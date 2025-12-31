/**
 * GitHub Integration Dialog
 * Manage GitHub connection, view PRs, and check Actions status
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import type {
  GitHubConnectionStatus,
  DetectedGitHubRepo,
  PullRequestSummary,
  WorkflowRun,
  CreatePullRequestInput,
  IssueSummary,
  CreateIssueInput,
  Label,
  ReleaseSummary,
  CreateReleaseInput,
} from '../../services/git.service.ts';
import { unifiedProfileStore } from '../../stores/unified-profile.store.ts';
import * as unifiedProfileService from '../../services/unified-profile.service.ts';
import type { ProfileIntegrationAccount } from '../../types/unified-profile.types.ts';
import * as credentialService from '../../services/credential.service.ts';
import './lv-modal.ts';
import './lv-account-selector.ts';

type TabType = 'connection' | 'pull-requests' | 'issues' | 'releases' | 'actions' | 'create-pr' | 'create-issue' | 'create-release';

@customElement('lv-github-dialog')
export class LvGitHubDialog extends LitElement {
  static styles = [
    sharedStyles,
    css`
      .content {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        min-height: 400px;
        max-height: 70vh;
      }

      .tabs {
        display: flex;
        gap: var(--spacing-xs);
        border-bottom: 1px solid var(--color-border);
        padding-bottom: var(--spacing-sm);
      }

      .tab {
        padding: var(--spacing-xs) var(--spacing-md);
        border: none;
        background: none;
        color: var(--color-text-secondary);
        font-size: var(--font-size-sm);
        cursor: pointer;
        border-radius: var(--radius-sm);
        transition: all var(--transition-fast);
      }

      .tab:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .tab.active {
        background: var(--color-primary-bg);
        color: var(--color-primary);
        font-weight: var(--font-weight-medium);
      }

      .tab-content {
        flex: 1;
        overflow: auto;
      }

      /* Connection Tab */
      .connection-status {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
      }

      .avatar {
        width: 48px;
        height: 48px;
        border-radius: 50%;
      }

      .user-info {
        flex: 1;
      }

      .user-name {
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }

      .user-login {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
      }

      .scopes {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-xs);
        margin-top: var(--spacing-xs);
      }

      .scope-badge {
        font-size: var(--font-size-xs);
        padding: 2px 6px;
        background: var(--color-bg-hover);
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
      }

      .token-form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .form-group label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
      }

      .form-group input,
      .form-group textarea {
        padding: var(--spacing-sm);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
      }

      .form-group textarea {
        min-height: 100px;
        resize: vertical;
        font-family: inherit;
      }

      .form-group input:focus,
      .form-group textarea:focus {
        outline: none;
        border-color: var(--color-primary);
      }

      .help-text {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .help-link {
        color: var(--color-primary);
        text-decoration: none;
      }

      .help-link:hover {
        text-decoration: underline;
      }

      /* PR List */
      .pr-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .pr-item {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background var(--transition-fast);
      }

      .pr-item:hover {
        background: var(--color-bg-hover);
      }

      .pr-number {
        font-weight: var(--font-weight-semibold);
        color: var(--color-primary);
        min-width: 50px;
      }

      .pr-info {
        flex: 1;
        min-width: 0;
      }

      .pr-title {
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        margin-bottom: var(--spacing-xs);
      }

      .pr-meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .pr-branch {
        display: flex;
        align-items: center;
        gap: 4px;
        font-family: var(--font-family-mono);
        background: var(--color-bg-hover);
        padding: 2px 6px;
        border-radius: var(--radius-sm);
      }

      .pr-state {
        padding: 2px 8px;
        border-radius: var(--radius-full);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
      }

      .pr-state.open {
        background: var(--color-success-bg);
        color: var(--color-success);
      }

      .pr-state.closed {
        background: var(--color-error-bg);
        color: var(--color-error);
      }

      .pr-state.merged {
        background: #8250df20;
        color: #8250df;
      }

      .pr-state.draft {
        background: var(--color-bg-hover);
        color: var(--color-text-muted);
      }

      /* Issue styles */
      .issue-item {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background var(--transition-fast);
      }

      .issue-item:hover {
        background: var(--color-bg-hover);
      }

      .issue-number {
        font-weight: var(--font-weight-semibold);
        color: var(--color-primary);
        min-width: 50px;
      }

      .issue-info {
        flex: 1;
        min-width: 0;
      }

      .issue-title {
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        margin-bottom: var(--spacing-xs);
      }

      .issue-meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .issue-state {
        padding: 2px 8px;
        border-radius: var(--radius-full);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
      }

      .issue-state.open {
        background: var(--color-success-bg);
        color: var(--color-success);
      }

      .issue-state.closed {
        background: #8250df20;
        color: #8250df;
      }

      .issue-labels {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: var(--spacing-xs);
      }

      .issue-label {
        padding: 2px 6px;
        border-radius: var(--radius-sm);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
      }

      .issue-comments {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      /* Release styles */
      .release-item {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background var(--transition-fast);
      }

      .release-item:hover {
        background: var(--color-bg-hover);
      }

      .release-tag {
        font-family: var(--font-family-mono);
        font-weight: var(--font-weight-semibold);
        color: var(--color-primary);
        min-width: 80px;
      }

      .release-info {
        flex: 1;
        min-width: 0;
      }

      .release-title {
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        margin-bottom: var(--spacing-xs);
      }

      .release-meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .release-badge {
        padding: 2px 8px;
        border-radius: var(--radius-full);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
      }

      .release-badge.latest {
        background: var(--color-success-bg);
        color: var(--color-success);
      }

      .release-badge.prerelease {
        background: var(--color-warning-bg);
        color: var(--color-warning);
      }

      .release-badge.draft {
        background: var(--color-bg-hover);
        color: var(--color-text-muted);
      }

      .pr-stats {
        display: flex;
        gap: var(--spacing-sm);
        font-size: var(--font-size-xs);
      }

      .stat-additions {
        color: var(--color-success);
      }

      .stat-deletions {
        color: var(--color-error);
      }

      /* Workflow Runs */
      .workflow-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .workflow-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
      }

      .workflow-status {
        width: 12px;
        height: 12px;
        border-radius: 50%;
      }

      .workflow-status.success {
        background: var(--color-success);
      }

      .workflow-status.failure {
        background: var(--color-error);
      }

      .workflow-status.pending,
      .workflow-status.in_progress {
        background: var(--color-warning);
        animation: pulse 2s infinite;
      }

      .workflow-status.cancelled,
      .workflow-status.skipped {
        background: var(--color-text-muted);
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      .workflow-info {
        flex: 1;
        min-width: 0;
      }

      .workflow-name {
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
      }

      .workflow-meta {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .workflow-branch {
        font-family: var(--font-family-mono);
      }

      .workflow-link {
        color: var(--color-primary);
        text-decoration: none;
        font-size: var(--font-size-sm);
      }

      .workflow-link:hover {
        text-decoration: underline;
      }

      /* Empty/Error States */
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        text-align: center;
        color: var(--color-text-muted);
      }

      .empty-state svg {
        width: 48px;
        height: 48px;
        margin-bottom: var(--spacing-md);
        opacity: 0.5;
      }

      .error-message {
        padding: var(--spacing-md);
        background: var(--color-error-bg);
        color: var(--color-error);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--color-text-muted);
      }

      /* Buttons */
      .btn-row {
        display: flex;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-md);
      }

      .btn {
        padding: var(--spacing-sm) var(--spacing-md);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .btn:hover {
        background: var(--color-bg-hover);
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-primary {
        background: var(--color-primary);
        border-color: var(--color-primary);
        color: white;
      }

      .btn-primary:hover:not(:disabled) {
        background: var(--color-primary-hover);
      }

      .btn-danger {
        color: var(--color-error);
        border-color: var(--color-error);
      }

      .btn-danger:hover:not(:disabled) {
        background: var(--color-error-bg);
      }

      /* Filter row */
      .filter-row {
        display: flex;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-md);
      }

      .filter-select {
        padding: var(--spacing-xs) var(--spacing-sm);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
      }

      /* Detected repo info */
      .repo-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        margin-bottom: var(--spacing-md);
      }

      .repo-icon {
        width: 20px;
        height: 20px;
        color: var(--color-text-muted);
      }

      .repo-name {
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
      }

      .repo-remote {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) repositoryPath = '';

  @state() private activeTab: TabType = 'connection';
  @state() private connectionStatus: GitHubConnectionStatus | null = null;
  @state() private detectedRepo: DetectedGitHubRepo | null = null;
  @state() private pullRequests: PullRequestSummary[] = [];
  @state() private workflowRuns: WorkflowRun[] = [];
  @state() private issues: IssueSummary[] = [];
  @state() private repoLabels: Label[] = [];
  @state() private isLoading = false;
  @state() private error: string | null = null;
  @state() private tokenInput = '';
  @state() private prFilter: 'open' | 'closed' | 'all' = 'open';
  @state() private issueFilter: 'open' | 'closed' | 'all' = 'open';

  // Multi-account support (from active unified profile)
  @state() private accounts: ProfileIntegrationAccount[] = [];
  @state() private selectedAccountId: string | null = null;

  private unsubscribeStore?: () => void;

  // Create PR form
  @state() private createPrTitle = '';
  @state() private createPrBody = '';
  @state() private createPrHead = '';
  @state() private createPrBase = '';
  @state() private createPrDraft = false;

  // Create Issue form
  @state() private createIssueTitle = '';
  @state() private createIssueBody = '';
  @state() private createIssueLabels: string[] = [];

  // Releases
  @state() private releases: ReleaseSummary[] = [];

  // Create Release form
  @state() private createReleaseTag = '';
  @state() private createReleaseName = '';
  @state() private createReleaseBody = '';
  @state() private createReleasePrerelease = false;
  @state() private createReleaseDraft = false;
  @state() private createReleaseGenerateNotes = true;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();

    // Subscribe to unified profile store - get accounts from active profile
    this.unsubscribeStore = unifiedProfileStore.subscribe((state) => {
      const activeProfile = state.activeProfile;
      if (activeProfile) {
        this.accounts = activeProfile.integrationAccounts.filter((a) => a.integrationType === 'github');
        // If no account selected, try to select the default one
        if (!this.selectedAccountId && this.accounts.length > 0) {
          const defaultAccount = this.accounts.find((a) => a.isDefaultForType);
          this.selectedAccountId = defaultAccount?.id ?? this.accounts[0]?.id ?? null;
        }
      } else {
        this.accounts = [];
      }
    });

    // Initialize from current state
    const state = unifiedProfileStore.getState();
    if (state.activeProfile) {
      this.accounts = state.activeProfile.integrationAccounts.filter((a) => a.integrationType === 'github');
      if (this.accounts.length > 0 && !this.selectedAccountId) {
        const defaultAccount = this.accounts.find((a) => a.isDefaultForType);
        this.selectedAccountId = defaultAccount?.id ?? this.accounts[0]?.id ?? null;
      }
    }

    if (this.open) {
      await this.loadInitialData();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeStore?.();
  }

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('open') && this.open) {
      await this.loadInitialData();
    }
    if (changedProperties.has('repositoryPath') && this.repositoryPath && this.open) {
      await this.detectRepo();
    }
  }

  private async loadInitialData(): Promise<void> {
    this.isLoading = true;
    this.error = null;

    try {
      // Ensure unified profiles are loaded
      await unifiedProfileService.loadUnifiedProfiles();

      // Re-sync local state with store after loading
      const state = unifiedProfileStore.getState();
      if (state.activeProfile) {
        this.accounts = state.activeProfile.integrationAccounts.filter((a) => a.integrationType === 'github');
        if (this.accounts.length > 0 && !this.selectedAccountId) {
          const defaultAccount = this.accounts.find((a) => a.isDefaultForType);
          this.selectedAccountId = defaultAccount?.id ?? this.accounts[0]?.id ?? null;
        }
      }

      await this.checkConnection();
      if (this.repositoryPath) {
        await this.detectRepo();
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load data';
    } finally {
      this.isLoading = false;
    }
  }

  private async checkConnection(): Promise<void> {
    try {
      // Get token for selected account (or legacy token if no account)
      const token = await this.getSelectedAccountToken();
      const result = await gitService.checkGitHubConnectionWithToken(token);
      if (result.success && result.data) {
        this.connectionStatus = result.data;
        // Update cached user in account if connected
        const activeProfile = unifiedProfileStore.getState().activeProfile;
        if (activeProfile && this.selectedAccountId && result.data.connected && result.data.user) {
          await unifiedProfileService.updateProfileAccountCachedUser(activeProfile.id, this.selectedAccountId, {
            username: result.data.user.login,
            displayName: result.data.user.name ?? null,
            email: result.data.user.email ?? null,
            avatarUrl: result.data.user.avatarUrl ?? null,
          });
        }
      } else if (!result.success) {
        this.error = result.error?.message ?? 'Failed to check connection';
      } else {
        this.error = 'Failed to verify connection';
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to check connection';
    }
  }

  /**
   * Get the token for the currently selected account
   */
  private async getSelectedAccountToken(): Promise<string | null> {
    if (this.selectedAccountId) {
      return credentialService.getAccountToken('github', this.selectedAccountId);
    }
    return null;
  }

  /**
   * Handle account selection change
   */
  private async handleAccountChange(e: CustomEvent<{ account: ProfileIntegrationAccount }>): Promise<void> {
    const { account } = e.detail;
    this.selectedAccountId = account.id;
    this.connectionStatus = null;
    this.error = null;

    // Re-check connection with new account
    await this.loadInitialData();
  }

  /**
   * Handle add account request
   */
  private handleAddAccount(): void {
    // Switch to connection tab to add token for new account
    this.activeTab = 'connection';
    this.connectionStatus = null;
    // For now, we'll create a new account when saving a token
    // In a more complete implementation, this would open an account creation dialog
  }

  /**
   * Handle manage accounts request
   */
  private handleManageAccounts(): void {
    // Dispatch event to open accounts management
    this.dispatchEvent(
      new CustomEvent('manage-accounts', {
        detail: { integrationType: 'github' },
        bubbles: true,
        composed: true,
      })
    );
  }

  private async detectRepo(): Promise<void> {
    if (!this.repositoryPath) return;

    const result = await gitService.detectGitHubRepo(this.repositoryPath);
    if (result.success && result.data) {
      this.detectedRepo = result.data;
      // Auto-load data if connected
      if (this.connectionStatus?.connected) {
        await Promise.all([
          this.loadPullRequests(),
          this.loadWorkflowRuns(),
          this.loadIssues(),
          this.loadLabels(),
          this.loadReleases(),
        ]);
      }
    }
  }

  private async loadPullRequests(providedToken?: string): Promise<void> {
    if (!this.detectedRepo || !this.connectionStatus?.connected) return;

    this.isLoading = true;
    this.error = null;

    try {
      const token = providedToken ?? await this.getSelectedAccountToken();
      const result = await gitService.listPullRequests(
        this.detectedRepo.owner,
        this.detectedRepo.repo,
        this.prFilter,
        30,
        token
      );

      if (result.success && result.data) {
        this.pullRequests = result.data;
      } else {
        this.error = result.error?.message ?? 'Failed to load pull requests';
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load pull requests';
    } finally {
      this.isLoading = false;
    }
  }

  private async loadWorkflowRuns(providedToken?: string): Promise<void> {
    if (!this.detectedRepo || !this.connectionStatus?.connected) return;

    try {
      const token = providedToken ?? await this.getSelectedAccountToken();
      const result = await gitService.getWorkflowRuns(
        this.detectedRepo.owner,
        this.detectedRepo.repo,
        undefined,
        20,
        token
      );

      if (result.success && result.data) {
        this.workflowRuns = result.data;
      }
    } catch {
      // Silently fail for workflow runs
    }
  }

  private async loadIssues(providedToken?: string): Promise<void> {
    if (!this.detectedRepo || !this.connectionStatus?.connected) return;

    try {
      const token = providedToken ?? await this.getSelectedAccountToken();
      const result = await gitService.listIssues(
        this.detectedRepo.owner,
        this.detectedRepo.repo,
        this.issueFilter,
        undefined,
        30,
        token
      );

      if (result.success && result.data) {
        this.issues = result.data;
      }
    } catch {
      // Silently fail for issues
    }
  }

  private async loadLabels(providedToken?: string): Promise<void> {
    if (!this.detectedRepo || !this.connectionStatus?.connected) return;

    try {
      const token = providedToken ?? await this.getSelectedAccountToken();
      const result = await gitService.getRepoLabels(
        this.detectedRepo.owner,
        this.detectedRepo.repo,
        undefined,
        token
      );

      if (result.success && result.data) {
        this.repoLabels = result.data;
      }
    } catch {
      // Silently fail for labels
    }
  }

  private async loadReleases(providedToken?: string): Promise<void> {
    if (!this.detectedRepo || !this.connectionStatus?.connected) return;

    try {
      const token = providedToken ?? await this.getSelectedAccountToken();
      const result = await gitService.listReleases(
        this.detectedRepo.owner,
        this.detectedRepo.repo,
        20,
        token
      );

      if (result.success && result.data) {
        this.releases = result.data;
      }
    } catch {
      // Silently fail for releases
    }
  }

  private async handleSaveToken(): Promise<void> {
    if (!this.tokenInput.trim()) return;

    this.isLoading = true;
    this.error = null;
    const tokenToSave = this.tokenInput.trim();

    try {
      // First verify the token works by checking connection
      const verifyResult = await gitService.checkGitHubConnectionWithToken(tokenToSave);
      if (!verifyResult.success || !verifyResult.data?.connected) {
        this.error = verifyResult.error?.message ?? 'Invalid token or connection failed';
        return;
      }

      const user = verifyResult.data.user;
      const activeProfile = unifiedProfileStore.getState().activeProfile;

      // If we have a selected account, save token to that account
      if (this.selectedAccountId) {
        await credentialService.storeAccountToken('github', this.selectedAccountId, tokenToSave);
      } else if (activeProfile) {
        // No account selected - create a new account in the active profile
        const { createEmptyGitHubProfileAccount, generateId } = await import('../../types/unified-profile.types.ts');
        const newAccount = {
          ...createEmptyGitHubProfileAccount(),
          id: generateId(),
          name: user?.login ? `GitHub (${user.login})` : 'GitHub Account',
          isDefaultForType: this.accounts.length === 0,
          cachedUser: user ? {
            username: user.login,
            displayName: user.name ?? null,
            email: user.email ?? null,
            avatarUrl: user.avatarUrl ?? null,
          } : null,
        };

        const savedAccount = await unifiedProfileService.addAccountToProfile(activeProfile.id, newAccount);
        await credentialService.storeAccountToken('github', savedAccount.id, tokenToSave);
        this.selectedAccountId = savedAccount.id;
      } else {
        // Fallback to legacy token storage if no profile
        await gitService.storeGitHubToken(tokenToSave);
      }

      // Token saved, update state
      this.tokenInput = '';
      this.connectionStatus = verifyResult.data;

      // Load data if connected and repo detected
      // Pass the token directly since storage might not be ready yet
      if (this.connectionStatus?.connected && this.detectedRepo) {
        await Promise.all([
          this.loadPullRequests(tokenToSave),
          this.loadWorkflowRuns(tokenToSave),
          this.loadIssues(tokenToSave),
          this.loadLabels(tokenToSave),
          this.loadReleases(tokenToSave),
        ]);
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to save token';
      this.tokenInput = tokenToSave;
    } finally {
      this.isLoading = false;
    }
  }

  private async handleDisconnect(): Promise<void> {
    this.isLoading = true;
    this.error = null;

    try {
      // Delete token for selected account or legacy token
      if (this.selectedAccountId) {
        await credentialService.deleteAccountToken('github', this.selectedAccountId);
      } else {
        await gitService.deleteGitHubToken();
      }

      this.connectionStatus = { connected: false, user: null, scopes: [] };
      this.pullRequests = [];
      this.workflowRuns = [];
      this.issues = [];
      this.repoLabels = [];
      this.releases = [];
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to disconnect';
    } finally {
      this.isLoading = false;
    }
  }

  private async handleCreatePR(): Promise<void> {
    if (!this.detectedRepo || !this.createPrTitle || !this.createPrHead || !this.createPrBase) return;

    this.isLoading = true;
    this.error = null;

    try {
      const token = await this.getSelectedAccountToken();
      const input: CreatePullRequestInput = {
        title: this.createPrTitle,
        body: this.createPrBody || undefined,
        head: this.createPrHead,
        base: this.createPrBase,
        draft: this.createPrDraft || undefined,
      };

      const result = await gitService.createPullRequest(
        this.detectedRepo.owner,
        this.detectedRepo.repo,
        input,
        token
      );

      if (result.success && result.data) {
        // Reset form and switch to PR list
        this.createPrTitle = '';
        this.createPrBody = '';
        this.createPrHead = '';
        this.createPrBase = '';
        this.createPrDraft = false;
        this.activeTab = 'pull-requests';
        await this.loadPullRequests();
      } else {
        this.error = result.error?.message ?? 'Failed to create pull request';
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to create pull request';
    } finally {
      this.isLoading = false;
    }
  }

  private handlePrFilterChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    this.prFilter = select.value as 'open' | 'closed' | 'all';
    this.loadPullRequests();
  }

  private handleIssueFilterChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    this.issueFilter = select.value as 'open' | 'closed' | 'all';
    this.loadIssues();
  }

  private async handleCreateIssue(): Promise<void> {
    if (!this.detectedRepo || !this.createIssueTitle) return;

    this.isLoading = true;
    this.error = null;

    try {
      const token = await this.getSelectedAccountToken();
      const input: CreateIssueInput = {
        title: this.createIssueTitle,
        body: this.createIssueBody || undefined,
        labels: this.createIssueLabels.length > 0 ? this.createIssueLabels : undefined,
      };

      const result = await gitService.createIssue(
        this.detectedRepo.owner,
        this.detectedRepo.repo,
        input,
        token
      );

      if (result.success && result.data) {
        // Reset form and switch to issues list
        this.createIssueTitle = '';
        this.createIssueBody = '';
        this.createIssueLabels = [];
        this.activeTab = 'issues';
        await this.loadIssues();
      } else {
        this.error = result.error?.message ?? 'Failed to create issue';
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to create issue';
    } finally {
      this.isLoading = false;
    }
  }

  private toggleIssueLabel(labelName: string): void {
    if (this.createIssueLabels.includes(labelName)) {
      this.createIssueLabels = this.createIssueLabels.filter(l => l !== labelName);
    } else {
      this.createIssueLabels = [...this.createIssueLabels, labelName];
    }
  }

  private getLabelTextColor(bgColor: string): string {
    // Simple luminance check to determine if text should be light or dark
    const hex = bgColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000000' : '#ffffff';
  }

  private async handleCreateRelease(): Promise<void> {
    if (!this.detectedRepo || !this.createReleaseTag) return;

    this.isLoading = true;
    this.error = null;

    try {
      const token = await this.getSelectedAccountToken();
      const input: CreateReleaseInput = {
        tagName: this.createReleaseTag,
        name: this.createReleaseName || undefined,
        body: this.createReleaseBody || undefined,
        draft: this.createReleaseDraft || undefined,
        prerelease: this.createReleasePrerelease || undefined,
        generateReleaseNotes: this.createReleaseGenerateNotes || undefined,
      };

      const result = await gitService.createRelease(
        this.detectedRepo.owner,
        this.detectedRepo.repo,
        input,
        token
      );

      if (result.success && result.data) {
        // Reset form and switch to releases list
        this.createReleaseTag = '';
        this.createReleaseName = '';
        this.createReleaseBody = '';
        this.createReleasePrerelease = false;
        this.createReleaseDraft = false;
        this.createReleaseGenerateNotes = true;
        this.activeTab = 'releases';
        await this.loadReleases();
      } else {
        this.error = result.error?.message ?? 'Failed to create release';
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to create release';
    } finally {
      this.isLoading = false;
    }
  }

  private handleClose(): void {
    this.dispatchEvent(new CustomEvent('close'));
  }

  private openInBrowser(url: string): void {
    window.open(url, '_blank');
  }

  private getPrState(pr: PullRequestSummary): string {
    if (pr.draft) return 'draft';
    if (pr.state === 'closed') {
      // Check if merged based on URL pattern (GitHub PRs have /pull/N for open, merged shows differently)
      return 'closed';
    }
    return pr.state;
  }

  private formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    return date.toLocaleDateString();
  }

  private renderConnectionTab() {
    if (this.connectionStatus?.connected && this.connectionStatus.user) {
      const user = this.connectionStatus.user;
      return html`
        <div class="connection-status">
          <img class="avatar" src="${user.avatarUrl}" alt="${user.login}" />
          <div class="user-info">
            <div class="user-name">${user.name ?? user.login}</div>
            <div class="user-login">@${user.login}</div>
            ${this.connectionStatus.scopes.length > 0 ? html`
              <div class="scopes">
                ${this.connectionStatus.scopes.map(scope => html`
                  <span class="scope-badge">${scope}</span>
                `)}
              </div>
            ` : ''}
          </div>
          <button class="btn btn-danger" @click=${() => this.handleDisconnect()} ?disabled=${this.isLoading}>
            Disconnect
          </button>
        </div>
      `;
    }

    return html`
      <div class="token-form">
        <div class="form-group">
          <label>Personal Access Token</label>
          <input
            type="password"
            placeholder="ghp_xxxxxxxxxxxx"
            .value=${this.tokenInput}
            @input=${(e: Event) => this.tokenInput = (e.target as HTMLInputElement).value}
            @change=${(e: Event) => this.tokenInput = (e.target as HTMLInputElement).value}
            @paste=${(e: Event) => {
              const target = e.target as HTMLInputElement;
              setTimeout(() => this.tokenInput = target.value, 0);
            }}
          />
          <span class="help-text">
            Create a token at
            <a
              class="help-link"
              href="https://github.com/settings/tokens/new?scopes=repo,read:user"
              target="_blank"
            >github.com/settings/tokens</a>
            with <code>repo</code> and <code>read:user</code> scopes.
          </span>
        </div>
        <div class="btn-row">
          <button
            class="btn btn-primary"
            @click=${() => this.handleSaveToken()}
            ?disabled=${this.isLoading || !this.tokenInput.trim()}
          >
            Connect to GitHub
          </button>
        </div>
      </div>
    `;
  }

  private renderPullRequestsTab() {
    if (!this.connectionStatus?.connected) {
      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
          </svg>
          <p>Connect to GitHub to view pull requests</p>
        </div>
      `;
    }

    if (!this.detectedRepo) {
      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <p>No GitHub repository detected</p>
        </div>
      `;
    }

    return html`
      <div class="filter-row">
        <select class="filter-select" @change=${this.handlePrFilterChange}>
          <option value="open" ?selected=${this.prFilter === 'open'}>Open</option>
          <option value="closed" ?selected=${this.prFilter === 'closed'}>Closed</option>
          <option value="all" ?selected=${this.prFilter === 'all'}>All</option>
        </select>
        <button class="btn" @click=${() => this.activeTab = 'create-pr'}>
          + New PR
        </button>
      </div>

      ${this.isLoading ? html`<div class="loading">Loading pull requests...</div>` : ''}

      ${!this.isLoading && this.pullRequests.length === 0 ? html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="18" cy="18" r="3"></circle>
            <circle cx="6" cy="6" r="3"></circle>
            <path d="M6 21V9a9 9 0 0 0 9 9"></path>
          </svg>
          <p>No ${this.prFilter} pull requests</p>
        </div>
      ` : ''}

      <div class="pr-list">
        ${this.pullRequests.map(pr => html`
          <div class="pr-item" @click=${() => this.openInBrowser(pr.htmlUrl)}>
            <span class="pr-number">#${pr.number}</span>
            <div class="pr-info">
              <div class="pr-title">${pr.title}</div>
              <div class="pr-meta">
                <span class="pr-state ${this.getPrState(pr)}">${this.getPrState(pr)}</span>
                <span class="pr-branch">${pr.headRef} → ${pr.baseRef}</span>
                <span>by ${pr.user.login}</span>
                <span>${this.formatDate(pr.createdAt)}</span>
              </div>
            </div>
            ${pr.additions != null && pr.deletions != null ? html`
              <div class="pr-stats">
                <span class="stat-additions">+${pr.additions}</span>
                <span class="stat-deletions">-${pr.deletions}</span>
              </div>
            ` : ''}
          </div>
        `)}
      </div>
    `;
  }

  private renderActionsTab() {
    if (!this.connectionStatus?.connected) {
      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
          </svg>
          <p>Connect to GitHub to view workflow runs</p>
        </div>
      `;
    }

    if (!this.detectedRepo) {
      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <p>No GitHub repository detected</p>
        </div>
      `;
    }

    if (this.workflowRuns.length === 0) {
      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
          </svg>
          <p>No workflow runs found</p>
        </div>
      `;
    }

    return html`
      <div class="workflow-list">
        ${this.workflowRuns.map(run => html`
          <div class="workflow-item">
            <div class="workflow-status ${run.conclusion ?? run.status}"></div>
            <div class="workflow-info">
              <div class="workflow-name">${run.name}</div>
              <div class="workflow-meta">
                <span class="workflow-branch">${run.headBranch}</span>
                <span>#${run.runNumber}</span>
                <span>${run.event}</span>
                <span>${this.formatDate(run.createdAt)}</span>
              </div>
            </div>
            <a
              class="workflow-link"
              href="${run.htmlUrl}"
              target="_blank"
              @click=${(e: Event) => e.stopPropagation()}
            >
              View →
            </a>
          </div>
        `)}
      </div>
    `;
  }

  private renderIssuesTab() {
    if (!this.connectionStatus?.connected) {
      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
          </svg>
          <p>Connect to GitHub to view issues</p>
        </div>
      `;
    }

    if (!this.detectedRepo) {
      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <p>No GitHub repository detected</p>
        </div>
      `;
    }

    return html`
      <div class="filter-row">
        <select class="filter-select" @change=${this.handleIssueFilterChange}>
          <option value="open" ?selected=${this.issueFilter === 'open'}>Open</option>
          <option value="closed" ?selected=${this.issueFilter === 'closed'}>Closed</option>
          <option value="all" ?selected=${this.issueFilter === 'all'}>All</option>
        </select>
        <button class="btn" @click=${() => this.activeTab = 'create-issue'}>
          + New Issue
        </button>
      </div>

      ${this.isLoading ? html`<div class="loading">Loading issues...</div>` : ''}

      ${!this.isLoading && this.issues.length === 0 ? html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p>No ${this.issueFilter} issues</p>
        </div>
      ` : ''}

      <div class="pr-list">
        ${this.issues.map(issue => html`
          <div class="issue-item" @click=${() => this.openInBrowser(issue.htmlUrl)}>
            <span class="issue-number">#${issue.number}</span>
            <div class="issue-info">
              <div class="issue-title">${issue.title}</div>
              <div class="issue-meta">
                <span class="issue-state ${issue.state}">${issue.state}</span>
                <span>by ${issue.user.login}</span>
                <span>${this.formatDate(issue.createdAt)}</span>
                ${issue.comments > 0 ? html`
                  <span class="issue-comments">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    ${issue.comments}
                  </span>
                ` : ''}
              </div>
              ${issue.labels.length > 0 ? html`
                <div class="issue-labels">
                  ${issue.labels.map(label => html`
                    <span
                      class="issue-label"
                      style="background: #${label.color}; color: ${this.getLabelTextColor(label.color)}"
                    >
                      ${label.name}
                    </span>
                  `)}
                </div>
              ` : ''}
            </div>
          </div>
        `)}
      </div>
    `;
  }

  private renderCreateIssueTab() {
    return html`
      <div class="token-form">
        <div class="form-group">
          <label>Title</label>
          <input
            type="text"
            placeholder="Issue title"
            .value=${this.createIssueTitle}
            @input=${(e: Event) => this.createIssueTitle = (e.target as HTMLInputElement).value}
          />
        </div>

        <div class="form-group">
          <label>Description</label>
          <textarea
            placeholder="Describe the issue..."
            .value=${this.createIssueBody}
            @input=${(e: Event) => this.createIssueBody = (e.target as HTMLTextAreaElement).value}
          ></textarea>
        </div>

        ${this.repoLabels.length > 0 ? html`
          <div class="form-group">
            <label>Labels</label>
            <div class="issue-labels" style="cursor: pointer;">
              ${this.repoLabels.map(label => html`
                <span
                  class="issue-label"
                  style="
                    background: ${this.createIssueLabels.includes(label.name) ? '#' + label.color : 'var(--color-bg-hover)'};
                    color: ${this.createIssueLabels.includes(label.name) ? this.getLabelTextColor(label.color) : 'var(--color-text-secondary)'};
                    border: 1px solid ${this.createIssueLabels.includes(label.name) ? 'transparent' : 'var(--color-border)'};
                  "
                  @click=${() => this.toggleIssueLabel(label.name)}
                >
                  ${label.name}
                </span>
              `)}
            </div>
          </div>
        ` : ''}

        <div class="btn-row">
          <button class="btn" @click=${() => this.activeTab = 'issues'}>
            Cancel
          </button>
          <button
            class="btn btn-primary"
            @click=${this.handleCreateIssue}
            ?disabled=${this.isLoading || !this.createIssueTitle}
          >
            Create Issue
          </button>
        </div>
      </div>
    `;
  }

  private renderReleasesTab() {
    if (!this.connectionStatus?.connected) {
      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
          </svg>
          <p>Connect to GitHub to view releases</p>
        </div>
      `;
    }

    if (!this.detectedRepo) {
      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <p>No GitHub repository detected</p>
        </div>
      `;
    }

    return html`
      <div class="filter-row">
        <button class="btn" @click=${() => this.activeTab = 'create-release'}>
          + New Release
        </button>
      </div>

      ${this.isLoading ? html`<div class="loading">Loading releases...</div>` : ''}

      ${!this.isLoading && this.releases.length === 0 ? html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
            <line x1="7" y1="7" x2="7.01" y2="7"></line>
          </svg>
          <p>No releases found</p>
        </div>
      ` : ''}

      <div class="pr-list">
        ${this.releases.map((release, index) => html`
          <div class="release-item" @click=${() => this.openInBrowser(release.htmlUrl)}>
            <span class="release-tag">${release.tagName}</span>
            <div class="release-info">
              <div class="release-title">${release.name || release.tagName}</div>
              <div class="release-meta">
                ${index === 0 && !release.draft && !release.prerelease ? html`
                  <span class="release-badge latest">Latest</span>
                ` : ''}
                ${release.prerelease ? html`
                  <span class="release-badge prerelease">Pre-release</span>
                ` : ''}
                ${release.draft ? html`
                  <span class="release-badge draft">Draft</span>
                ` : ''}
                <span>by ${release.author.login}</span>
                <span>${this.formatDate(release.createdAt)}</span>
                ${release.assetsCount > 0 ? html`
                  <span>${release.assetsCount} asset${release.assetsCount !== 1 ? 's' : ''}</span>
                ` : ''}
              </div>
            </div>
          </div>
        `)}
      </div>
    `;
  }

  private renderCreateReleaseTab() {
    return html`
      <div class="token-form">
        <div class="form-group">
          <label>Tag Name</label>
          <input
            type="text"
            placeholder="v1.0.0"
            .value=${this.createReleaseTag}
            @input=${(e: Event) => this.createReleaseTag = (e.target as HTMLInputElement).value}
          />
          <span class="help-text">Create a new tag or use an existing one</span>
        </div>

        <div class="form-group">
          <label>Release Title</label>
          <input
            type="text"
            placeholder="Release title (optional)"
            .value=${this.createReleaseName}
            @input=${(e: Event) => this.createReleaseName = (e.target as HTMLInputElement).value}
          />
        </div>

        <div class="form-group">
          <label>Description</label>
          <textarea
            placeholder="Describe this release..."
            .value=${this.createReleaseBody}
            @input=${(e: Event) => this.createReleaseBody = (e.target as HTMLTextAreaElement).value}
          ></textarea>
        </div>

        <div class="form-group">
          <label>
            <input
              type="checkbox"
              .checked=${this.createReleaseGenerateNotes}
              @change=${(e: Event) => this.createReleaseGenerateNotes = (e.target as HTMLInputElement).checked}
            />
            Auto-generate release notes
          </label>
        </div>

        <div class="form-group">
          <label>
            <input
              type="checkbox"
              .checked=${this.createReleasePrerelease}
              @change=${(e: Event) => this.createReleasePrerelease = (e.target as HTMLInputElement).checked}
            />
            Mark as pre-release
          </label>
        </div>

        <div class="form-group">
          <label>
            <input
              type="checkbox"
              .checked=${this.createReleaseDraft}
              @change=${(e: Event) => this.createReleaseDraft = (e.target as HTMLInputElement).checked}
            />
            Save as draft
          </label>
        </div>

        <div class="btn-row">
          <button class="btn" @click=${() => this.activeTab = 'releases'}>
            Cancel
          </button>
          <button
            class="btn btn-primary"
            @click=${this.handleCreateRelease}
            ?disabled=${this.isLoading || !this.createReleaseTag}
          >
            Create Release
          </button>
        </div>
      </div>
    `;
  }

  private renderCreatePrTab() {
    return html`
      <div class="token-form">
        <div class="form-group">
          <label>Title</label>
          <input
            type="text"
            placeholder="Pull request title"
            .value=${this.createPrTitle}
            @input=${(e: Event) => this.createPrTitle = (e.target as HTMLInputElement).value}
          />
        </div>

        <div class="form-group">
          <label>Description</label>
          <textarea
            placeholder="Describe your changes..."
            .value=${this.createPrBody}
            @input=${(e: Event) => this.createPrBody = (e.target as HTMLTextAreaElement).value}
          ></textarea>
        </div>

        <div class="form-group">
          <label>Head Branch (your changes)</label>
          <input
            type="text"
            placeholder="feature-branch"
            .value=${this.createPrHead}
            @input=${(e: Event) => this.createPrHead = (e.target as HTMLInputElement).value}
          />
        </div>

        <div class="form-group">
          <label>Base Branch (merge into)</label>
          <input
            type="text"
            placeholder="main"
            .value=${this.createPrBase}
            @input=${(e: Event) => this.createPrBase = (e.target as HTMLInputElement).value}
          />
        </div>

        <div class="form-group">
          <label>
            <input
              type="checkbox"
              .checked=${this.createPrDraft}
              @change=${(e: Event) => this.createPrDraft = (e.target as HTMLInputElement).checked}
            />
            Create as draft
          </label>
        </div>

        <div class="btn-row">
          <button class="btn" @click=${() => this.activeTab = 'pull-requests'}>
            Cancel
          </button>
          <button
            class="btn btn-primary"
            @click=${this.handleCreatePR}
            ?disabled=${this.isLoading || !this.createPrTitle || !this.createPrHead || !this.createPrBase}
          >
            Create Pull Request
          </button>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <lv-modal
        ?open=${this.open}
        modalTitle="GitHub"
        @close=${this.handleClose}
      >
        <div class="content">
          ${this.detectedRepo ? html`
            <div class="repo-info">
              <svg class="repo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
              </svg>
              <span class="repo-name">${this.detectedRepo.owner}/${this.detectedRepo.repo}</span>
              <span class="repo-remote">(${this.detectedRepo.remoteName})</span>
            </div>
          ` : ''}

          ${this.accounts.length > 0 || this.connectionStatus?.connected ? html`
            <lv-account-selector
              integrationType="github"
              .selectedAccountId=${this.selectedAccountId}
              @account-change=${this.handleAccountChange}
              @add-account=${this.handleAddAccount}
              @manage-accounts=${this.handleManageAccounts}
            ></lv-account-selector>
          ` : nothing}

          <div class="tabs">
            <button
              class="tab ${this.activeTab === 'connection' ? 'active' : ''}"
              @click=${() => this.activeTab = 'connection'}
            >
              Connection
            </button>
            <button
              class="tab ${this.activeTab === 'pull-requests' ? 'active' : ''}"
              @click=${() => this.activeTab = 'pull-requests'}
            >
              Pull Requests
            </button>
            <button
              class="tab ${this.activeTab === 'issues' ? 'active' : ''}"
              @click=${() => this.activeTab = 'issues'}
            >
              Issues
            </button>
            <button
              class="tab ${this.activeTab === 'releases' ? 'active' : ''}"
              @click=${() => this.activeTab = 'releases'}
            >
              Releases
            </button>
            <button
              class="tab ${this.activeTab === 'actions' ? 'active' : ''}"
              @click=${() => this.activeTab = 'actions'}
            >
              Actions
            </button>
          </div>

          ${this.error ? html`
            <div class="error-message">${this.error}</div>
          ` : ''}

          <div class="tab-content">
            ${this.activeTab === 'connection' ? this.renderConnectionTab() : ''}
            ${this.activeTab === 'pull-requests' ? this.renderPullRequestsTab() : ''}
            ${this.activeTab === 'issues' ? this.renderIssuesTab() : ''}
            ${this.activeTab === 'releases' ? this.renderReleasesTab() : ''}
            ${this.activeTab === 'actions' ? this.renderActionsTab() : ''}
            ${this.activeTab === 'create-pr' ? this.renderCreatePrTab() : ''}
            ${this.activeTab === 'create-issue' ? this.renderCreateIssueTab() : ''}
            ${this.activeTab === 'create-release' ? this.renderCreateReleaseTab() : ''}
          </div>
        </div>
      </lv-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-github-dialog': LvGitHubDialog;
  }
}
