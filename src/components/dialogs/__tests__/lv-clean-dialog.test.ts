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
/** When set, clean_files reports this many removed instead of all requested. */
let partialCleanCount: number | null = null;

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
    // partialCleanCount simulates the backend skipping entries it cannot
    // remove, which it reports by returning a count lower than the request.
    if (partialCleanCount !== null) return partialCleanCount;
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
    partialCleanCount = null;
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

  it('toasts what was deleted on success', async () => {
    const el = await fixture<LvCleanDialog>(
      html`<lv-clean-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-clean-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).selectedPaths = new Set(['a.txt', 'b.txt']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleClean();

    const toast = uiStore.getState().toasts.find(t => t.type === 'success');
    expect(toast, 'success toast shown').to.not.be.undefined;
    expect(toast!.message).to.include('2');
  });

  it('warns when clean_files removed fewer items than were selected', async () => {
    // clean_files silently skips nested repos without force, directories with
    // tracked content, and locked files. The dialog closes immediately, so the
    // shortfall must be surfaced or the user assumes everything was deleted.
    cleanableEntries = [];
    const el = await fixture<LvCleanDialog>(
      html`<lv-clean-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-clean-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).selectedPaths = new Set(['a.txt', 'b.txt', 'c.txt']);
    // Backend reports only 1 of the 3 actually removed.
    partialCleanCount = 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleClean();
    partialCleanCount = null;

    const toast = uiStore.getState().toasts.find(t => t.type === 'warning');
    expect(toast, 'warning toast shown').to.not.be.undefined;
    expect(toast!.message).to.include('1 of 3');
    expect(toast!.message).to.include('2 could not be removed');
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

  // `repositoryPath` is live-bound to the ACTIVE repository and rebinds the
  // instant the user Ctrl+Tabs — a document-level shortcut this dialog's
  // overlay does not block. The listed files belong to the repo that was
  // active at OPEN, so the delete must target that repo. Pinning only at click
  // time (the previous fix) still deleted from the wrong repository whenever
  // the switch happened before the click. Untracked files have no trash and no
  // recovery path, so this is the one deletion in the app that cannot be undone.
  it('deletes from the repository the listed files were read from, not the newly active one', async () => {
    cleanableEntries = [
      { path: 'dist/', isDirectory: true, isIgnored: true, isNestedRepo: false, size: 100 },
    ];

    const el = await fixture<LvCleanDialog>(
      html`<lv-clean-dialog ?open=${true} .repositoryPath=${'/repo/a'}></lv-clean-dialog>`,
    );
    await waitForEntries(el);

    // The user Ctrl+Tabs to another repo; the dialog stays open showing A's files.
    el.repositoryPath = '/repo/b';
    await el.updateComplete;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleClean();

    expect(lastCleanFilesArgs).to.not.be.null;
    expect(lastCleanFilesArgs!.path).to.equal('/repo/a');
  });

  it('reads the file list from the repo active at open, ignoring a later rebind', async () => {
    cleanableEntries = [
      { path: 'a.txt', isDirectory: false, isIgnored: false, isNestedRepo: false, size: 1 },
    ];

    const el = await fixture<LvCleanDialog>(
      html`<lv-clean-dialog ?open=${true} .repositoryPath=${'/repo/a'}></lv-clean-dialog>`,
    );
    await waitForEntries(el);

    el.repositoryPath = '/repo/b';
    await el.updateComplete;
    await new Promise(r => setTimeout(r, 0));

    // A tab switch must not silently swap the list out from under the
    // selection the user already made.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(((el as any).entries as unknown[]).length).to.equal(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).pinnedRepositoryPathIfOpen).to.equal('/repo/a');
  });

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
