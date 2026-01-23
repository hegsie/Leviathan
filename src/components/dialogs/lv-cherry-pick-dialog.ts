/**
 * Cherry-Pick Dialog Component
 * Allows users to cherry-pick a commit with options
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { cherryPick } from '../../services/git.service.ts';
import './lv-modal.ts';
import type { Commit } from '../../types/git.types.ts';

@customElement('lv-cherry-pick-dialog')
export class LvCherryPickDialog extends LitElement {
  static styles = [
    sharedStyles,
    css`
      .form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        min-width: 450px;
      }

      .commit-preview {
        padding: var(--spacing-md);
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
      }

      .commit-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-sm);
      }

      .commit-sha {
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        color: var(--color-primary);
        background: var(--color-primary-light);
        padding: 2px 6px;
        border-radius: var(--radius-sm);
      }

      .commit-date {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        margin-left: auto;
      }

      .commit-message {
        font-size: var(--font-size-md);
        color: var(--color-text-primary);
        font-weight: var(--font-weight-medium);
        margin-bottom: var(--spacing-xs);
        word-break: break-word;
      }

      .commit-body {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 100px;
        overflow-y: auto;
        margin-bottom: var(--spacing-sm);
      }

      .commit-author {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
      }

      .commit-author strong {
        color: var(--color-text-primary);
      }

      .target-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
      }

      .target-label {
        color: var(--color-text-secondary);
      }

      .target-branch {
        font-family: var(--font-mono);
        color: var(--color-success);
        font-weight: var(--font-weight-medium);
      }

      .options-section {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .options-header {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
      }

      .option-row {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs) 0;
      }

      .option-row input[type="checkbox"] {
        margin-top: 2px;
        accent-color: var(--color-primary);
      }

      .option-label {
        display: flex;
        flex-direction: column;
        gap: 2px;
        cursor: pointer;
      }

      .option-label-main {
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
      }

      .option-label-hint {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .option-row.disabled {
        opacity: 0.5;
        pointer-events: none;
      }

      .error-message {
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-error-bg);
        border: 1px solid var(--color-error);
        border-radius: var(--radius-md);
        color: var(--color-error);
        font-size: var(--font-size-sm);
      }

      .btn {
        padding: var(--spacing-sm) var(--spacing-lg);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .btn-primary {
        background: var(--color-primary);
        color: var(--color-text-inverse);
        border: none;
      }

      .btn-primary:hover:not(:disabled) {
        background: var(--color-primary-hover);
      }

      .btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-secondary {
        background: transparent;
        color: var(--color-text-secondary);
        border: 1px solid var(--color-border);
      }

      .btn-secondary:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .cherry-icon {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-xs);
      }
    `,
  ];

  @property({ type: String }) repositoryPath = '';
  @property({ type: String }) currentBranch = '';

  @state() private commit: Commit | null = null;
  @state() private noCommit = false;
  @state() private isExecuting = false;
  @state() private error = '';
  @state() private isOpen = false;

  public open(commit: Commit): void {
    this.reset();
    this.commit = commit;
    this.isOpen = true;
  }

  public close(): void {
    this.isOpen = false;
  }

  private reset(): void {
    this.commit = null;
    this.noCommit = false;
    this.isExecuting = false;
    this.error = '';
    this.isOpen = false;
  }

  private handleNoCommitChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.noCommit = input.checked;
  }

  private async handleCherryPick(): Promise<void> {
    if (!this.commit) return;

    this.isExecuting = true;
    this.error = '';

    try {
      const result = await cherryPick({
        path: this.repositoryPath,
        commitOid: this.commit.oid,
        noCommit: this.noCommit || undefined,
      });

      if (result.success) {
        this.dispatchEvent(new CustomEvent('cherry-pick-complete', {
          detail: {
            commit: result.data,
            sourceCommit: this.commit,
            noCommit: this.noCommit,
          },
          bubbles: true,
          composed: true,
        }));
        this.close();
      } else {
        // Check if it's a conflict
        if (result.error?.message?.includes('conflict')) {
          this.dispatchEvent(new CustomEvent('cherry-pick-conflict', {
            detail: {
              sourceCommit: this.commit,
              error: result.error,
            },
            bubbles: true,
            composed: true,
          }));
          this.close();
        } else {
          this.error = result.error?.message ?? 'Failed to cherry-pick commit';
        }
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unknown error occurred';
    } finally {
      this.isExecuting = false;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && this.commit && !this.isExecuting) {
      e.preventDefault();
      this.handleCherryPick();
    }
  }

  private handleModalClose(): void {
    if (!this.isExecuting) {
      this.close();
    }
  }

  private formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  render() {
    if (!this.commit) {
      return html`<lv-modal modalTitle="Cherry-Pick" ?open=${false}></lv-modal>`;
    }

    return html`
      <lv-modal
        modalTitle="Cherry-Pick Commit"
        ?open=${this.isOpen}
        @close=${this.handleModalClose}
      >
        <div class="form" @keydown=${this.handleKeyDown}>
          <!-- Commit Preview -->
          <div class="commit-preview">
            <div class="commit-header">
              <span class="commit-sha">${this.commit.shortId}</span>
              <span class="commit-date">${this.formatDate(this.commit.timestamp)}</span>
            </div>
            <div class="commit-message">${this.commit.summary}</div>
            ${this.commit.body ? html`
              <div class="commit-body">${this.commit.body}</div>
            ` : nothing}
            <div class="commit-author">
              by <strong>${this.commit.author.name}</strong>
              &lt;${this.commit.author.email}&gt;
            </div>
          </div>

          <!-- Target Info -->
          <div class="target-info">
            <span class="target-label">Cherry-pick onto:</span>
            <span class="target-branch">${this.currentBranch || 'current branch'}</span>
          </div>

          <!-- Options -->
          <div class="options-section">
            <div class="options-header">Options</div>

            <div class="option-row">
              <input
                type="checkbox"
                id="no-commit"
                .checked=${this.noCommit}
                @change=${this.handleNoCommitChange}
                ?disabled=${this.isExecuting}
              />
              <label class="option-label" for="no-commit">
                <span class="option-label-main">Stage changes only (no commit)</span>
                <span class="option-label-hint">Apply changes to working directory without committing</span>
              </label>
            </div>
          </div>

          ${this.error
            ? html`<div class="error-message">${this.error}</div>`
            : nothing}
        </div>

        <div slot="footer">
          <button
            class="btn btn-secondary"
            @click=${this.close}
            ?disabled=${this.isExecuting}
          >
            Cancel
          </button>
          <button
            class="btn btn-primary"
            @click=${this.handleCherryPick}
            ?disabled=${this.isExecuting}
          >
            ${this.isExecuting ? 'Cherry-picking...' : 'Cherry-Pick'}
          </button>
        </div>
      </lv-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-cherry-pick-dialog': LvCherryPickDialog;
  }
}
