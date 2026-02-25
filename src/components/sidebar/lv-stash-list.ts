/**
 * Stash List Component
 * Displays and manages stash entries
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import { showConfirm } from '../../services/dialog.service.ts';
import { showToast } from '../../services/notification.service.ts';
import type { Stash } from '../../types/git.types.ts';

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  stash: Stash | null;
}

@customElement('lv-stash-list')
export class LvStashList extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      .stash-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .stash-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 12px;
        cursor: pointer;
        font-size: var(--font-size-sm);
      }

      .stash-item:hover {
        background: var(--color-bg-hover);
      }

      .stash-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        color: var(--color-text-muted);
      }

      .stash-info {
        flex: 1;
        min-width: 0;
      }

      .stash-message {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .stash-index {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .empty {
        padding: 4px 8px;
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
        text-align: center;
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-md);
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
      }

      /* Context menu */
      .context-menu {
        position: fixed;
        z-index: var(--z-dropdown, 100);
        min-width: 140px;
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

      .context-menu-item:hover:not(:disabled) {
        background: var(--color-bg-hover);
      }

      .context-menu-item:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .context-menu-item.danger {
        color: var(--color-error);
      }

      .context-menu-item svg {
        width: 14px;
        height: 14px;
        color: var(--color-text-muted);
      }

      .context-menu-item.danger svg {
        color: var(--color-error);
      }

      .context-menu-divider {
        height: 1px;
        background: var(--color-border);
        margin: var(--spacing-xs) 0;
      }
    `,
  ];

  @property({ type: String }) repositoryPath: string = '';

  @state() private stashes: Stash[] = [];
  @state() private loading = true;
  @state() private isStashing = false;
  @state() private operationInProgress = false;
  @state() private contextMenu: ContextMenuState = { visible: false, x: 0, y: 0, stash: null };

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    await this.loadStashes();
    document.addEventListener('click', this.handleDocumentClick);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('click', this.handleDocumentClick);
  }

  private handleDocumentClick = (): void => {
    if (this.contextMenu.visible) {
      this.contextMenu = { ...this.contextMenu, visible: false };
    }
  };

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('repositoryPath') && this.repositoryPath) {
      await this.loadStashes();
    }
  }

  public async refresh(): Promise<void> {
    await this.loadStashes();
  }

  private async loadStashes(): Promise<void> {
    if (!this.repositoryPath) return;

    this.loading = true;

    try {
      const result = await gitService.getStashes(this.repositoryPath);
      if (result.success) {
        this.stashes = result.data!;
        // Emit count changed event
        this.dispatchEvent(new CustomEvent('stash-count-changed', {
          detail: { count: this.stashes.length },
          bubbles: true,
          composed: true,
        }));
      }
    } catch (err) {
      console.error('Failed to load stashes:', err);
      showToast('Failed to load stashes', 'error');
    } finally {
      this.loading = false;
    }
  }

  private async handleCreateStash(): Promise<void> {
    if (this.isStashing || !this.repositoryPath) return;

    this.isStashing = true;

    try {
      const result = await gitService.createStash({
        path: this.repositoryPath,
        message: undefined,
        includeUntracked: true,
      });

      if (result.success) {
        await this.loadStashes();
        this.dispatchEvent(new CustomEvent('stash-created', {
          bubbles: true,
          composed: true,
        }));
      } else {
        console.error('Failed to create stash:', result.error);
        showToast(result.error?.message ?? 'Failed to create stash', 'error');
      }
    } catch (err) {
      console.error('Failed to create stash:', err);
      showToast('Failed to create stash', 'error');
    } finally {
      this.isStashing = false;
    }
  }

  private handleContextMenu(e: MouseEvent, stash: Stash): void {
    e.preventDefault();
    e.stopPropagation();

    this.contextMenu = {
      visible: true,
      x: e.clientX,
      y: e.clientY,
      stash,
    };
  }

  private async handleApplyStash(): Promise<void> {
    const stash = this.contextMenu.stash;
    if (!stash || this.operationInProgress) return;

    this.contextMenu = { ...this.contextMenu, visible: false };
    this.operationInProgress = true;

    try {
      const result = await gitService.applyStash({
        path: this.repositoryPath,
        index: stash.index,
        dropAfter: false,
      });

      if (result.success) {
        await this.loadStashes();
        this.dispatchEvent(new CustomEvent('stash-applied', {
          bubbles: true,
          composed: true,
        }));
      } else {
        console.error('Failed to apply stash:', result.error);
        showToast(result.error?.message ?? 'Failed to apply stash', 'error');
      }
    } finally {
      this.operationInProgress = false;
    }
  }

  private async handlePopStash(): Promise<void> {
    const stash = this.contextMenu.stash;
    if (!stash || this.operationInProgress) return;

    this.contextMenu = { ...this.contextMenu, visible: false };
    this.operationInProgress = true;

    try {
      const result = await gitService.popStash({
        path: this.repositoryPath,
        index: stash.index,
      });

      if (result.success) {
        await this.loadStashes();
        this.dispatchEvent(new CustomEvent('stash-applied', {
          bubbles: true,
          composed: true,
        }));
      } else {
        console.error('Failed to pop stash:', result.error);
        showToast(result.error?.message ?? 'Failed to pop stash', 'error');
      }
    } finally {
      this.operationInProgress = false;
    }
  }

  private async handleDropStash(): Promise<void> {
    const stash = this.contextMenu.stash;
    if (!stash || this.operationInProgress) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    const confirmed = await showConfirm(
      'Drop Stash',
      `Are you sure you want to drop "${stash.message}"?\n\nThis action cannot be undone.`,
      'warning'
    );

    if (!confirmed) return;

    this.operationInProgress = true;

    try {
      const result = await gitService.dropStash({
        path: this.repositoryPath,
        index: stash.index,
      });

      if (result.success) {
        await this.loadStashes();
        this.dispatchEvent(new CustomEvent('stash-dropped', {
          detail: { stash },
          bubbles: true,
          composed: true,
        }));
      } else {
        console.error('Failed to drop stash:', result.error);
        showToast(result.error?.message ?? 'Failed to drop stash', 'error');
      }
    } finally {
      this.operationInProgress = false;
    }
  }

  private renderContextMenu() {
    if (!this.contextMenu.visible || !this.contextMenu.stash) return nothing;

    return html`
      <div
        class="context-menu"
        style="left: ${this.contextMenu.x}px; top: ${this.contextMenu.y}px;"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <button class="context-menu-item" ?disabled=${this.operationInProgress} @click=${this.handleApplyStash}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Apply
        </button>
        <button class="context-menu-item" ?disabled=${this.operationInProgress} @click=${this.handlePopStash}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 3v18"></path>
            <path d="M5 8l7-7 7 7"></path>
          </svg>
          Pop
        </button>
        <div class="context-menu-divider"></div>
        <button class="context-menu-item danger" ?disabled=${this.operationInProgress} @click=${this.handleDropStash}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
          </svg>
          Drop
        </button>
      </div>
    `;
  }

  render() {
    return html`
      ${this.loading
        ? html`<div class="loading">Loading stashes...</div>`
        : this.stashes.length === 0
          ? html`<div class="empty">No stashes</div>`
          : html`
              <ul class="stash-list">
                ${this.stashes.map((stash) => html`
                  <li
                    class="stash-item"
                    @contextmenu=${(e: MouseEvent) => this.handleContextMenu(e, stash)}
                  >
                    <svg class="stash-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                      <path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"></path>
                    </svg>
                    <div class="stash-info">
                      <div class="stash-message">${stash.message}</div>
                      <div class="stash-index">stash@{${stash.index}}</div>
                    </div>
                  </li>
                `)}
              </ul>
            `}

      ${this.renderContextMenu()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-stash-list': LvStashList;
  }
}
