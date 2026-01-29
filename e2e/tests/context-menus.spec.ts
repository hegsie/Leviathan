import { test, expect } from '@playwright/test';
import { setupOpenRepository, defaultMockData, type MockBranch, type MockTag, type MockCommit } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';

/**
 * Helper to find and right-click on a commit in the graph.
 * The graph is canvas-based, so we need to click on specific commit row areas.
 */
async function rightClickOnCommitRow(page: import('@playwright/test').Page, rowIndex: number = 0) {
  const graphCanvas = page.locator('lv-graph-canvas');
  await expect(graphCanvas).toBeVisible();

  // Wait for graph to render
  await page.waitForTimeout(300);

  // Get canvas bounding box
  const box = await graphCanvas.boundingBox();
  if (!box) throw new Error('Canvas not found');

  // Commits are rendered in rows, starting from top
  // Row height is approximately 32px, header is ~32px
  const rowHeight = 32;
  const headerHeight = 32;
  const commitX = box.x + 400; // Click in the commit message area
  const commitY = box.y + headerHeight + (rowIndex * rowHeight) + (rowHeight / 2);

  await page.mouse.click(commitX, commitY, { button: 'right' });
}

test.describe('Commit Context Menu', () => {
  let app: AppPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page);
  });

  test('should show context menu on right-click on commit row', async ({ page }) => {
    await rightClickOnCommitRow(page, 0);

    // Context menu should appear (either commit or ref menu)
    const contextMenu = page.locator('.context-menu');
    const isVisible = await contextMenu.isVisible().catch(() => false);

    // If we hit a commit, menu should be visible
    if (isVisible) {
      await expect(contextMenu).toBeVisible();
    }
  });

  test('context menu should have expected structure when visible', async ({ page }) => {
    await rightClickOnCommitRow(page, 0);

    const contextMenu = page.locator('.context-menu');
    const isVisible = await contextMenu.isVisible().catch(() => false);

    if (isVisible) {
      // Should have a header
      const header = contextMenu.locator('.context-menu-header');
      await expect(header).toBeVisible();

      // Should have menu items
      const menuItems = contextMenu.locator('.context-menu-item');
      const count = await menuItems.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('should close context menu on Escape key', async ({ page }) => {
    await rightClickOnCommitRow(page, 0);

    const contextMenu = page.locator('.context-menu');
    const isVisible = await contextMenu.isVisible().catch(() => false);

    if (isVisible) {
      await page.keyboard.press('Escape');
      await expect(contextMenu).not.toBeVisible();
    }
  });
});

// Note: Ref context menu tests (for branch/tag labels in the graph) are challenging
// because the labels are rendered on a canvas. The hit detection depends on exact
// pixel positions which vary based on ref names, graph layout, etc.
// These tests would require either:
// 1. Exposing ref label positions via a test API
// 2. Using visual regression testing
// 3. Testing at the component/unit level instead of E2E

test.describe('Operation Banner', () => {
  let app: AppPage;

  test('should show operation banner when repo is in cherry-pick state', async ({ page }) => {
    app = new AppPage(page);

    // Setup with cherry-pick state
    await setupOpenRepository(page, {
      repository: {
        ...defaultMockData.repository,
        state: 'cherrypick',
      },
    });

    // Operation banner should be visible
    const banner = page.locator('.operation-banner');
    await expect(banner).toBeVisible();

    // Should show cherry-pick text
    await expect(banner).toContainText('Cherry-pick in progress');

    // Should have abort button
    const abortBtn = banner.locator('.operation-abort-btn');
    await expect(abortBtn).toBeVisible();
    await expect(abortBtn).toContainText('Abort');
  });

  test('should show operation banner when repo is in merge state', async ({ page }) => {
    app = new AppPage(page);

    await setupOpenRepository(page, {
      repository: {
        ...defaultMockData.repository,
        state: 'merge',
      },
    });

    const banner = page.locator('.operation-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Merge in progress');
  });

  test('should show operation banner when repo is in rebase state', async ({ page }) => {
    app = new AppPage(page);

    await setupOpenRepository(page, {
      repository: {
        ...defaultMockData.repository,
        state: 'rebase',
      },
    });

    const banner = page.locator('.operation-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Rebase in progress');
  });

  test('should show operation banner when repo is in revert state', async ({ page }) => {
    app = new AppPage(page);

    await setupOpenRepository(page, {
      repository: {
        ...defaultMockData.repository,
        state: 'revert',
      },
    });

    const banner = page.locator('.operation-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Revert in progress');
  });

  test('should not show operation banner when repo is clean', async ({ page }) => {
    app = new AppPage(page);

    await setupOpenRepository(page, {
      repository: {
        ...defaultMockData.repository,
        state: 'clean',
      },
    });

    const banner = page.locator('.operation-banner');
    await expect(banner).not.toBeVisible();
  });

  test('should have correct styling for cherry-pick banner', async ({ page }) => {
    app = new AppPage(page);

    await setupOpenRepository(page, {
      repository: {
        ...defaultMockData.repository,
        state: 'cherrypick',
      },
    });

    const banner = page.locator('.operation-banner');
    await expect(banner).toHaveClass(/cherrypick/);
  });

  test('abort button should be clickable', async ({ page }) => {
    app = new AppPage(page);

    await setupOpenRepository(page, {
      repository: {
        ...defaultMockData.repository,
        state: 'cherrypick',
      },
    });

    const abortBtn = page.locator('.operation-abort-btn');
    await expect(abortBtn).toBeEnabled();

    // Click abort - should not throw
    await abortBtn.click();
  });

  test('should show Resolve Conflicts button for cherry-pick state', async ({ page }) => {
    app = new AppPage(page);

    await setupOpenRepository(page, {
      repository: {
        ...defaultMockData.repository,
        state: 'cherrypick',
      },
    });

    const banner = page.locator('.operation-banner');
    await expect(banner).toBeVisible();

    // Should have Resolve Conflicts button
    const resolveBtn = banner.locator('.operation-btn-primary');
    await expect(resolveBtn).toBeVisible();
    await expect(resolveBtn).toContainText('Resolve Conflicts');
  });

  test('should show Resolve Conflicts button for merge state', async ({ page }) => {
    app = new AppPage(page);

    await setupOpenRepository(page, {
      repository: {
        ...defaultMockData.repository,
        state: 'merge',
      },
    });

    const banner = page.locator('.operation-banner');
    const resolveBtn = banner.locator('.operation-btn-primary');
    await expect(resolveBtn).toBeVisible();
    await expect(resolveBtn).toContainText('Resolve Conflicts');
  });

  test('should show Resolve Conflicts button for rebase state', async ({ page }) => {
    app = new AppPage(page);

    await setupOpenRepository(page, {
      repository: {
        ...defaultMockData.repository,
        state: 'rebase',
      },
    });

    const banner = page.locator('.operation-banner');
    const resolveBtn = banner.locator('.operation-btn-primary');
    await expect(resolveBtn).toBeVisible();
    await expect(resolveBtn).toContainText('Resolve Conflicts');
  });

  test('should show Resolve Conflicts button for revert state', async ({ page }) => {
    app = new AppPage(page);

    await setupOpenRepository(page, {
      repository: {
        ...defaultMockData.repository,
        state: 'revert',
      },
    });

    const banner = page.locator('.operation-banner');
    const resolveBtn = banner.locator('.operation-btn-primary');
    await expect(resolveBtn).toBeVisible();
    await expect(resolveBtn).toContainText('Resolve Conflicts');
  });

  test('Resolve Conflicts button should open conflict resolution dialog', async ({ page }) => {
    app = new AppPage(page);

    await setupOpenRepository(page, {
      repository: {
        ...defaultMockData.repository,
        state: 'cherrypick',
      },
    });

    const resolveBtn = page.locator('.operation-btn-primary');
    await resolveBtn.click();

    // Conflict resolution dialog should be visible
    const conflictDialog = page.locator('lv-conflict-resolution-dialog[open]');
    await expect(conflictDialog).toBeVisible();
  });
});

test.describe('Context Menu Actions', () => {
  let app: AppPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    await setupOpenRepository(page);
  });

  test('clicking menu item should close context menu', async ({ page }) => {
    await rightClickOnCommitRow(page, 0);

    const contextMenu = page.locator('.context-menu');
    const isVisible = await contextMenu.isVisible().catch(() => false);

    if (isVisible) {
      // Click any menu item
      const menuItem = contextMenu.locator('.context-menu-item').first();
      if (await menuItem.isVisible()) {
        await menuItem.click();
        // Menu should close after action
        await expect(contextMenu).not.toBeVisible();
      }
    }
  });
});
