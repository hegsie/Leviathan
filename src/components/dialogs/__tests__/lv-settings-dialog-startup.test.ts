/**
 * The startup ("Reopen Last Repositories") control in Settings.
 *
 * `openLastRepository` shipped as a persisted store field with a setter and no
 * reader and no UI: the app restored the previous session's tabs
 * unconditionally, so a user who wanted to start on the welcome screen had no
 * way to ask for it. These tests hold the control in place.
 */

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

const mockInvoke: MockInvoke = async (command: string) => {
  switch (command) {
    case 'plugin:notification|is_permission_granted':
      return false;
    case 'get_ai_providers':
    case 'get_downloaded_models':
    case 'get_available_models':
    case 'get_available_diff_tools':
    case 'get_graph_color_schemes':
      return [];
    case 'get_app_version':
      return '0.1.0';
    case 'get_settings':
      return {};
    case 'get_system_capabilities':
      return { hasGpu: false, gpuName: null, totalRam: 8 };
    case 'get_local_model_status':
      return { loaded: false, modelId: null };
    case 'get_mcp_status':
      return { servers: [], totalTools: 0 };
    case 'get_merge_tool_config':
      return { toolName: null, toolCmd: null };
    case 'get_diff_tool':
      return { tool: null, cmd: null, prompt: false };
    case 'get_available_merge_tools':
      return [{ name: 'meld', displayName: 'Meld' }];
    case 'list_diff_tools':
      return [{ name: 'meld', command: 'meld', available: true }];
    default:
      return null;
  }
};

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

import { expect, fixture, html } from '@open-wc/testing';
import '../lv-settings-dialog.ts';
import type { LvSettingsDialog } from '../lv-settings-dialog.ts';
import { settingsStore } from '../../../stores/settings.store.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ROW_NAME = 'Reopen Last Repositories';

/** The `.setting-row` whose name matches, or null. */
function settingRow(el: LvSettingsDialog, name: string): HTMLElement | null {
  return (
    Array.from(el.shadowRoot!.querySelectorAll('.setting-row')).find(
      (row) => row.querySelector('.setting-name')?.textContent?.trim() === name
    ) as HTMLElement | undefined) ?? null;
}

function rowToggle(el: LvSettingsDialog, name: string): HTMLInputElement | null {
  return settingRow(el, name)?.querySelector('input[type="checkbox"]') ?? null;
}

describe('lv-settings-dialog startup section', () => {
  let el: LvSettingsDialog;

  beforeEach(async () => {
    settingsStore.setState({ openLastRepository: true });
    el = await fixture<LvSettingsDialog>(html`<lv-settings-dialog></lv-settings-dialog>`);
    await el.updateComplete;
  });

  afterEach(() => {
    settingsStore.setState({ openLastRepository: true });
  });

  it('renders the row with a description of what turning it off does', () => {
    const row = settingRow(el, ROW_NAME);
    expect(row, 'the startup row is rendered').to.not.be.null;
    const description = row!.querySelector('.setting-description')?.textContent ?? '';
    expect(description).to.contain('welcome screen');
    expect(description, 'says the tabs are not forgotten').to.match(/remember/i);
  });

  it('reflects the persisted value when the dialog opens', async () => {
    settingsStore.setState({ openLastRepository: false });

    const reopened = await fixture<LvSettingsDialog>(
      html`<lv-settings-dialog></lv-settings-dialog>`
    );
    await reopened.updateComplete;

    expect((reopened as any).openLastRepository).to.equal(false);
    expect(rowToggle(reopened, ROW_NAME)!.checked).to.equal(false);
  });

  it('clicking the toggle writes both directions to the store', async () => {
    const toggle = rowToggle(el, ROW_NAME)!;
    expect(toggle.checked, 'starts on — restoring is the default').to.equal(true);

    toggle.click();
    await el.updateComplete;
    expect(settingsStore.getState().openLastRepository).to.equal(false);

    toggle.click();
    await el.updateComplete;
    expect(settingsStore.getState().openLastRepository).to.equal(true);
  });

  it('dispatches settings-changed so the rest of the app can react', () => {
    let fired = 0;
    const onChange = (): void => {
      fired++;
    };
    window.addEventListener('settings-changed', onChange);
    try {
      rowToggle(el, ROW_NAME)!.click();
    } finally {
      window.removeEventListener('settings-changed', onChange);
    }
    expect(fired).to.equal(1);
  });
});
