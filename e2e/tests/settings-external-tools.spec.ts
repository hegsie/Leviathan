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

/**
 * Serve the merge/diff tool config from mutable state so `unset_git_config`
 * behaves like the backend: `git config --unset` writes the repository-local
 * file only, so a tool configured globally survives the unset while the get_*
 * commands keep reporting the effective value.
 */
async function installToolConfigState(
  page: Page,
  scopes: { merge: 'local' | 'global'; diff: 'local' | 'global' },
): Promise<void> {
  await page.evaluate((s) => {
    const internals = (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__;
    const originalInvoke = internals.invoke;
    const state: { merge: string | null; diff: string | null } = {
      merge: 'meld',
      diff: 'vscode',
    };

    internals.invoke = async (command: string, args?: unknown) => {
      if (command === 'get_merge_tool_config') {
        return { toolName: state.merge, toolCmd: null };
      }
      if (command === 'get_diff_tool') {
        return { tool: state.diff, cmd: null, prompt: false };
      }
      const result = await originalInvoke(command, args);
      if (command === 'unset_git_config') {
        const key = (args as { key?: string } | undefined)?.key;
        if (key === 'merge.tool' && s.merge === 'local') state.merge = null;
        if (key === 'diff.tool' && s.diff === 'local') state.diff = null;
      }
      return result;
    };
  }, scopes);
}

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

  test('shows the configured tools as selected when Settings opens', async ({ page }) => {
    await openSettings(page);

    // The <select>'s .value binding commits before the <option>s rendered in the
    // same Lit update, so without a re-sync a configured tool renders as "None".
    await expect(toolSelect(page, 'Merge Tool')).toHaveValue('meld');
    await expect(toolSelect(page, 'Diff Tool')).toHaveValue('vscode');
  });

  test('clearing the merge tool from Settings unsets merge.tool', async ({ page }) => {
    await installToolConfigState(page, { merge: 'local', diff: 'local' });
    await openSettings(page);
    const select = toolSelect(page, 'Merge Tool');
    await expect(select).toHaveValue('meld');

    await select.selectOption('');

    await expect
      .poll(() => unsetArgs(page))
      .toContainEqual(expect.objectContaining({ key: 'merge.tool', path: REPO_PATH }));
    await expect(select).toHaveValue('');
  });

  test('clearing the diff tool from Settings unsets diff.tool', async ({ page }) => {
    await installToolConfigState(page, { merge: 'local', diff: 'local' });
    await openSettings(page);
    const select = toolSelect(page, 'Diff Tool');
    await expect(select).toHaveValue('vscode');

    await select.selectOption('');

    await expect
      .poll(() => unsetArgs(page))
      .toContainEqual(expect.objectContaining({ key: 'diff.tool', path: REPO_PATH }));
    await expect(select).toHaveValue('');
  });

  test('surfaces an error and keeps the tool selected when the unset fails', async ({ page }) => {
    await installToolConfigState(page, { merge: 'local', diff: 'local' });
    await injectCommandError(page, 'unset_git_config', 'error: could not unset merge.tool');
    await openSettings(page);
    const select = toolSelect(page, 'Merge Tool');
    await expect(select).toHaveValue('meld');

    await select.selectOption('');

    await expect(page.locator('.toast.error, .error-banner').first()).toBeVisible();
    // The config still names Meld, so the select must not sit on "None".
    await expect(select).toHaveValue('meld');
  });

  test('keeps the tool selected when merge.tool is configured outside the repository', async ({
    page,
  }) => {
    await installToolConfigState(page, { merge: 'global', diff: 'local' });
    await openSettings(page);
    const select = toolSelect(page, 'Merge Tool');
    await expect(select).toHaveValue('meld');

    await select.selectOption('');

    // The local unset is attempted, but merge.tool survives it, so the UI must
    // say so rather than showing "None" while git still launches Meld.
    await expect
      .poll(() => unsetArgs(page))
      .toContainEqual(expect.objectContaining({ key: 'merge.tool', path: REPO_PATH }));
    await expect(page.locator('.toast.error, .error-banner').first()).toBeVisible();
    await expect(select).toHaveValue('meld');
  });

  test('clearing the merge tool touches merge.tool only', async ({ page }) => {
    await installToolConfigState(page, { merge: 'local', diff: 'local' });
    await openSettings(page);
    const select = toolSelect(page, 'Merge Tool');
    await expect(select).toHaveValue('meld');
    await select.selectOption('');

    await expect.poll(() => unsetArgs(page)).toHaveLength(1);
    // The custom mergetool.<name>.cmd is left in place: it is inert while no
    // tool is selected and the user may re-select that tool later.
    expect(await unsetArgs(page)).toEqual([
      { path: REPO_PATH, key: 'merge.tool', global: undefined },
    ]);
    // The diff tool is untouched and stays on its configured value.
    await expect(toolSelect(page, 'Diff Tool')).toHaveValue('vscode');
  });
});
