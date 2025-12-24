import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import type { Commit } from '../../types/git.types.ts';

/**
 * Commit panel component
 * Allows users to write commit messages and create commits
 */
@customElement('lv-commit-panel')
export class LvCommitPanel extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        padding: var(--spacing-sm);
        gap: var(--spacing-sm);
        background: var(--color-bg-secondary);
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
      }

      .staged-count {
        font-weight: var(--font-weight-medium);
      }

      .staged-count.has-staged {
        color: var(--color-success);
      }

      .message-container {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .summary-input {
        width: 100%;
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-primary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        font-family: inherit;
        resize: none;
        transition: border-color var(--transition-fast);
      }

      .summary-input:focus {
        outline: none;
        border-color: var(--color-primary);
      }

      .summary-input::placeholder {
        color: var(--color-text-muted);
      }

      .summary-input.over-limit {
        border-color: var(--color-warning);
      }

      .description-input {
        width: 100%;
        min-height: 60px;
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-primary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        font-family: inherit;
        resize: vertical;
        transition: border-color var(--transition-fast);
      }

      .description-input:focus {
        outline: none;
        border-color: var(--color-primary);
      }

      .description-input::placeholder {
        color: var(--color-text-muted);
      }

      .char-count {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        text-align: right;
      }

      .char-count.over-limit {
        color: var(--color-warning);
      }

      .actions {
        display: flex;
        gap: var(--spacing-xs);
      }

      .commit-btn {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-sm);
        background: var(--color-primary);
        color: var(--color-text-inverse);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        transition: background var(--transition-fast);
      }

      .commit-btn:hover:not(:disabled) {
        background: var(--color-primary-hover);
      }

      .commit-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .commit-btn svg {
        width: 16px;
        height: 16px;
      }

      .amend-toggle {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        cursor: pointer;
        user-select: none;
      }

      .amend-toggle input {
        margin: 0;
      }

      .error {
        padding: var(--spacing-xs);
        background: var(--color-error-bg);
        border-radius: var(--radius-sm);
        color: var(--color-error);
        font-size: var(--font-size-xs);
      }

      .success {
        padding: var(--spacing-xs);
        background: var(--color-success-bg);
        border-radius: var(--radius-sm);
        color: var(--color-success);
        font-size: var(--font-size-xs);
      }
    `,
  ];

  @property({ type: String }) repositoryPath: string = '';
  @property({ type: Number }) stagedCount: number = 0;

  @state() private summary: string = '';
  @state() private description: string = '';
  @state() private amend: boolean = false;
  @state() private isCommitting: boolean = false;
  @state() private error: string | null = null;
  @state() private success: string | null = null;
  @state() private lastCommit: Commit | null = null;

  // Store original input before amend pre-population
  private originalSummary: string = '';
  private originalDescription: string = '';

  @query('.summary-input') private summaryInput!: HTMLTextAreaElement;

  private readonly SUMMARY_LIMIT = 72;

  private get canCommit(): boolean {
    return (
      this.summary.trim().length > 0 &&
      (this.stagedCount > 0 || this.amend) &&
      !this.isCommitting
    );
  }

  private handleSummaryInput(e: Event): void {
    const target = e.target as HTMLTextAreaElement;
    this.summary = target.value;
    this.error = null;
    this.success = null;
  }

  private handleDescriptionInput(e: Event): void {
    const target = e.target as HTMLTextAreaElement;
    this.description = target.value;
  }

  private async handleAmendToggle(e: Event): Promise<void> {
    const target = e.target as HTMLInputElement;
    this.amend = target.checked;

    if (this.amend) {
      // Store current input before pre-populating
      this.originalSummary = this.summary;
      this.originalDescription = this.description;

      // Fetch last commit and pre-populate message
      await this.fetchLastCommitMessage();
    } else {
      // Restore original input when toggling off
      this.summary = this.originalSummary;
      this.description = this.originalDescription;
      this.lastCommit = null;
    }
  }

  private async fetchLastCommitMessage(): Promise<void> {
    if (!this.repositoryPath) return;

    try {
      const result = await gitService.getCommitHistory({
        path: this.repositoryPath,
        limit: 1,
      });

      if (result.success && result.data && result.data.length > 0) {
        this.lastCommit = result.data[0];
        this.summary = this.lastCommit.summary;
        this.description = this.lastCommit.body ?? '';
      }
    } catch (err) {
      console.error('Failed to fetch last commit:', err);
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Cmd/Ctrl + Enter to commit
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && this.canCommit) {
      e.preventDefault();
      this.handleCommit();
    }
  }

  private async handleCommit(): Promise<void> {
    if (!this.canCommit) return;

    this.isCommitting = true;
    this.error = null;
    this.success = null;

    try {
      const message = this.description
        ? `${this.summary}\n\n${this.description}`
        : this.summary;

      const result = await gitService.createCommit(this.repositoryPath, {
        message,
        amend: this.amend,
      });

      if (result.success) {
        this.success = `Created commit ${result.data?.shortId}`;
        this.summary = '';
        this.description = '';
        this.amend = false;
        this.lastCommit = null;
        this.originalSummary = '';
        this.originalDescription = '';

        // Notify parent to refresh
        this.dispatchEvent(new CustomEvent('commit-created', {
          detail: { commit: result.data },
          bubbles: true,
          composed: true,
        }));

        // Clear success message after a delay
        setTimeout(() => {
          this.success = null;
        }, 3000);
      } else {
        this.error = result.error?.message ?? 'Failed to create commit';
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      this.isCommitting = false;
    }
  }

  render() {
    const summaryOverLimit = this.summary.length > this.SUMMARY_LIMIT;

    return html`
      <div class="header">
        <span>Commit</span>
        <span class="staged-count ${this.stagedCount > 0 ? 'has-staged' : ''}">
          ${this.stagedCount} staged ${this.stagedCount === 1 ? 'file' : 'files'}
        </span>
      </div>

      <div class="message-container">
        <textarea
          class="summary-input ${summaryOverLimit ? 'over-limit' : ''}"
          placeholder="Summary (required)"
          rows="1"
          .value=${this.summary}
          @input=${this.handleSummaryInput}
          @keydown=${this.handleKeyDown}
        ></textarea>

        <div class="char-count ${summaryOverLimit ? 'over-limit' : ''}">
          ${this.summary.length}/${this.SUMMARY_LIMIT}
        </div>

        <textarea
          class="description-input"
          placeholder="Description (optional)"
          .value=${this.description}
          @input=${this.handleDescriptionInput}
          @keydown=${this.handleKeyDown}
        ></textarea>
      </div>

      <label class="amend-toggle">
        <input
          type="checkbox"
          .checked=${this.amend}
          @change=${this.handleAmendToggle}
        />
        Amend last commit${this.amend && this.lastCommit ? ` (${this.lastCommit.shortId})` : ''}
      </label>

      ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
      ${this.success ? html`<div class="success">${this.success}</div>` : nothing}

      <div class="actions">
        <button
          class="commit-btn"
          ?disabled=${!this.canCommit}
          @click=${this.handleCommit}
          title="Commit staged changes (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          ${this.isCommitting ? 'Committing...' : 'Commit'}
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-commit-panel': LvCommitPanel;
  }
}
