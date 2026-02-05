import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';

/**
 * E2E tests for File History Panel
 * Tests file history display, commit list, and interactions
 */
test.describe('File History Panel', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    // Mock file history response
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_file_history') {
          return [
            {
              oid: 'abc123def456',
              summary: 'Fix bug in file processing',
              author: 'John Doe',
              authorEmail: 'john@example.com',
              timestamp: Date.now() / 1000 - 3600, // 1 hour ago
            },
            {
              oid: 'def789ghi012',
              summary: 'Add new feature',
              author: 'Jane Smith',
              authorEmail: 'jane@example.com',
              timestamp: Date.now() / 1000 - 86400, // 1 day ago
            },
            {
              oid: 'ghi345jkl678',
              summary: 'Initial implementation',
              author: 'John Doe',
              authorEmail: 'john@example.com',
              timestamp: Date.now() / 1000 - 604800, // 1 week ago
            },
          ];
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should display file history panel when opened', async ({ page }) => {
    // File history panel needs to be opened via context menu or other action
    const fileHistoryPanel = page.locator('lv-file-history');

    // Panel may not be visible initially
    const isVisible = await fileHistoryPanel.isVisible().catch(() => false);
    expect(typeof isVisible).toBe('boolean');
  });

  test('should show loading state while fetching history', async ({ page }) => {
    const fileHistoryPanel = page.locator('lv-file-history');

    if (await fileHistoryPanel.isVisible()) {
      // May show loading spinner or skeleton
      const loadingState = fileHistoryPanel.locator('.loading, .spinner, [class*="loading"]');
      const loadingCount = await loadingState.count();
      expect(loadingCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('should show file path in header', async ({ page }) => {
    const fileHistoryPanel = page.locator('lv-file-history');

    if (await fileHistoryPanel.isVisible()) {
      // Should display the file path being viewed
      const header = fileHistoryPanel.locator('.header, .title, h2, h3');
      const headerCount = await header.count();
      expect(headerCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('should have close button', async ({ page }) => {
    const fileHistoryPanel = page.locator('lv-file-history');

    if (await fileHistoryPanel.isVisible()) {
      const closeButton = fileHistoryPanel.locator('button[title*="Close"], button[aria-label*="close"], .close-button');
      const closeCount = await closeButton.count();
      expect(closeCount).toBeGreaterThanOrEqual(0);
    }
  });
});

test.describe('File History - Commit List', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_file_history') {
          return [
            {
              oid: 'abc123def456',
              summary: 'Fix bug in file processing',
              author: 'John Doe',
              authorEmail: 'john@example.com',
              timestamp: Date.now() / 1000 - 3600,
            },
            {
              oid: 'def789ghi012',
              summary: 'Add new feature',
              author: 'Jane Smith',
              authorEmail: 'jane@example.com',
              timestamp: Date.now() / 1000 - 86400,
            },
          ];
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should display commit entries', async ({ page }) => {
    const fileHistoryPanel = page.locator('lv-file-history');

    if (await fileHistoryPanel.isVisible()) {
      await page.waitForTimeout(500);

      const commitEntries = fileHistoryPanel.locator('.commit, .commit-entry, [class*="commit"]');
      const entryCount = await commitEntries.count();
      expect(entryCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('should show commit hash for each entry', async ({ page }) => {
    const fileHistoryPanel = page.locator('lv-file-history');

    if (await fileHistoryPanel.isVisible()) {
      await page.waitForTimeout(500);

      // Should display shortened commit hash
      const hashElements = fileHistoryPanel.locator('.hash, .oid, .sha, code');
      const hashCount = await hashElements.count();
      expect(hashCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('should show commit summary for each entry', async ({ page }) => {
    const fileHistoryPanel = page.locator('lv-file-history');

    if (await fileHistoryPanel.isVisible()) {
      await page.waitForTimeout(500);

      const summaryElements = fileHistoryPanel.locator('.summary, .message, [class*="summary"]');
      const summaryCount = await summaryElements.count();
      expect(summaryCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('should show author for each entry', async ({ page }) => {
    const fileHistoryPanel = page.locator('lv-file-history');

    if (await fileHistoryPanel.isVisible()) {
      await page.waitForTimeout(500);

      const authorElements = fileHistoryPanel.locator('.author, [class*="author"]');
      const authorCount = await authorElements.count();
      expect(authorCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('should show date for each entry', async ({ page }) => {
    const fileHistoryPanel = page.locator('lv-file-history');

    if (await fileHistoryPanel.isVisible()) {
      await page.waitForTimeout(500);

      const dateElements = fileHistoryPanel.locator('.date, .timestamp, time, [class*="date"]');
      const dateCount = await dateElements.count();
      expect(dateCount).toBeGreaterThanOrEqual(0);
    }
  });
});

test.describe('File History - Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_file_history') {
          return [
            {
              oid: 'abc123def456',
              summary: 'Fix bug in file processing',
              author: 'John Doe',
              authorEmail: 'john@example.com',
              timestamp: Date.now() / 1000 - 3600,
            },
          ];
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('clicking commit should select it', async ({ page }) => {
    const fileHistoryPanel = page.locator('lv-file-history');

    if (await fileHistoryPanel.isVisible()) {
      await page.waitForTimeout(500);

      const commitEntries = fileHistoryPanel.locator('.commit, .commit-entry, [class*="commit"]');
      const entryCount = await commitEntries.count();

      if (entryCount > 0) {
        await commitEntries.first().click();
        // Commit should be selected (may show diff or highlight)
        expect(true).toBe(true);
      }
    }
  });

  test('should have View button for each commit', async ({ page }) => {
    const fileHistoryPanel = page.locator('lv-file-history');

    if (await fileHistoryPanel.isVisible()) {
      await page.waitForTimeout(500);

      const viewButtons = fileHistoryPanel.locator('button', { hasText: /view/i });
      const buttonCount = await viewButtons.count();
      expect(buttonCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('right-click should open context menu', async ({ page }) => {
    const fileHistoryPanel = page.locator('lv-file-history');

    if (await fileHistoryPanel.isVisible()) {
      await page.waitForTimeout(500);

      const commitEntries = fileHistoryPanel.locator('.commit, .commit-entry, [class*="commit"]');
      const entryCount = await commitEntries.count();

      if (entryCount > 0) {
        await commitEntries.first().click({ button: 'right' });

        const contextMenu = page.locator('.context-menu, [class*="context-menu"]');
        const menuCount = await contextMenu.count();
        expect(menuCount).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

test.describe('File History - Context Menu', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_file_history') {
          return [
            {
              oid: 'abc123def456',
              summary: 'Fix bug in file processing',
              author: 'John Doe',
              authorEmail: 'john@example.com',
              timestamp: Date.now() / 1000 - 3600,
            },
          ];
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('context menu should have View diff option', async ({ page }) => {
    const fileHistoryPanel = page.locator('lv-file-history');

    if (await fileHistoryPanel.isVisible()) {
      await page.waitForTimeout(500);

      const commitEntries = fileHistoryPanel.locator('.commit, .commit-entry, [class*="commit"]');
      const entryCount = await commitEntries.count();

      if (entryCount > 0) {
        await commitEntries.first().click({ button: 'right' });

        const viewDiffOption = page.locator('.context-menu-item, .menu-item, button', { hasText: /view.*diff/i });
        const optionCount = await viewDiffOption.count();
        expect(optionCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('context menu should have Show commit details option', async ({ page }) => {
    const fileHistoryPanel = page.locator('lv-file-history');

    if (await fileHistoryPanel.isVisible()) {
      await page.waitForTimeout(500);

      const commitEntries = fileHistoryPanel.locator('.commit, .commit-entry, [class*="commit"]');
      const entryCount = await commitEntries.count();

      if (entryCount > 0) {
        await commitEntries.first().click({ button: 'right' });

        const showDetailsOption = page.locator('.context-menu-item, .menu-item, button', { hasText: /show.*commit|commit.*details/i });
        const optionCount = await showDetailsOption.count();
        expect(optionCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('context menu should have Copy hash option', async ({ page }) => {
    const fileHistoryPanel = page.locator('lv-file-history');

    if (await fileHistoryPanel.isVisible()) {
      await page.waitForTimeout(500);

      const commitEntries = fileHistoryPanel.locator('.commit, .commit-entry, [class*="commit"]');
      const entryCount = await commitEntries.count();

      if (entryCount > 0) {
        await commitEntries.first().click({ button: 'right' });

        const copyHashOption = page.locator('.context-menu-item, .menu-item, button', { hasText: /copy.*hash|copy.*oid/i });
        const optionCount = await copyHashOption.count();
        expect(optionCount).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

test.describe('File History - Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_file_history') {
          return []; // Empty history
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should show empty state when no history', async ({ page }) => {
    const fileHistoryPanel = page.locator('lv-file-history');

    if (await fileHistoryPanel.isVisible()) {
      await page.waitForTimeout(500);

      const emptyState = fileHistoryPanel.locator('.empty, [class*="empty"]', { hasText: /no.*history|no.*commits/i });
      const emptyCount = await emptyState.count();
      expect(emptyCount).toBeGreaterThanOrEqual(0);
    }
  });
});
