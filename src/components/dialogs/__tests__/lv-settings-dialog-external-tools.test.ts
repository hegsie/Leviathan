/**
 * Settings Dialog External Tools Tests
 *
 * Choosing "None" for the merge/diff tool must actually unset merge.tool /
 * diff.tool in the repository config. Clearing only local component state
 * leaves git (and the app's own launch-merge-tool / launch-diff-tool flows) on
 * the old tool, and reopening Settings reloads it — silently reverting the
 * user's choice.
 */

import { expect, fixture, html } from '@open-wc/testing';

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

interface RecordedCall {
  command: string;
  args: Record<string, unknown> | undefined;
}

const calls: RecordedCall[] = [];
let responses: Record<string, unknown> = {};
const failures: Record<string, string> = {};

const mockInvoke: MockInvoke = async (command: string, args?: unknown) => {
  calls.push({ command, args: args as Record<string, unknown> | undefined });

  if (command === 'plugin:notification|is_permission_granted') return false;
  if (failures[command] !== undefined) {
    throw new Error(failures[command]);
  }
  if (command in responses) return responses[command];

  switch (command) {
    case 'get_ai_providers':
      return [];
    case 'get_app_version':
      return '0.1.0';
    case 'get_settings':
      return {};
    case 'get_system_capabilities':
      return { hasGpu: false, gpuName: null, totalRam: 8 };
    case 'get_downloaded_models':
      return [];
    case 'get_local_model_status':
      return { loaded: false, modelId: null };
    case 'get_available_models':
      return [];
    case 'get_mcp_status':
      return { servers: [], totalTools: 0 };
    case 'get_graph_color_schemes':
      return [];
    default:
      return null;
  }
};

let callbackId = 0;
(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
  transformCallback: () => callbackId++,
  convertFileSrc: (path: string) => path,
};

// Import AFTER setting up the mock
import '../lv-settings-dialog.ts';
import type { LvSettingsDialog } from '../lv-settings-dialog.ts';
import { repositoryStore } from '../../../stores/repository.store.ts';
import { uiStore } from '../../../stores/ui.store.ts';
import type { Repository } from '../../../types/git.types.ts';

const REPO_PATH = '/repo';

function mockRepo(path: string, name: string): Repository {
  return {
    path,
    name,
    isValid: true,
    isBare: false,
    headRef: 'main',
    state: 'clean',
    isShallow: false,
    isPartialClone: false,
    cloneFilter: null,
  };
}

function unsetCalls(): RecordedCall[] {
  return calls.filter((c) => c.command === 'unset_git_config');
}

/** Find the <select> in the setting row whose name matches `label`. */
function toolSelect(el: LvSettingsDialog, label: string): HTMLSelectElement {
  const rows = Array.from(el.shadowRoot?.querySelectorAll('.setting-row') ?? []);
  const row = rows.find(
    (r) => r.querySelector('.setting-name')?.textContent?.trim() === label,
  );
  const select = row?.querySelector('select') as HTMLSelectElement | null | undefined;
  expect(select, `${label} select exists`).to.exist;
  return select as HTMLSelectElement;
}

async function renderDialog(): Promise<LvSettingsDialog> {
  const el = await fixture<LvSettingsDialog>(
    html`<lv-settings-dialog></lv-settings-dialog>`,
  );
  await el.updateComplete;
  // Wait for the async external-tools load kicked off by connectedCallback.
  for (let i = 0; i < 50; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((el as any).loadingTools === false) break;
    await new Promise((r) => setTimeout(r, 5));
    await el.updateComplete;
  }
  await el.updateComplete;
  return el;
}

/** Drive the real rendered <select> the way a user would. */
async function chooseNone(el: LvSettingsDialog, label: string): Promise<HTMLSelectElement> {
  const select = toolSelect(el, label);
  select.value = '';
  const handler = label === 'Merge Tool' ? 'handleMergeToolChange' : 'handleDiffToolChange';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (el as any)[handler]({ target: select } as unknown as Event);
  await el.updateComplete;
  return select;
}

function lastToast(): { type: string; message: string } | undefined {
  const toasts = uiStore.getState().toasts;
  return toasts[toasts.length - 1];
}

describe('lv-settings-dialog external tools "None"', () => {
  beforeEach(() => {
    calls.length = 0;
    for (const key of Object.keys(failures)) delete failures[key];
    responses = {
      get_merge_tool_config: { toolName: 'meld', toolCmd: null },
      get_available_merge_tools: [{ name: 'meld', displayName: 'Meld', available: true }],
      get_diff_tool: { tool: 'vscode', cmd: null, prompt: false },
      list_diff_tools: [{ name: 'vscode', command: 'code', available: true }],
      unset_git_config: null,
      set_merge_tool_config: null,
      set_diff_tool: null,
    };
    uiStore.setState({ toasts: [] });
    repositoryStore.getState().reset();
    repositoryStore.getState().addRepository(mockRepo(REPO_PATH, 'repo'));
  });

  afterEach(() => {
    repositoryStore.getState().reset();
    uiStore.setState({ toasts: [] });
  });

  it('unsets merge.tool when Merge Tool is set to None', async () => {
    const el = await renderDialog();
    await chooseNone(el, 'Merge Tool');

    const unsets = unsetCalls();
    expect(unsets, 'unset_git_config was invoked').to.have.lengthOf(1);
    expect(unsets[0].args).to.deep.equal({ path: REPO_PATH, key: 'merge.tool', global: undefined });
  });

  it('dispatches settings-changed and clears the merge tool after a successful unset', async () => {
    const el = await renderDialog();
    let eventFired = false;
    const listener = () => { eventFired = true; };
    window.addEventListener('settings-changed', listener);

    await chooseNone(el, 'Merge Tool');
    window.removeEventListener('settings-changed', listener);

    expect(eventFired, 'settings-changed dispatched').to.be.true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).mergeToolName).to.be.null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).mergeToolCmd).to.be.null;
  });

  it('shows an error toast and keeps the configured merge tool when the unset fails', async () => {
    const el = await renderDialog();
    failures['unset_git_config'] = 'error: could not unset merge.tool';

    let eventFired = false;
    const listener = () => { eventFired = true; };
    window.addEventListener('settings-changed', listener);
    const select = await chooseNone(el, 'Merge Tool');
    window.removeEventListener('settings-changed', listener);

    expect(eventFired, 'settings-changed NOT dispatched on failure').to.be.false;
    expect(lastToast()?.type, 'error toast shown').to.equal('error');
    expect(lastToast()?.message).to.contain('could not unset');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).mergeToolName, 'still configured').to.equal('meld');
    expect(select.value, 'select reverted to the configured tool').to.equal('meld');
  });

  it('unsets diff.tool when Diff Tool is set to None', async () => {
    const el = await renderDialog();
    await chooseNone(el, 'Diff Tool');

    const unsets = unsetCalls();
    expect(unsets, 'unset_git_config was invoked').to.have.lengthOf(1);
    expect(unsets[0].args).to.deep.equal({ path: REPO_PATH, key: 'diff.tool', global: undefined });
  });

  it('dispatches settings-changed and clears the diff tool after a successful unset', async () => {
    const el = await renderDialog();
    let eventFired = false;
    const listener = () => { eventFired = true; };
    window.addEventListener('settings-changed', listener);

    await chooseNone(el, 'Diff Tool');
    window.removeEventListener('settings-changed', listener);

    expect(eventFired, 'settings-changed dispatched').to.be.true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).diffToolName).to.be.null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).diffToolCmd).to.be.null;
  });

  it('shows an error toast and keeps the configured diff tool when the unset fails', async () => {
    const el = await renderDialog();
    failures['unset_git_config'] = 'error: could not unset diff.tool';

    let eventFired = false;
    const listener = () => { eventFired = true; };
    window.addEventListener('settings-changed', listener);
    const select = await chooseNone(el, 'Diff Tool');
    window.removeEventListener('settings-changed', listener);

    expect(eventFired, 'settings-changed NOT dispatched on failure').to.be.false;
    expect(lastToast()?.type, 'error toast shown').to.equal('error');
    expect(lastToast()?.message).to.contain('could not unset');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).diffToolName, 'still configured').to.equal('vscode');
    expect(select.value, 'select reverted to the configured tool').to.equal('vscode');
  });

  it('unsets merge.tool when None is chosen after a Custom tool', async () => {
    const el = await renderDialog();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).mergeToolName = '__custom__';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).mergeToolCmd = 'meld $LOCAL $REMOTE $MERGED';
    await el.updateComplete;

    await chooseNone(el, 'Merge Tool');

    const unsets = unsetCalls();
    expect(unsets, 'unset_git_config was invoked').to.have.lengthOf(1);
    expect(unsets[0].args).to.include({ key: 'merge.tool' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any).mergeToolCmd).to.be.null;
  });

  it('still issues the unset when no tool was configured', async () => {
    responses['get_merge_tool_config'] = { toolName: null, toolCmd: null };
    const el = await renderDialog();

    let eventFired = false;
    const listener = () => { eventFired = true; };
    window.addEventListener('settings-changed', listener);
    await chooseNone(el, 'Merge Tool');
    window.removeEventListener('settings-changed', listener);

    // The backend treats a missing key as a benign no-op, so the write is safe
    // and the UI stays honest about what is configured.
    const unsets = unsetCalls();
    expect(unsets).to.have.lengthOf(1);
    expect(unsets[0].args).to.include({ key: 'merge.tool' });
    expect(eventFired, 'settings-changed dispatched').to.be.true;
  });

  it('does nothing when no repository is open', async () => {
    const el = await renderDialog();
    repositoryStore.getState().reset();
    await el.updateComplete;

    const select = document.createElement('select');
    select.innerHTML = '<option value=""></option>';
    select.value = '';
    calls.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleMergeToolChange({ target: select } as unknown as Event);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any).handleDiffToolChange({ target: select } as unknown as Event);

    expect(unsetCalls(), 'no config write without an active repository').to.have.lengthOf(0);
    expect(uiStore.getState().toasts, 'no toast').to.have.lengthOf(0);
  });
});
