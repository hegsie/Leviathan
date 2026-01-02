/**
 * GitLab Integration Dialog
 * Manage GitLab connection, view MRs, issues, and pipelines
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import { openExternalUrl, handleExternalLink } from '../../utils/index.ts';
import type {
  GitLabConnectionStatus,
  DetectedGitLabRepo,
  GitLabMergeRequest,
  GitLabIssue,
  GitLabPipeline,
  CreateMergeRequestInput,
  CreateGitLabIssueInput,
} from '../../services/git.service.ts';
import { unifiedProfileStore } from '../../stores/unified-profile.store.ts';
import * as unifiedProfileService from '../../services/unified-profile.service.ts';
import type { ProfileIntegrationAccount } from '../../types/unified-profile.types.ts';
import * as credentialService from '../../services/credential.service.ts';
import './lv-modal.ts';
import './lv-account-selector.ts';

type TabType = 'connection' | 'merge-requests' | 'issues' | 'pipelines' | 'create-mr' | 'create-issue';

@customElement('lv-gitlab-dialog')
export class LvGitLabDialog extends LitElement {
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

      /* Button styles */
      .btn {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-xs);
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

      .btn-secondary {
        background: var(--color-bg-tertiary);
        border-color: var(--color-border);
        color: var(--color-text-primary);
      }

      .btn-secondary:hover:not(:disabled) {
        background: var(--color-bg-hover);
      }

      .btn-danger {
        color: var(--color-error);
        border-color: var(--color-error);
      }

      .btn-danger:hover:not(:disabled) {
        background: var(--color-error-bg);
      }

      .tab-content {
        flex: 1;
        overflow: auto;
      }

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

      .user-avatar-placeholder {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: var(--color-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-lg);
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
      .form-group textarea,
      .form-group select {
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
      .form-group textarea:focus,
      .form-group select:focus {
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

      .mr-list, .issue-list, .pipeline-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .mr-item, .issue-item {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background var(--transition-fast);
      }

      .mr-item:hover, .issue-item:hover {
        background: var(--color-bg-hover);
      }

      .mr-number, .issue-number {
        font-weight: var(--font-weight-semibold);
        color: var(--color-primary);
        min-width: 50px;
      }

      .mr-info, .issue-info {
        flex: 1;
        min-width: 0;
      }

      .mr-title, .issue-title {
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        margin-bottom: var(--spacing-xs);
      }

      .mr-meta, .issue-meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .mr-branch {
        display: flex;
        align-items: center;
        gap: 4px;
        font-family: var(--font-family-mono);
        background: var(--color-bg-hover);
        padding: 2px 6px;
        border-radius: var(--radius-sm);
      }

      .mr-state, .issue-state {
        padding: 2px 8px;
        border-radius: var(--radius-full);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
      }

      .mr-state.opened, .issue-state.opened {
        background: var(--color-success-bg);
        color: var(--color-success);
      }

      .mr-state.merged {
        background: #8250df20;
        color: #8250df;
      }

      .mr-state.closed, .issue-state.closed {
        background: var(--color-error-bg);
        color: var(--color-error);
      }

      .mr-state.draft {
        background: var(--color-bg-hover);
        color: var(--color-text-muted);
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
        background: var(--color-bg-hover);
        color: var(--color-text-secondary);
      }

      .pipeline-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background var(--transition-fast);
      }

      .pipeline-item:hover {
        background: var(--color-bg-hover);
      }

      .pipeline-status {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .pipeline-status.success {
        background: var(--color-success);
      }

      .pipeline-status.failed {
        background: var(--color-error);
      }

      .pipeline-status.running, .pipeline-status.pending {
        background: var(--color-warning);
        animation: pulse 2s infinite;
      }

      .pipeline-status.canceled, .pipeline-status.skipped {
        background: var(--color-text-muted);
      }

      .pipeline-info {
        flex: 1;
        min-width: 0;
      }

      .pipeline-ref {
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        font-family: var(--font-family-mono);
      }

      .pipeline-meta {
        display: flex;
        gap: var(--spacing-sm);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      .detected-repo {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        margin-bottom: var(--spacing-md);
      }

      .repo-icon {
        width: 20px;
        height: 20px;
        color: var(--color-primary);
      }

      .repo-name {
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
      }

      .repo-remote {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .filter-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-md);
      }

      .filter-select {
        padding: var(--spacing-xs) var(--spacing-sm);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
      }

      .btn-row {
        display: flex;
        gap: var(--spacing-sm);
        justify-content: flex-end;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--color-text-muted);
        text-align: center;
      }

      .empty-state svg {
        width: 48px;
        height: 48px;
        margin-bottom: var(--spacing-md);
        opacity: 0.5;
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--color-text-muted);
      }

      .error {
        padding: var(--spacing-md);
        background: var(--color-error-bg);
        color: var(--color-error);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
      }

      .checkbox-group {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .checkbox-group input[type="checkbox"] {
        width: 16px;
        height: 16px;
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: String }) repositoryPath = '';

  @state() private activeTab: TabType = 'connection';
  @state() private connectionStatus: GitLabConnectionStatus | null = null;
  @state() private detectedRepo: DetectedGitLabRepo | null = null;
  @state() private mergeRequests: GitLabMergeRequest[] = [];
  @state() private issues: GitLabIssue[] = [];
  @state() private pipelines: GitLabPipeline[] = [];
  @state() private labels: string[] = [];
  @state() private isLoading = false;
  @state() private error: string | null = null;
  @state() private tokenInput = '';
  @state() private instanceUrlInput = 'https://gitlab.com';
  @state() private mrFilter: 'opened' | 'merged' | 'closed' | 'all' = 'opened';
  @state() private issueFilter: 'opened' | 'closed' | 'all' = 'opened';

  // Multi-account support (from active unified profile)
  @state() private accounts: ProfileIntegrationAccount[] = [];
  @state() private selectedAccountId: string | null = null;

  private unsubscribeStore?: () => void;

  // Create MR form
  @state() private createMrTitle = '';
  @state() private createMrDescription = '';
  @state() private createMrSource = '';
  @state() private createMrTarget = '';
  @state() private createMrDraft = false;

  // Create Issue form
  @state() private createIssueTitle = '';
  @state() private createIssueDescription = '';
  @state() private createIssueLabels: string[] = [];

  async connectedCallback(): Promise<void> {
    super.connectedCallback();

    // Subscribe to unified profile store - get accounts from active profile
    this.unsubscribeStore = unifiedProfileStore.subscribe((state) => {
      const activeProfile = state.activeProfile;
      if (activeProfile) {
        this.accounts = activeProfile.integrationAccounts.filter((a) => a.integrationType === 'gitlab');
        // If no account selected, try to select the default one
        if (!this.selectedAccountId && this.accounts.length > 0) {
          const defaultAccount = this.accounts.find((a) => a.isDefaultForType);
          const account = defaultAccount ?? this.accounts[0];
          if (account) {
            this.selectedAccountId = account.id;
            // Update instance URL from account config
            if (account.config.type === 'gitlab' && account.config.instanceUrl) {
              this.instanceUrlInput = account.config.instanceUrl;
            }
          }
        }
      } else {
        this.accounts = [];
      }
    });

    // Initialize from current state
    const state = unifiedProfileStore.getState();
    if (state.activeProfile) {
      this.accounts = state.activeProfile.integrationAccounts.filter((a) => a.integrationType === 'gitlab');
      if (this.accounts.length > 0 && !this.selectedAccountId) {
        const defaultAccount = this.accounts.find((a) => a.isDefaultForType);
        const account = defaultAccount ?? this.accounts[0];
        if (account) {
          this.selectedAccountId = account.id;
          if (account.config.type === 'gitlab' && account.config.instanceUrl) {
            this.instanceUrlInput = account.config.instanceUrl;
          }
        }
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
        this.accounts = state.activeProfile.integrationAccounts.filter((a) => a.integrationType === 'gitlab');
        if (this.accounts.length > 0 && !this.selectedAccountId) {
          const defaultAccount = this.accounts.find((a) => a.isDefaultForType);
          this.selectedAccountId = defaultAccount?.id ?? this.accounts[0]?.id ?? null;
        }
      }

      if (this.repositoryPath) {
        await this.detectRepo();
      }
      if (this.detectedRepo?.instanceUrl || this.instanceUrlInput) {
        await this.checkConnection();
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load data';
    } finally {
      this.isLoading = false;
    }
  }

  private async checkConnection(): Promise<void> {
    const instanceUrl = this.detectedRepo?.instanceUrl || this.instanceUrlInput;
    if (!instanceUrl) return;

    // Get token for selected account (or legacy token if no account)
    const token = await this.getSelectedAccountToken();
    const result = await gitService.checkGitLabConnectionWithToken(instanceUrl, token);
    if (result.success && result.data) {
      this.connectionStatus = result.data;
      // Update cached user in account if connected
      const activeProfile = unifiedProfileStore.getState().activeProfile;
      if (activeProfile && this.selectedAccountId && result.data.connected && result.data.user) {
        await unifiedProfileService.updateProfileAccountCachedUser(activeProfile.id, this.selectedAccountId, {
          username: result.data.user.username,
          displayName: result.data.user.name ?? null,
          email: null, // GitLab API doesn't return email in user object
          avatarUrl: result.data.user.avatarUrl ?? null,
        });
      }
    }
  }

  /**
   * Get the token for the currently selected account
   */
  private async getSelectedAccountToken(): Promise<string | null> {
    if (this.selectedAccountId) {
      return credentialService.getAccountToken('gitlab', this.selectedAccountId);
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

    // Update instance URL from account config
    if (account.config.type === 'gitlab' && account.config.instanceUrl) {
      this.instanceUrlInput = account.config.instanceUrl;
    }

    // Re-check connection with new account
    await this.loadInitialData();
  }

  /**
   * Handle add account request
   */
  private handleAddAccount(): void {
    this.activeTab = 'connection';
    this.connectionStatus = null;
  }

  /**
   * Handle manage accounts request
   */
  private handleManageAccounts(): void {
    this.dispatchEvent(
      new CustomEvent('manage-accounts', {
        detail: { integrationType: 'gitlab' },
        bubbles: true,
        composed: true,
      })
    );
  }

  private async detectRepo(): Promise<void> {
    if (!this.repositoryPath) return;

    const result = await gitService.detectGitLabRepo(this.repositoryPath);
    if (result.success && result.data) {
      this.detectedRepo = result.data;
      this.instanceUrlInput = result.data.instanceUrl;
      if (this.connectionStatus?.connected) {
        await this.loadAllData();
      }
    }
  }

  private async loadAllData(): Promise<void> {
    await Promise.all([
      this.loadMergeRequests(),
      this.loadIssues(),
      this.loadPipelines(),
      this.loadLabels(),
    ]);
  }

  private async loadMergeRequests(): Promise<void> {
    if (!this.detectedRepo || !this.connectionStatus?.connected) return;

    this.isLoading = true;
    this.error = null;

    try {
      const result = await gitService.listGitLabMergeRequests(
        this.detectedRepo.instanceUrl,
        this.detectedRepo.projectPath,
        this.mrFilter === 'all' ? undefined : this.mrFilter
      );

      if (result.success && result.data) {
        this.mergeRequests = result.data;
      } else {
        this.error = result.error?.message ?? 'Failed to load merge requests';
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load merge requests';
    } finally {
      this.isLoading = false;
    }
  }

  private async loadIssues(): Promise<void> {
    if (!this.detectedRepo || !this.connectionStatus?.connected) return;

    try {
      const result = await gitService.listGitLabIssues(
        this.detectedRepo.instanceUrl,
        this.detectedRepo.projectPath,
        this.issueFilter === 'all' ? undefined : this.issueFilter
      );

      if (result.success && result.data) {
        this.issues = result.data;
      }
    } catch {
      // Silent fail
    }
  }

  private async loadPipelines(): Promise<void> {
    if (!this.detectedRepo || !this.connectionStatus?.connected) return;

    try {
      const result = await gitService.listGitLabPipelines(
        this.detectedRepo.instanceUrl,
        this.detectedRepo.projectPath
      );

      if (result.success && result.data) {
        this.pipelines = result.data;
      }
    } catch {
      // Silent fail
    }
  }

  private async loadLabels(): Promise<void> {
    if (!this.detectedRepo || !this.connectionStatus?.connected) return;

    try {
      const result = await gitService.getGitLabLabels(
        this.detectedRepo.instanceUrl,
        this.detectedRepo.projectPath
      );

      if (result.success && result.data) {
        this.labels = result.data;
      }
    } catch {
      // Silent fail
    }
  }

  private async handleSaveToken(): Promise<void> {
    if (!this.tokenInput.trim() || !this.instanceUrlInput.trim()) return;

    this.isLoading = true;
    this.error = null;
    const tokenToSave = this.tokenInput.trim();
    const instanceUrl = this.instanceUrlInput.trim();

    try {
      // First verify the token works by checking connection
      const verifyResult = await gitService.checkGitLabConnectionWithToken(instanceUrl, tokenToSave);
      if (!verifyResult.success || !verifyResult.data?.connected) {
        this.error = verifyResult.error?.message ?? 'Invalid token or connection failed';
        return;
      }

      const user = verifyResult.data.user;
      const activeProfile = unifiedProfileStore.getState().activeProfile;

      // If we have a selected account, save token to that account
      if (this.selectedAccountId) {
        await credentialService.storeAccountToken('gitlab', this.selectedAccountId, tokenToSave);
      } else if (activeProfile) {
        // No account selected - create a new account in the active profile
        const { createEmptyGitLabProfileAccount, generateId } = await import('../../types/unified-profile.types.ts');
        const newAccount = {
          ...createEmptyGitLabProfileAccount(instanceUrl),
          id: generateId(),
          name: user?.username ? `GitLab (${user.username})` : 'GitLab Account',
          isDefaultForType: this.accounts.length === 0,
          cachedUser: user ? {
            username: user.username,
            displayName: user.name ?? null,
            email: null, // GitLab API doesn't return email in user object
            avatarUrl: user.avatarUrl ?? null,
          } : null,
        };

        const savedAccount = await unifiedProfileService.addAccountToProfile(activeProfile.id, newAccount);
        await credentialService.storeAccountToken('gitlab', savedAccount.id, tokenToSave);
        this.selectedAccountId = savedAccount.id;
      } else {
        // Fallback to legacy token storage if no profile
        await gitService.storeGitLabToken(tokenToSave);
      }

      // Token saved, update state
      this.tokenInput = '';
      this.connectionStatus = verifyResult.data;

      // Load data if connected and repo detected
      if (this.connectionStatus?.connected && this.detectedRepo) {
        await this.loadAllData();
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to connect';
      this.tokenInput = tokenToSave;
    } finally {
      this.isLoading = false;
    }
  }

  private async handleDisconnect(): Promise<void> {
    this.isLoading = true;

    try {
      // Delete token for selected account or legacy token
      if (this.selectedAccountId) {
        await credentialService.deleteAccountToken('gitlab', this.selectedAccountId);
      } else {
        await gitService.deleteGitLabToken();
      }

      this.connectionStatus = null;
      this.mergeRequests = [];
      this.issues = [];
      this.pipelines = [];
    } finally {
      this.isLoading = false;
    }
  }

  private async handleMrFilterChange(e: Event): Promise<void> {
    this.mrFilter = (e.target as HTMLSelectElement).value as 'opened' | 'merged' | 'closed' | 'all';
    await this.loadMergeRequests();
  }

  private async handleIssueFilterChange(e: Event): Promise<void> {
    this.issueFilter = (e.target as HTMLSelectElement).value as 'opened' | 'closed' | 'all';
    await this.loadIssues();
  }

  private async handleCreateMr(): Promise<void> {
    if (!this.detectedRepo || !this.createMrTitle.trim() || !this.createMrSource.trim() || !this.createMrTarget.trim()) return;

    this.isLoading = true;
    this.error = null;

    try {
      const input: CreateMergeRequestInput = {
        title: this.createMrTitle,
        description: this.createMrDescription || undefined,
        sourceBranch: this.createMrSource,
        targetBranch: this.createMrTarget,
        draft: this.createMrDraft,
      };

      const result = await gitService.createGitLabMergeRequest(
        this.detectedRepo.instanceUrl,
        this.detectedRepo.projectPath,
        input
      );

      if (result.success && result.data) {
        this.createMrTitle = '';
        this.createMrDescription = '';
        this.createMrSource = '';
        this.createMrTarget = '';
        this.createMrDraft = false;
        this.activeTab = 'merge-requests';
        await this.loadMergeRequests();
      } else {
        this.error = result.error?.message ?? 'Failed to create merge request';
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to create merge request';
    } finally {
      this.isLoading = false;
    }
  }

  private async handleCreateIssue(): Promise<void> {
    if (!this.detectedRepo || !this.createIssueTitle.trim()) return;

    this.isLoading = true;
    this.error = null;

    try {
      const input: CreateGitLabIssueInput = {
        title: this.createIssueTitle,
        description: this.createIssueDescription || undefined,
        labels: this.createIssueLabels.length > 0 ? this.createIssueLabels : undefined,
      };

      const result = await gitService.createGitLabIssue(
        this.detectedRepo.instanceUrl,
        this.detectedRepo.projectPath,
        input
      );

      if (result.success && result.data) {
        this.createIssueTitle = '';
        this.createIssueDescription = '';
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

  private handleClose(): void {
    this.dispatchEvent(new CustomEvent('close'));
  }

  private openInBrowser(url: string): void {
    openExternalUrl(url);
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

  private getInitials(name: string): string {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  }

  private renderConnectionTab() {
    if (this.connectionStatus?.connected && this.connectionStatus.user) {
      const user = this.connectionStatus.user;
      return html`
        <div class="connection-status">
          ${user.avatarUrl
            ? html`<img class="avatar" src="${user.avatarUrl}" alt="${user.username}" />`
            : html`<div class="user-avatar-placeholder">${this.getInitials(user.name)}</div>`
          }
          <div class="user-info">
            <div class="user-name">${user.name}</div>
            <div class="user-login">@${user.username}</div>
          </div>
          <button class="btn btn-danger" @click=${this.handleDisconnect} ?disabled=${this.isLoading}>
            Disconnect
          </button>
        </div>
      `;
    }

    return html`
      <div class="token-form">
        <div class="form-group">
          <label>GitLab Instance URL</label>
          <input
            type="text"
            placeholder="https://gitlab.com"
            .value=${this.instanceUrlInput}
            @input=${(e: Event) => this.instanceUrlInput = (e.target as HTMLInputElement).value}
          />
          <span class="help-text">
            Use https://gitlab.com for GitLab.com or your self-hosted instance URL
          </span>
        </div>
        <div class="form-group">
          <label>Personal Access Token</label>
          <input
            type="password"
            placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
            .value=${this.tokenInput}
            @input=${(e: Event) => this.tokenInput = (e.target as HTMLInputElement).value}
          />
          <span class="help-text">
            Create a token at
            <a
              class="help-link"
              href="${this.instanceUrlInput}/-/user_settings/personal_access_tokens"
              @click=${handleExternalLink}
            >GitLab Settings</a>
            with <code>api</code> scope.
          </span>
        </div>
        <div class="btn-row">
          <button
            class="btn btn-primary"
            @click=${this.handleSaveToken}
            ?disabled=${this.isLoading || !this.tokenInput.trim() || !this.instanceUrlInput.trim()}
          >
            Connect to GitLab
          </button>
        </div>
      </div>
    `;
  }

  private renderMergeRequestsTab() {
    if (!this.connectionStatus?.connected) {
      return this.renderNotConnected('merge requests');
    }

    if (!this.detectedRepo) {
      return this.renderNoRepo();
    }

    return html`
      <div class="filter-row">
        <select class="filter-select" @change=${this.handleMrFilterChange}>
          <option value="opened" ?selected=${this.mrFilter === 'opened'}>Open</option>
          <option value="merged" ?selected=${this.mrFilter === 'merged'}>Merged</option>
          <option value="closed" ?selected=${this.mrFilter === 'closed'}>Closed</option>
          <option value="all" ?selected=${this.mrFilter === 'all'}>All</option>
        </select>
        <button class="btn" @click=${() => this.activeTab = 'create-mr'}>
          + New MR
        </button>
      </div>

      ${this.isLoading ? html`<div class="loading">Loading merge requests...</div>` : ''}

      ${!this.isLoading && this.mergeRequests.length === 0 ? html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="18" cy="18" r="3"></circle>
            <circle cx="6" cy="6" r="3"></circle>
            <path d="M6 21V9a9 9 0 0 0 9 9"></path>
          </svg>
          <p>No ${this.mrFilter} merge requests</p>
        </div>
      ` : ''}

      <div class="mr-list">
        ${this.mergeRequests.map(mr => html`
          <div class="mr-item" @click=${() => this.openInBrowser(mr.webUrl)}>
            <span class="mr-number">!${mr.iid}</span>
            <div class="mr-info">
              <div class="mr-title">${mr.title}</div>
              <div class="mr-meta">
                <span class="mr-state ${mr.draft ? 'draft' : mr.state}">${mr.draft ? 'Draft' : mr.state}</span>
                <span class="mr-branch">${mr.sourceBranch} → ${mr.targetBranch}</span>
                <span>by ${mr.author.name}</span>
                <span>${this.formatDate(mr.createdAt)}</span>
              </div>
            </div>
          </div>
        `)}
      </div>
    `;
  }

  private renderIssuesTab() {
    if (!this.connectionStatus?.connected) {
      return this.renderNotConnected('issues');
    }

    if (!this.detectedRepo) {
      return this.renderNoRepo();
    }

    return html`
      <div class="filter-row">
        <select class="filter-select" @change=${this.handleIssueFilterChange}>
          <option value="opened" ?selected=${this.issueFilter === 'opened'}>Open</option>
          <option value="closed" ?selected=${this.issueFilter === 'closed'}>Closed</option>
          <option value="all" ?selected=${this.issueFilter === 'all'}>All</option>
        </select>
        <button class="btn" @click=${() => this.activeTab = 'create-issue'}>
          + New Issue
        </button>
      </div>

      ${this.issues.length === 0 ? html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p>No ${this.issueFilter} issues</p>
        </div>
      ` : ''}

      <div class="issue-list">
        ${this.issues.map(issue => html`
          <div class="issue-item" @click=${() => this.openInBrowser(issue.webUrl)}>
            <span class="issue-number">#${issue.iid}</span>
            <div class="issue-info">
              <div class="issue-title">${issue.title}</div>
              <div class="issue-meta">
                <span class="issue-state ${issue.state}">${issue.state}</span>
                <span>by ${issue.author.name}</span>
                <span>${this.formatDate(issue.createdAt)}</span>
              </div>
              ${issue.labels.length > 0 ? html`
                <div class="issue-labels">
                  ${issue.labels.map(label => html`
                    <span class="issue-label">${label}</span>
                  `)}
                </div>
              ` : ''}
            </div>
          </div>
        `)}
      </div>
    `;
  }

  private renderPipelinesTab() {
    if (!this.connectionStatus?.connected) {
      return this.renderNotConnected('pipelines');
    }

    if (!this.detectedRepo) {
      return this.renderNoRepo();
    }

    if (this.pipelines.length === 0) {
      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
          </svg>
          <p>No pipelines found</p>
        </div>
      `;
    }

    return html`
      <div class="pipeline-list">
        ${this.pipelines.map(pipeline => html`
          <div class="pipeline-item" @click=${() => this.openInBrowser(pipeline.webUrl)}>
            <div class="pipeline-status ${pipeline.status}"></div>
            <div class="pipeline-info">
              <div class="pipeline-ref">${pipeline.ref}</div>
              <div class="pipeline-meta">
                <span>#${pipeline.iid}</span>
                <span>${pipeline.status}</span>
                <span>${this.formatDate(pipeline.createdAt)}</span>
                <span>${pipeline.sha.substring(0, 8)}</span>
              </div>
            </div>
          </div>
        `)}
      </div>
    `;
  }

  private renderCreateMrTab() {
    return html`
      <div class="token-form">
        <div class="form-group">
          <label>Title</label>
          <input
            type="text"
            placeholder="Merge request title"
            .value=${this.createMrTitle}
            @input=${(e: Event) => this.createMrTitle = (e.target as HTMLInputElement).value}
          />
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea
            placeholder="Describe your changes..."
            .value=${this.createMrDescription}
            @input=${(e: Event) => this.createMrDescription = (e.target as HTMLTextAreaElement).value}
          ></textarea>
        </div>
        <div class="form-group">
          <label>Source Branch</label>
          <input
            type="text"
            placeholder="feature/my-branch"
            .value=${this.createMrSource}
            @input=${(e: Event) => this.createMrSource = (e.target as HTMLInputElement).value}
          />
        </div>
        <div class="form-group">
          <label>Target Branch</label>
          <input
            type="text"
            placeholder="main"
            .value=${this.createMrTarget}
            @input=${(e: Event) => this.createMrTarget = (e.target as HTMLInputElement).value}
          />
        </div>
        <div class="form-group">
          <div class="checkbox-group">
            <input
              type="checkbox"
              id="mr-draft"
              .checked=${this.createMrDraft}
              @change=${(e: Event) => this.createMrDraft = (e.target as HTMLInputElement).checked}
            />
            <label for="mr-draft">Create as draft</label>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn" @click=${() => this.activeTab = 'merge-requests'}>
            Cancel
          </button>
          <button
            class="btn btn-primary"
            @click=${this.handleCreateMr}
            ?disabled=${this.isLoading || !this.createMrTitle.trim() || !this.createMrSource.trim() || !this.createMrTarget.trim()}
          >
            Create Merge Request
          </button>
        </div>
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
            .value=${this.createIssueDescription}
            @input=${(e: Event) => this.createIssueDescription = (e.target as HTMLTextAreaElement).value}
          ></textarea>
        </div>
        <div class="btn-row">
          <button class="btn" @click=${() => this.activeTab = 'issues'}>
            Cancel
          </button>
          <button
            class="btn btn-primary"
            @click=${this.handleCreateIssue}
            ?disabled=${this.isLoading || !this.createIssueTitle.trim()}
          >
            Create Issue
          </button>
        </div>
      </div>
    `;
  }

  private renderNotConnected(feature: string) {
    return html`
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
        </svg>
        <p>Connect to GitLab to view ${feature}</p>
      </div>
    `;
  }

  private renderNoRepo() {
    return html`
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        <p>No GitLab repository detected</p>
      </div>
    `;
  }

  private renderDetectedRepo() {
    if (!this.detectedRepo) return '';

    return html`
      <div class="detected-repo">
        <svg class="repo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
        <div>
          <div class="repo-name">${this.detectedRepo.projectPath}</div>
          <div class="repo-remote">${this.detectedRepo.instanceUrl} via ${this.detectedRepo.remoteName}</div>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <lv-modal
        .open=${this.open}
        title="GitLab"
        @close=${this.handleClose}
      >
        <div class="content">
          ${this.renderDetectedRepo()}

          ${this.accounts.length > 0 || this.connectionStatus?.connected ? html`
            <lv-account-selector
              integrationType="gitlab"
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
              class="tab ${this.activeTab === 'merge-requests' ? 'active' : ''}"
              @click=${() => { this.activeTab = 'merge-requests'; this.loadMergeRequests(); }}
            >
              Merge Requests
            </button>
            <button
              class="tab ${this.activeTab === 'issues' ? 'active' : ''}"
              @click=${() => { this.activeTab = 'issues'; this.loadIssues(); }}
            >
              Issues
            </button>
            <button
              class="tab ${this.activeTab === 'pipelines' ? 'active' : ''}"
              @click=${() => { this.activeTab = 'pipelines'; this.loadPipelines(); }}
            >
              Pipelines
            </button>
          </div>

          ${this.error ? html`<div class="error">${this.error}</div>` : ''}

          <div class="tab-content">
            ${this.activeTab === 'connection' ? this.renderConnectionTab() : ''}
            ${this.activeTab === 'merge-requests' ? this.renderMergeRequestsTab() : ''}
            ${this.activeTab === 'issues' ? this.renderIssuesTab() : ''}
            ${this.activeTab === 'pipelines' ? this.renderPipelinesTab() : ''}
            ${this.activeTab === 'create-mr' ? this.renderCreateMrTab() : ''}
            ${this.activeTab === 'create-issue' ? this.renderCreateIssueTab() : ''}
          </div>
        </div>
      </lv-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-gitlab-dialog': LvGitLabDialog;
  }
}
