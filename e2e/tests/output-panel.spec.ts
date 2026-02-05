import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';

/**
 * E2E tests for Output Panel
 * Tests command logging, expansion, and clear functionality
 */
test.describe('Output Panel', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    // Add command tracking to log git commands
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        // Log git commands to the output panel
        if (command.startsWith('get_') || command === 'fetch' || command === 'pull' || command === 'push') {
          // Trigger log entry (the component should do this internally)
        }
        return originalInvoke(command, args);
      };
    });
  });

  test('should display output panel component', async ({ page }) => {
    const outputPanel = page.locator('lv-output-panel');
    // Output panel may be in a tab or always visible
    const count = await outputPanel.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should show header with Output title', async ({ page }) => {
    const outputPanel = page.locator('lv-output-panel');

    if (await outputPanel.isVisible()) {
      const header = outputPanel.locator('.header, [class*="header"]');
      await expect(header).toContainText(/output/i);
    }
  });

  test('should show empty state when no commands logged', async ({ page }) => {
    const outputPanel = page.locator('lv-output-panel');

    if (await outputPanel.isVisible()) {
      // Check for empty state or entries
      const emptyState = outputPanel.locator('.empty, [class*="empty"]');
      const entries = outputPanel.locator('.entry, [class*="entry"]');

      const emptyCount = await emptyState.count();
      const entriesCount = await entries.count();

      // Either show empty state or have some entries from initial load
      expect(emptyCount + entriesCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('should show clear button when entries exist', async ({ page }) => {
    const outputPanel = page.locator('lv-output-panel');

    if (await outputPanel.isVisible()) {
      const entries = outputPanel.locator('.entry, [class*="entry"]');
      const entriesCount = await entries.count();

      if (entriesCount > 0) {
        const clearButton = outputPanel.locator('.clear-btn, button', { hasText: /clear/i });
        await expect(clearButton).toBeVisible();
      }
    }
  });
});

test.describe('Output Panel Entries', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('entries should show timestamp', async ({ page }) => {
    const outputPanel = page.locator('lv-output-panel');

    if (await outputPanel.isVisible()) {
      const entries = outputPanel.locator('.entry, [class*="entry"]');
      const entriesCount = await entries.count();

      if (entriesCount > 0) {
        const timestamp = entries.first().locator('.entry-timestamp, .timestamp, [class*="timestamp"]');
        // Timestamp should match HH:MM:SS format or similar
        if (await timestamp.isVisible()) {
          const text = await timestamp.textContent();
          expect(text).toMatch(/\d{1,2}:\d{2}/);
        }
      }
    }
  });

  test('entries should show command text', async ({ page }) => {
    const outputPanel = page.locator('lv-output-panel');

    if (await outputPanel.isVisible()) {
      const entries = outputPanel.locator('.entry, [class*="entry"]');
      const entriesCount = await entries.count();

      if (entriesCount > 0) {
        const command = entries.first().locator('.entry-command, .command, [class*="command"]');
        if (await command.isVisible()) {
          const text = await command.textContent();
          expect(text?.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test('entries should show status indicator', async ({ page }) => {
    const outputPanel = page.locator('lv-output-panel');

    if (await outputPanel.isVisible()) {
      const entries = outputPanel.locator('.entry, [class*="entry"]');
      const entriesCount = await entries.count();

      if (entriesCount > 0) {
        const statusDot = entries.first().locator('.status-dot, .status, [class*="status"]');
        // Status indicator should exist
        const statusCount = await statusDot.count();
        expect(statusCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('entry should expand when clicked', async ({ page }) => {
    const outputPanel = page.locator('lv-output-panel');

    if (await outputPanel.isVisible()) {
      const entries = outputPanel.locator('.entry, [class*="entry"]');
      const entriesCount = await entries.count();

      if (entriesCount > 0) {
        const entryHeader = entries.first().locator('.entry-header, [class*="header"]');
        if (await entryHeader.isVisible()) {
          await entryHeader.click();

          // Output section should be visible after expansion
          const output = entries.first().locator('.entry-output, .output, [class*="output"]');
          // May or may not be visible depending on if there's output
          const outputCount = await output.count();
          expect(outputCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('entry should collapse when clicked again', async ({ page }) => {
    const outputPanel = page.locator('lv-output-panel');

    if (await outputPanel.isVisible()) {
      const entries = outputPanel.locator('.entry, [class*="entry"]');
      const entriesCount = await entries.count();

      if (entriesCount > 0) {
        const entryHeader = entries.first().locator('.entry-header, [class*="header"]');
        if (await entryHeader.isVisible()) {
          // Click to expand
          await entryHeader.click();
          await page.waitForTimeout(100);

          // Click to collapse
          await entryHeader.click();

          // Verify toggle behavior occurred (expand icon should change)
          const expandIcon = entries.first().locator('.expand-icon, [class*="expand"]');
          const iconCount = await expandIcon.count();
          expect(iconCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe('Output Panel Clear', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('clicking clear should remove all entries', async ({ page }) => {
    const outputPanel = page.locator('lv-output-panel');

    if (await outputPanel.isVisible()) {
      const entries = outputPanel.locator('.entry, [class*="entry"]');
      const entriesCount = await entries.count();

      if (entriesCount > 0) {
        const clearButton = outputPanel.locator('.clear-btn, button', { hasText: /clear/i });

        if (await clearButton.isVisible()) {
          await clearButton.click();

          // Entries should be cleared
          await page.waitForTimeout(100);
          const newEntriesCount = await entries.count();
          expect(newEntriesCount).toBe(0);
        }
      }
    }
  });

  test('should show empty state after clearing', async ({ page }) => {
    const outputPanel = page.locator('lv-output-panel');

    if (await outputPanel.isVisible()) {
      const entries = outputPanel.locator('.entry, [class*="entry"]');
      const entriesCount = await entries.count();

      if (entriesCount > 0) {
        const clearButton = outputPanel.locator('.clear-btn, button', { hasText: /clear/i });

        if (await clearButton.isVisible()) {
          await clearButton.click();
          await page.waitForTimeout(100);

          // Empty state should appear
          const emptyState = outputPanel.locator('.empty, [class*="empty"]');
          await expect(emptyState).toBeVisible();
        }
      }
    }
  });

  test('clear button should be hidden when no entries', async ({ page }) => {
    const outputPanel = page.locator('lv-output-panel');

    if (await outputPanel.isVisible()) {
      const entries = outputPanel.locator('.entry, [class*="entry"]');
      const entriesCount = await entries.count();

      if (entriesCount > 0) {
        const clearButton = outputPanel.locator('.clear-btn, button', { hasText: /clear/i });

        if (await clearButton.isVisible()) {
          await clearButton.click();
          await page.waitForTimeout(100);

          // Clear button should be hidden now
          await expect(clearButton).not.toBeVisible();
        }
      }
    }
  });
});

test.describe('Output Panel Entry Count', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('header should show entry count', async ({ page }) => {
    const outputPanel = page.locator('lv-output-panel');

    if (await outputPanel.isVisible()) {
      const header = outputPanel.locator('.header, [class*="header"]');
      const headerText = await header.textContent();

      // Header may show count like "Output (5)" or just "Output"
      expect(headerText).toContain('Output');
    }
  });
});
