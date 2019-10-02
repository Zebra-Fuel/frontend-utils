import * as Sentry from '@sentry/browser';

const { REACT_APP_VERSION = 'unknown' } = process.env;

const config = configuration => {
    if (configuration.SENTRY_URL) {
        // eslint-disable-next-line no-console
        console.info(`Setting up Sentry (${REACT_APP_VERSION})...`);
        Sentry.init({
            dns: configuration.SENTRY_URL,
            release: REACT_APP_VERSION,
            environment: configuration.ENV,
        });
    } else {
        // eslint-disable-next-line no-console
        console.warn('No SENTRY_URL set - skipping Sentry setup.');
    }
};

const configScope = data => Sentry.configureScope(scope => scope.setUser(data));

export default { config, configScope };
