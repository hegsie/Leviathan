/**
 * Git Hooks Dialog Tests
 *
 * Tests dialog rendering, hook loading, hook selection,
 * template functionality, save operations, and close events.
 */

import { expect, fixture, html } from '@open-wc/testing';
import type { GitHook } from '../../../services/git.service.ts';

// Mock hooks data
const mockHooks: GitHook[] = [
  {
    name: 'pre-commit',
    path: '/test/repo/.git/hooks/pre-commit',
    exists: true,
    enabled: true,
    content: '#!/bin/sh\necho "pre-commit"\n',
    description: 'Runs before a commit is made',
  },
  {
    name: 'commit-msg',
    path: '/test/repo/.git/hooks/commit-msg',
    exists: false,
    enabled: false,
    content: null,
    description: 'Validates commit message',
  },
  {
    name: 'pre-push',
    path: '/test/repo/.git/hooks/pre-push',
    exists: true,
    enabled: false,
    content: '#!/bin/sh\necho "pre-push"\n',
    description: 'Runs before a push',
  },
  {
    name: 'prepare-commit-msg',
    path: '/test/repo/.git/hooks/prepare-commit-msg',
    exists: false,
    enabled: false,
    content: null,
    description: 'Prepares commit message',
  },
  {
    name: 'post-commit',
    path: '/test/repo/.git/hooks/post-commit',
    exists: false,
    enabled: false,
    content: null,
    description: 'Runs after a commit',
  },
];

let lastInvokedCommand: string | null = null;
const invokeCalls: Array<{ command: string; args?: unknown }> = [];

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

const mockInvoke: MockInvoke = async (command: string, args?: unknown) => {
  lastInvokedCommand = command;
  invokeCalls.push({ command, args });
  const params = args as Record<string, unknown> | undefined;

  switch (command) {
    case 'get_hooks':
      return mockHooks;
    case 'get_hook': {
      const hookName = params?.hookName as string;
      const hook = mockHooks.find((h) => h.name === hookName);
      return hook ?? null;
    }
    case 'save_hook':
      return null;
    case 'delete_hook':
      return null;
    case 'toggle_hook':
      return null;
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
import '../lv-hooks-dialog.ts';
import type { LvHooksDialog } from '../lv-hooks-dialog.ts';

describe('lv-hooks-dialog', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
  });

  it('renders when open', async () => {
    const el = await fixture<LvHooksDialog>(
      html`<lv-hooks-dialog ?open=${true} .repoPath=${'/test/repo'}></lv-hooks-dialog>`,
    );

    const dialog = el.shadowRoot!.querySelector('.dialog');
    expect(dialog).to.not.be.null;

    const title = el.shadowRoot!.querySelector('.title');
    expect(title).to.not.be.null;
    expect(title!.textContent).to.include('Git Hooks');
  });

  it('does not render content when closed', async () => {
    const el = await fixture<LvHooksDialog>(
      html`<lv-hooks-dialog ?open=${false} .repoPath=${'/test/repo'}></lv-hooks-dialog>`,
    );

    // Host should be display:none when not open
    const computedStyle = getComputedStyle(el);
    expect(computedStyle.display).to.equal('none');
  });

  it('loads hooks on open', async () => {
    await fixture<LvHooksDialog>(
      html`<lv-hooks-dialog ?open=${true} .repoPath=${'/test/repo'}></lv-hooks-dialog>`,
    );

    // Wait for async loadHooks to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(lastInvokedCommand).to.equal('get_hooks');
  });

  it('displays hook list items', async () => {
    const el = await fixture<LvHooksDialog>(
      html`<lv-hooks-dialog ?open=${true} .repoPath=${'/test/repo'}></lv-hooks-dialog>`,
    );

    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    const hookItems = el.shadowRoot!.querySelectorAll('.hook-item');
    expect(hookItems.length).to.equal(mockHooks.length);
  });

  it('shows hook names in list', async () => {
    const el = await fixture<LvHooksDialog>(
      html`<lv-hooks-dialog ?open=${true} .repoPath=${'/test/repo'}></lv-hooks-dialog>`,
    );

    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    const hookNames = el.shadowRoot!.querySelectorAll('.hook-item-name');
    expect(hookNames.length).to.be.greaterThan(0);
    expect(hookNames[0].textContent).to.equal('pre-commit');
  });

  it('shows status dots for hooks', async () => {
    const el = await fixture<LvHooksDialog>(
      html`<lv-hooks-dialog ?open=${true} .repoPath=${'/test/repo'}></lv-hooks-dialog>`,
    );

    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    const enabledDots = el.shadowRoot!.querySelectorAll('.hook-status-dot.exists-enabled');
    const disabledDots = el.shadowRoot!.querySelectorAll('.hook-status-dot.exists-disabled');
    const notExistsDots = el.shadowRoot!.querySelectorAll('.hook-status-dot.not-exists');

    expect(enabledDots.length).to.equal(1); // pre-commit
    expect(disabledDots.length).to.equal(1); // pre-push
    expect(notExistsDots.length).to.equal(3); // commit-msg, prepare-commit-msg, post-commit
  });

  it('shows editor empty state when no hook is selected', async () => {
    const el = await fixture<LvHooksDialog>(
      html`<lv-hooks-dialog ?open=${true} .repoPath=${'/test/repo'}></lv-hooks-dialog>`,
    );

    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    const emptyState = el.shadowRoot!.querySelector('.editor-empty');
    expect(emptyState).to.not.be.null;
    expect(emptyState!.textContent).to.include('Select a hook');
  });

  it('shows template bar for hooks with templates', async () => {
    const el = await fixture<LvHooksDialog>(
      html`<lv-hooks-dialog ?open=${true} .repoPath=${'/test/repo'}></lv-hooks-dialog>`,
    );

    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    // Click on pre-commit hook (has a template)
    const hookItems = el.shadowRoot!.querySelectorAll('.hook-item');
    (hookItems[0] as HTMLElement).click();

    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    const templateBar = el.shadowRoot!.querySelector('.template-bar');
    expect(templateBar).to.not.be.null;

    const templateBtn = el.shadowRoot!.querySelector('.template-btn');
    expect(templateBtn).to.not.be.null;
    expect(templateBtn!.textContent).to.include('Use template');
  });

  it('does not show template bar for hooks without templates', async () => {
    const el = await fixture<LvHooksDialog>(
      html`<lv-hooks-dialog ?open=${true} .repoPath=${'/test/repo'}></lv-hooks-dialog>`,
    );

    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    // Click on post-commit hook (no template)
    const hookItems = el.shadowRoot!.querySelectorAll('.hook-item');
    const postCommitItem = Array.from(hookItems).find(
      (item) => item.querySelector('.hook-item-name')?.textContent === 'post-commit',
    );
    expect(postCommitItem).to.not.be.null;
    (postCommitItem as HTMLElement).click();

    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    const templateBar = el.shadowRoot!.querySelector('.template-bar');
    expect(templateBar).to.be.null;
  });

  it('shows close button and footer', async () => {
    const el = await fixture<LvHooksDialog>(
      html`<lv-hooks-dialog ?open=${true} .repoPath=${'/test/repo'}></lv-hooks-dialog>`,
    );

    const closeBtn = el.shadowRoot!.querySelector('.close-btn');
    expect(closeBtn).to.not.be.null;

    const footer = el.shadowRoot!.querySelector('.footer');
    expect(footer).to.not.be.null;
  });

  it('dispatches close event when close button is clicked', async () => {
    const el = await fixture<LvHooksDialog>(
      html`<lv-hooks-dialog ?open=${true} .repoPath=${'/test/repo'}></lv-hooks-dialog>`,
    );

    let closeDispatched = false;
    el.addEventListener('close', () => {
      closeDispatched = true;
    });

    const closeBtn = el.shadowRoot!.querySelector('.close-btn') as HTMLButtonElement;
    closeBtn.click();

    expect(closeDispatched).to.be.true;
  });

  it('shows active hook count', async () => {
    const el = await fixture<LvHooksDialog>(
      html`<lv-hooks-dialog ?open=${true} .repoPath=${'/test/repo'}></lv-hooks-dialog>`,
    );

    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    const hookCount = el.shadowRoot!.querySelector('.hook-count');
    expect(hookCount).to.not.be.null;
    expect(hookCount!.textContent).to.include('1 active'); // only pre-commit is enabled
  });

  it('shows save button when hook is selected', async () => {
    const el = await fixture<LvHooksDialog>(
      html`<lv-hooks-dialog ?open=${true} .repoPath=${'/test/repo'}></lv-hooks-dialog>`,
    );

    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    // Click first hook
    const hookItems = el.shadowRoot!.querySelectorAll('.hook-item');
    (hookItems[0] as HTMLElement).click();

    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    const saveBtn = el.shadowRoot!.querySelector('.btn-primary');
    expect(saveBtn).to.not.be.null;
  });

  // `repoPath` is live-bound to the ACTIVE repository and rebinds on a
  // Ctrl+Tab this dialog's overlay does not block. The hook list on screen
  // belongs to the repo active at open, so saving or deleting must target THAT
  // repo — .git/hooks is untracked, so a wrong-repo delete is unrecoverable.
  it('saves to the repository the hook list was read from, not the newly active one', async () => {
    const el = await fixture<LvHooksDialog>(
      html`<lv-hooks-dialog ?open=${true} .repoPath=${'/repo/a'}></lv-hooks-dialog>`,
    );
    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    (el.shadowRoot!.querySelectorAll('.hook-item')[0] as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    // The user Ctrl+Tabs; the dialog stays open showing repo A's hooks.
    el.repoPath = '/repo/b';
    await el.updateComplete;

    invokeCalls.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleSave();

    const save = invokeCalls.find((c) => c.command === 'save_hook');
    expect(save, 'save_hook issued').to.not.be.undefined;
    expect((save!.args as { path: string }).path).to.equal('/repo/a');
  });

  it('deletes from the repository the hook list was read from', async () => {
    const el = await fixture<LvHooksDialog>(
      html`<lv-hooks-dialog ?open=${true} .repoPath=${'/repo/a'}></lv-hooks-dialog>`,
    );
    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;

    el.repoPath = '/repo/b';
    await el.updateComplete;

    invokeCalls.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).confirmingDelete = 'pre-commit';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).confirmDelete();

    const del = invokeCalls.find((c) => c.command === 'delete_hook');
    expect(del, 'delete_hook issued').to.not.be.undefined;
    expect((del!.args as { path: string }).path).to.equal('/repo/a');
  });
});
