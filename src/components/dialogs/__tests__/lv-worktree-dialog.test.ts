/**
 * Worktree Dialog Tests
 *
 * Tests lock/unlock operations dispatch worktrees-changed events
 * and show success messages.
 */

import { expect, fixture, html } from '@open-wc/testing';
import type { Worktree } from '../../../services/git.service.ts';

// Mock data
const mockWorktrees: Worktree[] = [
  {
    path: '/test/repo',
    headOid: 'abc123',
    branch: 'main',
    isMain: true,
    isLocked: false,
    lockReason: null,
    isBare: false,
    isPrunable: false,
  },
  {
    path: '/test/worktree-1',
    headOid: 'def456',
    branch: 'feature-1',
    isMain: false,
    isLocked: false,
    lockReason: null,
    isBare: false,
    isPrunable: false,
  },
];

const invokedCommands: string[] = [];
let failingCommands: Set<string> = new Set();

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

const mockInvoke: MockInvoke = async (command: string) => {
  invokedCommands.push(command);

  if (failingCommands.has(command)) {
    throw { code: 'COMMAND_ERROR', message: `Failed: ${command}` };
  }

  switch (command) {
    case 'get_worktrees':
      return mockWorktrees;
    case 'lock_worktree':
      return null;
    case 'unlock_worktree':
      return null;
    case 'add_worktree':
      return null;
    case 'remove_worktree':
      return null;
    case 'get_branches':
      return [];
    case 'plugin:notification|is_permission_granted':
      return false;
    default:
      return null;
  }
};

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

// Import the component AFTER setting up the mock
import '../lv-worktree-dialog.ts';
import type { LvWorktreeDialog } from '../lv-worktree-dialog.ts';

describe('lv-worktree-dialog', () => {
  beforeEach(() => {
    invokedCommands.length = 0;
    failingCommands = new Set();
  });

  it('renders when open', async () => {
    const el = await fixture<LvWorktreeDialog>(
      html`<lv-worktree-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-worktree-dialog>`,
    );

    const dialog = el.shadowRoot!.querySelector('.dialog');
    expect(dialog).to.not.be.null;
  });

  it('dispatches worktrees-changed on lock', async () => {
    const el = await fixture<LvWorktreeDialog>(
      html`<lv-worktree-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-worktree-dialog>`,
    );

    let eventFired = false;
    el.addEventListener('worktrees-changed', () => { eventFired = true; });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleLock(mockWorktrees[1]);

    expect(invokedCommands).to.include('lock_worktree');
    expect(eventFired).to.be.true;
  });

  it('shows success message on lock', async () => {
    const el = await fixture<LvWorktreeDialog>(
      html`<lv-worktree-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-worktree-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleLock(mockWorktrees[1]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).success).to.equal('Worktree locked successfully');
  });

  it('dispatches worktrees-changed on unlock', async () => {
    const el = await fixture<LvWorktreeDialog>(
      html`<lv-worktree-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-worktree-dialog>`,
    );

    let eventFired = false;
    el.addEventListener('worktrees-changed', () => { eventFired = true; });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleUnlock(mockWorktrees[1]);

    expect(invokedCommands).to.include('unlock_worktree');
    expect(eventFired).to.be.true;
  });

  it('shows success message on unlock', async () => {
    const el = await fixture<LvWorktreeDialog>(
      html`<lv-worktree-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-worktree-dialog>`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleUnlock(mockWorktrees[1]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).success).to.equal('Worktree unlocked successfully');
  });

  it('shows error on lock failure', async () => {
    failingCommands.add('lock_worktree');

    const el = await fixture<LvWorktreeDialog>(
      html`<lv-worktree-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-worktree-dialog>`,
    );

    let eventFired = false;
    el.addEventListener('worktrees-changed', () => { eventFired = true; });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleLock(mockWorktrees[1]);

    expect(eventFired).to.be.false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).error).to.include('Failed');
  });

  it('shows error on unlock failure', async () => {
    failingCommands.add('unlock_worktree');

    const el = await fixture<LvWorktreeDialog>(
      html`<lv-worktree-dialog ?open=${true} .repositoryPath=${'/test/repo'}></lv-worktree-dialog>`,
    );

    let eventFired = false;
    el.addEventListener('worktrees-changed', () => { eventFired = true; });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleUnlock(mockWorktrees[1]);

    expect(eventFired).to.be.false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).error).to.include('Failed');
  });
});
