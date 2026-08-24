/**
 * Settings Dialog External Tools error-handling tests.
 *
 * setMergeToolConfig / setDiffTool return a CommandResult and never throw, so a
 * failed config write (read-only or locked .git/config) used to be completely
 * silent: the control kept showing a value git never accepted and
 * 'settings-changed' fired as if the write had landed. These tests pin the
 * toast, the revert of both state and DOM control, and the suppressed event.
 */

import { expect, fixture, html } from '@open-wc/testing';
import { repositoryStore } from '../../../stores/repository.store.ts';
import { uiStore } from '../../../stores/ui.store.ts';

const REPO_PATH = '/test/external-tools-repo';
const WRITE_ERROR = 'could not lock config file: Permission denied';

async function waitUntil(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`timed out waiting for ${what}`);
}

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let failingCommands: Set<string> = new Set();

const mockInvoke: MockInvoke = async (command: string) => {
  if (command === 'plugin:notification|is_permission_granted') return false;
  if (failingCommands.has(command)) {
    throw new Error(WRITE_ERROR);
  }

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
    case 'get_model_status':
    case 'get_local_model_status':
      return { loaded: false, modelId: null };
    case 'get_available_models':
      return [];
    case 'get_mcp_status':
      return { servers: [], totalTools: 0 };
    case 'get_graph_color_schemes':
      return [];
    case 'get_merge_tool_config':
      return { toolName: null, toolCmd: null };
    case 'get_diff_tool':
      return { tool: null, cmd: null, prompt: false };
    case 'get_available_merge_tools':
      return [
        { name: 'meld', displayName: 'Meld', command: 'meld', available: true },
        { name: 'vimdiff', displayName: 'Vimdiff', command: 'vimdiff', available: true },
      ];
    case 'list_diff_tools':
      return [
        { name: 'meld', command: 'meld', available: true },
        { name: 'vimdiff', command: 'vimdiff', available: true },
      ];
    case 'set_merge_tool_config':
    case 'set_diff_tool':
      return null;
    default:
      return null;
  }
};

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

// Import AFTER installing the mock
import '../lv-settings-dialog.ts';
import type { LvSettingsDialog } from '../lv-settings-dialog.ts';

interface ToolState {
  mergeToolName: string | null;
  mergeToolCmd: string | null;
  diffToolName: string | null;
  diffToolCmd: string | null;
}

function toolState(el: LvSettingsDialog): ToolState {
  return el as unknown as ToolState;
}

function settingRow(el: LvSettingsDialog, name: string): Element {
  const rows = Array.from(el.shadowRoot?.querySelectorAll('.setting-row') ?? []);
  const row = rows.find(
    (r) => r.querySelector('.setting-name')?.textContent?.trim() === name,
  );
  if (!row) throw new Error(`no setting row named "${name}"`);
  return row;
}

function rowSelect(el: LvSettingsDialog, name: string): HTMLSelectElement {
  const select = settingRow(el, name).querySelector('select');
  if (!select) throw new Error(`no select in setting row "${name}"`);
  return select;
}

function rowInput(el: LvSettingsDialog, name: string): HTMLInputElement {
  const input = settingRow(el, name).querySelector('input');
  if (!input) throw new Error(`no input in setting row "${name}"`);
  return input;
}

function change(control: HTMLElement): void {
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

function errorToasts(): string[] {
  return uiStore
    .getState()
    .toasts.filter((t) => t.type === 'error')
    .map((t) => t.message);
}

describe('lv-settings-dialog external tools write failures', () => {
  let el: LvSettingsDialog;
  let settingsChangedCount: number;
  let onSettingsChanged: () => void;

  beforeEach(async () => {
    failingCommands = new Set();
    uiStore.setState({ toasts: [] });
    repositoryStore.getState().addRepository({
      path: REPO_PATH,
      name: 'external-tools-repo',
      isValid: true,
      isBare: false,
      headRef: 'main',
      state: 'clean',
      isShallow: false,
      isPartialClone: false,
      cloneFilter: null,
    });

    settingsChangedCount = 0;
    onSettingsChanged = () => {
      settingsChangedCount += 1;
    };
    window.addEventListener('settings-changed', onSettingsChanged);

    el = await fixture<LvSettingsDialog>(html`<lv-settings-dialog></lv-settings-dialog>`);
    await el.updateComplete;
    await waitUntil(
      () => !!el.shadowRoot?.querySelector('option[value="vimdiff"]'),
      'the external tools lists to load',
    );
  });

  afterEach(() => {
    window.removeEventListener('settings-changed', onSettingsChanged);
    uiStore.setState({ toasts: [] });
  });

  it('shows an error toast when saving the merge tool fails', async () => {
    failingCommands.add('set_merge_tool_config');

    const select = rowSelect(el, 'Merge Tool');
    select.value = 'meld';
    change(select);

    await waitUntil(() => errorToasts().length > 0, 'the merge tool error toast');
    expect(errorToasts()[0]).to.contain('Failed to save merge tool');
    expect(errorToasts()[0]).to.contain('Permission denied');
  });

  it('puts the merge tool select back on the saved value when the write fails', async () => {
    failingCommands.add('set_merge_tool_config');

    const select = rowSelect(el, 'Merge Tool');
    select.value = 'meld';
    change(select);

    await waitUntil(() => errorToasts().length > 0, 'the merge tool error toast');
    await el.updateComplete;

    expect(select.value, 'select reverted to None').to.equal('');
    expect(toolState(el).mergeToolName, 'mergeToolName reverted').to.be.null;
    expect(settingsChangedCount, 'settings-changed suppressed on failure').to.equal(0);
  });

  it('restores the previously saved merge tool, not None, when a later write fails', async () => {
    const select = rowSelect(el, 'Merge Tool');
    select.value = 'meld';
    change(select);

    await waitUntil(() => settingsChangedCount === 1, 'the first merge tool save');
    await el.updateComplete;
    expect(select.value).to.equal('meld');

    failingCommands.add('set_merge_tool_config');
    select.value = 'vimdiff';
    change(select);

    await waitUntil(() => errorToasts().length > 0, 'the merge tool error toast');
    await el.updateComplete;

    expect(select.value, 'reverted to the last saved tool').to.equal('meld');
    expect(toolState(el).mergeToolName).to.equal('meld');
    expect(settingsChangedCount, 'no second settings-changed').to.equal(1);
  });

  it('shows an error toast and restores the saved merge tool command when the custom command write fails', async () => {
    const select = rowSelect(el, 'Merge Tool');
    select.value = '__custom__';
    change(select);
    await el.updateComplete;

    failingCommands.add('set_merge_tool_config');
    const input = rowInput(el, 'Merge Tool Command');
    input.value = '/usr/bin/meld $LOCAL $REMOTE $MERGED';
    change(input);

    await waitUntil(() => errorToasts().length > 0, 'the merge tool command error toast');
    await el.updateComplete;

    expect(errorToasts()[0]).to.contain('Failed to save merge tool command');
    expect(errorToasts()[0]).to.contain('Permission denied');
    expect(input.value, 'command input reverted').to.equal('');
    expect(toolState(el).mergeToolCmd, 'mergeToolCmd reverted').to.equal('');
    expect(toolState(el).mergeToolName, 'custom row stays open for a retry').to.equal('__custom__');
    expect(settingsChangedCount, 'settings-changed suppressed on failure').to.equal(0);
  });

  it('shows an error toast and reverts the diff tool select when the write fails', async () => {
    failingCommands.add('set_diff_tool');

    const select = rowSelect(el, 'Diff Tool');
    select.value = 'meld';
    change(select);

    await waitUntil(() => errorToasts().length > 0, 'the diff tool error toast');
    await el.updateComplete;

    expect(errorToasts()[0]).to.contain('Failed to save diff tool');
    expect(errorToasts()[0]).to.contain('Permission denied');
    expect(select.value, 'select reverted to None').to.equal('');
    expect(toolState(el).diffToolName, 'diffToolName reverted').to.be.null;
    expect(settingsChangedCount, 'settings-changed suppressed on failure').to.equal(0);
  });

  it('shows an error toast and restores the saved diff tool command when the custom command write fails', async () => {
    const select = rowSelect(el, 'Diff Tool');
    select.value = '__custom__';
    change(select);
    await el.updateComplete;

    failingCommands.add('set_diff_tool');
    const input = rowInput(el, 'Diff Tool Command');
    input.value = '/usr/bin/meld $LOCAL $REMOTE';
    change(input);

    await waitUntil(() => errorToasts().length > 0, 'the diff tool command error toast');
    await el.updateComplete;

    expect(errorToasts()[0]).to.contain('Failed to save diff tool command');
    expect(input.value, 'command input reverted').to.equal('');
    expect(toolState(el).diffToolCmd, 'diffToolCmd reverted').to.equal('');
    expect(toolState(el).diffToolName, 'custom row stays open for a retry').to.equal('__custom__');
    expect(settingsChangedCount, 'settings-changed suppressed on failure').to.equal(0);
  });

  it('dispatches settings-changed and keeps the value when the merge tool write succeeds', async () => {
    const select = rowSelect(el, 'Merge Tool');
    select.value = 'meld';
    change(select);

    await waitUntil(() => settingsChangedCount === 1, 'the merge tool save');
    await el.updateComplete;

    expect(select.value).to.equal('meld');
    expect(toolState(el).mergeToolName).to.equal('meld');
    expect(errorToasts(), 'no error toast on success').to.be.empty;
  });
});
