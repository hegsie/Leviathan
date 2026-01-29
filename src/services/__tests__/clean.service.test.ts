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
  getCleanableFiles,
  cleanFiles,
  cleanAll,
  type CleanEntry,
} from '../git.service.ts';

describe('git.service - Clean operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    invokeHistory.length = 0;
  });

  describe('getCleanableFiles', () => {
    it('invokes get_cleanable_files command', async () => {
      const mockEntries: CleanEntry[] = [
        { path: 'untracked.txt', isDirectory: false, isIgnored: false, size: 1024 },
        { path: 'temp/', isDirectory: true, isIgnored: false, size: null },
      ];
      mockInvoke = () => Promise.resolve(mockEntries);

      const result = await getCleanableFiles('/test/repo');
      expect(lastInvokedCommand).to.equal('get_cleanable_files');
      expect((lastInvokedArgs as Record<string, unknown>).path).to.equal('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
    });

    it('returns empty array when no cleanable files', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getCleanableFiles('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('invokes with includeIgnored option', async () => {
      mockInvoke = () =>
        Promise.resolve([
          { path: '.env', isDirectory: false, isIgnored: true, size: 256 },
          { path: 'node_modules/', isDirectory: true, isIgnored: true, size: null },
        ]);

      const result = await getCleanableFiles('/test/repo', true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.includeIgnored).to.be.true;
      expect(result.data?.some(e => e.isIgnored)).to.be.true;
    });

    it('invokes with includeDirectories option', async () => {
      mockInvoke = () =>
        Promise.resolve([
          { path: 'untracked.txt', isDirectory: false, isIgnored: false, size: 512 },
          { path: 'build/', isDirectory: true, isIgnored: false, size: null },
        ]);

      const result = await getCleanableFiles('/test/repo', false, true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.includeDirectories).to.be.true;
      expect(result.data?.some(e => e.isDirectory)).to.be.true;
    });

    it('invokes with both options enabled', async () => {
      mockInvoke = () =>
        Promise.resolve([
          { path: 'untracked.txt', isDirectory: false, isIgnored: false, size: 100 },
          { path: '.cache/', isDirectory: true, isIgnored: true, size: null },
        ]);

      await getCleanableFiles('/test/repo', true, true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.includeIgnored).to.be.true;
      expect(args.includeDirectories).to.be.true;
    });

    it('returns files with correct properties', async () => {
      const mockEntries: CleanEntry[] = [
        { path: 'file1.txt', isDirectory: false, isIgnored: false, size: 1024 },
        { path: 'file2.log', isDirectory: false, isIgnored: true, size: 2048 },
        { path: 'temp/', isDirectory: true, isIgnored: false, size: null },
      ];
      mockInvoke = () => Promise.resolve(mockEntries);

      const result = await getCleanableFiles('/test/repo', true, true);
      expect(result.data?.[0].path).to.equal('file1.txt');
      expect(result.data?.[0].isDirectory).to.be.false;
      expect(result.data?.[0].size).to.equal(1024);
      expect(result.data?.[1].isIgnored).to.be.true;
      expect(result.data?.[2].isDirectory).to.be.true;
      expect(result.data?.[2].size).to.be.null;
    });

    it('handles error response', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Repository not found' });

      const result = await getCleanableFiles('/nonexistent/repo');
      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('Repository not found');
    });
  });

  describe('cleanFiles', () => {
    it('invokes clean_files command', async () => {
      mockInvoke = () => Promise.resolve(2);

      const result = await cleanFiles('/test/repo', ['file1.txt', 'file2.txt']);
      expect(lastInvokedCommand).to.equal('clean_files');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.paths).to.deep.equal(['file1.txt', 'file2.txt']);
      expect(result.success).to.be.true;
    });

    it('returns count of cleaned files', async () => {
      mockInvoke = () => Promise.resolve(3);

      const result = await cleanFiles('/test/repo', ['a.txt', 'b.txt', 'c.txt']);
      expect(result.data).to.equal(3);
    });

    it('handles single file', async () => {
      mockInvoke = () => Promise.resolve(1);

      const result = await cleanFiles('/test/repo', ['single.txt']);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect((args.paths as string[]).length).to.equal(1);
      expect(result.data).to.equal(1);
    });

    it('handles empty paths array', async () => {
      mockInvoke = () => Promise.resolve(0);

      const result = await cleanFiles('/test/repo', []);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.paths).to.deep.equal([]);
      expect(result.data).to.equal(0);
    });

    it('handles nested paths', async () => {
      mockInvoke = () => Promise.resolve(2);

      await cleanFiles('/test/repo', ['src/temp.txt', 'build/output/file.log']);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.paths).to.include('src/temp.txt');
      expect(args.paths).to.include('build/output/file.log');
    });

    it('handles error when file not found', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'File not found' });

      const result = await cleanFiles('/test/repo', ['nonexistent.txt']);
      expect(result.success).to.be.false;
    });

    it('handles error when file is tracked', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Cannot clean tracked files' });

      const result = await cleanFiles('/test/repo', ['tracked.txt']);
      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('tracked');
    });
  });

  describe('cleanAll', () => {
    it('invokes clean_all command', async () => {
      mockInvoke = () => Promise.resolve(5);

      const result = await cleanAll('/test/repo');
      expect(lastInvokedCommand).to.equal('clean_all');
      expect((lastInvokedArgs as Record<string, unknown>).path).to.equal('/test/repo');
      expect(result.success).to.be.true;
    });

    it('returns count of cleaned files', async () => {
      mockInvoke = () => Promise.resolve(10);

      const result = await cleanAll('/test/repo');
      expect(result.data).to.equal(10);
    });

    it('returns zero when nothing to clean', async () => {
      mockInvoke = () => Promise.resolve(0);

      const result = await cleanAll('/test/repo');
      expect(result.data).to.equal(0);
    });

    it('invokes with includeIgnored option', async () => {
      mockInvoke = () => Promise.resolve(15);

      const result = await cleanAll('/test/repo', true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.includeIgnored).to.be.true;
      expect(result.data).to.equal(15);
    });

    it('invokes with includeDirectories option', async () => {
      mockInvoke = () => Promise.resolve(8);

      const result = await cleanAll('/test/repo', false, true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.includeDirectories).to.be.true;
      expect(result.data).to.equal(8);
    });

    it('invokes with both options enabled', async () => {
      mockInvoke = () => Promise.resolve(25);

      const result = await cleanAll('/test/repo', true, true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.includeIgnored).to.be.true;
      expect(args.includeDirectories).to.be.true;
      expect(result.data).to.equal(25);
    });

    it('handles includeIgnored false explicitly', async () => {
      mockInvoke = () => Promise.resolve(3);

      await cleanAll('/test/repo', false);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.includeIgnored).to.be.false;
    });

    it('handles includeDirectories false explicitly', async () => {
      mockInvoke = () => Promise.resolve(3);

      await cleanAll('/test/repo', false, false);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.includeDirectories).to.be.false;
    });

    it('handles error response', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Repository not found' });

      const result = await cleanAll('/nonexistent/repo');
      expect(result.success).to.be.false;
      expect(result.error?.message).to.include('Repository not found');
    });

    it('handles permission error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'PERMISSION_DENIED', message: 'Permission denied' });

      const result = await cleanAll('/test/repo');
      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal('PERMISSION_DENIED');
    });
  });
});
