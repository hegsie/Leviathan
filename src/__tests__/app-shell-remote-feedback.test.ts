/**
 * Feedback for the toolbar's network operations.
 *
 * The three toolbar handlers were the only callers of fetch/pull/push that
 * didn't pass `silent`, so the service toasted and then the handler toasted
 * again: two messages per operation. A conflicting pull was the worst of it —
 * the service's red "Pull failed" fired while the handler opened the conflict
 * dialog, telling the user nothing happened when in fact the merge had landed
 * and needed resolving.
 *
 * Auto-fetch had the opposite problem: every failure returned early, so a
 * background loop that could never authenticate froze the ahead/behind badge
 * with no indication at all.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
const invokeCallArgs: Array<{ command: string; args: Record<string, unknown> }> = [];
const mockResponses: Record<string, (args: Record<string, unknown>) => unknown> = {};
/** Commands that should reject, and with what. */
const failures: Record<string, { code?: string; message: string }> = {};

let cbId = 0;
(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: Record<string, unknown>) => {
    invokeCallArgs.push({ command, args: args || {} });
    if (failures[command]) return Promise.reject(failures[command]);
    const handler = mockResponses[command];
    return Promise.resolve(handler ? handler(args || {}) : null);
  },
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect } from '@open-wc/testing';
import type { AppShell } from '../app-shell.ts';
import '../app-shell.ts';
import { uiStore, repositoryStore } from '../stores/index.ts';
import type { Repository } from '../types/git.types.ts';

function createAppShell(): AppShell {
  return document.createElement('lv-app-shell') as AppShell;
}

function mockRepo(path: string, name: string): Repository {
  return {
    path,
    name,
    isValid: true,
    isBare: false,
    headRef: 'main',
    state: 'clean',
    isShallow: false,
    isPartialClone: false,
    cloneFilter: null,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('app-shell remote-operation feedback', () => {
  beforeEach(() => {
    invokeCallArgs.length = 0;
    for (const k of Object.keys(mockResponses)) delete mockResponses[k];
    for (const k of Object.keys(failures)) delete failures[k];
    uiStore.setState({ toasts: [] });
    repositoryStore.getState().reset();
  });

  afterEach(() => {
    repositoryStore.getState().reset();
  });

  function shellOnRepo(): AppShell {
    const el = createAppShell();
    (el as any).activeRepository = { repository: mockRepo('/repo/one', 'one') };
    return el;
  }

  describe('one message per operation', () => {
    for (const op of ['fetch', 'pull', 'push'] as const) {
      it(`${op} passes silent so the service does not toast on top of the handler`, async () => {
        const el = shellOnRepo();
        const handler = `handle${op[0].toUpperCase()}${op.slice(1)}` as
          | 'handleFetch'
          | 'handlePull'
          | 'handlePush';

        await (el as any)[handler]();

        const call = invokeCallArgs.find((c) => c.command === op);
        expect(call, `${op} invoked`).to.not.be.undefined;
        expect(call!.args.silent, `${op} suppresses the service toast`).to.equal(true);
      });

      it(`a failed ${op} produces exactly one error toast`, async () => {
        failures[op] = { code: 'COMMAND_ERROR', message: 'remote hung up' };
        const el = shellOnRepo();
        const handler = `handle${op[0].toUpperCase()}${op.slice(1)}` as
          | 'handleFetch'
          | 'handlePull'
          | 'handlePush';

        await (el as any)[handler]();

        const errors = uiStore.getState().toasts.filter((t) => t.type === 'error');
        expect(errors.length, `one error toast for a failed ${op}`).to.equal(1);
        expect(errors[0].message).to.contain('remote hung up');
      });
    }
  });

  describe('a conflicting pull is not reported as a failure', () => {
    it('says conflicts need resolving, not that the pull failed', async () => {
      failures['pull'] = { code: 'MERGE_CONFLICT', message: 'CONFLICT in a.txt' };
      const el = shellOnRepo();

      await (el as any).handlePull();

      const toasts = uiStore.getState().toasts;
      expect(
        toasts.some((t) => t.type === 'error' && /failed/i.test(t.message)),
        'no red "Pull failed" for a conflict',
      ).to.equal(false);
      expect(
        toasts.some((t) => /conflict/i.test(t.message)),
        'the user is told there are conflicts to resolve',
      ).to.equal(true);
    });
  });

  describe('auto-fetch failures are not swallowed', () => {
    it('reports a failure once, naming the repo', () => {
      const el = createAppShell();

      (el as any).handleAutoFetchCompleted({
        repoPath: '/home/user/projects/api-server',
        success: false,
        behind: 0,
        ahead: 0,
        message: 'No valid credentials found',
      });

      const toasts = uiStore.getState().toasts;
      expect(toasts.length, 'the failure is surfaced').to.equal(1);
      expect(toasts[0].message).to.contain('api-server');
      expect(toasts[0].message).to.contain('No valid credentials found');
    });

    it('does not repeat the same repo failure every cycle', () => {
      const el = createAppShell();
      const event = {
        repoPath: '/repo/one',
        success: false,
        behind: 0,
        ahead: 0,
        message: 'boom',
      };

      (el as any).handleAutoFetchCompleted(event);
      (el as any).handleAutoFetchCompleted(event);
      (el as any).handleAutoFetchCompleted(event);

      expect(uiStore.getState().toasts.length, 'reported once, not per cycle').to.equal(1);
    });

    it('speaks again after a recovery', () => {
      const el = createAppShell();

      (el as any).handleAutoFetchCompleted({
        repoPath: '/repo/one', success: false, behind: 0, ahead: 0, message: 'boom',
      });
      (el as any).handleAutoFetchCompleted({
        repoPath: '/repo/one', success: true, behind: 0, ahead: 0,
      });
      (el as any).handleAutoFetchCompleted({
        repoPath: '/repo/one', success: false, behind: 0, ahead: 0, message: 'boom again',
      });

      const toasts = uiStore.getState().toasts;
      expect(toasts.length).to.equal(2);
      expect(toasts[1].message).to.contain('boom again');
    });

    it('reports each repo separately', () => {
      const el = createAppShell();

      (el as any).handleAutoFetchCompleted({
        repoPath: '/repo/one', success: false, behind: 0, ahead: 0, message: 'boom',
      });
      (el as any).handleAutoFetchCompleted({
        repoPath: '/repo/two', success: false, behind: 0, ahead: 0, message: 'boom',
      });

      expect(uiStore.getState().toasts.length).to.equal(2);
    });
  });

  describe('create branch is reachable without a mouse', () => {
    it('the command palette offers Create branch, like Create tag', () => {
      const el = shellOnRepo();

      const ids = (el as any)
        .getPaletteCommands()
        .map((c: { id: string }) => c.id);

      expect(ids, 'Create tag was there all along').to.include('create-tag');
      expect(ids, 'Create branch was mouse-only').to.include('create-branch');
    });

    it('registers the Ctrl+Shift+N shortcut', async () => {
      // registerDefaultShortcuts only registers new-branch `if
      // (actions.createBranch)`, and app-shell never passed one — so the
      // shortcut was never registered, did nothing when pressed, and never
      // appeared in the shortcuts-help dialog.
      const { keyboardService } = await import('../services/keyboard.service.ts');
      const el = shellOnRepo();
      document.body.appendChild(el);
      try {
        await (el as any).updateComplete;
        // getAllShortcuts() returns bindings, not ids — match on the
        // description registerDefaultShortcuts gives this one.
        const newBranch = keyboardService
          .getAllShortcuts()
          .find((sc) => sc.description === 'Create new branch');
        expect(newBranch, 'Ctrl+Shift+N registered').to.not.be.undefined;
        expect(newBranch!.ctrl).to.equal(true);
        expect(newBranch!.shift).to.equal(true);
        expect(newBranch!.key).to.equal('n');
      } finally {
        el.remove();
      }
    });
  });
});
