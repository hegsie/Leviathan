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

import { createCommit } from '../git.service.ts';

describe('git.service - Commit operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    mockInvoke = () => Promise.resolve(null);
  });

  describe('createCommit', () => {
    it('invokes create_commit with message', async () => {
      const mockCommit = {
        oid: 'abc123',
        shortId: 'abc1234',
        message: 'Test commit',
        summary: 'Test commit',
        body: null,
        author: { name: 'Test', email: 'test@test.com', timestamp: 1700000000 },
        committer: { name: 'Test', email: 'test@test.com', timestamp: 1700000000 },
        parentIds: [],
        timestamp: 1700000000,
      };
      mockInvoke = () => Promise.resolve(mockCommit);

      const result = await createCommit('/test/repo', { message: 'Test commit' });
      expect(lastInvokedCommand).to.equal('create_commit');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.message).to.equal('Test commit');
      expect(result.success).to.be.true;
    });

    it('passes allowEmpty option', async () => {
      const mockCommit = {
        oid: 'def456',
        shortId: 'def4567',
        message: 'Empty commit',
        summary: 'Empty commit',
        body: null,
        author: { name: 'Test', email: 'test@test.com', timestamp: 1700000000 },
        committer: { name: 'Test', email: 'test@test.com', timestamp: 1700000000 },
        parentIds: ['abc123'],
        timestamp: 1700000000,
      };
      mockInvoke = () => Promise.resolve(mockCommit);

      const result = await createCommit('/test/repo', {
        message: 'Empty commit',
        allowEmpty: true,
      });
      expect(lastInvokedCommand).to.equal('create_commit');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.allowEmpty).to.be.true;
      expect(result.success).to.be.true;
    });

    it('passes signCommit option', async () => {
      const mockCommit = {
        oid: 'ghi789',
        shortId: 'ghi7890',
        message: 'Signed commit',
        summary: 'Signed commit',
        body: null,
        author: { name: 'Test', email: 'test@test.com', timestamp: 1700000000 },
        committer: { name: 'Test', email: 'test@test.com', timestamp: 1700000000 },
        parentIds: ['abc123'],
        timestamp: 1700000000,
      };
      mockInvoke = () => Promise.resolve(mockCommit);

      const result = await createCommit('/test/repo', {
        message: 'Signed commit',
        signCommit: true,
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.signCommit).to.be.true;
      expect(result.success).to.be.true;
    });

    it('passes amend option', async () => {
      const mockCommit = {
        oid: 'jkl012',
        shortId: 'jkl0123',
        message: 'Amended commit',
        summary: 'Amended commit',
        body: null,
        author: { name: 'Test', email: 'test@test.com', timestamp: 1700000000 },
        committer: { name: 'Test', email: 'test@test.com', timestamp: 1700000000 },
        parentIds: [],
        timestamp: 1700000000,
      };
      mockInvoke = () => Promise.resolve(mockCommit);

      const result = await createCommit('/test/repo', {
        message: 'Amended commit',
        amend: true,
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.amend).to.be.true;
      expect(result.success).to.be.true;
    });

    it('handles commit error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Nothing to commit' });

      const result = await createCommit('/test/repo', { message: 'Will fail' });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('OPERATION_FAILED');
    });
  });
});
