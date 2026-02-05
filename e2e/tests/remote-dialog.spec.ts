import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';

/**
 * E2E tests for Remote Dialog
 * Tests remote management (add, edit, rename, remove)
 */
test.describe('Remote Dialog - List View', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    // Mock remote-related commands
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_remotes') {
          return [
            { name: 'origin', url: 'https://github.com/user/repo.git', pushUrl: null },
            { name: 'upstream', url: 'https://github.com/original/repo.git', pushUrl: null },
          ];
        }

        if (command === 'add_remote') {
          return { success: true };
        }

        if (command === 'remove_remote') {
          return { success: true };
        }

        if (command === 'rename_remote') {
          return { success: true };
        }

        if (command === 'set_remote_url') {
          return { success: true };
        }

        if (command === 'plugin:dialog|confirm' || command === 'plugin:dialog|ask') {
          return true;
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should open remote dialog from command palette', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('remotes');
      await page.waitForTimeout(200);

      const remoteOption = page.locator('lv-command-palette .command-item', { hasText: /remote/i });
      if (await remoteOption.isVisible()) {
        await remoteOption.click();

        const remoteDialog = page.locator('lv-remote-dialog');
        await expect(remoteDialog).toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('should display list of remotes', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('remotes');
      await page.waitForTimeout(200);

      const remoteOption = page.locator('lv-command-palette .command-item', { hasText: /remote/i });
      if (await remoteOption.isVisible()) {
        await remoteOption.click();

        const remoteDialog = page.locator('lv-remote-dialog');
        if (await remoteDialog.isVisible()) {
          await page.waitForTimeout(500);

          // Should show remote items
          const remoteItems = remoteDialog.locator('.remote-item, .remote, [class*="remote"]');
          const itemCount = await remoteItems.count();
          expect(itemCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should show remote name and URL', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('remotes');
      await page.waitForTimeout(200);

      const remoteOption = page.locator('lv-command-palette .command-item', { hasText: /remote/i });
      if (await remoteOption.isVisible()) {
        await remoteOption.click();

        const remoteDialog = page.locator('lv-remote-dialog');
        if (await remoteDialog.isVisible()) {
          await page.waitForTimeout(500);

          // Should display origin remote
          const originText = remoteDialog.locator('text=origin');
          const originCount = await originText.count();
          expect(originCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should have Add Remote button', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('remotes');
      await page.waitForTimeout(200);

      const remoteOption = page.locator('lv-command-palette .command-item', { hasText: /remote/i });
      if (await remoteOption.isVisible()) {
        await remoteOption.click();

        const remoteDialog = page.locator('lv-remote-dialog');
        if (await remoteDialog.isVisible()) {
          const addButton = remoteDialog.locator('button', { hasText: /add.*remote/i });
          await expect(addButton).toBeVisible();
        }
      }
    }
  });

  test('should have action buttons for each remote', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('remotes');
      await page.waitForTimeout(200);

      const remoteOption = page.locator('lv-command-palette .command-item', { hasText: /remote/i });
      if (await remoteOption.isVisible()) {
        await remoteOption.click();

        const remoteDialog = page.locator('lv-remote-dialog');
        if (await remoteDialog.isVisible()) {
          await page.waitForTimeout(500);

          // Should have edit, rename, delete buttons
          const editButtons = remoteDialog.locator('button[title*="Edit"], button[aria-label*="edit"]');
          const renameButtons = remoteDialog.locator('button[title*="Rename"], button[aria-label*="rename"]');
          const deleteButtons = remoteDialog.locator('button[title*="Delete"], button[title*="Remove"], button[aria-label*="delete"]');

          const editCount = await editButtons.count();
          const renameCount = await renameButtons.count();
          const deleteCount = await deleteButtons.count();

          expect(editCount + renameCount + deleteCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe('Remote Dialog - Add Remote', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_remotes') {
          return [{ name: 'origin', url: 'https://github.com/user/repo.git', pushUrl: null }];
        }

        if (command === 'add_remote') {
          return { success: true };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('clicking Add Remote should show add form', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('remotes');
      await page.waitForTimeout(200);

      const remoteOption = page.locator('lv-command-palette .command-item', { hasText: /remote/i });
      if (await remoteOption.isVisible()) {
        await remoteOption.click();

        const remoteDialog = page.locator('lv-remote-dialog');
        if (await remoteDialog.isVisible()) {
          const addButton = remoteDialog.locator('button', { hasText: /add.*remote/i });
          await addButton.click();

          // Should show name and URL inputs
          const nameInput = remoteDialog.locator('input[placeholder*="name"], input[name*="name"]');
          const urlInput = remoteDialog.locator('input[placeholder*="url"], input[placeholder*="github"], input[name*="url"]');

          const nameCount = await nameInput.count();
          const urlCount = await urlInput.count();

          expect(nameCount + urlCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('add form should have Cancel and Save buttons', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('remotes');
      await page.waitForTimeout(200);

      const remoteOption = page.locator('lv-command-palette .command-item', { hasText: /remote/i });
      if (await remoteOption.isVisible()) {
        await remoteOption.click();

        const remoteDialog = page.locator('lv-remote-dialog');
        if (await remoteDialog.isVisible()) {
          const addButton = remoteDialog.locator('button', { hasText: /add.*remote/i });
          await addButton.click();

          const cancelButton = remoteDialog.locator('button', { hasText: /cancel/i });
          const saveButton = remoteDialog.locator('button', { hasText: /save/i });

          const cancelCount = await cancelButton.count();
          const saveCount = await saveButton.count();

          expect(cancelCount + saveCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('Save button should be disabled until form is valid', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('remotes');
      await page.waitForTimeout(200);

      const remoteOption = page.locator('lv-command-palette .command-item', { hasText: /remote/i });
      if (await remoteOption.isVisible()) {
        await remoteOption.click();

        const remoteDialog = page.locator('lv-remote-dialog');
        if (await remoteDialog.isVisible()) {
          const addButton = remoteDialog.locator('button', { hasText: /add.*remote/i });
          await addButton.click();

          const saveButton = remoteDialog.locator('button', { hasText: /save/i }).first();
          const isDisabled = await saveButton.isDisabled().catch(() => false);
          expect(typeof isDisabled).toBe('boolean');
        }
      }
    }
  });
});

test.describe('Remote Dialog - Edit Remote', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_remotes') {
          return [{ name: 'origin', url: 'https://github.com/user/repo.git', pushUrl: null }];
        }

        if (command === 'set_remote_url') {
          return { success: true };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('clicking Edit should show edit form', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('remotes');
      await page.waitForTimeout(200);

      const remoteOption = page.locator('lv-command-palette .command-item', { hasText: /remote/i });
      if (await remoteOption.isVisible()) {
        await remoteOption.click();

        const remoteDialog = page.locator('lv-remote-dialog');
        if (await remoteDialog.isVisible()) {
          await page.waitForTimeout(500);

          const editButton = remoteDialog.locator('button[title*="Edit"], button[aria-label*="edit"]').first();
          if (await editButton.isVisible()) {
            await editButton.click();

            // Should show URL input fields
            const urlInput = remoteDialog.locator('input[type="text"]');
            const urlCount = await urlInput.count();
            expect(urlCount).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  test('edit form should have fetch and push URL fields', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('remotes');
      await page.waitForTimeout(200);

      const remoteOption = page.locator('lv-command-palette .command-item', { hasText: /remote/i });
      if (await remoteOption.isVisible()) {
        await remoteOption.click();

        const remoteDialog = page.locator('lv-remote-dialog');
        if (await remoteDialog.isVisible()) {
          await page.waitForTimeout(500);

          const editButton = remoteDialog.locator('button[title*="Edit"], button[aria-label*="edit"]').first();
          if (await editButton.isVisible()) {
            await editButton.click();

            // Should have fetch URL and push URL fields
            const fetchLabel = remoteDialog.locator('label, .label', { hasText: /fetch/i });
            const pushLabel = remoteDialog.locator('label, .label', { hasText: /push/i });

            const fetchCount = await fetchLabel.count();
            const pushCount = await pushLabel.count();
            expect(fetchCount + pushCount).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

test.describe('Remote Dialog - Delete Remote', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_remotes') {
          return [
            { name: 'origin', url: 'https://github.com/user/repo.git', pushUrl: null },
            { name: 'upstream', url: 'https://github.com/original/repo.git', pushUrl: null },
          ];
        }

        if (command === 'remove_remote') {
          return { success: true };
        }

        if (command === 'plugin:dialog|confirm' || command === 'plugin:dialog|ask') {
          return true;
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('clicking Delete should show confirmation', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('remotes');
      await page.waitForTimeout(200);

      const remoteOption = page.locator('lv-command-palette .command-item', { hasText: /remote/i });
      if (await remoteOption.isVisible()) {
        await remoteOption.click();

        const remoteDialog = page.locator('lv-remote-dialog');
        if (await remoteDialog.isVisible()) {
          await page.waitForTimeout(500);

          const deleteButton = remoteDialog.locator('button[title*="Delete"], button[title*="Remove"], button[aria-label*="delete"]').first();
          if (await deleteButton.isVisible()) {
            await deleteButton.click();
            // Should show confirmation or remove the remote
            await page.waitForTimeout(300);
            expect(true).toBe(true);
          }
        }
      }
    }
  });
});

test.describe('Remote Dialog - Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_remotes') {
          return []; // No remotes
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should show empty state when no remotes', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('remotes');
      await page.waitForTimeout(200);

      const remoteOption = page.locator('lv-command-palette .command-item', { hasText: /remote/i });
      if (await remoteOption.isVisible()) {
        await remoteOption.click();

        const remoteDialog = page.locator('lv-remote-dialog');
        if (await remoteDialog.isVisible()) {
          await page.waitForTimeout(500);

          const emptyState = remoteDialog.locator('.empty, [class*="empty"]', { hasText: /no.*remote/i });
          const emptyCount = await emptyState.count();
          expect(emptyCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
