/**
 * Tag List Component
 * Displays and manages repository tags
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import { showConfirm } from '../../services/dialog.service.ts';
import type { Tag } from '../../types/git.types.ts';

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  tag: Tag | null;
}

@customElement('lv-tag-list')
export class LvTagList extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      .tag-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .tag-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        cursor: pointer;
        font-size: var(--font-size-sm);
      }

      .tag-item:hover {
        background: var(--color-bg-hover);
      }

      .tag-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        color: var(--color-warning);
      }

      .tag-info {
        flex: 1;
        min-width: 0;
      }

      .tag-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tag-type {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .empty {
        padding: var(--spacing-sm);
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

      .context-menu-item:hover {
        background: var(--color-bg-hover);
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
    `,
  ];

  @property({ type: String }) repositoryPath: string = '';

  @state() private tags: Tag[] = [];
  @state() private loading = true;
  @state() private contextMenu: ContextMenuState = { visible: false, x: 0, y: 0, tag: null };

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    await this.loadTags();
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
      await this.loadTags();
    }
  }

  public async refresh(): Promise<void> {
    await this.loadTags();
  }

  private async loadTags(): Promise<void> {
    if (!this.repositoryPath) return;

    this.loading = true;

    try {
      const result = await gitService.getTags(this.repositoryPath);
      if (result.success) {
        this.tags = result.data!;
        // Emit count changed event
        this.dispatchEvent(new CustomEvent('tag-count-changed', {
          detail: { count: this.tags.length },
          bubbles: true,
          composed: true,
        }));
      }
    } catch (err) {
      console.error('Failed to load tags:', err);
    } finally {
      this.loading = false;
    }
  }

  private handleContextMenu(e: MouseEvent, tag: Tag): void {
    e.preventDefault();
    e.stopPropagation();

    this.contextMenu = {
      visible: true,
      x: e.clientX,
      y: e.clientY,
      tag,
    };
  }

  private async handleCheckoutTag(): Promise<void> {
    const tag = this.contextMenu.tag;
    if (!tag) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    const result = await gitService.checkout(this.repositoryPath, {
      ref: tag.name,
    });

    if (result.success) {
      this.dispatchEvent(new CustomEvent('tag-checkout', {
        detail: { tag },
        bubbles: true,
        composed: true,
      }));
    } else {
      console.error('Failed to checkout tag:', result.error);
    }
  }

  private async handleDeleteTag(): Promise<void> {
    const tag = this.contextMenu.tag;
    if (!tag) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    const confirmed = await showConfirm(
      'Delete Tag',
      `Are you sure you want to delete tag "${tag.name}"?\n\nThis action cannot be undone.`,
      'warning'
    );

    if (!confirmed) return;

    const result = await gitService.deleteTag({
      path: this.repositoryPath,
      name: tag.name,
    });

    if (result.success) {
      await this.loadTags();
      this.dispatchEvent(new CustomEvent('tags-changed', {
        bubbles: true,
        composed: true,
      }));
    } else {
      console.error('Failed to delete tag:', result.error);
    }
  }

  private handleTagClick(tag: Tag): void {
    this.dispatchEvent(new CustomEvent('tag-selected', {
      detail: { tag },
      bubbles: true,
      composed: true,
    }));
  }

  private renderContextMenu() {
    if (!this.contextMenu.visible || !this.contextMenu.tag) return nothing;

    return html`
      <div
        class="context-menu"
        style="left: ${this.contextMenu.x}px; top: ${this.contextMenu.y}px;"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <button class="context-menu-item" @click=${this.handleCheckoutTag}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Checkout
        </button>
        <button class="context-menu-item danger" @click=${this.handleDeleteTag}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
          </svg>
          Delete
        </button>
      </div>
    `;
  }

  render() {
    return html`
      ${this.loading
        ? html`<div class="loading">Loading tags...</div>`
        : this.tags.length === 0
          ? html`<div class="empty">No tags</div>`
          : html`
              <ul class="tag-list">
                ${this.tags.map((tag) => html`
                  <li
                    class="tag-item"
                    @click=${() => this.handleTagClick(tag)}
                    @contextmenu=${(e: MouseEvent) => this.handleContextMenu(e, tag)}
                    title="${tag.message || tag.name}"
                  >
                    <svg class="tag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"></path>
                      <line x1="7" y1="7" x2="7.01" y2="7"></line>
                    </svg>
                    <div class="tag-info">
                      <div class="tag-name">${tag.name}</div>
                      <div class="tag-type">${tag.isAnnotated ? 'annotated' : 'lightweight'}</div>
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
    'lv-tag-list': LvTagList;
  }
}
