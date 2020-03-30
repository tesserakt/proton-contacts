import React from 'react';
import PropTypes from 'prop-types';
import { ErrorBoundary, StandardPrivateApp } from 'react-components';
import { Redirect, Route, Switch } from 'react-router';
import {
    UserModel,
    ContactsModel,
    ContactEmailsModel,
    LabelsModel,
    UserSettingsModel,
    SubscriptionModel,
    MailSettingsModel
} from 'proton-shared/lib/models';
import locales from '../locales';

import ContactsProvider from '../containers/ContactProvider';
import ContactsContainer from '../containers/ContactsContainer';
import SettingsContainer from '../containers/SettingsContainer';

const EVENT_MODELS = [
    UserModel,
    UserSettingsModel,
    MailSettingsModel,
    ContactsModel,
    SubscriptionModel,
    ContactEmailsModel,
    LabelsModel
];

const PRELOAD_MODELS = [UserSettingsModel, UserModel];

const PrivateApp = ({ onLogout }) => {
    return (
        <StandardPrivateApp
            locales={locales}
            onLogout={onLogout}
            preloadModels={PRELOAD_MODELS}
            eventModels={EVENT_MODELS}
        >
            <ContactsProvider>
                <ErrorBoundary>
                    <Switch>
                        <Route
                            path="/contacts/settings"
                            render={({ location }) => <SettingsContainer location={location} />}
                        />
                        <Route
                            path="/contacts"
                            render={({ location, history }) => (
                                <ContactsContainer location={location} history={history} />
                            )}
                        />
                        <Redirect to="/contacts" />
                    </Switch>
                </ErrorBoundary>
            </ContactsProvider>
        </StandardPrivateApp>
    );
};

PrivateApp.propTypes = {
    onLogout: PropTypes.func.isRequired
};

export default PrivateApp;
