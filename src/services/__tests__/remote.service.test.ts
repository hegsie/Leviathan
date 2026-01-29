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
  getRemotes,
  addRemote,
  removeRemote,
  renameRemote,
  setRemoteUrl,
  fetch,
  pull,
  push,
  pushToMultipleRemotes,
  startAutoFetch,
  stopAutoFetch,
  isAutoFetchRunning,
  getRemoteStatus,
  type RemoteStatus,
} from '../git.service.ts';
import type { Remote } from '../../types/git.types.ts';
import type { MultiPushResult } from '../../types/api.types.ts';

describe('git.service - Remote operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    invokeHistory.length = 0;
  });

  describe('getRemotes', () => {
    it('invokes get_remotes command', async () => {
      const mockRemotes: Remote[] = [
        { name: 'origin', url: 'https://github.com/user/repo.git', pushUrl: null },
      ];
      mockInvoke = () => Promise.resolve(mockRemotes);

      const result = await getRemotes('/test/repo');
      expect(lastInvokedCommand).to.equal('get_remotes');
      expect((lastInvokedArgs as Record<string, unknown>).path).to.equal('/test/repo');
      expect(result.success).to.be.true;
    });

    it('returns list of remotes', async () => {
      const mockRemotes: Remote[] = [
        { name: 'origin', url: 'https://github.com/user/repo.git', pushUrl: null },
        { name: 'upstream', url: 'https://github.com/original/repo.git', pushUrl: null },
      ];
      mockInvoke = () => Promise.resolve(mockRemotes);

      const result = await getRemotes('/test/repo');
      expect(result.data?.length).to.equal(2);
      expect(result.data?.[0].name).to.equal('origin');
      expect(result.data?.[1].name).to.equal('upstream');
    });

    it('returns empty array when no remotes', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getRemotes('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('handles error when repository not found', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REPO_NOT_FOUND', message: 'Repository not found' });

      const result = await getRemotes('/invalid/path');
      expect(result.success).to.be.false;
    });
  });

  describe('addRemote', () => {
    it('invokes add_remote command with correct arguments', async () => {
      const mockRemote: Remote = {
        name: 'upstream',
        url: 'https://github.com/original/repo.git',
        pushUrl: null,
      };
      mockInvoke = () => Promise.resolve(mockRemote);

      const result = await addRemote(
        '/test/repo',
        'upstream',
        'https://github.com/original/repo.git'
      );
      expect(lastInvokedCommand).to.equal('add_remote');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.name).to.equal('upstream');
      expect(args.url).to.equal('https://github.com/original/repo.git');
      expect(result.success).to.be.true;
    });

    it('returns the created remote', async () => {
      const mockRemote: Remote = {
        name: 'fork',
        url: 'https://github.com/fork/repo.git',
        pushUrl: null,
      };
      mockInvoke = () => Promise.resolve(mockRemote);

      const result = await addRemote('/test/repo', 'fork', 'https://github.com/fork/repo.git');
      expect(result.data?.name).to.equal('fork');
      expect(result.data?.url).to.equal('https://github.com/fork/repo.git');
    });

    it('handles duplicate remote name error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REMOTE_EXISTS', message: 'Remote already exists' });

      const result = await addRemote('/test/repo', 'origin', 'https://github.com/user/repo.git');
      expect(result.success).to.be.false;
    });
  });

  describe('removeRemote', () => {
    it('invokes remove_remote command with correct arguments', async () => {
      mockInvoke = () => Promise.resolve(null);

      await removeRemote('/test/repo', 'upstream');
      expect(lastInvokedCommand).to.equal('remove_remote');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.name).to.equal('upstream');
    });

    it('returns success on removal', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await removeRemote('/test/repo', 'origin');
      expect(result.success).to.be.true;
    });

    it('handles non-existent remote error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REMOTE_NOT_FOUND', message: 'Remote not found' });

      const result = await removeRemote('/test/repo', 'nonexistent');
      expect(result.success).to.be.false;
    });
  });

  describe('renameRemote', () => {
    it('invokes rename_remote command with correct arguments', async () => {
      const mockRemote: Remote = {
        name: 'new-name',
        url: 'https://github.com/user/repo.git',
        pushUrl: null,
      };
      mockInvoke = () => Promise.resolve(mockRemote);

      await renameRemote('/test/repo', 'old-name', 'new-name');
      expect(lastInvokedCommand).to.equal('rename_remote');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.oldName).to.equal('old-name');
      expect(args.newName).to.equal('new-name');
    });

    it('returns the renamed remote', async () => {
      const mockRemote: Remote = {
        name: 'upstream',
        url: 'https://github.com/original/repo.git',
        pushUrl: null,
      };
      mockInvoke = () => Promise.resolve(mockRemote);

      const result = await renameRemote('/test/repo', 'origin', 'upstream');
      expect(result.success).to.be.true;
      expect(result.data?.name).to.equal('upstream');
    });

    it('handles non-existent remote error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REMOTE_NOT_FOUND', message: 'Remote not found' });

      const result = await renameRemote('/test/repo', 'nonexistent', 'newname');
      expect(result.success).to.be.false;
    });
  });

  describe('setRemoteUrl', () => {
    it('invokes set_remote_url command with correct arguments', async () => {
      const mockRemote: Remote = {
        name: 'origin',
        url: 'https://github.com/newuser/repo.git',
        pushUrl: null,
      };
      mockInvoke = () => Promise.resolve(mockRemote);

      await setRemoteUrl('/test/repo', 'origin', 'https://github.com/newuser/repo.git');
      expect(lastInvokedCommand).to.equal('set_remote_url');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.name).to.equal('origin');
      expect(args.url).to.equal('https://github.com/newuser/repo.git');
    });

    it('supports setting push URL separately', async () => {
      const mockRemote: Remote = {
        name: 'origin',
        url: 'https://github.com/user/repo.git',
        pushUrl: 'git@github.com:user/repo.git',
      };
      mockInvoke = () => Promise.resolve(mockRemote);

      await setRemoteUrl('/test/repo', 'origin', 'git@github.com:user/repo.git', true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.push).to.be.true;
    });

    it('returns updated remote', async () => {
      const mockRemote: Remote = {
        name: 'origin',
        url: 'https://github.com/newuser/repo.git',
        pushUrl: null,
      };
      mockInvoke = () => Promise.resolve(mockRemote);

      const result = await setRemoteUrl(
        '/test/repo',
        'origin',
        'https://github.com/newuser/repo.git'
      );
      expect(result.success).to.be.true;
      expect(result.data?.url).to.equal('https://github.com/newuser/repo.git');
    });

    it('handles non-existent remote error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REMOTE_NOT_FOUND', message: 'Remote not found' });

      const result = await setRemoteUrl('/test/repo', 'nonexistent', 'https://example.com');
      expect(result.success).to.be.false;
    });
  });

  describe('fetch', () => {
    it('invokes fetch command with path', async () => {
      mockInvoke = () => Promise.resolve(null);

      await fetch({ path: '/test/repo', silent: true });
      expect(lastInvokedCommand).to.equal('fetch');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
    });

    it('supports fetching specific remote', async () => {
      mockInvoke = () => Promise.resolve(null);

      await fetch({ path: '/test/repo', remote: 'upstream', silent: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.remote).to.equal('upstream');
    });

    it('supports prune option', async () => {
      mockInvoke = () => Promise.resolve(null);

      await fetch({ path: '/test/repo', prune: true, silent: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.prune).to.be.true;
    });

    it('supports authentication token', async () => {
      mockInvoke = () => Promise.resolve(null);

      await fetch({ path: '/test/repo', token: 'ghp_test_token', silent: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.token).to.equal('ghp_test_token');
    });

    it('returns success on successful fetch', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await fetch({ path: '/test/repo', silent: true });
      expect(result.success).to.be.true;
    });

    it('handles network error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'NETWORK_ERROR', message: 'Could not connect to remote' });

      const result = await fetch({ path: '/test/repo', silent: true });
      expect(result.success).to.be.false;
    });
  });

  describe('pull', () => {
    it('invokes pull command with path', async () => {
      mockInvoke = () => Promise.resolve(null);

      await pull({ path: '/test/repo', silent: true });
      expect(lastInvokedCommand).to.equal('pull');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
    });

    it('supports specific remote and branch', async () => {
      mockInvoke = () => Promise.resolve(null);

      await pull({ path: '/test/repo', remote: 'origin', branch: 'main', silent: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.remote).to.equal('origin');
      expect(args.branch).to.equal('main');
    });

    it('supports rebase option', async () => {
      mockInvoke = () => Promise.resolve(null);

      await pull({ path: '/test/repo', rebase: true, silent: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.rebase).to.be.true;
    });

    it('supports authentication token', async () => {
      mockInvoke = () => Promise.resolve(null);

      await pull({ path: '/test/repo', token: 'ghp_test_token', silent: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.token).to.equal('ghp_test_token');
    });

    it('returns success on successful pull', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await pull({ path: '/test/repo', silent: true });
      expect(result.success).to.be.true;
    });

    it('handles merge conflict error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'MERGE_CONFLICT', message: 'Merge conflict occurred' });

      const result = await pull({ path: '/test/repo', silent: true });
      expect(result.success).to.be.false;
    });
  });

  describe('push', () => {
    it('invokes push command with path', async () => {
      mockInvoke = () => Promise.resolve(null);

      await push({ path: '/test/repo', silent: true });
      expect(lastInvokedCommand).to.equal('push');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
    });

    it('supports specific remote and branch', async () => {
      mockInvoke = () => Promise.resolve(null);

      await push({ path: '/test/repo', remote: 'origin', branch: 'feature', silent: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.remote).to.equal('origin');
      expect(args.branch).to.equal('feature');
    });

    it('supports force push option', async () => {
      mockInvoke = () => Promise.resolve(null);

      await push({ path: '/test/repo', force: true, silent: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.force).to.be.true;
    });

    it('supports force with lease option', async () => {
      mockInvoke = () => Promise.resolve(null);

      await push({ path: '/test/repo', forceWithLease: true, silent: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.forceWithLease).to.be.true;
    });

    it('supports push tags option', async () => {
      mockInvoke = () => Promise.resolve(null);

      await push({ path: '/test/repo', pushTags: true, silent: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.pushTags).to.be.true;
    });

    it('supports set upstream option', async () => {
      mockInvoke = () => Promise.resolve(null);

      await push({ path: '/test/repo', setUpstream: true, silent: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.setUpstream).to.be.true;
    });

    it('supports authentication token', async () => {
      mockInvoke = () => Promise.resolve(null);

      await push({ path: '/test/repo', token: 'ghp_test_token', silent: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.token).to.equal('ghp_test_token');
    });

    it('returns success on successful push', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await push({ path: '/test/repo', silent: true });
      expect(result.success).to.be.true;
    });

    it('handles rejected push error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'PUSH_REJECTED', message: 'Push rejected, non-fast-forward' });

      const result = await push({ path: '/test/repo', silent: true });
      expect(result.success).to.be.false;
    });
  });

  describe('pushToMultipleRemotes', () => {
    it('invokes push_to_multiple_remotes command with correct arguments', async () => {
      const mockResult: MultiPushResult = {
        results: [
          { remote: 'origin', success: true, message: 'Pushed to origin/main' },
          { remote: 'upstream', success: true, message: 'Pushed to upstream/main' },
        ],
        totalSuccess: 2,
        totalFailed: 0,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      await pushToMultipleRemotes({
        path: '/test/repo',
        remotes: ['origin', 'upstream'],
        force: false,
        forceWithLease: false,
        pushTags: false,
        silent: true,
      });
      expect(lastInvokedCommand).to.equal('push_to_multiple_remotes');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.remotes).to.deep.equal(['origin', 'upstream']);
      expect(args.force).to.be.false;
    });

    it('supports optional branch parameter', async () => {
      const mockResult: MultiPushResult = {
        results: [{ remote: 'origin', success: true, message: 'Pushed to origin/feature' }],
        totalSuccess: 1,
        totalFailed: 0,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      await pushToMultipleRemotes({
        path: '/test/repo',
        remotes: ['origin'],
        branch: 'feature',
        force: false,
        forceWithLease: false,
        pushTags: false,
        silent: true,
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.branch).to.equal('feature');
    });

    it('supports force push option', async () => {
      const mockResult: MultiPushResult = {
        results: [{ remote: 'origin', success: true, message: 'Force-pushed to origin/main' }],
        totalSuccess: 1,
        totalFailed: 0,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      await pushToMultipleRemotes({
        path: '/test/repo',
        remotes: ['origin'],
        force: true,
        forceWithLease: false,
        pushTags: false,
        silent: true,
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.force).to.be.true;
    });

    it('supports force with lease option', async () => {
      const mockResult: MultiPushResult = {
        results: [{ remote: 'origin', success: true }],
        totalSuccess: 1,
        totalFailed: 0,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      await pushToMultipleRemotes({
        path: '/test/repo',
        remotes: ['origin'],
        force: false,
        forceWithLease: true,
        pushTags: false,
        silent: true,
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.forceWithLease).to.be.true;
    });

    it('supports push tags option', async () => {
      const mockResult: MultiPushResult = {
        results: [{ remote: 'origin', success: true }],
        totalSuccess: 1,
        totalFailed: 0,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      await pushToMultipleRemotes({
        path: '/test/repo',
        remotes: ['origin'],
        force: false,
        forceWithLease: false,
        pushTags: true,
        silent: true,
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.pushTags).to.be.true;
    });

    it('returns success with all remotes pushed', async () => {
      const mockResult: MultiPushResult = {
        results: [
          { remote: 'origin', success: true, message: 'Pushed to origin/main' },
          { remote: 'upstream', success: true, message: 'Pushed to upstream/main' },
        ],
        totalSuccess: 2,
        totalFailed: 0,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await pushToMultipleRemotes({
        path: '/test/repo',
        remotes: ['origin', 'upstream'],
        force: false,
        forceWithLease: false,
        pushTags: false,
        silent: true,
      });
      expect(result.success).to.be.true;
      expect(result.data?.totalSuccess).to.equal(2);
      expect(result.data?.totalFailed).to.equal(0);
      expect(result.data?.results).to.have.length(2);
    });

    it('returns partial failure when some remotes fail', async () => {
      const mockResult: MultiPushResult = {
        results: [
          { remote: 'origin', success: true, message: 'Pushed to origin/main' },
          { remote: 'upstream', success: false, message: 'Authentication failed' },
        ],
        totalSuccess: 1,
        totalFailed: 1,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      const result = await pushToMultipleRemotes({
        path: '/test/repo',
        remotes: ['origin', 'upstream'],
        force: false,
        forceWithLease: false,
        pushTags: false,
        silent: true,
      });
      expect(result.success).to.be.true;
      expect(result.data?.totalSuccess).to.equal(1);
      expect(result.data?.totalFailed).to.equal(1);
      expect(result.data?.results[0].success).to.be.true;
      expect(result.data?.results[1].success).to.be.false;
    });

    it('handles error when command fails entirely', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'REMOTE_NOT_FOUND', message: 'Remote not found' });

      const result = await pushToMultipleRemotes({
        path: '/test/repo',
        remotes: ['nonexistent'],
        force: false,
        forceWithLease: false,
        pushTags: false,
        silent: true,
      });
      expect(result.success).to.be.false;
    });

    it('supports authentication token', async () => {
      const mockResult: MultiPushResult = {
        results: [{ remote: 'origin', success: true }],
        totalSuccess: 1,
        totalFailed: 0,
      };
      mockInvoke = () => Promise.resolve(mockResult);

      await pushToMultipleRemotes({
        path: '/test/repo',
        remotes: ['origin'],
        force: false,
        forceWithLease: false,
        pushTags: false,
        token: 'ghp_test_token',
        silent: true,
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.token).to.equal('ghp_test_token');
    });
  });

  describe('startAutoFetch', () => {
    it('invokes start_auto_fetch command with correct arguments', async () => {
      mockInvoke = () => Promise.resolve(null);

      await startAutoFetch('/test/repo', 5);
      expect(lastInvokedCommand).to.equal('start_auto_fetch');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.intervalMinutes).to.equal(5);
    });

    it('returns success when auto-fetch is started', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await startAutoFetch('/test/repo', 10);
      expect(result.success).to.be.true;
    });

    it('handles error when starting auto-fetch', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Failed to start auto-fetch' });

      const result = await startAutoFetch('/test/repo', 5);
      expect(result.success).to.be.false;
    });
  });

  describe('stopAutoFetch', () => {
    it('invokes stop_auto_fetch command with correct arguments', async () => {
      mockInvoke = () => Promise.resolve(null);

      await stopAutoFetch('/test/repo');
      expect(lastInvokedCommand).to.equal('stop_auto_fetch');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
    });

    it('returns success when auto-fetch is stopped', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await stopAutoFetch('/test/repo');
      expect(result.success).to.be.true;
    });

    it('handles error when stopping auto-fetch', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Failed to stop auto-fetch' });

      const result = await stopAutoFetch('/test/repo');
      expect(result.success).to.be.false;
    });
  });

  describe('isAutoFetchRunning', () => {
    it('invokes is_auto_fetch_running command', async () => {
      mockInvoke = () => Promise.resolve(true);

      await isAutoFetchRunning('/test/repo');
      expect(lastInvokedCommand).to.equal('is_auto_fetch_running');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
    });

    it('returns true when auto-fetch is running', async () => {
      mockInvoke = () => Promise.resolve(true);

      const result = await isAutoFetchRunning('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.be.true;
    });

    it('returns false when auto-fetch is not running', async () => {
      mockInvoke = () => Promise.resolve(false);

      const result = await isAutoFetchRunning('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.be.false;
    });

    it('handles error checking auto-fetch status', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Failed to check status' });

      const result = await isAutoFetchRunning('/test/repo');
      expect(result.success).to.be.false;
    });
  });

  describe('getRemoteStatus', () => {
    it('invokes get_remote_status command', async () => {
      const mockStatus: RemoteStatus = {
        ahead: 2,
        behind: 1,
        hasUpstream: true,
        upstreamName: 'origin/main',
      };
      mockInvoke = () => Promise.resolve(mockStatus);

      await getRemoteStatus('/test/repo');
      expect(lastInvokedCommand).to.equal('get_remote_status');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
    });

    it('returns ahead/behind counts', async () => {
      const mockStatus: RemoteStatus = {
        ahead: 5,
        behind: 3,
        hasUpstream: true,
        upstreamName: 'origin/develop',
      };
      mockInvoke = () => Promise.resolve(mockStatus);

      const result = await getRemoteStatus('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.ahead).to.equal(5);
      expect(result.data?.behind).to.equal(3);
      expect(result.data?.hasUpstream).to.be.true;
      expect(result.data?.upstreamName).to.equal('origin/develop');
    });

    it('handles branch without upstream', async () => {
      const mockStatus: RemoteStatus = {
        ahead: 0,
        behind: 0,
        hasUpstream: false,
      };
      mockInvoke = () => Promise.resolve(mockStatus);

      const result = await getRemoteStatus('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.hasUpstream).to.be.false;
      expect(result.data?.upstreamName).to.be.undefined;
    });

    it('handles error getting remote status', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Failed to get status' });

      const result = await getRemoteStatus('/test/repo');
      expect(result.success).to.be.false;
    });
  });
});
