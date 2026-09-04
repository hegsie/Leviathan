/**
 * Tests for the repository tab bar: labels/tooltips, duplicate-name
 * disambiguation, active styling, status badges, the all-repos dropdown,
 * middle-click close, and the tab context menu.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
let cbId = 0;
let mockInvoke: (command: string, args?: unknown) => Promise<unknown> = () => Promise.resolve(null);
(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => mockInvoke(command, args),
  transformCallback: () => cbId++,
};
(globalThis as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  convertCallback: () => 0,
  unregisterListener: () => {},
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import type { LvToolbar } from '../lv-toolbar.ts';
import '../lv-toolbar.ts';
import { repositoryStore, uiStore } from '../../../stores/index.ts';
import type { Repository, Branch, Remote, StatusEntry } from '../../../types/git.types.ts';
import {
  resetRefOpLocks,
  tryAcquireRefOp,
  tryAcquirePush,
  releaseRefOp,
  releasePush,
} from '../../../utils/ref-lock.ts';

function mockRepo(path: string, name: string): Repository {
  return {
    path,
    name,
    isValid: true,
    isBare: false,
    headRef: 'main',
    detachedHeadOid: null,
    state: 'clean',
    isShallow: false,
    isPartialClone: false,
    cloneFilter: null,
  };
}

function mockBranch(aheadBehind?: { ahead: number; behind: number }): Branch {
  return {
    name: 'main',
    shorthand: 'main',
    isHead: true,
    isRemote: false,
    upstream: 'origin/main',
    targetOid: 'abc123',
    aheadBehind,
    isStale: false,
  };
}

const dirtyEntry = { path: 'a.txt', status: 'modified', isStaged: false } as unknown as StatusEntry;

const originRemote: Remote = {
  name: 'origin',
  url: 'https://example.com/test/repo.git',
  pushUrl: null,
};

async function createToolbar(): Promise<LvToolbar> {
  return fixture<LvToolbar>(html`<lv-toolbar></lv-toolbar>`);
}

function tabs(el: LvToolbar): HTMLButtonElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll('.tab'));
}

describe('lv-toolbar repository tabs', () => {
  beforeEach(() => {
    repositoryStore.getState().reset();
    mockInvoke = () => Promise.resolve(null);
  });

  describe('tab rendering', () => {
    it('shows the full path as a tooltip on every tab', async () => {
      repositoryStore.getState().addRepository(mockRepo('/work/api', 'api'));
      const el = await createToolbar();

      expect(tabs(el)[0].title).to.equal('/work/api');
    });

    it('disambiguates duplicate repo names on Windows-style paths', async () => {
      repositoryStore.getState().addRepository(mockRepo('C:\\work\\client-a\\api', 'api'));
      repositoryStore.getState().addRepository(mockRepo('C:\\work\\client-b\\api', 'api'));
      const el = await createToolbar();

      const hints = tabs(el).map((t) => t.querySelector('.tab-hint')?.textContent?.trim() ?? null);
      expect(hints[0]).to.equal('client-a');
      expect(hints[1]).to.equal('client-b');
    });

    it('disambiguates duplicate repo names with the parent directory', async () => {
      repositoryStore.getState().addRepository(mockRepo('/client-a/api', 'api'));
      repositoryStore.getState().addRepository(mockRepo('/client-b/api', 'api'));
      repositoryStore.getState().addRepository(mockRepo('/work/web', 'web'));
      const el = await createToolbar();

      const hints = tabs(el).map((t) => t.querySelector('.tab-hint')?.textContent?.trim() ?? null);
      expect(hints[0]).to.equal('client-a');
      expect(hints[1]).to.equal('client-b');
      expect(hints[2]).to.equal(null, 'unique names need no hint');
    });

    it('marks the active tab with class, aria-selected and an accent', async () => {
      repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
      repositoryStore.getState().addRepository(mockRepo('/repo/two', 'two'));
      const el = await createToolbar();

      const [first, second] = tabs(el);
      expect(second.classList.contains('active')).to.be.true;
      expect(second.getAttribute('aria-selected')).to.equal('true');
      expect(first.classList.contains('active')).to.be.false;
      expect(first.getAttribute('aria-selected')).to.equal('false');
    });
  });

  describe('tab badges', () => {
    it('shows a dirty dot when the repo has uncommitted changes', async () => {
      repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
      repositoryStore.getState().updateRepoData('/repo/one', { status: [dirtyEntry] });
      const el = await createToolbar();

      expect(tabs(el)[0].querySelector('.tab-dirty')).to.exist;
    });

    it('shows no dirty dot for a clean repo', async () => {
      repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
      const el = await createToolbar();

      expect(tabs(el)[0].querySelector('.tab-dirty')).to.not.exist;
    });

    it('shows ahead/behind counts when the branch diverges from upstream', async () => {
      repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
      repositoryStore.getState().updateRepoData('/repo/one', {
        currentBranch: mockBranch({ ahead: 2, behind: 1 }),
      });
      const el = await createToolbar();

      const badge = tabs(el)[0].querySelector('.tab-ahead-behind');
      expect(badge).to.exist;
      expect(badge!.textContent).to.contain('↑2');
      expect(badge!.textContent).to.contain('↓1');
    });

    it('shows no ahead/behind badge when in sync', async () => {
      repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
      repositoryStore.getState().updateRepoData('/repo/one', {
        currentBranch: mockBranch({ ahead: 0, behind: 0 }),
      });
      const el = await createToolbar();

      expect(tabs(el)[0].querySelector('.tab-ahead-behind')).to.not.exist;
    });
  });

  describe('all-repositories dropdown', () => {
    it('lists every open repo with its path and activates on click', async () => {
      repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
      repositoryStore.getState().addRepository(mockRepo('/repo/two', 'two'));
      const el = await createToolbar();

      (el.shadowRoot!.querySelector('.tab-list-btn') as HTMLButtonElement).click();
      await el.updateComplete;

      const items = Array.from(el.shadowRoot!.querySelectorAll('.tab-list-item'));
      expect(items.length).to.equal(2);
      expect(items[0].textContent).to.contain('one');
      expect(items[0].querySelector('.item-path')!.textContent).to.contain('/repo/one');
      // Active repo (two) carries the check mark
      expect(items[1].querySelector('.check svg')).to.exist;
      expect(items[0].querySelector('.check svg')).to.not.exist;

      (items[0] as HTMLButtonElement).click();
      await el.updateComplete;

      expect(repositoryStore.getState().activeIndex).to.equal(0);
      expect(el.shadowRoot!.querySelector('.tab-list-menu')).to.not.exist;
    });

    it('is hidden when no repositories are open', async () => {
      const el = await createToolbar();
      expect(el.shadowRoot!.querySelector('.tab-list-btn')).to.not.exist;
    });
  });

  describe('middle-click close', () => {
    it('closes the tab on middle click', async () => {
      repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
      repositoryStore.getState().addRepository(mockRepo('/repo/two', 'two'));
      const el = await createToolbar();

      tabs(el)[0].dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));
      await el.updateComplete;

      const state = repositoryStore.getState();
      expect(state.openRepositories.length).to.equal(1);
      expect(state.openRepositories[0].repository.path).to.equal('/repo/two');
    });

    it('ignores non-middle auxclicks', async () => {
      repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
      const el = await createToolbar();

      tabs(el)[0].dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true }));
      await el.updateComplete;

      expect(repositoryStore.getState().openRepositories.length).to.equal(1);
    });
  });

  describe('tab context menu', () => {
    async function openContextMenu(el: LvToolbar, tabIndex: number): Promise<HTMLElement> {
      tabs(el)[tabIndex].dispatchEvent(
        new MouseEvent('contextmenu', { clientX: 50, clientY: 50, bubbles: true, cancelable: true })
      );
      await el.updateComplete;
      const menu = el.shadowRoot!.querySelector('.tab-context-menu');
      expect(menu).to.exist;
      return menu as HTMLElement;
    }

    function menuItem(menu: HTMLElement, label: string): HTMLButtonElement {
      const item = Array.from(menu.querySelectorAll('.context-menu-item')).find((b) =>
        b.textContent!.includes(label)
      );
      expect(item, `menu item "${label}"`).to.exist;
      return item as HTMLButtonElement;
    }

    beforeEach(() => {
      repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
      repositoryStore.getState().addRepository(mockRepo('/repo/two', 'two'));
      repositoryStore.getState().addRepository(mockRepo('/repo/three', 'three'));
    });

    it('Close closes only that tab', async () => {
      const el = await createToolbar();
      const menu = await openContextMenu(el, 1);

      menuItem(menu, 'Close').click();
      await el.updateComplete;

      const paths = repositoryStore.getState().openRepositories.map((r) => r.repository.path);
      expect(paths).to.deep.equal(['/repo/one', '/repo/three']);
    });

    it('Close Others keeps only the clicked tab', async () => {
      const el = await createToolbar();
      const menu = await openContextMenu(el, 1);

      menuItem(menu, 'Close Others').click();
      await el.updateComplete;

      const paths = repositoryStore.getState().openRepositories.map((r) => r.repository.path);
      expect(paths).to.deep.equal(['/repo/two']);
      expect(repositoryStore.getState().activeIndex).to.equal(0);
    });

    it('Close Tabs to the Right closes everything after the clicked tab', async () => {
      const el = await createToolbar();
      const menu = await openContextMenu(el, 0);

      menuItem(menu, 'Close Tabs to the Right').click();
      await el.updateComplete;

      const paths = repositoryStore.getState().openRepositories.map((r) => r.repository.path);
      expect(paths).to.deep.equal(['/repo/one']);
    });

    it('Close All closes every tab', async () => {
      const el = await createToolbar();
      const menu = await openContextMenu(el, 0);

      menuItem(menu, 'Close All').click();
      await el.updateComplete;

      expect(repositoryStore.getState().openRepositories.length).to.equal(0);
      expect(repositoryStore.getState().activeIndex).to.equal(-1);
    });

    it('disables Close Tabs to the Right on the last tab', async () => {
      const el = await createToolbar();
      const menu = await openContextMenu(el, 2);

      expect(menuItem(menu, 'Close Tabs to the Right').disabled).to.be.true;
    });

    it('closes on Escape without touching any tab', async () => {
      const el = await createToolbar();
      await openContextMenu(el, 0);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await el.updateComplete;

      expect(el.shadowRoot!.querySelector('.tab-context-menu')).to.not.exist;
      expect(repositoryStore.getState().openRepositories.length).to.equal(3);
    });

    it('the all-repositories dropdown also closes on Escape', async () => {
      const el = await createToolbar();
      (el.shadowRoot!.querySelector('.tab-list-btn') as HTMLButtonElement).click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('.tab-list-menu')).to.exist;

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await el.updateComplete;

      expect(el.shadowRoot!.querySelector('.tab-list-menu')).to.not.exist;
    });

    it('closes via the backdrop without touching any tab', async () => {
      const el = await createToolbar();
      await openContextMenu(el, 0);

      (el.shadowRoot!.querySelector('.menu-backdrop') as HTMLElement).click();
      await el.updateComplete;

      expect(el.shadowRoot!.querySelector('.tab-context-menu')).to.not.exist;
      expect(repositoryStore.getState().openRepositories.length).to.equal(3);
    });
  });

  describe('remote operation buttons', () => {
    /** A repo with a remote and an upstream branch — the normal case. */
    function openRemoteRepo(aheadBehind?: { ahead: number; behind: number }): string {
      const path = '/repo/one';
      repositoryStore.getState().addRepository(mockRepo(path, 'one'));
      repositoryStore.getState().updateRepoData(path, {
        remotes: [originRemote],
        currentBranch: mockBranch(aheadBehind),
      });
      return path;
    }

    function remoteBtn(el: LvToolbar, op: 'fetch' | 'pull' | 'push'): HTMLButtonElement {
      const btn = el.shadowRoot!.querySelector(`.remote-btn.${op}`);
      expect(btn, `${op} button`).to.exist;
      return btn as HTMLButtonElement;
    }

    afterEach(() => {
      resetRefOpLocks();
    });

    it('renders Fetch, Pull and Push with labels and shortcut hints', async () => {
      openRemoteRepo({ ahead: 0, behind: 0 });
      const el = await createToolbar();

      const group = el.shadowRoot!.querySelector('.remote-actions');
      expect(group, 'remote actions group').to.exist;
      expect(group!.getAttribute('role')).to.equal('group');

      for (const op of ['fetch', 'pull', 'push'] as const) {
        const btn = remoteBtn(el, op);
        // Accessible name and tooltip agree, and both name the operation
        expect(btn.getAttribute('aria-label')).to.equal(btn.title);
        expect(btn.getAttribute('aria-label')!.toLowerCase()).to.contain(op);
        expect(btn.getAttribute('aria-keyshortcuts')).to.contain('Control+Shift+');
        // Native buttons: reachable and activatable from the keyboard
        expect(btn.tagName).to.equal('BUTTON');
      }
    });

    it('disables all three with an explanation when no repository is open', async () => {
      const el = await createToolbar();

      for (const op of ['fetch', 'pull', 'push'] as const) {
        const btn = remoteBtn(el, op);
        expect(btn.disabled, `${op} disabled`).to.be.true;
        expect(btn.title).to.contain('open a repository first');
      }
    });

    it('disables all three when the repository has no remote', async () => {
      repositoryStore.getState().addRepository(mockRepo('/repo/one', 'one'));
      repositoryStore.getState().updateRepoData('/repo/one', {
        currentBranch: mockBranch({ ahead: 1, behind: 1 }),
      });
      const el = await createToolbar();

      for (const op of ['fetch', 'pull', 'push'] as const) {
        const btn = remoteBtn(el, op);
        expect(btn.disabled, `${op} disabled`).to.be.true;
        expect(btn.title).to.contain('no remote configured');
      }
    });

    it('shows the behind count on Pull and the ahead count on Push', async () => {
      openRemoteRepo({ ahead: 2, behind: 5 });
      const el = await createToolbar();

      const pull = remoteBtn(el, 'pull');
      const push = remoteBtn(el, 'push');
      expect(pull.querySelector('.remote-count')!.textContent!.trim()).to.equal('5');
      expect(push.querySelector('.remote-count')!.textContent!.trim()).to.equal('2');
      expect(pull.title).to.contain('5 incoming commits');
      expect(push.title).to.contain('2 local commits');
      // Something to do — neither is dimmed
      expect(pull.classList.contains('idle')).to.be.false;
      expect(push.classList.contains('idle')).to.be.false;
      // Fetch never carries a count
      expect(remoteBtn(el, 'fetch').querySelector('.remote-count')).to.not.exist;
    });

    it('dims Pull and Push, without disabling them, when there is nothing to do', async () => {
      openRemoteRepo({ ahead: 0, behind: 0 });
      const el = await createToolbar();

      const pull = remoteBtn(el, 'pull');
      const push = remoteBtn(el, 'push');
      expect(pull.classList.contains('idle')).to.be.true;
      expect(push.classList.contains('idle')).to.be.true;
      expect(pull.disabled).to.be.false;
      expect(push.disabled).to.be.false;
      expect(pull.title).to.contain('nothing to pull');
      expect(push.title).to.contain('nothing to push');
      expect(pull.querySelector('.remote-count')).to.not.exist;
      expect(push.querySelector('.remote-count')).to.not.exist;
    });

    it('keeps Push undimmed for a branch that has no upstream yet', async () => {
      const path = '/repo/one';
      repositoryStore.getState().addRepository(mockRepo(path, 'one'));
      repositoryStore.getState().updateRepoData(path, {
        remotes: [originRemote],
        currentBranch: { ...mockBranch(), upstream: null },
      });
      const el = await createToolbar();

      const push = remoteBtn(el, 'push');
      expect(push.disabled).to.be.false;
      expect(push.classList.contains('idle')).to.be.false;
      expect(push.title).to.contain('no upstream yet');
    });

    it('disables Fetch while a fetch is in flight and re-enables it after', async () => {
      const path = openRemoteRepo({ ahead: 0, behind: 0 });
      const el = await createToolbar();

      tryAcquirePush(`fetch:${path}`);
      await el.updateComplete;
      expect(remoteBtn(el, 'fetch').disabled).to.be.true;
      expect(remoteBtn(el, 'fetch').title).to.contain('already in progress');
      // The other two are untouched — a fetch holds no working tree
      expect(remoteBtn(el, 'pull').disabled).to.be.false;
      expect(remoteBtn(el, 'push').disabled).to.be.false;

      releasePush(`fetch:${path}`);
      await el.updateComplete;
      expect(remoteBtn(el, 'fetch').disabled).to.be.false;
    });

    it('disables Pull while any working-tree operation holds the repository', async () => {
      const path = openRemoteRepo({ ahead: 0, behind: 3 });
      const el = await createToolbar();

      tryAcquireRefOp(path);
      await el.updateComplete;
      const pull = remoteBtn(el, 'pull');
      expect(pull.disabled).to.be.true;
      expect(pull.title).to.contain('already running in this repository');

      releaseRefOp(path);
      await el.updateComplete;
      expect(remoteBtn(el, 'pull').disabled).to.be.false;
    });

    it('disables Push while a push holds the repository push slot', async () => {
      const path = openRemoteRepo({ ahead: 2, behind: 0 });
      const el = await createToolbar();

      tryAcquirePush(path);
      await el.updateComplete;
      expect(remoteBtn(el, 'push').disabled).to.be.true;
      expect(remoteBtn(el, 'push').title).to.contain('already in progress');

      releasePush(path);
      await el.updateComplete;
      expect(remoteBtn(el, 'push').disabled).to.be.false;
    });

    it('dispatches the matching remote event so app-shell runs the operation', async () => {
      openRemoteRepo({ ahead: 2, behind: 2 });
      const el = await createToolbar();

      for (const op of ['fetch', 'pull', 'push'] as const) {
        let detected: CustomEvent | null = null;
        const listener = (e: Event) => { detected = e as CustomEvent; };
        el.addEventListener(`remote-${op}`, listener);
        remoteBtn(el, op).click();
        el.removeEventListener(`remote-${op}`, listener);

        expect(detected, `remote-${op} dispatched`).to.not.be.null;
        expect(detected!.bubbles, 'reaches app-shell').to.be.true;
        expect(detected!.composed, 'crosses the shadow boundary').to.be.true;
      }
    });

    it('warns instead of failing silently if a click lands with no remote', async () => {
      const path = openRemoteRepo({ ahead: 1, behind: 0 });
      const el = await createToolbar();
      uiStore.setState({ toasts: [] });

      // The remote disappears (removed from another surface) between the
      // render and the click — the button is still the one the user pressed.
      repositoryStore.getState().updateRepoData(path, { remotes: [] });
      let dispatched = false;
      el.addEventListener('remote-push', () => { dispatched = true; });
      (el as unknown as { handleRemoteAction: (op: string) => void }).handleRemoteAction('push');

      expect(dispatched, 'no operation is started').to.be.false;
      const toast = uiStore.getState().toasts.at(-1);
      expect(toast, 'a warning is shown').to.exist;
      expect(toast!.message).to.contain('No remote configured');
    });

    it('warns instead of failing silently if a click lands with no repository', async () => {
      const el = await createToolbar();
      uiStore.setState({ toasts: [] });

      let dispatched = false;
      el.addEventListener('remote-fetch', () => { dispatched = true; });
      (el as unknown as { handleRemoteAction: (op: string) => void }).handleRemoteAction('fetch');

      expect(dispatched, 'no operation is started').to.be.false;
      const toast = uiStore.getState().toasts.at(-1);
      expect(toast, 'a warning is shown').to.exist;
      expect(toast!.message).to.contain('open a repository');
    });
  });

  describe('open repository failures', () => {
    it('shows a toast (not just a silent store error) when opening fails', async () => {
      // Dialog returns a folder; the open then fails (e.g. not a git repo).
      mockInvoke = (command: string) => {
        if (command === 'plugin:dialog|open') return Promise.resolve('/not/a/repo');
        if (command === 'open_repository') {
          return Promise.reject({ message: 'not a git repository' });
        }
        return Promise.resolve(null);
      };
      uiStore.setState({ toasts: [] });

      const el = await createToolbar();
      await (el as unknown as { handleOpenRepo: () => Promise<void> }).handleOpenRepo();

      const toasts = uiStore.getState().toasts;
      const errorToast = toasts.find(t => t.type === 'error');
      expect(errorToast, 'an error toast is surfaced to the user').to.exist;
      expect(errorToast!.message).to.contain('not a git repository');
      // And the store error is still set for any listener.
      expect(repositoryStore.getState().error).to.contain('not a git repository');
    });
  });
});
