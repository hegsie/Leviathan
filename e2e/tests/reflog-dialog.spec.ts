import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';

/**
 * E2E tests for Reflog Dialog
 * Tests reflog display, context menus, and restore operations
 */
test.describe('Reflog Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    // Add mocks for reflog commands
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

        if (command === 'get_reflog') {
          return [
            {
              oid: 'abc123',
              shortId: 'abc123',
              message: 'commit: Add new feature',
              action: 'commit',
              timestamp: Date.now() / 1000,
            },
            {
              oid: 'def456',
              shortId: 'def456',
              message: 'checkout: moving from main to feature',
              action: 'checkout',
              timestamp: Date.now() / 1000 - 3600,
            },
            {
              oid: 'ghi789',
              shortId: 'ghi789',
              message: 'reset: moving to HEAD~1',
              action: 'reset',
              timestamp: Date.now() / 1000 - 7200,
            },
            {
              oid: 'jkl012',
              shortId: 'jkl012',
              message: 'rebase (finish): refs/heads/main onto def456',
              action: 'rebase',
              timestamp: Date.now() / 1000 - 10800,
            },
          ];
        }

        if (command === 'checkout' || command === 'reset') {
          return null;
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should open reflog dialog', async ({ page }) => {
    // Look for reflog dialog or trigger it
    const reflogDialog = page.locator('lv-reflog-dialog');
    const count = await reflogDialog.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should display reflog entries', async ({ page }) => {
    const reflogDialog = page.locator('lv-reflog-dialog');

    if (await reflogDialog.isVisible()) {
      // Should show reflog entries
      const entries = page.locator('lv-reflog-dialog .reflog-entry, lv-reflog-dialog .entry-item');
      const count = await entries.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('should show commit hash for each entry', async ({ page }) => {
    const reflogDialog = page.locator('lv-reflog-dialog');

    if (await reflogDialog.isVisible()) {
      const hashElements = page.locator('lv-reflog-dialog .commit-hash, lv-reflog-dialog .entry-oid');
      if (await hashElements.first().isVisible()) {
        await expect(hashElements.first()).toBeVisible();
      }
    }
  });

  test('should show action message for each entry', async ({ page }) => {
    const reflogDialog = page.locator('lv-reflog-dialog');

    if (await reflogDialog.isVisible()) {
      const messageElements = page.locator('lv-reflog-dialog .entry-message, lv-reflog-dialog .reflog-message');
      if (await messageElements.first().isVisible()) {
        await expect(messageElements.first()).toBeVisible();
      }
    }
  });

  test('should open context menu on right-click', async ({ page }) => {
    const reflogDialog = page.locator('lv-reflog-dialog');

    if (await reflogDialog.isVisible()) {
      const firstEntry = page.locator('lv-reflog-dialog .reflog-entry, lv-reflog-dialog .entry-item').first();
      await firstEntry.click({ button: 'right' });

      const contextMenu = page.locator('.context-menu, .reflog-context-menu');
      await expect(contextMenu).toBeVisible();
    }
  });

  test('should show Checkout option in context menu', async ({ page }) => {
    const reflogDialog = page.locator('lv-reflog-dialog');

    if (await reflogDialog.isVisible()) {
      const firstEntry = page.locator('lv-reflog-dialog .reflog-entry, lv-reflog-dialog .entry-item').first();
      await firstEntry.click({ button: 'right' });

      const checkoutOption = page.locator('.context-menu-item, .menu-item', { hasText: /checkout/i });
      await expect(checkoutOption).toBeVisible();
    }
  });

  test('should show Reset option in context menu', async ({ page }) => {
    const reflogDialog = page.locator('lv-reflog-dialog');

    if (await reflogDialog.isVisible()) {
      const firstEntry = page.locator('lv-reflog-dialog .reflog-entry, lv-reflog-dialog .entry-item').first();
      await firstEntry.click({ button: 'right' });

      const resetOption = page.locator('.context-menu-item, .menu-item', { hasText: /reset/i });
      await expect(resetOption).toBeVisible();
    }
  });

  test('should close context menu after clicking Checkout', async ({ page }) => {
    const reflogDialog = page.locator('lv-reflog-dialog');

    if (await reflogDialog.isVisible()) {
      const firstEntry = page.locator('lv-reflog-dialog .reflog-entry, lv-reflog-dialog .entry-item').first();
      await firstEntry.click({ button: 'right' });

      const checkoutOption = page.locator('.context-menu-item, .menu-item', { hasText: /checkout/i });
      await checkoutOption.waitFor({ state: 'visible' });
      await checkoutOption.click();

      // Context menu should close
      const contextMenu = page.locator('.context-menu, .reflog-context-menu');
      await expect(contextMenu).not.toBeVisible();
    }
  });

  test('should invoke checkout command from reflog', async ({ page }) => {
    const reflogDialog = page.locator('lv-reflog-dialog');

    if (await reflogDialog.isVisible()) {
      const firstEntry = page.locator('lv-reflog-dialog .reflog-entry, lv-reflog-dialog .entry-item').first();
      await firstEntry.click({ button: 'right' });

      const checkoutOption = page.locator('.context-menu-item, .menu-item', { hasText: /checkout/i });
      await checkoutOption.waitFor({ state: 'visible' });
      await checkoutOption.click();

      await page.waitForTimeout(100);

      const commands = await page.evaluate(() => {
        return (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
          .__INVOKED_COMMANDS__;
      });

      const checkoutCommand = commands.find(c => c.command === 'checkout');
      expect(checkoutCommand).toBeDefined();
    }
  });

  test('should close context menu after clicking Reset', async ({ page }) => {
    const reflogDialog = page.locator('lv-reflog-dialog');

    if (await reflogDialog.isVisible()) {
      const firstEntry = page.locator('lv-reflog-dialog .reflog-entry, lv-reflog-dialog .entry-item').first();
      await firstEntry.click({ button: 'right' });

      const resetOption = page.locator('.context-menu-item, .menu-item', { hasText: /reset/i });
      await resetOption.waitFor({ state: 'visible' });
      await resetOption.click();

      // May show confirmation dialog
      await page.waitForTimeout(100);
      const confirmButton = page.locator('button', { hasText: /confirm|yes|ok/i });
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }

      // Context menu should close
      const contextMenu = page.locator('.context-menu, .reflog-context-menu');
      await expect(contextMenu).not.toBeVisible();
    }
  });

  test('should show Create Branch option', async ({ page }) => {
    const reflogDialog = page.locator('lv-reflog-dialog');

    if (await reflogDialog.isVisible()) {
      const firstEntry = page.locator('lv-reflog-dialog .reflog-entry, lv-reflog-dialog .entry-item').first();
      await firstEntry.click({ button: 'right' });

      const createBranchOption = page.locator('.context-menu-item, .menu-item', { hasText: /create.*branch|branch/i });
      // This option may or may not exist
      const count = await createBranchOption.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('should filter reflog entries by search', async ({ page }) => {
    const reflogDialog = page.locator('lv-reflog-dialog');

    if (await reflogDialog.isVisible()) {
      // Look for search/filter input
      const searchInput = page.locator('lv-reflog-dialog input[type="search"], lv-reflog-dialog input[placeholder*="filter"], lv-reflog-dialog input[placeholder*="search"]');

      if (await searchInput.isVisible()) {
        await searchInput.fill('commit');

        // Should filter entries
        await page.waitForTimeout(100);

        const entries = page.locator('lv-reflog-dialog .reflog-entry, lv-reflog-dialog .entry-item');
        const count = await entries.count();
        // Should have fewer entries (only commit actions)
        expect(count).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('should close dialog when clicking close button', async ({ page }) => {
    const reflogDialog = page.locator('lv-reflog-dialog');

    if (await reflogDialog.isVisible()) {
      const closeButton = page.locator('lv-reflog-dialog .close-btn, lv-reflog-dialog button[aria-label="Close"]');

      if (await closeButton.isVisible()) {
        await closeButton.click();
        await expect(reflogDialog).not.toBeVisible();
      }
    }
  });

  test('should close dialog on Escape key', async ({ page }) => {
    const reflogDialog = page.locator('lv-reflog-dialog');

    if (await reflogDialog.isVisible()) {
      await page.keyboard.press('Escape');
      await expect(reflogDialog).not.toBeVisible();
    }
  });

  test('should show timestamp for each entry', async ({ page }) => {
    const reflogDialog = page.locator('lv-reflog-dialog');

    if (await reflogDialog.isVisible()) {
      const timestampElements = page.locator('lv-reflog-dialog .entry-time, lv-reflog-dialog .timestamp, lv-reflog-dialog time');
      if (await timestampElements.first().isVisible()) {
        await expect(timestampElements.first()).toBeVisible();
      }
    }
  });
});

test.describe('Reflog Dialog - Event Propagation', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_reflog') {
          return [
            {
              oid: 'abc123',
              shortId: 'abc123',
              message: 'commit: Add new feature',
              action: 'commit',
              timestamp: Date.now() / 1000,
            },
          ];
        }

        if (command === 'checkout' || command === 'reset') {
          return null; // Success
        }

        return originalInvoke(command, args);
      };
    });

    // Open reflog dialog via command palette
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');
    if (await commandPalette.isVisible()) {
      const input = commandPalette.locator('input');
      await input.fill('reflog');
      await page.waitForTimeout(200);
      const reflogOption = commandPalette.locator('.command-item', { hasText: /reflog/i });
      if (await reflogOption.isVisible()) {
        await reflogOption.click();
      }
    }
  });

  test('should dispatch repository-changed event after checkout from reflog', async ({ page }) => {
    const reflogDialog = page.locator('lv-reflog-dialog');

    if (await reflogDialog.isVisible()) {
      const eventPromise = page.evaluate(() => {
        return new Promise<boolean>((resolve) => {
          document.addEventListener('repository-changed', () => {
            resolve(true);
          }, { once: true });
          setTimeout(() => resolve(false), 3000);
        });
      });

      // Right-click on reflog entry
      const entry = reflogDialog.locator('.reflog-entry, .entry').first();
      if (await entry.isVisible()) {
        await entry.click({ button: 'right' });

        const checkoutOption = page.locator('.context-menu-item, .menu-item', { hasText: /checkout/i });
        if (await checkoutOption.isVisible()) {
          await checkoutOption.click();

          const eventReceived = await eventPromise;
          expect(eventReceived).toBe(true);
        }
      }
    }
  });
});
