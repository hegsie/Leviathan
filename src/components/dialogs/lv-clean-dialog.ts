/**
 * Clean Dialog
 * Remove untracked and ignored files from the working directory
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import type { CleanEntry } from '../../services/git.service.ts';
import { showToast } from '../../services/notification.service.ts';

@customElement('lv-clean-dialog')
export class LvCleanDialog extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: var(--z-modal, 200);
      }

      :host([open]) {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(2px);
      }

      .dialog {
        position: relative;
        display: flex;
        flex-direction: column;
        width: 600px;
        max-width: 90vw;
        max-height: 80vh;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        overflow: hidden;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);
        background: var(--color-bg-tertiary);
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .header-icon {
        width: 20px;
        height: 20px;
        color: var(--color-warning);
      }

      .title {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }

      .close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .close-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .close-btn svg {
        width: 16px;
        height: 16px;
      }

      .warning-banner {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-warning-bg);
        border-bottom: 1px solid var(--color-border);
        color: var(--color-warning);
        font-size: var(--font-size-sm);
      }

      .warning-banner svg {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        margin-top: 2px;
      }

      .options {
        display: flex;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        border-bottom: 1px solid var(--color-border);
        background: var(--color-bg-tertiary);
      }

      .option {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
        cursor: pointer;
        user-select: none;
      }

      .option input {
        margin: 0;
      }

      .content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-sm);
      }

      .loading, .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--color-text-muted);
        text-align: center;
      }

      .empty svg {
        width: 48px;
        height: 48px;
        margin-bottom: var(--spacing-md);
        opacity: 0.5;
      }

      .file-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .file-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background var(--transition-fast);
      }

      .file-item:hover {
        background: var(--color-bg-hover);
      }

      .file-item.selected {
        background: var(--color-bg-selected);
      }

      .file-checkbox {
        margin: 0;
      }

      .file-icon {
        width: 16px;
        height: 16px;
        color: var(--color-text-muted);
        flex-shrink: 0;
      }

      .file-icon.directory {
        color: var(--color-warning);
      }

      .file-icon.ignored {
        color: var(--color-text-muted);
        opacity: 0.5;
      }

      .file-info {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .file-path {
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .file-badge {
        font-size: var(--font-size-xs);
        padding: 1px 6px;
        border-radius: var(--radius-sm);
        flex-shrink: 0;
      }

      .file-badge.ignored {
        background: var(--color-bg-tertiary);
        color: var(--color-text-muted);
      }

      .file-badge.directory {
        background: var(--color-warning-bg);
        color: var(--color-warning);
      }

      .file-size {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        flex-shrink: 0;
      }

      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md) var(--spacing-lg);
        border-top: 1px solid var(--color-border);
        background: var(--color-bg-tertiary);
      }

      .footer-left {
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
      }

      .footer-right {
        display: flex;
        gap: var(--spacing-sm);
      }

      .btn {
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-md);
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

      .btn-danger {
        background: var(--color-error);
        border: 1px solid var(--color-error);
        color: white;
      }

      .btn-danger:hover {
        background: var(--color-error-hover, #c0392b);
      }

      .btn-danger:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .select-all {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        border-bottom: 1px solid var(--color-border);
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
      }

      .select-all input {
        margin: 0;
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) repositoryPath = '';

  @state() private entries: CleanEntry[] = [];
  @state() private selectedPaths: Set<string> = new Set();
  @state() private loading = false;
  @state() private cleaning = false;
  @state() private includeIgnored = false;
  @state() private includeDirectories = true;

  async updated(changedProps: Map<string, unknown>): Promise<void> {
    if (changedProps.has('open') && this.open) {
      await this.loadFiles();
    }
  }

  private async loadFiles(): Promise<void> {
    if (!this.repositoryPath) return;

    this.loading = true;
    this.entries = [];
    this.selectedPaths = new Set();

    try {
      const result = await gitService.getCleanableFiles(
        this.repositoryPath,
        this.includeIgnored,
        this.includeDirectories
      );

      if (result.success && result.data) {
        this.entries = result.data;
        // Select all by default
        this.selectedPaths = new Set(this.entries.map(e => e.path));
      }
    } catch (err) {
      console.error('Failed to load cleanable files:', err);
      showToast('Failed to load cleanable files', 'error');
    } finally {
      this.loading = false;
    }
  }

  private handleOverlayClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) {
      this.close();
    }
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.close();
    }
  };

  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('keydown', this.handleKeyDown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  public close(): void {
    this.open = false;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private toggleEntry(path: string): void {
    const newSelected = new Set(this.selectedPaths);
    if (newSelected.has(path)) {
      newSelected.delete(path);
    } else {
      newSelected.add(path);
    }
    this.selectedPaths = newSelected;
  }

  private toggleAll(): void {
    if (this.selectedPaths.size === this.entries.length) {
      this.selectedPaths = new Set();
    } else {
      this.selectedPaths = new Set(this.entries.map(e => e.path));
    }
  }

  private async handleOptionChange(): Promise<void> {
    await this.loadFiles();
  }

  private async handleClean(): Promise<void> {
    if (this.selectedPaths.size === 0) return;

    this.cleaning = true;

    try {
      const paths = Array.from(this.selectedPaths);
      const result = await gitService.cleanFiles(this.repositoryPath, paths);

      if (result.success) {
        this.dispatchEvent(new CustomEvent('files-cleaned', {
          detail: { count: result.data },
          bubbles: true,
          composed: true,
        }));
        this.close();
      }
    } catch (err) {
      console.error('Clean failed:', err);
      showToast('Clean operation failed', 'error');
    } finally {
      this.cleaning = false;
    }
  }

  private formatSize(bytes: number | null): string {
    if (bytes === null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private getTotalSize(): number {
    return this.entries
      .filter(e => this.selectedPaths.has(e.path) && e.size !== null)
      .reduce((sum, e) => sum + (e.size ?? 0), 0);
  }

  private renderEntry(entry: CleanEntry) {
    const isSelected = this.selectedPaths.has(entry.path);

    return html`
      <div
        class="file-item ${isSelected ? 'selected' : ''}"
        @click=${() => this.toggleEntry(entry.path)}
      >
        <input
          type="checkbox"
          class="file-checkbox"
          .checked=${isSelected}
          @click=${(e: Event) => e.stopPropagation()}
          @change=${() => this.toggleEntry(entry.path)}
        />
        ${entry.isDirectory ? html`
          <svg class="file-icon directory" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"></path>
          </svg>
        ` : html`
          <svg class="file-icon ${entry.isIgnored ? 'ignored' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        `}
        <div class="file-info">
          <span class="file-path" title="${entry.path}">${entry.path}</span>
          ${entry.isIgnored ? html`<span class="file-badge ignored">ignored</span>` : nothing}
          ${entry.isDirectory ? html`<span class="file-badge directory">dir</span>` : nothing}
        </div>
        ${entry.size !== null ? html`
          <span class="file-size">${this.formatSize(entry.size)}</span>
        ` : nothing}
      </div>
    `;
  }

  render() {
    const allSelected = this.selectedPaths.size === this.entries.length && this.entries.length > 0;
    const someSelected = this.selectedPaths.size > 0;

    return html`
      <div class="overlay" @click=${this.handleOverlayClick}></div>
      <div class="dialog">
        <div class="header">
          <div class="header-left">
            <svg class="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
            </svg>
            <span class="title">Clean Working Directory</span>
          </div>
          <button class="close-btn" @click=${this.close}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="warning-banner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <span>This will permanently delete selected files. This action cannot be undone.</span>
        </div>

        <div class="options">
          <label class="option">
            <input
              type="checkbox"
              .checked=${this.includeIgnored}
              @change=${(e: Event) => {
                this.includeIgnored = (e.target as HTMLInputElement).checked;
                this.handleOptionChange();
              }}
            />
            Include ignored files
          </label>
          <label class="option">
            <input
              type="checkbox"
              .checked=${this.includeDirectories}
              @change=${(e: Event) => {
                this.includeDirectories = (e.target as HTMLInputElement).checked;
                this.handleOptionChange();
              }}
            />
            Include directories
          </label>
        </div>

        ${this.entries.length > 0 ? html`
          <div class="select-all">
            <input
              type="checkbox"
              .checked=${allSelected}
              .indeterminate=${someSelected && !allSelected}
              @change=${() => this.toggleAll()}
            />
            <span>Select all (${this.entries.length} ${this.entries.length === 1 ? 'item' : 'items'})</span>
          </div>
        ` : nothing}

        <div class="content">
          ${this.loading
            ? html`<div class="loading">Scanning for untracked files...</div>`
            : this.entries.length === 0
              ? html`
                  <div class="empty">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path>
                      <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                    <div>Working directory is clean</div>
                    <div style="font-size: var(--font-size-xs); margin-top: var(--spacing-xs);">
                      No untracked files to remove
                    </div>
                  </div>
                `
              : html`
                  <div class="file-list">
                    ${this.entries.map(entry => this.renderEntry(entry))}
                  </div>
                `
          }
        </div>

        <div class="footer">
          <div class="footer-left">
            ${someSelected ? html`
              ${this.selectedPaths.size} selected
              ${this.getTotalSize() > 0 ? html` (${this.formatSize(this.getTotalSize())})` : nothing}
            ` : html`No files selected`}
          </div>
          <div class="footer-right">
            <button class="btn btn-secondary" @click=${this.close}>Cancel</button>
            <button
              class="btn btn-danger"
              ?disabled=${!someSelected || this.cleaning}
              @click=${this.handleClean}
            >
              ${this.cleaning ? 'Cleaning...' : 'Delete Selected'}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-clean-dialog': LvCleanDialog;
  }
}
