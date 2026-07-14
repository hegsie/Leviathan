/**
 * Tests for lv-merge-editor component
 *
 * Tests the structured no-markers merge editor: segment parsing, per-block
 * resolution (ours/theirs/both/edit/reset), whole-file strategies, pane
 * alignment, AI resolution, mark-resolved gating, and the invariant that raw
 * conflict markers never appear in the rendered UI.
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
import '../lv-merge-editor.ts';
import type { LvMergeEditor } from '../lv-merge-editor.ts';
import type { ConflictFile } from '../../../types/git.types.ts';

// ── Test data ──────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

const MARKER_CHARS = ['<<<<<<<', '=======', '>>>>>>>', '|||||||'];

const DEFAULT_WORKDIR_CONTENT =
  'line1\n<<<<<<< HEAD\nline2-ours\n=======\nline2-theirs\n>>>>>>> feature\nline3';

function makeConflictFile(path: string): ConflictFile {
  return {
    path,
    ancestor: { oid: 'base-oid', path, mode: 0o100644 },
    ours: { oid: 'ours-oid', path, mode: 0o100644 },
    theirs: { oid: 'theirs-oid', path, mode: 0o100644 },
    isBinary: false,
  };
}

interface OutputSegmentShape {
  id: number;
  type: 'resolved' | 'conflict';
  lines: string[];
  oursLines: string[];
  theirsLines: string[];
  oursLabel: string;
  theirsLabel: string;
  origin: string | null;
  fromConflict: boolean;
}

interface EditorInternal {
  conflictFile: ConflictFile | null;
  baseContent: string;
  oursContent: string;
  theirsContent: string;
  segments: OutputSegmentShape[];
  loading: boolean;
  loadFailed: boolean;
  aiAvailable: boolean;
  parseSegments: (text: string) => OutputSegmentShape[];
  loadContents: () => Promise<void>;
  handleMarkResolved: () => Promise<void>;
  handleAiResolveAll: () => Promise<void>;
}

// ── Helpers ────────────────────────────────────────────────────────────────
let workdirContent: string | (() => Promise<unknown>) = DEFAULT_WORKDIR_CONTENT;
let aiAvailable = false;
let aiSuggestion: (() => Promise<unknown>) | null = null;

function setupDefaultMocks(): void {
  workdirContent = DEFAULT_WORKDIR_CONTENT;
  aiAvailable = false;
  aiSuggestion = null;
  mockInvoke = async (command: string, args?: unknown) => {
    switch (command) {
      case 'get_blob_content': {
        const blobArgs = args as { oid: string };
        if (blobArgs?.oid === 'base-oid') return 'line1\nline2\nline3';
        if (blobArgs?.oid === 'ours-oid') return 'line1\nline2-ours\nline3';
        if (blobArgs?.oid === 'theirs-oid') return 'line1\nline2-theirs\nline3';
        return '';
      }
      case 'read_file_content':
        if (typeof workdirContent === 'function') return workdirContent();
        return workdirContent;
      case 'get_merge_tool_config':
        return null;
      case 'is_ai_available':
        return aiAvailable;
      case 'suggest_conflict_resolution':
        if (aiSuggestion) return aiSuggestion();
        return { resolvedContent: 'ai-resolved', explanation: 'merged by ai' };
      case 'resolve_conflict':
        return { success: true };
      default:
        return null;
    }
  };
}

async function renderEditor(): Promise<LvMergeEditor> {
  const el = await fixture<LvMergeEditor>(html`
    <lv-merge-editor
      .repositoryPath=${REPO_PATH}
    ></lv-merge-editor>
  `);
  return el;
}

/** Render the editor and load a conflict file through the real load path. */
async function renderLoadedEditor(path = 'src/test.ts'): Promise<LvMergeEditor> {
  const el = await renderEditor();
  const internal = el as unknown as EditorInternal;
  internal.conflictFile = makeConflictFile(path);
  await el.updateComplete;
  // loadContents runs from updated(); poll until it settles (the first load
  // also initializes the syntax highlighter, which can take a while).
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 20));
    if (!internal.loading && (internal.segments.length > 0 || internal.loadFailed)) break;
  }
  await el.updateComplete;
  return el;
}

function internalOf(el: LvMergeEditor): EditorInternal {
  return el as unknown as EditorInternal;
}

function shadowText(el: LvMergeEditor): string {
  return el.shadowRoot!.textContent ?? '';
}

function expectNoMarkers(el: LvMergeEditor): void {
  const text = shadowText(el);
  for (const marker of MARKER_CHARS) {
    expect(text, `UI must never contain "${marker}"`).to.not.include(marker);
  }
}

function findConflictButton(el: LvMergeEditor, label: string): HTMLButtonElement {
  const block = el.shadowRoot!.querySelector('.code-conflict-block');
  expect(block, 'conflict block rendered').to.not.be.null;
  const btn = Array.from(block!.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label
  );
  expect(btn, `conflict button "${label}"`).to.not.be.undefined;
  return btn as HTMLButtonElement;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-merge-editor', () => {
  beforeEach(() => {
    invokeHistory.length = 0;
    setupDefaultMocks();
  });

  // ── Rendering ──────────────────────────────────────────────────────────
  describe('rendering', () => {
    it('renders without errors', async () => {
      const el = await renderEditor();
      expect(el).to.exist;
      expect(el.tagName.toLowerCase()).to.equal('lv-merge-editor');
    });

    it('renders empty state without conflict file', async () => {
      const el = await renderEditor();
      const empty = el.shadowRoot!.querySelector('.empty');
      expect(empty).to.exist;
      expect(empty!.textContent).to.include('Select a file');
    });

    it('renders toolbar and panes when a conflict file loads', async () => {
      const el = await renderLoadedEditor();
      expect(el.shadowRoot!.querySelector('.toolbar')).to.exist;
      expect(el.shadowRoot!.querySelector('#panel-ours')).to.exist;
      expect(el.shadowRoot!.querySelector('#panel-base')).to.exist;
      expect(el.shadowRoot!.querySelector('#panel-theirs')).to.exist;
      expect(el.shadowRoot!.querySelector('#panel-output')).to.exist;
    });

    it('never renders raw conflict markers even though the file has them', async () => {
      const el = await renderLoadedEditor();
      expect(internalOf(el).segments.some((s) => s.type === 'conflict')).to.be.true;
      expectNoMarkers(el);
    });

    it('shows the remaining conflict count', async () => {
      const el = await renderLoadedEditor();
      expect(shadowText(el)).to.include('1 conflict remaining');
    });
  });

  // ── parseSegments ────────────────────────────────────────────────────
  describe('parseSegments', () => {
    it('parses content without conflicts as a single resolved segment', async () => {
      const el = await renderEditor();
      const segments = internalOf(el).parseSegments('line1\nline2\nline3');
      expect(segments.length).to.equal(1);
      expect(segments[0].type).to.equal('resolved');
      expect(segments[0].lines).to.deep.equal(['line1', 'line2', 'line3']);
    });

    it('parses content with one conflict', async () => {
      const el = await renderEditor();
      const segments = internalOf(el).parseSegments(DEFAULT_WORKDIR_CONTENT);
      expect(segments.map((s) => s.type)).to.deep.equal(['resolved', 'conflict', 'resolved']);
      expect(segments[1].oursLines).to.deep.equal(['line2-ours']);
      expect(segments[1].theirsLines).to.deep.equal(['line2-theirs']);
    });

    it('parses multiple conflicts', async () => {
      const el = await renderEditor();
      const text = [
        'a',
        '<<<<<<< HEAD', 'b-ours', '=======', 'b-theirs', '>>>>>>> other',
        'c',
        '<<<<<<< HEAD', 'd-ours', '=======', 'd-theirs', '>>>>>>> other',
        'e',
      ].join('\n');
      const segments = internalOf(el).parseSegments(text);
      expect(segments.filter((s) => s.type === 'conflict').length).to.equal(2);
    });

    it('extracts labels from conflict markers', async () => {
      const el = await renderEditor();
      const segments = internalOf(el).parseSegments(
        '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature/x'
      );
      expect(segments[0].oursLabel).to.equal('HEAD');
      expect(segments[0].theirsLabel).to.equal('feature/x');
    });

    it('defaults to OURS/THEIRS when labels are missing', async () => {
      const el = await renderEditor();
      const segments = internalOf(el).parseSegments('<<<<<<<\nours\n=======\ntheirs\n>>>>>>>');
      expect(segments[0].oursLabel).to.equal('OURS');
      expect(segments[0].theirsLabel).to.equal('THEIRS');
    });

    it('treats a nested "<<<<<<<" line as content', async () => {
      const el = await renderEditor();
      const segments = internalOf(el).parseSegments(
        '<<<<<<< HEAD\nours\n<<<<<<< nested\n=======\ntheirs\n>>>>>>> other'
      );
      expect(segments.length).to.equal(1);
      expect(segments[0].oursLines).to.deep.equal(['ours', '<<<<<<< nested']);
    });

    it('supports diff3 output without leaking the base section into ours', async () => {
      const el = await renderEditor();
      const segments = internalOf(el).parseSegments(
        '<<<<<<< HEAD\nours\n||||||| base\nbase-line\n=======\ntheirs\n>>>>>>> other'
      );
      expect(segments.length).to.equal(1);
      expect(segments[0].oursLines).to.deep.equal(['ours']);
      expect(segments[0].theirsLines).to.deep.equal(['theirs']);
    });

    it('does not mistake a divider banner inside ours for the separator', async () => {
      const el = await renderEditor();
      // The ours side contains a legitimate ====-banner line; only the exact
      // 7-equals line is git's separator.
      const segments = internalOf(el).parseSegments(
        '<<<<<<< HEAD\nfoo\n========================\nbar\n=======\ntheirs-content\n>>>>>>> feature'
      );
      expect(segments.length).to.equal(1);
      expect(segments[0].oursLines).to.deep.equal(['foo', '========================', 'bar']);
      expect(segments[0].theirsLines).to.deep.equal(['theirs-content']);
    });

    it('treats pipe-banner content and diff3 markers in theirs as content', async () => {
      const el = await renderEditor();
      // A ||||||| after the separator is content (git never emits it there);
      // it must not silently discard following lines.
      const segments = internalOf(el).parseSegments(
        '<<<<<<< HEAD\nours\n=======\n||||||||||\ntheirs-content\n>>>>>>> feature'
      );
      expect(segments.length).to.equal(1);
      expect(segments[0].oursLines).to.deep.equal(['ours']);
      expect(segments[0].theirsLines).to.deep.equal(['||||||||||', 'theirs-content']);
    });

    it('parses CRLF files, keeping content line endings intact', async () => {
      const el = await renderEditor();
      const segments = internalOf(el).parseSegments(
        'ctx\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> feature\r\ntail\r'
      );
      expect(segments.map((s) => s.type)).to.deep.equal(['resolved', 'conflict', 'resolved']);
      expect(segments[0].lines).to.deep.equal(['ctx\r']);
      expect(segments[1].oursLines).to.deep.equal(['ours\r']);
      expect(segments[1].theirsLines).to.deep.equal(['theirs\r']);
      expect(segments[1].oursLabel).to.equal('HEAD');
      expect(segments[1].theirsLabel).to.equal('feature');
    });

    it('treats a >>>>>>>-shaped line before the separator as content', async () => {
      const el = await renderEditor();
      // A quoted diff or docs line resembling an end marker inside the ours
      // section must not terminate the conflict — that would drop the real
      // theirs side and leak the true markers as "resolved" text.
      const segments = internalOf(el).parseSegments(
        '<<<<<<< HEAD\nline1\n>>>>>>> quoted diff header\nline3\n=======\ntheirs line\n>>>>>>> feature'
      );
      expect(segments.length).to.equal(1);
      expect(segments[0].type).to.equal('conflict');
      expect(segments[0].oursLines).to.deep.equal([
        'line1',
        '>>>>>>> quoted diff header',
        'line3',
      ]);
      expect(segments[0].theirsLines).to.deep.equal(['theirs line']);
      expect(segments[0].theirsLabel).to.equal('feature');
    });

    it('does not mistake 8+ angle brackets for conflict markers', async () => {
      const el = await renderEditor();
      const segments = internalOf(el).parseSegments('<<<<<<<< not a marker\ncontent');
      expect(segments.length).to.equal(1);
      expect(segments[0].type).to.equal('resolved');
      expect(segments[0].lines).to.deep.equal(['<<<<<<<< not a marker', 'content']);
    });

    it('keeps an unterminated conflict as a conflict block', async () => {
      const el = await renderEditor();
      const segments = internalOf(el).parseSegments(
        'ok\n<<<<<<< HEAD\nours\n=======\ntheirs'
      );
      expect(segments.map((s) => s.type)).to.deep.equal(['resolved', 'conflict']);
      expect(segments[1].theirsLines).to.deep.equal(['theirs']);
    });
  });

  // ── Load failure handling ────────────────────────────────────────────
  describe('load failure', () => {
    it('shows an error state with Retry instead of fabricating a merge', async () => {
      setupDefaultMocks();
      workdirContent = () => Promise.reject(new Error('read failed'));
      const el = await renderLoadedEditor();
      const internal = internalOf(el);

      expect(internal.loadFailed).to.be.true;
      expect(internal.segments).to.deep.equal([]);
      expect(shadowText(el)).to.include('Could not read the merged file');
      const retry = Array.from(el.shadowRoot!.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Retry'
      );
      expect(retry).to.not.be.undefined;
      // Mark Resolved must be disabled — there is nothing trustworthy to write.
      const markBtn = Array.from(el.shadowRoot!.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Mark Resolved'
      ) as HTMLButtonElement;
      expect(markBtn.disabled).to.be.true;
    });

    it('Retry reloads the file and clears the error state', async () => {
      setupDefaultMocks();
      let fail = true;
      workdirContent = () =>
        fail ? Promise.reject(new Error('read failed')) : Promise.resolve(DEFAULT_WORKDIR_CONTENT);
      const el = await renderLoadedEditor();
      expect(internalOf(el).loadFailed).to.be.true;

      fail = false;
      const retry = Array.from(el.shadowRoot!.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Retry'
      ) as HTMLButtonElement;
      retry.click();
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      expect(internalOf(el).loadFailed).to.be.false;
      expect(internalOf(el).segments.length).to.be.greaterThan(0);
    });

    it('treats an empty working-directory file as valid content, not a failure', async () => {
      setupDefaultMocks();
      workdirContent = '';
      const el = await renderLoadedEditor();
      const internal = internalOf(el);
      expect(internal.loadFailed).to.be.false;
      expect(internal.segments.length).to.equal(1);
      expect(internal.segments[0].type).to.equal('resolved');
    });
  });

  // ── Per-block resolution ─────────────────────────────────────────────
  describe('per-block resolution', () => {
    it('Use Ours resolves the block with ours lines and records the origin', async () => {
      const el = await renderLoadedEditor();
      findConflictButton(el, 'Use Ours').click();
      await el.updateComplete;

      const internal = internalOf(el);
      const resolved = internal.segments[1];
      expect(resolved.type).to.equal('resolved');
      expect(resolved.lines).to.deep.equal(['line2-ours']);
      expect(resolved.origin).to.equal('ours');
      expect(resolved.fromConflict).to.be.true;
      expect(shadowText(el)).to.include('No conflicts');
      expectNoMarkers(el);
    });

    it('Use Theirs resolves the block with theirs lines', async () => {
      const el = await renderLoadedEditor();
      findConflictButton(el, 'Use Theirs').click();
      await el.updateComplete;

      const resolved = internalOf(el).segments[1];
      expect(resolved.lines).to.deep.equal(['line2-theirs']);
      expect(resolved.origin).to.equal('theirs');
    });

    it('Use Both keeps ours then theirs', async () => {
      const el = await renderLoadedEditor();
      findConflictButton(el, 'Use Both').click();
      await el.updateComplete;

      const resolved = internalOf(el).segments[1];
      expect(resolved.lines).to.deep.equal(['line2-ours', 'line2-theirs']);
      expect(resolved.origin).to.equal('both');
    });

    it('resolves only the targeted conflict, preserving others', async () => {
      setupDefaultMocks();
      workdirContent = [
        'a',
        '<<<<<<< HEAD', 'b-ours', '=======', 'b-theirs', '>>>>>>> other',
        'c',
        '<<<<<<< HEAD', 'd-ours', '=======', 'd-theirs', '>>>>>>> other',
      ].join('\n');
      const el = await renderLoadedEditor();

      findConflictButton(el, 'Use Ours').click();
      await el.updateComplete;

      const internal = internalOf(el);
      const conflicts = internal.segments.filter((s) => s.type === 'conflict');
      expect(conflicts.length).to.equal(1);
      expect(conflicts[0].oursLines).to.deep.equal(['d-ours']);
      expect(shadowText(el)).to.include('1 conflict remaining');
      expectNoMarkers(el);
    });

    it('Reset reopens a resolved-from-conflict block', async () => {
      const el = await renderLoadedEditor();
      findConflictButton(el, 'Use Ours').click();
      await el.updateComplete;

      const resetBtn = Array.from(el.shadowRoot!.querySelectorAll('.segment-btn')).find(
        (b) => b.textContent?.trim() === 'Reset'
      ) as HTMLButtonElement;
      expect(resetBtn, 'Reset button on resolved-from-conflict segment').to.not.be.undefined;
      resetBtn.click();
      await el.updateComplete;

      const internal = internalOf(el);
      expect(internal.segments[1].type).to.equal('conflict');
      expect(internal.segments[1].oursLines).to.deep.equal(['line2-ours']);
      expect(shadowText(el)).to.include('1 conflict remaining');
    });
  });

  // ── Inline editing ───────────────────────────────────────────────────
  describe('inline editing', () => {
    it('editing a conflict block starts from both sides, never marker text', async () => {
      const el = await renderLoadedEditor();
      findConflictButton(el, 'Edit').click();
      await el.updateComplete;

      const textarea = el.shadowRoot!.querySelector('.segment-editor textarea') as HTMLTextAreaElement;
      expect(textarea).to.not.be.null;
      expect(textarea.value).to.equal('line2-ours\nline2-theirs');
      for (const marker of MARKER_CHARS) {
        expect(textarea.value).to.not.include(marker);
      }
    });

    it('applying a conflict edit resolves the block as manual', async () => {
      const el = await renderLoadedEditor();
      findConflictButton(el, 'Edit').click();
      await el.updateComplete;

      const textarea = el.shadowRoot!.querySelector('.segment-editor textarea') as HTMLTextAreaElement;
      textarea.value = 'hand-merged';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await el.updateComplete;

      const applyBtn = Array.from(el.shadowRoot!.querySelectorAll('.segment-editor button')).find(
        (b) => b.textContent?.trim() === 'Apply'
      ) as HTMLButtonElement;
      applyBtn.click();
      await el.updateComplete;

      const resolved = internalOf(el).segments[1];
      expect(resolved.type).to.equal('resolved');
      expect(resolved.lines).to.deep.equal(['hand-merged']);
      expect(resolved.origin).to.equal('manual');
      expect(shadowText(el)).to.include('No conflicts');
    });

    it('cancelling a conflict edit leaves the block unresolved', async () => {
      const el = await renderLoadedEditor();
      findConflictButton(el, 'Edit').click();
      await el.updateComplete;

      const cancelBtn = Array.from(el.shadowRoot!.querySelectorAll('.segment-editor button')).find(
        (b) => b.textContent?.trim() === 'Cancel'
      ) as HTMLButtonElement;
      cancelBtn.click();
      await el.updateComplete;

      expect(internalOf(el).segments[1].type).to.equal('conflict');
      expect(shadowText(el)).to.include('1 conflict remaining');
    });

    it('resolved text is editable in place', async () => {
      const el = await renderLoadedEditor();
      // First resolved segment ("line1") has an Edit hover action.
      const editBtn = el.shadowRoot!.querySelector('.output-segment .segment-btn') as HTMLButtonElement;
      expect(editBtn.textContent?.trim()).to.equal('Edit');
      editBtn.click();
      await el.updateComplete;

      const textarea = el.shadowRoot!.querySelector('.segment-editor textarea') as HTMLTextAreaElement;
      expect(textarea.value).to.equal('line1');
      textarea.value = 'line1-edited';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await el.updateComplete;

      const applyBtn = Array.from(el.shadowRoot!.querySelectorAll('.segment-editor button')).find(
        (b) => b.textContent?.trim() === 'Apply'
      ) as HTMLButtonElement;
      applyBtn.click();
      await el.updateComplete;

      expect(internalOf(el).segments[0].lines).to.deep.equal(['line1-edited']);
      expect(shadowText(el)).to.include('line1-edited');
    });
  });

  // ── Whole-file strategies ────────────────────────────────────────────
  describe('whole-file strategies', () => {
    it('Use Ours replaces the output with ours content', async () => {
      const el = await renderLoadedEditor();
      const btn = Array.from(el.shadowRoot!.querySelectorAll('.toolbar-actions .btn-ours')).find(
        (b) => b.textContent?.trim() === 'Use Ours'
      ) as HTMLButtonElement;
      btn.click();
      await el.updateComplete;

      const internal = internalOf(el);
      expect(internal.segments.length).to.equal(1);
      expect(internal.segments[0].lines).to.deep.equal(['line1', 'line2-ours', 'line3']);
      expect(internal.segments[0].origin).to.equal('ours');
      expect(shadowText(el)).to.include('No conflicts');
    });

    it('Use Theirs replaces the output with theirs content', async () => {
      const el = await renderLoadedEditor();
      const btn = Array.from(el.shadowRoot!.querySelectorAll('.toolbar-actions .btn-theirs')).find(
        (b) => b.textContent?.trim() === 'Use Theirs'
      ) as HTMLButtonElement;
      btn.click();
      await el.updateComplete;

      expect(internalOf(el).segments[0].lines).to.deep.equal(['line1', 'line2-theirs', 'line3']);
    });

    it('Use Base resets the output to the ancestor content', async () => {
      const el = await renderLoadedEditor();
      const btn = Array.from(el.shadowRoot!.querySelectorAll('.toolbar-actions .btn')).find(
        (b) => b.textContent?.trim() === 'Use Base'
      ) as HTMLButtonElement;
      btn.click();
      await el.updateComplete;

      expect(internalOf(el).segments[0].lines).to.deep.equal(['line1', 'line2', 'line3']);
      expect(internalOf(el).segments[0].origin).to.equal('base');
    });

    it('Reload re-reads the on-disk merge, restoring conflicts', async () => {
      const el = await renderLoadedEditor();
      const useOurs = Array.from(el.shadowRoot!.querySelectorAll('.toolbar-actions .btn-ours')).find(
        (b) => b.textContent?.trim() === 'Use Ours'
      ) as HTMLButtonElement;
      useOurs.click();
      await el.updateComplete;
      expect(internalOf(el).segments.filter((s) => s.type === 'conflict').length).to.equal(0);

      const reload = Array.from(el.shadowRoot!.querySelectorAll('.toolbar-actions .btn')).find(
        (b) => b.textContent?.trim() === 'Reload'
      ) as HTMLButtonElement;
      reload.click();
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      expect(internalOf(el).segments.filter((s) => s.type === 'conflict').length).to.equal(1);
    });
  });

  // ── Mark resolved ──────────────────────────────────────────────────────
  describe('mark resolved', () => {
    it('is disabled while conflicts remain', async () => {
      const el = await renderLoadedEditor();
      const markBtn = Array.from(el.shadowRoot!.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Mark Resolved'
      ) as HTMLButtonElement;
      expect(markBtn.disabled).to.be.true;
    });

    it('refuses to write while conflicts remain even if invoked directly', async () => {
      const el = await renderLoadedEditor();
      invokeHistory.length = 0;
      await internalOf(el).handleMarkResolved();
      expect(invokeHistory.some((h) => h.command === 'resolve_conflict')).to.be.false;
    });

    it('refuses to write after a failed load even if invoked directly', async () => {
      setupDefaultMocks();
      workdirContent = () => Promise.reject(new Error('read failed'));
      const el = await renderLoadedEditor();
      expect(internalOf(el).loadFailed).to.be.true;

      // conflictCount is 0 here (no segments), so without the loadFailed
      // guard this would write an EMPTY file as the resolution.
      invokeHistory.length = 0;
      await internalOf(el).handleMarkResolved();
      expect(invokeHistory.some((h) => h.command === 'resolve_conflict')).to.be.false;
    });

    it('writes marker-free content and dispatches conflict-resolved once resolved', async () => {
      const el = await renderLoadedEditor();
      findConflictButton(el, 'Use Both').click();
      await el.updateComplete;

      let eventFile: string | null = null;
      el.addEventListener('conflict-resolved', ((e: CustomEvent) => {
        eventFile = e.detail.file.path;
      }) as EventListener);

      invokeHistory.length = 0;
      const markBtn = Array.from(el.shadowRoot!.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Mark Resolved'
      ) as HTMLButtonElement;
      expect(markBtn.disabled).to.be.false;
      markBtn.click();
      await new Promise((r) => setTimeout(r, 50));

      const resolveCall = invokeHistory.find((h) => h.command === 'resolve_conflict');
      expect(resolveCall).to.exist;
      const content = (resolveCall!.args as { content: string }).content;
      expect(content).to.equal('line1\nline2-ours\nline2-theirs\nline3');
      for (const marker of MARKER_CHARS) {
        expect(content).to.not.include(marker);
      }
      expect(eventFile).to.equal('src/test.ts');
    });
  });

  // ── Empty-side conflicts (delete/modify hunks) ───────────────────────
  describe('empty-side conflicts', () => {
    it('renders an empty side as such and keeps a removed-section resolution reachable', async () => {
      setupDefaultMocks();
      workdirContent = 'ctx\n<<<<<<< HEAD\n=======\ntheirs-line\n>>>>>>> other\ntail';
      const el = await renderLoadedEditor();

      const block = el.shadowRoot!.querySelector('.code-conflict-block')!;
      expect(block.querySelector('.code-conflict-side-ours')!.textContent).to.include(
        'no lines on this side'
      );

      // Resolving to the empty side yields a zero-line segment; it must still
      // render a placeholder row so its hover actions (Edit/Reset) work.
      findConflictButton(el, 'Use Ours').click();
      await el.updateComplete;

      const resolved = internalOf(el).segments[1];
      expect(resolved.type).to.equal('resolved');
      expect(resolved.lines).to.deep.equal([]);
      const segmentEls = el.shadowRoot!.querySelectorAll('.output-segment');
      const emptySegment = Array.from(segmentEls).find((s) =>
        s.textContent?.includes('removed the section')
      );
      expect(emptySegment, 'placeholder row rendered').to.not.be.undefined;
      expect(emptySegment!.querySelector('.segment-actions .segment-btn')).to.not.be.null;
    });

    it('Edit → Apply on an empty resolution keeps zero lines, not one blank line', async () => {
      setupDefaultMocks();
      workdirContent = 'ctx\n<<<<<<< HEAD\n=======\ntheirs-line\n>>>>>>> other\ntail';
      const el = await renderLoadedEditor();
      findConflictButton(el, 'Use Ours').click();
      await el.updateComplete;
      expect(internalOf(el).segments[1].lines).to.deep.equal([]);

      // Open Edit on the empty placeholder and Apply without typing anything.
      const segmentEls = el.shadowRoot!.querySelectorAll('.output-segment');
      const emptySegment = Array.from(segmentEls).find((s) =>
        s.textContent?.includes('removed the section')
      )!;
      (emptySegment.querySelector('.segment-actions .segment-btn') as HTMLButtonElement).click();
      await el.updateComplete;

      const applyBtn = Array.from(el.shadowRoot!.querySelectorAll('.segment-editor button')).find(
        (b) => b.textContent?.trim() === 'Apply'
      ) as HTMLButtonElement;
      applyBtn.click();
      await el.updateComplete;

      // Still zero lines — no spurious blank line was inserted.
      expect(internalOf(el).segments[1].lines).to.deep.equal([]);
    });
  });

  // ── Add/add conflicts (no common ancestor) ───────────────────────────
  describe('add/add conflicts', () => {
    it('treats an absent ancestor as zero base lines, coloring both sides as additions', async () => {
      setupDefaultMocks();
      mockInvoke = (async (command: string, args?: unknown) => {
        if (command === 'get_blob_content') {
          const blobArgs = args as { oid: string };
          if (blobArgs?.oid === 'ours-oid') return 'a\nb';
          if (blobArgs?.oid === 'theirs-oid') return 'x\ny';
          return '';
        }
        if (command === 'read_file_content')
          return '<<<<<<< HEAD\na\nb\n=======\nx\ny\n>>>>>>> other';
        if (command === 'get_merge_tool_config') return null;
        if (command === 'is_ai_available') return false;
        return null;
      }) as MockInvoke;

      const el = await renderEditor();
      const internal = internalOf(el);
      internal.conflictFile = { ...makeConflictFile('src/new.ts'), ancestor: null };
      await el.updateComplete;
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 20));
        if (!internal.loading && internal.segments.length > 0) break;
      }
      await el.updateComplete;

      // No phantom blank base line: every base-pane row is a filler.
      const baseNumbers = Array.from(
        el.shadowRoot!.querySelectorAll('#panel-base .line-number')
      ).map((n) => n.textContent?.trim());
      expect(baseNumbers.every((n) => n === '')).to.be.true;
      // All ours lines are additions, none miscolored as changed.
      expect(el.shadowRoot!.querySelectorAll('#panel-ours .code-addition').length).to.equal(2);
      expect(el.shadowRoot!.querySelectorAll('#panel-ours .line-changed').length).to.equal(0);

      // There is no ancestor version — offering "Use Base" would stage an
      // empty file as a "common ancestor" that never existed.
      const useBase = Array.from(el.shadowRoot!.querySelectorAll('.toolbar-actions .btn')).find(
        (b) => b.textContent?.trim() === 'Use Base'
      );
      expect(useBase).to.be.undefined;
    });
  });

  // ── Side blob read failures ──────────────────────────────────────────
  describe('side blob read failures', () => {
    it('routes a failed read of an existing side to the Retry state', async () => {
      setupDefaultMocks();
      mockInvoke = (async (command: string, args?: unknown) => {
        if (command === 'get_blob_content') {
          const blobArgs = args as { oid: string };
          // The ours blob EXISTS but its read fails — this must not
          // masquerade as an empty file (Use Ours would truncate it).
          if (blobArgs?.oid === 'ours-oid') return Promise.reject(new Error('read failed'));
          if (blobArgs?.oid === 'base-oid') return 'line1\nline2\nline3';
          if (blobArgs?.oid === 'theirs-oid') return 'line1\nline2-theirs\nline3';
          return '';
        }
        if (command === 'read_file_content') return DEFAULT_WORKDIR_CONTENT;
        if (command === 'get_merge_tool_config') return null;
        if (command === 'is_ai_available') return false;
        return null;
      }) as MockInvoke;

      const el = await renderLoadedEditor();
      const internal = internalOf(el);
      expect(internal.loadFailed).to.be.true;
      expect(shadowText(el)).to.include('Could not read the merged file');
      const markBtn = Array.from(el.shadowRoot!.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Mark Resolved'
      ) as HTMLButtonElement;
      expect(markBtn.disabled).to.be.true;
    });
  });

  // ── Parsed side labels ───────────────────────────────────────────────
  describe('parsed side labels', () => {
    it('shows the branch labels git recorded alongside the generic roles', async () => {
      const el = await renderLoadedEditor();
      const block = el.shadowRoot!.querySelector('.code-conflict-block')!;
      // Default mock content is <<<<<<< HEAD ... >>>>>>> feature
      expect(block.querySelector('.code-conflict-side-ours .code-conflict-side-label')!.textContent)
        .to.include('HEAD');
      expect(block.querySelector('.code-conflict-side-theirs .code-conflict-side-label')!.textContent)
        .to.include('feature');
    });
  });

  // ── Pane alignment ───────────────────────────────────────────────────
  describe('pane alignment', () => {
    it('renders the same number of rows in all three source panes', async () => {
      setupDefaultMocks();
      mockInvoke = (async (command: string, args?: unknown) => {
        if (command === 'get_blob_content') {
          const blobArgs = args as { oid: string };
          if (blobArgs?.oid === 'base-oid') return 'a\nb\nc';
          // ours inserts two lines at the top; theirs deletes one line.
          if (blobArgs?.oid === 'ours-oid') return 'x\ny\na\nb\nc';
          if (blobArgs?.oid === 'theirs-oid') return 'a\nc';
          return '';
        }
        if (command === 'read_file_content') return 'a\nb\nc';
        if (command === 'get_merge_tool_config') return null;
        if (command === 'is_ai_available') return false;
        return null;
      }) as MockInvoke;

      const el = await renderLoadedEditor();
      const rows = (side: string) =>
        el.shadowRoot!.querySelectorAll(`#panel-${side} .code-line`).length;
      expect(rows('ours')).to.equal(rows('base'));
      expect(rows('base')).to.equal(rows('theirs'));
    });

    it('an insertion does not mark every following line as changed', async () => {
      setupDefaultMocks();
      mockInvoke = (async (command: string, args?: unknown) => {
        if (command === 'get_blob_content') {
          const blobArgs = args as { oid: string };
          if (blobArgs?.oid === 'base-oid') return 'a\nb\nc\nd';
          if (blobArgs?.oid === 'ours-oid') return 'new\na\nb\nc\nd';
          if (blobArgs?.oid === 'theirs-oid') return 'a\nb\nc\nd';
          return '';
        }
        if (command === 'read_file_content') return 'a\nb\nc\nd';
        if (command === 'get_merge_tool_config') return null;
        if (command === 'is_ai_available') return false;
        return null;
      }) as MockInvoke;

      const el = await renderLoadedEditor();
      // Exactly one added line in ours; nothing else may be highlighted.
      const additions = el.shadowRoot!.querySelectorAll('#panel-ours .code-addition');
      const changed = el.shadowRoot!.querySelectorAll('#panel-ours .line-changed');
      expect(additions.length).to.equal(1);
      expect(changed.length).to.equal(0);
      expect(shadowText(el)).to.include('1 change from base');
    });
  });

  // ── Operation-aware labels ───────────────────────────────────────────
  describe('operation-aware labels', () => {
    it('labels sides for merge by default', async () => {
      const el = await renderLoadedEditor();
      const text = shadowText(el);
      expect(text).to.include('Ours (Current Branch)');
      expect(text).to.include('Theirs (Incoming)');
    });

    it('labels the swapped sides during a rebase', async () => {
      const el = await renderEditor();
      el.operationType = 'rebase';
      const internal = internalOf(el);
      internal.conflictFile = makeConflictFile('src/test.ts');
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      const text = shadowText(el);
      expect(text).to.include('Ours (Rebasing Onto)');
      expect(text).to.include('Theirs (Your Commit)');
    });

    it('labels stash conflicts as working tree vs stashed changes', async () => {
      const el = await renderEditor();
      el.operationType = 'stash';
      const internal = internalOf(el);
      internal.conflictFile = makeConflictFile('src/test.ts');
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      const text = shadowText(el);
      expect(text).to.include('Ours (Working Tree)');
      expect(text).to.include('Theirs (Stashed Changes)');
    });
  });

  // ── AI resolution ────────────────────────────────────────────────────
  describe('AI resolution', () => {
    it('applies a per-block AI suggestion with origin "ai"', async () => {
      setupDefaultMocks();
      aiAvailable = true;
      const el = await renderLoadedEditor();

      findConflictButton(el, 'AI Suggest').click();
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      const resolved = internalOf(el).segments[1];
      expect(resolved.type).to.equal('resolved');
      expect(resolved.lines).to.deep.equal(['ai-resolved']);
      expect(resolved.origin).to.equal('ai');
      expect(shadowText(el)).to.include('merged by ai');
    });

    it('AI Resolve All stops after the first failure instead of retrying forever', async () => {
      setupDefaultMocks();
      aiAvailable = true;
      workdirContent = [
        '<<<<<<< HEAD', 'a-ours', '=======', 'a-theirs', '>>>>>>> other',
        'mid',
        '<<<<<<< HEAD', 'b-ours', '=======', 'b-theirs', '>>>>>>> other',
      ].join('\n');
      let aiCalls = 0;
      aiSuggestion = () => {
        aiCalls++;
        return Promise.reject(new Error('ai down'));
      };

      const el = await renderLoadedEditor();
      await internalOf(el).handleAiResolveAll();

      expect(aiCalls).to.equal(1);
      expect(internalOf(el).segments.filter((s) => s.type === 'conflict').length).to.equal(2);
    });

    it('skips blocks the user resolved mid-batch instead of aborting', async () => {
      setupDefaultMocks();
      aiAvailable = true;
      workdirContent = [
        '<<<<<<< HEAD', 'a-ours', '=======', 'a-theirs', '>>>>>>> other',
        'mid',
        '<<<<<<< HEAD', 'b-ours', '=======', 'b-theirs', '>>>>>>> other',
      ].join('\n');

      const el = await renderLoadedEditor();
      let aiCalls = 0;
      aiSuggestion = () => {
        aiCalls++;
        if (aiCalls === 1) {
          // While the FIRST block's suggestion is in flight, the user
          // manually resolves the SECOND block. The batch must skip it —
          // not treat it as a failure and abandon the rest.
          const second = el.shadowRoot!.querySelectorAll('.code-conflict-block')[1];
          const useOurs = Array.from(second.querySelectorAll('button')).find(
            (b) => b.textContent?.trim() === 'Use Ours'
          ) as HTMLButtonElement;
          useOurs.click();
        }
        return Promise.resolve({ resolvedContent: 'ai-resolved', explanation: '' });
      };

      await internalOf(el).handleAiResolveAll();
      await el.updateComplete;

      // Only the first block needed an AI call; the second was skipped as
      // already-resolved rather than aborting the batch.
      expect(aiCalls).to.equal(1);
      expect(internalOf(el).segments.filter((s) => s.type === 'conflict').length).to.equal(0);
    });

    it('disables AI Suggest on every block while one suggestion is in flight', async () => {
      setupDefaultMocks();
      aiAvailable = true;
      workdirContent = [
        '<<<<<<< HEAD', 'a-ours', '=======', 'a-theirs', '>>>>>>> other',
        'mid',
        '<<<<<<< HEAD', 'b-ours', '=======', 'b-theirs', '>>>>>>> other',
      ].join('\n');
      let release: (() => void) | null = null;
      aiSuggestion = () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ resolvedContent: 'ai-resolved', explanation: '' });
        });

      const el = await renderLoadedEditor();
      const blocks = el.shadowRoot!.querySelectorAll('.code-conflict-block');
      expect(blocks.length).to.equal(2);

      const aiBtn = (block: Element) =>
        Array.from(block.querySelectorAll('button')).find((b) =>
          b.textContent?.includes('AI')
        ) as HTMLButtonElement;

      aiBtn(blocks[0]).click();
      await el.updateComplete;

      // The OTHER block's AI button must also be disabled — clicking it would
      // silently no-op otherwise.
      const secondBtn = aiBtn(el.shadowRoot!.querySelectorAll('.code-conflict-block')[1]);
      expect(secondBtn.disabled).to.be.true;

      release!();
      await new Promise((r) => setTimeout(r, 20));
      await el.updateComplete;
    });

    it('rejects an AI suggestion that contains conflict markers', async () => {
      setupDefaultMocks();
      aiAvailable = true;
      aiSuggestion = () =>
        Promise.resolve({
          resolvedContent: 'ok line\n<<<<<<< HEAD\nleak\n=======',
          explanation: 'bad',
        });

      const el = await renderLoadedEditor();
      findConflictButton(el, 'AI Suggest').click();
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      // The block stays unresolved and no marker text reaches the DOM.
      expect(internalOf(el).segments[1].type).to.equal('conflict');
      expectNoMarkers(el);
    });

    it('drops a stale AI explanation when the block is reset or re-picked', async () => {
      setupDefaultMocks();
      aiAvailable = true;
      const el = await renderLoadedEditor();

      findConflictButton(el, 'AI Suggest').click();
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;
      expect(shadowText(el)).to.include('merged by ai');

      // Reset the block: the explanation no longer describes anything.
      const resetBtn = Array.from(el.shadowRoot!.querySelectorAll('.segment-btn')).find(
        (b) => b.textContent?.trim() === 'Reset'
      ) as HTMLButtonElement;
      resetBtn.click();
      await el.updateComplete;
      expect(shadowText(el)).to.not.include('merged by ai');

      // Re-picking a side must not resurrect it.
      findConflictButton(el, 'Use Ours').click();
      await el.updateComplete;
      expect(shadowText(el)).to.not.include('merged by ai');
    });

    it('clears AI explanations when a different file loads', async () => {
      setupDefaultMocks();
      aiAvailable = true;
      const el = await renderLoadedEditor();
      findConflictButton(el, 'AI Suggest').click();
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;
      expect(shadowText(el)).to.include('merged by ai');

      const internal = internalOf(el);
      internal.conflictFile = makeConflictFile('src/other.ts');
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;

      expect(shadowText(el)).to.not.include('merged by ai');
    });
  });

  // ── Binary conflicts ────────────────────────────────────────────────────
  describe('binary conflicts', () => {
    it('renders take-side UI (no text editor) for a binary conflict', async () => {
      const el = await renderEditor();
      const internal = el as unknown as { conflictFile: ConflictFile; loading: boolean };
      internal.conflictFile = { ...makeConflictFile('image.png'), isBinary: true };
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 50));
      internal.loading = false;
      await el.updateComplete;

      // No text output panel / editor for binary files.
      expect(el.shadowRoot!.querySelector('.output-panel')).to.be.null;
      expect(el.shadowRoot!.querySelector('.source-panels')).to.be.null;
      // Binary conflict message + side buttons present.
      expect(el.shadowRoot!.textContent).to.include('Binary file conflict');
      expect(el.shadowRoot!.querySelector('.btn-ours')).to.not.be.null;
      expect(el.shadowRoot!.querySelector('.btn-theirs')).to.not.be.null;
    });

    it('resolves a binary conflict via resolve_conflict_take_side, not text resolve', async () => {
      const el = await renderEditor();
      const internal = el as unknown as { conflictFile: ConflictFile; loading: boolean };
      internal.conflictFile = { ...makeConflictFile('image.png'), isBinary: true };
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 50));
      internal.loading = false;
      await el.updateComplete;

      let resolvedFired = false;
      el.addEventListener('conflict-resolved', () => { resolvedFired = true; });

      invokeHistory.length = 0;
      const oursBtn = el.shadowRoot!.querySelector('.btn-ours') as HTMLButtonElement;
      oursBtn.click();
      await new Promise(r => setTimeout(r, 50));

      const takeSide = invokeHistory.find(h => h.command === 'resolve_conflict_take_side');
      expect(takeSide, 'take-side called').to.exist;
      expect((takeSide!.args as Record<string, unknown>).side).to.equal('ours');
      // Text resolve pipeline must NOT be used (would truncate binary to 0 bytes).
      expect(invokeHistory.some(h => h.command === 'resolve_conflict')).to.be.false;
      expect(resolvedFired).to.be.true;
    });
  });

  // ── Deleted-side (modify/delete) conflicts ────────────────────────────────
  describe('deleted-side conflicts', () => {
    it('labels the deleted side and resolves it via take-side (deletion)', async () => {
      const el = await renderEditor();
      const internal = el as unknown as { conflictFile: ConflictFile; loading: boolean };
      // theirs deleted the file; ours modified it.
      internal.conflictFile = { ...makeConflictFile('src/gone.ts'), theirs: null };
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 50));
      internal.loading = false;
      await el.updateComplete;

      const theirsBtn = el.shadowRoot!.querySelector('.toolbar-actions .btn-theirs') as HTMLButtonElement;
      expect(theirsBtn.textContent).to.include('delete file');

      let resolvedFired = false;
      el.addEventListener('conflict-resolved', () => { resolvedFired = true; });

      invokeHistory.length = 0;
      theirsBtn.click();
      await new Promise(r => setTimeout(r, 50));

      const takeSide = invokeHistory.find(h => h.command === 'resolve_conflict_take_side');
      expect(takeSide, 'take-side called for deleted side').to.exist;
      expect((takeSide!.args as Record<string, unknown>).side).to.equal('theirs');
      expect(invokeHistory.some(h => h.command === 'resolve_conflict')).to.be.false;
      expect(resolvedFired).to.be.true;
    });

    it('the pane-header Use button also resolves a deleted side as a deletion', async () => {
      const el = await renderEditor();
      const internal = el as unknown as { conflictFile: ConflictFile; loading: boolean };
      // theirs deleted the file; ours modified it.
      internal.conflictFile = { ...makeConflictFile('src/gone.ts'), theirs: null };
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 50));
      internal.loading = false;
      await el.updateComplete;

      let resolvedFired = false;
      el.addEventListener('conflict-resolved', () => { resolvedFired = true; });

      // The THEIRS pane-header "Use" button must stage the deletion like the
      // toolbar button — not write a 0-byte file from the empty side content.
      invokeHistory.length = 0;
      const theirsHeaderUse = el.shadowRoot!.querySelector(
        '.panel-header.theirs .panel-header-btn'
      ) as HTMLButtonElement;
      theirsHeaderUse.click();
      await new Promise(r => setTimeout(r, 50));

      const takeSide = invokeHistory.find(h => h.command === 'resolve_conflict_take_side');
      expect(takeSide, 'take-side called from pane header').to.exist;
      expect((takeSide!.args as Record<string, unknown>).side).to.equal('theirs');
      expect(invokeHistory.some(h => h.command === 'resolve_conflict')).to.be.false;
      expect(resolvedFired).to.be.true;
    });
  });
});
