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
  state: 'clean',
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

function setupDefaultMocks(): void {
  mockInvoke = async (command: string) => {
    switch (command) {
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

    it('opens conflict dialog on REBASE_CONFLICT', async () => {
      mockInvoke = async (command: string) => {
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
  });

  describe('handleRefDeleteTag', () => {
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
});
