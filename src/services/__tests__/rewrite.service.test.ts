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
  cherryPick,
  cherryPickRange,
  cherryPickFromBranch,
  continueCherryPick,
  abortCherryPick,
  revert,
  continueRevert,
  abortRevert,
  reset,
} from '../git.service.ts';

describe('git.service - Cherry-pick operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    mockInvoke = () => Promise.resolve({ success: true, data: null });
  });

  describe('cherryPick', () => {
    it('invokes cherry_pick with path and commitOid', async () => {
      const mockCommit = { oid: 'new123', summary: 'cherry-picked commit' };
      mockInvoke = () => Promise.resolve(mockCommit);

      const result = await cherryPick({ path: '/test/repo', commitOid: 'abc123' });
      expect(lastInvokedCommand).to.equal('cherry_pick');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo', commitOid: 'abc123' });
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal(mockCommit);
    });

    it('handles cherry-pick conflict error', async () => {
      mockInvoke = () => Promise.reject({ code: 'CHERRY_PICK_CONFLICT', message: 'Conflict detected' });

      const result = await cherryPick({ path: '/test/repo', commitOid: 'abc123' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('CHERRY_PICK_CONFLICT');
    });

    it('handles cherry-pick in progress error', async () => {
      mockInvoke = () => Promise.reject({ code: 'CHERRY_PICK_IN_PROGRESS', message: 'Cherry-pick already in progress' });

      const result = await cherryPick({ path: '/test/repo', commitOid: 'def456' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('CHERRY_PICK_IN_PROGRESS');
    });

    it('handles commit not found error', async () => {
      mockInvoke = () => Promise.reject({ code: 'COMMIT_NOT_FOUND', message: 'Commit not found' });

      const result = await cherryPick({ path: '/test/repo', commitOid: 'invalid' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('COMMIT_NOT_FOUND');
    });
  });

  describe('cherryPickRange', () => {
    it('invokes cherry_pick_range with path and commit OIDs', async () => {
      const mockCommits = [
        { oid: 'new1', summary: 'commit 1' },
        { oid: 'new2', summary: 'commit 2' },
      ];
      mockInvoke = () => Promise.resolve(mockCommits);

      const result = await cherryPickRange('/test/repo', ['abc123', 'def456']);
      expect(lastInvokedCommand).to.equal('cherry_pick_range');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.commitOids).to.deep.equal(['abc123', 'def456']);
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal(mockCommits);
    });

    it('handles single commit in range', async () => {
      const mockCommits = [{ oid: 'new1', summary: 'commit 1' }];
      mockInvoke = () => Promise.resolve(mockCommits);

      const result = await cherryPickRange('/test/repo', ['abc123']);
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
    });

    it('handles conflict during range cherry-pick', async () => {
      mockInvoke = () => Promise.reject({ code: 'CHERRY_PICK_CONFLICT', message: 'Conflict at commit 2' });

      const result = await cherryPickRange('/test/repo', ['abc123', 'def456', 'ghi789']);
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('CHERRY_PICK_CONFLICT');
    });

    it('handles empty commit list error', async () => {
      mockInvoke = () => Promise.reject({ code: 'OPERATION_FAILED', message: 'No commits specified' });

      const result = await cherryPickRange('/test/repo', []);
      expect(result.success).to.be.false;
    });
  });

  describe('continueCherryPick', () => {
    it('invokes continue_cherry_pick with path', async () => {
      const mockCommit = { oid: 'resolved123', summary: 'resolved commit' };
      mockInvoke = () => Promise.resolve(mockCommit);

      const result = await continueCherryPick({ path: '/test/repo' });
      expect(lastInvokedCommand).to.equal('continue_cherry_pick');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal(mockCommit);
    });

    it('handles no cherry-pick in progress error', async () => {
      mockInvoke = () => Promise.reject({ code: 'OPERATION_FAILED', message: 'No cherry-pick in progress' });

      const result = await continueCherryPick({ path: '/test/repo' });
      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('No cherry-pick in progress');
    });

    it('handles unresolved conflicts error', async () => {
      mockInvoke = () => Promise.reject({ code: 'CHERRY_PICK_CONFLICT', message: 'Conflicts remain' });

      const result = await continueCherryPick({ path: '/test/repo' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('CHERRY_PICK_CONFLICT');
    });
  });

  describe('abortCherryPick', () => {
    it('invokes abort_cherry_pick with path', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await abortCherryPick({ path: '/test/repo' });
      expect(lastInvokedCommand).to.equal('abort_cherry_pick');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
      expect(result.success).to.be.true;
    });

    it('succeeds even when no cherry-pick is in progress', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await abortCherryPick({ path: '/test/repo' });
      expect(result.success).to.be.true;
    });
  });
});

describe('git.service - Revert operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    mockInvoke = () => Promise.resolve({ success: true, data: null });
  });

  describe('revert', () => {
    it('invokes revert with path and commitOid', async () => {
      const mockCommit = { oid: 'revert123', summary: 'Revert "original"' };
      mockInvoke = () => Promise.resolve(mockCommit);

      const result = await revert({ path: '/test/repo', commitOid: 'abc123' });
      expect(lastInvokedCommand).to.equal('revert');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo', commitOid: 'abc123' });
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal(mockCommit);
    });

    it('handles revert conflict error', async () => {
      mockInvoke = () => Promise.reject({ code: 'REVERT_CONFLICT', message: 'Conflict detected' });

      const result = await revert({ path: '/test/repo', commitOid: 'abc123' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('REVERT_CONFLICT');
    });

    it('handles operation in progress error', async () => {
      mockInvoke = () => Promise.reject({ code: 'OPERATION_FAILED', message: 'Another operation is in progress' });

      const result = await revert({ path: '/test/repo', commitOid: 'abc123' });
      expect(result.success).to.be.false;
    });

    it('handles commit not found error', async () => {
      mockInvoke = () => Promise.reject({ code: 'COMMIT_NOT_FOUND', message: 'Commit not found' });

      const result = await revert({ path: '/test/repo', commitOid: 'nonexistent' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('COMMIT_NOT_FOUND');
    });
  });

  describe('continueRevert', () => {
    it('invokes continue_revert with path', async () => {
      const mockCommit = { oid: 'resolved456', summary: 'Revert "original"' };
      mockInvoke = () => Promise.resolve(mockCommit);

      const result = await continueRevert({ path: '/test/repo' });
      expect(lastInvokedCommand).to.equal('continue_revert');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal(mockCommit);
    });

    it('handles no revert in progress error', async () => {
      mockInvoke = () => Promise.reject({ code: 'OPERATION_FAILED', message: 'No revert in progress' });

      const result = await continueRevert({ path: '/test/repo' });
      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('No revert in progress');
    });

    it('handles unresolved conflicts error', async () => {
      mockInvoke = () => Promise.reject({ code: 'REVERT_CONFLICT', message: 'Conflicts remain' });

      const result = await continueRevert({ path: '/test/repo' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('REVERT_CONFLICT');
    });
  });

  describe('abortRevert', () => {
    it('invokes abort_revert with path', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await abortRevert({ path: '/test/repo' });
      expect(lastInvokedCommand).to.equal('abort_revert');
      expect(lastInvokedArgs).to.deep.equal({ path: '/test/repo' });
      expect(result.success).to.be.true;
    });

    it('succeeds even when no revert is in progress', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await abortRevert({ path: '/test/repo' });
      expect(result.success).to.be.true;
    });
  });
});

describe('git.service - Reset operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    mockInvoke = () => Promise.resolve({ success: true, data: null });
  });

  describe('reset', () => {
    it('invokes reset with soft mode', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await reset({ path: '/test/repo', target_ref: 'abc123', mode: 'soft' });
      expect(lastInvokedCommand).to.equal('reset');
      expect(lastInvokedArgs).to.deep.equal({
        path: '/test/repo',
        target_ref: 'abc123',
        mode: 'soft',
      });
      expect(result.success).to.be.true;
    });

    it('invokes reset with mixed mode', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await reset({ path: '/test/repo', target_ref: 'def456', mode: 'mixed' });
      expect(lastInvokedCommand).to.equal('reset');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.mode).to.equal('mixed');
      expect(result.success).to.be.true;
    });

    it('invokes reset with hard mode', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await reset({ path: '/test/repo', target_ref: 'ghi789', mode: 'hard' });
      expect(lastInvokedCommand).to.equal('reset');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.mode).to.equal('hard');
      expect(result.success).to.be.true;
    });

    it('supports branch name as target_ref', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await reset({ path: '/test/repo', target_ref: 'main', mode: 'soft' });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.target_ref).to.equal('main');
      expect(result.success).to.be.true;
    });

    it('supports HEAD~N notation as target_ref', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await reset({ path: '/test/repo', target_ref: 'HEAD~3', mode: 'mixed' });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.target_ref).to.equal('HEAD~3');
      expect(result.success).to.be.true;
    });

    it('handles commit not found error', async () => {
      mockInvoke = () => Promise.reject({ code: 'COMMIT_NOT_FOUND', message: 'Target not found' });

      const result = await reset({ path: '/test/repo', target_ref: 'nonexistent', mode: 'soft' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('COMMIT_NOT_FOUND');
    });

    it('handles operation in progress error', async () => {
      mockInvoke = () => Promise.reject({ code: 'OPERATION_FAILED', message: 'Another operation is in progress' });

      const result = await reset({ path: '/test/repo', target_ref: 'abc123', mode: 'hard' });
      expect(result.success).to.be.false;
    });
  });
});

describe('git.service - Cherry-pick from branch operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    mockInvoke = () => Promise.resolve({ success: true, data: null });
  });

  describe('cherryPickFromBranch', () => {
    it('invokes cherry_pick_from_branch with branch name and default count', async () => {
      const mockCommits = [{ oid: 'new1', summary: 'Feature commit' }];
      mockInvoke = () => Promise.resolve(mockCommits);

      const result = await cherryPickFromBranch({ path: '/test/repo', branch: 'feature' });
      expect(lastInvokedCommand).to.equal('cherry_pick_from_branch');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.branch).to.equal('feature');
      expect(args.count).to.be.undefined;
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal(mockCommits);
    });

    it('invokes cherry_pick_from_branch with explicit count', async () => {
      const mockCommits = [
        { oid: 'new1', summary: 'commit 1' },
        { oid: 'new2', summary: 'commit 2' },
        { oid: 'new3', summary: 'commit 3' },
      ];
      mockInvoke = () => Promise.resolve(mockCommits);

      const result = await cherryPickFromBranch({ path: '/test/repo', branch: 'feature', count: 3 });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.count).to.equal(3);
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(3);
    });

    it('handles branch not found error', async () => {
      mockInvoke = () => Promise.reject({ code: 'BRANCH_NOT_FOUND', message: 'Branch not found' });

      const result = await cherryPickFromBranch({ path: '/test/repo', branch: 'nonexistent' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('BRANCH_NOT_FOUND');
    });

    it('handles cherry-pick conflict during branch pick', async () => {
      mockInvoke = () => Promise.reject({ code: 'CHERRY_PICK_CONFLICT', message: 'Conflict detected' });

      const result = await cherryPickFromBranch({ path: '/test/repo', branch: 'conflicting' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('CHERRY_PICK_CONFLICT');
    });

    it('handles operation in progress error', async () => {
      mockInvoke = () => Promise.reject({ code: 'CHERRY_PICK_IN_PROGRESS', message: 'Cherry-pick already in progress' });

      const result = await cherryPickFromBranch({ path: '/test/repo', branch: 'feature' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('CHERRY_PICK_IN_PROGRESS');
    });
  });
});
