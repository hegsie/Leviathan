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
import { uiStore } from '../../../stores/ui.store.ts';
import { settingsStore } from '../../../stores/settings.store.ts';

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

/** Answer for the next confirm dialog. 'Ok' confirms, anything else declines. */
let confirmAnswer = 'Ok';

function setupDefaultMocks(opts: {
  diff?: DiffFile;
  fileContent?: string;
  diffToolConfig?: { tool: string | null };
  readFails?: { code?: string; message: string };
} = {}): void {
  const diff = opts.diff ?? makeDiffFile();
  mockInvoke = async (command: string) => {
    switch (command) {
      case 'get_file_diff':
        return diff;
      case 'get_commit_file_diff':
        return diff;
      case 'read_file_content':
        if (opts.readFails) throw opts.readFails;
        return opts.fileContent ?? 'file content here';
      case 'write_file_content':
        return undefined;
      case 'get_diff_tool':
        return opts.diffToolConfig ?? { tool: null };
      // showConfirm() resolves to (this result === okLabel); default ok is 'Ok'.
      case 'plugin:dialog|message':
        return confirmAnswer;
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

function findWordWrapButton(el: LvDiffView): HTMLElement | null {
  const viewBtns = el.shadowRoot!.querySelectorAll('.view-btn');
  return (
    (Array.from(viewBtns).find((btn) => btn.getAttribute('title') === 'Toggle word wrap') as
      | HTMLElement
      | undefined) ?? null
  );
}

function clickWordWrapButton(el: LvDiffView): void {
  const btn = findWordWrapButton(el);
  expect(btn, 'the word wrap toolbar button exists').to.not.be.null;
  btn!.click();
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-diff-view', () => {
  beforeEach(() => {
    clearHistory();
    setupDefaultMocks();
    confirmAnswer = 'Ok';
    // Word wrap is a shared setting now — start every test from a known off.
    settingsStore.getState().setWordWrap(false);
    localStorage.removeItem('leviathan-diff-word-wrap');
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

    it('says why when the file cannot be opened for editing', async () => {
      // Two reachable failures: the file was deleted or renamed on disk since
      // the last status refresh, or it is not valid UTF-8 despite passing the
      // diff's binary heuristic. Both left the Edit button doing nothing at
      // all — and read_file_content is excluded from the Output panel by its
      // `read_` prefix, so the failure was recorded nowhere.
      setupDefaultMocks({ readFails: { code: 'COMMAND_ERROR', message: 'stream did not contain valid UTF-8' } });
      const el = await renderDiffView();
      uiStore.setState({ toasts: [] });

      (el.shadowRoot!.querySelector('.edit-btn') as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      expect(el.shadowRoot!.querySelector('.editor-textarea'), 'edit mode is not entered').to.be
        .null;
      const errors = uiStore.getState().toasts.filter((t) => t.type === 'error');
      expect(errors.length, 'the click is not silent').to.equal(1);
      expect(errors[0].message).to.contain('UTF-8');
    });

    it('a file that vanished from disk is named, not reported as a decode error', async () => {
      setupDefaultMocks({ readFails: { code: 'FILE_NOT_FOUND', message: 'src/main.ts' } });
      const el = await renderDiffView();
      uiStore.setState({ toasts: [] });

      (el.shadowRoot!.querySelector('.edit-btn') as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const errors = uiStore.getState().toasts.filter((t) => t.type === 'error');
      expect(errors.length).to.equal(1);
      expect(errors[0].message).to.contain('no longer on disk');
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

    it('cancel asks before throwing away typed text', async () => {
      // Every other editing surface in the app (lv-hooks-dialog,
      // lv-merge-editor) confirms this; Escape reaches the same handler, and
      // Escape is bound app-wide to "close diff", so it gets pressed
      // reflexively.
      setupDefaultMocks({ fileContent: 'original content' });
      const el = await renderDiffView();

      const editBtn = el.shadowRoot!.querySelector('.edit-btn') as HTMLElement;
      editBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const textarea = el.shadowRoot!.querySelector('.editor-textarea') as HTMLTextAreaElement;
      textarea.value = 'modified content';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await el.updateComplete;

      confirmAnswer = 'Cancel';
      (el.shadowRoot!.querySelector('.cancel-btn') as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      const stillEditing = el.shadowRoot!.querySelector('.editor-textarea') as HTMLTextAreaElement;
      expect(stillEditing, 'declining keeps the editor open').to.not.be.null;
      expect(stillEditing.value).to.equal('modified content');
    });

    it('cancel with no edits does not nag', async () => {
      setupDefaultMocks({ fileContent: 'original content' });
      const el = await renderDiffView();

      const editBtn = el.shadowRoot!.querySelector('.edit-btn') as HTMLElement;
      editBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      invokeHistory.length = 0;
      confirmAnswer = 'Cancel';
      (el.shadowRoot!.querySelector('.cancel-btn') as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      expect(
        invokeHistory.some((c) => c.command === 'plugin:dialog|message'),
        'nothing is at stake, so nothing is asked',
      ).to.equal(false);
      expect(el.shadowRoot!.querySelector('.editor-textarea')).to.be.null;
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

      // Click Cancel — now confirm-gated, so let the dialog round-trip settle.
      const cancelBtn = el.shadowRoot!.querySelector('.cancel-btn') as HTMLElement;
      cancelBtn.click();
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      // Should be back in diff view
      const diffContent = el.shadowRoot!.querySelector('.diff-content');
      expect(diffContent).to.not.be.null;

      // Editor should be gone
      const editorTextarea = el.shadowRoot!.querySelector('.editor-textarea');
      expect(editorTextarea).to.be.null;
    });

    it('selecting another file closes the editor instead of retargeting it', async () => {
      // This pane is ONE reused element. With the editor open on A and B then
      // selected, the header named B while the textarea still held A's text —
      // and Save writes editContent to this.file.path, i.e. A's content over B,
      // destroying B's uncommitted changes with no git object to recover from.
      setupDefaultMocks({ fileContent: 'contents of A' });
      const el = await renderDiffView({ file: makeStatusEntry({ path: 'A.ts' }) });

      (el.shadowRoot!.querySelector('.edit-btn') as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('.editor-textarea')).to.not.be.null;

      el.file = makeStatusEntry({ path: 'B.ts' });
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      expect(
        el.shadowRoot!.querySelector('.editor-textarea'),
        'the editor does not follow the selection',
      ).to.be.null;
    });

    it("a stale buffer can never be written to the newly selected file", async () => {
      setupDefaultMocks({ fileContent: 'contents of A' });
      const el = await renderDiffView({ file: makeStatusEntry({ path: 'A.ts' }) });

      (el.shadowRoot!.querySelector('.edit-btn') as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const textarea = el.shadowRoot!.querySelector('.editor-textarea') as HTMLTextAreaElement;
      textarea.value = 'edits meant for A';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await el.updateComplete;

      el.file = makeStatusEntry({ path: 'B.ts' });
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      invokeHistory.length = 0;
      // Reach past the UI: even if a save were somehow triggered, the buffer no
      // longer belongs to the displayed file.
      await (el as unknown as { saveEdit: () => Promise<void> }).saveEdit();

      const writes = invokeHistory.filter((c) => c.command === 'write_file_content');
      expect(writes.length, "B.ts is never written with A's content").to.equal(0);
    });
  });

  // ── Conflicted files ──────────────────────────────────────────────────
  describe('conflicted files', () => {
    it('shows the merge-editor redirect instead of a diff', async () => {
      const diff = makeDiffFile({ status: 'conflicted' });
      setupDefaultMocks({ diff, fileContent: CONFLICT_CONTENT });

      const el = await renderDiffView({
        file: makeStatusEntry({ isConflicted: true, status: 'conflicted' }),
      });

      const redirect = el.shadowRoot!.querySelector('.conflict-redirect');
      expect(redirect).to.not.be.null;
      expect(redirect!.textContent).to.include('merge conflicts');
      // No diff body and no edit affordance for conflicted files.
      expect(el.shadowRoot!.querySelector('.diff-content')).to.be.null;
      expect(el.shadowRoot!.querySelector('.edit-btn')).to.be.null;
    });

    it('never renders raw conflict markers', async () => {
      const diff = makeDiffFile({ status: 'conflicted' });
      setupDefaultMocks({ diff, fileContent: CONFLICT_CONTENT });

      const el = await renderDiffView({
        file: makeStatusEntry({ isConflicted: true, status: 'conflicted' }),
      });

      const text = el.shadowRoot!.textContent ?? '';
      for (const marker of ['<<<<<<<', '=======', '>>>>>>>']) {
        expect(text, `UI must never contain "${marker}"`).to.not.include(marker);
      }
    });

    it('does not load the marker-laden diff at all', async () => {
      const diff = makeDiffFile({ status: 'conflicted' });
      setupDefaultMocks({ diff, fileContent: CONFLICT_CONTENT });

      clearHistory();
      await renderDiffView({
        file: makeStatusEntry({ isConflicted: true, status: 'conflicted' }),
      });

      expect(findCommands('get_file_diff').length).to.equal(0);
    });

    it('dispatches open-conflict-dialog when Open Merge Editor is clicked', async () => {
      const diff = makeDiffFile({ status: 'conflicted' });
      setupDefaultMocks({ diff, fileContent: CONFLICT_CONTENT });

      const el = await renderDiffView({
        file: makeStatusEntry({ isConflicted: true, status: 'conflicted' }),
      });

      let dispatched = false;
      el.addEventListener('open-conflict-dialog', () => {
        dispatched = true;
      });

      const btn = el.shadowRoot!.querySelector('.conflict-redirect-btn') as HTMLElement;
      expect(btn).to.not.be.null;
      btn.click();

      expect(dispatched).to.be.true;
    });

    it('does not show the redirect for non-conflicted files', async () => {
      setupDefaultMocks();
      const el = await renderDiffView();

      expect(el.shadowRoot!.querySelector('.conflict-redirect')).to.be.null;
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

    it('toolbar button writes the shared Word Wrap setting', async () => {
      const el = await renderDiffView();

      clickWordWrapButton(el);
      await el.updateComplete;

      expect(settingsStore.getState().wordWrap, 'the app setting is the source of truth').to.be
        .true;
      const diffContent = el.shadowRoot!.querySelector('.diff-content');
      expect(diffContent!.classList.contains('word-wrap')).to.be.true;
    });

    it('renders wrapped when the setting is already on', async () => {
      settingsStore.getState().setWordWrap(true);

      const el = await renderDiffView();

      const diffContent = el.shadowRoot!.querySelector('.diff-content');
      expect(diffContent!.classList.contains('word-wrap')).to.be.true;
      const wordWrapBtn = findWordWrapButton(el);
      expect(wordWrapBtn!.classList.contains('active'), 'the toolbar button reflects it').to.be
        .true;
    });

    it('follows the Settings dialog changing the setting while the diff is open', async () => {
      const el = await renderDiffView();
      let diffContent = el.shadowRoot!.querySelector('.diff-content');
      expect(diffContent!.classList.contains('word-wrap')).to.be.false;

      settingsStore.getState().setWordWrap(true);
      await el.updateComplete;

      diffContent = el.shadowRoot!.querySelector('.diff-content');
      expect(diffContent!.classList.contains('word-wrap')).to.be.true;
    });

    it('no longer writes its own word-wrap storage key', async () => {
      const el = await renderDiffView();

      clickWordWrapButton(el);
      await el.updateComplete;

      expect(localStorage.getItem('leviathan-diff-word-wrap')).to.be.null;
    });

    it('stops following the setting once removed', async () => {
      const el = await renderDiffView();

      el.remove();
      settingsStore.getState().setWordWrap(true);

      expect((el as unknown as { wordWrap: boolean }).wordWrap, 'the subscription is torn down').to
        .be.false;
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

  // ── Split view staging ────────────────────────────────────────────────
  // Split view used to be read-only: no hunk Stage/Unstage buttons, no line
  // checkboxes, no click-to-select and no selection actions bar — while the
  // header still offered the line-selection toggle that did nothing there.
  describe('split view staging', () => {
    function headerBtn(el: LvDiffView, title: string): HTMLElement {
      const btn = Array.from(el.shadowRoot!.querySelectorAll('.view-btn')).find(
        (b) => b.getAttribute('title') === title
      );
      expect(btn, `header button "${title}"`).to.not.be.undefined;
      return btn as HTMLElement;
    }

    async function switchToSplit(el: LvDiffView): Promise<void> {
      headerBtn(el, 'Split view').click();
      await el.updateComplete;
    }

    async function enterLineSelectionMode(el: LvDiffView): Promise<void> {
      headerBtn(el, 'Toggle line selection mode for staging individual lines').click();
      await el.updateComplete;
    }

    /** The Modified pane, which is where the hunk actions live. */
    function modifiedPane(el: LvDiffView): Element {
      const panes = el.shadowRoot!.querySelectorAll('.split-pane');
      expect(panes.length, 'both split panes render').to.equal(2);
      return panes[1];
    }

    function lastPatch(command: string): string {
      const calls = findCommands(command);
      expect(calls.length, `${command} should have been invoked once`).to.equal(1);
      const args = calls[0].args as Record<string, unknown>;
      const payload = (args?.args ?? args) as Record<string, unknown>;
      return String(payload.patch ?? '');
    }

    it('shows Stage buttons on split-view hunk separators for an unstaged file', async () => {
      const el = await renderDiffView({ file: makeStatusEntry({ isStaged: false }) });
      await switchToSplit(el);

      const stageBtn = modifiedPane(el).querySelector('.stage-btn.stage');
      expect(stageBtn, 'the split view offers hunk staging').to.not.be.null;
      expect(stageBtn!.textContent).to.include('Stage');
    });

    it('shows Unstage buttons on split-view hunk separators for a staged file', async () => {
      const el = await renderDiffView({ file: makeStatusEntry({ isStaged: true }) });
      await switchToSplit(el);

      const unstageBtn = modifiedPane(el).querySelector('.stage-btn.unstage');
      expect(unstageBtn, 'the split view offers hunk unstaging').to.not.be.null;
      expect(unstageBtn!.textContent).to.include('Unstage');
    });

    it('stages a hunk from split view', async () => {
      const el = await renderDiffView({ file: makeStatusEntry({ isStaged: false }) });
      await switchToSplit(el);

      clearHistory();
      (modifiedPane(el).querySelector('.stage-btn.stage') as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      const patch = lastPatch('stage_hunk');
      expect(patch).to.include('+new line');
      expect(patch).to.include('-old line');
    });

    it('does not show stage buttons in split view for commit diffs', async () => {
      const el = await renderDiffView({
        file: null,
        commitFile: { commitOid: 'abc123', filePath: 'src/main.ts' },
      });
      await switchToSplit(el);

      expect(el.shadowRoot!.querySelector('.stage-btn'), 'commit diffs cannot be staged').to.be
        .null;
    });

    it('renders checkboxes on split changed lines in line-selection mode', async () => {
      const el = await renderDiffView();
      await enterLineSelectionMode(el);
      await switchToSplit(el);

      const addCheckbox = el.shadowRoot!.querySelector(
        '.split-line.code-addition .line-checkbox'
      );
      const delCheckbox = el.shadowRoot!.querySelector(
        '.split-line.code-deletion .line-checkbox'
      );
      expect(addCheckbox, 'addition rows are selectable').to.not.be.null;
      expect(delCheckbox, 'deletion rows are selectable').to.not.be.null;
    });

    it('clicking a changed line in split view selects it and shows the selection actions bar', async () => {
      const el = await renderDiffView();
      await enterLineSelectionMode(el);
      await switchToSplit(el);

      const addLine = el.shadowRoot!.querySelector('.split-line.code-addition') as HTMLElement;
      expect(addLine).to.not.be.null;
      addLine.click();
      await el.updateComplete;

      expect(
        el.shadowRoot!.querySelector('.split-line.code-addition')!.classList.contains('selected'),
        'the clicked row is marked selected'
      ).to.be.true;

      const actions = el.shadowRoot!.querySelector('.selection-actions');
      expect(actions, 'the selection actions bar is reachable from split view').to.not.be.null;
      expect(actions!.textContent).to.include('1 line selected');
    });

    it('Stage Selected stages only the lines picked in split view', async () => {
      const el = await renderDiffView();
      await enterLineSelectionMode(el);
      await switchToSplit(el);

      (el.shadowRoot!.querySelector('.split-line.code-addition') as HTMLElement).click();
      await el.updateComplete;

      clearHistory();
      (el.shadowRoot!.querySelector('.selection-actions .selection-btn.primary') as HTMLElement)
        .click();
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      const lines = lastPatch('stage_hunk').split('\n');
      expect(lines).to.include('+new line');
      // The deletion was not selected, so it stays in the index as context.
      expect(lines.some((l) => l.startsWith('-old line'))).to.be.false;
      expect(lines).to.include(' old line');
    });

    it('a whitespace-only split row selects both of its lines', async () => {
      // One change shown on both sides — selecting it must select the
      // deletion AND the addition, the same rule the unified view applies.
      const diff = makeDiffFile({
        hunks: [
          makeDiffHunk({
            header: '@@ -1,2 +1,2 @@',
            oldStart: 1,
            oldLines: 2,
            newStart: 1,
            newLines: 2,
            lines: [
              makeDiffLine({ content: 'ctx', origin: 'context', oldLineNo: 1, newLineNo: 1 }),
              makeDiffLine({
                content: '    indented',
                origin: 'deletion',
                oldLineNo: 2,
                newLineNo: null,
              }),
              makeDiffLine({
                content: '\tindented',
                origin: 'addition',
                oldLineNo: null,
                newLineNo: 2,
              }),
            ],
          }),
        ],
      });
      setupDefaultMocks({ diff });
      const el = await renderDiffView();
      await enterLineSelectionMode(el);
      await switchToSplit(el);

      const panes = el.shadowRoot!.querySelectorAll('.split-pane');
      const leftCell = panes[0].querySelector('.split-line.code-ws-change') as HTMLElement;
      expect(leftCell, 'the whitespace-only row renders on the Original side').to.not.be.null;
      leftCell.click();
      await el.updateComplete;

      const selected = (el as unknown as { selectedLines: Set<string> }).selectedLines;
      expect(Array.from(selected).sort()).to.deep.equal(['0-1', '0-2']);
      expect(
        panes[0].querySelector('.split-line.code-ws-change')!.classList.contains('selected')
      ).to.be.true;
      expect(
        panes[1].querySelector('.split-line.code-ws-change')!.classList.contains('selected')
      ).to.be.true;
    });

    it('surfaces an error when staging a hunk from split view fails', async () => {
      const diff = makeDiffFile();
      mockInvoke = async (command: string) => {
        if (command === 'stage_hunk') throw new Error('index.lock exists');
        if (command === 'get_file_diff') return diff;
        return null;
      };
      const el = await renderDiffView({ file: makeStatusEntry({ isStaged: false }) });
      await switchToSplit(el);
      uiStore.setState({ toasts: [] });

      (modifiedPane(el).querySelector('.stage-btn.stage') as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      const errors = uiStore.getState().toasts.filter((t) => t.type === 'error');
      expect(errors.length, 'the failure is not silent').to.equal(1);
      expect(errors[0].message).to.include('Failed to stage hunk');
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

  // ── Truncated / full diff ─────────────────────────────────────────────
  describe('truncated diff', () => {
    it('passes a default maxLines cap on the initial working diff fetch', async () => {
      setupDefaultMocks();
      await renderDiffView({ file: makeStatusEntry() });

      const calls = findCommands('get_file_diff');
      expect(calls.length).to.be.greaterThan(0);
      const args = calls[calls.length - 1].args as { maxLines?: number };
      expect(args.maxLines).to.equal(3000);
    });

    it('passes a default maxLines cap on the initial commit diff fetch', async () => {
      setupDefaultMocks();
      await renderDiffView({
        file: null,
        commitFile: { commitOid: 'abc123', filePath: 'src/main.ts' },
      });

      const calls = findCommands('get_commit_file_diff');
      expect(calls.length).to.be.greaterThan(0);
      const args = calls[calls.length - 1].args as { maxLines?: number };
      expect(args.maxLines).to.equal(3000);
    });

    it('shows the "Load full diff" banner when the diff is truncated', async () => {
      const diff = makeDiffFile({ truncated: true, totalLines: 50000 });
      setupDefaultMocks({ diff });
      const el = await renderDiffView();

      const banner = el.shadowRoot!.querySelector('.large-diff-info');
      expect(banner).to.not.be.null;
      const btn = banner!.querySelector('.btn-link');
      expect(btn).to.not.be.null;
      expect(btn!.textContent).to.include('Load full diff');
    });

    it('re-fetches without a maxLines cap and hides the banner when "Load full diff" is clicked', async () => {
      // First load: truncated. Second load (full): not truncated.
      let firstLoad = true;
      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_file_diff': {
            if (firstLoad) {
              firstLoad = false;
              return makeDiffFile({ truncated: true, totalLines: 50000 });
            }
            return makeDiffFile({ truncated: false });
          }
          case 'get_diff_tool':
            return { tool: null };
          default:
            return null;
        }
      };

      const el = await renderDiffView();

      // Banner present initially
      expect(el.shadowRoot!.querySelector('.large-diff-info')).to.not.be.null;

      clearHistory();
      const btn = el.shadowRoot!.querySelector('.large-diff-info .btn-link') as HTMLElement;
      btn.click();

      // Wait for the re-fetch to settle
      const start = Date.now();
      while (Date.now() - start < 2000) {
        await new Promise((r) => setTimeout(r, 50));
        await el.updateComplete;
        if (!(el as unknown as { loading: boolean }).loading) break;
      }
      await el.updateComplete;

      // The re-fetch used no maxLines cap
      const calls = findCommands('get_file_diff');
      expect(calls.length).to.be.greaterThan(0);
      const args = calls[calls.length - 1].args as { maxLines?: number };
      expect(args.maxLines).to.equal(undefined);

      // Banner is gone now that the full diff is loaded
      expect(el.shadowRoot!.querySelector('.large-diff-info')).to.be.null;
    });

    it('does not dispatch a load-full-diff event (handled internally)', async () => {
      const diff = makeDiffFile({ truncated: true, totalLines: 50000 });
      setupDefaultMocks({ diff });
      const el = await renderDiffView();

      let eventFired = false;
      el.addEventListener('load-full-diff', () => { eventFired = true; });

      const btn = el.shadowRoot!.querySelector('.large-diff-info .btn-link') as HTMLElement;
      btn.click();
      await new Promise((r) => setTimeout(r, 100));
      await el.updateComplete;

      expect(eventFired).to.be.false;
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

  // ── Patch construction: no-newline markers and CRLF content ──────────────
  // Regression tests for hunk/line staging producing patches that byte-match
  // the index (findings: EOFNL markers and CR stripping).
  describe('patch construction', () => {
    async function bareView(): Promise<LvDiffView> {
      const el = await fixture<LvDiffView>(html`<lv-diff-view></lv-diff-view>`);
      await el.updateComplete;
      return el;
    }

    it('buildHunkPatch keeps the \\r in CRLF content lines', async () => {
      const el = await bareView();
      const hunk = makeDiffHunk({
        header: '@@ -1,2 +1,2 @@',
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: [
          makeDiffLine({ content: 'ctx\r\n', origin: 'context', oldLineNo: 1, newLineNo: 1 }),
          makeDiffLine({ content: 'old\r\n', origin: 'deletion', oldLineNo: 2, newLineNo: null }),
          makeDiffLine({ content: 'new\r\n', origin: 'addition', oldLineNo: null, newLineNo: 2 }),
        ],
      });
      (el as unknown as { file: unknown }).file = makeStatusEntry({ path: 'f.txt' });
      (el as unknown as { diff: unknown }).diff = makeDiffFile({ path: 'f.txt', hunks: [hunk] });

      const patch = (el as unknown as { buildHunkPatch: (h: DiffHunk) => string }).buildHunkPatch(hunk);
      const patchLines = patch.split('\n');
      // \r is preserved (part of the file bytes); only the \n terminator is stripped.
      expect(patchLines).to.include(' ctx\r');
      expect(patchLines).to.include('-old\r');
      expect(patchLines).to.include('+new\r');
    });

    // A hunk with BOTH a selected and an unselected change of each kind — the
    // shape that made partial unstaging fail on every mixed hunk.
    function mixedHunk() {
      return makeDiffHunk({
        header: '@@ -1,4 +1,4 @@',
        oldStart: 1,
        oldLines: 4,
        newStart: 1,
        newLines: 4,
        lines: [
          makeDiffLine({ content: 'ctx\n', origin: 'context', oldLineNo: 1, newLineNo: 1 }),
          makeDiffLine({ content: 'del-sel\n', origin: 'deletion', oldLineNo: 2, newLineNo: null }),
          makeDiffLine({ content: 'del-unsel\n', origin: 'deletion', oldLineNo: 3, newLineNo: null }),
          makeDiffLine({ content: 'add-sel\n', origin: 'addition', oldLineNo: null, newLineNo: 2 }),
          makeDiffLine({ content: 'add-unsel\n', origin: 'addition', oldLineNo: null, newLineNo: 3 }),
        ],
      });
    }

    async function viewWithMixedHunk(): Promise<LvDiffView> {
      const el = await bareView();
      (el as unknown as { file: unknown }).file = makeStatusEntry({ path: 'f.txt' });
      (el as unknown as { diff: unknown }).diff = makeDiffFile({
        path: 'f.txt',
        hunks: [mixedHunk()],
      });
      // Select the deletion at index 1 and the addition at index 3.
      (el as unknown as { selectedLines: Set<string> }).selectedLines = new Set(['0-1', '0-3']);
      return el;
    }

    type PatchBuilder = { buildSelectedLinesPatch: (d?: 'stage' | 'unstage') => string };

    it('staging keeps an unselected deletion as context and omits an unselected addition', async () => {
      const el = await viewWithMixedHunk();
      const patch = (el as unknown as PatchBuilder).buildSelectedLinesPatch('stage');
      const lines = patch.split('\n');

      expect(lines).to.include('-del-sel');
      expect(lines).to.include('+add-sel');
      // Still in the index, so it is context on both sides.
      expect(lines).to.include(' del-unsel');
      // Not in the index yet, so it must not appear at all.
      expect(lines.some((l) => l.includes('add-unsel'))).to.be.false;
    });

    it('unstaging omits an unselected deletion and keeps an unselected addition as context', async () => {
      const el = await viewWithMixedHunk();
      const patch = (el as unknown as PatchBuilder).buildSelectedLinesPatch('unstage');
      const lines = patch.split('\n');

      expect(lines).to.include('-del-sel');
      expect(lines).to.include('+add-sel');
      // The deletion is already in the index, so this line is NOT there —
      // emitting it as context makes the reverse apply reject the patch.
      expect(
        lines.some((l) => l.includes('del-unsel')),
        'an unselected deletion must not appear in an unstage patch',
      ).to.be.false;
      // The addition IS in the index and is staying, so it is context.
      expect(lines).to.include(' add-unsel');
    });

    it('unstageSelectedLines sends an unstage-shaped patch to the backend', async () => {
      // The direction must be wired at the CALL SITE, not just supported by the
      // builder: unstage_hunk reverse-applies the patch, so a patch built with
      // the staging transformation is rejected for every mixed hunk.
      const el = await viewWithMixedHunk();
      (el as unknown as { repositoryPath: string }).repositoryPath = '/test/repo';

      clearHistory();
      mockInvoke = () => Promise.resolve(null);
      await (el as unknown as { unstageSelectedLines: () => Promise<boolean> }).unstageSelectedLines();

      const calls = findCommands('unstage_hunk');
      expect(calls.length, 'unstage_hunk should have been invoked').to.equal(1);

      const args = calls[0].args as Record<string, unknown>;
      const payload = (args?.args ?? args) as Record<string, unknown>;
      const patch = String(payload.patch ?? payload.patchText ?? '');
      const lines = patch.split('\n');

      expect(
        lines.some((l) => l.includes('del-unsel')),
        'the patch sent to unstage_hunk still used the staging transformation',
      ).to.be.false;
      expect(lines).to.include(' add-unsel');
    });

    it('hunk header counts match the emitted lines in both directions', async () => {
      const countFor = (patch: string) => {
        const lines = patch.split('\n');
        const header = lines.find((l) => l.startsWith('@@'))!;
        const m = /@@ -\d+,(\d+) \+\d+,(\d+) @@/.exec(header)!;
        const body = lines.slice(lines.indexOf(header) + 1).filter((l) => l.length > 0);
        const oldSide = body.filter((l) => l.startsWith(' ') || l.startsWith('-')).length;
        const newSide = body.filter((l) => l.startsWith(' ') || l.startsWith('+')).length;
        return { declaredOld: Number(m[1]), declaredNew: Number(m[2]), oldSide, newSide };
      };

      for (const direction of ['stage', 'unstage'] as const) {
        const el = await viewWithMixedHunk();
        const c = countFor((el as unknown as PatchBuilder).buildSelectedLinesPatch(direction));
        expect(c.declaredOld, `${direction}: old count`).to.equal(c.oldSide);
        expect(c.declaredNew, `${direction}: new count`).to.equal(c.newSide);
      }
    });

    it('buildSelectedLinesPatch emits "\\ No newline at end of file" markers', async () => {
      const el = await bareView();
      // Mirrors libgit2 output for a file whose last line lacks a trailing
      // newline on both sides: the marker follows the annotated content line.
      const hunk = makeDiffHunk({
        header: '@@ -1,3 +1,3 @@',
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        lines: [
          makeDiffLine({ content: 'line1\n', origin: 'context', oldLineNo: 1, newLineNo: 1 }),
          makeDiffLine({ content: 'line2\n', origin: 'context', oldLineNo: 2, newLineNo: 2 }),
          makeDiffLine({ content: 'last', origin: 'deletion', oldLineNo: 3, newLineNo: null }),
          makeDiffLine({ content: '\n\\ No newline at end of file\n', origin: 'add-eofnl', oldLineNo: null, newLineNo: null }),
          makeDiffLine({ content: 'CHANGED', origin: 'addition', oldLineNo: null, newLineNo: 3 }),
          makeDiffLine({ content: '\n\\ No newline at end of file\n', origin: 'del-eofnl', oldLineNo: null, newLineNo: null }),
        ],
      });
      (el as unknown as { file: unknown }).file = makeStatusEntry({ path: 'f.txt' });
      (el as unknown as { diff: unknown }).diff = makeDiffFile({ path: 'f.txt', hunks: [hunk] });
      // Select the deletion (index 2) and the addition (index 4).
      (el as unknown as { selectedLines: Set<string> }).selectedLines = new Set(['0-2', '0-4']);

      const patch = (el as unknown as { buildSelectedLinesPatch: () => string }).buildSelectedLinesPatch();

      // The marker must appear immediately after both the deleted and the added
      // last line — not be dropped.
      expect(patch).to.contain('-last\n\\ No newline at end of file\n');
      expect(patch).to.contain('+CHANGED\n\\ No newline at end of file');
    });

    it('buildSelectedLinesPatch skips the newline marker of an unselected addition', async () => {
      const el = await bareView();
      // Appending a line without a trailing newline: only the new side lacks
      // the newline. If the addition is not selected, its marker must not leak
      // into the patch (which would otherwise fail to apply).
      const hunk = makeDiffHunk({
        header: '@@ -1,1 +1,2 @@',
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        lines: [
          makeDiffLine({ content: 'line1\n', origin: 'context', oldLineNo: 1, newLineNo: 1 }),
          makeDiffLine({ content: 'new', origin: 'addition', oldLineNo: null, newLineNo: 2 }),
          makeDiffLine({ content: '\n\\ No newline at end of file\n', origin: 'del-eofnl', oldLineNo: null, newLineNo: null }),
        ],
      });
      (el as unknown as { file: unknown }).file = makeStatusEntry({ path: 'f.txt' });
      (el as unknown as { diff: unknown }).diff = makeDiffFile({ path: 'f.txt', hunks: [hunk] });
      // Select nothing meaningful — the addition (index 1) is NOT selected.
      (el as unknown as { selectedLines: Set<string> }).selectedLines = new Set(['0-0']);

      const patch = (el as unknown as { buildSelectedLinesPatch: () => string }).buildSelectedLinesPatch();
      // No change selected → empty patch, and certainly no stray marker.
      expect(patch).to.not.contain('No newline at end of file');
    });
  });

  // ── Context-menu line staging ────────────────────────────────────────────
  // Selection keys are positional `${hunkIndex}-${lineIndex}` pairs. A stage or
  // unstage reloads the diff and renumbers those positions, so a selection
  // saved across the call would silently address different code.
  describe('context-menu line staging', () => {
    function stageableHunk(): DiffHunk {
      return makeDiffHunk({
        header: '@@ -1,4 +1,4 @@',
        oldStart: 1,
        oldLines: 4,
        newStart: 1,
        newLines: 4,
        lines: [
          makeDiffLine({ content: 'ctx\n', origin: 'context', oldLineNo: 1, newLineNo: 1 }),
          makeDiffLine({ content: 'del-a\n', origin: 'deletion', oldLineNo: 2, newLineNo: null }),
          makeDiffLine({ content: 'del-b\n', origin: 'deletion', oldLineNo: 3, newLineNo: null }),
          makeDiffLine({ content: 'add-a\n', origin: 'addition', oldLineNo: null, newLineNo: 2 }),
          makeDiffLine({ content: 'add-b\n', origin: 'addition', oldLineNo: null, newLineNo: 3 }),
        ],
      });
    }

    // The same file after one change was applied: one hunk line fewer, so the
    // old key '0-2' now addresses an addition and '0-4' no longer exists.
    function reloadedHunk(): DiffHunk {
      return makeDiffHunk({
        header: '@@ -1,3 +1,3 @@',
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        lines: [
          makeDiffLine({ content: 'ctx\n', origin: 'context', oldLineNo: 1, newLineNo: 1 }),
          makeDiffLine({ content: 'del-b\n', origin: 'deletion', oldLineNo: 2, newLineNo: null }),
          makeDiffLine({ content: 'add-a\n', origin: 'addition', oldLineNo: null, newLineNo: 2 }),
        ],
      });
    }

    type Handlers = {
      handleContextStageLine: () => Promise<void>;
      handleContextUnstageLine: () => Promise<void>;
      stageSelectedLines: () => Promise<boolean>;
      selectedLines: Set<string>;
      lineSelectionMode: boolean;
      diff: DiffFile;
      contextMenu: { visible: boolean; x: number; y: number; line: DiffLine | null; hunk: DiffHunk | null };
    };

    /**
     * Renders the view with two lines already selected by the user ('0-2' and
     * '0-4') and the context menu open on a third line.
     */
    async function viewWithOpenContextMenu(
      opts: { isStaged?: boolean; hunkFails?: boolean } = {},
    ): Promise<LvDiffView> {
      const original = makeDiffFile({ hunks: [stageableHunk()] });
      const reloaded = makeDiffFile({ hunks: [reloadedHunk()] });
      let applied = false;

      mockInvoke = async (command: string) => {
        switch (command) {
          case 'get_file_diff':
            return applied ? reloaded : original;
          case 'get_diff_tool':
            return { tool: null };
          case 'read_file_content':
            return 'file content here';
          case 'stage_hunk':
          case 'unstage_hunk':
            if (opts.hunkFails) throw { code: 'COMMAND_ERROR', message: 'patch does not apply' };
            applied = true;
            return null;
          default:
            return null;
        }
      };

      const el = await renderDiffView({ file: makeStatusEntry({ isStaged: opts.isStaged ?? false }) });
      const view = el as unknown as Handlers;
      const loaded = view.diff;
      view.lineSelectionMode = true;
      // The user's own multi-line selection: del-b and add-b.
      view.selectedLines = new Set(['0-2', '0-4']);
      // The objects MUST come from el.diff — the handler locates them by indexOf.
      view.contextMenu = {
        visible: true,
        x: 0,
        y: 0,
        line: loaded.hunks[0].lines[1],
        hunk: loaded.hunks[0],
      };
      await el.updateComplete;
      return el;
    }

    it('clears the selection after a context-menu stage reloads the diff', async () => {
      const el = await viewWithOpenContextMenu();
      await (el as unknown as Handlers).handleContextStageLine();
      await el.updateComplete;

      expect(
        (el as unknown as Handlers).selectedLines.size,
        'a stale positional selection was restored after the diff reloaded',
      ).to.equal(0);
      expect(el.shadowRoot!.querySelector('.selection-actions')).to.be.null;
      expect(el.shadowRoot!.querySelectorAll('.line.selected').length).to.equal(0);
    });

    it('clears the selection after a context-menu unstage reloads the diff', async () => {
      const el = await viewWithOpenContextMenu({ isStaged: true });
      await (el as unknown as Handlers).handleContextUnstageLine();
      await el.updateComplete;

      expect(
        (el as unknown as Handlers).selectedLines.size,
        'a stale positional selection was restored after the diff reloaded',
      ).to.equal(0);
      expect(el.shadowRoot!.querySelector('.selection-actions')).to.be.null;
      expect(el.shadowRoot!.querySelectorAll('.line.selected').length).to.equal(0);
    });

    it('does not let a follow-up Stage Selected act on stale keys', async () => {
      const el = await viewWithOpenContextMenu();
      await (el as unknown as Handlers).handleContextStageLine();
      await el.updateComplete;

      clearHistory();
      await (el as unknown as Handlers).stageSelectedLines();

      expect(
        findCommands('stage_hunk').length,
        'a stale selection let a second stage send a patch built from renumbered keys',
      ).to.equal(0);
    });

    it('keeps the previous selection when the stage fails', async () => {
      const el = await viewWithOpenContextMenu({ hunkFails: true });
      await (el as unknown as Handlers).handleContextStageLine();
      await el.updateComplete;

      // Nothing was applied, so the diff is untouched and the keys still valid.
      expect([...(el as unknown as Handlers).selectedLines]).to.have.members(['0-2', '0-4']);
      expect(findCommands('stage_hunk').length).to.equal(1);
    });

    it('keeps the previous selection when the clicked line produces no patch', async () => {
      const el = await viewWithOpenContextMenu();
      const view = el as unknown as Handlers;
      // A context line yields an empty patch, so nothing is sent or reloaded.
      view.contextMenu = { ...view.contextMenu, line: view.diff.hunks[0].lines[0] };
      await el.updateComplete;

      clearHistory();
      await view.handleContextStageLine();
      await el.updateComplete;

      expect([...view.selectedLines]).to.have.members(['0-2', '0-4']);
      expect(findCommands('stage_hunk').length).to.equal(0);
    });
  });
});
