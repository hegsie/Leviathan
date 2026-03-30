/**
 * Tests for operationInProgress guards in lv-stash-list.
 *
 * Verifies that async handlers (createStash, applyStash, popStash, dropStash)
 * are protected against double-click / re-entry while an operation is
 * already in progress.
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

// Import the actual component
import '../lv-stash-list.ts';

// ── Helpers ────────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

function makeStash(overrides: Partial<{
  index: number;
  message: string;
  oid: string;
}> = {}) {
  return {
    index: overrides.index ?? 0,
    message: overrides.message ?? 'WIP on main',
    oid: overrides.oid ?? 'abc123',
  };
}

function defaultMockInvoke(command: string): Promise<unknown> {
  if (command === 'get_stashes') {
    return Promise.resolve([]);
  }
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

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-stash-list operationInProgress guards', () => {
  beforeEach(() => {
    invokeCalls.length = 0;
  });

  it('should have operationInProgress initially false', async () => {
    const el = await createComponent();
    expect((el as unknown as { operationInProgress: boolean }).operationInProgress).to.equal(false);
  });

  it('handleApplyStash should skip when operationInProgress is true', async () => {
    const el = await createComponent();

    const stash = makeStash({ index: 0 });
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; stash: typeof stash | null } }).contextMenu = {
      visible: true, x: 0, y: 0, stash,
    };
    (el as unknown as { operationInProgress: boolean }).operationInProgress = true;

    invokeCalls.length = 0;

    await (el as unknown as { handleApplyStash: () => Promise<void> }).handleApplyStash();

    const applyCalls = invokeCalls.filter(c => c.command === 'apply_stash');
    expect(applyCalls).to.have.length(0);
  });

  it('handlePopStash should skip when operationInProgress is true', async () => {
    const el = await createComponent();

    const stash = makeStash({ index: 1 });
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; stash: typeof stash | null } }).contextMenu = {
      visible: true, x: 0, y: 0, stash,
    };
    (el as unknown as { operationInProgress: boolean }).operationInProgress = true;

    invokeCalls.length = 0;

    await (el as unknown as { handlePopStash: () => Promise<void> }).handlePopStash();

    const popCalls = invokeCalls.filter(c => c.command === 'pop_stash');
    expect(popCalls).to.have.length(0);
  });

  it('handleDropStash should skip when operationInProgress is true', async () => {
    const el = await createComponent();

    const stash = makeStash({ index: 2 });
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; stash: typeof stash | null } }).contextMenu = {
      visible: true, x: 0, y: 0, stash,
    };
    (el as unknown as { operationInProgress: boolean }).operationInProgress = true;

    invokeCalls.length = 0;

    await (el as unknown as { handleDropStash: () => Promise<void> }).handleDropStash();

    const dropCalls = invokeCalls.filter(c => c.command === 'drop_stash');
    expect(dropCalls).to.have.length(0);
  });

  it('handleApplyStash should set and clear operationInProgress', async () => {
    const el = await createComponent();

    let resolveApply!: (v: unknown) => void;
    mockInvoke = (command: string) => {
      if (command === 'apply_stash') {
        return new Promise((resolve) => { resolveApply = resolve; });
      }
      return defaultMockInvoke(command);
    };

    const stash = makeStash({ index: 0 });
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; stash: typeof stash | null } }).contextMenu = {
      visible: true, x: 0, y: 0, stash,
    };

    // Start apply (won't resolve yet)
    const promise = (el as unknown as { handleApplyStash: () => Promise<void> }).handleApplyStash();

    // Should be in progress now
    expect((el as unknown as { operationInProgress: boolean }).operationInProgress).to.equal(true);

    // Resolve
    resolveApply({ success: true });
    await promise;

    // Should be cleared
    expect((el as unknown as { operationInProgress: boolean }).operationInProgress).to.equal(false);
  });

  it('handleApplyStash should clear operationInProgress even on error', async () => {
    const el = await createComponent();

    mockInvoke = (command: string) => {
      if (command === 'apply_stash') {
        return Promise.reject(new Error('apply failed'));
      }
      return defaultMockInvoke(command);
    };

    const stash = makeStash({ index: 0 });
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; stash: typeof stash | null } }).contextMenu = {
      visible: true, x: 0, y: 0, stash,
    };

    try {
      await (el as unknown as { handleApplyStash: () => Promise<void> }).handleApplyStash();
    } catch {
      // expected
    }

    expect((el as unknown as { operationInProgress: boolean }).operationInProgress).to.equal(false);
  });

  it('isStashing guard prevents double createStash', async () => {
    const el = await createComponent();

    // Set isStashing to true to simulate in-flight stash creation
    (el as unknown as { isStashing: boolean }).isStashing = true;

    invokeCalls.length = 0;

    await (el as unknown as { handleCreateStash: () => Promise<void> }).handleCreateStash();

    const createCalls = invokeCalls.filter(c => c.command === 'create_stash');
    expect(createCalls).to.have.length(0);
  });
});
