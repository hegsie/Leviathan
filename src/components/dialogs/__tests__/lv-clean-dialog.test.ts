/**
 * Clean Dialog Tests
 *
 * Tests that the clean dialog shows error toasts on API failure.
 */

import { expect, fixture, html } from '@open-wc/testing';

let failingCommands: Set<string> = new Set();

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

const mockInvoke: MockInvoke = async (command: string) => {
  if (command === 'plugin:notification|is_permission_granted') return false;

  if (failingCommands.has(command)) {
    throw { code: 'COMMAND_ERROR', message: 'Permission denied' };
  }

  if (command === 'get_untracked_files') {
    return [
      { path: 'untracked.txt', size: 100, isDirectory: false },
    ];
  }

  if (command === 'clean_files') {
    return 1;
  }

  return null;
};

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

// Import AFTER setting up the mock
import '../lv-clean-dialog.ts';
import type { LvCleanDialog } from '../lv-clean-dialog.ts';
import { uiStore } from '../../../stores/ui.store.ts';

describe('lv-clean-dialog', () => {
  beforeEach(() => {
    failingCommands = new Set();
    const state = uiStore.getState();
    state.toasts.forEach(t => state.removeToast(t.id));
  });

  it('renders when open', async () => {
    const el = await fixture<LvCleanDialog>(
      html`<lv-clean-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-clean-dialog>`,
    );

    const dialog = el.shadowRoot!.querySelector('.dialog, .dialog-overlay');
    expect(dialog).to.not.be.null;
  });

  it('dispatches files-cleaned on success', async () => {
    const el = await fixture<LvCleanDialog>(
      html`<lv-clean-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-clean-dialog>`,
    );

    let eventFired = false;
    el.addEventListener('files-cleaned', () => { eventFired = true; });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).selectedPaths = new Set(['untracked.txt']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleClean();

    expect(eventFired).to.be.true;
  });

  it('shows error toast on API failure', async () => {
    failingCommands.add('clean_files');

    const el = await fixture<LvCleanDialog>(
      html`<lv-clean-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-clean-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).selectedPaths = new Set(['untracked.txt']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleClean();

    const toasts = uiStore.getState().toasts;
    const errorToast = toasts.find(t => t.type === 'error');
    expect(errorToast).to.not.be.undefined;
    expect(errorToast!.message).to.include('Permission denied');
  });
});
