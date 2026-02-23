import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import {
  startCommandCaptureWithMocks,
  findCommand,
  injectCommandError,
  openViaCommandPalette,
  autoConfirmDialogs,
} from '../fixtures/test-helpers';

/**
 * E2E tests for the Git Configuration Dialog (lv-config-dialog).
 *
 * The dialog has three tabs: Identity, Settings, and Aliases.
 * It is opened by setting showConfig = true on the app-shell and renders
 * inside an lv-modal with the title "Git Configuration".
 */

/** Open the config dialog via the command palette and wait for it to appear */
async function openConfigDialog(page: import('@playwright/test').Page): Promise<void> {
  await openViaCommandPalette(page, 'Git Configuration');
  // Wait for the modal inside to be visible (the custom element itself has no :host display style)
  await page.locator('lv-config-dialog lv-modal[open]').waitFor({ state: 'visible', timeout: 5000 });
}

// --------------------------------------------------------------------------
// Identity Tab
// --------------------------------------------------------------------------
test.describe('Config Dialog - Identity Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await startCommandCaptureWithMocks(page, {
      get_user_identity: {
        name: 'Test User',
        email: 'test@example.com',
        nameIsGlobal: false,
        emailIsGlobal: true,
      },
      get_common_settings: [
        { key: 'core.autocrlf', value: 'input', scope: 'local' },
        { key: 'push.default', value: 'current', scope: 'global' },
      ],
      get_aliases: [
        { name: 'co', command: 'checkout', isGlobal: true },
        { name: 'st', command: 'status', isGlobal: false },
      ],
      set_user_identity: null,
    });

    await openConfigDialog(page);
  });

  test('should display the dialog with Identity tab active by default', async ({ page }) => {
    await expect(page.locator('lv-config-dialog lv-modal[open]')).toBeVisible();
    await expect(page.locator('lv-config-dialog .tab.active')).toHaveText('Identity');
  });

  test('should show Name and Email form fields populated from backend', async ({ page }) => {
    const inputs = page.locator('lv-config-dialog .form-group input');
    await expect(inputs.nth(0)).toHaveValue('Test User');
    await expect(inputs.nth(1)).toHaveValue('test@example.com');
  });

  test('should show scope toggle with Repository and Global buttons', async ({ page }) => {
    const scopeButtons = page.locator('lv-config-dialog .scope-btn');
    await expect(scopeButtons).toContainText(['Repository', 'Global']);
  });

  test('should show scope badge "from global" on email field', async ({ page }) => {
    await expect(page.locator('lv-config-dialog .scope-badge', { hasText: 'from global' })).toBeVisible();
  });

  test('should call set_user_identity when clicking Save', async ({ page }) => {
    await page.locator('lv-config-dialog .form-group input').first().fill('New Name');
    await page.locator('lv-config-dialog .btn-primary').click();

    const commands = await findCommand(page, 'set_user_identity');
    expect(commands.length).toBeGreaterThan(0);

    // Verify UI: no error banner should be visible after successful save
    await expect(page.locator('lv-config-dialog .error-banner')).not.toBeVisible();

    // Verify UI: the dialog should still be open (identity save does not close the dialog)
    await expect(page.locator('lv-config-dialog lv-modal[open]')).toBeVisible();
  });

  test('should show error banner when save fails', async ({ page }) => {
    await injectCommandError(page, 'set_user_identity', 'Permission denied');
    await page.locator('lv-config-dialog .btn-primary').click();
    await expect(page.locator('lv-config-dialog .error-banner')).toBeVisible();
  });
});

// --------------------------------------------------------------------------
// Settings Tab
// --------------------------------------------------------------------------
test.describe('Config Dialog - Settings Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await startCommandCaptureWithMocks(page, {
      get_user_identity: {
        name: 'Test User',
        email: 'test@example.com',
        nameIsGlobal: false,
        emailIsGlobal: false,
      },
      get_common_settings: [
        { key: 'core.autocrlf', value: 'input', scope: 'local' },
        { key: 'push.default', value: 'current', scope: 'global' },
      ],
      get_aliases: [],
      set_config_value: null,
    });

    await openConfigDialog(page);

    await page.locator('lv-config-dialog .tab', { hasText: 'Settings' }).click();
    await page.locator('lv-config-dialog .settings-list, lv-config-dialog .setting-item').first().waitFor({ state: 'visible' });
  });

  test('should display setting items loaded from backend', async ({ page }) => {
    await expect(page.locator('lv-config-dialog .setting-item')).toHaveCount(2);
  });

  test('each setting should show its key and scope badge', async ({ page }) => {
    const items = page.locator('lv-config-dialog .setting-item');

    await expect(items.nth(0).locator('.setting-key')).toHaveText('core.autocrlf');
    await expect(items.nth(0).locator('.scope-badge')).toHaveText('local');
    await expect(items.nth(1).locator('.setting-key')).toHaveText('push.default');
    await expect(items.nth(1).locator('.scope-badge')).toHaveText('global');
  });

  test('changing a setting value should call set_config_value', async ({ page }) => {
    const input = page.locator('lv-config-dialog .setting-value input').first();
    await input.fill('true');
    await input.dispatchEvent('change');

    const commands = await findCommand(page, 'set_config_value');
    expect(commands.length).toBeGreaterThan(0);

    // Verify UI: no error banner should appear after successful save
    await expect(page.locator('lv-config-dialog .error-banner')).not.toBeVisible();

    // Verify UI: the input should reflect the updated value
    await expect(input).toHaveValue('true');
  });

  test('should show error banner when setting save fails', async ({ page }) => {
    await injectCommandError(page, 'set_config_value', 'Failed to write config');

    const input = page.locator('lv-config-dialog .setting-value input').first();
    await input.fill('true');
    await input.dispatchEvent('change');

    await expect(page.locator('lv-config-dialog .error-banner')).toBeVisible();
  });
});

// --------------------------------------------------------------------------
// Settings Tab - Empty State
// --------------------------------------------------------------------------
test.describe('Config Dialog - Settings Tab Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await startCommandCaptureWithMocks(page, {
      get_user_identity: { name: '', email: '', nameIsGlobal: false, emailIsGlobal: false },
      get_common_settings: [],
      get_aliases: [],
    });

    await openConfigDialog(page);

    await page.locator('lv-config-dialog .tab', { hasText: 'Settings' }).click();
    await page.locator('lv-config-dialog .empty-state, lv-config-dialog .settings-list').first().waitFor({ state: 'visible' });
  });

  test('should show empty state when no settings configured', async ({ page }) => {
    await expect(page.locator('lv-config-dialog .empty-state', { hasText: 'No common settings' })).toBeVisible();
  });
});

// --------------------------------------------------------------------------
// Aliases Tab
// --------------------------------------------------------------------------
test.describe('Config Dialog - Aliases Tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await startCommandCaptureWithMocks(page, {
      get_user_identity: { name: 'Test User', email: 'test@example.com', nameIsGlobal: false, emailIsGlobal: false },
      get_common_settings: [],
      get_aliases: [
        { name: 'co', command: 'checkout', isGlobal: true },
        { name: 'st', command: 'status', isGlobal: false },
      ],
      set_alias: null,
      delete_alias: null,
    });

    await openConfigDialog(page);

    await page.locator('lv-config-dialog .tab', { hasText: 'Aliases' }).click();
    await page.locator('lv-config-dialog .alias-list, lv-config-dialog .alias-item').first().waitFor({ state: 'visible' });
  });

  test('should display existing aliases', async ({ page }) => {
    await expect(page.locator('lv-config-dialog .alias-item')).toHaveCount(2);
  });

  test('each alias should show name, command, and scope badge', async ({ page }) => {
    const items = page.locator('lv-config-dialog .alias-item');

    await expect(items.nth(0).locator('.alias-name')).toContainText('co');
    await expect(items.nth(0).locator('.alias-name')).toContainText('global');
    await expect(items.nth(0).locator('.alias-command')).toHaveText('checkout');
    await expect(items.nth(1).locator('.alias-name')).toContainText('st');
    await expect(items.nth(1).locator('.alias-command')).toHaveText('status');
  });

  test('should have Add New Alias form with name and command inputs', async ({ page }) => {
    const formInputs = page.locator('lv-config-dialog .add-alias-form input');
    await expect(formInputs).toHaveCount(2);
  });

  test('Add button should be disabled when inputs are empty', async ({ page }) => {
    await expect(page.locator('lv-config-dialog .add-alias-form .btn-primary')).toBeDisabled();
  });

  test('filling alias name and command then clicking Add should call set_alias', async ({ page }) => {
    const inputs = page.locator('lv-config-dialog .inline-form input');
    await inputs.nth(0).fill('br');
    await inputs.nth(1).fill('branch');

    await page.locator('lv-config-dialog .add-alias-form .btn-primary').click();

    const commands = await findCommand(page, 'set_alias');
    expect(commands.length).toBeGreaterThan(0);

    // Verify UI: no error banner should appear after successful add
    await expect(page.locator('lv-config-dialog .error-banner')).not.toBeVisible();
  });

  test('clicking delete button on alias should call delete_alias', async ({ page }) => {
    // Mock native confirm() since the component uses it directly
    await page.evaluate(() => { window.confirm = () => true; });

    // Verify initial alias count before deletion
    await expect(page.locator('lv-config-dialog .alias-item')).toHaveCount(2);

    await page.locator('lv-config-dialog .btn-icon.danger').first().click();

    const commands = await findCommand(page, 'delete_alias');
    expect(commands.length).toBeGreaterThan(0);

    // Verify UI: no error banner should appear after successful deletion
    await expect(page.locator('lv-config-dialog .error-banner')).not.toBeVisible();
  });

  test('should show error banner when adding alias fails', async ({ page }) => {
    await injectCommandError(page, 'set_alias', 'Alias already exists');

    const inputs = page.locator('lv-config-dialog .inline-form input');
    await inputs.nth(0).fill('co');
    await inputs.nth(1).fill('checkout');

    await page.locator('lv-config-dialog .add-alias-form .btn-primary').click();

    await expect(page.locator('lv-config-dialog .error-banner')).toBeVisible();
  });
});

// --------------------------------------------------------------------------
// Aliases Tab - Empty State
// --------------------------------------------------------------------------
test.describe('Config Dialog - Aliases Tab Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await startCommandCaptureWithMocks(page, {
      get_user_identity: { name: '', email: '', nameIsGlobal: false, emailIsGlobal: false },
      get_common_settings: [],
      get_aliases: [],
    });

    await openConfigDialog(page);

    await page.locator('lv-config-dialog .tab', { hasText: 'Aliases' }).click();
    await page.locator('lv-config-dialog .empty-state, lv-config-dialog .add-alias-form').first().waitFor({ state: 'visible' });
  });

  test('should show empty state when no aliases configured', async ({ page }) => {
    await expect(page.locator('lv-config-dialog .empty-state', { hasText: 'No aliases' })).toBeVisible();
  });
});

// --------------------------------------------------------------------------
// Tab Navigation
// --------------------------------------------------------------------------
test.describe('Config Dialog - Tab Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await startCommandCaptureWithMocks(page, {
      get_user_identity: { name: 'Test User', email: 'test@example.com', nameIsGlobal: false, emailIsGlobal: false },
      get_common_settings: [
        { key: 'core.autocrlf', value: 'input', scope: 'local' },
      ],
      get_aliases: [
        { name: 'co', command: 'checkout', isGlobal: true },
      ],
    });

    await openConfigDialog(page);
  });

  test('should have Identity, Settings, and Aliases tabs', async ({ page }) => {
    const tabs = page.locator('lv-config-dialog .tab');
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toHaveText('Identity');
    await expect(tabs.nth(1)).toHaveText('Settings');
    await expect(tabs.nth(2)).toHaveText('Aliases');
  });

  test('clicking Settings tab should show settings list', async ({ page }) => {
    await page.locator('lv-config-dialog .tab', { hasText: 'Settings' }).click();
    await expect(page.locator('lv-config-dialog .settings-list')).toBeVisible();
  });

  test('clicking Aliases tab should show alias list', async ({ page }) => {
    await page.locator('lv-config-dialog .tab', { hasText: 'Aliases' }).click();
    await expect(page.locator('lv-config-dialog .alias-list, lv-config-dialog .add-alias-form').first()).toBeVisible();
  });

  test('dialog should close when modal close event fires', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('lv-config-dialog');
      if (el) {
        el.dispatchEvent(new CustomEvent('close', { bubbles: true }));
      }
    });

    const isOpen = await page.evaluate(() => {
      const appShell = document.querySelector('app-shell') as HTMLElement & { showConfig: boolean };
      return appShell?.showConfig ?? false;
    });
    expect(isOpen).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Loading State
// --------------------------------------------------------------------------
test.describe('Config Dialog - Loading State', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await startCommandCaptureWithMocks(page, {
      get_user_identity: { name: 'Test', email: 'test@test.com', nameIsGlobal: false, emailIsGlobal: false },
      get_common_settings: [],
      get_aliases: [],
    });
  });

  test('should call get_user_identity, get_common_settings, and get_aliases on open', async ({ page }) => {
    await openConfigDialog(page);

    const identityCmds = await findCommand(page, 'get_user_identity');
    const settingsCmds = await findCommand(page, 'get_common_settings');
    const aliasesCmds = await findCommand(page, 'get_aliases');

    expect(identityCmds.length).toBeGreaterThan(0);
    expect(settingsCmds.length).toBeGreaterThan(0);
    expect(aliasesCmds.length).toBeGreaterThan(0);

    // Verify UI: the dialog should be visible and populated with identity data
    await expect(page.locator('lv-config-dialog lv-modal[open]')).toBeVisible();
    await expect(page.locator('lv-config-dialog .form-group input').first()).toHaveValue('Test');
    await expect(page.locator('lv-config-dialog .form-group input').nth(1)).toHaveValue('test@test.com');
  });
});
