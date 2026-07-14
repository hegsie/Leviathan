/**
 * Tests that lv-file-status never stages conflicted files raw.
 *
 * Staging a conflicted file would write git's conflict-marker text into the
 * index and clear the conflict entries — git would then treat the file as
 * "resolved" with markers in it, bypassing the merge editor entirely.
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
import '../lv-file-status.ts';
import type { LvFileStatus } from '../lv-file-status.ts';
import type { StatusEntry } from '../../../types/git.types.ts';

// ── Test data ──────────────────────────────────────────────────────────────
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

interface FileStatusInternal {
  stagedFiles: StatusEntry[];
  unstagedFiles: StatusEntry[];
  selectedFiles: Set<string>;
  handleStageFile: (file: StatusEntry, e: Event) => Promise<void>;
  handleStageAll: () => Promise<void>;
  handleStageSelected: () => Promise<void>;
}

function internalOf(el: LvFileStatus): FileStatusInternal {
  return el as unknown as FileStatusInternal;
}

function stageCalls(): Array<{ command: string; args?: unknown }> {
  return invokeHistory.filter((h) => h.command === 'stage_files');
}

async function renderFileStatus(entries: StatusEntry[]): Promise<LvFileStatus> {
  mockInvoke = async (command: string) => {
    switch (command) {
      case 'get_status':
        return entries;
      case 'stage_files':
      case 'unstage_files':
        return null;
      default:
        return null;
    }
  };

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
describe('lv-file-status conflicted staging guards', () => {
  beforeEach(() => {
    invokeHistory.length = 0;
  });

  it('staging a conflicted file opens the conflict flow instead of staging markers', async () => {
    const conflicted = makeEntry({ path: 'src/conflict.ts', status: 'conflicted', isConflicted: true });
    const el = await renderFileStatus([conflicted]);

    let dialogRequestedFor: string | null = null;
    el.addEventListener('open-conflict-dialog', ((e: CustomEvent) => {
      dialogRequestedFor = e.detail?.filePath ?? null;
    }) as EventListener);

    invokeHistory.length = 0;
    await internalOf(el).handleStageFile(conflicted, new Event('click'));

    expect(stageCalls().length, 'stage_files must not be called').to.equal(0);
    expect(dialogRequestedFor).to.equal('src/conflict.ts');
  });

  it('stage-all skips conflicted files and stages the rest', async () => {
    const clean = makeEntry({ path: 'src/ok.ts' });
    const conflicted = makeEntry({ path: 'src/conflict.ts', status: 'conflicted', isConflicted: true });
    const el = await renderFileStatus([clean, conflicted]);

    invokeHistory.length = 0;
    await internalOf(el).handleStageAll();

    const calls = stageCalls();
    expect(calls.length).to.equal(1);
    expect((calls[0].args as { paths: string[] }).paths).to.deep.equal(['src/ok.ts']);
  });

  it('stage-all with only conflicted files stages nothing', async () => {
    const conflicted = makeEntry({ path: 'src/conflict.ts', status: 'conflicted', isConflicted: true });
    const el = await renderFileStatus([conflicted]);

    invokeHistory.length = 0;
    await internalOf(el).handleStageAll();

    expect(stageCalls().length).to.equal(0);
  });

  it('stage-selected skips conflicted files', async () => {
    const clean = makeEntry({ path: 'src/ok.ts' });
    const conflicted = makeEntry({ path: 'src/conflict.ts', status: 'conflicted', isConflicted: true });
    const el = await renderFileStatus([clean, conflicted]);

    const internal = internalOf(el);
    internal.selectedFiles = new Set(['src/ok.ts', 'src/conflict.ts']);
    invokeHistory.length = 0;
    await internal.handleStageSelected();

    const calls = stageCalls();
    expect(calls.length).to.equal(1);
    expect((calls[0].args as { paths: string[] }).paths).to.deep.equal(['src/ok.ts']);
  });
});
