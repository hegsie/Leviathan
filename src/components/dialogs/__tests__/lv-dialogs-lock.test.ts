/**
 * Submodule, worktree and LFS dialogs must hold the SHARED locks.
 *
 * These three were missed by every lock sweep — none of them imported
 * `ref-lock.ts` or `maintenance-confirms.ts` — even though each reaches a
 * command that mutates state the rest of the app serializes on:
 *
 *   - `remove_submodule` runs `git submodule deinit -f` + `git rm -f`, which
 *     rewrite the SUPERPROJECT's index and working tree. While it ran, every
 *     branch row, Discard button and graph ref menu stayed live, and a
 *     checkout's auto-stash could capture a half-removed tree or die on
 *     `index.lock`.
 *   - `add_worktree -b` creates a branch and `remove_worktree` prunes shared
 *     worktree metadata — refs the sidebar branch list holds this lock for.
 *   - `lfs_prune` irreversibly deletes local LFS objects (its own confirm says
 *     objects that were never pushed cannot be recovered) yet was the one
 *     maintenance command that could run beside a `git gc`.
 *
 * Each case asserts BOTH halves: the control greys out on a lock taken by
 * another surface (which needs the subscription, not just the getter), and the
 * handler refuses without reaching the backend.
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
const invoked: string[] = [];

const mockInvoke: MockInvoke = async (command: string) => {
  invoked.push(command);
  if (command === 'plugin:notification|is_permission_granted') return false;
  if (
    command === 'plugin:dialog|message' ||
    command === 'plugin:dialog|confirm' ||
    command === 'plugin:dialog|ask'
  ) {
    return 'Ok';
  }
  switch (command) {
    case 'get_submodules':
      return [
        {
          name: 'lib/utils',
          path: 'lib/utils',
          url: 'https://example.test/utils.git',
          status: 'current',
          headOid: 'abc123',
          branch: 'main',
          initialized: true,
        },
      ];
    case 'get_worktrees':
      return [
        {
          path: '/test/repo',
          headOid: 'abc123',
          branch: 'main',
          isMain: true,
          isLocked: false,
          lockReason: null,
          isBare: false,
          isPrunable: false,
        },
        {
          path: '/test/worktree-1',
          headOid: 'def456',
          branch: 'feature-1',
          isMain: false,
          isLocked: false,
          lockReason: null,
          isBare: false,
          isPrunable: false,
        },
      ];
    case 'get_branches':
      return [];
    case 'get_lfs_status':
      return {
        installed: true,
        version: '3.0.0',
        enabled: true,
        patterns: [],
        fileCount: 0,
        totalSize: 0,
      };
    case 'get_lfs_files':
      return [];
    default:
      return null;
  }
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import '../lv-submodule-dialog.ts';
import '../lv-worktree-dialog.ts';
import '../lv-lfs-dialog.ts';
import { tryAcquireRefOp, releaseRefOp, resetRefOpLocks } from '../../../utils/ref-lock.ts';
import { resetMaintenanceLocks } from '../../../utils/maintenance-confirms.ts';

const REPO_PATH = '/test/repo';

interface Updatable extends HTMLElement {
  updateComplete: Promise<unknown>;
}

/** Wait for an async load to put `selector` in the shadow root. */
async function waitForRendered(el: Updatable, selector: string): Promise<Element> {
  for (let i = 0; i < 100; i++) {
    await el.updateComplete;
    const found = el.shadowRoot!.querySelector(selector);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`${selector} never rendered`);
}

/**
 * The control must track the lock with no further gesture — no reopening, no
 * re-render triggered by the test. Reading a getter is not enough: it calls
 * isRefOpRunning on every access and so reports the truth even with the
 * subscription deleted.
 */
async function expectDisabledTracksLock(
  el: Updatable,
  btn: HTMLButtonElement,
  what: string,
): Promise<void> {
  expect(btn.disabled, `${what}: enabled while the repo is idle`).to.equal(false);

  tryAcquireRefOp(REPO_PATH);
  await el.updateComplete;
  expect(btn.disabled, `${what}: a claim from another surface must disable it`).to.equal(true);

  releaseRefOp(REPO_PATH);
  await el.updateComplete;
  expect(btn.disabled, `${what}: the release must revive it`).to.equal(false);
}

describe('destructive dialogs hold the shared locks', () => {
  beforeEach(() => {
    resetMaintenanceLocks();
    resetRefOpLocks();
    invoked.length = 0;
  });

  afterEach(() => {
    resetMaintenanceLocks();
    resetRefOpLocks();
  });

  it('submodule Remove greys out and refuses while the working tree is locked', async () => {
    const el = await fixture<Updatable>(html`
      <lv-submodule-dialog .repositoryPath=${REPO_PATH} ?open=${true}></lv-submodule-dialog>
    `);
    const btn = (await waitForRendered(el, '.action-btn.danger')) as HTMLButtonElement;

    await expectDisabledTracksLock(el, btn, 'submodule Remove');

    // And the handler itself refuses, for the surfaces with no disabled state.
    tryAcquireRefOp(REPO_PATH);
    invoked.length = 0;
    await (
      el as unknown as { handleRemove: (s: { name: string; path: string }) => Promise<void> }
    ).handleRemove({ name: 'lib/utils', path: 'lib/utils' });
    expect(invoked, 'no confirm and no removal while another op holds the lock').to.not.include(
      'remove_submodule',
    );
    expect(invoked, 'the irreversible warning must not even be raised').to.not.include(
      'plugin:dialog|message',
    );
  });

  it('worktree Remove greys out and refuses while the working tree is locked', async () => {
    const el = await fixture<Updatable>(html`
      <lv-worktree-dialog .repositoryPath=${REPO_PATH} ?open=${true}></lv-worktree-dialog>
    `);
    await waitForRendered(el, '.action-btn.danger');
    // The FIRST danger button belongs to the main worktree, which is
    // permanently disabled (isMain); the removable one is the second.
    const btn = el.shadowRoot!.querySelectorAll('.action-btn.danger')[1] as HTMLButtonElement;
    expect(btn, 'a removable worktree row must be rendered').to.not.be.undefined;

    await expectDisabledTracksLock(el, btn, 'worktree Remove');

    tryAcquireRefOp(REPO_PATH);
    invoked.length = 0;
    await (
      el as unknown as {
        handleRemove: (w: { path: string; isMain: boolean }) => Promise<void>;
      }
    ).handleRemove({ path: '/test/worktree-1', isMain: false });
    expect(invoked, 'no removal while another op holds the lock').to.not.include('remove_worktree');
  });

  it('LFS Prune greys out and refuses while maintenance or the working tree is busy', async () => {
    const el = await fixture<Updatable>(html`
      <lv-lfs-dialog .repositoryPath=${REPO_PATH} ?open=${true}></lv-lfs-dialog>
    `);
    // The prune button is the only .actions button with the "Prune" label.
    const buttons = Array.from(
      (await waitForRendered(el, '.actions')).querySelectorAll('button'),
    ) as HTMLButtonElement[];
    const btn = buttons.find((b) => /Prune/i.test(b.textContent ?? ''));
    expect(btn, 'the Prune button must be rendered').to.not.be.undefined;

    await expectDisabledTracksLock(el, btn!, 'LFS Prune');

    tryAcquireRefOp(REPO_PATH);
    invoked.length = 0;
    await (el as unknown as { handlePrune: () => Promise<void> }).handlePrune();
    expect(invoked, 'no prune while another op holds the lock').to.not.include('lfs_prune');
    expect(invoked, 'the irreversible warning must not even be raised').to.not.include(
      'plugin:dialog|message',
    );
  });
});
