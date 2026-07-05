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

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => mockInvoke(command, args),
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import { uiStore } from '../../../stores/ui.store.ts';
import type { Commit } from '../../../types/git.types.ts';
import type { LvFileHistory } from '../lv-file-history.ts';
import '../lv-file-history.ts';

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
});
