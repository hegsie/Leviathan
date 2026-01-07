/**
 * Main Toolbar Component
 * Contains menu buttons and repository tabs
 */

import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { repositoryStore, type OpenRepository } from '../../stores/index.ts';
import { openRepository } from '../../services/git.service.ts';
import { openRepositoryDialog } from '../../services/dialog.service.ts';
import { showToast } from '../../services/notification.service.ts';
import { loggers } from '../../utils/logger.ts';

const log = loggers.ui;
import '../dialogs/lv-clone-dialog.ts';
import '../dialogs/lv-init-dialog.ts';
import './lv-search-bar.ts';
// Profile selector moved to context dashboard
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

      .tabs-container {
        display: flex;
        align-items: center;
        flex: 1;
        min-width: 0;
        position: relative;
      }

      .tabs {
        display: flex;
        flex: 1;
        overflow-x: hidden;
        padding: 0 var(--spacing-xs);
        gap: var(--spacing-xs);
        scroll-behavior: smooth;
      }

      .scroll-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border: none;
        border-radius: var(--radius-sm);
        background: var(--color-bg-tertiary);
        color: var(--color-text-secondary);
        cursor: pointer;
        flex-shrink: 0;
        transition: all var(--transition-fast);
        opacity: 0;
        pointer-events: none;
      }

      .scroll-btn.visible {
        opacity: 1;
        pointer-events: auto;
      }

      .scroll-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .scroll-btn svg {
        width: 14px;
        height: 14px;
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
        flex-shrink: 0;
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
        white-space: nowrap;
      }

      .provider-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
      }

      .provider-icon.github {
        color: var(--color-text-secondary);
      }

      .provider-icon.ado {
        color: #0078d4;
      }

      .provider-icon.gitlab {
        color: #fc6d26;
      }

      .provider-icon.bitbucket {
        color: #0052cc;
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
        margin-left: auto;
        flex-shrink: 0;
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

      .no-repos {
        padding: 0 var(--spacing-md);
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
        font-style: italic;
      }
    `,
  ];

  @state() private openRepositories: OpenRepository[] = [];
  @state() private activeIndex = -1;
  @state() private isLoading = false;

  @query('lv-clone-dialog') private cloneDialog!: LvCloneDialog;
  @query('lv-init-dialog') private initDialog!: LvInitDialog;
  @query('lv-search-bar') private searchBar!: LvSearchBar;
  @query('.tabs') private tabsContainer!: HTMLElement;

  @state() private showSearch = false;
  @state() private canScrollLeft = false;
  @state() private canScrollRight = false;

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
    log.debug('handleOpenRepo called');
    try {
      const path = await openRepositoryDialog();
      log.debug('Got path:', path);
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
      log.error('Error in handleOpenRepo:', error);
      showToast(error instanceof Error ? error.message : 'Failed to open repository', 'error');
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

  private detectProvider(repo: OpenRepository): 'github' | 'ado' | 'gitlab' | 'bitbucket' | null {
    const originRemote = repo.remotes.find(r => r.name === 'origin') ?? repo.remotes[0];
    if (!originRemote) return null;

    const url = originRemote.url.toLowerCase();
    if (url.includes('github.com') || url.includes('github.')) return 'github';
    if (url.includes('dev.azure.com') || url.includes('visualstudio.com')) return 'ado';
    if (url.includes('gitlab.com') || url.includes('gitlab.')) return 'gitlab';
    if (url.includes('bitbucket.org') || url.includes('bitbucket.')) return 'bitbucket';
    return null;
  }

  private renderProviderIcon(repo: OpenRepository) {
    const provider = this.detectProvider(repo);
    if (!provider) return null;

    switch (provider) {
      case 'github':
        return html`<svg class="provider-icon github" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>`;
      case 'ado':
        return html`<svg class="provider-icon ado" viewBox="0 0 24 24" fill="currentColor">
          <path d="M0 8.877L2.247 5.91l8.405-3.416V.022l7.37 5.393L2.966 8.338v8.225L0 15.707zm24-4.45v14.651l-5.753 4.9-9.303-3.057v3.056l-5.978-7.416 15.057 1.798V5.415z"/>
        </svg>`;
      case 'gitlab':
        return html`<svg class="provider-icon gitlab" viewBox="0 0 24 24" fill="currentColor">
          <path d="M23.955 13.587l-1.342-4.135-2.664-8.189a.455.455 0 00-.867 0L16.418 9.45H7.582L4.918 1.263a.455.455 0 00-.867 0L1.386 9.452.044 13.587a.924.924 0 00.331 1.023L12 23.054l11.625-8.443a.92.92 0 00.33-1.024"/>
        </svg>`;
      case 'bitbucket':
        return html`<svg class="provider-icon bitbucket" viewBox="0 0 24 24" fill="currentColor">
          <path d="M.778 1.211a.768.768 0 00-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 00.77-.646l3.27-20.03a.768.768 0 00-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z"/>
        </svg>`;
    }
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

  private handleOpenProfileManager(): void {
    this.dispatchEvent(new CustomEvent('open-profile-manager', {
      bubbles: true,
      composed: true,
    }));
  }

  private updateScrollButtons(): void {
    if (!this.tabsContainer) return;
    const { scrollLeft, scrollWidth, clientWidth } = this.tabsContainer;
    this.canScrollLeft = scrollLeft > 0;
    this.canScrollRight = scrollLeft + clientWidth < scrollWidth - 1;
  }

  private handleScrollLeft(): void {
    if (!this.tabsContainer) return;
    this.tabsContainer.scrollBy({ left: -150, behavior: 'smooth' });
  }

  private handleScrollRight(): void {
    if (!this.tabsContainer) return;
    this.tabsContainer.scrollBy({ left: 150, behavior: 'smooth' });
  }

  private handleTabsScroll(): void {
    this.updateScrollButtons();
  }

  protected updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);
    if (changedProperties.has('openRepositories')) {
      this.updateComplete.then(() => this.updateScrollButtons());
    }
  }

  protected firstUpdated(): void {
    this.updateScrollButtons();
    // Listen for resize to update scroll buttons
    new ResizeObserver(() => this.updateScrollButtons()).observe(this);
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

      <div class="tabs-container toolbar-section">
        <button
          class="scroll-btn ${this.canScrollLeft ? 'visible' : ''}"
          @click=${this.handleScrollLeft}
          title="Scroll left"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <div class="tabs" @scroll=${this.handleTabsScroll}>
          ${this.openRepositories.length === 0
            ? html`<span class="no-repos">No repositories open</span>`
            : this.openRepositories.map(
                (repo, index) => html`
                  <button
                    class="tab ${index === this.activeIndex ? 'active' : ''}"
                    @click=${() => this.handleTabClick(index)}
                  >
                    ${this.renderProviderIcon(repo)}
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
        <button
          class="scroll-btn ${this.canScrollRight ? 'visible' : ''}"
          @click=${this.handleScrollRight}
          title="Scroll right"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      </div>

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
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-toolbar': LvToolbar;
  }
}
