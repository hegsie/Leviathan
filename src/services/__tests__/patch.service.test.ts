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
  createPatch,
  applyPatch,
  applyPatchToIndex,
} from '../git.service.ts';

describe('git.service - Patch operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('createPatch', () => {
    it('invokes create_patch with commit OIDs', async () => {
      const mockFiles = ['/tmp/0001-fix.patch', '/tmp/0002-feature.patch'];
      mockInvoke = () => Promise.resolve(mockFiles);

      const result = await createPatch(
        '/test/repo',
        ['abc123', 'def456'],
        '/tmp/patches',
      );
      expect(lastInvokedCommand).to.equal('create_patch');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.commitOids).to.deep.equal(['abc123', 'def456']);
      expect(args.outputPath).to.equal('/tmp/patches');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal(mockFiles);
    });

    it('creates patch for single commit', async () => {
      mockInvoke = () => Promise.resolve(['/tmp/0001-initial.patch']);

      const result = await createPatch('/test/repo', ['abc123'], '/tmp');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(1);
    });

    it('handles errors for invalid commits', async () => {
      mockInvoke = () => Promise.reject({ code: 'COMMIT_NOT_FOUND', message: 'Not found' });

      const result = await createPatch('/test/repo', ['invalid'], '/tmp');
      expect(result.success).to.be.false;
    });
  });

  describe('applyPatch', () => {
    it('invokes apply_patch command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await applyPatch('/test/repo', '/tmp/fix.patch');
      expect(lastInvokedCommand).to.equal('apply_patch');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.patchPath).to.equal('/tmp/fix.patch');
      expect(result.success).to.be.true;
    });

    it('supports check-only mode', async () => {
      mockInvoke = () => Promise.resolve(null);

      await applyPatch('/test/repo', '/tmp/fix.patch', true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.checkOnly).to.be.true;
    });

    it('handles patch conflicts', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'OPERATION_FAILED', message: 'Patch conflict' });

      const result = await applyPatch('/test/repo', '/tmp/conflicting.patch');
      expect(result.success).to.be.false;
    });
  });

  describe('applyPatchToIndex', () => {
    it('invokes apply_patch_to_index command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await applyPatchToIndex('/test/repo', '/tmp/fix.patch');
      expect(lastInvokedCommand).to.equal('apply_patch_to_index');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.patchPath).to.equal('/tmp/fix.patch');
      expect(result.success).to.be.true;
    });
  });
});
