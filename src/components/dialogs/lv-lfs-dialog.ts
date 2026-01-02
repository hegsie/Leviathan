/**
 * LFS Dialog Component
 * Manage Git Large File Storage
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import { handleExternalLink } from '../../utils/index.ts';
import type { LfsStatus, LfsFile } from '../../services/git.service.ts';

@customElement('lv-lfs-dialog')
export class LvLfsDialog extends LitElement {
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

      /* Status section */
      .status-section {
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        margin-bottom: var(--spacing-md);
      }

      .status-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--spacing-sm);
      }

      .status-title {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
      }

      .status-badge {
        padding: 2px 8px;
        border-radius: var(--radius-xs);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
      }

      .status-badge.enabled {
        background: var(--color-success-bg);
        color: var(--color-success);
      }

      .status-badge.disabled {
        background: var(--color-bg-secondary);
        color: var(--color-text-muted);
      }

      .status-badge.not-installed {
        background: var(--color-error-bg);
        color: var(--color-error);
      }

      .status-stats {
        display: flex;
        gap: var(--spacing-lg);
        margin-top: var(--spacing-sm);
      }

      .stat {
        text-align: center;
      }

      .stat-value {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-bold);
        color: var(--color-primary);
      }

      .stat-label {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      /* Patterns section */
      .section {
        margin-bottom: var(--spacing-lg);
      }

      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--spacing-sm);
      }

      .section-title {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
      }

      .pattern-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .pattern-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
      }

      .pattern-text {
        font-family: var(--font-family-mono);
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
      }

      .empty-text {
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
        font-style: italic;
      }

      /* Add pattern form */
      .add-form {
        display: flex;
        gap: var(--spacing-sm);
      }

      .add-input {
        flex: 1;
        padding: var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        font-family: var(--font-family-mono);
      }

      .add-input::placeholder {
        color: var(--color-text-muted);
      }

      /* Files list */
      .files-list {
        max-height: 200px;
        overflow-y: auto;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
      }

      .file-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs) var(--spacing-sm);
        border-bottom: 1px solid var(--color-border);
      }

      .file-item:last-child {
        border-bottom: none;
      }

      .file-status {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        flex-shrink: 0;
      }

      .file-status.downloaded {
        background: var(--color-success-bg);
        color: var(--color-success);
      }

      .file-status.pointer {
        background: var(--color-bg-tertiary);
        color: var(--color-text-muted);
      }

      .file-path {
        flex: 1;
        font-size: var(--font-size-xs);
        font-family: var(--font-family-mono);
        color: var(--color-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Actions */
      .actions {
        display: flex;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-md);
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

      .btn-sm {
        padding: var(--spacing-xs) var(--spacing-sm);
        font-size: var(--font-size-xs);
      }

      .btn-icon {
        padding: var(--spacing-xs);
        background: none;
        border: none;
        color: var(--color-text-secondary);
        cursor: pointer;
        border-radius: var(--radius-sm);
      }

      .btn-icon:hover {
        background: var(--color-bg-tertiary);
        color: var(--color-text-primary);
      }

      .btn-icon.danger:hover {
        background: var(--color-error-bg);
        color: var(--color-error);
      }

      .btn-icon svg {
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

      .message.warning {
        background: rgba(245, 158, 11, 0.1);
        border: 1px solid rgb(245, 158, 11);
        color: rgb(245, 158, 11);
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

  @state() private status: LfsStatus | null = null;
  @state() private files: LfsFile[] = [];
  @state() private loading = false;
  @state() private error = '';
  @state() private success = '';
  @state() private newPattern = '';
  @state() private showFiles = false;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    if (this.open) {
      await this.loadStatus();
    }
  }

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('open') && this.open) {
      await this.loadStatus();
    }
  }

  private async loadStatus(): Promise<void> {
    this.loading = true;
    this.error = '';

    const result = await gitService.getLfsStatus(this.repositoryPath);

    if (result.success && result.data) {
      this.status = result.data;
      if (result.data.enabled) {
        await this.loadFiles();
      }
    } else {
      this.error = result.error?.message || 'Failed to load LFS status';
    }

    this.loading = false;
  }

  private async loadFiles(): Promise<void> {
    const result = await gitService.getLfsFiles(this.repositoryPath);
    if (result.success && result.data) {
      this.files = result.data;
    }
  }

  private async handleInit(): Promise<void> {
    this.loading = true;
    this.error = '';

    const result = await gitService.initLfs(this.repositoryPath);

    if (result.success) {
      this.success = 'Git LFS initialized';
      await this.loadStatus();
      this.dispatchEvent(new CustomEvent('lfs-changed'));
    } else {
      this.error = result.error?.message || 'Failed to initialize LFS';
    }

    this.loading = false;
  }

  private async handleTrack(): Promise<void> {
    if (!this.newPattern) return;

    this.loading = true;
    this.error = '';

    const result = await gitService.lfsTrack(this.repositoryPath, this.newPattern);

    if (result.success) {
      this.newPattern = '';
      await this.loadStatus();
      this.dispatchEvent(new CustomEvent('lfs-changed'));
    } else {
      this.error = result.error?.message || 'Failed to track pattern';
    }

    this.loading = false;
  }

  private async handleUntrack(pattern: string): Promise<void> {
    this.loading = true;
    this.error = '';

    const result = await gitService.lfsUntrack(this.repositoryPath, pattern);

    if (result.success) {
      await this.loadStatus();
      this.dispatchEvent(new CustomEvent('lfs-changed'));
    } else {
      this.error = result.error?.message || 'Failed to untrack pattern';
    }

    this.loading = false;
  }

  private async handlePull(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.success = '';

    const result = await gitService.lfsPull(this.repositoryPath);

    if (result.success) {
      this.success = 'LFS files pulled successfully';
      await this.loadFiles();
    } else {
      this.error = result.error?.message || 'Failed to pull LFS files';
    }

    this.loading = false;
  }

  private async handlePrune(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.success = '';

    const result = await gitService.lfsPrune(this.repositoryPath);

    if (result.success) {
      this.success = result.data || 'LFS files pruned';
      await this.loadStatus();
    } else {
      this.error = result.error?.message || 'Failed to prune LFS files';
    }

    this.loading = false;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  private handleClose(): void {
    this.dispatchEvent(new CustomEvent('close'));
  }

  render() {
    if (!this.open) return null;

    return html`
      <div class="dialog-overlay" @click=${this.handleClose}>
        <div class="dialog" @click=${(e: Event) => e.stopPropagation()}>
          <div class="dialog-header">
            <span class="dialog-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <path d="M12 8v8m-4-4h8"/>
              </svg>
              Git LFS
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

            ${!this.loading && this.status ? this.renderContent() : ''}
          </div>

          <div class="dialog-footer">
            <button class="btn btn-secondary" @click=${this.handleClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderContent() {
    if (!this.status) return '';

    if (!this.status.installed) {
      return html`
        <div class="message warning">
          Git LFS is not installed. Please install it to manage large files.
          <br><br>
          <a href="https://git-lfs.github.io/" @click=${handleExternalLink} style="color: inherit; text-decoration: underline;">
            Learn more about Git LFS
          </a>
        </div>
      `;
    }

    return html`
      <div class="status-section">
        <div class="status-header">
          <span class="status-title">Status</span>
          <span class="status-badge ${this.status.enabled ? 'enabled' : 'disabled'}">
            ${this.status.enabled ? 'Enabled' : 'Not configured'}
          </span>
        </div>
        <div style="font-size: var(--font-size-xs); color: var(--color-text-muted);">
          ${this.status.version}
        </div>
        ${this.status.enabled
          ? html`
              <div class="status-stats">
                <div class="stat">
                  <div class="stat-value">${this.status.fileCount}</div>
                  <div class="stat-label">Files</div>
                </div>
                <div class="stat">
                  <div class="stat-value">${this.formatSize(this.status.totalSize)}</div>
                  <div class="stat-label">Total size</div>
                </div>
              </div>
            `
          : html`
              <div class="actions">
                <button class="btn btn-primary" @click=${this.handleInit} ?disabled=${this.loading}>
                  Initialize LFS
                </button>
              </div>
            `}
      </div>

      ${this.status.enabled
        ? html`
            <div class="section">
              <div class="section-header">
                <span class="section-title">Tracked Patterns</span>
              </div>
              <div class="pattern-list">
                ${this.status.patterns.length === 0
                  ? html`<span class="empty-text">No patterns configured</span>`
                  : this.status.patterns.map(
                      (p) => html`
                        <div class="pattern-item">
                          <span class="pattern-text">${p.pattern}</span>
                          <button
                            class="btn-icon danger"
                            title="Remove"
                            @click=${() => this.handleUntrack(p.pattern)}
                            ?disabled=${this.loading}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                              <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                          </button>
                        </div>
                      `
                    )}
              </div>
              <div class="add-form" style="margin-top: var(--spacing-sm);">
                <input
                  type="text"
                  class="add-input"
                  placeholder="*.psd, *.zip, images/**"
                  .value=${this.newPattern}
                  @input=${(e: Event) => {
                    this.newPattern = (e.target as HTMLInputElement).value;
                  }}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === 'Enter') this.handleTrack();
                  }}
                />
                <button
                  class="btn btn-primary btn-sm"
                  @click=${this.handleTrack}
                  ?disabled=${this.loading || !this.newPattern}
                >
                  Track
                </button>
              </div>
            </div>

            <div class="section">
              <div class="section-header">
                <span class="section-title">LFS Files (${this.files.length})</span>
                <button
                  class="btn btn-secondary btn-sm"
                  @click=${() => {
                    this.showFiles = !this.showFiles;
                  }}
                >
                  ${this.showFiles ? 'Hide' : 'Show'}
                </button>
              </div>
              ${this.showFiles
                ? html`
                    <div class="files-list">
                      ${this.files.length === 0
                        ? html`<div style="padding: var(--spacing-md); color: var(--color-text-muted); text-align: center;">
                            No LFS files
                          </div>`
                        : this.files.map(
                            (f) => html`
                              <div class="file-item">
                                <span class="file-status ${f.downloaded ? 'downloaded' : 'pointer'}">
                                  ${f.downloaded ? '&#10003;' : '&#8226;'}
                                </span>
                                <span class="file-path" title="${f.path}">${f.path}</span>
                              </div>
                            `
                          )}
                    </div>
                  `
                : ''}
            </div>

            <div class="actions">
              <button class="btn btn-secondary" @click=${this.handlePull} ?disabled=${this.loading}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Pull Files
              </button>
              <button class="btn btn-secondary" @click=${this.handlePrune} ?disabled=${this.loading}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
                Prune Old Files
              </button>
            </div>
          `
        : ''}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-lfs-dialog': LvLfsDialog;
  }
}
