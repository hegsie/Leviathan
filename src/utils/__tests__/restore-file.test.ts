/**
 * Tests for the shared "restore a file to its version in a commit" helper.
 *
 * checkout_file_from_commit overwrites the working-tree copy AND stages it, so
 * the helper must confirm first, must hold the same working-tree lock every
 * other destructive surface takes, and must never fail silently.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
const invokeHistory: Array<{ command: string; args?: unknown }> = [];
/** Args of the last showConfirm(): plugin-dialog routes confirm() through it. */
let lastConfirm: { title?: string; message?: string } | null = null;
/** Button label the mocked confirm resolves with. 'Ok' means accepted. */
let confirmAnswer = 'Ok';

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeHistory.push({ command, args });
    if (command === 'plugin:dialog|message') {
      const a = args as { title?: string; message?: string };
      lastConfirm = { title: a?.title, message: a?.message };
      return Promise.resolve(confirmAnswer);
    }
    return mockInvoke(command, args);
  },
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect } from '@open-wc/testing';
import { uiStore } from '../../stores/ui.store.ts';
import {
  tryAcquireRefOp,
  isRefOpRunning,
  resetRefOpLocks,
} from '../ref-lock.ts';
import { restoreFileFromCommit, restoreFileConfirmCopy } from '../restore-file.ts';

const REPO_PATH = '/test/repo';
const FILE_PATH = 'src/main.ts';
const COMMIT_OID = 'abc123def456';
const SHORT_ID = 'abc123d';

function checkoutCalls(): Array<{ command: string; args?: unknown }> {
  return invokeHistory.filter((c) => c.command === 'checkout_file_from_commit');
}

function confirmCalls(): Array<{ command: string; args?: unknown }> {
  return invokeHistory.filter((c) => c.command === 'plugin:dialog|message');
}

function toasts(): Array<{ type: string; message: string }> {
  return uiStore.getState().toasts as unknown as Array<{ type: string; message: string }>;
}

/** Record the two refresh events the helper raises on success. */
function watchRefreshEvents(): {
  repositoryRefresh: Array<{ repoPath?: string } | undefined>;
  statusRefresh: number;
  stop: () => void;
} {
  const seen = {
    repositoryRefresh: [] as Array<{ repoPath?: string } | undefined>,
    statusRefresh: 0,
    stop: () => {
      window.removeEventListener('repository-refresh', onRepo);
      window.removeEventListener('status-refresh', onStatus);
    },
  };
  const onRepo = (e: Event): void => {
    seen.repositoryRefresh.push((e as CustomEvent).detail as { repoPath?: string } | undefined);
  };
  const onStatus = (): void => {
    seen.statusRefresh += 1;
  };
  window.addEventListener('repository-refresh', onRepo);
  window.addEventListener('status-refresh', onStatus);
  return seen;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('restoreFileFromCommit', () => {
  beforeEach(() => {
    resetRefOpLocks();
    invokeHistory.length = 0;
    lastConfirm = null;
    confirmAnswer = 'Ok';
    uiStore.setState({ toasts: [] });
    mockInvoke = async () => null;
  });

  afterEach(() => {
    resetRefOpLocks();
  });

  it('names the file and warns that the working copy is overwritten and staged', async () => {
    await restoreFileFromCommit(REPO_PATH, FILE_PATH, COMMIT_OID, SHORT_ID);

    expect(lastConfirm).to.not.be.null;
    expect(lastConfirm!.title).to.equal('Restore File');
    expect(lastConfirm!.message).to.contain(FILE_PATH);
    expect(lastConfirm!.message).to.contain(SHORT_ID);
    expect(lastConfirm!.message).to.match(/overwrites/i);
    expect(lastConfirm!.message).to.match(/stages/i);

    // The shared copy helper is the single source both surfaces use.
    const copy = restoreFileConfirmCopy(FILE_PATH, SHORT_ID);
    expect(copy.title).to.equal(lastConfirm!.title);
    expect(copy.message).to.equal(lastConfirm!.message);
  });

  it('restores the file after the confirm is accepted', async () => {
    const events = watchRefreshEvents();
    try {
      const restored = await restoreFileFromCommit(REPO_PATH, FILE_PATH, COMMIT_OID, SHORT_ID);

      expect(restored).to.be.true;
      const calls = checkoutCalls();
      expect(calls).to.have.lengthOf(1);
      expect(calls[0].args).to.deep.equal({
        path: REPO_PATH,
        filePath: FILE_PATH,
        commit: COMMIT_OID,
      });

      const success = toasts().filter((t) => t.type === 'success');
      expect(success).to.have.lengthOf(1);
      expect(success[0].message).to.contain(FILE_PATH);

      // Pinned refresh naming the repo the restore ran against, plus the
      // immediate status reload so the staged file appears in Changes.
      expect(events.repositoryRefresh).to.deep.equal([{ repoPath: REPO_PATH }]);
      expect(events.statusRefresh).to.equal(1);

      // Lock handed back for the next operation.
      expect(isRefOpRunning(REPO_PATH)).to.be.false;
    } finally {
      events.stop();
    }
  });

  it('does not touch the working tree when the confirm is declined', async () => {
    confirmAnswer = 'Cancel';
    const events = watchRefreshEvents();
    try {
      const restored = await restoreFileFromCommit(REPO_PATH, FILE_PATH, COMMIT_OID, SHORT_ID);

      expect(restored).to.be.false;
      expect(checkoutCalls()).to.have.lengthOf(0);
      expect(events.repositoryRefresh).to.have.lengthOf(0);
      expect(events.statusRefresh).to.equal(0);
      // A leaked claim would freeze every ref control for the rest of the session.
      expect(isRefOpRunning(REPO_PATH)).to.be.false;
    } finally {
      events.stop();
    }
  });

  it('surfaces a backend failure as an error toast and refreshes nothing', async () => {
    mockInvoke = async (command: string) => {
      if (command === 'checkout_file_from_commit') {
        throw {
          code: 'COMMAND_ERROR',
          message: `File '${FILE_PATH}' not found in commit ${SHORT_ID}`,
        };
      }
      return null;
    };

    const events = watchRefreshEvents();
    try {
      const restored = await restoreFileFromCommit(REPO_PATH, FILE_PATH, COMMIT_OID, SHORT_ID);

      expect(restored).to.be.false;
      const errors = toasts().filter((t) => t.type === 'error');
      expect(errors).to.have.lengthOf(1);
      expect(errors[0].message).to.contain('not found in commit');
      expect(events.repositoryRefresh).to.have.lengthOf(0);
      expect(events.statusRefresh).to.equal(0);
      expect(isRefOpRunning(REPO_PATH)).to.be.false;
    } finally {
      events.stop();
    }
  });

  it('refuses, visibly, while another operation holds the working tree', async () => {
    expect(tryAcquireRefOp(REPO_PATH)).to.be.true;

    const restored = await restoreFileFromCommit(REPO_PATH, FILE_PATH, COMMIT_OID, SHORT_ID);

    expect(restored).to.be.false;
    // Never even asks, let alone writes.
    expect(confirmCalls()).to.have.lengthOf(0);
    expect(checkoutCalls()).to.have.lengthOf(0);
    // And the refusal is not silent.
    expect(toasts().filter((t) => t.type === 'warning')).to.have.lengthOf(1);
    // The other operation still holds its claim.
    expect(isRefOpRunning(REPO_PATH)).to.be.true;
  });

  it('claims the lock before the confirm, so a double-clicked menu item cannot double-restore', async () => {
    let lockedDuringConfirm = false;
    const original = (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ as {
      invoke: MockInvoke;
    };
    const originalInvoke = original.invoke;
    original.invoke = async (command: string, args?: unknown) => {
      if (command === 'plugin:dialog|message') {
        lockedDuringConfirm = isRefOpRunning(REPO_PATH);
      }
      return originalInvoke(command, args);
    };

    try {
      await restoreFileFromCommit(REPO_PATH, FILE_PATH, COMMIT_OID, SHORT_ID);
    } finally {
      original.invoke = originalInvoke;
    }

    expect(lockedDuringConfirm).to.be.true;
  });
});
