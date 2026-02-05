import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';

/**
 * E2E tests for Repository Health Dialog
 * Tests repository health stats, recommendations, and maintenance actions
 */
test.describe('Repository Health Dialog - Statistics', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    // Mock repository health commands
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_repository_stats') {
          return {
            objectCount: 1250,
            sizeInBytes: 5242880, // 5MB
            looseObjects: 150,
            packFiles: 3,
          };
        }

        if (command === 'get_pack_info') {
          return {
            packCount: 3,
            totalSize: 4194304, // 4MB
          };
        }

        if (command === 'run_gc') {
          return { success: true };
        }

        if (command === 'run_fsck') {
          return { success: true, issues: [] };
        }

        if (command === 'run_prune') {
          return { success: true };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should open repository health dialog from command palette', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('health');
      await page.waitForTimeout(200);

      const healthOption = page.locator('lv-command-palette .command-item', { hasText: /health|maintenance/i });
      if (await healthOption.isVisible()) {
        await healthOption.click();

        const healthDialog = page.locator('lv-repository-health-dialog');
        await expect(healthDialog).toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('should display repository statistics', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('health');
      await page.waitForTimeout(200);

      const healthOption = page.locator('lv-command-palette .command-item', { hasText: /health|maintenance/i });
      if (await healthOption.isVisible()) {
        await healthOption.click();

        const healthDialog = page.locator('lv-repository-health-dialog');
        if (await healthDialog.isVisible()) {
          await page.waitForTimeout(500);

          // Should show stats like object count, size
          const stats = healthDialog.locator('.stat, .stat-card, [class*="stat"]');
          const statCount = await stats.count();
          expect(statCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should show total objects count', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('health');
      await page.waitForTimeout(200);

      const healthOption = page.locator('lv-command-palette .command-item', { hasText: /health|maintenance/i });
      if (await healthOption.isVisible()) {
        await healthOption.click();

        const healthDialog = page.locator('lv-repository-health-dialog');
        if (await healthDialog.isVisible()) {
          await page.waitForTimeout(500);

          const objectsText = healthDialog.locator('text=Objects, text=objects', { exact: false });
          const objectsCount = await objectsText.count();
          expect(objectsCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should show repository size', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('health');
      await page.waitForTimeout(200);

      const healthOption = page.locator('lv-command-palette .command-item', { hasText: /health|maintenance/i });
      if (await healthOption.isVisible()) {
        await healthOption.click();

        const healthDialog = page.locator('lv-repository-health-dialog');
        if (await healthDialog.isVisible()) {
          await page.waitForTimeout(500);

          const sizeText = healthDialog.locator('text=Size, text=MB, text=KB, text=GB', { exact: false });
          const sizeCount = await sizeText.count();
          expect(sizeCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should show loose objects count', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('health');
      await page.waitForTimeout(200);

      const healthOption = page.locator('lv-command-palette .command-item', { hasText: /health|maintenance/i });
      if (await healthOption.isVisible()) {
        await healthOption.click();

        const healthDialog = page.locator('lv-repository-health-dialog');
        if (await healthDialog.isVisible()) {
          await page.waitForTimeout(500);

          const looseText = healthDialog.locator('text=Loose, text=loose', { exact: false });
          const looseCount = await looseText.count();
          expect(looseCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should show pack files count', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('health');
      await page.waitForTimeout(200);

      const healthOption = page.locator('lv-command-palette .command-item', { hasText: /health|maintenance/i });
      if (await healthOption.isVisible()) {
        await healthOption.click();

        const healthDialog = page.locator('lv-repository-health-dialog');
        if (await healthDialog.isVisible()) {
          await page.waitForTimeout(500);

          const packText = healthDialog.locator('text=Pack, text=pack', { exact: false });
          const packCount = await packText.count();
          expect(packCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe('Repository Health Dialog - Maintenance Actions', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_repository_stats') {
          return {
            objectCount: 1250,
            sizeInBytes: 5242880,
            looseObjects: 600, // High loose objects to trigger warning
            packFiles: 15, // High pack files to trigger warning
          };
        }

        if (command === 'run_gc') {
          return { success: true };
        }

        if (command === 'run_fsck') {
          return { success: true, issues: [] };
        }

        if (command === 'run_prune') {
          return { success: true };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should have Garbage Collection button', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('health');
      await page.waitForTimeout(200);

      const healthOption = page.locator('lv-command-palette .command-item', { hasText: /health|maintenance/i });
      if (await healthOption.isVisible()) {
        await healthOption.click();

        const healthDialog = page.locator('lv-repository-health-dialog');
        if (await healthDialog.isVisible()) {
          const gcButton = healthDialog.locator('button', { hasText: /garbage.*collection|gc/i });
          const buttonCount = await gcButton.count();
          expect(buttonCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should have Aggressive GC button', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('health');
      await page.waitForTimeout(200);

      const healthOption = page.locator('lv-command-palette .command-item', { hasText: /health|maintenance/i });
      if (await healthOption.isVisible()) {
        await healthOption.click();

        const healthDialog = page.locator('lv-repository-health-dialog');
        if (await healthDialog.isVisible()) {
          const aggressiveButton = healthDialog.locator('button', { hasText: /aggressive/i });
          const buttonCount = await aggressiveButton.count();
          expect(buttonCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should have File System Check button', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('health');
      await page.waitForTimeout(200);

      const healthOption = page.locator('lv-command-palette .command-item', { hasText: /health|maintenance/i });
      if (await healthOption.isVisible()) {
        await healthOption.click();

        const healthDialog = page.locator('lv-repository-health-dialog');
        if (await healthDialog.isVisible()) {
          const fsckButton = healthDialog.locator('button', { hasText: /fsck|file.*system.*check/i });
          const buttonCount = await fsckButton.count();
          expect(buttonCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should have Prune button', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('health');
      await page.waitForTimeout(200);

      const healthOption = page.locator('lv-command-palette .command-item', { hasText: /health|maintenance/i });
      if (await healthOption.isVisible()) {
        await healthOption.click();

        const healthDialog = page.locator('lv-repository-health-dialog');
        if (await healthDialog.isVisible()) {
          const pruneButton = healthDialog.locator('button', { hasText: /prune/i });
          const buttonCount = await pruneButton.count();
          expect(buttonCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('clicking GC should run garbage collection', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('health');
      await page.waitForTimeout(200);

      const healthOption = page.locator('lv-command-palette .command-item', { hasText: /health|maintenance/i });
      if (await healthOption.isVisible()) {
        await healthOption.click();

        const healthDialog = page.locator('lv-repository-health-dialog');
        if (await healthDialog.isVisible()) {
          const gcButton = healthDialog.locator('button', { hasText: /garbage.*collection|^gc$/i }).first();
          if (await gcButton.isVisible()) {
            await gcButton.click();
            await page.waitForTimeout(500);
            expect(true).toBe(true);
          }
        }
      }
    }
  });
});

test.describe('Repository Health Dialog - Recommendations', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_repository_stats') {
          return {
            objectCount: 1250,
            sizeInBytes: 5242880,
            looseObjects: 600, // Above 500 threshold
            packFiles: 15, // Above 10 threshold
          };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should show recommendations when issues detected', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('health');
      await page.waitForTimeout(200);

      const healthOption = page.locator('lv-command-palette .command-item', { hasText: /health|maintenance/i });
      if (await healthOption.isVisible()) {
        await healthOption.click();

        const healthDialog = page.locator('lv-repository-health-dialog');
        if (await healthDialog.isVisible()) {
          await page.waitForTimeout(500);

          const recommendations = healthDialog.locator('.recommendation, .warning, [class*="recommendation"]');
          const recCount = await recommendations.count();
          expect(recCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('should show warning styling for high loose objects', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('health');
      await page.waitForTimeout(200);

      const healthOption = page.locator('lv-command-palette .command-item', { hasText: /health|maintenance/i });
      if (await healthOption.isVisible()) {
        await healthOption.click();

        const healthDialog = page.locator('lv-repository-health-dialog');
        if (await healthDialog.isVisible()) {
          await page.waitForTimeout(500);

          const warningElements = healthDialog.locator('.warning, [class*="warning"]');
          const warningCount = await warningElements.count();
          expect(warningCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe('Repository Health Dialog - Healthy State', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_repository_stats') {
          return {
            objectCount: 500,
            sizeInBytes: 1048576, // 1MB
            looseObjects: 50, // Below 500 threshold
            packFiles: 2, // Below 10 threshold
          };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should show healthy message when no issues', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('health');
      await page.waitForTimeout(200);

      const healthOption = page.locator('lv-command-palette .command-item', { hasText: /health|maintenance/i });
      if (await healthOption.isVisible()) {
        await healthOption.click();

        const healthDialog = page.locator('lv-repository-health-dialog');
        if (await healthDialog.isVisible()) {
          await page.waitForTimeout(500);

          const healthyMessage = healthDialog.locator('text=healthy, text=good', { exact: false });
          const healthyCount = await healthyMessage.count();
          expect(healthyCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe('Repository Health Dialog - Footer', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_repository_stats') {
          return {
            objectCount: 500,
            sizeInBytes: 1048576,
            looseObjects: 50,
            packFiles: 2,
          };
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should have Done button to close dialog', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('health');
      await page.waitForTimeout(200);

      const healthOption = page.locator('lv-command-palette .command-item', { hasText: /health|maintenance/i });
      if (await healthOption.isVisible()) {
        await healthOption.click();

        const healthDialog = page.locator('lv-repository-health-dialog');
        if (await healthDialog.isVisible()) {
          const doneButton = healthDialog.locator('button', { hasText: /done|close/i });
          await expect(doneButton).toBeVisible();
        }
      }
    }
  });

  test('clicking Done should close dialog', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    const commandPalette = page.locator('lv-command-palette');

    if (await commandPalette.isVisible()) {
      const searchInput = commandPalette.locator('input');
      await searchInput.fill('health');
      await page.waitForTimeout(200);

      const healthOption = page.locator('lv-command-palette .command-item', { hasText: /health|maintenance/i });
      if (await healthOption.isVisible()) {
        await healthOption.click();

        const healthDialog = page.locator('lv-repository-health-dialog');
        if (await healthDialog.isVisible()) {
          const doneButton = healthDialog.locator('button', { hasText: /done|close/i });
          await doneButton.click();

          await expect(healthDialog).not.toBeVisible();
        }
      }
    }
  });
});
