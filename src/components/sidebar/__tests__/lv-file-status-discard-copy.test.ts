/**
 * Tests that lv-file-status tells the truth about what a discard destroys.
 *
 * Discarding an UNTRACKED file deletes it from disk — staging.rs classifies
 * anything absent from both the index and HEAD as untracked and removes it.
 * There is no git object and no trash, so the file is unrecoverable. A confirm
 * that says "discard changes to X" reads as "restore X", which materially
 * understates that, and in bulk can mean N permanent deletions.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
const invokeHistory: Array<{ command: string; args?: unknown }> = [];
/** Args of the last showConfirm(): plugin-dialog routes confirm() through it. */
let lastConfirm: { title?: string; message?: string } | null = null;

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeHistory.push({ command, args });
    if (command === 'plugin:dialog|message') {
      const a = args as { title?: string; message?: string };
      lastConfirm = { title: a?.title, message: a?.message };
      return Promise.resolve('Ok');
    }
    return mockInvoke(command, args);
  },
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import '../lv-file-status.ts';
import type { LvFileStatus } from '../lv-file-status.ts';
import type { StatusEntry } from '../../../types/git.types.ts';

const REPO_PATH = '/test/repo';

function makeEntry(overrides: Partial<StatusEntry> = {}): StatusEntry {
  return {
    path: 'src/main.ts',
    status: 'modified',
    isStaged: false,
    isConflicted: false,
    ...overrides,
  };
}

interface Internal {
  unstagedFiles: StatusEntry[];
  stagedFiles: StatusEntry[];
  selectedFiles: Set<string>;
  handleDiscardFile: (file: StatusEntry, e: Event) => Promise<void>;
  handleDiscardSelected: () => Promise<void>;
}

function internalOf(el: LvFileStatus): Internal {
  return el as unknown as Internal;
}

async function render(entries: StatusEntry[]): Promise<LvFileStatus> {
  mockInvoke = async (command: string) => (command === 'get_status' ? entries : null);

  const el = await fixture<LvFileStatus>(html`
    <lv-file-status .repositoryPath=${REPO_PATH}></lv-file-status>
  `);
  await new Promise((r) => setTimeout(r, 50));
  await el.updateComplete;
  const internal = internalOf(el);
  internal.unstagedFiles = entries.filter((f) => !f.isStaged);
  internal.stagedFiles = entries.filter((f) => f.isStaged);
  await el.updateComplete;
  return el;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-file-status discard confirm copy', () => {
  beforeEach(() => {
    invokeHistory.length = 0;
    lastConfirm = null;
  });

  it('says "permanently delete" for a single untracked file', async () => {
    const untracked = makeEntry({ path: 'notes.md', status: 'untracked' });
    const el = await render([untracked]);

    await internalOf(el).handleDiscardFile(untracked, new Event('click'));

    expect(lastConfirm, 'confirm shown').to.not.be.null;
    expect(lastConfirm!.message!.toLowerCase()).to.include('permanently delete');
    expect(lastConfirm!.message).to.include('notes.md');
    expect(lastConfirm!.message!.toLowerCase()).to.include('cannot be recovered');
  });

  it('keeps "discard changes" wording for a tracked file', async () => {
    const tracked = makeEntry({ path: 'src/main.ts', status: 'modified' });
    const el = await render([tracked]);

    await internalOf(el).handleDiscardFile(tracked, new Event('click'));

    expect(lastConfirm, 'confirm shown').to.not.be.null;
    expect(lastConfirm!.message!.toLowerCase()).to.include('discard changes');
    expect(lastConfirm!.message!.toLowerCase()).to.not.include('permanently delete');
  });

  it('names both counts when a bulk discard mixes tracked and untracked', async () => {
    const tracked = makeEntry({ path: 'a.ts', status: 'modified' });
    const untrackedA = makeEntry({ path: 'b.txt', status: 'untracked' });
    const untrackedB = makeEntry({ path: 'c.txt', status: 'untracked' });
    const el = await render([tracked, untrackedA, untrackedB]);

    const internal = internalOf(el);
    internal.selectedFiles = new Set(['a.ts', 'b.txt', 'c.txt']);
    await el.updateComplete;

    await internal.handleDiscardSelected();

    expect(lastConfirm, 'confirm shown').to.not.be.null;
    expect(lastConfirm!.message).to.include('1 file');
    expect(lastConfirm!.message).to.include('2 untracked file');
    expect(lastConfirm!.message!.toLowerCase()).to.include('permanently delete');
  });

  it('says delete-only when every selected file is untracked', async () => {
    const a = makeEntry({ path: 'a.txt', status: 'untracked' });
    const b = makeEntry({ path: 'b.txt', status: 'untracked' });
    const el = await render([a, b]);

    const internal = internalOf(el);
    internal.selectedFiles = new Set(['a.txt', 'b.txt']);
    await el.updateComplete;

    await internal.handleDiscardSelected();

    expect(lastConfirm, 'confirm shown').to.not.be.null;
    expect(lastConfirm!.message!.toLowerCase()).to.include('permanently delete 2 untracked file');
    expect(lastConfirm!.message!.toLowerCase()).to.not.include('discard changes');
  });
});
