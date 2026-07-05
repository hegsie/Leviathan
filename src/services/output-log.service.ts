/**
 * Output log service
 * Singleton store of git command executions displayed by <lv-output-panel>.
 * Entries are recorded by the IPC layer (tauri-api.ts) for state-changing
 * commands; read queries are excluded so the log stays meaningful.
 */

const MAX_ENTRIES = 100;

export interface OutputLogEntry {
  timestamp: number;
  command: string;
  output: string;
  success: boolean;
  /** Repository the command ran against (absent for repo-independent commands) */
  repoPath?: string;
}

// Singleton log entries array and listeners
const logEntries: OutputLogEntry[] = [];
const listeners: Set<() => void> = new Set();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Subscribe to log changes. Returns an unsubscribe function.
 */
export function subscribeOutputLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Log a git command execution result.
 */
export function logGitCommand(
  command: string,
  output: string,
  success: boolean,
  repoPath?: string,
): void {
  logEntries.unshift({
    timestamp: Date.now(),
    command,
    output,
    success,
    repoPath,
  });

  // Trim to max entries
  if (logEntries.length > MAX_ENTRIES) {
    logEntries.length = MAX_ENTRIES;
  }

  notifyListeners();
}

/**
 * Get current log entries (read-only snapshot).
 */
export function getLogEntries(): ReadonlyArray<OutputLogEntry> {
  return logEntries;
}

/**
 * Clear all log entries.
 */
export function clearLogEntries(): void {
  logEntries.length = 0;
  notifyListeners();
}

// Read queries would flood the 100-entry buffer with noise (status polls,
// graph loads), and keyring/watcher plumbing isn't a git operation the user
// initiated — only state-changing commands belong in the output panel.
const SKIP_PREFIXES = [
  'get_',
  'list_',
  'check_',
  'detect_',
  'read_',
  'search_',
  'preview_',
  'is_',
  'plugin:',
];
const SKIP_COMMANDS = new Set([
  'start_watching',
  'stop_watching',
  'store_keyring_token',
  'delete_keyring_token',
  // App plumbing, not git operations the user ran
  'open_repository',
  'close_repository',
]);

/**
 * Whether an IPC command's result should be recorded in the output panel.
 */
export function shouldLogToOutput(command: string): boolean {
  if (SKIP_COMMANDS.has(command)) return false;
  return !SKIP_PREFIXES.some((prefix) => command.startsWith(prefix));
}
