/**
 * Unit tests for lv-file-history component.
 *
 * Verifies:
 *   - the context "View blame" action dispatches a `show-blame` event (which
 *     app-shell now listens for on <lv-file-history>).
 *   - clipboard copy failures show an error toast instead of failing silently.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
let mockInvoke: MockInvoke = () => Promise.resolve(null);

/** Every invoke made during a test, so a restore can be asserted end to end. */
const invokeHistory: Array<{ command: string; args?: unknown }> = [];
/** Button label the mocked confirm resolves with. 'Ok' means accepted. */
let confirmAnswer = 'Ok';

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeHistory.push({ command, args });
    // plugin-dialog 2.x routes confirm() through `message` and reads true only
    // from the OK button label.
    if (command === 'plugin:dialog|message') return Promise.resolve(confirmAnswer);
    return mockInvoke(command, args);
  },
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import { uiStore } from '../../../stores/ui.store.ts';
import type { Commit } from '../../../types/git.types.ts';
import type { LvFileHistory } from '../lv-file-history.ts';
import '../lv-file-history.ts';
import { resetRefOpLocks } from '../../../utils/ref-lock.ts';

const REPO_PATH = '/test/repo';

const mockCommit: Commit = {
  oid: 'abc123def456',
  shortId: 'abc123d',
  summary: 'Test commit',
  message: 'Test commit',
  body: null,
  timestamp: Math.floor(Date.now() / 1000),
  author: { name: 'Test User', email: 'test@example.com', timestamp: Math.floor(Date.now() / 1000) },
  committer: { name: 'Test User', email: 'test@example.com', timestamp: Math.floor(Date.now() / 1000) },
  parentIds: [],
};

async function renderHistory(): Promise<LvFileHistory> {
  const el = await fixture<LvFileHistory>(
    html`<lv-file-history
      .repositoryPath=${REPO_PATH}
      .filePath=${'src/main.ts'}
    ></lv-file-history>`
  );
  await el.updateComplete;
  return el;
}

describe('lv-file-history', () => {
  beforeEach(() => {
    uiStore.setState({ toasts: [] });
    mockInvoke = async () => null;
    invokeHistory.length = 0;
    confirmAnswer = 'Ok';
    resetRefOpLocks();
  });

  afterEach(() => {
    resetRefOpLocks();
  });

  describe('show-blame event', () => {
    it('dispatches show-blame with the file path and commit oid', async () => {
      const el = await renderHistory();

      let received: { filePath: string; commitOid: string } | null = null;
      el.addEventListener('show-blame', (e) => {
        received = (e as CustomEvent).detail;
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).contextMenu = { visible: true, x: 0, y: 0, commit: mockCommit };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).handleContextViewBlame();

      expect(received).to.not.be.null;
      expect(received!.filePath).to.equal('src/main.ts');
      expect(received!.commitOid).to.equal(mockCommit.oid);
    });
  });

  describe('clipboard error feedback', () => {
    it('shows an error toast when copying a hash fails', async () => {
      const el = await renderHistory();

      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied')) },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).contextMenu = { visible: true, x: 0, y: 0, commit: mockCommit };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleContextCopyHash();

      const toasts = uiStore.getState().toasts;
      expect(toasts.some((t) => t.type === 'error' && /copy hash/i.test(t.message))).to.be.true;
    });
  });
  describe('restore this version', () => {
    const RESTORE_LABEL = /restore this version/i;

    async function renderWithCommits(commits: Commit[] = [mockCommit]): Promise<LvFileHistory> {
      mockInvoke = async (command: string) => (command === 'get_file_history' ? commits : null);
      const el = await renderHistory();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).loadHistory();
      await el.updateComplete;
      return el;
    }

    async function openMenu(el: LvFileHistory): Promise<HTMLButtonElement[]> {
      const row = el.shadowRoot!.querySelector('.commit-item');
      expect(row, 'no commit row rendered').to.not.be.null;
      row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await el.updateComplete;
      return Array.from(el.shadowRoot!.querySelectorAll('.context-menu .context-menu-item'));
    }

    function restoreCalls(): Array<{ command: string; args?: unknown }> {
      return invokeHistory.filter((c) => c.command === 'checkout_file_from_commit');
    }

    it("restores the panel's file from the right-clicked commit", async () => {
      const el = await renderWithCommits();

      const items = await openMenu(el);
      const restore = items.find((i) => RESTORE_LABEL.test(i.textContent ?? ''));
      expect(restore, 'the commit menu offers a restore').to.not.be.undefined;
      restore!.click();
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 0));

      // File comes from the panel, version from the clicked row.
      const calls = restoreCalls();
      expect(calls).to.have.lengthOf(1);
      expect(calls[0].args).to.deep.equal({
        path: REPO_PATH,
        filePath: 'src/main.ts',
        commit: mockCommit.oid,
      });
      expect(
        uiStore.getState().toasts.some((t) => t.type === 'success' && t.message.includes('src/main.ts'))
      ).to.be.true;
    });

    it('reports a commit that does not contain the file', async () => {
      const el = await renderWithCommits();
      mockInvoke = async (command: string) => {
        if (command === 'checkout_file_from_commit') {
          throw {
            code: 'COMMAND_ERROR',
            message: `File 'src/main.ts' not found in commit ${mockCommit.shortId}`,
          };
        }
        return command === 'get_file_history' ? [mockCommit] : null;
      };

      const items = await openMenu(el);
      items.find((i) => RESTORE_LABEL.test(i.textContent ?? ''))!.click();
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 0));

      const toasts = uiStore.getState().toasts;
      expect(toasts.some((t) => t.type === 'error' && /not found in commit/.test(t.message))).to.be
        .true;
    });

    it('restores a pre-rename commit under the path the file had then', async () => {
      // The panel loads with follow=true, so rows from before a rename hold the
      // file under its OLD name — the current name is not in those trees at
      // all, and restoring it could only fail.
      const renamed: Commit = { ...mockCommit, path: 'src/old-name.ts' };
      const el = await renderWithCommits([renamed]);

      const items = await openMenu(el);
      items.find((i) => RESTORE_LABEL.test(i.textContent ?? ''))!.click();
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 0));

      const calls = restoreCalls();
      expect(calls).to.have.lengthOf(1);
      expect(calls[0].args).to.deep.equal({
        path: REPO_PATH,
        filePath: 'src/old-name.ts',
        commit: renamed.oid,
      });
      expect(
        uiStore
          .getState()
          .toasts.some((t) => t.type === 'success' && t.message.includes('src/old-name.ts'))
      ).to.be.true;
    });

    it('does nothing when the confirm is declined', async () => {
      const el = await renderWithCommits();
      confirmAnswer = 'Cancel';

      const items = await openMenu(el);
      items.find((i) => RESTORE_LABEL.test(i.textContent ?? ''))!.click();
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 0));

      expect(restoreCalls()).to.have.lengthOf(0);
      expect(uiStore.getState().toasts).to.have.lengthOf(0);
    });
  });
});
