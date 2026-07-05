/**
 * Tests for lv-stash-list conflict handling.
 *
 * When a stash apply/pop fails with a merge conflict, the component must open
 * the conflict resolution dialog (open-conflict-dialog) with the correct stash
 * index and drop-on-complete semantics:
 *   - apply (dropAfter false)  -> dropStashOnComplete: false (keep the stash)
 *   - pop   (drop after apply) -> dropStashOnComplete: true  (drop once resolved)
 * A non-conflict failure must NOT open the dialog (only a toast).
 */

// ── Tauri mock (must be set before any imports) ────────────────────────────
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let cbId = 0;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
const invokeCalls: Array<{ command: string; args?: unknown }> = [];

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokeCalls.push({ command, args });
    return mockInvoke(command, args);
  },
  transformCallback: () => cbId++,
};

// ── Imports (after Tauri mock) ─────────────────────────────────────────────
import { expect, fixture, html } from '@open-wc/testing';
import type { LvStashList } from '../lv-stash-list.ts';
import '../lv-stash-list.ts';

// ── Helpers ────────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

function makeStash(index: number) {
  return { index, message: `WIP on main ${index}`, oid: `oid${index}` };
}

function defaultMockInvoke(command: string): Promise<unknown> {
  if (command === 'get_stashes') return Promise.resolve([]);
  // Tauri confirm() dialogs resolve via plugin:dialog|message; a truthy value =
  // confirmed.
  if (command === 'plugin:dialog|message') return Promise.resolve('Ok');
  return Promise.resolve(null);
}

async function createComponent(): Promise<LvStashList> {
  mockInvoke = defaultMockInvoke;
  const el = await fixture<LvStashList>(
    html`<lv-stash-list .repositoryPath=${REPO_PATH}></lv-stash-list>`
  );
  await el.updateComplete;
  return el;
}

interface ConflictDetail {
  operationType: string;
  stashIndex: number;
  dropStashOnComplete: boolean;
}

function listenForConflict(el: LvStashList): { detail: ConflictDetail | null } {
  const captured: { detail: ConflictDetail | null } = { detail: null };
  el.addEventListener('open-conflict-dialog', (e) => {
    captured.detail = (e as CustomEvent<ConflictDetail>).detail;
  });
  return captured;
}

function setContextMenu(el: LvStashList, stash: ReturnType<typeof makeStash>): void {
  (el as unknown as { contextMenu: unknown }).contextMenu = {
    visible: true, x: 0, y: 0, stash,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-stash-list conflict handling', () => {
  beforeEach(() => {
    invokeCalls.length = 0;
  });

  it('apply conflict opens the dialog with dropStashOnComplete=false and the stash index', async () => {
    const el = await createComponent();
    setContextMenu(el, makeStash(2));
    const captured = listenForConflict(el);

    mockInvoke = (command: string) => {
      if (command === 'apply_stash') {
        return Promise.reject({ code: 'STASH_CONFLICT', message: 'Stash apply resulted in conflicts' });
      }
      return defaultMockInvoke(command);
    };

    await (el as unknown as { handleApplyStash: () => Promise<void> }).handleApplyStash();

    expect(captured.detail, 'open-conflict-dialog dispatched').to.not.be.null;
    expect(captured.detail!.operationType).to.equal('stash');
    expect(captured.detail!.stashIndex).to.equal(2);
    expect(captured.detail!.dropStashOnComplete).to.be.false;
  });

  it('pop conflict opens the dialog with dropStashOnComplete=true and the stash index', async () => {
    const el = await createComponent();
    setContextMenu(el, makeStash(1));
    const captured = listenForConflict(el);

    mockInvoke = (command: string) => {
      if (command === 'pop_stash') {
        return Promise.reject({ code: 'STASH_CONFLICT', message: 'Conflicts while popping stash' });
      }
      return defaultMockInvoke(command);
    };

    await (el as unknown as { handlePopStash: () => Promise<void> }).handlePopStash();

    expect(captured.detail, 'open-conflict-dialog dispatched').to.not.be.null;
    expect(captured.detail!.operationType).to.equal('stash');
    expect(captured.detail!.stashIndex).to.equal(1);
    expect(captured.detail!.dropStashOnComplete).to.be.true;
  });

  it('opens the dialog off the MERGE_CONFLICT error code even when the message lacks "conflict"', async () => {
    const el = await createComponent();
    setContextMenu(el, makeStash(3));
    const captured = listenForConflict(el);

    mockInvoke = (command: string) => {
      if (command === 'pop_stash') {
        // Message intentionally omits the word "conflict" — must key off code.
        return Promise.reject({ code: 'MERGE_CONFLICT', message: 'Resolution required' });
      }
      return defaultMockInvoke(command);
    };

    await (el as unknown as { handlePopStash: () => Promise<void> }).handlePopStash();

    expect(captured.detail, 'open-conflict-dialog dispatched via error code').to.not.be.null;
    expect(captured.detail!.operationType).to.equal('stash');
    expect(captured.detail!.stashIndex).to.equal(3);
    expect(captured.detail!.dropStashOnComplete).to.be.true;
  });

  it('a non-conflict apply failure does NOT open the dialog', async () => {
    const el = await createComponent();
    setContextMenu(el, makeStash(0));
    const captured = listenForConflict(el);

    mockInvoke = (command: string) => {
      if (command === 'apply_stash') {
        return Promise.reject({ code: 'STASH_ERROR', message: 'no such stash' });
      }
      return defaultMockInvoke(command);
    };

    await (el as unknown as { handleApplyStash: () => Promise<void> }).handleApplyStash();

    expect(captured.detail, 'no conflict dialog for non-conflict error').to.be.null;
  });
});
