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
import { isTopOverlay } from '../../utils/overlay-stack.ts';
import {
  tryAcquireRefOp,
  releaseRefOp,
  isRefOpRunning,
  subscribeRefOps,
} from '../../utils/ref-lock.ts';

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
  /**
   * The working-tree lock, shared with app-shell and the other sidebar lists.
   *
   * This was a component-local boolean, so a hard reset started from the graph
   * and a checkout started here ran concurrently against the same working
   * tree. See utils/ref-lock.ts.
   */
  @state() private refOpsVersion = 0;
  private unsubscribeRefOps?: () => void;

  private get operationInProgress(): boolean {
    void this.refOpsVersion;
    return isRefOpRunning(this.repositoryPath);
  }

  /**
   * Claim the lock for `repoPath`; false when it is already held.
   *
   * The path is passed explicitly rather than read from `this.repositoryPath`
   * at release time: the prop rebinds when the user switches repo tabs
   * mid-operation, so a release that re-read it would free the WRONG repo's
   * lock and wedge the one that is actually running.
   */
  private claimOperation(repoPath: string): boolean {
    return tryAcquireRefOp(repoPath);
  }

  private releaseOperation(repoPath: string): void {
    releaseRefOp(repoPath);
  }

  @state() private contextMenu: ContextMenuState = { visible: false, x: 0, y: 0, stash: null };

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    // Conflicted applies/pops complete inside the shared conflict dialog
    // (which drops the stash there), so reload when the app-level refresh
    // fires — otherwise the dropped entry stays listed.
    window.addEventListener('repository-refresh', this.handleRepositoryRefresh);
    await this.loadStashes();
    document.addEventListener('click', this.handleDocumentClick);
    document.addEventListener('keydown', this.handleKeydown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeRefOps?.();
    this.unsubscribeRefOps = undefined;
    window.removeEventListener('repository-refresh', this.handleRepositoryRefresh);
    document.removeEventListener('click', this.handleDocumentClick);
    document.removeEventListener('keydown', this.handleKeydown);
  }

  private handleRepositoryRefresh = (): void => {
    void this.loadStashes();
  };

  private handleDocumentClick = (): void => {
    if (this.contextMenu.visible) {
      this.contextMenu = { ...this.contextMenu, visible: false };
    }
  };

  private handleKeydown = (e: KeyboardEvent): void => {
    // A context menu must not eat an Escape aimed at a dialog opened over
    // it: every global keydown listener fires on the same keypress.
    if (!isTopOverlay(this)) return;
    if (e.key === 'Escape' && this.contextMenu.visible) {
      this.contextMenu = { ...this.contextMenu, visible: false };
    }
  };

  private handleContextMenuKeydown(e: KeyboardEvent): void {
    const menu = this.renderRoot.querySelector('.context-menu') as HTMLElement;
    if (!menu) return;

    const items = Array.from(menu.querySelectorAll('.context-menu-item:not([disabled])')) as HTMLElement[];
    const currentIndex = items.indexOf(e.target as HTMLElement);

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        items[next]?.focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        items[prev]?.focus();
        break;
      }
      case 'Escape':
        e.preventDefault();
        this.contextMenu = { ...this.contextMenu, visible: false };
        break;
    }
  }

  private handleStashItemKeydown(e: KeyboardEvent, stash: Stash): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.handleContextMenu(
        new MouseEvent('contextmenu', { clientX: 0, clientY: 0 }),
        stash,
      );
    }
  }

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
      } else {
        showToast(result.error?.message || 'Failed to load stashes', 'error');
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

    const repoPath = this.repositoryPath;
    try {
      const result = await gitService.createStash({
        path: repoPath,
        message: undefined,
        includeUntracked: true,
      });

      if (result.success) {
        if (result.data === null) {
          // Clean working tree: nothing to stash — informational, not an error.
          showToast('No local changes to save', 'info');
          return;
        }
        await this.loadStashes();
        this.dispatchEvent(new CustomEvent('stash-created', {
          detail: { repositoryPath: repoPath },
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

  /**
   * Re-resolve a stash captured at context-menu time to its CURRENT index in
   * `repoPath`'s stash list.
   *
   * `Stash.index` is a POSITION, not an identity: creating or dropping any
   * stash shifts every entry below it. The context menu caches the Stash object
   * from when it opened and survives list reloads — `repository-refresh`
   * reloads the list without closing the menu (handleRepositoryRefresh), and
   * only Escape or a click dismisses it — so the cached index can name a
   * different stash by the time the user clicks an action, or by the time a
   * confirm is dismissed. Match on `oid`, which is stable.
   *
   * Reads the list from `repoPath` rather than `this.stashes`: the caller pins
   * repoPath before its confirm, and on a mid-confirm tab switch `this.stashes`
   * holds the OTHER repo's entries — resolving against it would produce an
   * index into the wrong list.
   *
   * Returns the live index, or null if the caller must abort (already toasted).
   */
  private async resolveStashIndex(
    repoPath: string,
    stash: Stash,
    action: 'applied' | 'popped' | 'dropped'
  ): Promise<number | null> {
    const result = await gitService.getStashes(repoPath);

    if (!result.success || !result.data) {
      showToast(
        result.error?.message ?? `Could not read the stash list — nothing was ${action}`,
        'error'
      );
      return null;
    }

    const index = result.data.findIndex(s => s.oid === stash.oid);

    if (index < 0) {
      showToast(
        `"${stash.message}" is no longer in the stash list — nothing was ${action}`,
        'warning'
      );
      await this.loadStashes();
      return null;
    }

    return index;
  }

  private async handleApplyStash(): Promise<void> {
    const stash = this.contextMenu.stash;
    if (!stash) return;
    const lockedRepo = this.repositoryPath;
    if (!this.claimOperation(lockedRepo)) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    // Captured BEFORE the await: the conflict event must carry the repo the
    // apply actually ran on, even if the prop is rebound mid-flight.
    const repoPath = this.repositoryPath;
    try {
      const index = await this.resolveStashIndex(repoPath, stash, 'applied');
      if (index === null) return;

      const result = await gitService.applyStash({
        path: repoPath,
        index,
        dropAfter: false,
      });

      if (result.success) {
        await this.loadStashes();
        this.dispatchEvent(new CustomEvent('stash-applied', {
          detail: { repositoryPath: repoPath },
          bubbles: true,
          composed: true,
        }));
      } else {
        console.error('Failed to apply stash:', result.error);
        showToast(result.error?.message ?? 'Failed to apply stash', 'error');
        // A conflicting apply left the changes in the working tree; open the
        // conflict resolution dialog. The stash was NOT dropped (apply, not pop),
        // so completion must keep it.
        if (this.isConflictError(result.error)) {
          this.dispatchEvent(new CustomEvent('open-conflict-dialog', {
            bubbles: true,
            composed: true,
            detail: {
              operationType: 'stash',
              stashIndex: index,
              dropStashOnComplete: false,
              repositoryPath: repoPath,
            },
          }));
        }
      }
    } finally {
      this.releaseOperation(lockedRepo);
    }
  }

  /** True when a stash apply/pop error indicates a merge conflict. */
  private isConflictError(error: { code?: string; message?: string } | undefined): boolean {
    if (!error) return false;
    // Prefer the structured error code; keep the message match as a fallback.
    if (error.code === 'MERGE_CONFLICT') return true;
    return !!error.message && error.message.toLowerCase().includes('conflict');
  }

  private async handlePopStash(): Promise<void> {
    const stash = this.contextMenu.stash;
    if (!stash) return;
    const lockedRepo = this.repositoryPath;
    if (!this.claimOperation(lockedRepo)) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    // Captured BEFORE the confirm await: stash.index is from THIS repo's list,
    // so the pop must run on this repo even if the user switches tabs while the
    // confirm is up — applying stash.index against another repo pops the wrong
    // stash.
    const repoPath = this.repositoryPath;
    const confirmed = await showConfirm(
      'Pop Stash',
      `This will apply the stash "${stash.message}" and remove it from the stash list. Any conflicts will need to be resolved manually. Continue?`,
      'warning'
    );
    if (!confirmed) {
      this.releaseOperation(lockedRepo);
      return;
    }


    try {
      const index = await this.resolveStashIndex(repoPath, stash, 'popped');
      if (index === null) return;

      const result = await gitService.popStash({
        path: repoPath,
        index,
      });

      if (result.success) {
        await this.loadStashes();
        this.dispatchEvent(new CustomEvent('stash-applied', {
          detail: { repositoryPath: repoPath },
          bubbles: true,
          composed: true,
        }));
      } else {
        console.error('Failed to pop stash:', result.error);
        showToast(result.error?.message ?? 'Failed to pop stash', 'error');
        // A conflicting pop left the changes in the working tree AND left the
        // stash entry in place. Open the conflict resolution dialog; completion
        // must drop the stash (pop semantics) once conflicts are resolved.
        if (this.isConflictError(result.error)) {
          this.dispatchEvent(new CustomEvent('open-conflict-dialog', {
            bubbles: true,
            composed: true,
            detail: {
              operationType: 'stash',
              stashIndex: index,
              dropStashOnComplete: true,
              repositoryPath: repoPath,
            },
          }));
        }
      }
    } finally {
      this.releaseOperation(lockedRepo);
    }
  }

  private async handleDropStash(): Promise<void> {
    const stash = this.contextMenu.stash;
    if (!stash) return;
    const lockedRepo = this.repositoryPath;
    if (!this.claimOperation(lockedRepo)) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    // Captured BEFORE the confirm await: dropping is irreversible and stash.index
    // is from THIS repo's list, so it must target this repo even if the user
    // switches tabs while the confirm is up — otherwise a different, unrelated
    // stash is dropped in the wrong repo.
    const repoPath = this.repositoryPath;
    const confirmed = await showConfirm(
      'Drop Stash',
      `Are you sure you want to drop "${stash.message}"?\n\nThis action cannot be undone.`,
      'warning'
    );

    if (!confirmed) {
      this.releaseOperation(lockedRepo);
      return;
    }


    try {
      const index = await this.resolveStashIndex(repoPath, stash, 'dropped');
      if (index === null) return;

      const result = await gitService.dropStash({
        path: repoPath,
        index,
      });

      if (result.success) {
        await this.loadStashes();
        this.dispatchEvent(new CustomEvent('stash-dropped', {
          detail: { stash, repositoryPath: repoPath },
          bubbles: true,
          composed: true,
        }));
      } else {
        console.error('Failed to drop stash:', result.error);
        showToast(result.error?.message ?? 'Failed to drop stash', 'error');
      }
    } finally {
      this.releaseOperation(lockedRepo);
    }
  }

  private renderContextMenu() {
    if (!this.contextMenu.visible || !this.contextMenu.stash) return nothing;

    return html`
      <div
        class="context-menu"
        role="menu"
        aria-label="Stash actions"
        style="left: ${this.contextMenu.x}px; top: ${this.contextMenu.y}px;"
        @click=${(e: Event) => e.stopPropagation()}
        @keydown=${(e: KeyboardEvent) => this.handleContextMenuKeydown(e)}
      >
        <button class="context-menu-item" role="menuitem" ?disabled=${this.operationInProgress} @click=${this.handleApplyStash}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Apply
        </button>
        <button class="context-menu-item" role="menuitem" ?disabled=${this.operationInProgress} @click=${this.handlePopStash}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 3v18"></path>
            <path d="M5 8l7-7 7 7"></path>
          </svg>
          Pop
        </button>
        <div class="context-menu-divider" role="separator"></div>
        <button class="context-menu-item danger" role="menuitem" ?disabled=${this.operationInProgress} @click=${this.handleDropStash}>
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
              <ul class="stash-list" role="list">
                ${this.stashes.map((stash) => html`
                  <li
                    class="stash-item"
                    role="listitem"
                    tabindex="0"
                    aria-label="Stash: ${stash.message}"
                    @contextmenu=${(e: MouseEvent) => this.handleContextMenu(e, stash)}
                    @keydown=${(e: KeyboardEvent) => this.handleStashItemKeydown(e, stash)}
                  >
                    <svg class="stash-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
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
