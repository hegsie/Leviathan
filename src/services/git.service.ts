/**
 * Git Service
 * Provides high-level Git operations via Tauri commands
 */

import { invokeCommand } from './tauri-api.ts';
import type {
  Repository,
  Commit,
  Branch,
  Remote,
  Tag,
  Stash,
  RebaseCommit,
  ConflictFile,
  StatusEntry,
  DiffFile,
  RefsByCommit,
  CommitFileEntry,
  CommitStats,
  BlameResult,
  ReflogEntry,
} from '../types/git.types.ts';
import type {
  OpenRepositoryCommand,
  CloneRepositoryCommand,
  InitRepositoryCommand,
  CreateBranchCommand,
  RenameBranchCommand,
  CheckoutCommand,
  CreateCommitCommand,
  GetCommitHistoryCommand,
  StageFilesCommand,
  UnstageFilesCommand,
  FetchCommand,
  PullCommand,
  PushCommand,
  MergeCommand,
  AbortMergeCommand,
  RebaseCommand,
  ContinueRebaseCommand,
  AbortRebaseCommand,
  CherryPickCommand,
  ContinueCherryPickCommand,
  AbortCherryPickCommand,
  RevertCommand,
  ContinueRevertCommand,
  AbortRevertCommand,
  ResetCommand,
  CreateStashCommand,
  ApplyStashCommand,
  DropStashCommand,
  PopStashCommand,
  CreateTagCommand,
  DeleteTagCommand,
  PushTagCommand,
  GetDiffCommand,
  CommandResult,
} from '../types/api.types.ts';

/**
 * Repository operations
 */
export async function openRepository(
  args: OpenRepositoryCommand
): Promise<CommandResult<Repository>> {
  return invokeCommand<Repository>('open_repository', args);
}

export async function cloneRepository(
  args: CloneRepositoryCommand
): Promise<CommandResult<Repository>> {
  return invokeCommand<Repository>('clone_repository', args);
}

export async function initRepository(
  args: InitRepositoryCommand
): Promise<CommandResult<Repository>> {
  return invokeCommand<Repository>('init_repository', args);
}

/**
 * Branch operations
 */
export async function getBranches(path: string): Promise<CommandResult<Branch[]>> {
  return invokeCommand<Branch[]>('get_branches', { path });
}

export async function createBranch(
  path: string,
  args: CreateBranchCommand
): Promise<CommandResult<Branch>> {
  return invokeCommand<Branch>('create_branch', { path, ...args });
}

export async function deleteBranch(
  path: string,
  name: string,
  force?: boolean
): Promise<CommandResult<void>> {
  return invokeCommand<void>('delete_branch', { path, name, force });
}

export async function renameBranch(
  path: string,
  args: RenameBranchCommand
): Promise<CommandResult<Branch>> {
  return invokeCommand<Branch>('rename_branch', { path, ...args });
}

export async function checkout(
  path: string,
  args: CheckoutCommand
): Promise<CommandResult<void>> {
  return invokeCommand<void>('checkout', { path, ...args });
}

/**
 * Commit operations
 */
export async function getCommitHistory(
  args: GetCommitHistoryCommand
): Promise<CommandResult<Commit[]>> {
  return invokeCommand<Commit[]>('get_commit_history', args);
}

export async function getCommit(oid: string): Promise<CommandResult<Commit>> {
  return invokeCommand<Commit>('get_commit', { oid });
}

/**
 * Search commits with filters
 */
export async function searchCommits(
  repoPath: string,
  options: {
    query?: string;
    author?: string;
    dateFrom?: number;
    dateTo?: number;
    filePath?: string;
    limit?: number;
  }
): Promise<CommandResult<Commit[]>> {
  return invokeCommand<Commit[]>('search_commits', {
    path: repoPath,
    query: options.query,
    author: options.author,
    date_from: options.dateFrom,
    date_to: options.dateTo,
    file_path: options.filePath,
    limit: options.limit,
  });
}

export async function createCommit(
  path: string,
  args: CreateCommitCommand
): Promise<CommandResult<Commit>> {
  return invokeCommand<Commit>('create_commit', { path, ...args });
}

/**
 * Staging operations
 */
export async function getStatus(path: string): Promise<CommandResult<StatusEntry[]>> {
  return invokeCommand<StatusEntry[]>('get_status', { path });
}

export async function stageFiles(
  repoPath: string,
  args: StageFilesCommand
): Promise<CommandResult<void>> {
  return invokeCommand<void>('stage_files', { path: repoPath, ...args });
}

export async function unstageFiles(
  repoPath: string,
  args: UnstageFilesCommand
): Promise<CommandResult<void>> {
  return invokeCommand<void>('unstage_files', { path: repoPath, ...args });
}

export async function discardChanges(
  repoPath: string,
  paths: string[]
): Promise<CommandResult<void>> {
  return invokeCommand<void>('discard_changes', { path: repoPath, paths });
}

/**
 * Stage a specific hunk from a diff
 * @param repoPath Repository path
 * @param patch The patch content for the hunk (with proper diff headers)
 */
export async function stageHunk(
  repoPath: string,
  patch: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('stage_hunk', { repoPath, patch });
}

/**
 * Unstage a specific hunk from the index
 * @param repoPath Repository path
 * @param patch The patch content for the hunk (with proper diff headers)
 */
export async function unstageHunk(
  repoPath: string,
  patch: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('unstage_hunk', { repoPath, patch });
}

/**
 * Remote operations
 */
export async function getRemotes(path: string): Promise<CommandResult<Remote[]>> {
  return invokeCommand<Remote[]>('get_remotes', { path });
}

export async function addRemote(
  repoPath: string,
  name: string,
  url: string
): Promise<CommandResult<Remote>> {
  return invokeCommand<Remote>('add_remote', { path: repoPath, name, url });
}

export async function removeRemote(
  repoPath: string,
  name: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('remove_remote', { path: repoPath, name });
}

export async function renameRemote(
  repoPath: string,
  oldName: string,
  newName: string
): Promise<CommandResult<Remote>> {
  return invokeCommand<Remote>('rename_remote', { path: repoPath, oldName, newName });
}

export async function setRemoteUrl(
  repoPath: string,
  name: string,
  url: string,
  push?: boolean
): Promise<CommandResult<Remote>> {
  return invokeCommand<Remote>('set_remote_url', { path: repoPath, name, url, push });
}

export async function fetch(args?: FetchCommand): Promise<CommandResult<void>> {
  return invokeCommand<void>('fetch', args);
}

export async function pull(args?: PullCommand): Promise<CommandResult<void>> {
  return invokeCommand<void>('pull', args);
}

export async function push(args?: PushCommand): Promise<CommandResult<void>> {
  return invokeCommand<void>('push', args);
}

/**
 * Merge operations
 */
export async function merge(args: MergeCommand): Promise<CommandResult<void>> {
  return invokeCommand<void>('merge', args);
}

export async function abortMerge(
  args: AbortMergeCommand
): Promise<CommandResult<void>> {
  return invokeCommand<void>('abort_merge', args);
}

/**
 * Rebase operations
 */
export async function rebase(
  args: RebaseCommand
): Promise<CommandResult<void>> {
  return invokeCommand<void>('rebase', args);
}

export async function continueRebase(
  args: ContinueRebaseCommand
): Promise<CommandResult<void>> {
  return invokeCommand<void>('continue_rebase', args);
}

export async function abortRebase(
  args: AbortRebaseCommand
): Promise<CommandResult<void>> {
  return invokeCommand<void>('abort_rebase', args);
}

export async function getRebaseCommits(
  path: string,
  onto: string
): Promise<CommandResult<RebaseCommit[]>> {
  return invokeCommand<RebaseCommit[]>('get_rebase_commits', { path, onto });
}

export async function executeInteractiveRebase(
  path: string,
  onto: string,
  todo: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('execute_interactive_rebase', { path, onto, todo });
}

/**
 * Conflict resolution operations
 */
export async function getConflicts(
  path: string
): Promise<CommandResult<ConflictFile[]>> {
  return invokeCommand<ConflictFile[]>('get_conflicts', { path });
}

export async function getBlobContent(
  path: string,
  oid: string
): Promise<CommandResult<string>> {
  return invokeCommand<string>('get_blob_content', { path, oid });
}

export async function resolveConflict(
  path: string,
  filePath: string,
  content: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('resolve_conflict', { path, file_path: filePath, content });
}

/**
 * Cherry-pick operations
 */
export async function cherryPick(
  args: CherryPickCommand
): Promise<CommandResult<Commit>> {
  return invokeCommand<Commit>('cherry_pick', args);
}

export async function continueCherryPick(
  args: ContinueCherryPickCommand
): Promise<CommandResult<Commit>> {
  return invokeCommand<Commit>('continue_cherry_pick', args);
}

export async function abortCherryPick(
  args: AbortCherryPickCommand
): Promise<CommandResult<void>> {
  return invokeCommand<void>('abort_cherry_pick', args);
}

/**
 * Revert operations
 */
export async function revert(
  args: RevertCommand
): Promise<CommandResult<Commit>> {
  return invokeCommand<Commit>('revert', args);
}

export async function continueRevert(
  args: ContinueRevertCommand
): Promise<CommandResult<Commit>> {
  return invokeCommand<Commit>('continue_revert', args);
}

export async function abortRevert(
  args: AbortRevertCommand
): Promise<CommandResult<void>> {
  return invokeCommand<void>('abort_revert', args);
}

/**
 * Reset operations
 */
export async function reset(
  args: ResetCommand
): Promise<CommandResult<void>> {
  return invokeCommand<void>('reset', args);
}

/**
 * Stash operations
 */
export async function getStashes(path: string): Promise<CommandResult<Stash[]>> {
  return invokeCommand<Stash[]>('get_stashes', { path });
}

export async function createStash(
  args: CreateStashCommand
): Promise<CommandResult<Stash>> {
  return invokeCommand<Stash>('create_stash', args);
}

export async function applyStash(
  args: ApplyStashCommand
): Promise<CommandResult<void>> {
  return invokeCommand<void>('apply_stash', args);
}

export async function dropStash(
  args: DropStashCommand
): Promise<CommandResult<void>> {
  return invokeCommand<void>('drop_stash', args);
}

export async function popStash(
  args: PopStashCommand
): Promise<CommandResult<void>> {
  return invokeCommand<void>('pop_stash', args);
}

/**
 * Tag operations
 */
export async function getTags(path: string): Promise<CommandResult<Tag[]>> {
  return invokeCommand<Tag[]>('get_tags', { path });
}

export async function createTag(
  args: CreateTagCommand
): Promise<CommandResult<Tag>> {
  return invokeCommand<Tag>('create_tag', args);
}

export async function deleteTag(
  args: DeleteTagCommand
): Promise<CommandResult<void>> {
  return invokeCommand<void>('delete_tag', args);
}

export async function pushTag(
  args: PushTagCommand
): Promise<CommandResult<void>> {
  return invokeCommand<void>('push_tag', args);
}

/**
 * Diff operations
 */
export async function getDiff(
  args?: GetDiffCommand
): Promise<CommandResult<DiffFile[]>> {
  return invokeCommand<DiffFile[]>('get_diff', args);
}

export async function getFileDiff(
  repoPath: string,
  filePath: string,
  staged?: boolean
): Promise<CommandResult<DiffFile>> {
  return invokeCommand<DiffFile>('get_file_diff', { path: repoPath, filePath, staged });
}

export async function getCommitFiles(
  repoPath: string,
  commitOid: string
): Promise<CommandResult<CommitFileEntry[]>> {
  return invokeCommand<CommitFileEntry[]>('get_commit_files', { path: repoPath, commitOid });
}

export async function getCommitFileDiff(
  repoPath: string,
  commitOid: string,
  filePath: string
): Promise<CommandResult<DiffFile>> {
  return invokeCommand<DiffFile>('get_commit_file_diff', { path: repoPath, commitOid, filePath });
}

/**
 * Get stats (additions/deletions) for multiple commits in bulk
 * Optimized for graph view to show commit sizes
 */
export async function getCommitsStats(
  repoPath: string,
  commitOids: string[]
): Promise<CommandResult<CommitStats[]>> {
  return invokeCommand<CommitStats[]>('get_commits_stats', { path: repoPath, commitOids });
}

/**
 * Get blame information for a file
 */
export async function getFileBlame(
  repoPath: string,
  filePath: string,
  commitOid?: string
): Promise<CommandResult<BlameResult>> {
  return invokeCommand<BlameResult>('get_file_blame', { path: repoPath, filePath, commitOid });
}

/**
 * Get all commits that modified a specific file
 */
export async function getFileHistory(
  repoPath: string,
  filePath: string,
  limit?: number,
  followRenames?: boolean
): Promise<CommandResult<Commit[]>> {
  return invokeCommand<Commit[]>('get_file_history', {
    path: repoPath,
    filePath,
    limit,
    followRenames,
  });
}

/**
 * Refs operations
 */
export async function getRefsByCommit(
  path: string
): Promise<CommandResult<RefsByCommit>> {
  return invokeCommand<RefsByCommit>('get_refs_by_commit', { path });
}

/**
 * Reflog operations
 */
export async function getReflog(
  repoPath: string,
  limit?: number
): Promise<CommandResult<ReflogEntry[]>> {
  return invokeCommand<ReflogEntry[]>('get_reflog', { path: repoPath, limit });
}

export async function resetToReflog(
  repoPath: string,
  reflogIndex: number,
  mode: 'soft' | 'mixed' | 'hard' = 'mixed'
): Promise<CommandResult<ReflogEntry>> {
  return invokeCommand<ReflogEntry>('reset_to_reflog', {
    path: repoPath,
    reflogIndex,
    mode,
  });
}

/**
 * Clean operations
 */
export interface CleanEntry {
  path: string;
  isDirectory: boolean;
  isIgnored: boolean;
  size: number | null;
}

export async function getCleanableFiles(
  repoPath: string,
  includeIgnored?: boolean,
  includeDirectories?: boolean
): Promise<CommandResult<CleanEntry[]>> {
  return invokeCommand<CleanEntry[]>('get_cleanable_files', {
    path: repoPath,
    includeIgnored,
    includeDirectories,
  });
}

export async function cleanFiles(
  repoPath: string,
  paths: string[]
): Promise<CommandResult<number>> {
  return invokeCommand<number>('clean_files', {
    path: repoPath,
    paths,
  });
}

export async function cleanAll(
  repoPath: string,
  includeIgnored?: boolean,
  includeDirectories?: boolean
): Promise<CommandResult<number>> {
  return invokeCommand<number>('clean_all', {
    path: repoPath,
    includeIgnored,
    includeDirectories,
  });
}

/**
 * Bisect operations
 */
export interface BisectLogEntry {
  commitOid: string;
  action: string;
  message: string | null;
}

export interface BisectStatus {
  active: boolean;
  currentCommit: string | null;
  badCommit: string | null;
  goodCommit: string | null;
  remaining: number | null;
  totalSteps: number | null;
  currentStep: number | null;
  log: BisectLogEntry[];
}

export interface CulpritCommit {
  oid: string;
  summary: string;
  author: string;
  email: string;
}

export interface BisectStepResult {
  status: BisectStatus;
  culprit: CulpritCommit | null;
  message: string;
}

export async function getBisectStatus(
  repoPath: string
): Promise<CommandResult<BisectStatus>> {
  return invokeCommand<BisectStatus>('get_bisect_status', { path: repoPath });
}

export async function bisectStart(
  repoPath: string,
  badCommit?: string,
  goodCommit?: string
): Promise<CommandResult<BisectStepResult>> {
  return invokeCommand<BisectStepResult>('bisect_start', {
    path: repoPath,
    badCommit,
    goodCommit,
  });
}

export async function bisectBad(
  repoPath: string,
  commit?: string
): Promise<CommandResult<BisectStepResult>> {
  return invokeCommand<BisectStepResult>('bisect_bad', {
    path: repoPath,
    commit,
  });
}

export async function bisectGood(
  repoPath: string,
  commit?: string
): Promise<CommandResult<BisectStepResult>> {
  return invokeCommand<BisectStepResult>('bisect_good', {
    path: repoPath,
    commit,
  });
}

export async function bisectSkip(
  repoPath: string,
  commit?: string
): Promise<CommandResult<BisectStepResult>> {
  return invokeCommand<BisectStepResult>('bisect_skip', {
    path: repoPath,
    commit,
  });
}

export async function bisectReset(
  repoPath: string
): Promise<CommandResult<BisectStepResult>> {
  return invokeCommand<BisectStepResult>('bisect_reset', { path: repoPath });
}

/**
 * Submodule operations
 */
export type SubmoduleStatus = 'current' | 'modified' | 'uninitialized' | 'missing' | 'dirty';

export interface Submodule {
  name: string;
  path: string;
  url: string | null;
  headOid: string | null;
  branch: string | null;
  initialized: boolean;
  status: SubmoduleStatus;
}

export async function getSubmodules(
  repoPath: string
): Promise<CommandResult<Submodule[]>> {
  return invokeCommand<Submodule[]>('get_submodules', { path: repoPath });
}

export async function addSubmodule(
  repoPath: string,
  url: string,
  submodulePath: string,
  branch?: string
): Promise<CommandResult<Submodule>> {
  return invokeCommand<Submodule>('add_submodule', {
    path: repoPath,
    url,
    submodulePath,
    branch,
  });
}

export async function initSubmodules(
  repoPath: string,
  submodulePaths?: string[]
): Promise<CommandResult<void>> {
  return invokeCommand<void>('init_submodules', {
    path: repoPath,
    submodulePaths,
  });
}

export async function updateSubmodules(
  repoPath: string,
  options?: {
    submodulePaths?: string[];
    init?: boolean;
    recursive?: boolean;
    remote?: boolean;
  }
): Promise<CommandResult<void>> {
  return invokeCommand<void>('update_submodules', {
    path: repoPath,
    submodulePaths: options?.submodulePaths,
    init: options?.init,
    recursive: options?.recursive,
    remote: options?.remote,
  });
}

export async function syncSubmodules(
  repoPath: string,
  submodulePaths?: string[]
): Promise<CommandResult<void>> {
  return invokeCommand<void>('sync_submodules', {
    path: repoPath,
    submodulePaths,
  });
}

export async function deinitSubmodule(
  repoPath: string,
  submodulePath: string,
  force?: boolean
): Promise<CommandResult<void>> {
  return invokeCommand<void>('deinit_submodule', {
    path: repoPath,
    submodulePath,
    force,
  });
}

export async function removeSubmodule(
  repoPath: string,
  submodulePath: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('remove_submodule', {
    path: repoPath,
    submodulePath,
  });
}

/**
 * Worktree operations
 */
export interface Worktree {
  path: string;
  headOid: string | null;
  branch: string | null;
  isMain: boolean;
  isLocked: boolean;
  lockReason: string | null;
  isBare: boolean;
  isPrunable: boolean;
}

export async function getWorktrees(
  repoPath: string
): Promise<CommandResult<Worktree[]>> {
  return invokeCommand<Worktree[]>('get_worktrees', { path: repoPath });
}

export async function addWorktree(
  repoPath: string,
  worktreePath: string,
  options?: {
    branch?: string;
    newBranch?: string;
    commit?: string;
    force?: boolean;
    detach?: boolean;
  }
): Promise<CommandResult<Worktree>> {
  return invokeCommand<Worktree>('add_worktree', {
    path: repoPath,
    worktreePath,
    branch: options?.branch,
    newBranch: options?.newBranch,
    commit: options?.commit,
    force: options?.force,
    detach: options?.detach,
  });
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force?: boolean
): Promise<CommandResult<void>> {
  return invokeCommand<void>('remove_worktree', {
    path: repoPath,
    worktreePath,
    force,
  });
}

export async function pruneWorktrees(
  repoPath: string,
  dryRun?: boolean
): Promise<CommandResult<string>> {
  return invokeCommand<string>('prune_worktrees', {
    path: repoPath,
    dryRun,
  });
}

export async function lockWorktree(
  repoPath: string,
  worktreePath: string,
  reason?: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('lock_worktree', {
    path: repoPath,
    worktreePath,
    reason,
  });
}

export async function unlockWorktree(
  repoPath: string,
  worktreePath: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('unlock_worktree', {
    path: repoPath,
    worktreePath,
  });
}

/**
 * Git LFS operations
 */
export interface LfsPattern {
  pattern: string;
}

export interface LfsFile {
  path: string;
  oid: string | null;
  size: number | null;
  downloaded: boolean;
}

export interface LfsStatus {
  installed: boolean;
  version: string | null;
  enabled: boolean;
  patterns: LfsPattern[];
  fileCount: number;
  totalSize: number;
}

export async function getLfsStatus(
  repoPath: string
): Promise<CommandResult<LfsStatus>> {
  return invokeCommand<LfsStatus>('get_lfs_status', { path: repoPath });
}

export async function initLfs(
  repoPath: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('init_lfs', { path: repoPath });
}

export async function lfsTrack(
  repoPath: string,
  pattern: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('lfs_track', { path: repoPath, pattern });
}

export async function lfsUntrack(
  repoPath: string,
  pattern: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('lfs_untrack', { path: repoPath, pattern });
}

export async function getLfsFiles(
  repoPath: string
): Promise<CommandResult<LfsFile[]>> {
  return invokeCommand<LfsFile[]>('get_lfs_files', { path: repoPath });
}

export async function lfsPull(
  repoPath: string
): Promise<CommandResult<string>> {
  return invokeCommand<string>('lfs_pull', { path: repoPath });
}

export async function lfsFetch(
  repoPath: string,
  refs?: string[]
): Promise<CommandResult<string>> {
  return invokeCommand<string>('lfs_fetch', { path: repoPath, refs });
}

export async function lfsPrune(
  repoPath: string,
  dryRun?: boolean
): Promise<CommandResult<string>> {
  return invokeCommand<string>('lfs_prune', { path: repoPath, dryRun });
}

/**
 * GPG operations
 */
export interface GpgKey {
  keyId: string;
  keyIdLong: string;
  userId: string;
  email: string;
  created: string | null;
  expires: string | null;
  isSigningKey: boolean;
  keyType: string;
  keySize: number;
  trust: string;
}

export interface GpgConfig {
  gpgAvailable: boolean;
  gpgVersion: string | null;
  signingKey: string | null;
  signCommits: boolean;
  signTags: boolean;
  gpgProgram: string | null;
}

export interface CommitSignature {
  signed: boolean;
  status: string | null;
  keyId: string | null;
  signer: string | null;
  valid: boolean;
  trust: string | null;
}

export async function getGpgConfig(
  repoPath: string
): Promise<CommandResult<GpgConfig>> {
  return invokeCommand<GpgConfig>('get_gpg_config', { path: repoPath });
}

export async function getGpgKeys(
  repoPath: string
): Promise<CommandResult<GpgKey[]>> {
  return invokeCommand<GpgKey[]>('get_gpg_keys', { path: repoPath });
}

export async function setSigningKey(
  repoPath: string,
  keyId: string | null,
  global?: boolean
): Promise<CommandResult<void>> {
  return invokeCommand<void>('set_signing_key', {
    path: repoPath,
    keyId,
    global,
  });
}

export async function setCommitSigning(
  repoPath: string,
  enabled: boolean,
  global?: boolean
): Promise<CommandResult<void>> {
  return invokeCommand<void>('set_commit_signing', {
    path: repoPath,
    enabled,
    global,
  });
}

export async function setTagSigning(
  repoPath: string,
  enabled: boolean,
  global?: boolean
): Promise<CommandResult<void>> {
  return invokeCommand<void>('set_tag_signing', {
    path: repoPath,
    enabled,
    global,
  });
}

export async function getCommitSignature(
  repoPath: string,
  commitOid: string
): Promise<CommandResult<CommitSignature>> {
  return invokeCommand<CommitSignature>('get_commit_signature', {
    path: repoPath,
    commitOid,
  });
}

// ============================================================================
// SSH Key Management
// ============================================================================

export interface SshKey {
  name: string;
  path: string;
  publicPath: string;
  keyType: string;
  fingerprint: string | null;
  comment: string | null;
  publicKey: string | null;
}

export interface SshConfig {
  sshAvailable: boolean;
  sshVersion: string | null;
  sshDir: string;
  gitSshCommand: string | null;
}

export interface SshTestResult {
  success: boolean;
  host: string;
  message: string;
  username: string | null;
}

export async function getSshConfig(): Promise<CommandResult<SshConfig>> {
  return invokeCommand<SshConfig>('get_ssh_config', {});
}

export async function getSshKeys(): Promise<CommandResult<SshKey[]>> {
  return invokeCommand<SshKey[]>('get_ssh_keys', {});
}

export async function generateSshKey(
  keyType: string,
  email: string,
  filename?: string,
  passphrase?: string
): Promise<CommandResult<SshKey>> {
  return invokeCommand<SshKey>('generate_ssh_key', {
    keyType,
    email,
    filename,
    passphrase,
  });
}

export async function testSshConnection(
  host: string
): Promise<CommandResult<SshTestResult>> {
  return invokeCommand<SshTestResult>('test_ssh_connection', { host });
}

export async function addKeyToAgent(
  keyPath: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('add_key_to_agent', { keyPath });
}

export async function listAgentKeys(): Promise<CommandResult<string[]>> {
  return invokeCommand<string[]>('list_agent_keys', {});
}

export async function getPublicKeyContent(
  keyName: string
): Promise<CommandResult<string>> {
  return invokeCommand<string>('get_public_key_content', { keyName });
}

export async function deleteSshKey(
  keyName: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('delete_ssh_key', { keyName });
}

// ============================================================================
// Git Configuration
// ============================================================================

export interface ConfigEntry {
  key: string;
  value: string;
  scope: string;
}

export interface GitAlias {
  name: string;
  command: string;
  isGlobal: boolean;
}

export interface UserIdentity {
  name: string | null;
  email: string | null;
  nameIsGlobal: boolean;
  emailIsGlobal: boolean;
}

export async function getConfigValue(
  path: string | null,
  key: string,
  global?: boolean
): Promise<CommandResult<string | null>> {
  return invokeCommand<string | null>('get_config_value', { path, key, global });
}

export async function setConfigValue(
  path: string | null,
  key: string,
  value: string,
  global?: boolean
): Promise<CommandResult<void>> {
  return invokeCommand<void>('set_config_value', { path, key, value, global });
}

export async function unsetConfigValue(
  path: string | null,
  key: string,
  global?: boolean
): Promise<CommandResult<void>> {
  return invokeCommand<void>('unset_config_value', { path, key, global });
}

export async function getConfigList(
  path: string | null,
  global?: boolean
): Promise<CommandResult<ConfigEntry[]>> {
  return invokeCommand<ConfigEntry[]>('get_config_list', { path, global });
}

export async function getUserIdentity(
  path: string
): Promise<CommandResult<UserIdentity>> {
  return invokeCommand<UserIdentity>('get_user_identity', { path });
}

export async function setUserIdentity(
  path: string | null,
  name: string | null,
  email: string | null,
  global?: boolean
): Promise<CommandResult<void>> {
  return invokeCommand<void>('set_user_identity', { path, name, email, global });
}

export async function getAliases(
  path?: string
): Promise<CommandResult<GitAlias[]>> {
  return invokeCommand<GitAlias[]>('get_aliases', { path });
}

export async function setAlias(
  path: string | null,
  name: string,
  command: string,
  global?: boolean
): Promise<CommandResult<void>> {
  return invokeCommand<void>('set_alias', { path, name, command, global });
}

export async function deleteAlias(
  path: string | null,
  name: string,
  global?: boolean
): Promise<CommandResult<void>> {
  return invokeCommand<void>('delete_alias', { path, name, global });
}

export async function getCommonSettings(
  path: string
): Promise<CommandResult<ConfigEntry[]>> {
  return invokeCommand<ConfigEntry[]>('get_common_settings', { path });
}

// ============================================================================
// Credential Management
// ============================================================================

export interface CredentialHelper {
  name: string;
  command: string;
  scope: string;
  urlPattern: string | null;
}

export interface CredentialTestResult {
  success: boolean;
  host: string;
  protocol: string;
  username: string | null;
  message: string;
}

export interface AvailableHelper {
  name: string;
  description: string;
  available: boolean;
}

export async function getCredentialHelpers(
  path: string
): Promise<CommandResult<CredentialHelper[]>> {
  return invokeCommand<CredentialHelper[]>('get_credential_helpers', { path });
}

export async function setCredentialHelper(
  path: string | null,
  helper: string,
  global?: boolean,
  urlPattern?: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('set_credential_helper', { path, helper, global, urlPattern });
}

export async function unsetCredentialHelper(
  path: string | null,
  global?: boolean,
  urlPattern?: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('unset_credential_helper', { path, global, urlPattern });
}

export async function getAvailableHelpers(): Promise<CommandResult<AvailableHelper[]>> {
  return invokeCommand<AvailableHelper[]>('get_available_helpers', {});
}

export async function testCredentials(
  path: string,
  remoteUrl: string
): Promise<CommandResult<CredentialTestResult>> {
  return invokeCommand<CredentialTestResult>('test_credentials', { path, remoteUrl });
}

export async function eraseCredentials(
  path: string,
  host: string,
  protocol: string
): Promise<CommandResult<void>> {
  return invokeCommand<void>('erase_credentials', { path, host, protocol });
}

// ============================================================================
// GitHub Integration
// ============================================================================

export interface GitHubUser {
  login: string;
  id: number;
  avatarUrl: string;
  name: string | null;
  email: string | null;
}

export interface GitHubConnectionStatus {
  connected: boolean;
  user: GitHubUser | null;
  scopes: string[];
}

export interface DetectedGitHubRepo {
  owner: string;
  repo: string;
  remoteName: string;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  state: string;
  user: GitHubUser;
  createdAt: string;
  updatedAt: string;
  headRef: string;
  baseRef: string;
  draft: boolean;
  mergeable: boolean | null;
  htmlUrl: string;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
}

export interface Label {
  id: number;
  name: string;
  color: string;
  description: string | null;
}

export interface PullRequestDetails {
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: GitHubUser;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  headRef: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
  draft: boolean;
  mergeable: boolean | null;
  mergeableState: string | null;
  htmlUrl: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  comments: number;
  reviewComments: number;
  labels: Label[];
  assignees: GitHubUser[];
  reviewers: GitHubUser[];
}

export interface PullRequestReview {
  id: number;
  user: GitHubUser;
  body: string | null;
  state: string;
  submittedAt: string | null;
  htmlUrl: string;
}

export interface WorkflowRun {
  id: number;
  name: string;
  headBranch: string;
  headSha: string;
  status: string;
  conclusion: string | null;
  workflowId: number;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  runNumber: number;
  event: string;
}

export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  htmlUrl: string | null;
}

export interface CreatePullRequestInput {
  title: string;
  body?: string;
  head: string;
  base: string;
  draft?: boolean;
}

// Authentication
export async function storeGitHubToken(token: string): Promise<CommandResult<void>> {
  return invokeCommand<void>('store_github_token', { token });
}

export async function getGitHubToken(): Promise<CommandResult<string | null>> {
  return invokeCommand<string | null>('get_github_token', {});
}

export async function deleteGitHubToken(): Promise<CommandResult<void>> {
  return invokeCommand<void>('delete_github_token', {});
}

export async function checkGitHubConnection(): Promise<CommandResult<GitHubConnectionStatus>> {
  return invokeCommand<GitHubConnectionStatus>('check_github_connection', {});
}

// Repository Detection
export async function detectGitHubRepo(path: string): Promise<CommandResult<DetectedGitHubRepo | null>> {
  return invokeCommand<DetectedGitHubRepo | null>('detect_github_repo', { path });
}

// Pull Requests
export async function listPullRequests(
  owner: string,
  repo: string,
  state?: string,
  perPage?: number
): Promise<CommandResult<PullRequestSummary[]>> {
  return invokeCommand<PullRequestSummary[]>('list_pull_requests', { owner, repo, state, perPage });
}

export async function getPullRequest(
  owner: string,
  repo: string,
  number: number
): Promise<CommandResult<PullRequestDetails>> {
  return invokeCommand<PullRequestDetails>('get_pull_request', { owner, repo, number });
}

export async function createPullRequest(
  owner: string,
  repo: string,
  input: CreatePullRequestInput
): Promise<CommandResult<PullRequestSummary>> {
  return invokeCommand<PullRequestSummary>('create_pull_request', { owner, repo, input });
}

export async function getPullRequestReviews(
  owner: string,
  repo: string,
  number: number
): Promise<CommandResult<PullRequestReview[]>> {
  return invokeCommand<PullRequestReview[]>('get_pull_request_reviews', { owner, repo, number });
}

// GitHub Actions
export async function getWorkflowRuns(
  owner: string,
  repo: string,
  branch?: string,
  perPage?: number
): Promise<CommandResult<WorkflowRun[]>> {
  return invokeCommand<WorkflowRun[]>('get_workflow_runs', { owner, repo, branch, perPage });
}

export async function getCheckRuns(
  owner: string,
  repo: string,
  commitSha: string
): Promise<CommandResult<CheckRun[]>> {
  return invokeCommand<CheckRun[]>('get_check_runs', { owner, repo, commitSha });
}

export async function getCommitStatus(
  owner: string,
  repo: string,
  commitSha: string
): Promise<CommandResult<string>> {
  return invokeCommand<string>('get_commit_status', { owner, repo, commitSha });
}
