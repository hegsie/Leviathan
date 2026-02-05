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

test.describe('Branch Checkout via Context Menu', () => {
  let app: AppPage;
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    leftPanel = new LeftPanelPage(page);
    // Setup with multiple branches where main is HEAD
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
    // Track invoked commands
    const invokedCommands: { command: string; args: unknown }[] = [];

    // Intercept Tauri invoke calls to track checkout command
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
        __INVOKED_COMMANDS__: { command: string; args: unknown }[];
      }).__INVOKED_COMMANDS__ = [];

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
          .__INVOKED_COMMANDS__.push({ command, args });
        return originalInvoke(command, args);
      };
    });

    // Right-click on develop branch
    await leftPanel.openBranchContextMenu('develop');

    // Click the Checkout option
    const checkoutMenuItem = page.locator('.context-menu-item', { hasText: 'Checkout' });
    await checkoutMenuItem.waitFor({ state: 'visible' });
    await checkoutMenuItem.click();

    // Wait a bit for the command to be invoked
    await page.waitForTimeout(100);

    // Check that checkout command was called with correct arguments
    const commands = await page.evaluate(() => {
      return (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
        .__INVOKED_COMMANDS__;
    });

    const checkoutCommand = commands.find(
      (c: { command: string }) => c.command === 'checkout'
    );
    expect(checkoutCommand).toBeDefined();
    expect((checkoutCommand?.args as { refName?: string })?.refName).toBe('refs/heads/develop');
  });

  test('should checkout feature branch via context menu', async ({ page }) => {
    // Track invoked commands
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
        return originalInvoke(command, args);
      };
    });

    // Right-click on feature branch
    await leftPanel.openBranchContextMenu('feature/checkout-test');

    // Click the Checkout option
    const checkoutMenuItem = page.locator('.context-menu-item', { hasText: 'Checkout' });
    await checkoutMenuItem.waitFor({ state: 'visible' });
    await checkoutMenuItem.click();

    // Wait for the command to be invoked
    await page.waitForTimeout(100);

    // Verify checkout was called with the feature branch name
    const commands = await page.evaluate(() => {
      return (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
        .__INVOKED_COMMANDS__;
    });

    const checkoutCommand = commands.find(
      (c: { command: string }) => c.command === 'checkout'
    );
    expect(checkoutCommand).toBeDefined();
    expect((checkoutCommand?.args as { refName?: string })?.refName).toBe(
      'refs/heads/feature/checkout-test'
    );
  });

  test('should dispatch repository-changed event after checkout', async ({ page }) => {
    // Listen for repository-changed event
    const eventPromise = page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        document.addEventListener('repository-changed', () => {
          resolve(true);
        }, { once: true });
        // Timeout after 3 seconds
        setTimeout(() => resolve(false), 3000);
      });
    });

    // Right-click on feature branch
    await leftPanel.openBranchContextMenu('feature/checkout-test');

    // Click the Checkout option
    const checkoutMenuItem = page.locator('.context-menu-item', { hasText: 'Checkout' });
    await checkoutMenuItem.waitFor({ state: 'visible' });
    await checkoutMenuItem.click();

    // Verify repository-changed event was dispatched
    const eventReceived = await eventPromise;
    expect(eventReceived).toBe(true);
  });
});

test.describe('Branch Context Menu - Remote Branch Checkout', () => {
  let leftPanel: LeftPanelPage;

  test.beforeEach(async ({ page }) => {
    leftPanel = new LeftPanelPage(page);
    // Setup with remote branches including nested prefixes (like copilot/feature-name)
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
    // Track invoked commands
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
        return originalInvoke(command, args);
      };
    });

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

    // Wait for the command to be invoked
    await page.waitForTimeout(100);

    // Verify checkout was called with the FULL remote reference (branch.name), not shorthand
    // This is critical - using shorthand would fail for remote branches with prefixes
    const commands = await page.evaluate(() => {
      return (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
        .__INVOKED_COMMANDS__;
    });

    const checkoutCommand = commands.find(
      (c: { command: string }) => c.command === 'checkout'
    );
    expect(checkoutCommand).toBeDefined();
    // Should be the full remote reference (branch.name), not just the shorthand
    expect((checkoutCommand?.args as { refName?: string })?.refName).toBe(
      'refs/remotes/origin/feature/remote-feature'
    );
  });

  test('should checkout remote branch with nested prefix (copilot/) correctly', async ({ page }) => {
    // This test specifically catches the bug where copilot/branch-name was being passed
    // instead of refs/remotes/origin/copilot/branch-name
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
        return originalInvoke(command, args);
      };
    });

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

    await page.waitForTimeout(100);

    const commands = await page.evaluate(() => {
      return (window as unknown as { __INVOKED_COMMANDS__: { command: string; args: unknown }[] })
        .__INVOKED_COMMANDS__;
    });

    const checkoutCommand = commands.find(
      (c: { command: string }) => c.command === 'checkout'
    );
    expect(checkoutCommand).toBeDefined();
    // CRITICAL: Must include 'refs/remotes/origin/' prefix, not just 'copilot/ai-generated-branch'
    expect((checkoutCommand?.args as { refName?: string })?.refName).toBe(
      'refs/remotes/origin/copilot/ai-generated-branch'
    );
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
