import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';
import { DialogsPage } from '../pages/dialogs.page';
import {
  startCommandCapture,
  findCommand,
  injectCommandError,
  injectCommandMock,
  startCommandCaptureWithMocks,
  waitForCommand,
} from '../fixtures/test-helpers';

/**
 * E2E tests for Bitbucket Dialog
 * Tests dialog display, connection flow (App Password authentication), and close behavior.
 */

test.describe('Bitbucket Dialog - Dialog Display', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await setupOpenRepository(page);
  });

  test('should open dialog with all tabs visible', async () => {
    await app.executeCommand('Bitbucket');

    await expect(dialogs.bitbucket.dialog).toBeVisible();
    await expect(dialogs.bitbucket.connectionTab).toBeVisible();
    await expect(dialogs.bitbucket.pullRequestsTab).toBeVisible();
    await expect(dialogs.bitbucket.issuesTab).toBeVisible();
    await expect(dialogs.bitbucket.pipelinesTab).toBeVisible();
  });

  test('should have connection tab active by default', async () => {
    await app.executeCommand('Bitbucket');

    await expect(dialogs.bitbucket.dialog).toBeVisible();
    await expect(dialogs.bitbucket.connectionTab).toBeVisible();
  });

  test('should be able to switch between tabs', async () => {
    await app.executeCommand('Bitbucket');
    await expect(dialogs.bitbucket.dialog).toBeVisible();

    await dialogs.bitbucket.pullRequestsTab.click();
    await dialogs.bitbucket.issuesTab.click();
    await dialogs.bitbucket.pipelinesTab.click();
    await dialogs.bitbucket.switchToConnectionTab();

    // Dialog remains open after tab navigation
    await expect(dialogs.bitbucket.dialog).toBeVisible();
  });
});

test.describe('Bitbucket Dialog - Connection Flow', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await setupOpenRepository(page);
  });

  test('should show username and app password inputs when App Password method selected', async ({ page }) => {
    await app.executeCommand('Bitbucket');
    await expect(dialogs.bitbucket.dialog).toBeVisible();

    // Switch to App Password mode
    await dialogs.bitbucket.selectAppPasswordMethod();

    await expect(dialogs.bitbucket.usernameInput).toBeVisible();
    await expect(dialogs.bitbucket.appPasswordInput).toBeVisible();
    await expect(dialogs.bitbucket.connectButton).toBeVisible();
  });

  test('should be able to type in username and app password inputs', async ({ page }) => {
    await app.executeCommand('Bitbucket');
    await expect(dialogs.bitbucket.dialog).toBeVisible();

    await dialogs.bitbucket.selectAppPasswordMethod();

    await dialogs.bitbucket.usernameInput.fill('testuser');
    await dialogs.bitbucket.appPasswordInput.fill('app-password-123');

    await expect(dialogs.bitbucket.usernameInput).toHaveValue('testuser');
    await expect(dialogs.bitbucket.appPasswordInput).toHaveValue('app-password-123');
  });

  test('should call check_bitbucket_connection when connecting', async ({ page }) => {
    await app.executeCommand('Bitbucket');
    await expect(dialogs.bitbucket.dialog).toBeVisible();

    // Inject mocks after dialog opens. Bitbucket handleSaveCredentials stores credentials
    // then calls checkConnection() which uses check_bitbucket_connection.
    // Must also mock Stronghold plugin commands so credential storage succeeds.
    await startCommandCaptureWithMocks(page, {
      check_bitbucket_connection: {
        connected: true,
        user: { username: 'testuser', displayName: 'Test User', avatarUrl: '' },
      },
      'plugin:stronghold|initialize': null,
      'plugin:stronghold|load_client': null,
      'plugin:stronghold|create_client': null,
      'plugin:stronghold|save': null,
      'plugin:stronghold|save_store_record': null,
      'plugin:stronghold|insert_store_record': null,
      'plugin:path|resolve_directory': '/mock/app/data',
      'migrate_vault_if_needed': null,
    });

    // Switch to App Password mode and fill in credentials
    await dialogs.bitbucket.selectAppPasswordMethod();
    await dialogs.bitbucket.usernameInput.fill('testuser');
    await dialogs.bitbucket.appPasswordInput.fill('app-password-123');
    await dialogs.bitbucket.connectButton.click();

    // Verify the connection command was called (actual command is check_bitbucket_connection)
    await waitForCommand(page, 'check_bitbucket_connection');
    const connectCmds = await findCommand(page, 'check_bitbucket_connection');
    expect(connectCmds.length).toBeGreaterThan(0);
  });

  test('should show error on failed connection', async ({ page }) => {
    await app.executeCommand('Bitbucket');
    await expect(dialogs.bitbucket.dialog).toBeVisible();

    // Inject error for the connection check command
    await injectCommandError(page, 'check_bitbucket_connection', 'Invalid credentials');

    // Switch to App Password mode and try to connect with invalid credentials
    await dialogs.bitbucket.selectAppPasswordMethod();
    await dialogs.bitbucket.usernameInput.fill('baduser');
    await dialogs.bitbucket.appPasswordInput.fill('wrong-password');
    await dialogs.bitbucket.connectButton.click();

    // Should still show the dialog with an error indicator
    await expect(dialogs.bitbucket.dialog).toBeVisible();
    const errorElement = page.locator('lv-bitbucket-dialog .error, lv-bitbucket-dialog .error-message, .toast.error').first();
    await expect(errorElement).toBeVisible({ timeout: 5000 });
    await expect(errorElement).toContainText('Invalid credentials');
  });
});

test.describe('Bitbucket Dialog - Close', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await setupOpenRepository(page);
  });

  test('should close dialog with Escape key', async () => {
    await app.executeCommand('Bitbucket');
    await expect(dialogs.bitbucket.dialog).toBeVisible();

    await dialogs.bitbucket.closeWithEscape();
    await expect(dialogs.bitbucket.dialog).not.toBeVisible();
  });

  test('should close dialog with close button', async () => {
    await app.executeCommand('Bitbucket');
    await expect(dialogs.bitbucket.dialog).toBeVisible();

    await dialogs.bitbucket.close();
    await expect(dialogs.bitbucket.dialog).not.toBeVisible();
  });
});

test.describe('Bitbucket Dialog - Extended Scenarios', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await setupOpenRepository(page);
  });

  test('should show connected user info when already connected', async ({ page }) => {
    // Set up mocks before opening dialog so connection check returns connected
    await startCommandCaptureWithMocks(page, {
      check_bitbucket_connection: {
        connected: true,
        user: { username: 'testuser', displayName: 'Test User', avatarUrl: '' },
      },
    });

    await app.executeCommand('Bitbucket');
    await expect(dialogs.bitbucket.dialog).toBeVisible();

    // Connection status should show the connected user info
    await expect(dialogs.bitbucket.connectionStatus).toBeVisible({ timeout: 10000 });
  });

  test('should show invalid credentials error message', async ({ page }) => {
    await app.executeCommand('Bitbucket');
    await expect(dialogs.bitbucket.dialog).toBeVisible();

    // Inject invalid credentials error for connection check
    await injectCommandError(page, 'check_bitbucket_connection', 'Invalid credentials: authentication failed');

    // Switch to App Password mode and try to connect with bad credentials
    await dialogs.bitbucket.selectAppPasswordMethod();
    await dialogs.bitbucket.usernameInput.fill('baduser');
    await dialogs.bitbucket.appPasswordInput.fill('wrong-password');
    await dialogs.bitbucket.connectButton.click();

    // Dialog should remain open with error displayed
    await expect(dialogs.bitbucket.dialog).toBeVisible();

    // Verify the error is shown within the dialog
    const errorElement = page.locator('lv-bitbucket-dialog .error, lv-bitbucket-dialog .error-message, .toast.error').first();
    await expect(errorElement).toBeVisible({ timeout: 5000 });
    await expect(errorElement).toContainText('authentication failed');
  });
});
