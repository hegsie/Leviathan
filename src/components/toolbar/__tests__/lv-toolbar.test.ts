/**
 * Tests for the repository tab bar: labels/tooltips, duplicate-name
 * disambiguation, active styling, status badges, the all-repos dropdown,
 * middle-click close, and the tab context menu.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
let cbId = 0;
(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: () => Promise.resolve(null),
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import type { LvToolbar } from '../lv-toolbar.ts';
import '../lv-toolbar.ts';
import { repositoryStore } from '../../../stores/index.ts';
import type { Repository, Branch, StatusEntry } from '../../../types/git.types.ts';

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

async function createToolbar(): Promise<LvToolbar> {
  return fixture<LvToolbar>(html`<lv-toolbar></lv-toolbar>`);
}

function tabs(el: LvToolbar): HTMLButtonElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll('.tab'));
}

describe('lv-toolbar repository tabs', () => {
  beforeEach(() => {
    repositoryStore.getState().reset();
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
});
