/**
 * Leviathan - Git GUI Client
 * Application entry point
 */

// Import styles
import './styles/tokens.css';

// Localization runtime. Importing this configures @lit/localize in runtime
// mode; applying the persisted language here means the first paint is already
// in the user's language, and later changes re-render without a restart.
import './i18n/index.ts';
import { applyPersistedLocale } from './stores/settings.store.ts';

// Import app shell
import './app-shell.ts';

// Import component registrations
import './components/index.ts';

import { loggers } from './utils/logger.ts';

// Through the store action, not setAppLocale(): a persisted language whose
// templates cannot be loaded must be written back as the locale that really
// rendered, or Settings would keep naming a language the UI is not in.
void applyPersistedLocale();

loggers.app.info('Leviathan initialized');
