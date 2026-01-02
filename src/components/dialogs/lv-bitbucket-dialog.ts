/**
 * Bitbucket Integration Dialog
 * Manage Bitbucket connection, view PRs, issues, and pipelines
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import { openExternalUrl, handleExternalLink } from '../../utils/index.ts';
import type {
  BitbucketConnectionStatus,
  DetectedBitbucketRepo,
  BitbucketPullRequest,
  BitbucketIssue,
  BitbucketPipeline,
  CreateBitbucketPullRequestInput,
} from '../../services/git.service.ts';
import './lv-modal.ts';

type TabType = 'connection' | 'pull-requests' | 'issues' | 'pipelines' | 'create-pr';

@customElement('lv-bitbucket-dialog')
export class LvBitbucketDialog extends LitElement {
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
        background: #0052cc;
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

      .pr-list, .issue-list, .pipeline-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .pr-item, .issue-item {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background var(--transition-fast);
      }

      .pr-item:hover, .issue-item:hover {
        background: var(--color-bg-hover);
      }

      .pr-number, .issue-number {
        font-weight: var(--font-weight-semibold);
        color: var(--color-primary);
        min-width: 50px;
      }

      .pr-info, .issue-info {
        flex: 1;
        min-width: 0;
      }

      .pr-title, .issue-title {
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        margin-bottom: var(--spacing-xs);
      }

      .pr-meta, .issue-meta {
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

      .pr-state, .issue-state {
        padding: 2px 8px;
        border-radius: var(--radius-full);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
      }

      .pr-state.OPEN, .issue-state.open {
        background: var(--color-success-bg);
        color: var(--color-success);
      }

      .pr-state.MERGED {
        background: #8250df20;
        color: #8250df;
      }

      .pr-state.DECLINED, .issue-state.closed, .issue-state.resolved {
        background: var(--color-error-bg);
        color: var(--color-error);
      }

      .issue-kind {
        padding: 2px 8px;
        border-radius: var(--radius-full);
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

      .pipeline-status.SUCCESSFUL {
        background: var(--color-success);
      }

      .pipeline-status.FAILED {
        background: var(--color-error);
      }

      .pipeline-status.IN_PROGRESS, .pipeline-status.PENDING {
        background: var(--color-warning);
        animation: pulse 2s infinite;
      }

      .pipeline-status.STOPPED {
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
  @state() private connectionStatus: BitbucketConnectionStatus | null = null;
  @state() private detectedRepo: DetectedBitbucketRepo | null = null;
  @state() private pullRequests: BitbucketPullRequest[] = [];
  @state() private issues: BitbucketIssue[] = [];
  @state() private pipelines: BitbucketPipeline[] = [];
  @state() private isLoading = false;
  @state() private error: string | null = null;
  @state() private usernameInput = '';
  @state() private appPasswordInput = '';
  @state() private prFilter: 'OPEN' | 'MERGED' | 'DECLINED' = 'OPEN';

  // Create PR form
  @state() private createPrTitle = '';
  @state() private createPrDescription = '';
  @state() private createPrSource = '';
  @state() private createPrDestination = '';
  @state() private createPrCloseSource = false;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    if (this.open) {
      await this.loadInitialData();
    }
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
    const result = await gitService.checkBitbucketConnection();
    if (result.success && result.data) {
      this.connectionStatus = result.data;
    }
  }

  private async detectRepo(): Promise<void> {
    if (!this.repositoryPath) return;

    const result = await gitService.detectBitbucketRepo(this.repositoryPath);
    if (result.success && result.data) {
      this.detectedRepo = result.data;
      if (this.connectionStatus?.connected) {
        await this.loadAllData();
      }
    }
  }

  private async loadAllData(): Promise<void> {
    await Promise.all([
      this.loadPullRequests(),
      this.loadIssues(),
      this.loadPipelines(),
    ]);
  }

  private async loadPullRequests(): Promise<void> {
    if (!this.detectedRepo || !this.connectionStatus?.connected) return;

    this.isLoading = true;
    this.error = null;

    try {
      const result = await gitService.listBitbucketPullRequests(
        this.detectedRepo.workspace,
        this.detectedRepo.repoSlug,
        this.prFilter
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

  private async loadIssues(): Promise<void> {
    if (!this.detectedRepo || !this.connectionStatus?.connected) return;

    try {
      const result = await gitService.listBitbucketIssues(
        this.detectedRepo.workspace,
        this.detectedRepo.repoSlug
      );

      if (result.success && result.data) {
        this.issues = result.data;
      }
    } catch {
      // Silent fail - issues might not be enabled
    }
  }

  private async loadPipelines(): Promise<void> {
    if (!this.detectedRepo || !this.connectionStatus?.connected) return;

    try {
      const result = await gitService.listBitbucketPipelines(
        this.detectedRepo.workspace,
        this.detectedRepo.repoSlug
      );

      if (result.success && result.data) {
        this.pipelines = result.data;
      }
    } catch {
      // Silent fail - pipelines might not be enabled
    }
  }

  private async handleSaveCredentials(): Promise<void> {
    if (!this.usernameInput.trim() || !this.appPasswordInput.trim()) return;

    this.isLoading = true;
    this.error = null;

    try {
      const storeResult = await gitService.storeBitbucketCredentials(
        this.usernameInput,
        this.appPasswordInput
      );
      if (!storeResult.success) {
        this.error = storeResult.error?.message ?? 'Failed to save credentials';
        return;
      }

      await this.checkConnection();

      if (this.connectionStatus?.connected) {
        this.usernameInput = '';
        this.appPasswordInput = '';
        if (this.detectedRepo) {
          await this.loadAllData();
        }
      } else {
        this.error = 'Failed to connect. Please check your credentials.';
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to connect';
    } finally {
      this.isLoading = false;
    }
  }

  private async handleDisconnect(): Promise<void> {
    this.isLoading = true;

    try {
      await gitService.deleteBitbucketCredentials();
      this.connectionStatus = null;
      this.pullRequests = [];
      this.issues = [];
      this.pipelines = [];
    } finally {
      this.isLoading = false;
    }
  }

  private async handlePrFilterChange(e: Event): Promise<void> {
    this.prFilter = (e.target as HTMLSelectElement).value as 'OPEN' | 'MERGED' | 'DECLINED';
    await this.loadPullRequests();
  }

  private async handleCreatePr(): Promise<void> {
    if (!this.detectedRepo || !this.createPrTitle.trim() || !this.createPrSource.trim() || !this.createPrDestination.trim()) return;

    this.isLoading = true;
    this.error = null;

    try {
      const input: CreateBitbucketPullRequestInput = {
        title: this.createPrTitle,
        description: this.createPrDescription || undefined,
        sourceBranch: this.createPrSource,
        destinationBranch: this.createPrDestination,
        closeSourceBranch: this.createPrCloseSource,
      };

      const result = await gitService.createBitbucketPullRequest(
        this.detectedRepo.workspace,
        this.detectedRepo.repoSlug,
        input
      );

      if (result.success && result.data) {
        this.createPrTitle = '';
        this.createPrDescription = '';
        this.createPrSource = '';
        this.createPrDestination = '';
        this.createPrCloseSource = false;
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

  private renderConnectionTab() {
    if (this.connectionStatus?.connected && this.connectionStatus.user) {
      const user = this.connectionStatus.user;
      return html`
        <div class="connection-status">
          ${user.avatarUrl
            ? html`<img class="avatar" src="${user.avatarUrl}" alt="${user.username}" />`
            : html`<div class="user-avatar-placeholder">${this.getInitials(user.displayName)}</div>`
          }
          <div class="user-info">
            <div class="user-name">${user.displayName}</div>
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
          <label>Bitbucket Username</label>
          <input
            type="text"
            placeholder="your-username"
            .value=${this.usernameInput}
            @input=${(e: Event) => this.usernameInput = (e.target as HTMLInputElement).value}
          />
        </div>
        <div class="form-group">
          <label>App Password</label>
          <input
            type="password"
            placeholder="xxxx-xxxx-xxxx-xxxx"
            .value=${this.appPasswordInput}
            @input=${(e: Event) => this.appPasswordInput = (e.target as HTMLInputElement).value}
          />
          <span class="help-text">
            Create an app password at
            <a
              class="help-link"
              href="https://bitbucket.org/account/settings/app-passwords/"
              @click=${handleExternalLink}
            >Bitbucket Settings</a>
            with <code>Repositories: Read/Write</code> and <code>Pull requests: Read/Write</code> permissions.
          </span>
        </div>
        <div class="btn-row">
          <button
            class="btn btn-primary"
            @click=${this.handleSaveCredentials}
            ?disabled=${this.isLoading || !this.usernameInput.trim() || !this.appPasswordInput.trim()}
          >
            Connect to Bitbucket
          </button>
        </div>
      </div>
    `;
  }

  private renderPullRequestsTab() {
    if (!this.connectionStatus?.connected) {
      return this.renderNotConnected('pull requests');
    }

    if (!this.detectedRepo) {
      return this.renderNoRepo();
    }

    return html`
      <div class="filter-row">
        <select class="filter-select" @change=${this.handlePrFilterChange}>
          <option value="OPEN" ?selected=${this.prFilter === 'OPEN'}>Open</option>
          <option value="MERGED" ?selected=${this.prFilter === 'MERGED'}>Merged</option>
          <option value="DECLINED" ?selected=${this.prFilter === 'DECLINED'}>Declined</option>
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
          <p>No ${this.prFilter.toLowerCase()} pull requests</p>
        </div>
      ` : ''}

      <div class="pr-list">
        ${this.pullRequests.map(pr => html`
          <div class="pr-item" @click=${() => this.openInBrowser(pr.url)}>
            <span class="pr-number">#${pr.id}</span>
            <div class="pr-info">
              <div class="pr-title">${pr.title}</div>
              <div class="pr-meta">
                <span class="pr-state ${pr.state}">${pr.state}</span>
                <span class="pr-branch">${pr.sourceBranch} → ${pr.destinationBranch}</span>
                <span>by ${pr.author.displayName}</span>
                <span>${this.formatDate(pr.createdOn)}</span>
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

    if (this.issues.length === 0) {
      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p>No issues found (or issue tracker not enabled)</p>
        </div>
      `;
    }

    return html`
      <div class="issue-list">
        ${this.issues.map(issue => html`
          <div class="issue-item" @click=${() => this.openInBrowser(issue.url)}>
            <span class="issue-number">#${issue.id}</span>
            <div class="issue-info">
              <div class="issue-title">${issue.title}</div>
              <div class="issue-meta">
                <span class="issue-state ${issue.state}">${issue.state}</span>
                <span class="issue-kind">${issue.kind}</span>
                <span>${issue.priority}</span>
                ${issue.reporter ? html`<span>by ${issue.reporter.displayName}</span>` : ''}
                <span>${this.formatDate(issue.createdOn)}</span>
              </div>
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
          <p>No pipelines found (or Pipelines not enabled)</p>
        </div>
      `;
    }

    return html`
      <div class="pipeline-list">
        ${this.pipelines.map(pipeline => html`
          <div class="pipeline-item" @click=${() => this.openInBrowser(pipeline.url)}>
            <div class="pipeline-status ${pipeline.resultName ?? pipeline.stateName}"></div>
            <div class="pipeline-info">
              <div class="pipeline-name">#${pipeline.buildNumber}</div>
              <div class="pipeline-meta">
                <span class="pipeline-branch">${pipeline.targetBranch}</span>
                <span>${pipeline.resultName ?? pipeline.stateName}</span>
                <span>${this.formatDate(pipeline.createdOn)}</span>
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
          <label>Destination Branch</label>
          <input
            type="text"
            placeholder="main"
            .value=${this.createPrDestination}
            @input=${(e: Event) => this.createPrDestination = (e.target as HTMLInputElement).value}
          />
        </div>
        <div class="form-group">
          <div class="checkbox-group">
            <input
              type="checkbox"
              id="pr-close-source"
              .checked=${this.createPrCloseSource}
              @change=${(e: Event) => this.createPrCloseSource = (e.target as HTMLInputElement).checked}
            />
            <label for="pr-close-source">Close source branch after merge</label>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn" @click=${() => this.activeTab = 'pull-requests'}>
            Cancel
          </button>
          <button
            class="btn btn-primary"
            @click=${this.handleCreatePr}
            ?disabled=${this.isLoading || !this.createPrTitle.trim() || !this.createPrSource.trim() || !this.createPrDestination.trim()}
          >
            Create Pull Request
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
        <p>Connect to Bitbucket to view ${feature}</p>
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
        <p>No Bitbucket repository detected</p>
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
          <div class="repo-name">${this.detectedRepo.workspace}/${this.detectedRepo.repoSlug}</div>
          <div class="repo-remote">via ${this.detectedRepo.remoteName}</div>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <lv-modal
        .open=${this.open}
        title="Bitbucket"
        @close=${this.handleClose}
      >
        <div class="content">
          ${this.renderDetectedRepo()}

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
            ${this.activeTab === 'pull-requests' ? this.renderPullRequestsTab() : ''}
            ${this.activeTab === 'issues' ? this.renderIssuesTab() : ''}
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
    'lv-bitbucket-dialog': LvBitbucketDialog;
  }
}
