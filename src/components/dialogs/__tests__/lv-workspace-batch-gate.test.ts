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

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invoked.push({ command, args });
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

describe('workspace batch operations and the security gate', () => {
  beforeEach(() => {
    invoked.length = 0;
    failCommands = new Set();
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