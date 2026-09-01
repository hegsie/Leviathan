/**
 * Integration tests for app-shell ref context menu handlers.
 *
 * These create a REAL AppShell instance, set its internal state, call its
 * REAL handler methods, and verify the actual Tauri commands are invoked
 * in the correct order. This would have caught the bug where handlers
 * called graphCanvas.refresh() instead of handleRefresh().
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
import { expect } from '@open-wc/testing';
import type { AppShell } from '../app-shell.ts';
import type { OpenRepository } from '../stores/index.ts';
import type { Repository } from '../types/git.types.ts';
import { uiStore } from '../stores/ui.store.ts';
import { repositoryStore } from '../stores/repository.store.ts';

// Import the real component
import '../app-shell.ts';

// ── Test data ──────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

const mockRepository: Repository = {
  path: REPO_PATH,
  name: 'test-repo',
  isValid: true,
  isBare: false,
  headRef: 'refs/heads/main',
  detachedHeadOid: null,
  state: 'clean',
  isShallow: false,
  isPartialClone: false,
  cloneFilter: null,
};

const mockOpenRepository: OpenRepository = {
  repository: mockRepository,
  branches: [],
  currentBranch: null,
  remotes: [],
  tags: [],
  stashes: [],
  status: [],
  stagedFiles: [],
  unstagedFiles: [],
};

// ── Helpers ────────────────────────────────────────────────────────────────
function clearHistory(): void {
  invokeHistory.length = 0;
}

function findCommands(name: string): Array<{ command: string; args?: unknown }> {
  return invokeHistory.filter((h) => h.command === name);
}

function commandIndex(name: string): number {
  return invokeHistory.findIndex((h) => h.command === name);
}

/** Make every showConfirm() in the run resolve to "declined". */
function declineConfirms(): void {
  const previous = mockInvoke;
  mockInvoke = (command: string, args?: unknown) =>
    command === 'plugin:dialog|message'
      ? Promise.resolve('Cancel')
      : previous(command, args);
}

function setupDefaultMocks(): void {
  mockInvoke = async (command: string) => {
    switch (command) {
      // Tauri confirm() resolves via plugin:dialog|message; truthy = confirmed.
      // The destructive ref handlers (delete branch/tag) gate on this, matching
      // their sidebar counterparts.
      case 'plugin:dialog|message':
        return 'Ok';
      case 'checkout_with_autostash':
        return { success: true, stashed: false, stashApplied: false, stashConflict: false, message: 'ok' };
      case 'open_repository':
        return mockOpenRepository;
      case 'merge':
        return null;
      case 'rebase':
        return null;
      case 'delete_branch':
        return null;
      case 'delete_tag':
        return null;
      case 'push_tag':
        return null;
      case 'get_branches':
        return [];
      case 'get_remotes':
        return [];
      default:
        return null;
    }
  };
}

/**
 * Create a real AppShell instance with the required internal state.
 * We don't render it to the DOM (to avoid side effects from connectedCallback),
 * but the instance is real and its methods call real services.
 */
function createAppShell(): AppShell {
  const el = document.createElement('lv-app-shell') as AppShell;
  // Set internal state that handlers depend on
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shell = el as any;
  shell.activeRepository = mockOpenRepository;
  return el;
}

function setRefContextMenu(el: AppShell, refName: string, refType: 'localBranch' | 'remoteBranch' | 'tag' = 'localBranch'): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any).refContextMenu = {
    visible: true,
    x: 100,
    y: 100,
    refName,
    fullName: refName,
    refType,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('app-shell ref context menu handlers (integration)', () => {
  beforeEach(() => {
    clearHistory();
    setupDefaultMocks();
    uiStore.setState({ toasts: [] });
  });

  describe('handleRefCheckout', () => {
    it('calls checkout_with_autostash with the correct ref name', async () => {
      const el = createAppShell();
      setRefContextMenu(el, 'feature-branch');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefCheckout();

      const calls = findCommands('checkout_with_autostash');
      expect(calls.length).to.equal(1);
      expect(calls[0].args).to.deep.include({
        path: REPO_PATH,
        refName: 'feature-branch',
      });
    });

    it('calls open_repository after successful checkout (the bug fix)', async () => {
      const el = createAppShell();
      setRefContextMenu(el, 'feature-branch');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefCheckout();

      // This is the critical assertion — before the fix, open_repository was
      // never called because the handler used graphCanvas.refresh() instead
      // of handleRefresh()
      const openRepoCalls = findCommands('open_repository');
      expect(openRepoCalls.length).to.be.greaterThan(0);
    });

    it('calls open_repository AFTER checkout_with_autostash', async () => {
      const el = createAppShell();
      setRefContextMenu(el, 'feature-branch');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefCheckout();

      const checkoutIdx = commandIndex('checkout_with_autostash');
      const openRepoIdx = commandIndex('open_repository');
      expect(checkoutIdx).to.be.greaterThanOrEqual(0);
      expect(openRepoIdx).to.be.greaterThan(checkoutIdx);
    });

    it('does NOT call open_repository on failed checkout', async () => {
      mockInvoke = async (command: string) => {
        if (command === 'checkout_with_autostash') {
          return { success: false, stashed: false, stashApplied: false, stashConflict: false, message: 'error' };
        }
        return null;
      };

      const el = createAppShell();
      setRefContextMenu(el, 'feature-branch');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefCheckout();

      expect(findCommands('open_repository').length).to.equal(0);
    });

    it('does nothing when activeRepository is null', async () => {
      const el = createAppShell();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).activeRepository = null;
      setRefContextMenu(el, 'feature-branch');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefCheckout();

      expect(findCommands('checkout_with_autostash').length).to.equal(0);
    });

    it('closes the ref context menu', async () => {
      const el = createAppShell();
      setRefContextMenu(el, 'feature-branch');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefCheckout();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).refContextMenu.visible).to.be.false;
    });
  });

  describe('handleRefMerge', () => {
    it('calls merge with the correct source ref', async () => {
      const el = createAppShell();
      setRefContextMenu(el, 'feature-branch');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefMerge();

      const calls = findCommands('merge');
      expect(calls.length).to.equal(1);
      expect(calls[0].args).to.deep.include({
        path: REPO_PATH,
        sourceRef: 'feature-branch',
      });
    });

    it('calls open_repository after successful merge', async () => {
      const el = createAppShell();
      setRefContextMenu(el, 'feature-branch');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefMerge();

      expect(findCommands('open_repository').length).to.be.greaterThan(0);
    });

    it('opens conflict dialog on MERGE_CONFLICT', async () => {
      mockInvoke = async (command: string) => {
        // These handlers now confirm first, like their sidebar counterparts.
        if (command === 'plugin:dialog|message') return 'Ok';
        if (command === 'merge') {
          throw { code: 'MERGE_CONFLICT', message: 'Merge conflict' };
        }
        return null;
      };

      const el = createAppShell();
      setRefContextMenu(el, 'feature-branch');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefMerge();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).showConflictDialog).to.be.true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).conflictOperationType).to.equal('merge');
    });
  });

  describe('handleRefMerge confirmation', () => {
    it('declining blocks the merge', async () => {
      setupDefaultMocks();
      declineConfirms();
      const el = createAppShell();
      setRefContextMenu(el, 'feature-branch');
      invokeHistory.length = 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefMerge();

      expect(invokeHistory.some((c) => c.command === 'merge')).to.be.false;
    });
  });

  describe('handleRefRebase', () => {
    it('calls rebase with the correct onto ref', async () => {
      const el = createAppShell();
      setRefContextMenu(el, 'main');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefRebase();

      const calls = findCommands('rebase');
      expect(calls.length).to.equal(1);
      expect(calls[0].args).to.deep.include({
        path: REPO_PATH,
        onto: 'main',
      });
    });

    it('calls open_repository after successful rebase', async () => {
      const el = createAppShell();
      setRefContextMenu(el, 'main');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefRebase();

      expect(findCommands('open_repository').length).to.be.greaterThan(0);
    });

    // A commit whose patch is already on `onto` is dropped by the rebase and
    // disappears from the branch. `git rebase` warns on stderr; the toast is
    // the only place this GUI can say it.
    it('names the skipped commits in the success toast', async () => {
      mockInvoke = async (command: string) => {
        if (command === 'plugin:dialog|message') return 'Ok';
        if (command === 'rebase') return 2;
        return null;
      };

      const el = createAppShell();
      setRefContextMenu(el, 'main');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefRebase();

      const toast = uiStore.getState().toasts.find((t) => t.type === 'success');
      expect(toast?.message).to.equal(
        'Rebased onto main, skipped 2 already applied upstream'
      );
    });

    it('keeps the plain success toast when nothing was skipped', async () => {
      const el = createAppShell();
      setRefContextMenu(el, 'main');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefRebase();

      const toast = uiStore.getState().toasts.find((t) => t.type === 'success');
      expect(toast?.message).to.equal('Rebased onto main');
    });

    it('opens conflict dialog on REBASE_CONFLICT', async () => {
      mockInvoke = async (command: string) => {
        // These handlers now confirm first, like their sidebar counterparts.
        if (command === 'plugin:dialog|message') return 'Ok';
        if (command === 'rebase') {
          throw { code: 'REBASE_CONFLICT', message: 'Rebase conflict' };
        }
        return null;
      };

      const el = createAppShell();
      setRefContextMenu(el, 'main');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefRebase();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).showConflictDialog).to.be.true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).conflictOperationType).to.equal('rebase');
    });
  });

  describe('handleRefRebase confirmation', () => {
    it('declining blocks the rebase', async () => {
      setupDefaultMocks();
      declineConfirms();
      const el = createAppShell();
      setRefContextMenu(el, 'feature-branch');
      invokeHistory.length = 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefRebase();

      expect(invokeHistory.some((c) => c.command === 'rebase')).to.be.false;
    });
  });

  describe('handleRefDeleteBranch', () => {
    it('calls delete_branch with the correct args', async () => {
      const el = createAppShell();
      setRefContextMenu(el, 'old-feature');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefDeleteBranch();

      const calls = findCommands('delete_branch');
      expect(calls.length).to.equal(1);
      expect(calls[0].args).to.deep.include({
        path: REPO_PATH,
        name: 'old-feature',
        force: false,
      });
    });

    it('calls open_repository after successful delete', async () => {
      const el = createAppShell();
      setRefContextMenu(el, 'old-feature');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefDeleteBranch();

      expect(findCommands('open_repository').length).to.be.greaterThan(0);
    });

    it('does not delete when the confirm is declined', async () => {
      // The graph ref menu deletes the same branch as the sidebar, which always
      // confirms — this path must not be the unguarded shortcut.
      declineConfirms();
      const el = createAppShell();
      setRefContextMenu(el, 'old-feature');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefDeleteBranch();

      expect(findCommands('delete_branch')).to.have.length(0);
    });
  });

  describe('maintenance commands', () => {
    it('does not run gc or prune when the confirm is declined', async () => {
      declineConfirms();
      const el = createAppShell();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRunGc(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRunPrune();

      expect(findCommands('run_gc')).to.have.length(0);
      expect(findCommands('run_prune')).to.have.length(0);
    });

    it('reports the outcome of gc, prune and fsck', async () => {
      // Each of these previously discarded its result, so the palette entry
      // produced no observable effect on success OR failure.
      const el = createAppShell();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRunGc(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRunPrune();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRunFsck();

      const toasts = uiStore.getState().toasts;
      expect(toasts.length, 'each maintenance command reports an outcome').to.be.greaterThan(2);
    });
  });

  describe('force delete from the error-suggestion toast', () => {
    // forceDeleteBranch now takes the originating repo explicitly: the toast
    // outlives a repository switch, so the repo cannot be resolved at click time.
    beforeEach(() => {
      repositoryStore.setState({ openRepositories: [mockOpenRepository], activeIndex: 0 });
    });

    afterEach(() => {
      repositoryStore.setState({ openRepositories: [], activeIndex: -1 });
    });

    it('does not force delete when the confirm is declined', async () => {
      // One click on a toast button must not discard unmerged commits.
      declineConfirms();
      const el = createAppShell();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).forceDeleteBranch('unmerged-feature', REPO_PATH);

      expect(findCommands('delete_branch')).to.have.length(0);
    });

    it('force deletes once confirmed', async () => {
      const el = createAppShell();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).forceDeleteBranch('unmerged-feature', REPO_PATH);

      const calls = findCommands('delete_branch');
      expect(calls).to.have.length(1);
      expect(calls[0].args).to.deep.include({
        path: REPO_PATH,
        name: 'unmerged-feature',
        force: true,
      });
    });
  });

  describe('handleRefDeleteTag', () => {
    it('does not delete when the confirm is declined', async () => {
      declineConfirms();
      const el = createAppShell();
      setRefContextMenu(el, 'v1.0.0', 'tag');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefDeleteTag();

      expect(findCommands('delete_tag')).to.have.length(0);
    });

    it('calls delete_tag with the correct args', async () => {
      const el = createAppShell();
      setRefContextMenu(el, 'v1.0.0', 'tag');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefDeleteTag();

      const calls = findCommands('delete_tag');
      expect(calls.length).to.equal(1);
      expect(calls[0].args).to.deep.include({
        path: REPO_PATH,
        name: 'v1.0.0',
      });
    });

    it('calls open_repository after successful delete', async () => {
      const el = createAppShell();
      setRefContextMenu(el, 'v1.0.0', 'tag');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefDeleteTag();

      expect(findCommands('open_repository').length).to.be.greaterThan(0);
    });

    it('offers the same remote delete the sidebar does', async () => {
      // delete_tag removes the local ref only; the tag fetch refspec copies a
      // pushed tag back. The sidebar asks about the remote copy, and this
      // surface deletes the same tag — it must not be the one that does not.
      const previous = mockInvoke;
      mockInvoke = (command: string, args?: unknown) => {
        if (command === 'get_remotes') {
          return Promise.resolve([
            { name: 'origin', url: 'https://example.test/r.git', pushUrl: null },
          ]);
        }
        if (command === 'delete_remote_tag') return Promise.resolve(null);
        return previous(command, args);
      };

      const el = createAppShell();
      setRefContextMenu(el, 'v1.0.0', 'tag');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefDeleteTag();

      const calls = findCommands('delete_remote_tag');
      expect(calls.length, 'the graph ref menu offers the remote delete too').to.equal(1);
      expect(calls[0].args).to.deep.include({
        path: REPO_PATH,
        name: 'v1.0.0',
        remote: 'origin',
      });
    });
  });

  describe('handleRefPushTag', () => {
    it('calls push_tag with the correct args', async () => {
      const el = createAppShell();
      setRefContextMenu(el, 'v2.0.0', 'tag');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefPushTag();

      const calls = findCommands('push_tag');
      expect(calls.length).to.equal(1);
      expect(calls[0].args).to.deep.include({
        path: REPO_PATH,
        name: 'v2.0.0',
      });
    });
  });

  describe('handleRefresh ordering (regression test for checkout bug)', () => {
    it('all ref handlers call open_repository to refresh full state', async () => {
      // This is the key regression test. Before the fix, handlers called
      // graphCanvas.refresh() which only reloaded graph commits but never
      // called open_repository to update the store/sidebar/toolbar.

      const handlers = [
        { name: 'handleRefCheckout', ref: 'branch-a', refType: 'localBranch' as const },
        { name: 'handleRefMerge', ref: 'branch-b', refType: 'localBranch' as const },
        { name: 'handleRefRebase', ref: 'branch-c', refType: 'localBranch' as const },
        { name: 'handleRefDeleteBranch', ref: 'branch-d', refType: 'localBranch' as const },
        { name: 'handleRefDeleteTag', ref: 'tag-a', refType: 'tag' as const },
      ];

      for (const { name, ref, refType } of handlers) {
        clearHistory();
        const el = createAppShell();
        setRefContextMenu(el, ref, refType);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (el as any)[name]();

        const openRepoCalls = findCommands('open_repository');
        expect(openRepoCalls.length, `${name} should call open_repository`).to.be.greaterThan(0);
      }
    });
  });

  // D3: handleRefreshAccount must give the user feedback when the account can't
  // be found, instead of silently returning.
  describe('handleRefreshAccount (D3)', () => {
    it('shows an error toast when the account is not found', async () => {
      uiStore.setState({ toasts: [] });
      // get_global_account resolves null (account missing).
      mockInvoke = async (command: string) => {
        if (command === 'get_global_account') return null;
        return null;
      };

      const el = createAppShell();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefreshAccount(
        new CustomEvent('refresh-account', { detail: { accountId: 'missing-acc' } })
      );

      const toasts = uiStore.getState().toasts;
      expect(toasts.some((t) => t.type === 'error' && /Account not found/i.test(t.message))).to.be.true;
    });

    it('does not show the not-found toast when the account exists', async () => {
      uiStore.setState({ toasts: [] });
      mockInvoke = async (command: string) => {
        if (command === 'get_global_account') {
          return {
            id: 'acc-1',
            name: 'Acc',
            integrationType: 'github',
            config: { type: 'github' },
            color: null,
            cachedUser: null,
            urlPatterns: [],
            isDefault: false,
          };
        }
        // refreshAccountCachedUser path: no token -> disconnected, returns cleanly.
        if (command === 'get_keyring_token') return null;
        return null;
      };

      const el = createAppShell();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleRefreshAccount(
        new CustomEvent('refresh-account', { detail: { accountId: 'acc-1' } })
      );

      const toasts = uiStore.getState().toasts;
      expect(toasts.some((t) => /Account not found/i.test(t.message))).to.be.false;
    });
  });
});

describe('app-shell force-delete toast action (integration)', () => {
  beforeEach(() => {
    clearHistory();
    setupDefaultMocks();
    uiStore.setState({ toasts: [] });
    // The handler resolves the originating repo through the store, so it must
    // actually be open there.
    repositoryStore.setState({ openRepositories: [mockOpenRepository], activeIndex: 0 });
  });

  afterEach(() => {
    repositoryStore.setState({ openRepositories: [], activeIndex: -1 });
  });

  // The Force Delete button lives on an 8-second error toast, and nothing
  // clears toasts when the user switches repository. Resolving the repo when
  // the button is clicked therefore force-deleted from whichever tab happened
  // to be active by then — with two repos both holding a branch of the same
  // name, that discards unmerged commits in a repo the user never aimed at.
  it('force-deletes in the repository the failure came from, not the active one', async () => {
    const el = createAppShell();
    // The user has since switched to a different repository.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).activeRepository = {
      ...mockOpenRepository,
      repository: { ...mockOpenRepository.repository, path: '/other/repo', name: 'other' },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).forceDeleteBranch('feature/x', REPO_PATH);

    const calls = findCommands('delete_branch');
    expect(calls.length, 'delete_branch issued').to.equal(1);
    expect((calls[0].args as { path: string }).path, 'targets the originating repo')
      .to.equal(REPO_PATH);
  });

  it('refuses when the originating repository is no longer open', async () => {
    const el = createAppShell();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).forceDeleteBranch('feature/x', '/closed/repo');

    expect(findCommands('delete_branch').length, 'no delete against a closed repo')
      .to.equal(0);
    const toasts = uiStore.getState().toasts;
    expect(toasts.some((t) => /no longer open/i.test(t.message)), 'user is told why')
      .to.be.true;
  });
});

