/**
 * Tests that a rebase which dropped commits says so.
 *
 * A commit whose patch is already on the target is skipped by the rebase, so
 * it disappears from the branch. `git rebase` prints "warning: skipped
 * previously applied commit <sha>" for each one; there is no stderr here, and
 * a bare green "Rebased onto <branch>" is the same message a clean rebase
 * gets. `pull --rebase` already reports its skips — the branch list's three
 * Rebase gestures must too.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
const invokeCalls: Array<{ command: string; args?: unknown }> = [];

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeCalls.push({ command, args });
    return mockInvoke(command, args);
  },
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import type { LvBranchList } from '../lv-branch-list.ts';
import '../lv-branch-list.ts';
import { uiStore } from '../../../stores/ui.store.ts';
import { resetRefOpLocks } from '../../../utils/ref-lock.ts';

// ── Helpers ────────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

function makeBranch(name: string, isHead = false) {
  return {
    name,
    shorthand: name,
    isHead,
    isRemote: false,
    upstream: null,
    targetOid: 'abc123',
    isStale: false,
  };
}

/** `rebase` resolves with the number of commits it skipped. */
let skipped: unknown = 0;

function defaultMockInvoke(command: string): Promise<unknown> {
  if (command === 'plugin:dialog|confirm' || command === 'plugin:dialog|message') {
    return Promise.resolve('Ok');
  }
  if (command === 'rebase') return Promise.resolve(skipped);
  if (command === 'get_branches') return Promise.resolve([]);
  if (command === 'get_remotes') return Promise.resolve([]);
  if (command === 'get_hidden_branches') return Promise.resolve([]);
  if (command === 'get_branch_sort_mode') return Promise.resolve('name');
  return Promise.resolve(null);
}

async function createComponent(): Promise<LvBranchList> {
  mockInvoke = defaultMockInvoke;
  const el = await fixture<LvBranchList>(
    html`<lv-branch-list .repositoryPath=${REPO_PATH}></lv-branch-list>`
  );
  await el.updateComplete;
  return el;
}

function successToast(): string | undefined {
  return uiStore.getState().toasts.find((t) => t.type === 'success')?.message;
}

/** Runs the context-menu Rebase against `branch`. */
async function rebaseFromContextMenu(el: LvBranchList, branch: ReturnType<typeof makeBranch>) {
  (
    el as unknown as {
      contextMenu: { visible: boolean; x: number; y: number; branch: typeof branch | null };
    }
  ).contextMenu = { visible: true, x: 0, y: 0, branch };
  await (el as unknown as { handleRebaseBranch: () => Promise<void> }).handleRebaseBranch();
}

// A minimal DragEvent stand-in. alt = rebase rather than merge.
function fakeDragEvent(altKey: boolean): DragEvent {
  return { preventDefault() {}, altKey } as unknown as DragEvent;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-branch-list rebase skip reporting', () => {
  beforeEach(() => {
    resetRefOpLocks();
    invokeCalls.length = 0;
    skipped = 0;
    const state = uiStore.getState();
    state.toasts.forEach((t) => state.removeToast(t.id));
  });

  it('names the dropped commits after a context-menu rebase', async () => {
    const el = await createComponent();
    skipped = 2;

    await rebaseFromContextMenu(el, makeBranch('main'));

    expect(invokeCalls.some((c) => c.command === 'rebase'), 'rebase ran').to.be.true;
    expect(successToast()).to.equal('Rebased onto main, skipped 2 already applied upstream');
  });

  it('keeps the plain success when nothing was skipped', async () => {
    const el = await createComponent();
    skipped = 0;

    await rebaseFromContextMenu(el, makeBranch('main'));

    expect(successToast()).to.equal('Rebased onto main');
  });

  // The backend reports every commit skipped when the whole branch was already
  // applied upstream — the branch ref still moves, so this is the case the
  // message exists for.
  it('reports a rebase that dropped every commit', async () => {
    const el = await createComponent();
    skipped = 3;

    await rebaseFromContextMenu(el, makeBranch('origin/main'));

    expect(successToast()).to.equal(
      'Rebased onto origin/main, skipped 3 already applied upstream'
    );
  });

  it('names the dropped commits after an alt-drag rebase onto HEAD', async () => {
    const el = await createComponent();
    skipped = 1;

    const source = makeBranch('feature/source');
    (el as unknown as { draggingBranch: unknown }).draggingBranch = source;

    await (
      el as unknown as { handleDrop: (e: DragEvent, b: unknown) => Promise<void> }
    ).handleDrop(fakeDragEvent(true), makeBranch('main', /* isHead */ true));

    expect(invokeCalls.some((c) => c.command === 'rebase'), 'rebase ran').to.be.true;
    expect(successToast()).to.equal(
      'Rebased onto feature/source, skipped 1 already applied upstream'
    );
  });
});
