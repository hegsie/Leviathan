/**
 * Branch Cleanup Dialog Tests (fixture-based)
 *
 * Renders the REAL lv-branch-cleanup-dialog component, mocks only the Tauri
 * invoke layer, and verifies actual DOM output for rendering, tabs, risk
 * badges, protection, selection, delete flow, prune option, and footer.
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
import { settingsStore } from '../../../stores/settings.store.ts';
import type { CleanupCandidate } from '../../../types/git.types.ts';

// Import the actual component — registers <lv-branch-cleanup-dialog>
import '../lv-branch-cleanup-dialog.ts';
import type { LvBranchCleanupDialog } from '../lv-branch-cleanup-dialog.ts';

// ── Test data ──────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

function createCandidate(
  name: string,
  category: 'merged' | 'stale' | 'gone',
  overrides: Partial<CleanupCandidate> = {},
): CleanupCandidate {
  return {
    name,
    shorthand: name,
    category,
    lastCommitTimestamp: null,
    isProtected: false,
    upstream: null,
    aheadBehind: null,
    ...overrides,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────
function clearHistory(): void {
  invokeHistory.length = 0;
}

function findCommands(name: string): Array<{ command: string; args?: unknown }> {
  return invokeHistory.filter((h) => h.command === name);
}

/** Wait for the dialog's async load to complete after open(). */
async function settle(el: LvBranchCleanupDialog): Promise<void> {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 50));
  await el.updateComplete;
}

async function renderAndOpen(
  candidates: CleanupCandidate[],
): Promise<LvBranchCleanupDialog> {
  mockInvoke = async (command: string) => {
    switch (command) {
      case 'get_cleanup_candidates':
        return candidates;
      case 'delete_branch':
        return undefined;
      case 'prune_remote_tracking_branches':
        return { success: true, pruned: [], count: 0 };
      case 'plugin:notification|is_permission_granted':
        return false;
      case 'plugin:dialog|confirm':
        return true;
      default:
        return null;
    }
  };

  const el = await fixture<LvBranchCleanupDialog>(
    html`<lv-branch-cleanup-dialog .repositoryPath=${REPO_PATH}></lv-branch-cleanup-dialog>`,
  );
  await el.updateComplete;
  el.open();
  await settle(el);
  return el;
}

// ── Standard candidate sets ────────────────────────────────────────────────
const mergedSafe = createCandidate('feature/done', 'merged', {
  aheadBehind: { ahead: 0, behind: 2 },
});

const mergedWarning = createCandidate('feature/wip', 'merged', {
  aheadBehind: { ahead: 5, behind: 0 },
});

const staleSafe = createCandidate('feature/old', 'stale', {
  aheadBehind: { ahead: 0, behind: 0 },
  lastCommitTimestamp: 1600000000,
});

const staleWarning = createCandidate('feature/stale-wip', 'stale', {
  aheadBehind: { ahead: 3, behind: 0 },
  lastCommitTimestamp: 1600000000,
});

const goneSafe = createCandidate('feature/gone-safe', 'gone', {
  aheadBehind: { ahead: 0, behind: 0 },
  upstream: 'origin/feature/gone-safe',
});

const goneDanger = createCandidate('feature/gone-danger', 'gone', {
  aheadBehind: { ahead: 3, behind: 0 },
  upstream: 'origin/feature/gone-danger',
});

const protectedMain = createCandidate('main', 'merged', {
  aheadBehind: { ahead: 0, behind: 0 },
});

const protectedMaster = createCandidate('master', 'merged', {
  aheadBehind: { ahead: 0, behind: 0 },
});

const allCandidates: CleanupCandidate[] = [
  mergedSafe,
  mergedWarning,
  protectedMain,
  protectedMaster,
  staleSafe,
  staleWarning,
  goneSafe,
  goneDanger,
];

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-branch-cleanup-dialog (fixture)', () => {
  beforeEach(() => {
    clearHistory();
    // Ensure settings store has staleBranchDays set
    settingsStore.setState({ staleBranchDays: 90 });
  });

  // ── Rendering ──────────────────────────────────────────────────────────
  describe('Rendering', () => {
    it('open() renders the dialog with tabs (Merged, Stale, Gone Upstream)', async () => {
      const el = await renderAndOpen(allCandidates);

      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      expect(tabs.length).to.equal(3);

      const tabTexts = Array.from(tabs).map((t) => t.textContent!.trim());
      expect(tabTexts.some((t) => t.includes('Merged'))).to.be.true;
      expect(tabTexts.some((t) => t.includes('Stale'))).to.be.true;
      expect(tabTexts.some((t) => t.includes('Gone Upstream'))).to.be.true;
    });

    it('tab badges show correct counts', async () => {
      const el = await renderAndOpen(allCandidates);

      const badges = el.shadowRoot!.querySelectorAll('.tab-badge');
      expect(badges.length).to.equal(3);

      // Merged: mergedSafe, mergedWarning, protectedMain, protectedMaster = 4
      expect(badges[0].textContent!.trim()).to.equal('4');
      // Stale: staleSafe, staleWarning = 2
      expect(badges[1].textContent!.trim()).to.equal('2');
      // Gone: goneSafe, goneDanger = 2
      expect(badges[2].textContent!.trim()).to.equal('2');
    });

    it('branch items render with .branch-name showing branch name', async () => {
      const el = await renderAndOpen([mergedSafe]);

      const branchName = el.shadowRoot!.querySelector('.branch-name');
      expect(branchName).to.not.be.null;
      expect(branchName!.textContent!.trim()).to.equal('feature/done');
    });

    it('risk badges render with correct class (.risk-badge.safe, .risk-badge.warning, .risk-badge.danger)', async () => {
      // Put one of each risk in merged tab
      const el = await renderAndOpen([mergedSafe, mergedWarning]);

      const safeBadge = el.shadowRoot!.querySelector('.risk-badge.safe');
      const warningBadge = el.shadowRoot!.querySelector('.risk-badge.warning');

      expect(safeBadge).to.not.be.null;
      expect(safeBadge!.textContent).to.include('Safe');
      expect(warningBadge).to.not.be.null;
      expect(warningBadge!.textContent).to.include('Warning');
    });

    it('protected branches show .protected-badge', async () => {
      const el = await renderAndOpen([protectedMain]);

      const protectedBadge = el.shadowRoot!.querySelector('.protected-badge');
      expect(protectedBadge).to.not.be.null;
      expect(protectedBadge!.textContent).to.include('Protected');
    });
  });

  // ── Loading state ──────────────────────────────────────────────────────
  describe('Loading state', () => {
    it('shows .loading with "Loading branches..." during fetch', async () => {
      // Use a slow mock that resolves after we check
      let resolveLoad!: (value: CleanupCandidate[]) => void;
      const slowPromise = new Promise<CleanupCandidate[]>((r) => {
        resolveLoad = r;
      });

      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_cleanup_candidates':
            return slowPromise;
          case 'plugin:notification|is_permission_granted':
            return false;
          default:
            return null;
        }
      };

      const el = await fixture<LvBranchCleanupDialog>(
        html`<lv-branch-cleanup-dialog .repositoryPath=${REPO_PATH}></lv-branch-cleanup-dialog>`,
      );
      await el.updateComplete;
      el.open();
      await el.updateComplete;

      const loading = el.shadowRoot!.querySelector('.loading');
      expect(loading).to.not.be.null;
      expect(loading!.textContent).to.include('Loading branches...');

      // Resolve the promise so the test can clean up
      resolveLoad([]);
      await settle(el);
    });

    it('loading disappears after data loads', async () => {
      const el = await renderAndOpen([mergedSafe]);

      const loading = el.shadowRoot!.querySelector('.loading');
      expect(loading).to.be.null;
    });
  });

  // ── Empty state ────────────────────────────────────────────────────────
  describe('Empty state', () => {
    it('tab with no branches shows .empty-state', async () => {
      // Only put branches in merged, so stale tab is empty
      const el = await renderAndOpen([mergedSafe]);

      // Switch to stale tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const staleTab = Array.from(tabs).find((t) => t.textContent!.includes('Stale'));
      staleTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle(el);

      const emptyState = el.shadowRoot!.querySelector('.empty-state');
      expect(emptyState).to.not.be.null;
    });

    it('empty state has appropriate message text', async () => {
      const el = await renderAndOpen([mergedSafe]);

      // Switch to stale tab (which is empty)
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const staleTab = Array.from(tabs).find((t) => t.textContent!.includes('Stale'));
      staleTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle(el);

      const emptyState = el.shadowRoot!.querySelector('.empty-state');
      expect(emptyState!.textContent).to.include('No stale branches found');
    });
  });

  // ── Tab switching ──────────────────────────────────────────────────────
  describe('Tab switching', () => {
    it('clicking "Stale" tab button shows stale branches', async () => {
      const el = await renderAndOpen(allCandidates);

      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const staleTab = Array.from(tabs).find((t) => t.textContent!.includes('Stale'));
      staleTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle(el);

      const branchNames = el.shadowRoot!.querySelectorAll('.branch-name');
      const names = Array.from(branchNames).map((n) => n.textContent!.trim());
      expect(names).to.include('feature/old');
      expect(names).to.include('feature/stale-wip');
      expect(names).to.not.include('feature/done');
    });

    it('clicking "Gone Upstream" tab shows gone branches', async () => {
      const el = await renderAndOpen(allCandidates);

      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const goneTab = Array.from(tabs).find((t) => t.textContent!.includes('Gone Upstream'));
      goneTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle(el);

      const branchNames = el.shadowRoot!.querySelectorAll('.branch-name');
      const names = Array.from(branchNames).map((n) => n.textContent!.trim());
      expect(names).to.include('feature/gone-safe');
      expect(names).to.include('feature/gone-danger');
      expect(names).to.not.include('feature/done');
    });

    it('active tab has .active class', async () => {
      const el = await renderAndOpen(allCandidates);

      // Initially merged tab is active
      let activeTab = el.shadowRoot!.querySelector('.tab.active');
      expect(activeTab).to.not.be.null;
      expect(activeTab!.textContent).to.include('Merged');

      // Switch to stale
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const staleTab = Array.from(tabs).find((t) => t.textContent!.includes('Stale'));
      staleTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle(el);

      activeTab = el.shadowRoot!.querySelector('.tab.active');
      expect(activeTab).to.not.be.null;
      expect(activeTab!.textContent).to.include('Stale');
    });
  });

  // ── Risk assessment via DOM ────────────────────────────────────────────
  describe('Risk assessment via DOM', () => {
    it('branch with ahead: 0 shows .risk-badge.safe', async () => {
      const el = await renderAndOpen([mergedSafe]);

      const safeBadge = el.shadowRoot!.querySelector('.risk-badge.safe');
      expect(safeBadge).to.not.be.null;
      expect(safeBadge!.textContent).to.include('Safe');
    });

    it('branch with ahead: 5 shows .risk-badge.warning', async () => {
      const el = await renderAndOpen([mergedWarning]);

      const warningBadge = el.shadowRoot!.querySelector('.risk-badge.warning');
      expect(warningBadge).to.not.be.null;
      expect(warningBadge!.textContent).to.include('Warning');
    });

    it('gone branch with ahead: 3 shows .risk-badge.danger', async () => {
      const el = await renderAndOpen([goneDanger]);

      // Need to switch to gone tab
      const tabs = el.shadowRoot!.querySelectorAll('.tab');
      const goneTab = Array.from(tabs).find((t) => t.textContent!.includes('Gone Upstream'));
      goneTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle(el);

      const dangerBadge = el.shadowRoot!.querySelector('.risk-badge.danger');
      expect(dangerBadge).to.not.be.null;
      expect(dangerBadge!.textContent).to.include('Danger');
    });
  });

  // ── Branch protection ──────────────────────────────────────────────────
  describe('Branch protection', () => {
    it('main branch shows .protected-badge and disabled checkbox', async () => {
      const el = await renderAndOpen([protectedMain, mergedSafe]);

      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const mainItem = Array.from(branchItems).find(
        (item) => item.querySelector('.branch-name')?.textContent?.trim() === 'main',
      );
      expect(mainItem).to.not.be.null;

      const protectedBadge = mainItem!.querySelector('.protected-badge');
      expect(protectedBadge).to.not.be.null;

      const checkbox = mainItem!.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.disabled).to.be.true;
    });

    it('master branch shows .protected-badge', async () => {
      const el = await renderAndOpen([protectedMaster]);

      const protectedBadge = el.shadowRoot!.querySelector('.protected-badge');
      expect(protectedBadge).to.not.be.null;
      expect(protectedBadge!.textContent).to.include('Protected');
    });

    it('feature branch does NOT show .protected-badge', async () => {
      const el = await renderAndOpen([mergedSafe]);

      const protectedBadge = el.shadowRoot!.querySelector('.protected-badge');
      expect(protectedBadge).to.be.null;

      // It should show a risk badge instead
      const riskBadge = el.shadowRoot!.querySelector('.risk-badge');
      expect(riskBadge).to.not.be.null;
    });
  });

  // ── Selection ──────────────────────────────────────────────────────────
  describe('Selection', () => {
    it('safe merged non-protected branches are auto-selected (checkbox checked)', async () => {
      const el = await renderAndOpen([mergedSafe, protectedMain]);

      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const featureItem = Array.from(branchItems).find(
        (item) => item.querySelector('.branch-name')?.textContent?.trim() === 'feature/done',
      );
      expect(featureItem).to.not.be.null;

      const checkbox = featureItem!.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.checked).to.be.true;
    });

    it('protected branches are NOT auto-selected', async () => {
      const el = await renderAndOpen([protectedMain, mergedSafe]);

      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const mainItem = Array.from(branchItems).find(
        (item) => item.querySelector('.branch-name')?.textContent?.trim() === 'main',
      );
      expect(mainItem).to.not.be.null;

      const checkbox = mainItem!.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.checked).to.be.false;
    });

    it('click checkbox toggles selection', async () => {
      const el = await renderAndOpen([mergedSafe]);

      const checkbox = el.shadowRoot!.querySelector(
        '.branch-item input[type="checkbox"]',
      ) as HTMLInputElement;
      expect(checkbox.checked).to.be.true; // auto-selected

      // Uncheck
      checkbox.click();
      await settle(el);

      const updatedCheckbox = el.shadowRoot!.querySelector(
        '.branch-item input[type="checkbox"]',
      ) as HTMLInputElement;
      expect(updatedCheckbox.checked).to.be.false;

      // Check again
      updatedCheckbox.click();
      await settle(el);

      const finalCheckbox = el.shadowRoot!.querySelector(
        '.branch-item input[type="checkbox"]',
      ) as HTMLInputElement;
      expect(finalCheckbox.checked).to.be.true;
    });

    it('select-all checkbox toggles all selectable branches', async () => {
      const el = await renderAndOpen([mergedSafe, mergedWarning, protectedMain]);

      // Find select-all checkbox
      const selectAllCheckbox = el.shadowRoot!.querySelector(
        '.select-all input[type="checkbox"]',
      ) as HTMLInputElement;
      expect(selectAllCheckbox).to.not.be.null;

      // Click select-all to select all
      selectAllCheckbox.click();
      await settle(el);

      // All non-protected should be checked
      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item:not(.protected)');
      for (const item of Array.from(branchItems)) {
        const cb = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(cb.checked).to.be.true;
      }

      // Protected should still be unchecked
      const protectedItem = el.shadowRoot!.querySelector('.branch-item.protected');
      if (protectedItem) {
        const protectedCb = protectedItem.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(protectedCb.checked).to.be.false;
      }

      // Click select-all again to deselect all
      const selectAllAgain = el.shadowRoot!.querySelector(
        '.select-all input[type="checkbox"]',
      ) as HTMLInputElement;
      selectAllAgain.click();
      await settle(el);

      const branchItemsAfter = el.shadowRoot!.querySelectorAll('.branch-item:not(.protected)');
      for (const item of Array.from(branchItemsAfter)) {
        const cb = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(cb.checked).to.be.false;
      }
    });
  });

  // ── Delete flow ────────────────────────────────────────────────────────
  describe('Delete flow', () => {
    it('delete button shows selected count text "Delete Selected (N)"', async () => {
      const el = await renderAndOpen([mergedSafe]);

      const deleteBtn = el.shadowRoot!.querySelector('.btn-danger') as HTMLButtonElement;
      expect(deleteBtn).to.not.be.null;
      expect(deleteBtn.textContent!.trim()).to.include('Delete Selected (1)');
    });

    it('delete button disabled when nothing selected', async () => {
      // Use a warning branch that won't be auto-selected
      const el = await renderAndOpen([mergedWarning]);

      const deleteBtn = el.shadowRoot!.querySelector('.btn-danger') as HTMLButtonElement;
      expect(deleteBtn).to.not.be.null;
      expect(deleteBtn.disabled).to.be.true;
    });

    it('clicking delete calls delete_branch for each selected branch', async () => {
      const candidates = [mergedSafe, mergedWarning];
      const el = await renderAndOpen(candidates);
      clearHistory();

      // Select the warning branch too (safe is auto-selected)
      const branchItems = el.shadowRoot!.querySelectorAll('.branch-item');
      const warningItem = Array.from(branchItems).find(
        (item) => item.querySelector('.branch-name')?.textContent?.trim() === 'feature/wip',
      );
      const warningCheckbox = warningItem!.querySelector('input[type="checkbox"]') as HTMLInputElement;
      warningCheckbox.click();
      await settle(el);

      clearHistory();

      // Click delete
      const deleteBtn = el.shadowRoot!.querySelector('.btn-danger') as HTMLButtonElement;
      deleteBtn.click();

      // Wait for async confirmation dialog + deletion
      await new Promise((r) => setTimeout(r, 200));
      await el.updateComplete;

      const deleteCalls = findCommands('delete_branch');
      expect(deleteCalls.length).to.equal(2);

      const deletedNames = deleteCalls.map(
        (c) => (c.args as Record<string, unknown>).name,
      );
      expect(deletedNames).to.include('feature/done');
      expect(deletedNames).to.include('feature/wip');
    });

    it('cleanup-complete event dispatched after successful deletion', async () => {
      const el = await renderAndOpen([mergedSafe]);

      let eventFired = false;
      el.addEventListener('cleanup-complete', () => {
        eventFired = true;
      });

      clearHistory();

      const deleteBtn = el.shadowRoot!.querySelector('.btn-danger') as HTMLButtonElement;
      deleteBtn.click();

      await new Promise((r) => setTimeout(r, 200));
      await el.updateComplete;

      expect(eventFired).to.be.true;
    });
  });

  // ── Prune option ───────────────────────────────────────────────────────
  describe('Prune option', () => {
    it('prune checkbox is checked by default', async () => {
      const el = await renderAndOpen([mergedSafe]);

      const pruneCheckbox = el.shadowRoot!.querySelector(
        '.prune-option input[type="checkbox"]',
      ) as HTMLInputElement;
      expect(pruneCheckbox).to.not.be.null;
      expect(pruneCheckbox.checked).to.be.true;
    });

    it('when prune is checked and delete executes, prune_remote_tracking_branches is called', async () => {
      const el = await renderAndOpen([mergedSafe]);
      clearHistory();

      const deleteBtn = el.shadowRoot!.querySelector('.btn-danger') as HTMLButtonElement;
      deleteBtn.click();

      await new Promise((r) => setTimeout(r, 200));
      await el.updateComplete;

      const pruneCalls = findCommands('prune_remote_tracking_branches');
      expect(pruneCalls.length).to.equal(1);
    });
  });

  // ── Footer ─────────────────────────────────────────────────────────────
  describe('Footer', () => {
    it('shows "No branches selected" when none selected', async () => {
      // Use only a warning branch so nothing is auto-selected
      const el = await renderAndOpen([mergedWarning]);

      const footer = el.shadowRoot!.querySelector('.footer-summary');
      expect(footer).to.not.be.null;
      expect(footer!.textContent).to.include('No branches selected');
    });

    it('shows "N branches selected" with correct count', async () => {
      const el = await renderAndOpen([mergedSafe, goneSafe]);

      // mergedSafe is auto-selected; goneSafe is auto-selected
      const footer = el.shadowRoot!.querySelector('.footer-summary');
      expect(footer).to.not.be.null;
      expect(footer!.textContent).to.include('2 branches selected');
    });
  });
});
