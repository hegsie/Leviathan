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

/** Give any pending handler continuation plenty of turns to run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

let failingCommands: Set<string> = new Set();

/**
 * Commands parked until the test settles them, so two writes can be resolved
 * out of the order they were issued.
 */
let deferredCommands: Set<string> = new Set();
interface DeferredWrite {
  command: string;
  succeed: () => void;
  fail: () => void;
}
let deferredWrites: DeferredWrite[] = [];

const mockInvoke: MockInvoke = async (command: string) => {
  if (command === 'plugin:notification|is_permission_granted') return false;
  if (failingCommands.has(command)) {
    throw new Error(WRITE_ERROR);
  }
  if (deferredCommands.has(command)) {
    return new Promise((resolve, reject) => {
      deferredWrites.push({
        command,
        succeed: () => resolve(null),
        fail: () => reject(new Error(WRITE_ERROR)),
      });
    });
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
    deferredCommands = new Set();
    deferredWrites = [];
    uiStore.setState({ toasts: [] });
    repositoryStore.getState().addRepository({
      path: REPO_PATH,
      name: 'external-tools-repo',
      isValid: true,
      isBare: false,
      headRef: 'main',
      detachedHeadOid: null,
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

  it('keeps the newer saved merge tool when an older failed write resolves late', async () => {
    deferredCommands.add('set_merge_tool_config');

    const select = rowSelect(el, 'Merge Tool');
    select.value = 'meld';
    change(select);
    await waitUntil(() => deferredWrites.length === 1, 'the first merge tool write');

    select.value = 'vimdiff';
    change(select);
    await waitUntil(() => deferredWrites.length === 2, 'the second merge tool write');

    // The newer write lands first and succeeds...
    deferredWrites[1].succeed();
    await waitUntil(() => settingsChangedCount === 1, 'the newer merge tool save');
    await el.updateComplete;
    expect(select.value).to.equal('vimdiff');

    // ...then the superseded write fails. It must not roll the control back.
    deferredWrites[0].fail();
    await settle();
    await el.updateComplete;

    expect(select.value, 'newer saved tool survives').to.equal('vimdiff');
    expect(toolState(el).mergeToolName).to.equal('vimdiff');
    expect(errorToasts(), 'no rollback toast for a superseded write').to.be.empty;
    expect(settingsChangedCount, 'only the newer save dispatched').to.equal(1);
  });

  it('keeps the newer saved diff tool when an older failed write resolves late', async () => {
    deferredCommands.add('set_diff_tool');

    const select = rowSelect(el, 'Diff Tool');
    select.value = 'meld';
    change(select);
    await waitUntil(() => deferredWrites.length === 1, 'the first diff tool write');

    select.value = 'vimdiff';
    change(select);
    await waitUntil(() => deferredWrites.length === 2, 'the second diff tool write');

    deferredWrites[1].succeed();
    await waitUntil(() => settingsChangedCount === 1, 'the newer diff tool save');
    await el.updateComplete;
    expect(select.value).to.equal('vimdiff');

    deferredWrites[0].fail();
    await settle();
    await el.updateComplete;

    expect(select.value, 'newer saved tool survives').to.equal('vimdiff');
    expect(toolState(el).diffToolName).to.equal('vimdiff');
    expect(errorToasts(), 'no rollback toast for a superseded write').to.be.empty;
    expect(settingsChangedCount, 'only the newer save dispatched').to.equal(1);
  });

  it('leaves the merge tool on None when an in-flight write fails after the user picks None', async () => {
    const select = rowSelect(el, 'Merge Tool');
    select.value = 'meld';
    change(select);
    await waitUntil(() => settingsChangedCount === 1, 'the first merge tool save');
    await el.updateComplete;

    deferredCommands.add('set_merge_tool_config');
    select.value = 'vimdiff';
    change(select);
    await waitUntil(() => deferredWrites.length === 1, 'the merge tool write');

    // The user gives up on external merge tools before the write comes back.
    select.value = '';
    change(select);
    await el.updateComplete;

    deferredWrites[0].fail();
    await settle();
    await el.updateComplete;

    expect(select.value, 'the None choice survives').to.equal('');
    expect(toolState(el).mergeToolName).to.be.null;
    expect(errorToasts(), 'no rollback toast for a superseded write').to.be.empty;
    expect(settingsChangedCount, 'only the first save dispatched').to.equal(1);
  });

  it('does not roll the custom diff tool command back over a newer tool selection', async () => {
    const select = rowSelect(el, 'Diff Tool');
    select.value = '__custom__';
    change(select);
    await el.updateComplete;

    deferredCommands.add('set_diff_tool');
    const input = rowInput(el, 'Diff Tool Command');
    input.value = '/usr/bin/meld $LOCAL $REMOTE';
    change(input);
    await waitUntil(() => deferredWrites.length === 1, 'the custom command write');

    // The user switches to a named tool while the command write is still open.
    select.value = 'vimdiff';
    change(select);
    await waitUntil(() => deferredWrites.length === 2, 'the named tool write');
    deferredWrites[1].succeed();
    await waitUntil(() => settingsChangedCount === 1, 'the named tool save');
    await el.updateComplete;

    deferredWrites[0].fail();
    await settle();
    await el.updateComplete;

    expect(select.value, 'the named tool survives').to.equal('vimdiff');
    expect(toolState(el).diffToolName).to.equal('vimdiff');
    expect(errorToasts(), 'no rollback toast for a superseded write').to.be.empty;
    expect(settingsChangedCount).to.equal(1);
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
