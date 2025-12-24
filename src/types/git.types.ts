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
}

export interface AheadBehind {
  ahead: number;
  behind: number;
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

export type RefType = 'localBranch' | 'remoteBranch' | 'tag';

export interface RefInfo {
  name: string;
  shorthand: string;
  refType: RefType;
  isHead: boolean;
}

/** Map of commit OID to refs pointing to it */
export type RefsByCommit = Record<string, RefInfo[]>;

export interface Stash {
  index: number;
  message: string;
  oid: string;
}

export interface RebaseCommit {
  oid: string;
  shortId: string;
  summary: string;
  action: string;
}

export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

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
  additions: number;
  deletions: number;
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

export interface Submodule {
  name: string;
  path: string;
  url: string;
  headId: string | null;
  status: SubmoduleStatus;
}

export type SubmoduleStatus =
  | 'clean'
  | 'dirty'
  | 'uninitialized'
  | 'modified'
  | 'untracked';
