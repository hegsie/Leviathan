import { expect } from '@open-wc/testing';

// Mock Tauri API before importing any modules that use it
const mockInvoke = (_command: string): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

import { getErrorSuggestion } from '../error-suggestion.service.ts';

describe('error-suggestion.service', () => {
  describe('getErrorSuggestion', () => {
    it('should return suggestion for non-fast-forward push error', () => {
      const result = getErrorSuggestion('Updates were rejected because the remote contains work that you do not have locally. non-fast-forward');
      expect(result).to.not.be.null;
      expect(result!.message).to.include('Pull');
      expect(result!.action).to.not.be.undefined;
      expect(result!.action!.label).to.equal('Pull Now');
    });

    it('should return suggestion for rejected push with context', () => {
      const result = getErrorSuggestion('rejected', { operation: 'push' });
      expect(result).to.not.be.null;
      expect(result!.message).to.include('Pull');
      expect(result!.action!.label).to.equal('Pull Now');
    });

    it('should return suggestion for "not fully merged" branch error', () => {
      const result = getErrorSuggestion('The branch is not fully merged', { branchName: 'feature/test' });
      expect(result).to.not.be.null;
      expect(result!.message).to.include('not fully merged');
      expect(result!.action).to.not.be.undefined;
      expect(result!.action!.label).to.equal('Force Delete');
    });

    it('should return suggestion for authentication errors', () => {
      const result = getErrorSuggestion('authentication required');
      expect(result).to.not.be.null;
      expect(result!.message).to.include('credentials');
      expect(result!.action!.label).to.equal('Open Settings');
    });

    it('should return suggestion for permission denied', () => {
      const result = getErrorSuggestion('Permission denied (publickey)');
      expect(result).to.not.be.null;
      expect(result!.message).to.include('credentials');
    });

    it('should return suggestion for rebase in progress', () => {
      const result = getErrorSuggestion('rebase in progress');
      expect(result).to.not.be.null;
      expect(result!.message).to.include('rebase');
      expect(result!.action!.label).to.equal('Abort Rebase');
    });

    it('should return suggestion for no upstream branch', () => {
      const result = getErrorSuggestion('There is no tracking information for the current branch');
      expect(result).to.not.be.null;
      expect(result!.message).to.include('upstream');
      expect(result!.action).to.be.undefined;
    });

    it('should return suggestion for lock file errors', () => {
      const result = getErrorSuggestion('Unable to create lock file');
      expect(result).to.not.be.null;
      expect(result!.message).to.include('locked');
      expect(result!.action).to.be.undefined;
    });

    it('should return suggestion for operation timeout', () => {
      const result = getErrorSuggestion('The operation timed out after 300 seconds');
      expect(result).to.not.be.null;
      expect(result!.message).to.include('timed out');
      expect(result!.action).to.not.be.undefined;
      expect(result!.action!.label).to.equal('Open Settings');
    });

    it('should return suggestion for operation_timeout code', () => {
      const result = getErrorSuggestion('OPERATION_TIMEOUT: fetch exceeded timeout');
      expect(result).to.not.be.null;
      expect(result!.message).to.include('timed out');
      expect(result!.action!.label).to.equal('Open Settings');
    });

    it('should return suggestion for cancelled operation', () => {
      const result = getErrorSuggestion('OPERATION_CANCELLED');
      expect(result).to.not.be.null;
      expect(result!.message).to.include('cancelled');
      expect(result!.action).to.be.undefined;
    });

    it('should dispatch open-settings event for timeout errors', () => {
      const result = getErrorSuggestion('operation timed out');
      expect(result).to.not.be.null;

      let dispatched = false;
      const handler = () => { dispatched = true; };
      window.addEventListener('open-settings', handler);

      result!.action!.callback();

      expect(dispatched).to.be.true;
      window.removeEventListener('open-settings', handler);
    });

    it('should return null for unknown errors', () => {
      const result = getErrorSuggestion('some random error message');
      expect(result).to.be.null;
    });

    it('should return null for empty error message', () => {
      const result = getErrorSuggestion('');
      expect(result).to.be.null;
    });

    it('should dispatch trigger-pull event when action callback is called', () => {
      const result = getErrorSuggestion('non-fast-forward');
      expect(result).to.not.be.null;

      let dispatched = false;
      const handler = () => { dispatched = true; };
      window.addEventListener('trigger-pull', handler);

      result!.action!.callback();

      expect(dispatched).to.be.true;
      window.removeEventListener('trigger-pull', handler);
    });

    it('should dispatch force-delete-branch event with branch name', () => {
      const result = getErrorSuggestion('not fully merged', { branchName: 'my-branch' });
      expect(result).to.not.be.null;

      let detail: Record<string, unknown> | null = null;
      const handler = (e: Event) => { detail = (e as CustomEvent).detail; };
      window.addEventListener('force-delete-branch', handler);

      result!.action!.callback();

      expect(detail).to.not.be.null;
      expect(detail!.branchName).to.equal('my-branch');
      window.removeEventListener('force-delete-branch', handler);
    });

    it('should dispatch open-settings event for auth errors', () => {
      const result = getErrorSuggestion('authentication failed');
      expect(result).to.not.be.null;

      let dispatched = false;
      const handler = () => { dispatched = true; };
      window.addEventListener('open-settings', handler);

      result!.action!.callback();

      expect(dispatched).to.be.true;
      window.removeEventListener('open-settings', handler);
    });
  });
});
