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
  createArchive,
  getArchiveFiles,
} from '../git.service.ts';

describe('git.service - Archive operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('createArchive', () => {
    it('invokes create_archive for zip', async () => {
      mockInvoke = () => Promise.resolve('/tmp/repo.zip');

      const result = await createArchive('/test/repo', '/tmp/repo.zip', undefined, 'zip');
      expect(lastInvokedCommand).to.equal('create_archive');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.outputPath).to.equal('/tmp/repo.zip');
      expect(args.format).to.equal('zip');
      expect(result.success).to.be.true;
    });

    it('invokes create_archive for tar.gz', async () => {
      mockInvoke = () => Promise.resolve('/tmp/repo.tar.gz');

      await createArchive('/test/repo', '/tmp/repo.tar.gz', undefined, 'tar.gz');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.format).to.equal('tar.gz');
    });

    it('supports specific tree ref', async () => {
      mockInvoke = () => Promise.resolve('/tmp/repo.zip');

      await createArchive('/test/repo', '/tmp/repo.zip', 'v1.0.0', 'zip');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.treeRef).to.equal('v1.0.0');
    });

    it('supports prefix in archive', async () => {
      mockInvoke = () => Promise.resolve('/tmp/repo.zip');

      await createArchive('/test/repo', '/tmp/repo.zip', undefined, 'zip', 'myproject-v1.0');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.prefix).to.equal('myproject-v1.0');
    });

    it('handles invalid format error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Unsupported format' });

      const result = await createArchive('/test/repo', '/tmp/repo.bad', undefined, 'invalid');
      expect(result.success).to.be.false;
    });
  });

  describe('getArchiveFiles', () => {
    it('invokes get_archive_files command', async () => {
      mockInvoke = () =>
        Promise.resolve(['README.md', 'src/main.rs', 'Cargo.toml']);

      const result = await getArchiveFiles('/test/repo');
      expect(lastInvokedCommand).to.equal('get_archive_files');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(3);
    });

    it('supports specific tree ref', async () => {
      mockInvoke = () => Promise.resolve(['README.md']);

      await getArchiveFiles('/test/repo', 'abc123');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.treeRef).to.equal('abc123');
    });

    it('returns empty array for empty tree', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getArchiveFiles('/test/repo');
      expect(result.data).to.deep.equal([]);
    });
  });
});
