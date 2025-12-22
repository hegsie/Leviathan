/**
 * Commit Details Panel
 * Shows detailed information about a selected commit
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import type { Commit, RefInfo, CommitFileEntry, FileStatus } from '../../types/git.types.ts';

@customElement('lv-commit-details')
export class LvCommitDetails extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }

      .header {
        padding: var(--spacing-md);
        border-bottom: 1px solid var(--color-border);
        background: var(--color-bg-secondary);
      }

      .header-title {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-md);
      }

      .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
      }

      .section {
        margin-bottom: var(--spacing-lg);
      }

      .section:last-child {
        margin-bottom: 0;
      }

      .section-title {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: var(--spacing-xs);
      }

      .commit-message {
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
        margin-bottom: var(--spacing-sm);
        line-height: 1.4;
      }

      .commit-body {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
        white-space: pre-wrap;
        line-height: 1.5;
      }

      .commit-oid {
        font-family: var(--font-family-mono);
        font-size: var(--font-size-sm);
        color: var(--color-primary);
        background: var(--color-bg-tertiary);
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--radius-sm);
        display: inline-block;
        user-select: all;
      }

      .meta-row {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-xs);
        font-size: var(--font-size-sm);
      }

      .meta-label {
        color: var(--color-text-muted);
        min-width: 80px;
        flex-shrink: 0;
      }

      .meta-value {
        color: var(--color-text-primary);
        word-break: break-word;
      }

      .refs {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-xs);
      }

      .ref-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px var(--spacing-sm);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
      }

      .ref-badge.local-branch {
        background: var(--color-success-bg, #dcfce7);
        color: var(--color-success, #16a34a);
      }

      .ref-badge.remote-branch {
        background: var(--color-info-bg, #dbeafe);
        color: var(--color-info, #2563eb);
      }

      .ref-badge.tag {
        background: var(--color-warning-bg, #fef3c7);
        color: var(--color-warning, #d97706);
      }

      .ref-badge.head {
        border: 1px solid currentColor;
      }

      .ref-icon {
        width: 12px;
        height: 12px;
      }

      .parents {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .parent-oid {
        font-family: var(--font-family-mono);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        cursor: pointer;
      }

      .parent-oid:hover {
        color: var(--color-primary);
        text-decoration: underline;
      }

      .timestamp {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      /* File list styles */
      .file-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .file-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-xs) var(--spacing-sm);
        margin: 0 calc(-1 * var(--spacing-sm));
        cursor: pointer;
        font-size: var(--font-size-sm);
        border-radius: var(--radius-sm);
      }

      .file-item:hover {
        background: var(--color-bg-hover);
      }

      .file-item.selected {
        background: var(--color-primary-bg);
      }

      .file-status {
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: var(--font-weight-bold);
        border-radius: 2px;
        flex-shrink: 0;
      }

      .file-status.new {
        background: var(--color-success-bg);
        color: var(--color-success);
      }

      .file-status.modified {
        background: var(--color-warning-bg);
        color: var(--color-warning);
      }

      .file-status.deleted {
        background: var(--color-error-bg);
        color: var(--color-error);
      }

      .file-status.renamed,
      .file-status.copied {
        background: var(--color-info-bg);
        color: var(--color-info);
      }

      .file-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--font-family-mono);
        font-size: var(--font-size-xs);
      }

      .file-stats {
        display: flex;
        gap: var(--spacing-xs);
        font-size: var(--font-size-xs);
        font-family: var(--font-family-mono);
      }

      .file-stats .additions {
        color: var(--color-success);
      }

      .file-stats .deletions {
        color: var(--color-error);
      }

      .file-actions {
        display: flex;
        gap: 4px;
        margin-left: auto;
        opacity: 0;
        transition: opacity 0.15s ease;
      }

      .file-item:hover .file-actions {
        opacity: 1;
      }

      .file-action {
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-sm);
        color: var(--color-primary);
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .file-action:hover {
        background: var(--color-primary);
        color: white;
        border-color: var(--color-primary);
      }

      .loading-files {
        color: var(--color-text-muted);
        font-size: var(--font-size-xs);
        font-style: italic;
      }
    `,
  ];

  @property({ type: String }) repositoryPath: string = '';
  @property({ type: Object }) commit: Commit | null = null;
  @property({ type: Array }) refs: RefInfo[] = [];

  @state() private files: CommitFileEntry[] = [];
  @state() private loadingFiles = false;
  @state() private selectedFilePath: string | null = null;

  private currentCommitOid: string | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    console.log('[commit-details] connectedCallback - initial state:', {
      repositoryPath: this.repositoryPath,
      commitOid: this.commit?.oid,
    });
  }

  updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);

    // Debug: log all property changes
    console.log('[commit-details] updated called, changedProperties:', [...changedProperties.keys()]);
    console.log('[commit-details] current state:', {
      repositoryPath: this.repositoryPath,
      commitOid: this.commit?.oid,
      currentCommitOid: this.currentCommitOid,
    });

    // Load files when commit changes
    if (changedProperties.has('commit') && this.commit && this.repositoryPath) {
      if (this.commit.oid !== this.currentCommitOid) {
        console.log('[commit-details] commit changed, loading files for:', this.commit.oid);
        this.currentCommitOid = this.commit.oid;
        this.selectedFilePath = null;
        this.loadFiles();
      }
    }
  }

  private async loadFiles(): Promise<void> {
    if (!this.repositoryPath || !this.commit) {
      console.log('loadFiles: missing repositoryPath or commit', { repositoryPath: this.repositoryPath, commit: this.commit?.oid });
      return;
    }

    console.log('loadFiles: loading files for commit', this.commit.oid);
    this.loadingFiles = true;
    this.files = [];

    try {
      const result = await gitService.getCommitFiles(this.repositoryPath, this.commit.oid);
      console.log('loadFiles: result', result);
      if (result.success && result.data) {
        this.files = result.data;
        console.log('loadFiles: loaded', this.files.length, 'files');
      } else {
        console.error('loadFiles: failed', result.error);
      }
    } catch (err) {
      console.error('Failed to load commit files:', err);
    } finally {
      this.loadingFiles = false;
    }
  }

  private formatDate(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp * 1000;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 30) {
      return this.formatDate(timestamp);
    } else if (days > 0) {
      return `${days} day${days > 1 ? 's' : ''} ago`;
    } else if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else {
      return 'just now';
    }
  }

  private handleParentClick(oid: string): void {
    this.dispatchEvent(
      new CustomEvent('select-commit', {
        detail: { oid },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleFileClick(file: CommitFileEntry): void {
    this.selectedFilePath = file.path;
    this.dispatchEvent(
      new CustomEvent('commit-file-selected', {
        detail: {
          commitOid: this.commit?.oid,
          filePath: file.path,
          status: file.status,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleBlameClick(file: CommitFileEntry, e: Event): void {
    e.stopPropagation();
    // Don't show blame for deleted files
    if (file.status === 'deleted') return;

    this.dispatchEvent(
      new CustomEvent('show-blame', {
        detail: {
          filePath: file.path,
          commitOid: this.commit?.oid,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private getRefClass(refType: string): string {
    switch (refType) {
      case 'localBranch':
        return 'local-branch';
      case 'remoteBranch':
        return 'remote-branch';
      case 'tag':
        return 'tag';
      default:
        return '';
    }
  }

  private getStatusLabel(status: FileStatus): string {
    const labels: Record<FileStatus, string> = {
      new: 'A',
      modified: 'M',
      deleted: 'D',
      renamed: 'R',
      copied: 'C',
      ignored: 'I',
      untracked: '?',
      typechange: 'T',
      conflicted: '!',
    };
    return labels[status] || '?';
  }

  private renderFileItem(file: CommitFileEntry) {
    const filename = file.path.split('/').pop() || file.path;
    const canBlame = file.status !== 'deleted';

    return html`
      <li
        class="file-item ${this.selectedFilePath === file.path ? 'selected' : ''}"
        @click=${() => this.handleFileClick(file)}
        title="${file.path}"
      >
        <span class="file-status ${file.status}">${this.getStatusLabel(file.status)}</span>
        <span class="file-name">${filename}</span>
        <span class="file-stats">
          ${file.additions > 0 ? html`<span class="additions">+${file.additions}</span>` : nothing}
          ${file.deletions > 0 ? html`<span class="deletions">-${file.deletions}</span>` : nothing}
        </span>
        <div class="file-actions">
          ${canBlame ? html`
            <button
              class="file-action"
              title="View file blame"
              @click=${(e: Event) => this.handleBlameClick(file, e)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          ` : nothing}
        </div>
      </li>
    `;
  }

  render() {
    if (!this.commit) {
      return html`
        <div class="header">
          <span class="header-title">Commit Details</span>
        </div>
        <div class="empty-state">Select a commit to view details</div>
      `;
    }

    return html`
      <div class="header">
        <span class="header-title">Commit Details</span>
      </div>

      <div class="content">
        <div class="section">
          <div class="commit-message">${this.commit.summary}</div>
          ${this.commit.body
            ? html`<div class="commit-body">${this.commit.body}</div>`
            : ''}
        </div>

        ${this.refs.length > 0
          ? html`
              <div class="section">
                <div class="section-title">Refs</div>
                <div class="refs">
                  ${this.refs.map(
                    (ref) => html`
                      <span class="ref-badge ${this.getRefClass(ref.refType)} ${ref.isHead ? 'head' : ''}">
                        ${ref.refType === 'tag'
                          ? html`<svg class="ref-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                              <line x1="7" y1="7" x2="7.01" y2="7"></line>
                            </svg>`
                          : html`<svg class="ref-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <line x1="6" y1="3" x2="6" y2="15"></line>
                              <circle cx="18" cy="6" r="3"></circle>
                              <circle cx="6" cy="18" r="3"></circle>
                              <path d="M18 9a9 9 0 0 1-9 9"></path>
                            </svg>`}
                        ${ref.shorthand}
                      </span>
                    `
                  )}
                </div>
              </div>
            `
          : ''}

        <div class="section">
          <div class="section-title">Files Changed (${this.files.length})</div>
          ${this.loadingFiles
            ? html`<div class="loading-files">Loading files...</div>`
            : this.files.length > 0
              ? html`
                  <ul class="file-list">
                    ${this.files.map((f) => this.renderFileItem(f))}
                  </ul>
                `
              : html`<div class="loading-files">No files changed</div>`}
        </div>

        <div class="section">
          <div class="section-title">SHA</div>
          <code class="commit-oid">${this.commit.oid}</code>
        </div>

        <div class="section">
          <div class="section-title">Author</div>
          <div class="meta-row">
            <span class="meta-value">${this.commit.author.name}</span>
          </div>
          <div class="meta-row">
            <span class="meta-value" style="color: var(--color-text-muted);">
              &lt;${this.commit.author.email}&gt;
            </span>
          </div>
          <div class="timestamp">
            ${this.formatRelativeTime(this.commit.author.timestamp)} &bull;
            ${this.formatDate(this.commit.author.timestamp)}
          </div>
        </div>

        ${this.commit.committer.email !== this.commit.author.email
          ? html`
              <div class="section">
                <div class="section-title">Committer</div>
                <div class="meta-row">
                  <span class="meta-value">${this.commit.committer.name}</span>
                </div>
                <div class="meta-row">
                  <span class="meta-value" style="color: var(--color-text-muted);">
                    &lt;${this.commit.committer.email}&gt;
                  </span>
                </div>
              </div>
            `
          : ''}

        ${this.commit.parentIds.length > 0
          ? html`
              <div class="section">
                <div class="section-title">
                  Parent${this.commit.parentIds.length > 1 ? 's' : ''}
                </div>
                <div class="parents">
                  ${this.commit.parentIds.map(
                    (oid) => html`
                      <code
                        class="parent-oid"
                        @click=${() => this.handleParentClick(oid)}
                      >
                        ${oid.substring(0, 7)}
                      </code>
                    `
                  )}
                </div>
              </div>
            `
          : ''}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-commit-details': LvCommitDetails;
  }
}
