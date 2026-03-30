/**
 * Tests for operationInProgress guards in lv-tag-list.
 *
 * Verifies that async handlers (checkoutTag, deleteTag, pushTag)
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
import type { LvTagList } from '../lv-tag-list.ts';

// Import the actual component
import '../lv-tag-list.ts';

// ── Helpers ────────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

function makeTag(overrides: Partial<{
  name: string;
  targetOid: string;
  message: string | null;
  tagger: null;
  isAnnotated: boolean;
}> = {}) {
  return {
    name: overrides.name ?? 'v1.0.0',
    targetOid: overrides.targetOid ?? 'abc123',
    message: overrides.message ?? null,
    tagger: overrides.tagger ?? null,
    isAnnotated: overrides.isAnnotated ?? false,
  };
}

function defaultMockInvoke(command: string): Promise<unknown> {
  if (command === 'get_tags') {
    return Promise.resolve([]);
  }
  if (command === 'get_tag_sort_mode') {
    return Promise.resolve('name');
  }
  return Promise.resolve(null);
}

async function createComponent(): Promise<LvTagList> {
  mockInvoke = defaultMockInvoke;
  const el = await fixture<LvTagList>(
    html`<lv-tag-list .repositoryPath=${REPO_PATH}></lv-tag-list>`
  );
  await el.updateComplete;
  return el;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('lv-tag-list operationInProgress guards', () => {
  beforeEach(() => {
    invokeCalls.length = 0;
  });

  it('should have operationInProgress initially false', async () => {
    const el = await createComponent();
    expect((el as unknown as { operationInProgress: boolean }).operationInProgress).to.equal(false);
  });

  it('handleCheckoutTag should skip when operationInProgress is true', async () => {
    const el = await createComponent();

    const tag = makeTag({ name: 'v1.0.0' });
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; tag: typeof tag | null } }).contextMenu = {
      visible: true, x: 0, y: 0, tag,
    };
    (el as unknown as { operationInProgress: boolean }).operationInProgress = true;

    invokeCalls.length = 0;

    await (el as unknown as { handleCheckoutTag: () => Promise<void> }).handleCheckoutTag();

    const checkoutCalls = invokeCalls.filter(c => c.command === 'checkout_with_autostash');
    expect(checkoutCalls).to.have.length(0);
  });

  it('handleDeleteTag should skip when operationInProgress is true', async () => {
    const el = await createComponent();

    const tag = makeTag({ name: 'v2.0.0' });
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; tag: typeof tag | null } }).contextMenu = {
      visible: true, x: 0, y: 0, tag,
    };
    (el as unknown as { operationInProgress: boolean }).operationInProgress = true;

    invokeCalls.length = 0;

    await (el as unknown as { handleDeleteTag: () => Promise<void> }).handleDeleteTag();

    const deleteCalls = invokeCalls.filter(c => c.command === 'delete_tag');
    expect(deleteCalls).to.have.length(0);
  });

  it('handlePushTag should skip when operationInProgress is true', async () => {
    const el = await createComponent();

    const tag = makeTag({ name: 'v3.0.0' });
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; tag: typeof tag | null } }).contextMenu = {
      visible: true, x: 0, y: 0, tag,
    };
    (el as unknown as { operationInProgress: boolean }).operationInProgress = true;

    invokeCalls.length = 0;

    await (el as unknown as { handlePushTag: () => Promise<void> }).handlePushTag();

    const pushCalls = invokeCalls.filter(c => c.command === 'push_tag');
    expect(pushCalls).to.have.length(0);
  });

  it('handlePushTag should set and clear operationInProgress', async () => {
    const el = await createComponent();

    let resolvePush!: (v: unknown) => void;
    mockInvoke = (command: string) => {
      if (command === 'push_tag') {
        return new Promise((resolve) => { resolvePush = resolve; });
      }
      return defaultMockInvoke(command);
    };

    const tag = makeTag({ name: 'v4.0.0' });
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; tag: typeof tag | null } }).contextMenu = {
      visible: true, x: 0, y: 0, tag,
    };

    // Start push (won't resolve yet)
    const promise = (el as unknown as { handlePushTag: () => Promise<void> }).handlePushTag();

    // Should be in progress now
    expect((el as unknown as { operationInProgress: boolean }).operationInProgress).to.equal(true);

    // Resolve
    resolvePush({ success: true });
    await promise;

    // Should be cleared
    expect((el as unknown as { operationInProgress: boolean }).operationInProgress).to.equal(false);
  });

  it('handlePushTag should clear operationInProgress even on error', async () => {
    const el = await createComponent();

    mockInvoke = (command: string) => {
      if (command === 'push_tag') {
        return Promise.reject(new Error('push failed'));
      }
      return defaultMockInvoke(command);
    };

    const tag = makeTag({ name: 'v5.0.0' });
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; tag: typeof tag | null } }).contextMenu = {
      visible: true, x: 0, y: 0, tag,
    };

    try {
      await (el as unknown as { handlePushTag: () => Promise<void> }).handlePushTag();
    } catch {
      // expected
    }

    expect((el as unknown as { operationInProgress: boolean }).operationInProgress).to.equal(false);
  });
});
