import { test, expect, type Page } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import {
  startCommandCaptureWithMocks,
  injectCommandError,
  findCommand,
  waitForCommand,
} from '../fixtures/test-helpers';

// =========================================================================
// Settings Dialog — External Tools (merge/diff tool config writes)
//
// setMergeToolConfig / setDiffTool return a CommandResult rather than throwing,
// so a rejected config write used to leave the control showing a value git
// never accepted, with no feedback at all.
// =========================================================================

const WRITE_ERROR = 'could not lock config file: Permission denied';

function externalToolMocks(): Record<string, unknown> {
  return {
    get_merge_tool_config: { toolName: null, toolCmd: null },
    get_diff_tool: { tool: null, cmd: null, prompt: false },
    get_available_merge_tools: [
      { name: 'meld', displayName: 'Meld', command: 'meld', available: true },
      { name: 'vimdiff', displayName: 'Vimdiff', command: 'vimdiff', available: true },
    ],
    list_diff_tools: [
      { name: 'meld', command: 'meld', available: true },
      { name: 'vimdiff', command: 'vimdiff', available: true },
    ],
    set_merge_tool_config: null,
    set_diff_tool: null,
  };
}

async function openSettings(page: Page) {
  await page.keyboard.press('Meta+,');
  await expect(page.locator('lv-settings-dialog')).toBeVisible();
}

/** The `.setting-row` whose `.setting-name` is exactly `name`. */
function settingRow(page: Page, name: string) {
  return page.locator('lv-settings-dialog .setting-row', {
    has: page.locator('.setting-name', { hasText: new RegExp(`^${name}$`) }),
  });
}

function mergeSelect(page: Page) {
  return settingRow(page, 'Merge Tool').locator('select');
}

function diffSelect(page: Page) {
  return settingRow(page, 'Diff Tool').locator('select');
}

function errorToast(page: Page) {
  return page.locator('lv-toast-container .toast.error .toast-message');
}

test.describe('Settings Dialog — External Tools', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
    await startCommandCaptureWithMocks(page, externalToolMocks());
  });

  test('saving a merge tool sends set_merge_tool_config and shows no error', async ({ page }) => {
    await openSettings(page);

    const select = mergeSelect(page);
    await expect(select.locator('option[value="meld"]')).toHaveCount(1);
    await select.selectOption('meld');

    await waitForCommand(page, 'set_merge_tool_config');
    const calls = await findCommand(page, 'set_merge_tool_config');
    expect(calls[0].args).toMatchObject({ toolName: 'meld' });

    await expect(select).toHaveValue('meld');
    await expect(errorToast(page)).toHaveCount(0);
  });

  test('a failed merge tool write shows an error toast and leaves the select on None', async ({ page }) => {
    await injectCommandError(page, 'set_merge_tool_config', WRITE_ERROR);
    await openSettings(page);

    const select = mergeSelect(page);
    await expect(select.locator('option[value="meld"]')).toHaveCount(1);
    await select.selectOption('meld');

    await expect(errorToast(page)).toContainText('Failed to save merge tool');
    await expect(errorToast(page)).toContainText('Permission denied');
    await expect(select).toHaveValue('');
  });

  test('a failed custom diff tool command shows an error toast', async ({ page }) => {
    await injectCommandError(page, 'set_diff_tool', WRITE_ERROR);
    await openSettings(page);

    const select = diffSelect(page);
    await expect(select.locator('option[value="__custom__"]')).toHaveCount(1);
    await select.selectOption('__custom__');

    const cmdInput = settingRow(page, 'Diff Tool Command').locator('input');
    await expect(cmdInput).toBeVisible();
    await cmdInput.fill('/usr/bin/meld $LOCAL $REMOTE');
    await cmdInput.blur();

    await expect(errorToast(page)).toContainText('Failed to save diff tool command');
    await expect(cmdInput).toHaveValue('');
  });
});
