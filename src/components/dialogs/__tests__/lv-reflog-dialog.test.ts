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
import { tryAcquireRefOp, releaseRefOp, resetRefOpLocks } from '../../../utils/ref-lock.ts';

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


/** A "checkout: moving from X to Y" reflog entry. */
function checkoutEntry(from: string, to: string): ReflogEntry {
  return {
    oid: 'feed0000beef',
    shortId: 'feed000',
    index: 1,
    action: 'checkout',
    message: `checkout: moving from ${from} to ${to}`,
    timestamp: Math.floor(Date.now() / 1000),
    author: 'T',
  } as unknown as ReflogEntry;
}

/** `count` sequential reflog entries, newest first. */
function pageEntries(count: number): ReflogEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    oid: `oid${i}`.padEnd(12, '0'),
    shortId: `oid${i}`.padEnd(7, '0').slice(0, 7),
    index: i,
    action: 'commit',
    message: `commit: entry ${i}`,
    timestamp: Math.floor(Date.now() / 1000),
    author: 'T',
  })) as unknown as ReflogEntry[];
}

/**
 * A repo whose reflog holds `total` entries; get_reflog honours `limit` the
 * way the backend does (it stops once `limit` entries have been collected).
 * Every requested limit is recorded in `calls`.
 */
function mockReflogOfSize(total: number, calls: Array<{ limit?: number }>): void {
  const all = pageEntries(total);
  mockInvoke = async (command, args) => {
    if (command === 'get_reflog') {
      const limit = (args as { limit?: number }).limit;
      calls.push({ limit });
      return all.slice(0, limit ?? total);
    }
    if (command === 'plugin:dialog|message') return 'Ok';
    return null;
  };
}

/** An ordinary commit entry, which SHOULD still offer a reset. */
function commitEntry(): ReflogEntry {
  return {
    oid: 'cafe0000babe',
    shortId: 'cafe000',
    index: 2,
    action: 'commit',
    message: 'commit: work',
    timestamp: Math.floor(Date.now() / 1000),
    author: 'T',
  } as unknown as ReflogEntry;
}

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

  // handleReset already CLAIMED the shared lock and refused when another
  // surface held it — but the buttons were bound to `resetting` alone, a flag
  // that only ever tracked this dialog. So while a checkout ran elsewhere,
  // "Hard reset (discard all changes)" stayed fully clickable and did nothing
  // but raise a refusal toast. Asserted on rendered DOM: the getter calls
  // isRefOpRunning on every access and so reports the truth even with the
  // subscription deleted.
  it('greys out Undo and Hard while another surface holds the working tree', async () => {
    const REPO = '/test/repo';
    resetRefOpLocks();
    mockInvoke = async (command: string) =>
      command === 'get_reflog'
        ? [mockEntry, { ...mockEntry, oid: 'cafe5678', shortId: 'cafe567', index: 1 }]
        : null;

    const el = await fixture<LvReflogDialog>(
      html`<lv-reflog-dialog ?open=${true} .repositoryPath=${REPO}></lv-reflog-dialog>`
    );

    let buttons: HTMLButtonElement[] = [];
    for (let i = 0; i < 100 && buttons.length === 0; i++) {
      await el.updateComplete;
      buttons = Array.from(el.shadowRoot!.querySelectorAll('.reset-btn'));
      if (buttons.length === 0) await new Promise((r) => setTimeout(r, 10));
    }
    expect(buttons.length, 'reset buttons must be rendered').to.be.greaterThan(0);
    expect(
      buttons.every((b) => !b.disabled),
      'clickable while the repo is idle'
    ).to.be.true;

    tryAcquireRefOp(REPO);
    await el.updateComplete;
    expect(
      buttons.every((b) => b.disabled),
      'a claim from another surface must grey them out'
    ).to.be.true;

    releaseRefOp(REPO);
    await el.updateComplete;
    expect(
      buttons.every((b) => !b.disabled),
      'and the release must revive them'
    ).to.be.true;

    resetRefOpLocks();
  });

  // ── Checkout entries must switch, not reset ──────────────────────────────
  describe('checkout entries', () => {
    /**
     * Opens the dialog for real, so the repo it pins is the one under test.
     * Poking `entries` on a closed dialog left `pinnedRepoPath` empty, which no
     * longer resembles anything a user can produce.
     */
    async function dialogWith(
      entries: ReflogEntry[],
      repositoryPath = '/test/repo'
    ): Promise<LvReflogDialog> {
      const inner = mockInvoke;
      mockInvoke = async (command, args) => {
        if (command === 'get_reflog') return entries;
        return inner(command, args);
      };

      const el = await fixture<LvReflogDialog>(
        html`<lv-reflog-dialog ?open=${true} .repositoryPath=${repositoryPath}></lv-reflog-dialog>`
      );
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 0));
      await el.updateComplete;
      return el;
    }

    /** A successful `checkout_with_autostash` payload, with overrides. */
    function stashResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        success: true,
        stashed: false,
        stashApplied: false,
        stashConflict: false,
        stashOid: null,
        message: 'Switched',
        ...overrides,
      };
    }

    it('offers Switch instead of a reset on a checkout entry', async () => {
      // A "checkout: moving from main to feature" entry records ANOTHER
      // branch's tip. Resetting onto it repoints the current branch there and
      // orphans its commits — the opposite of "go back to that state".
      const el = await dialogWith([checkoutEntry('main', 'feature')]);

      const labels = Array.from(el.shadowRoot!.querySelectorAll('.entry-actions button')).map(
        (b) => b.textContent!.trim()
      );

      expect(labels.join(' | ')).to.contain('Switch to feature');
      expect(labels, 'a checkout entry must not offer a hard reset').to.not.include('Hard');
      expect(labels, 'a checkout entry must not offer an "Undo" reset').to.not.include('Undo');
    });

    it('still offers Undo and Hard on an ordinary commit entry', async () => {
      const el = await dialogWith([commitEntry()]);

      const labels = Array.from(el.shadowRoot!.querySelectorAll('.entry-actions button')).map(
        (b) => b.textContent!.trim()
      );

      expect(labels).to.include('Undo');
      expect(labels).to.include('Hard');
    });

    it('checks out the target branch rather than resetting', async () => {
      const calls: string[] = [];
      mockInvoke = async (command: string) => {
        calls.push(command);
        if (command === 'checkout_with_autostash') return stashResult();
        return null;
      };

      const el = await dialogWith([checkoutEntry('main', 'feature')]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleSwitchTo(checkoutEntry('main', 'feature'));

      expect(calls).to.include('checkout_with_autostash');
      expect(calls, 'a switch must never reset the branch').to.not.include('reset_to_reflog');
    });

    // The same live-prop trap the reset path already guards against: the
    // overlay does not block Ctrl+Tab, so reading `repositoryPath` at call time
    // ran the checkout against whichever repo the user had switched to — where
    // the branch name means something else, or nothing at all.
    it('switches the repository the entries were read from, not the newly active one', async () => {
      const calls: Array<{ command: string; args?: unknown }> = [];
      mockInvoke = async (command, args) => {
        calls.push({ command, args });
        if (command === 'checkout_with_autostash') return stashResult();
        return null;
      };

      const el = await dialogWith([checkoutEntry('main', 'feature')], '/repo/a');
      el.repositoryPath = '/repo/b';
      await el.updateComplete;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleSwitchTo(checkoutEntry('main', 'feature'));

      const checkout = calls.find((c) => c.command === 'checkout_with_autostash');
      expect(checkout, 'checkout_with_autostash issued').to.not.be.undefined;
      expect((checkout!.args as { path: string }).path).to.equal('/repo/a');
    });

    // The switch auto-stashes, so it can land with the user's changes still
    // shelved or conflicted. A bare "Switched to feature" hid that entirely.
    it('reports a conflicting auto-stash instead of a bare success', async () => {
      mockInvoke = async (command: string) => {
        if (command === 'checkout_with_autostash') {
          return stashResult({
            stashed: true,
            stashApplied: false,
            stashConflict: true,
            stashOid: 'stash0id',
            message: 'Stash conflicts',
          });
        }
        return null;
      };

      const el = await dialogWith([checkoutEntry('main', 'feature')]);
      let conflictDetail: Record<string, unknown> | null = null;
      el.addEventListener('open-conflict-dialog', (e) => {
        conflictDetail = (e as CustomEvent).detail;
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleSwitchTo(checkoutEntry('main', 'feature'));

      const toasts = uiStore.getState().toasts;
      expect(
        toasts.some((t) => t.type === 'warning' && /stash conflicts/i.test(t.message)),
        'the user must be told the stash needs resolving'
      ).to.be.true;
      expect(conflictDetail, 'the conflict dialog must be opened').to.not.be.null;
      expect(conflictDetail!).to.include({
        operationType: 'stash',
        stashOid: 'stash0id',
        dropStashOnComplete: true,
        repositoryPath: '/test/repo',
      });
    });

    it('warns when the auto-stash could not be re-applied', async () => {
      mockInvoke = async (command: string) => {
        if (command === 'checkout_with_autostash') {
          return stashResult({
            stashed: true,
            stashApplied: false,
            stashConflict: false,
            message: 'Changes are kept in the stash',
          });
        }
        return null;
      };

      const el = await dialogWith([checkoutEntry('main', 'feature')]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleSwitchTo(checkoutEntry('main', 'feature'));

      const toasts = uiStore.getState().toasts;
      expect(
        toasts.some((t) => t.type === 'warning' && /kept in the stash/i.test(t.message)),
        'work left in the stash must not be reported as a clean switch'
      ).to.be.true;
    });

    it('parses the target only from checkout entries', async () => {
      const el = await dialogWith([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const target = (e: ReflogEntry) => (el as any).checkoutTarget(e);

      expect(target(checkoutEntry('main', 'feature'))).to.equal('feature');
      expect(target(checkoutEntry('feature', 'release/2.0'))).to.equal('release/2.0');
      expect(target(commitEntry()), 'a commit entry is not a checkout').to.be.null;
    });
  });

  // ── Reaching entries past the first page ─────────────────────────────────
  //
  // This dialog is the app's recovery surface, and it asked for exactly 50
  // entries and rendered nothing else: a user whose lost commit sat at
  // HEAD@{51} scrolled to the bottom, found nothing, and had no way to learn
  // that older states existed — while git could still recover them.
  describe('pagination', () => {
    /** Open a real session so the dialog pins a repo and loads its first page. */
    async function openDialog(repositoryPath = '/test/repo'): Promise<LvReflogDialog> {
      const el = await fixture<LvReflogDialog>(
        html`<lv-reflog-dialog ?open=${true} .repositoryPath=${repositoryPath}></lv-reflog-dialog>`
      );
      await settle(el);
      return el;
    }

    async function settle(el: LvReflogDialog): Promise<void> {
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 0));
      await el.updateComplete;
    }

    function showMore(el: LvReflogDialog): HTMLButtonElement | null {
      return el.shadowRoot!.querySelector<HTMLButtonElement>('.show-more-btn');
    }

    function note(el: LvReflogDialog): string {
      return el.shadowRoot!.querySelector('.list-note')?.textContent ?? '';
    }

    it('flags the list as truncated and offers a way to see older entries', async () => {
      const calls: Array<{ limit?: number }> = [];
      mockReflogOfSize(120, calls);

      const el = await openDialog();

      expect(calls[0].limit, 'the first page asks for 50').to.equal(50);
      expect(el.shadowRoot!.querySelectorAll('.entry').length).to.equal(50);
      expect(showMore(el), 'a truncated list must offer more').to.not.be.null;
      expect(note(el)).to.match(/first 50/);
    });

    it('Show more pulls the next page and stops once the whole reflog is listed', async () => {
      const calls: Array<{ limit?: number }> = [];
      mockReflogOfSize(120, calls);

      const el = await openDialog();

      showMore(el)!.click();
      await settle(el);

      // get_reflog has no skip parameter, so the next page is a re-read from
      // HEAD@{0} with a bigger limit — replacing the list, not appending.
      expect(calls[1].limit).to.equal(100);
      expect(el.shadowRoot!.querySelectorAll('.entry').length).to.equal(100);
      expect(showMore(el), 'still more to come').to.not.be.null;

      showMore(el)!.click();
      await settle(el);

      expect(calls[2].limit).to.equal(150);
      expect(el.shadowRoot!.querySelectorAll('.entry').length).to.equal(120);
      expect(showMore(el), 'a complete list must not offer a dead control').to.be.null;
      expect(note(el)).to.match(/Showing all 120/);
    });

    it('keeps the list and the control when a page fails to load, and says so', async () => {
      let loads = 0;
      mockInvoke = async (command) => {
        if (command === 'get_reflog') {
          loads++;
          if (loads > 1) throw new Error('reflog read failed');
          return pageEntries(50);
        }
        return null;
      };

      const el = await openDialog();
      expect(el.shadowRoot!.querySelectorAll('.entry').length).to.equal(50);

      showMore(el)!.click();
      await settle(el);

      const toasts = uiStore.getState().toasts;
      expect(
        toasts.some((t) => t.type === 'error' && /load more/i.test(t.message)),
        'a failed page must be reported'
      ).to.be.true;
      expect(
        el.shadowRoot!.querySelectorAll('.entry').length,
        'the failure must not wipe the list the user was reading'
      ).to.equal(50);
      expect(showMore(el), 'retry must stay available').to.not.be.null;
    });

    it('a short reflog says the list is complete instead of offering a dead control', async () => {
      const calls: Array<{ limit?: number }> = [];
      mockReflogOfSize(3, calls);

      const el = await openDialog();

      expect(showMore(el)).to.be.null;
      expect(note(el)).to.match(/Showing all 3/);
    });

    // loadReflog doubles as the post-failed-reset refresh (the backend's
    // "refresh and try again" advice), so it must NOT collapse the expansion
    // at exactly the moment the user is hunting for a deep entry.
    it('keeps the expanded listing when a failed reset reloads the entries', async () => {
      const calls: Array<{ limit?: number }> = [];
      const all = pageEntries(120);
      resetRefOpLocks();
      mockInvoke = async (command, args) => {
        if (command === 'get_reflog') {
          const limit = (args as { limit?: number }).limit;
          calls.push({ limit });
          return all.slice(0, limit ?? 120);
        }
        if (command === 'plugin:dialog|message') return 'Ok';
        if (command === 'reset_to_reflog') throw new Error('reflog moved');
        return null;
      };

      const el = await openDialog();
      showMore(el)!.click();
      await settle(el);
      expect(el.shadowRoot!.querySelectorAll('.entry').length).to.equal(100);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleReset(all[5], 'mixed');
      await settle(el);

      expect(calls[calls.length - 1].limit, 'the refresh keeps the expansion').to.equal(100);
      expect(el.shadowRoot!.querySelectorAll('.entry').length).to.equal(100);
      resetRefOpLocks();
    });

    it('starts a reopened dialog back at the first page', async () => {
      const calls: Array<{ limit?: number }> = [];
      mockReflogOfSize(120, calls);

      const el = await openDialog();
      showMore(el)!.click();
      await settle(el);
      expect(calls[calls.length - 1].limit, 'expanded before closing').to.equal(100);

      el.open = false;
      await el.updateComplete;
      el.open = true;
      await settle(el);

      expect(calls[calls.length - 1].limit, 'a new session starts fresh').to.equal(50);
      expect(el.shadowRoot!.querySelectorAll('.entry').length).to.equal(50);
    });
  });
});
