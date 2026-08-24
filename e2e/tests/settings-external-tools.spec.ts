import { test, expect, type Page, type Locator } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import {
  startCommandCaptureWithMocks,
  findCommand,
  injectCommandError,
} from '../fixtures/test-helpers';

const REPO_PATH = '/tmp/test-repo';

const TOOL_MOCKS = {
  get_merge_tool_config: { toolName: 'meld', toolCmd: null },
  get_available_merge_tools: [{ name: 'meld', displayName: 'Meld', available: true }],
  get_diff_tool: { tool: 'vscode', cmd: null, prompt: false },
  list_diff_tools: [{ name: 'vscode', command: 'code', available: true }],
  set_merge_tool_config: null,
  set_diff_tool: null,
  unset_git_config: null,
};

function toolSelect(page: Page, label: 'Merge Tool' | 'Diff Tool'): Locator {
  return page.locator(`lv-settings-dialog .setting-row:has-text("${label}") select`).first();
}

async function openSettings(page: Page): Promise<void> {
  await page.keyboard.press('Meta+,');
  await expect(page.locator('lv-settings-dialog')).toBeVisible();
}

async function unsetArgs(page: Page): Promise<Array<{ key?: string; path?: string }>> {
  const cmds = await findCommand(page, 'unset_git_config');
  return cmds.map((c) => c.args as { key?: string; path?: string });
}

test.describe('Settings - clearing the external merge/diff tool', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
    await startCommandCaptureWithMocks(page, TOOL_MOCKS);
  });

  test('clearing the merge tool from Settings unsets merge.tool', async ({ page }) => {
    await openSettings(page);
    const select = toolSelect(page, 'Merge Tool');
    await select.selectOption('meld');
    await expect(select).toHaveValue('meld');

    await select.selectOption('');

    await expect
      .poll(() => unsetArgs(page))
      .toContainEqual(expect.objectContaining({ key: 'merge.tool', path: REPO_PATH }));
    await expect(select).toHaveValue('');
  });

  test('clearing the diff tool from Settings unsets diff.tool', async ({ page }) => {
    await openSettings(page);
    const select = toolSelect(page, 'Diff Tool');
    await select.selectOption('vscode');
    await expect(select).toHaveValue('vscode');

    await select.selectOption('');

    await expect
      .poll(() => unsetArgs(page))
      .toContainEqual(expect.objectContaining({ key: 'diff.tool', path: REPO_PATH }));
    await expect(select).toHaveValue('');
  });

  test('surfaces an error and keeps the tool selected when the unset fails', async ({ page }) => {
    await injectCommandError(page, 'unset_git_config', 'error: could not unset merge.tool');
    await openSettings(page);
    const select = toolSelect(page, 'Merge Tool');
    await select.selectOption('meld');
    await expect(select).toHaveValue('meld');

    await select.selectOption('');

    await expect(page.locator('.toast.error, .error-banner').first()).toBeVisible();
    // The config still names Meld, so the select must not sit on "None".
    await expect(select).toHaveValue('meld');
  });

  test('clearing the merge tool touches merge.tool only', async ({ page }) => {
    await openSettings(page);
    const select = toolSelect(page, 'Merge Tool');
    await select.selectOption('meld');
    await select.selectOption('');

    await expect.poll(() => unsetArgs(page)).toHaveLength(1);
    // The custom mergetool.<name>.cmd is left in place: it is inert while no
    // tool is selected and the user may re-select that tool later.
    expect(await unsetArgs(page)).toEqual([
      { path: REPO_PATH, key: 'merge.tool', global: undefined },
    ]);
    await expect(toolSelect(page, 'Diff Tool')).toHaveValue('');
  });
});
