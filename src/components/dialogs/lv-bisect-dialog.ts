/**
 * Bisect Dialog Component
 * Provides UI for git bisect binary search to find bug-introducing commits
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import type { BisectStatus, CulpritCommit } from '../../services/git.service.ts';
import type { Commit } from '../../types/git.types.ts';

type BisectStep = 'setup' | 'in-progress' | 'complete';

@customElement('lv-bisect-dialog')
export class LvBisectDialog extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      .dialog-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: var(--z-modal);
      }

      .dialog {
        background: var(--color-bg-primary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        width: 500px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: var(--shadow-xl);
      }

      .dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md);
        border-bottom: 1px solid var(--color-border);
      }

      .dialog-title {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .dialog-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-md);
      }

      .dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
        padding: var(--spacing-md);
        border-top: 1px solid var(--color-border);
      }

      .close-btn {
        background: none;
        border: none;
        padding: var(--spacing-xs);
        cursor: pointer;
        color: var(--color-text-secondary);
        border-radius: var(--radius-sm);
      }

      .close-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      /* Setup step */
      .setup-section {
        margin-bottom: var(--spacing-lg);
      }

      .setup-section h3 {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
        margin-bottom: var(--spacing-sm);
      }

      .commit-input-group {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .commit-input {
        display: flex;
        gap: var(--spacing-sm);
        align-items: center;
      }

      .commit-input input {
        flex: 1;
        padding: var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-family: var(--font-family-mono);
        font-size: var(--font-size-sm);
      }

      .commit-input input::placeholder {
        color: var(--color-text-muted);
      }

      .hint {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      /* In progress step */
      .progress-info {
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        margin-bottom: var(--spacing-md);
      }

      .progress-stats {
        display: flex;
        gap: var(--spacing-lg);
        margin-bottom: var(--spacing-sm);
      }

      .progress-stat {
        text-align: center;
      }

      .progress-stat-value {
        font-size: var(--font-size-xl);
        font-weight: var(--font-weight-bold);
        color: var(--color-primary);
      }

      .progress-stat-label {
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
      }

      .current-commit {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        margin-bottom: var(--spacing-md);
      }

      .current-commit-label {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: var(--spacing-xs);
      }

      .current-commit-oid {
        font-family: var(--font-family-mono);
        font-size: var(--font-size-sm);
        color: var(--color-primary);
        margin-bottom: var(--spacing-xs);
      }

      .current-commit-message {
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
      }

      .action-buttons {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: var(--spacing-sm);
      }

      .action-btn {
        padding: var(--spacing-md);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
        cursor: pointer;
        text-align: center;
        transition: all var(--transition-fast);
      }

      .action-btn:hover {
        background: var(--color-bg-hover);
      }

      .action-btn.good {
        border-color: var(--color-success);
      }

      .action-btn.good:hover {
        background: var(--color-success-bg);
      }

      .action-btn.bad {
        border-color: var(--color-error);
      }

      .action-btn.bad:hover {
        background: var(--color-error-bg);
      }

      .action-btn.skip {
        border-color: var(--color-warning);
      }

      .action-btn.skip:hover {
        background: rgba(245, 158, 11, 0.1);
      }

      .action-btn-icon {
        font-size: 24px;
        margin-bottom: var(--spacing-xs);
      }

      .action-btn-label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
      }

      /* Complete step */
      .culprit-card {
        background: var(--color-error-bg);
        border: 1px solid var(--color-error);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        margin-bottom: var(--spacing-md);
      }

      .culprit-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-sm);
      }

      .culprit-icon {
        width: 24px;
        height: 24px;
        color: var(--color-error);
      }

      .culprit-title {
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-semibold);
        color: var(--color-error);
      }

      .culprit-oid {
        font-family: var(--font-family-mono);
        font-size: var(--font-size-sm);
        color: var(--color-primary);
        margin-bottom: var(--spacing-xs);
      }

      .culprit-summary {
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
        margin-bottom: var(--spacing-sm);
      }

      .culprit-author {
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
      }

      /* Bisect log */
      .bisect-log {
        margin-top: var(--spacing-md);
      }

      .bisect-log-title {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
        margin-bottom: var(--spacing-sm);
      }

      .bisect-log-entries {
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        max-height: 150px;
        overflow-y: auto;
      }

      .bisect-log-entry {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs) var(--spacing-sm);
        font-size: var(--font-size-xs);
        font-family: var(--font-family-mono);
      }

      .bisect-log-entry:not(:last-child) {
        border-bottom: 1px solid var(--color-border);
      }

      .log-action {
        padding: 2px 6px;
        border-radius: var(--radius-xs);
        font-weight: var(--font-weight-medium);
      }

      .log-action.good {
        background: var(--color-success-bg);
        color: var(--color-success);
      }

      .log-action.bad {
        background: var(--color-error-bg);
        color: var(--color-error);
      }

      .log-action.skip {
        background: rgba(245, 158, 11, 0.1);
        color: rgb(245, 158, 11);
      }

      .log-oid {
        color: var(--color-text-secondary);
      }

      /* Buttons */
      .btn {
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .btn-secondary {
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        color: var(--color-text-primary);
      }

      .btn-secondary:hover {
        background: var(--color-bg-hover);
      }

      .btn-primary {
        background: var(--color-primary);
        border: 1px solid var(--color-primary);
        color: white;
      }

      .btn-primary:hover {
        background: var(--color-primary-hover);
      }

      .btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-danger {
        background: var(--color-error-bg);
        border: 1px solid var(--color-error);
        color: var(--color-error);
      }

      .btn-danger:hover {
        background: var(--color-error);
        color: white;
      }

      .message {
        padding: var(--spacing-sm);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);
        margin-bottom: var(--spacing-md);
      }

      .message.info {
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        color: var(--color-text-secondary);
      }

      .message.error {
        background: var(--color-error-bg);
        border: 1px solid var(--color-error);
        color: var(--color-error);
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-lg);
        color: var(--color-text-secondary);
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: String }) repositoryPath = '';

  @state() private step: BisectStep = 'setup';
  @state() private status: BisectStatus | null = null;
  @state() private culprit: CulpritCommit | null = null;
  @state() private badCommitInput = '';
  @state() private goodCommitInput = '';
  @state() private loading = false;
  @state() private error = '';
  @state() private message = '';
  @state() private currentCommitInfo: Commit | null = null;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    if (this.open) {
      await this.checkBisectStatus();
    }
  }

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('open') && this.open) {
      await this.checkBisectStatus();
    }
  }

  private async checkBisectStatus(): Promise<void> {
    this.loading = true;
    this.error = '';

    const result = await gitService.getBisectStatus(this.repositoryPath);

    if (result.success && result.data) {
      this.status = result.data;
      if (result.data.active) {
        this.step = 'in-progress';
        // Fetch current commit info
        if (result.data.currentCommit) {
          await this.fetchCurrentCommitInfo(result.data.currentCommit);
        }
      } else {
        this.step = 'setup';
        this.culprit = null;
      }
    } else {
      this.error = result.error?.message || 'Failed to get bisect status';
    }

    this.loading = false;
  }

  private async fetchCurrentCommitInfo(oid: string): Promise<void> {
    const result = await gitService.getCommit(oid);
    if (result.success && result.data) {
      this.currentCommitInfo = result.data;
    }
  }

  private async handleStart(): Promise<void> {
    if (!this.badCommitInput || !this.goodCommitInput) {
      this.error = 'Please provide both bad and good commit references';
      return;
    }

    this.loading = true;
    this.error = '';

    const result = await gitService.bisectStart(
      this.repositoryPath,
      this.badCommitInput,
      this.goodCommitInput
    );

    if (result.success && result.data) {
      this.status = result.data.status;
      this.message = result.data.message;

      if (result.data.status.active) {
        this.step = 'in-progress';
        if (result.data.status.currentCommit) {
          await this.fetchCurrentCommitInfo(result.data.status.currentCommit);
        }
      }
    } else {
      this.error = result.error?.message || 'Failed to start bisect';
    }

    this.loading = false;
  }

  private async handleBad(): Promise<void> {
    this.loading = true;
    this.error = '';

    const result = await gitService.bisectBad(this.repositoryPath);

    if (result.success && result.data) {
      this.status = result.data.status;
      this.message = result.data.message;

      if (result.data.culprit) {
        this.culprit = result.data.culprit;
        this.step = 'complete';
      } else if (result.data.status.currentCommit) {
        await this.fetchCurrentCommitInfo(result.data.status.currentCommit);
      }
    } else {
      this.error = result.error?.message || 'Failed to mark as bad';
    }

    this.loading = false;
    this.dispatchEvent(new CustomEvent('bisect-step'));
  }

  private async handleGood(): Promise<void> {
    this.loading = true;
    this.error = '';

    const result = await gitService.bisectGood(this.repositoryPath);

    if (result.success && result.data) {
      this.status = result.data.status;
      this.message = result.data.message;

      if (result.data.culprit) {
        this.culprit = result.data.culprit;
        this.step = 'complete';
      } else if (result.data.status.currentCommit) {
        await this.fetchCurrentCommitInfo(result.data.status.currentCommit);
      }
    } else {
      this.error = result.error?.message || 'Failed to mark as good';
    }

    this.loading = false;
    this.dispatchEvent(new CustomEvent('bisect-step'));
  }

  private async handleSkip(): Promise<void> {
    this.loading = true;
    this.error = '';

    const result = await gitService.bisectSkip(this.repositoryPath);

    if (result.success && result.data) {
      this.status = result.data.status;
      this.message = result.data.message;

      if (result.data.status.currentCommit) {
        await this.fetchCurrentCommitInfo(result.data.status.currentCommit);
      }
    } else {
      this.error = result.error?.message || 'Failed to skip commit';
    }

    this.loading = false;
    this.dispatchEvent(new CustomEvent('bisect-step'));
  }

  private async handleReset(): Promise<void> {
    this.loading = true;
    this.error = '';

    const result = await gitService.bisectReset(this.repositoryPath);

    if (result.success) {
      this.step = 'setup';
      this.status = null;
      this.culprit = null;
      this.currentCommitInfo = null;
      this.badCommitInput = '';
      this.goodCommitInput = '';
      this.message = '';
      this.dispatchEvent(new CustomEvent('bisect-complete'));
    } else {
      this.error = result.error?.message || 'Failed to reset bisect';
    }

    this.loading = false;
  }

  private handleClose(): void {
    this.dispatchEvent(new CustomEvent('close'));
  }

  private renderSetup() {
    return html`
      <div class="setup-section">
        <h3>Bad Commit (has the bug)</h3>
        <div class="commit-input-group">
          <div class="commit-input">
            <input
              type="text"
              placeholder="HEAD, commit hash, or branch name"
              .value=${this.badCommitInput}
              @input=${(e: Event) => {
                this.badCommitInput = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          <span class="hint">Usually HEAD or your current branch</span>
        </div>
      </div>

      <div class="setup-section">
        <h3>Good Commit (before the bug)</h3>
        <div class="commit-input-group">
          <div class="commit-input">
            <input
              type="text"
              placeholder="Commit hash, tag, or branch name"
              .value=${this.goodCommitInput}
              @input=${(e: Event) => {
                this.goodCommitInput = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          <span class="hint">A commit where the bug did not exist</span>
        </div>
      </div>
    `;
  }

  private renderInProgress() {
    return html`
      ${this.status
        ? html`
            <div class="progress-info">
              <div class="progress-stats">
                <div class="progress-stat">
                  <div class="progress-stat-value">${this.status.remaining ?? '?'}</div>
                  <div class="progress-stat-label">Commits left</div>
                </div>
                <div class="progress-stat">
                  <div class="progress-stat-value">${this.status.currentStep ?? 0}</div>
                  <div class="progress-stat-label">Steps taken</div>
                </div>
                <div class="progress-stat">
                  <div class="progress-stat-value">~${this.status.totalSteps ?? '?'}</div>
                  <div class="progress-stat-label">Total steps</div>
                </div>
              </div>
            </div>
          `
        : ''}

      <div class="current-commit">
        <div class="current-commit-label">Current Commit to Test</div>
        <div class="current-commit-oid">
          ${this.status?.currentCommit?.substring(0, 12) ?? '...'}
        </div>
        <div class="current-commit-message">
          ${this.currentCommitInfo?.summary ?? 'Loading...'}
        </div>
      </div>

      <div class="action-buttons">
        <button
          class="action-btn good"
          @click=${this.handleGood}
          ?disabled=${this.loading}
        >
          <div class="action-btn-icon">&#10003;</div>
          <div class="action-btn-label">Good</div>
        </button>
        <button
          class="action-btn bad"
          @click=${this.handleBad}
          ?disabled=${this.loading}
        >
          <div class="action-btn-icon">&#10007;</div>
          <div class="action-btn-label">Bad</div>
        </button>
        <button
          class="action-btn skip"
          @click=${this.handleSkip}
          ?disabled=${this.loading}
        >
          <div class="action-btn-icon">&#8594;</div>
          <div class="action-btn-label">Skip</div>
        </button>
      </div>

      ${this.renderBisectLog()}
    `;
  }

  private renderComplete() {
    return html`
      ${this.culprit
        ? html`
            <div class="culprit-card">
              <div class="culprit-header">
                <svg class="culprit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <span class="culprit-title">Bug-Introducing Commit Found</span>
              </div>
              <div class="culprit-oid">${this.culprit.oid}</div>
              <div class="culprit-summary">${this.culprit.summary}</div>
              <div class="culprit-author">
                by ${this.culprit.author} &lt;${this.culprit.email}&gt;
              </div>
            </div>
          `
        : ''}

      ${this.renderBisectLog()}
    `;
  }

  private renderBisectLog() {
    if (!this.status?.log?.length) return '';

    return html`
      <div class="bisect-log">
        <div class="bisect-log-title">Bisect History</div>
        <div class="bisect-log-entries">
          ${this.status.log.map(
            (entry) => html`
              <div class="bisect-log-entry">
                <span class="log-action ${entry.action}">${entry.action}</span>
                <span class="log-oid">${entry.commitOid.substring(0, 7)}</span>
              </div>
            `
          )}
        </div>
      </div>
    `;
  }

  render() {
    if (!this.open) return null;

    return html`
      <div class="dialog-overlay" @click=${this.handleClose}>
        <div class="dialog" @click=${(e: Event) => e.stopPropagation()}>
          <div class="dialog-header">
            <span class="dialog-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M12 2v4m0 12v4M2 12h4m12 0h4"></path>
              </svg>
              Git Bisect
            </span>
            <button class="close-btn" @click=${this.handleClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <div class="dialog-content">
            ${this.loading
              ? html`<div class="loading">Loading...</div>`
              : ''}

            ${this.error
              ? html`<div class="message error">${this.error}</div>`
              : ''}

            ${this.message && !this.error
              ? html`<div class="message info">${this.message}</div>`
              : ''}

            ${!this.loading
              ? this.step === 'setup'
                ? this.renderSetup()
                : this.step === 'in-progress'
                  ? this.renderInProgress()
                  : this.renderComplete()
              : ''}
          </div>

          <div class="dialog-footer">
            ${this.step === 'setup'
              ? html`
                  <button class="btn btn-secondary" @click=${this.handleClose}>
                    Cancel
                  </button>
                  <button
                    class="btn btn-primary"
                    @click=${this.handleStart}
                    ?disabled=${this.loading || !this.badCommitInput || !this.goodCommitInput}
                  >
                    Start Bisect
                  </button>
                `
              : this.step === 'in-progress'
                ? html`
                    <button
                      class="btn btn-danger"
                      @click=${this.handleReset}
                      ?disabled=${this.loading}
                    >
                      Abort Bisect
                    </button>
                  `
                : html`
                    <button
                      class="btn btn-primary"
                      @click=${this.handleReset}
                      ?disabled=${this.loading}
                    >
                      Finish
                    </button>
                  `}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-bisect-dialog': LvBisectDialog;
  }
}
