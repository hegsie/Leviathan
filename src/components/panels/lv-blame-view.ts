import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { getFileBlame } from '../../services/git.service.ts';
import { formatRelativeTime } from '../../utils/format.ts';
import { tokenizeLine, detectLanguage, getTokenColor } from '../../utils/syntax-highlighter.ts';
import type { BlameLine } from '../../types/git.types.ts';

// Generate consistent color for author
function getAuthorColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 60%, 65%)`;
}

// Generate gravatar URL
function getGravatarUrl(email: string, size: number = 32): string {
  const hash = email.toLowerCase().trim();
  // Simple hash - in production you'd use MD5
  let hashCode = 0;
  for (let i = 0; i < hash.length; i++) {
    hashCode = hash.charCodeAt(i) + ((hashCode << 5) - hashCode);
  }
  return `https://www.gravatar.com/avatar/${Math.abs(hashCode).toString(16).padStart(32, '0')}?s=${size}&d=identicon`;
}

@customElement('lv-blame-view')
export class LvBlameView extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        font-family: var(--font-family-mono);
        font-size: var(--font-size-xs);

        /* Syntax highlighting colors */
        --syntax-keyword: #c678dd;
        --syntax-string: #98c379;
        --syntax-number: #d19a66;
        --syntax-comment: #5c6370;
        --syntax-operator: #56b6c2;
        --syntax-function: #61afef;
        --syntax-type: #e5c07b;
        --syntax-variable: #abb2bf;
        --syntax-punctuation: #abb2bf;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
        gap: var(--spacing-md);
      }

      .file-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        flex: 1;
        min-width: 0;
      }

      .file-icon {
        width: 16px;
        height: 16px;
        color: var(--color-text-muted);
        flex-shrink: 0;
      }

      .file-path {
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .commit-badge {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: 2px 8px;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        font-size: 11px;
        color: var(--color-text-secondary);
        flex-shrink: 0;
      }

      .commit-badge code {
        color: var(--color-primary);
        font-weight: var(--font-weight-medium);
      }

      .close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: none;
        background: transparent;
        color: var(--color-text-secondary);
        cursor: pointer;
        border-radius: var(--radius-sm);
        transition: all var(--transition-fast);
        flex-shrink: 0;
      }

      .close-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .close-btn svg {
        width: 16px;
        height: 16px;
      }

      .blame-content {
        flex: 1;
        overflow: auto;
      }

      .blame-table {
        width: 100%;
        min-width: max-content;
      }

      .blame-row {
        display: flex;
        min-height: 22px;
        line-height: 22px;
        border-bottom: 1px solid var(--color-border);
        transition: background-color 0.1s ease;
      }

      .blame-row:hover {
        background: var(--color-bg-hover);
      }

      .blame-row:hover .blame-info {
        opacity: 1 !important;
      }

      .blame-row.group-start {
        border-top: 2px solid var(--color-border);
      }

      .blame-row.group-start:first-child {
        border-top: none;
      }

      .blame-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        width: 320px;
        min-width: 320px;
        padding: 0 var(--spacing-sm);
        background: var(--color-bg-secondary);
        border-right: 1px solid var(--color-border);
        cursor: pointer;
        transition: opacity 0.15s ease;
      }

      .blame-info:hover {
        background: var(--color-bg-hover);
      }

      .blame-info.same-commit {
        opacity: 0.4;
      }

      .blame-info.same-commit .author-avatar,
      .blame-info.same-commit .commit-details {
        visibility: hidden;
      }

      .author-avatar {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        flex-shrink: 0;
        background: var(--color-bg-tertiary);
      }

      .commit-details {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        gap: 1px;
      }

      .commit-top-row {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
      }

      .commit-hash {
        font-size: 11px;
        color: var(--color-primary);
        font-weight: var(--font-weight-medium);
      }

      .commit-message {
        font-size: 11px;
        color: var(--color-text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1;
      }

      .commit-bottom-row {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        font-size: 10px;
        color: var(--color-text-muted);
      }

      .author-name {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 120px;
      }

      .commit-date {
        white-space: nowrap;
        flex-shrink: 0;
      }

      .line-number {
        width: 50px;
        min-width: 50px;
        padding: 0 var(--spacing-xs);
        text-align: right;
        color: var(--color-text-muted);
        background: var(--color-bg-secondary);
        border-right: 1px solid var(--color-border);
        user-select: none;
        flex-shrink: 0;
      }

      .line-content {
        flex: 1;
        padding: 0 var(--spacing-sm);
        white-space: pre;
        overflow-x: visible;
        color: var(--color-text-primary);
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--color-text-muted);
        gap: var(--spacing-sm);
      }

      .loading-spinner {
        width: 20px;
        height: 20px;
        border: 2px solid var(--color-border);
        border-top-color: var(--color-primary);
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .error {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--color-error);
        padding: var(--spacing-lg);
        text-align: center;
        gap: var(--spacing-sm);
      }

      .error-icon {
        width: 48px;
        height: 48px;
        opacity: 0.5;
      }

      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--color-text-muted);
        padding: var(--spacing-lg);
        text-align: center;
      }

      .stats-bar {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-xs) var(--spacing-md);
        background: var(--color-bg-secondary);
        border-bottom: 1px solid var(--color-border);
        font-size: 11px;
        color: var(--color-text-muted);
      }

      .stat {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
      }

      .stat-value {
        color: var(--color-text-primary);
        font-weight: var(--font-weight-medium);
      }

      /* Author color indicator */
      .author-indicator {
        width: 3px;
        align-self: stretch;
        flex-shrink: 0;
      }
    `,
  ];

  @property({ type: String }) repositoryPath = '';
  @property({ type: String }) filePath = '';
  @property({ type: String }) commitOid: string | null = null;

  @state() private lines: BlameLine[] = [];
  @state() private isLoading = false;
  @state() private error: string | null = null;

  private language: string | null = null;
  private authorColors: Map<string, string> = new Map();
  private uniqueAuthors: Set<string> = new Set();
  private uniqueCommits: Set<string> = new Set();

  updated(changedProps: Map<string, unknown>): void {
    if (
      changedProps.has('filePath') ||
      changedProps.has('repositoryPath') ||
      changedProps.has('commitOid')
    ) {
      this.loadBlame();
    }
  }

  private async loadBlame(): Promise<void> {
    if (!this.repositoryPath || !this.filePath) {
      this.lines = [];
      return;
    }

    this.isLoading = true;
    this.error = null;
    this.language = detectLanguage(this.filePath);

    try {
      const result = await getFileBlame(
        this.repositoryPath,
        this.filePath,
        this.commitOid ?? undefined
      );

      if (result.success && result.data) {
        this.lines = result.data.lines;
        this.processAuthors();
      } else {
        this.error = typeof result.error === 'string' ? result.error : 'Failed to load blame';
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to load blame';
    } finally {
      this.isLoading = false;
    }
  }

  private processAuthors(): void {
    this.authorColors.clear();
    this.uniqueAuthors.clear();
    this.uniqueCommits.clear();

    for (const line of this.lines) {
      this.uniqueAuthors.add(line.authorName);
      this.uniqueCommits.add(line.commitOid);
      if (!this.authorColors.has(line.authorName)) {
        this.authorColors.set(line.authorName, getAuthorColor(line.authorName));
      }
    }
  }

  private handleClose(): void {
    this.dispatchEvent(new CustomEvent('close'));
  }

  private handleCommitClick(line: BlameLine): void {
    this.dispatchEvent(
      new CustomEvent('commit-click', {
        detail: { oid: line.commitOid },
        bubbles: true,
        composed: true,
      })
    );
  }

  private shouldShowInfo(line: BlameLine, index: number): boolean {
    if (index === 0) return true;
    const prevLine = this.lines[index - 1];
    return prevLine.commitOid !== line.commitOid;
  }

  private renderHighlightedContent(content: string) {
    const tokens = tokenizeLine(content, this.language);
    return html`${tokens.map(
      (token) => html`<span style="color: ${getTokenColor(token.type)}">${token.value}</span>`
    )}`;
  }

  private getFileName(): string {
    return this.filePath.split('/').pop() || this.filePath;
  }

  render() {
    if (this.isLoading) {
      return html`
        <div class="header">
          <div class="file-info">
            <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <span class="file-path">${this.filePath}</span>
          </div>
          <button class="close-btn" @click=${this.handleClose} title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="loading">
          <div class="loading-spinner"></div>
          <span>Loading blame...</span>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div class="header">
          <div class="file-info">
            <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <span class="file-path">${this.filePath}</span>
          </div>
          <button class="close-btn" @click=${this.handleClose} title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="error">
          <svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>${this.error}</span>
        </div>
      `;
    }

    if (!this.filePath) {
      return html`<div class="empty">Select a file to view blame</div>`;
    }

    return html`
      <div class="header">
        <div class="file-info">
          <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <span class="file-path" title="${this.filePath}">${this.getFileName()}</span>
        </div>
        ${this.commitOid ? html`
          <div class="commit-badge">
            <span>at</span>
            <code>${this.commitOid.substring(0, 7)}</code>
          </div>
        ` : nothing}
        <button class="close-btn" @click=${this.handleClose} title="Close blame view (Esc)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div class="stats-bar">
        <div class="stat">
          <span>Lines:</span>
          <span class="stat-value">${this.lines.length}</span>
        </div>
        <div class="stat">
          <span>Authors:</span>
          <span class="stat-value">${this.uniqueAuthors.size}</span>
        </div>
        <div class="stat">
          <span>Commits:</span>
          <span class="stat-value">${this.uniqueCommits.size}</span>
        </div>
      </div>

      <div class="blame-content">
        <div class="blame-table">
          ${this.lines.map((line, index) => {
            const showInfo = this.shouldShowInfo(line, index);
            const authorColor = this.authorColors.get(line.authorName) || '#888';

            return html`
              <div class="blame-row ${showInfo ? 'group-start' : ''}">
                <div
                  class="author-indicator"
                  style="background: ${authorColor}"
                ></div>
                <div
                  class="blame-info ${showInfo ? '' : 'same-commit'}"
                  @click=${() => this.handleCommitClick(line)}
                  title="${line.summary}&#10;&#10;${line.authorName}&#10;${new Date(line.timestamp * 1000).toLocaleString()}"
                >
                  <img
                    class="author-avatar"
                    src="${getGravatarUrl(line.authorEmail, 40)}"
                    alt="${line.authorName}"
                    loading="lazy"
                  />
                  <div class="commit-details">
                    <div class="commit-top-row">
                      <span class="commit-hash">${line.commitShortId}</span>
                      <span class="commit-message">${line.summary}</span>
                    </div>
                    <div class="commit-bottom-row">
                      <span class="author-name" style="color: ${authorColor}">${line.authorName}</span>
                      <span>•</span>
                      <span class="commit-date">${formatRelativeTime(line.timestamp * 1000)}</span>
                    </div>
                  </div>
                </div>
                <div class="line-number">${line.lineNumber}</div>
                <div class="line-content">${this.renderHighlightedContent(line.content)}</div>
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-blame-view': LvBlameView;
  }
}
