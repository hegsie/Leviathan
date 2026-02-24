import { test, expect } from '@playwright/test';
import { setupTauriMocks, emptyRepository } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';
import { DialogsPage } from '../pages/dialogs.page';
import { startCommandCapture, findCommand, waitForCommand, injectCommandError } from '../fixtures/test-helpers';

test.describe('Welcome Screen', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    // Setup Tauri mocks with empty repository (no repo open)
    await setupTauriMocks(page, emptyRepository());
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await app.goto();
  });

  test('should display welcome screen when no repository is open', async () => {
    await expect(app.welcomeScreen).toBeVisible();
    await expect(app.welcomeLogo).toHaveText('Leviathan');
    await expect(app.welcomeTagline).toContainText('Git client');
  });

  test('should display all action buttons', async ({ page }) => {
    await expect(app.openButton).toBeVisible();
    await expect(app.cloneButton).toBeVisible();
    await expect(app.initButton).toBeVisible();

    // Verify button text
    await expect(app.openButton).toContainText('Open');
    await expect(app.cloneButton).toContainText('Clone');
    await expect(app.initButton).toContainText('Init');
  });

  test('should open clone dialog when Clone button is clicked', async () => {
    await app.cloneButton.click();
    await expect(dialogs.clone.dialog).toBeVisible();
  });

  test('should open init dialog when Init button is clicked', async () => {
    await app.initButton.click();
    await expect(dialogs.init.dialog).toBeVisible();
  });

  test('should close clone dialog with Escape key', async () => {
    await app.cloneButton.click();
    await expect(dialogs.clone.dialog).toBeVisible();

    await dialogs.clone.closeWithEscape();
    await expect(dialogs.clone.dialog).not.toBeVisible();
  });

  test('should close init dialog with Escape key', async () => {
    await app.initButton.click();
    await expect(dialogs.init.dialog).toBeVisible();

    await dialogs.init.closeWithEscape();
    await expect(dialogs.init.dialog).not.toBeVisible();
  });

  test('should display recent repositories section', async () => {
    await expect(app.recentSection).toBeVisible();
  });

  test('should show empty message when no recent repositories', async () => {
    const emptyMessage = app.welcomeScreen.locator('.empty-recent');
    await expect(emptyMessage).toContainText('No recent repositories');
  });
});

test.describe('Welcome Screen with Recent Repositories', () => {
  let app: AppPage;

  test.beforeEach(async ({ page }) => {
    // Setup Tauri mocks with some recent repositories
    await page.addInitScript(() => {
      (window as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: async (command: string) => {
          switch (command) {
            case 'get_recent_repositories':
              return [
                { path: '/path/to/repo1', name: 'repo1' },
                { path: '/path/to/repo2', name: 'repo2' },
              ];
            case 'get_repository_info':
              return null; // No repo open
            default:
              return null;
          }
        },
        transformCallback: () => 0,
        convertFileSrc: (path: string) => path,
      };
    });

    app = new AppPage(page);
    await app.goto();
  });

  test('should display recent repository items', async () => {
    // Note: This test depends on how the store initializes recent repos
    // The component may need to call get_recent_repositories
    await expect(app.recentSection).toBeVisible();
  });

  test('should call open_repository when clicking a recent repo', async ({ page }) => {
    // Recent items should render from the mock data
    const recentItem = app.recentItems.first();
    await expect(recentItem).toBeVisible({ timeout: 5000 });

    await startCommandCapture(page);
    await recentItem.click();

    await waitForCommand(page, 'open_repository');

    const openCmds = await findCommand(page, 'open_repository');
    expect(openCmds.length).toBeGreaterThanOrEqual(1);
    expect((openCmds[0].args as { path?: string })?.path).toBe('/path/to/repo1');

    // Verify the welcome screen is still visible (mock returns null, so no repo loads)
    await expect(app.welcomeScreen).toBeVisible();
  });
});

test.describe('Clone Dialog', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page, emptyRepository());
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await app.goto();
    await app.cloneButton.click();
    await dialogs.clone.waitForOpen();
  });

  test('should have URL input field', async () => {
    await expect(dialogs.clone.urlInput).toBeVisible();
  });

  test('should have Clone button', async () => {
    await expect(dialogs.clone.cloneButton).toBeVisible();
  });

  test('should allow entering repository URL', async () => {
    await dialogs.clone.fillUrl('https://github.com/test/repo.git');
    await expect(dialogs.clone.urlInput).toHaveValue('https://github.com/test/repo.git');
  });
});

test.describe('Clone Dialog - Command Verification', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page, emptyRepository());
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await app.goto();
    await app.cloneButton.click();
    await dialogs.clone.waitForOpen();
  });

  test('should call clone_repository with correct URL and path', async ({ page }) => {
    // Fill in the clone form
    await dialogs.clone.fillUrl('https://github.com/user/my-project.git');
    await dialogs.clone.fillPath('/home/user/projects');

    // Start capturing commands before clicking clone
    await startCommandCapture(page);

    // Click the clone button
    await dialogs.clone.clone();

    await waitForCommand(page, 'clone_repository');

    // Verify clone_repository was called with the correct arguments
    const cloneCmds = await findCommand(page, 'clone_repository');
    expect(cloneCmds.length).toBeGreaterThanOrEqual(1);

    const args = cloneCmds[0].args as { url?: string; path?: string };
    expect(args.url).toBe('https://github.com/user/my-project.git');
    // The dialog constructs the full path as destination/repoName
    expect(args.path).toBe('/home/user/projects/my-project');
  });

  test('should call clone_repository with SSH URL', async ({ page }) => {
    await dialogs.clone.fillUrl('git@github.com:user/ssh-repo.git');
    await dialogs.clone.fillPath('/tmp/clones');

    await startCommandCapture(page);
    await dialogs.clone.clone();

    await waitForCommand(page, 'clone_repository');

    const cloneCmds = await findCommand(page, 'clone_repository');
    expect(cloneCmds.length).toBeGreaterThanOrEqual(1);

    const args = cloneCmds[0].args as { url?: string; path?: string };
    expect(args.url).toBe('git@github.com:user/ssh-repo.git');
    expect(args.path).toBe('/tmp/clones/ssh-repo');
  });

  test('should not call clone_repository when URL is empty', async ({ page }) => {
    // Only fill destination, leave URL empty
    await dialogs.clone.fillPath('/home/user/projects');

    // The Clone button should be disabled when URL is empty
    await expect(dialogs.clone.cloneButton).toBeDisabled();

    // Verify the dialog remains open
    await expect(dialogs.clone.dialog).toBeVisible();
  });

  test('should not call clone_repository when destination is empty', async ({ page }) => {
    // Only fill URL, leave destination empty
    await dialogs.clone.fillUrl('https://github.com/user/repo.git');

    // The Clone button should be disabled when destination is empty
    await expect(dialogs.clone.cloneButton).toBeDisabled();

    // Verify the dialog remains open
    await expect(dialogs.clone.dialog).toBeVisible();
  });
});

test.describe('Clone Dialog - Error Handling', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page, emptyRepository());
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await app.goto();
    await app.cloneButton.click();
    await dialogs.clone.waitForOpen();
  });

  test('should show error message when clone fails', async ({ page }) => {
    // Fill in valid form data
    await dialogs.clone.fillUrl('https://github.com/user/nonexistent-repo.git');
    await dialogs.clone.fillPath('/home/user/projects');

    // Inject error for clone_repository command
    await injectCommandError(page, 'clone_repository', 'Repository not found');

    // Click clone
    await dialogs.clone.clone();

    // Verify error message is displayed in the dialog
    const errorMessage = page.locator('lv-clone-dialog .error-message');
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toContainText('Repository not found');
  });

  test('should disable clone button when URL is empty', async ({ page }) => {
    // Leave URL empty but fill destination
    await dialogs.clone.fillPath('/home/user/projects');

    // The Clone button should be disabled when URL is empty (validation at button level)
    await expect(dialogs.clone.cloneButton).toBeDisabled();

    // Dialog should remain open
    await expect(dialogs.clone.dialog).toBeVisible();
  });

  test('should disable clone button when destination is empty', async ({ page }) => {
    // Fill URL but leave destination empty
    await dialogs.clone.fillUrl('https://github.com/user/repo.git');

    // The Clone button should be disabled when destination is empty (validation at button level)
    await expect(dialogs.clone.cloneButton).toBeDisabled();

    // Dialog should remain open
    await expect(dialogs.clone.dialog).toBeVisible();
  });

  test('should clear error message when user edits URL after error', async ({ page }) => {
    // Trigger a clone error by filling both fields and injecting an error
    await dialogs.clone.fillUrl('https://github.com/user/bad-repo.git');
    await dialogs.clone.fillPath('/home/user/projects');

    await injectCommandError(page, 'clone_repository', 'Repository not found');
    await dialogs.clone.clone();

    const errorMessage = page.locator('lv-clone-dialog .error-message');
    await expect(errorMessage).toBeVisible();

    // Edit the URL field -- error should clear
    await dialogs.clone.fillUrl('https://github.com/user/good-repo.git');
    await expect(errorMessage).not.toBeVisible();
  });

  test('should show network error message on clone failure', async ({ page }) => {
    await dialogs.clone.fillUrl('https://github.com/user/repo.git');
    await dialogs.clone.fillPath('/home/user/projects');

    // Inject a network-style error
    await injectCommandError(page, 'clone_repository', 'Failed to connect: network unreachable');

    await dialogs.clone.clone();

    const errorMessage = page.locator('lv-clone-dialog .error-message');
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toContainText('Failed to connect');
  });
});

test.describe('Init Dialog', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page, emptyRepository());
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await app.goto();
    await app.initButton.click();
    await dialogs.init.waitForOpen();
  });

  test('should have path input field', async () => {
    await expect(dialogs.init.pathInput).toBeVisible();
  });

  test('should have Initialize button', async () => {
    await expect(dialogs.init.initButton).toBeVisible();
  });

  test('should allow entering directory path', async () => {
    await dialogs.init.fillPath('/path/to/new/repo');
    await expect(dialogs.init.pathInput).toHaveValue('/path/to/new/repo');
  });
});

test.describe('Init Dialog - Command Verification', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page, emptyRepository());
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await app.goto();
    await app.initButton.click();
    await dialogs.init.waitForOpen();
  });

  test('should call init_repository with correct path', async ({ page }) => {
    await dialogs.init.fillPath('/home/user/new-project');

    // Start capturing commands before clicking init
    await startCommandCapture(page);

    await dialogs.init.init();

    await waitForCommand(page, 'init_repository');

    const initCmds = await findCommand(page, 'init_repository');
    expect(initCmds.length).toBeGreaterThanOrEqual(1);

    const args = initCmds[0].args as { path?: string; bare?: boolean };
    expect(args.path).toBe('/home/user/new-project');
    expect(args.bare).toBe(false);
  });

  test('should call init_repository with bare=true when bare checkbox is checked', async ({ page }) => {
    await dialogs.init.fillPath('/home/user/bare-repo');
    await dialogs.init.setBare(true);

    await startCommandCapture(page);

    await dialogs.init.init();

    await waitForCommand(page, 'init_repository');

    const initCmds = await findCommand(page, 'init_repository');
    expect(initCmds.length).toBeGreaterThanOrEqual(1);

    const args = initCmds[0].args as { path?: string; bare?: boolean };
    expect(args.path).toBe('/home/user/bare-repo');
    expect(args.bare).toBe(true);
  });

  test('should not call init_repository when path is empty', async ({ page }) => {
    // Leave path empty - the Initialize button should be disabled
    await expect(dialogs.init.initButton).toBeDisabled();

    // Verify the dialog remains open
    await expect(dialogs.init.dialog).toBeVisible();
  });
});

test.describe('Init Dialog - Error Handling', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    await setupTauriMocks(page, emptyRepository());
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await app.goto();
    await app.initButton.click();
    await dialogs.init.waitForOpen();
  });

  test('should show error message when init fails', async ({ page }) => {
    await dialogs.init.fillPath('/home/user/new-project');

    // Inject error for init_repository command
    await injectCommandError(page, 'init_repository', 'Permission denied: cannot create directory');

    await dialogs.init.init();

    // Verify error message is displayed in the dialog
    const errorMessage = page.locator('lv-init-dialog .error-message');
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toContainText('Permission denied');
  });

  test('should disable init button when path is empty', async ({ page }) => {
    // Leave path empty - the Initialize button should be disabled (validation at button level)
    await expect(dialogs.init.initButton).toBeDisabled();

    // Dialog should remain open
    await expect(dialogs.init.dialog).toBeVisible();
  });

  test('should clear error message when user edits path after error', async ({ page }) => {
    // Trigger an init error by filling path and injecting an error
    await dialogs.init.fillPath('/home/user/existing-project');

    await injectCommandError(page, 'init_repository', 'Directory already exists');
    await dialogs.init.init();

    const errorMessage = page.locator('lv-init-dialog .error-message');
    await expect(errorMessage).toBeVisible();

    // Edit the path field -- error should clear
    await dialogs.init.fillPath('/home/user/new-project');
    await expect(errorMessage).not.toBeVisible();
  });

  test('should show error when directory already contains a git repo', async ({ page }) => {
    await dialogs.init.fillPath('/home/user/existing-repo');

    // Inject a specific error simulating an existing repo
    await injectCommandError(page, 'init_repository', 'Directory already contains a .git directory');

    await dialogs.init.init();

    const errorMessage = page.locator('lv-init-dialog .error-message');
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toContainText('already contains');
  });
});

// ============================================================================
// Extended Tests - Transition After Success
// ============================================================================

test.describe('Welcome - Extended Tests', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test('clone success should transition away from welcome screen to repo view', async ({ page }) => {
    // Set up Tauri mocks with empty repo initially (welcome screen visible)
    await setupTauriMocks(page, emptyRepository());
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await app.goto();

    // Verify welcome screen is shown
    await expect(app.welcomeScreen).toBeVisible();

    // Open clone dialog
    await app.cloneButton.click();
    await dialogs.clone.waitForOpen();

    // Fill in clone form
    await dialogs.clone.fillUrl('https://github.com/user/my-project.git');
    await dialogs.clone.fillPath('/home/user/projects');

    // Mock clone_repository to succeed and return a valid repository
    // After clone, the app opens the repository, so we need open_repository to return data
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'clone_repository') {
          return { path: '/home/user/projects/my-project', name: 'my-project' };
        }
        if (command === 'open_repository' || command === 'get_repository_info') {
          return {
            path: '/home/user/projects/my-project',
            name: 'my-project',
            isValid: true,
            isBare: false,
            headRef: 'refs/heads/main',
            state: 'clean',
          };
        }
        return originalInvoke(command, args);
      };
    });

    // Click clone
    await dialogs.clone.clone();

    // Verify the clone dialog closes (either closes or shows progress then closes)
    await expect(dialogs.clone.dialog).not.toBeVisible({ timeout: 10000 });

    // After successful clone, the welcome screen should no longer be visible
    // as the app transitions to the repository view
    await expect(app.welcomeScreen).not.toBeVisible({ timeout: 10000 });

    // Verify the repository view components actually loaded
    await expect(app.toolbar).toBeVisible({ timeout: 10000 });
    await expect(app.leftPanel).toBeVisible({ timeout: 10000 });
    await expect(app.centerPanel).toBeVisible({ timeout: 10000 });
  });

  test('init success should transition away from welcome screen', async ({ page }) => {
    // Set up Tauri mocks with empty repo initially (welcome screen visible)
    await setupTauriMocks(page, emptyRepository());
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await app.goto();

    // Verify welcome screen is shown
    await expect(app.welcomeScreen).toBeVisible();

    // Open init dialog
    await app.initButton.click();
    await dialogs.init.waitForOpen();

    // Fill in init form
    await dialogs.init.fillPath('/home/user/new-project');

    // Mock init_repository to succeed and return a valid repository
    // After init, the app opens the repository
    await page.evaluate(() => {
      const originalInvoke = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke;

      (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__.invoke = async (command: string, args?: unknown) => {
        if (command === 'init_repository') {
          return { path: '/home/user/new-project', name: 'new-project' };
        }
        if (command === 'open_repository' || command === 'get_repository_info') {
          return {
            path: '/home/user/new-project',
            name: 'new-project',
            isValid: true,
            isBare: false,
            headRef: 'refs/heads/main',
            state: 'clean',
          };
        }
        return originalInvoke(command, args);
      };
    });

    // Click init
    await dialogs.init.init();

    // Verify the init dialog closes
    await expect(dialogs.init.dialog).not.toBeVisible({ timeout: 10000 });

    // After successful init, the welcome screen should no longer be visible
    await expect(app.welcomeScreen).not.toBeVisible({ timeout: 10000 });

    // Verify the repository view components actually loaded
    await expect(app.toolbar).toBeVisible({ timeout: 10000 });
    await expect(app.leftPanel).toBeVisible({ timeout: 10000 });
    await expect(app.centerPanel).toBeVisible({ timeout: 10000 });
  });
});
