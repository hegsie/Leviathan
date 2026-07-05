/**
 * Output log service
 * Singleton store of git command executions displayed by <lv-output-panel>.
 * Entries are recorded by the IPC layer (tauri-api.ts) for state-changing
 * commands; read queries are excluded so the log stays meaningful.
 */

const MAX_ENTRIES = 100;

export interface OutputLogEntry {
  /** Stable identity — UI state (e.g. row expansion) must key off this, not
   *  the array position, which shifts every time a new entry is prepended. */
  id: number;
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
let nextEntryId = 1;

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
    id: nextEntryId++,
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
 * Clear log entries.
 *
 * With no argument, ALL entries are cleared (used by tests and injected setups).
 *
 * When `repoPath` is given, the log is scoped: entries for that repository are
 * removed AND repo-independent entries (those with no repoPath) are removed too
 * — those are the entries the scoped <lv-output-panel> actually displays, so
 * clearing matches what the user sees. Other repositories' entries are preserved
 * so clearing repo A never destroys repo B's history.
 */
export function clearLogEntries(repoPath?: string): void {
  if (repoPath === undefined) {
    logEntries.length = 0;
  } else {
    // Keep only entries that belong to a DIFFERENT repository.
    const kept = logEntries.filter(
      (e) => e.repoPath !== undefined && e.repoPath !== repoPath,
    );
    logEntries.length = 0;
    logEntries.push(...kept);
  }
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
