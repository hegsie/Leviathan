/**
 * Worktree Dialog Component
 * Manage git worktrees for working on multiple branches
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import type { Worktree } from '../../services/git.service.ts';
import type { Branch } from '../../types/git.types.ts';
import { showConfirm } from '../../services/dialog.service.ts';

type DialogMode = 'list' | 'add';

@customElement('lv-worktree-dialog')
export class LvWorktreeDialog extends LitElement {
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
        width: 550px;
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
        justify-content: space-between;
        gap: var(--spacing-sm);
        padding: var(--spacing-md);
        border-top: 1px solid var(--color-border);
      }

      .dialog-footer-right {
        display: flex;
        gap: var(--spacing-sm);
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

      /* Worktree list */
      .worktree-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .empty-state {
        text-align: center;
        padding: var(--spacing-xl);
        color: var(--color-text-muted);
      }

      .worktree-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm);
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
      }

      .worktree-item.main {
        border-color: var(--color-primary);
        background: rgba(59, 130, 246, 0.05);
      }

      .worktree-item.locked {
        opacity: 0.7;
      }

      .worktree-icon {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-sm);
        flex-shrink: 0;
      }

      .worktree-icon svg {
        width: 16px;
        height: 16px;
        color: var(--color-text-secondary);
      }

      .worktree-info {
        flex: 1;
        min-width: 0;
      }

      .worktree-branch {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
      }

      .main-badge {
        padding: 1px 6px;
        background: var(--color-primary);
        color: white;
        border-radius: var(--radius-xs);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
      }

      .locked-badge {
        padding: 1px 6px;
        background: var(--color-bg-tertiary);
        color: var(--color-text-muted);
        border-radius: var(--radius-xs);
        font-size: var(--font-size-xs);
      }

      .worktree-path {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        font-family: var(--font-family-mono);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .worktree-actions {
        display: flex;
        gap: var(--spacing-xs);
        flex-shrink: 0;
      }

      .action-btn {
        padding: var(--spacing-xs);
        background: none;
        border: none;
        color: var(--color-text-secondary);
        cursor: pointer;
        border-radius: var(--radius-sm);
      }

      .action-btn:hover {
        background: var(--color-bg-tertiary);
        color: var(--color-text-primary);
      }

      .action-btn.danger:hover {
        background: var(--color-error-bg);
        color: var(--color-error);
      }

      .action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .action-btn svg {
        width: 14px;
        height: 14px;
      }

      /* Add form */
      .form-group {
        margin-bottom: var(--spacing-md);
      }

      .form-label {
        display: block;
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
        margin-bottom: var(--spacing-xs);
      }

      .form-input {
        width: 100%;
        padding: var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
      }

      .form-input::placeholder {
        color: var(--color-text-muted);
      }

      .form-hint {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        margin-top: var(--spacing-xs);
      }

      .form-select {
        width: 100%;
        padding: var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
      }

      .form-checkbox {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-size: var(--font-size-sm);
      }

      /* Buttons */
      .btn {
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        transition: all var(--transition-fast);
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-xs);
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

      .btn svg {
        width: 14px;
        height: 14px;
      }

      .message {
        padding: var(--spacing-sm);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);
        margin-bottom: var(--spacing-md);
      }

      .message.error {
        background: var(--color-error-bg);
        border: 1px solid var(--color-error);
        color: var(--color-error);
      }

      .message.success {
        background: var(--color-success-bg);
        border: 1px solid var(--color-success);
        color: var(--color-success);
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

  @state() private mode: DialogMode = 'list';
  @state() private worktrees: Worktree[] = [];
  @state() private branches: Branch[] = [];
  @state() private loading = false;
  @state() private error = '';
  @state() private success = '';

  // Add form
  @state() private addPath = '';
  @state() private addBranch = '';
  @state() private createNewBranch = false;
  @state() private newBranchName = '';

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    if (this.open) {
      await this.loadWorktrees();
    }
  }

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('open') && this.open) {
      this.mode = 'list';
      await this.loadWorktrees();
      await this.loadBranches();
    }
  }

  private async loadWorktrees(): Promise<void> {
    this.loading = true;
    this.error = '';

    const result = await gitService.getWorktrees(this.repositoryPath);

    if (result.success && result.data) {
      this.worktrees = result.data;
    } else {
      this.error = result.error?.message || 'Failed to load worktrees';
    }

    this.loading = false;
  }

  private async loadBranches(): Promise<void> {
    const result = await gitService.getBranches(this.repositoryPath);
    if (result.success && result.data) {
      // Filter out branches already checked out in other worktrees
      const usedBranches = new Set(this.worktrees.map((wt) => wt.branch).filter(Boolean));
      this.branches = result.data.filter((b) => !usedBranches.has(b.name));
    }
  }

  private async handleAdd(): Promise<void> {
    if (!this.addPath) {
      this.error = 'Path is required';
      return;
    }

    if (!this.createNewBranch && !this.addBranch) {
      this.error = 'Please select a branch or create a new one';
      return;
    }

    if (this.createNewBranch && !this.newBranchName) {
      this.error = 'New branch name is required';
      return;
    }

    this.loading = true;
    this.error = '';

    const result = await gitService.addWorktree(this.repositoryPath, this.addPath, {
      branch: this.createNewBranch ? undefined : this.addBranch,
      newBranch: this.createNewBranch ? this.newBranchName : undefined,
    });

    if (result.success) {
      this.success = 'Worktree added successfully';
      this.addPath = '';
      this.addBranch = '';
      this.newBranchName = '';
      this.createNewBranch = false;
      this.mode = 'list';
      await this.loadWorktrees();
      this.dispatchEvent(new CustomEvent('worktrees-changed'));
    } else {
      this.error = result.error?.message || 'Failed to add worktree';
    }

    this.loading = false;
  }

  private async handleRemove(worktree: Worktree): Promise<void> {
    if (worktree.isMain) {
      this.error = 'Cannot remove the main worktree';
      return;
    }

    const confirmed = await showConfirm('Remove Worktree', `Are you sure you want to remove the worktree at "${worktree.path}"?`, 'warning');

    if (!confirmed) return;

    this.loading = true;
    this.error = '';

    const result = await gitService.removeWorktree(this.repositoryPath, worktree.path);

    if (result.success) {
      this.success = 'Worktree removed';
      await this.loadWorktrees();
      this.dispatchEvent(new CustomEvent('worktrees-changed'));
    } else {
      this.error = result.error?.message || 'Failed to remove worktree';
    }

    this.loading = false;
  }

  private async handleLock(worktree: Worktree): Promise<void> {
    this.loading = true;
    this.error = '';

    const result = await gitService.lockWorktree(this.repositoryPath, worktree.path);

    if (result.success) {
      await this.loadWorktrees();
    } else {
      this.error = result.error?.message || 'Failed to lock worktree';
    }

    this.loading = false;
  }

  private async handleUnlock(worktree: Worktree): Promise<void> {
    this.loading = true;
    this.error = '';

    const result = await gitService.unlockWorktree(this.repositoryPath, worktree.path);

    if (result.success) {
      await this.loadWorktrees();
    } else {
      this.error = result.error?.message || 'Failed to unlock worktree';
    }

    this.loading = false;
  }

  private handleClose(): void {
    this.dispatchEvent(new CustomEvent('close'));
  }

  private renderList() {
    if (this.worktrees.length === 0) {
      return html`
        <div class="empty-state">
          <div>No worktrees found</div>
        </div>
      `;
    }

    return html`
      <div class="worktree-list">
        ${this.worktrees.map(
          (wt) => html`
            <div class="worktree-item ${wt.isMain ? 'main' : ''} ${wt.isLocked ? 'locked' : ''}">
              <div class="worktree-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <div class="worktree-info">
                <div class="worktree-branch">
                  ${wt.branch || 'detached HEAD'}
                  ${wt.isMain ? html`<span class="main-badge">main</span>` : ''}
                  ${wt.isLocked ? html`<span class="locked-badge">locked</span>` : ''}
                </div>
                <div class="worktree-path" title="${wt.path}">${wt.path}</div>
              </div>
              <div class="worktree-actions">
                ${wt.isLocked
                  ? html`
                      <button
                        class="action-btn"
                        title="Unlock"
                        @click=${() => this.handleUnlock(wt)}
                        ?disabled=${this.loading}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                        </svg>
                      </button>
                    `
                  : html`
                      <button
                        class="action-btn"
                        title="Lock"
                        @click=${() => this.handleLock(wt)}
                        ?disabled=${this.loading || wt.isMain}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                      </button>
                    `}
                <button
                  class="action-btn danger"
                  title="Remove"
                  @click=${() => this.handleRemove(wt)}
                  ?disabled=${this.loading || wt.isMain || wt.isLocked}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              </div>
            </div>
          `
        )}
      </div>
    `;
  }

  private renderAddForm() {
    return html`
      <div class="form-group">
        <label class="form-label">Worktree Path</label>
        <input
          type="text"
          class="form-input"
          placeholder="../my-feature-worktree"
          .value=${this.addPath}
          @input=${(e: Event) => {
            this.addPath = (e.target as HTMLInputElement).value;
          }}
        />
        <div class="form-hint">Path where the new worktree will be created</div>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input
            type="checkbox"
            .checked=${this.createNewBranch}
            @change=${(e: Event) => {
              this.createNewBranch = (e.target as HTMLInputElement).checked;
            }}
          />
          Create new branch
        </label>
      </div>

      ${this.createNewBranch
        ? html`
            <div class="form-group">
              <label class="form-label">New Branch Name</label>
              <input
                type="text"
                class="form-input"
                placeholder="feature/my-new-feature"
                .value=${this.newBranchName}
                @input=${(e: Event) => {
                  this.newBranchName = (e.target as HTMLInputElement).value;
                }}
              />
            </div>
          `
        : html`
            <div class="form-group">
              <label class="form-label">Branch</label>
              <select
                class="form-select"
                .value=${this.addBranch}
                @change=${(e: Event) => {
                  this.addBranch = (e.target as HTMLSelectElement).value;
                }}
              >
                <option value="">Select a branch...</option>
                ${this.branches.map(
                  (b) => html`<option value="${b.name}">${b.name}</option>`
                )}
              </select>
              <div class="form-hint">
                Only branches not checked out in other worktrees are shown
              </div>
            </div>
          `}
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
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              ${this.mode === 'list' ? 'Worktrees' : 'Add Worktree'}
            </span>
            <button class="close-btn" @click=${this.handleClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <div class="dialog-content">
            ${this.loading ? html`<div class="loading">Loading...</div>` : ''}

            ${this.error ? html`<div class="message error">${this.error}</div>` : ''}

            ${this.success ? html`<div class="message success">${this.success}</div>` : ''}

            ${!this.loading
              ? this.mode === 'list'
                ? this.renderList()
                : this.renderAddForm()
              : ''}
          </div>

          <div class="dialog-footer">
            ${this.mode === 'list'
              ? html`
                  <button
                    class="btn btn-primary"
                    @click=${() => {
                      this.mode = 'add';
                      this.error = '';
                      this.success = '';
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="12" y1="5" x2="12" y2="19"/>
                      <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Add Worktree
                  </button>
                  <div class="dialog-footer-right">
                    <button class="btn btn-secondary" @click=${this.handleClose}>
                      Close
                    </button>
                  </div>
                `
              : html`
                  <button
                    class="btn btn-secondary"
                    @click=${() => {
                      this.mode = 'list';
                      this.error = '';
                    }}
                  >
                    Cancel
                  </button>
                  <div class="dialog-footer-right">
                    <button
                      class="btn btn-primary"
                      @click=${this.handleAdd}
                      ?disabled=${this.loading || !this.addPath}
                    >
                      Add Worktree
                    </button>
                  </div>
                `}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-worktree-dialog': LvWorktreeDialog;
  }
}
