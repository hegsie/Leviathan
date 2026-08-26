import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import { openViaCommandPalette } from '../fixtures/test-helpers';

/**
 * E2E tests for the Credential Management dialog (lv-credentials-dialog).
 *
 * A URL-scoped credential helper (`credential.<url>.helper`) can be written in
 * any git config file. Removing one has to target the file it actually lives
 * in — the backend refuses a `--local` unset without a repository path, and a
 * `--local` unset never touches the global file. These tests install a
 * stateful mock that only drops the helper when the removal is aimed
 * correctly, so a wrong-target call reproduces the "confirm and nothing
 * happens" loop instead of silently passing.
 */
async function mockCredentialHelpers(
  page: import('@playwright/test').Page,
  helper: { name: string; command: string; scope: string; configScope: string; urlPattern: string | null }
): Promise<void> {
  await page.evaluate((initialHelper) => {
    const win = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      __HELPERS__: unknown[];
    };
    const originalInvoke = win.__TAURI_INTERNALS__.invoke;
    win.__HELPERS__ = [initialHelper];

    win.__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
      switch (command) {
        case 'get_credential_helpers':
          return win.__HELPERS__;
        case 'get_available_helpers':
          return [];
        case 'detect_credential_manager':
          return null;
        case 'unset_credential_helper': {
          const params = args as { path?: string | null; global?: boolean; urlPattern?: string };
          // Faithful to the backend: `--local` without a repository path is
          // refused, and the wrong scope simply does not touch this file.
          const wantsGlobal = initialHelper.configScope === 'global';
          const aimedRight = wantsGlobal
            ? params.global === true
            : params.global !== true && typeof params.path === 'string' && params.path.length > 0;
          if (aimedRight) {
            win.__HELPERS__ = [];
          }
          return null;
        }
        // showConfirm() resolves true only for the OK button label.
        case 'plugin:dialog|message':
          return 'Ok';
        default:
          return originalInvoke(command, args);
      }
    };
  }, helper);
}

async function openCredentialsDialog(page: import('@playwright/test').Page): Promise<void> {
  await openViaCommandPalette(page, 'Credential Management');
  await page
    .locator('lv-credentials-dialog lv-modal[open]')
    .waitFor({ state: 'visible', timeout: 5000 });
}

test.describe('Credentials Dialog - removing URL-scoped helpers', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('removing a URL-scoped helper actually removes it from the list', async ({ page }) => {
    await mockCredentialHelpers(page, {
      name: 'manager',
      command: 'manager',
      scope: 'url',
      configScope: 'global',
      urlPattern: 'https://github.com',
    });
    await openCredentialsDialog(page);

    const helperItem = page.locator('lv-credentials-dialog .helper-item');
    await expect(helperItem).toHaveCount(1);

    await page.locator('lv-credentials-dialog .helper-item .btn-icon.danger').click();

    // Assert the settled, reloaded list — `.helper-item` is briefly absent
    // while loadData() renders its loading state, so an empty list on its own
    // would pass even when the removal did nothing.
    await expect(page.locator('lv-credentials-dialog .empty-state')).toContainText(
      'No credential helpers configured'
    );
    await expect(helperItem).toHaveCount(0);
    await expect(page.locator('lv-credentials-dialog .error-banner')).not.toBeVisible();
  });

  test('a system-scoped helper is not offered as removable', async ({ page }) => {
    await mockCredentialHelpers(page, {
      name: 'manager',
      command: 'manager',
      scope: 'url',
      configScope: 'system',
      urlPattern: 'https://github.com',
    });
    await openCredentialsDialog(page);

    const removeButton = page.locator('lv-credentials-dialog .helper-item .btn-icon.danger');
    await expect(removeButton).toBeDisabled();
    await expect(removeButton).toHaveAttribute('title', /system git config/);
  });
});
