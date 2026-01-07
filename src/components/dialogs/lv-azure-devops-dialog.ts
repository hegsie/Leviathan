/**
 * Azure DevOps Integration Dialog
 * Manage Azure DevOps connection, view PRs, work items, and pipelines
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import { loggers, openExternalUrl, handleExternalLink } from '../../utils/index.ts';

const log = loggers.azureDevOps;
import type {
  AdoConnectionStatus,
  DetectedAdoRepo,
  AdoPullRequest,
  AdoWorkItem,
  AdoPipelineRun,
  CreateAdoPullRequestInput,
} from '../../services/git.service.ts';
import { unifiedProfileStore, getAccountsByType, getDefaultGlobalAccount, getAccountById } from '../../stores/unified-profile.store.ts';
import * as unifiedProfileService from '../../services/unified-profile.service.ts';
import type { IntegrationAccount } from '../../types/unified-profile.types.ts';
import * as credentialService from '../../services/credential.service.ts';
import './lv-modal.ts';
import './lv-account-selector.ts';

type TabType = 'connection' | 'pull-requests' | 'work-items' | 'pipelines' | 'create-pr';

@customElement('lv-azure-devops-dialog')
export class LvAzureDevOpsDialog extends LitElement {
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

      .user-avatar {
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

      .user-org {
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

      .pr-state.active {
        background: var(--color-success-bg);
        color: var(--color-success);
      }

      .pr-state.completed {
        background: #8250df20;
        color: #8250df;
      }

      .pr-state.abandoned {
        background: var(--color-error-bg);
        color: var(--color-error);
      }

      .pr-state.draft {
        background: var(--color-bg-hover);
        color: var(--color-text-muted);
      }

      /* Work Item styles */
      .work-item {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background var(--transition-fast);
      }

      .work-item:hover {
        background: var(--color-bg-hover);
      }

      .work-item-id {
        font-weight: var(--font-weight-semibold);
        color: var(--color-primary);
        min-width: 50px;
      }

      .work-item-info {
        flex: 1;
        min-width: 0;
      }

      .work-item-title {
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        margin-bottom: var(--spacing-xs);
      }

      .work-item-meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .work-item-type {
        padding: 2px 8px;
        border-radius: var(--radius-full);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
      }

      .work-item-type.bug {
        background: var(--color-error-bg);
        color: var(--color-error);
      }

      .work-item-type.task {
        background: var(--color-warning-bg);
        color: var(--color-warning);
      }

      .work-item-type.user-story {
        background: var(--color-success-bg);
        color: var(--color-success);
      }

      .work-item-type.feature {
        background: #8250df20;
        color: #8250df;
      }

      .work-item-state {
        padding: 2px 8px;
        border-radius: var(--radius-full);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        background: var(--color-bg-hover);
        color: var(--color-text-secondary);
      }

      /* Pipeline styles */
      .pipeline-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
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

      .pipeline-status.succeeded {
        background: var(--color-success);
      }

      .pipeline-status.failed {
        background: var(--color-error);
      }

      .pipeline-status.inProgress,
      .pipeline-status.notStarted {
        background: var(--color-warning);
        animation: pulse 2s infinite;
      }

      .pipeline-status.canceled {
        background: var(--color-text-muted);
      }

      .pipeline-info {
        flex: 1;
        min-width: 0;
      }

      .pipeline-name {
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
      }

      .pipeline-meta {
        display: flex;
        gap: var(--spacing-sm);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .pipeline-branch {
        font-family: var(--font-family-mono);
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      /* Detected Repo */
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

      /* Utility */
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

      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        transition: all var(--transition-fast);
        background: var(--color-bg-tertiary);
        color: var(--color-text-primary);
        border: 1px solid var(--color-border);
      }

      .btn:hover:not(:disabled) {
        background: var(--color-bg-hover);
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-primary {
        background: var(--color-primary);
        color: white;
        border-color: var(--color-primary);
      }

      .btn-primary:hover:not(:disabled) {
        background: var(--color-primary-hover);
      }

      .btn-danger {
        background: var(--color-error);
        color: white;
        border-color: var(--color-error);
      }

      .btn-danger:hover:not(:disabled) {
        opacity: 0.9;
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
  @state() private connectionStatus: AdoConnectionStatus | null = null;
  @state() private detectedRepo: DetectedAdoRepo | null = null;
  @state() private pullRequests: AdoPullRequest[] = [];
  @state() private workItems: AdoWorkItem[] = [];
  @state() private pipelineRuns: AdoPipelineRun[] = [];
  @state() private isLoading = false;
  @state() private error: string | null = null;
  @state() private tokenInput = '';
  @state() private organizationInput = '';
  @state() private hasStoredToken = false;
  @state() private prFilter: 'active' | 'completed' | 'abandoned' | 'all' = 'active';
  @state() private workItemFilter: string = '';

  // Multi-account support (global accounts)
  @state() private accounts: IntegrationAccount[] = [];
  @state() private selectedAccountId: string | null = null;

  private unsubscribeStore?: () => void;

  // Create PR form
  @state() private createPrTitle = '';
  @state() private createPrDescription = '';
  @state() private createPrSource = '';
  @state() private createPrTarget = '';
  @state() private createPrDraft = false;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();

    // Subscribe to unified profile store - get global accounts
    this.unsubscribeStore = unifiedProfileStore.subscribe(() => {
      this.accounts = getAccountsByType('azure-devops');
      // If no account selected, try to select the default one
      if (!this.selectedAccountId && this.accounts.length > 0) {
        const defaultAccount = getDefaultGlobalAccount('azure-devops');
        const account = defaultAccount ?? this.accounts[0];
        if (account) {
          this.selectedAccountId = account.id;
          // Update organization from account config
          if (account.config.type === 'azure-devops' && account.config.organization) {
            this.organizationInput = account.config.organization;
          }
        }
      }
    });

    // Initialize from current state
    this.accounts = getAccountsByType('azure-devops');
    if (this.accounts.length > 0 && !this.selectedAccountId) {
      const defaultAccount = getDefaultGlobalAccount('azure-devops');
      const account = defaultAccount ?? this.accounts[0];
      if (account) {
        this.selectedAccountId = account.id;
        if (account.config.type === 'azure-devops' && account.config.organization) {
          this.organizationInput = account.config.organization;
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

      // Load the profile for this repository to set activeProfile
      if (this.repositoryPath) {
        await unifiedProfileService.loadUnifiedProfileForRepository(this.repositoryPath);
      }

      // Re-sync local state with store after loading
      this.accounts = getAccountsByType('azure-devops');
      if (this.accounts.length > 0 && !this.selectedAccountId) {
        const defaultAccount = getDefaultGlobalAccount('azure-devops');
        this.selectedAccountId = defaultAccount?.id ?? this.accounts[0]?.id ?? null;
      }

      // Check if selected account has a stored token
      await this.checkStoredToken();

      // Try to detect repo first to get organization
      if (this.repositoryPath) {
        await this.detectRepo();
      }
      // Check connection if we have an organization
      if (this.detectedRepo?.organization || this.organizationInput) {
        await this.checkConnection();
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load data';
    } finally {
      this.isLoading = false;
    }
  }

  private async checkStoredToken(): Promise<void> {
    log.debug('checkStoredToken called, selectedAccountId:', this.selectedAccountId);
    if (this.selectedAccountId) {
      // First check account-specific token
      let token = await credentialService.getAccountToken('azure-devops', this.selectedAccountId);
      log.debug('Account-specific token found:', !!token);

      // If not found, check legacy token and migrate it
      if (!token) {
        const legacyToken = await credentialService.AzureDevOpsCredentials.getToken();
        log.debug('Legacy token found:', !!legacyToken);
        if (legacyToken) {
          await credentialService.storeAccountToken('azure-devops', this.selectedAccountId, legacyToken);
          token = legacyToken;
        }
      }

      this.hasStoredToken = !!token;
      log.debug('hasStoredToken set to:', this.hasStoredToken);
    } else {
      this.hasStoredToken = false;
      log.debug('No selectedAccountId, hasStoredToken = false');
    }
  }

  private async checkConnection(): Promise<void> {
    const org = this.detectedRepo?.organization || this.organizationInput;
    if (!org) return;

    // Get token for selected account (or legacy token if no account)
    const token = await this.getSelectedAccountToken();
    const result = await gitService.checkAdoConnectionWithToken(org, token);
    if (result.success && result.data) {
      this.connectionStatus = result.data;
      // Update cached user in global account if connected
      if (this.selectedAccountId && result.data.connected && result.data.user) {
        await unifiedProfileService.updateGlobalAccountCachedUser(this.selectedAccountId, {
          username: result.data.user.displayName,
          displayName: result.data.user.displayName,
          email: null, // ADO API doesn't return email in this context
          avatarUrl: result.data.user.imageUrl ?? null,
        });
      }

      // Ensure git credentials are stored in keyring for push/pull operations
      // This handles the case where token was previously stored only in Stronghold
      if (result.data.connected && token && org) {
        try {
          // Store for both dev.azure.com and {org}.visualstudio.com formats
          // Username must be non-empty for macOS Keychain - use 'pat' as a placeholder
          await gitService.storeGitCredentials('https://dev.azure.com', 'pat', token);
          await gitService.storeGitCredentials(`https://${org}.visualstudio.com`, 'pat', token);
          log.debug(`Synced git credentials to keyring for dev.azure.com and ${org}.visualstudio.com`);
        } catch (err) {
          console.warn('[AzureDevOps] Failed to sync git credentials to keyring:', err);
        }
      }
    }
  }

  /**
   * Get the token for the currently selected account
   */
  private async getSelectedAccountToken(): Promise<string | null> {
    log.debug('getSelectedAccountToken called, selectedAccountId:', this.selectedAccountId);
    if (this.selectedAccountId) {
      const token = await credentialService.getAccountToken('azure-devops', this.selectedAccountId);
      log.debug('getSelectedAccountToken result:', !!token);
      return token;
    }
    log.debug('getSelectedAccountToken: no selectedAccountId');
    return null;
  }

  /**
   * Handle account selection change
   */
  private async handleAccountChange(e: CustomEvent<{ account: IntegrationAccount }>): Promise<void> {
    const { account } = e.detail;
    this.selectedAccountId = account.id;
    this.connectionStatus = null;
    this.error = null;
    this.tokenInput = ''; // Clear any manually entered token

    // Update organization from account config
    if (account.config.type === 'azure-devops' && account.config.organization) {
      this.organizationInput = account.config.organization;
    }

    // Check if this account has a stored token
    await this.checkStoredToken();

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
        detail: { integrationType: 'azure-devops' },
        bubbles: true,
        composed: true,
      })
    );
  }

  private async detectRepo(): Promise<void> {
    if (!this.repositoryPath) return;

    const result = await gitService.detectAdoRepo(this.repositoryPath);
    if (result.success && result.data) {
      this.detectedRepo = result.data;
      this.organizationInput = result.data.organization;
      // Auto-load data if connected
      if (this.connectionStatus?.connected) {
        await this.loadAllData();
      }
    }
  }

  private async loadAllData(providedToken?: string): Promise<void> {
    await Promise.all([
      this.loadPullRequests(providedToken),
      this.loadWorkItems(providedToken),
      this.loadPipelineRuns(providedToken),
    ]);
  }

  private async loadPullRequests(providedToken?: string): Promise<void> {
    if (!this.detectedRepo || !this.connectionStatus?.connected) return;

    this.isLoading = true;
    this.error = null;

    try {
      const token = providedToken ?? await this.getSelectedAccountToken();
      const result = await gitService.listAdoPullRequests(
        this.detectedRepo.organization,
        this.detectedRepo.project,
        this.detectedRepo.repository,
        this.prFilter === 'all' ? undefined : this.prFilter,
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

  private async loadWorkItems(providedToken?: string): Promise<void> {
    if (!this.detectedRepo || !this.connectionStatus?.connected) return;

    try {
      const token = providedToken ?? await this.getSelectedAccountToken();
      const result = await gitService.queryAdoWorkItems(
        this.detectedRepo.organization,
        this.detectedRepo.project,
        this.workItemFilter || undefined,
        token
      );

      if (result.success && result.data) {
        this.workItems = result.data;
      }
    } catch {
      // Silent fail for work items
    }
  }

  private async loadPipelineRuns(providedToken?: string): Promise<void> {
    if (!this.detectedRepo || !this.connectionStatus?.connected) return;

    try {
      const token = providedToken ?? await this.getSelectedAccountToken();
      const result = await gitService.listAdoPipelineRuns(
        this.detectedRepo.organization,
        this.detectedRepo.project,
        20,
        token
      );

      if (result.success && result.data) {
        this.pipelineRuns = result.data;
      }
    } catch {
      // Silent fail for pipelines
    }
  }

  private async handleConnectWithStoredToken(): Promise<void> {
    if (!this.organizationInput.trim()) return;

    this.isLoading = true;
    this.error = null;

    try {
      // If user entered a new token, save it first
      if (this.tokenInput.trim()) {
        await this.handleSaveToken();
        return;
      }

      // Otherwise use the stored token
      const token = await this.getSelectedAccountToken();
      if (!token) {
        this.error = 'No stored token found';
        return;
      }

      const organization = this.organizationInput.trim();

      // Verify the stored token works
      const verifyResult = await gitService.checkAdoConnectionWithToken(organization, token);
      if (!verifyResult.success || !verifyResult.data?.connected) {
        this.error = verifyResult.error?.message ?? 'Connection failed - token may have expired';
        return;
      }

      this.connectionStatus = verifyResult.data;

      // Update cached user if we got user info
      if (this.selectedAccountId && verifyResult.data.user) {
        await unifiedProfileService.updateGlobalAccountCachedUser(this.selectedAccountId, {
          username: verifyResult.data.user.displayName,
          displayName: verifyResult.data.user.displayName,
          email: null,
          avatarUrl: verifyResult.data.user.imageUrl ?? null,
        });
      }

      // Sync git credentials
      await gitService.storeGitCredentials('https://dev.azure.com', 'pat', token);
      await gitService.storeGitCredentials(`https://${organization}.visualstudio.com`, 'pat', token);

      // Load data if connected and repo detected
      if (this.connectionStatus?.connected && this.detectedRepo) {
        await this.loadAllData(token);
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to connect';
    } finally {
      this.isLoading = false;
    }
  }

  private async handleSaveToken(): Promise<void> {
    if (!this.tokenInput.trim() || !this.organizationInput.trim()) return;

    this.isLoading = true;
    this.error = null;
    const tokenToSave = this.tokenInput.trim();
    const organization = this.organizationInput.trim();

    try {
      log.debug('handleSaveToken: verifying token for org:', organization, 'token length:', tokenToSave.length);
      // First verify the token works by checking connection
      // Add timeout because Tauri IPC can hang on Windows
      let verifyResult;
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timed out - please try again')), 15000)
        );
        verifyResult = await Promise.race([
          gitService.checkAdoConnectionWithToken(organization, tokenToSave),
          timeoutPromise
        ]);
      } catch (ipcError) {
        log.error('handleSaveToken: IPC error:', ipcError);
        this.error = `Connection failed: ${ipcError instanceof Error ? ipcError.message : String(ipcError)}`;
        this.isLoading = false;
        return;
      }
      log.debug('handleSaveToken: verifyResult:', verifyResult);
      if (!verifyResult.success || !verifyResult.data?.connected) {
        this.error = verifyResult.error?.message ?? 'Invalid token or connection failed';
        this.isLoading = false;
        return;
      }

      const user = verifyResult.data.user;

      // If we have a selected account, save token to that account
      if (this.selectedAccountId) {
        await credentialService.storeAccountToken('azure-devops', this.selectedAccountId, tokenToSave);
      } else {
        // No account selected - create a new global account
        const { createEmptyIntegrationAccount, generateId } = await import('../../types/unified-profile.types.ts');
        const newAccount: IntegrationAccount = {
          ...createEmptyIntegrationAccount('azure-devops', organization),
          id: generateId(),
          name: user?.displayName ? `Azure DevOps (${user.displayName})` : `Azure DevOps (${organization})`,
          isDefault: this.accounts.length === 0,
          cachedUser: user ? {
            username: user.displayName,
            displayName: user.displayName,
            email: null, // ADO API doesn't return email in this context
            avatarUrl: user.imageUrl ?? null,
          } : null,
        };

        const savedAccount = await unifiedProfileService.saveGlobalAccount(newAccount);
        await credentialService.storeAccountToken('azure-devops', savedAccount.id, tokenToSave);
        this.selectedAccountId = savedAccount.id;

        // Refresh accounts list
        await unifiedProfileService.loadUnifiedProfiles();
        this.accounts = getAccountsByType('azure-devops');
      }

      // Token saved, update state
      this.tokenInput = '';
      this.connectionStatus = verifyResult.data;

      // Store git credentials in keyring for push/pull operations
      // Username must be non-empty for macOS Keychain - use 'pat' as a placeholder
      // Store for both dev.azure.com and {org}.visualstudio.com formats
      await gitService.storeGitCredentials('https://dev.azure.com', 'pat', tokenToSave);
      await gitService.storeGitCredentials(`https://${organization}.visualstudio.com`, 'pat', tokenToSave);
      log.debug(`Stored git credentials in keyring for dev.azure.com and ${organization}.visualstudio.com`);

      // Load data if connected and repo detected
      // Pass the token directly since storage might not be ready yet
      if (this.connectionStatus?.connected && this.detectedRepo) {
        await this.loadAllData(tokenToSave);
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
        await credentialService.deleteAccountToken('azure-devops', this.selectedAccountId);
      } else {
        await gitService.deleteAdoToken();
      }

      // Also delete git credentials from keyring for both URL formats
      await gitService.deleteGitCredentials('https://dev.azure.com');
      if (this.organizationInput) {
        await gitService.deleteGitCredentials(`https://${this.organizationInput}.visualstudio.com`);
      }
      log.debug('Deleted git credentials from keyring');

      this.connectionStatus = null;
      this.pullRequests = [];
      this.workItems = [];
      this.pipelineRuns = [];
    } finally {
      this.isLoading = false;
    }
  }

  private async handlePrFilterChange(e: Event): Promise<void> {
    this.prFilter = (e.target as HTMLSelectElement).value as 'active' | 'completed' | 'abandoned' | 'all';
    await this.loadPullRequests();
  }

  private async handleCreatePr(): Promise<void> {
    if (!this.detectedRepo || !this.createPrTitle.trim() || !this.createPrSource.trim() || !this.createPrTarget.trim()) return;

    this.isLoading = true;
    this.error = null;

    try {
      const input: CreateAdoPullRequestInput = {
        title: this.createPrTitle,
        description: this.createPrDescription || undefined,
        sourceRefName: this.createPrSource,
        targetRefName: this.createPrTarget,
        isDraft: this.createPrDraft,
      };

      const token = await this.getSelectedAccountToken();
      const result = await gitService.createAdoPullRequest(
        this.detectedRepo.organization,
        this.detectedRepo.project,
        this.detectedRepo.repository,
        input,
        token
      );

      if (result.success && result.data) {
        // Reset form and go back to list
        this.createPrTitle = '';
        this.createPrDescription = '';
        this.createPrSource = '';
        this.createPrTarget = '';
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

  private getWorkItemTypeClass(type: string): string {
    const lowerType = type.toLowerCase().replace(/\s+/g, '-');
    if (lowerType === 'bug') return 'bug';
    if (lowerType === 'task') return 'task';
    if (lowerType === 'user-story') return 'user-story';
    if (lowerType === 'feature') return 'feature';
    return '';
  }

  private renderConnectionTab() {
    if (this.connectionStatus?.connected && this.connectionStatus.user) {
      const user = this.connectionStatus.user;
      return html`
        <div class="connection-status">
          <div class="user-avatar">${this.getInitials(user.displayName)}</div>
          <div class="user-info">
            <div class="user-name">${user.displayName}</div>
            <div class="user-org">${this.connectionStatus.organization}</div>
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
          <label>Organization</label>
          <input
            type="text"
            placeholder="my-organization"
            .value=${this.organizationInput}
            @input=${(e: Event) => this.organizationInput = (e.target as HTMLInputElement).value}
          />
          <span class="help-text">
            Your Azure DevOps organization name (from dev.azure.com/{organization})
          </span>
        </div>

        <div class="form-group">
          <label>Personal Access Token</label>
          <input
            type="password"
            placeholder=${this.hasStoredToken ? '••••••••••••••••••••••••••••••••' : 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
            .value=${this.tokenInput}
            @input=${(e: Event) => this.tokenInput = (e.target as HTMLInputElement).value}
          />
          <span class="help-text">
            ${this.hasStoredToken
              ? html`Token saved securely. Enter a new token to update, or click Connect to use the saved token.`
              : html`Create a token at
                <a
                  class="help-link"
                  href="https://dev.azure.com/${this.organizationInput || '{org}'}/_usersSettings/tokens"
                  @click=${handleExternalLink}
                >Azure DevOps Settings</a>.
                Required scopes: <strong>Code (Read & Write)</strong>, <strong>Work Items (Read)</strong>, <strong>Build (Read)</strong>, and <strong>User Profile (Read)</strong>.`
            }
          </span>
        </div>
        <div class="btn-row">
          <button
            class="btn btn-primary"
            @click=${this.tokenInput.trim() ? this.handleSaveToken : this.handleConnectWithStoredToken}
            ?disabled=${this.isLoading || !this.organizationInput.trim() || (!this.tokenInput.trim() && !this.hasStoredToken)}
          >
            Connect
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
          <p>Connect to Azure DevOps to view pull requests</p>
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
          <p>No Azure DevOps repository detected</p>
        </div>
      `;
    }

    return html`
      <div class="filter-row">
        <select class="filter-select" @change=${this.handlePrFilterChange}>
          <option value="active" ?selected=${this.prFilter === 'active'}>Active</option>
          <option value="completed" ?selected=${this.prFilter === 'completed'}>Completed</option>
          <option value="abandoned" ?selected=${this.prFilter === 'abandoned'}>Abandoned</option>
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
          <div class="pr-item" @click=${() => this.openInBrowser(pr.url)}>
            <span class="pr-number">!${pr.pullRequestId}</span>
            <div class="pr-info">
              <div class="pr-title">${pr.title}</div>
              <div class="pr-meta">
                <span class="pr-state ${pr.isDraft ? 'draft' : pr.status}">${pr.isDraft ? 'Draft' : pr.status}</span>
                <span class="pr-branch">${pr.sourceRefName} → ${pr.targetRefName}</span>
                <span>by ${pr.createdBy.displayName}</span>
                <span>${this.formatDate(pr.creationDate)}</span>
              </div>
            </div>
          </div>
        `)}
      </div>
    `;
  }

  private renderWorkItemsTab() {
    if (!this.connectionStatus?.connected) {
      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
          </svg>
          <p>Connect to Azure DevOps to view work items</p>
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
          <p>No Azure DevOps repository detected</p>
        </div>
      `;
    }

    if (this.workItems.length === 0) {
      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 11l3 3L22 4"></path>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
          </svg>
          <p>No work items found</p>
        </div>
      `;
    }

    return html`
      <div class="pr-list">
        ${this.workItems.map(item => html`
          <div class="work-item" @click=${() => this.openInBrowser(item.url)}>
            <span class="work-item-id">#${item.id}</span>
            <div class="work-item-info">
              <div class="work-item-title">${item.title}</div>
              <div class="work-item-meta">
                <span class="work-item-type ${this.getWorkItemTypeClass(item.workItemType)}">${item.workItemType}</span>
                <span class="work-item-state">${item.state}</span>
                ${item.assignedTo ? html`<span>Assigned to ${item.assignedTo.displayName}</span>` : ''}
                <span>${this.formatDate(item.createdDate)}</span>
              </div>
            </div>
          </div>
        `)}
      </div>
    `;
  }

  private renderPipelinesTab() {
    if (!this.connectionStatus?.connected) {
      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
          </svg>
          <p>Connect to Azure DevOps to view pipelines</p>
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
          <p>No Azure DevOps repository detected</p>
        </div>
      `;
    }

    if (this.pipelineRuns.length === 0) {
      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
          </svg>
          <p>No pipeline runs found</p>
        </div>
      `;
    }

    return html`
      <div class="pipeline-list">
        ${this.pipelineRuns.map(run => html`
          <div class="pipeline-item" @click=${() => this.openInBrowser(run.url)}>
            <div class="pipeline-status ${run.result ?? run.state}"></div>
            <div class="pipeline-info">
              <div class="pipeline-name">${run.name}</div>
              <div class="pipeline-meta">
                <span class="pipeline-branch">${run.sourceBranch}</span>
                <span>${this.formatDate(run.createdDate)}</span>
                ${run.result ? html`<span>${run.result}</span>` : html`<span>${run.state}</span>`}
              </div>
            </div>
          </div>
        `)}
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
            .value=${this.createPrDescription}
            @input=${(e: Event) => this.createPrDescription = (e.target as HTMLTextAreaElement).value}
          ></textarea>
        </div>
        <div class="form-group">
          <label>Source Branch</label>
          <input
            type="text"
            placeholder="feature/my-branch"
            .value=${this.createPrSource}
            @input=${(e: Event) => this.createPrSource = (e.target as HTMLInputElement).value}
          />
        </div>
        <div class="form-group">
          <label>Target Branch</label>
          <input
            type="text"
            placeholder="main"
            .value=${this.createPrTarget}
            @input=${(e: Event) => this.createPrTarget = (e.target as HTMLInputElement).value}
          />
        </div>
        <div class="form-group">
          <div class="checkbox-group">
            <input
              type="checkbox"
              id="pr-draft"
              .checked=${this.createPrDraft}
              @change=${(e: Event) => this.createPrDraft = (e.target as HTMLInputElement).checked}
            />
            <label for="pr-draft">Create as draft</label>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn" @click=${() => this.activeTab = 'pull-requests'}>
            Cancel
          </button>
          <button
            class="btn btn-primary"
            @click=${this.handleCreatePr}
            ?disabled=${this.isLoading || !this.createPrTitle.trim() || !this.createPrSource.trim() || !this.createPrTarget.trim()}
          >
            Create Pull Request
          </button>
        </div>
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
          <div class="repo-name">${decodeURIComponent(this.detectedRepo.organization)}/${decodeURIComponent(this.detectedRepo.project)}/${decodeURIComponent(this.detectedRepo.repository)}</div>
          <div class="repo-remote">via ${this.detectedRepo.remoteName}</div>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <lv-modal
        .open=${this.open}
        title="Azure DevOps"
        @close=${this.handleClose}
      >
        <div class="content">
          ${this.renderDetectedRepo()}

          ${this.accounts.length > 0 || this.connectionStatus?.connected ? html`
            <lv-account-selector
              integrationType="azure-devops"
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
              @click=${() => { this.activeTab = 'pull-requests'; this.loadPullRequests(); }}
            >
              Pull Requests
            </button>
            <button
              class="tab ${this.activeTab === 'work-items' ? 'active' : ''}"
              @click=${() => { this.activeTab = 'work-items'; this.loadWorkItems(); }}
            >
              Work Items
            </button>
            <button
              class="tab ${this.activeTab === 'pipelines' ? 'active' : ''}"
              @click=${() => { this.activeTab = 'pipelines'; this.loadPipelineRuns(); }}
            >
              Pipelines
            </button>
          </div>

          ${this.error ? html`<div class="error">${this.error}</div>` : ''}

          <div class="tab-content">
            ${this.activeTab === 'connection' ? this.renderConnectionTab() : ''}
            ${this.activeTab === 'pull-requests' ? this.renderPullRequestsTab() : ''}
            ${this.activeTab === 'work-items' ? this.renderWorkItemsTab() : ''}
            ${this.activeTab === 'pipelines' ? this.renderPipelinesTab() : ''}
            ${this.activeTab === 'create-pr' ? this.renderCreatePrTab() : ''}
          </div>
        </div>
      </lv-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-azure-devops-dialog': LvAzureDevOpsDialog;
  }
}
