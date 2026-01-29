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

import {
  getStashes,
  createStash,
  applyStash,
  dropStash,
  popStash,
} from '../git.service.ts';
import type { Stash } from '../../types/git.types.ts';

describe('git.service - Stash operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    invokeHistory.length = 0;
  });

  describe('getStashes', () => {
    it('invokes get_stashes command', async () => {
      const mockStashes: Stash[] = [
        { index: 0, message: 'WIP on main: abc123 Initial commit', oid: 'stash0' },
        { index: 1, message: 'WIP on feature: def456 Add feature', oid: 'stash1' },
      ];
      mockInvoke = () => Promise.resolve(mockStashes);

      const result = await getStashes('/test/repo');
      expect(lastInvokedCommand).to.equal('get_stashes');
      expect((lastInvokedArgs as Record<string, unknown>).path).to.equal('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
    });

    it('returns empty array when no stashes exist', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getStashes('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('returns stashes with correct indices', async () => {
      const mockStashes: Stash[] = [
        { index: 0, message: 'Stash 0', oid: 'oid0' },
        { index: 1, message: 'Stash 1', oid: 'oid1' },
        { index: 2, message: 'Stash 2', oid: 'oid2' },
      ];
      mockInvoke = () => Promise.resolve(mockStashes);

      const result = await getStashes('/test/repo');
      expect(result.data?.[0].index).to.equal(0);
      expect(result.data?.[1].index).to.equal(1);
      expect(result.data?.[2].index).to.equal(2);
    });

    it('handles error response', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Repository not found' });

      const result = await getStashes('/nonexistent/repo');
      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('Repository not found');
    });
  });

  describe('createStash', () => {
    it('invokes create_stash command with minimal args', async () => {
      const mockStash: Stash = {
        index: 0,
        message: 'WIP on main: abc123 Current work',
        oid: 'newstash',
      };
      mockInvoke = () => Promise.resolve(mockStash);

      const result = await createStash({ path: '/test/repo' });
      expect(lastInvokedCommand).to.equal('create_stash');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.index).to.equal(0);
    });

    it('invokes create_stash with custom message', async () => {
      const mockStash: Stash = {
        index: 0,
        message: 'My custom stash message',
        oid: 'newstash',
      };
      mockInvoke = () => Promise.resolve(mockStash);

      const result = await createStash({
        path: '/test/repo',
        message: 'My custom stash message',
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.message).to.equal('My custom stash message');
      expect(result.data?.message).to.equal('My custom stash message');
    });

    it('invokes create_stash with include_untracked', async () => {
      mockInvoke = () =>
        Promise.resolve({ index: 0, message: 'WIP', oid: 'stash123' });

      await createStash({
        path: '/test/repo',
        include_untracked: true,
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.include_untracked).to.be.true;
    });

    it('invokes create_stash with all options', async () => {
      mockInvoke = () =>
        Promise.resolve({ index: 0, message: 'Custom message', oid: 'stash123' });

      await createStash({
        path: '/test/repo',
        message: 'Custom message',
        include_untracked: true,
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.message).to.equal('Custom message');
      expect(args.include_untracked).to.be.true;
    });

    it('handles error when nothing to stash', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'No local changes to save' });

      const result = await createStash({ path: '/test/repo' });
      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('No local changes');
    });
  });

  describe('applyStash', () => {
    it('invokes apply_stash command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await applyStash({ path: '/test/repo', index: 0 });
      expect(lastInvokedCommand).to.equal('apply_stash');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.index).to.equal(0);
      expect(result.success).to.be.true;
    });

    it('invokes apply_stash with specific index', async () => {
      mockInvoke = () => Promise.resolve(null);

      await applyStash({ path: '/test/repo', index: 2 });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.index).to.equal(2);
    });

    it('invokes apply_stash with drop_after option', async () => {
      mockInvoke = () => Promise.resolve(null);

      await applyStash({ path: '/test/repo', index: 0, drop_after: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.drop_after).to.be.true;
    });

    it('handles error when stash index not found', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'INVALID_ARGUMENT', message: 'Stash index out of range' });

      const result = await applyStash({ path: '/test/repo', index: 99 });
      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('out of range');
    });

    it('handles conflict during apply', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'CONFLICT', message: 'Merge conflict applying stash' });

      const result = await applyStash({ path: '/test/repo', index: 0 });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('CONFLICT');
    });
  });

  describe('dropStash', () => {
    it('invokes drop_stash command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await dropStash({ path: '/test/repo', index: 0 });
      expect(lastInvokedCommand).to.equal('drop_stash');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.index).to.equal(0);
      expect(result.success).to.be.true;
    });

    it('invokes drop_stash with specific index', async () => {
      mockInvoke = () => Promise.resolve(null);

      await dropStash({ path: '/test/repo', index: 3 });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.index).to.equal(3);
    });

    it('handles error when stash index not found', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'INVALID_ARGUMENT', message: 'Stash index out of range' });

      const result = await dropStash({ path: '/test/repo', index: 99 });
      expect(result.success).to.be.false;
    });

    it('handles error when stash is empty', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'No stash entries' });

      const result = await dropStash({ path: '/test/repo', index: 0 });
      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('No stash entries');
    });
  });

  describe('popStash', () => {
    it('invokes pop_stash command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await popStash({ path: '/test/repo', index: 0 });
      expect(lastInvokedCommand).to.equal('pop_stash');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.index).to.equal(0);
      expect(result.success).to.be.true;
    });

    it('invokes pop_stash with specific index', async () => {
      mockInvoke = () => Promise.resolve(null);

      await popStash({ path: '/test/repo', index: 1 });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.index).to.equal(1);
    });

    it('handles error when stash index not found', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'INVALID_ARGUMENT', message: 'Stash index out of range' });

      const result = await popStash({ path: '/test/repo', index: 99 });
      expect(result.success).to.be.false;
    });

    it('handles conflict during pop', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'CONFLICT', message: 'Merge conflict popping stash' });

      const result = await popStash({ path: '/test/repo', index: 0 });
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('CONFLICT');
    });

    it('handles error when stash is empty', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'No stash entries' });

      const result = await popStash({ path: '/test/repo', index: 0 });
      expect(result.success).to.be.false;
    });
  });
});
