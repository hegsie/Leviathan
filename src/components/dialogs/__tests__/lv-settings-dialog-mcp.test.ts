/**
 * Settings Dialog MCP Tests
 *
 * The MCP server configuration is persisted on the backend, so the dialog must
 * save the port when it changes, report a failed save instead of swallowing it,
 * and explain why the server is stopped after a failed launch-time start.
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
});
