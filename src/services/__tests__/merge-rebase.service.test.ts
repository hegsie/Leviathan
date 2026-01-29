import { expect } from '@open-wc/testing';

// Mock Tauri API
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
let lastInvokedCommand: string | null = null;
let lastInvokedArgs: unknown = null;

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    lastInvokedCommand = command;
    lastInvokedArgs = args;
    return mockInvoke(command, args);
  },
};

import {
  merge,
  abortMerge,
  rebase,
  continueRebase,
  abortRebase,
  getRebaseCommits,
  executeInteractiveRebase,
  getRebaseState,
  getRebaseTodo,
  updateRebaseTodo,
  skipRebaseCommit,
  getConflicts,
  getBlobContent,
  resolveConflict,
  detectConflictMarkers,
  getConflictDetails,
} from '../git.service.ts';

describe('git.service - Merge operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    mockInvoke = () => Promise.resolve(null);
  });

  describe('merge', () => {
    it('invokes merge with sourceRef', async () => {
      const result = await merge({ path: '/test/repo', sourceRef: 'feature/login' });
      expect(lastInvokedCommand).to.equal('merge');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo', sourceRef: 'feature/login' });
      expect(result.success).to.be.true;
    });

    it('invokes merge with noFf option', async () => {
      await merge({ path: '/test/repo', sourceRef: 'develop', noFf: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.noFf).to.be.true;
    });

    it('invokes merge with squash option', async () => {
      await merge({ path: '/test/repo', sourceRef: 'feature/x', squash: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.squash).to.be.true;
    });

    it('invokes merge with custom message', async () => {
      await merge({ path: '/test/repo', sourceRef: 'develop', message: 'Merge develop' });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.message).to.equal('Merge develop');
    });

    it('handles merge conflict error', async () => {
      mockInvoke = () => Promise.reject({ code: 'MERGE_CONFLICT', message: 'Merge conflict' });

      const result = await merge({ path: '/test/repo', sourceRef: 'feature/conflict' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('MERGE_CONFLICT');
    });
  });

  describe('abortMerge', () => {
    it('invokes abort_merge with path', async () => {
      const result = await abortMerge({ path: '/test/repo' });
      expect(lastInvokedCommand).to.equal('abort_merge');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
      expect(result.success).to.be.true;
    });
  });
});

describe('git.service - Rebase operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    mockInvoke = () => Promise.resolve(null);
  });

  describe('rebase', () => {
    it('invokes rebase with path and onto', async () => {
      const result = await rebase({ path: '/test/repo', onto: 'main' });
      expect(lastInvokedCommand).to.equal('rebase');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo', onto: 'main' });
      expect(result.success).to.be.true;
    });

    it('handles rebase conflict error', async () => {
      mockInvoke = () => Promise.reject({ code: 'REBASE_CONFLICT', message: 'Rebase conflict' });

      const result = await rebase({ path: '/test/repo', onto: 'main' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('REBASE_CONFLICT');
    });
  });

  describe('continueRebase', () => {
    it('invokes continue_rebase with path', async () => {
      const result = await continueRebase({ path: '/test/repo' });
      expect(lastInvokedCommand).to.equal('continue_rebase');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
      expect(result.success).to.be.true;
    });

    it('handles conflict still present error', async () => {
      mockInvoke = () => Promise.reject({ code: 'REBASE_CONFLICT', message: 'Conflicts remain' });

      const result = await continueRebase({ path: '/test/repo' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('REBASE_CONFLICT');
    });
  });

  describe('abortRebase', () => {
    it('invokes abort_rebase with path', async () => {
      const result = await abortRebase({ path: '/test/repo' });
      expect(lastInvokedCommand).to.equal('abort_rebase');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
      expect(result.success).to.be.true;
    });
  });

  describe('getRebaseCommits', () => {
    it('invokes get_rebase_commits with path and onto', async () => {
      const mockCommits = [
        { oid: 'abc', summary: 'commit 1', action: 'pick' },
        { oid: 'def', summary: 'commit 2', action: 'pick' },
      ];
      mockInvoke = () => Promise.resolve(mockCommits);

      const result = await getRebaseCommits('/test/repo', 'main');
      expect(lastInvokedCommand).to.equal('get_rebase_commits');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo', onto: 'main' });
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal(mockCommits);
    });
  });

  describe('executeInteractiveRebase', () => {
    it('invokes execute_interactive_rebase with path, onto, and todo', async () => {
      const todo = 'pick abc commit 1\nsquash def commit 2';
      const result = await executeInteractiveRebase('/test/repo', 'main', todo);
      expect(lastInvokedCommand).to.equal('execute_interactive_rebase');
      expect(lastInvokedArgs).to.deep.equal({
        path: '/test/repo',
        onto: 'main',
        todo,
      });
      expect(result.success).to.be.true;
    });

    it('handles rebase conflict during interactive rebase', async () => {
      mockInvoke = () => Promise.reject({ code: 'REBASE_CONFLICT', message: 'Conflict during interactive rebase' });

      const result = await executeInteractiveRebase('/test/repo', 'main', 'pick abc commit');
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('REBASE_CONFLICT');
    });
  });
});

describe('git.service - Conflict resolution operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    mockInvoke = () => Promise.resolve(null);
  });

  describe('getConflicts', () => {
    it('invokes get_conflicts with path', async () => {
      const mockConflicts = [
        { path: 'src/index.ts', oursOid: 'abc', theirsOid: 'def', ancestorOid: 'ghi' },
      ];
      mockInvoke = () => Promise.resolve(mockConflicts);

      const result = await getConflicts('/test/repo');
      expect(lastInvokedCommand).to.equal('get_conflicts');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal(mockConflicts);
    });

    it('returns empty array when no conflicts', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getConflicts('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });
  });

  describe('getBlobContent', () => {
    it('invokes get_blob_content with path and oid', async () => {
      mockInvoke = () => Promise.resolve('file content here');

      const result = await getBlobContent('/test/repo', 'abc123');
      expect(lastInvokedCommand).to.equal('get_blob_content');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo', oid: 'abc123' });
      expect(result.success).to.be.true;
      expect(result.data).to.equal('file content here');
    });

    it('handles blob not found error', async () => {
      mockInvoke = () => Promise.reject({ code: 'BLOB_NOT_FOUND', message: 'Blob not found' });

      const result = await getBlobContent('/test/repo', 'nonexistent');
      expect(result.success).to.be.false;
    });
  });

  describe('resolveConflict', () => {
    it('invokes resolve_conflict with path, file_path, and content', async () => {
      const result = await resolveConflict('/test/repo', 'src/index.ts', 'resolved content');
      expect(lastInvokedCommand).to.equal('resolve_conflict');
      expect(lastInvokedArgs).to.deep.equal({
        path: '/test/repo',
        file_path: 'src/index.ts',
        content: 'resolved content',
      });
      expect(result.success).to.be.true;
    });

    it('handles resolve error', async () => {
      mockInvoke = () => Promise.reject({ code: 'COMMAND_ERROR', message: 'Failed to resolve' });

      const result = await resolveConflict('/test/repo', 'bad/path.ts', '');
      expect(result.success).to.be.false;
    });
  });
});

describe('git.service - Interactive rebase state management', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    mockInvoke = () => Promise.resolve(null);
  });

  describe('getRebaseState', () => {
    it('invokes get_rebase_state with path', async () => {
      const mockState = {
        inProgress: false,
        headName: null,
        onto: null,
        currentCommit: null,
        doneCount: 0,
        totalCount: 0,
        hasConflicts: false,
      };
      mockInvoke = () => Promise.resolve(mockState);

      const result = await getRebaseState('/test/repo');
      expect(lastInvokedCommand).to.equal('get_rebase_state');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal(mockState);
    });

    it('returns active rebase state when in progress', async () => {
      const mockState = {
        inProgress: true,
        headName: 'feature-branch',
        onto: 'abc123',
        currentCommit: 'def456',
        doneCount: 2,
        totalCount: 5,
        hasConflicts: true,
      };
      mockInvoke = () => Promise.resolve(mockState);

      const result = await getRebaseState('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.inProgress).to.be.true;
      expect(result.data?.headName).to.equal('feature-branch');
      expect(result.data?.hasConflicts).to.be.true;
    });
  });

  describe('getRebaseTodo', () => {
    it('invokes get_rebase_todo with path', async () => {
      const mockTodo = {
        entries: [
          { action: 'pick', commitOid: 'abc', commitShort: 'abc', message: 'First' },
          { action: 'squash', commitOid: 'def', commitShort: 'def', message: 'Second' },
        ],
        done: [
          { action: 'pick', commitOid: 'ghi', commitShort: 'ghi', message: 'Done' },
        ],
      };
      mockInvoke = () => Promise.resolve(mockTodo);

      const result = await getRebaseTodo('/test/repo');
      expect(lastInvokedCommand).to.equal('get_rebase_todo');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal(mockTodo);
    });

    it('handles no rebase in progress error', async () => {
      mockInvoke = () => Promise.reject({ code: 'OPERATION_FAILED', message: 'No rebase in progress' });

      const result = await getRebaseTodo('/test/repo');
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('OPERATION_FAILED');
    });
  });

  describe('updateRebaseTodo', () => {
    it('invokes update_rebase_todo with path and entries', async () => {
      const entries = [
        { action: 'pick', commitOid: 'abc', commitShort: 'abc', message: 'First' },
        { action: 'fixup', commitOid: 'def', commitShort: 'def', message: 'Second' },
      ];

      const result = await updateRebaseTodo('/test/repo', entries);
      expect(lastInvokedCommand).to.equal('update_rebase_todo');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo', entries });
      expect(result.success).to.be.true;
    });

    it('handles no rebase in progress error', async () => {
      mockInvoke = () => Promise.reject({ code: 'OPERATION_FAILED', message: 'No rebase in progress' });

      const result = await updateRebaseTodo('/test/repo', []);
      expect(result.success).to.be.false;
    });

    it('allows reordering entries', async () => {
      const reorderedEntries = [
        { action: 'pick', commitOid: 'def', commitShort: 'def', message: 'Second (now first)' },
        { action: 'pick', commitOid: 'abc', commitShort: 'abc', message: 'First (now second)' },
      ];

      await updateRebaseTodo('/test/repo', reorderedEntries);
      const args = lastInvokedArgs as { entries: typeof reorderedEntries };
      expect(args.entries[0].commitOid).to.equal('def');
      expect(args.entries[1].commitOid).to.equal('abc');
    });

    it('allows changing actions', async () => {
      const modifiedEntries = [
        { action: 'reword', commitOid: 'abc', commitShort: 'abc', message: 'First' },
        { action: 'drop', commitOid: 'def', commitShort: 'def', message: 'Second' },
      ];

      await updateRebaseTodo('/test/repo', modifiedEntries);
      const args = lastInvokedArgs as { entries: typeof modifiedEntries };
      expect(args.entries[0].action).to.equal('reword');
      expect(args.entries[1].action).to.equal('drop');
    });
  });

  describe('skipRebaseCommit', () => {
    it('invokes skip_rebase_commit with path', async () => {
      const result = await skipRebaseCommit('/test/repo');
      expect(lastInvokedCommand).to.equal('skip_rebase_commit');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
      expect(result.success).to.be.true;
    });

    it('handles no rebase in progress error', async () => {
      mockInvoke = () => Promise.reject({ code: 'OPERATION_FAILED', message: 'No rebase in progress' });

      const result = await skipRebaseCommit('/test/repo');
      expect(result.success).to.be.false;
    });

    it('handles rebase conflict error', async () => {
      mockInvoke = () => Promise.reject({ code: 'REBASE_CONFLICT', message: 'Conflict after skip' });

      const result = await skipRebaseCommit('/test/repo');
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('REBASE_CONFLICT');
    });
  });
});

describe('git.service - Conflict detection operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    mockInvoke = () => Promise.resolve(null);
  });

  describe('detectConflictMarkers', () => {
    it('invokes detect_conflict_markers with path only', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await detectConflictMarkers('/test/repo');
      expect(lastInvokedCommand).to.equal('detect_conflict_markers');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo', file_path: undefined });
      expect(result.success).to.be.true;
    });

    it('invokes detect_conflict_markers with path and file_path', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await detectConflictMarkers('/test/repo', 'src/file.ts');
      expect(lastInvokedCommand).to.equal('detect_conflict_markers');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo', file_path: 'src/file.ts' });
      expect(result.success).to.be.true;
    });

    it('returns conflict marker files', async () => {
      const mockFiles = [
        {
          path: 'src/index.ts',
          conflictCount: 2,
          markers: [
            {
              startLine: 10,
              separatorLine: 15,
              endLine: 20,
              oursContent: 'our code',
              theirsContent: 'their code',
              baseContent: null,
            },
            {
              startLine: 30,
              separatorLine: 35,
              endLine: 40,
              oursContent: 'more ours',
              theirsContent: 'more theirs',
              baseContent: 'original',
            },
          ],
        },
      ];
      mockInvoke = () => Promise.resolve(mockFiles);

      const result = await detectConflictMarkers('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal(mockFiles);
      expect(result.data?.[0].conflictCount).to.equal(2);
      expect(result.data?.[0].markers[0].oursContent).to.equal('our code');
    });

    it('returns empty array when no conflicts', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await detectConflictMarkers('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });
  });

  describe('getConflictDetails', () => {
    it('invokes get_conflict_details with path and file_path', async () => {
      const mockDetails = {
        filePath: 'src/index.ts',
        ourRef: 'main',
        theirRef: 'feature-branch',
        baseRef: null,
        markers: [],
      };
      mockInvoke = () => Promise.resolve(mockDetails);

      const result = await getConflictDetails('/test/repo', 'src/index.ts');
      expect(lastInvokedCommand).to.equal('get_conflict_details');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo', file_path: 'src/index.ts' });
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal(mockDetails);
    });

    it('returns conflict details with markers', async () => {
      const mockDetails = {
        filePath: 'src/index.ts',
        ourRef: 'main',
        theirRef: 'feature/login',
        baseRef: 'common-ancestor',
        markers: [
          {
            startLine: 10,
            separatorLine: 15,
            endLine: 20,
            oursContent: 'function login() { return true; }',
            theirsContent: 'function login() { return false; }',
            baseContent: 'function login() { }',
          },
        ],
      };
      mockInvoke = () => Promise.resolve(mockDetails);

      const result = await getConflictDetails('/test/repo', 'src/index.ts');
      expect(result.success).to.be.true;
      expect(result.data?.ourRef).to.equal('main');
      expect(result.data?.theirRef).to.equal('feature/login');
      expect(result.data?.baseRef).to.equal('common-ancestor');
      expect(result.data?.markers.length).to.equal(1);
    });

    it('handles file not found error', async () => {
      mockInvoke = () => Promise.reject({ code: 'OPERATION_FAILED', message: 'File not found' });

      const result = await getConflictDetails('/test/repo', 'nonexistent.ts');
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('OPERATION_FAILED');
    });
  });
});
