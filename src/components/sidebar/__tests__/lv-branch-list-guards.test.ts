/**
 * Tests for operationInProgress guards in lv-branch-list.
 *
 * Verifies that async handlers (checkout, rename, delete, merge, rebase)
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
import type { LvBranchList } from '../lv-branch-list.ts';

// Import the actual component
import '../lv-branch-list.ts';

// ── Helpers ────────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

function makeBranch(overrides: Partial<{
  name: string;
  shorthand: string;
  isHead: boolean;
  isRemote: boolean;
  upstream: string | null;
  targetOid: string;
  isStale: boolean;
}> = {}) {
  return {
    name: overrides.name ?? 'feature/test',
    shorthand: overrides.shorthand ?? 'feature/test',
    isHead: overrides.isHead ?? false,
    isRemote: overrides.isRemote ?? false,
    upstream: overrides.upstream ?? null,
    targetOid: overrides.targetOid ?? 'abc123',
    isStale: overrides.isStale ?? false,
  };
}

/** Returns a promise that never resolves (blocks the handler). */
function neverResolve(): Promise<never> {
  return new Promise(() => {});
}

function defaultMockInvoke(command: string): Promise<unknown> {
  if (command === 'get_branches') {
    return Promise.resolve([]);
  }
  if (command === 'get_remotes') {
    return Promise.resolve([]);
  }
  if (command === 'get_hidden_branches') {
    return Promise.resolve([]);
  }
  if (command === 'get_branch_sort_mode') {
    return Promise.resolve('name');
  }
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

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-branch-list operationInProgress guards', () => {
  beforeEach(() => {
    invokeCalls.length = 0;
  });

  it('should have operationInProgress initially false', async () => {
    const el = await createComponent();
    // Access private via cast
    expect((el as unknown as { operationInProgress: boolean }).operationInProgress).to.equal(false);
  });

  it('handleCheckout should skip when operationInProgress is true', async () => {
    const el = await createComponent();

    // Set operationInProgress = true to simulate an in-flight operation
    (el as unknown as { operationInProgress: boolean }).operationInProgress = true;

    // Reset call tracking
    invokeCalls.length = 0;

    const branch = makeBranch({ name: 'feature/blocked', isHead: false });

    // Call handleCheckout — it should bail early
    await (el as unknown as { handleCheckout: (b: typeof branch) => Promise<void> }).handleCheckout(branch);

    // No checkout_with_autostash call should have been made
    const checkoutCalls = invokeCalls.filter(c => c.command === 'checkout_with_autostash');
    expect(checkoutCalls).to.have.length(0);
  });

  it('handleCheckout should set operationInProgress during the operation', async () => {
    const el = await createComponent();

    let resolveCheckout!: (v: unknown) => void;
    mockInvoke = (command: string) => {
      if (command === 'checkout_with_autostash') {
        return new Promise((resolve) => { resolveCheckout = resolve; });
      }
      return defaultMockInvoke(command);
    };

    const branch = makeBranch({ name: 'feature/progress', isHead: false });

    // Start checkout (won't resolve yet)
    const promise = (el as unknown as { handleCheckout: (b: typeof branch) => Promise<void> }).handleCheckout(branch);

    // Should be in progress now
    expect((el as unknown as { operationInProgress: boolean }).operationInProgress).to.equal(true);

    // Resolve the checkout
    resolveCheckout({ success: true, data: { success: true, message: 'ok', stashed: false, stashApplied: false, stashConflict: false } });
    await promise;

    // Should be cleared after completion
    expect((el as unknown as { operationInProgress: boolean }).operationInProgress).to.equal(false);
  });

  it('handleRenameBranch should skip when operationInProgress is true', async () => {
    const el = await createComponent();

    // Set context menu with a branch
    const branch = makeBranch({ name: 'feature/rename-me', isHead: false, isRemote: false });
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; branch: typeof branch | null } }).contextMenu = {
      visible: true, x: 0, y: 0, branch,
    };
    (el as unknown as { operationInProgress: boolean }).operationInProgress = true;

    invokeCalls.length = 0;

    await (el as unknown as { handleRenameBranch: () => Promise<void> }).handleRenameBranch();

    const renameCalls = invokeCalls.filter(c => c.command === 'rename_branch');
    expect(renameCalls).to.have.length(0);
  });

  it('handleDeleteBranch should skip when operationInProgress is true', async () => {
    const el = await createComponent();

    const branch = makeBranch({ name: 'feature/delete-me', isHead: false });
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; branch: typeof branch | null } }).contextMenu = {
      visible: true, x: 0, y: 0, branch,
    };
    (el as unknown as { operationInProgress: boolean }).operationInProgress = true;

    invokeCalls.length = 0;

    await (el as unknown as { handleDeleteBranch: () => Promise<void> }).handleDeleteBranch();

    const deleteCalls = invokeCalls.filter(c => c.command === 'delete_branch');
    expect(deleteCalls).to.have.length(0);
  });

  it('handleMergeBranch should skip when operationInProgress is true', async () => {
    const el = await createComponent();

    const branch = makeBranch({ name: 'feature/merge-me', isHead: false });
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; branch: typeof branch | null } }).contextMenu = {
      visible: true, x: 0, y: 0, branch,
    };
    (el as unknown as { operationInProgress: boolean }).operationInProgress = true;

    invokeCalls.length = 0;

    await (el as unknown as { handleMergeBranch: () => Promise<void> }).handleMergeBranch();

    const mergeCalls = invokeCalls.filter(c => c.command === 'merge');
    expect(mergeCalls).to.have.length(0);
  });

  it('handleRebaseBranch should skip when operationInProgress is true', async () => {
    const el = await createComponent();

    const branch = makeBranch({ name: 'feature/rebase-me', isHead: false });
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; branch: typeof branch | null } }).contextMenu = {
      visible: true, x: 0, y: 0, branch,
    };
    (el as unknown as { operationInProgress: boolean }).operationInProgress = true;

    invokeCalls.length = 0;

    await (el as unknown as { handleRebaseBranch: () => Promise<void> }).handleRebaseBranch();

    const rebaseCalls = invokeCalls.filter(c => c.command === 'rebase');
    expect(rebaseCalls).to.have.length(0);
  });

  it('handleCheckout should clear operationInProgress even on error', async () => {
    const el = await createComponent();

    mockInvoke = (command: string) => {
      if (command === 'checkout_with_autostash') {
        return Promise.reject(new Error('Network error'));
      }
      return defaultMockInvoke(command);
    };

    const branch = makeBranch({ name: 'feature/error', isHead: false });

    try {
      await (el as unknown as { handleCheckout: (b: typeof branch) => Promise<void> }).handleCheckout(branch);
    } catch {
      // expected
    }

    expect((el as unknown as { operationInProgress: boolean }).operationInProgress).to.equal(false);
  });
});
