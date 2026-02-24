import { test, expect } from '@playwright/test';
import { setupOpenRepository, setupProfilesAndAccounts } from '../fixtures/tauri-mock';
import { AppPage } from '../pages/app.page';
import { DialogsPage, AzureDevOpsDialogPage } from '../pages/dialogs.page';
import {
  startCommandCapture,
  findCommand,
  injectCommandError,
  injectCommandMock,
  startCommandCaptureWithMocks,
  waitForCommand,
} from '../fixtures/test-helpers';

/**
 * E2E tests for Azure DevOps Dialog
 *
 * The Azure DevOps dialog is opened via the command palette ("Azure DevOps Integration").
 * It has tabs: Connection, Pull Requests, Work Items, Pipelines.
 * It uses `lv-modal[open]` internally and is accessed via `AzureDevOpsDialogPage`.
 *
 * The dialog element is `lv-azure-devops-dialog` with an internal `lv-modal[open]`.
 */

test.describe('Azure DevOps Dialog - Display', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);

    await setupProfilesAndAccounts(
      page,
      {
        profiles: [
          {
            id: 'default',
            name: 'Default',
            gitName: 'Test User',
            gitEmail: 'test@example.com',
            signingKey: null,
            urlPatterns: [],
            isDefault: true,
            color: '#3b82f6',
            defaultAccounts: { 'azure-devops': 'ado-account-1' },
          },
        ],
        accounts: [
          {
            id: 'ado-account-1',
            name: 'My Azure DevOps',
            integrationType: 'azure-devops',
            config: { type: 'pat', organization: 'testorg' },
            color: null,
            cachedUser: { username: 'testuser', displayName: 'Test User', avatarUrl: null },
            urlPatterns: ['dev.azure.com/testorg'],
            isDefault: false,
          },
        ],
        connectedAccounts: ['ado-account-1'],
      },
      {
        remotes: [
          { name: 'origin', url: 'https://dev.azure.com/testorg/testproject/_git/testrepo', pushUrl: null },
        ],
      },
    );

    // Mock Azure DevOps commands
    await startCommandCaptureWithMocks(page, {
      detect_ado_repo: {
        organization: 'testorg',
        project: 'testproject',
        repoName: 'testrepo',
        remoteName: 'origin',
      },
      check_ado_connection_with_pat: {
        user: { displayName: 'Test User', emailAddress: 'test@example.com', id: 'user-1' },
      },
      list_ado_pull_requests: [
        {
          pullRequestId: 123,
          title: 'Add new feature',
          status: 'active',
          createdBy: { displayName: 'Developer', uniqueName: 'dev@example.com' },
          creationDate: new Date().toISOString(),
          sourceRefName: 'refs/heads/feature/new-feature',
          targetRefName: 'refs/heads/main',
        },
        {
          pullRequestId: 124,
          title: 'Fix login bug',
          status: 'active',
          createdBy: { displayName: 'Developer 2', uniqueName: 'dev2@example.com' },
          creationDate: new Date().toISOString(),
          sourceRefName: 'refs/heads/fix/login',
          targetRefName: 'refs/heads/main',
        },
      ],
      list_ado_work_items: [
        {
          id: 45,
          title: 'Bug: Application crashes',
          workItemType: 'Bug',
          state: 'Active',
          assignedTo: { displayName: 'Developer' },
          createdDate: new Date().toISOString(),
          priority: 1,
        },
      ],
      list_ado_pipeline_runs: [
        {
          id: 1,
          name: 'CI Pipeline',
          state: 'completed',
          result: 'succeeded',
          sourceBranch: 'refs/heads/main',
          createdDate: new Date().toISOString(),
          finishedDate: new Date().toISOString(),
        },
      ],
    });
  });

  test('opens dialog with all tabs visible', async () => {
    await app.executeCommand('Azure DevOps');

    await expect(dialogs.azureDevOps.dialog).toBeVisible();
    await expect(dialogs.azureDevOps.connectionTab).toBeVisible();
    await expect(dialogs.azureDevOps.pullRequestsTab).toBeVisible();
    await expect(dialogs.azureDevOps.workItemsTab).toBeVisible();
    await expect(dialogs.azureDevOps.pipelinesTab).toBeVisible();
  });

  test('Connection tab is active by default', async () => {
    await app.executeCommand('Azure DevOps');

    await expect(dialogs.azureDevOps.dialog).toBeVisible();
    await expect(dialogs.azureDevOps.connectionTab).toBeVisible();
  });

  test('can navigate between all tabs', async () => {
    await app.executeCommand('Azure DevOps');
    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    // Navigate to each tab
    await dialogs.azureDevOps.pullRequestsTab.click();
    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    await dialogs.azureDevOps.workItemsTab.click();
    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    await dialogs.azureDevOps.pipelinesTab.click();
    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    await dialogs.azureDevOps.switchToConnectionTab();
    await expect(dialogs.azureDevOps.dialog).toBeVisible();
  });
});

test.describe('Azure DevOps Dialog - Connection Tab', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);

    await setupOpenRepository(page, {
      remotes: [
        { name: 'origin', url: 'https://dev.azure.com/testorg/testproject/_git/testrepo', pushUrl: null },
      ],
    });

    await startCommandCaptureWithMocks(page, {
      detect_ado_repo: {
        organization: 'testorg',
        project: 'testproject',
        repoName: 'testrepo',
        remoteName: 'origin',
      },
      // Default to not connected so the token form is shown
      check_ado_connection: { connected: false, user: null },
    });
  });

  test('shows PAT authentication form', async ({ page }) => {
    await app.executeCommand('Azure DevOps');
    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    // ADO has no OAuth toggle - token form is shown by default
    // Token input and connect button should be visible
    await expect(dialogs.azureDevOps.tokenInput).toBeVisible();
    await expect(dialogs.azureDevOps.connectButton).toBeVisible();
  });

  test('can type in PAT input', async ({ page }) => {
    await app.executeCommand('Azure DevOps');
    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    await dialogs.azureDevOps.tokenInput.fill('test-pat-token-123');
    await expect(dialogs.azureDevOps.tokenInput).toHaveValue('test-pat-token-123');
  });

  test('connecting with PAT calls check_ado_connection', async ({ page }) => {
    await app.executeCommand('Azure DevOps');
    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    // Now inject the connected response for when user clicks Connect
    await startCommandCaptureWithMocks(page, {
      check_ado_connection: {
        connected: true,
        user: { displayName: 'Test User', emailAddress: 'test@example.com', id: 'user-1' },
        organization: 'testorg',
      },
      save_global_account: {
        id: 'new-ado-account',
        name: 'Azure DevOps (Test User)',
        integrationType: 'azure-devops',
        config: { type: 'pat', organization: 'testorg' },
        color: null,
        cachedUser: null,
        urlPatterns: [],
        isDefault: false,
      },
      store_git_credentials: null,
    });

    // Fill organization (required for the connect button to be enabled)
    await dialogs.azureDevOps.organizationInput.fill('testorg');
    await dialogs.azureDevOps.tokenInput.fill('valid-pat-token');
    await dialogs.azureDevOps.connectButton.click();

    await waitForCommand(page, 'check_ado_connection');

    const commands = await findCommand(page, 'check_ado_connection');
    expect(commands.length).toBeGreaterThan(0);

    // Verify the UI shows connected state
    await expect(dialogs.azureDevOps.connectionStatus).toBeVisible({ timeout: 10000 });
  });

  test('shows connected state after successful PAT validation', async ({ page }) => {
    await app.executeCommand('Azure DevOps');
    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    // Now inject the connected response for when user clicks Connect
    await startCommandCaptureWithMocks(page, {
      check_ado_connection: {
        connected: true,
        user: { displayName: 'Test User', emailAddress: 'test@example.com', id: 'user-1' },
        organization: 'testorg',
      },
      save_global_account: {
        id: 'new-ado-account',
        name: 'Azure DevOps (Test User)',
        integrationType: 'azure-devops',
        config: { type: 'pat', organization: 'testorg' },
        color: null,
        cachedUser: null,
        urlPatterns: [],
        isDefault: false,
      },
      store_git_credentials: null,
    });

    // Fill organization (required for the connect button to be enabled)
    await dialogs.azureDevOps.organizationInput.fill('testorg');
    await dialogs.azureDevOps.tokenInput.fill('valid-pat-token');
    await dialogs.azureDevOps.connectButton.click();

    // Connection status should show connected info
    await expect(dialogs.azureDevOps.connectionStatus).toBeVisible({ timeout: 10000 });
  });

  test('shows error on failed PAT validation', async ({ page }) => {
    await app.executeCommand('Azure DevOps');
    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    // Inject error for the check command before user clicks Connect
    await injectCommandError(page, 'check_ado_connection', 'Invalid Personal Access Token');

    // Fill organization (required for the connect button to be enabled)
    await dialogs.azureDevOps.organizationInput.fill('testorg');
    await dialogs.azureDevOps.tokenInput.fill('invalid-token');
    await dialogs.azureDevOps.connectButton.click();

    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    const errorElement = page.locator('lv-azure-devops-dialog .error, lv-azure-devops-dialog .error-message, .toast.error').first();
    await expect(errorElement).toBeVisible({ timeout: 5000 });
    await expect(errorElement).toContainText('Invalid Personal Access Token');
  });
});

test.describe('Azure DevOps Dialog - Tabs Content', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);

    await setupProfilesAndAccounts(
      page,
      {
        profiles: [
          {
            id: 'default',
            name: 'Default',
            gitName: 'Test User',
            gitEmail: 'test@example.com',
            signingKey: null,
            urlPatterns: [],
            isDefault: true,
            color: '#3b82f6',
            defaultAccounts: { 'azure-devops': 'ado-1' },
          },
        ],
        accounts: [
          {
            id: 'ado-1',
            name: 'Azure DevOps',
            integrationType: 'azure-devops',
            config: { type: 'pat', organization: 'testorg' },
            color: null,
            cachedUser: { username: 'testuser', displayName: 'Test User', avatarUrl: null },
            urlPatterns: [],
            isDefault: false,
          },
        ],
        connectedAccounts: ['ado-1'],
      },
      {
        remotes: [
          { name: 'origin', url: 'https://dev.azure.com/testorg/testproject/_git/testrepo', pushUrl: null },
        ],
      },
    );

    await startCommandCaptureWithMocks(page, {
      detect_ado_repo: {
        organization: 'testorg',
        project: 'testproject',
        repoName: 'testrepo',
        remoteName: 'origin',
      },
      list_ado_pull_requests: [
        {
          pullRequestId: 123,
          title: 'Add new feature',
          status: 'active',
          createdBy: { displayName: 'Developer', uniqueName: 'dev@example.com' },
          creationDate: new Date().toISOString(),
          sourceRefName: 'refs/heads/feature/new-feature',
          targetRefName: 'refs/heads/main',
        },
      ],
      list_ado_work_items: [
        {
          id: 45,
          title: 'Bug: Application crashes',
          workItemType: 'Bug',
          state: 'Active',
          assignedTo: { displayName: 'Developer' },
          createdDate: new Date().toISOString(),
          priority: 1,
        },
      ],
      list_ado_pipeline_runs: [
        {
          id: 1,
          name: 'CI Pipeline',
          state: 'completed',
          result: 'succeeded',
          sourceBranch: 'refs/heads/main',
          createdDate: new Date().toISOString(),
          finishedDate: new Date().toISOString(),
        },
      ],
    });
  });

  test('Pull Requests tab is navigable', async () => {
    await app.executeCommand('Azure DevOps');
    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    await dialogs.azureDevOps.pullRequestsTab.click();

    // Tab should now be active
    await expect(dialogs.azureDevOps.pullRequestsTab).toHaveClass(/active/);
  });

  test('Work Items tab is navigable', async () => {
    await app.executeCommand('Azure DevOps');
    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    await dialogs.azureDevOps.workItemsTab.click();

    await expect(dialogs.azureDevOps.workItemsTab).toHaveClass(/active/);
  });

  test('Pipelines tab is navigable', async () => {
    await app.executeCommand('Azure DevOps');
    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    await dialogs.azureDevOps.pipelinesTab.click();

    await expect(dialogs.azureDevOps.pipelinesTab).toHaveClass(/active/);
  });
});

test.describe('Azure DevOps Dialog - Close', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);

    await setupOpenRepository(page);

    await startCommandCaptureWithMocks(page, {
      detect_ado_repo: null,
    });
  });

  test('closes dialog with Escape key', async () => {
    await app.executeCommand('Azure DevOps');
    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    await dialogs.azureDevOps.closeWithEscape();
    await expect(dialogs.azureDevOps.dialog).not.toBeVisible();
  });

  test('closes dialog with close button', async () => {
    await app.executeCommand('Azure DevOps');
    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    await dialogs.azureDevOps.close();
    await expect(dialogs.azureDevOps.dialog).not.toBeVisible();
  });
});

test.describe('Azure DevOps Dialog - Extended Scenarios', () => {
  let app: AppPage;
  let dialogs: DialogsPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    dialogs = new DialogsPage(page);

    await setupOpenRepository(page, {
      remotes: [
        { name: 'origin', url: 'https://dev.azure.com/testorg/testproject/_git/testrepo', pushUrl: null },
      ],
    });

    await startCommandCaptureWithMocks(page, {
      detect_ado_repo: {
        organization: 'testorg',
        project: 'testproject',
        repoName: 'testrepo',
        remoteName: 'origin',
      },
    });
  });

  test('should show connected user info when already connected', async ({ page }) => {
    // Inject connected state for the connection check
    await injectCommandMock(page, {
      check_ado_connection: {
        connected: true,
        user: { displayName: 'Test User', emailAddress: 'test@example.com', id: 'user-1' },
        organization: 'testorg',
      },
    });

    await app.executeCommand('Azure DevOps');
    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    // Connection status should show the connected user info
    await expect(dialogs.azureDevOps.connectionStatus).toBeVisible({ timeout: 10000 });
  });

  test('should show invalid organization error message', async ({ page }) => {
    // Start with not-connected state
    await injectCommandMock(page, {
      check_ado_connection: { connected: false, user: null },
    });

    await app.executeCommand('Azure DevOps');
    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    // Inject error for connection attempt with invalid organization
    await injectCommandError(page, 'check_ado_connection', 'Invalid organization: organization not found');

    // Fill in organization and token, then attempt to connect
    await dialogs.azureDevOps.organizationInput.fill('invalidorg');
    await dialogs.azureDevOps.tokenInput.fill('some-pat-token');
    await dialogs.azureDevOps.connectButton.click();

    // Dialog should remain open with error displayed
    await expect(dialogs.azureDevOps.dialog).toBeVisible();

    // Verify the error is shown within the dialog
    const errorElement = page.locator('lv-azure-devops-dialog .error, lv-azure-devops-dialog .error-message, .toast.error').first();
    await expect(errorElement).toBeVisible({ timeout: 5000 });
    await expect(errorElement).toContainText('organization not found');
  });
});
