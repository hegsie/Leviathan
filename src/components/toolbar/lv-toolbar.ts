/**
 * Main Toolbar Component
 * Contains menu buttons and repository tabs
 */

import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { repositoryStore, type OpenRepository } from '../../stores/index.ts';
import { openRepository, fetch as gitFetch, pull as gitPull, push as gitPush } from '../../services/git.service.ts';
import { openRepositoryDialog } from '../../services/dialog.service.ts';
import '../dialogs/lv-clone-dialog.ts';
import '../dialogs/lv-init-dialog.ts';
import './lv-search-bar.ts';
import type { LvCloneDialog } from '../dialogs/lv-clone-dialog.ts';
import type { LvInitDialog } from '../dialogs/lv-init-dialog.ts';
import type { LvSearchBar, SearchFilter } from './lv-search-bar.ts';

@customElement('lv-toolbar')
export class LvToolbar extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        height: 48px;
        padding-left: 78px; /* Space for macOS traffic light buttons */
        background: var(--color-bg-secondary);
        border-bottom: 1px solid var(--color-border);
        -webkit-app-region: drag;
      }

      .toolbar-section {
        display: flex;
        align-items: center;
        -webkit-app-region: no-drag;
      }

      .menu-buttons {
        display: flex;
        gap: var(--spacing-xs);
        padding: 0 var(--spacing-sm);
        border-right: 1px solid var(--color-border);
      }

      .menu-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .menu-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .menu-btn svg {
        width: 18px;
        height: 18px;
      }

      .logo {
        display: flex;
        align-items: center;
        padding: 0 var(--spacing-md);
        font-size: var(--font-size-lg);
        font-weight: 600;
        color: var(--color-text-primary);
      }

      .tabs {
        display: flex;
        flex: 1;
        overflow-x: auto;
        padding: 0 var(--spacing-sm);
        gap: var(--spacing-xs);
      }

      .tabs::-webkit-scrollbar {
        display: none;
      }

      .tab {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: 0 var(--spacing-sm);
        height: 32px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-text-secondary);
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition: all var(--transition-fast);
        white-space: nowrap;
        max-width: 200px;
      }

      .tab:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .tab.active {
        background: var(--color-bg-tertiary);
        color: var(--color-text-primary);
      }

      .tab-name {
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .tab-close {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: var(--radius-sm);
        opacity: 0.5;
        transition: opacity var(--transition-fast);
      }

      .tab:hover .tab-close {
        opacity: 1;
      }

      .tab-close:hover {
        background: var(--color-bg-hover);
      }

      .tab-close svg {
        width: 12px;
        height: 12px;
      }

      .spacer {
        flex: 1;
      }

      .no-repos {
        padding: 0 var(--spacing-md);
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
        font-style: italic;
      }

      .remote-buttons {
        display: flex;
        gap: var(--spacing-xs);
        padding: 0 var(--spacing-sm);
        border-left: 1px solid var(--color-border);
      }

      .remote-btn {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        height: 32px;
        padding: 0 var(--spacing-sm);
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-text-secondary);
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .remote-btn:hover:not(:disabled) {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .remote-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .remote-btn svg {
        width: 16px;
        height: 16px;
      }

      .remote-btn.loading svg {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .remote-btn-label {
        display: none;
      }

      @media (min-width: 800px) {
        .remote-btn-label {
          display: inline;
        }
      }
    `,
  ];

  @state() private openRepositories: OpenRepository[] = [];
  @state() private activeIndex = -1;
  @state() private isLoading = false;
  @state() private isFetching = false;
  @state() private isPulling = false;
  @state() private isPushing = false;

  @query('lv-clone-dialog') private cloneDialog!: LvCloneDialog;
  @query('lv-init-dialog') private initDialog!: LvInitDialog;
  @query('lv-search-bar') private searchBar!: LvSearchBar;

  @state() private showSearch = false;

  private unsubscribe?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    // Subscribe to store changes
    this.unsubscribe = repositoryStore.subscribe((state) => {
      this.openRepositories = state.openRepositories;
      this.activeIndex = state.activeIndex;
      this.isLoading = state.isLoading;
    });

    // Listen for focus-search event from app-shell
    this.addEventListener('focus-search', () => {
      this.showSearch = true;
      this.updateComplete.then(() => {
        this.searchBar?.focus();
      });
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }

  private async handleOpenRepo(): Promise<void> {
    console.log('handleOpenRepo called');
    try {
      const path = await openRepositoryDialog();
      console.log('Got path:', path);
      if (!path) return;

      const store = repositoryStore.getState();
      store.setLoading(true);

      try {
        const result = await openRepository({ path });
        if (result.success && result.data) {
          store.addRepository(result.data);
        } else {
          store.setError(result.error?.message ?? 'Failed to open repository');
        }
      } catch (err) {
        store.setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        store.setLoading(false);
      }
    } catch (error) {
      console.error('Error in handleOpenRepo:', error);
    }
  }

  private handleCloneRepo(): void {
    this.cloneDialog.open();
  }

  private handleInitRepo(): void {
    this.initDialog.open();
  }

  private handleTabClick(index: number): void {
    repositoryStore.getState().setActiveIndex(index);
  }

  private handleTabClose(e: Event, path: string): void {
    e.stopPropagation();
    repositoryStore.getState().removeRepository(path);
  }

  private get activeRepo(): OpenRepository | undefined {
    return this.openRepositories[this.activeIndex];
  }

  private async handleFetch(): Promise<void> {
    if (!this.activeRepo || this.isFetching) return;

    this.isFetching = true;
    try {
      const result = await gitFetch({ path: this.activeRepo.repository.path });
      if (!result.success) {
        repositoryStore.getState().setError(result.error?.message ?? 'Fetch failed');
      } else {
        // Refresh repository data after fetch
        this.dispatchEvent(new CustomEvent('repository-refresh', {
          bubbles: true,
          composed: true,
        }));
      }
    } catch (err) {
      repositoryStore.getState().setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      this.isFetching = false;
    }
  }

  private async handlePull(): Promise<void> {
    if (!this.activeRepo || this.isPulling) return;

    this.isPulling = true;
    try {
      const result = await gitPull({ path: this.activeRepo.repository.path });
      if (!result.success) {
        repositoryStore.getState().setError(result.error?.message ?? 'Pull failed');
      } else {
        this.dispatchEvent(new CustomEvent('repository-refresh', {
          bubbles: true,
          composed: true,
        }));
      }
    } catch (err) {
      repositoryStore.getState().setError(err instanceof Error ? err.message : 'Pull failed');
    } finally {
      this.isPulling = false;
    }
  }

  private async handlePush(): Promise<void> {
    if (!this.activeRepo || this.isPushing) return;

    this.isPushing = true;
    try {
      const result = await gitPush({ path: this.activeRepo.repository.path });
      if (!result.success) {
        repositoryStore.getState().setError(result.error?.message ?? 'Push failed');
      } else {
        this.dispatchEvent(new CustomEvent('repository-refresh', {
          bubbles: true,
          composed: true,
        }));
      }
    } catch (err) {
      repositoryStore.getState().setError(err instanceof Error ? err.message : 'Push failed');
    } finally {
      this.isPushing = false;
    }
  }

  private get isRemoteOperationInProgress(): boolean {
    return this.isFetching || this.isPulling || this.isPushing;
  }

  private handleToggleSearch(): void {
    this.showSearch = !this.showSearch;
    if (this.showSearch) {
      this.updateComplete.then(() => {
        this.searchBar?.focus();
      });
    }
  }

  private handleSearchChange(e: CustomEvent<{ filter: SearchFilter }>): void {
    this.dispatchEvent(new CustomEvent('search-change', {
      detail: e.detail,
      bubbles: true,
      composed: true,
    }));
  }

  private handleSearchClose(): void {
    this.showSearch = false;
    // Clear search
    this.dispatchEvent(new CustomEvent('search-change', {
      detail: { filter: { query: '', author: '', dateFrom: '', dateTo: '' } },
      bubbles: true,
      composed: true,
    }));
  }

  private handleOpenSettings(): void {
    this.dispatchEvent(new CustomEvent('open-settings', {
      bubbles: true,
      composed: true,
    }));
  }

  private handleOpenCommandPalette(): void {
    this.dispatchEvent(new CustomEvent('open-command-palette', {
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    return html`
      <lv-clone-dialog></lv-clone-dialog>
      <lv-init-dialog></lv-init-dialog>

      <div class="toolbar-section menu-buttons">
        <button
          class="menu-btn"
          title="Open Repository"
          @click=${this.handleOpenRepo}
          ?disabled=${this.isLoading}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
        </button>
        <button
          class="menu-btn"
          title="Clone Repository"
          @click=${this.handleCloneRepo}
          ?disabled=${this.isLoading}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            <polyline points="10 9 13 12 10 15"></polyline>
          </svg>
        </button>
        <button
          class="menu-btn"
          title="Init Repository"
          @click=${this.handleInitRepo}
          ?disabled=${this.isLoading}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      </div>

      <div class="logo">Leviathan</div>

      <div class="tabs toolbar-section">
        ${this.openRepositories.length === 0
          ? html`<span class="no-repos">No repositories open</span>`
          : this.openRepositories.map(
              (repo, index) => html`
                <button
                  class="tab ${index === this.activeIndex ? 'active' : ''}"
                  @click=${() => this.handleTabClick(index)}
                >
                  <span class="tab-name">${repo.repository.name}</span>
                  <span
                    class="tab-close"
                    @click=${(e: Event) => this.handleTabClose(e, repo.repository.path)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </span>
                </button>
              `
            )}
      </div>

      <div class="spacer"></div>

      <div class="toolbar-section">
        ${this.activeRepo ? html`
          <button
            class="menu-btn ${this.showSearch ? 'active' : ''}"
            title="Search commits (Ctrl+F)"
            @click=${this.handleToggleSearch}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="M21 21l-4.35-4.35"></path>
            </svg>
          </button>
        ` : ''}
        <button
          class="menu-btn"
          title="Command Palette (Cmd+P)"
          @click=${this.handleOpenCommandPalette}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="9" y1="9" x2="15" y2="9"></line>
            <line x1="9" y1="15" x2="15" y2="15"></line>
            <line x1="9" y1="12" x2="13" y2="12"></line>
          </svg>
        </button>
        <button
          class="menu-btn"
          title="Settings"
          @click=${this.handleOpenSettings}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      </div>

      ${this.showSearch && this.activeRepo ? html`
        <lv-search-bar
          @search-change=${this.handleSearchChange}
          @close=${this.handleSearchClose}
        ></lv-search-bar>
      ` : ''}

      ${this.activeRepo ? html`
        <div class="toolbar-section remote-buttons">
          <button
            class="remote-btn ${this.isFetching ? 'loading' : ''}"
            title="Fetch from remote"
            @click=${this.handleFetch}
            ?disabled=${this.isRemoteOperationInProgress}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <path d="M3 3v5h5"></path>
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
              <path d="M16 16h5v5"></path>
            </svg>
            <span class="remote-btn-label">Fetch</span>
          </button>
          <button
            class="remote-btn ${this.isPulling ? 'loading' : ''}"
            title="Pull from remote"
            @click=${this.handlePull}
            ?disabled=${this.isRemoteOperationInProgress}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 3v18"></path>
              <path d="M5 16l7 7 7-7"></path>
            </svg>
            <span class="remote-btn-label">Pull</span>
          </button>
          <button
            class="remote-btn ${this.isPushing ? 'loading' : ''}"
            title="Push to remote"
            @click=${this.handlePush}
            ?disabled=${this.isRemoteOperationInProgress}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 3v18"></path>
              <path d="M5 8l7-7 7 7"></path>
            </svg>
            <span class="remote-btn-label">Push</span>
          </button>
        </div>
      ` : ''}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-toolbar': LvToolbar;
  }
}
