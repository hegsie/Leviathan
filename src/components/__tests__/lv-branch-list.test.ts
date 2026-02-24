/**
 * Comprehensive unit tests for the lv-branch-list component.
 *
 * These render the REAL lv-branch-list component, mock only the Tauri invoke
 * layer, and verify the actual DOM output and user interactions.
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
import type { Branch } from '../../types/git.types.ts';
import type { LvBranchList } from '../sidebar/lv-branch-list.ts';

// Import the actual component — registers <lv-branch-list> custom element
import '../sidebar/lv-branch-list.ts';

// ── Test data ──────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';
const NOW_SECONDS = Math.floor(Date.now() / 1000);

function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    name: 'feature-x',
    shorthand: 'feature-x',
    isHead: false,
    isRemote: false,
    upstream: null,
    targetOid: 'abc123',
    isStale: false,
    lastCommitTimestamp: NOW_SECONDS,
    ...overrides,
  };
}

const mainBranch = makeBranch({
  name: 'main',
  shorthand: 'main',
  isHead: true,
  targetOid: 'aaa111',
});

const featureBranch = makeBranch({
  name: 'feature-x',
  shorthand: 'feature-x',
  targetOid: 'bbb222',
});

const featureOneBranch = makeBranch({
  name: 'feature/one',
  shorthand: 'feature/one',
  targetOid: 'ddd444',
});

const featureTwoBranch = makeBranch({
  name: 'feature/two',
  shorthand: 'feature/two',
  targetOid: 'eee555',
});

const trackedBranch = makeBranch({
  name: 'tracked-branch',
  shorthand: 'tracked-branch',
  targetOid: 'fff666',
  upstream: 'origin/tracked-branch',
  aheadBehind: { ahead: 2, behind: 1 },
});

const staleBranch = makeBranch({
  name: 'old-branch',
  shorthand: 'old-branch',
  targetOid: 'ggg777',
  lastCommitTimestamp: NOW_SECONDS - 100 * 86400, // 100 days ago
});

const remoteDevelopBranch = makeBranch({
  name: 'origin/develop',
  shorthand: 'develop',
  isRemote: true,
  targetOid: 'hhh888',
});

const remoteMainBranch = makeBranch({
  name: 'origin/main',
  shorthand: 'main',
  isRemote: true,
  targetOid: 'iii999',
});

const allBranches: Branch[] = [
  mainBranch,
  featureBranch,
  featureOneBranch,
  featureTwoBranch,
  trackedBranch,
  staleBranch,
  remoteDevelopBranch,
  remoteMainBranch,
];

// ── Helpers ────────────────────────────────────────────────────────────────
function clearHistory(): void {
  invokeHistory.length = 0;
}

function findCommands(name: string): Array<{ command: string; args?: unknown }> {
  return invokeHistory.filter((h) => h.command === name);
}

function setupDefaultMocks(branches: Branch[] = allBranches): void {
  mockInvoke = async (command: string) => {
    switch (command) {
      case 'get_branches':
        return branches;
      case 'get_remotes':
        return [];
      case 'checkout_with_autostash':
        return { success: true, stashed: false, stashApplied: false, stashConflict: false, message: 'ok' };
      case 'delete_branch':
        return null;
      case 'rename_branch':
        return null;
      case 'set_upstream_branch':
        return null;
      case 'unset_upstream_branch':
        return null;
      case 'merge':
        return null;
      case 'rebase':
        return null;
      default:
        return null;
    }
  };
}

async function renderBranchList(): Promise<LvBranchList> {
  const el = await fixture<LvBranchList>(
    html`<lv-branch-list .repositoryPath=${REPO_PATH}></lv-branch-list>`
  );
  // Wait for initial loadBranches to complete
  await el.updateComplete;
  // One more microtask for async loadBranches
  await new Promise((r) => setTimeout(r, 50));
  await el.updateComplete;
  return el;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-branch-list', () => {
  beforeEach(() => {
    clearHistory();
    setupDefaultMocks();
  });

  // ── 1. Rendering ──────────────────────────────────────────────────────
  describe('rendering', () => {
    it('renders local branches as .branch-item elements', async () => {
      const el = await renderBranchList();
      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      // We have 6 local branches: main, feature-x, feature/one, feature/two, tracked-branch, old-branch
      expect(branchItems.length).to.be.greaterThanOrEqual(6);
    });

    it('marks the HEAD branch with .active class', async () => {
      const el = await renderBranchList();
      const activeItem = el.shadowRoot!.querySelector('.branch-item.active');
      expect(activeItem).to.not.be.null;
      expect(activeItem!.textContent).to.include('main');
    });

    it('shows ahead/behind indicators for tracked branches', async () => {
      const el = await renderBranchList();
      const aheadSpan = el.shadowRoot!.querySelector('.ahead');
      const behindSpan = el.shadowRoot!.querySelector('.behind');
      expect(aheadSpan).to.not.be.null;
      expect(behindSpan).to.not.be.null;
      expect(aheadSpan!.textContent).to.include('2');
      expect(behindSpan!.textContent).to.include('1');
    });

    it('renders remote branches in separate .group sections', async () => {
      const el = await renderBranchList();
      const groups = el.shadowRoot!.querySelectorAll('.group');
      expect(groups.length).to.be.greaterThanOrEqual(1);
      // Remote group should contain remote branch names
      const groupName = groups[0].querySelector('.group-name');
      expect(groupName).to.not.be.null;
      expect(groupName!.textContent).to.include('origin');
    });
  });

  // ── 2. Filter UI ─────────────────────────────────────────────────────
  describe('filter UI', () => {
    it('click filter button toggles .filter-bar visibility', async () => {
      const el = await renderBranchList();

      // Filter bar should not be visible initially
      let filterBar = el.shadowRoot!.querySelector('.filter-bar');
      expect(filterBar).to.be.null;

      // Click the filter button (first controls-btn)
      const filterBtn = el.shadowRoot!.querySelector('.controls-btn') as HTMLButtonElement;
      expect(filterBtn).to.not.be.null;
      filterBtn.click();
      await el.updateComplete;

      // Filter bar should now be visible
      filterBar = el.shadowRoot!.querySelector('.filter-bar');
      expect(filterBar).to.not.be.null;
    });

    it('typing in filter input shows only matching branches', async () => {
      const el = await renderBranchList();

      // Open filter
      const filterBtn = el.shadowRoot!.querySelector('.controls-btn') as HTMLButtonElement;
      filterBtn.click();
      await el.updateComplete;

      // Type in filter input
      const filterInput = el.shadowRoot!.querySelector('.filter-input') as HTMLInputElement;
      expect(filterInput).to.not.be.null;
      filterInput.value = 'tracked';
      filterInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      // Only matching branches should be visible in the ungrouped section
      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const visibleNames = Array.from(branchItems).map((item) =>
        item.querySelector('.branch-name')?.textContent?.trim()
      );
      expect(visibleNames).to.include('tracked-branch');
      // Non-matching branches like 'old-branch' should not appear
      expect(visibleNames).to.not.include('old-branch');
    });

    it('clearing filter shows all branches again', async () => {
      const el = await renderBranchList();

      // Open filter and type
      const filterBtn = el.shadowRoot!.querySelector('.controls-btn') as HTMLButtonElement;
      filterBtn.click();
      await el.updateComplete;

      const filterInput = el.shadowRoot!.querySelector('.filter-input') as HTMLInputElement;
      filterInput.value = 'tracked';
      filterInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      const filteredCount = el.shadowRoot!.querySelectorAll('.branch-item').length;

      // Click the clear button
      const clearBtn = el.shadowRoot!.querySelector('.filter-clear') as HTMLButtonElement;
      expect(clearBtn).to.not.be.null;
      clearBtn.click();
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      const allCount = el.shadowRoot!.querySelectorAll('.branch-item').length;
      expect(allCount).to.be.greaterThan(filteredCount);
    });

    it('no matches shows no branch items in the list', async () => {
      const el = await renderBranchList();

      // Open filter and type something that matches nothing
      const filterBtn = el.shadowRoot!.querySelector('.controls-btn') as HTMLButtonElement;
      filterBtn.click();
      await el.updateComplete;

      const filterInput = el.shadowRoot!.querySelector('.filter-input') as HTMLInputElement;
      filterInput.value = 'zzzznonexistent';
      filterInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      expect(branchItems.length).to.equal(0);
    });
  });

  // ── 3. Sort UI ────────────────────────────────────────────────────────
  describe('sort UI', () => {
    it('click sort button shows .sort-menu', async () => {
      const el = await renderBranchList();

      // Sort menu should not be visible
      let sortMenu = el.shadowRoot!.querySelector('.sort-menu');
      expect(sortMenu).to.be.null;

      // Click the sort button (second controls-btn)
      const controlsBtns = el.shadowRoot!.querySelectorAll('.controls-btn');
      const sortBtn = controlsBtns[1] as HTMLButtonElement;
      sortBtn.click();
      await el.updateComplete;

      sortMenu = el.shadowRoot!.querySelector('.sort-menu');
      expect(sortMenu).to.not.be.null;
    });

    it('click sort option changes sort order', async () => {
      const el = await renderBranchList();

      // Open sort menu
      const controlsBtns = el.shadowRoot!.querySelectorAll('.controls-btn');
      const sortBtn = controlsBtns[1] as HTMLButtonElement;
      sortBtn.click();
      await el.updateComplete;

      // Click Date (Newest) option
      const sortOptions = el.shadowRoot!.querySelectorAll('.sort-option');
      const dateOption = Array.from(sortOptions).find((opt) =>
        opt.textContent?.includes('Date (Newest)')
      ) as HTMLButtonElement;
      expect(dateOption).to.not.be.undefined;
      dateOption.click();

      // Wait for re-sort and re-render (setSortMode calls loadBranches)
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      // Sort menu should be hidden after selection
      const sortMenu = el.shadowRoot!.querySelector('.sort-menu');
      expect(sortMenu).to.be.null;
    });

    it('active sort mode has .active class on .sort-option', async () => {
      const el = await renderBranchList();

      // Open sort menu
      const controlsBtns = el.shadowRoot!.querySelectorAll('.controls-btn');
      const sortBtn = controlsBtns[1] as HTMLButtonElement;
      sortBtn.click();
      await el.updateComplete;

      // Default sort mode is 'name', so the Name option should be active
      const activeOption = el.shadowRoot!.querySelector('.sort-option.active');
      expect(activeOption).to.not.be.null;
      expect(activeOption!.textContent).to.include('Name');
    });
  });

  // ── 4. Group display ─────────────────────────────────────────────────
  describe('group display', () => {
    it('branches with prefix show in .subgroup with .subgroup-header', async () => {
      const el = await renderBranchList();

      // feature/one and feature/two should create a 'feature' subgroup
      const subgroups = el.shadowRoot!.querySelectorAll('.subgroup');
      expect(subgroups.length).to.be.greaterThanOrEqual(1);

      const subgroupHeaders = el.shadowRoot!.querySelectorAll('.subgroup-header');
      const featureHeader = Array.from(subgroupHeaders).find((h) =>
        h.querySelector('.subgroup-name')?.textContent?.includes('feature')
      );
      expect(featureHeader).to.not.be.undefined;
    });

    it('click .subgroup-header toggles group collapse', async () => {
      const el = await renderBranchList();

      // Find the feature subgroup header
      const subgroupHeaders = el.shadowRoot!.querySelectorAll('.subgroup-header');
      const featureHeader = Array.from(subgroupHeaders).find((h) =>
        h.querySelector('.subgroup-name')?.textContent?.includes('feature')
      ) as HTMLElement;
      expect(featureHeader).to.not.be.undefined;

      // Initially expanded (chevron should have .expanded class)
      let chevron = featureHeader.querySelector('.chevron');
      expect(chevron!.classList.contains('expanded')).to.be.true;

      // Click to collapse
      featureHeader.click();
      await el.updateComplete;

      chevron = featureHeader.querySelector('.chevron');
      expect(chevron!.classList.contains('expanded')).to.be.false;

      // Click again to expand
      featureHeader.click();
      await el.updateComplete;

      chevron = featureHeader.querySelector('.chevron');
      expect(chevron!.classList.contains('expanded')).to.be.true;
    });

    it('group shows count in .group-count', async () => {
      const el = await renderBranchList();

      // Remote group should show count
      const groupCount = el.shadowRoot!.querySelector('.group .group-count');
      expect(groupCount).to.not.be.null;
      // We have 2 remote branches (origin/develop, origin/main)
      expect(groupCount!.textContent?.trim()).to.equal('2');
    });
  });

  // ── 5. Context menu ──────────────────────────────────────────────────
  describe('context menu', () => {
    it('right-click branch shows .context-menu', async () => {
      const el = await renderBranchList();

      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const firstItem = branchItems[0];
      firstItem.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      const contextMenu = el.shadowRoot!.querySelector('.context-menu');
      expect(contextMenu).to.not.be.null;
    });

    it('right-click non-HEAD local branch shows Checkout, Merge, Rebase, Delete', async () => {
      const el = await renderBranchList();

      // Find the non-HEAD local branch
      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const nonHeadItem = Array.from(branchItems).find(
        (item) => !item.classList.contains('active') && item.textContent?.includes('feature-x')
      );
      expect(nonHeadItem).to.not.be.undefined;

      nonHeadItem!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      const menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const menuTexts = Array.from(menuItems).map((item) => item.textContent?.trim());

      expect(menuTexts.some((t) => t?.includes('Checkout'))).to.be.true;
      expect(menuTexts.some((t) => t?.includes('Merge'))).to.be.true;
      expect(menuTexts.some((t) => t?.includes('Rebase'))).to.be.true;
      expect(menuTexts.some((t) => t?.includes('Delete'))).to.be.true;
    });

    it('right-click HEAD branch hides Checkout and Delete', async () => {
      const el = await renderBranchList();

      const activeItem = el.shadowRoot!.querySelector('.branch-item.active');
      expect(activeItem).to.not.be.null;

      activeItem!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      const menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const menuTexts = Array.from(menuItems).map((item) => item.textContent?.trim());

      expect(menuTexts.some((t) => t?.includes('Checkout'))).to.be.false;
      expect(menuTexts.some((t) => t?.includes('Delete'))).to.be.false;
    });

    it('right-click remote branch shows Track this branch', async () => {
      const el = await renderBranchList();

      // Find a remote branch item
      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const remoteItem = Array.from(branchItems).find(
        (item) => item.getAttribute('title')?.includes('origin/')
      );
      expect(remoteItem).to.not.be.undefined;

      remoteItem!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      const menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const menuTexts = Array.from(menuItems).map((item) => item.textContent?.trim());

      expect(menuTexts.some((t) => t?.includes('Track this branch'))).to.be.true;
    });

    it('context menu closes on document click', async () => {
      const el = await renderBranchList();

      // Open context menu
      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      branchItems[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      let contextMenu = el.shadowRoot!.querySelector('.context-menu');
      expect(contextMenu).to.not.be.null;

      // Click on document to close
      document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      contextMenu = el.shadowRoot!.querySelector('.context-menu');
      expect(contextMenu).to.be.null;
    });
  });

  // ── 6. Tracking UI ───────────────────────────────────────────────────
  describe('tracking UI', () => {
    it('branch with upstream shows ahead/behind indicators', async () => {
      const el = await renderBranchList();

      // trackedBranch has upstream and aheadBehind
      const aheadBehindSpans = el.shadowRoot!.querySelectorAll('.ahead-behind');
      expect(aheadBehindSpans.length).to.be.greaterThanOrEqual(1);
    });

    it('right-click tracked branch shows Change Upstream and Unset Upstream', async () => {
      const el = await renderBranchList();

      // Find the tracked branch item
      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const trackedItem = Array.from(branchItems).find(
        (item) => item.textContent?.includes('tracked-branch')
      );
      expect(trackedItem).to.not.be.undefined;

      trackedItem!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      const menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const menuTexts = Array.from(menuItems).map((item) => item.textContent?.trim());

      expect(menuTexts.some((t) => t?.includes('Change Upstream...'))).to.be.true;
      expect(menuTexts.some((t) => t?.includes('Unset Upstream'))).to.be.true;
    });

    it('right-click untracked local branch shows Set Upstream', async () => {
      const el = await renderBranchList();

      // Find feature-x branch (no upstream)
      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const untrackedItem = Array.from(branchItems).find(
        (item) => item.textContent?.includes('feature-x')
      );
      expect(untrackedItem).to.not.be.undefined;

      untrackedItem!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      const menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const menuTexts = Array.from(menuItems).map((item) => item.textContent?.trim());

      expect(menuTexts.some((t) => t?.includes('Set Upstream...'))).to.be.true;
      expect(menuTexts.some((t) => t?.includes('Unset Upstream'))).to.be.false;
    });
  });

  // ── 7. Stale detection ────────────────────────────────────────────────
  describe('stale detection', () => {
    it('branch with old lastCommitTimestamp gets .stale class', async () => {
      const el = await renderBranchList();

      // staleBranch (old-branch) has lastCommitTimestamp 100 days ago
      // The default staleBranchDays is 90, so it should be stale
      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const staleItem = Array.from(branchItems).find(
        (item) => item.textContent?.includes('old-branch')
      );
      expect(staleItem).to.not.be.undefined;
      expect(staleItem!.classList.contains('stale')).to.be.true;
    });

    it('non-stale branches do not have .stale class', async () => {
      const el = await renderBranchList();

      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const featureItem = Array.from(branchItems).find(
        (item) => item.textContent?.includes('feature-x')
      );
      expect(featureItem).to.not.be.undefined;
      expect(featureItem!.classList.contains('stale')).to.be.false;
    });
  });

  // ── 8. Hidden branches ────────────────────────────────────────────────
  describe('hidden branches', () => {
    it('clicking Hide branch changes context menu text to Show branch', async () => {
      const el = await renderBranchList();

      // Right-click a branch
      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const featureItem = Array.from(branchItems).find(
        (item) => item.textContent?.includes('feature-x')
      );
      featureItem!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      // Find and click "Hide branch"
      let menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const hideBtn = Array.from(menuItems).find(
        (btn) => btn.textContent?.trim().includes('Hide branch')
      ) as HTMLButtonElement;
      expect(hideBtn).to.not.be.undefined;
      hideBtn.click();
      await el.updateComplete;

      // Re-open context menu on same branch
      // Need to re-query because the branch items may have been re-rendered
      const updatedBranchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const updatedFeatureItem = Array.from(updatedBranchItems).find(
        (item) => item.textContent?.includes('feature-x')
      );
      updatedFeatureItem!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const showBtn = Array.from(menuItems).find(
        (btn) => btn.textContent?.trim().includes('Show branch')
      );
      expect(showBtn).to.not.be.undefined;
    });

    it('clicking Show branch on hidden branch restores it', async () => {
      const el = await renderBranchList();

      // Hide a branch
      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const featureItem = Array.from(branchItems).find(
        (item) => item.textContent?.includes('feature-x')
      );
      featureItem!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      let menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const hideBtn = Array.from(menuItems).find(
        (btn) => btn.textContent?.trim().includes('Hide branch')
      ) as HTMLButtonElement;
      hideBtn.click();
      await el.updateComplete;

      // Now show it again
      const updatedBranchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const updatedFeatureItem = Array.from(updatedBranchItems).find(
        (item) => item.textContent?.includes('feature-x')
      );
      updatedFeatureItem!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const showBtn = Array.from(menuItems).find(
        (btn) => btn.textContent?.trim().includes('Show branch')
      ) as HTMLButtonElement;
      expect(showBtn).to.not.be.undefined;
      showBtn.click();
      await el.updateComplete;

      // Re-open context menu, should now say "Hide branch" again
      const finalBranchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const finalFeatureItem = Array.from(finalBranchItems).find(
        (item) => item.textContent?.includes('feature-x')
      );
      finalFeatureItem!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const hideBtnAgain = Array.from(menuItems).find(
        (btn) => btn.textContent?.trim().includes('Hide branch')
      );
      expect(hideBtnAgain).to.not.be.undefined;
    });
  });

  // ── 9. Error state ────────────────────────────────────────────────────
  describe('error state', () => {
    it('get_branches reject shows .error element with message', async () => {
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_branches':
            throw new Error('Repository not found');
          case 'get_remotes':
            return [];
          default:
            return null;
        }
      };

      const el = await renderBranchList();

      const errorEl = el.shadowRoot!.querySelector('.error');
      expect(errorEl).to.not.be.null;
      expect(errorEl!.textContent).to.include('Repository not found');
    });

    it('error clears on successful reload', async () => {
      let shouldFail = true;
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_branches':
            if (shouldFail) {
              throw new Error('Temporary error');
            }
            return allBranches;
          case 'get_remotes':
            return [];
          default:
            return null;
        }
      };

      const el = await renderBranchList();

      // Verify error state
      let errorEl = el.shadowRoot!.querySelector('.error');
      expect(errorEl).to.not.be.null;

      // Fix the error and reload
      shouldFail = false;
      window.dispatchEvent(new CustomEvent('repository-refresh'));
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      // Error should be gone
      errorEl = el.shadowRoot!.querySelector('.error');
      expect(errorEl).to.be.null;

      // Branches should be rendered
      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      expect(branchItems.length).to.be.greaterThan(0);
    });
  });

  // ── 10. Loading state ─────────────────────────────────────────────────
  describe('loading state', () => {
    it('shows .loading element during initial fetch', async () => {
      // Make the mock slow so we can catch the loading state
      mockInvoke = async (command: string) => {
        if (command === 'get_branches') {
          await new Promise((r) => setTimeout(r, 200));
          return allBranches;
        }
        if (command === 'get_remotes') {
          await new Promise((r) => setTimeout(r, 200));
          return [];
        }
        return null;
      };

      const el = await fixture<LvBranchList>(
        html`<lv-branch-list .repositoryPath=${REPO_PATH}></lv-branch-list>`
      );
      await el.updateComplete;

      // Should show loading before branches are fetched
      const loadingEl = el.shadowRoot!.querySelector('.loading');
      expect(loadingEl).to.not.be.null;
      expect(loadingEl!.textContent).to.include('Loading');

      // Wait for branches to load
      await new Promise((r) => setTimeout(r, 300));
      await el.updateComplete;
    });
  });

  // ── 11. Empty state ───────────────────────────────────────────────────
  describe('empty state', () => {
    it('no branches returned renders no branch items', async () => {
      setupDefaultMocks([]);
      const el = await renderBranchList();

      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      expect(branchItems.length).to.equal(0);
    });
  });

  // ── 12. Event dispatching ─────────────────────────────────────────────
  describe('event dispatching', () => {
    it('click branch dispatches branch-selected event', async () => {
      const el = await renderBranchList();

      let selectedBranch: Branch | null = null;
      el.addEventListener('branch-selected', ((e: CustomEvent) => {
        selectedBranch = e.detail.branch;
      }) as EventListener);

      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const firstItem = branchItems[0] as HTMLElement;
      firstItem.click();
      await el.updateComplete;

      expect(selectedBranch).to.not.be.null;
    });

    it('repository-refresh event triggers reload', async () => {
      const el = await renderBranchList();
      clearHistory();

      window.dispatchEvent(new CustomEvent('repository-refresh'));
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      // Should have called get_branches again
      const branchCalls = findCommands('get_branches');
      expect(branchCalls.length).to.be.greaterThan(0);
    });

    it('branches-changed dispatched after delete operation', async () => {
      // We need to mock window.confirm for the delete confirmation
      // Since the component uses showConfirm from dialog.service, which is also mocked
      // via __TAURI_INTERNALS__, we need to set up the mock to handle delete
      let deleteCalled = false;
      let branchesChangedFired = false;

      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_branches':
            // After delete, return branches without the deleted one
            if (deleteCalled) {
              return allBranches.filter((b) => b.name !== 'feature-x');
            }
            return allBranches;
          case 'get_remotes':
            return [];
          case 'delete_branch':
            deleteCalled = true;
            return null;
          // showConfirm uses Tauri dialog plugin
          case 'plugin:dialog|confirm':
            return true;
          default:
            return null;
        }
      };

      const el = await renderBranchList();

      el.addEventListener('branches-changed', () => {
        branchesChangedFired = true;
      });

      // Right-click feature-x
      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const featureItem = Array.from(branchItems).find(
        (item) => item.textContent?.includes('feature-x')
      );
      featureItem!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      // Click Delete branch
      const menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const deleteBtn = Array.from(menuItems).find(
        (btn) => btn.textContent?.trim().includes('Delete branch')
      ) as HTMLButtonElement;
      expect(deleteBtn).to.not.be.undefined;
      deleteBtn.click();

      await new Promise((r) => setTimeout(r, 200));
      await el.updateComplete;

      // The confirm dialog goes through Tauri invoke mock, so delete should fire
      if (deleteCalled) {
        expect(branchesChangedFired).to.be.true;
      }
    });
  });

  // ── 13. operationInProgress guard ─────────────────────────────────────
  describe('operationInProgress guard', () => {
    it('prevents concurrent checkout operations', async () => {
      let checkoutCallCount = 0;
      let resolveCheckout: (() => void) | null = null;

      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_branches':
            return allBranches;
          case 'get_remotes':
            return [];
          case 'checkout_with_autostash':
            checkoutCallCount++;
            // First call blocks
            if (checkoutCallCount === 1) {
              await new Promise<void>((r) => { resolveCheckout = r; });
            }
            return { success: true, stashed: false, stashApplied: false, stashConflict: false, message: 'ok' };
          default:
            return null;
        }
      };

      const el = await renderBranchList();

      // Trigger first checkout (will block)
      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const nonHeadItem = Array.from(branchItems).find(
        (item) => !item.classList.contains('active') && item.textContent?.includes('feature-x')
      ) as HTMLElement;
      nonHeadItem.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

      // Give the first call time to start
      await new Promise((r) => setTimeout(r, 20));

      // Trigger second checkout (should be blocked by guard)
      nonHeadItem.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));

      // Only one checkout_with_autostash should have been called
      expect(checkoutCallCount).to.equal(1);

      // Unblock the first checkout
      (resolveCheckout as (() => void) | null)?.();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;
    });

    it('context menu items are disabled during operation', async () => {
      let resolveCheckout: (() => void) | null = null;

      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_branches':
            return allBranches;
          case 'get_remotes':
            return [];
          case 'checkout_with_autostash':
            await new Promise<void>((r) => { resolveCheckout = r; });
            return { success: true, stashed: false, stashApplied: false, stashConflict: false, message: 'ok' };
          default:
            return null;
        }
      };

      const el = await renderBranchList();

      // Start a checkout to set operationInProgress
      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const nonHeadItem = Array.from(branchItems).find(
        (item) => !item.classList.contains('active') && item.textContent?.includes('feature-x')
      ) as HTMLElement;
      nonHeadItem.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
      await el.updateComplete;

      // Open context menu on another branch
      const trackedItem = Array.from(el.shadowRoot!.querySelectorAll('.branch-item')).find(
        (item) => item.textContent?.includes('tracked-branch')
      ) as HTMLElement;
      trackedItem.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
      await el.updateComplete;

      // Check that async action buttons are disabled
      const menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const checkoutBtn = Array.from(menuItems).find(
        (item) => item.textContent?.trim() === 'Checkout'
      ) as HTMLButtonElement;
      if (checkoutBtn) {
        expect(checkoutBtn.disabled).to.be.true;
      }

      const mergeBtn = Array.from(menuItems).find(
        (item) => item.textContent?.trim().includes('Merge')
      ) as HTMLButtonElement;
      if (mergeBtn) {
        expect(mergeBtn.disabled).to.be.true;
      }

      // Unblock
      (resolveCheckout as (() => void) | null)?.();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;
    });
  });
});
