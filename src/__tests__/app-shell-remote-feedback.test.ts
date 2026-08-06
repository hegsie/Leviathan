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

  describe('the security gate does not report itself as a failure', () => {
    it('a declined confirm produces no error toast', async () => {
      const { settingsStore } = await import('../stores/index.ts');
      settingsStore.setState({ confirmNetworkOps: true });
      mockResponses['plugin:dialog|confirm'] = () => 'Cancel';
      mockResponses['plugin:dialog|message'] = () => 'Cancel';
      try {
        const el = shellOnRepo();
        await (el as any).handleFetch();

        expect(
          uiStore.getState().toasts.filter((t) => t.type === 'error').length,
          "the user's own Cancel is not an error",
        ).to.equal(0);
      } finally {
        settingsStore.setState({ confirmNetworkOps: false });
      }
    });

    it('an offline block is announced once by the gate, not twice', async () => {
      const { settingsStore } = await import('../stores/index.ts');
      settingsStore.setState({ offlineMode: true });
      try {
        const el = shellOnRepo();
        await (el as any).handlePush();

        const toasts = uiStore.getState().toasts;
        expect(toasts.length, 'one message, from the gate').to.equal(1);
        expect(toasts[0].message).to.contain('Offline mode');
      } finally {
        settingsStore.setState({ offlineMode: false });
      }
    });
  });

  describe('commands that need a repository say so', () => {
    it('palette network and staging entries are guarded', () => {
      const el = createAppShell();
      (el as any).activeRepository = null;
      const commands = (el as any).getPaletteCommands() as Array<{
        id: string;
        action: () => void;
      }>;

      uiStore.setState({ toasts: [] });
      for (const id of ['fetch', 'pull', 'push', 'stash', 'stage-all', 'unstage-all']) {
        const cmd = commands.find((c) => c.id === id);
        expect(cmd, `${id} present in the palette`).to.not.be.undefined;
        uiStore.setState({ toasts: [] });
        cmd!.action();
        expect(
          uiStore.getState().toasts.length,
          `${id} tells the user a repository is needed`,
        ).to.equal(1);
      }
    });
  });

  describe('a rejected push offers the recovery the app already implements', () => {
    it('being behind the remote carries a Pull Now action', async () => {
      failures['push'] = {
        code: 'COMMAND_ERROR',
        message: 'the remote contains commits that are not present locally',
      };
      const el = shellOnRepo();

      await (el as any).handlePush();

      const toasts = uiStore.getState().toasts;
      expect(toasts.length, 'the failure is reported').to.be.greaterThan(0);
      expect(
        toasts.some((t) => t.action?.label === 'Pull Now'),
        'the Pull Now recovery is reachable from the only push surface',
      ).to.equal(true);
    });

    it('an amended history carries a Force Push action instead', async () => {
      // libgit2's "non-fastforwardable" means YOU rewrote history. Pulling
      // merges the pre-amend commits back in and undoes the amend, so the only
      // correct recovery is a force push — which had no affordance anywhere.
      failures['push'] = {
        code: 'COMMAND_ERROR',
        message: 'cannot push non-fastforwardable reference',
      };
      const el = shellOnRepo();

      await (el as any).handlePush();

      const toasts = uiStore.getState().toasts;
      expect(toasts.some((t) => t.action?.label === 'Force Push')).to.equal(true);
      expect(
        toasts.some((t) => /pull/i.test(t.message)),
        'and does not tell the user to do the thing that undoes their amend',
      ).to.equal(false);
    });
  });

  describe('force push', () => {
    function shellWithStoreRepo(): AppShell {
      const el = shellOnRepo();
      repositoryStore.setState({
        openRepositories: [{ repository: mockRepo('/repo/one', 'one') }],
        activeIndex: 0,
      } as any);
      return el;
    }

    it('asks before replacing the remote branch', async () => {
      mockResponses['plugin:dialog|confirm'] = () => 'Cancel';
      mockResponses['plugin:dialog|message'] = () => 'Cancel';
      const el = shellWithStoreRepo();

      await (el as any).forcePush('/repo/one');

      expect(
        invokeCallArgs.some((c) => c.command === 'push'),
        'declining the confirm blocks the push',
      ).to.equal(false);
    });

    it('uses force-with-lease, not a bare force', async () => {
      // If someone else pushed while the suggestion toast was up, a bare force
      // would silently discard their commits. With-lease refuses instead.
      // confirm() resolves to (message-dialog result === okLabel), and the
      // default ok label is 'Ok'.
      mockResponses['plugin:dialog|confirm'] = () => 'Ok';
      mockResponses['plugin:dialog|message'] = () => 'Ok';
      const el = shellWithStoreRepo();

      await (el as any).forcePush('/repo/one');

      const push = invokeCallArgs.find((c) => c.command === 'push');
      expect(push, 'the push runs once confirmed').to.not.be.undefined;
      expect(push!.args.forceWithLease).to.equal(true);
      expect(push!.args.force).to.not.equal(true);
    });

    it('leaves the success message to the backend event', async () => {
      // The Rust push command emits `remote-operation-completed` and
      // setupRemoteOperationListeners toasts it, naming the branch and remote —
      // which this handler could not. Adding one here stacked two success
      // toasts on a single click, the exact rule handleFetch documents.
      mockResponses['plugin:dialog|confirm'] = () => 'Ok';
      mockResponses['plugin:dialog|message'] = () => 'Ok';
      const el = shellWithStoreRepo();
      uiStore.setState({ toasts: [] });

      await (el as any).forcePush('/repo/one');

      expect(
        uiStore.getState().toasts.filter((t) => t.type === 'success').length,
        'exactly one owner of the success message',
      ).to.equal(0);
    });

    it('the confirm names the branch it is about to overwrite', async () => {
      // This is the one operation in the app that can discard commits belonging
      // to someone else; naming only the repository was not enough.
      let prompt = '';
      mockResponses['plugin:dialog|message'] = (args) => {
        prompt = String(args.message ?? '');
        return 'Cancel';
      };
      mockResponses['plugin:dialog|confirm'] = () => 'Cancel';
      const el = shellOnRepo();
      repositoryStore.setState({
        openRepositories: [
          {
            repository: mockRepo('/repo/one', 'one'),
            currentBranch: { shorthand: 'feature/x', name: 'refs/heads/feature/x' },
          },
        ],
        activeIndex: 0,
      } as any);

      await (el as any).forcePush('/repo/one');

      expect(prompt).to.contain('feature/x');
    });

    it('a force push that is itself rejected does not offer Force Push again', async () => {
      // Routing this through the suggestion service would match the same branch
      // that produced the toast and loop the user back onto the one action that
      // discards remote commits.
      // confirm() resolves to (message-dialog result === okLabel), and the
      // default ok label is 'Ok'.
      mockResponses['plugin:dialog|confirm'] = () => 'Ok';
      mockResponses['plugin:dialog|message'] = () => 'Ok';
      failures['push'] = {
        code: 'COMMAND_ERROR',
        message: 'cannot push non-fastforwardable reference',
      };
      const el = shellWithStoreRepo();

      await (el as any).forcePush('/repo/one');

      expect(
        uiStore.getState().toasts.some((t) => t.action?.label === 'Force Push'),
        'no unbounded loop through the destructive action',
      ).to.equal(false);
    });

    it('force pushing a tag asks first and sends the force flag', async () => {
      // confirm() resolves to (message-dialog result === okLabel), and the
      // default ok label is 'Ok'.
      mockResponses['plugin:dialog|confirm'] = () => 'Ok';
      mockResponses['plugin:dialog|message'] = () => 'Ok';
      const el = shellWithStoreRepo();

      await (el as any).forcePushTag('v1.2.0', '/repo/one');

      const pushTag = invokeCallArgs.find((c) => c.command === 'push_tag');
      expect(pushTag).to.not.be.undefined;
      expect(pushTag!.args.name).to.equal('v1.2.0');
      expect(pushTag!.args.force).to.equal(true);
    });

    it('declining blocks the tag force push', async () => {
      mockResponses['plugin:dialog|confirm'] = () => 'Cancel';
      mockResponses['plugin:dialog|message'] = () => 'Cancel';
      const el = shellWithStoreRepo();

      await (el as any).forcePushTag('v1.2.0', '/repo/one');

      expect(invokeCallArgs.some((c) => c.command === 'push_tag')).to.equal(false);
    });

    it('the suggestion action reaches the handler through the window event', async () => {
      // The suggestion service dispatches on `window`; app-shell has to be
      // listening, or the button is dead.
      mockResponses['plugin:dialog|confirm'] = () => 'Cancel';
      mockResponses['plugin:dialog|message'] = () => 'Cancel';
      const el = shellWithStoreRepo();
      document.body.appendChild(el);
      await (el as any).updateComplete;
      try {
        let reached: string | null = null;
        (el as any).forcePush = (p: string): Promise<void> => {
          reached = p;
          return Promise.resolve();
        };
        window.dispatchEvent(
          new CustomEvent('force-push', { detail: { repoPath: '/repo/one' } }),
        );
        expect(reached, 'the Force Push button is wired to something').to.equal('/repo/one');
      } finally {
        el.remove();
      }
    });
  });

  describe('checking out a tag from the graph warns about detached HEAD', () => {
    it('declining the warning blocks the checkout', async () => {
      mockResponses['plugin:dialog|confirm'] = () => 'Cancel';
      mockResponses['plugin:dialog|message'] = () => 'Cancel';
      const el = shellOnRepo();
      (el as any).refContextMenu = { visible: true, x: 0, y: 0, refName: 'v1.0.0', refType: 'tag' };

      await (el as any).handleRefCheckout();

      expect(
        invokeCallArgs.some((c) => c.command === 'checkout_with_autostash'),
        'HEAD is not detached behind the user',
      ).to.equal(false);
    });

    it('a branch checkout is not gated by the tag warning', async () => {
      mockResponses['plugin:dialog|confirm'] = () => 'Cancel';
      mockResponses['plugin:dialog|message'] = () => 'Cancel';
      const el = shellOnRepo();
      (el as any).refContextMenu = {
        visible: true,
        x: 0,
        y: 0,
        refName: 'feature',
        refType: 'localBranch',
      };

      await (el as any).handleRefCheckout();

      expect(invokeCallArgs.some((c) => c.command === 'checkout_with_autostash')).to.equal(true);
    });
  });

  describe('the graph ref menu confirms before rewriting history', () => {
    async function refMenuShell(): Promise<AppShell> {
      const el = shellOnRepo();
      (el as any).refContextMenu = { visible: true, x: 0, y: 0, refName: 'feature' };
      return el;
    }

    it('merge asks first, and declining blocks it', async () => {
      mockResponses['plugin:dialog|confirm'] = () => 'Cancel';
      mockResponses['plugin:dialog|message'] = () => 'Cancel';
      const el = await refMenuShell();

      await (el as any).handleRefMerge();

      expect(invokeCallArgs.some((c) => c.command === 'merge'), 'declined merge blocked').to.equal(
        false,
      );
    });

    it('rebase asks first, and declining blocks it', async () => {
      mockResponses['plugin:dialog|confirm'] = () => 'Cancel';
      mockResponses['plugin:dialog|message'] = () => 'Cancel';
      const el = await refMenuShell();

      await (el as any).handleRefRebase();

      expect(invokeCallArgs.some((c) => c.command === 'rebase'), 'declined rebase blocked').to.equal(
        false,
      );
    });

    it('accepting the confirm runs the merge', async () => {
      mockResponses['plugin:dialog|confirm'] = () => 'Ok';
      mockResponses['plugin:dialog|message'] = () => 'Ok';
      const el = await refMenuShell();

      await (el as any).handleRefMerge();

      expect(invokeCallArgs.some((c) => c.command === 'merge')).to.equal(true);
    });

    it('a second rebase cannot start while the first is running', async () => {
      mockResponses['plugin:dialog|confirm'] = () => 'Ok';
      mockResponses['plugin:dialog|message'] = () => 'Ok';
      const el = await refMenuShell();
      (el as any).refOperationInFlight = true;

      await (el as any).handleRefRebase();

      expect(
        invokeCallArgs.some((c) => c.command === 'rebase'),
        'no second history rewrite on the same worktree',
      ).to.equal(false);
    });
  });

  describe('shortcuts with no repository open', () => {
    it('Ctrl+Z and Ctrl+Shift+N explain, like their palette twins', async () => {
      const { keyboardService } = await import('../services/keyboard.service.ts');
      const el = createAppShell();
      (el as any).activeRepository = null;
      document.body.appendChild(el);
      try {
        await (el as any).updateComplete;
        for (const description of ['Open reflog', 'Create new branch']) {
          const sc = keyboardService
            .getAllShortcuts()
            .find((s) => s.description === description);
          if (!sc) continue;
          uiStore.setState({ toasts: [] });
          sc.action();
          expect(
            uiStore.getState().toasts.length,
            `${description} tells the user a repository is needed`,
          ).to.equal(1);
        }
      } finally {
        el.remove();
      }
    });
  });

  describe('staging works with the right panel hidden', () => {
    it('reveals the panel that owns the listener before dispatching', async () => {
      // `stage-all` is heard only by lv-file-status, which lives inside the
      // right panel. With Ctrl+J pressed the panel is unmounted, its listener
      // gone, and both the `s` shortcut and the palette entry silently did
      // nothing — with no other way to stage.
      const { uiStore: ui } = await import('../stores/index.ts');
      const el = shellOnRepo();
      document.body.appendChild(el);
      try {
        await (el as any).updateComplete;
        if ((el as any).rightPanelVisible) {
          ui.getState().togglePanel('right');
          await (el as any).updateComplete;
        }
        expect((el as any).rightPanelVisible, 'panel starts hidden').to.equal(false);

        let heard = 0;
        const onStage = (): void => { heard++; };
        window.addEventListener('stage-all', onStage);
        try {
          await (el as any).dispatchToFileStatus('stage-all');
        } finally {
          window.removeEventListener('stage-all', onStage);
        }

        expect((el as any).rightPanelVisible, 'panel revealed').to.equal(true);
        expect(heard, 'event still dispatched').to.equal(1);
      } finally {
        el.remove();
      }
    });

    it('leaves an already-visible panel alone', async () => {
      const { uiStore: ui } = await import('../stores/index.ts');
      const el = shellOnRepo();
      document.body.appendChild(el);
      try {
        await (el as any).updateComplete;
        if (!(el as any).rightPanelVisible) {
          ui.getState().togglePanel('right');
          await (el as any).updateComplete;
        }

        let heard = 0;
        const onUnstage = (): void => { heard++; };
        window.addEventListener('unstage-all', onUnstage);
        try {
          await (el as any).dispatchToFileStatus('unstage-all');
        } finally {
          window.removeEventListener('unstage-all', onUnstage);
        }

        expect((el as any).rightPanelVisible).to.equal(true);
        expect(heard).to.equal(1);
      } finally {
        el.remove();
      }
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
