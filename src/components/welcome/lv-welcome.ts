/**
 * Welcome Screen Component
 * Shown when no repository is open
 */

import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { repositoryStore, type RecentRepository } from '../../stores/index.ts';
import { openRepository } from '../../services/git.service.ts';
import { openRepositoryDialog } from '../../services/dialog.service.ts';
import '../dialogs/lv-clone-dialog.ts';
import '../dialogs/lv-init-dialog.ts';
import type { LvCloneDialog } from '../dialogs/lv-clone-dialog.ts';
import type { LvInitDialog } from '../dialogs/lv-init-dialog.ts';

@customElement('lv-welcome')
export class LvWelcome extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: var(--spacing-xl);
        background: var(--color-bg-primary);
      }

      .welcome-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        max-width: 600px;
        text-align: center;
      }

      .logo {
        font-size: 48px;
        font-weight: 700;
        color: var(--color-primary);
        margin-bottom: var(--spacing-md);
      }

      .tagline {
        font-size: var(--font-size-lg);
        color: var(--color-text-secondary);
        margin-bottom: var(--spacing-xl);
      }

      .actions {
        display: flex;
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-xl);
      }

      .action-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-lg);
        width: 140px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .action-btn:hover {
        background: var(--color-bg-hover);
        border-color: var(--color-primary);
      }

      .action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .action-btn svg {
        width: 32px;
        height: 32px;
        color: var(--color-primary);
      }

      .action-btn span {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
      }

      .recent-section {
        width: 100%;
        max-width: 400px;
      }

      .recent-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--spacing-sm);
        padding-bottom: var(--spacing-xs);
        border-bottom: 1px solid var(--color-border);
      }

      .recent-title {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .clear-btn {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        background: none;
        border: none;
        cursor: pointer;
        padding: var(--spacing-xs);
      }

      .clear-btn:hover {
        color: var(--color-text-secondary);
      }

      .recent-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .recent-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-md);
        background: var(--color-bg-secondary);
        border: 1px solid transparent;
        cursor: pointer;
        transition: all var(--transition-fast);
        text-align: left;
      }

      .recent-item:hover {
        background: var(--color-bg-hover);
        border-color: var(--color-border);
      }

      .recent-icon {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        color: var(--color-text-muted);
      }

      .recent-info {
        flex: 1;
        min-width: 0;
      }

      .recent-name {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .recent-path {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .recent-remove {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        padding: 0;
        border: none;
        background: none;
        color: var(--color-text-muted);
        cursor: pointer;
        opacity: 0;
        transition: opacity var(--transition-fast);
      }

      .recent-item:hover .recent-remove {
        opacity: 1;
      }

      .recent-remove:hover {
        color: var(--color-error);
      }

      .empty-recent {
        padding: var(--spacing-lg);
        text-align: center;
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
      }
    `,
  ];

  @state() private recentRepositories: RecentRepository[] = [];
  @state() private isLoading = false;

  @query('lv-clone-dialog') private cloneDialog!: LvCloneDialog;
  @query('lv-init-dialog') private initDialog!: LvInitDialog;

  private unsubscribe?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = repositoryStore.subscribe((state) => {
      this.recentRepositories = state.recentRepositories;
      this.isLoading = state.isLoading;
    });
    // Initialize from current state
    const state = repositoryStore.getState();
    this.recentRepositories = state.recentRepositories;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }

  private async handleOpen(): Promise<void> {
    console.log('handleOpen called');
    try {
      const path = await openRepositoryDialog();
      console.log('Got path:', path);
      if (!path) return;
      await this.openRepoByPath(path);
    } catch (error) {
      console.error('Error in handleOpen:', error);
    }
  }

  private async openRepoByPath(path: string): Promise<void> {
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
  }

  private handleClone(): void {
    this.cloneDialog.open();
  }

  private handleInit(): void {
    this.initDialog.open();
  }

  private handleRecentClick(path: string): void {
    this.openRepoByPath(path);
  }

  private handleRecentRemove(e: Event, path: string): void {
    e.stopPropagation();
    repositoryStore.getState().removeRecentRepository(path);
  }

  private handleClearRecent(): void {
    repositoryStore.getState().clearRecentRepositories();
  }

  render() {
    return html`
      <lv-clone-dialog></lv-clone-dialog>
      <lv-init-dialog></lv-init-dialog>

      <div class="welcome-content">
        <div class="logo">Leviathan</div>
        <p class="tagline">A powerful, open-source Git client</p>

        <div class="actions">
          <button
            class="action-btn"
            @click=${this.handleOpen}
            ?disabled=${this.isLoading}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>Open</span>
          </button>

          <button
            class="action-btn"
            @click=${this.handleClone}
            ?disabled=${this.isLoading}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
              <polyline points="10 9 13 12 10 15"></polyline>
            </svg>
            <span>Clone</span>
          </button>

          <button
            class="action-btn"
            @click=${this.handleInit}
            ?disabled=${this.isLoading}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>Init</span>
          </button>
        </div>

        ${this.recentRepositories.length > 0
          ? html`
              <div class="recent-section">
                <div class="recent-header">
                  <span class="recent-title">Recent Repositories</span>
                  <button class="clear-btn" @click=${this.handleClearRecent}>
                    Clear
                  </button>
                </div>
                <div class="recent-list">
                  ${this.recentRepositories.map(
                    (repo) => html`
                      <button
                        class="recent-item"
                        @click=${() => this.handleRecentClick(repo.path)}
                      >
                        <svg class="recent-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                        </svg>
                        <div class="recent-info">
                          <div class="recent-name">${repo.name}</div>
                          <div class="recent-path">${repo.path}</div>
                        </div>
                        <button
                          class="recent-remove"
                          @click=${(e: Event) => this.handleRecentRemove(e, repo.path)}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                        </button>
                      </button>
                    `
                  )}
                </div>
              </div>
            `
          : html`
              <div class="recent-section">
                <div class="recent-header">
                  <span class="recent-title">Recent Repositories</span>
                </div>
                <div class="empty-recent">
                  No recent repositories
                </div>
              </div>
            `}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-welcome': LvWelcome;
  }
}
