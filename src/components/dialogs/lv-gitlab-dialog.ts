/**
 * GitLab Integration Dialog
 * Manage GitLab connection, view MRs, issues, and pipelines
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import * as aiService from '../../services/ai.service.ts';
import { showToast } from '../../services/notification.service.ts';
import { showConfirm } from '../../services/dialog.service.ts';
import { loggers, openExternalUrl, handleExternalLink } from '../../utils/index.ts';
import type {
  GitLabConnectionStatus,
  DetectedGitLabRepo,
  GitLabMergeRequest,
  GitLabIssue,
  GitLabPipeline,
  CreateMergeRequestInput,
  CreateGitLabIssueInput,
} from '../../services/git.service.ts';
import { unifiedProfileStore, getAccountsByType, selectDefaultGlobalAccount, getAccountById, getActiveProfilePreferredAccount } from '../../stores/unified-profile.store.ts';
import * as unifiedProfileService from '../../services/unified-profile.service.ts';
import type { IntegrationAccount } from '../../types/unified-profile.types.ts';
import * as credentialService from '../../services/credential.service.ts';
import * as oauthService from '../../services/oauth.service.ts';
import { getClientId, isOAuthConfigured } from '../../services/oauth.service.ts';
import type { OAuthFlowState, OAuthTokenResponse } from '../../types/oauth.types.ts';
import './lv-modal.ts';
import './lv-account-selector.ts';

const log = loggers.gitlab;

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

      .btn-danger-outline {
        background: transparent;
        color: var(--color-error);
        border-color: var(--color-error);
      }

      .btn-danger-outline:hover:not(:disabled) {
        background: var(--color-error);
        color: white;
      }

      .connection-actions {
        display: flex;
        gap: var(--spacing-sm);
        margin-left: auto;
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

      /* OAuth styles */
      .auth-method-toggle {
        display: flex;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-md);
      }

      .auth-method-toggle .btn {
        flex: 1;
        justify-content: center;
      }

      .auth-method-toggle .btn.active {
        background: var(--color-primary);
        border-color: var(--color-primary);
        color: white;
      }

      .btn-oauth {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
        width: 100%;
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .btn-oauth:hover:not(:disabled) {
        background: var(--color-bg-hover);
        border-color: var(--color-primary);
      }

      .btn-oauth:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .btn-oauth svg {
        width: 20px;
        height: 20px;
      }

      .oauth-spinner {
        width: 20px;
        height: 20px;
        border: 2px solid var(--color-border);
        border-top-color: var(--color-primary);
        border-radius: 50%;
        animation: oauth-spin 0.8s linear infinite;
      }

      @keyframes oauth-spin {
        to { transform: rotate(360deg); }
      }

      .oauth-status {
        text-align: center;
        padding: var(--spacing-md);
        color: var(--color-text-secondary);
        font-size: var(--font-size-sm);
      }

      .oauth-status.error {
        color: var(--color-error);
      }

      .oauth-divider {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        margin: var(--spacing-md) 0;
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
      }

      .oauth-divider::before,
      .oauth-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--color-border);
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: String }) repositoryPath = '';
  /**
   * Show a back arrow instead of a close ×. Set explicitly by the host ONLY when
   * this dialog was opened with a return target (the profile manager).
   */
  @property({ type: Boolean }) backButton = false;
  /** Profile name for the "Adding to <name>" breadcrumb; empty when standalone. */
  @property({ type: String }) attachToProfileName = '';

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

  // Multi-account support (global accounts)
  @state() private accounts: IntegrationAccount[] = [];
  @state() private selectedAccountId: string | null = null;

  // OAuth state
  @state() private authMethod: 'oauth' | 'pat' = 'oauth';
  @state() private oauthState: OAuthFlowState = { status: 'idle' };

  private unsubscribeStore?: () => void;
  private oauthCompleteHandler?: EventListener;
  private oauthStateUnsubscribe?: () => void;
  private loadGeneration = 0;
  // Set while the user is mid-"Add account" (selection intentionally cleared so
  // the next save creates a NEW account). Guards the store subscription from
  // re-selecting an existing account on a background emit.
  private isAddingAccount = false;

  // Create MR form
  @state() private createMrTitle = '';
  @state() private createMrDescription = '';
  @state() private createMrSource = '';
  @state() private createMrTarget = '';
  @state() private createMrDraft = false;
  @state() private generatingMrDescription = false;

  // Create Issue form
  @state() private createIssueTitle = '';
  @state() private createIssueDescription = '';
  @state() private createIssueLabels: string[] = [];

  async connectedCallback(): Promise<void> {
    super.connectedCallback();

    // Set up OAuth event listeners
    this.oauthCompleteHandler = ((e: CustomEvent<{ provider: string; tokens: OAuthTokenResponse; instanceUrl?: string }>) => {
      if (e.detail.provider === 'gitlab') {
        this.handleOAuthComplete(e.detail.tokens, e.detail.instanceUrl);
      }
    }) as unknown as EventListener;
    window.addEventListener('oauth-complete', this.oauthCompleteHandler);

    this.oauthStateUnsubscribe = oauthService.onOAuthStateChange((state) => {
      if (state.provider === 'gitlab') {
        this.oauthState = state;
        // A failed/denied sign-in clears the pending spinner — surface the error
        // so the user isn't left with no feedback (matches the other providers).
        if (state.status === 'error') {
          this.error = state.error ?? 'GitLab sign-in failed';
          showToast(this.error, 'error');
        }
      }
    });

    // Subscribe to unified profile store. When the active profile changes,
    // re-derive the preferred account so a profile switch is reflected here.
    let lastActiveProfileId = unifiedProfileStore.getState().activeProfile?.id ?? null;
    const applyAccount = (account: IntegrationAccount | undefined) => {
      if (!account) return;
      this.selectedAccountId = account.id;
      if (account.config.type === 'gitlab' && account.config.instanceUrl) {
        this.instanceUrlInput = account.config.instanceUrl;
      }
    };
    this.unsubscribeStore = unifiedProfileStore.subscribe((state) => {
      this.accounts = getAccountsByType('gitlab');
      if (this.selectedAccountId && !this.accounts.some(a => a.id === this.selectedAccountId)) {
        this.selectedAccountId = null;
      }
      const activeProfileId = state.activeProfile?.id ?? null;
      if (activeProfileId !== lastActiveProfileId) {
        // Track the id either way so this doesn't re-fire, but DON'T clobber a
        // half-completed "Add account" flow (a background store emit must not
        // re-select an existing account, or the next save overwrites it).
        lastActiveProfileId = activeProfileId;
        if (!this.isAddingAccount) {
          applyAccount(getActiveProfilePreferredAccount('gitlab') ?? this.accounts[0]);
        }
      } else if (!this.isAddingAccount && !this.selectedAccountId && this.accounts.length > 0) {
        applyAccount(
          getActiveProfilePreferredAccount('gitlab') ?? selectDefaultGlobalAccount('gitlab') ?? this.accounts[0],
        );
      }
    });

    // Initialize from current state
    this.accounts = getAccountsByType('gitlab');
    if (this.accounts.length > 0 && !this.selectedAccountId) {
      applyAccount(
        getActiveProfilePreferredAccount('gitlab') ?? selectDefaultGlobalAccount('gitlab') ?? this.accounts[0],
      );
    }

    if (this.open) {
      await this.loadInitialData();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeStore?.();

    // Clean up OAuth listeners
    if (this.oauthCompleteHandler) {
      window.removeEventListener('oauth-complete', this.oauthCompleteHandler);
    }
    this.oauthStateUnsubscribe?.();
  }

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('open') && this.open) {
      // Fresh open: clear selectedAccountId so loadInitialData() re-derives
      // it from the current active profile's preferred account.
      this.selectedAccountId = null;
      await this.loadInitialData();
    }
    if (changedProperties.has('repositoryPath') && this.repositoryPath && this.open) {
      await this.detectRepo();
    }
  }

  private async loadInitialData(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.isLoading = true;
    this.error = null;

    try {
      // Ensure unified profiles are loaded
      await unifiedProfileService.loadUnifiedProfiles();
      if (generation !== this.loadGeneration) return;

      // Load the profile for this repository to set activeProfile
      if (this.repositoryPath) {
        await unifiedProfileService.loadUnifiedProfileForRepository(this.repositoryPath);
        if (generation !== this.loadGeneration) return;
      }

      // Re-sync local state with store after loading. Auto-derive only when
      // nothing is selected (fresh open clears selectedAccountId in updated()).
      // Manual switches set selectedAccountId before calling loadInitialData()
      // and must not be overwritten.
      this.accounts = getAccountsByType('gitlab');
      if (this.accounts.length > 0 && !this.selectedAccountId) {
        const preferred = getActiveProfilePreferredAccount('gitlab')
          ?? selectDefaultGlobalAccount('gitlab');
        this.selectedAccountId = preferred?.id ?? this.accounts[0]?.id ?? null;
        if (preferred?.config.type === 'gitlab' && preferred.config.instanceUrl) {
          this.instanceUrlInput = preferred.config.instanceUrl;
        }
      }

      if (this.repositoryPath) {
        await this.detectRepo();
        if (generation !== this.loadGeneration) return;
      }
      if (this.detectedRepo?.instanceUrl || this.instanceUrlInput) {
        await this.checkConnection();
      }
    } catch (err) {
      if (generation !== this.loadGeneration) return;
      this.error = err instanceof Error ? err.message : 'Failed to load data';
    } finally {
      if (generation === this.loadGeneration) {
        this.isLoading = false;
      }
    }
  }

  /**
   * Mirror a verified connection result into the shared unified-profile store so
   * other views (e.g. the profile manager's status dots) reflect it immediately.
   */
  private syncSharedConnectionStatus(connected: boolean): void {
    if (this.selectedAccountId) {
      unifiedProfileStore
        .getState()
        .setAccountConnectionStatus(this.selectedAccountId, connected ? 'connected' : 'disconnected');
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
      this.syncSharedConnectionStatus(result.data.connected);
      // Update cached user in global account if connected
      if (this.selectedAccountId && result.data.connected && result.data.user) {
        await unifiedProfileService.updateGlobalAccountCachedUser(this.selectedAccountId, {
          username: result.data.user.username,
          displayName: result.data.user.name ?? null,
          email: null, // GitLab API doesn't return email in user object
          avatarUrl: result.data.user.avatarUrl ?? null,
        });
      }
    } else {
      // Failed check must mark the account as disconnected so dependent UI
      // surfaces (toolbar, account selector dot) don't keep showing a stale
      // "connected" state for a now-invalid token.
      this.connectionStatus = { connected: false, user: null, instanceUrl };
      this.syncSharedConnectionStatus(false);
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
  private async handleAccountChange(e: CustomEvent<{ account: IntegrationAccount }>): Promise<void> {
    const { account } = e.detail;
    // The user explicitly selected an existing account — re-enable the
    // subscription's auto-apply branch.
    this.isAddingAccount = false;
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
    // Clear selection so the next token save creates a new account instead of
    // overwriting the previously-selected account's token.
    this.isAddingAccount = true;
    this.activeTab = 'connection';
    this.connectionStatus = null;
    this.selectedAccountId = null;
    this.tokenInput = '';
  }

  /**
   * Handle manage accounts request
   */
  private handleManageAccounts(e: Event): void {
    // Consume the account-selector's bubbling/composed event so it can't ALSO
    // reach the host — otherwise the host would receive both it and our re-dispatch
    // below, firing its handler twice (the second pass corrupts reversible-Back state).
    e.stopPropagation();
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
    } else if (!result.success) {
      // A genuine backend failure (not merely "this isn't a GitLab repo", which
      // surfaces as success with null data) must not fail silently.
      this.error = result.error?.message ?? 'Failed to detect GitLab repository';
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
      const token = await this.getSelectedAccountToken();
      const result = await gitService.listGitLabMergeRequests(
        this.detectedRepo.instanceUrl,
        this.detectedRepo.projectPath,
        this.mrFilter === 'all' ? undefined : this.mrFilter,
        token
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
      const token = await this.getSelectedAccountToken();
      const result = await gitService.listGitLabIssues(
        this.detectedRepo.instanceUrl,
        this.detectedRepo.projectPath,
        this.issueFilter === 'all' ? undefined : this.issueFilter,
        undefined, // labels
        token
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
      const token = await this.getSelectedAccountToken();
      const result = await gitService.listGitLabPipelines(
        this.detectedRepo.instanceUrl,
        this.detectedRepo.projectPath,
        undefined, // status
        token
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
      const token = await this.getSelectedAccountToken();
      const result = await gitService.getGitLabLabels(
        this.detectedRepo.instanceUrl,
        this.detectedRepo.projectPath,
        token
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

      // If we have a selected account, save token to that account
      if (this.selectedAccountId) {
        await credentialService.storeAccountToken('gitlab', this.selectedAccountId, tokenToSave);
        // Refresh cachedUser so the profile manager shows the up-to-date
        // avatar/username immediately instead of waiting for background validation.
        if (user) {
          await unifiedProfileService.updateGlobalAccountCachedUser(this.selectedAccountId, {
            username: user.username,
            displayName: user.name ?? null,
            email: null, // GitLab API doesn't return email in user object
            avatarUrl: user.avatarUrl ?? null,
          });
        }
      } else {
        // No account selected - create a new global account
        const { createEmptyIntegrationAccount, generateId } = await import('../../types/unified-profile.types.ts');
        const newAccount: IntegrationAccount = {
          ...createEmptyIntegrationAccount('gitlab', instanceUrl),
          id: generateId(),
          name: user?.username ? `GitLab (${user.username})` : 'GitLab Account',
          isDefault: this.accounts.length === 0,
          cachedUser: user ? {
            username: user.username,
            displayName: user.name ?? null,
            email: null, // GitLab API doesn't return email in user object
            avatarUrl: user.avatarUrl ?? null,
          } : null,
        };

        const savedAccount = await unifiedProfileService.saveGlobalAccount(newAccount);
        await credentialService.storeAccountToken('gitlab', savedAccount.id, tokenToSave);
        this.selectedAccountId = savedAccount.id;
        // The new account now exists and is selected — the add flow is complete.
        this.isAddingAccount = false;

        // Refresh accounts list
        await unifiedProfileService.loadUnifiedProfiles();
        this.accounts = getAccountsByType('gitlab');
      }

      // Token saved, update state
      this.tokenInput = '';
      this.connectionStatus = verifyResult.data;
      this.syncSharedConnectionStatus(true);

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
    this.error = null;

    try {
      // Delete token for selected account or legacy token
      if (this.selectedAccountId) {
        await credentialService.deleteAccountToken('gitlab', this.selectedAccountId);
      } else {
        await gitService.deleteGitLabToken();
      }

      this.syncSharedConnectionStatus(false);
      this.connectionStatus = null;
      this.mergeRequests = [];
      this.issues = [];
      this.pipelines = [];
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to disconnect';
      showToast(this.error, 'error');
    } finally {
      this.isLoading = false;
    }
  }

  private async handleDeleteIntegration(): Promise<void> {
    if (!this.selectedAccountId) return;

    const selected = this.accounts.find((a) => a.id === this.selectedAccountId);
    const accountName = selected?.name ?? 'this account';
    const confirmed = await showConfirm(
      'Delete GitLab Integration',
      `Delete ${accountName}? The stored token will be removed and any profile that uses this account as its default will lose that reference.`,
      'warning',
    );
    if (!confirmed) return;

    this.isLoading = true;
    this.error = null;

    // M10: Delete the config/account record (the source of truth) FIRST so a
    // failure leaves the token intact but no zombie account. The keyring token
    // deletion is best-effort last; if it fails we surface a warning rather than
    // leaving a half-deleted state.
    const accountId = this.selectedAccountId;
    try {
      await unifiedProfileService.deleteGlobalAccount(accountId);

      await unifiedProfileService.loadUnifiedProfiles();
      this.accounts = getAccountsByType('gitlab');

      this.selectedAccountId = this.accounts.length > 0 ? this.accounts[0].id : null;
      this.connectionStatus = null;
      this.mergeRequests = [];
      this.issues = [];
      this.pipelines = [];

      // Best-effort token cleanup after the record is gone.
      try {
        await credentialService.deleteAccountToken('gitlab', accountId);
      } catch (tokenErr) {
        // M7/M10: surface partial failure instead of swallowing it.
        const msg =
          tokenErr instanceof Error
            ? `Account deleted, but its stored token could not be removed: ${tokenErr.message}`
            : 'Account deleted, but its stored token could not be removed.';
        this.error = msg;
        showToast(msg, 'error');
      }

      if (this.accounts.length > 0) {
        await this.loadInitialData();
      }
    } catch (err) {
      // M7: error path was previously console-only (silent). Surface to the user.
      const msg = err instanceof Error ? err.message : 'Failed to delete GitLab integration';
      this.error = msg;
      showToast(msg, 'error');
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Start OAuth flow for GitLab
   */
  private async handleStartOAuth(): Promise<void> {
    const clientId = getClientId('gitlab');
    if (!clientId) {
      this.error = 'GitLab OAuth is not configured. Please use a Personal Access Token.';
      this.authMethod = 'pat';
      return;
    }

    this.error = null;
    // Pass instance URL for self-hosted GitLab
    const instanceUrl = this.instanceUrlInput !== 'https://gitlab.com' ? this.instanceUrlInput : undefined;
    await oauthService.startOAuth('gitlab', clientId, instanceUrl);
  }

  /**
   * Handle OAuth completion
   */
  private async handleOAuthComplete(tokens: OAuthTokenResponse, instanceUrl?: string): Promise<void> {
    log.debug('handleOAuthComplete called', {
      hasAccessToken: !!tokens?.accessToken,
      instanceUrl,
      currentInstanceUrl: this.instanceUrlInput,
    });

    // OAuth can complete after the dialog was closed; still persist the account
    // but surface a toast instead of the (invisible) inline status.
    const wasOpen = this.open;

    this.isLoading = true;
    this.error = null;

    try {
      // Update instance URL if provided
      if (instanceUrl) {
        this.instanceUrlInput = instanceUrl;
      }

      log.debug('Verifying token', { instanceUrl: this.instanceUrlInput });

      // Verify the token works
      const verifyResult = await gitService.checkGitLabConnectionWithToken(
        this.instanceUrlInput,
        tokens.accessToken
      );

      log.debug('Token verification result', {
        success: verifyResult.success,
        connected: verifyResult.data?.connected,
        user: verifyResult.data?.user?.username,
      });

      if (!verifyResult.success || !verifyResult.data?.connected) {
        this.error = verifyResult.error?.message ?? 'OAuth token verification failed';
        return;
      }

      const user = verifyResult.data.user;

      log.debug('Account state', {
        selectedAccountId: this.selectedAccountId,
        accountsCount: this.accounts.length,
      });

      // Find existing account for this instance URL, or use selected account.
      // When the user explicitly chose "Add account", never match an existing
      // same-instance account — that would clobber it instead of creating the
      // new account they asked for (the common two-identities-on-gitlab.com case).
      const existingAccount = this.selectedAccountId
        ? getAccountById(this.selectedAccountId)
        : this.isAddingAccount
          ? undefined
          : this.accounts.find((a) =>
              a.config.type === 'gitlab' &&
              a.config.instanceUrl === this.instanceUrlInput
            );

      if (existingAccount) {
        // Update existing account with OAuth token
        log.debug('Updating existing account', { accountId: existingAccount.id });
        await credentialService.storeAccountOAuthToken(
          'gitlab',
          existingAccount.id,
          tokens.accessToken,
          tokens.refreshToken,
          tokens.expiresIn
        );

        // Update cached user info
        if (user) {
          await unifiedProfileService.updateGlobalAccountCachedUser(existingAccount.id, {
            username: user.username,
            displayName: user.name ?? null,
            email: null,
            avatarUrl: user.avatarUrl ?? null,
          });
        }

        this.selectedAccountId = existingAccount.id;
      } else {
        // Create new global account
        log.debug('Creating new global account');
        const { createEmptyIntegrationAccount, generateId } = await import('../../types/unified-profile.types.ts');
        const newAccount: IntegrationAccount = {
          ...createEmptyIntegrationAccount('gitlab', this.instanceUrlInput),
          id: generateId(),
          name: user?.username ? `GitLab (${user.username})` : 'GitLab Account',
          isDefault: this.accounts.length === 0,
          cachedUser: user ? {
            username: user.username,
            displayName: user.name ?? null,
            email: null,
            avatarUrl: user.avatarUrl ?? null,
          } : null,
        };

        log.debug('New account to create', { id: newAccount.id, name: newAccount.name });
        const savedAccount = await unifiedProfileService.saveGlobalAccount(newAccount);
        log.debug('Saved account', { id: savedAccount.id });
        await credentialService.storeAccountOAuthToken(
          'gitlab',
          savedAccount.id,
          tokens.accessToken,
          tokens.refreshToken,
          tokens.expiresIn
        );

        this.selectedAccountId = savedAccount.id;
        // The new account now exists and is selected — the add flow is complete.
        this.isAddingAccount = false;
        // Refresh accounts list
        await unifiedProfileService.loadUnifiedProfiles();
        this.accounts = getAccountsByType('gitlab');
        log.debug('Account created', { count: this.accounts.length });
      }

      // Force UI update
      this.requestUpdate();

      this.connectionStatus = verifyResult.data;
      // Mirror the verified status into the shared store so the profile
      // manager's status dots update immediately (matches checkConnection and
      // the GitHub/OIDC dialogs) instead of staying stale until restart.
      this.syncSharedConnectionStatus(true);
      this.oauthState = { status: 'idle' };

      // If the dialog was closed before OAuth completed, surface a toast so the
      // connection isn't a silent no-op.
      if (!wasOpen) {
        showToast(
          user?.username ? `Connected GitLab account @${user.username}` : 'Connected GitLab account',
          'success'
        );
      }

      // Load data if connected and repo detected
      if (wasOpen && this.connectionStatus?.connected && this.detectedRepo) {
        await this.loadAllData();
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to complete OAuth';
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

  private async handleGenerateMrDescription(): Promise<void> {
    if (!this.repositoryPath || !this.createMrSource || !this.createMrTarget) return;

    this.generatingMrDescription = true;
    const result = await aiService.generatePrDescription(
      this.repositoryPath,
      this.createMrTarget,
      this.createMrSource,
      this.createMrTitle || 'Untitled MR',
    );

    if (result.success && result.data) {
      this.createMrDescription = result.data.body;
    } else {
      showToast(result.error?.message ?? 'Failed to generate description', 'error');
    }

    this.generatingMrDescription = false;
  }

  private async handleCreateMr(): Promise<void> {
    if (!this.detectedRepo || !this.createMrTitle.trim() || !this.createMrSource.trim() || !this.createMrTarget.trim()) return;

    this.isLoading = true;
    this.error = null;

    try {
      const token = await this.getSelectedAccountToken();
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
        input,
        token
      );

      if (result.success && result.data) {
        this.createMrTitle = '';
        this.createMrDescription = '';
        this.createMrSource = '';
        this.createMrTarget = '';
        this.createMrDraft = false;
        this.activeTab = 'merge-requests';
        await this.loadMergeRequests();
        showToast('Merge request created successfully', 'success');
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
      const token = await this.getSelectedAccountToken();
      const input: CreateGitLabIssueInput = {
        title: this.createIssueTitle,
        description: this.createIssueDescription || undefined,
        labels: this.createIssueLabels.length > 0 ? this.createIssueLabels : undefined,
      };

      const result = await gitService.createGitLabIssue(
        this.detectedRepo.instanceUrl,
        this.detectedRepo.projectPath,
        input,
        token
      );

      if (result.success && result.data) {
        this.createIssueTitle = '';
        this.createIssueDescription = '';
        this.createIssueLabels = [];
        this.activeTab = 'issues';
        await this.loadIssues();
        showToast('Issue created successfully', 'success');
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
          <div class="connection-actions">
            <button class="btn btn-danger" @click=${this.handleDisconnect} ?disabled=${this.isLoading}>Disconnect</button>
            <button class="btn btn-danger-outline" @click=${this.handleDeleteIntegration} ?disabled=${this.isLoading}>Delete</button>
          </div>
        </div>
      `;
    }

    const isOAuthPending = this.oauthState.status === 'pending' || this.oauthState.status === 'exchanging';
    const oauthConfigured = isOAuthConfigured('gitlab');

    return html`
      <div class="token-form">
        <div class="form-group">
          <label>GitLab Instance URL</label>
          <input
            type="text"
            placeholder="https://gitlab.com"
            .value=${this.instanceUrlInput}
            @input=${(e: Event) => this.instanceUrlInput = (e.target as HTMLInputElement).value}
            ?disabled=${isOAuthPending}
          />
          <span class="help-text">
            Use https://gitlab.com for GitLab.com or your self-hosted instance URL
          </span>
        </div>

        ${oauthConfigured ? html`
          <div class="auth-method-toggle">
            <button
              class="btn ${this.authMethod === 'oauth' ? 'active' : ''}"
              @click=${() => this.authMethod = 'oauth'}
              ?disabled=${isOAuthPending}
            >
              Sign in with GitLab
            </button>
            <button
              class="btn ${this.authMethod === 'pat' ? 'active' : ''}"
              @click=${() => this.authMethod = 'pat'}
              ?disabled=${isOAuthPending}
            >
              Personal Access Token
            </button>
          </div>
        ` : ''}

        ${this.authMethod === 'oauth' && oauthConfigured ? html`
          <button
            class="btn-oauth"
            @click=${this.handleStartOAuth}
            ?disabled=${isOAuthPending || this.isLoading || !this.instanceUrlInput.trim()}
          >
            ${isOAuthPending ? html`
              <div class="oauth-spinner"></div>
              <span>${this.oauthState.status === 'exchanging' ? 'Completing sign in...' : 'Waiting for browser...'}</span>
            ` : html`
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.955 13.587l-1.342-4.135-2.664-8.189a.455.455 0 00-.867 0L16.418 9.45H7.582L4.918 1.263a.455.455 0 00-.867 0L1.387 9.452.045 13.587a.924.924 0 00.331 1.023L12 23.054l11.624-8.443a.92.92 0 00.331-1.024"/>
              </svg>
              <span>Sign in with GitLab</span>
            `}
          </button>

          ${this.oauthState.status === 'error' ? html`
            <div class="oauth-status error">${this.oauthState.error}</div>
          ` : ''}

          <div class="oauth-divider">or</div>
        ` : ''}

        <div class="form-group">
          <label>Personal Access Token</label>
          <input
            type="password"
            placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
            .value=${this.tokenInput}
            @input=${(e: Event) => this.tokenInput = (e.target as HTMLInputElement).value}
            ?disabled=${isOAuthPending}
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
          ${this.selectedAccountId ? html`
            <button
              class="btn btn-danger-outline"
              @click=${this.handleDeleteIntegration}
              ?disabled=${this.isLoading}
            >
              Delete Integration
            </button>
          ` : nothing}
          <button
            class="btn btn-primary"
            @click=${this.handleSaveToken}
            ?disabled=${this.isLoading || isOAuthPending || !this.tokenInput.trim() || !this.instanceUrlInput.trim()}
          >
            Connect with Token
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
          <div style="display:flex;align-items:center;justify-content:space-between">
            <label>Description</label>
            <button
              class="btn btn-sm"
              style="font-size:12px;padding:2px 8px;display:flex;align-items:center;gap:4px"
              @click=${this.handleGenerateMrDescription}
              ?disabled=${this.generatingMrDescription || !this.createMrSource || !this.createMrTarget}
              title="Generate description using AI"
            >
              ${this.generatingMrDescription ? 'Generating...' : html`<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a3.5 3.5 0 0 0-3.5 3.5c0 1.193.603 2.26 1.5 2.898V9.5a1 1 0 0 0 .293.707l1 1a1 1 0 0 0 1.414 0l1-1A1 1 0 0 0 10 9.5V7.398A3.496 3.496 0 0 0 11.5 4.5 3.5 3.5 0 0 0 8 1z"/></svg> AI Generate`}
            </button>
          </div>
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
        ?backButton=${this.backButton}
        modalTitle="GitLab"
        @close=${this.handleClose}
      >
        <div class="content">
          ${this.attachToProfileName
            ? html`<div class="attach-breadcrumb" data-testid="attach-breadcrumb">Adding to <strong>${this.attachToProfileName}</strong></div>`
            : nothing}
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
