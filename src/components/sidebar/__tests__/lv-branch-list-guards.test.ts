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
import { repositoryStore } from '../../../stores/index.ts';
import type { Repository } from '../../../types/git.types.ts';

// Import the actual component
import '../lv-branch-list.ts';

function mockRepo(path: string, name: string): Repository {
  return {
    path,
    name,
    isValid: true,
    isBare: false,
    headRef: 'main',
    state: 'clean',
    isShallow: false,
    isPartialClone: false,
    cloneFilter: null,
  };
}

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

  it('preserves the interactive-rebase dialog ELEMENT across a loading toggle', async () => {
    // A background refresh flips loading true→false. With a single stable
    // outer template the dialog element instance must survive the toggle —
    // recreating it (as three distinct top-level templates did) would reset
    // its state and silently discard an in-progress rebase plan.
    const el = await createComponent();
    const internal = el as unknown as { loading: boolean };
    const dialogBefore = el.shadowRoot!.querySelector('lv-interactive-rebase-dialog');
    expect(dialogBefore, 'dialog present when loaded').to.not.be.null;

    internal.loading = true;
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector('lv-interactive-rebase-dialog'),
      'same element instance while loading',
    ).to.equal(dialogBefore);

    internal.loading = false;
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector('lv-interactive-rebase-dialog'),
      'same element instance after loading clears',
    ).to.equal(dialogBefore);
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

  it('closes its embedded interactive-rebase dialog when the pinned repo tab is removed', async () => {
    // The dialog is kept alive across background refreshes by the single stable
    // template. If the user closes the repo tab the rebase was started on, the
    // dialog must self-close — otherwise Execute would rewrite a repo with no
    // tab observing it. The store subscription in connectedCallback owns this.
    repositoryStore.getState().reset();
    repositoryStore.getState().addRepository(mockRepo('/repo/a', 'a'));
    repositoryStore.getState().addRepository(mockRepo('/repo/b', 'b'));

    const el = await createComponent();
    // connectedCallback subscribes only AFTER an async loadBranches(); wait
    // until the store subscription is actually registered.
    for (let i = 0; i < 50; i++) {
      if ((el as unknown as { storeUnsubscribe?: () => void }).storeUnsubscribe) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    // Shadow the @query getter with a fake dialog pinned to repo A.
    let closed = false;
    Object.defineProperty(el, 'interactiveRebaseDialog', {
      configurable: true,
      value: {
        pinnedRepositoryPathIfOpen: '/repo/a',
        close: () => {
          closed = true;
        },
      },
    });

    // Closing A's tab must trigger the subscription to close the dialog.
    repositoryStore.getState().removeRepository('/repo/a');
    await el.updateComplete;

    expect(closed, 'dialog closed when its pinned repo tab was removed').to.be.true;

    repositoryStore.getState().reset();
  });

  it('leaves the dialog open when a DIFFERENT repo tab is removed', async () => {
    // Only the pinned repo's removal cancels the rebase; unrelated tab churn
    // must not disrupt an in-progress plan.
    repositoryStore.getState().reset();
    repositoryStore.getState().addRepository(mockRepo('/repo/a', 'a'));
    repositoryStore.getState().addRepository(mockRepo('/repo/b', 'b'));

    const el = await createComponent();

    let closed = false;
    Object.defineProperty(el, 'interactiveRebaseDialog', {
      configurable: true,
      value: {
        pinnedRepositoryPathIfOpen: '/repo/a',
        close: () => {
          closed = true;
        },
      },
    });

    repositoryStore.getState().removeRepository('/repo/b');
    await el.updateComplete;

    expect(closed, 'dialog stays open when an unrelated tab is removed').to.be.false;

    repositoryStore.getState().reset();
  });

  it('branches-changed carries the originating repositoryPath so refreshes pin correctly', async () => {
    // The host pins its refresh to detail.repositoryPath (the repo the mutation
    // ran on), not the active tab. A branches-changed with no repositoryPath
    // would refresh whichever tab happens to be active after a mid-op switch.
    const el = await createComponent();

    let detail: { repositoryPath?: string } | null = null;
    el.addEventListener('branches-changed', (e) => {
      detail = (e as CustomEvent<{ repositoryPath?: string }>).detail;
    });

    (el as unknown as { dispatchBranchesChanged: (p: string) => void }).dispatchBranchesChanged(
      '/repo/origin'
    );

    expect(detail, 'branches-changed dispatched').to.not.be.null;
    expect(detail!.repositoryPath).to.equal('/repo/origin');
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
