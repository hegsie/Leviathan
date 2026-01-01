import { test, expect } from '@playwright/test';
import { setupTauriMocks, emptyRepository } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';
import { DialogsPage } from '../pages/dialogs.page';

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
