import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import * as watcherService from '../../services/watcher.service.ts';
import type { StatusEntry, FileStatus } from '../../types/git.types.ts';

/**
 * File status component
 * Displays staged and unstaged changes with staging functionality
 */
@customElement('lv-file-status')
export class LvFileStatus extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      .section {
        border-bottom: 1px solid var(--color-border);
      }

      .section:last-child {
        border-bottom: none;
      }

      .section-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        cursor: pointer;
        user-select: none;
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
      }

      .section-header:hover {
        background: var(--color-bg-hover);
      }

      .chevron {
        width: 14px;
        height: 14px;
        transition: transform var(--transition-fast);
      }

      .chevron.expanded {
        transform: rotate(90deg);
      }

      .section-title {
        flex: 1;
        font-weight: var(--font-weight-medium);
      }

      .section-count {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        background: var(--color-bg-tertiary);
        padding: 1px 6px;
        border-radius: var(--radius-full);
      }

      .section-actions {
        display: flex;
        gap: 2px;
      }

      .section-action {
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
      }

      .section-action:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .file-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .file-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        padding-left: calc(var(--spacing-md) + 16px);
        cursor: pointer;
        font-size: var(--font-size-sm);
      }

      .file-item:hover {
        background: var(--color-bg-hover);
      }

      .file-item.selected {
        background: var(--color-primary-bg);
      }

      .file-status {
        width: 14px;
        height: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: var(--font-weight-bold);
        border-radius: 2px;
        flex-shrink: 0;
      }

      .file-status.new,
      .file-status.untracked {
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

      .file-status.conflicted {
        background: var(--color-error-bg);
        color: var(--color-error);
      }

      .file-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--font-family-mono);
        font-size: var(--font-size-xs);
      }

      .file-actions {
        display: none;
        gap: 2px;
      }

      .file-item:hover .file-actions {
        display: flex;
      }

      .file-action {
        width: 18px;
        height: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
      }

      .file-action:hover {
        background: var(--color-bg-tertiary);
        color: var(--color-text-primary);
      }

      .empty {
        padding: var(--spacing-md);
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

      .error {
        padding: var(--spacing-sm);
        color: var(--color-error);
        font-size: var(--font-size-sm);
      }

      .clean-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-lg);
        color: var(--color-text-muted);
        text-align: center;
      }

      .clean-state svg {
        width: 48px;
        height: 48px;
        margin-bottom: var(--spacing-sm);
        opacity: 0.5;
      }

      .clean-state .title {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        margin-bottom: var(--spacing-xs);
      }

      .clean-state .subtitle {
        font-size: var(--font-size-xs);
      }
    `,
  ];

  @property({ type: String }) repositoryPath: string = '';

  @state() private stagedFiles: StatusEntry[] = [];
  @state() private unstagedFiles: StatusEntry[] = [];
  @state() private loading = true;
  @state() private error: string | null = null;
  @state() private stagedExpanded = true;
  @state() private unstagedExpanded = true;
  @state() private selectedFile: string | null = null;

  private unsubscribeWatcher: (() => void) | null = null;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();

    // Subscribe to file change events
    this.unsubscribeWatcher = watcherService.onFileChange((event) => {
      // Refresh status on workdir or index changes
      if (event.eventType === 'workdir-changed' || event.eventType === 'index-changed') {
        this.loadStatus();
      }
    });

    await this.loadStatus();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();

    // Unsubscribe from file changes
    if (this.unsubscribeWatcher) {
      this.unsubscribeWatcher();
      this.unsubscribeWatcher = null;
    }
  }

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('repositoryPath') && this.repositoryPath) {
      // Start watching the new repository
      try {
        await watcherService.startWatching(this.repositoryPath);
      } catch (err) {
        console.warn('Failed to start file watcher:', err);
      }
      await this.loadStatus();
    }
  }

  async loadStatus(): Promise<void> {
    if (!this.repositoryPath) return;

    this.loading = true;
    this.error = null;

    try {
      const result = await gitService.getStatus(this.repositoryPath);

      if (!result.success) {
        this.error = result.error?.message ?? 'Failed to load status';
        return;
      }

      const entries = result.data!;
      this.stagedFiles = entries.filter((e) => e.isStaged);
      this.unstagedFiles = entries.filter((e) => !e.isStaged);

      // Emit status changed event
      this.dispatchEvent(new CustomEvent('status-changed', {
        detail: {
          stagedCount: this.stagedFiles.length,
          totalCount: this.stagedFiles.length + this.unstagedFiles.length,
        },
        bubbles: true,
        composed: true,
      }));
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      this.loading = false;
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

  private async handleStageFile(file: StatusEntry, e: Event): Promise<void> {
    e.stopPropagation();
    const result = await gitService.stageFiles(this.repositoryPath, { paths: [file.path] });
    if (result.success) {
      await this.loadStatus();
    }
  }

  private async handleUnstageFile(file: StatusEntry, e: Event): Promise<void> {
    e.stopPropagation();
    const result = await gitService.unstageFiles(this.repositoryPath, { paths: [file.path] });
    if (result.success) {
      await this.loadStatus();
    }
  }

  private async handleDiscardFile(file: StatusEntry, e: Event): Promise<void> {
    e.stopPropagation();
    // TODO: Add confirmation dialog
    const result = await gitService.discardChanges(this.repositoryPath, [file.path]);
    if (result.success) {
      await this.loadStatus();
    }
  }

  private async handleStageAll(): Promise<void> {
    const paths = this.unstagedFiles.map((f) => f.path);
    if (paths.length === 0) return;

    const result = await gitService.stageFiles(this.repositoryPath, { paths });
    if (result.success) {
      await this.loadStatus();
    }
  }

  private async handleUnstageAll(): Promise<void> {
    const paths = this.stagedFiles.map((f) => f.path);
    if (paths.length === 0) return;

    const result = await gitService.unstageFiles(this.repositoryPath, { paths });
    if (result.success) {
      await this.loadStatus();
    }
  }

  private handleFileClick(file: StatusEntry): void {
    this.selectedFile = file.path;
    this.dispatchEvent(new CustomEvent('file-selected', {
      detail: { file },
      bubbles: true,
      composed: true,
    }));
  }

  private renderFileItem(file: StatusEntry, staged: boolean) {
    const filename = file.path.split('/').pop() || file.path;

    return html`
      <li
        class="file-item ${this.selectedFile === file.path ? 'selected' : ''}"
        @click=${() => this.handleFileClick(file)}
        title="${file.path}"
      >
        <span class="file-status ${file.status}">${this.getStatusLabel(file.status)}</span>
        <span class="file-name">${filename}</span>
        <div class="file-actions">
          ${staged ? html`
            <button
              class="file-action"
              title="Unstage"
              @click=${(e: Event) => this.handleUnstageFile(file, e)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          ` : html`
            <button
              class="file-action"
              title="Stage"
              @click=${(e: Event) => this.handleStageFile(file, e)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <button
              class="file-action"
              title="Discard changes"
              @click=${(e: Event) => this.handleDiscardFile(file, e)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          `}
        </div>
      </li>
    `;
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">Loading changes...</div>`;
    }

    if (this.error) {
      return html`<div class="error">${this.error}</div>`;
    }

    if (this.stagedFiles.length === 0 && this.unstagedFiles.length === 0) {
      return html`
        <div class="clean-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <div class="title">Working tree clean</div>
          <div class="subtitle">No changes to commit</div>
        </div>
      `;
    }

    return html`
      <!-- Staged changes -->
      ${this.stagedFiles.length > 0 ? html`
        <div class="section">
          <div class="section-header" @click=${() => this.stagedExpanded = !this.stagedExpanded}>
            <svg class="chevron ${this.stagedExpanded ? 'expanded' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
            <span class="section-title">Staged</span>
            <span class="section-count">${this.stagedFiles.length}</span>
            <div class="section-actions" @click=${(e: Event) => e.stopPropagation()}>
              <button
                class="section-action"
                title="Unstage all"
                @click=${this.handleUnstageAll}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
            </div>
          </div>
          ${this.stagedExpanded ? html`
            <ul class="file-list">
              ${this.stagedFiles.map((f) => this.renderFileItem(f, true))}
            </ul>
          ` : nothing}
        </div>
      ` : nothing}

      <!-- Unstaged changes -->
      ${this.unstagedFiles.length > 0 ? html`
        <div class="section">
          <div class="section-header" @click=${() => this.unstagedExpanded = !this.unstagedExpanded}>
            <svg class="chevron ${this.unstagedExpanded ? 'expanded' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
            <span class="section-title">Changes</span>
            <span class="section-count">${this.unstagedFiles.length}</span>
            <div class="section-actions" @click=${(e: Event) => e.stopPropagation()}>
              <button
                class="section-action"
                title="Stage all"
                @click=${this.handleStageAll}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
            </div>
          </div>
          ${this.unstagedExpanded ? html`
            <ul class="file-list">
              ${this.unstagedFiles.map((f) => this.renderFileItem(f, false))}
            </ul>
          ` : nothing}
        </div>
      ` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-file-status': LvFileStatus;
  }
}
