/**
 * Tests for operationInProgress guards in lv-stash-list.
 *
 * Verifies that async handlers (createStash, applyStash, popStash, dropStash)
 * are protected against double-click / re-entry while an operation is
 * already in progress.
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
import type { LvStashList } from '../lv-stash-list.ts';

// Import the actual component
import '../lv-stash-list.ts';
import { tryAcquireRefOp, resetRefOpLocks } from '../../../utils/ref-lock.ts';

// ── Helpers ────────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

function makeStash(overrides: Partial<{
  index: number;
  message: string;
  oid: string;
}> = {}) {
  return {
    index: overrides.index ?? 0,
    message: overrides.message ?? 'WIP on main',
    oid: overrides.oid ?? 'abc123',
  };
}

/**
 * Stash list returned by `get_stashes`. The handlers re-resolve the
 * right-clicked stash by oid against this list before acting, so a test that
 * expects an operation to RUN must seed it with that stash.
 */
let mockStashes: unknown[] = [];

function defaultMockInvoke(command: string): Promise<unknown> {
  if (command === 'get_stashes') {
    return Promise.resolve(mockStashes);
  }
  return Promise.resolve(null);
}

async function createComponent(): Promise<LvStashList> {
  mockStashes = [];
  mockInvoke = defaultMockInvoke;
  const el = await fixture<LvStashList>(
    html`<lv-stash-list .repositoryPath=${REPO_PATH}></lv-stash-list>`
  );
  await el.updateComplete;
  return el;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-stash-list operationInProgress guards', () => {
  beforeEach(() => {
    resetRefOpLocks();
    invokeCalls.length = 0;
  });

  it('should have operationInProgress initially false', async () => {
    const el = await createComponent();
    expect((el as unknown as { operationInProgress: boolean }).operationInProgress).to.equal(false);
  });

  it('handleApplyStash should skip when operationInProgress is true', async () => {
    const el = await createComponent();

    const stash = makeStash({ index: 0 });
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; stash: typeof stash | null } }).contextMenu = {
      visible: true, x: 0, y: 0, stash,
    };
    tryAcquireRefOp(REPO_PATH);

    invokeCalls.length = 0;

    await (el as unknown as { handleApplyStash: () => Promise<void> }).handleApplyStash();

    const applyCalls = invokeCalls.filter(c => c.command === 'apply_stash');
    expect(applyCalls).to.have.length(0);
  });

  it('handlePopStash should skip when operationInProgress is true', async () => {
    const el = await createComponent();

    const stash = makeStash({ index: 1 });
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; stash: typeof stash | null } }).contextMenu = {
      visible: true, x: 0, y: 0, stash,
    };
    tryAcquireRefOp(REPO_PATH);

    invokeCalls.length = 0;

    await (el as unknown as { handlePopStash: () => Promise<void> }).handlePopStash();

    const popCalls = invokeCalls.filter(c => c.command === 'pop_stash');
    expect(popCalls).to.have.length(0);
  });

  it('handleDropStash should skip when operationInProgress is true', async () => {
    const el = await createComponent();

    const stash = makeStash({ index: 2 });
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; stash: typeof stash | null } }).contextMenu = {
      visible: true, x: 0, y: 0, stash,
    };
    tryAcquireRefOp(REPO_PATH);

    invokeCalls.length = 0;

    await (el as unknown as { handleDropStash: () => Promise<void> }).handleDropStash();

    const dropCalls = invokeCalls.filter(c => c.command === 'drop_stash');
    expect(dropCalls).to.have.length(0);
  });

  it('handleApplyStash should set and clear operationInProgress', async () => {
    const el = await createComponent();

    let resolveApply!: (v: unknown) => void;
    mockInvoke = (command: string) => {
      if (command === 'apply_stash') {
        return new Promise((resolve) => { resolveApply = resolve; });
      }
      return defaultMockInvoke(command);
    };

    const stash = makeStash({ index: 0 });
    mockStashes = [stash];
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; stash: typeof stash | null } }).contextMenu = {
      visible: true, x: 0, y: 0, stash,
    };

    // Start apply (won't resolve yet)
    const promise = (el as unknown as { handleApplyStash: () => Promise<void> }).handleApplyStash();

    // Should be in progress now
    expect((el as unknown as { operationInProgress: boolean }).operationInProgress).to.equal(true);

    // The handler re-resolves the stash by oid (an extra awaited round trip)
    // before calling apply_stash, so let that settle before resolving it.
    await new Promise((r) => setTimeout(r, 0));

    // Resolve
    resolveApply({ success: true });
    await promise;

    // Should be cleared
    expect((el as unknown as { operationInProgress: boolean }).operationInProgress).to.equal(false);
  });

  it('handleApplyStash should clear operationInProgress even on error', async () => {
    const el = await createComponent();

    mockInvoke = (command: string) => {
      if (command === 'apply_stash') {
        return Promise.reject(new Error('apply failed'));
      }
      return defaultMockInvoke(command);
    };

    const stash = makeStash({ index: 0 });
    mockStashes = [stash];
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; stash: typeof stash | null } }).contextMenu = {
      visible: true, x: 0, y: 0, stash,
    };

    try {
      await (el as unknown as { handleApplyStash: () => Promise<void> }).handleApplyStash();
    } catch {
      // expected
    }

    expect((el as unknown as { operationInProgress: boolean }).operationInProgress).to.equal(false);
  });

  it('stash-applied carries the repo the apply ran on, even after a mid-op tab switch', async () => {
    // repoPath is captured BEFORE the await. If the active tab (and thus
    // .repositoryPath) rebinds while apply_stash is in flight, the event must
    // still name the origin repo so the host pins its refresh correctly.
    const el = await createComponent();

    let resolveApply!: (v: unknown) => void;
    mockInvoke = (command: string) => {
      if (command === 'apply_stash') {
        return new Promise((resolve) => {
          resolveApply = resolve;
        });
      }
      return defaultMockInvoke(command);
    };

    let detail: { repositoryPath?: string } | null = null;
    el.addEventListener('stash-applied', (e) => {
      detail = (e as CustomEvent<{ repositoryPath?: string }>).detail;
    });

    const stash = makeStash({ index: 0 });
    mockStashes = [stash];
    (
      el as unknown as {
        contextMenu: { visible: boolean; x: number; y: number; stash: typeof stash | null };
      }
    ).contextMenu = { visible: true, x: 0, y: 0, stash };

    const promise = (
      el as unknown as { handleApplyStash: () => Promise<void> }
    ).handleApplyStash();

    // Let the oid re-resolution settle so apply_stash is actually in flight.
    await new Promise((r) => setTimeout(r, 0));

    // User switches tabs mid-apply: the prop rebinds to another repo.
    (el as unknown as { repositoryPath: string }).repositoryPath = '/other/repo';

    resolveApply({ success: true });
    await promise;
    await el.updateComplete;

    expect(detail, 'stash-applied dispatched').to.not.be.null;
    expect(detail!.repositoryPath).to.equal(REPO_PATH);
  });

  it('handleDropStash drops from the origin repo, not the tab switched to during the confirm', async () => {
    // Dropping is irreversible and stash.index is from THIS repo's list.
    // showConfirm's await yields; a tab switch during it rebinds
    // this.repositoryPath. The drop must target the repo it was invoked on.
    const el = await createComponent();

    let resolveConfirm!: (v: unknown) => void;
    mockInvoke = (command: string) => {
      if (command === 'plugin:dialog|message') {
        return new Promise((resolve) => {
          resolveConfirm = resolve;
        });
      }
      if (command === 'drop_stash') return Promise.resolve(null);
      return defaultMockInvoke(command);
    };

    const stash = makeStash({ index: 0 });
    mockStashes = [stash];
    (
      el as unknown as {
        contextMenu: { visible: boolean; x: number; y: number; stash: typeof stash | null };
      }
    ).contextMenu = { visible: true, x: 0, y: 0, stash };

    invokeCalls.length = 0;
    const promise = (el as unknown as { handleDropStash: () => Promise<void> }).handleDropStash();

    await new Promise((r) => setTimeout(r, 10));
    (el as unknown as { repositoryPath: string }).repositoryPath = '/other/repo';

    resolveConfirm('Ok');
    await promise;

    const dropCall = invokeCalls.find((c) => c.command === 'drop_stash');
    expect(dropCall, 'drop_stash called').to.not.be.undefined;
    expect((dropCall!.args as { path: string }).path).to.equal(REPO_PATH);
  });

  it('handleDropStash drops the stash the user right-clicked after the list shifts', async () => {
    // Stash.index is a POSITION. Creating a stash while the context menu is
    // open (Ctrl+Shift+S does not close it) pushes every entry down one, so the
    // cached index names a different stash by the time Drop is clicked.
    const el = await createComponent();

    const target = makeStash({ index: 1, message: 'refactor WIP', oid: 'target-oid' });
    (
      el as unknown as {
        contextMenu: { visible: boolean; x: number; y: number; stash: typeof target | null };
      }
    ).contextMenu = { visible: true, x: 0, y: 0, stash: target };

    // A new stash landed at 0, so the target now sits at index 2.
    mockStashes = [
      makeStash({ index: 0, message: 'brand new', oid: 'new-oid' }),
      makeStash({ index: 1, message: 'other', oid: 'other-oid' }),
      target,
    ];

    // Confirm the drop: plugin-dialog's confirm() resolves via
    // `plugin:dialog|message`, where the OK button label means confirmed.
    mockInvoke = (command: string) =>
      command === 'plugin:dialog|message'
        ? Promise.resolve('Ok')
        : defaultMockInvoke(command);

    invokeCalls.length = 0;
    await (el as unknown as { handleDropStash: () => Promise<void> }).handleDropStash();

    const dropCall = invokeCalls.find((c) => c.command === 'drop_stash');
    expect(dropCall, 'drop_stash called').to.not.be.undefined;
    expect(
      (dropCall!.args as { index: number }).index,
      'must drop the right-clicked stash at its CURRENT position, not the stale one'
    ).to.equal(2);
  });

  it('handleDropStash aborts when the right-clicked stash is gone', async () => {
    const el = await createComponent();

    const target = makeStash({ index: 0, message: 'gone', oid: 'gone-oid' });
    (
      el as unknown as {
        contextMenu: { visible: boolean; x: number; y: number; stash: typeof target | null };
      }
    ).contextMenu = { visible: true, x: 0, y: 0, stash: target };

    // Someone dropped it from a terminal — it is no longer in the list.
    mockStashes = [makeStash({ index: 0, message: 'unrelated', oid: 'other-oid' })];

    // Confirm the drop: plugin-dialog's confirm() resolves via
    // `plugin:dialog|message`, where the OK button label means confirmed.
    mockInvoke = (command: string) =>
      command === 'plugin:dialog|message'
        ? Promise.resolve('Ok')
        : defaultMockInvoke(command);

    invokeCalls.length = 0;
    await (el as unknown as { handleDropStash: () => Promise<void> }).handleDropStash();

    expect(
      invokeCalls.filter((c) => c.command === 'drop_stash'),
      'must not drop a substitute stash'
    ).to.have.length(0);
  });

  it('isStashing guard prevents double createStash', async () => {
    const el = await createComponent();

    // Set isStashing to true to simulate in-flight stash creation
    (el as unknown as { isStashing: boolean }).isStashing = true;

    invokeCalls.length = 0;

    await (el as unknown as { handleCreateStash: () => Promise<void> }).handleCreateStash();

    const createCalls = invokeCalls.filter(c => c.command === 'create_stash');
    expect(createCalls).to.have.length(0);
  });
});
