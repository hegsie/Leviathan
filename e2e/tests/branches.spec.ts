import { test, expect } from '@playwright/test';
import { setupOpenRepository, defaultMockData } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';
import { LeftPanelPage } from '../pages/panels.page';
import { DialogsPage } from '../pages/dialogs.page';

test.describe('Branch List', () => {
  let app: AppPage;
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    leftPanel = new LeftPanelPage(page);
    await setupOpenRepository(page);
  });

  test('should display left panel with branch list', async () => {
    await expect(leftPanel.panel).toBeVisible();
    await expect(leftPanel.branchList).toBeVisible();
  });

  test('should show current branch highlighted', async () => {
    await expect(leftPanel.currentBranch).toBeVisible();
  });

  test('should display local branches', async () => {
    const count = await leftPanel.getLocalBranchCount();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Branch with Multiple Branches', () => {
  let app: AppPage;
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    leftPanel = new LeftPanelPage(page);
    // Setup with multiple branches
    await setupOpenRepository(page, {
      branches: [
        {
          name: 'refs/heads/main',
          shorthand: 'main',
          isHead: true,
          isRemote: false,
          upstream: 'refs/remotes/origin/main',
          targetOid: 'abc123',
          isStale: false,
        },
        {
          name: 'refs/heads/develop',
          shorthand: 'develop',
          isHead: false,
          isRemote: false,
          upstream: null,
          targetOid: 'def456',
          isStale: false,
        },
        {
          name: 'refs/heads/feature/new-feature',
          shorthand: 'feature/new-feature',
          isHead: false,
          isRemote: false,
          upstream: null,
          targetOid: 'ghi789',
          isStale: false,
        },
        {
          name: 'refs/remotes/origin/main',
          shorthand: 'origin/main',
          isHead: false,
          isRemote: true,
          upstream: null,
          targetOid: 'abc123',
          isStale: false,
        },
      ],
    });
  });

  test('should display main branch as current', async () => {
    const mainBranch = leftPanel.getBranch('main');
    await expect(mainBranch).toBeVisible();
  });

  test('should display develop branch', async () => {
    const developBranch = leftPanel.getBranch('develop');
    await expect(developBranch).toBeVisible();
  });

  test('should display feature branch', async () => {
    const featureBranch = leftPanel.getBranch('feature/new-feature');
    await expect(featureBranch).toBeVisible();
  });
});

test.describe('Stash List', () => {
  let app: AppPage;
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    leftPanel = new LeftPanelPage(page);
    await setupOpenRepository(page, {
      stashes: [
        { index: 0, message: 'WIP on main: abc123 some work', oid: 'stash1' },
        { index: 1, message: 'WIP on feature: def456 more work', oid: 'stash2' },
      ],
    });
  });

  test('should display stash list', async () => {
    // Expand stashes section first
    await leftPanel.expandStashes();
    await expect(leftPanel.stashList).toBeVisible();
  });

  test('should show stash count', async () => {
    // Expand stashes section first
    await leftPanel.expandStashes();
    const count = await leftPanel.getStashCount();
    expect(count).toBe(2);
  });
});

test.describe('Tag List', () => {
  let app: AppPage;
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    leftPanel = new LeftPanelPage(page);
    await setupOpenRepository(page, {
      tags: [
        {
          name: 'v1.0.0',
          targetOid: 'abc123',
          message: 'Release v1.0.0',
          tagger: { name: 'Test User', email: 'test@example.com', timestamp: Date.now() / 1000 },
          isAnnotated: true,
        },
        {
          name: 'v1.1.0',
          targetOid: 'def456',
          message: 'Release v1.1.0',
          tagger: null,
          isAnnotated: false,
        },
      ],
    });
  });

  test('should display tag list', async () => {
    // Expand tags section first
    await leftPanel.expandTags();
    await expect(leftPanel.tagList).toBeVisible();
  });

  test('should show tag count', async () => {
    // Expand tags section first
    await leftPanel.expandTags();
    const count = await leftPanel.getTagCount();
    expect(count).toBe(2);
  });

  test('should display v1.0.0 tag', async () => {
    // Expand tags section first
    await leftPanel.expandTags();
    const tag = leftPanel.getTag('v1.0.0');
    await expect(tag).toBeVisible();
  });
});

test.describe('Create Branch Dialog', () => {
  let app: AppPage;
  let leftPanel: LeftPanelPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    leftPanel = new LeftPanelPage(page);
    dialogs = new DialogsPage(page);
    await setupOpenRepository(page);
  });

  test('should open create branch dialog from context menu', async ({ page }) => {
    // Right-click on main branch to open context menu
    await leftPanel.openBranchContextMenu('main');

    // Wait for context menu to appear and click the create branch option
    const contextMenuItem = page.locator('.context-menu-item', { hasText: 'Create branch from here' });
    await contextMenuItem.waitFor({ state: 'visible' });
    await contextMenuItem.click();

    // The create branch dialog's modal should be visible
    await expect(page.locator('lv-create-branch-dialog lv-modal[open]')).toBeVisible();
  });

  test('should allow entering branch name', async ({ page }) => {
    // Open dialog via context menu
    await leftPanel.openBranchContextMenu('main');
    const contextMenuItem = page.locator('.context-menu-item', { hasText: 'Create branch from here' });
    await contextMenuItem.waitFor({ state: 'visible' });
    await contextMenuItem.click();

    // Wait for modal to be visible
    await page.locator('lv-create-branch-dialog lv-modal[open]').waitFor({ state: 'visible' });

    await dialogs.createBranch.fillName('feature/my-new-feature');
    await expect(dialogs.createBranch.nameInput).toHaveValue('feature/my-new-feature');
  });

  test('should have create button', async ({ page }) => {
    await leftPanel.openBranchContextMenu('main');
    const contextMenuItem = page.locator('.context-menu-item', { hasText: 'Create branch from here' });
    await contextMenuItem.waitFor({ state: 'visible' });
    await contextMenuItem.click();

    await page.locator('lv-create-branch-dialog lv-modal[open]').waitFor({ state: 'visible' });

    await expect(dialogs.createBranch.createButton).toBeVisible();
  });

  test('should close dialog with Escape', async ({ page }) => {
    await leftPanel.openBranchContextMenu('main');
    const contextMenuItem = page.locator('.context-menu-item', { hasText: 'Create branch from here' });
    await contextMenuItem.waitFor({ state: 'visible' });
    await contextMenuItem.click();

    await page.locator('lv-create-branch-dialog lv-modal[open]').waitFor({ state: 'visible' });

    await page.keyboard.press('Escape');
    await expect(page.locator('lv-create-branch-dialog lv-modal[open]')).not.toBeVisible();
  });
});

test.describe('Empty Repository Branches', () => {
  let app: AppPage;
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    leftPanel = new LeftPanelPage(page);
    // Setup with no branches (empty/new repo)
    await setupOpenRepository(page, {
      branches: [],
      commits: [],
    });
  });

  test('should handle empty branch list', async () => {
    const count = await leftPanel.getLocalBranchCount();
    expect(count).toBe(0);
  });
});
