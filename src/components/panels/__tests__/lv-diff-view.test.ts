/**
 * Unit tests for lv-diff-view component.
 *
 * Renders the REAL lv-diff-view component, mocks only the Tauri invoke
 * layer, and verifies the actual component behavior and DOM output.
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
import type { DiffFile, DiffHunk, DiffLine, StatusEntry } from '../../../types/git.types.ts';
import type { LvDiffView } from '../lv-diff-view.ts';

// Import the actual component — registers <lv-diff-view> custom element
import '../lv-diff-view.ts';

// ── Test data ──────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

function makeStatusEntry(overrides: Partial<StatusEntry> = {}): StatusEntry {
  return {
    path: 'src/main.ts',
    status: 'modified',
    isStaged: false,
    isConflicted: false,
    ...overrides,
  };
}

function makeDiffLine(overrides: Partial<DiffLine> = {}): DiffLine {
  return {
    content: 'some content',
    origin: 'context',
    oldLineNo: 1,
    newLineNo: 1,
    ...overrides,
  };
}

function makeDiffHunk(overrides: Partial<DiffHunk> = {}): DiffHunk {
  return {
    header: '@@ -1,5 +1,6 @@',
    oldStart: 1,
    oldLines: 5,
    newStart: 1,
    newLines: 6,
    lines: [
      makeDiffLine({ content: 'unchanged line', origin: 'context', oldLineNo: 1, newLineNo: 1 }),
      makeDiffLine({ content: 'old line', origin: 'deletion', oldLineNo: 2, newLineNo: null }),
      makeDiffLine({ content: 'new line', origin: 'addition', oldLineNo: null, newLineNo: 2 }),
      makeDiffLine({ content: 'another unchanged', origin: 'context', oldLineNo: 3, newLineNo: 3 }),
    ],
    ...overrides,
  };
}

function makeDiffFile(overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    path: 'src/main.ts',
    oldPath: null,
    status: 'modified',
    hunks: [makeDiffHunk()],
    isBinary: false,
    isImage: false,
    imageType: null,
    additions: 1,
    deletions: 1,
    ...overrides,
  };
}

const CONFLICT_CONTENT = [
  'line before conflict',
  '<<<<<<< HEAD',
  'our change line 1',
  'our change line 2',
  '=======',
  'their change line 1',
  '>>>>>>> feature-branch',
  'line after conflict',
].join('\n');

// ── Helpers ────────────────────────────────────────────────────────────────
function clearHistory(): void {
  invokeHistory.length = 0;
}

function findCommands(name: string): Array<{ command: string; args?: unknown }> {
  return invokeHistory.filter((h) => h.command === name);
}

function setupDefaultMocks(opts: {
  diff?: DiffFile;
  fileContent?: string;
  diffToolConfig?: { tool: string | null };
} = {}): void {
  const diff = opts.diff ?? makeDiffFile();
  mockInvoke = async (command: string) => {
    switch (command) {
      case 'get_file_diff':
        return diff;
      case 'get_commit_file_diff':
        return diff;
      case 'read_file_content':
        return opts.fileContent ?? 'file content here';
      case 'write_file_content':
        return undefined;
      case 'get_diff_tool':
        return opts.diffToolConfig ?? { tool: null };
      default:
        return null;
    }
  };
}

async function renderDiffView(props: {
  file?: StatusEntry | null;
  commitFile?: { commitOid: string; filePath: string } | null;
  hasPartialStaging?: boolean;
} = {}): Promise<LvDiffView> {
  const file = props.file !== undefined ? props.file : makeStatusEntry();
  const commitFile = props.commitFile ?? null;
  const hasPartialStaging = props.hasPartialStaging ?? false;

  const el = await fixture<LvDiffView>(
    html`<lv-diff-view
      .repositoryPath=${REPO_PATH}
      .file=${file}
      .commitFile=${commitFile}
      .hasPartialStaging=${hasPartialStaging}
    ></lv-diff-view>`
  );

  // Wait for initial loadWorkingDiff / loadCommitDiff to complete
  // Shiki highlighter init can take longer than 100ms in test environment
  await el.updateComplete;
  const maxWait = 3000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;
    // Check if diff has loaded (loading is false and either diff is set or error is set)
    if (!(el as unknown as { loading: boolean }).loading) break;
  }
  await el.updateComplete;
  return el;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-diff-view', () => {
  beforeEach(() => {
    clearHistory();
    setupDefaultMocks();
  });

  // ── Rendering ──────────────────────────────────────────────────────────
  describe('rendering', () => {
    it('renders diff content with additions highlighted', async () => {
      const el = await renderDiffView();

      const additionLines = el.shadowRoot!.querySelectorAll('.line.code-addition');
      expect(additionLines.length).to.be.greaterThan(0);

      // Check that the + origin char is present
      const originSpan = additionLines[0].querySelector('.line-origin');
      expect(originSpan).to.not.be.null;
      expect(originSpan!.textContent).to.equal('+');
    });

    it('renders diff content with deletions highlighted', async () => {
      const el = await renderDiffView();

      const deletionLines = el.shadowRoot!.querySelectorAll('.line.code-deletion');
      expect(deletionLines.length).to.be.greaterThan(0);

      // Check that the - origin char is present
      const originSpan = deletionLines[0].querySelector('.line-origin');
      expect(originSpan).to.not.be.null;
      expect(originSpan!.textContent).to.equal('-');
    });

    it('renders context lines without addition/deletion classes', async () => {
      const el = await renderDiffView();

      const contextLines = el.shadowRoot!.querySelectorAll('.line.context');
      expect(contextLines.length).to.be.greaterThan(0);

      // Origin char should be a space for context lines
      const originSpan = contextLines[0].querySelector('.line-origin');
      expect(originSpan).to.not.be.null;
      expect(originSpan!.textContent).to.equal(' ');
    });

    it('shows file additions and deletions stats in the header', async () => {
      const diff = makeDiffFile({ additions: 10, deletions: 5 });
      setupDefaultMocks({ diff });
      const el = await renderDiffView();

      const additions = el.shadowRoot!.querySelector('.additions');
      expect(additions).to.not.be.null;
      expect(additions!.textContent).to.include('+10');

      const deletions = el.shadowRoot!.querySelector('.deletions');
      expect(deletions).to.not.be.null;
      expect(deletions!.textContent).to.include('-5');
    });

    it('renders line numbers for old and new lines', async () => {
      const el = await renderDiffView();

      const lineNumbers = el.shadowRoot!.querySelectorAll('.line-no');
      expect(lineNumbers.length).to.be.greaterThan(0);
    });
  });

  // ── Empty state ──────────────────────────────────────────────────────────
  describe('empty state', () => {
    it('shows "No file selected" when no file or commitFile is set', async () => {
      const el = await renderDiffView({ file: null });

      const empty = el.shadowRoot!.querySelector('.empty');
      expect(empty).to.not.be.null;
      expect(empty!.textContent).to.include('No file selected');
    });

    it('shows "No changes to display" when diff is null after loading', async () => {
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_file_diff':
            // Simulate a successful result but with no data to keep diff null
            // The invokeCommand wrapper returns { success: true, data } from invoke result
            // Since diff gets set to result.data when success is true, returning null
            // will mean diff = null (the raw invoke returns the value which becomes data)
            return null;
          case 'get_diff_tool':
            return { tool: null };
          default:
            return null;
        }
      };

      const el = await renderDiffView();

      const empty = el.shadowRoot!.querySelector('.empty');
      expect(empty).to.not.be.null;
    });

    it('shows "No changes in this file" when diff has zero hunks', async () => {
      const diff = makeDiffFile({ hunks: [] });
      setupDefaultMocks({ diff });
      const el = await renderDiffView();

      const empty = el.shadowRoot!.querySelector('.empty');
      expect(empty).to.not.be.null;
      expect(empty!.textContent).to.include('No changes in this file');
    });
  });

  // ── View mode toggle ──────────────────────────────────────────────────
  describe('view mode', () => {
    it('defaults to unified view mode', async () => {
      const el = await renderDiffView();

      // Unified view should be present
      const diffContent = el.shadowRoot!.querySelector('.diff-content');
      expect(diffContent).to.not.be.null;

      // Unified button should be active
      const viewBtns = el.shadowRoot!.querySelectorAll('.view-btn');
      const unifiedBtn = Array.from(viewBtns).find(
        (btn) => btn.getAttribute('title') === 'Unified view'
      );
      expect(unifiedBtn).to.not.be.null;
      expect(unifiedBtn!.classList.contains('active')).to.be.true;
    });

    it('toggles to split view when split button is clicked', async () => {
      const el = await renderDiffView();

      // Click the split view button
      const viewBtns = el.shadowRoot!.querySelectorAll('.view-btn');
      const splitBtn = Array.from(viewBtns).find(
        (btn) => btn.getAttribute('title') === 'Split view'
      );
      expect(splitBtn).to.not.be.null;
      (splitBtn as HTMLElement).click();
      await el.updateComplete;

      // Split container should now be visible
      const splitContainer = el.shadowRoot!.querySelector('.split-container');
      expect(splitContainer).to.not.be.null;

      // Split panes should have "Original" and "Modified" headers
      const paneHeaders = el.shadowRoot!.querySelectorAll('.split-pane-header');
      expect(paneHeaders.length).to.equal(2);
      expect(paneHeaders[0].textContent).to.include('Original');
      expect(paneHeaders[1].textContent).to.include('Modified');
    });

    it('toggles back to unified view from split view', async () => {
      const el = await renderDiffView();

      // Switch to split first
      const viewBtns = el.shadowRoot!.querySelectorAll('.view-btn');
      const splitBtn = Array.from(viewBtns).find(
        (btn) => btn.getAttribute('title') === 'Split view'
      );
      (splitBtn as HTMLElement).click();
      await el.updateComplete;

      // Now switch back to unified
      const updatedBtns = el.shadowRoot!.querySelectorAll('.view-btn');
      const unifiedBtn = Array.from(updatedBtns).find(
        (btn) => btn.getAttribute('title') === 'Unified view'
      );
      (unifiedBtn as HTMLElement).click();
      await el.updateComplete;

      // Unified diff-content should be present
      const diffContent = el.shadowRoot!.querySelector('.diff-content');
      expect(diffContent).to.not.be.null;
    });
  });

  // ── Edit mode ──────────────────────────────────────────────────────────
  describe('edit mode', () => {
    it('shows Edit button for working directory files', async () => {
      const el = await renderDiffView();

      const editBtn = el.shadowRoot!.querySelector('.edit-btn');
      expect(editBtn).to.not.be.null;
      expect(editBtn!.textContent).to.include('Edit');
    });

    it('does not show Edit button for commit diffs', async () => {
      const diff = makeDiffFile();
      setupDefaultMocks({ diff });
      const el = await renderDiffView({
        file: null,
        commitFile: { commitOid: 'abc123', filePath: 'src/main.ts' },
      });

      const editBtn = el.shadowRoot!.querySelector('.edit-btn');
      expect(editBtn).to.be.null;
    });

    it('enters edit mode and shows save/cancel buttons when Edit is clicked', async () => {
      setupDefaultMocks({ fileContent: 'file content here' });
      const el = await renderDiffView();

      // Click Edit button
      const editBtn = el.shadowRoot!.querySelector('.edit-btn') as HTMLElement;
      expect(editBtn).to.not.be.null;
      editBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      // Should now see editor toolbar with Cancel and Save buttons
      const cancelBtn = el.shadowRoot!.querySelector('.cancel-btn');
      expect(cancelBtn).to.not.be.null;
      expect(cancelBtn!.textContent).to.include('Cancel');

      const saveBtn = el.shadowRoot!.querySelector('.save-btn');
      expect(saveBtn).to.not.be.null;
      expect(saveBtn!.textContent).to.include('Save');
    });

    it('shows textarea in edit mode', async () => {
      setupDefaultMocks({ fileContent: 'file content here' });
      const el = await renderDiffView();

      const editBtn = el.shadowRoot!.querySelector('.edit-btn') as HTMLElement;
      editBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const textarea = el.shadowRoot!.querySelector('.editor-textarea') as HTMLTextAreaElement;
      expect(textarea).to.not.be.null;
      expect(textarea.value).to.equal('file content here');
    });
  });

  // ── Unsaved changes indicator ──────────────────────────────────────────
  describe('unsaved changes', () => {
    it('shows unsaved indicator when edit content differs from original', async () => {
      setupDefaultMocks({ fileContent: 'original content' });
      const el = await renderDiffView();

      // Enter edit mode
      const editBtn = el.shadowRoot!.querySelector('.edit-btn') as HTMLElement;
      editBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      // Modify content
      const textarea = el.shadowRoot!.querySelector('.editor-textarea') as HTMLTextAreaElement;
      textarea.value = 'modified content';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await el.updateComplete;

      const indicator = el.shadowRoot!.querySelector('.edit-indicator');
      expect(indicator).to.not.be.null;
      expect(indicator!.textContent).to.include('Unsaved changes');
    });

    it('does not show unsaved indicator when edit content equals original', async () => {
      setupDefaultMocks({ fileContent: 'original content' });
      const el = await renderDiffView();

      // Enter edit mode
      const editBtn = el.shadowRoot!.querySelector('.edit-btn') as HTMLElement;
      editBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      // Content is unchanged
      const indicator = el.shadowRoot!.querySelector('.edit-indicator');
      expect(indicator).to.be.null;
    });

    it('cancel restores to diff view and discards edits', async () => {
      setupDefaultMocks({ fileContent: 'original content' });
      const el = await renderDiffView();

      // Enter edit mode
      const editBtn = el.shadowRoot!.querySelector('.edit-btn') as HTMLElement;
      editBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      // Modify content
      const textarea = el.shadowRoot!.querySelector('.editor-textarea') as HTMLTextAreaElement;
      textarea.value = 'modified content';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await el.updateComplete;

      // Click Cancel
      const cancelBtn = el.shadowRoot!.querySelector('.cancel-btn') as HTMLElement;
      cancelBtn.click();
      await el.updateComplete;

      // Should be back in diff view
      const diffContent = el.shadowRoot!.querySelector('.diff-content');
      expect(diffContent).to.not.be.null;

      // Editor should be gone
      const editorTextarea = el.shadowRoot!.querySelector('.editor-textarea');
      expect(editorTextarea).to.be.null;
    });
  });

  // ── Conflict markers ──────────────────────────────────────────────────
  describe('conflict markers', () => {
    it('shows conflict banner for conflicted files', async () => {
      const diff = makeDiffFile({ status: 'conflicted' });
      setupDefaultMocks({ diff, fileContent: CONFLICT_CONTENT });

      const el = await renderDiffView({
        file: makeStatusEntry({ isConflicted: true, status: 'conflicted' }),
      });

      const conflictBanner = el.shadowRoot!.querySelector('.conflict-banner');
      expect(conflictBanner).to.not.be.null;
    });

    it('shows correct conflict count in banner', async () => {
      const diff = makeDiffFile({ status: 'conflicted' });
      setupDefaultMocks({ diff, fileContent: CONFLICT_CONTENT });

      const el = await renderDiffView({
        file: makeStatusEntry({ isConflicted: true, status: 'conflicted' }),
      });

      const conflictInfo = el.shadowRoot!.querySelector('.conflict-info');
      expect(conflictInfo).to.not.be.null;
      expect(conflictInfo!.textContent).to.include('1 conflict');
    });

    it('does not show conflict banner for non-conflicted files', async () => {
      setupDefaultMocks();
      const el = await renderDiffView();

      const conflictBanner = el.shadowRoot!.querySelector('.conflict-banner');
      expect(conflictBanner).to.be.null;
    });
  });

  // ── Conflict resolution ──────────────────────────────────────────────
  describe('conflict resolution', () => {
    it('shows Accept All Ours and Accept All Theirs buttons in conflict banner', async () => {
      const diff = makeDiffFile({ status: 'conflicted' });
      setupDefaultMocks({ diff, fileContent: CONFLICT_CONTENT });

      const el = await renderDiffView({
        file: makeStatusEntry({ isConflicted: true, status: 'conflicted' }),
      });

      const conflictActions = el.shadowRoot!.querySelector('.conflict-actions');
      expect(conflictActions).to.not.be.null;

      const buttons = conflictActions!.querySelectorAll('.conflict-btn');
      expect(buttons.length).to.equal(2);

      const btnTexts = Array.from(buttons).map((b) => b.textContent?.trim());
      expect(btnTexts).to.include('Accept All Ours');
      expect(btnTexts).to.include('Accept All Theirs');
    });

    it('calls write_file_content when Accept All Ours is clicked', async () => {
      const diff = makeDiffFile({ status: 'conflicted' });
      setupDefaultMocks({ diff, fileContent: CONFLICT_CONTENT });

      const el = await renderDiffView({
        file: makeStatusEntry({ isConflicted: true, status: 'conflicted' }),
      });

      clearHistory();

      // Click Accept All Ours
      const buttons = el.shadowRoot!.querySelectorAll('.conflict-btn');
      const oursBtn = Array.from(buttons).find(
        (btn) => btn.textContent?.trim() === 'Accept All Ours'
      ) as HTMLElement;
      expect(oursBtn).to.not.be.undefined;
      oursBtn.click();

      await new Promise((r) => setTimeout(r, 200));
      await el.updateComplete;

      // Should have called read_file_content then write_file_content
      const readCalls = findCommands('read_file_content');
      expect(readCalls.length).to.be.greaterThan(0);

      const writeCalls = findCommands('write_file_content');
      expect(writeCalls.length).to.be.greaterThan(0);
    });

    it('calls write_file_content when Accept All Theirs is clicked', async () => {
      const diff = makeDiffFile({ status: 'conflicted' });
      setupDefaultMocks({ diff, fileContent: CONFLICT_CONTENT });

      const el = await renderDiffView({
        file: makeStatusEntry({ isConflicted: true, status: 'conflicted' }),
      });

      clearHistory();

      // Click Accept All Theirs
      const buttons = el.shadowRoot!.querySelectorAll('.conflict-btn');
      const theirsBtn = Array.from(buttons).find(
        (btn) => btn.textContent?.trim() === 'Accept All Theirs'
      ) as HTMLElement;
      expect(theirsBtn).to.not.be.undefined;
      theirsBtn.click();

      await new Promise((r) => setTimeout(r, 200));
      await el.updateComplete;

      const writeCalls = findCommands('write_file_content');
      expect(writeCalls.length).to.be.greaterThan(0);
    });
  });

  // ── Partial staging banner ──────────────────────────────────────────────
  describe('partial staging banner', () => {
    it('shows partial staging info when hasPartialStaging is true and file is unstaged', async () => {
      setupDefaultMocks();
      const el = await renderDiffView({
        file: makeStatusEntry({ isStaged: false }),
        hasPartialStaging: true,
      });

      const banner = el.shadowRoot!.querySelector('.partial-staging-info');
      expect(banner).to.not.be.null;
      expect(banner!.textContent).to.include('staged changes');
    });

    it('does not show partial staging info when hasPartialStaging is false', async () => {
      setupDefaultMocks();
      const el = await renderDiffView({
        file: makeStatusEntry({ isStaged: false }),
        hasPartialStaging: false,
      });

      const banner = el.shadowRoot!.querySelector('.partial-staging-info');
      expect(banner).to.be.null;
    });

    it('does not show partial staging info when file is staged', async () => {
      setupDefaultMocks();
      const el = await renderDiffView({
        file: makeStatusEntry({ isStaged: true }),
        hasPartialStaging: true,
      });

      const banner = el.shadowRoot!.querySelector('.partial-staging-info');
      expect(banner).to.be.null;
    });
  });

  // ── Binary files ──────────────────────────────────────────────────────
  describe('file type detection', () => {
    it('shows binary notice for binary non-image files', async () => {
      const diff = makeDiffFile({ isBinary: true, isImage: false });
      setupDefaultMocks({ diff });
      const el = await renderDiffView();

      const binaryNotice = el.shadowRoot!.querySelector('.binary-notice');
      expect(binaryNotice).to.not.be.null;
      expect(binaryNotice!.textContent).to.include('Binary file');
    });

    it('does not show binary notice for text files', async () => {
      setupDefaultMocks();
      const el = await renderDiffView();

      const binaryNotice = el.shadowRoot!.querySelector('.binary-notice');
      expect(binaryNotice).to.be.null;
    });

    it('does not show Edit button for binary files', async () => {
      const diff = makeDiffFile({ isBinary: true, isImage: false });
      setupDefaultMocks({ diff });
      const el = await renderDiffView();

      // Binary notice replaces the entire header, so no edit button
      const editBtn = el.shadowRoot!.querySelector('.edit-btn');
      expect(editBtn).to.be.null;
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────
  describe('error handling', () => {
    it('shows error message when diff loading fails', async () => {
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_file_diff':
            throw new Error('Network error');
          case 'get_diff_tool':
            return { tool: null };
          default:
            return null;
        }
      };

      const el = await renderDiffView();

      const errorDiv = el.shadowRoot!.querySelector('.error');
      expect(errorDiv).to.not.be.null;
      expect(errorDiv!.textContent).to.include('Network error');
    });

    it('shows error from failed CommandResult', async () => {
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_file_diff':
            // invokeCommand wraps thrown errors into { success: false, error: ... }
            // but here we go through invoke directly, which throws and gets caught
            throw { code: 'DIFF_ERROR', message: 'Cannot diff deleted file' };
          case 'get_diff_tool':
            return { tool: null };
          default:
            return null;
        }
      };

      const el = await renderDiffView();

      const errorDiv = el.shadowRoot!.querySelector('.error');
      expect(errorDiv).to.not.be.null;
      expect(errorDiv!.textContent).to.include('Cannot diff deleted file');
    });
  });

  // ── Word wrap toggle ──────────────────────────────────────────────────
  describe('word wrap', () => {
    it('toggles word-wrap class on diff content when word wrap button is clicked', async () => {
      const el = await renderDiffView();

      // Initially no word-wrap
      let diffContent = el.shadowRoot!.querySelector('.diff-content');
      expect(diffContent).to.not.be.null;
      expect(diffContent!.classList.contains('word-wrap')).to.be.false;

      // Click word wrap button
      const viewBtns = el.shadowRoot!.querySelectorAll('.view-btn');
      const wordWrapBtn = Array.from(viewBtns).find(
        (btn) => btn.getAttribute('title') === 'Toggle word wrap'
      );
      expect(wordWrapBtn).to.not.be.null;
      (wordWrapBtn as HTMLElement).click();
      await el.updateComplete;

      diffContent = el.shadowRoot!.querySelector('.diff-content');
      expect(diffContent).to.not.be.null;
      expect(diffContent!.classList.contains('word-wrap')).to.be.true;
    });
  });

  // ── Split view rendering ──────────────────────────────────────────────
  describe('split view rendering', () => {
    it('renders deletion lines on the left pane and addition lines on the right pane', async () => {
      const el = await renderDiffView();

      // Switch to split view
      const viewBtns = el.shadowRoot!.querySelectorAll('.view-btn');
      const splitBtn = Array.from(viewBtns).find(
        (btn) => btn.getAttribute('title') === 'Split view'
      );
      (splitBtn as HTMLElement).click();
      await el.updateComplete;

      const splitPanes = el.shadowRoot!.querySelectorAll('.split-pane');
      expect(splitPanes.length).to.equal(2);

      // Left pane (Original) should have deletion lines
      const leftDeletions = splitPanes[0].querySelectorAll('.split-line.code-deletion');
      expect(leftDeletions.length).to.be.greaterThan(0);

      // Right pane (Modified) should have addition lines
      const rightAdditions = splitPanes[1].querySelectorAll('.split-line.code-addition');
      expect(rightAdditions.length).to.be.greaterThan(0);
    });
  });

  // ── Hunk stage/unstage buttons ────────────────────────────────────────
  describe('hunk staging', () => {
    it('shows Stage button for unstaged file hunks', async () => {
      setupDefaultMocks();
      const el = await renderDiffView({
        file: makeStatusEntry({ isStaged: false }),
      });

      const stageBtn = el.shadowRoot!.querySelector('.stage-btn.stage');
      expect(stageBtn).to.not.be.null;
      expect(stageBtn!.textContent).to.include('Stage');
    });

    it('shows Unstage button for staged file hunks', async () => {
      setupDefaultMocks();
      const el = await renderDiffView({
        file: makeStatusEntry({ isStaged: true }),
      });

      const unstageBtn = el.shadowRoot!.querySelector('.stage-btn.unstage');
      expect(unstageBtn).to.not.be.null;
      expect(unstageBtn!.textContent).to.include('Unstage');
    });

    it('does not show stage buttons for commit diffs', async () => {
      const diff = makeDiffFile();
      setupDefaultMocks({ diff });
      const el = await renderDiffView({
        file: null,
        commitFile: { commitOid: 'abc123', filePath: 'src/main.ts' },
      });

      const stageBtn = el.shadowRoot!.querySelector('.stage-btn');
      expect(stageBtn).to.be.null;
    });
  });

  // ── File status badge ──────────────────────────────────────────────────
  describe('file status badge', () => {
    it('renders the file status badge with correct class', async () => {
      setupDefaultMocks();
      const el = await renderDiffView();

      const statusBadge = el.shadowRoot!.querySelector('.file-status');
      expect(statusBadge).to.not.be.null;
      expect(statusBadge!.classList.contains('modified')).to.be.true;
      expect(statusBadge!.textContent).to.include('modified');
    });

    it('renders "new" status for new files', async () => {
      const diff = makeDiffFile({ status: 'new' });
      setupDefaultMocks({ diff });
      const el = await renderDiffView({
        file: makeStatusEntry({ status: 'new' }),
      });

      const statusBadge = el.shadowRoot!.querySelector('.file-status');
      expect(statusBadge).to.not.be.null;
      expect(statusBadge!.classList.contains('new')).to.be.true;
    });
  });
});
