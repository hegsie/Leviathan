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
}

export interface PullCommand {
  path: string;
  remote?: string;
  branch?: string;
  rebase?: boolean;
}

export interface PushCommand {
  path: string;
  remote?: string;
  branch?: string;
  force?: boolean;
  setUpstream?: boolean;
}

/**
 * Merge commands
 */
export interface MergeCommand {
  path: string;
  source_ref: string;
  no_ff?: boolean;
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
 * Stash commands
 */
export interface CreateStashCommand {
  path: string;
  message?: string;
  include_untracked?: boolean;
}

export interface ApplyStashCommand {
  path: string;
  index: number;
  drop_after?: boolean;
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
  changeType: 'status' | 'index' | 'refs' | 'config';
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
  theme: 'light' | 'dark' | 'system';
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
