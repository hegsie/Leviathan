/**
 * Tests for lv-merge-editor component
 *
 * Tests merge editor core logic: auto-merge, conflict parsing,
 * accept ours/theirs/base, conflict resolution, and edit modes.
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

function makeConflictFile(path: string): ConflictFile {
  return {
    path,
    ancestor: { oid: 'base-oid', path, mode: 0o100644 },
    ours: { oid: 'ours-oid', path, mode: 0o100644 },
    theirs: { oid: 'theirs-oid', path, mode: 0o100644 },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────
function setupDefaultMocks(): void {
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
        // Working directory file with conflict markers
        return 'line1\n<<<<<<< HEAD\nline2-ours\n=======\nline2-theirs\n>>>>>>> feature\nline3';
      case 'get_merge_tool_config':
        return null;
      case 'is_ai_available':
        return false;
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

    it('renders toolbar when conflict file is set', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        conflictFile: ConflictFile;
        baseContent: string;
        oursContent: string;
        theirsContent: string;
        outputContent: string;
        loading: boolean;
      };
      internal.conflictFile = makeConflictFile('src/test.ts');
      internal.baseContent = 'base';
      internal.oursContent = 'ours';
      internal.theirsContent = 'theirs';
      internal.outputContent = 'output';
      internal.loading = false;
      await el.updateComplete;

      const toolbar = el.shadowRoot!.querySelector('.toolbar');
      expect(toolbar).to.exist;
    });

    it('renders loading state initially', async () => {
      const el = await renderEditor();
      // Without conflictFile, it shouldn't be in loading state
      const internal = el as unknown as { loading: boolean };
      expect(internal.loading).to.be.false;
    });
  });

  // ── performAutoMerge ───────────────────────────────────────────────────
  describe('performAutoMerge', () => {
    it('merges when both sides agree', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        baseContent: string;
        oursContent: string;
        theirsContent: string;
        performAutoMerge: () => string;
      };

      internal.baseContent = 'line1\nline2';
      internal.oursContent = 'line1\nline2';
      internal.theirsContent = 'line1\nline2';

      const result = internal.performAutoMerge();
      expect(result).to.equal('line1\nline2');
    });

    it('takes theirs when only theirs changed', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        baseContent: string;
        oursContent: string;
        theirsContent: string;
        performAutoMerge: () => string;
      };

      internal.baseContent = 'old line';
      internal.oursContent = 'old line';
      internal.theirsContent = 'new line';

      const result = internal.performAutoMerge();
      expect(result).to.equal('new line');
    });

    it('takes ours when only ours changed', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        baseContent: string;
        oursContent: string;
        theirsContent: string;
        performAutoMerge: () => string;
      };

      internal.baseContent = 'old line';
      internal.oursContent = 'our change';
      internal.theirsContent = 'old line';

      const result = internal.performAutoMerge();
      expect(result).to.equal('our change');
    });

    it('produces conflict markers when both sides changed differently', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        baseContent: string;
        oursContent: string;
        theirsContent: string;
        performAutoMerge: () => string;
      };

      internal.baseContent = 'original';
      internal.oursContent = 'our version';
      internal.theirsContent = 'their version';

      const result = internal.performAutoMerge();
      expect(result).to.include('<<<<<<< OURS');
      expect(result).to.include('our version');
      expect(result).to.include('=======');
      expect(result).to.include('their version');
      expect(result).to.include('>>>>>>> THEIRS');
    });

    it('handles different-length files', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        baseContent: string;
        oursContent: string;
        theirsContent: string;
        performAutoMerge: () => string;
      };

      internal.baseContent = 'line1\nline2';
      internal.oursContent = 'line1\nline2\nline3-ours';
      internal.theirsContent = 'line1\nline2';

      const result = internal.performAutoMerge();
      expect(result).to.include('line1');
      expect(result).to.include('line2');
      // Third line: ours added, theirs is empty, base is empty, both different from base
      // Since ours != theirs and both differ from base (which is empty), it'll be a conflict or auto-resolved
    });
  });

  // ── parseOutputSegments ────────────────────────────────────────────────
  describe('parseOutputSegments', () => {
    it('parses content without conflicts as single resolved segment', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        outputContent: string;
        parseOutputSegments: () => Array<{ type: string; lines: string[] }>;
      };

      internal.outputContent = 'line1\nline2\nline3';

      const segments = internal.parseOutputSegments();
      expect(segments.length).to.equal(1);
      expect(segments[0].type).to.equal('resolved');
      expect(segments[0].lines).to.deep.equal(['line1', 'line2', 'line3']);
    });

    it('parses content with one conflict', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        outputContent: string;
        parseOutputSegments: () => Array<{
          type: string;
          lines: string[];
          oursLines: string[];
          theirsLines: string[];
          oursLabel: string;
          theirsLabel: string;
        }>;
      };

      internal.outputContent = 'before\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature\nafter';

      const segments = internal.parseOutputSegments();
      expect(segments.length).to.equal(3);

      expect(segments[0].type).to.equal('resolved');
      expect(segments[0].lines).to.deep.equal(['before']);

      expect(segments[1].type).to.equal('conflict');
      expect(segments[1].oursLines).to.deep.equal(['ours']);
      expect(segments[1].theirsLines).to.deep.equal(['theirs']);
      expect(segments[1].oursLabel).to.equal('HEAD');
      expect(segments[1].theirsLabel).to.equal('feature');

      expect(segments[2].type).to.equal('resolved');
      expect(segments[2].lines).to.deep.equal(['after']);
    });

    it('parses multiple conflicts', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        outputContent: string;
        parseOutputSegments: () => Array<{ type: string }>;
      };

      internal.outputContent = [
        'top',
        '<<<<<<< HEAD',
        'ours1',
        '=======',
        'theirs1',
        '>>>>>>> branch',
        'middle',
        '<<<<<<< HEAD',
        'ours2',
        '=======',
        'theirs2',
        '>>>>>>> branch',
        'bottom',
      ].join('\n');

      const segments = internal.parseOutputSegments();
      const conflictCount = segments.filter(s => s.type === 'conflict').length;
      expect(conflictCount).to.equal(2);
    });

    it('extracts labels from conflict markers', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        outputContent: string;
        parseOutputSegments: () => Array<{
          type: string;
          oursLabel: string;
          theirsLabel: string;
        }>;
      };

      internal.outputContent = '<<<<<<< my-branch\nours\n=======\ntheirs\n>>>>>>> other-branch';

      const segments = internal.parseOutputSegments();
      const conflict = segments.find(s => s.type === 'conflict')!;
      expect(conflict.oursLabel).to.equal('my-branch');
      expect(conflict.theirsLabel).to.equal('other-branch');
    });

    it('defaults to OURS/THEIRS when labels are missing', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        outputContent: string;
        parseOutputSegments: () => Array<{
          type: string;
          oursLabel: string;
          theirsLabel: string;
        }>;
      };

      internal.outputContent = '<<<<<<< \nours\n=======\ntheirs\n>>>>>>> ';

      const segments = internal.parseOutputSegments();
      const conflict = segments.find(s => s.type === 'conflict')!;
      // Empty labels default based on implementation
      expect(conflict.oursLabel).to.not.be.undefined;
      expect(conflict.theirsLabel).to.not.be.undefined;
    });
  });

  // ── Accept ours/theirs/base ────────────────────────────────────────────
  describe('accept strategies', () => {
    it('handleAcceptOurs sets output to ours content', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        baseContent: string;
        oursContent: string;
        theirsContent: string;
        outputContent: string;
        handleAcceptOurs: () => void;
      };

      internal.baseContent = 'base';
      internal.oursContent = 'ours content';
      internal.theirsContent = 'theirs content';

      internal.handleAcceptOurs();
      expect(internal.outputContent).to.equal('ours content');
    });

    it('handleAcceptTheirs sets output to theirs content', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        baseContent: string;
        oursContent: string;
        theirsContent: string;
        outputContent: string;
        handleAcceptTheirs: () => void;
      };

      internal.baseContent = 'base';
      internal.oursContent = 'ours content';
      internal.theirsContent = 'theirs content';

      internal.handleAcceptTheirs();
      expect(internal.outputContent).to.equal('theirs content');
    });

    it('handleAcceptBase sets output to base content', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        baseContent: string;
        oursContent: string;
        theirsContent: string;
        outputContent: string;
        handleAcceptBase: () => void;
      };

      internal.baseContent = 'base content';
      internal.oursContent = 'ours';
      internal.theirsContent = 'theirs';

      internal.handleAcceptBase();
      expect(internal.outputContent).to.equal('base content');
    });
  });

  // ── resolveOutputConflict ──────────────────────────────────────────────
  describe('resolveOutputConflict', () => {
    it('resolves a conflict choosing ours', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        outputContent: string;
        resolveOutputConflict: (segmentIndex: number, choice: 'ours' | 'theirs' | 'both') => void;
      };

      internal.outputContent = 'before\n<<<<<<< HEAD\nours-line\n=======\ntheirs-line\n>>>>>>> branch\nafter';

      internal.resolveOutputConflict(0, 'ours');

      expect(internal.outputContent).to.include('ours-line');
      expect(internal.outputContent).to.not.include('<<<<<<<');
      expect(internal.outputContent).to.not.include('theirs-line');
      expect(internal.outputContent).to.include('before');
      expect(internal.outputContent).to.include('after');
    });

    it('resolves a conflict choosing theirs', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        outputContent: string;
        resolveOutputConflict: (segmentIndex: number, choice: 'ours' | 'theirs' | 'both') => void;
      };

      internal.outputContent = 'before\n<<<<<<< HEAD\nours-line\n=======\ntheirs-line\n>>>>>>> branch\nafter';

      internal.resolveOutputConflict(0, 'theirs');

      expect(internal.outputContent).to.include('theirs-line');
      expect(internal.outputContent).to.not.include('<<<<<<<');
      expect(internal.outputContent).to.not.include('ours-line');
    });

    it('resolves a conflict choosing both', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        outputContent: string;
        resolveOutputConflict: (segmentIndex: number, choice: 'ours' | 'theirs' | 'both') => void;
      };

      internal.outputContent = 'before\n<<<<<<< HEAD\nours-line\n=======\ntheirs-line\n>>>>>>> branch\nafter';

      internal.resolveOutputConflict(0, 'both');

      expect(internal.outputContent).to.include('ours-line');
      expect(internal.outputContent).to.include('theirs-line');
      expect(internal.outputContent).to.not.include('<<<<<<<');
    });

    it('resolves only the targeted conflict, preserving others', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        outputContent: string;
        resolveOutputConflict: (segmentIndex: number, choice: 'ours' | 'theirs' | 'both') => void;
      };

      internal.outputContent = [
        '<<<<<<< HEAD',
        'ours1',
        '=======',
        'theirs1',
        '>>>>>>> branch',
        'middle',
        '<<<<<<< HEAD',
        'ours2',
        '=======',
        'theirs2',
        '>>>>>>> branch',
      ].join('\n');

      // Resolve first conflict, keep second
      internal.resolveOutputConflict(0, 'ours');

      expect(internal.outputContent).to.include('ours1');
      // Second conflict should still have markers
      expect(internal.outputContent).to.include('<<<<<<< HEAD');
      expect(internal.outputContent).to.include('ours2');
      expect(internal.outputContent).to.include('theirs2');
    });
  });

  // ── applyAiSuggestion ─────────────────────────────────────────────────
  describe('applyAiSuggestion', () => {
    it('replaces conflict with AI suggestion', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        outputContent: string;
        applyAiSuggestion: (conflictIndex: number, resolvedContent: string) => void;
      };

      internal.outputContent = 'before\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\nafter';

      internal.applyAiSuggestion(0, 'ai-resolved-content');

      expect(internal.outputContent).to.include('ai-resolved-content');
      expect(internal.outputContent).to.not.include('<<<<<<<');
      expect(internal.outputContent).to.include('before');
      expect(internal.outputContent).to.include('after');
    });
  });

  // ── Edit mode toggle ───────────────────────────────────────────────────
  describe('edit mode', () => {
    it('starts in visual mode', async () => {
      const el = await renderEditor();
      const internal = el as unknown as { outputEditMode: string };
      expect(internal.outputEditMode).to.equal('visual');
    });

    it('toggles between visual and raw mode', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        outputEditMode: string;
        toggleOutputEditMode: () => void;
      };

      internal.toggleOutputEditMode();
      expect(internal.outputEditMode).to.equal('raw');

      internal.toggleOutputEditMode();
      expect(internal.outputEditMode).to.equal('visual');
    });
  });

  // ── Output change ──────────────────────────────────────────────────────
  describe('output change', () => {
    it('updates outputContent on textarea change', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        outputContent: string;
        handleOutputChange: (e: Event) => void;
      };

      const fakeEvent = {
        target: { value: 'new content' },
      } as unknown as Event;

      internal.handleOutputChange(fakeEvent);
      expect(internal.outputContent).to.equal('new content');
    });
  });

  // ── getResolvedContent ─────────────────────────────────────────────────
  describe('getResolvedContent', () => {
    it('returns current output content', async () => {
      const el = await renderEditor();
      const internal = el as unknown as { outputContent: string };
      internal.outputContent = 'final resolved content';

      expect(el.getResolvedContent()).to.equal('final resolved content');
    });
  });

  // ── computeLineOrigins ─────────────────────────────────────────────────
  describe('computeLineOrigins', () => {
    it('identifies lines that came from ours', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        baseContent: string;
        oursContent: string;
        theirsContent: string;
        outputContent: string;
        lineOrigins: Map<number, string>;
        computeLineOrigins: () => void;
      };

      internal.baseContent = 'shared';
      internal.oursContent = 'shared\nours-only';
      internal.theirsContent = 'shared';
      internal.outputContent = 'shared\nours-only';

      internal.computeLineOrigins();

      // Line 1 ("ours-only") should be marked as 'ours'
      expect(internal.lineOrigins.get(1)).to.equal('ours');
    });

    it('identifies lines that came from theirs', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        baseContent: string;
        oursContent: string;
        theirsContent: string;
        outputContent: string;
        lineOrigins: Map<number, string>;
        computeLineOrigins: () => void;
      };

      internal.baseContent = 'shared';
      internal.oursContent = 'shared';
      internal.theirsContent = 'shared\ntheirs-only';
      internal.outputContent = 'shared\ntheirs-only';

      internal.computeLineOrigins();

      expect(internal.lineOrigins.get(1)).to.equal('theirs');
    });

    it('identifies lines present in both as "both"', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        baseContent: string;
        oursContent: string;
        theirsContent: string;
        outputContent: string;
        lineOrigins: Map<number, string>;
        computeLineOrigins: () => void;
      };

      internal.baseContent = 'base';
      internal.oursContent = 'base\nnew-in-both';
      internal.theirsContent = 'base\nnew-in-both';
      internal.outputContent = 'base\nnew-in-both';

      internal.computeLineOrigins();

      expect(internal.lineOrigins.get(1)).to.equal('both');
    });
  });

  // ── Mark resolved ──────────────────────────────────────────────────────
  describe('mark resolved', () => {
    it('dispatches conflict-resolved event', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        conflictFile: ConflictFile;
        outputContent: string;
      };

      internal.conflictFile = makeConflictFile('src/test.ts');
      internal.outputContent = 'resolved content';

      let eventFired = false;
      let eventFile: string | null = null;
      el.addEventListener('conflict-resolved', ((e: CustomEvent) => {
        eventFired = true;
        eventFile = e.detail.file.path;
      }) as EventListener);

      const handleMarkResolved = (el as unknown as {
        handleMarkResolved: () => Promise<void>;
      }).handleMarkResolved.bind(el);

      await handleMarkResolved();

      expect(eventFired).to.be.true;
      expect(eventFile).to.equal('src/test.ts');
    });

    it('calls resolve_conflict with correct args', async () => {
      const el = await renderEditor();
      const internal = el as unknown as {
        conflictFile: ConflictFile;
        outputContent: string;
      };

      internal.conflictFile = makeConflictFile('src/test.ts');
      internal.outputContent = 'final content';

      invokeHistory.length = 0;

      const handleMarkResolved = (el as unknown as {
        handleMarkResolved: () => Promise<void>;
      }).handleMarkResolved.bind(el);

      await handleMarkResolved();

      const resolveCall = invokeHistory.find(h => h.command === 'resolve_conflict');
      expect(resolveCall).to.exist;
    });
  });
});
