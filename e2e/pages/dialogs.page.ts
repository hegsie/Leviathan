import type { Page, Locator } from '@playwright/test';

/**
 * Base dialog helper class
 */
class BaseDialog {
  readonly page: Page;
  readonly dialog: Locator;
  readonly closeButton: Locator;

  constructor(page: Page, selector: string) {
    this.page = page;
    this.dialog = page.locator(selector);
    this.closeButton = this.dialog.locator('.close-btn, button[aria-label="Close"]');
  }

  async isVisible(): Promise<boolean> {
    return this.dialog.isVisible();
  }

  async close(): Promise<void> {
    await this.closeButton.click();
    await this.dialog.waitFor({ state: 'hidden' });
  }

  async closeWithEscape(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await this.dialog.waitFor({ state: 'hidden' });
  }

  async waitForOpen(): Promise<void> {
    await this.dialog.waitFor({ state: 'visible' });
  }
}

/**
 * Clone Dialog Page Object
 */
export class CloneDialogPage extends BaseDialog {
  readonly urlInput: Locator;
  readonly pathInput: Locator;
  readonly browseButton: Locator;
  readonly cloneButton: Locator;
  readonly progressBar: Locator;

  constructor(page: Page) {
    super(page, 'lv-clone-dialog');
    // Use direct role selectors (Playwright pierces shadow DOM automatically)
    this.dialog = page.getByRole('dialog', { name: 'Clone Repository' });
    this.closeButton = page.getByRole('button', { name: 'Close' });
    // Use direct getByRole on page since Playwright flattens the accessibility tree
    this.urlInput = page.getByRole('textbox', { name: 'Repository URL' });
    this.pathInput = page.getByRole('textbox', { name: 'Clone to' });
    this.browseButton = page.getByRole('button', { name: /Browse/i });
    // Clone button inside the dialog - use locator within the dialog to avoid matching welcome screen button
    this.cloneButton = page.locator('lv-clone-dialog').getByRole('button', { name: 'Clone', exact: true });
    this.progressBar = this.dialog.locator('.progress-bar, progress');
  }

  async fillUrl(url: string): Promise<void> {
    await this.urlInput.fill(url);
  }

  async fillPath(path: string): Promise<void> {
    await this.pathInput.fill(path);
  }

  async clone(): Promise<void> {
    await this.cloneButton.click();
  }

  async isCloneEnabled(): Promise<boolean> {
    return this.cloneButton.isEnabled();
  }
}

/**
 * Init Dialog Page Object
 */
export class InitDialogPage extends BaseDialog {
  readonly pathInput: Locator;
  readonly browseButton: Locator;
  readonly initButton: Locator;
  readonly bareCheckbox: Locator;

  constructor(page: Page) {
    super(page, 'lv-init-dialog');
    // Use direct role selectors (Playwright flattens the accessibility tree)
    this.dialog = page.getByRole('dialog', { name: 'Initialize Repository' });
    this.closeButton = page.getByRole('button', { name: 'Close' });
    // Path input has label "Repository Location"
    this.pathInput = page.getByRole('textbox', { name: /Repository Location/i });
    this.browseButton = page.getByRole('button', { name: /Browse/i });
    // Initialize button - may be disabled when no path
    this.initButton = page.getByRole('button', { name: /Initialize/i });
    this.bareCheckbox = page.getByRole('checkbox', { name: /bare/i });
  }

  async fillPath(path: string): Promise<void> {
    await this.pathInput.fill(path);
  }

  async init(): Promise<void> {
    await this.initButton.click();
  }

  async setBare(bare: boolean): Promise<void> {
    if (bare) {
      await this.bareCheckbox.check();
    } else {
      await this.bareCheckbox.uncheck();
    }
  }
}

/**
 * Create Branch Dialog Page Object
 */
export class CreateBranchDialogPage extends BaseDialog {
  readonly nameInput: Locator;
  readonly createButton: Locator;
  readonly checkoutCheckbox: Locator;

  constructor(page: Page) {
    super(page, 'lv-create-branch-dialog');
    // Input has id="branch-name-input" and placeholder="feature/my-new-feature"
    this.nameInput = this.dialog.locator('#branch-name-input, input[placeholder*="feature"]');
    this.createButton = this.dialog.locator('button', { hasText: 'Create' });
    this.checkoutCheckbox = this.dialog.locator('input[type="checkbox"]');
  }

  async fillName(name: string): Promise<void> {
    await this.nameInput.fill(name);
  }

  async create(): Promise<void> {
    await this.createButton.click();
  }

  async setCheckoutAfterCreate(checkout: boolean): Promise<void> {
    if (checkout) {
      await this.checkoutCheckbox.check();
    } else {
      await this.checkoutCheckbox.uncheck();
    }
  }
}

/**
 * Settings Dialog Page Object
 */
export class SettingsDialogPage extends BaseDialog {
  readonly themeSelect: Locator;
  readonly vimModeToggle: Locator;
  readonly doneButton: Locator;

  constructor(page: Page) {
    // Settings dialog uses lv-modal which adds role="dialog" with aria-labelledby
    super(page, 'lv-modal:has(lv-settings-dialog)');
    // Use locator for modal dialog (lv-modal with Settings title)
    this.dialog = page.locator('lv-modal:has(lv-settings-dialog)');
    // Theme select - the select element inside settings-dialog
    this.themeSelect = page.locator('lv-settings-dialog select').first();
    // Toggle switches for boolean settings (showAvatars, showCommitSize, wordWrap, confirmBeforeDiscard)
    // Note: vim mode toggle is in keyboard shortcuts dialog, not settings
    this.vimModeToggle = page.locator('lv-settings-dialog .toggle-switch').first();
    this.doneButton = page.locator('lv-settings-dialog button:has-text("Done")');
  }

  async setTheme(theme: 'light' | 'dark' | 'system'): Promise<void> {
    await this.themeSelect.selectOption(theme);
  }

  async toggleVimMode(): Promise<void> {
    await this.vimModeToggle.click();
  }

  async save(): Promise<void> {
    await this.doneButton.click();
  }
}

/**
 * Profile Manager Dialog Page Object
 */
export class ProfileManagerDialogPage extends BaseDialog {
  readonly profileList: Locator;
  readonly addProfileButton: Locator;
  readonly nameInput: Locator;
  readonly emailInput: Locator;

  constructor(page: Page) {
    super(page, 'lv-profile-manager-dialog');
    // The dialog header contains "Profiles" text - use that to verify visibility
    // Custom element tags aren't in accessibility tree, so use text matching
    this.dialog = page.locator('lv-profile-manager-dialog[open]');
    // Fallback - check for the New Profile button which is only visible in the dialog
    this.profileList = page.locator('lv-profile-manager-dialog[open] .profile-list');
    // "New Profile" button - use accessible role selector
    this.addProfileButton = page.getByRole('button', { name: 'New Profile' });
    this.nameInput = page.getByRole('textbox', { name: /Profile Name/i });
    this.emailInput = page.getByRole('textbox', { name: /Git Email/i });
  }

  async getProfileCount(): Promise<number> {
    return this.profileList.locator('.profile-item').count();
  }

  async selectProfile(name: string): Promise<void> {
    await this.profileList.locator('.profile-item', { hasText: name }).click();
  }

  async addProfile(name: string, email: string): Promise<void> {
    await this.addProfileButton.click();
    await this.nameInput.fill(name);
    await this.emailInput.fill(email);
  }
}

/**
 * GitHub Dialog Page Object
 */
export class GitHubDialogPage extends BaseDialog {
  // Tabs
  readonly connectionTab: Locator;
  readonly pullRequestsTab: Locator;
  readonly issuesTab: Locator;
  readonly releasesTab: Locator;
  readonly actionsTab: Locator;

  // Connection tab
  readonly tokenInput: Locator;
  readonly connectButton: Locator;
  readonly connectionStatus: Locator;

  // OAuth elements
  readonly authMethodToggle: Locator;
  readonly oauthButton: Locator;
  readonly patButton: Locator;
  readonly oauthSignInButton: Locator;
  readonly oauthSpinner: Locator;
  readonly oauthStatus: Locator;
  readonly oauthDivider: Locator;

  // Pull requests tab
  readonly prList: Locator;
  readonly createPrButton: Locator;

  // Issues tab
  readonly issueList: Locator;
  readonly createIssueButton: Locator;

  constructor(page: Page) {
    super(page, 'lv-github-dialog');
    // GitHub dialog uses lv-modal wrapper - check the modal's dialog role
    this.dialog = page.getByRole('dialog', { name: 'GitHub' });

    // Tabs - buttons with class .tab inside .tabs container
    this.connectionTab = page.locator('lv-github-dialog .tab:has-text("Connection")');
    this.pullRequestsTab = page.locator('lv-github-dialog .tab:has-text("Pull Requests")');
    this.issuesTab = page.locator('lv-github-dialog .tab:has-text("Issues")');
    this.releasesTab = page.locator('lv-github-dialog .tab:has-text("Releases")');
    this.actionsTab = page.locator('lv-github-dialog .tab:has-text("Actions")');

    // Connection
    this.tokenInput = page.locator('lv-github-dialog input[type="password"]');
    this.connectButton = page.locator('lv-github-dialog button:has-text("Connect to GitHub")');
    this.connectionStatus = page.locator('lv-github-dialog .connection-status');

    // OAuth elements
    this.authMethodToggle = page.locator('lv-github-dialog .auth-method-toggle');
    this.oauthButton = page.locator('lv-github-dialog .auth-method-toggle button:has-text("Sign in with GitHub")');
    this.patButton = page.locator('lv-github-dialog .auth-method-toggle button:has-text("Personal Access Token")');
    this.oauthSignInButton = page.locator('lv-github-dialog .btn-oauth');
    this.oauthSpinner = page.locator('lv-github-dialog .oauth-spinner');
    this.oauthStatus = page.locator('lv-github-dialog .oauth-status');
    this.oauthDivider = page.locator('lv-github-dialog .oauth-divider');

    // PRs
    this.prList = page.locator('lv-github-dialog .pr-list');
    this.createPrButton = page.locator('lv-github-dialog button:has-text("New PR")');

    // Issues
    this.issueList = page.locator('lv-github-dialog .issue-list');
    this.createIssueButton = page.locator('lv-github-dialog button:has-text("New Issue")');
  }

  async switchToConnectionTab(): Promise<void> {
    await this.connectionTab.click();
  }

  async switchToPullRequestsTab(): Promise<void> {
    await this.pullRequestsTab.click();
  }

  async switchToIssuesTab(): Promise<void> {
    await this.issuesTab.click();
  }

  async switchToReleasesTab(): Promise<void> {
    await this.releasesTab.click();
  }

  async switchToActionsTab(): Promise<void> {
    await this.actionsTab.click();
  }

  async connect(token: string): Promise<void> {
    // Switch to PAT mode if OAuth toggle is visible
    if (await this.authMethodToggle.isVisible()) {
      await this.patButton.click();
    }
    await this.tokenInput.fill(token);
    await this.connectButton.click();
  }

  async selectOAuthMethod(): Promise<void> {
    await this.oauthButton.click();
  }

  async selectPATMethod(): Promise<void> {
    await this.patButton.click();
  }

  async isOAuthConfigured(): Promise<boolean> {
    // OAuth is configured if the toggle is visible and the OAuth button is enabled
    const toggleVisible = await this.authMethodToggle.isVisible();
    if (!toggleVisible) return false;
    return this.oauthButton.isEnabled();
  }

  async isOAuthPending(): Promise<boolean> {
    return this.oauthSpinner.isVisible();
  }

  async isConnected(): Promise<boolean> {
    const status = await this.connectionStatus.textContent();
    return status?.toLowerCase().includes('connected') ?? false;
  }
}

/**
 * GitLab Dialog Page Object
 */
export class GitLabDialogPage extends BaseDialog {
  // Tabs
  readonly connectionTab: Locator;
  readonly mergeRequestsTab: Locator;
  readonly issuesTab: Locator;
  readonly pipelinesTab: Locator;

  // Connection tab
  readonly instanceUrlInput: Locator;
  readonly tokenInput: Locator;
  readonly connectButton: Locator;
  readonly connectionStatus: Locator;

  // OAuth elements
  readonly authMethodToggle: Locator;
  readonly oauthButton: Locator;
  readonly patButton: Locator;
  readonly oauthSignInButton: Locator;
  readonly oauthSpinner: Locator;
  readonly oauthStatus: Locator;

  constructor(page: Page) {
    super(page, 'lv-gitlab-dialog');
    // Use element locator since the modal title attribute may vary
    this.dialog = page.locator('lv-gitlab-dialog lv-modal[open]');

    // Tabs
    this.connectionTab = page.locator('lv-gitlab-dialog .tab:has-text("Connection")');
    this.mergeRequestsTab = page.locator('lv-gitlab-dialog .tab:has-text("Merge Requests")');
    this.issuesTab = page.locator('lv-gitlab-dialog .tab:has-text("Issues")');
    this.pipelinesTab = page.locator('lv-gitlab-dialog .tab:has-text("Pipelines")');

    // Connection
    this.instanceUrlInput = page.locator('lv-gitlab-dialog input[type="text"]').first();
    this.tokenInput = page.locator('lv-gitlab-dialog input[type="password"]');
    this.connectButton = page.locator('lv-gitlab-dialog button:has-text("Connect with Token")');
    this.connectionStatus = page.locator('lv-gitlab-dialog .connection-status');

    // OAuth
    this.authMethodToggle = page.locator('lv-gitlab-dialog .auth-method-toggle');
    this.oauthButton = page.locator('lv-gitlab-dialog .auth-method-toggle button:has-text("Sign in with GitLab")');
    this.patButton = page.locator('lv-gitlab-dialog .auth-method-toggle button:has-text("Personal Access Token")');
    this.oauthSignInButton = page.locator('lv-gitlab-dialog .btn-oauth');
    this.oauthSpinner = page.locator('lv-gitlab-dialog .oauth-spinner');
    this.oauthStatus = page.locator('lv-gitlab-dialog .oauth-status');
  }

  async switchToConnectionTab(): Promise<void> {
    await this.connectionTab.click();
  }

  async isOAuthConfigured(): Promise<boolean> {
    return this.authMethodToggle.isVisible();
  }

  async selectOAuthMethod(): Promise<void> {
    await this.oauthButton.click();
  }

  async selectPATMethod(): Promise<void> {
    await this.patButton.click();
  }
}

/**
 * Azure DevOps Dialog Page Object
 */
export class AzureDevOpsDialogPage extends BaseDialog {
  // Tabs
  readonly connectionTab: Locator;
  readonly pullRequestsTab: Locator;
  readonly workItemsTab: Locator;
  readonly pipelinesTab: Locator;

  // Connection tab
  readonly organizationInput: Locator;
  readonly tokenInput: Locator;
  readonly connectButton: Locator;
  readonly connectionStatus: Locator;

  // OAuth elements
  readonly authMethodToggle: Locator;
  readonly oauthButton: Locator;
  readonly patButton: Locator;
  readonly oauthSignInButton: Locator;
  readonly oauthSpinner: Locator;
  readonly oauthStatus: Locator;

  constructor(page: Page) {
    super(page, 'lv-azure-devops-dialog');
    // Use element locator since the modal title attribute may vary
    this.dialog = page.locator('lv-azure-devops-dialog lv-modal[open]');

    // Tabs
    this.connectionTab = page.locator('lv-azure-devops-dialog .tab:has-text("Connection")');
    this.pullRequestsTab = page.locator('lv-azure-devops-dialog .tab:has-text("Pull Requests")');
    this.workItemsTab = page.locator('lv-azure-devops-dialog .tab:has-text("Work Items")');
    this.pipelinesTab = page.locator('lv-azure-devops-dialog .tab:has-text("Pipelines")');

    // Connection
    this.organizationInput = page.locator('lv-azure-devops-dialog input[type="text"]').first();
    this.tokenInput = page.locator('lv-azure-devops-dialog input[type="password"]');
    this.connectButton = page.locator('lv-azure-devops-dialog button:has-text("Connect with Token")');
    this.connectionStatus = page.locator('lv-azure-devops-dialog .connection-status');

    // OAuth
    this.authMethodToggle = page.locator('lv-azure-devops-dialog .auth-method-toggle');
    this.oauthButton = page.locator('lv-azure-devops-dialog .auth-method-toggle button:has-text("Sign in with Microsoft")');
    this.patButton = page.locator('lv-azure-devops-dialog .auth-method-toggle button:has-text("Personal Access Token")');
    this.oauthSignInButton = page.locator('lv-azure-devops-dialog .btn-oauth');
    this.oauthSpinner = page.locator('lv-azure-devops-dialog .oauth-spinner');
    this.oauthStatus = page.locator('lv-azure-devops-dialog .oauth-status');
  }

  async switchToConnectionTab(): Promise<void> {
    await this.connectionTab.click();
  }

  async isOAuthConfigured(): Promise<boolean> {
    return this.authMethodToggle.isVisible();
  }

  async selectOAuthMethod(): Promise<void> {
    await this.oauthButton.click();
  }

  async selectPATMethod(): Promise<void> {
    await this.patButton.click();
  }
}

/**
 * Bitbucket Dialog Page Object
 */
export class BitbucketDialogPage extends BaseDialog {
  // Tabs
  readonly connectionTab: Locator;
  readonly pullRequestsTab: Locator;
  readonly issuesTab: Locator;
  readonly pipelinesTab: Locator;

  // Connection tab
  readonly usernameInput: Locator;
  readonly appPasswordInput: Locator;
  readonly connectButton: Locator;
  readonly connectionStatus: Locator;

  // OAuth elements
  readonly authMethodToggle: Locator;
  readonly oauthButton: Locator;
  readonly appPasswordButton: Locator;
  readonly oauthSignInButton: Locator;
  readonly oauthSpinner: Locator;
  readonly oauthStatus: Locator;

  constructor(page: Page) {
    super(page, 'lv-bitbucket-dialog');
    // Use element locator since the modal title attribute may vary
    this.dialog = page.locator('lv-bitbucket-dialog lv-modal[open]');

    // Tabs
    this.connectionTab = page.locator('lv-bitbucket-dialog .tab:has-text("Connection")');
    this.pullRequestsTab = page.locator('lv-bitbucket-dialog .tab:has-text("Pull Requests")');
    this.issuesTab = page.locator('lv-bitbucket-dialog .tab:has-text("Issues")');
    this.pipelinesTab = page.locator('lv-bitbucket-dialog .tab:has-text("Pipelines")');

    // Connection
    this.usernameInput = page.locator('lv-bitbucket-dialog input[type="text"]').first();
    this.appPasswordInput = page.locator('lv-bitbucket-dialog input[type="password"]');
    this.connectButton = page.locator('lv-bitbucket-dialog button:has-text("Connect with App Password")');
    this.connectionStatus = page.locator('lv-bitbucket-dialog .connection-status');

    // OAuth
    this.authMethodToggle = page.locator('lv-bitbucket-dialog .auth-method-toggle');
    this.oauthButton = page.locator('lv-bitbucket-dialog .auth-method-toggle button:has-text("Sign in with Bitbucket")');
    this.appPasswordButton = page.locator('lv-bitbucket-dialog .auth-method-toggle button:has-text("App Password")');
    this.oauthSignInButton = page.locator('lv-bitbucket-dialog .btn-oauth');
    this.oauthSpinner = page.locator('lv-bitbucket-dialog .oauth-spinner');
    this.oauthStatus = page.locator('lv-bitbucket-dialog .oauth-status');
  }

  async switchToConnectionTab(): Promise<void> {
    await this.connectionTab.click();
  }

  async isOAuthConfigured(): Promise<boolean> {
    return this.authMethodToggle.isVisible();
  }

  async selectOAuthMethod(): Promise<void> {
    if (await this.authMethodToggle.isVisible()) {
      await this.oauthButton.click();
    }
  }

  async selectAppPasswordMethod(): Promise<void> {
    if (await this.authMethodToggle.isVisible()) {
      await this.appPasswordButton.click();
    }
  }
}

/**
 * Keyboard Shortcuts Dialog Page Object
 */
export class KeyboardShortcutsDialogPage extends BaseDialog {
  readonly shortcutList: Locator;
  readonly vimModeToggle: Locator;

  constructor(page: Page) {
    // Keyboard shortcuts dialog has [open] attribute when visible
    super(page, 'lv-keyboard-shortcuts-dialog[open]');
    // The dialog is the component with [open] attribute
    this.dialog = page.locator('lv-keyboard-shortcuts-dialog[open]');
    // Shortcuts are in .content > .category > .shortcuts-list with .shortcut-row items
    this.shortcutList = page.locator('lv-keyboard-shortcuts-dialog[open] .content');
    // Vim toggle is in footer with .toggle-switch
    this.vimModeToggle = page.locator('lv-keyboard-shortcuts-dialog[open] .toggle-switch');
  }

  async getShortcutCount(): Promise<number> {
    return this.page.locator('lv-keyboard-shortcuts-dialog[open] .shortcut-row').count();
  }

  async toggleVimMode(): Promise<void> {
    await this.vimModeToggle.click();
  }
}

/**
 * Command Palette Page Object
 */
export class CommandPalettePage {
  readonly page: Page;
  readonly palette: Locator;
  readonly input: Locator;
  readonly resultList: Locator;
  readonly results: Locator;

  constructor(page: Page) {
    this.page = page;
    // Command palette uses [open] attribute when visible
    this.palette = page.locator('lv-command-palette[open]');
    // Input has class .search-input
    this.input = this.palette.locator('.search-input');
    // Results are in .results div with .command items
    this.resultList = this.palette.locator('.results');
    this.results = this.resultList.locator('.command');
  }

  async open(): Promise<void> {
    await this.page.keyboard.press('Meta+p');
    await this.page.locator('lv-command-palette[open]').waitFor({ state: 'visible' });
  }

  async close(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await this.page.locator('lv-command-palette[open]').waitFor({ state: 'hidden' });
  }

  async isVisible(): Promise<boolean> {
    return this.palette.isVisible();
  }

  async search(query: string): Promise<void> {
    await this.input.fill(query);
  }

  async selectResult(index: number): Promise<void> {
    await this.results.nth(index).click();
  }

  async selectResultByText(text: string): Promise<void> {
    await this.resultList.locator('.command', { hasText: text }).click();
  }

  async executeFirst(): Promise<void> {
    await this.page.keyboard.press('Enter');
  }

  async getResultCount(): Promise<number> {
    return this.results.count();
  }
}

/**
 * Dialogs Page Object - Factory for all dialogs
 */
export class DialogsPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get clone(): CloneDialogPage {
    return new CloneDialogPage(this.page);
  }

  get init(): InitDialogPage {
    return new InitDialogPage(this.page);
  }

  get createBranch(): CreateBranchDialogPage {
    return new CreateBranchDialogPage(this.page);
  }

  get settings(): SettingsDialogPage {
    return new SettingsDialogPage(this.page);
  }

  get profileManager(): ProfileManagerDialogPage {
    return new ProfileManagerDialogPage(this.page);
  }

  get github(): GitHubDialogPage {
    return new GitHubDialogPage(this.page);
  }

  get gitlab(): GitLabDialogPage {
    return new GitLabDialogPage(this.page);
  }

  get azureDevOps(): AzureDevOpsDialogPage {
    return new AzureDevOpsDialogPage(this.page);
  }

  get bitbucket(): BitbucketDialogPage {
    return new BitbucketDialogPage(this.page);
  }

  get keyboardShortcuts(): KeyboardShortcutsDialogPage {
    return new KeyboardShortcutsDialogPage(this.page);
  }

  get commandPalette(): CommandPalettePage {
    return new CommandPalettePage(this.page);
  }
}
