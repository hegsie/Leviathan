/**
 * Tests for user feedback in lv-tag-list.
 *
 * - handleCheckoutTag failure must show the backend error message, not
 *   "[object Object]" (result.error is a CommandError object).
 * - handlePushTag success must show a confirmation toast.
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
import type { LvTagList } from '../lv-tag-list.ts';
import '../lv-tag-list.ts';
import { uiStore } from '../../../stores/ui.store.ts';

// ── Helpers ────────────────────────────────────────────────────────────────
const REPO_PATH = '/test/repo';

function makeTag(name = 'v1.0.0') {
  return { name, targetOid: 'abc123', message: null, tagger: null, isAnnotated: false };
}

function defaultMockInvoke(command: string): Promise<unknown> {
  if (command === 'get_tags') return Promise.resolve([]);
  if (command === 'get_tag_sort_mode') return Promise.resolve('name');
  // Confirmation dialogs return the clicked button label; 'Ok' = confirmed.
  if (command === 'plugin:dialog|message') return Promise.resolve('Ok');
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
describe('lv-tag-list feedback', () => {
  beforeEach(() => {
    const state = uiStore.getState();
    state.toasts.forEach(t => state.removeToast(t.id));
  });

  it('handleCheckoutTag failure shows the backend message, not [object Object]', async () => {
    const el = await createComponent();

    mockInvoke = (command: string) => {
      if (command === 'checkout_with_autostash') {
        return Promise.reject({ code: 'CHECKOUT_ERROR', message: 'Local changes would be overwritten' });
      }
      return defaultMockInvoke(command);
    };

    const tag = makeTag('v1.0.0');
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; tag: typeof tag | null } }).contextMenu = {
      visible: true, x: 0, y: 0, tag,
    };

    await (el as unknown as { handleCheckoutTag: () => Promise<void> }).handleCheckoutTag();

    const errorToast = uiStore.getState().toasts.find(t => t.type === 'error');
    expect(errorToast, 'an error toast should be shown').to.not.be.undefined;
    expect(errorToast!.message).to.contain('Local changes would be overwritten');
    expect(errorToast!.message).to.not.contain('[object Object]');
  });

  it('handlePushTag success shows a confirmation toast', async () => {
    const el = await createComponent();

    mockInvoke = (command: string) => {
      if (command === 'push_tag') return Promise.resolve(null);
      return defaultMockInvoke(command);
    };

    const tag = makeTag('v2.0.0');
    (el as unknown as { contextMenu: { visible: boolean; x: number; y: number; tag: typeof tag | null } }).contextMenu = {
      visible: true, x: 0, y: 0, tag,
    };

    await (el as unknown as { handlePushTag: () => Promise<void> }).handlePushTag();

    const successToast = uiStore.getState().toasts.find(t => t.type === 'success');
    expect(successToast, 'a success toast should be shown').to.not.be.undefined;
    expect(successToast!.message).to.equal('Pushed tag v2.0.0 to remote');
  });
});
