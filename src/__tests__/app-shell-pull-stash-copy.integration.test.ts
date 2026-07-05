/**
 * Integration tests for app-shell pull / stash / copy-sha / conflict-dialog
 * handlers.
 *
 * These create a REAL AppShell instance, set its internal state, call its REAL
 * handler methods, and verify the actual Tauri commands + user-visible toasts.
 * They cover the verified fixes:
 *   - handlePull inspects the CommandResult (success, MERGE_CONFLICT,
 *     REBASE_CONFLICT, generic error) instead of assuming success.
 *   - handleCreateStash reports success/failure via toast.
 *   - handleCopySha shows a success toast.
 *   - handleOpenConflictDialogEvent refreshes the repository.
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

function setupDefaultMocks(): void {
  mockInvoke = async (command: string) => {
    switch (command) {
      case 'open_repository':
        return mockOpenRepository;
      default:
        return null;
    }
  };
}

function createAppShell(): AppShell {
  const el = document.createElement('lv-app-shell') as AppShell;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any).activeRepository = mockOpenRepository;
  return el;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('app-shell pull/stash/copy handlers (integration)', () => {
  beforeEach(() => {
    clearHistory();
    setupDefaultMocks();
    uiStore.setState({ toasts: [] });
  });

  describe('handlePull', () => {
    it('refreshes the repository on success', async () => {
      const el = createAppShell();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handlePull();

      expect(findCommands('pull').length).to.equal(1);
      // handleRefresh -> open_repository
      expect(findCommands('open_repository').length).to.be.greaterThan(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).showConflictDialog).to.be.false;
    });

    it('opens the merge conflict dialog on MERGE_CONFLICT', async () => {
      mockInvoke = async (command: string) => {
        if (command === 'pull') throw { code: 'MERGE_CONFLICT', message: 'Merge conflict' };
        if (command === 'open_repository') return mockOpenRepository;
        return null;
      };

      const el = createAppShell();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handlePull();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).showConflictDialog).to.be.true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).conflictOperationType).to.equal('merge');
      // Still refreshes so the working tree reflects the conflicted state
      expect(findCommands('open_repository').length).to.be.greaterThan(0);
    });

    it('opens the rebase conflict dialog on REBASE_CONFLICT', async () => {
      mockInvoke = async (command: string) => {
        if (command === 'pull') throw { code: 'REBASE_CONFLICT', message: 'Rebase conflict' };
        if (command === 'open_repository') return mockOpenRepository;
        return null;
      };

      const el = createAppShell();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handlePull();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).showConflictDialog).to.be.true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).conflictOperationType).to.equal('rebase');
    });

    it('shows an error toast on generic failure and does not open the dialog', async () => {
      mockInvoke = async (command: string) => {
        if (command === 'pull') throw { code: 'NETWORK', message: 'Could not reach remote' };
        return null;
      };

      const el = createAppShell();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handlePull();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).showConflictDialog).to.be.false;
      const toasts = uiStore.getState().toasts;
      expect(toasts.some((t) => t.type === 'error' && /Could not reach remote/.test(t.message))).to.be.true;
    });
  });

  describe('handleCreateStash', () => {
    it('shows a success toast and refreshes on success', async () => {
      const el = createAppShell();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleCreateStash();

      expect(findCommands('create_stash').length).to.equal(1);
      expect(findCommands('open_repository').length).to.be.greaterThan(0);
      const toasts = uiStore.getState().toasts;
      expect(toasts.some((t) => t.type === 'success' && /Stash created/i.test(t.message))).to.be.true;
    });

    it('shows an error toast and does not refresh on failure', async () => {
      mockInvoke = async (command: string) => {
        if (command === 'create_stash') throw { code: 'STASH_ERROR', message: 'Nothing to stash' };
        return null;
      };

      const el = createAppShell();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleCreateStash();

      const toasts = uiStore.getState().toasts;
      expect(toasts.some((t) => t.type === 'error' && /Nothing to stash/.test(t.message))).to.be.true;
      expect(findCommands('open_repository').length).to.equal(0);
    });
  });

  describe('handleCopySha', () => {
    it('shows a success toast with the copied sha', () => {
      const el = createAppShell();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).handleCopySha(new CustomEvent('copy-sha', { detail: { sha: 'abc1234' } }));

      const toasts = uiStore.getState().toasts;
      expect(toasts.some((t) => t.type === 'success' && /abc1234/.test(t.message))).to.be.true;
    });
  });

  describe('handleShowBlame (show-blame from file-history/right-panel)', () => {
    it('opens the blame view and closes any open diff', () => {
      const el = createAppShell();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shell = el as any;
      shell.showDiff = true;
      shell.diffFile = { path: 'src/x.ts', status: 'modified', isStaged: false, isConflicted: false };

      shell.handleShowBlame(
        new CustomEvent('show-blame', { detail: { filePath: 'src/x.ts', commitOid: 'abc123' } })
      );

      expect(shell.showBlame).to.be.true;
      expect(shell.blameFile).to.equal('src/x.ts');
      expect(shell.blameCommitOid).to.equal('abc123');
      expect(shell.showDiff).to.be.false;
      expect(shell.diffFile).to.be.null;
    });
  });

  describe('handleCloseDiff (file-cleared from diff-view)', () => {
    it('closes the diff overlay and clears diff state', () => {
      const el = createAppShell();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shell = el as any;
      shell.showDiff = true;
      shell.diffFile = { path: 'src/x.ts', status: 'modified', isStaged: false, isConflicted: false };
      shell.diffCommitFile = null;

      shell.handleCloseDiff();

      expect(shell.showDiff).to.be.false;
      expect(shell.diffFile).to.be.null;
      expect(shell.diffCommitFile).to.be.null;
    });
  });

  describe('handleOpenConflictDialogEvent', () => {
    it('opens the dialog and refreshes the repository', async () => {
      const el = createAppShell();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).handleOpenConflictDialogEvent(
        new CustomEvent('open-conflict-dialog', { detail: { operationType: 'rebase' } })
      );

      // Let the async handleRefresh run
      await new Promise((r) => setTimeout(r, 0));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).showConflictDialog).to.be.true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).conflictOperationType).to.equal('rebase');
      expect(findCommands('open_repository').length).to.be.greaterThan(0);
    });

    it('passes stash operationType through to the dialog', async () => {
      const el = createAppShell();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).handleOpenConflictDialogEvent(
        new CustomEvent('open-conflict-dialog', { detail: { operationType: 'stash' } })
      );
      await new Promise((r) => setTimeout(r, 0));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).showConflictDialog).to.be.true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).conflictOperationType).to.equal('stash');
    });
  });

  describe('handleAutoStashToast', () => {
    it('opens the stash conflict dialog when the stash pop conflicts', async () => {
      const el = createAppShell();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).handleAutoStashToast(
        { stashed: true, stashApplied: false, stashConflict: true, success: true, message: 'conflict' },
        'feature/x'
      );
      await new Promise((r) => setTimeout(r, 0));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).showConflictDialog).to.be.true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).conflictOperationType).to.equal('stash');
      // Warns the user AND opens the dialog.
      const toasts = uiStore.getState().toasts;
      expect(toasts.some((t) => t.type === 'warning' && /stash conflicts/i.test(t.message))).to.be.true;
    });

    it('does not open the dialog when the stash re-applies cleanly', async () => {
      const el = createAppShell();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).handleAutoStashToast(
        { stashed: true, stashApplied: true, stashConflict: false, success: true, message: 'ok' },
        'feature/x'
      );
      await new Promise((r) => setTimeout(r, 0));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).showConflictDialog).to.be.false;
    });
  });
});
