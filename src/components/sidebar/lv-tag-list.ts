/**
 * Tag List Component
 * Displays and manages repository tags with filtering, sorting, and version grouping
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import { showConfirm } from '../../services/dialog.service.ts';
import { showToast } from '../../services/notification.service.ts';
import type { Tag } from '../../types/git.types.ts';
import '../dialogs/lv-create-tag-dialog.ts';
import type { LvCreateTagDialog } from '../dialogs/lv-create-tag-dialog.ts';

type TagSortMode = 'name' | 'date' | 'date-asc';

interface TagGroup {
  name: string;
  tags: Tag[];
}

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
        gap: 6px;
        padding: 2px 12px;
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

      /* Filter and sort controls */
      .controls {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 2px 4px;
        border-bottom: 1px solid var(--color-border);
      }

      .controls-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-text-secondary);
        cursor: pointer;
        padding: 0;
      }

      .controls-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .controls-btn.active {
        color: var(--color-primary);
        background: var(--color-primary-bg);
      }

      .controls-btn svg {
        width: 14px;
        height: 14px;
      }

      .filter-bar {
        display: flex;
        align-items: center;
        padding: 4px 8px;
        border-bottom: 1px solid var(--color-border);
        background: var(--color-bg-tertiary);
      }

      .filter-input {
        flex: 1;
        border: none;
        background: transparent;
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        outline: none;
        padding: 2px 0;
      }

      .filter-input::placeholder {
        color: var(--color-text-muted);
      }

      .filter-clear {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-text-muted);
        cursor: pointer;
        padding: 0;
      }

      .filter-clear:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
      }

      .filter-clear svg {
        width: 12px;
        height: 12px;
      }

      .sort-menu {
        position: absolute;
        z-index: var(--z-dropdown, 100);
        right: 4px;
        top: 28px;
        min-width: 140px;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        padding: var(--spacing-xs) 0;
      }

      .sort-option {
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

      .sort-option:hover {
        background: var(--color-bg-hover);
      }

      .sort-option.active {
        color: var(--color-primary);
      }

      .sort-option svg {
        width: 14px;
        height: 14px;
        color: var(--color-text-muted);
      }

      .sort-option.active svg {
        color: var(--color-primary);
      }

      /* Group headers */
      .group-header {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        cursor: pointer;
        user-select: none;
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
      }

      .group-header:hover {
        background: var(--color-bg-hover);
      }

      .chevron {
        width: 16px;
        height: 16px;
        transition: transform var(--transition-fast);
      }

      .chevron.expanded {
        transform: rotate(90deg);
      }

      .group-name {
        flex: 1;
        font-weight: var(--font-weight-medium);
      }

      .group-count {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        background: var(--color-bg-tertiary);
        padding: 1px 6px;
        border-radius: var(--radius-full);
      }
    `,
  ];

  @property({ type: String }) repositoryPath: string = '';

  @state() private tags: Tag[] = [];
  @state() private loading = true;
  @state() private contextMenu: ContextMenuState = { visible: false, x: 0, y: 0, tag: null };
  @state() private filterText = '';
  @state() private sortMode: TagSortMode = 'name';
  @state() private showFilter = false;
  @state() private showSortMenu = false;
  @state() private collapsedGroups = new Set<string>();

  @query('lv-create-tag-dialog') private createTagDialog!: LvCreateTagDialog;

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
    if (this.showSortMenu) {
      this.showSortMenu = false;
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
      showToast('Failed to load tags', 'error');
    } finally {
      this.loading = false;
    }
  }

  private filterTags(tags: Tag[]): Tag[] {
    if (!this.filterText) return tags;
    const lower = this.filterText.toLowerCase();
    return tags.filter((t) => t.name.toLowerCase().includes(lower));
  }

  private sortTags(tags: Tag[]): Tag[] {
    return [...tags].sort((a, b) => {
      switch (this.sortMode) {
        case 'date': {
          // Newest first; lightweight tags (no tagger) sort to end
          const aTime = a.tagger?.timestamp ?? 0;
          const bTime = b.tagger?.timestamp ?? 0;
          if (aTime === 0 && bTime === 0) return a.name.localeCompare(b.name);
          if (aTime === 0) return 1;
          if (bTime === 0) return -1;
          return bTime - aTime;
        }
        case 'date-asc': {
          // Oldest first; lightweight tags (no tagger) sort to end
          const aTime = a.tagger?.timestamp ?? 0;
          const bTime = b.tagger?.timestamp ?? 0;
          if (aTime === 0 && bTime === 0) return a.name.localeCompare(b.name);
          if (aTime === 0) return 1;
          if (bTime === 0) return -1;
          return aTime - bTime;
        }
        case 'name':
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }

  private groupTags(tags: Tag[]): TagGroup[] {
    const versionRegex = /^v?(\d+)\./;
    const groupMap = new Map<string, Tag[]>();

    for (const tag of tags) {
      const match = tag.name.match(versionRegex);
      const key = match ? `v${match[1]}.x` : 'Other';
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key)!.push(tag);
    }

    // If only one group, return flat (no headers needed)
    if (groupMap.size <= 1) {
      return [{ name: '', tags }];
    }

    // Sort groups: newest major version first, "Other" last
    const groups = Array.from(groupMap.entries()).map(([name, tags]) => ({ name, tags }));
    groups.sort((a, b) => {
      if (a.name === 'Other') return 1;
      if (b.name === 'Other') return -1;
      // Extract version number for comparison
      const aNum = parseInt(a.name.replace('v', ''));
      const bNum = parseInt(b.name.replace('v', ''));
      return bNum - aNum; // Newest first
    });

    return groups;
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

    const result = await gitService.checkoutWithAutoStash(this.repositoryPath, tag.name);

    if (result.success && result.data?.success) {
      const data = result.data;
      if (data.stashed && data.stashConflict) {
        showToast(`Switched to ${tag.name} — stash conflicts need resolution`, 'warning');
      } else if (data.stashed && data.stashApplied) {
        showToast(`Switched to ${tag.name} (changes re-applied)`, 'info');
      } else if (data.stashed && !data.stashApplied) {
        showToast(data.message, 'warning');
      }
      this.dispatchEvent(new CustomEvent('tag-checkout', {
        detail: { tag },
        bubbles: true,
        composed: true,
      }));
    } else {
      const errorMsg = result.data?.message || result.error || 'Unknown error';
      console.error('Failed to checkout tag:', errorMsg);
      showToast(`Failed to checkout tag: ${errorMsg}`, 'error');
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
      showToast(`Failed to delete tag: ${result.error?.message ?? 'Unknown error'}`, 'error');
    }
  }

  private handleTagClick(tag: Tag): void {
    this.dispatchEvent(new CustomEvent('tag-selected', {
      detail: { tag },
      bubbles: true,
      composed: true,
    }));
  }

  public openCreateTagDialog(targetRef?: string): void {
    this.createTagDialog.open(targetRef);
  }

  private handleCreateTagFromContext(): void {
    const tag = this.contextMenu.tag;
    this.contextMenu = { ...this.contextMenu, visible: false };
    // Open create tag dialog with the selected tag's target as the starting point
    this.createTagDialog.open(tag?.targetOid);
  }

  private async handleTagCreated(): Promise<void> {
    await this.loadTags();
    this.dispatchEvent(new CustomEvent('tags-changed', {
      bubbles: true,
      composed: true,
    }));
  }

  private async handlePushTag(): Promise<void> {
    const tag = this.contextMenu.tag;
    if (!tag) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    const result = await gitService.pushTag({
      path: this.repositoryPath,
      name: tag.name,
    });

    if (result.success) {
      this.dispatchEvent(new CustomEvent('tag-pushed', {
        detail: { tag },
        bubbles: true,
        composed: true,
      }));
    } else {
      console.error('Failed to push tag:', result.error);
      showToast(`Failed to push tag: ${result.error?.message ?? 'Unknown error'}`, 'error');
    }
  }

  private handleFilterInput(e: InputEvent): void {
    this.filterText = (e.target as HTMLInputElement).value;
  }

  private clearFilter(): void {
    this.filterText = '';
  }

  private toggleFilter(): void {
    this.showFilter = !this.showFilter;
    if (!this.showFilter) {
      this.filterText = '';
    }
  }

  private toggleSortMenu(e: Event): void {
    e.stopPropagation();
    this.showSortMenu = !this.showSortMenu;
  }

  private setSortMode(mode: TagSortMode): void {
    this.sortMode = mode;
    this.showSortMenu = false;
  }

  private toggleGroupCollapse(groupName: string): void {
    if (this.collapsedGroups.has(groupName)) {
      this.collapsedGroups.delete(groupName);
    } else {
      this.collapsedGroups.add(groupName);
    }
    this.requestUpdate();
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
        <button class="context-menu-item" @click=${this.handleCreateTagFromContext}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"></path>
            <line x1="7" y1="7" x2="7.01" y2="7"></line>
            <line x1="12" y1="8" x2="12" y2="14"></line>
            <line x1="9" y1="11" x2="15" y2="11"></line>
          </svg>
          Create Tag Here
        </button>
        <button class="context-menu-item" @click=${this.handlePushTag}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="19" x2="12" y2="5"></line>
            <polyline points="5 12 12 5 19 12"></polyline>
          </svg>
          Push to Remote
        </button>
        <div class="context-menu-divider" style="height: 1px; background: var(--color-border); margin: var(--spacing-xs) 0;"></div>
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

  private renderTagItem(tag: Tag) {
    return html`
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
    `;
  }

  private renderControls() {
    return html`
      <div class="controls" style="position: relative;">
        <button
          class="controls-btn ${this.showFilter ? 'active' : ''}"
          title="Filter tags"
          @click=${this.toggleFilter}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </button>
        <button
          class="controls-btn ${this.showSortMenu ? 'active' : ''}"
          title="Sort tags"
          @click=${(e: Event) => this.toggleSortMenu(e)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="4" y1="6" x2="20" y2="6"></line>
            <line x1="4" y1="12" x2="16" y2="12"></line>
            <line x1="4" y1="18" x2="12" y2="18"></line>
          </svg>
        </button>
        ${this.showSortMenu ? html`
          <div class="sort-menu" @click=${(e: Event) => e.stopPropagation()}>
            <button class="sort-option ${this.sortMode === 'name' ? 'active' : ''}" @click=${() => this.setSortMode('name')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 6h7M4 12h5M4 18h3M17 6v12M14 18l3 3 3-3"></path>
              </svg>
              Name (A-Z)
            </button>
            <button class="sort-option ${this.sortMode === 'date' ? 'active' : ''}" @click=${() => this.setSortMode('date')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              Date (Newest)
            </button>
            <button class="sort-option ${this.sortMode === 'date-asc' ? 'active' : ''}" @click=${() => this.setSortMode('date-asc')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              Date (Oldest)
            </button>
          </div>
        ` : nothing}
      </div>
      ${this.showFilter ? html`
        <div class="filter-bar">
          <svg style="width:14px;height:14px;color:var(--color-text-muted);margin-right:4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            class="filter-input"
            type="text"
            placeholder="Filter tags..."
            .value=${this.filterText}
            @input=${this.handleFilterInput}
          />
          ${this.filterText ? html`
            <button class="filter-clear" @click=${this.clearFilter}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          ` : nothing}
        </div>
      ` : nothing}
    `;
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">Loading tags...</div>`;
    }

    if (this.tags.length === 0) {
      return html`
        ${this.renderControls()}
        <div class="empty">No tags</div>
        <lv-create-tag-dialog
          .repositoryPath=${this.repositoryPath}
          @tag-created=${this.handleTagCreated}
        ></lv-create-tag-dialog>
      `;
    }

    const filtered = this.filterTags(this.tags);
    const sorted = this.sortTags(filtered);
    const groups = this.groupTags(sorted);

    return html`
      ${this.renderControls()}

      ${filtered.length === 0
        ? html`<div class="empty">No matching tags</div>`
        : groups.length === 1 && groups[0].name === ''
          ? html`
              <ul class="tag-list">
                ${groups[0].tags.map((tag) => this.renderTagItem(tag))}
              </ul>
            `
          : groups.map((group) => {
              const collapsed = this.collapsedGroups.has(group.name);
              return html`
                <div class="group-header" @click=${() => this.toggleGroupCollapse(group.name)}>
                  <svg class="chevron ${collapsed ? '' : 'expanded'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                  <span class="group-name">${group.name}</span>
                  <span class="group-count">${group.tags.length}</span>
                </div>
                ${!collapsed ? html`
                  <ul class="tag-list">
                    ${group.tags.map((tag) => this.renderTagItem(tag))}
                  </ul>
                ` : nothing}
              `;
            })}

      ${this.renderContextMenu()}

      <lv-create-tag-dialog
        .repositoryPath=${this.repositoryPath}
        @tag-created=${this.handleTagCreated}
      ></lv-create-tag-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-tag-list': LvTagList;
  }
}
