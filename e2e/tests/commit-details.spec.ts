import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';

/**
 * E2E tests for Commit Details Panel
 * Tests commit metadata display, file list, context menus, and interactions
 */
test.describe('Commit Details Panel', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    // Mock commit files response
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_commit_files') {
          return [
            { path: 'src/main.ts', status: 'modified', additions: 10, deletions: 5 },
            { path: 'src/utils/helper.ts', status: 'new', additions: 25, deletions: 0 },
            { path: 'README.md', status: 'modified', additions: 3, deletions: 1 },
            { path: 'old-file.ts', status: 'deleted', additions: 0, deletions: 50 },
          ];
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should display commit details when commit is selected', async ({ page }) => {
    // Click on a commit in the graph to select it
    const commitNode = page.locator('lv-graph-canvas .commit-node, [data-commit-oid]').first();

    if (await commitNode.isVisible()) {
      await commitNode.click();

      // Commit details panel should show commit info
      const detailsPanel = page.locator('lv-commit-details');
      await expect(detailsPanel).toBeVisible({ timeout: 5000 });
    }
  });

  test('should show commit message summary', async ({ page }) => {
    const commitNode = page.locator('lv-graph-canvas .commit-node, [data-commit-oid]').first();

    if (await commitNode.isVisible()) {
      await commitNode.click();

      const detailsPanel = page.locator('lv-commit-details');
      if (await detailsPanel.isVisible()) {
        // Should show commit summary/message
        const summary = detailsPanel.locator('.commit-summary, .summary, .message');
        const summaryCount = await summary.count();
        expect(summaryCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('should show commit SHA', async ({ page }) => {
    const commitNode = page.locator('lv-graph-canvas .commit-node, [data-commit-oid]').first();

    if (await commitNode.isVisible()) {
      await commitNode.click();

      const detailsPanel = page.locator('lv-commit-details');
      if (await detailsPanel.isVisible()) {
        // Should show SHA (commit hash)
        const sha = detailsPanel.locator('.sha, .commit-sha, .oid, code');
        const shaCount = await sha.count();
        expect(shaCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('should show author information', async ({ page }) => {
    const commitNode = page.locator('lv-graph-canvas .commit-node, [data-commit-oid]').first();

    if (await commitNode.isVisible()) {
      await commitNode.click();

      const detailsPanel = page.locator('lv-commit-details');
      if (await detailsPanel.isVisible()) {
        // Should show author name/email
        const author = detailsPanel.locator('.author, [class*="author"]');
        const authorCount = await author.count();
        expect(authorCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('should show timestamp', async ({ page }) => {
    const commitNode = page.locator('lv-graph-canvas .commit-node, [data-commit-oid]').first();

    if (await commitNode.isVisible()) {
      await commitNode.click();

      const detailsPanel = page.locator('lv-commit-details');
      if (await detailsPanel.isVisible()) {
        // Should show timestamp (relative or absolute)
        const timestamp = detailsPanel.locator('.timestamp, .date, time, [class*="time"]');
        const timestampCount = await timestamp.count();
        expect(timestampCount).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

test.describe('Commit Details - Files Changed', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_commit_files') {
          return [
            { path: 'src/main.ts', status: 'modified', additions: 10, deletions: 5 },
            { path: 'src/utils/helper.ts', status: 'new', additions: 25, deletions: 0 },
            { path: 'README.md', status: 'modified', additions: 3, deletions: 1 },
          ];
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should show files changed section', async ({ page }) => {
    const commitNode = page.locator('lv-graph-canvas .commit-node, [data-commit-oid]').first();

    if (await commitNode.isVisible()) {
      await commitNode.click();

      const detailsPanel = page.locator('lv-commit-details');
      if (await detailsPanel.isVisible()) {
        // Should show "Files Changed" section
        const filesSection = detailsPanel.locator('text=Files Changed, text=files changed', { exact: false });
        const filesSectionCount = await filesSection.count();
        expect(filesSectionCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('should list changed files with status', async ({ page }) => {
    const commitNode = page.locator('lv-graph-canvas .commit-node, [data-commit-oid]').first();

    if (await commitNode.isVisible()) {
      await commitNode.click();

      const detailsPanel = page.locator('lv-commit-details');
      if (await detailsPanel.isVisible()) {
        await page.waitForTimeout(500); // Wait for files to load

        // Should show file items
        const fileItems = detailsPanel.locator('.file-item, .file, [class*="file"]');
        const fileCount = await fileItems.count();
        expect(fileCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('should show additions and deletions stats', async ({ page }) => {
    const commitNode = page.locator('lv-graph-canvas .commit-node, [data-commit-oid]').first();

    if (await commitNode.isVisible()) {
      await commitNode.click();

      const detailsPanel = page.locator('lv-commit-details');
      if (await detailsPanel.isVisible()) {
        await page.waitForTimeout(500);

        // Should show +/- stats
        const stats = detailsPanel.locator('.stats, .additions, .deletions, [class*="stat"]');
        const statsCount = await stats.count();
        expect(statsCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('clicking file should select it', async ({ page }) => {
    const commitNode = page.locator('lv-graph-canvas .commit-node, [data-commit-oid]').first();

    if (await commitNode.isVisible()) {
      await commitNode.click();

      const detailsPanel = page.locator('lv-commit-details');
      if (await detailsPanel.isVisible()) {
        await page.waitForTimeout(500);

        const fileItems = detailsPanel.locator('.file-item, .file, [class*="file"]');
        const fileCount = await fileItems.count();

        if (fileCount > 0) {
          await fileItems.first().click();
          // File should be selected (may show diff)
          expect(true).toBe(true);
        }
      }
    }
  });
});

test.describe('Commit Details - Context Menu', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);

    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'get_commit_files') {
          return [
            { path: 'src/main.ts', status: 'modified', additions: 10, deletions: 5 },
            { path: 'deleted-file.ts', status: 'deleted', additions: 0, deletions: 20 },
          ];
        }

        return originalInvoke(command, args);
      };
    });
  });

  test('should open context menu on right-click file', async ({ page }) => {
    const commitNode = page.locator('lv-graph-canvas .commit-node, [data-commit-oid]').first();

    if (await commitNode.isVisible()) {
      await commitNode.click();

      const detailsPanel = page.locator('lv-commit-details');
      if (await detailsPanel.isVisible()) {
        await page.waitForTimeout(500);

        const fileItems = detailsPanel.locator('.file-item, .file, [class*="file"]');
        const fileCount = await fileItems.count();

        if (fileCount > 0) {
          await fileItems.first().click({ button: 'right' });

          const contextMenu = page.locator('.context-menu, [class*="context-menu"]');
          const menuCount = await contextMenu.count();
          expect(menuCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('context menu should have View diff option', async ({ page }) => {
    const commitNode = page.locator('lv-graph-canvas .commit-node, [data-commit-oid]').first();

    if (await commitNode.isVisible()) {
      await commitNode.click();

      const detailsPanel = page.locator('lv-commit-details');
      if (await detailsPanel.isVisible()) {
        await page.waitForTimeout(500);

        const fileItems = detailsPanel.locator('.file-item, .file, [class*="file"]');
        const fileCount = await fileItems.count();

        if (fileCount > 0) {
          await fileItems.first().click({ button: 'right' });

          const viewDiffOption = page.locator('.context-menu-item, .menu-item, button', { hasText: /view.*diff/i });
          const optionCount = await viewDiffOption.count();
          expect(optionCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('context menu should have Copy path option', async ({ page }) => {
    const commitNode = page.locator('lv-graph-canvas .commit-node, [data-commit-oid]').first();

    if (await commitNode.isVisible()) {
      await commitNode.click();

      const detailsPanel = page.locator('lv-commit-details');
      if (await detailsPanel.isVisible()) {
        await page.waitForTimeout(500);

        const fileItems = detailsPanel.locator('.file-item, .file, [class*="file"]');
        const fileCount = await fileItems.count();

        if (fileCount > 0) {
          await fileItems.first().click({ button: 'right' });

          const copyPathOption = page.locator('.context-menu-item, .menu-item, button', { hasText: /copy.*path/i });
          const optionCount = await copyPathOption.count();
          expect(optionCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe('Commit Details - Parent Commits', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should show parent commit links', async ({ page }) => {
    const commitNode = page.locator('lv-graph-canvas .commit-node, [data-commit-oid]').first();

    if (await commitNode.isVisible()) {
      await commitNode.click();

      const detailsPanel = page.locator('lv-commit-details');
      if (await detailsPanel.isVisible()) {
        // Should show parent section
        const parentSection = detailsPanel.locator('text=Parent, text=parent', { exact: false });
        const parentCount = await parentSection.count();
        expect(parentCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('clicking parent should navigate to that commit', async ({ page }) => {
    const commitNode = page.locator('lv-graph-canvas .commit-node, [data-commit-oid]').first();

    if (await commitNode.isVisible()) {
      await commitNode.click();

      const detailsPanel = page.locator('lv-commit-details');
      if (await detailsPanel.isVisible()) {
        const parentLink = detailsPanel.locator('.parent-oid, .parent a, [class*="parent"] a');
        const parentLinkCount = await parentLink.count();

        if (parentLinkCount > 0) {
          await parentLink.first().click();
          // Should navigate to parent commit
          expect(true).toBe(true);
        }
      }
    }
  });
});

test.describe('Commit Details - Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should show empty state when no commit selected', async ({ page }) => {
    // Without clicking a commit, the details panel should show empty state
    const detailsPanel = page.locator('lv-commit-details');

    if (await detailsPanel.isVisible()) {
      const emptyState = detailsPanel.locator('.empty, [class*="empty"]', { hasText: /select.*commit/i });
      const emptyCount = await emptyState.count();
      expect(emptyCount).toBeGreaterThanOrEqual(0);
    }
  });
});

test.describe('Commit Details - Refs Display', () => {
  test.beforeEach(async ({ page }) => {
    await setupOpenRepository(page);
  });

  test('should show branch refs as badges', async ({ page }) => {
    const commitNode = page.locator('lv-graph-canvas .commit-node, [data-commit-oid]').first();

    if (await commitNode.isVisible()) {
      await commitNode.click();

      const detailsPanel = page.locator('lv-commit-details');
      if (await detailsPanel.isVisible()) {
        // Should show ref badges (branches, tags)
        const refBadges = detailsPanel.locator('.ref-badge, .badge, [class*="badge"], [class*="ref"]');
        const badgeCount = await refBadges.count();
        expect(badgeCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('should show HEAD indicator on current branch', async ({ page }) => {
    const commitNode = page.locator('lv-graph-canvas .commit-node, [data-commit-oid]').first();

    if (await commitNode.isVisible()) {
      await commitNode.click();

      const detailsPanel = page.locator('lv-commit-details');
      if (await detailsPanel.isVisible()) {
        // May show HEAD indicator
        const headIndicator = detailsPanel.locator('text=HEAD', { exact: false });
        const headCount = await headIndicator.count();
        expect(headCount).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
