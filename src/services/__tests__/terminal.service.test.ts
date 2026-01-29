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
  openTerminal,
  openFileManager,
  openInEditor,
} from '../git.service.ts';

describe('git.service - Terminal integration', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('openTerminal', () => {
    it('invokes open_terminal command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await openTerminal('/test/repo');
      expect(lastInvokedCommand).to.equal('open_terminal');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(result.success).to.be.true;
    });

    it('handles invalid path error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'INVALID_PATH', message: 'Path not found' });

      const result = await openTerminal('/nonexistent/path');
      expect(result.success).to.be.false;
    });
  });

  describe('openFileManager', () => {
    it('invokes open_file_manager command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await openFileManager('/test/repo');
      expect(lastInvokedCommand).to.equal('open_file_manager');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(result.success).to.be.true;
    });

    it('handles invalid path error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'INVALID_PATH', message: 'Path not found' });

      const result = await openFileManager('/nonexistent/path');
      expect(result.success).to.be.false;
    });
  });

  describe('openInEditor', () => {
    it('invokes open_in_editor command', async () => {
      mockInvoke = () => Promise.resolve(null);

      const result = await openInEditor('/test/repo/src/main.ts');
      expect(lastInvokedCommand).to.equal('open_in_editor');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.filePath).to.equal('/test/repo/src/main.ts');
      expect(result.success).to.be.true;
    });

    it('handles file not found error', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'INVALID_PATH', message: 'File not found' });

      const result = await openInEditor('/nonexistent/file.txt');
      expect(result.success).to.be.false;
    });
  });
});
