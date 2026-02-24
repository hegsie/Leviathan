import { test, expect } from '@playwright/test';
import {
  setupProfilesAndAccounts,
  type MockUnifiedProfile,
  type MockIntegrationAccount,
} from '../fixtures/tauri-mock';
import { DialogsPage } from '../pages/dialogs.page';

/**
 * E2E Tests: Switching between integration accounts
 *
 * Tests that multiple accounts are listed in the dropdown, default badges
 * are shown, and switching between accounts updates the selector display.
 */

const defaultProfile: MockUnifiedProfile = {
  id: 'profile-1',
  name: 'Default',
  gitName: 'Test User',
  gitEmail: 'test@example.com',
  signingKey: null,
  urlPatterns: [],
  isDefault: true,
  color: '#4f46e5',
  defaultAccounts: { github: 'gh-acc-1' },
};

const account1: MockIntegrationAccount = {
  id: 'gh-acc-1',
  name: 'GitHub (personal)',
  integrationType: 'github',
  config: { type: 'github' },
  color: '#4f46e5',
  cachedUser: { username: 'personal-user', displayName: 'Personal User', avatarUrl: null },
  urlPatterns: [],
  isDefault: true,
};

const account2: MockIntegrationAccount = {
  id: 'gh-acc-2',
  name: 'GitHub (work)',
  integrationType: 'github',
  config: { type: 'github' },
  color: '#059669',
  cachedUser: { username: 'work-user', displayName: 'Work User', avatarUrl: null },
  urlPatterns: [],
  isDefault: false,
};

test.describe('Multi-Account - Switching Between Accounts', () => {
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    await setupProfilesAndAccounts(
      page,
      {
        profiles: [defaultProfile],
        accounts: [account1, account2],
        connectedAccounts: ['gh-acc-1', 'gh-acc-2'],
      },
    );

    dialogs = new DialogsPage(page);
  });

  test('should list both accounts in the dropdown', async ({ page }) => {
    // Open GitHub dialog
    await page.locator('lv-toolbar').getByRole('button', { name: /GitHub/i }).click();
    await page.waitForTimeout(300);

    // Click the account selector to open dropdown
    const selectorBtn = page.locator('lv-github-dialog lv-account-selector .selector-btn');
    await selectorBtn.click();
    await page.waitForTimeout(200);

    // Both accounts should be listed
    const dropdownItems = page.locator('lv-github-dialog lv-account-selector .dropdown-item');
    const count = await dropdownItems.count();
    expect(count).toBe(2);

    // Check account names are present
    const dropdownText = await page.locator('lv-github-dialog lv-account-selector .dropdown').textContent();
    expect(dropdownText).toContain('GitHub (personal)');
    expect(dropdownText).toContain('GitHub (work)');
  });

  test('should show Default badge on the default account', async ({ page }) => {
    // Open GitHub dialog
    await page.locator('lv-toolbar').getByRole('button', { name: /GitHub/i }).click();
    await page.waitForTimeout(300);

    // Open dropdown
    const selectorBtn = page.locator('lv-github-dialog lv-account-selector .selector-btn');
    await selectorBtn.click();
    await page.waitForTimeout(200);

    // The default account should have a "Default" badge
    const defaultBadge = page.locator('lv-github-dialog lv-account-selector .default-badge');
    await expect(defaultBadge).toBeVisible();
    const badgeText = await defaultBadge.textContent();
    expect(badgeText).toContain('Default');

    // Only one default badge should exist
    const badgeCount = await page.locator('lv-github-dialog lv-account-selector .default-badge').count();
    expect(badgeCount).toBe(1);
  });

  test('should update selector display when switching accounts', async ({ page }) => {
    // Open GitHub dialog
    await page.locator('lv-toolbar').getByRole('button', { name: /GitHub/i }).click();
    await page.waitForTimeout(300);

    // Verify the initial account is shown
    const selectorText = page.locator('lv-github-dialog lv-account-selector .account-name');
    await expect(selectorText).toHaveText('GitHub (personal)');

    // Open dropdown and click second account
    const selectorBtn = page.locator('lv-github-dialog lv-account-selector .selector-btn');
    await selectorBtn.click();
    await page.waitForTimeout(200);

    // Select the second account
    const workAccountItem = page.locator('lv-github-dialog lv-account-selector .dropdown-item', { hasText: 'GitHub (work)' });
    await workAccountItem.click();
    await page.waitForTimeout(300);

    // The selector should now show the second account
    await expect(selectorText).toHaveText('GitHub (work)');
  });

  test('should show Manage Accounts option in dropdown', async ({ page }) => {
    // Open GitHub dialog
    await page.locator('lv-toolbar').getByRole('button', { name: /GitHub/i }).click();
    await page.waitForTimeout(300);

    // Open dropdown
    const selectorBtn = page.locator('lv-github-dialog lv-account-selector .selector-btn');
    await selectorBtn.click();
    await page.waitForTimeout(200);

    // Should show "Manage Accounts..." action
    const manageBtn = page.locator('lv-github-dialog lv-account-selector .dropdown-action:has-text("Manage Accounts")');
    await expect(manageBtn).toBeVisible();
  });
});
