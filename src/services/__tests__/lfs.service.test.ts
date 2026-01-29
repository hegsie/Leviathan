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
  getLfsStatus,
  initLfs,
  lfsTrack,
  lfsUntrack,
  getLfsFiles,
  lfsPull,
  lfsFetch,
  lfsPrune,
  type LfsStatus,
  type LfsFile,
} from '../git.service.ts';

describe('git.service - LFS operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getLfsStatus', () => {
    it('invokes get_lfs_status command', async () => {
      const mockStatus: LfsStatus = {
        installed: true,
        version: '3.4.0',
        enabled: true,
        patterns: [{ pattern: '*.psd' }, { pattern: '*.bin' }],
        fileCount: 10,
        totalSize: 1024000,
      };
      mockInvoke = () => Promise.resolve(mockStatus);

      const result = await getLfsStatus('/test/repo');
      expect(lastInvokedCommand).to.equal('get_lfs_status');
      expect(result.success).to.be.true;
      expect(result.data?.installed).to.be.true;
      expect(result.data?.version).to.equal('3.4.0');
    });

    it('passes the correct path argument', async () => {
      mockInvoke = () =>
        Promise.resolve({
          installed: false,
          version: null,
          enabled: false,
          patterns: [],
          fileCount: 0,
          totalSize: 0,
        });

      await getLfsStatus('/my/repo/path');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo/path');
    });

    it('returns disabled status when LFS is not installed', async () => {
      mockInvoke = () =>
        Promise.resolve({
          installed: false,
          version: null,
          enabled: false,
          patterns: [],
          fileCount: 0,
          totalSize: 0,
        });

      const result = await getLfsStatus('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.installed).to.be.false;
      expect(result.data?.enabled).to.be.false;
    });

    it('returns patterns when LFS is enabled', async () => {
      mockInvoke = () =>
        Promise.resolve({
          installed: true,
          version: '3.4.0',
          enabled: true,
          patterns: [{ pattern: '*.zip' }, { pattern: '*.tar.gz' }],
          fileCount: 5,
          totalSize: 512000,
        });

      const result = await getLfsStatus('/test/repo');
      expect(result.data?.patterns).to.have.length(2);
      expect(result.data?.patterns[0].pattern).to.equal('*.zip');
    });
  });

  describe('initLfs', () => {
    it('invokes init_lfs command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await initLfs('/test/repo');
      expect(lastInvokedCommand).to.equal('init_lfs');
      expect(result.success).to.be.true;
    });

    it('passes the correct path argument', async () => {
      mockInvoke = () => Promise.resolve(null);

      await initLfs('/my/lfs/repo');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/lfs/repo');
    });

    it('handles error when LFS cannot be initialized', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Git LFS not installed' });

      const result = await initLfs('/test/repo');
      expect(result.success).to.be.false;
    });
  });

  describe('lfsTrack', () => {
    it('invokes lfs_track command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await lfsTrack('/test/repo', '*.psd');
      expect(lastInvokedCommand).to.equal('lfs_track');
      expect(result.success).to.be.true;
    });

    it('passes the correct path and pattern arguments', async () => {
      mockInvoke = () => Promise.resolve(null);

      await lfsTrack('/my/repo', '*.bin');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo');
      expect(args.pattern).to.equal('*.bin');
    });

    it('handles complex patterns', async () => {
      mockInvoke = () => Promise.resolve(null);

      await lfsTrack('/test/repo', 'assets/**/*.png');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.pattern).to.equal('assets/**/*.png');
    });

    it('handles error when pattern is invalid', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Invalid pattern' });

      const result = await lfsTrack('/test/repo', '');
      expect(result.success).to.be.false;
    });
  });

  describe('lfsUntrack', () => {
    it('invokes lfs_untrack command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await lfsUntrack('/test/repo', '*.psd');
      expect(lastInvokedCommand).to.equal('lfs_untrack');
      expect(result.success).to.be.true;
    });

    it('passes the correct path and pattern arguments', async () => {
      mockInvoke = () => Promise.resolve(null);

      await lfsUntrack('/my/repo', '*.bin');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo');
      expect(args.pattern).to.equal('*.bin');
    });

    it('handles error when pattern is not tracked', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Pattern not tracked' });

      const result = await lfsUntrack('/test/repo', '*.nottracked');
      expect(result.success).to.be.false;
    });
  });

  describe('getLfsFiles', () => {
    it('invokes get_lfs_files command', async () => {
      const mockFiles: LfsFile[] = [
        { path: 'assets/image.psd', oid: 'abc123', size: 1024, downloaded: true },
        { path: 'data/archive.bin', oid: 'def456', size: 2048, downloaded: false },
      ];
      mockInvoke = () => Promise.resolve(mockFiles);

      const result = await getLfsFiles('/test/repo');
      expect(lastInvokedCommand).to.equal('get_lfs_files');
      expect(result.success).to.be.true;
      expect(result.data).to.have.length(2);
    });

    it('passes the correct path argument', async () => {
      mockInvoke = () => Promise.resolve([]);

      await getLfsFiles('/my/repo/path');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo/path');
    });

    it('returns file details correctly', async () => {
      const mockFiles: LfsFile[] = [
        { path: 'assets/large.zip', oid: 'xyz789', size: 5000000, downloaded: true },
      ];
      mockInvoke = () => Promise.resolve(mockFiles);

      const result = await getLfsFiles('/test/repo');
      expect(result.data?.[0].path).to.equal('assets/large.zip');
      expect(result.data?.[0].oid).to.equal('xyz789');
      expect(result.data?.[0].size).to.equal(5000000);
      expect(result.data?.[0].downloaded).to.be.true;
    });

    it('returns empty array when no LFS files exist', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getLfsFiles('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });
  });

  describe('lfsPull', () => {
    it('invokes lfs_pull command', async () => {
      mockInvoke = () => Promise.resolve('Downloading LFS objects: 100% (5/5)');

      const result = await lfsPull('/test/repo');
      expect(lastInvokedCommand).to.equal('lfs_pull');
      expect(result.success).to.be.true;
    });

    it('passes the correct path argument', async () => {
      mockInvoke = () => Promise.resolve('');

      await lfsPull('/my/repo/path');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo/path');
    });

    it('returns output message on success', async () => {
      mockInvoke = () => Promise.resolve('Downloaded 3 files (150 MB)');

      const result = await lfsPull('/test/repo');
      expect(result.data).to.equal('Downloaded 3 files (150 MB)');
    });

    it('handles error when pull fails', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Network error' });

      const result = await lfsPull('/test/repo');
      expect(result.success).to.be.false;
    });
  });

  describe('lfsFetch', () => {
    it('invokes lfs_fetch command without refs', async () => {
      mockInvoke = () => Promise.resolve('Fetching LFS objects: 100% (10/10)');

      const result = await lfsFetch('/test/repo');
      expect(lastInvokedCommand).to.equal('lfs_fetch');
      expect(result.success).to.be.true;
    });

    it('invokes lfs_fetch command with refs', async () => {
      mockInvoke = () => Promise.resolve('Fetching LFS objects for refs');

      await lfsFetch('/test/repo', ['main', 'develop']);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.refs).to.deep.equal(['main', 'develop']);
    });

    it('passes the correct path argument', async () => {
      mockInvoke = () => Promise.resolve('');

      await lfsFetch('/my/repo/path');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo/path');
    });

    it('returns output message on success', async () => {
      mockInvoke = () => Promise.resolve('Fetched 5 LFS objects');

      const result = await lfsFetch('/test/repo');
      expect(result.data).to.equal('Fetched 5 LFS objects');
    });

    it('handles error when fetch fails', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Authentication failed' });

      const result = await lfsFetch('/test/repo');
      expect(result.success).to.be.false;
    });
  });

  describe('lfsPrune', () => {
    it('invokes lfs_prune command', async () => {
      mockInvoke = () => Promise.resolve('Pruned 3 files (50 MB)');

      const result = await lfsPrune('/test/repo');
      expect(lastInvokedCommand).to.equal('lfs_prune');
      expect(result.success).to.be.true;
    });

    it('passes the correct path argument', async () => {
      mockInvoke = () => Promise.resolve('');

      await lfsPrune('/my/repo/path');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo/path');
    });

    it('invokes lfs_prune with dryRun option', async () => {
      mockInvoke = () => Promise.resolve('Would prune 3 files (50 MB)');

      await lfsPrune('/test/repo', true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.dryRun).to.be.true;
    });

    it('invokes lfs_prune without dryRun option', async () => {
      mockInvoke = () => Promise.resolve('Pruned 3 files');

      await lfsPrune('/test/repo', false);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.dryRun).to.be.false;
    });

    it('returns output message on success', async () => {
      mockInvoke = () => Promise.resolve('Pruned 10 files (200 MB)');

      const result = await lfsPrune('/test/repo');
      expect(result.data).to.equal('Pruned 10 files (200 MB)');
    });

    it('handles error when prune fails', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Prune operation failed' });

      const result = await lfsPrune('/test/repo');
      expect(result.success).to.be.false;
    });
  });
});
