import { expect } from '@open-wc/testing';

// Track invocations of the Tauri dialog commands
const invokeLog: { command: string; args: unknown }[] = [];
let invokeResult: unknown = null;
let invokeShouldThrow = false;

// Mock Tauri internals before importing dialog.service
if (!(globalThis as Record<string, unknown>).__TAURI_INTERNALS__) {
  (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke: (command: string, args?: unknown): Promise<unknown> => {
      invokeLog.push({ command, args });
      if (invokeShouldThrow) return Promise.reject(new Error('mock error'));
      return Promise.resolve(invokeResult);
    },
    transformCallback: () => 0,
  };
}

// Must mark the window as Tauri to pass isTauri() check
(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = (
  globalThis as unknown as Record<string, unknown>
).__TAURI_INTERNALS__;

import {
  openDialog,
  openRepositoryDialog,
  openCloneDestinationDialog,
  saveDialog,
  showMessage,
  showConfirm,
  showAsk,
} from '../dialog.service.ts';

describe('dialog.service', () => {
  beforeEach(() => {
    invokeLog.length = 0;
    invokeResult = null;
    invokeShouldThrow = false;
  });

  describe('openDialog', () => {
    it('should return null when dialog is cancelled', async () => {
      invokeResult = null;
      const result = await openDialog();
      expect(result).to.be.null;
    });

    it('should return a file path when selected', async () => {
      invokeResult = '/test/repo';
      const result = await openDialog({ directory: true });
      expect(result).to.equal('/test/repo');
    });

    it('should return array for multiple selection', async () => {
      invokeResult = ['/path/one', '/path/two'];
      const result = await openDialog({ multiple: true });
      expect(result).to.deep.equal(['/path/one', '/path/two']);
    });

    it('should propagate errors', async () => {
      invokeShouldThrow = true;
      try {
        await openDialog();
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).to.equal('mock error');
      }
    });
  });

  describe('openRepositoryDialog', () => {
    it('should return a string path', async () => {
      invokeResult = '/home/user/repo';
      const result = await openRepositoryDialog();
      expect(result).to.equal('/home/user/repo');
    });

    it('should return null on cancel', async () => {
      invokeResult = null;
      const result = await openRepositoryDialog();
      expect(result).to.be.null;
    });

    it('should return first element when result is array', async () => {
      invokeResult = ['/first/repo', '/second/repo'];
      const result = await openRepositoryDialog();
      expect(result).to.equal('/first/repo');
    });

    it('should return null for empty array result', async () => {
      invokeResult = [];
      const result = await openRepositoryDialog();
      expect(result).to.be.null;
    });
  });

  describe('openCloneDestinationDialog', () => {
    it('should return selected directory', async () => {
      invokeResult = '/clone/destination';
      const result = await openCloneDestinationDialog();
      expect(result).to.equal('/clone/destination');
    });

    it('should return null on cancel', async () => {
      invokeResult = null;
      const result = await openCloneDestinationDialog();
      expect(result).to.be.null;
    });

    it('should return first element when result is array', async () => {
      invokeResult = ['/first/path'];
      const result = await openCloneDestinationDialog();
      expect(result).to.equal('/first/path');
    });

    it('should accept a default path', async () => {
      invokeResult = '/some/path';
      const result = await openCloneDestinationDialog('/default/path');
      expect(result).to.equal('/some/path');
    });
  });

  describe('saveDialog', () => {
    it('should return a file path when saved', async () => {
      invokeResult = '/save/file.txt';
      const result = await saveDialog({ title: 'Save' });
      expect(result).to.equal('/save/file.txt');
    });

    it('should return null on cancel or error', async () => {
      invokeShouldThrow = true;
      const result = await saveDialog();
      expect(result).to.be.null;
    });
  });

  describe('showMessage', () => {
    it('should not throw', async () => {
      invokeResult = undefined;
      await showMessage('Title', 'Body');
    });

    it('should accept kind parameter', async () => {
      invokeResult = undefined;
      await showMessage('Warning', 'Careful!', 'warning');
    });
  });

  describe('showConfirm', () => {
    it('should return true when confirmed', async () => {
      invokeResult = true;
      const result = await showConfirm('Confirm', 'Are you sure?');
      expect(result).to.be.true;
    });

    it('should return false when denied', async () => {
      invokeResult = false;
      const result = await showConfirm('Confirm', 'Are you sure?');
      expect(result).to.be.false;
    });

    it('should accept kind parameter', async () => {
      invokeResult = true;
      const result = await showConfirm('Delete', 'Remove file?', 'warning');
      expect(result).to.be.true;
    });
  });

  describe('showAsk', () => {
    it('should return true when OK is pressed', async () => {
      invokeResult = true;
      const result = await showAsk('Question', 'Proceed?');
      expect(result).to.be.true;
    });

    it('should return false when Cancel is pressed', async () => {
      invokeResult = false;
      const result = await showAsk('Question', 'Proceed?');
      expect(result).to.be.false;
    });

    it('should accept kind parameter', async () => {
      invokeResult = false;
      const result = await showAsk('Error', 'Retry?', 'error');
      expect(result).to.be.false;
    });
  });
});
