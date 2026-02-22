/**
 * Tests for lv-file-status component.
 *
 * Renders the REAL lv-file-status component, mocks only the Tauri invoke
 * layer, and verifies the actual component code renders the correct DOM
 * and calls the right commands.
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
import type { LvFileStatus } from '../sidebar/lv-file-status.ts';
import '../sidebar/lv-file-status.ts';

// ── Test data ──────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

const mockStatusEntries = [
  { path: 'src/app.ts', status: 'modified', isStaged: true, isConflicted: false },
  { path: 'src/utils/helper.ts', status: 'modified', isStaged: false, isConflicted: false },
  { path: 'src/new-file.ts', status: 'new', isStaged: true, isConflicted: false },
  { path: 'README.md', status: 'deleted', isStaged: false, isConflicted: false },
  { path: 'src/renamed.ts', status: 'renamed', isStaged: true, isConflicted: false },
  { path: 'temp.log', status: 'untracked', isStaged: false, isConflicted: false },
  // Partially staged file - same path in both staged and unstaged:
  { path: 'src/partial.ts', status: 'modified', isStaged: true, isConflicted: false },
  { path: 'src/partial.ts', status: 'modified', isStaged: false, isConflicted: false },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function clearHistory(): void {
  invokeHistory.length = 0;
}

function findCommands(name: string): Array<{ command: string; args?: unknown }> {
  return invokeHistory.filter((h) => h.command === name);
}

function setupDefaultMocks(
  opts: { entries?: typeof mockStatusEntries; postStageEntries?: typeof mockStatusEntries } = {},
): void {
  let stageDone = false;
  const entries = opts.entries ?? mockStatusEntries;

  mockInvoke = async (command: string) => {
    switch (command) {
      case 'get_status':
        if (stageDone && opts.postStageEntries) {
          return opts.postStageEntries;
        }
        return entries;
      case 'stage_files':
        stageDone = true;
        return null;
      case 'unstage_files':
        stageDone = true;
        return null;
      case 'discard_changes':
        return null;
      case 'start_watching':
        return null;
      case 'plugin:dialog|confirm':
        return true;
      default:
        return null;
    }
  };
}

async function renderFileStatus(): Promise<LvFileStatus> {
  const el = await fixture<LvFileStatus>(
    html`<lv-file-status .repositoryPath=${REPO_PATH}></lv-file-status>`,
  );
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 50));
  await el.updateComplete;
  return el;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-file-status', () => {
  beforeEach(() => {
    clearHistory();
    setupDefaultMocks();
  });

  // ── 1. Rendering ──────────────────────────────────────────────────────
  describe('rendering', () => {
    it('renders staged section with title "Staged" and correct count', async () => {
      const el = await renderFileStatus();

      const sections = el.shadowRoot!.querySelectorAll('.section');
      expect(sections.length).to.equal(2);

      const stagedSection = sections[0];
      const title = stagedSection.querySelector('.section-title');
      expect(title).to.not.be.null;
      expect(title!.textContent).to.include('Staged');

      const count = stagedSection.querySelector('.section-count');
      expect(count).to.not.be.null;
      // Staged files: src/app.ts, src/new-file.ts, src/renamed.ts, src/partial.ts = 4
      expect(count!.textContent!.trim()).to.equal('4');
    });

    it('renders unstaged section with title "Changes" and correct count', async () => {
      const el = await renderFileStatus();

      const sections = el.shadowRoot!.querySelectorAll('.section');
      const unstagedSection = sections[1];
      const title = unstagedSection.querySelector('.section-title');
      expect(title).to.not.be.null;
      expect(title!.textContent).to.include('Changes');

      const count = unstagedSection.querySelector('.section-count');
      expect(count).to.not.be.null;
      // Unstaged files: src/utils/helper.ts, README.md, temp.log, src/partial.ts = 4
      expect(count!.textContent!.trim()).to.equal('4');
    });

    it('renders each file with file-name and file-dir', async () => {
      const el = await renderFileStatus();

      const fileItems = el.shadowRoot!.querySelectorAll('.file-item');
      expect(fileItems.length).to.be.greaterThanOrEqual(1);

      // Check first staged file: src/app.ts
      const firstItem = fileItems[0];
      const fileName = firstItem.querySelector('.file-name');
      expect(fileName).to.not.be.null;
      expect(fileName!.textContent).to.include('app.ts');

      const fileDir = firstItem.querySelector('.file-dir');
      expect(fileDir).to.not.be.null;
      expect(fileDir!.textContent).to.include('src');
    });

    it('shows clean state when no changes', async () => {
      setupDefaultMocks({ entries: [] });
      const el = await renderFileStatus();

      const cleanState = el.shadowRoot!.querySelector('.clean-state');
      expect(cleanState).to.not.be.null;
      expect(cleanState!.textContent).to.include('Working tree clean');
    });
  });

  // ── 2. Status badges ─────────────────────────────────────────────────
  describe('status badges', () => {
    it('shows "M" badge for modified file', async () => {
      const el = await renderFileStatus();

      const fileItems = el.shadowRoot!.querySelectorAll('.file-item');
      // First staged file is src/app.ts (modified)
      const statusBadge = fileItems[0].querySelector('.file-status');
      expect(statusBadge).to.not.be.null;
      expect(statusBadge!.classList.contains('modified')).to.be.true;
      expect(statusBadge!.textContent!.trim()).to.equal('M');
    });

    it('shows "A" badge for new/added file', async () => {
      const el = await renderFileStatus();

      const fileItems = el.shadowRoot!.querySelectorAll('.file-item');
      // Second staged file is src/new-file.ts (new)
      const statusBadge = fileItems[1].querySelector('.file-status');
      expect(statusBadge).to.not.be.null;
      expect(statusBadge!.classList.contains('new')).to.be.true;
      expect(statusBadge!.textContent!.trim()).to.equal('A');
    });

    it('shows "D" badge for deleted file', async () => {
      const el = await renderFileStatus();

      // Find the unstaged deleted file (README.md)
      const fileItems = el.shadowRoot!.querySelectorAll('.file-item');
      const deletedItem = Array.from(fileItems).find(
        (item) => item.querySelector('.file-status.deleted'),
      );
      expect(deletedItem).to.not.be.undefined;
      const badge = deletedItem!.querySelector('.file-status');
      expect(badge!.textContent!.trim()).to.equal('D');
    });

    it('shows "R" badge for renamed file', async () => {
      const el = await renderFileStatus();

      const fileItems = el.shadowRoot!.querySelectorAll('.file-item');
      const renamedItem = Array.from(fileItems).find(
        (item) => item.querySelector('.file-status.renamed'),
      );
      expect(renamedItem).to.not.be.undefined;
      const badge = renamedItem!.querySelector('.file-status');
      expect(badge!.textContent!.trim()).to.equal('R');
    });

    it('shows "?" badge for untracked file', async () => {
      const el = await renderFileStatus();

      const fileItems = el.shadowRoot!.querySelectorAll('.file-item');
      const untrackedItem = Array.from(fileItems).find(
        (item) => item.querySelector('.file-status.untracked'),
      );
      expect(untrackedItem).to.not.be.undefined;
      const badge = untrackedItem!.querySelector('.file-status');
      expect(badge!.textContent!.trim()).to.equal('?');
    });
  });

  // ── 3. Section collapse ──────────────────────────────────────────────
  describe('section collapse', () => {
    it('collapses staged section when header is clicked', async () => {
      const el = await renderFileStatus();

      const sections = el.shadowRoot!.querySelectorAll('.section');
      const stagedHeader = sections[0].querySelector('.section-header')!;
      const chevron = stagedHeader.querySelector('.chevron')!;

      // Initially expanded
      expect(chevron.classList.contains('expanded')).to.be.true;

      // Click to collapse
      stagedHeader.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      const chevronAfter = sections[0].querySelector('.section-header .chevron')!;
      expect(chevronAfter.classList.contains('expanded')).to.be.false;
    });

    it('expands collapsed section when header is clicked again', async () => {
      const el = await renderFileStatus();

      const sections = el.shadowRoot!.querySelectorAll('.section');
      const stagedHeader = sections[0].querySelector('.section-header')!;

      // Click once to collapse
      stagedHeader.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      // Click again to expand
      const headerAgain = el.shadowRoot!.querySelectorAll('.section')[0].querySelector('.section-header')!;
      headerAgain.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      const chevronAfter = el.shadowRoot!.querySelectorAll('.section')[0].querySelector('.section-header .chevron')!;
      expect(chevronAfter.classList.contains('expanded')).to.be.true;
    });
  });

  // ── 4. Tree view ─────────────────────────────────────────────────────
  describe('tree view', () => {
    it('switches from flat to tree view when view toggle is clicked', async () => {
      const el = await renderFileStatus();

      const viewToggle = el.shadowRoot!.querySelector('.view-toggle')!;
      expect(viewToggle.textContent).to.include('Flat');

      viewToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      const viewToggleAfter = el.shadowRoot!.querySelector('.view-toggle')!;
      expect(viewToggleAfter.classList.contains('active')).to.be.true;
      expect(viewToggleAfter.textContent).to.include('Tree');
    });

    it('shows folder items in tree view', async () => {
      const el = await renderFileStatus();

      const viewToggle = el.shadowRoot!.querySelector('.view-toggle')!;
      viewToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      const folderItems = el.shadowRoot!.querySelectorAll('.folder-item');
      expect(folderItems.length).to.be.greaterThan(0);

      const folderNames = Array.from(folderItems).map(
        (item) => item.querySelector('.folder-name')!.textContent!.trim(),
      );
      expect(folderNames).to.include('src');
    });

    it('shows file count in folder-count', async () => {
      const el = await renderFileStatus();

      const viewToggle = el.shadowRoot!.querySelector('.view-toggle')!;
      viewToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      const folderItems = el.shadowRoot!.querySelectorAll('.folder-item');
      const srcFolder = Array.from(folderItems).find(
        (item) => item.querySelector('.folder-name')!.textContent!.trim() === 'src',
      );
      expect(srcFolder).to.not.be.undefined;
      const folderCount = srcFolder!.querySelector('.folder-count');
      expect(folderCount).to.not.be.null;
      const count = parseInt(folderCount!.textContent!.trim(), 10);
      expect(count).to.be.greaterThan(0);
    });
  });

  // ── 5. File selection ────────────────────────────────────────────────
  describe('file selection', () => {
    it('dispatches file-selected event when a file is clicked', async () => {
      const el = await renderFileStatus();

      let eventDetail: unknown = null;
      el.addEventListener('file-selected', ((e: CustomEvent) => {
        eventDetail = e.detail;
      }) as EventListener);

      const fileItems = el.shadowRoot!.querySelectorAll('.file-item');
      fileItems[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      expect(eventDetail).to.not.be.null;
      expect((eventDetail as { file: { path: string } }).file.path).to.equal('src/app.ts');
    });

    it('adds selected class to clicked file', async () => {
      const el = await renderFileStatus();

      const fileItems = el.shadowRoot!.querySelectorAll('.file-item');
      fileItems[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      const updatedItems = el.shadowRoot!.querySelectorAll('.file-item');
      expect(updatedItems[0].classList.contains('selected')).to.be.true;
    });

    it('ctrl+click adds to selection for multiple selected items', async () => {
      const el = await renderFileStatus();

      const fileItems = el.shadowRoot!.querySelectorAll('.file-item');
      // Click first file
      fileItems[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      // Ctrl+click second file
      fileItems[1].dispatchEvent(
        new MouseEvent('click', { bubbles: true, ctrlKey: true }),
      );
      await el.updateComplete;

      const selectedItems = el.shadowRoot!.querySelectorAll('.file-item.selected');
      expect(selectedItems.length).to.equal(2);
    });

    it('shows selection-actions bar when files are selected', async () => {
      const el = await renderFileStatus();

      // Click an unstaged file to select it
      const fileItems = el.shadowRoot!.querySelectorAll('.file-item');
      // Find an unstaged file item (after the staged ones)
      const stagedCount = 4; // 4 staged files
      fileItems[stagedCount].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;

      const selectionActions = el.shadowRoot!.querySelector('.selection-actions');
      expect(selectionActions).to.not.be.null;

      const selectionCount = selectionActions!.querySelector('.selection-count');
      expect(selectionCount).to.not.be.null;
      expect(selectionCount!.textContent).to.include('1 selected');
    });
  });

  // ── 6. Stage / Unstage ───────────────────────────────────────────────
  describe('stage and unstage', () => {
    it('calls stage_files when stage button is clicked on unstaged file', async () => {
      const el = await renderFileStatus();
      clearHistory();

      // Find an unstaged file's stage button (file-action with title "Stage")
      const sections = el.shadowRoot!.querySelectorAll('.section');
      const unstagedSection = sections[1];
      const fileItems = unstagedSection.querySelectorAll('.file-item');
      const firstUnstagedItem = fileItems[0];

      // Hover to make actions visible, then find the Stage button
      const actions = firstUnstagedItem.querySelectorAll('.file-action');
      const stageBtn = Array.from(actions).find(
        (btn) => btn.getAttribute('title') === 'Stage',
      );
      expect(stageBtn).to.not.be.undefined;

      stageBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const stageCalls = findCommands('stage_files');
      expect(stageCalls.length).to.be.greaterThan(0);
      const stageArgs = stageCalls[0].args as { path: string; paths: string[] };
      expect(stageArgs.path).to.equal(REPO_PATH);
      expect(stageArgs.paths).to.include('src/utils/helper.ts');
    });

    it('calls unstage_files when unstage button is clicked on staged file', async () => {
      const el = await renderFileStatus();
      clearHistory();

      // Find a staged file's unstage button
      const sections = el.shadowRoot!.querySelectorAll('.section');
      const stagedSection = sections[0];
      const fileItems = stagedSection.querySelectorAll('.file-item');
      const firstStagedItem = fileItems[0];

      const actions = firstStagedItem.querySelectorAll('.file-action');
      const unstageBtn = Array.from(actions).find(
        (btn) => btn.getAttribute('title') === 'Unstage',
      );
      expect(unstageBtn).to.not.be.undefined;

      unstageBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const unstageCalls = findCommands('unstage_files');
      expect(unstageCalls.length).to.be.greaterThan(0);
      const unstageArgs = unstageCalls[0].args as { path: string; paths: string[] };
      expect(unstageArgs.path).to.equal(REPO_PATH);
      expect(unstageArgs.paths).to.include('src/app.ts');
    });

    it('calls stage_files with all unstaged paths when Stage All button is clicked', async () => {
      const el = await renderFileStatus();
      clearHistory();

      // Find the Stage All button in the unstaged section header
      const sections = el.shadowRoot!.querySelectorAll('.section');
      const unstagedSection = sections[1];
      const sectionActions = unstagedSection.querySelector('.section-actions');
      expect(sectionActions).to.not.be.null;

      const stageAllBtn = sectionActions!.querySelector('.section-action');
      expect(stageAllBtn).to.not.be.null;

      stageAllBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const stageCalls = findCommands('stage_files');
      expect(stageCalls.length).to.be.greaterThan(0);
      const stageArgs = stageCalls[0].args as { path: string; paths: string[] };
      expect(stageArgs.paths.length).to.equal(4); // 4 unstaged files
    });

    it('calls unstage_files with all staged paths when Unstage All button is clicked', async () => {
      const el = await renderFileStatus();
      clearHistory();

      // Find the Unstage All button in the staged section header
      const sections = el.shadowRoot!.querySelectorAll('.section');
      const stagedSection = sections[0];
      const sectionActions = stagedSection.querySelector('.section-actions');
      expect(sectionActions).to.not.be.null;

      const unstageAllBtn = sectionActions!.querySelector('.section-action');
      expect(unstageAllBtn).to.not.be.null;

      unstageAllBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const unstageCalls = findCommands('unstage_files');
      expect(unstageCalls.length).to.be.greaterThan(0);
      const unstageArgs = unstageCalls[0].args as { path: string; paths: string[] };
      expect(unstageArgs.paths.length).to.equal(4); // 4 staged files
    });

    it('refreshes status after staging a file', async () => {
      const el = await renderFileStatus();
      clearHistory();

      // Stage a file via file action button
      const sections = el.shadowRoot!.querySelectorAll('.section');
      const unstagedSection = sections[1];
      const fileItems = unstagedSection.querySelectorAll('.file-item');
      const stageBtn = fileItems[0].querySelector('.file-action[title="Stage"]');
      expect(stageBtn).to.not.be.null;

      stageBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      // Verify get_status was called again after staging
      const statusCalls = findCommands('get_status');
      expect(statusCalls.length).to.be.greaterThan(0);
    });

    it('stages selected files when stage button on a selected file is clicked', async () => {
      const el = await renderFileStatus();

      // Select two unstaged files
      const fileItems = el.shadowRoot!.querySelectorAll('.file-item');
      const stagedCount = 4;
      // Click first unstaged file
      fileItems[stagedCount].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await el.updateComplete;
      // Ctrl+click second unstaged file
      fileItems[stagedCount + 1].dispatchEvent(
        new MouseEvent('click', { bubbles: true, ctrlKey: true }),
      );
      await el.updateComplete;

      clearHistory();

      // Click the stage button on one of the selected files - should stage all selected
      const updatedItems = el.shadowRoot!.querySelectorAll('.file-item');
      const stageBtn = updatedItems[stagedCount].querySelector('.file-action[title="Stage"]');
      expect(stageBtn).to.not.be.null;

      stageBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const stageCalls = findCommands('stage_files');
      expect(stageCalls.length).to.be.greaterThan(0);
      const stageArgs = stageCalls[0].args as { path: string; paths: string[] };
      expect(stageArgs.paths.length).to.equal(2);
    });
  });

  // ── 7. Partial staging ───────────────────────────────────────────────
  describe('partial staging', () => {
    it('marks file with partial-staged class when it appears in both staged and unstaged', async () => {
      const el = await renderFileStatus();

      const partialItems = el.shadowRoot!.querySelectorAll('.file-item.partial-staged');
      // src/partial.ts should appear in both staged and unstaged
      expect(partialItems.length).to.be.greaterThanOrEqual(1);
    });

    it('shows partial-indicator or partial-badge for partially staged files', async () => {
      const el = await renderFileStatus();

      const partialItems = el.shadowRoot!.querySelectorAll('.file-item.partial-staged');
      expect(partialItems.length).to.be.greaterThan(0);

      const firstPartial = partialItems[0];
      const hasIndicator = firstPartial.querySelector('.partial-indicator') !== null;
      const hasBadge = firstPartial.querySelector('.partial-badge') !== null;
      expect(hasIndicator || hasBadge).to.be.true;
    });
  });

  // ── 8. Context menu ──────────────────────────────────────────────────
  describe('context menu', () => {
    it('shows context menu on right-click', async () => {
      const el = await renderFileStatus();

      const fileItems = el.shadowRoot!.querySelectorAll('.file-item');
      fileItems[0].dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }),
      );
      await el.updateComplete;

      const contextMenu = el.shadowRoot!.querySelector('.context-menu');
      expect(contextMenu).to.not.be.null;
    });

    it('shows "Unstage" menu item for staged file context menu', async () => {
      const el = await renderFileStatus();

      // Right-click on first staged file
      const sections = el.shadowRoot!.querySelectorAll('.section');
      const stagedFiles = sections[0].querySelectorAll('.file-item');
      stagedFiles[0].dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }),
      );
      await el.updateComplete;

      const menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const unstageItem = Array.from(menuItems).find(
        (item) => item.textContent!.trim().includes('Unstage'),
      );
      expect(unstageItem).to.not.be.undefined;
    });

    it('shows "Stage" menu item for unstaged file context menu', async () => {
      const el = await renderFileStatus();

      // Right-click on first unstaged file
      const sections = el.shadowRoot!.querySelectorAll('.section');
      const unstagedFiles = sections[1].querySelectorAll('.file-item');
      unstagedFiles[0].dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }),
      );
      await el.updateComplete;

      const menuItems = el.shadowRoot!.querySelectorAll('.context-menu-item');
      const stageItem = Array.from(menuItems).find(
        (item) => item.textContent!.trim().includes('Stage'),
      );
      expect(stageItem).to.not.be.undefined;
    });

    it('shows "Discard changes" menu item with danger class', async () => {
      const el = await renderFileStatus();

      const fileItems = el.shadowRoot!.querySelectorAll('.file-item');
      fileItems[0].dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }),
      );
      await el.updateComplete;

      const dangerItems = el.shadowRoot!.querySelectorAll('.context-menu-item.danger');
      expect(dangerItems.length).to.be.greaterThan(0);
      const discardItem = Array.from(dangerItems).find(
        (item) => item.textContent!.trim().includes('Discard'),
      );
      expect(discardItem).to.not.be.undefined;
    });
  });

  // ── 9. Error handling ────────────────────────────────────────────────
  describe('error handling', () => {
    it('shows error element when get_status throws', async () => {
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_status':
            throw new Error('Repository not found');
          case 'start_watching':
            return null;
          default:
            return null;
        }
      };

      const el = await renderFileStatus();

      const errorEl = el.shadowRoot!.querySelector('.error');
      expect(errorEl).to.not.be.null;
      expect(errorEl!.textContent).to.include('Repository not found');
    });

    it('shows error when get_status returns unsuccessful result', async () => {
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_status':
            // invokeCommand wraps errors as CommandResult, but the raw invoke
            // just returns data or throws. The component calls gitService.getStatus
            // which calls invokeCommand, which catches the throw and returns
            // { success: false, error: { message: ... } }.
            // So throwing here simulates the Tauri invoke failing.
            throw new Error('Permission denied');
          case 'start_watching':
            return null;
          default:
            return null;
        }
      };

      const el = await renderFileStatus();

      const errorEl = el.shadowRoot!.querySelector('.error');
      expect(errorEl).to.not.be.null;
    });
  });

  // ── 10. Loading state ────────────────────────────────────────────────
  describe('loading state', () => {
    it('shows loading element during initial fetch', async () => {
      // Use a slow mock to catch the loading state
      let resolveStatus: ((value: unknown) => void) | null = null;
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_status':
            return new Promise((resolve) => {
              resolveStatus = resolve;
            });
          case 'start_watching':
            return null;
          default:
            return null;
        }
      };

      const el = await fixture<LvFileStatus>(
        html`<lv-file-status .repositoryPath=${REPO_PATH}></lv-file-status>`,
      );
      await el.updateComplete;

      // While status is loading, should show loading indicator
      const loadingEl = el.shadowRoot!.querySelector('.loading');
      expect(loadingEl).to.not.be.null;
      expect(loadingEl!.textContent).to.include('Loading');

      // Resolve to clean up
      if (resolveStatus) {
        (resolveStatus as (value: unknown) => void)(mockStatusEntries);
      }
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;
    });
  });

  // ── 11. Status changed event ─────────────────────────────────────────
  describe('status-changed event', () => {
    it('dispatches status-changed with correct counts on initial load', async () => {
      let eventDetail: { stagedCount: number; totalCount: number } | null = null;

      const el = await fixture<LvFileStatus>(
        html`<lv-file-status
          .repositoryPath=${REPO_PATH}
          @status-changed=${(e: CustomEvent) => {
            eventDetail = e.detail;
          }}
        ></lv-file-status>`,
      );
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      expect(eventDetail).to.not.be.null;
      expect(eventDetail!.stagedCount).to.equal(4); // 4 staged files
      expect(eventDetail!.totalCount).to.equal(8); // 8 total entries
    });

    it('dispatches updated counts after stage operation', async () => {
      const postStageEntries = [
        // After staging src/utils/helper.ts, it moves from unstaged to staged
        { path: 'src/app.ts', status: 'modified', isStaged: true, isConflicted: false },
        { path: 'src/utils/helper.ts', status: 'modified', isStaged: true, isConflicted: false },
        { path: 'src/new-file.ts', status: 'new', isStaged: true, isConflicted: false },
        { path: 'README.md', status: 'deleted', isStaged: false, isConflicted: false },
        { path: 'src/renamed.ts', status: 'renamed', isStaged: true, isConflicted: false },
        { path: 'temp.log', status: 'untracked', isStaged: false, isConflicted: false },
        { path: 'src/partial.ts', status: 'modified', isStaged: true, isConflicted: false },
        { path: 'src/partial.ts', status: 'modified', isStaged: false, isConflicted: false },
      ];

      setupDefaultMocks({ postStageEntries });
      const events: Array<{ stagedCount: number; totalCount: number }> = [];

      const el = await fixture<LvFileStatus>(
        html`<lv-file-status
          .repositoryPath=${REPO_PATH}
          @status-changed=${(e: CustomEvent) => {
            events.push(e.detail);
          }}
        ></lv-file-status>`,
      );
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      // Should have received initial event
      expect(events.length).to.be.greaterThanOrEqual(1);
      const initialEvent = events[0];
      expect(initialEvent.stagedCount).to.equal(4);

      // Now stage a file
      const sections = el.shadowRoot!.querySelectorAll('.section');
      const unstagedSection = sections[1];
      const fileItems = unstagedSection.querySelectorAll('.file-item');
      const stageBtn = fileItems[0].querySelector('.file-action[title="Stage"]');
      expect(stageBtn).to.not.be.null;

      stageBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 150));
      await el.updateComplete;

      // Should have received another event with updated counts
      expect(events.length).to.be.greaterThan(1);
      const lastEvent = events[events.length - 1];
      expect(lastEvent.stagedCount).to.equal(5); // 5 staged files now
    });
  });
});
