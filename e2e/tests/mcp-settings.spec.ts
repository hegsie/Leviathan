import { test, expect, type Page } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import {
  startCommandCaptureWithMocks,
  injectCommandError,
  findCommand,
} from '../fixtures/test-helpers';

/**
 * MCP server settings.
 *
 * The MCP configuration is persisted on the backend and the server is restarted
 * on launch while it is enabled, so the Settings dialog must save the port when
 * it changes and explain why the server is stopped when a start failed.
 */

const stoppedStatus = {
  running: false,
  port: 3001,
  url: null,
  lastError: null,
};

const defaultConfig = {
  enabled: false,
  port: 3001,
  allowedOrigins: [],
};

function mcpMocks(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    get_mcp_status: stoppedStatus,
    get_mcp_config: defaultConfig,
    set_mcp_config: null,
    start_mcp_server: null,
    stop_mcp_server: null,
    ...overrides,
  };
}

/** Open the settings dialog via keyboard shortcut */
async function openSettings(page: Page) {
  await page.keyboard.press('Meta+,');
  await expect(page.locator('lv-settings-dialog')).toBeVisible();
}

/** The MCP port input, scoped by its description so other number inputs don't match */
function mcpPortInput(page: Page) {
  return page
    .locator('lv-settings-dialog .setting-row', { hasText: 'Localhost port for the MCP server' })
    .locator('input');
}

/** The Start/Retry/Stop button in the MCP section */
function mcpToggleButton(page: Page) {
  return page
    .locator('lv-settings-dialog .setting-row', { hasText: 'Context Proxy' })
    .locator('button.mcp-toggle');
}

/** The Disable button, shown only while the server is enabled but not running */
function mcpDisableButton(page: Page) {
  return page
    .locator('lv-settings-dialog .setting-row', { hasText: 'Context Proxy' })
    .locator('button.mcp-disable');
}

test.describe('Settings Dialog — MCP Server', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('saves the MCP port when it is changed', async ({ page }) => {
    await startCommandCaptureWithMocks(page, mcpMocks());
    await openSettings(page);

    const input = mcpPortInput(page);
    await expect(input).toBeVisible();
    await input.fill('4321');
    await input.blur();

    await expect
      .poll(async () => (await findCommand(page, 'set_mcp_config')).length)
      .toBeGreaterThan(0);

    const saves = await findCommand(page, 'set_mcp_config');
    expect(saves[saves.length - 1].args).toEqual({
      config: { enabled: false, port: 4321, allowedOrigins: [] },
    });
  });

  test('reports a failed launch-time start in the MCP section', async ({ page }) => {
    await startCommandCaptureWithMocks(
      page,
      mcpMocks({
        get_mcp_config: { enabled: true, port: 3001, allowedOrigins: [] },
        get_mcp_status: {
          running: false,
          port: 3001,
          url: null,
          lastError: 'Failed to bind to 127.0.0.1:3001: Address already in use',
        },
      })
    );
    await openSettings(page);

    await expect(
      page.locator('lv-settings-dialog .setting-row', { hasText: 'Context Proxy' })
    ).toContainText('Stopped');
    await expect(page.locator('lv-settings-dialog .error-text')).toContainText(
      'Failed to bind to 127.0.0.1:3001'
    );
  });

  test('surfaces an error when the config cannot be saved on Start', async ({ page }) => {
    await startCommandCaptureWithMocks(page, mcpMocks());
    await openSettings(page);
    await injectCommandError(page, 'set_mcp_config', 'Failed to write MCP config: disk full');

    await mcpToggleButton(page).click();

    await expect(page.locator('lv-settings-dialog .error-text')).toContainText(
      'Failed to write MCP config: disk full'
    );
    await expect(
      page.locator('lv-settings-dialog .setting-row', { hasText: 'Context Proxy' })
    ).toContainText('Disabled');
    expect(await findCommand(page, 'start_mcp_server')).toHaveLength(0);
  });

  test('lets the user turn off a start that keeps failing', async ({ page }) => {
    await startCommandCaptureWithMocks(
      page,
      mcpMocks({
        get_mcp_config: { enabled: true, port: 3001, allowedOrigins: [] },
        get_mcp_status: {
          running: false,
          port: 3001,
          url: null,
          lastError: 'Failed to bind to 127.0.0.1:3001: Address already in use',
        },
      })
    );
    await openSettings(page);

    // A server that is enabled but not running keeps retrying on every launch,
    // so the section must offer a way to stop that without a running server
    await expect(mcpDisableButton(page)).toBeVisible();
    // ...and the start control reads as a retry, not a fresh start
    await expect(mcpToggleButton(page)).toHaveText('Retry');
    await mcpDisableButton(page).click();

    await expect
      .poll(async () => (await findCommand(page, 'set_mcp_config')).length)
      .toBeGreaterThan(0);

    const saves = await findCommand(page, 'set_mcp_config');
    expect(saves[saves.length - 1].args).toEqual({
      config: { enabled: false, port: 3001, allowedOrigins: [] },
    });
  });

  test('a disabled server does not advertise a stale start failure', async ({ page }) => {
    // The backend keeps `lastError` after a disable, so the section must key the
    // explanation off the persisted enabled flag, not off `running` alone
    await startCommandCaptureWithMocks(
      page,
      mcpMocks({
        get_mcp_status: {
          running: false,
          port: 3001,
          url: null,
          lastError: 'Failed to bind to 127.0.0.1:3001: Address already in use',
        },
      })
    );
    await openSettings(page);

    await expect(
      page.locator('lv-settings-dialog .setting-row', { hasText: 'Context Proxy' })
    ).toContainText('Disabled');
    await expect(mcpDisableButton(page)).toHaveCount(0);
    await expect(page.locator('lv-settings-dialog .error-text')).toHaveCount(0);
  });

  test('offers no disable action while the server is stopped and disabled', async ({ page }) => {
    await startCommandCaptureWithMocks(page, mcpMocks());
    await openSettings(page);

    await expect(mcpToggleButton(page)).toHaveText('Start');
    await expect(mcpDisableButton(page)).toHaveCount(0);
  });
});
