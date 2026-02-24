/**
 * Git-related type definitions
 */

export interface Repository {
  path: string;
  name: string;
  isValid: boolean;
  isBare: boolean;
  headRef: string | null;
  state: RepositoryState;
}

export type RepositoryState =
  | 'clean'
  | 'merge'
  | 'revert'
  | 'cherrypick'
  | 'bisect'
  | 'rebase'
  | 'rebase-interactive'
  | 'rebase-merge'
  | 'apply-mailbox'
  | 'apply-mailbox-or-rebase';

export interface CloneFilterInfo {
  isPartialClone: boolean;
  filter: string | null;
  promisorRemote: string | null;
}

export interface Commit {
  oid: string;
  shortId: string;
  message: string;
  summary: string;
  body: string | null;
  author: Signature;
  committer: Signature;
  parentIds: string[];
  timestamp: number;
}

export interface Signature {
  name: string;
  email: string;
  timestamp: number;
}

export interface Branch {
  name: string;
  shorthand: string;
  isHead: boolean;
  isRemote: boolean;
  upstream: string | null;
  targetOid: string;
  aheadBehind?: AheadBehind;
  /** Unix timestamp of the last commit on this branch */
  lastCommitTimestamp?: number;
  /** Whether this branch is considered stale (no commits in 90+ days) */
  isStale: boolean;
}

export interface AheadBehind {
  ahead: number;
  behind: number;
}

/** Detailed branch tracking information */
export interface BranchTrackingInfo {
  /** The local branch name */
  localBranch: string;
  /** The full upstream reference (e.g., "refs/remotes/origin/main") */
  upstream: string | null;
  /** Number of commits ahead of upstream */
  ahead: number;
  /** Number of commits behind upstream */
  behind: number;
  /** The remote name (e.g., "origin") */
  remote: string | null;
  /** The remote branch name (e.g., "main") */
  remoteBranch: string | null;
  /** Whether the upstream branch was deleted */
  isGone: boolean;
}

export interface Remote {
  name: string;
  url: string;
  pushUrl: string | null;
}

export interface Tag {
  name: string;
  targetOid: string;
  message: string | null;
  tagger: Signature | null;
  isAnnotated: boolean;
}

export interface TagDetails {
  name: string;
  oid: string;
  targetOid: string;
  isAnnotated: boolean;
  message: string | null;
  taggerName: string | null;
  taggerEmail: string | null;
  taggerDate: number | null;
  isSigned: boolean;
}

export type RefType = 'localBranch' | 'remoteBranch' | 'tag';

export interface RefInfo {
  name: string;
  shorthand: string;
  refType: RefType;
  isHead: boolean;
  /** For tags: whether the tag is annotated (has message/tagger) */
  isAnnotated?: boolean;
  /** For tags: the tag message (if annotated) */
  tagMessage?: string;
}

/** Map of commit OID to refs pointing to it */
export type RefsByCommit = Record<string, RefInfo[]>;

export interface Stash {
  index: number;
  message: string;
  oid: string;
}

export interface StashFile {
  path: string;
  additions: number;
  deletions: number;
  status: string;
}

export interface StashShowResult {
  index: number;
  message: string;
  files: StashFile[];
  totalAdditions: number;
  totalDeletions: number;
  patch: string | null;
}

export interface RebaseCommit {
  oid: string;
  shortId: string;
  summary: string;
  action: string;
}

export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

/**
 * Represents the current state of an interactive rebase
 */
export interface RebaseState {
  inProgress: boolean;
  headName: string | null;
  onto: string | null;
  currentCommit: string | null;
  doneCount: number;
  totalCount: number;
  hasConflicts: boolean;
}

/**
 * Represents an entry in the rebase todo list
 */
export interface RebaseTodoEntry {
  action: string;
  commitOid: string;
  commitShort: string;
  message: string;
}

/**
 * Represents the full rebase todo state
 */
export interface RebaseTodo {
  entries: RebaseTodoEntry[];
  done: RebaseTodoEntry[];
}

/**
 * Result of a squash operation
 */
export interface SquashResult {
  newOid: string;
  squashedCount: number;
  success: boolean;
}

/**
 * Result of a drop commit operation
 */
export interface DropCommitResult {
  success: boolean;
  newTip: string;
  hasConflicts: boolean;
  droppedMessage: string;
}

/**
 * Result of a commit reorder operation
 */
export interface ReorderResult {
  success: boolean;
  newTip: string;
  reorderedCount: number;
  hasConflicts: boolean;
}

export interface StatusEntry {
  path: string;
  status: FileStatus;
  isStaged: boolean;
  isConflicted: boolean;
}

export type FileStatus =
  | 'new'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'ignored'
  | 'untracked'
  | 'typechange'
  | 'conflicted';

export interface DiffFile {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  hunks: DiffHunk[];
  isBinary: boolean;
  isImage: boolean;
  imageType: string | null;
  additions: number;
  deletions: number;
  truncated?: boolean;
  totalLines?: number;
}

export interface ImageVersions {
  path: string;
  oldData: string | null;
  newData: string | null;
  oldSize: [number, number] | null;
  newSize: [number, number] | null;
  imageType: string | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  content: string;
  origin: DiffLineOrigin;
  oldLineNo: number | null;
  newLineNo: number | null;
}

export type DiffLineOrigin =
  | 'context'
  | 'addition'
  | 'deletion'
  | 'context-eofnl'
  | 'add-eofnl'
  | 'del-eofnl'
  | 'file-header'
  | 'hunk-header'
  | 'binary';

/**
 * Partial staging types
 */
export interface FileHunks {
  filePath: string;
  hunks: IndexedDiffHunk[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface IndexedDiffHunk {
  index: number;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: HunkDiffLine[];
  isStaged: boolean;
}

export interface HunkDiffLine {
  lineType: string;
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface CommitFileEntry {
  path: string;
  status: FileStatus;
  additions: number;
  deletions: number;
}

export interface CommitStats {
  oid: string;
  additions: number;
  deletions: number;
  filesChanged: number;
}

export interface ReflogEntry {
  oid: string;
  shortId: string;
  index: number;
  action: string;
  message: string;
  timestamp: number;
  author: string;
}

export interface UndoAction {
  actionType: string;
  description: string;
  timestamp: number;
  beforeRef: string;
  afterRef: string;
  details: string | null;
}

export interface UndoHistory {
  actions: UndoAction[];
  currentIndex: number;
  canUndo: boolean;
  canRedo: boolean;
}

export interface BlameLine {
  lineNumber: number;
  content: string;
  commitOid: string;
  commitShortId: string;
  authorName: string;
  authorEmail: string;
  timestamp: number;
  summary: string;
  isBoundary: boolean;
}

export interface BlameResult {
  path: string;
  lines: BlameLine[];
  totalLines: number;
}

export interface ConflictFile {
  path: string;
  ancestor: ConflictEntry | null;
  ours: ConflictEntry | null;
  theirs: ConflictEntry | null;
}

export interface ConflictEntry {
  oid: string;
  path: string;
  mode: number;
}

/**
 * File with conflict markers detected in its content
 */
export interface ConflictMarkerFile {
  /** File path relative to repository root */
  path: string;
  /** Number of conflict regions in the file */
  conflictCount: number;
  /** Details of each conflict marker region */
  markers: ConflictMarker[];
}

/**
 * A single conflict marker region in a file
 */
export interface ConflictMarker {
  /** Line number where the conflict starts (<<<<<<< marker) */
  startLine: number;
  /** Line number of the separator (=======) */
  separatorLine: number;
  /** Line number where the conflict ends (>>>>>>> marker) */
  endLine: number;
  /** Content from our side (between <<<<<<< and =======) */
  oursContent: string;
  /** Content from their side (between ======= and >>>>>>>) */
  theirsContent: string;
  /** Content from base version if diff3 style (between ||||||| and =======) */
  baseContent: string | null;
}

/**
 * Detailed information about conflicts in a file including ref names
 */
export interface ConflictDetails {
  /** File path relative to repository root */
  filePath: string;
  /** Name of our ref (current branch or HEAD) */
  ourRef: string;
  /** Name of their ref (incoming branch) */
  theirRef: string;
  /** Name of base ref if available */
  baseRef: string | null;
  /** Conflict markers found in the file */
  markers: ConflictMarker[];
}

export type SubmoduleStatus =
  | 'current'
  | 'modified'
  | 'uninitialized'
  | 'missing'
  | 'dirty';

export interface Submodule {
  name: string;
  path: string;
  url: string | null;
  headOid: string | null;
  branch: string | null;
  initialized: boolean;
  status: SubmoduleStatus;
}

/**
 * Avatar info returned from the backend
 */
export interface AvatarInfo {
  email: string;
  gravatarUrl: string;
  initials: string;
  color: string;
}

/**
 * Result of viewing or checking out a file at a specific commit
 */
export interface FileAtCommitResult {
  filePath: string;
  commitOid: string;
  content: string;
  isBinary: boolean;
  size: number;
}

/**
 * File encoding detection information
 */
export interface FileEncodingInfo {
  /** Relative path of the file */
  filePath: string;
  /** Detected encoding name (e.g., "UTF-8", "UTF-16LE", "Shift_JIS") */
  encoding: string;
  /** Detection confidence from 0.0 to 1.0 */
  confidence: number;
  /** Whether the file has a byte order mark */
  hasBom: boolean;
  /** Line ending style: "LF", "CRLF", "CR", "Mixed", or "N/A" */
  lineEnding: string;
  /** Whether the file appears to be binary */
  isBinary: boolean;
}

/**
 * Result of a file encoding conversion
 */
export interface ConvertEncodingResult {
  success: boolean;
  sourceEncoding: string;
  targetEncoding: string;
  bytesWritten: number;
}

/**
 * Sorted file status result with summary counts
 */
export interface SortedFileStatus {
  files: SortedStatusEntry[];
  totalCount: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictedCount: number;
}

/**
 * A status entry enriched with sorting-related metadata
 */
export interface SortedStatusEntry {
  path: string;
  filename: string;
  directory: string;
  extension: string | null;
  status: string;
  isStaged: boolean;
  isConflicted: boolean;
}

/**
 * Sort options for file tree sorting
 */
export type FileStatusSortBy = 'name' | 'status' | 'path' | 'extension';

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc';

/**
 * A branch that is a candidate for cleanup, returned by the backend.
 * Uses graph_descendant_of for accurate merge detection.
 */
export interface CleanupCandidate {
  name: string;
  shorthand: string;
  category: 'merged' | 'stale' | 'gone';
  lastCommitTimestamp: number | null;
  isProtected: boolean;
  upstream: string | null;
  aheadBehind: AheadBehind | null;
}

/**
 * A workspace grouping related repositories
 */
export interface Workspace {
  id: string;
  name: string;
  description: string;
  color: string;
  repositories: WorkspaceRepository[];
  createdAt: string;
  lastOpened: string | null;
}

/**
 * A repository within a workspace
 */
export interface WorkspaceRepository {
  path: string;
  name: string;
}

/**
 * Status information for a repository within a workspace
 */
export interface WorkspaceRepoStatus {
  path: string;
  name: string;
  exists: boolean;
  isValidRepo: boolean;
  changedFilesCount: number;
  currentBranch: string | null;
  ahead: number;
  behind: number;
}

/**
 * A search result from workspace-level search across repos
 */
export interface WorkspaceSearchResult {
  repoName: string;
  repoPath: string;
  filePath: string;
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

/**
 * Checkout with auto-stash result
 */
export interface CheckoutWithStashResult {
  success: boolean;
  stashed: boolean;
  stashApplied: boolean;
  stashConflict: boolean;
  message: string;
}

/**
 * Shortlog types
 */
export interface ShortlogOptions {
  range?: string;
  all?: boolean;
  numbered?: boolean;
  summary?: boolean;
  email?: boolean;
  group?: 'author' | 'committer';
}

export interface ShortlogEntry {
  name: string;
  email: string | null;
  count: number;
  commits: string[];
}

export interface ShortlogResult {
  entries: ShortlogEntry[];
  totalCommits: number;
  totalContributors: number;
}

/**
 * Clean operation types
 */
export interface CleanEntry {
  path: string;
  isDirectory: boolean;
  isIgnored: boolean;
  size: number | null;
}

/**
 * Bisect operation types
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

/**
 * Worktree types
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

/**
 * Git LFS types
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

/**
 * GPG types
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

/**
 * Signing status
 * NOTE: SigningStatus is defined in api.types.ts to avoid duplicate export
 */

/**
 * SSH types
 */
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

/**
 * Git configuration types
 */
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

export interface LineEndingConfig {
  coreAutocrlf: string | null;
  coreEol: string | null;
  coreSafecrlf: string | null;
}

export interface GitConfig {
  key: string;
  value: string;
  scope: string;
}

/**
 * Credential types
 */
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

/**
 * Commit template types
 */
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
 * PR template types
 */
export interface PrTemplate {
  name: string;
  path: string;
  isDefault: boolean;
}

/**
 * GitFlow configuration
 * NOTE: GitFlowConfig is defined in workflow.types.ts to avoid duplicate export
 */

/**
 * Git hook types
 */
export interface GitHook {
  name: string;
  path: string;
  exists: boolean;
  enabled: boolean;
  content: string | null;
  description: string;
}

/**
 * File operation result
 */
export interface OpenResult {
  success: boolean;
  message?: string;
}

/**
 * Editor configuration
 */
export interface EditorConfig {
  editor?: string;
  visual?: string;
}

/**
 * Search types
 */
export interface SearchResult {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

export interface SearchFileResult {
  filePath: string;
  matches: SearchResult[];
  matchCount: number;
}

export interface DiffSearchResult {
  commitId: string;
  author: string;
  date: number;
  message: string;
  filePath: string;
  lineContent: string;
}

/**
 * Repository bookmark
 */
export interface RepoBookmark {
  path: string;
  name: string;
  group: string | null;
  pinned: boolean;
  lastOpened: number;
  color: string | null;
}

/**
 * Branch protection rules
 */
export interface BranchRule {
  pattern: string;
  preventDeletion: boolean;
  preventForcePush: boolean;
  requirePullRequest: boolean;
  preventDirectPush: boolean;
}

/**
 * Diff tool types
 */
export interface AvailableDiffTool {
  name: string;
  command: string;
  available: boolean;
}

export interface DiffToolResult {
  success: boolean;
  message: string;
}

/**
 * Merge tool types
 */
export interface MergeToolInfo {
  name: string;
  displayName: string;
  command: string;
  available: boolean;
}

export interface MergeToolResult {
  success: boolean;
  message: string;
}

/**
 * Enhanced repository statistics
 */
export interface EnhancedMonthActivity {
  year: number;
  month: number;
  commits: number;
  authors: number;
}

export interface WeekdayActivity {
  day: string;
  commits: number;
}

export interface EnhancedHourActivity {
  hour: number;
  commits: number;
}

export interface EnhancedContributorStats {
  name: string;
  email: string;
  commits: number;
  linesAdded: number;
  linesDeleted: number;
  firstCommit: number;
  lastCommit: number;
}

export interface FileTypeStats {
  extension: string;
  fileCount: number;
  totalLines: number;
}

export interface RepoStatistics {
  totalCommits: number;
  totalBranches: number;
  totalTags: number;
  totalContributors: number;
  totalFiles: number;
  repoSizeBytes: number;
  firstCommitDate: number | null;
  lastCommitDate: number | null;
  repoAgeDays: number;
  activityByMonth: EnhancedMonthActivity[] | null;
  activityByWeekday: WeekdayActivity[] | null;
  activityByHour: EnhancedHourActivity[] | null;
  topContributors: EnhancedContributorStats[] | null;
  fileTypes: FileTypeStats[] | null;
  totalLinesAdded: number;
  totalLinesDeleted: number;
}

export interface GetRepoStatisticsOptions {
  includeActivity?: boolean;
  includeContributors?: boolean;
  includeFileTypes?: boolean;
  since?: string;
  until?: string;
}
