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

  describe('security-gate refusals are not diagnosed as git failures', () => {
    it('does not call a blocked operation a stuck lock file', () => {
      // 'blocked' contains 'lock', so a plain includes('lock') matched and told
      // the user to go remove an index.lock that does not exist.
      expect(getErrorSuggestion('Operation blocked by security settings')).to.equal(null);
    });

    it('still recognises the real lock messages', () => {
      expect(getErrorSuggestion('Unable to create index.lock: File exists')).to.not.equal(null);
      expect(getErrorSuggestion('the index is locked')).to.not.equal(null);
    });
  });

  describe('a checkout refused for local changes explains itself', () => {
    it("translates libgit2's bare conflict count", () => {
      // Reachable whenever Auto-Stash on Checkout is off. libgit2 says
      // "1 conflict prevents checkout" — no files, no way forward.
      const result = getErrorSuggestion('Checkout failed: 1 conflict prevents checkout');
      expect(result).to.not.equal(null);
      expect(result!.message).to.contain('Stash or commit');
      expect(result!.message).to.contain('Auto-Stash on Checkout');
    });

    it('handles the plural form and git\'s own wording', () => {
      expect(getErrorSuggestion('3 conflicts prevent checkout')).to.not.equal(null);
      expect(
        getErrorSuggestion('Your local changes would be overwritten by checkout'),
      ).to.not.equal(null);
    });
  });

  describe('a rejected push distinguishes the two libgit2 messages', () => {
    // push.c:345 and push.c:356 share no substring and mean opposite things.
    const REMOTE_AHEAD =
      'cannot push because a reference that you are trying to update on the remote contains commits that are not present locally.';
    const LOCAL_DIVERGED = 'cannot push non-fastforwardable reference';

    it('offers Pull Now when the remote genuinely has commits we lack', () => {
      const result = getErrorSuggestion(REMOTE_AHEAD, { operation: 'push' });
      expect(result).to.not.equal(null);
      expect(result!.message).to.match(/pull before pushing/i);
      expect(result!.action?.label).to.equal('Pull Now');
    });

    it('does NOT offer Pull Now after an amend or rebase', () => {
      // Pulling here merges the pre-amend commits back in, duplicating them and
      // undoing the amend — worse than saying nothing.
      const result = getErrorSuggestion(LOCAL_DIVERGED, { operation: 'push' });
      expect(result).to.not.equal(null);
      expect(result!.message).to.match(/diverged/i);
      expect(result!.action, 'no one-click action that would undo their work').to.be.undefined;
    });

    it('a tag already on the remote gets tag-specific advice, not "pull"', () => {
      const result = getErrorSuggestion(LOCAL_DIVERGED, { operation: 'push-tag' });
      expect(result!.message).to.match(/tag at a different commit/i);
      expect(result!.message).to.not.match(/pull before pushing/i);
    });

    it('the git CLI wording still reaches the pull advice', () => {
      const result = getErrorSuggestion('Updates were rejected', { operation: 'push' });
      expect(result!.action?.label).to.equal('Pull Now');
    });
  });

  describe('suggestion actions carry the repo that failed', () => {
    it('Pull Now pins the repo', () => {
      const result = getErrorSuggestion('...not present locally', {
        operation: 'push',
        repoPath: '/repo/a',
      });
      let detail: { repoPath?: string } | null = null;
      const handler = (e: Event): void => {
        detail = (e as CustomEvent<{ repoPath?: string }>).detail;
      };
      window.addEventListener('trigger-pull', handler);
      try {
        result!.action!.callback();
      } finally {
        window.removeEventListener('trigger-pull', handler);
      }
      expect(detail).to.not.be.null;
      expect(detail!.repoPath).to.equal('/repo/a');
    });

    it('Abort Rebase pins the repo', () => {
      const result = getErrorSuggestion('rebase in progress', { repoPath: '/repo/a' });
      let detail: { repoPath?: string } | null = null;
      const handler = (e: Event): void => {
        detail = (e as CustomEvent<{ repoPath?: string }>).detail;
      };
      window.addEventListener('trigger-abort', handler);
      try {
        result!.action!.callback();
      } finally {
        window.removeEventListener('trigger-abort', handler);
      }
      expect(detail!.repoPath).to.equal('/repo/a');
    });
  });

  describe('"permission denied" is not always an auth failure', () => {
    it('a locked file during a checkout is not reported as an SSH problem', () => {
      // The OS says "permission denied" for a read-only or held file too.
      const result = getErrorSuggestion('failed to write file: permission denied');
      expect(
        String(result?.message ?? ''),
        'the real filesystem error must not be replaced with credentials advice',
      ).to.not.contain('credentials or SSH keys');
    });

    it('but a push that fails on permission denied still is', () => {
      const result = getErrorSuggestion('permission denied', { operation: 'push' });
      expect(result!.message).to.match(/credentials or SSH keys/);
    });

    it('publickey wording is recognised regardless of operation', () => {
      const result = getErrorSuggestion('Permission denied (publickey)');
      expect(result!.message).to.match(/credentials or SSH keys/);
    });
  });
});