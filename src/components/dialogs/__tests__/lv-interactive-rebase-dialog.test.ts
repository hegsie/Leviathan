/**
 * Fixture-based tests for lv-interactive-rebase-dialog.
 *
 * These render the REAL component, mock only the Tauri invoke layer,
 * and verify actual DOM output and behavior.
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
import type { LvInteractiveRebaseDialog } from '../lv-interactive-rebase-dialog.ts';

// Import the actual component — registers <lv-interactive-rebase-dialog>
import '../lv-interactive-rebase-dialog.ts';

// ── Test data ──────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

const mockCommits = [
  { oid: 'aaa1111111111', shortId: 'aaa1111', summary: 'Add feature A' },
  { oid: 'bbb2222222222', shortId: 'bbb2222', summary: 'Fix bug in feature A' },
  { oid: 'ccc3333333333', shortId: 'ccc3333', summary: 'Add feature B' },
];

const mockCommitsWithAutosquash = [
  { oid: 'aaa1111111111', shortId: 'aaa1111', summary: 'Add feature A' },
  { oid: 'bbb2222222222', shortId: 'bbb2222', summary: 'Add feature B' },
  { oid: 'ccc3333333333', shortId: 'ccc3333', summary: 'fixup! Add feature A' },
  { oid: 'ddd4444444444', shortId: 'ddd4444', summary: 'squash! Add feature B' },
];

const mockCommitsWithUnmatchedAutosquash = [
  { oid: 'aaa1111111111', shortId: 'aaa1111', summary: 'Add feature A' },
  { oid: 'bbb2222222222', shortId: 'bbb2222', summary: 'fixup! Nonexistent commit' },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function clearHistory(): void {
  invokeHistory.length = 0;
}

function findCommands(name: string): Array<{ command: string; args?: unknown }> {
  return invokeHistory.filter((h) => h.command === name);
}

function setupDefaultMocks(commits = mockCommits): void {
  mockInvoke = async (command: string) => {
    switch (command) {
      case 'get_rebase_commits':
        return commits;
      case 'execute_interactive_rebase':
        return undefined;
      default:
        return null;
    }
  };
}

async function createDialog(): Promise<LvInteractiveRebaseDialog> {
  const el = await fixture<LvInteractiveRebaseDialog>(
    html`<lv-interactive-rebase-dialog .repositoryPath=${REPO_PATH}></lv-interactive-rebase-dialog>`
  );
  return el;
}

async function openAndWait(el: LvInteractiveRebaseDialog, onto = 'main'): Promise<void> {
  await el.open(onto);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 50));
  await el.updateComplete;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-interactive-rebase-dialog (fixture)', () => {
  beforeEach(() => {
    clearHistory();
    setupDefaultMocks();
  });

  // ── Rendering ──────────────────────────────────────────────────────────
  describe('Rendering', () => {
    it('open(onto) renders commit rows in .commits-list', async () => {
      const el = await createDialog();
      await openAndWait(el);

      const rows = el.shadowRoot!.querySelectorAll('.commits-list .commit-row');
      expect(rows.length).to.equal(3);
    });

    it('each .commit-row has .commit-hash and .commit-message', async () => {
      const el = await createDialog();
      await openAndWait(el);

      const rows = el.shadowRoot!.querySelectorAll('.commit-row');
      for (const row of Array.from(rows)) {
        const hash = row.querySelector('.commit-hash');
        const message = row.querySelector('.commit-message');
        expect(hash, 'commit-hash should exist').to.not.be.null;
        expect(message, 'commit-message should exist').to.not.be.null;
      }

      // Verify specific content
      const firstHash = rows[0].querySelector('.commit-hash')!;
      expect(firstHash.textContent).to.include('aaa1111');

      const firstMsg = rows[0].querySelector('.commit-message')!;
      expect(firstMsg.textContent).to.include('Add feature A');
    });

    it('header shows the "onto" ref name and commit count', async () => {
      const el = await createDialog();
      await openAndWait(el);

      const headerInfo = el.shadowRoot!.querySelector('.header-info');
      expect(headerInfo).to.not.be.null;
      expect(headerInfo!.textContent).to.include('main');

      const commitCount = el.shadowRoot!.querySelector('.commit-count');
      expect(commitCount).to.not.be.null;
      expect(commitCount!.textContent).to.include('3');
    });

    it('preview toggle button visible in .header-actions', async () => {
      const el = await createDialog();
      await openAndWait(el);

      const headerActions = el.shadowRoot!.querySelector('.header-actions');
      expect(headerActions).to.not.be.null;

      const previewBtn = headerActions!.querySelector('button');
      expect(previewBtn).to.not.be.null;
      expect(previewBtn!.textContent).to.include('Preview');
    });
  });

  // ── Loading state ──────────────────────────────────────────────────────
  describe('Loading state', () => {
    it('shows .loading with "Loading commits..." during fetch', async () => {
      // Use a deferred promise to hold the loading state
      let resolveLoad!: (value: unknown) => void;
      mockInvoke = async (command: string) => {
        if (command === 'get_rebase_commits') {
          return new Promise((resolve) => {
            resolveLoad = resolve;
          });
        }
        return null;
      };

      const el = await createDialog();

      // Start open but don't await its completion
      const openPromise = el.open('main');
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 10));
      await el.updateComplete;

      const loading = el.shadowRoot!.querySelector('.loading');
      expect(loading).to.not.be.null;
      expect(loading!.textContent).to.include('Loading commits...');

      // Resolve to clean up
      resolveLoad(mockCommits);
      await openPromise;
      await el.updateComplete;
    });

    it('loading disappears after commits load', async () => {
      const el = await createDialog();
      await openAndWait(el);

      const loading = el.shadowRoot!.querySelector('.loading');
      expect(loading).to.be.null;

      const rows = el.shadowRoot!.querySelectorAll('.commit-row');
      expect(rows.length).to.be.greaterThan(0);
    });
  });

  // ── Empty state ────────────────────────────────────────────────────────
  describe('Empty state', () => {
    it('empty commits array shows .empty element', async () => {
      setupDefaultMocks([]);

      const el = await createDialog();
      await openAndWait(el);

      const empty = el.shadowRoot!.querySelector('.empty');
      expect(empty).to.not.be.null;
      expect(empty!.textContent).to.include('No commits to rebase');
    });
  });

  // ── Action changes ─────────────────────────────────────────────────────
  describe('Action changes', () => {
    it('default action is pick — select shows "pick" selected', async () => {
      const el = await createDialog();
      await openAndWait(el);

      const selects = el.shadowRoot!.querySelectorAll('.action-select') as NodeListOf<HTMLSelectElement>;
      expect(selects.length).to.equal(3);
      for (const select of Array.from(selects)) {
        expect(select.value).to.equal('pick');
      }
    });

    it('changing action select to reword shows .reword-input textarea', async () => {
      const el = await createDialog();
      await openAndWait(el);

      const select = el.shadowRoot!.querySelector('.action-select') as HTMLSelectElement;
      select.value = 'reword';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;

      const textarea = el.shadowRoot!.querySelector('.reword-input');
      expect(textarea).to.not.be.null;
    });

    it('changing action to drop adds .action-drop class to row', async () => {
      const el = await createDialog();
      await openAndWait(el);

      const select = el.shadowRoot!.querySelector('.action-select') as HTMLSelectElement;
      select.value = 'drop';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;

      const firstRow = el.shadowRoot!.querySelector('.commit-row');
      expect(firstRow!.classList.contains('action-drop')).to.be.true;
    });

    it('changing action from reword back to pick hides textarea', async () => {
      const el = await createDialog();
      await openAndWait(el);

      const select = el.shadowRoot!.querySelector('.action-select') as HTMLSelectElement;

      // Set to reword first
      select.value = 'reword';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;

      let textarea = el.shadowRoot!.querySelector('.reword-input');
      expect(textarea, 'textarea should appear for reword').to.not.be.null;

      // Set back to pick
      select.value = 'pick';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;

      textarea = el.shadowRoot!.querySelector('.reword-input');
      expect(textarea, 'textarea should disappear for pick').to.be.null;
    });
  });

  // ── Preview panel ──────────────────────────────────────────────────────
  describe('Preview panel', () => {
    it('preview panel (.preview-section) shown by default', async () => {
      const el = await createDialog();
      await openAndWait(el);

      const preview = el.shadowRoot!.querySelector('.preview-section');
      expect(preview).to.not.be.null;
    });

    it('toggle preview button hides .preview-section', async () => {
      const el = await createDialog();
      await openAndWait(el);

      const toggleBtn = el.shadowRoot!.querySelector('.header-actions button') as HTMLButtonElement;
      toggleBtn.click();
      await el.updateComplete;

      const preview = el.shadowRoot!.querySelector('.preview-section');
      expect(preview).to.be.null;
    });

    it('preview shows correct number of .preview-commit items', async () => {
      const el = await createDialog();
      await openAndWait(el);

      const previewCommits = el.shadowRoot!.querySelectorAll('.preview-commit');
      expect(previewCommits.length).to.equal(3);
    });

    it('dropped commits are excluded from preview', async () => {
      const el = await createDialog();
      await openAndWait(el);

      // Drop the first commit
      const select = el.shadowRoot!.querySelector('.action-select') as HTMLSelectElement;
      select.value = 'drop';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;

      const previewCommits = el.shadowRoot!.querySelectorAll('.preview-commit');
      expect(previewCommits.length).to.equal(2);
    });

    it('squash commits show .squash-badge on the parent preview commit', async () => {
      const el = await createDialog();
      await openAndWait(el);

      // Set second commit to squash
      const selects = el.shadowRoot!.querySelectorAll('.action-select') as NodeListOf<HTMLSelectElement>;
      selects[1].value = 'squash';
      selects[1].dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;

      // Preview should have 2 commits (first + squash merged, third alone)
      const previewCommits = el.shadowRoot!.querySelectorAll('.preview-commit');
      expect(previewCommits.length).to.equal(2);

      const badge = previewCommits[0].querySelector('.squash-badge');
      expect(badge).to.not.be.null;
      expect(badge!.textContent).to.include('+1 squashed');
    });
  });

  // ── Autosquash ─────────────────────────────────────────────────────────
  describe('Autosquash', () => {
    it('.autosquash-banner shown when commits have fixup!/squash! prefixes', async () => {
      setupDefaultMocks(mockCommitsWithAutosquash);

      const el = await createDialog();
      await openAndWait(el);

      const banner = el.shadowRoot!.querySelector('.autosquash-banner');
      expect(banner).to.not.be.null;
    });

    it('banner hidden when no autosquash commits', async () => {
      setupDefaultMocks(mockCommits);

      const el = await createDialog();
      await openAndWait(el);

      const banner = el.shadowRoot!.querySelector('.autosquash-banner');
      expect(banner).to.be.null;
    });

    it('clicking apply autosquash button reorders commits', async () => {
      setupDefaultMocks(mockCommitsWithAutosquash);

      const el = await createDialog();
      await openAndWait(el);

      // Before autosquash, order is: A, B, fixup!A, squash!B
      let rows = el.shadowRoot!.querySelectorAll('.commit-row');
      let hashes = Array.from(rows).map(r => r.querySelector('.commit-hash')!.textContent!.trim());
      expect(hashes).to.deep.equal(['aaa1111', 'bbb2222', 'ccc3333', 'ddd4444']);

      // Click apply autosquash
      const banner = el.shadowRoot!.querySelector('.autosquash-banner');
      const applyBtn = banner!.querySelector('button') as HTMLButtonElement;
      applyBtn.click();
      await el.updateComplete;

      // After autosquash, fixup!A should follow A, squash!B should follow B
      rows = el.shadowRoot!.querySelectorAll('.commit-row');
      hashes = Array.from(rows).map(r => r.querySelector('.commit-hash')!.textContent!.trim());
      expect(hashes).to.deep.equal(['aaa1111', 'ccc3333', 'bbb2222', 'ddd4444']);
    });

    it('warning message shown after autosquash with unmatched targets', async () => {
      setupDefaultMocks(mockCommitsWithUnmatchedAutosquash);

      const el = await createDialog();
      await openAndWait(el);

      const banner = el.shadowRoot!.querySelector('.autosquash-banner');
      const applyBtn = banner!.querySelector('button') as HTMLButtonElement;
      applyBtn.click();
      await el.updateComplete;

      const warning = el.shadowRoot!.querySelector('.warning-message');
      expect(warning).to.not.be.null;
      expect(warning!.textContent).to.include("couldn't find");
    });
  });

  // ── Stats row ──────────────────────────────────────────────────────────
  describe('Stats row', () => {
    it('stats show "kept" count for pick/edit commits', async () => {
      const el = await createDialog();
      await openAndWait(el);

      const statsRow = el.shadowRoot!.querySelector('.stats-row');
      expect(statsRow).to.not.be.null;

      const stats = Array.from(statsRow!.querySelectorAll('.stat'));
      const resultingStat = stats.find(s => s.textContent!.includes('Resulting'));
      expect(resultingStat).to.not.be.null;

      const value = resultingStat!.querySelector('.stat-value');
      expect(value!.textContent!.trim()).to.equal('3');
    });

    it('stats show "dropped" count when commits are dropped', async () => {
      const el = await createDialog();
      await openAndWait(el);

      // Drop one commit
      const selects = el.shadowRoot!.querySelectorAll('.action-select') as NodeListOf<HTMLSelectElement>;
      selects[0].value = 'drop';
      selects[0].dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;

      const statsRow = el.shadowRoot!.querySelector('.stats-row');
      const stats = Array.from(statsRow!.querySelectorAll('.stat'));
      const droppedStat = stats.find(s => s.textContent!.includes('Dropped'));
      expect(droppedStat).to.not.be.null;

      const value = droppedStat!.querySelector('.stat-value');
      expect(value!.textContent!.trim()).to.equal('1');
    });

    it('stats show "squashed" count when commits use squash/fixup', async () => {
      const el = await createDialog();
      await openAndWait(el);

      // Squash the second commit
      const selects = el.shadowRoot!.querySelectorAll('.action-select') as NodeListOf<HTMLSelectElement>;
      selects[1].value = 'squash';
      selects[1].dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;

      const statsRow = el.shadowRoot!.querySelector('.stats-row');
      const stats = Array.from(statsRow!.querySelectorAll('.stat'));
      const squashedStat = stats.find(s => s.textContent!.includes('Squashed'));
      expect(squashedStat).to.not.be.null;

      const value = squashedStat!.querySelector('.stat-value');
      expect(value!.textContent!.trim()).to.equal('1');
    });
  });

  // ── Execute ────────────────────────────────────────────────────────────
  describe('Execute', () => {
    it('execute button enabled when commits exist and no validation errors', async () => {
      const el = await createDialog();
      await openAndWait(el);

      const executeBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      expect(executeBtn).to.not.be.null;
      expect(executeBtn.disabled).to.be.false;
      expect(executeBtn.textContent).to.include('Start Rebase');
    });

    it('execute button disabled during execution (shows "Rebasing...")', async () => {
      let resolveExec!: (value: unknown) => void;
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_rebase_commits':
            return mockCommits;
          case 'execute_interactive_rebase':
            return new Promise((resolve) => { resolveExec = resolve; });
          default:
            return null;
        }
      };

      const el = await createDialog();
      await openAndWait(el);

      const executeBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      executeBtn.click();
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 10));
      await el.updateComplete;

      const btnDuring = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      expect(btnDuring.disabled).to.be.true;
      expect(btnDuring.textContent).to.include('Rebasing...');

      // Clean up
      resolveExec(undefined);
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;
    });

    it('execute calls execute_interactive_rebase with correct path, onto, and todo string', async () => {
      const el = await createDialog();
      await openAndWait(el);
      clearHistory();

      const executeBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      executeBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const execCalls = findCommands('execute_interactive_rebase');
      expect(execCalls.length).to.equal(1);

      const args = execCalls[0].args as { path: string; onto: string; todo: string };
      expect(args.path).to.equal(REPO_PATH);
      expect(args.onto).to.equal('main');
      expect(args.todo).to.include('pick aaa1111');
      expect(args.todo).to.include('pick bbb2222');
      expect(args.todo).to.include('pick ccc3333');
    });

    it('rebase-complete event dispatched on success', async () => {
      const el = await createDialog();
      await openAndWait(el);

      let eventFired = false;
      el.addEventListener('rebase-complete', () => { eventFired = true; });

      const executeBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      executeBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      expect(eventFired).to.be.true;
    });

    it('error message shown when execute fails', async () => {
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_rebase_commits':
            return mockCommits;
          case 'execute_interactive_rebase':
            throw new Error('Rebase failed: conflicts detected');
          default:
            return null;
        }
      };

      const el = await createDialog();
      await openAndWait(el);

      const executeBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      executeBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const errorMsg = el.shadowRoot!.querySelector('.error-message');
      expect(errorMsg).to.not.be.null;
      expect(errorMsg!.textContent).to.include('Rebase failed');
    });
  });

  // ── Conflict handling ──────────────────────────────────────────────────
  describe('Conflict handling', () => {
    it('REBASE_CONFLICT error dispatches open-conflict-dialog with { operationType: rebase }', async () => {
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_rebase_commits':
            return mockCommits;
          case 'execute_interactive_rebase':
            // Tauri serializes Rust errors as objects, caught by invokeCommand
            throw { code: 'REBASE_CONFLICT', message: 'Conflict during rebase' };
          default:
            return null;
        }
      };

      const el = await createDialog();
      await openAndWait(el);

      let conflictDetail: { operationType?: string } | null = null;
      el.addEventListener('open-conflict-dialog', ((e: CustomEvent) => {
        conflictDetail = e.detail;
      }) as EventListener);

      const executeBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      executeBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      expect(conflictDetail).to.not.be.null;
      expect(conflictDetail!.operationType).to.equal('rebase');
    });

    it('dialog closes on conflict (modal.open becomes false)', async () => {
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_rebase_commits':
            return mockCommits;
          case 'execute_interactive_rebase':
            throw { code: 'REBASE_CONFLICT', message: 'Conflict during rebase' };
          default:
            return null;
        }
      };

      const el = await createDialog();
      await openAndWait(el);

      const modal = el.shadowRoot!.querySelector('lv-modal') as HTMLElement & { open: boolean };
      expect(modal.open).to.be.true;

      const executeBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      executeBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      expect(modal.open).to.be.false;
    });
  });

  // ── Validation errors ──────────────────────────────────────────────────
  describe('Validation errors', () => {
    it('squash at index 0 shows .error-badge in preview', async () => {
      const el = await createDialog();
      await openAndWait(el);

      // Set first commit to squash (orphaned)
      const selects = el.shadowRoot!.querySelectorAll('.action-select') as NodeListOf<HTMLSelectElement>;
      selects[0].value = 'squash';
      selects[0].dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;

      const errorBadge = el.shadowRoot!.querySelector('.error-badge');
      expect(errorBadge).to.not.be.null;
      expect(errorBadge!.textContent).to.include('Error');
    });

    it('execute button disabled when validation errors exist', async () => {
      const el = await createDialog();
      await openAndWait(el);

      // Set first commit to squash (orphaned squash = validation error)
      const selects = el.shadowRoot!.querySelectorAll('.action-select') as NodeListOf<HTMLSelectElement>;
      selects[0].value = 'squash';
      selects[0].dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;

      const executeBtn = el.shadowRoot!.querySelector('.btn-primary') as HTMLButtonElement;
      expect(executeBtn.disabled).to.be.true;
    });
  });

  // ── Drag and drop ──────────────────────────────────────────────────────
  describe('Drag and drop', () => {
    it('commit row has .drag-handle element', async () => {
      const el = await createDialog();
      await openAndWait(el);

      const row = el.shadowRoot!.querySelector('.commit-row');
      const handle = row!.querySelector('.drag-handle');
      expect(handle).to.not.be.null;
    });

    it('commit rows have draggable="true" attribute', async () => {
      const el = await createDialog();
      await openAndWait(el);

      const rows = el.shadowRoot!.querySelectorAll('.commit-row');
      for (const row of Array.from(rows)) {
        expect(row.getAttribute('draggable')).to.equal('true');
      }
    });
  });

  // ── Close/Cancel ───────────────────────────────────────────────────────
  describe('Close/Cancel', () => {
    it('cancel button dispatches close', async () => {
      const el = await createDialog();
      await openAndWait(el);

      const cancelBtn = el.shadowRoot!.querySelector('.btn-secondary') as HTMLButtonElement;
      expect(cancelBtn).to.not.be.null;
      expect(cancelBtn.textContent).to.include('Cancel');

      const modal = el.shadowRoot!.querySelector('lv-modal') as HTMLElement & { open: boolean };
      expect(modal.open).to.be.true;

      cancelBtn.click();
      await el.updateComplete;

      expect(modal.open).to.be.false;
    });

    it('handleModalClose resets state (commits array cleared)', async () => {
      const el = await createDialog();
      await openAndWait(el);

      // Verify commits are loaded
      let rows = el.shadowRoot!.querySelectorAll('.commit-row');
      expect(rows.length).to.equal(3);

      // Simulate modal close event
      const modal = el.shadowRoot!.querySelector('lv-modal')!;
      modal.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      // Commits should be cleared after close handler runs
      rows = el.shadowRoot!.querySelectorAll('.commit-row');
      expect(rows.length).to.equal(0);
    });
  });
});
