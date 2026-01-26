/**
 * API and IPC type definitions
 */

/**
 * Tauri command response wrapper
 */
export interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: CommandError;
}

export interface CommandError {
  code: string;
  message: string;
  details?: string;
}

/**
 * Repository commands
 */
export interface OpenRepositoryCommand {
  path: string;
}

export interface CloneRepositoryCommand {
  url: string;
  path: string;
  bare?: boolean;
  branch?: string;
  token?: string;
}

export interface InitRepositoryCommand {
  path: string;
  bare?: boolean;
}

/**
 * Branch commands
 */
export interface CreateBranchCommand {
  name: string;
  startPoint?: string;
  checkout?: boolean;
}

export interface DeleteBranchCommand {
  name: string;
  force?: boolean;
}

export interface RenameBranchCommand {
  oldName: string;
  newName: string;
}

export interface CheckoutCommand {
  ref: string;
  force?: boolean;
}

/**
 * Commit commands
 */
export interface CreateCommitCommand {
  message: string;
  amend?: boolean;
}

export interface GetCommitCommand {
  oid: string;
}

export interface GetCommitHistoryCommand {
  path: string;
  startOid?: string;
  limit?: number;
  skip?: number;
  /** Load commits from all branches, not just HEAD */
  allBranches?: boolean;
}

/**
 * Staging commands
 */
export interface StageFilesCommand {
  paths: string[];
}

export interface UnstageFilesCommand {
  paths: string[];
}

export interface DiscardChangesCommand {
  paths: string[];
}

/**
 * Remote commands
 */
export interface FetchCommand {
  path: string;
  remote?: string;
  prune?: boolean;
  token?: string;
}

export interface PullCommand {
  path: string;
  remote?: string;
  branch?: string;
  rebase?: boolean;
  token?: string;
}

export interface PushCommand {
  path: string;
  remote?: string;
  branch?: string;
  force?: boolean;
  setUpstream?: boolean;
  token?: string;
}

/**
 * Merge commands
 */
export interface MergeCommand {
  path: string;
  sourceRef: string;
  noFf?: boolean;
  squash?: boolean;
  message?: string;
}

export interface AbortMergeCommand {
  path: string;
}

/**
 * Rebase commands
 */
export interface RebaseCommand {
  path: string;
  onto: string;
}

export interface ContinueRebaseCommand {
  path: string;
}

export interface AbortRebaseCommand {
  path: string;
}

/**
 * Cherry-pick commands
 */
export interface CherryPickCommand {
  path: string;
  commitOid: string;
  /** If true, stages changes without committing (like `git cherry-pick -n`) */
  noCommit?: boolean;
}

export interface ContinueCherryPickCommand {
  path: string;
}

export interface AbortCherryPickCommand {
  path: string;
}

/**
 * Revert commands
 */
export interface RevertCommand {
  path: string;
  commitOid: string;
}

export interface ContinueRevertCommand {
  path: string;
}

export interface AbortRevertCommand {
  path: string;
}

/**
 * Reset commands
 */
export interface ResetCommand {
  path: string;
  targetRef: string;
  mode: "soft" | "mixed" | "hard";
}

/**
 * Stash commands
 */
export interface CreateStashCommand {
  path: string;
  message?: string;
  includeUntracked?: boolean;
}

export interface ApplyStashCommand {
  path: string;
  index: number;
  dropAfter?: boolean;
}

export interface DropStashCommand {
  path: string;
  index: number;
}

export interface PopStashCommand {
  path: string;
  index: number;
}

/**
 * Tag commands
 */
export interface CreateTagCommand {
  path: string;
  name: string;
  target?: string;
  message?: string;
}

export interface DeleteTagCommand {
  path: string;
  name: string;
}

export interface PushTagCommand {
  path: string;
  name: string;
  remote?: string;
  force?: boolean;
}

/**
 * Diff commands
 */
export interface GetDiffCommand {
  path?: string;
  staged?: boolean;
  commit?: string;
  compareWith?: string;
}

/**
 * Event payloads
 */
export interface RepositoryChangedEvent {
  path: string;
  changeType: "status" | "index" | "refs" | "config";
}

export interface OperationProgressEvent {
  operation: string;
  current: number;
  total: number;
  message?: string;
}

export interface OperationCompleteEvent {
  operation: string;
  success: boolean;
  message?: string;
}

/**
 * Settings
 */
export interface AppSettings {
  theme: "light" | "dark" | "system";
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  wordWrap: boolean;
  showLineNumbers: boolean;
  autoFetch: boolean;
  autoFetchInterval: number;
  confirmBeforeDelete: boolean;
  gpgSign: boolean;
  defaultRemote: string;
}

export interface GitSettings {
  userName: string;
  userEmail: string;
  defaultBranch: string;
  autoStash: boolean;
  pruneOnFetch: boolean;
  rebaseOnPull: boolean;
}

/**
 * Maintenance commands
 */
export interface RunGcCommand {
  path: string;
  /** Run more thorough but slower garbage collection */
  aggressive?: boolean;
  /** Prune objects older than this date (e.g., "2.weeks.ago", "now") */
  prune?: string;
  /** Only run gc if needed (based on heuristics) */
  auto?: boolean;
}

export interface RunFsckCommand {
  path: string;
  /** Run a more thorough check */
  full?: boolean;
}

export interface RunPruneCommand {
  path: string;
  /** Show what would be pruned without actually pruning */
  dryRun?: boolean;
}

export interface MaintenanceResult {
  success: boolean;
  message: string;
}
