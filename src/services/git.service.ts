/**
 * Git Service
 * Provides high-level Git operations via Tauri commands
 */

import { invokeCommand, listenToEvent } from "./tauri-api.ts";
import { showToast } from "./notification.service.ts";
import type { UnlistenFn } from "@tauri-apps/api/event";
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
  ImageVersions,
} from "../types/git.types.ts";
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
} from "../types/api.types.ts";

/**
 * Repository operations
 */
export async function openRepository(
  args: OpenRepositoryCommand,
): Promise<CommandResult<Repository>> {
  return invokeCommand<Repository>("open_repository", args);
}

export async function cloneRepository(
  args: CloneRepositoryCommand,
): Promise<CommandResult<Repository>> {
  // If no token is provided, try to find one based on the URL
  if (args && !args.token) {
    // We don't have a repo path yet (it's being cloned), so we can't detect by folder.
    // But we can check the URL domain.
    if (
      args.url.includes("github.com") ||
      args.url.includes("azure.com") ||
      args.url.includes("visualstudio.com")
    ) {
      // Try GitHub first
      if (args.url.includes("github.com")) {
        const tokenResult = await getGitHubToken();
        if (tokenResult.success && tokenResult.data) {
          args.token = tokenResult.data;
        }
      }
      // Try Azure DevOps (simplified check, would ideally need a specialized helper for URL parsing without repo context)
      // For now, we'll just support GitHub auto-token on clone, as ADO usually needs organization context which we can infer from URL but it's safer to implement specifically if needed.
      // But let's at least try the ADO token if we can get it globally (if we had a global getAdoToken).
      // Since getAdoToken isn't exported globally/generically in this file (it's inside getRepoToken logic), we will stick to GitHub for now.
    }
  }
  return invokeCommand<Repository>("clone_repository", args);
}

export async function initRepository(
  args: InitRepositoryCommand,
): Promise<CommandResult<Repository>> {
  return invokeCommand<Repository>("init_repository", args);
}

/**
 * Branch operations
 */
export async function getBranches(
  path: string,
): Promise<CommandResult<Branch[]>> {
  return invokeCommand<Branch[]>("get_branches", { path });
}

export async function createBranch(
  path: string,
  args: CreateBranchCommand,
): Promise<CommandResult<Branch>> {
  return invokeCommand<Branch>("create_branch", { path, ...args });
}

export async function deleteBranch(
  path: string,
  name: string,
  force?: boolean,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("delete_branch", { path, name, force });
}

export async function renameBranch(
  path: string,
  args: RenameBranchCommand,
): Promise<CommandResult<Branch>> {
  return invokeCommand<Branch>("rename_branch", { path, ...args });
}

export async function checkout(
  path: string,
  args: CheckoutCommand,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("checkout", { path, ...args });
}

/**
 * Commit operations
 */
export async function getCommitHistory(
  args: GetCommitHistoryCommand,
): Promise<CommandResult<Commit[]>> {
  return invokeCommand<Commit[]>("get_commit_history", args);
}

export async function getCommit(oid: string): Promise<CommandResult<Commit>> {
  return invokeCommand<Commit>("get_commit", { oid });
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
  },
): Promise<CommandResult<Commit[]>> {
  return invokeCommand<Commit[]>("search_commits", {
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
  args: CreateCommitCommand,
): Promise<CommandResult<Commit>> {
  return invokeCommand<Commit>("create_commit", { path, ...args });
}

/**
 * Staging operations
 */
export async function getStatus(
  path: string,
): Promise<CommandResult<StatusEntry[]>> {
  return invokeCommand<StatusEntry[]>("get_status", { path });
}

export async function stageFiles(
  repoPath: string,
  args: StageFilesCommand,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("stage_files", { path: repoPath, ...args });
}

export async function unstageFiles(
  repoPath: string,
  args: UnstageFilesCommand,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("unstage_files", { path: repoPath, ...args });
}

export async function discardChanges(
  repoPath: string,
  paths: string[],
): Promise<CommandResult<void>> {
  return invokeCommand<void>("discard_changes", { path: repoPath, paths });
}

/**
 * Stage a specific hunk from a diff
 * @param repoPath Repository path
 * @param patch The patch content for the hunk (with proper diff headers)
 */
export async function stageHunk(
  repoPath: string,
  patch: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("stage_hunk", { repoPath, patch });
}

/**
 * Unstage a specific hunk from the index
 * @param repoPath Repository path
 * @param patch The patch content for the hunk (with proper diff headers)
 */
export async function unstageHunk(
  repoPath: string,
  patch: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("unstage_hunk", { repoPath, patch });
}

/**
 * Write content to a file in the working directory
 * @param repoPath Repository path
 * @param filePath Path to the file relative to repo root
 * @param content Content to write
 * @param stageAfter Whether to stage the file after writing
 */
export async function writeFileContent(
  repoPath: string,
  filePath: string,
  content: string,
  stageAfter?: boolean,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("write_file_content", {
    repoPath,
    filePath,
    content,
    stageAfter,
  });
}

/**
 * Read file content from working directory or index
 * @param repoPath Repository path
 * @param filePath Path to the file relative to repo root
 * @param fromIndex Whether to read from index instead of working directory
 */
export async function readFileContent(
  repoPath: string,
  filePath: string,
  fromIndex?: boolean,
): Promise<CommandResult<string>> {
  return invokeCommand<string>("read_file_content", {
    repoPath,
    filePath,
    fromIndex,
  });
}

/**
 * Remote operations
 */
export async function getRemotes(
  path: string,
): Promise<CommandResult<Remote[]>> {
  return invokeCommand<Remote[]>("get_remotes", { path });
}

export async function addRemote(
  repoPath: string,
  name: string,
  url: string,
): Promise<CommandResult<Remote>> {
  return invokeCommand<Remote>("add_remote", { path: repoPath, name, url });
}

export async function removeRemote(
  repoPath: string,
  name: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("remove_remote", { path: repoPath, name });
}

export async function renameRemote(
  repoPath: string,
  oldName: string,
  newName: string,
): Promise<CommandResult<Remote>> {
  return invokeCommand<Remote>("rename_remote", {
    path: repoPath,
    oldName,
    newName,
  });
}

export async function setRemoteUrl(
  repoPath: string,
  name: string,
  url: string,
  push?: boolean,
): Promise<CommandResult<Remote>> {
  return invokeCommand<Remote>("set_remote_url", {
    path: repoPath,
    name,
    url,
    push,
  });
}

export async function fetch(
  args?: FetchCommand & { silent?: boolean },
): Promise<CommandResult<void>> {
  // If no token is provided, try to find one for the repository
  if (args && !args.token) {
    const token = await getRepoToken(args.path, args.remote);
    if (token) {
      args.token = token;
    }
  }

  const result = await invokeCommand<void>("fetch", args);
  if (!args?.silent) {
    if (result.success) {
      showToast("Fetch completed successfully", "success");
    } else {
      showToast(
        `Fetch failed: ${result.error?.message ?? "Unknown error"}`,
        "error",
      );
    }
  }
  return result;
}

export async function pull(
  args?: PullCommand & { silent?: boolean },
): Promise<CommandResult<void>> {
  // If no token is provided, try to find one for the repository
  if (args && !args.token) {
    const token = await getRepoToken(args.path, args.remote);
    if (token) {
      args.token = token;
    }
  }

  const result = await invokeCommand<void>("pull", args);
  if (!args?.silent) {
    if (result.success) {
      showToast("Pull completed successfully", "success");
    } else {
      showToast(
        `Pull failed: ${result.error?.message ?? "Unknown error"}`,
        "error",
      );
    }
  }
  return result;
}

export async function push(
  args?: PushCommand & { silent?: boolean },
): Promise<CommandResult<void>> {
  // If no token is provided, try to find one for the repository
  if (args && !args.token) {
    const token = await getRepoToken(args.path, args.remote);
    if (token) {
      args.token = token;
    }
  }

  const result = await invokeCommand<void>("push", args);
  if (!args?.silent) {
    if (result.success) {
      showToast("Push completed successfully", "success");
    } else {
      showToast(
        `Push failed: ${result.error?.message ?? "Unknown error"}`,
        "error",
      );
    }
  }
  return result;
}

/**
 * Helper to get authentication token for a repository
 * Checks if it's a GitHub or Azure DevOps repo and retrieves corresponding token
 */
async function getRepoToken(
  repoPath: string,
  remoteName?: string,
): Promise<string | undefined> {
  try {
    // Check if it's a GitHub repo
    const ghRepoResult = await detectGitHubRepo(repoPath);
    if (
      ghRepoResult.success &&
      ghRepoResult.data &&
      (!remoteName || ghRepoResult.data.remoteName === remoteName)
    ) {
      const tokenResult = await getGitHubToken();
      if (tokenResult.success && tokenResult.data) {
        return tokenResult.data;
      }
    }

    // Check if it's an Azure DevOps repo
    const adoRepoResult = await detectAdoRepo(repoPath);
    if (
      adoRepoResult.success &&
      adoRepoResult.data &&
      (!remoteName || adoRepoResult.data.remoteName === remoteName)
    ) {
      const tokenResult = await getAdoToken();
      if (tokenResult.success && tokenResult.data) {
        return tokenResult.data;
      }
    }

    // Check if it's a GitLab repo
    const gitlabRepoResult = await detectGitLabRepo(repoPath);
    if (
      gitlabRepoResult.success &&
      gitlabRepoResult.data &&
      (!remoteName || gitlabRepoResult.data.remoteName === remoteName)
    ) {
      const tokenResult = await getGitLabToken();
      if (tokenResult.success && tokenResult.data) {
        return tokenResult.data;
      }
    }
  } catch (err) {
    console.error("Failed to auto-detect repository token:", err);
  }
  return undefined;
}

/**
 * Merge operations
 */
export async function merge(args: MergeCommand): Promise<CommandResult<void>> {
  return invokeCommand<void>("merge", args);
}

export async function abortMerge(
  args: AbortMergeCommand,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("abort_merge", args);
}

/**
 * Rebase operations
 */
export async function rebase(
  args: RebaseCommand,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("rebase", args);
}

export async function continueRebase(
  args: ContinueRebaseCommand,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("continue_rebase", args);
}

export async function abortRebase(
  args: AbortRebaseCommand,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("abort_rebase", args);
}

export async function getRebaseCommits(
  path: string,
  onto: string,
): Promise<CommandResult<RebaseCommit[]>> {
  return invokeCommand<RebaseCommit[]>("get_rebase_commits", { path, onto });
}

export async function executeInteractiveRebase(
  path: string,
  onto: string,
  todo: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("execute_interactive_rebase", {
    path,
    onto,
    todo,
  });
}

/**
 * Conflict resolution operations
 */
export async function getConflicts(
  path: string,
): Promise<CommandResult<ConflictFile[]>> {
  return invokeCommand<ConflictFile[]>("get_conflicts", { path });
}

export async function getBlobContent(
  path: string,
  oid: string,
): Promise<CommandResult<string>> {
  return invokeCommand<string>("get_blob_content", { path, oid });
}

export async function resolveConflict(
  path: string,
  filePath: string,
  content: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("resolve_conflict", {
    path,
    file_path: filePath,
    content,
  });
}

/**
 * Cherry-pick operations
 */
export async function cherryPick(
  args: CherryPickCommand,
): Promise<CommandResult<Commit>> {
  return invokeCommand<Commit>("cherry_pick", args);
}

export async function continueCherryPick(
  args: ContinueCherryPickCommand,
): Promise<CommandResult<Commit>> {
  return invokeCommand<Commit>("continue_cherry_pick", args);
}

export async function abortCherryPick(
  args: AbortCherryPickCommand,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("abort_cherry_pick", args);
}

/**
 * Revert operations
 */
export async function revert(
  args: RevertCommand,
): Promise<CommandResult<Commit>> {
  return invokeCommand<Commit>("revert", args);
}

export async function continueRevert(
  args: ContinueRevertCommand,
): Promise<CommandResult<Commit>> {
  return invokeCommand<Commit>("continue_revert", args);
}

export async function abortRevert(
  args: AbortRevertCommand,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("abort_revert", args);
}

/**
 * Reset operations
 */
export async function reset(args: ResetCommand): Promise<CommandResult<void>> {
  return invokeCommand<void>("reset", args);
}

/**
 * Stash operations
 */
export async function getStashes(
  path: string,
): Promise<CommandResult<Stash[]>> {
  return invokeCommand<Stash[]>("get_stashes", { path });
}

export async function createStash(
  args: CreateStashCommand,
): Promise<CommandResult<Stash>> {
  return invokeCommand<Stash>("create_stash", args);
}

export async function applyStash(
  args: ApplyStashCommand,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("apply_stash", args);
}

export async function dropStash(
  args: DropStashCommand,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("drop_stash", args);
}

export async function popStash(
  args: PopStashCommand,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("pop_stash", args);
}

/**
 * Tag operations
 */
export async function getTags(path: string): Promise<CommandResult<Tag[]>> {
  return invokeCommand<Tag[]>("get_tags", { path });
}

export async function createTag(
  args: CreateTagCommand,
): Promise<CommandResult<Tag>> {
  return invokeCommand<Tag>("create_tag", args);
}

export async function deleteTag(
  args: DeleteTagCommand,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("delete_tag", args);
}

export async function pushTag(
  args: PushTagCommand,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("push_tag", args);
}

/**
 * Diff operations
 */
export async function getDiff(
  args?: GetDiffCommand,
): Promise<CommandResult<DiffFile[]>> {
  return invokeCommand<DiffFile[]>("get_diff", args);
}

export async function getFileDiff(
  repoPath: string,
  filePath: string,
  staged?: boolean,
): Promise<CommandResult<DiffFile>> {
  return invokeCommand<DiffFile>("get_file_diff", {
    path: repoPath,
    filePath,
    staged,
  });
}

export async function getCommitFiles(
  repoPath: string,
  commitOid: string,
): Promise<CommandResult<CommitFileEntry[]>> {
  return invokeCommand<CommitFileEntry[]>("get_commit_files", {
    path: repoPath,
    commitOid,
  });
}

export async function getCommitFileDiff(
  repoPath: string,
  commitOid: string,
  filePath: string,
): Promise<CommandResult<DiffFile>> {
  return invokeCommand<DiffFile>("get_commit_file_diff", {
    path: repoPath,
    commitOid,
    filePath,
  });
}

/**
 * Get stats (additions/deletions) for multiple commits in bulk
 * Optimized for graph view to show commit sizes
 */
export async function getCommitsStats(
  repoPath: string,
  commitOids: string[],
): Promise<CommandResult<CommitStats[]>> {
  return invokeCommand<CommitStats[]>("get_commits_stats", {
    path: repoPath,
    commitOids,
  });
}

/**
 * Get blame information for a file
 */
export async function getFileBlame(
  repoPath: string,
  filePath: string,
  commitOid?: string,
): Promise<CommandResult<BlameResult>> {
  return invokeCommand<BlameResult>("get_file_blame", {
    path: repoPath,
    filePath,
    commitOid,
  });
}

/**
 * Get image versions for comparison (old and new base64-encoded data)
 */
export async function getImageVersions(
  repoPath: string,
  filePath: string,
  staged?: boolean,
  commitOid?: string,
): Promise<CommandResult<ImageVersions>> {
  return invokeCommand<ImageVersions>("get_image_versions", {
    path: repoPath,
    filePath,
    staged,
    commitOid,
  });
}

/**
 * Get all commits that modified a specific file
 */
export async function getFileHistory(
  repoPath: string,
  filePath: string,
  limit?: number,
  followRenames?: boolean,
): Promise<CommandResult<Commit[]>> {
  return invokeCommand<Commit[]>("get_file_history", {
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
  path: string,
): Promise<CommandResult<RefsByCommit>> {
  return invokeCommand<RefsByCommit>("get_refs_by_commit", { path });
}

/**
 * Reflog operations
 */
export async function getReflog(
  repoPath: string,
  limit?: number,
): Promise<CommandResult<ReflogEntry[]>> {
  return invokeCommand<ReflogEntry[]>("get_reflog", { path: repoPath, limit });
}

export async function resetToReflog(
  repoPath: string,
  reflogIndex: number,
  mode: "soft" | "mixed" | "hard" = "mixed",
): Promise<CommandResult<ReflogEntry>> {
  return invokeCommand<ReflogEntry>("reset_to_reflog", {
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
  includeDirectories?: boolean,
): Promise<CommandResult<CleanEntry[]>> {
  return invokeCommand<CleanEntry[]>("get_cleanable_files", {
    path: repoPath,
    includeIgnored,
    includeDirectories,
  });
}

export async function cleanFiles(
  repoPath: string,
  paths: string[],
): Promise<CommandResult<number>> {
  return invokeCommand<number>("clean_files", {
    path: repoPath,
    paths,
  });
}

export async function cleanAll(
  repoPath: string,
  includeIgnored?: boolean,
  includeDirectories?: boolean,
): Promise<CommandResult<number>> {
  return invokeCommand<number>("clean_all", {
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
  repoPath: string,
): Promise<CommandResult<BisectStatus>> {
  return invokeCommand<BisectStatus>("get_bisect_status", { path: repoPath });
}

export async function bisectStart(
  repoPath: string,
  badCommit?: string,
  goodCommit?: string,
): Promise<CommandResult<BisectStepResult>> {
  return invokeCommand<BisectStepResult>("bisect_start", {
    path: repoPath,
    badCommit,
    goodCommit,
  });
}

export async function bisectBad(
  repoPath: string,
  commit?: string,
): Promise<CommandResult<BisectStepResult>> {
  return invokeCommand<BisectStepResult>("bisect_bad", {
    path: repoPath,
    commit,
  });
}

export async function bisectGood(
  repoPath: string,
  commit?: string,
): Promise<CommandResult<BisectStepResult>> {
  return invokeCommand<BisectStepResult>("bisect_good", {
    path: repoPath,
    commit,
  });
}

export async function bisectSkip(
  repoPath: string,
  commit?: string,
): Promise<CommandResult<BisectStepResult>> {
  return invokeCommand<BisectStepResult>("bisect_skip", {
    path: repoPath,
    commit,
  });
}

export async function bisectReset(
  repoPath: string,
): Promise<CommandResult<BisectStepResult>> {
  return invokeCommand<BisectStepResult>("bisect_reset", { path: repoPath });
}

/**
 * Submodule operations
 */
export type SubmoduleStatus =
  | "current"
  | "modified"
  | "uninitialized"
  | "missing"
  | "dirty";

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
  repoPath: string,
): Promise<CommandResult<Submodule[]>> {
  return invokeCommand<Submodule[]>("get_submodules", { path: repoPath });
}

export async function addSubmodule(
  repoPath: string,
  url: string,
  submodulePath: string,
  branch?: string,
): Promise<CommandResult<Submodule>> {
  return invokeCommand<Submodule>("add_submodule", {
    path: repoPath,
    url,
    submodulePath,
    branch,
  });
}

export async function initSubmodules(
  repoPath: string,
  submodulePaths?: string[],
): Promise<CommandResult<void>> {
  return invokeCommand<void>("init_submodules", {
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
    token?: string;
  },
): Promise<CommandResult<void>> {
  // Try to find a token if not provided
  let token = options?.token;
  if (!token) {
    token = await getRepoToken(repoPath);
  }

  return invokeCommand<void>("update_submodules", {
    path: repoPath,
    submodulePaths: options?.submodulePaths,
    init: options?.init,
    recursive: options?.recursive,
    remote: options?.remote,
    token,
  });
}

export async function syncSubmodules(
  repoPath: string,
  submodulePaths?: string[],
): Promise<CommandResult<void>> {
  return invokeCommand<void>("sync_submodules", {
    path: repoPath,
    submodulePaths,
  });
}

export async function deinitSubmodule(
  repoPath: string,
  submodulePath: string,
  force?: boolean,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("deinit_submodule", {
    path: repoPath,
    submodulePath,
    force,
  });
}

export async function removeSubmodule(
  repoPath: string,
  submodulePath: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("remove_submodule", {
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
  repoPath: string,
): Promise<CommandResult<Worktree[]>> {
  return invokeCommand<Worktree[]>("get_worktrees", { path: repoPath });
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
  },
): Promise<CommandResult<Worktree>> {
  return invokeCommand<Worktree>("add_worktree", {
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
  force?: boolean,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("remove_worktree", {
    path: repoPath,
    worktreePath,
    force,
  });
}

export async function pruneWorktrees(
  repoPath: string,
  dryRun?: boolean,
): Promise<CommandResult<string>> {
  return invokeCommand<string>("prune_worktrees", {
    path: repoPath,
    dryRun,
  });
}

export async function lockWorktree(
  repoPath: string,
  worktreePath: string,
  reason?: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("lock_worktree", {
    path: repoPath,
    worktreePath,
    reason,
  });
}

export async function unlockWorktree(
  repoPath: string,
  worktreePath: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("unlock_worktree", {
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
  repoPath: string,
): Promise<CommandResult<LfsStatus>> {
  return invokeCommand<LfsStatus>("get_lfs_status", { path: repoPath });
}

export async function initLfs(repoPath: string): Promise<CommandResult<void>> {
  return invokeCommand<void>("init_lfs", { path: repoPath });
}

export async function lfsTrack(
  repoPath: string,
  pattern: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("lfs_track", { path: repoPath, pattern });
}

export async function lfsUntrack(
  repoPath: string,
  pattern: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("lfs_untrack", { path: repoPath, pattern });
}

export async function getLfsFiles(
  repoPath: string,
): Promise<CommandResult<LfsFile[]>> {
  return invokeCommand<LfsFile[]>("get_lfs_files", { path: repoPath });
}

export async function lfsPull(
  repoPath: string,
): Promise<CommandResult<string>> {
  const token = await getRepoToken(repoPath);
  return invokeCommand<string>("lfs_pull", { path: repoPath, token });
}

export async function lfsFetch(
  repoPath: string,
  refs?: string[],
): Promise<CommandResult<string>> {
  const token = await getRepoToken(repoPath);
  return invokeCommand<string>("lfs_fetch", { path: repoPath, refs, token });
}

export async function lfsPrune(
  repoPath: string,
  dryRun?: boolean,
): Promise<CommandResult<string>> {
  return invokeCommand<string>("lfs_prune", { path: repoPath, dryRun });
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
  repoPath: string,
): Promise<CommandResult<GpgConfig>> {
  return invokeCommand<GpgConfig>("get_gpg_config", { path: repoPath });
}

export async function getGpgKeys(
  repoPath: string,
): Promise<CommandResult<GpgKey[]>> {
  return invokeCommand<GpgKey[]>("get_gpg_keys", { path: repoPath });
}

export async function setSigningKey(
  repoPath: string,
  keyId: string | null,
  global?: boolean,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("set_signing_key", {
    path: repoPath,
    keyId,
    global,
  });
}

export async function setCommitSigning(
  repoPath: string,
  enabled: boolean,
  global?: boolean,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("set_commit_signing", {
    path: repoPath,
    enabled,
    global,
  });
}

export async function setTagSigning(
  repoPath: string,
  enabled: boolean,
  global?: boolean,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("set_tag_signing", {
    path: repoPath,
    enabled,
    global,
  });
}

export async function getCommitSignature(
  repoPath: string,
  commitOid: string,
): Promise<CommandResult<CommitSignature>> {
  return invokeCommand<CommitSignature>("get_commit_signature", {
    path: repoPath,
    commitOid,
  });
}

export async function getCommitsSignatures(
  repoPath: string,
  commitOids: string[],
): Promise<CommandResult<Array<[string, CommitSignature]>>> {
  return invokeCommand<Array<[string, CommitSignature]>>(
    "get_commits_signatures",
    {
      path: repoPath,
      commitOids,
    },
  );
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
  return invokeCommand<SshConfig>("get_ssh_config", {});
}

export async function getSshKeys(): Promise<CommandResult<SshKey[]>> {
  return invokeCommand<SshKey[]>("get_ssh_keys", {});
}

export async function generateSshKey(
  keyType: string,
  email: string,
  filename?: string,
  passphrase?: string,
): Promise<CommandResult<SshKey>> {
  return invokeCommand<SshKey>("generate_ssh_key", {
    keyType,
    email,
    filename,
    passphrase,
  });
}

export async function testSshConnection(
  host: string,
): Promise<CommandResult<SshTestResult>> {
  return invokeCommand<SshTestResult>("test_ssh_connection", { host });
}

export async function addKeyToAgent(
  keyPath: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("add_key_to_agent", { keyPath });
}

export async function listAgentKeys(): Promise<CommandResult<string[]>> {
  return invokeCommand<string[]>("list_agent_keys", {});
}

export async function getPublicKeyContent(
  keyName: string,
): Promise<CommandResult<string>> {
  return invokeCommand<string>("get_public_key_content", { keyName });
}

export async function deleteSshKey(
  keyName: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("delete_ssh_key", { keyName });
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
  global?: boolean,
): Promise<CommandResult<string | null>> {
  return invokeCommand<string | null>("get_config_value", {
    path,
    key,
    global,
  });
}

export async function setConfigValue(
  path: string | null,
  key: string,
  value: string,
  global?: boolean,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("set_config_value", { path, key, value, global });
}

export async function unsetConfigValue(
  path: string | null,
  key: string,
  global?: boolean,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("unset_config_value", { path, key, global });
}

export async function getConfigList(
  path: string | null,
  global?: boolean,
): Promise<CommandResult<ConfigEntry[]>> {
  return invokeCommand<ConfigEntry[]>("get_config_list", { path, global });
}

export async function getUserIdentity(
  path: string,
): Promise<CommandResult<UserIdentity>> {
  return invokeCommand<UserIdentity>("get_user_identity", { path });
}

export async function setUserIdentity(
  path: string | null,
  name: string | null,
  email: string | null,
  global?: boolean,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("set_user_identity", {
    path,
    name,
    email,
    global,
  });
}

export async function getAliases(
  path?: string,
): Promise<CommandResult<GitAlias[]>> {
  return invokeCommand<GitAlias[]>("get_aliases", { path });
}

export async function setAlias(
  path: string | null,
  name: string,
  command: string,
  global?: boolean,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("set_alias", { path, name, command, global });
}

export async function deleteAlias(
  path: string | null,
  name: string,
  global?: boolean,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("delete_alias", { path, name, global });
}

export async function getCommonSettings(
  path: string,
): Promise<CommandResult<ConfigEntry[]>> {
  return invokeCommand<ConfigEntry[]>("get_common_settings", { path });
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
  path: string,
): Promise<CommandResult<CredentialHelper[]>> {
  return invokeCommand<CredentialHelper[]>("get_credential_helpers", { path });
}

export async function setCredentialHelper(
  path: string | null,
  helper: string,
  global?: boolean,
  urlPattern?: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("set_credential_helper", {
    path,
    helper,
    global,
    urlPattern,
  });
}

export async function unsetCredentialHelper(
  path: string | null,
  global?: boolean,
  urlPattern?: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("unset_credential_helper", {
    path,
    global,
    urlPattern,
  });
}

export async function getAvailableHelpers(): Promise<
  CommandResult<AvailableHelper[]>
> {
  return invokeCommand<AvailableHelper[]>("get_available_helpers", {});
}

export async function testCredentials(
  path: string,
  remoteUrl: string,
): Promise<CommandResult<CredentialTestResult>> {
  return invokeCommand<CredentialTestResult>("test_credentials", {
    path,
    remoteUrl,
  });
}

export async function eraseCredentials(
  path: string,
  host: string,
  protocol: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("erase_credentials", { path, host, protocol });
}

/**
 * Store git credentials in the system keyring for HTTPS authentication
 */
export async function storeGitCredentials(
  url: string,
  username: string,
  password: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("store_git_credentials", {
    url,
    username,
    password,
  });
}

/**
 * Delete git credentials from the system keyring
 */
export async function deleteGitCredentials(
  url: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("delete_git_credentials", { url });
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
  mergedAt: string | null;
  headRef: string;
  headSha: string;
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

// Authentication (using Stronghold secure storage)
export async function storeGitHubToken(
  token: string,
): Promise<CommandResult<void>> {
  try {
    const { GitHubCredentials } = await import("./credential.service.ts");
    await GitHubCredentials.setToken(token);
    return { success: true, data: undefined };
  } catch (error) {
    return {
      success: false,
      error: { code: "CREDENTIAL_ERROR", message: String(error) },
    };
  }
}

export async function getGitHubToken(): Promise<CommandResult<string | null>> {
  try {
    const { GitHubCredentials } = await import("./credential.service.ts");
    const token = await GitHubCredentials.getToken();
    return { success: true, data: token };
  } catch (error) {
    return {
      success: false,
      error: { code: "CREDENTIAL_ERROR", message: String(error) },
    };
  }
}

export async function deleteGitHubToken(): Promise<CommandResult<void>> {
  try {
    const { GitHubCredentials } = await import("./credential.service.ts");
    await GitHubCredentials.deleteToken();
    return { success: true, data: undefined };
  } catch (error) {
    return {
      success: false,
      error: { code: "CREDENTIAL_ERROR", message: String(error) },
    };
  }
}

export async function checkGitHubConnection(): Promise<
  CommandResult<GitHubConnectionStatus>
> {
  // Get token from Stronghold and pass to backend
  const tokenResult = await getGitHubToken();
  const token = tokenResult.success ? tokenResult.data : null;
  return invokeCommand<GitHubConnectionStatus>("check_github_connection", {
    token,
  });
}

/**
 * Check GitHub connection with a specific token
 * Used for multi-account support where token is retrieved from account-specific storage
 */
export async function checkGitHubConnectionWithToken(
  token: string | null,
): Promise<CommandResult<GitHubConnectionStatus>> {
  return invokeCommand<GitHubConnectionStatus>("check_github_connection", {
    token,
  });
}

// Repository Detection
export async function detectGitHubRepo(
  path: string,
): Promise<CommandResult<DetectedGitHubRepo | null>> {
  return invokeCommand<DetectedGitHubRepo | null>("detect_github_repo", {
    path,
  });
}

// Pull Requests
export async function listPullRequests(
  owner: string,
  repo: string,
  state?: string,
  perPage?: number,
  token?: string | null,
): Promise<CommandResult<PullRequestSummary[]>> {
  return invokeCommand<PullRequestSummary[]>("list_pull_requests", {
    owner,
    repo,
    state,
    perPage,
    token,
  });
}

export async function getPullRequest(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<CommandResult<PullRequestDetails>> {
  return invokeCommand<PullRequestDetails>("get_pull_request", {
    owner,
    repo,
    number,
    token,
  });
}

export async function createPullRequest(
  owner: string,
  repo: string,
  input: CreatePullRequestInput,
  token?: string | null,
): Promise<CommandResult<PullRequestSummary>> {
  return invokeCommand<PullRequestSummary>("create_pull_request", {
    owner,
    repo,
    input,
    token,
  });
}

export async function getPullRequestReviews(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<CommandResult<PullRequestReview[]>> {
  return invokeCommand<PullRequestReview[]>("get_pull_request_reviews", {
    owner,
    repo,
    number,
    token,
  });
}

// GitHub Actions
export async function getWorkflowRuns(
  owner: string,
  repo: string,
  branch?: string,
  perPage?: number,
  token?: string | null,
): Promise<CommandResult<WorkflowRun[]>> {
  return invokeCommand<WorkflowRun[]>("get_workflow_runs", {
    owner,
    repo,
    branch,
    perPage,
    token,
  });
}

export async function getCheckRuns(
  owner: string,
  repo: string,
  commitSha: string,
  token?: string | null,
): Promise<CommandResult<CheckRun[]>> {
  return invokeCommand<CheckRun[]>("get_check_runs", {
    owner,
    repo,
    commitSha,
    token,
  });
}

export async function getCommitStatus(
  owner: string,
  repo: string,
  commitSha: string,
  token?: string | null,
): Promise<CommandResult<string>> {
  return invokeCommand<string>("get_commit_status", {
    owner,
    repo,
    commitSha,
    token,
  });
}

// GitHub Issues

export interface IssueSummary {
  number: number;
  title: string;
  state: string;
  user: GitHubUser;
  labels: Label[];
  assignees: GitHubUser[];
  comments: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  htmlUrl: string;
  body: string | null;
}

export interface IssueComment {
  id: number;
  user: GitHubUser;
  body: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface CreateIssueInput {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

export async function listIssues(
  owner: string,
  repo: string,
  state?: string,
  labels?: string,
  perPage?: number,
  token?: string | null,
): Promise<CommandResult<IssueSummary[]>> {
  return invokeCommand<IssueSummary[]>("list_issues", {
    owner,
    repo,
    state,
    labels,
    perPage,
    token,
  });
}

export async function getIssue(
  owner: string,
  repo: string,
  number: number,
  token?: string | null,
): Promise<CommandResult<IssueSummary>> {
  return invokeCommand<IssueSummary>("get_issue", {
    owner,
    repo,
    number,
    token,
  });
}

export async function createIssue(
  owner: string,
  repo: string,
  input: CreateIssueInput,
  token?: string | null,
): Promise<CommandResult<IssueSummary>> {
  return invokeCommand<IssueSummary>("create_issue", {
    owner,
    repo,
    input,
    token,
  });
}

export async function updateIssueState(
  owner: string,
  repo: string,
  number: number,
  state: string,
  token?: string | null,
): Promise<CommandResult<IssueSummary>> {
  return invokeCommand<IssueSummary>("update_issue_state", {
    owner,
    repo,
    number,
    state,
    token,
  });
}

export async function getIssueComments(
  owner: string,
  repo: string,
  number: number,
  perPage?: number,
  token?: string | null,
): Promise<CommandResult<IssueComment[]>> {
  return invokeCommand<IssueComment[]>("get_issue_comments", {
    owner,
    repo,
    number,
    perPage,
    token,
  });
}

export async function addIssueComment(
  owner: string,
  repo: string,
  number: number,
  body: string,
  token?: string | null,
): Promise<CommandResult<IssueComment>> {
  return invokeCommand<IssueComment>("add_issue_comment", {
    owner,
    repo,
    number,
    body,
    token,
  });
}

export async function getRepoLabels(
  owner: string,
  repo: string,
  perPage?: number,
  token?: string | null,
): Promise<CommandResult<Label[]>> {
  return invokeCommand<Label[]>("get_repo_labels", {
    owner,
    repo,
    perPage,
    token,
  });
}

// Issue Reference Utilities

export interface IssueReference {
  number: number;
  keyword: string | null; // 'fixes', 'closes', 'resolves', etc. or null for plain #123
  fullMatch: string;
}

/**
 * Parse issue references from commit message text.
 * Detects patterns like: #123, fixes #123, closes #123, resolves #123
 */
export function parseIssueReferences(text: string): IssueReference[] {
  const references: IssueReference[] = [];
  const seen = new Set<number>();

  // Keywords that GitHub recognizes for auto-closing issues
  const keywords = [
    "close",
    "closes",
    "closed",
    "fix",
    "fixes",
    "fixed",
    "resolve",
    "resolves",
    "resolved",
  ];
  const keywordPattern = keywords.join("|");

  // Match keyword + issue reference (e.g., "fixes #123" or "fix #123")
  const keywordRegex = new RegExp(`\\b(${keywordPattern})\\s+#(\\d+)\\b`, "gi");
  let match;

  while ((match = keywordRegex.exec(text)) !== null) {
    const num = parseInt(match[2], 10);
    if (!seen.has(num)) {
      seen.add(num);
      references.push({
        number: num,
        keyword: match[1].toLowerCase(),
        fullMatch: match[0],
      });
    }
  }

  // Match standalone issue references (e.g., "#123" not preceded by a keyword)
  const standaloneRegex = /#(\d+)\b/g;
  while ((match = standaloneRegex.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    if (!seen.has(num)) {
      seen.add(num);
      references.push({
        number: num,
        keyword: null,
        fullMatch: match[0],
      });
    }
  }

  return references;
}

/**
 * Check if a keyword indicates the issue should be closed
 */
export function isClosingKeyword(keyword: string | null): boolean {
  if (!keyword) return false;
  const closingKeywords = [
    "close",
    "closes",
    "closed",
    "fix",
    "fixes",
    "fixed",
    "resolve",
    "resolves",
    "resolved",
  ];
  return closingKeywords.includes(keyword.toLowerCase());
}

// GitHub Releases

export interface ReleaseSummary {
  id: number;
  tagName: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  createdAt: string;
  publishedAt: string | null;
  htmlUrl: string;
  author: GitHubUser;
  assetsCount: number;
}

export interface CreateReleaseInput {
  tagName: string;
  targetCommitish?: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  generateReleaseNotes?: boolean;
}

export async function listReleases(
  owner: string,
  repo: string,
  perPage?: number,
  token?: string | null,
): Promise<CommandResult<ReleaseSummary[]>> {
  return invokeCommand<ReleaseSummary[]>("list_releases", {
    owner,
    repo,
    perPage,
    token,
  });
}

export async function getReleaseByTag(
  owner: string,
  repo: string,
  tag: string,
  token?: string | null,
): Promise<CommandResult<ReleaseSummary>> {
  return invokeCommand<ReleaseSummary>("get_release_by_tag", {
    owner,
    repo,
    tag,
    token,
  });
}

export async function getLatestRelease(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<CommandResult<ReleaseSummary>> {
  return invokeCommand<ReleaseSummary>("get_latest_release", {
    owner,
    repo,
    token,
  });
}

export async function createRelease(
  owner: string,
  repo: string,
  input: CreateReleaseInput,
  token?: string | null,
): Promise<CommandResult<ReleaseSummary>> {
  return invokeCommand<ReleaseSummary>("create_release", {
    owner,
    repo,
    input,
    token,
  });
}

export async function deleteRelease(
  owner: string,
  repo: string,
  releaseId: number,
  token?: string | null,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("delete_release", {
    owner,
    repo,
    releaseId,
    token,
  });
}

// =======================
// Azure DevOps Integration
// =======================

export interface AdoUser {
  id: string;
  displayName: string;
  uniqueName: string;
  imageUrl: string | null;
}

export interface AdoConnectionStatus {
  connected: boolean;
  user: AdoUser | null;
  organization: string | null;
}

export interface DetectedAdoRepo {
  organization: string;
  project: string;
  repository: string;
  remoteName: string;
}

export interface AdoPullRequest {
  pullRequestId: number;
  title: string;
  description: string | null;
  status: string;
  createdBy: AdoUser;
  creationDate: string;
  sourceRefName: string;
  targetRefName: string;
  isDraft: boolean;
  url: string;
  repositoryId: string;
}

export interface CreateAdoPullRequestInput {
  title: string;
  description?: string;
  sourceRefName: string;
  targetRefName: string;
  isDraft?: boolean;
}

export interface AdoWorkItem {
  id: number;
  title: string;
  workItemType: string;
  state: string;
  assignedTo: AdoUser | null;
  createdDate: string;
  url: string;
}

export interface AdoPipelineRun {
  id: number;
  name: string;
  state: string;
  result: string | null;
  createdDate: string;
  finishedDate: string | null;
  sourceBranch: string;
  url: string;
}

// Azure DevOps Token Management (using Stronghold secure storage)

export async function storeAdoToken(
  token: string,
): Promise<CommandResult<void>> {
  try {
    const { AzureDevOpsCredentials } = await import("./credential.service.ts");
    await AzureDevOpsCredentials.setToken(token);
    return { success: true, data: undefined };
  } catch (error) {
    return {
      success: false,
      error: { code: "CREDENTIAL_ERROR", message: String(error) },
    };
  }
}

export async function getAdoToken(): Promise<CommandResult<string | null>> {
  try {
    const { AzureDevOpsCredentials } = await import("./credential.service.ts");
    const token = await AzureDevOpsCredentials.getToken();
    return { success: true, data: token };
  } catch (error) {
    return {
      success: false,
      error: { code: "CREDENTIAL_ERROR", message: String(error) },
    };
  }
}

export async function deleteAdoToken(): Promise<CommandResult<void>> {
  try {
    const { AzureDevOpsCredentials } = await import("./credential.service.ts");
    await AzureDevOpsCredentials.deleteToken();
    return { success: true, data: undefined };
  } catch (error) {
    return {
      success: false,
      error: { code: "CREDENTIAL_ERROR", message: String(error) },
    };
  }
}

// Azure DevOps Connection

export async function checkAdoConnection(
  organization: string,
): Promise<CommandResult<AdoConnectionStatus>> {
  // Get token from Stronghold and pass to backend
  const tokenResult = await getAdoToken();
  const token = tokenResult.success ? tokenResult.data : null;
  return invokeCommand<AdoConnectionStatus>("check_ado_connection", {
    organization,
    token,
  });
}

/**
 * Check Azure DevOps connection with a specific token
 * Used for multi-account support where token is retrieved from account-specific storage
 */
export async function checkAdoConnectionWithToken(
  organization: string,
  token: string | null,
): Promise<CommandResult<AdoConnectionStatus>> {
  return invokeCommand<AdoConnectionStatus>("check_ado_connection", {
    organization,
    token,
  });
}

export async function detectAdoRepo(
  path: string,
): Promise<CommandResult<DetectedAdoRepo | null>> {
  return invokeCommand<DetectedAdoRepo | null>("detect_ado_repo", { path });
}

// Azure DevOps Pull Requests

export async function listAdoPullRequests(
  organization: string,
  project: string,
  repository: string,
  status?: string,
  token?: string | null,
): Promise<CommandResult<AdoPullRequest[]>> {
  return invokeCommand<AdoPullRequest[]>("list_ado_pull_requests", {
    organization,
    project,
    repository,
    status,
    token,
  });
}

export async function getAdoPullRequest(
  organization: string,
  project: string,
  repository: string,
  pullRequestId: number,
  token?: string | null,
): Promise<CommandResult<AdoPullRequest>> {
  return invokeCommand<AdoPullRequest>("get_ado_pull_request", {
    organization,
    project,
    repository,
    pullRequestId,
    token,
  });
}

export async function createAdoPullRequest(
  organization: string,
  project: string,
  repository: string,
  input: CreateAdoPullRequestInput,
  token?: string | null,
): Promise<CommandResult<AdoPullRequest>> {
  return invokeCommand<AdoPullRequest>("create_ado_pull_request", {
    organization,
    project,
    repository,
    input,
    token,
  });
}

// Azure DevOps Work Items

export async function getAdoWorkItems(
  organization: string,
  project: string,
  ids: number[],
  token?: string | null,
): Promise<CommandResult<AdoWorkItem[]>> {
  return invokeCommand<AdoWorkItem[]>("get_ado_work_items", {
    organization,
    project,
    ids,
    token,
  });
}

export async function queryAdoWorkItems(
  organization: string,
  project: string,
  state?: string,
  token?: string | null,
): Promise<CommandResult<AdoWorkItem[]>> {
  return invokeCommand<AdoWorkItem[]>("query_ado_work_items", {
    organization,
    project,
    state,
    token,
  });
}

// Azure DevOps Pipelines

export async function listAdoPipelineRuns(
  organization: string,
  project: string,
  top?: number,
  token?: string | null,
): Promise<CommandResult<AdoPipelineRun[]>> {
  return invokeCommand<AdoPipelineRun[]>("list_ado_pipeline_runs", {
    organization,
    project,
    top,
    token,
  });
}

// =======================
// GitLab Integration
// =======================

export interface GitLabUser {
  id: number;
  username: string;
  name: string;
  avatarUrl: string | null;
  webUrl: string;
}

export interface GitLabConnectionStatus {
  connected: boolean;
  user: GitLabUser | null;
  instanceUrl: string;
}

export interface DetectedGitLabRepo {
  instanceUrl: string;
  projectPath: string;
  remoteName: string;
}

export interface GitLabMergeRequest {
  iid: number;
  title: string;
  description: string | null;
  state: string;
  author: GitLabUser;
  createdAt: string;
  sourceBranch: string;
  targetBranch: string;
  draft: boolean;
  webUrl: string;
  mergeStatus: string;
}

export interface CreateMergeRequestInput {
  title: string;
  description?: string;
  sourceBranch: string;
  targetBranch: string;
  draft?: boolean;
}

export interface GitLabIssue {
  iid: number;
  title: string;
  description: string | null;
  state: string;
  author: GitLabUser;
  assignees: GitLabUser[];
  labels: string[];
  createdAt: string;
  webUrl: string;
}

export interface CreateGitLabIssueInput {
  title: string;
  description?: string;
  labels?: string[];
}

export interface GitLabPipeline {
  id: number;
  iid: number;
  status: string;
  source: string;
  ref: string;
  sha: string;
  createdAt: string;
  updatedAt: string;
  webUrl: string;
}

// GitLab Token Management (using Stronghold secure storage)
export async function storeGitLabToken(
  token: string,
): Promise<CommandResult<void>> {
  try {
    const { GitLabCredentials } = await import("./credential.service.ts");
    await GitLabCredentials.setToken(token);
    return { success: true, data: undefined };
  } catch (error) {
    return {
      success: false,
      error: { code: "CREDENTIAL_ERROR", message: String(error) },
    };
  }
}

export async function getGitLabToken(): Promise<CommandResult<string | null>> {
  try {
    const { GitLabCredentials } = await import("./credential.service.ts");
    const token = await GitLabCredentials.getToken();
    return { success: true, data: token };
  } catch (error) {
    return {
      success: false,
      error: { code: "CREDENTIAL_ERROR", message: String(error) },
    };
  }
}

export async function deleteGitLabToken(): Promise<CommandResult<void>> {
  try {
    const { GitLabCredentials } = await import("./credential.service.ts");
    await GitLabCredentials.deleteToken();
    return { success: true, data: undefined };
  } catch (error) {
    return {
      success: false,
      error: { code: "CREDENTIAL_ERROR", message: String(error) },
    };
  }
}

// GitLab Connection

export async function checkGitLabConnection(
  instanceUrl: string,
): Promise<CommandResult<GitLabConnectionStatus>> {
  // Get token from Stronghold and pass to backend
  const tokenResult = await getGitLabToken();
  const token = tokenResult.success ? tokenResult.data : null;
  return invokeCommand<GitLabConnectionStatus>("check_gitlab_connection", {
    instanceUrl,
    token,
  });
}

/**
 * Check GitLab connection with a specific token
 * Used for multi-account support where token is retrieved from account-specific storage
 */
export async function checkGitLabConnectionWithToken(
  instanceUrl: string,
  token: string | null,
): Promise<CommandResult<GitLabConnectionStatus>> {
  return invokeCommand<GitLabConnectionStatus>("check_gitlab_connection", {
    instanceUrl,
    token,
  });
}

export async function detectGitLabRepo(
  path: string,
): Promise<CommandResult<DetectedGitLabRepo | null>> {
  return invokeCommand<DetectedGitLabRepo | null>("detect_gitlab_repo", {
    path,
  });
}

// GitLab Merge Requests

export async function listGitLabMergeRequests(
  instanceUrl: string,
  projectPath: string,
  state?: string,
  token?: string | null,
): Promise<CommandResult<GitLabMergeRequest[]>> {
  return invokeCommand<GitLabMergeRequest[]>("list_gitlab_merge_requests", {
    instanceUrl,
    projectPath,
    state,
    token,
  });
}

export async function getGitLabMergeRequest(
  instanceUrl: string,
  projectPath: string,
  mrIid: number,
  token?: string | null,
): Promise<CommandResult<GitLabMergeRequest>> {
  return invokeCommand<GitLabMergeRequest>("get_gitlab_merge_request", {
    instanceUrl,
    projectPath,
    mrIid,
    token,
  });
}

export async function createGitLabMergeRequest(
  instanceUrl: string,
  projectPath: string,
  input: CreateMergeRequestInput,
  token?: string | null,
): Promise<CommandResult<GitLabMergeRequest>> {
  return invokeCommand<GitLabMergeRequest>("create_gitlab_merge_request", {
    instanceUrl,
    projectPath,
    input,
    token,
  });
}

// GitLab Issues

export async function listGitLabIssues(
  instanceUrl: string,
  projectPath: string,
  state?: string,
  labels?: string,
  token?: string | null,
): Promise<CommandResult<GitLabIssue[]>> {
  return invokeCommand<GitLabIssue[]>("list_gitlab_issues", {
    instanceUrl,
    projectPath,
    state,
    labels,
    token,
  });
}

export async function createGitLabIssue(
  instanceUrl: string,
  projectPath: string,
  input: CreateGitLabIssueInput,
  token?: string | null,
): Promise<CommandResult<GitLabIssue>> {
  return invokeCommand<GitLabIssue>("create_gitlab_issue", {
    instanceUrl,
    projectPath,
    input,
    token,
  });
}

// GitLab Pipelines

export async function listGitLabPipelines(
  instanceUrl: string,
  projectPath: string,
  status?: string,
  token?: string | null,
): Promise<CommandResult<GitLabPipeline[]>> {
  return invokeCommand<GitLabPipeline[]>("list_gitlab_pipelines", {
    instanceUrl,
    projectPath,
    status,
    token,
  });
}

export async function getGitLabLabels(
  instanceUrl: string,
  projectPath: string,
  token?: string | null,
): Promise<CommandResult<string[]>> {
  return invokeCommand<string[]>("get_gitlab_labels", {
    instanceUrl,
    projectPath,
    token,
  });
}

// =======================
// Bitbucket Integration
// =======================

export interface BitbucketUser {
  uuid: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface BitbucketConnectionStatus {
  connected: boolean;
  user: BitbucketUser | null;
}

export interface DetectedBitbucketRepo {
  workspace: string;
  repoSlug: string;
  remoteName: string;
}

export interface BitbucketPullRequest {
  id: number;
  title: string;
  description: string | null;
  state: string;
  author: BitbucketUser;
  createdOn: string;
  sourceBranch: string;
  destinationBranch: string;
  url: string;
}

export interface CreateBitbucketPullRequestInput {
  title: string;
  description?: string;
  sourceBranch: string;
  destinationBranch: string;
  closeSourceBranch?: boolean;
}

export interface BitbucketIssue {
  id: number;
  title: string;
  content: string | null;
  state: string;
  priority: string;
  kind: string;
  reporter: BitbucketUser | null;
  assignee: BitbucketUser | null;
  createdOn: string;
  url: string;
}

export interface BitbucketPipeline {
  uuid: string;
  buildNumber: number;
  stateName: string;
  resultName: string | null;
  targetBranch: string;
  createdOn: string;
  completedOn: string | null;
  url: string;
}

// Bitbucket Credential Management (using Stronghold secure storage)

export async function storeBitbucketCredentials(
  username: string,
  appPassword: string,
): Promise<CommandResult<void>> {
  try {
    const { BitbucketCredentials } = await import("./credential.service.ts");
    await BitbucketCredentials.setCredentials(username, appPassword);
    return { success: true, data: undefined };
  } catch (error) {
    return {
      success: false,
      error: { code: "CREDENTIAL_ERROR", message: String(error) },
    };
  }
}

export async function getBitbucketCredentials(): Promise<
  CommandResult<[string, string] | null>
> {
  try {
    const { BitbucketCredentials } = await import("./credential.service.ts");
    const creds = await BitbucketCredentials.getCredentials();
    if (creds) {
      return { success: true, data: [creds.username, creds.password] };
    }
    return { success: true, data: null };
  } catch (error) {
    return {
      success: false,
      error: { code: "CREDENTIAL_ERROR", message: String(error) },
    };
  }
}

export async function deleteBitbucketCredentials(): Promise<
  CommandResult<void>
> {
  try {
    const { BitbucketCredentials } = await import("./credential.service.ts");
    await BitbucketCredentials.deleteCredentials();
    return { success: true, data: undefined };
  } catch (error) {
    return {
      success: false,
      error: { code: "CREDENTIAL_ERROR", message: String(error) },
    };
  }
}

// Bitbucket Connection

export async function checkBitbucketConnection(): Promise<
  CommandResult<BitbucketConnectionStatus>
> {
  // Get credentials from Stronghold and pass to backend
  const credsResult = await getBitbucketCredentials();
  let username: string | null = null;
  let appPassword: string | null = null;
  if (credsResult.success && credsResult.data) {
    [username, appPassword] = credsResult.data;
  }
  return invokeCommand<BitbucketConnectionStatus>(
    "check_bitbucket_connection",
    { username, appPassword },
  );
}

/**
 * Check Bitbucket connection with a specific OAuth token
 */
export async function checkBitbucketConnectionWithToken(
  token: string,
): Promise<CommandResult<BitbucketConnectionStatus>> {
  return invokeCommand<BitbucketConnectionStatus>(
    "check_bitbucket_connection_with_token",
    { token },
  );
}

/**
 * Store Bitbucket OAuth token
 */
export async function storeBitbucketOAuthToken(
  accessToken: string,
  refreshToken?: string,
  expiresIn?: number,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("store_bitbucket_oauth_token", {
    accessToken,
    refreshToken,
    expiresIn,
  });
}

export async function detectBitbucketRepo(
  path: string,
): Promise<CommandResult<DetectedBitbucketRepo | null>> {
  return invokeCommand<DetectedBitbucketRepo | null>("detect_bitbucket_repo", {
    path,
  });
}

// Bitbucket Pull Requests

export async function listBitbucketPullRequests(
  workspace: string,
  repoSlug: string,
  state?: string,
  token?: string | null,
): Promise<CommandResult<BitbucketPullRequest[]>> {
  return invokeCommand<BitbucketPullRequest[]>("list_bitbucket_pull_requests", {
    workspace,
    repoSlug,
    state,
    token,
  });
}

export async function getBitbucketPullRequest(
  workspace: string,
  repoSlug: string,
  prId: number,
  token?: string | null,
): Promise<CommandResult<BitbucketPullRequest>> {
  return invokeCommand<BitbucketPullRequest>("get_bitbucket_pull_request", {
    workspace,
    repoSlug,
    prId,
    token,
  });
}

export async function createBitbucketPullRequest(
  workspace: string,
  repoSlug: string,
  input: CreateBitbucketPullRequestInput,
  token?: string | null,
): Promise<CommandResult<BitbucketPullRequest>> {
  return invokeCommand<BitbucketPullRequest>("create_bitbucket_pull_request", {
    workspace,
    repoSlug,
    input,
    token,
  });
}

// Bitbucket Issues

export async function listBitbucketIssues(
  workspace: string,
  repoSlug: string,
  state?: string,
  token?: string | null,
): Promise<CommandResult<BitbucketIssue[]>> {
  return invokeCommand<BitbucketIssue[]>("list_bitbucket_issues", {
    workspace,
    repoSlug,
    state,
    token,
  });
}

// Bitbucket Pipelines

export async function listBitbucketPipelines(
  workspace: string,
  repoSlug: string,
  token?: string | null,
): Promise<CommandResult<BitbucketPipeline[]>> {
  return invokeCommand<BitbucketPipeline[]>("list_bitbucket_pipelines", {
    workspace,
    repoSlug,
    token,
  });
}

// ============================================================================
// Commit Templates
// ============================================================================

export interface CommitTemplate {
  id: string;
  name: string;
  content: string;
  isConventional: boolean;
  createdAt: number;
}

export interface ConventionalType {
  typeName: string;
  description: string;
  emoji?: string;
}

/**
 * Get commit template from git config or .gitmessage file
 */
export async function getCommitTemplate(
  repoPath: string,
): Promise<CommandResult<string | null>> {
  return invokeCommand<string | null>("get_commit_template", {
    path: repoPath,
  });
}

/**
 * List all saved commit templates
 */
export async function listTemplates(): Promise<
  CommandResult<CommitTemplate[]>
> {
  return invokeCommand<CommitTemplate[]>("list_templates", {});
}

/**
 * Save a commit template
 */
export async function saveTemplate(
  template: CommitTemplate,
): Promise<CommandResult<CommitTemplate>> {
  return invokeCommand<CommitTemplate>("save_template", { template });
}

/**
 * Delete a commit template
 */
export async function deleteTemplate(id: string): Promise<CommandResult<void>> {
  return invokeCommand<void>("delete_template", { id });
}

/**
 * Get conventional commit types
 */
export async function getConventionalTypes(): Promise<
  CommandResult<ConventionalType[]>
> {
  return invokeCommand<ConventionalType[]>("get_conventional_types", {});
}

// ============================================================================
// Auto-fetch
// ============================================================================

export interface RemoteStatus {
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  upstreamName?: string;
}

/**
 * Start auto-fetching for a repository
 */
export async function startAutoFetch(
  repoPath: string,
  intervalMinutes: number,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("start_auto_fetch", {
    path: repoPath,
    intervalMinutes,
  });
}

/**
 * Stop auto-fetching for a repository
 */
export async function stopAutoFetch(
  repoPath: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("stop_auto_fetch", { path: repoPath });
}

/**
 * Check if auto-fetch is running for a repository
 */
export async function isAutoFetchRunning(
  repoPath: string,
): Promise<CommandResult<boolean>> {
  return invokeCommand<boolean>("is_auto_fetch_running", { path: repoPath });
}

/**
 * Get remote status (ahead/behind counts)
 */
export async function getRemoteStatus(
  repoPath: string,
): Promise<CommandResult<RemoteStatus>> {
  return invokeCommand<RemoteStatus>("get_remote_status", { path: repoPath });
}

// ============================================================================
// Remote Operation Events
// ============================================================================

/**
 * Result of a remote operation (fetch/pull/push) emitted by the backend
 */
export interface RemoteOperationResult {
  operation: string;
  remote: string;
  success: boolean;
  message: string;
}

let remoteOperationUnlisten: UnlistenFn | null = null;

/**
 * Set up listeners for remote operation events (fetch/pull/push completions).
 * These are particularly useful for auto-fetch and other background operations.
 * Call this once when the app starts.
 */
export async function setupRemoteOperationListeners(): Promise<void> {
  // Only set up once
  if (remoteOperationUnlisten) {
    return;
  }

  remoteOperationUnlisten = await listenToEvent<RemoteOperationResult>(
    "remote-operation-completed",
    (result) => {
      // For auto-fetch background operations, show a success toast
      // Note: The inline toasts in fetch/pull/push handle user-initiated operations
      if (result.operation === "fetch" && result.success) {
        showToast(result.message, "success");
      }
    },
  );
}

/**
 * Clean up remote operation listeners (call on app unmount)
 */
export function cleanupRemoteOperationListeners(): void {
  if (remoteOperationUnlisten) {
    remoteOperationUnlisten();
    remoteOperationUnlisten = null;
  }
}

// ============================================================================
// Git Profiles
// ============================================================================

import type { GitProfile, ProfilesConfig } from "../types/workflow.types.ts";
import { workflowStore } from "../stores/workflow.store.ts";
import * as unifiedProfileService from "./unified-profile.service.ts";

/**
 * Current identity for a repository
 */
export interface CurrentIdentityInfo {
  name: string | null;
  email: string | null;
  signingKey: string | null;
}

/**
 * Get all saved profiles
 */
export async function getProfiles(): Promise<CommandResult<GitProfile[]>> {
  return invokeCommand<GitProfile[]>("get_profiles", {});
}

/**
 * Get profiles config including repository assignments
 */
export async function getProfilesConfig(): Promise<
  CommandResult<ProfilesConfig>
> {
  return invokeCommand<ProfilesConfig>("get_profiles_config", {});
}

/**
 * Save a profile (create or update)
 */
export async function saveProfile(
  profile: GitProfile,
): Promise<CommandResult<GitProfile>> {
  const result = await invokeCommand<GitProfile>("save_profile", { profile });
  if (result.success && result.data) {
    // Update store
    const store = workflowStore.getState();
    const existing = store.profiles.find((p) => p.id === profile.id);
    if (existing) {
      store.updateProfile(result.data);
    } else {
      store.addProfile(result.data);
    }
  }
  return result;
}

/**
 * Delete a profile
 */
export async function deleteProfile(
  profileId: string,
): Promise<CommandResult<void>> {
  const result = await invokeCommand<void>("delete_profile", { profileId });
  if (result.success) {
    workflowStore.getState().removeProfile(profileId);
  }
  return result;
}

/**
 * Apply a profile to a repository (sets git config)
 */
export async function applyProfile(
  repoPath: string,
  profileId: string,
): Promise<CommandResult<void>> {
  const result = await invokeCommand<void>("apply_profile", {
    path: repoPath,
    profileId,
  });
  if (result.success) {
    const profile = workflowStore
      .getState()
      .profiles.find((p) => p.id === profileId);
    if (profile) {
      workflowStore.getState().setActiveProfile(profile);
    }
    showToast("Profile applied successfully", "success");
  }
  return result;
}

/**
 * Detect which profile should be used for a repository based on URL patterns
 */
export async function detectProfileForRepository(
  repoPath: string,
): Promise<CommandResult<GitProfile | null>> {
  return invokeCommand<GitProfile | null>("detect_profile_for_repository", {
    path: repoPath,
  });
}

/**
 * Get the assigned profile for a repository
 */
export async function getAssignedProfile(
  repoPath: string,
): Promise<CommandResult<GitProfile | null>> {
  return invokeCommand<GitProfile | null>("get_assigned_profile", {
    path: repoPath,
  });
}

/**
 * Manually assign a profile to a repository (without applying git config)
 */
export async function assignProfileToRepository(
  repoPath: string,
  profileId: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("assign_profile_to_repository", {
    path: repoPath,
    profileId,
  });
}

/**
 * Remove profile assignment from a repository
 */
export async function unassignProfileFromRepository(
  repoPath: string,
): Promise<CommandResult<void>> {
  return invokeCommand<void>("unassign_profile_from_repository", {
    path: repoPath,
  });
}

/**
 * Get the current git identity for a repository
 */
export async function getCurrentIdentity(
  repoPath: string,
): Promise<CommandResult<CurrentIdentityInfo>> {
  return invokeCommand<CurrentIdentityInfo>("get_current_identity", {
    path: repoPath,
  });
}

/**
 * Load profiles from backend and update store
 */
export async function loadProfiles(): Promise<void> {
  const store = workflowStore.getState();
  store.setLoadingProfiles(true);

  try {
    const result = await getProfiles();
    if (result.success && result.data) {
      store.setProfiles(result.data);
    } else {
      store.setProfileError(result.error?.message ?? "Failed to load profiles");
    }
  } finally {
    store.setLoadingProfiles(false);
  }
}

/**
 * Load and detect profile for a repository
 */
export async function loadProfileForRepository(
  repoPath: string,
): Promise<void> {
  const store = workflowStore.getState();
  store.setCurrentRepositoryPath(repoPath);

  // Load legacy profile for workflow store
  const result = await getAssignedProfile(repoPath);
  if (result.success) {
    store.setActiveProfile(result.data ?? null);
  }

  // Also load unified profile for integration accounts
  await unifiedProfileService.loadUnifiedProfileForRepository(repoPath);
}

/**
 * Repository hosting provider types
 */
export type RepositoryProvider =
  | "github"
  | "ado"
  | "gitlab"
  | "bitbucket"
  | null;

/**
 * Integration suggestion result
 */
export interface IntegrationSuggestion {
  provider: RepositoryProvider;
  providerName: string;
  isConfigured: boolean;
  features: string[];
}

/**
 * Detect repository hosting provider and check if integration is configured
 */
export async function detectRepositoryIntegration(
  repoPath: string,
): Promise<IntegrationSuggestion | null> {
  // Import the store to check for configured accounts
  const { unifiedProfileStore } =
    await import("../stores/unified-profile.store.ts");
  const accounts = unifiedProfileStore.getState().accounts;

  // Helper to check if an account of a given type exists
  const hasAccountOfType = (
    type: "github" | "gitlab" | "azure-devops" | "bitbucket",
  ): boolean => {
    return accounts.some((account) => account.integrationType === type);
  };

  // Try to detect each provider in parallel
  const [githubResult, adoResult, gitlabResult, bitbucketResult] =
    await Promise.all([
      detectGitHubRepo(repoPath),
      detectAdoRepo(repoPath),
      detectGitLabRepo(repoPath),
      detectBitbucketRepo(repoPath),
    ]);

  // Check GitHub
  if (githubResult.success && githubResult.data) {
    return {
      provider: "github",
      providerName: "GitHub",
      isConfigured: hasAccountOfType("github"),
      features: [
        "Pull request overlays",
        "Create PRs from branches",
        "Link issues",
      ],
    };
  }

  // Check Azure DevOps
  if (adoResult.success && adoResult.data) {
    return {
      provider: "ado",
      providerName: "Azure DevOps",
      isConfigured: hasAccountOfType("azure-devops"),
      features: ["Pull request overlays", "Work item linking"],
    };
  }

  // Check GitLab
  if (gitlabResult.success && gitlabResult.data) {
    return {
      provider: "gitlab",
      providerName: "GitLab",
      isConfigured: hasAccountOfType("gitlab"),
      features: ["Merge request overlays", "Issue linking"],
    };
  }

  // Check Bitbucket
  if (bitbucketResult.success && bitbucketResult.data) {
    return {
      provider: "bitbucket",
      providerName: "Bitbucket",
      isConfigured: hasAccountOfType("bitbucket"),
      features: ["Pull request overlays"],
    };
  }

  return null;
}

// ============================================================================
// Repository Maintenance
// ============================================================================

import type {
  RunGcCommand,
  RunFsckCommand,
  RunPruneCommand,
  MaintenanceResult,
} from "../types/api.types.ts";

/**
 * Run garbage collection on a repository
 * Cleans up unnecessary files and optimizes the local repository
 */
export async function runGc(
  args: RunGcCommand & { silent?: boolean },
): Promise<CommandResult<MaintenanceResult>> {
  const result = await invokeCommand<MaintenanceResult>("run_gc", args);
  if (!args?.silent) {
    if (result.success && result.data) {
      showToast(result.data.message, "success");
    } else {
      showToast(`Garbage collection failed: ${result.error?.message}`, "error");
    }
  }
  return result;
}

/**
 * Run file system check on a repository
 * Verifies the connectivity and validity of objects in the repository
 */
export async function runFsck(
  args: RunFsckCommand & { silent?: boolean },
): Promise<CommandResult<MaintenanceResult>> {
  const result = await invokeCommand<MaintenanceResult>("run_fsck", args);
  if (!args?.silent) {
    if (result.success && result.data) {
      showToast(result.data.message, "success");
    } else {
      showToast(`Repository check failed: ${result.error?.message}`, "error");
    }
  }
  return result;
}

/**
 * Prune unreachable objects from the repository
 */
export async function runPrune(
  args: RunPruneCommand & { silent?: boolean },
): Promise<CommandResult<MaintenanceResult>> {
  const result = await invokeCommand<MaintenanceResult>("run_prune", args);
  if (!args?.silent) {
    if (result.success && result.data) {
      showToast(result.data.message, "success");
    } else {
      showToast(`Prune failed: ${result.error?.message}`, "error");
    }
  }
  return result;
}
