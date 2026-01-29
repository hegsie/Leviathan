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
  getWorktrees,
  addWorktree,
  removeWorktree,
  pruneWorktrees,
  lockWorktree,
  unlockWorktree,
  type Worktree,
} from '../git.service.ts';

describe('git.service - Worktree operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getWorktrees', () => {
    it('invokes get_worktrees command', async () => {
      const mockWorktrees: Worktree[] = [
        {
          path: '/test/repo',
          headOid: 'abc123',
          branch: 'main',
          isMain: true,
          isLocked: false,
          lockReason: null,
          isBare: false,
          isPrunable: false,
        },
      ];
      mockInvoke = () => Promise.resolve(mockWorktrees);

      const result = await getWorktrees('/test/repo');
      expect(lastInvokedCommand).to.equal('get_worktrees');
      expect(result.success).to.be.true;
      expect(result.data).to.have.length(1);
    });

    it('passes the correct path argument', async () => {
      mockInvoke = () => Promise.resolve([]);

      await getWorktrees('/my/repo/path');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo/path');
    });

    it('returns worktree details correctly', async () => {
      const mockWorktrees: Worktree[] = [
        {
          path: '/test/repo',
          headOid: 'abc123',
          branch: 'main',
          isMain: true,
          isLocked: false,
          lockReason: null,
          isBare: false,
          isPrunable: false,
        },
        {
          path: '/test/repo-feature',
          headOid: 'def456',
          branch: 'feature/new-feature',
          isMain: false,
          isLocked: false,
          lockReason: null,
          isBare: false,
          isPrunable: false,
        },
      ];
      mockInvoke = () => Promise.resolve(mockWorktrees);

      const result = await getWorktrees('/test/repo');
      expect(result.data?.[0].isMain).to.be.true;
      expect(result.data?.[0].branch).to.equal('main');
      expect(result.data?.[1].isMain).to.be.false;
      expect(result.data?.[1].branch).to.equal('feature/new-feature');
    });

    it('returns locked worktrees with lock reason', async () => {
      const mockWorktrees: Worktree[] = [
        {
          path: '/test/repo-locked',
          headOid: 'xyz789',
          branch: 'hotfix/critical',
          isMain: false,
          isLocked: true,
          lockReason: 'In progress - do not remove',
          isBare: false,
          isPrunable: false,
        },
      ];
      mockInvoke = () => Promise.resolve(mockWorktrees);

      const result = await getWorktrees('/test/repo');
      expect(result.data?.[0].isLocked).to.be.true;
      expect(result.data?.[0].lockReason).to.equal('In progress - do not remove');
    });

    it('returns prunable worktrees', async () => {
      const mockWorktrees: Worktree[] = [
        {
          path: '/test/repo-stale',
          headOid: null,
          branch: null,
          isMain: false,
          isLocked: false,
          lockReason: null,
          isBare: false,
          isPrunable: true,
        },
      ];
      mockInvoke = () => Promise.resolve(mockWorktrees);

      const result = await getWorktrees('/test/repo');
      expect(result.data?.[0].isPrunable).to.be.true;
    });
  });

  describe('addWorktree', () => {
    it('invokes add_worktree command', async () => {
      const mockWorktree: Worktree = {
        path: '/test/repo-feature',
        headOid: 'abc123',
        branch: 'feature/new-feature',
        isMain: false,
        isLocked: false,
        lockReason: null,
        isBare: false,
        isPrunable: false,
      };
      mockInvoke = () => Promise.resolve(mockWorktree);

      const result = await addWorktree('/test/repo', '/test/repo-feature');
      expect(lastInvokedCommand).to.equal('add_worktree');
      expect(result.success).to.be.true;
    });

    it('passes the correct path and worktreePath arguments', async () => {
      mockInvoke = () =>
        Promise.resolve({
          path: '/new/worktree',
          headOid: null,
          branch: null,
          isMain: false,
          isLocked: false,
          lockReason: null,
          isBare: false,
          isPrunable: false,
        });

      await addWorktree('/my/repo', '/new/worktree');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo');
      expect(args.worktreePath).to.equal('/new/worktree');
    });

    it('passes branch option when provided', async () => {
      mockInvoke = () =>
        Promise.resolve({
          path: '/test/worktree',
          headOid: 'abc123',
          branch: 'develop',
          isMain: false,
          isLocked: false,
          lockReason: null,
          isBare: false,
          isPrunable: false,
        });

      await addWorktree('/test/repo', '/test/worktree', { branch: 'develop' });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.branch).to.equal('develop');
    });

    it('passes newBranch option when provided', async () => {
      mockInvoke = () =>
        Promise.resolve({
          path: '/test/worktree',
          headOid: 'abc123',
          branch: 'feature/new-branch',
          isMain: false,
          isLocked: false,
          lockReason: null,
          isBare: false,
          isPrunable: false,
        });

      await addWorktree('/test/repo', '/test/worktree', { newBranch: 'feature/new-branch' });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.newBranch).to.equal('feature/new-branch');
    });

    it('passes commit option when provided', async () => {
      mockInvoke = () =>
        Promise.resolve({
          path: '/test/worktree',
          headOid: 'abc123def',
          branch: null,
          isMain: false,
          isLocked: false,
          lockReason: null,
          isBare: false,
          isPrunable: false,
        });

      await addWorktree('/test/repo', '/test/worktree', { commit: 'abc123def' });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.commit).to.equal('abc123def');
    });

    it('passes force option when provided', async () => {
      mockInvoke = () =>
        Promise.resolve({
          path: '/test/worktree',
          headOid: 'abc123',
          branch: 'main',
          isMain: false,
          isLocked: false,
          lockReason: null,
          isBare: false,
          isPrunable: false,
        });

      await addWorktree('/test/repo', '/test/worktree', { force: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.force).to.be.true;
    });

    it('passes detach option when provided', async () => {
      mockInvoke = () =>
        Promise.resolve({
          path: '/test/worktree',
          headOid: 'abc123',
          branch: null,
          isMain: false,
          isLocked: false,
          lockReason: null,
          isBare: false,
          isPrunable: false,
        });

      await addWorktree('/test/repo', '/test/worktree', { detach: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.detach).to.be.true;
    });

    it('passes all options together', async () => {
      mockInvoke = () =>
        Promise.resolve({
          path: '/test/worktree',
          headOid: 'abc123',
          branch: 'feature/x',
          isMain: false,
          isLocked: false,
          lockReason: null,
          isBare: false,
          isPrunable: false,
        });

      await addWorktree('/test/repo', '/test/worktree', {
        branch: 'main',
        newBranch: 'feature/x',
        commit: 'abc123',
        force: true,
        detach: false,
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.branch).to.equal('main');
      expect(args.newBranch).to.equal('feature/x');
      expect(args.commit).to.equal('abc123');
      expect(args.force).to.be.true;
      expect(args.detach).to.be.false;
    });

    it('returns the created worktree', async () => {
      const mockWorktree: Worktree = {
        path: '/test/new-worktree',
        headOid: 'xyz789',
        branch: 'release/1.0',
        isMain: false,
        isLocked: false,
        lockReason: null,
        isBare: false,
        isPrunable: false,
      };
      mockInvoke = () => Promise.resolve(mockWorktree);

      const result = await addWorktree('/test/repo', '/test/new-worktree', {
        branch: 'release/1.0',
      });
      expect(result.data?.path).to.equal('/test/new-worktree');
      expect(result.data?.branch).to.equal('release/1.0');
    });

    it('handles error when path already exists', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Path already exists' });

      const result = await addWorktree('/test/repo', '/existing/path');
      expect(result.success).to.be.false;
    });
  });

  describe('removeWorktree', () => {
    it('invokes remove_worktree command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await removeWorktree('/test/repo', '/test/old-worktree');
      expect(lastInvokedCommand).to.equal('remove_worktree');
      expect(result.success).to.be.true;
    });

    it('passes the correct path and worktreePath arguments', async () => {
      mockInvoke = () => Promise.resolve(null);

      await removeWorktree('/my/repo', '/my/worktree');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo');
      expect(args.worktreePath).to.equal('/my/worktree');
    });

    it('passes force option when provided', async () => {
      mockInvoke = () => Promise.resolve(null);

      await removeWorktree('/test/repo', '/test/dirty-worktree', true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.force).to.be.true;
    });

    it('removes without force by default', async () => {
      mockInvoke = () => Promise.resolve(null);

      await removeWorktree('/test/repo', '/test/clean-worktree');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.force).to.be.undefined;
    });

    it('handles error when worktree has uncommitted changes', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Worktree has uncommitted changes' });

      const result = await removeWorktree('/test/repo', '/test/dirty-worktree');
      expect(result.success).to.be.false;
    });

    it('handles error when worktree is locked', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Worktree is locked' });

      const result = await removeWorktree('/test/repo', '/test/locked-worktree');
      expect(result.success).to.be.false;
    });
  });

  describe('pruneWorktrees', () => {
    it('invokes prune_worktrees command', async () => {
      mockInvoke = () => Promise.resolve('Pruned 2 worktrees');

      const result = await pruneWorktrees('/test/repo');
      expect(lastInvokedCommand).to.equal('prune_worktrees');
      expect(result.success).to.be.true;
    });

    it('passes the correct path argument', async () => {
      mockInvoke = () => Promise.resolve('');

      await pruneWorktrees('/my/repo/path');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo/path');
    });

    it('passes dryRun option when provided', async () => {
      mockInvoke = () => Promise.resolve('Would prune 3 worktrees');

      await pruneWorktrees('/test/repo', true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.dryRun).to.be.true;
    });

    it('passes dryRun as false when explicitly set', async () => {
      mockInvoke = () => Promise.resolve('Pruned 1 worktree');

      await pruneWorktrees('/test/repo', false);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.dryRun).to.be.false;
    });

    it('returns output message on success', async () => {
      mockInvoke = () => Promise.resolve('Pruned 5 stale worktree entries');

      const result = await pruneWorktrees('/test/repo');
      expect(result.data).to.equal('Pruned 5 stale worktree entries');
    });

    it('returns dry run message', async () => {
      mockInvoke = () => Promise.resolve('Would prune 2 worktrees:\n/old/worktree1\n/old/worktree2');

      const result = await pruneWorktrees('/test/repo', true);
      expect(result.data).to.include('Would prune');
    });

    it('handles error when prune fails', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Prune operation failed' });

      const result = await pruneWorktrees('/test/repo');
      expect(result.success).to.be.false;
    });
  });

  describe('lockWorktree', () => {
    it('invokes lock_worktree command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await lockWorktree('/test/repo', '/test/worktree');
      expect(lastInvokedCommand).to.equal('lock_worktree');
      expect(result.success).to.be.true;
    });

    it('passes the correct path and worktreePath arguments', async () => {
      mockInvoke = () => Promise.resolve(null);

      await lockWorktree('/my/repo', '/my/worktree');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo');
      expect(args.worktreePath).to.equal('/my/worktree');
    });

    it('passes reason when provided', async () => {
      mockInvoke = () => Promise.resolve(null);

      await lockWorktree('/test/repo', '/test/worktree', 'Work in progress');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.reason).to.equal('Work in progress');
    });

    it('locks without reason when not provided', async () => {
      mockInvoke = () => Promise.resolve(null);

      await lockWorktree('/test/repo', '/test/worktree');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.reason).to.be.undefined;
    });

    it('handles error when worktree is already locked', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Worktree is already locked' });

      const result = await lockWorktree('/test/repo', '/test/locked-worktree');
      expect(result.success).to.be.false;
    });

    it('handles error when worktree does not exist', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Worktree not found' });

      const result = await lockWorktree('/test/repo', '/nonexistent/worktree');
      expect(result.success).to.be.false;
    });
  });

  describe('unlockWorktree', () => {
    it('invokes unlock_worktree command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await unlockWorktree('/test/repo', '/test/worktree');
      expect(lastInvokedCommand).to.equal('unlock_worktree');
      expect(result.success).to.be.true;
    });

    it('passes the correct path and worktreePath arguments', async () => {
      mockInvoke = () => Promise.resolve(null);

      await unlockWorktree('/my/repo', '/my/worktree');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo');
      expect(args.worktreePath).to.equal('/my/worktree');
    });

    it('handles error when worktree is not locked', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Worktree is not locked' });

      const result = await unlockWorktree('/test/repo', '/test/unlocked-worktree');
      expect(result.success).to.be.false;
    });

    it('handles error when worktree does not exist', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Worktree not found' });

      const result = await unlockWorktree('/test/repo', '/nonexistent/worktree');
      expect(result.success).to.be.false;
    });
  });
});
