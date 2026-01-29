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
  getSubmodules,
  addSubmodule,
  initSubmodules,
  updateSubmodules,
  syncSubmodules,
  deinitSubmodule,
  removeSubmodule,
  type Submodule,
  type SubmoduleStatus,
} from '../git.service.ts';

describe('git.service - Submodule operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getSubmodules', () => {
    it('invokes get_submodules command', async () => {
      const mockSubmodules: Submodule[] = [
        {
          name: 'libs/shared',
          path: 'libs/shared',
          url: 'https://github.com/org/shared.git',
          headOid: 'abc123',
          branch: 'main',
          initialized: true,
          status: 'current' as SubmoduleStatus,
        },
      ];
      mockInvoke = () => Promise.resolve(mockSubmodules);

      const result = await getSubmodules('/test/repo');
      expect(lastInvokedCommand).to.equal('get_submodules');
      expect(result.success).to.be.true;
      expect(result.data).to.have.length(1);
    });

    it('passes the correct path argument', async () => {
      mockInvoke = () => Promise.resolve([]);

      await getSubmodules('/my/repo/path');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo/path');
    });

    it('returns empty array when no submodules exist', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getSubmodules('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('returns submodule details correctly', async () => {
      const mockSubmodules: Submodule[] = [
        {
          name: 'vendor/lib',
          path: 'vendor/lib',
          url: 'https://github.com/vendor/lib.git',
          headOid: 'def456',
          branch: 'develop',
          initialized: true,
          status: 'modified' as SubmoduleStatus,
        },
      ];
      mockInvoke = () => Promise.resolve(mockSubmodules);

      const result = await getSubmodules('/test/repo');
      expect(result.data?.[0].name).to.equal('vendor/lib');
      expect(result.data?.[0].url).to.equal('https://github.com/vendor/lib.git');
      expect(result.data?.[0].status).to.equal('modified');
    });

    it('returns uninitialized submodules', async () => {
      const mockSubmodules: Submodule[] = [
        {
          name: 'external/tool',
          path: 'external/tool',
          url: null,
          headOid: null,
          branch: null,
          initialized: false,
          status: 'uninitialized' as SubmoduleStatus,
        },
      ];
      mockInvoke = () => Promise.resolve(mockSubmodules);

      const result = await getSubmodules('/test/repo');
      expect(result.data?.[0].initialized).to.be.false;
      expect(result.data?.[0].status).to.equal('uninitialized');
    });
  });

  describe('addSubmodule', () => {
    it('invokes add_submodule command', async () => {
      const mockSubmodule: Submodule = {
        name: 'libs/new-lib',
        path: 'libs/new-lib',
        url: 'https://github.com/org/new-lib.git',
        headOid: 'abc123',
        branch: 'main',
        initialized: true,
        status: 'current' as SubmoduleStatus,
      };
      mockInvoke = () => Promise.resolve(mockSubmodule);

      const result = await addSubmodule(
        '/test/repo',
        'https://github.com/org/new-lib.git',
        'libs/new-lib',
      );
      expect(lastInvokedCommand).to.equal('add_submodule');
      expect(result.success).to.be.true;
    });

    it('passes the correct arguments', async () => {
      mockInvoke = () =>
        Promise.resolve({
          name: 'libs/dep',
          path: 'libs/dep',
          url: 'https://github.com/org/dep.git',
          headOid: null,
          branch: null,
          initialized: true,
          status: 'current',
        });

      await addSubmodule('/my/repo', 'https://github.com/org/dep.git', 'libs/dep');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo');
      expect(args.url).to.equal('https://github.com/org/dep.git');
      expect(args.submodulePath).to.equal('libs/dep');
    });

    it('passes branch argument when provided', async () => {
      mockInvoke = () =>
        Promise.resolve({
          name: 'libs/dep',
          path: 'libs/dep',
          url: 'https://github.com/org/dep.git',
          headOid: null,
          branch: 'develop',
          initialized: true,
          status: 'current',
        });

      await addSubmodule('/my/repo', 'https://github.com/org/dep.git', 'libs/dep', 'develop');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.branch).to.equal('develop');
    });

    it('returns the created submodule', async () => {
      const mockSubmodule: Submodule = {
        name: 'external/tool',
        path: 'external/tool',
        url: 'https://github.com/org/tool.git',
        headOid: 'xyz789',
        branch: 'main',
        initialized: true,
        status: 'current' as SubmoduleStatus,
      };
      mockInvoke = () => Promise.resolve(mockSubmodule);

      const result = await addSubmodule(
        '/test/repo',
        'https://github.com/org/tool.git',
        'external/tool',
      );
      expect(result.data?.name).to.equal('external/tool');
      expect(result.data?.initialized).to.be.true;
    });

    it('handles error when URL is invalid', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Invalid repository URL' });

      const result = await addSubmodule('/test/repo', 'invalid-url', 'libs/invalid');
      expect(result.success).to.be.false;
    });
  });

  describe('initSubmodules', () => {
    it('invokes init_submodules command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await initSubmodules('/test/repo');
      expect(lastInvokedCommand).to.equal('init_submodules');
      expect(result.success).to.be.true;
    });

    it('passes the correct path argument', async () => {
      mockInvoke = () => Promise.resolve(null);

      await initSubmodules('/my/repo/path');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo/path');
    });

    it('passes submodule paths when provided', async () => {
      mockInvoke = () => Promise.resolve(null);

      await initSubmodules('/test/repo', ['libs/a', 'libs/b']);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.submodulePaths).to.deep.equal(['libs/a', 'libs/b']);
    });

    it('initializes all submodules when no paths provided', async () => {
      mockInvoke = () => Promise.resolve(null);

      await initSubmodules('/test/repo');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.submodulePaths).to.be.undefined;
    });

    it('handles error when init fails', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Submodule not found' });

      const result = await initSubmodules('/test/repo', ['nonexistent']);
      expect(result.success).to.be.false;
    });
  });

  describe('updateSubmodules', () => {
    it('invokes update_submodules command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await updateSubmodules('/test/repo');
      expect(lastInvokedCommand).to.equal('update_submodules');
      expect(result.success).to.be.true;
    });

    it('passes the correct path argument', async () => {
      mockInvoke = () => Promise.resolve(null);

      await updateSubmodules('/my/repo/path');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo/path');
    });

    it('passes submodule paths option', async () => {
      mockInvoke = () => Promise.resolve(null);

      await updateSubmodules('/test/repo', { submodulePaths: ['libs/a', 'libs/b'] });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.submodulePaths).to.deep.equal(['libs/a', 'libs/b']);
    });

    it('passes init option', async () => {
      mockInvoke = () => Promise.resolve(null);

      await updateSubmodules('/test/repo', { init: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.init).to.be.true;
    });

    it('passes recursive option', async () => {
      mockInvoke = () => Promise.resolve(null);

      await updateSubmodules('/test/repo', { recursive: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.recursive).to.be.true;
    });

    it('passes remote option', async () => {
      mockInvoke = () => Promise.resolve(null);

      await updateSubmodules('/test/repo', { remote: true });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.remote).to.be.true;
    });

    it('passes all options together', async () => {
      mockInvoke = () => Promise.resolve(null);

      await updateSubmodules('/test/repo', {
        submodulePaths: ['libs/a'],
        init: true,
        recursive: true,
        remote: true,
      });
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.submodulePaths).to.deep.equal(['libs/a']);
      expect(args.init).to.be.true;
      expect(args.recursive).to.be.true;
      expect(args.remote).to.be.true;
    });

    it('handles error when update fails', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Network error' });

      const result = await updateSubmodules('/test/repo');
      expect(result.success).to.be.false;
    });
  });

  describe('syncSubmodules', () => {
    it('invokes sync_submodules command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await syncSubmodules('/test/repo');
      expect(lastInvokedCommand).to.equal('sync_submodules');
      expect(result.success).to.be.true;
    });

    it('passes the correct path argument', async () => {
      mockInvoke = () => Promise.resolve(null);

      await syncSubmodules('/my/repo/path');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo/path');
    });

    it('passes submodule paths when provided', async () => {
      mockInvoke = () => Promise.resolve(null);

      await syncSubmodules('/test/repo', ['libs/a', 'libs/b']);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.submodulePaths).to.deep.equal(['libs/a', 'libs/b']);
    });

    it('syncs all submodules when no paths provided', async () => {
      mockInvoke = () => Promise.resolve(null);

      await syncSubmodules('/test/repo');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.submodulePaths).to.be.undefined;
    });

    it('handles error when sync fails', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Sync failed' });

      const result = await syncSubmodules('/test/repo');
      expect(result.success).to.be.false;
    });
  });

  describe('deinitSubmodule', () => {
    it('invokes deinit_submodule command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await deinitSubmodule('/test/repo', 'libs/old');
      expect(lastInvokedCommand).to.equal('deinit_submodule');
      expect(result.success).to.be.true;
    });

    it('passes the correct path and submodulePath arguments', async () => {
      mockInvoke = () => Promise.resolve(null);

      await deinitSubmodule('/my/repo', 'vendor/lib');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo');
      expect(args.submodulePath).to.equal('vendor/lib');
    });

    it('passes force option when provided', async () => {
      mockInvoke = () => Promise.resolve(null);

      await deinitSubmodule('/test/repo', 'libs/dirty', true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.force).to.be.true;
    });

    it('deinitializes without force by default', async () => {
      mockInvoke = () => Promise.resolve(null);

      await deinitSubmodule('/test/repo', 'libs/clean');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.force).to.be.undefined;
    });

    it('handles error when deinit fails', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Submodule has local changes' });

      const result = await deinitSubmodule('/test/repo', 'libs/dirty');
      expect(result.success).to.be.false;
    });
  });

  describe('removeSubmodule', () => {
    it('invokes remove_submodule command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await removeSubmodule('/test/repo', 'libs/deprecated');
      expect(lastInvokedCommand).to.equal('remove_submodule');
      expect(result.success).to.be.true;
    });

    it('passes the correct path and submodulePath arguments', async () => {
      mockInvoke = () => Promise.resolve(null);

      await removeSubmodule('/my/repo', 'vendor/old-lib');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo');
      expect(args.submodulePath).to.equal('vendor/old-lib');
    });

    it('handles error when submodule does not exist', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Submodule not found' });

      const result = await removeSubmodule('/test/repo', 'nonexistent/submodule');
      expect(result.success).to.be.false;
    });

    it('handles error when removal fails', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Failed to remove submodule' });

      const result = await removeSubmodule('/test/repo', 'libs/problematic');
      expect(result.success).to.be.false;
    });
  });
});
