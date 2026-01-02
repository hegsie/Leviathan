/**
 * Logger utility for consistent logging across the application
 * Logs are only shown in development mode
 */

const isDev = import.meta.env.DEV;

interface LoggerOptions {
  prefix?: string;
}

class Logger {
  private prefix: string;

  constructor(options: LoggerOptions = {}) {
    this.prefix = options.prefix ? `[${options.prefix}]` : '';
  }

  private formatMessage(...args: unknown[]): unknown[] {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
    return [`${timestamp} ${this.prefix}`, ...args];
  }

  debug(...args: unknown[]): void {
    if (isDev) {
      console.log(...this.formatMessage(...args));
    }
  }

  info(...args: unknown[]): void {
    if (isDev) {
      console.info(...this.formatMessage(...args));
    }
  }

  warn(...args: unknown[]): void {
    console.warn(...this.formatMessage(...args));
  }

  error(...args: unknown[]): void {
    console.error(...this.formatMessage(...args));
  }
}

/**
 * Create a logger instance with an optional prefix
 */
export function createLogger(prefix?: string): Logger {
  return new Logger({ prefix });
}

/**
 * Default logger instance
 */
export const logger = createLogger();

/**
 * Pre-configured loggers for specific services
 */
export const loggers = {
  credential: createLogger('Credential'),
  profile: createLogger('Profile'),
  git: createLogger('Git'),
  ui: createLogger('UI'),
  keyboard: createLogger('Keyboard'),
  watcher: createLogger('Watcher'),
  integration: createLogger('Integration'),
  dialog: createLogger('Dialog'),
  app: createLogger('App'),
  azureDevOps: createLogger('AzureDevOps'),
  graph: createLogger('Graph'),
};
