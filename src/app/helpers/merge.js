import { normalize } from 'proton-shared/lib/helpers/string';
import { hasPref, generateNewGroupName } from 'proton-shared/lib/contacts/properties';
import { unique } from 'proton-shared/lib/helpers/array';
import {
    ONE_OR_MORE_MUST_BE_PRESENT,
    ONE_OR_MORE_MAY_BE_PRESENT,
    PROPERTIES,
    isCustomField,
} from 'proton-shared/lib/contacts/vcard';

/**
 * Given an array of keys and an object storing an index for each key,
 * if the object contains any of these keys, return the index stored in the object
 * for the first of such keys. Otherwise return -1
 * @param {Array} keys
 * @param {Object} obj
 *
 * @returns {Number}
 */
const findKeyIndex = (keys, obj) => {
    for (const key of keys) {
        if (obj[key] !== undefined) {
            return obj[key];
        }
    }
    return -1;
};

/**
 * Given a list of connections (a "connection" is a list of keys [key1, key2, ...] connected for some reason),
 * find recursively all connections and return a new list of connections with no key repeated.
 * E.g.: [[1, 2, 3], [3, 5], [4, 6]] ->  [[1, 2, 3, 5], [4, 6]]
 * @param {Array} connections
 *
 * @returns {Array}
 */
export const linkConnections = (connections) => {
    let didModify = false;

    const { newConnections } = connections.reduce(
        (acc, connection) => {
            const { connected, newConnections } = acc;
            // check if some index in current connection has been connected already
            const indexFound = findKeyIndex(connection, connected);

            if (indexFound !== -1) {
                // add indices in current connection to the connected connection
                newConnections[indexFound] = unique([...connection, ...newConnections[indexFound]]);
                for (const key of connection) {
                    // update list of connected indices
                    if (connected[key] === undefined) {
                        connected[key] = indexFound;
                    }
                }
                didModify = true;
            } else {
                // update list of connected indices
                for (const key of connection) {
                    connected[key] = newConnections.length;
                }
                newConnections.push(connection);
            }
            return acc;
        },
        { connected: Object.create(null), newConnections: [] }
    );
    // if some indices previously unconnected have been connected,
    // run linkConnections again
    if (didModify) {
        return linkConnections(newConnections);
    }
    // otherwise no more connections to be established
    return connections;
};

/**
 * Given a list of contacts, extract the ones that can be merged
 * @param {Array<Object>} contacts      Each contact is an object { ID, emails, Name, LabelIDs }
 *
 * @returns {Array<Array<Object>>}      List of groups of contacts that can be merged
 */
export const extractMergeable = (contacts = []) => {
    // detect duplicate names
    // namesConnections = { name: [contact indices with this name] }
    const namesConnections = Object.values(
        contacts.reduce((acc, { Name }, index) => {
            const name = normalize(Name);

            if (!acc[name]) {
                acc[name] = [index];
            } else {
                acc[name].push(index);
            }

            return acc;
        }, Object.create(null))
    )
        .map(unique)
        .filter((connection) => connection.length > 1);

    // detect duplicate emails
    // emailConnections = { email: [contact indices with this email] }
    const emailConnections = Object.values(
        contacts.reduce((acc, { emails }, index) => {
            emails.map(normalize).forEach((email) => {
                if (!acc[email]) {
                    acc[email] = [index];
                } else {
                    acc[email].push(index);
                }
            });
            return acc;
        }, Object.create(null))
    )
        .map(unique)
        .filter((connection) => connection.length > 1);

    // Now we collect contact indices that go together
    // either in duplicate names or duplicate emails.
    const allConnections = linkConnections([...namesConnections, ...emailConnections]);

    return allConnections.map((indices) => indices.map((index) => contacts[index]));
};

/**
 * Given the value and field of a contact property, and a list of merged properties,
 * return and object with a Boolean that tells if the value has been merged or is a new value.
 * In the latter case, return the new value in the object
 * @param {String|Array} value
 * @param {String} field
 * @param {Array<String|Array>} mergedValues
 * @returns {Object} { isNewValue: {Boolean}, newValue: {String|Array} }
 * @dev  Normalize strings in all fields but EMAIL
 */
export const extractNewValue = (value, field, mergedValues = []) => {
    //  the fields n and adr have to be treated separately since they are array-valued
    if (['adr', 'n'].includes(field)) {
        // value is an array in this case, whose elements can be strings or arrays of strings

        // compare with merged values. Normalize all strings
        const isNotRepeatedValue = mergedValues
            .map((mergedValue) => {
                // check element by element to see if there are new values
                const newComponents = mergedValue
                    .map((component, index) => {
                        // each of the components inside be an array itself
                        const componentIsArray = Array.isArray(component);
                        const valueIsArray = Array.isArray(value[index]);
                        if (componentIsArray && valueIsArray) {
                            return value[index].some((str) => !component.map(normalize).includes(normalize(str)));
                        }
                        if (!componentIsArray && !valueIsArray) {
                            return normalize(component) !== normalize(value[index]);
                        }
                        return componentIsArray ? component.includes(value) : true;
                    })
                    .filter(Boolean);

                return !newComponents.length;
            })
            // keep track of only repeated addresses
            .filter(Boolean);

        // if the be-new address is repeated, it is not new
        const isNew = !isNotRepeatedValue.length;
        return { isNewValue: isNew, newValue: isNew ? value : undefined };
    }
    // for the other fields, value is a string, and mergedValues an array of strings
    // for EMAIL field, do not normalize, only trim
    if (field === 'email') {
        const isNew = !mergedValues.map((value) => value.trim()).includes(value.trim());
        return { isNewValue: isNew, newValue: isNew ? value : undefined };
    }
    // for the rest of the fields, normalize strings
    const isNew = !mergedValues.map(normalize).includes(normalize(value));
    return { isNewValue: isNew, newValue: isNew ? value : undefined };
};

/**
 * Merge a list of contacts. The contacts must be ordered in terms of preference.
 * @param {Array<Array<Object>>} contacts   Each contact is a list of properties [{ pref, field, group, type, value }]
 *
 * @return {Array}                          The merged contact
 */
export const merge = (contacts = []) => {
    if (!contacts.length) {
        return [];
    }

    const { mergedContact } = contacts.reduce(
        (acc, contact, index) => {
            const { mergedContact, mergedProperties, mergedPropertiesPrefs, mergedGroups } = acc;
            if (index === 0) {
                // merged contact inherits all properties from the first contact
                mergedContact.push(...contact);
                // keep track of merged properties with respective prefs and merged groups
                for (const { pref, field, value, group } of contact) {
                    if (!mergedProperties[field]) {
                        mergedProperties[field] = [value];
                        if (hasPref(field)) {
                            mergedPropertiesPrefs[field] = [pref];
                        }
                    } else {
                        mergedProperties[field].push(value);
                        if (hasPref(field)) {
                            mergedPropertiesPrefs[field].push(pref);
                        }
                    }
                    // email and groups are in one-to-one correspondence
                    if (field === 'email') {
                        mergedGroups[value] = group;
                    }
                }
            } else {
                // for the other contacts, keep only non-merged properties

                // but first prepare to change repeated groups
                // extract groups in contact to be merged
                const groups = contact
                    .filter(({ field }) => field === 'email')
                    .map(({ value, group }) => ({ email: value, group }));
                // establish how groups should be changed
                const changeGroup = groups.reduce((acc, { email, group }) => {
                    if (Object.values(mergedGroups).includes(group)) {
                        const newGroup = mergedGroups[email] || generateNewGroupName(Object.values(mergedGroups));
                        acc[group] = newGroup;
                        mergedGroups[email] = newGroup;
                    } else {
                        acc[group] = group;
                    }
                    return acc;
                }, {});

                for (const property of contact) {
                    const { pref, field, group, value } = property;
                    const newGroup = group ? changeGroup[group] : group;
                    if (!mergedProperties[field]) {
                        // an unseen property is directly merged
                        mergedContact.push({ ...property, pref, group: newGroup });
                        mergedProperties[field] = [value];
                        if (hasPref(field)) {
                            mergedPropertiesPrefs[field] = [pref];
                        }
                        if (newGroup && field === 'email') {
                            mergedGroups[value] = newGroup;
                        }
                    } else {
                        // for properties already seen,
                        // check if there is a new value for it
                        const { isNewValue, newValue } = extractNewValue(value, field, mergedProperties[field]);
                        const newPref = hasPref(field) ? Math.max(...mergedPropertiesPrefs[field]) + 1 : undefined;
                        // check if the new value can be added
                        const canAdd =
                            isCustomField(field) ||
                            [ONE_OR_MORE_MAY_BE_PRESENT, ONE_OR_MORE_MUST_BE_PRESENT].includes(
                                PROPERTIES[field].cardinality
                            );

                        if (isNewValue && canAdd) {
                            mergedContact.push({ ...property, pref: newPref, value: newValue, group: newGroup });
                            mergedProperties[field].push(newValue);
                            if (hasPref(field)) {
                                mergedPropertiesPrefs[field] = [newPref];
                            }
                            if (newGroup && field === 'email') {
                                mergedGroups[value] = newGroup;
                            }
                        }
                    }
                }
            }
            return acc;
        },
        {
            mergedContact: [],
            mergedProperties: {},
            mergedPropertiesPrefs: {},
            mergedGroups: {},
        }
    );

    return mergedContact;
};
