/**
 * Comprehensive tests for lv-stash-list component.
 *
 * These render the REAL lv-stash-list component, mock only the Tauri invoke
 * layer, and verify the actual component code calls the right commands in the
 * right order.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
const invokeHistory: Array<{ command: string; args?: unknown }> = [];
let mockInvoke: MockInvoke = () => Promise.resolve(null);

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeHistory.push({ command, args });
    return mockInvoke(command, args);
  },
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import type { LvStashList } from '../sidebar/lv-stash-list.ts';
import '../sidebar/lv-stash-list.ts';

// ── Test data ──────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

const mockStashes = [
  { index: 0, message: 'WIP on main: abc123 first commit', branchName: 'main' },
  { index: 1, message: 'WIP on feature: def456 second commit', branchName: 'feature' },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function clearHistory(): void {
  invokeHistory.length = 0;
}

function findCommands(name: string): Array<{ command: string; args?: unknown }> {
  return invokeHistory.filter((h) => h.command === name);
}

function setupDefaultMocks(stashes = mockStashes): void {
  mockInvoke = async (command: string) => {
    switch (command) {
      case 'get_stashes':
        return stashes;
      case 'create_stash':
        return null;
      case 'apply_stash':
        return null;
      case 'pop_stash':
        return null;
      case 'drop_stash':
        return null;
      case 'plugin:dialog|confirm':
        return true;
      default:
        return null;
    }
  };
}

async function renderStashList(): Promise<LvStashList> {
  const el = await fixture<LvStashList>(
    html`<lv-stash-list .repositoryPath=${REPO_PATH}></lv-stash-list>`
  );
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 50));
  await el.updateComplete;
  return el;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-stash-list', () => {
  beforeEach(() => {
    clearHistory();
    setupDefaultMocks();
  });

  // ── 1. Rendering ──────────────────────────────────────────────────────
  describe('rendering', () => {
    it('renders stash items with correct count', async () => {
      const el = await renderStashList();

      const stashItems = el.shadowRoot!.querySelectorAll('.stash-item');
      expect(stashItems.length).to.equal(mockStashes.length);
    });

    it('each stash shows .stash-message and .stash-index', async () => {
      const el = await renderStashList();

      const messages = el.shadowRoot!.querySelectorAll('.stash-message');
      const indices = el.shadowRoot!.querySelectorAll('.stash-index');
      expect(messages.length).to.equal(mockStashes.length);
      expect(indices.length).to.equal(mockStashes.length);

      expect(messages[0].textContent?.trim()).to.include('first commit');
      expect(indices[0].textContent?.trim()).to.include('stash@{0}');
    });
  });

  // ── 2. Empty state ──────────────────────────────────────────────────
  describe('empty state', () => {
    it('no stashes shows .empty element', async () => {
      setupDefaultMocks([]);
      const el = await renderStashList();

      const empty = el.shadowRoot!.querySelector('.empty');
      expect(empty).to.not.be.null;
      expect(empty!.textContent?.trim()).to.equal('No stashes');
    });
  });

  // ── 3. Loading state ────────────────────────────────────────────────
  describe('loading state', () => {
    it('shows .loading during initial fetch', async () => {
      mockInvoke = async (command: string) => {
        if (command === 'get_stashes') {
          await new Promise((r) => setTimeout(r, 500));
          return mockStashes;
        }
        return null;
      };

      const el = await fixture<LvStashList>(
        html`<lv-stash-list .repositoryPath=${REPO_PATH}></lv-stash-list>`
      );
      await el.updateComplete;

      const loading = el.shadowRoot!.querySelector('.loading');
      expect(loading).to.not.be.null;
      expect(loading!.textContent?.trim()).to.include('Loading');
    });
  });

  // ── 4. Context menu ──────────────────────────────────────────────────
  describe('context menu', () => {
    it('right-click stash shows .context-menu', async () => {
      const el = await renderStashList();

      expect(el.shadowRoot!.querySelector('.context-menu')).to.be.null;

      const stashItem = el.shadowRoot!.querySelector('.stash-item') as HTMLElement;
      stashItem.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      expect(el.shadowRoot!.querySelector('.context-menu')).to.not.be.null;
    });

    it('menu has Apply, Pop, Drop items', async () => {
      const el = await renderStashList();

      const stashItem = el.shadowRoot!.querySelector('.stash-item') as HTMLElement;
      stashItem.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      const menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const labels = Array.from(menuItems).map((item) => item.textContent?.trim());
      expect(labels).to.include('Apply');
      expect(labels).to.include('Pop');
      expect(labels).to.include('Drop');
    });

    it('Drop has .danger class', async () => {
      const el = await renderStashList();

      const stashItem = el.shadowRoot!.querySelector('.stash-item') as HTMLElement;
      stashItem.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      const menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const dropBtn = Array.from(menuItems).find(
        (item) => item.textContent?.trim() === 'Drop'
      );
      expect(dropBtn).to.not.be.undefined;
      expect(dropBtn!.classList.contains('danger')).to.be.true;
    });
  });

  // ── 5. Stash operations ─────────────────────────────────────────────
  describe('stash operations', () => {
    it('click Apply calls apply_stash with correct index', async () => {
      const el = await renderStashList();

      const stashItem = el.shadowRoot!.querySelector('.stash-item') as HTMLElement;
      stashItem.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      clearHistory();

      const menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const applyBtn = Array.from(menuItems).find(
        (item) => item.textContent?.trim() === 'Apply'
      ) as HTMLElement;
      applyBtn.click();

      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const applyCalls = findCommands('apply_stash');
      expect(applyCalls.length).to.equal(1);
      expect(applyCalls[0].args).to.deep.include({ index: 0, path: REPO_PATH });
    });

    it('click Pop calls pop_stash with correct index', async () => {
      const el = await renderStashList();

      const stashItem = el.shadowRoot!.querySelector('.stash-item') as HTMLElement;
      stashItem.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      clearHistory();

      const menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const popBtn = Array.from(menuItems).find(
        (item) => item.textContent?.trim() === 'Pop'
      ) as HTMLElement;
      popBtn.click();

      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const popCalls = findCommands('pop_stash');
      expect(popCalls.length).to.equal(1);
      expect(popCalls[0].args).to.deep.include({ index: 0, path: REPO_PATH });
    });

    it('click Drop calls drop_stash after confirmation', async () => {
      const el = await renderStashList();

      const stashItem = el.shadowRoot!.querySelector('.stash-item') as HTMLElement;
      stashItem.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      clearHistory();

      const menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const dropBtn = Array.from(menuItems).find(
        (item) => item.textContent?.trim() === 'Drop'
      ) as HTMLElement;
      dropBtn.click();

      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const dropCalls = findCommands('drop_stash');
      expect(dropCalls.length).to.equal(1);
      expect(dropCalls[0].args).to.deep.include({ index: 0, path: REPO_PATH });
    });
  });

  // ── 6. operationInProgress guard ──────────────────────────────────────
  describe('operationInProgress guard', () => {
    it('prevents concurrent stash operations', async () => {
      let applyCallCount = 0;
      let resolveApply: (() => void) | null = null;

      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_stashes':
            return mockStashes;
          case 'apply_stash':
            applyCallCount++;
            if (applyCallCount === 1) {
              await new Promise<void>((r) => { resolveApply = r; });
            }
            return null;
          default:
            return null;
        }
      };

      const el = await renderStashList();

      // Open context menu and click Apply
      const stashItem = el.shadowRoot!.querySelector('.stash-item') as HTMLElement;
      stashItem.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      const menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const applyBtn = Array.from(menuItems).find(
        (item) => item.textContent?.trim() === 'Apply'
      ) as HTMLElement;
      applyBtn.click();
      await new Promise((r) => setTimeout(r, 20));

      // Try Apply again — should be blocked
      stashItem.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      const menuItems2 = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const applyBtn2 = Array.from(menuItems2).find(
        (item) => item.textContent?.trim() === 'Apply'
      ) as HTMLElement;
      applyBtn2.click();
      await new Promise((r) => setTimeout(r, 20));

      expect(applyCallCount).to.equal(1);

      // Unblock
      (resolveApply as (() => void) | null)?.();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;
    });

    it('context menu items are disabled during operation', async () => {
      let resolveApply: (() => void) | null = null;

      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_stashes':
            return mockStashes;
          case 'apply_stash':
            await new Promise<void>((r) => { resolveApply = r; });
            return null;
          default:
            return null;
        }
      };

      const el = await renderStashList();

      // Open context menu and start Apply
      const stashItem = el.shadowRoot!.querySelector('.stash-item') as HTMLElement;
      stashItem.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      const menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const applyBtn = Array.from(menuItems).find(
        (item) => item.textContent?.trim() === 'Apply'
      ) as HTMLElement;
      applyBtn.click();
      await new Promise((r) => setTimeout(r, 20));
      await el.updateComplete;

      // Re-open context menu
      stashItem.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      // Check disabled state
      const popBtn = Array.from(el.shadowRoot!.querySelectorAll('.context-menu-item')).find(
        (item) => item.textContent?.trim() === 'Pop'
      ) as HTMLButtonElement;
      expect(popBtn.disabled).to.be.true;

      const dropBtn = Array.from(el.shadowRoot!.querySelectorAll('.context-menu-item')).find(
        (item) => item.textContent?.trim() === 'Drop'
      ) as HTMLButtonElement;
      expect(dropBtn.disabled).to.be.true;

      // Unblock
      (resolveApply as (() => void) | null)?.();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;
    });
  });
});
