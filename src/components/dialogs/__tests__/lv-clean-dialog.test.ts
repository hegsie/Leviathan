/**
 * Clean Dialog Tests
 *
 * Tests that the clean dialog shows error toasts on API failure.
 */

import { expect, fixture, html } from '@open-wc/testing';

let failingCommands: Set<string> = new Set();
let cleanableEntries: unknown[] = [];
let lastCleanFilesArgs: Record<string, unknown> | null = null;
// Controls the result of the app's showConfirm() dialog (plugin-dialog's
// confirm() routes through `plugin:dialog|message` and treats a truthy return
// as "confirmed").
let confirmResult = true;

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

const mockInvoke: MockInvoke = async (command: string, args?: unknown) => {
  if (command === 'plugin:notification|is_permission_granted') return false;

  if (
    command === 'plugin:dialog|message' ||
    command === 'plugin:dialog|confirm' ||
    command === 'plugin:dialog|ask'
  ) {
    // plugin-dialog's confirm() resolves true only when the command returns the
    // OK button label ('Ok'); anything else is treated as declined.
    return confirmResult ? 'Ok' : 'Cancel';
  }

  if (failingCommands.has(command)) {
    throw { code: 'COMMAND_ERROR', message: 'Permission denied' };
  }

  if (command === 'get_cleanable_files') {
    return cleanableEntries;
  }

  if (command === 'clean_files') {
    lastCleanFilesArgs = args as Record<string, unknown>;
    return (args as { paths?: unknown[] }).paths?.length ?? 1;
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
    cleanableEntries = [];
    lastCleanFilesArgs = null;
    confirmResult = true;
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

  // --- Finding 51: nested git repositories must be protected ---
  async function waitForEntries(el: LvCleanDialog): Promise<void> {
    for (let i = 0; i < 50; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (((el as any).entries as unknown[]).length > 0) return;
      await el.updateComplete;
      await new Promise(r => setTimeout(r, 0));
    }
  }

  it('does not pre-select untracked nested repositories', async () => {
    cleanableEntries = [
      { path: 'untracked.txt', isDirectory: false, isIgnored: false, isNestedRepo: false, size: 100 },
      { path: 'vendor/', isDirectory: true, isIgnored: false, isNestedRepo: true, size: null },
    ];

    const el = await fixture<LvCleanDialog>(
      html`<lv-clean-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-clean-dialog>`,
    );
    await waitForEntries(el);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const selected = (el as any).selectedPaths as Set<string>;
    expect(selected.has('untracked.txt')).to.be.true;
    expect(selected.has('vendor/')).to.be.false;
  });

  it('requires confirmation and passes forceNested when a nested repo is selected', async () => {
    cleanableEntries = [
      { path: 'vendor/', isDirectory: true, isIgnored: false, isNestedRepo: true, size: null },
    ];
    confirmResult = true;

    const el = await fixture<LvCleanDialog>(
      html`<lv-clean-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-clean-dialog>`,
    );
    await waitForEntries(el);

    // User explicitly opts into deleting the nested repo.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).selectedPaths = new Set(['vendor/']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleClean();

    expect(lastCleanFilesArgs).to.not.be.null;
    expect(lastCleanFilesArgs!.forceNested).to.be.true;
  });

  it('aborts the clean when the nested-repo confirmation is declined', async () => {
    cleanableEntries = [
      { path: 'vendor/', isDirectory: true, isIgnored: false, isNestedRepo: true, size: null },
    ];
    confirmResult = false;

    const el = await fixture<LvCleanDialog>(
      html`<lv-clean-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-clean-dialog>`,
    );
    await waitForEntries(el);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).selectedPaths = new Set(['vendor/']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleClean();

    // Declining must not invoke clean_files at all.
    expect(lastCleanFilesArgs).to.be.null;
    expect(el.open).to.be.true;
  });

  it('passes forceNested=false for ordinary (non-nested) selections', async () => {
    cleanableEntries = [
      { path: 'untracked.txt', isDirectory: false, isIgnored: false, isNestedRepo: false, size: 100 },
    ];

    const el = await fixture<LvCleanDialog>(
      html`<lv-clean-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-clean-dialog>`,
    );
    await waitForEntries(el);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleClean();

    expect(lastCleanFilesArgs).to.not.be.null;
    expect(lastCleanFilesArgs!.forceNested).to.be.false;
  });
});
