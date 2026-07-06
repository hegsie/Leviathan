/**
 * Unit tests for lv-reflog-dialog.
 *
 * Verifies that a failed clipboard copy of a reflog entry hash shows an error
 * toast instead of failing silently.
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
import type { ReflogEntry } from '../../../types/git.types.ts';
import type { LvReflogDialog } from '../lv-reflog-dialog.ts';
import '../lv-reflog-dialog.ts';

const mockEntry: ReflogEntry = {
  oid: 'deadbeef1234',
  shortId: 'deadbee',
  refName: 'HEAD',
  message: 'commit: something',
  operation: 'commit',
  committer: { name: 'T', email: 't@example.com', timestamp: Math.floor(Date.now() / 1000) },
  timestamp: Math.floor(Date.now() / 1000),
  index: 0,
} as unknown as ReflogEntry;

describe('lv-reflog-dialog', () => {
  beforeEach(() => {
    uiStore.setState({ toasts: [] });
    mockInvoke = async () => null;
  });

  it('shows an error toast when copying an entry hash fails', async () => {
    const el = await fixture<LvReflogDialog>(
      html`<lv-reflog-dialog .repositoryPath=${'/test/repo'}></lv-reflog-dialog>`
    );
    await el.updateComplete;

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).contextMenu = { visible: true, x: 0, y: 0, entry: mockEntry };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleContextCopyHash();

    const toasts = uiStore.getState().toasts;
    expect(toasts.some((t) => t.type === 'error' && /copy hash/i.test(t.message))).to.be.true;
  });
});
