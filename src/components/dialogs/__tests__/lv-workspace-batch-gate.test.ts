/**
 * Batch Fetch All / Pull All against the network security gate.
 *
 * A gate refusal is not a failure. With offline mode on, an 8-repo workspace
 * counted all eight refusals as failures and reported "0 succeeded, 8 failed"
 * for operations that were never attempted — the same "report the user's own
 * settings back as an error" pattern fixed elsewhere, missed on this surface.
 */

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
const invoked: Array<{ command: string; args?: unknown }> = [];
let failCommands = new Set<string>();
let failureFor: Map<string, { code: string; message: string }> = new Map();
/** confirm() resolves to (message-dialog result === okLabel); the default is 'Ok'. */
let confirmAnswer = 'Cancel';
const dialogMessages: string[] = [];

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invoked.push({ command, args });
    if (command === 'plugin:dialog|message') {
      dialogMessages.push(String((args as { message?: string })?.message ?? ''));
      return Promise.resolve(confirmAnswer);
    }
    const specific = failureFor.get(command);
    if (specific) return Promise.reject(specific);
    if (failCommands.has(command)) {
      return Promise.reject({ code: 'COMMAND_ERROR', message: 'remote hung up' });
    }
    if (command === 'get_workspaces') return Promise.resolve([]);
    return Promise.resolve(null);
  },
  transformCallback: () => 0,
};

import { expect, fixture, html } from '@open-wc/testing';
import '../lv-workspace-manager-dialog.ts';
import type { LvWorkspaceManagerDialog } from '../lv-workspace-manager-dialog.ts';
import { settingsStore } from '../../../stores/settings.store.ts';
import { uiStore } from '../../../stores/index.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

const WORKSPACE = {
  id: 'ws1',
  name: 'Team',
  repositories: [
    { path: '/repo/one', name: 'one' },
    { path: '/repo/two', name: 'two' },
    { path: '/repo/three', name: 'three' },
  ],
};

async function dialogWithWorkspace(): Promise<LvWorkspaceManagerDialog> {
  const el = await fixture<LvWorkspaceManagerDialog>(
    html`<lv-workspace-manager-dialog ?open=${true}></lv-workspace-manager-dialog>`,
  );
  await el.updateComplete;
  (el as any).workspaces = [WORKSPACE];
  (el as any).selectedWorkspaceId = 'ws1';
  await el.updateComplete;
  return el;
}

describe('deleting a workspace', () => {
  beforeEach(() => {
    invoked.length = 0;
    failCommands = new Set();
    failureFor = new Map();
    uiStore.setState({ toasts: [] });
  });

  it('asks first, and declining leaves the workspace alone', async () => {
    // The footer's single Delete button permanently drops a saved multi-repo
    // configuration with no undo. The profile manager — the sibling dialog
    // managing the same kind of object — has always confirmed; this one didn't.
    const el = await dialogWithWorkspace();
    confirmAnswer = 'Cancel';

    await (el as any).handleDelete();

    expect(invoked.some((c) => c.command === 'delete_workspace')).to.equal(false);
  });

  it('names the workspace and how much is in it', async () => {
    const el = await dialogWithWorkspace();
    confirmAnswer = 'Cancel';
    dialogMessages.length = 0;

    await (el as any).handleDelete();

    const prompt = dialogMessages.join(' ');
    expect(prompt).to.contain('Team');
    expect(prompt, 'the repository count is stated').to.contain('3');
    expect(prompt, 'and that the repos on disk survive').to.contain('not touched');
  });

  it('confirming deletes it and says so', async () => {
    const el = await dialogWithWorkspace();
    confirmAnswer = 'Ok';
    uiStore.setState({ toasts: [] });

    await (el as any).handleDelete();

    expect(invoked.some((c) => c.command === 'delete_workspace')).to.equal(true);
    const summary = uiStore.getState().toasts.map((t) => `${t.type}:${t.message}`).join(' | ');
    expect(summary).to.contain('success:Deleted workspace Team');
  });
});

describe('workspace batch operations and the security gate', () => {
  beforeEach(() => {
    invoked.length = 0;
    failCommands = new Set();
    failureFor = new Map();
    uiStore.setState({ toasts: [] });
    settingsStore.setState({ offlineMode: false, confirmNetworkOps: false, remoteAllowlist: [] });
  });

  afterEach(() => {
    settingsStore.setState({ offlineMode: false, confirmNetworkOps: false, remoteAllowlist: [] });
  });

  it('offline mode reports repos as skipped, not failed', async () => {
    const el = await dialogWithWorkspace();
    settingsStore.setState({ offlineMode: true });
    uiStore.setState({ toasts: [] });

    await (el as any).handleFetchAll();

    const summary = uiStore.getState().toasts.map((t) => t.message).join(' | ');
    expect(summary, 'nothing was attempted, so nothing failed').to.not.contain('failed');
    expect(summary).to.contain('skipped by security settings');
    expect(invoked.some((c) => c.command === 'fetch'), 'no fetch reached the backend').to.equal(
      false,
    );
  });

  it('a real failure is still reported as a failure', async () => {
    const el = await dialogWithWorkspace();
    failCommands = new Set(['fetch']);
    uiStore.setState({ toasts: [] });

    await (el as any).handleFetchAll();

    const summary = uiStore.getState().toasts.map((t) => t.message).join(' | ');
    expect(summary).to.contain('failed');
    expect(summary).to.not.contain('skipped');
  });

  it('pull all separates skipped from failed the same way', async () => {
    const el = await dialogWithWorkspace();
    settingsStore.setState({ offlineMode: true });
    uiStore.setState({ toasts: [] });

    await (el as any).handlePullAll();

    const summary = uiStore.getState().toasts.map((t) => t.message).join(' | ');
    expect(summary).to.not.contain('failed');
    expect(summary).to.contain('skipped by security settings');
  });

  it('a clean run still reports plain success', async () => {
    const el = await dialogWithWorkspace();
    uiStore.setState({ toasts: [] });

    await (el as any).handleFetchAll();

    const summary = uiStore.getState().toasts.map((t) => t.message).join(' | ');
    expect(summary).to.contain('succeeded');
    expect(summary).to.not.contain('failed');
    expect(summary).to.not.contain('skipped');
  });

  it('a repo left mid-merge is reported as conflicted, not as failed', async () => {
    // The pull LANDED — the repo has a conflicted index and MERGE_HEAD. Calling
    // that "failed" tells the user nothing happened there, which is the one
    // reading that will make them stop looking.
    const el = await dialogWithWorkspace();
    failureFor = new Map([['pull', { code: 'MERGE_CONFLICT', message: 'conflicts in 2 files' }]]);
    uiStore.setState({ toasts: [] });

    await (el as any).handlePullAll();

    const summary = uiStore.getState().toasts.map((t) => t.message).join(' | ');
    expect(summary).to.contain('need conflict resolution');
    expect(summary, 'and not double-counted as a failure').to.not.contain('failed');
  });

  it('names the repos left mid-merge', async () => {
    // "2 need conflict resolution" across a 10-repo workspace is not actionable.
    const el = await dialogWithWorkspace();
    failureFor = new Map([['pull', { code: 'MERGE_CONFLICT', message: 'conflicts' }]]);
    uiStore.setState({ toasts: [] });

    await (el as any).handlePullAll();

    const summary = uiStore.getState().toasts.map((t) => t.message).join(' | ');
    for (const name of ['one', 'two', 'three']) {
      expect(summary, `${name} is named`).to.contain(name);
    }
  });

  it('names the repos that genuinely failed', async () => {
    const el = await dialogWithWorkspace();
    failCommands = new Set(['pull']);
    uiStore.setState({ toasts: [] });

    await (el as any).handlePullAll();

    const summary = uiStore.getState().toasts.map((t) => t.message).join(' | ');
    expect(summary).to.contain('3 failed');
    expect(summary).to.contain('one');
  });

  it('repos that are missing or not git repos are accounted for, not dropped', async () => {
    const el = await dialogWithWorkspace();
    (el as any).repoStatuses = new Map([
      ['/repo/one', { exists: true, isValidRepo: true }],
      ['/repo/two', { exists: false, isValidRepo: false }],
      ['/repo/three', { exists: true, isValidRepo: false }],
    ]);
    uiStore.setState({ toasts: [] });

    await (el as any).handleFetchAll();

    const summary = uiStore.getState().toasts.map((t) => t.message).join(' | ');
    expect(summary, 'the summary adds up to the workspace size').to.contain('2 unavailable');
    expect(summary).to.contain('1 succeeded');
  });
});