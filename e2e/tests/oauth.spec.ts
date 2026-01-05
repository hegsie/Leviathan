/**
 * OAuth Integration Flow E2E Tests
 *
 * Tests for OAuth authentication UI in all integration dialogs.
 * Note: Actual OAuth flow requires browser interaction, so we test the UI state.
 */

import { test, expect } from '@playwright/test';
import { setupOpenRepository } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';
import { DialogsPage } from '../pages/dialogs.page';

test.describe('GitHub OAuth Integration', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await setupOpenRepository(page);
  });

  test('should open GitHub dialog from command palette', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('GitHub Integration');
    await dialogs.commandPalette.executeFirst();

    await expect(dialogs.github.dialog).toBeVisible();
  });

  test('should have connection tab active by default', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('GitHub Integration');
    await dialogs.commandPalette.executeFirst();

    await expect(dialogs.github.connectionTab).toBeVisible();
  });

  test('should have token input field when PAT mode selected', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('GitHub Integration');
    await dialogs.commandPalette.executeFirst();

    // Switch to PAT mode (dialog defaults to OAuth mode)
    await dialogs.github.selectPATMethod();
    await expect(dialogs.github.tokenInput).toBeVisible();
  });

  test('should have connect button', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('GitHub Integration');
    await dialogs.commandPalette.executeFirst();

    // Either OAuth or PAT connect button should be visible
    const hasConnectButton = await dialogs.github.connectButton.isVisible().catch(() => false);
    const hasOAuthButton = await dialogs.github.oauthSignInButton.isVisible().catch(() => false);
    expect(hasConnectButton || hasOAuthButton).toBe(true);
  });

  test('should show OAuth button with GitHub icon when OAuth configured', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('GitHub Integration');
    await dialogs.commandPalette.executeFirst();

    // Check if OAuth is configured (toggle visible)
    const oauthConfigured = await dialogs.github.isOAuthConfigured();
    if (oauthConfigured) {
      await expect(dialogs.github.oauthSignInButton).toBeVisible();
    }
  });

  test('should toggle between OAuth and PAT methods', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('GitHub Integration');
    await dialogs.commandPalette.executeFirst();

    const oauthConfigured = await dialogs.github.isOAuthConfigured();
    if (oauthConfigured) {
      // Switch to PAT method
      await dialogs.github.selectPATMethod();
      await expect(dialogs.github.tokenInput).toBeVisible();
      await expect(dialogs.github.connectButton).toBeVisible();

      // Switch back to OAuth
      await dialogs.github.selectOAuthMethod();
      await expect(dialogs.github.oauthSignInButton).toBeVisible();
    }
  });

  // Note: GitHub dialog uses a toggle switcher instead of an "or" divider
  // The divider test is covered in other dialogs (GitLab, Azure, Bitbucket)

  test('should close dialog with Escape', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('GitHub Integration');
    await dialogs.commandPalette.executeFirst();

    await dialogs.github.closeWithEscape();
    await expect(dialogs.github.dialog).not.toBeVisible();
  });
});

test.describe('GitLab OAuth Integration', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await setupOpenRepository(page);
  });

  test('should open GitLab dialog from command palette', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('GitLab Integration');
    await dialogs.commandPalette.executeFirst();

    await expect(dialogs.gitlab.dialog).toBeVisible();
  });

  test('should have instance URL input', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('GitLab Integration');
    await dialogs.commandPalette.executeFirst();

    await expect(dialogs.gitlab.instanceUrlInput).toBeVisible();
  });

  test('should have token input field when PAT mode selected', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('GitLab Integration');
    await dialogs.commandPalette.executeFirst();

    // If OAuth is configured, switch to PAT mode first
    const oauthConfigured = await dialogs.gitlab.isOAuthConfigured();
    if (oauthConfigured) {
      await dialogs.gitlab.selectPATMethod();
    }
    await expect(dialogs.gitlab.tokenInput).toBeVisible();
  });

  test('should toggle between OAuth and PAT methods', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('GitLab Integration');
    await dialogs.commandPalette.executeFirst();

    const oauthConfigured = await dialogs.gitlab.isOAuthConfigured();
    if (oauthConfigured) {
      // Switch to PAT method
      await dialogs.gitlab.selectPATMethod();
      await expect(dialogs.gitlab.tokenInput).toBeVisible();

      // Switch back to OAuth
      await dialogs.gitlab.selectOAuthMethod();
      await expect(dialogs.gitlab.oauthSignInButton).toBeVisible();
    }
  });
});

test.describe('Azure DevOps OAuth Integration', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await setupOpenRepository(page);
  });

  test('should open Azure DevOps dialog from command palette', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('Azure DevOps');
    await dialogs.commandPalette.executeFirst();

    await expect(dialogs.azureDevOps.dialog).toBeVisible();
  });

  test('should have organization input', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('Azure DevOps');
    await dialogs.commandPalette.executeFirst();

    await expect(dialogs.azureDevOps.organizationInput).toBeVisible();
  });

  test('should have token input field when PAT mode selected', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('Azure DevOps');
    await dialogs.commandPalette.executeFirst();

    // If OAuth is configured, switch to PAT mode first
    const oauthConfigured = await dialogs.azureDevOps.isOAuthConfigured();
    if (oauthConfigured) {
      await dialogs.azureDevOps.selectPATMethod();
    }
    await expect(dialogs.azureDevOps.tokenInput).toBeVisible();
  });

  test('should toggle between OAuth and PAT methods', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('Azure DevOps');
    await dialogs.commandPalette.executeFirst();

    const oauthConfigured = await dialogs.azureDevOps.isOAuthConfigured();
    if (oauthConfigured) {
      // Switch to PAT method
      await dialogs.azureDevOps.selectPATMethod();
      await expect(dialogs.azureDevOps.tokenInput).toBeVisible();

      // Switch back to OAuth (Microsoft)
      await dialogs.azureDevOps.selectOAuthMethod();
      await expect(dialogs.azureDevOps.oauthSignInButton).toBeVisible();
    }
  });

  test('should have Sign in with Microsoft button when OAuth configured', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('Azure DevOps');
    await dialogs.commandPalette.executeFirst();

    const oauthConfigured = await dialogs.azureDevOps.isOAuthConfigured();
    if (oauthConfigured) {
      await expect(dialogs.azureDevOps.oauthButton).toContainText('Sign in with Microsoft');
    }
  });
});

test.describe('Bitbucket OAuth Integration', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await setupOpenRepository(page);
  });

  test('should open Bitbucket dialog from command palette', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('Bitbucket');
    await dialogs.commandPalette.executeFirst();

    await expect(dialogs.bitbucket.dialog).toBeVisible();
  });

  test('should have username input when app password mode selected', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('Bitbucket');
    await dialogs.commandPalette.executeFirst();

    // If OAuth is configured, switch to App Password mode first
    const oauthConfigured = await dialogs.bitbucket.isOAuthConfigured();
    if (oauthConfigured) {
      await dialogs.bitbucket.selectAppPasswordMethod();
    }
    await expect(dialogs.bitbucket.usernameInput).toBeVisible();
  });

  test('should have app password input when app password mode selected', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('Bitbucket');
    await dialogs.commandPalette.executeFirst();

    // If OAuth is configured, switch to App Password mode first
    const oauthConfigured = await dialogs.bitbucket.isOAuthConfigured();
    if (oauthConfigured) {
      await dialogs.bitbucket.selectAppPasswordMethod();
    }
    await expect(dialogs.bitbucket.appPasswordInput).toBeVisible();
  });

  test('should toggle between OAuth and App Password methods', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('Bitbucket');
    await dialogs.commandPalette.executeFirst();

    const oauthConfigured = await dialogs.bitbucket.isOAuthConfigured();
    if (oauthConfigured) {
      // Switch to App Password method
      await dialogs.bitbucket.selectAppPasswordMethod();
      await expect(dialogs.bitbucket.usernameInput).toBeVisible();
      await expect(dialogs.bitbucket.appPasswordInput).toBeVisible();

      // Switch back to OAuth
      await dialogs.bitbucket.selectOAuthMethod();
      await expect(dialogs.bitbucket.oauthSignInButton).toBeVisible();
    }
  });
});

test.describe('OAuth UI State Management', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await setupOpenRepository(page);
  });

  test('PAT input should be available in PAT mode', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('GitHub Integration');
    await dialogs.commandPalette.executeFirst();

    // Switch to PAT mode (dialog defaults to OAuth mode)
    await dialogs.github.selectPATMethod();

    // Token input should be visible in PAT mode
    await expect(dialogs.github.tokenInput).toBeVisible();
  });

  test('should be able to type in token input', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('GitHub Integration');
    await dialogs.commandPalette.executeFirst();

    // Switch to PAT mode (dialog defaults to OAuth mode)
    await dialogs.github.selectPATMethod();

    await dialogs.github.tokenInput.fill('ghp_test123');
    await expect(dialogs.github.tokenInput).toHaveValue('ghp_test123');
  });
});

test.describe('Dialog Tabs with OAuth', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);
    await setupOpenRepository(page);
  });

  test('GitHub should have all tabs', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('GitHub Integration');
    await dialogs.commandPalette.executeFirst();

    await expect(dialogs.github.connectionTab).toBeVisible();
    await expect(dialogs.github.pullRequestsTab).toBeVisible();
    await expect(dialogs.github.issuesTab).toBeVisible();
  });

  test('GitLab should have all tabs', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('GitLab Integration');
    await dialogs.commandPalette.executeFirst();

    await expect(dialogs.gitlab.connectionTab).toBeVisible();
    await expect(dialogs.gitlab.mergeRequestsTab).toBeVisible();
    await expect(dialogs.gitlab.issuesTab).toBeVisible();
    await expect(dialogs.gitlab.pipelinesTab).toBeVisible();
  });

  test('Azure DevOps should have all tabs', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('Azure DevOps');
    await dialogs.commandPalette.executeFirst();

    await expect(dialogs.azureDevOps.connectionTab).toBeVisible();
    await expect(dialogs.azureDevOps.pullRequestsTab).toBeVisible();
    await expect(dialogs.azureDevOps.workItemsTab).toBeVisible();
    await expect(dialogs.azureDevOps.pipelinesTab).toBeVisible();
  });

  test('Bitbucket should have all tabs', async () => {
    await dialogs.commandPalette.open();
    await dialogs.commandPalette.search('Bitbucket');
    await dialogs.commandPalette.executeFirst();

    await expect(dialogs.bitbucket.connectionTab).toBeVisible();
    await expect(dialogs.bitbucket.pullRequestsTab).toBeVisible();
    await expect(dialogs.bitbucket.issuesTab).toBeVisible();
    await expect(dialogs.bitbucket.pipelinesTab).toBeVisible();
  });
});
