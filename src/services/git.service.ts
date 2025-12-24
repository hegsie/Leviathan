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
 * Refs operations
 */
export async function getRefsByCommit(
  path: string
): Promise<CommandResult<RefsByCommit>> {
  return invokeCommand<RefsByCommit>('get_refs_by_commit', { path });
}
