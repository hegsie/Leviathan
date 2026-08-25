/**
 * Unit tests for lv-file-history component.
 *
 * Verifies:
 *   - diff and blame actions use the path the file had AT THAT COMMIT, which
 *     differs from the file's current path for entries older than a rename.
 *   - the historical path is surfaced on those rows.
 *   - a failed history load shows an error and lists nothing.
 *   - clipboard copy failures show an error toast instead of failing silently.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
let mockInvoke: MockInvoke = () => Promise.resolve(null);

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => mockInvoke(command, args),
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html, waitUntil } from '@open-wc/testing';
import { uiStore } from '../../../stores/ui.store.ts';
import type { Commit, FileHistoryEntry } from '../../../types/git.types.ts';
import type { LvFileHistory } from '../lv-file-history.ts';
import '../lv-file-history.ts';

const REPO_PATH = '/test/repo';
const CURRENT_PATH = 'src/main.ts';
const OLD_PATH = 'src/old-main.ts';

const now = Math.floor(Date.now() / 1000);

function commit(oid: string, shortId: string, summary: string): Commit {
  return {
    oid,
    shortId,
    summary,
    message: summary,
    body: null,
    timestamp: now,
    author: { name: 'Test User', email: 'test@example.com', timestamp: now },
    committer: { name: 'Test User', email: 'test@example.com', timestamp: now },
    parentIds: [],
  };
}

/** Entry from after the rename — its path is the file's current path. */
const postRename: FileHistoryEntry = {
  commit: commit('aaa111', 'aaa111a', 'Edit after rename'),
  pathAtCommit: CURRENT_PATH,
};

/** Entry from before the rename — the file lived under a different name. */
const preRename: FileHistoryEntry = {
  commit: commit('bbb222', 'bbb222b', 'Add original'),
  pathAtCommit: OLD_PATH,
};

async function renderHistory(): Promise<LvFileHistory> {
  const el = await fixture<LvFileHistory>(
    html`<lv-file-history
      .repositoryPath=${REPO_PATH}
      .filePath=${CURRENT_PATH}
    ></lv-file-history>`
  );
  await waitUntil(
    () => el.shadowRoot!.querySelectorAll('.commit-item').length === 2,
    'file history entries never rendered'
  );
  return el;
}

describe('lv-file-history', () => {
  beforeEach(() => {
    uiStore.setState({ toasts: [] });
    mockInvoke = async (command: string) => {
      if (command === 'get_file_history') return [postRename, preRename];
      return null;
    };
  });

  describe('view-diff event', () => {
    it('dispatches view-diff with the path the file had at that commit', async () => {
      const el = await renderHistory();

      let received: { commitOid: string; filePath: string } | null = null;
      el.addEventListener('view-diff', (e) => {
        received = (e as CustomEvent).detail;
      });

      const buttons = el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.view-diff-btn');
      buttons[1].click();

      expect(received).to.not.be.null;
      expect(received!.commitOid).to.equal(preRename.commit.oid);
      expect(received!.filePath).to.equal(OLD_PATH);
    });

    it('uses the current path for an entry that was not renamed', async () => {
      const el = await renderHistory();

      let received: { commitOid: string; filePath: string } | null = null;
      el.addEventListener('view-diff', (e) => {
        received = (e as CustomEvent).detail;
      });

      const buttons = el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.view-diff-btn');
      buttons[0].click();

      expect(received).to.not.be.null;
      expect(received!.filePath).to.equal(CURRENT_PATH);
    });
  });

  describe('show-blame event', () => {
    it('dispatches show-blame with the path the file had at that commit', async () => {
      const el = await renderHistory();

      let received: { filePath: string; commitOid: string } | null = null;
      el.addEventListener('show-blame', (e) => {
        received = (e as CustomEvent).detail;
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).contextMenu = { visible: true, x: 0, y: 0, entry: preRename };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).handleContextViewBlame();

      expect(received).to.not.be.null;
      expect(received!.filePath).to.equal(OLD_PATH);
      expect(received!.commitOid).to.equal(preRename.commit.oid);
    });

    it('uses the current path when the file was not renamed', async () => {
      const el = await renderHistory();

      let received: { filePath: string; commitOid: string } | null = null;
      el.addEventListener('show-blame', (e) => {
        received = (e as CustomEvent).detail;
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).contextMenu = { visible: true, x: 0, y: 0, entry: postRename };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).handleContextViewBlame();

      expect(received).to.not.be.null;
      expect(received!.filePath).to.equal(CURRENT_PATH);
      expect(received!.commitOid).to.equal(postRename.commit.oid);
    });
  });

  describe('historical path display', () => {
    it('shows the historical path only on entries whose path differs', async () => {
      const el = await renderHistory();

      const items = el.shadowRoot!.querySelectorAll('.commit-item');
      expect(items[0].querySelector('.commit-path')).to.be.null;

      const historical = items[1].querySelector('.commit-path');
      expect(historical).to.not.be.null;
      expect(historical!.textContent!.trim()).to.equal(OLD_PATH);
    });
  });

  describe('error handling', () => {
    it('shows the error message and no entries when history fails', async () => {
      mockInvoke = async (command: string) => {
        if (command === 'get_file_history') throw new Error('boom');
        return null;
      };

      const el = await fixture<LvFileHistory>(
        html`<lv-file-history
          .repositoryPath=${REPO_PATH}
          .filePath=${CURRENT_PATH}
        ></lv-file-history>`
      );
      await waitUntil(
        () => el.shadowRoot!.querySelector('.error') !== null,
        'error state never rendered'
      );

      expect(el.shadowRoot!.querySelectorAll('.commit-item').length).to.equal(0);
      expect(el.shadowRoot!.querySelector('.error')!.textContent).to.contain('boom');
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
      (el as any).contextMenu = { visible: true, x: 0, y: 0, entry: postRename };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleContextCopyHash();

      const toasts = uiStore.getState().toasts;
      expect(toasts.some((t) => t.type === 'error' && /copy hash/i.test(t.message))).to.be.true;
    });
  });
});
