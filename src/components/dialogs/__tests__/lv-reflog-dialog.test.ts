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

  // `repositoryPath` is live-bound to the ACTIVE repository and rebinds on a
  // Ctrl+Tab this dialog's overlay does not block. The entries on screen (and
  // the oid named in the confirm) belong to the repo active at OPEN, so the
  // reset must target that repo — not whichever tab the user switched to.
  it('resets the repository the entries were read from, not the newly active one', async () => {
    const calls: Array<{ command: string; args?: unknown }> = [];
    mockInvoke = async (command, args) => {
      calls.push({ command, args });
      if (command === 'get_reflog') return [mockEntry];
      if (command === 'plugin:dialog|message') return 'Ok';
      return null;
    };

    const el = await fixture<LvReflogDialog>(
      html`<lv-reflog-dialog ?open=${true} .repositoryPath=${'/repo/a'}></lv-reflog-dialog>`
    );
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));

    // The reflog was read from repo A.
    const load = calls.find((c) => c.command === 'get_reflog');
    expect((load?.args as { path?: string })?.path).to.equal('/repo/a');

    // User Ctrl+Tabs; the dialog stays open still showing A's entries.
    el.repositoryPath = '/repo/b';
    await el.updateComplete;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleReset(mockEntry, 'hard');

    const reset = calls.find((c) => c.command === 'reset_to_reflog');
    expect(reset, 'reset_to_reflog issued').to.not.be.undefined;
    expect((reset!.args as { path: string }).path).to.equal('/repo/a');
  });

  // Only handleDocumentClick cleared this, and Escape is not a click — so the
  // menu was repainted over the next session's list still holding the OLD
  // entry, and clicking it ran a reset the user never re-selected.
  it('clears the context menu when the dialog closes', async () => {
    const el = await fixture<LvReflogDialog>(
      html`<lv-reflog-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-reflog-dialog>`
    );
    await el.updateComplete;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).contextMenu = { visible: true, x: 10, y: 10, entry: mockEntry };
    el.close();
    await el.updateComplete;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).contextMenu.visible).to.be.false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).contextMenu.entry).to.be.null;
  });
});
