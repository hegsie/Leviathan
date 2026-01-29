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
  getHooks,
  getHook,
  saveHook,
  deleteHook,
  toggleHook,
  type GitHook,
} from '../git.service.ts';

describe('git.service - Git Hooks management', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getHooks', () => {
    it('invokes get_hooks command', async () => {
      const mockHooks: GitHook[] = [
        {
          name: 'pre-commit',
          path: '/test/.git/hooks/pre-commit',
          exists: true,
          enabled: true,
          content: '#!/bin/sh\nexit 0',
          description: 'Run before a commit is created.',
        },
        {
          name: 'commit-msg',
          path: '/test/.git/hooks/commit-msg',
          exists: false,
          enabled: false,
          content: null,
          description: 'Run after the commit message is entered.',
        },
      ];
      mockInvoke = () => Promise.resolve(mockHooks);

      const result = await getHooks('/test/repo');
      expect(lastInvokedCommand).to.equal('get_hooks');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
    });

    it('lists all known hook types', async () => {
      const mockHooks: GitHook[] = [
        'pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit',
        'pre-rebase', 'post-checkout', 'post-merge', 'pre-push',
      ].map(name => ({
        name,
        path: `/test/.git/hooks/${name}`,
        exists: false,
        enabled: false,
        content: null,
        description: '',
      }));
      mockInvoke = () => Promise.resolve(mockHooks);

      const result = await getHooks('/test/repo');
      expect(result.data?.length).to.be.at.least(8);
    });
  });

  describe('getHook', () => {
    it('invokes get_hook command for specific hook', async () => {
      const mockHook: GitHook = {
        name: 'pre-commit',
        path: '/test/.git/hooks/pre-commit',
        exists: true,
        enabled: true,
        content: '#!/bin/sh\nnpm run lint',
        description: 'Run before a commit is created.',
      };
      mockInvoke = () => Promise.resolve(mockHook);

      const result = await getHook('/test/repo', 'pre-commit');
      expect(lastInvokedCommand).to.equal('get_hook');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.name).to.equal('pre-commit');
      expect(result.data?.exists).to.be.true;
      expect(result.data?.content).to.include('npm run lint');
    });

    it('returns non-existent hook info', async () => {
      mockInvoke = () =>
        Promise.resolve({
          name: 'pre-push',
          path: '/test/.git/hooks/pre-push',
          exists: false,
          enabled: false,
          content: null,
          description: 'Run before push.',
        });

      const result = await getHook('/test/repo', 'pre-push');
      expect(result.data?.exists).to.be.false;
      expect(result.data?.content).to.be.null;
    });
  });

  describe('saveHook', () => {
    it('invokes save_hook command', async () => {
      mockInvoke = () => Promise.resolve(null);
      const script = '#!/bin/sh\nnpm run test\nexit $?';

      const result = await saveHook('/test/repo', 'pre-commit', script);
      expect(lastInvokedCommand).to.equal('save_hook');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.name).to.equal('pre-commit');
      expect(args.content).to.equal(script);
      expect(result.success).to.be.true;
    });
  });

  describe('deleteHook', () => {
    it('invokes delete_hook command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await deleteHook('/test/repo', 'pre-commit');
      expect(lastInvokedCommand).to.equal('delete_hook');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.name).to.equal('pre-commit');
      expect(result.success).to.be.true;
    });
  });

  describe('toggleHook', () => {
    it('invokes toggle_hook to disable', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await toggleHook('/test/repo', 'pre-commit', false);
      expect(lastInvokedCommand).to.equal('toggle_hook');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.name).to.equal('pre-commit');
      expect(args.enabled).to.be.false;
      expect(result.success).to.be.true;
    });

    it('invokes toggle_hook to enable', async () => {
      mockInvoke = () => Promise.resolve(null);

      await toggleHook('/test/repo', 'pre-commit', true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.enabled).to.be.true;
    });
  });
});
