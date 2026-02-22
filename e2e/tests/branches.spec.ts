import { test, expect } from '@playwright/test';
import { setupOpenRepository, defaultMockData } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';
import { LeftPanelPage } from '../pages/panels.page';
import { DialogsPage } from '../pages/dialogs.page';
import {
  startCommandCapture,
  startCommandCaptureWithMocks,
  findCommand,
  injectCommandError,
  injectCommandMock,
  autoConfirmDialogs,
  waitForRepositoryChanged,
  waitForCommand,
} from '../fixtures/test-helpers';

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

test.describe('Branch Checkout via Context Menu', () => {
  let app: AppPage;
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    leftPanel = new LeftPanelPage(page);
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
          name: 'refs/heads/feature/checkout-test',
          shorthand: 'feature/checkout-test',
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

  test('should show Checkout option in context menu for non-HEAD branch', async ({ page }) => {
    // Right-click on develop branch (not HEAD)
    await leftPanel.openBranchContextMenu('develop');

    // Checkout option should be visible for non-HEAD branch
    const checkoutMenuItem = page.locator('.context-menu-item', { hasText: 'Checkout' });
    await expect(checkoutMenuItem).toBeVisible();
  });

  test('should NOT show Checkout option for current HEAD branch', async ({ page }) => {
    // Right-click on main branch (HEAD)
    await leftPanel.openBranchContextMenu('main');

    // Wait for context menu to appear
    await page.locator('.context-menu').waitFor({ state: 'visible' });

    // Checkout option should NOT be visible for HEAD branch
    const checkoutMenuItem = page.locator('.context-menu-item', { hasText: 'Checkout' });
    await expect(checkoutMenuItem).not.toBeVisible();
  });

  test('should close context menu after clicking Checkout', async ({ page }) => {
    // Right-click on develop branch
    await leftPanel.openBranchContextMenu('develop');

    // Click the Checkout option
    const checkoutMenuItem = page.locator('.context-menu-item', { hasText: 'Checkout' });
    await checkoutMenuItem.waitFor({ state: 'visible' });
    await checkoutMenuItem.click();

    // Context menu should close after clicking
    await expect(page.locator('.context-menu')).not.toBeVisible();
  });

  test('should invoke checkout command when clicking Checkout button', async ({ page }) => {
    await startCommandCapture(page);

    // Right-click on develop branch
    await leftPanel.openBranchContextMenu('develop');

    // Click the Checkout option
    const checkoutMenuItem = page.locator('.context-menu-item', { hasText: 'Checkout' });
    await checkoutMenuItem.waitFor({ state: 'visible' });
    await checkoutMenuItem.click();

    await waitForCommand(page, 'checkout_with_autostash');

    const commands = await findCommand(page, 'checkout_with_autostash');
    expect(commands.length).toBeGreaterThan(0);
    expect((commands[0].args as { refName?: string })?.refName).toBe('refs/heads/develop');

    // Verify UI: develop should now be the active branch
    const activeBranch = page.locator('lv-branch-list .branch-item.active');
    await expect(activeBranch).toContainText('develop');

    // Verify UI: main should no longer be active
    const mainBranch = leftPanel.getBranch('main');
    await expect(mainBranch).toBeVisible();
    await expect(mainBranch).not.toHaveClass(/active/);
  });

  test('should checkout feature branch via context menu', async ({ page }) => {
    await startCommandCapture(page);

    // Right-click on feature branch
    await leftPanel.openBranchContextMenu('feature/checkout-test');

    // Click the Checkout option
    const checkoutMenuItem = page.locator('.context-menu-item', { hasText: 'Checkout' });
    await checkoutMenuItem.waitFor({ state: 'visible' });
    await checkoutMenuItem.click();

    await waitForCommand(page, 'checkout_with_autostash');

    const commands = await findCommand(page, 'checkout_with_autostash');
    expect(commands.length).toBeGreaterThan(0);
    expect((commands[0].args as { refName?: string })?.refName).toBe(
      'refs/heads/feature/checkout-test'
    );

    // Verify UI: feature/checkout-test should now be the active branch
    const activeBranch = page.locator('lv-branch-list .branch-item.active');
    await expect(activeBranch).toContainText('feature/checkout-test');

    // Verify UI: main should no longer be active
    const mainBranch = leftPanel.getBranch('main');
    await expect(mainBranch).not.toHaveClass(/active/);
  });

  test('should dispatch repository-changed event after checkout', async ({ page }) => {
    const eventReceived = await waitForRepositoryChanged(page, async () => {
      // Right-click on feature branch
      await leftPanel.openBranchContextMenu('feature/checkout-test');

      // Click the Checkout option
      const checkoutMenuItem = page.locator('.context-menu-item', { hasText: 'Checkout' });
      await checkoutMenuItem.waitFor({ state: 'visible' });
      await checkoutMenuItem.click();
    });

    expect(eventReceived).toBe(true);
  });
});

test.describe('Branch Context Menu - Remote Branch Checkout', () => {
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    leftPanel = new LeftPanelPage(page);
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
          name: 'refs/remotes/origin/main',
          shorthand: 'main',
          isHead: false,
          isRemote: true,
          upstream: null,
          targetOid: 'abc123',
          isStale: false,
        },
        {
          name: 'refs/remotes/origin/feature/remote-feature',
          shorthand: 'feature/remote-feature',
          isHead: false,
          isRemote: true,
          upstream: null,
          targetOid: 'def456',
          isStale: false,
        },
        {
          name: 'refs/remotes/origin/copilot/ai-generated-branch',
          shorthand: 'copilot/ai-generated-branch',
          isHead: false,
          isRemote: true,
          upstream: null,
          targetOid: 'ghi789',
          isStale: false,
        },
      ],
    });
  });

  test('should checkout remote branch with correct refName', async ({ page }) => {
    await startCommandCapture(page);

    // Expand the origin remote group to see remote branches
    await leftPanel.expandRemote('origin');

    // Wait for the remote branch to become visible after expanding
    const remoteBranch = leftPanel.getRemoteBranch('origin', 'feature/remote-feature');
    await remoteBranch.waitFor({ state: 'visible', timeout: 5000 });

    // Right-click on remote feature branch
    await remoteBranch.click({ button: 'right' });

    // Click the Checkout option
    const checkoutMenuItem = page.locator('.context-menu-item', { hasText: 'Checkout' });
    await checkoutMenuItem.waitFor({ state: 'visible' });
    await checkoutMenuItem.click();

    await waitForCommand(page, 'checkout_with_autostash');

    const commands = await findCommand(page, 'checkout_with_autostash');
    expect(commands.length).toBeGreaterThan(0);
    expect((commands[0].args as { refName?: string })?.refName).toBe(
      'refs/remotes/origin/feature/remote-feature'
    );
  });

  test('should checkout remote branch with nested prefix (copilot/) correctly', async ({ page }) => {
    await startCommandCapture(page);

    // Expand the origin remote group
    await leftPanel.expandRemote('origin');

    // Wait for the remote branch to become visible after expanding
    const remoteBranch = leftPanel.getRemoteBranch('origin', 'copilot/ai-generated-branch');
    await remoteBranch.waitFor({ state: 'visible', timeout: 5000 });

    // Right-click on the copilot remote branch
    await remoteBranch.click({ button: 'right' });

    // Click the Checkout option
    const checkoutMenuItem = page.locator('.context-menu-item', { hasText: 'Checkout' });
    await checkoutMenuItem.waitFor({ state: 'visible' });
    await checkoutMenuItem.click();

    await waitForCommand(page, 'checkout_with_autostash');

    const commands = await findCommand(page, 'checkout_with_autostash');
    expect(commands.length).toBeGreaterThan(0);
    expect((commands[0].args as { refName?: string })?.refName).toBe(
      'refs/remotes/origin/copilot/ai-generated-branch'
    );
  });

  test('should show error toast when remote branch checkout fails', async ({ page }) => {
    // Inject checkout failure for remote branch
    await injectCommandError(page, 'checkout_with_autostash', 'Failed to create local tracking branch');

    // Expand the origin remote group
    await leftPanel.expandRemote('origin');

    // Right-click on remote feature branch
    const remoteBranch = leftPanel.getRemoteBranch('origin', 'feature/remote-feature');
    await remoteBranch.waitFor({ state: 'visible', timeout: 5000 });
    await remoteBranch.click({ button: 'right' });

    // Click the Checkout option
    const checkoutMenuItem = page.locator('.context-menu-item', { hasText: 'Checkout' });
    await checkoutMenuItem.waitFor({ state: 'visible' });
    await checkoutMenuItem.click();

    // Verify error toast appears with the error message
    const toastMessage = page.locator('lv-toast-container .toast.error .toast-message');
    await expect(toastMessage).toBeVisible();
    await expect(toastMessage).toContainText('Failed to create local tracking branch');

    // Verify main is still the active branch (checkout failed, HEAD unchanged)
    const activeBranch = page.locator('lv-branch-list .branch-item.active');
    await expect(activeBranch).toContainText('main');
  });
});

test.describe('Empty Repository Branches', () => {
  let app: AppPage;
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    leftPanel = new LeftPanelPage(page);
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

test.describe('Branch Checkout - Error Handling', () => {
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    leftPanel = new LeftPanelPage(page);
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
      ],
    });
  });

  test('should show error toast when checkout fails', async ({ page }) => {
    // Inject checkout failure for checkout_with_autostash
    await injectCommandError(page, 'checkout_with_autostash', 'Checkout failed: uncommitted changes');

    // Attempt checkout
    await leftPanel.openBranchContextMenu('develop');
    const checkoutMenuItem = page.locator('.context-menu-item', { hasText: 'Checkout' });
    await checkoutMenuItem.waitFor({ state: 'visible' });
    await checkoutMenuItem.click();

    // Verify the toast is shown in the DOM (toast container renders error toasts)
    const toastMessage = page.locator('lv-toast-container .toast.error .toast-message');
    await expect(toastMessage).toBeVisible();
    await expect(toastMessage).toContainText('Checkout failed');
  });

  test('should keep branch list unchanged after checkout failure', async ({ page }) => {
    // Inject checkout failure
    await injectCommandError(page, 'checkout', 'Checkout failed: merge conflicts');

    // Attempt checkout
    await leftPanel.openBranchContextMenu('develop');
    const checkoutMenuItem = page.locator('.context-menu-item', { hasText: 'Checkout' });
    await checkoutMenuItem.waitFor({ state: 'visible' });
    await checkoutMenuItem.click();

    // main should still be HEAD (visible as current branch)
    await expect(leftPanel.currentBranch).toBeVisible();
    // develop should still be listed
    await expect(leftPanel.getBranch('develop')).toBeVisible();
  });
});

test.describe('Branch Delete via Context Menu', () => {
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    leftPanel = new LeftPanelPage(page);
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
          name: 'refs/heads/feature/to-delete',
          shorthand: 'feature/to-delete',
          isHead: false,
          isRemote: false,
          upstream: null,
          targetOid: 'def456',
          isStale: false,
        },
      ],
    });
  });

  test('should invoke delete_branch command via context menu', async ({ page }) => {
    await startCommandCaptureWithMocks(page, {
      'plugin:dialog|confirm': true,
      'plugin:dialog|ask': true,
    });

    await leftPanel.openBranchContextMenu('feature/to-delete');
    const deleteItem = page.locator('.context-menu-item', { hasText: /delete/i });
    await deleteItem.waitFor({ state: 'visible' });
    await deleteItem.click();

    // Verify the deleted branch no longer appears in the list
    await expect(leftPanel.getBranch('feature/to-delete')).not.toBeVisible();

    const deleteCommands = await findCommand(page, 'delete_branch');
    expect(deleteCommands.length).toBeGreaterThan(0);
  });

  test('should dispatch repository-changed event after branch deletion', async ({ page }) => {
    await startCommandCaptureWithMocks(page, {
      'plugin:dialog|confirm': true,
      'plugin:dialog|ask': true,
    });

    const eventReceived = await waitForRepositoryChanged(page, async () => {
      await leftPanel.openBranchContextMenu('feature/to-delete');
      const deleteItem = page.locator('.context-menu-item', { hasText: /delete/i });
      await deleteItem.waitFor({ state: 'visible' });
      await deleteItem.click();
    });

    expect(eventReceived).toBe(true);
  });
});

test.describe('Branch Create via Context Menu', () => {
  let leftPanel: LeftPanelPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    leftPanel = new LeftPanelPage(page);
    dialogs = new DialogsPage(page);
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
      ],
    });
  });

  test('should invoke create_branch when submitting the dialog', async ({ page }) => {
    await startCommandCapture(page);

    // Open create branch dialog
    await leftPanel.openBranchContextMenu('main');
    const createMenuItem = page.locator('.context-menu-item', { hasText: 'Create branch from here' });
    await createMenuItem.waitFor({ state: 'visible' });
    await createMenuItem.click();

    await page.locator('lv-create-branch-dialog lv-modal[open]').waitFor({ state: 'visible' });

    // Fill in branch name and submit
    await dialogs.createBranch.fillName('feature/new-branch');
    await dialogs.createBranch.createButton.click();

    // Verify the dialog closes after successful creation
    await expect(page.locator('lv-create-branch-dialog lv-modal[open]')).not.toBeVisible();

    // Verify the new branch appears in the branch list
    await expect(leftPanel.getBranch('feature/new-branch')).toBeVisible();

    const createCommands = await findCommand(page, 'create_branch');
    expect(createCommands.length).toBeGreaterThan(0);
  });

  test('should dispatch repository-changed event after branch creation', async ({ page }) => {
    const eventReceived = await waitForRepositoryChanged(page, async () => {
      await leftPanel.openBranchContextMenu('main');
      const createMenuItem = page.locator('.context-menu-item', { hasText: 'Create branch from here' });
      await createMenuItem.waitFor({ state: 'visible' });
      await createMenuItem.click();

      await page.locator('lv-create-branch-dialog lv-modal[open]').waitFor({ state: 'visible' });

      await dialogs.createBranch.fillName('feature/created-branch');
      await dialogs.createBranch.createButton.click();
    });

    expect(eventReceived).toBe(true);
  });
});

test.describe('Branch Checkout - HEAD Indicator Update', () => {
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    leftPanel = new LeftPanelPage(page);
    await setupOpenRepository(page, {
      branches: [
        {
          name: 'refs/heads/main',
          shorthand: 'main',
          isHead: true,
          isRemote: false,
          upstream: null,
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
      ],
    });
  });

  test('should invoke checkout with correct refName for target branch', async ({ page }) => {
    await startCommandCapture(page);

    await leftPanel.openBranchContextMenu('develop');
    const checkoutMenuItem = page.locator('.context-menu-item', { hasText: 'Checkout' });
    await checkoutMenuItem.waitFor({ state: 'visible' });
    await checkoutMenuItem.click();

    await waitForCommand(page, 'checkout_with_autostash');

    const checkoutCommands = await findCommand(page, 'checkout_with_autostash');
    expect(checkoutCommands.length).toBeGreaterThan(0);
    expect((checkoutCommands[0].args as { refName?: string })?.refName).toBe('refs/heads/develop');

    // Verify the DOM reflects the new HEAD: develop should now be the active branch
    const activeBranch = page.locator('lv-branch-list .branch-item.active');
    await expect(activeBranch).toContainText('develop');
  });

  test('should trigger branch list refresh after checkout', async ({ page }) => {
    await startCommandCapture(page);

    await leftPanel.openBranchContextMenu('develop');
    const checkoutMenuItem = page.locator('.context-menu-item', { hasText: 'Checkout' });
    await checkoutMenuItem.waitFor({ state: 'visible' });
    await checkoutMenuItem.click();

    await waitForCommand(page, 'checkout_with_autostash');

    // After checkout, a get_branches call should be made to refresh the branch list
    // Wait for the refresh call after checkout
    await waitForCommand(page, 'get_branches');

    const branchCommands = await findCommand(page, 'get_branches');
    expect(branchCommands.length).toBeGreaterThan(0);

    // Verify the DOM shows develop as the active (HEAD) branch
    const activeBranch = page.locator('lv-branch-list .branch-item.active');
    await expect(activeBranch).toContainText('develop');
  });
});

test.describe('Remote Branch Checkout - Creates Local Tracking Branch', () => {
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    leftPanel = new LeftPanelPage(page);
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
          name: 'refs/remotes/origin/main',
          shorthand: 'main',
          isHead: false,
          isRemote: true,
          upstream: null,
          targetOid: 'abc123',
          isStale: false,
        },
        {
          name: 'refs/remotes/origin/feature-x',
          shorthand: 'feature-x',
          isHead: false,
          isRemote: true,
          upstream: null,
          targetOid: 'def456',
          isStale: false,
        },
      ],
    });
  });

  test('should create local tracking branch and show it as HEAD after checkout', async ({ page }) => {
    await startCommandCapture(page);

    // Expand origin remote group
    await leftPanel.expandRemote('origin');

    // Right-click on remote feature-x branch
    const remoteBranch = leftPanel.getRemoteBranch('origin', 'feature-x');
    await remoteBranch.waitFor({ state: 'visible', timeout: 5000 });
    await remoteBranch.click({ button: 'right' });

    // Click Checkout
    const checkoutMenuItem = page.locator('.context-menu-item', { hasText: 'Checkout' });
    await checkoutMenuItem.waitFor({ state: 'visible' });
    await checkoutMenuItem.click();

    await waitForCommand(page, 'checkout_with_autostash');

    // Verify checkout command was called
    const checkoutCommands = await findCommand(page, 'checkout_with_autostash');
    expect(checkoutCommands.length).toBeGreaterThan(0);
    expect((checkoutCommands[0].args as { refName?: string })?.refName).toBe(
      'refs/remotes/origin/feature-x'
    );

    // Verify: new local branch feature-x should now appear and be the active (HEAD) branch
    const activeBranch = page.locator('lv-branch-list .branch-item.active');
    await expect(activeBranch).toContainText('feature-x');

    // Verify: the new local branch should be in the branch list
    await expect(leftPanel.getBranch('feature-x')).toBeVisible();
  });
});

test.describe('Detached HEAD State', () => {
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    leftPanel = new LeftPanelPage(page);
    await setupOpenRepository(page, {
      repository: {
        ...defaultMockData.repository,
        headRef: null,
      },
      branches: [
        {
          name: 'refs/heads/main',
          shorthand: 'main',
          isHead: false,
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
      ],
    });
  });

  test('should not show any branch as active when HEAD is detached', async ({ page }) => {
    // No branch should have the active class
    const activeBranches = page.locator('lv-branch-list .branch-item.active');
    await expect(activeBranches).toHaveCount(0);
  });

  test('should still display all branches in detached HEAD state', async () => {
    const count = await leftPanel.getLocalBranchCount();
    expect(count).toBe(2);
  });
});

test.describe('Branches - UI Outcome Verification', () => {
  let leftPanel: LeftPanelPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    leftPanel = new LeftPanelPage(page);
    dialogs = new DialogsPage(page);
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
          name: 'refs/heads/feature/old-feature',
          shorthand: 'feature/old-feature',
          isHead: false,
          isRemote: false,
          upstream: null,
          targetOid: 'ghi789',
          isStale: false,
        },
      ],
    });
  });

  test('should decrease branch count after deleting a branch', async ({ page }) => {
    // Verify initial branch count
    const initialCount = await leftPanel.getLocalBranchCount();
    expect(initialCount).toBe(3);

    // Set up command capture with dialog auto-confirm
    await startCommandCaptureWithMocks(page, {
      'plugin:dialog|confirm': true,
      'plugin:dialog|ask': true,
    });

    // Delete the feature/old-feature branch via context menu
    await leftPanel.openBranchContextMenu('feature/old-feature');
    const deleteItem = page.locator('.context-menu-item', { hasText: /delete/i });
    await deleteItem.waitFor({ state: 'visible' });
    await deleteItem.click();

    // Verify the branch is removed from the list
    await expect(leftPanel.getBranch('feature/old-feature')).not.toBeVisible();

    // Verify the branch count decreased
    const finalCount = await leftPanel.getLocalBranchCount();
    expect(finalCount).toBe(2);
  });

  test('should close dialog and show new branch in list after creation', async ({ page }) => {
    await startCommandCapture(page);

    // Open create branch dialog from context menu
    await leftPanel.openBranchContextMenu('main');
    const createMenuItem = page.locator('.context-menu-item', { hasText: 'Create branch from here' });
    await createMenuItem.waitFor({ state: 'visible' });
    await createMenuItem.click();

    // Wait for dialog to open
    await page.locator('lv-create-branch-dialog lv-modal[open]').waitFor({ state: 'visible' });

    // Fill in branch name and submit
    await dialogs.createBranch.fillName('feature/brand-new');
    await dialogs.createBranch.createButton.click();

    // Verify the dialog closes
    await expect(page.locator('lv-create-branch-dialog lv-modal[open]')).not.toBeVisible();

    // Verify the new branch appears in the branch list
    await expect(leftPanel.getBranch('feature/brand-new')).toBeVisible();
  });

  test('should show error when create_branch fails', async ({ page }) => {
    // Inject create_branch failure
    await injectCommandError(page, 'create_branch', 'Branch already exists');

    // Open create branch dialog from context menu
    await leftPanel.openBranchContextMenu('main');
    const createMenuItem = page.locator('.context-menu-item', { hasText: 'Create branch from here' });
    await createMenuItem.waitFor({ state: 'visible' });
    await createMenuItem.click();

    // Wait for dialog to open
    await page.locator('lv-create-branch-dialog lv-modal[open]').waitFor({ state: 'visible' });

    // Fill in branch name and attempt to create
    await dialogs.createBranch.fillName('develop');
    await dialogs.createBranch.createButton.click();

    // Verify error is shown (either toast or error banner within dialog)
    const errorIndicator = page.locator(
      'lv-toast-container .toast.error .toast-message, lv-create-branch-dialog .error-message, lv-create-branch-dialog .error'
    );
    await expect(errorIndicator).toBeVisible();
  });

  test('should show error when delete_branch fails', async ({ page }) => {
    // Inject delete_branch failure
    await injectCommandError(page, 'delete_branch', 'Cannot delete current branch');

    // Auto-confirm the delete dialog
    await autoConfirmDialogs(page);

    // Attempt to delete develop branch via context menu
    await leftPanel.openBranchContextMenu('develop');
    const deleteItem = page.locator('.context-menu-item', { hasText: /delete/i });
    await deleteItem.waitFor({ state: 'visible' });
    await deleteItem.click();

    // Verify error toast is shown
    const toastMessage = page.locator('lv-toast-container .toast.error .toast-message');
    await expect(toastMessage).toBeVisible();
    await expect(toastMessage).toContainText('Cannot delete current branch');

    // Verify the branch is still in the list (delete failed)
    await expect(leftPanel.getBranch('develop')).toBeVisible();
  });
});
