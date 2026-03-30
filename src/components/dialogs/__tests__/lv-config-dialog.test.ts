/**
 * Config Dialog Tests
 *
 * Tests success toasts on identity save, alias add/delete operations.
 */

import { expect, fixture, html } from '@open-wc/testing';

let failingCommands: Set<string> = new Set();

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

const mockInvoke: MockInvoke = async (command: string) => {
  if (command === 'plugin:notification|is_permission_granted') return false;

  if (failingCommands.has(command)) {
    throw { code: 'COMMAND_ERROR', message: 'Operation failed' };
  }

  switch (command) {
    case 'get_user_identity':
      return { name: 'Test User', email: 'test@example.com' };
    case 'set_user_identity':
      return null;
    case 'get_config_entries':
      return [];
    case 'get_aliases':
      return [];
    case 'set_alias':
      return null;
    case 'delete_alias':
      return null;
    case 'set_config_value':
      return null;
    case 'plugin:dialog|confirm':
      return true;
    default:
      return null;
  }
};

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

// Import AFTER setting up the mock
import '../lv-config-dialog.ts';
import type { LvConfigDialog } from '../lv-config-dialog.ts';
import { uiStore } from '../../../stores/ui.store.ts';

describe('lv-config-dialog', () => {
  beforeEach(() => {
    failingCommands = new Set();
    const state = uiStore.getState();
    state.toasts.forEach(t => state.removeToast(t.id));
  });

  it('renders when open', async () => {
    const el = await fixture<LvConfigDialog>(
      html`<lv-config-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-config-dialog>`,
    );

    const dialog = el.shadowRoot!.querySelector('.dialog, lv-modal');
    expect(dialog).to.not.be.null;
  });

  it('shows success toast on identity save', async () => {
    const el = await fixture<LvConfigDialog>(
      html`<lv-config-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-config-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).editName = 'New Name';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).editEmail = 'new@example.com';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleSaveIdentity();

    const toasts = uiStore.getState().toasts;
    const successToast = toasts.find(t => t.type === 'success');
    expect(successToast).to.not.be.undefined;
    expect(successToast!.message).to.equal('Identity saved');
  });

  it('shows error on identity save failure', async () => {
    failingCommands.add('set_user_identity');

    const el = await fixture<LvConfigDialog>(
      html`<lv-config-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-config-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).editName = 'New Name';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).editEmail = 'new@example.com';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleSaveIdentity();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).error).to.not.be.null;
  });

  it('shows success toast on alias add', async () => {
    const el = await fixture<LvConfigDialog>(
      html`<lv-config-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-config-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).newAliasName = 'co';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).newAliasCommand = 'checkout';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleAddAlias();

    const toasts = uiStore.getState().toasts;
    const successToast = toasts.find(t => t.type === 'success');
    expect(successToast).to.not.be.undefined;
    expect(successToast!.message).to.equal('Alias added');
  });

  it('shows success toast on alias delete', async () => {
    const el = await fixture<LvConfigDialog>(
      html`<lv-config-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-config-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleDeleteAlias({ name: 'co', command: 'checkout', isGlobal: false });

    const toasts = uiStore.getState().toasts;
    const successToast = toasts.find(t => t.type === 'success');
    expect(successToast).to.not.be.undefined;
    expect(successToast!.message).to.equal('Alias deleted');
  });
});
