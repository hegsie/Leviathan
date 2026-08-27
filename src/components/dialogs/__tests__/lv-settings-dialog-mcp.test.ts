/**
 * Settings Dialog MCP Tests
 *
 * The MCP server configuration is persisted on the backend, so the dialog must
 * save the port when it changes, report a failed save instead of swallowing it,
 * explain why the server is stopped after a failed launch-time start, and let the
 * user turn off a start that keeps failing.
 */

import { expect, fixture, html } from '@open-wc/testing';

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

interface InvokedCommand {
  command: string;
  args?: unknown;
}

const invoked: InvokedCommand[] = [];

let mcpStatus: Record<string, unknown> = {
  running: false,
  port: 3001,
  url: null,
  lastError: null,
};
let setMcpConfigError: string | null = null;
let mcpConfig: Record<string, unknown> = { enabled: false, port: 3001, allowedOrigins: [] };

const mockInvoke: MockInvoke = async (command: string, args?: unknown) => {
  if (command === 'plugin:notification|is_permission_granted') return false;
  invoked.push({ command, args });

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
    case 'get_available_models':
    case 'get_available_diff_tools':
    case 'get_graph_color_schemes':
      return [];
    case 'get_local_model_status':
      return { loaded: false, modelId: null };
    case 'get_mcp_status':
      return mcpStatus;
    case 'get_mcp_config':
      return mcpConfig;
    case 'set_mcp_config':
      if (setMcpConfigError) throw new Error(setMcpConfigError);
      mcpConfig = { ...(args as { config: Record<string, unknown> }).config };
      return null;
    case 'start_mcp_server':
      return null;
    default:
      return null;
  }
};

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

// Import AFTER setting up the mock
import '../lv-settings-dialog.ts';
import type { LvSettingsDialog } from '../lv-settings-dialog.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Let the awaited invoke chain behind a click settle, then re-render */
async function flush(el: LvSettingsDialog): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
    await el.updateComplete;
  }
}

describe('lv-settings-dialog MCP settings', () => {
  beforeEach(() => {
    invoked.length = 0;
    setMcpConfigError = null;
    mcpStatus = { running: false, port: 3001, url: null, lastError: null };
    mcpConfig = { enabled: false, port: 3001, allowedOrigins: [] };
  });

  it('persists the port when it changes', async () => {
    const el = await fixture<LvSettingsDialog>(html`<lv-settings-dialog></lv-settings-dialog>`);

    await (el as any).handleMcpPortChange({ target: { value: '4321' } } as unknown as Event);
    await el.updateComplete;

    const saves = invoked.filter((c) => c.command === 'set_mcp_config');
    expect(saves.length).to.equal(1);
    expect(saves[0].args).to.deep.equal({
      config: { enabled: false, port: 4321, allowedOrigins: [] },
    });
  });

  it('keeps the server enabled when the port changes after a failed start', async () => {
    mcpConfig = { enabled: true, port: 3001, allowedOrigins: [] };
    mcpStatus = {
      running: false,
      port: 3001,
      url: null,
      lastError: 'Failed to bind to 127.0.0.1:3001: Address already in use',
    };

    const el = await fixture<LvSettingsDialog>(html`<lv-settings-dialog></lv-settings-dialog>`);
    await (el as any).loadMcpStatus();

    await (el as any).handleMcpPortChange({ target: { value: '4321' } } as unknown as Event);
    await el.updateComplete;

    const saves = invoked.filter((c) => c.command === 'set_mcp_config');
    expect(saves[saves.length - 1].args).to.deep.equal({
      config: { enabled: true, port: 4321, allowedOrigins: [] },
    });
  });

  it('shows an error when saving the MCP config fails', async () => {
    const el = await fixture<LvSettingsDialog>(html`<lv-settings-dialog></lv-settings-dialog>`);

    setMcpConfigError = 'Failed to write MCP config: disk full';
    await (el as any).handleMcpToggle();
    await el.updateComplete;

    // The server must not be started when its configuration could not be saved
    expect(invoked.some((c) => c.command === 'start_mcp_server')).to.be.false;

    const errorText = el.shadowRoot?.textContent ?? '';
    expect(errorText).to.contain('Failed to write MCP config: disk full');
  });

  it('shows why the MCP server is stopped after a failed auto-start', async () => {
    mcpConfig = { enabled: true, port: 3001, allowedOrigins: [] };
    mcpStatus = {
      running: false,
      port: 3001,
      url: null,
      lastError: 'Failed to bind to 127.0.0.1:3001: Address already in use',
    };

    const el = await fixture<LvSettingsDialog>(html`<lv-settings-dialog></lv-settings-dialog>`);
    // loadMcpStatus runs on connect; wait for the resulting render
    await (el as any).loadMcpStatus();
    await el.updateComplete;

    const rendered = el.shadowRoot?.textContent ?? '';
    expect(rendered).to.contain('Failed to bind to 127.0.0.1:3001: Address already in use');
  });

  it('offers a disable action when the server is enabled but it is not running', async () => {
    mcpConfig = { enabled: true, port: 3001, allowedOrigins: [] };
    mcpStatus = {
      running: false,
      port: 3001,
      url: null,
      lastError: 'Failed to bind to 127.0.0.1:3001: Address already in use',
    };

    const el = await fixture<LvSettingsDialog>(html`<lv-settings-dialog></lv-settings-dialog>`);
    await (el as any).loadMcpStatus();
    await el.updateComplete;

    const disable = el.shadowRoot?.querySelector<HTMLButtonElement>('button.mcp-disable');
    expect(disable, 'an enabled-but-stopped server must offer a way out').to.exist;

    disable?.click();
    await flush(el);

    const saves = invoked.filter((c) => c.command === 'set_mcp_config');
    expect(saves[saves.length - 1].args).to.deep.equal({
      config: { enabled: false, port: 3001, allowedOrigins: [] },
    });

    // The disabled server no longer advertises the stale bind failure, and the
    // control reflects the persisted state rather than only the runtime state
    expect((el as any).mcpEnabled).to.be.false;
    expect(el.shadowRoot?.querySelector('button.mcp-disable')).to.not.exist;
    expect(el.shadowRoot?.textContent ?? '').to.not.contain('Address already in use');
  });

  it('shows an error when disabling the MCP server fails', async () => {
    mcpConfig = { enabled: true, port: 3001, allowedOrigins: [] };
    mcpStatus = { running: false, port: 3001, url: null, lastError: 'Address already in use' };

    const el = await fixture<LvSettingsDialog>(html`<lv-settings-dialog></lv-settings-dialog>`);
    await (el as any).loadMcpStatus();
    await el.updateComplete;

    setMcpConfigError = 'Failed to write MCP config: disk full';
    await (el as any).handleMcpDisable();
    await el.updateComplete;

    expect(el.shadowRoot?.textContent ?? '').to.contain('Failed to write MCP config: disk full');
    // The failed save must not fake a disabled server
    expect((el as any).mcpEnabled).to.be.true;
    expect(el.shadowRoot?.querySelector('button.mcp-disable')).to.exist;
  });

  it('offers no disable action while the server is already disabled', async () => {
    const el = await fixture<LvSettingsDialog>(html`<lv-settings-dialog></lv-settings-dialog>`);
    await (el as any).loadMcpStatus();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('button.mcp-disable')).to.not.exist;
    const toggle = el.shadowRoot?.querySelector<HTMLButtonElement>('button.mcp-toggle');
    expect(toggle?.textContent?.trim()).to.equal('Start');
  });

  it('offers no disable action while the server is running', async () => {
    mcpConfig = { enabled: true, port: 3001, allowedOrigins: [] };
    mcpStatus = { running: true, port: 3001, url: 'http://127.0.0.1:3001', lastError: null };

    const el = await fixture<LvSettingsDialog>(html`<lv-settings-dialog></lv-settings-dialog>`);
    await (el as any).loadMcpStatus();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('button.mcp-disable')).to.not.exist;
    const toggle = el.shadowRoot?.querySelector<HTMLButtonElement>('button.mcp-toggle');
    expect(toggle?.textContent?.trim()).to.equal('Stop');
  });
});
