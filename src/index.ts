/**
 * Leviathan - Git GUI Client
 * Application entry point
 */

// Import styles
import './styles/tokens.css';

// Import app shell
import './app-shell.ts';

// Import component registrations
import './components/index.ts';

import { loggers } from './utils/logger.ts';
loggers.app.info('Leviathan initialized');
