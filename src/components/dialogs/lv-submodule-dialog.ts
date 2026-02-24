/**
 * Submodule Dialog Component
 * Manage git submodules - list, add, update, remove
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import type { Submodule } from '../../services/git.service.ts';
import { showConfirm } from '../../services/dialog.service.ts';

type DialogMode = 'list' | 'add';

@customElement('lv-submodule-dialog')
export class LvSubmoduleDialog extends LitElement {
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

      /* Submodule list */
      .submodule-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .empty-state {
        text-align: center;
        padding: var(--spacing-xl);
        color: var(--color-text-muted);
      }

      .empty-icon {
        font-size: 48px;
        margin-bottom: var(--spacing-sm);
        opacity: 0.5;
      }

      .submodule-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm);
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
      }

      .submodule-item:hover {
        background: var(--color-bg-hover);
      }

      .submodule-icon {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-sm);
        flex-shrink: 0;
      }

      .submodule-icon svg {
        width: 16px;
        height: 16px;
        color: var(--color-text-secondary);
      }

      .submodule-info {
        flex: 1;
        min-width: 0;
      }

      .submodule-name {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .submodule-path {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        font-family: var(--font-family-mono);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .submodule-status {
        padding: 2px 8px;
        border-radius: var(--radius-xs);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        flex-shrink: 0;
      }

      .status-current {
        background: var(--color-success-bg);
        color: var(--color-success);
      }

      .status-modified {
        background: rgba(245, 158, 11, 0.1);
        color: rgb(245, 158, 11);
      }

      .status-uninitialized {
        background: var(--color-bg-tertiary);
        color: var(--color-text-muted);
      }

      .status-missing {
        background: var(--color-error-bg);
        color: var(--color-error);
      }

      .status-dirty {
        background: rgba(245, 158, 11, 0.1);
        color: rgb(245, 158, 11);
      }

      .submodule-actions {
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

      /* Bulk actions */
      .bulk-actions {
        display: flex;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-md);
        padding: var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: String }) repositoryPath = '';

  @state() private mode: DialogMode = 'list';
  @state() private submodules: Submodule[] = [];
  @state() private loading = false;
  @state() private error = '';
  @state() private success = '';

  // Add form
  @state() private addUrl = '';
  @state() private addPath = '';
  @state() private addBranch = '';

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    if (this.open) {
      await this.loadSubmodules();
    }
  }

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('open') && this.open) {
      this.mode = 'list';
      await this.loadSubmodules();
    }
  }

  private async loadSubmodules(): Promise<void> {
    this.loading = true;
    this.error = '';

    const result = await gitService.getSubmodules(this.repositoryPath);

    if (result.success && result.data) {
      this.submodules = result.data;
    } else {
      this.error = result.error?.message || 'Failed to load submodules';
    }

    this.loading = false;
  }

  private async handleAdd(): Promise<void> {
    if (!this.addUrl || !this.addPath) {
      this.error = 'URL and path are required';
      return;
    }

    this.loading = true;
    this.error = '';

    const result = await gitService.addSubmodule(
      this.repositoryPath,
      this.addUrl,
      this.addPath,
      this.addBranch || undefined
    );

    if (result.success) {
      this.success = 'Submodule added successfully';
      this.addUrl = '';
      this.addPath = '';
      this.addBranch = '';
      this.mode = 'list';
      await this.loadSubmodules();
      this.dispatchEvent(new CustomEvent('submodules-changed'));
    } else {
      this.error = result.error?.message || 'Failed to add submodule';
    }

    this.loading = false;
  }

  private async handleInit(submodule: Submodule): Promise<void> {
    this.loading = true;
    this.error = '';

    const result = await gitService.initSubmodules(this.repositoryPath, [submodule.path]);

    if (result.success) {
      // Also update after init
      await gitService.updateSubmodules(this.repositoryPath, {
        submodulePaths: [submodule.path],
      });
      await this.loadSubmodules();
      this.dispatchEvent(new CustomEvent('submodules-changed'));
    } else {
      this.error = result.error?.message || 'Failed to initialize submodule';
    }

    this.loading = false;
  }

  private async handleUpdate(submodule: Submodule): Promise<void> {
    this.loading = true;
    this.error = '';

    const result = await gitService.updateSubmodules(this.repositoryPath, {
      submodulePaths: [submodule.path],
      remote: true,
    });

    if (result.success) {
      await this.loadSubmodules();
      this.dispatchEvent(new CustomEvent('submodules-changed'));
    } else {
      this.error = result.error?.message || 'Failed to update submodule';
    }

    this.loading = false;
  }

  private async handleRemove(submodule: Submodule): Promise<void> {
    const confirmed = await showConfirm('Remove Submodule', `Are you sure you want to remove the submodule "${submodule.name}"?\n\nThis will remove the submodule from your repository.`, 'warning');

    if (!confirmed) return;

    this.loading = true;
    this.error = '';

    const result = await gitService.removeSubmodule(this.repositoryPath, submodule.path);

    if (result.success) {
      this.success = 'Submodule removed successfully';
      await this.loadSubmodules();
      this.dispatchEvent(new CustomEvent('submodules-changed'));
    } else {
      this.error = result.error?.message || 'Failed to remove submodule';
    }

    this.loading = false;
  }

  private async handleUpdateAll(): Promise<void> {
    this.loading = true;
    this.error = '';

    const result = await gitService.updateSubmodules(this.repositoryPath, {
      init: true,
      recursive: true,
    });

    if (result.success) {
      this.success = 'All submodules updated';
      await this.loadSubmodules();
      this.dispatchEvent(new CustomEvent('submodules-changed'));
    } else {
      this.error = result.error?.message || 'Failed to update submodules';
    }

    this.loading = false;
  }

  private handleClose(): void {
    this.dispatchEvent(new CustomEvent('close'));
  }

  private getStatusLabel(status: string): string {
    switch (status) {
      case 'current':
        return 'Up to date';
      case 'modified':
        return 'Modified';
      case 'uninitialized':
        return 'Not initialized';
      case 'missing':
        return 'Missing';
      case 'dirty':
        return 'Has changes';
      default:
        return status;
    }
  }

  private renderList() {
    if (this.submodules.length === 0) {
      return html`
        <div class="empty-state">
          <div class="empty-icon">&#128230;</div>
          <div>No submodules</div>
          <div style="font-size: var(--font-size-xs); margin-top: var(--spacing-xs);">
            Add a submodule to include another repository
          </div>
        </div>
      `;
    }

    return html`
      ${this.submodules.length > 1 ? html`
        <div class="bulk-actions">
          <button class="btn btn-secondary" @click=${this.handleUpdateAll} ?disabled=${this.loading}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Update All
          </button>
        </div>
      ` : ''}

      <div class="submodule-list">
        ${this.submodules.map(
          (sub) => html`
            <div class="submodule-item">
              <div class="submodule-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 3h18v18H3z"/>
                  <path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>
                </svg>
              </div>
              <div class="submodule-info">
                <div class="submodule-name">${sub.name}</div>
                <div class="submodule-path">${sub.path}</div>
              </div>
              <span class="submodule-status status-${sub.status}">
                ${this.getStatusLabel(sub.status)}
              </span>
              <div class="submodule-actions">
                ${!sub.initialized
                  ? html`
                      <button
                        class="action-btn"
                        title="Initialize"
                        @click=${() => this.handleInit(sub)}
                        ?disabled=${this.loading}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="7 10 12 15 17 10"/>
                          <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                      </button>
                    `
                  : html`
                      <button
                        class="action-btn"
                        title="Update"
                        @click=${() => this.handleUpdate(sub)}
                        ?disabled=${this.loading}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M23 4v6h-6M1 20v-6h6"/>
                          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                      </button>
                    `}
                <button
                  class="action-btn danger"
                  title="Remove"
                  @click=${() => this.handleRemove(sub)}
                  ?disabled=${this.loading}
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
        <label class="form-label">Repository URL</label>
        <input
          type="text"
          class="form-input"
          placeholder="https://github.com/user/repo.git"
          .value=${this.addUrl}
          @input=${(e: Event) => {
            this.addUrl = (e.target as HTMLInputElement).value;
          }}
        />
        <div class="form-hint">The URL of the repository to add as a submodule</div>
      </div>

      <div class="form-group">
        <label class="form-label">Path</label>
        <input
          type="text"
          class="form-input"
          placeholder="lib/my-submodule"
          .value=${this.addPath}
          @input=${(e: Event) => {
            this.addPath = (e.target as HTMLInputElement).value;
          }}
        />
        <div class="form-hint">Where to place the submodule in your repository</div>
      </div>

      <div class="form-group">
        <label class="form-label">Branch (optional)</label>
        <input
          type="text"
          class="form-input"
          placeholder="main"
          .value=${this.addBranch}
          @input=${(e: Event) => {
            this.addBranch = (e.target as HTMLInputElement).value;
          }}
        />
        <div class="form-hint">Track a specific branch instead of the default</div>
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
                <path d="M3 3h18v18H3z"/>
                <path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>
              </svg>
              ${this.mode === 'list' ? 'Submodules' : 'Add Submodule'}
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
                  <button class="btn btn-primary" @click=${() => { this.mode = 'add'; this.error = ''; this.success = ''; }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="12" y1="5" x2="12" y2="19"/>
                      <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Add Submodule
                  </button>
                  <div class="dialog-footer-right">
                    <button class="btn btn-secondary" @click=${this.handleClose}>Close</button>
                  </div>
                `
              : html`
                  <button class="btn btn-secondary" @click=${() => { this.mode = 'list'; this.error = ''; }}>
                    Cancel
                  </button>
                  <div class="dialog-footer-right">
                    <button
                      class="btn btn-primary"
                      @click=${this.handleAdd}
                      ?disabled=${this.loading || !this.addUrl || !this.addPath}
                    >
                      Add Submodule
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
    'lv-submodule-dialog': LvSubmoduleDialog;
  }
}
