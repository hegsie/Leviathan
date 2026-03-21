/**
 * LFS Dialog Tests
 *
 * Tests that pull and prune operations dispatch lfs-changed events.
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
});
