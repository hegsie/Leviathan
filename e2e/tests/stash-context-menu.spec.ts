import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import { LeftPanelPage } from '../pages/panels.page';
import {
  startCommandCaptureWithMocks,
  startCommandCapture,
  findCommand,
  injectCommandError,
  injectCommandMock,
  waitForRepositoryChanged,
} from '../fixtures/test-helpers';

test.describe('Stash List Context Menu', () => {
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    leftPanel = new LeftPanelPage(page);

    await setupOpenRepository(page, {
      stashes: [
        { index: 0, message: 'WIP on main: abc123 first stash', oid: 'stash1' },
        { index: 1, message: 'WIP on feature: def456 second stash', oid: 'stash2' },
        { index: 2, message: 'WIP on develop: ghi789 third stash', oid: 'stash3' },
      ],
    });

    await startCommandCaptureWithMocks(page, {
      'plugin:dialog|confirm': true,
      'plugin:dialog|ask': true,
    });
  });

  test('should display stash items', async ({ page }) => {
    await leftPanel.expandStashes();

    const stashCount = await leftPanel.getStashCount();
    expect(stashCount).toBe(3);
  });

  test('should open context menu on right-click', async ({ page }) => {
    await leftPanel.expandStashes();

    const firstStash = leftPanel.getStash(0);
    await firstStash.click({ button: 'right' });

    const contextMenu = page.locator('.context-menu, .stash-context-menu');
    await expect(contextMenu).toBeVisible();
  });

  test('should show Apply option in context menu', async ({ page }) => {
    await leftPanel.expandStashes();

    const firstStash = leftPanel.getStash(0);
    await firstStash.click({ button: 'right' });

    const applyOption = page.locator('.context-menu-item, .menu-item', { hasText: /apply/i });
    await expect(applyOption).toBeVisible();
  });

  test('should show Pop option in context menu', async ({ page }) => {
    await leftPanel.expandStashes();

    const firstStash = leftPanel.getStash(0);
    await firstStash.click({ button: 'right' });

    const popOption = page.locator('.context-menu-item, .menu-item', { hasText: /pop/i });
    await expect(popOption).toBeVisible();
  });

  test('should show Drop option in context menu', async ({ page }) => {
    await leftPanel.expandStashes();

    const firstStash = leftPanel.getStash(0);
    await firstStash.click({ button: 'right' });

    const dropOption = page.locator('.context-menu-item, .menu-item', { hasText: /drop|delete/i });
    await expect(dropOption).toBeVisible();
  });

  test('should close context menu after clicking Apply', async ({ page }) => {
    await leftPanel.expandStashes();

    const firstStash = leftPanel.getStash(0);
    await firstStash.click({ button: 'right' });

    const applyOption = page.locator('.context-menu-item, .menu-item', { hasText: /apply/i });
    await expect(applyOption).toBeVisible();
    await applyOption.click();

    const contextMenu = page.locator('.context-menu, .stash-context-menu');
    await expect(contextMenu).not.toBeVisible();
  });

  test('should invoke apply_stash command', async ({ page }) => {
    await leftPanel.expandStashes();

    const firstStash = leftPanel.getStash(0);
    await firstStash.click({ button: 'right' });

    const applyOption = page.locator('.context-menu-item, .menu-item', { hasText: /apply/i });
    await expect(applyOption).toBeVisible();
    await applyOption.click();

    const applyCommands = await findCommand(page, 'apply_stash');
    expect(applyCommands.length).toBeGreaterThan(0);
  });

  test('should close context menu after clicking Pop', async ({ page }) => {
    await leftPanel.expandStashes();

    const firstStash = leftPanel.getStash(0);
    await firstStash.click({ button: 'right' });

    const popOption = page.locator('.context-menu-item, .menu-item', { hasText: /pop/i });
    await expect(popOption).toBeVisible();
    await popOption.click();

    const contextMenu = page.locator('.context-menu, .stash-context-menu');
    await expect(contextMenu).not.toBeVisible();
  });

  test('should invoke pop_stash command', async ({ page }) => {
    await leftPanel.expandStashes();

    const firstStash = leftPanel.getStash(0);
    await firstStash.click({ button: 'right' });

    const popOption = page.locator('.context-menu-item, .menu-item', { hasText: /pop/i });
    await expect(popOption).toBeVisible();
    await popOption.click();

    const popCommands = await findCommand(page, 'pop_stash');
    expect(popCommands.length).toBeGreaterThan(0);

    const stashCount = await leftPanel.getStashCount();
    expect(stashCount).toBe(2);
  });

  test('should close context menu after clicking Drop', async ({ page }) => {
    await leftPanel.expandStashes();

    const firstStash = leftPanel.getStash(0);
    await firstStash.click({ button: 'right' });

    const dropOption = page.locator('.context-menu-item, .menu-item', { hasText: /drop|delete/i });
    await expect(dropOption).toBeVisible();
    await dropOption.click();

    const contextMenu = page.locator('.context-menu, .stash-context-menu');
    await expect(contextMenu).not.toBeVisible();
  });

  test('should invoke drop_stash command', async ({ page }) => {
    await leftPanel.expandStashes();

    const firstStash = leftPanel.getStash(0);
    await firstStash.click({ button: 'right' });

    const dropOption = page.locator('.context-menu-item, .menu-item', { hasText: /drop|delete/i });
    await expect(dropOption).toBeVisible();
    await dropOption.click();

    const dropCommands = await findCommand(page, 'drop_stash');
    expect(dropCommands.length).toBeGreaterThan(0);

    const stashCount = await leftPanel.getStashCount();
    expect(stashCount).toBe(2);
  });

  test('should pass correct stash index to commands', async ({ page }) => {
    await leftPanel.expandStashes();

    const secondStash = leftPanel.getStash(1);
    await secondStash.click({ button: 'right' });

    const applyOption = page.locator('.context-menu-item, .menu-item', { hasText: /apply/i });
    await expect(applyOption).toBeVisible();
    await applyOption.click();

    const applyCommands = await findCommand(page, 'apply_stash');
    expect(applyCommands.length).toBeGreaterThan(0);
    expect((applyCommands[0]?.args as { index?: number })?.index).toBe(1);
  });
});

test.describe('Stash Context Menu - Event Propagation', () => {
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    leftPanel = new LeftPanelPage(page);

    await setupOpenRepository(page, {
      stashes: [
        { index: 0, message: 'WIP on main: abc123 first stash', oid: 'stash1' },
      ],
    });

    await injectCommandMock(page, {
      'plugin:dialog|confirm': true,
      'plugin:dialog|ask': true,
    });
  });

  test('should dispatch repository-changed event after stash apply', async ({ page }) => {
    await leftPanel.expandStashes();

    const eventReceived = await waitForRepositoryChanged(page, async () => {
      const stash = leftPanel.getStash(0);
      await stash.click({ button: 'right' });

      const applyOption = page.locator('.context-menu-item, .menu-item', { hasText: /apply/i });
      await expect(applyOption).toBeVisible();
      await applyOption.click();
    });

    expect(eventReceived).toBe(true);
  });

  test('should dispatch repository-changed event after stash pop', async ({ page }) => {
    await leftPanel.expandStashes();

    const eventReceived = await waitForRepositoryChanged(page, async () => {
      const stash = leftPanel.getStash(0);
      await stash.click({ button: 'right' });

      const popOption = page.locator('.context-menu-item, .menu-item', { hasText: /pop/i });
      await expect(popOption).toBeVisible();
      await popOption.click();
    });

    expect(eventReceived).toBe(true);
  });

  test('should dispatch repository-changed event after stash drop', async ({ page }) => {
    await leftPanel.expandStashes();

    const eventReceived = await waitForRepositoryChanged(page, async () => {
      const stash = leftPanel.getStash(0);
      await stash.click({ button: 'right' });

      const dropOption = page.locator('.context-menu-item, .menu-item', { hasText: /drop/i });
      await expect(dropOption).toBeVisible();
      await dropOption.click();
    });

    expect(eventReceived).toBe(true);
  });
});

test.describe('Stash Context Menu - Error Handling', () => {
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    leftPanel = new LeftPanelPage(page);

    await setupOpenRepository(page, {
      stashes: [
        { index: 0, message: 'WIP on main: abc123 first stash', oid: 'stash1' },
      ],
    });
  });

  test('should show error toast when apply_stash fails', async ({ page }) => {
    await injectCommandError(page, 'apply_stash', 'Apply failed: conflicts detected');

    await leftPanel.expandStashes();
    const stash = leftPanel.getStash(0);
    await stash.click({ button: 'right' });

    const applyOption = page.locator('.context-menu-item, .menu-item', { hasText: /apply/i });
    await expect(applyOption).toBeVisible();
    await applyOption.click();

    const errorToast = page.locator('lv-toast-container .toast.error').first();
    await expect(errorToast).toBeVisible({ timeout: 5000 });
    await expect(errorToast).toContainText('Apply failed');
  });

  test('should show error toast when pop_stash fails', async ({ page }) => {
    await injectCommandError(page, 'pop_stash', 'Pop failed: working directory not clean');

    await leftPanel.expandStashes();
    const stash = leftPanel.getStash(0);
    await stash.click({ button: 'right' });

    const popOption = page.locator('.context-menu-item, .menu-item', { hasText: /pop/i });
    await expect(popOption).toBeVisible();
    await popOption.click();

    const errorToast = page.locator('lv-toast-container .toast.error').first();
    await expect(errorToast).toBeVisible({ timeout: 5000 });
    await expect(errorToast).toContainText('Pop failed');
  });

  test('should show error toast when drop_stash fails', async ({ page }) => {
    await injectCommandMock(page, {
      'plugin:dialog|confirm': true,
      'plugin:dialog|ask': true,
    });

    await injectCommandError(page, 'drop_stash', 'Drop failed: stash not found');

    await leftPanel.expandStashes();
    const stash = leftPanel.getStash(0);
    await stash.click({ button: 'right' });

    const dropOption = page.locator('.context-menu-item, .menu-item', { hasText: /drop|delete/i });
    await expect(dropOption).toBeVisible();
    await dropOption.click();

    const errorToast = page.locator('lv-toast-container .toast.error').first();
    await expect(errorToast).toBeVisible({ timeout: 5000 });
    await expect(errorToast).toContainText('Drop failed');
  });

  test('should keep stash list unchanged after apply failure', async ({ page }) => {
    await injectCommandError(page, 'apply_stash', 'Apply failed: conflicts');

    await leftPanel.expandStashes();

    const stash = leftPanel.getStash(0);
    await stash.click({ button: 'right' });

    const applyOption = page.locator('.context-menu-item, .menu-item', { hasText: /apply/i });
    await expect(applyOption).toBeVisible();
    await applyOption.click();

    const stashCount = await leftPanel.getStashCount();
    expect(stashCount).toBe(1);
  });

  test('should verify drop triggers get_stashes refresh on success', async ({ page }) => {
    await startCommandCaptureWithMocks(page, {
      'plugin:dialog|confirm': true,
      'plugin:dialog|ask': true,
    });

    await leftPanel.expandStashes();
    const stash = leftPanel.getStash(0);
    await stash.click({ button: 'right' });

    const dropOption = page.locator('.context-menu-item, .menu-item', { hasText: /drop|delete/i });
    await expect(dropOption).toBeVisible();
    await dropOption.click();

    const stashCommands = await findCommand(page, 'get_stashes');
    expect(stashCommands.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Extended Tests - Additional Coverage
// ============================================================================

test.describe('Stash Context Menu - Extended Tests', () => {
  let leftPanel: LeftPanelPage;

  test('apply with CONFLICT error should show error toast', async ({ page }) => {
    leftPanel = new LeftPanelPage(page);

    await setupOpenRepository(page, {
      stashes: [
        { index: 0, message: 'WIP on main: abc123 first stash', oid: 'stash1' },
        { index: 1, message: 'WIP on feature: def456 second stash', oid: 'stash2' },
      ],
    });

    await injectCommandError(page, 'apply_stash', 'CONFLICT (content): Merge conflict in src/main.ts');

    await leftPanel.expandStashes();
    const stash = leftPanel.getStash(0);
    await stash.click({ button: 'right' });

    const applyOption = page.locator('.context-menu-item, .menu-item', { hasText: /apply/i });
    await expect(applyOption).toBeVisible();
    await applyOption.click();

    const errorToast = page.locator('lv-toast-container .toast.error').first();
    await expect(errorToast).toBeVisible({ timeout: 5000 });
    await expect(errorToast).toContainText('CONFLICT');

    // Stash list should remain unchanged after a failed apply
    const stashCount = await leftPanel.getStashCount();
    expect(stashCount).toBe(2);
  });

  test('pop should remove stash from the list on success', async ({ page }) => {
    leftPanel = new LeftPanelPage(page);

    await setupOpenRepository(page, {
      stashes: [
        { index: 0, message: 'WIP on main: abc123 first stash', oid: 'stash1' },
        { index: 1, message: 'WIP on feature: def456 second stash', oid: 'stash2' },
        { index: 2, message: 'WIP on develop: ghi789 third stash', oid: 'stash3' },
      ],
    });

    await startCommandCaptureWithMocks(page, {
      'plugin:dialog|confirm': true,
      'plugin:dialog|ask': true,
    });

    await leftPanel.expandStashes();

    // Verify initial count is 3
    const initialCount = await leftPanel.getStashCount();
    expect(initialCount).toBe(3);

    // Pop the first stash
    const firstStash = leftPanel.getStash(0);
    await firstStash.click({ button: 'right' });

    const popOption = page.locator('.context-menu-item, .menu-item', { hasText: /pop/i });
    await expect(popOption).toBeVisible();
    await popOption.click();

    // Verify pop_stash command was called
    const popCommands = await findCommand(page, 'pop_stash');
    expect(popCommands.length).toBeGreaterThan(0);

    // Verify the stash count decreased to 2
    const finalCount = await leftPanel.getStashCount();
    expect(finalCount).toBe(2);
  });
});
