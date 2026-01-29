import { expect } from '@open-wc/testing';

// Mock Tauri API
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
let lastInvokedCommand: string | null = null;
let lastInvokedArgs: unknown = null;
const invokeHistory: Array<{ command: string; args: unknown }> = [];

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    lastInvokedCommand = command;
    lastInvokedArgs = args;
    invokeHistory.push({ command, args });
    return mockInvoke(command, args);
  },
};

import { getReflog, resetToReflog } from '../git.service.ts';
import type { ReflogEntry } from '../../types/git.types.ts';

describe('git.service - Reflog operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    invokeHistory.length = 0;
  });

  describe('getReflog', () => {
    it('invokes get_reflog command with path', async () => {
      const mockEntries: ReflogEntry[] = [
        {
          oid: 'abc123def456',
          shortId: 'abc123d',
          index: 0,
          action: 'commit',
          message: 'HEAD@{0}: commit: Add new feature',
          timestamp: 1706400000,
          author: 'Test User',
        },
      ];
      mockInvoke = () => Promise.resolve(mockEntries);

      await getReflog('/test/repo');
      expect(lastInvokedCommand).to.equal('get_reflog');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
    });

    it('returns reflog entries', async () => {
      const mockEntries: ReflogEntry[] = [
        {
          oid: 'abc123def456',
          shortId: 'abc123d',
          index: 0,
          action: 'commit',
          message: 'HEAD@{0}: commit: Add new feature',
          timestamp: 1706400000,
          author: 'Test User',
        },
        {
          oid: 'def456abc123',
          shortId: 'def456a',
          index: 1,
          action: 'checkout',
          message: 'HEAD@{1}: checkout: moving from main to feature',
          timestamp: 1706390000,
          author: 'Test User',
        },
        {
          oid: '789012345678',
          shortId: '7890123',
          index: 2,
          action: 'commit',
          message: 'HEAD@{2}: commit: Initial commit',
          timestamp: 1706380000,
          author: 'Test User',
        },
      ];
      mockInvoke = () => Promise.resolve(mockEntries);

      const result = await getReflog('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(3);
      expect(result.data?.[0].action).to.equal('commit');
      expect(result.data?.[1].action).to.equal('checkout');
    });

    it('supports limit parameter', async () => {
      const mockEntries: ReflogEntry[] = [
        {
          oid: 'abc123def456',
          shortId: 'abc123d',
          index: 0,
          action: 'commit',
          message: 'HEAD@{0}: commit: Recent commit',
          timestamp: 1706400000,
          author: 'Test User',
        },
      ];
      mockInvoke = () => Promise.resolve(mockEntries);

      await getReflog('/test/repo', 10);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.limit).to.equal(10);
    });

    it('returns correct reflog entry properties', async () => {
      const mockEntry: ReflogEntry = {
        oid: 'abc123def456789012345678901234567890abcd',
        shortId: 'abc123d',
        index: 0,
        action: 'reset',
        message: 'HEAD@{0}: reset: moving to HEAD~1',
        timestamp: 1706400000,
        author: 'Jane Doe',
      };
      mockInvoke = () => Promise.resolve([mockEntry]);

      const result = await getReflog('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.[0].oid).to.equal('abc123def456789012345678901234567890abcd');
      expect(result.data?.[0].shortId).to.equal('abc123d');
      expect(result.data?.[0].index).to.equal(0);
      expect(result.data?.[0].action).to.equal('reset');
      expect(result.data?.[0].message).to.include('reset: moving to HEAD~1');
      expect(result.data?.[0].timestamp).to.equal(1706400000);
      expect(result.data?.[0].author).to.equal('Jane Doe');
    });

    it('returns empty array for fresh repository', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getReflog('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('handles various reflog actions', async () => {
      const mockEntries: ReflogEntry[] = [
        {
          oid: 'abc123',
          shortId: 'abc123',
          index: 0,
          action: 'commit',
          message: 'HEAD@{0}: commit: Add feature',
          timestamp: 1706400000,
          author: 'User',
        },
        {
          oid: 'def456',
          shortId: 'def456',
          index: 1,
          action: 'checkout',
          message: 'HEAD@{1}: checkout: moving from main to develop',
          timestamp: 1706390000,
          author: 'User',
        },
        {
          oid: 'ghi789',
          shortId: 'ghi789',
          index: 2,
          action: 'merge',
          message: 'HEAD@{2}: merge feature: Fast-forward',
          timestamp: 1706380000,
          author: 'User',
        },
        {
          oid: 'jkl012',
          shortId: 'jkl012',
          index: 3,
          action: 'rebase',
          message: 'HEAD@{3}: rebase (finish): refs/heads/main onto abc123',
          timestamp: 1706370000,
          author: 'User',
        },
        {
          oid: 'mno345',
          shortId: 'mno345',
          index: 4,
          action: 'pull',
          message: 'HEAD@{4}: pull: Fast-forward',
          timestamp: 1706360000,
          author: 'User',
        },
      ];
      mockInvoke = () => Promise.resolve(mockEntries);

      const result = await getReflog('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.[0].action).to.equal('commit');
      expect(result.data?.[1].action).to.equal('checkout');
      expect(result.data?.[2].action).to.equal('merge');
      expect(result.data?.[3].action).to.equal('rebase');
      expect(result.data?.[4].action).to.equal('pull');
    });

    it('handles error when repository not found', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REPO_NOT_FOUND', message: 'Repository not found' });

      const result = await getReflog('/invalid/path');
      expect(result.success).to.be.false;
    });

    it('handles error for corrupted reflog', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REFLOG_ERROR', message: 'Reflog corrupted or unreadable' });

      const result = await getReflog('/test/repo');
      expect(result.success).to.be.false;
    });
  });

  describe('resetToReflog', () => {
    it('invokes reset_to_reflog command with default mode (mixed)', async () => {
      const mockEntry: ReflogEntry = {
        oid: 'abc123def456',
        shortId: 'abc123d',
        index: 3,
        action: 'commit',
        message: 'HEAD@{3}: commit: Previous state',
        timestamp: 1706380000,
        author: 'Test User',
      };
      mockInvoke = () => Promise.resolve(mockEntry);

      await resetToReflog('/test/repo', 3);
      expect(lastInvokedCommand).to.equal('reset_to_reflog');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.reflogIndex).to.equal(3);
      expect(args.mode).to.equal('mixed');
    });

    it('supports soft reset mode', async () => {
      const mockEntry: ReflogEntry = {
        oid: 'abc123def456',
        shortId: 'abc123d',
        index: 2,
        action: 'commit',
        message: 'HEAD@{2}: commit: Some commit',
        timestamp: 1706390000,
        author: 'Test User',
      };
      mockInvoke = () => Promise.resolve(mockEntry);

      await resetToReflog('/test/repo', 2, 'soft');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.mode).to.equal('soft');
    });

    it('supports mixed reset mode', async () => {
      const mockEntry: ReflogEntry = {
        oid: 'def456abc123',
        shortId: 'def456a',
        index: 1,
        action: 'checkout',
        message: 'HEAD@{1}: checkout: switching branches',
        timestamp: 1706395000,
        author: 'Test User',
      };
      mockInvoke = () => Promise.resolve(mockEntry);

      await resetToReflog('/test/repo', 1, 'mixed');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.mode).to.equal('mixed');
    });

    it('supports hard reset mode', async () => {
      const mockEntry: ReflogEntry = {
        oid: 'ghi789jkl012',
        shortId: 'ghi789j',
        index: 5,
        action: 'merge',
        message: 'HEAD@{5}: merge: before merge',
        timestamp: 1706370000,
        author: 'Test User',
      };
      mockInvoke = () => Promise.resolve(mockEntry);

      await resetToReflog('/test/repo', 5, 'hard');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.mode).to.equal('hard');
    });

    it('returns the reflog entry after reset', async () => {
      const mockEntry: ReflogEntry = {
        oid: 'abc123def456',
        shortId: 'abc123d',
        index: 4,
        action: 'commit',
        message: 'HEAD@{4}: commit: Target state',
        timestamp: 1706375000,
        author: 'Test User',
      };
      mockInvoke = () => Promise.resolve(mockEntry);

      const result = await resetToReflog('/test/repo', 4, 'soft');
      expect(result.success).to.be.true;
      expect(result.data?.oid).to.equal('abc123def456');
      expect(result.data?.index).to.equal(4);
    });

    it('handles reset to index 0 (most recent)', async () => {
      const mockEntry: ReflogEntry = {
        oid: 'current123',
        shortId: 'current',
        index: 0,
        action: 'commit',
        message: 'HEAD@{0}: commit: Latest commit',
        timestamp: 1706400000,
        author: 'Test User',
      };
      mockInvoke = () => Promise.resolve(mockEntry);

      const result = await resetToReflog('/test/repo', 0);
      expect(result.success).to.be.true;
      expect(result.data?.index).to.equal(0);
    });

    it('handles reset to older reflog entry', async () => {
      const mockEntry: ReflogEntry = {
        oid: 'older123456',
        shortId: 'older12',
        index: 100,
        action: 'commit',
        message: 'HEAD@{100}: commit: Very old commit',
        timestamp: 1700000000,
        author: 'Test User',
      };
      mockInvoke = () => Promise.resolve(mockEntry);

      const result = await resetToReflog('/test/repo', 100, 'hard');
      expect(result.success).to.be.true;
      expect(result.data?.index).to.equal(100);
    });

    it('handles error for invalid reflog index', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'INVALID_REFLOG_INDEX', message: 'Reflog index out of range' });

      const result = await resetToReflog('/test/repo', 999);
      expect(result.success).to.be.false;
    });

    it('handles error when repository is in conflicted state', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'CONFLICT', message: 'Cannot reset with conflicts present' });

      const result = await resetToReflog('/test/repo', 3, 'hard');
      expect(result.success).to.be.false;
    });

    it('handles error for repository not found', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REPO_NOT_FOUND', message: 'Repository not found' });

      const result = await resetToReflog('/invalid/path', 1);
      expect(result.success).to.be.false;
    });

    it('handles error when working directory is dirty (for hard reset)', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'DIRTY_WORKDIR',
          message: 'Working directory has uncommitted changes',
        });

      const result = await resetToReflog('/test/repo', 2, 'hard');
      expect(result.success).to.be.false;
    });
  });
});
