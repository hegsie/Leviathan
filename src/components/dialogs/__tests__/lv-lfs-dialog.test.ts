/**
 * LFS Dialog Tests
 *
 * Tests that pull and prune operations dispatch lfs-changed events.
 */

import { expect, fixture, html } from '@open-wc/testing';

let failingCommands: Set<string> = new Set();
/** Result of the app's showConfirm(); prune is gated behind it. */
let confirmResult = true;

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

const mockInvoke: MockInvoke = async (command: string) => {
  if (command === 'plugin:notification|is_permission_granted') return false;

  if (
    command === 'plugin:dialog|message' ||
    command === 'plugin:dialog|confirm' ||
    command === 'plugin:dialog|ask'
  ) {
    // plugin-dialog's confirm() resolves true only for the OK button label.
    return confirmResult ? 'Ok' : 'Cancel';
  }

  if (failingCommands.has(command)) {
    throw { code: 'COMMAND_ERROR', message: 'Operation failed' };
  }

  switch (command) {
    case 'lfs_status':
      return { installed: true, initialized: true, patterns: [], version: '3.0.0' };
    case 'lfs_files':
      return [];
    case 'lfs_pull':
      return null;
    case 'lfs_prune':
      return 'Pruned 5 files';
    case 'lfs_init':
      return null;
    case 'lfs_track':
      return null;
    case 'lfs_untrack':
      return null;
    default:
      return null;
  }
};

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

// Import AFTER setting up the mock
import '../lv-lfs-dialog.ts';
import type { LvLfsDialog } from '../lv-lfs-dialog.ts';

describe('lv-lfs-dialog', () => {
  beforeEach(() => {
    failingCommands = new Set();
    confirmResult = true;
  });

  it('renders when open', async () => {
    const el = await fixture<LvLfsDialog>(
      html`<lv-lfs-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-lfs-dialog>`,
    );

    expect(el.shadowRoot!.querySelector('.dialog')).to.not.be.null;
  });

  it('dispatches lfs-changed on init', async () => {
    const el = await fixture<LvLfsDialog>(
      html`<lv-lfs-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-lfs-dialog>`,
    );

    let eventFired = false;
    el.addEventListener('lfs-changed', () => { eventFired = true; });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleInit();

    expect(eventFired).to.be.true;
  });

  it('dispatches lfs-changed on pull', async () => {
    const el = await fixture<LvLfsDialog>(
      html`<lv-lfs-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-lfs-dialog>`,
    );

    let eventFired = false;
    el.addEventListener('lfs-changed', () => { eventFired = true; });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handlePull();

    expect(eventFired).to.be.true;
  });

  it('dispatches lfs-changed on prune', async () => {
    const el = await fixture<LvLfsDialog>(
      html`<lv-lfs-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-lfs-dialog>`,
    );

    let eventFired = false;
    el.addEventListener('lfs-changed', () => { eventFired = true; });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handlePrune();

    expect(eventFired).to.be.true;
  });

  it('does not prune when the confirm is declined', async () => {
    // `git lfs prune` deletes local LFS objects; blobs from a commit that was
    // never pushed have no copy anywhere else.
    confirmResult = false;

    const el = await fixture<LvLfsDialog>(
      html`<lv-lfs-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-lfs-dialog>`,
    );

    let eventFired = false;
    el.addEventListener('lfs-changed', () => { eventFired = true; });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handlePrune();

    expect(eventFired, 'declining must not prune').to.be.false;
  });

  it('does not dispatch lfs-changed on pull failure', async () => {
    failingCommands.add('lfs_pull');

    const el = await fixture<LvLfsDialog>(
      html`<lv-lfs-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-lfs-dialog>`,
    );

    let eventFired = false;
    el.addEventListener('lfs-changed', () => { eventFired = true; });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handlePull();

    expect(eventFired).to.be.false;
  });

  it('does not dispatch lfs-changed on prune failure', async () => {
    failingCommands.add('lfs_prune');

    const el = await fixture<LvLfsDialog>(
      html`<lv-lfs-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-lfs-dialog>`,
    );

    let eventFired = false;
    el.addEventListener('lfs-changed', () => { eventFired = true; });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handlePrune();

    expect(eventFired).to.be.false;
  });

  describe('successful operations tell the user they happened', () => {
    it('Track names the pattern it added', async () => {
      // Init, Pull and Prune in this same dialog all report; Track and Untrack
      // did not, and the pattern list is long enough that a row appearing or
      // vanishing is not by itself a signal.
      const el = await fixture<LvLfsDialog>(
        html`<lv-lfs-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-lfs-dialog>`,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).newPattern = '*.psd';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleTrack();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).success, 'named, and not blanked by the input clear').to.contain('*.psd');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).newPattern, 'the input is still cleared').to.equal('');
    });

    it('Untrack names the pattern it removed', async () => {
      const el = await fixture<LvLfsDialog>(
        html`<lv-lfs-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-lfs-dialog>`,
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).handleUntrack('*.bin');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((el as any).success).to.contain('*.bin');
    });
  });
});
