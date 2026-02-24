/**
 * Reflog Browser Dialog
 * Shows reflog entries and allows undo operations
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import type { ReflogEntry } from '../../types/git.types.ts';
import { showConfirm } from '../../services/dialog.service.ts';
import { showToast } from '../../services/notification.service.ts';

interface ReflogContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  entry: ReflogEntry | null;
}

@customElement('lv-reflog-dialog')
export class LvReflogDialog extends LitElement {
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
        width: 700px;
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
        color: var(--color-primary);
      }

      .title {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }

      .subtitle {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
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

      .content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-sm);
      }

      .loading, .empty {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
      }

      .entry-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .entry {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-md);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background var(--transition-fast);
      }

      .entry:hover {
        background: var(--color-bg-hover);
      }

      .entry.selected {
        background: var(--color-bg-selected);
      }

      .entry-index {
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        min-width: 50px;
        flex-shrink: 0;
      }

      .entry-main {
        flex: 1;
        min-width: 0;
      }

      .entry-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin-bottom: 2px;
      }

      .entry-oid {
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        color: var(--color-primary);
        background: var(--color-bg-tertiary);
        padding: 2px 6px;
        border-radius: var(--radius-sm);
      }

      .entry-action {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
        text-transform: capitalize;
      }

      .entry-message {
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .entry-meta {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        margin-top: 4px;
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .entry-actions {
        display: flex;
        gap: var(--spacing-xs);
        flex-shrink: 0;
        opacity: 0;
        transition: opacity var(--transition-fast);
      }

      .entry:hover .entry-actions {
        opacity: 1;
      }

      .reset-btn {
        padding: var(--spacing-xs) var(--spacing-sm);
        font-size: var(--font-size-xs);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: all var(--transition-fast);
        border: 1px solid var(--color-border);
        background: var(--color-bg-tertiary);
        color: var(--color-text-primary);
      }

      .reset-btn:hover {
        background: var(--color-primary);
        border-color: var(--color-primary);
        color: white;
      }

      .reset-btn.hard {
        border-color: var(--color-error);
        color: var(--color-error);
      }

      .reset-btn.hard:hover {
        background: var(--color-error);
        color: white;
      }

      .current-badge {
        font-size: var(--font-size-xs);
        padding: 2px 6px;
        background: var(--color-success-bg);
        color: var(--color-success);
        border-radius: var(--radius-sm);
        font-weight: var(--font-weight-medium);
      }

      .help-text {
        padding: var(--spacing-sm) var(--spacing-md);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        border-top: 1px solid var(--color-border);
        background: var(--color-bg-tertiary);
      }

      .help-text strong {
        color: var(--color-text-secondary);
      }

      /* Context menu */
      .context-menu {
        position: fixed;
        z-index: var(--z-dropdown, 300);
        min-width: 180px;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        padding: var(--spacing-xs) 0;
      }

      .context-menu-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        width: 100%;
        padding: var(--spacing-xs) var(--spacing-md);
        border: none;
        background: none;
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        text-align: left;
        cursor: pointer;
      }

      .context-menu-item:hover {
        background: var(--color-bg-hover);
      }

      .context-menu-item svg {
        width: 14px;
        height: 14px;
        color: var(--color-text-muted);
      }

      .context-menu-divider {
        height: 1px;
        background: var(--color-border);
        margin: var(--spacing-xs) 0;
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) repositoryPath = '';

  @state() private entries: ReflogEntry[] = [];
  @state() private loading = false;
  @state() private selectedIndex: number | null = null;
  @state() private resetting = false;
  @state() private contextMenu: ReflogContextMenuState = { visible: false, x: 0, y: 0, entry: null };

  private handleDocumentClick = (): void => {
    if (this.contextMenu.visible) {
      this.contextMenu = { ...this.contextMenu, visible: false };
    }
  };

  async updated(changedProps: Map<string, unknown>): Promise<void> {
    if (changedProps.has('open') && this.open) {
      await this.loadReflog();
    }
  }

  private async loadReflog(): Promise<void> {
    if (!this.repositoryPath) return;

    this.loading = true;
    this.entries = [];

    try {
      const result = await gitService.getReflog(this.repositoryPath, 50);
      if (result.success && result.data) {
        this.entries = result.data;
      }
    } catch (err) {
      console.error('Failed to load reflog:', err);
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
    document.addEventListener('click', this.handleDocumentClick);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('click', this.handleDocumentClick);
  }

  public close(): void {
    this.open = false;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private async handleReset(entry: ReflogEntry, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    if (this.resetting) return;

    if (mode === 'hard') {
      const confirmed = await showConfirm('Hard Reset', `Are you sure you want to hard reset to ${entry.shortId}? This will discard all uncommitted changes.`, 'warning');
      if (!confirmed) return;
    } else {
      const confirmed = await showConfirm(`${mode.charAt(0).toUpperCase() + mode.slice(1)} Reset`, `Reset HEAD to ${entry.shortId} using ${mode} mode?`, 'info');
      if (!confirmed) return;
    }

    this.resetting = true;

    try {
      const result = await gitService.resetToReflog(this.repositoryPath, entry.index, mode);

      if (result.success) {
        showToast(`Reset to ${entry.shortId} (${mode})`, 'success');
        this.dispatchEvent(new CustomEvent('undo-complete', {
          detail: { entry: result.data, mode },
          bubbles: true,
          composed: true,
        }));
        this.close();
      } else {
        console.error('Reset failed:', result.error);
        showToast(`Reset failed: ${result.error?.message ?? 'Unknown error'}`, 'error');
      }
    } catch (err) {
      console.error('Reset failed:', err);
      showToast('Reset failed', 'error');
    } finally {
      this.resetting = false;
    }
  }

  private formatDate(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  // Context menu handlers
  private handleEntryContextMenu(e: MouseEvent, entry: ReflogEntry): void {
    e.preventDefault();
    e.stopPropagation();
    this.contextMenu = { visible: true, x: e.clientX, y: e.clientY, entry };
  }

  private handleContextCheckout(): void {
    const entry = this.contextMenu.entry;
    if (!entry) return;
    this.contextMenu = { ...this.contextMenu, visible: false };
    this.handleReset(entry, 'mixed');
  }

  private async handleContextCopyHash(): Promise<void> {
    const entry = this.contextMenu.entry;
    if (!entry) return;
    this.contextMenu = { ...this.contextMenu, visible: false };
    try {
      await navigator.clipboard.writeText(entry.oid);
    } catch (err) {
      console.error('Failed to copy hash:', err);
    }
  }

  private handleContextShowCommit(): void {
    const entry = this.contextMenu.entry;
    if (!entry) return;
    this.contextMenu = { ...this.contextMenu, visible: false };
    this.dispatchEvent(new CustomEvent('show-commit', {
      detail: { oid: entry.oid },
      bubbles: true,
      composed: true,
    }));
  }

  private renderEntry(entry: ReflogEntry) {
    const isCurrent = entry.index === 0;

    return html`
      <div
        class="entry ${this.selectedIndex === entry.index ? 'selected' : ''}"
        @click=${() => { this.selectedIndex = entry.index; }}
        @contextmenu=${(e: MouseEvent) => this.handleEntryContextMenu(e, entry)}
      >
        <span class="entry-index">HEAD@{${entry.index}}</span>

        <div class="entry-main">
          <div class="entry-header">
            <span class="entry-oid">${entry.shortId}</span>
            <span class="entry-action">${entry.action}</span>
            ${isCurrent ? html`<span class="current-badge">Current</span>` : nothing}
          </div>
          <div class="entry-message">${entry.message}</div>
          <div class="entry-meta">
            <span>${entry.author}</span>
            <span>${this.formatDate(entry.timestamp)}</span>
          </div>
        </div>

        ${!isCurrent ? html`
          <div class="entry-actions">
            <button
              class="reset-btn"
              @click=${(e: Event) => { e.stopPropagation(); this.handleReset(entry, 'mixed'); }}
              ?disabled=${this.resetting}
              title="Reset (keep changes unstaged)"
            >
              Undo
            </button>
            <button
              class="reset-btn hard"
              @click=${(e: Event) => { e.stopPropagation(); this.handleReset(entry, 'hard'); }}
              ?disabled=${this.resetting}
              title="Hard reset (discard all changes)"
            >
              Hard
            </button>
          </div>
        ` : nothing}
      </div>
    `;
  }

  render() {
    return html`
      <div class="overlay" @click=${this.handleOverlayClick}></div>
      <div class="dialog">
        <div class="header">
          <div class="header-left">
            <svg class="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="1 4 1 10 7 10"></polyline>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
            </svg>
            <div>
              <div class="title">Undo History</div>
              <div class="subtitle">Reflog - recover previous states</div>
            </div>
          </div>
          <button class="close-btn" @click=${this.close}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="content">
          ${this.loading
            ? html`<div class="loading">Loading reflog...</div>`
            : this.entries.length === 0
              ? html`<div class="empty">No reflog entries found</div>`
              : html`
                  <div class="entry-list">
                    ${this.entries.map(entry => this.renderEntry(entry))}
                  </div>
                `}
        </div>

        <div class="help-text">
          <strong>Undo</strong> resets HEAD but keeps your changes. <strong>Hard</strong> discards all changes.
        </div>
      </div>
      ${this.renderContextMenu()}
    `;
  }

  private renderContextMenu() {
    if (!this.contextMenu.visible || !this.contextMenu.entry) return nothing;

    const { x, y, entry } = this.contextMenu;
    const isCurrent = entry.index === 0;

    return html`
      <div class="context-menu" style="left: ${x}px; top: ${y}px">
        ${!isCurrent ? html`
          <button class="context-menu-item" @click=${this.handleContextCheckout}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="1 4 1 10 7 10"></polyline>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
            </svg>
            Undo to this state
          </button>
          <div class="context-menu-divider"></div>
        ` : nothing}
        <button class="context-menu-item" @click=${this.handleContextShowCommit}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"></circle>
            <line x1="12" y1="3" x2="12" y2="9"></line>
            <line x1="12" y1="15" x2="12" y2="21"></line>
          </svg>
          Show commit details
        </button>
        <button class="context-menu-item" @click=${this.handleContextCopyHash}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          Copy commit hash
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-reflog-dialog': LvReflogDialog;
  }
}
