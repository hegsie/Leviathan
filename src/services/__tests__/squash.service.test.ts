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

import { squashCommits, fixupCommit } from '../git.service.ts';

describe('git.service - Squash operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    mockInvoke = () => Promise.resolve({ success: true, data: null });
  });

  describe('squashCommits', () => {
    it('invokes squash_commits with correct parameters', async () => {
      const mockResult = {
        newOid: 'squashed123',
        squashedCount: 3,
        success: true,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await squashCommits(
        '/test/repo',
        'from123',
        'to456',
        'Squashed commit message'
      );

      expect(lastInvokedCommand).to.equal('squash_commits');
      expect(lastInvokedArgs).to.deep.equal({
        path: '/test/repo',
        fromOid: 'from123',
        toOid: 'to456',
        message: 'Squashed commit message',
      });
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal(mockResult);
    });

    it('handles successful squash of 2 commits', async () => {
      const mockResult = {
        newOid: 'new789',
        squashedCount: 2,
        success: true,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await squashCommits(
        '/test/repo',
        'parent',
        'head',
        'Combined changes'
      );

      expect(result.success).to.be.true;
      expect(result.data?.squashedCount).to.equal(2);
    });

    it('handles empty range error', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: 'No commits found in the specified range',
        });

      const result = await squashCommits(
        '/test/repo',
        'same',
        'same',
        'Should fail'
      );

      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('OPERATION_FAILED');
    });

    it('handles commit not found error for from_oid', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'COMMIT_NOT_FOUND',
          message: 'Commit not found: invalid-from',
        });

      const result = await squashCommits(
        '/test/repo',
        'invalid-from',
        'valid-to',
        'Should fail'
      );

      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('COMMIT_NOT_FOUND');
    });

    it('handles commit not found error for to_oid', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'COMMIT_NOT_FOUND',
          message: 'Commit not found: invalid-to',
        });

      const result = await squashCommits(
        '/test/repo',
        'valid-from',
        'invalid-to',
        'Should fail'
      );

      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('COMMIT_NOT_FOUND');
    });

    it('handles uncommitted changes error', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: 'Working directory has uncommitted changes',
        });

      const result = await squashCommits(
        '/test/repo',
        'from',
        'to',
        'Should fail'
      );

      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('uncommitted changes');
    });

    it('handles operation in progress error', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: 'Another operation is in progress',
        });

      const result = await squashCommits(
        '/test/repo',
        'from',
        'to',
        'Should fail'
      );

      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('operation is in progress');
    });
  });

  describe('fixupCommit', () => {
    it('invokes fixup_commit with correct parameters (no message)', async () => {
      const mockResult = {
        newOid: 'fixedup123',
        squashedCount: 1,
        success: true,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await fixupCommit('/test/repo', 'target456');

      expect(lastInvokedCommand).to.equal('fixup_commit');
      expect(lastInvokedArgs).to.deep.equal({
        path: '/test/repo',
        targetOid: 'target456',
        amendMessage: undefined,
      });
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal(mockResult);
    });

    it('invokes fixup_commit with amend message', async () => {
      const mockResult = {
        newOid: 'fixedup789',
        squashedCount: 1,
        success: true,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await fixupCommit(
        '/test/repo',
        'target456',
        'Updated commit message'
      );

      expect(lastInvokedCommand).to.equal('fixup_commit');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.amendMessage).to.equal('Updated commit message');
      expect(result.success).to.be.true;
    });

    it('handles no staged changes error', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: 'No staged changes to fixup',
        });

      const result = await fixupCommit('/test/repo', 'target');

      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('No staged changes');
    });

    it('handles target not an ancestor error', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: 'Target commit is not an ancestor of HEAD',
        });

      const result = await fixupCommit('/test/repo', 'not-ancestor');

      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('not an ancestor');
    });

    it('handles commit not found error', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'COMMIT_NOT_FOUND',
          message: 'Commit not found: invalid',
        });

      const result = await fixupCommit('/test/repo', 'invalid');

      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('COMMIT_NOT_FOUND');
    });

    it('handles conflict during replay error', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: 'Conflict while replaying commit abc123',
        });

      const result = await fixupCommit('/test/repo', 'target');

      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('Conflict while replaying');
    });

    it('handles operation in progress error', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: 'Another operation is in progress',
        });

      const result = await fixupCommit('/test/repo', 'target');

      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('operation is in progress');
    });
  });
});
