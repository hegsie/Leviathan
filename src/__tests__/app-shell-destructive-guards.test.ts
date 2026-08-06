/**
 * Guards on two destructive gestures in app-shell.
 *
 * Amend ONLY ever rewrites HEAD — create_commit re-parents
 * `repo.head()?.peel_to_commit()` regardless of which commit the UI believes
 * it is amending. The graph's Amend entry trusted the clicked commit, so
 * amending an older one replaced HEAD instead: HEAD's message became the
 * clicked commit's, staged changes were folded into HEAD, and the commit the
 * user right-clicked was untouched. Reword had always performed the HEAD
 * check; amend was left behind.
 *
 * The Abort banner's double-click flag was claimed AFTER its confirm, so it
 * did not guard the case its own comment named.
 */

const invokeCallArgs: Array<{ command: string; args: Record<string, unknown> }> = [];
const mockResponses: Record<string, (args: Record<string, unknown>) => unknown> = {};

let cbId = 0;
(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: Record<string, unknown>) => {
    invokeCallArgs.push({ command, args: args || {} });
    const handler = mockResponses[command];
    return Promise.resolve(handler ? handler(args || {}) : null);
  },
  transformCallback: () => cbId++,
};

import { expect } from '@open-wc/testing';
import type { AppShell } from '../app-shell.ts';
import '../app-shell.ts';
import { uiStore, repositoryStore } from '../stores/index.ts';
import type { Repository } from '../types/git.types.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

function mockRepo(path: string, name: string, state = 'clean'): Repository {
  return {
    path,
    name,
    isValid: true,
    isBare: false,
    headRef: 'main',
    state,
    isShallow: false,
    isPartialClone: false,
    cloneFilter: null,
  } as Repository;
}

function commit(oid: string) {
  return { oid, summary: `summary of ${oid}`, body: null };
}

describe('app-shell destructive guards', () => {
  beforeEach(() => {
    invokeCallArgs.length = 0;
    for (const k of Object.keys(mockResponses)) delete mockResponses[k];
    uiStore.setState({ toasts: [] });
    repositoryStore.getState().reset();
  });

  afterEach(() => {
    repositoryStore.getState().reset();
  });

  function shellOnRepo(state = 'clean'): AppShell {
    const el = document.createElement('lv-app-shell') as AppShell;
    (el as any).activeRepository = { repository: mockRepo('/repo/one', 'one', state) };
    return el;
  }

  describe('amend from the graph context menu', () => {
    it('does not put a non-HEAD commit into amend mode', async () => {
      mockResponses['get_commit_history'] = () => [commit('headoid')];
      const el = shellOnRepo();
      (el as any).contextMenu = { visible: true, x: 0, y: 0, commit: commit('olderoid') };

      let amended: string | null = null;
      const handler = (e: Event): void => {
        amended = (e as CustomEvent<{ commit: { oid: string } }>).detail.commit.oid;
      };
      window.addEventListener('trigger-amend', handler);
      try {
        await (el as any).handleQuickAmend();
      } finally {
        window.removeEventListener('trigger-amend', handler);
      }

      expect(amended, 'amend mode would have rewritten HEAD, not this commit').to.be.null;
    });

    it('routes a non-HEAD commit to interactive rebase instead of dead-ending', async () => {
      mockResponses['get_commit_history'] = () => [commit('headoid')];
      const el = shellOnRepo();
      (el as any).contextMenu = { visible: true, x: 0, y: 0, commit: commit('olderoid') };

      let openedOnto: string | null = null;
      let rewordOid: string | undefined;
      // `interactiveRebaseDialog` is a @query getter, so it has to be shadowed
      // on the instance rather than assigned.
      Object.defineProperty(el, 'interactiveRebaseDialog', {
        configurable: true,
        get: () => ({
          open: (onto: string, opts?: { rewordCommitOid?: string }) => {
            openedOnto = onto;
            rewordOid = opts?.rewordCommitOid;
            return Promise.resolve();
          },
        }),
      });

      await (el as any).handleQuickAmend();

      expect(openedOnto).to.equal('olderoid^');
      expect(rewordOid).to.equal('olderoid');
      expect(
        uiStore.getState().toasts.some((t) => /latest commit can be amended/i.test(t.message)),
        'and says why the gesture was redirected',
      ).to.equal(true);
    });

    it('still amends when the clicked commit IS HEAD', async () => {
      mockResponses['get_commit_history'] = () => [commit('headoid')];
      const el = shellOnRepo();
      (el as any).contextMenu = { visible: true, x: 0, y: 0, commit: commit('headoid') };

      let amended: string | null = null;
      const handler = (e: Event): void => {
        amended = (e as CustomEvent<{ commit: { oid: string } }>).detail.commit.oid;
      };
      window.addEventListener('trigger-amend', handler);
      try {
        await (el as any).handleQuickAmend();
      } finally {
        window.removeEventListener('trigger-amend', handler);
      }

      expect(amended).to.equal('headoid');
    });

    it('reveals the panel that owns the listener before dispatching', async () => {
      // trigger-amend is heard only by lv-commit-panel, in the right panel's
      // Changes tab. Right-clicking a commit selects it first, and a new
      // selection auto-switches that panel to Details — so amend mode was
      // turned on inside a tab-panel with display:none and the gesture looked
      // like it did nothing. With the panel hidden entirely there was no
      // listener at all.
      mockResponses['get_commit_history'] = () => [commit('headoid')];
      const el = shellOnRepo();
      document.body.appendChild(el);
      try {
        await (el as any).updateComplete;
        if ((el as any).rightPanelVisible) {
          const { uiStore: ui } = await import('../stores/index.ts');
          ui.getState().togglePanel('right');
          await (el as any).updateComplete;
        }
        expect((el as any).rightPanelVisible, 'panel starts hidden').to.equal(false);

        (el as any).contextMenu = { visible: true, x: 0, y: 0, commit: commit('headoid') };

        // The ordering is the whole fix: the panel that owns the listener has
        // to be visible BEFORE the event fires, or amend mode is turned on in
        // a component that is unmounted (or in a hidden tab).
        let visibleWhenDispatched: boolean | null = null;
        const onAmend = (): void => {
          visibleWhenDispatched = (el as any).rightPanelVisible;
        };
        window.addEventListener('trigger-amend', onAmend);
        try {
          await (el as any).handleQuickAmend();
        } finally {
          window.removeEventListener('trigger-amend', onAmend);
        }

        expect(visibleWhenDispatched, 'the event fired').to.not.be.null;
        expect(visibleWhenDispatched, 'and the panel was already up').to.equal(true);
        expect((el as any).rightPanelVisible, 'panel revealed').to.equal(true);
      } finally {
        el.remove();
      }
    });

    it('a repository switch during the history lookup cancels the amend', async () => {
      let release!: (v: unknown) => void;
      mockResponses['get_commit_history'] = () =>
        new Promise((r) => {
          release = r;
        });
      const el = shellOnRepo();
      (el as any).contextMenu = { visible: true, x: 0, y: 0, commit: commit('headoid') };

      let amended = false;
      const handler = (): void => {
        amended = true;
      };
      window.addEventListener('trigger-amend', handler);
      try {
        const running = (el as any).handleQuickAmend();
        (el as any).activeRepository = { repository: mockRepo('/repo/two', 'two') };
        release([commit('headoid')]);
        await running;
      } finally {
        window.removeEventListener('trigger-amend', handler);
      }

      expect(amended, 'the commit panel binds to the live repo').to.equal(false);
    });
  });

  describe('the Abort banner double-click guard', () => {
    it('a double-click raises one confirm and runs one abort', async () => {
      // The flag used to be claimed after the confirm, and there is an IPC
      // round trip between the click and the native dialog taking focus — so a
      // second click landed while it was still false.
      let confirms = 0;
      mockResponses['plugin:dialog|message'] = () => {
        confirms++;
        return 'Ok';
      };
      const el = shellOnRepo('merge');

      await Promise.all([
        (el as any).handleAbortOperation(),
        (el as any).handleAbortOperation(),
      ]);

      expect(confirms, 'one prompt, not two').to.equal(1);
      expect(
        invokeCallArgs.filter((c) => c.command === 'abort_merge').length,
        'the second abort would run against an already-restored tree',
      ).to.equal(1);
    });

    it('declining releases the guard so Abort still works afterwards', async () => {
      mockResponses['plugin:dialog|message'] = () => 'Cancel';
      const el = shellOnRepo('merge');

      await (el as any).handleAbortOperation();
      expect(invokeCallArgs.some((c) => c.command === 'abort_merge')).to.equal(false);

      mockResponses['plugin:dialog|message'] = () => 'Ok';
      await (el as any).handleAbortOperation();

      expect(
        invokeCallArgs.filter((c) => c.command === 'abort_merge').length,
        'a declined abort must not wedge the button',
      ).to.equal(1);
    });

    it('an unabortable state is rejected without claiming the guard', async () => {
      mockResponses['plugin:dialog|message'] = () => 'Ok';
      const el = shellOnRepo('clean');

      await (el as any).handleAbortOperation();

      expect((el as any).abortInProgress, 'the flag is not left set').to.equal(false);
      expect(invokeCallArgs.some((c) => c.command.startsWith('abort_'))).to.equal(false);
    });
  });

  describe('closing the diff pane with unsaved editor text', () => {
    function shellWithDirtyEditor(path: string): AppShell {
      const el = shellOnRepo();
      // `diffView` is a @query getter, so it has to be shadowed on the
      // instance. This stands in for a mounted lv-diff-view whose inline
      // editor holds typed text.
      Object.defineProperty(el, 'diffView', {
        configurable: true,
        get: () => ({ hasUnsavedEdits: true, editingPath: path }),
      });
      (el as any).showDiff = true;
      return el;
    }

    it('the × button says the edits were discarded rather than dropping them silently', async () => {
      // The editor guards every teardown it can see — Cancel confirms, a file
      // change warns — but ×, Escape and a tab switch are owned by app-shell
      // and just set showDiff = false, unmounting the editor with the text in
      // it. Escape is the sharpest case: the editor says "Esc to cancel" while
      // the header says "Close diff (Esc)".
      const el = shellWithDirtyEditor('src/main.ts');
      uiStore.setState({ toasts: [] });

      (el as any).handleCloseDiff();

      const warning = uiStore.getState().toasts.find((t) => t.type === 'warning');
      expect(warning, 'the loss is reported').to.not.be.undefined;
      expect(warning!.message).to.contain('src/main.ts');
      expect((el as any).showDiff, 'and the pane still closes').to.equal(false);
    });

    it('a clean editor closes quietly', async () => {
      const el = shellOnRepo();
      Object.defineProperty(el, 'diffView', {
        configurable: true,
        get: () => ({ hasUnsavedEdits: false, editingPath: null }),
      });
      (el as any).showDiff = true;
      uiStore.setState({ toasts: [] });

      (el as any).handleCloseDiff();

      expect(uiStore.getState().toasts.length, 'nothing was lost, so nothing is said').to.equal(0);
    });

    it('opening Blame from the commit panel warns the same way', async () => {
      // A fourth app-shell-owned gesture that unmounts the same pane. The ×
      // and the tab switch were guarded; this one swaps lv-diff-view for
      // lv-blame-view through the same `showDiff = false`.
      const el = shellWithDirtyEditor('src/main.ts');
      uiStore.setState({ toasts: [] });

      (el as any).handleShowBlame(
        new CustomEvent('show-blame', { detail: { filePath: 'src/other.ts' } }),
      );

      const warning = uiStore.getState().toasts.find((t) => t.type === 'warning');
      expect(warning, 'the loss is reported').to.not.be.undefined;
      expect(warning!.message).to.contain('src/main.ts');
      expect((el as any).showBlame, 'and blame still opens').to.equal(true);
    });

    it('closing with no diff open says nothing', async () => {
      const el = shellOnRepo();
      uiStore.setState({ toasts: [] });

      (el as any).handleCloseDiff();

      expect(uiStore.getState().toasts.length).to.equal(0);
    });
  });
});
