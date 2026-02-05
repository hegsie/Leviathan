import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import { LeftPanelPage } from '../pages/panels.page';

/**
 * E2E tests for Stash List Context Menu
 * Tests apply, pop, and drop stash operations via context menu
 */
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

    // Add command tracking and auto-confirm dialogs
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __INVOKED_COMMANDS__: { command: string; args: unknown }[];
      }).__INVOKED_COMMANDS__ = [];

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
          .__INVOKED_COMMANDS__.push({ command, args });

        // Auto-confirm dialogs
        if (command === 'plugin:dialog|confirm' || command === 'plugin:dialog|ask') {
          return true;
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should display stash items', async ({ page }) => {
    // Expand stashes section
    await leftPanel.expandStashes();

    // Should show 3 stash items
    const stashCount = await leftPanel.getStashCount();
    expect(stashCount).toBe(3);
  });

  test('should open context menu on right-click', async ({ page }) => {
    // Expand stashes section
    await leftPanel.expandStashes();

    // Right-click on first stash
    const firstStash = leftPanel.getStash(0);
    await firstStash.click({ button: 'right' });

    // Context menu should appear
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
    await applyOption.waitFor({ state: 'visible' });
    await applyOption.click();

    // Context menu should close
    const contextMenu = page.locator('.context-menu, .stash-context-menu');
    await expect(contextMenu).not.toBeVisible();
  });

  test('should invoke apply_stash command', async ({ page }) => {
    await leftPanel.expandStashes();

    const firstStash = leftPanel.getStash(0);
    await firstStash.click({ button: 'right' });

    const applyOption = page.locator('.context-menu-item, .menu-item', { hasText: /apply/i });
    await applyOption.waitFor({ state: 'visible' });
    await applyOption.click();

    await page.waitForTimeout(100);

    const commands = await page.evaluate(() => {
      return (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
        .__INVOKED_COMMANDS__;
    });

    const applyCommand = commands.find(c => c.command === 'apply_stash');
    expect(applyCommand).toBeDefined();
  });

  test('should close context menu after clicking Pop', async ({ page }) => {
    await leftPanel.expandStashes();

    const firstStash = leftPanel.getStash(0);
    await firstStash.click({ button: 'right' });

    const popOption = page.locator('.context-menu-item, .menu-item', { hasText: /pop/i });
    await popOption.waitFor({ state: 'visible' });
    await popOption.click();

    // Context menu should close
    const contextMenu = page.locator('.context-menu, .stash-context-menu');
    await expect(contextMenu).not.toBeVisible();
  });

  test('should invoke pop_stash command', async ({ page }) => {
    await leftPanel.expandStashes();

    const firstStash = leftPanel.getStash(0);
    await firstStash.click({ button: 'right' });

    const popOption = page.locator('.context-menu-item, .menu-item', { hasText: /pop/i });
    await popOption.waitFor({ state: 'visible' });
    await popOption.click();

    await page.waitForTimeout(100);

    const commands = await page.evaluate(() => {
      return (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
        .__INVOKED_COMMANDS__;
    });

    const popCommand = commands.find(c => c.command === 'pop_stash');
    expect(popCommand).toBeDefined();
  });

  test('should close context menu after clicking Drop', async ({ page }) => {
    await leftPanel.expandStashes();

    const firstStash = leftPanel.getStash(0);
    await firstStash.click({ button: 'right' });

    const dropOption = page.locator('.context-menu-item, .menu-item', { hasText: /drop|delete/i });
    await dropOption.waitFor({ state: 'visible' });
    await dropOption.click();

    // May show confirmation dialog - look for it in a dialog/modal container
    await page.waitForTimeout(100);
    const confirmDialog = page.locator('.dialog, .modal, [role="dialog"]');
    if (await confirmDialog.count() > 0) {
      const confirmButton = confirmDialog.locator('button', { hasText: /confirm|yes|ok|drop/i }).first();
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }
    }

    // Context menu should close
    const contextMenu = page.locator('.context-menu, .stash-context-menu');
    await expect(contextMenu).not.toBeVisible();
  });

  test('should invoke drop_stash command', async ({ page }) => {
    await leftPanel.expandStashes();

    const firstStash = leftPanel.getStash(0);
    await firstStash.click({ button: 'right' });

    const dropOption = page.locator('.context-menu-item, .menu-item', { hasText: /drop|delete/i });
    await dropOption.waitFor({ state: 'visible' });
    // Use evaluate to click - context menu may extend outside viewport
    await dropOption.evaluate((el: HTMLElement) => el.click());

    // Handle potential confirmation dialog - look for it in a dialog/modal container
    await page.waitForTimeout(100);
    const confirmDialog = page.locator('.dialog, .modal, [role="dialog"]');
    if (await confirmDialog.count() > 0) {
      const confirmButton = confirmDialog.locator('button', { hasText: /confirm|yes|ok|drop/i }).first();
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }
    }

    await page.waitForTimeout(100);

    const commands = await page.evaluate(() => {
      return (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
        .__INVOKED_COMMANDS__;
    });

    const dropCommand = commands.find(c => c.command === 'drop_stash');
    expect(dropCommand).toBeDefined();
  });

  test('should pass correct stash index to commands', async ({ page }) => {
    await leftPanel.expandStashes();

    // Right-click on second stash (index 1)
    const secondStash = leftPanel.getStash(1);
    await secondStash.click({ button: 'right' });

    const applyOption = page.locator('.context-menu-item, .menu-item', { hasText: /apply/i });
    await applyOption.waitFor({ state: 'visible' });
    await applyOption.click();

    await page.waitForTimeout(100);

    const commands = await page.evaluate(() => {
      return (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
        .__INVOKED_COMMANDS__;
    });

    const applyCommand = commands.find(c => c.command === 'apply_stash');
    expect(applyCommand).toBeDefined();
    // Check that index 1 was passed
    expect((applyCommand?.args as { index?: number })?.index).toBe(1);
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

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'plugin:dialog|confirm' || command === 'plugin:dialog|ask') {
          return true;
        }
        return originalInvoke(command, args);
      };
    });
  });

  test('should dispatch repository-changed event after stash apply', async ({ page }) => {
    const eventPromise = page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        document.addEventListener('repository-changed', () => {
          resolve(true);
        }, { once: true });
        setTimeout(() => resolve(false), 3000);
      });
    });

    await leftPanel.expandStashes();
    const stash = leftPanel.getStash(0);
    await stash.click({ button: 'right' });

    const applyOption = page.locator('.context-menu-item, .menu-item', { hasText: /apply/i });
    await applyOption.waitFor({ state: 'visible' });
    await applyOption.click();

    const eventReceived = await eventPromise;
    expect(eventReceived).toBe(true);
  });

  test('should dispatch repository-changed event after stash pop', async ({ page }) => {
    const eventPromise = page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        document.addEventListener('repository-changed', () => {
          resolve(true);
        }, { once: true });
        setTimeout(() => resolve(false), 3000);
      });
    });

    await leftPanel.expandStashes();
    const stash = leftPanel.getStash(0);
    await stash.click({ button: 'right' });

    const popOption = page.locator('.context-menu-item, .menu-item', { hasText: /pop/i });
    await popOption.waitFor({ state: 'visible' });
    await popOption.click();

    const eventReceived = await eventPromise;
    expect(eventReceived).toBe(true);
  });

  test('should dispatch repository-changed event after stash drop', async ({ page }) => {
    const eventPromise = page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        document.addEventListener('repository-changed', () => {
          resolve(true);
        }, { once: true });
        setTimeout(() => resolve(false), 3000);
      });
    });

    await leftPanel.expandStashes();
    const stash = leftPanel.getStash(0);
    await stash.click({ button: 'right' });

    const dropOption = page.locator('.context-menu-item, .menu-item', { hasText: /drop/i });
    await dropOption.waitFor({ state: 'visible' });
    await dropOption.evaluate((el: HTMLElement) => el.click());

    // Handle confirmation dialog
    await page.waitForTimeout(100);
    const confirmDialog = page.locator('.dialog, .modal, [role="dialog"]');
    if (await confirmDialog.count() > 0) {
      const confirmButton = confirmDialog.locator('button', { hasText: /confirm|yes|ok|drop/i }).first();
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }
    }

    const eventReceived = await eventPromise;
    expect(eventReceived).toBe(true);
  });
});
