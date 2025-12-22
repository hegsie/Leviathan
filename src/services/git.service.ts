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
  StatusEntry,
  DiffFile,
  RefsByCommit,
  CommitFileEntry,
  CommitStats,
} from '../types/git.types.ts';
import type {
  OpenRepositoryCommand,
  CloneRepositoryCommand,
  InitRepositoryCommand,
  CreateBranchCommand,
  DeleteBranchCommand,
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
  CreateStashCommand,
  ApplyStashCommand,
  DropStashCommand,
  PopStashCommand,
  CreateTagCommand,
  DeleteTagCommand,
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
 * Refs operations
 */
export async function getRefsByCommit(
  path: string
): Promise<CommandResult<RefsByCommit>> {
  return invokeCommand<RefsByCommit>('get_refs_by_commit', { path });
}
