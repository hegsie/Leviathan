/**
 * Unit tests for lv-blame-view component.
 *
 * Renders the REAL lv-blame-view, mocks only the Tauri invoke layer, and
 * verifies:
 *   - a failed CommandResult surfaces the backend error MESSAGE (not a generic
 *     fallback) — the old `typeof result.error === 'string'` check was always
 *     false and discarded the real message.
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
import type { LvBlameView } from '../lv-blame-view.ts';
import '../lv-blame-view.ts';

const REPO_PATH = '/test/repo';

async function renderBlame(): Promise<LvBlameView> {
  const el = await fixture<LvBlameView>(
    html`<lv-blame-view
      .repositoryPath=${REPO_PATH}
      .filePath=${'src/main.ts'}
    ></lv-blame-view>`
  );
  await el.updateComplete;
  const start = Date.now();
  while (Date.now() - start < 2000) {
    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;
    if (!(el as unknown as { isLoading: boolean }).isLoading) break;
  }
  await el.updateComplete;
  return el;
}

describe('lv-blame-view', () => {
  beforeEach(() => {
    uiStore.setState({ toasts: [] });
  });

  describe('error handling', () => {
    it('surfaces the backend error message from a failed CommandResult', async () => {
      mockInvoke = async (command: string) => {
        if (command === 'get_file_blame') {
          throw { code: 'BLAME_ERROR', message: 'Cannot blame a binary file' };
        }
        return null;
      };

      const el = await renderBlame();

      const errorDiv = el.shadowRoot!.querySelector('.error');
      expect(errorDiv).to.not.be.null;
      expect(errorDiv!.textContent).to.include('Cannot blame a binary file');
    });

  });

  describe('clipboard error feedback', () => {
    it('shows an error toast when copying a hash fails', async () => {
      mockInvoke = async () => null;
      const el = await renderBlame();

      // Force clipboard write to reject (clipboard is a read-only accessor).
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied')) },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).contextMenu = { visible: true, x: 0, y: 0, group: { commitOid: 'deadbeef' }, line: null };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleContextCopyHash();

      const toasts = uiStore.getState().toasts;
      expect(toasts.some((t) => t.type === 'error' && /copy hash/i.test(t.message))).to.be.true;
    });
  });
});
