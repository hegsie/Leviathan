/**
 * Config Dialog Tests
 *
 * Tests success toasts on identity save, alias add/delete operations.
 */

import { expect, fixture, html, waitUntil } from '@open-wc/testing';

let failingCommands: Set<string> = new Set();

/**
 * Common settings the mocked backend reports. null means "this test does not
 * drive the Settings tab", so the component keeps whatever it was seeded with.
 */
let commonSettings: Array<{ key: string; value: string; scope: string }> | null = null;

/** Every command the component invoked, so tests can assert on the arguments. */
let invoked: Array<{ command: string; args?: unknown }> = [];

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

const mockInvoke: MockInvoke = async (command: string, args?: unknown) => {
  if (command === 'plugin:notification|is_permission_granted') return false;

  invoked.push({ command, args });

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
    case 'get_common_settings':
      return commonSettings;
    case 'unset_config_value':
      return null;
    case 'get_aliases':
      return [];
    case 'set_alias':
      return null;
    case 'delete_alias':
      return null;
    case 'set_config_value':
      return null;
    // plugin-dialog 2.7 routes confirm() through `message` and returns the
    // clicked button label; 'Ok' means the user confirmed.
    case 'plugin:dialog|message':
      return 'Ok';
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
    commonSettings = null;
    invoked = [];
    const state = uiStore.getState();
    state.toasts.forEach(t => state.removeToast(t.id));
  });

  /** Open the dialog on the Settings tab with the backend data already loaded. */
  async function openSettingsTab(): Promise<LvConfigDialog> {
    const el = await fixture<LvConfigDialog>(
      html`<lv-config-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-config-dialog>`,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await waitUntil(() => (el as any).loading === false, 'config data loaded');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).activeTab = 'settings';
    await el.updateComplete;
    return el;
  }

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

  it('shows success toast and updates in-memory value on setting save', async () => {
    const el = await fixture<LvConfigDialog>(
      html`<lv-config-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-config-dialog>`,
    );

    // Seed a setting so we can verify the in-memory value updates.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).settings = [{ key: 'core.editor', value: 'vim', scope: 'local' }];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleSaveSetting('core.editor', 'nano');

    const toasts = uiStore.getState().toasts;
    const successToast = toasts.find(t => t.type === 'success');
    expect(successToast).to.not.be.undefined;
    expect(successToast!.message).to.equal('Setting saved');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = (el as any).settings.find((s: { key: string }) => s.key === 'core.editor');
    expect(updated.value).to.equal('nano');
  });

  it('shows error and leaves value unchanged on setting save failure', async () => {
    failingCommands.add('set_config_value');

    const el = await fixture<LvConfigDialog>(
      html`<lv-config-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-config-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).settings = [{ key: 'core.editor', value: 'vim', scope: 'local' }];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleSaveSetting('core.editor', 'nano');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).error).to.not.be.null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setting = (el as any).settings.find((s: { key: string }) => s.key === 'core.editor');
    expect(setting.value).to.equal('vim');
  });

  it('renders a dropdown for a setting that is not configured yet', async () => {
    commonSettings = [{ key: 'pull.rebase', value: '', scope: 'unset' }];

    const el = await openSettingsTab();

    const item = el.shadowRoot!.querySelector('.setting-item')!;
    const select = item.querySelector<HTMLSelectElement>('.setting-value select');
    expect(select, 'an unset enumerated setting must still be editable').to.not.be.null;
    expect(select!.value).to.equal('');

    const options = [...select!.options].map(o => o.textContent!.trim());
    expect(options).to.include.members(['Not set', 'true', 'false', 'merges', 'interactive']);
    expect(item.querySelector('.scope-badge')!.textContent!.trim()).to.equal('not set');
  });

  it('renders a text input for an unconfigured free-form setting', async () => {
    commonSettings = [{ key: 'core.editor', value: '', scope: 'unset' }];

    const el = await openSettingsTab();

    const input = el.shadowRoot!.querySelector<HTMLInputElement>('.setting-value input');
    expect(input).to.not.be.null;
    expect(input!.value).to.equal('');
    expect(input!.placeholder).to.equal('Not set');
    expect(el.shadowRoot!.querySelector('.setting-value select')).to.be.null;
  });

  it('preselects the configured value in a dropdown', async () => {
    commonSettings = [{ key: 'pull.rebase', value: 'merges', scope: 'global' }];

    const el = await openSettingsTab();

    const select = el.shadowRoot!.querySelector<HTMLSelectElement>('.setting-value select');
    expect(select!.value).to.equal('merges');
    expect(el.shadowRoot!.querySelector('.scope-badge')!.textContent!.trim()).to.equal('global');
  });

  it('keeps a configured value outside the known set visible', async () => {
    commonSettings = [{ key: 'merge.ff', value: 'weird', scope: 'local' }];

    const el = await openSettingsTab();

    const select = el.shadowRoot!.querySelector<HTMLSelectElement>('.setting-value select');
    expect(select!.value).to.equal('weird');
    expect([...select!.options].map(o => o.value)).to.include('weird');
  });

  it('writes the chosen value when a dropdown changes', async () => {
    commonSettings = [{ key: 'pull.rebase', value: '', scope: 'unset' }];

    const el = await openSettingsTab();

    const select = el.shadowRoot!.querySelector<HTMLSelectElement>('.setting-value select')!;
    select.value = 'true';
    select.dispatchEvent(new Event('change'));

    await waitUntil(
      () => uiStore.getState().toasts.some(t => t.type === 'success'),
      'the save completed',
    );
    const call = invoked.find(i => i.command === 'set_config_value')!;
    expect(call.args).to.deep.equal({
      path: '/test/repo',
      key: 'pull.rebase',
      value: 'true',
      global: false,
    });

    const toasts = uiStore.getState().toasts;
    expect(toasts.find(t => t.type === 'success')!.message).to.equal('Setting saved');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = (el as any).settings.find((s: { key: string }) => s.key === 'pull.rebase');
    expect(updated.value).to.equal('true');
    expect(updated.scope).to.equal('local');
  });

  it('clears a setting through unset instead of writing an empty value', async () => {
    commonSettings = [{ key: 'push.default', value: 'simple', scope: 'local' }];

    const el = await openSettingsTab();

    // After the unset the backend reports the key as no longer configured.
    commonSettings = [{ key: 'push.default', value: '', scope: 'unset' }];

    const select = el.shadowRoot!.querySelector<HTMLSelectElement>('.setting-value select')!;
    select.value = '';
    select.dispatchEvent(new Event('change'));

    await waitUntil(
      () => uiStore.getState().toasts.some(t => t.type === 'success'),
      'the clear completed',
    );

    // The guard this test owns: an empty selection must never reach
    // set_config_value. `git config push.default ""` is accepted on write and
    // then makes every later git command in the repo die with
    // `fatal: bad config variable 'push.default'`.
    expect(
      invoked.filter(i => i.command === 'set_config_value'),
      'an emptied setting must not be written as an empty string',
    ).to.have.lengthOf(0);

    const unsetCall = invoked.find(i => i.command === 'unset_config_value');
    expect(unsetCall, 'clearing must go through unset_config_value').to.not.be.undefined;
    expect(unsetCall!.args).to.deep.equal({
      path: '/test/repo',
      key: 'push.default',
      global: false,
    });

    expect(uiStore.getState().toasts.find(t => t.type === 'success')!.message).to.equal(
      'Setting cleared',
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = (el as any).settings.find((s: { key: string }) => s.key === 'push.default');
    expect(updated.value).to.equal('');
    expect(updated.scope).to.equal('unset');

    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.scope-badge')!.textContent!.trim()).to.equal('not set');
  });

  it('shows the value uncovered from a broader scope after clearing', async () => {
    commonSettings = [{ key: 'pull.rebase', value: 'merges', scope: 'local' }];

    const el = await openSettingsTab();

    // Dropping the repository-scoped key uncovers the global one; the row must
    // show what git actually resolves now, not "not set".
    commonSettings = [{ key: 'pull.rebase', value: 'true', scope: 'global' }];

    const select = el.shadowRoot!.querySelector<HTMLSelectElement>('.setting-value select')!;
    select.value = '';
    select.dispatchEvent(new Event('change'));

    await waitUntil(
      () => uiStore.getState().toasts.some(t => t.type === 'success'),
      'the clear completed',
    );
    await el.updateComplete;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = (el as any).settings.find((s: { key: string }) => s.key === 'pull.rebase');
    expect(updated.value, 'the global value is now the effective one').to.equal('true');
    expect(updated.scope).to.equal('global');
    expect(el.shadowRoot!.querySelector('.scope-badge')!.textContent!.trim()).to.equal('global');
    expect(
      el.shadowRoot!.querySelector<HTMLSelectElement>('.setting-value select')!.value,
    ).to.equal('true');
  });

  it('clears a free-form setting when its input is emptied', async () => {
    commonSettings = [{ key: 'core.editor', value: 'vim', scope: 'local' }];

    const el = await openSettingsTab();

    commonSettings = [{ key: 'core.editor', value: '', scope: 'unset' }];

    const input = el.shadowRoot!.querySelector<HTMLInputElement>('.setting-value input')!;
    input.value = '';
    input.dispatchEvent(new Event('change'));

    await waitUntil(
      () => uiStore.getState().toasts.some(t => t.type === 'success'),
      'the clear completed',
    );

    expect(invoked.filter(i => i.command === 'set_config_value')).to.have.lengthOf(0);
    expect(invoked.find(i => i.command === 'unset_config_value')).to.not.be.undefined;
  });

  it('shows an error and keeps the value when clearing a setting fails', async () => {
    failingCommands.add('unset_config_value');
    commonSettings = [{ key: 'push.default', value: 'simple', scope: 'local' }];

    const el = await openSettingsTab();

    const select = el.shadowRoot!.querySelector<HTMLSelectElement>('.setting-value select')!;
    select.value = '';
    select.dispatchEvent(new Event('change'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await waitUntil(() => (el as any).error !== null, 'the failure surfaced');

    expect(uiStore.getState().toasts.filter(t => t.type === 'success')).to.have.lengthOf(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setting = (el as any).settings.find((s: { key: string }) => s.key === 'push.default');
    expect(setting.value, 'a failed clear must leave the row alone').to.equal('simple');
    expect(setting.scope).to.equal('local');
  });

  it('marks a saved setting as repository-scoped', async () => {
    const el = await fixture<LvConfigDialog>(
      html`<lv-config-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-config-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).settings = [{ key: 'push.default', value: 'current', scope: 'global' }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleSaveSetting('push.default', 'simple');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = (el as any).settings.find((s: { key: string }) => s.key === 'push.default');
    expect(updated.value).to.equal('simple');
    expect(updated.scope, 'the value now lives in this repository').to.equal('local');
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
