/**
 * Tests for lv-conflict-resolution-dialog component
 *
 * Tests conflict file rendering, navigation, resolution tracking,
 * abort/continue flows, keyboard shortcuts, and event dispatching.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
const invokeHistory: Array<{ command: string; args?: unknown }> = [];

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeHistory.push({ command, args });
    return mockInvoke(command, args);
  },
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import '../lv-conflict-resolution-dialog.ts';
import type { LvConflictResolutionDialog } from '../lv-conflict-resolution-dialog.ts';
import type { ConflictFile } from '../../../types/git.types.ts';

// ── Test data ──────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

function makeConflict(path: string): ConflictFile {
  return {
    path,
    ancestor: { oid: 'base123', path, mode: 0o100644 },
    ours: { oid: 'ours123', path, mode: 0o100644 },
    theirs: { oid: 'theirs123', path, mode: 0o100644 },
  };
}

const TEST_CONFLICTS: ConflictFile[] = [
  makeConflict('src/main.ts'),
  makeConflict('src/utils.ts'),
  makeConflict('src/app.ts'),
];

// ── Helpers ────────────────────────────────────────────────────────────────
function setupDefaultMocks(conflicts: ConflictFile[] = TEST_CONFLICTS): void {
  mockInvoke = async (command: string) => {
    switch (command) {
      case 'get_conflicts':
        return conflicts;
      case 'get_merge_tool_config':
        return null;
      case 'auto_detect_merge_tool':
        return null;
      case 'abort_merge':
      case 'abort_rebase':
      case 'abort_cherry_pick':
      case 'abort_revert':
        return { success: true };
      case 'continue_rebase':
      case 'continue_cherry_pick':
      case 'continue_revert':
        return { success: true };
      default:
        return null;
    }
  };
}

async function renderDialog(
  operationType: 'merge' | 'rebase' | 'cherry-pick' | 'revert' = 'merge'
): Promise<LvConflictResolutionDialog> {
  const el = await fixture<LvConflictResolutionDialog>(html`
    <lv-conflict-resolution-dialog
      .repositoryPath=${REPO_PATH}
      .operationType=${operationType}
    ></lv-conflict-resolution-dialog>
  `);
  return el;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-conflict-resolution-dialog', () => {
  beforeEach(() => {
    invokeHistory.length = 0;
    setupDefaultMocks();
  });

  // ── Rendering ──────────────────────────────────────────────────────────
  describe('rendering', () => {
    it('renders without errors', async () => {
      const el = await renderDialog();
      expect(el).to.exist;
      expect(el.tagName.toLowerCase()).to.equal('lv-conflict-resolution-dialog');
    });

    it('is hidden when not open', async () => {
      const el = await renderDialog();
      expect(el.open).to.be.false;

      // Should not render any visible content when not open
      const dialog = el.shadowRoot!.querySelector('.dialog');
      expect(dialog).to.be.null;
    });

    it('shows dialog when open is set', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      // Wait for loadConflicts
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const dialog = el.shadowRoot!.querySelector('.dialog');
      expect(dialog).to.exist;
    });

    it('shows correct operation title for merge', async () => {
      const el = await renderDialog('merge');
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const title = el.shadowRoot!.querySelector('.header-title');
      expect(title?.textContent).to.include('Merge');
    });

    it('shows correct operation title for rebase', async () => {
      const el = await renderDialog('rebase');
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const title = el.shadowRoot!.querySelector('.header-title');
      expect(title?.textContent).to.include('Rebase');
    });

    it('shows correct operation title for cherry-pick', async () => {
      const el = await renderDialog('cherry-pick');
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const title = el.shadowRoot!.querySelector('.header-title');
      expect(title?.textContent).to.include('Cherry-pick');
    });

    it('shows correct operation title for revert', async () => {
      const el = await renderDialog('revert');
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const title = el.shadowRoot!.querySelector('.header-title');
      expect(title?.textContent).to.include('Revert');
    });
  });

  // ── Conflict file list ─────────────────────────────────────────────────
  describe('conflict file list', () => {
    it('renders conflict files after loading', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const fileItems = el.shadowRoot!.querySelectorAll('.file-item');
      expect(fileItems.length).to.equal(3);
    });

    it('shows file names from paths', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const fileNames = el.shadowRoot!.querySelectorAll('.file-name');
      const names = Array.from(fileNames).map(n => n.textContent!.trim());
      expect(names).to.include('main.ts');
      expect(names).to.include('utils.ts');
      expect(names).to.include('app.ts');
    });

    it('marks first file as selected by default', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const selectedItems = el.shadowRoot!.querySelectorAll('.file-item.selected');
      expect(selectedItems.length).to.equal(1);
    });

    it('shows conflict icon for unresolved files', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const conflictIcons = el.shadowRoot!.querySelectorAll('.file-icon.conflict');
      expect(conflictIcons.length).to.equal(3);
    });

    it('shows resolved count in subtitle', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const subtitle = el.shadowRoot!.querySelector('.header-subtitle');
      expect(subtitle?.textContent).to.include('0 of 3');
    });
  });

  // ── File selection ─────────────────────────────────────────────────────
  describe('file selection', () => {
    it('selects file on click', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const fileItems = el.shadowRoot!.querySelectorAll('.file-item');
      (fileItems[1] as HTMLElement).click();
      await el.updateComplete;

      const internal = el as unknown as { selectedIndex: number };
      expect(internal.selectedIndex).to.equal(1);
    });
  });

  // ── Navigation ─────────────────────────────────────────────────────────
  describe('navigation', () => {
    it('has previous and next buttons', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const navBtns = el.shadowRoot!.querySelectorAll('.nav-btn');
      expect(navBtns.length).to.equal(2);
    });

    it('disables previous button on first file', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const prevBtn = el.shadowRoot!.querySelectorAll('.nav-btn')[0] as HTMLButtonElement;
      expect(prevBtn.disabled).to.be.true;
    });

    it('enables next button when not on last file', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const nextBtn = el.shadowRoot!.querySelectorAll('.nav-btn')[1] as HTMLButtonElement;
      expect(nextBtn.disabled).to.be.false;
    });

    it('navigates to next file', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const nextBtn = el.shadowRoot!.querySelectorAll('.nav-btn')[1] as HTMLButtonElement;
      nextBtn.click();
      await el.updateComplete;

      const internal = el as unknown as { selectedIndex: number };
      expect(internal.selectedIndex).to.equal(1);
    });

    it('navigates to previous file', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      // Navigate to second file first
      const internal = el as unknown as { selectedIndex: number };
      internal.selectedIndex = 2;
      await el.updateComplete;

      const prevBtn = el.shadowRoot!.querySelectorAll('.nav-btn')[0] as HTMLButtonElement;
      prevBtn.click();
      await el.updateComplete;

      expect(internal.selectedIndex).to.equal(1);
    });

    it('does not go below index 0', () => {
      const el = document.createElement('lv-conflict-resolution-dialog') as LvConflictResolutionDialog;
      const internal = el as unknown as {
        selectedIndex: number;
        handlePrevious: () => void;
      };
      internal.selectedIndex = 0;
      internal.handlePrevious();
      expect(internal.selectedIndex).to.equal(0);
    });
  });

  // ── Conflict resolution tracking ───────────────────────────────────────
  describe('resolution tracking', () => {
    it('tracks resolved files', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      // Simulate conflict resolution
      const internal = el as unknown as { resolvedFiles: Set<string> };
      internal.resolvedFiles = new Set(['src/main.ts']);
      el.requestUpdate();
      await el.updateComplete;

      const resolvedIcons = el.shadowRoot!.querySelectorAll('.file-icon.resolved');
      expect(resolvedIcons.length).to.equal(1);
    });

    it('updates resolved count after resolution', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const internal = el as unknown as { resolvedFiles: Set<string> };
      internal.resolvedFiles = new Set(['src/main.ts', 'src/utils.ts']);
      el.requestUpdate();
      await el.updateComplete;

      const subtitle = el.shadowRoot!.querySelector('.header-subtitle');
      expect(subtitle?.textContent).to.include('2 of 3');
    });

    it('handles conflict-resolved event by adding to resolved set', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const handleConflictResolved = (el as unknown as {
        handleConflictResolved: (e: CustomEvent) => void;
      }).handleConflictResolved.bind(el);

      handleConflictResolved(
        new CustomEvent('conflict-resolved', {
          detail: { file: makeConflict('src/main.ts') },
        })
      );
      await el.updateComplete;

      const internal = el as unknown as { resolvedFiles: Set<string> };
      expect(internal.resolvedFiles.has('src/main.ts')).to.be.true;
    });

    it('auto-advances to next unresolved file after resolution', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      // Mark first file as selected, resolve it
      const internal = el as unknown as {
        selectedIndex: number;
        resolvedFiles: Set<string>;
      };
      internal.selectedIndex = 0;

      const handleConflictResolved = (el as unknown as {
        handleConflictResolved: (e: CustomEvent) => void;
      }).handleConflictResolved.bind(el);

      // Also mark second as resolved to test it advances past it
      internal.resolvedFiles = new Set(['src/utils.ts']);
      el.requestUpdate();

      handleConflictResolved(
        new CustomEvent('conflict-resolved', {
          detail: { file: makeConflict('src/main.ts') },
        })
      );

      // Should advance to index 2 (src/app.ts), skipping resolved src/utils.ts
      expect(internal.selectedIndex).to.equal(2);
    });
  });

  // ── Abort flow ─────────────────────────────────────────────────────────
  describe('abort flow', () => {
    it('shows abort confirmation dialog', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      // Click abort
      const abortBtn = el.shadowRoot!.querySelector('.btn-danger') as HTMLButtonElement;
      abortBtn.click();
      await el.updateComplete;

      const confirmOverlay = el.shadowRoot!.querySelector('.confirm-overlay');
      expect(confirmOverlay).to.exist;
    });

    it('can cancel the abort confirmation', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const internal = el as unknown as { showAbortConfirm: boolean };
      internal.showAbortConfirm = true;
      await el.updateComplete;

      // Click cancel in confirmation
      const cancelBtn = el.shadowRoot!.querySelector('.confirm-overlay .btn:not(.btn-danger)') as HTMLButtonElement;
      cancelBtn.click();
      await el.updateComplete;

      expect(internal.showAbortConfirm).to.be.false;
    });

    it('dispatches operation-aborted on successful abort', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      let abortedFired = false;
      el.addEventListener('operation-aborted', () => { abortedFired = true; });

      // Trigger abort confirm
      const internal = el as unknown as {
        showAbortConfirm: boolean;
        aborting: boolean;
      };
      internal.showAbortConfirm = true;
      await el.updateComplete;

      const confirmAbortBtn = el.shadowRoot!.querySelector('.confirm-overlay .btn-danger') as HTMLButtonElement;
      confirmAbortBtn.click();
      await new Promise(r => setTimeout(r, 100));

      expect(abortedFired).to.be.true;
    });

    it('calls abort_merge for merge type', async () => {
      const el = await renderDialog('merge');
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));

      invokeHistory.length = 0;

      const handleAbortConfirm = (el as unknown as {
        handleAbortConfirm: () => Promise<void>;
      }).handleAbortConfirm.bind(el);

      await handleAbortConfirm();

      const abortCall = invokeHistory.find(h => h.command === 'abort_merge');
      expect(abortCall).to.exist;
    });

    it('calls abort_rebase for rebase type', async () => {
      const el = await renderDialog('rebase');
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));

      invokeHistory.length = 0;

      const handleAbortConfirm = (el as unknown as {
        handleAbortConfirm: () => Promise<void>;
      }).handleAbortConfirm.bind(el);

      await handleAbortConfirm();

      const abortCall = invokeHistory.find(h => h.command === 'abort_rebase');
      expect(abortCall).to.exist;
    });
  });

  // ── Continue flow ──────────────────────────────────────────────────────
  describe('continue flow', () => {
    it('disables continue button when not all resolved', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const continueBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      expect(continueBtn.disabled).to.be.true;
    });

    it('enables continue button when all resolved', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const internal = el as unknown as { resolvedFiles: Set<string> };
      internal.resolvedFiles = new Set(['src/main.ts', 'src/utils.ts', 'src/app.ts']);
      el.requestUpdate();
      await el.updateComplete;

      const continueBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      expect(continueBtn.disabled).to.be.false;
    });

    it('dispatches operation-completed on successful continue', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const internal = el as unknown as { resolvedFiles: Set<string>; conflicts: ConflictFile[] };
      internal.resolvedFiles = new Set(internal.conflicts.map(c => c.path));

      let completedFired = false;
      el.addEventListener('operation-completed', () => { completedFired = true; });

      const handleContinue = (el as unknown as {
        handleContinue: () => Promise<void>;
      }).handleContinue.bind(el);

      await handleContinue();

      expect(completedFired).to.be.true;
    });

    it('shows merge-specific button text', async () => {
      const el = await renderDialog('merge');
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const continueBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      expect(continueBtn.textContent!.trim()).to.include('Complete Merge');
    });

    it('shows rebase-specific button text', async () => {
      const el = await renderDialog('rebase');
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const continueBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      expect(continueBtn.textContent!.trim()).to.include('Continue Rebase');
    });
  });

  // ── Computed properties ────────────────────────────────────────────────
  describe('computed properties', () => {
    it('selectedConflict returns correct file', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));

      const internal = el as unknown as {
        selectedIndex: number;
        selectedConflict: ConflictFile | null;
      };
      internal.selectedIndex = 1;

      expect(internal.selectedConflict?.path).to.equal('src/utils.ts');
    });

    it('resolvedCount returns correct value', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));

      const internal = el as unknown as {
        resolvedFiles: Set<string>;
        resolvedCount: number;
      };
      internal.resolvedFiles = new Set(['src/main.ts', 'src/utils.ts']);

      expect(internal.resolvedCount).to.equal(2);
    });

    it('totalCount returns number of conflicts', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));

      const internal = el as unknown as { totalCount: number };
      expect(internal.totalCount).to.equal(3);
    });
  });

  // ── Empty state ────────────────────────────────────────────────────────
  describe('empty state', () => {
    it('shows empty state when no conflicts', async () => {
      setupDefaultMocks([]);
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));
      await el.updateComplete;

      const emptyState = el.shadowRoot!.querySelector('.empty-state');
      expect(emptyState).to.exist;
      expect(emptyState!.textContent).to.include('No conflicts');
    });
  });

  // ── Show/close methods ─────────────────────────────────────────────────
  describe('show/close', () => {
    it('sets open to true and resets state on show()', async () => {
      const el = await renderDialog();

      await el.show();
      await new Promise(r => setTimeout(r, 100));

      expect(el.open).to.be.true;
      const internal = el as unknown as { selectedIndex: number };
      expect(internal.selectedIndex).to.equal(0);
    });

    it('cleans up state on close', async () => {
      const el = await renderDialog();
      el.open = true;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 100));

      const close = (el as unknown as { close: () => void }).close.bind(el);
      close();

      expect(el.open).to.be.false;
      const internal = el as unknown as { conflicts: ConflictFile[] };
      expect(internal.conflicts.length).to.equal(0);
    });
  });
});
