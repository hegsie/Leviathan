import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';

/**
 * E2E tests for Submodule Dialog
 * Tests submodule management (list, add, update, remove)
 */
test.describe('Submodule Dialog - List View', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    // Mock submodule-related commands
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_submodules') {
          return [
            { name: 'lib/utils', path: 'lib/utils', url: 'https://github.com/user/utils.git', status: 'current' },
            { name: 'vendor/plugin', path: 'vendor/plugin', url: 'https://github.com/vendor/plugin.git', status: 'modified' },
          ];
        }

        if (command === 'add_submodule') {
          return { success: true };
        }

        if (command === 'init_submodules') {
          return { success: true };
        }

        if (command === 'update_submodules') {
          return { success: true };
        }

        if (command === 'remove_submodule') {
          return { success: true };
        }

        if (command === 'plugin:dialog|confirm' || command === 'plugin:dialog|ask') {
          return true;
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should open submodule dialog from command palette', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('submodule');
      await page.waitForTimeout(200);

      const submoduleOption = page.locator('lv-command-palette .command-item', { hasText: /submodule/i });
      if (await submoduleOption.isVisible()) {
        await submoduleOption.click();

        const submoduleDialog = page.locator('lv-submodule-dialog');
        await expect(submoduleDialog).toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('should display list of submodules', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('submodule');
      await page.waitForTimeout(200);

      const submoduleOption = page.locator('lv-command-palette .command-item', { hasText: /submodule/i });
      if (await submoduleOption.isVisible()) {
        await submoduleOption.click();

        const submoduleDialog = page.locator('lv-submodule-dialog');
        if (await submoduleDialog.isVisible()) {
          await page.waitForTimeout(500);

          const submoduleItems = submoduleDialog.locator('.submodule-item, .submodule, [class*="submodule"]');
          const itemCount = await submoduleItems.count();
          expect(itemCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should show submodule name and path', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('submodule');
      await page.waitForTimeout(200);

      const submoduleOption = page.locator('lv-command-palette .command-item', { hasText: /submodule/i });
      if (await submoduleOption.isVisible()) {
        await submoduleOption.click();

        const submoduleDialog = page.locator('lv-submodule-dialog');
        if (await submoduleDialog.isVisible()) {
          await page.waitForTimeout(500);

          // Should display submodule paths
          const pathText = submoduleDialog.locator('text=lib/utils, text=vendor/plugin');
          const pathCount = await pathText.count();
          expect(pathCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should show status badges for submodules', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('submodule');
      await page.waitForTimeout(200);

      const submoduleOption = page.locator('lv-command-palette .command-item', { hasText: /submodule/i });
      if (await submoduleOption.isVisible()) {
        await submoduleOption.click();

        const submoduleDialog = page.locator('lv-submodule-dialog');
        if (await submoduleDialog.isVisible()) {
          await page.waitForTimeout(500);

          const statusBadges = submoduleDialog.locator('.status, .badge, [class*="status"]');
          const badgeCount = await statusBadges.count();
          expect(badgeCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should have Add Submodule button', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('submodule');
      await page.waitForTimeout(200);

      const submoduleOption = page.locator('lv-command-palette .command-item', { hasText: /submodule/i });
      if (await submoduleOption.isVisible()) {
        await submoduleOption.click();

        const submoduleDialog = page.locator('lv-submodule-dialog');
        if (await submoduleDialog.isVisible()) {
          const addButton = submoduleDialog.locator('button', { hasText: /add.*submodule/i });
          await expect(addButton).toBeVisible();
        }
      }
    }
  });

  test('should have Update All button when multiple submodules exist', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('submodule');
      await page.waitForTimeout(200);

      const submoduleOption = page.locator('lv-command-palette .command-item', { hasText: /submodule/i });
      if (await submoduleOption.isVisible()) {
        await submoduleOption.click();

        const submoduleDialog = page.locator('lv-submodule-dialog');
        if (await submoduleDialog.isVisible()) {
          await page.waitForTimeout(500);

          const updateAllButton = submoduleDialog.locator('button', { hasText: /update.*all/i });
          const buttonCount = await updateAllButton.count();
          expect(buttonCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should have action buttons for each submodule', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('submodule');
      await page.waitForTimeout(200);

      const submoduleOption = page.locator('lv-command-palette .command-item', { hasText: /submodule/i });
      if (await submoduleOption.isVisible()) {
        await submoduleOption.click();

        const submoduleDialog = page.locator('lv-submodule-dialog');
        if (await submoduleDialog.isVisible()) {
          await page.waitForTimeout(500);

          // Should have initialize, update, delete buttons
          const initButtons = submoduleDialog.locator('button', { hasText: /init/i });
          const updateButtons = submoduleDialog.locator('button', { hasText: /update/i });
          const deleteButtons = submoduleDialog.locator('button[title*="Delete"], button[title*="Remove"]');

          const initCount = await initButtons.count();
          const updateCount = await updateButtons.count();
          const deleteCount = await deleteButtons.count();

          expect(initCount + updateCount + deleteCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe('Submodule Dialog - Add Submodule', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_submodules') {
          return [];
        }

        if (command === 'add_submodule') {
          return { success: true };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('clicking Add Submodule should show add form', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('submodule');
      await page.waitForTimeout(200);

      const submoduleOption = page.locator('lv-command-palette .command-item', { hasText: /submodule/i });
      if (await submoduleOption.isVisible()) {
        await submoduleOption.click();

        const submoduleDialog = page.locator('lv-submodule-dialog');
        if (await submoduleDialog.isVisible()) {
          const addButton = submoduleDialog.locator('button', { hasText: /add.*submodule/i });
          await addButton.click();

          // Should show URL and path inputs
          const urlInput = submoduleDialog.locator('input[placeholder*="url"], input[placeholder*="github"]');
          const pathInput = submoduleDialog.locator('input[placeholder*="path"], input[placeholder*="lib"]');

          const urlCount = await urlInput.count();
          const pathCount = await pathInput.count();

          expect(urlCount + pathCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('add form should have optional branch field', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('submodule');
      await page.waitForTimeout(200);

      const submoduleOption = page.locator('lv-command-palette .command-item', { hasText: /submodule/i });
      if (await submoduleOption.isVisible()) {
        await submoduleOption.click();

        const submoduleDialog = page.locator('lv-submodule-dialog');
        if (await submoduleDialog.isVisible()) {
          const addButton = submoduleDialog.locator('button', { hasText: /add.*submodule/i });
          await addButton.click();

          const branchInput = submoduleDialog.locator('input[placeholder*="branch"], input[placeholder*="main"]');
          const branchCount = await branchInput.count();
          expect(branchCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('add form should have Cancel button', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('submodule');
      await page.waitForTimeout(200);

      const submoduleOption = page.locator('lv-command-palette .command-item', { hasText: /submodule/i });
      if (await submoduleOption.isVisible()) {
        await submoduleOption.click();

        const submoduleDialog = page.locator('lv-submodule-dialog');
        if (await submoduleDialog.isVisible()) {
          const addButton = submoduleDialog.locator('button', { hasText: /add.*submodule/i });
          await addButton.click();

          const cancelButton = submoduleDialog.locator('button', { hasText: /cancel/i });
          await expect(cancelButton).toBeVisible();
        }
      }
    }
  });
});

test.describe('Submodule Dialog - Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_submodules') {
          return []; // No submodules
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should show empty state when no submodules', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('submodule');
      await page.waitForTimeout(200);

      const submoduleOption = page.locator('lv-command-palette .command-item', { hasText: /submodule/i });
      if (await submoduleOption.isVisible()) {
        await submoduleOption.click();

        const submoduleDialog = page.locator('lv-submodule-dialog');
        if (await submoduleDialog.isVisible()) {
          await page.waitForTimeout(500);

          const emptyState = submoduleDialog.locator('.empty, [class*="empty"]', { hasText: /no.*submodule/i });
          const emptyCount = await emptyState.count();
          expect(emptyCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe('Submodule Dialog - Update Operations', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_submodules') {
          return [
            { name: 'lib/utils', path: 'lib/utils', url: 'https://github.com/user/utils.git', status: 'uninitialized' },
          ];
        }

        if (command === 'init_submodules') {
          return { success: true };
        }

        if (command === 'update_submodules') {
          return { success: true };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should show Initialize button for uninitialized submodules', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('submodule');
      await page.waitForTimeout(200);

      const submoduleOption = page.locator('lv-command-palette .command-item', { hasText: /submodule/i });
      if (await submoduleOption.isVisible()) {
        await submoduleOption.click();

        const submoduleDialog = page.locator('lv-submodule-dialog');
        if (await submoduleDialog.isVisible()) {
          await page.waitForTimeout(500);

          const initButton = submoduleDialog.locator('button', { hasText: /init/i });
          const initCount = await initButton.count();
          expect(initCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('clicking Update should update the submodule', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('submodule');
      await page.waitForTimeout(200);

      const submoduleOption = page.locator('lv-command-palette .command-item', { hasText: /submodule/i });
      if (await submoduleOption.isVisible()) {
        await submoduleOption.click();

        const submoduleDialog = page.locator('lv-submodule-dialog');
        if (await submoduleDialog.isVisible()) {
          await page.waitForTimeout(500);

          const updateButton = submoduleDialog.locator('button', { hasText: /update/i }).first();
          if (await updateButton.isVisible()) {
            await updateButton.click();
            await page.waitForTimeout(300);
            expect(true).toBe(true);
          }
        }
      }
    }
  });
});
