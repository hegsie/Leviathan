/**
 * Leviathan - Git GUI Client
 * Application entry point
 */

// Import styles
import './styles/tokens.css';

// Localization runtime. Importing this configures @lit/localize in runtime
// mode; applying the persisted language here means the first paint is already
// in the user's language, and later changes re-render without a restart.
import { setAppLocale } from './i18n/index.ts';
import { settingsStore } from './stores/settings.store.ts';

// Import app shell
import './app-shell.ts';

// Import component registrations
import './components/index.ts';

import { loggers } from './utils/logger.ts';

void setAppLocale(settingsStore.getState().language);

loggers.app.info('Leviathan initialized');
