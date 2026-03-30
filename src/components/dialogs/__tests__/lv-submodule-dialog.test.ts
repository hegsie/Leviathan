/**
 * Submodule Dialog Tests
 *
 * Tests toast notifications on success/error for submodule operations.
 */

import { expect, fixture, html } from '@open-wc/testing';
import type { Submodule } from '../../../services/git.service.ts';

const mockSubmodules: Submodule[] = [
  {
    name: 'lib/utils',
    path: 'lib/utils',
    url: 'https://github.com/test/utils.git',
    status: 'current',
    headOid: 'abc123',
    branch: 'main',
    initialized: true,
  },
];

let failingCommands: Set<string> = new Set();

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

const mockInvoke: MockInvoke = async (command: string) => {
  if (command === 'plugin:notification|is_permission_granted') return false;

  if (failingCommands.has(command)) {
    throw { code: 'COMMAND_ERROR', message: 'Operation failed' };
  }

  switch (command) {
    case 'get_submodules':
      return mockSubmodules;
    case 'add_submodule':
      return null;
    case 'init_submodules':
      return null;
    case 'update_submodules':
      return null;
    case 'remove_submodule':
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
import '../lv-submodule-dialog.ts';
import type { LvSubmoduleDialog } from '../lv-submodule-dialog.ts';
import { uiStore } from '../../../stores/ui.store.ts';

describe('lv-submodule-dialog', () => {
  beforeEach(() => {
    failingCommands = new Set();
    const state = uiStore.getState();
    state.toasts.forEach(t => state.removeToast(t.id));
  });

  it('renders when open', async () => {
    const el = await fixture<LvSubmoduleDialog>(
      html`<lv-submodule-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-submodule-dialog>`,
    );

    const dialog = el.shadowRoot!.querySelector('.dialog');
    expect(dialog).to.not.be.null;
  });

  it('shows success toast on add', async () => {
    const el = await fixture<LvSubmoduleDialog>(
      html`<lv-submodule-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-submodule-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).addUrl = 'https://github.com/test/new.git';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).addPath = 'lib/new';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleAdd();

    const toasts = uiStore.getState().toasts;
    const successToast = toasts.find(t => t.type === 'success');
    expect(successToast).to.not.be.undefined;
    expect(successToast!.message).to.include('Submodule added');
  });

  it('shows error toast on add failure', async () => {
    failingCommands.add('add_submodule');

    const el = await fixture<LvSubmoduleDialog>(
      html`<lv-submodule-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-submodule-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).addUrl = 'https://github.com/test/new.git';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).addPath = 'lib/new';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleAdd();

    const toasts = uiStore.getState().toasts;
    const errorToast = toasts.find(t => t.type === 'error');
    expect(errorToast).to.not.be.undefined;
    expect(errorToast!.message).to.include('Operation failed');
  });

  it('shows success toast on remove', async () => {
    const el = await fixture<LvSubmoduleDialog>(
      html`<lv-submodule-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-submodule-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleRemove(mockSubmodules[0]);

    const toasts = uiStore.getState().toasts;
    const successToast = toasts.find(t => t.type === 'success');
    expect(successToast).to.not.be.undefined;
    expect(successToast!.message).to.include('Submodule removed');
  });

  it('shows error toast on remove failure', async () => {
    failingCommands.add('remove_submodule');

    const el = await fixture<LvSubmoduleDialog>(
      html`<lv-submodule-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-submodule-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleRemove(mockSubmodules[0]);

    const toasts = uiStore.getState().toasts;
    const errorToast = toasts.find(t => t.type === 'error');
    expect(errorToast).to.not.be.undefined;
    expect(errorToast!.message).to.include('Operation failed');
  });

  it('shows success toast on update all', async () => {
    const el = await fixture<LvSubmoduleDialog>(
      html`<lv-submodule-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-submodule-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleUpdateAll();

    const toasts = uiStore.getState().toasts;
    const successToast = toasts.find(t => t.type === 'success');
    expect(successToast).to.not.be.undefined;
    expect(successToast!.message).to.include('All submodules updated');
  });

  it('shows error toast on update all failure', async () => {
    failingCommands.add('update_submodules');

    const el = await fixture<LvSubmoduleDialog>(
      html`<lv-submodule-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-submodule-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleUpdateAll();

    const toasts = uiStore.getState().toasts;
    const errorToast = toasts.find(t => t.type === 'error');
    expect(errorToast).to.not.be.undefined;
    expect(errorToast!.message).to.include('Operation failed');
  });

  it('shows error toast on init failure', async () => {
    failingCommands.add('init_submodules');

    const el = await fixture<LvSubmoduleDialog>(
      html`<lv-submodule-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-submodule-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleInit(mockSubmodules[0]);

    const toasts = uiStore.getState().toasts;
    const errorToast = toasts.find(t => t.type === 'error');
    expect(errorToast).to.not.be.undefined;
    expect(errorToast!.message).to.include('Operation failed');
  });

  it('shows error toast on single update failure', async () => {
    failingCommands.add('update_submodules');

    const el = await fixture<LvSubmoduleDialog>(
      html`<lv-submodule-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-submodule-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleUpdate(mockSubmodules[0]);

    const toasts = uiStore.getState().toasts;
    const errorToast = toasts.find(t => t.type === 'error');
    expect(errorToast).to.not.be.undefined;
    expect(errorToast!.message).to.include('Operation failed');
  });
});
