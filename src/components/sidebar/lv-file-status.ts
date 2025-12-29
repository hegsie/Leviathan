import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import * as watcherService from '../../services/watcher.service.ts';
import { showConfirm } from '../../services/dialog.service.ts';
import { dragDropService, type DragItem } from '../../services/drag-drop.service.ts';
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
        min-height: 100px;
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
        min-height: 100px;
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

      /* Drag and drop styles */
      .file-item[draggable="true"] {
        cursor: grab;
      }

      .file-item.dragging {
        opacity: 0.5;
        cursor: grabbing;
      }

      .section.drop-target .section-header {
        background: var(--color-primary-bg);
      }

      .section.drop-target-stage .section-header {
        background: var(--color-success-bg);
        color: var(--color-success);
      }

      .section.drop-target-unstage .section-header {
        background: var(--color-warning-bg);
        color: var(--color-warning);
      }

      .drop-hint {
        display: none;
        padding: var(--spacing-sm) var(--spacing-md);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        text-align: center;
        border: 2px dashed var(--color-border);
        border-radius: var(--radius-md);
        margin: var(--spacing-xs);
      }

      .section.drop-target .drop-hint {
        display: block;
      }

      .section.drop-target-stage .drop-hint {
        border-color: var(--color-success);
        color: var(--color-success);
      }

      .section.drop-target-unstage .drop-hint {
        border-color: var(--color-warning);
        color: var(--color-warning);
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
  @state() private draggingFile: StatusEntry | null = null;
  @state() private dropTargetSection: 'staged' | 'unstaged' | null = null;

  private unsubscribeWatcher: (() => void) | null = null;
  private statusRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private static readonly STATUS_REFRESH_DEBOUNCE_MS = 300;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();

    // Subscribe to file change events with debouncing
    this.unsubscribeWatcher = watcherService.onFileChange((event) => {
      // Refresh status on workdir or index changes
      if (event.eventType === 'workdir-changed' || event.eventType === 'index-changed') {
        this.debouncedLoadStatus();
      }
    });

    // Listen for global stage-all and unstage-all events
    this.boundHandleStageAllEvent = () => this.handleStageAll();
    this.boundHandleUnstageAllEvent = () => this.handleUnstageAll();
    window.addEventListener('stage-all', this.boundHandleStageAllEvent);
    window.addEventListener('unstage-all', this.boundHandleUnstageAllEvent);

    await this.loadStatus();
  }

  private boundHandleStageAllEvent: (() => void) | null = null;
  private boundHandleUnstageAllEvent: (() => void) | null = null;

  disconnectedCallback(): void {
    super.disconnectedCallback();

    // Clear debounce timeout
    if (this.statusRefreshTimeout) {
      clearTimeout(this.statusRefreshTimeout);
      this.statusRefreshTimeout = null;
    }

    // Unsubscribe from file changes
    if (this.unsubscribeWatcher) {
      this.unsubscribeWatcher();
      this.unsubscribeWatcher = null;
    }

    // Remove global event listeners
    if (this.boundHandleStageAllEvent) {
      window.removeEventListener('stage-all', this.boundHandleStageAllEvent);
    }
    if (this.boundHandleUnstageAllEvent) {
      window.removeEventListener('unstage-all', this.boundHandleUnstageAllEvent);
    }
  }

  /**
   * Debounced version of loadStatus to prevent excessive refreshes
   * when multiple file changes occur in rapid succession.
   * Uses delta update (no loading indicator) for smooth UI.
   */
  private debouncedLoadStatus(): void {
    if (this.statusRefreshTimeout) {
      clearTimeout(this.statusRefreshTimeout);
    }
    this.statusRefreshTimeout = setTimeout(() => {
      this.statusRefreshTimeout = null;
      this.loadStatus(false); // Don't show loading indicator on file watcher refreshes
    }, LvFileStatus.STATUS_REFRESH_DEBOUNCE_MS);
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

  async loadStatus(showLoading = true): Promise<void> {
    if (!this.repositoryPath) return;

    // Only show loading indicator on initial load, not on refreshes
    if (showLoading && this.stagedFiles.length === 0 && this.unstagedFiles.length === 0) {
      this.loading = true;
    }
    this.error = null;

    try {
      const result = await gitService.getStatus(this.repositoryPath);

      if (!result.success) {
        this.error = result.error?.message ?? 'Failed to load status';
        return;
      }

      const entries = result.data!;
      const newStagedFiles = entries.filter((e) => e.isStaged);
      const newUnstagedFiles = entries.filter((e) => !e.isStaged);

      // Only update if there are actual changes (delta update)
      const stagedChanged = !this.areStatusEntriesEqual(this.stagedFiles, newStagedFiles);
      const unstagedChanged = !this.areStatusEntriesEqual(this.unstagedFiles, newUnstagedFiles);

      if (stagedChanged) {
        this.stagedFiles = newStagedFiles;
      }
      if (unstagedChanged) {
        this.unstagedFiles = newUnstagedFiles;
      }

      // Emit status changed event only if something changed
      if (stagedChanged || unstagedChanged) {
        this.dispatchEvent(new CustomEvent('status-changed', {
          detail: {
            stagedCount: this.stagedFiles.length,
            totalCount: this.stagedFiles.length + this.unstagedFiles.length,
          },
          bubbles: true,
          composed: true,
        }));
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      this.loading = false;
    }
  }

  /**
   * Compare two arrays of status entries for equality
   */
  private areStatusEntriesEqual(a: StatusEntry[], b: StatusEntry[]): boolean {
    if (a.length !== b.length) return false;

    for (let i = 0; i < a.length; i++) {
      if (a[i].path !== b[i].path ||
          a[i].status !== b[i].status ||
          a[i].isStaged !== b[i].isStaged ||
          a[i].isConflicted !== b[i].isConflicted) {
        return false;
      }
    }
    return true;
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

    const confirmed = await showConfirm(
      'Discard Changes',
      `Are you sure you want to discard changes to "${file.path}"? This action cannot be undone.`,
      'warning'
    );

    if (!confirmed) return;

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
    const isDragging = this.draggingFile?.path === file.path;

    return html`
      <li
        class="file-item ${this.selectedFile === file.path ? 'selected' : ''} ${isDragging ? 'dragging' : ''}"
        draggable="true"
        @click=${() => this.handleFileClick(file)}
        @dragstart=${(e: DragEvent) => this.handleFileDragStart(e, file, staged)}
        @dragend=${() => this.handleFileDragEnd()}
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

  // File drag handlers
  private handleFileDragStart(e: DragEvent, file: StatusEntry, staged: boolean): void {
    this.draggingFile = file;
    const item: DragItem = { type: 'file', data: { file, staged } };
    e.dataTransfer?.setData('application/json', JSON.stringify(item));
    e.dataTransfer!.effectAllowed = 'move';
    dragDropService.startDrag(item);
  }

  private handleFileDragEnd(): void {
    this.draggingFile = null;
    this.dropTargetSection = null;
    dragDropService.endDrag();
  }

  private handleSectionDragOver(e: DragEvent, section: 'staged' | 'unstaged'): void {
    if (!this.draggingFile) return;

    // Check if we're dragging to a different section
    const isDraggedFromStaged = this.stagedFiles.some(f => f.path === this.draggingFile?.path);
    const isDroppingToSameSection = (section === 'staged' && isDraggedFromStaged) ||
                                     (section === 'unstaged' && !isDraggedFromStaged);

    if (isDroppingToSameSection) return;

    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
  }

  private handleSectionDragEnter(e: DragEvent, section: 'staged' | 'unstaged'): void {
    if (!this.draggingFile) return;

    // Check if we're dragging to a different section
    const isDraggedFromStaged = this.stagedFiles.some(f => f.path === this.draggingFile?.path);
    const isDroppingToSameSection = (section === 'staged' && isDraggedFromStaged) ||
                                     (section === 'unstaged' && !isDraggedFromStaged);

    if (isDroppingToSameSection) return;

    e.preventDefault();
    this.dropTargetSection = section;
  }

  private handleSectionDragLeave(e: DragEvent, section: 'staged' | 'unstaged'): void {
    const target = e.currentTarget as HTMLElement;
    if (target.contains(e.relatedTarget as Node)) return;

    if (this.dropTargetSection === section) {
      this.dropTargetSection = null;
    }
  }

  private async handleSectionDrop(e: DragEvent, targetSection: 'staged' | 'unstaged'): Promise<void> {
    e.preventDefault();

    const file = this.draggingFile;
    if (!file) return;

    // Clear drag state
    this.draggingFile = null;
    this.dropTargetSection = null;
    dragDropService.endDrag();

    // Determine if we need to stage or unstage
    const isDraggedFromStaged = this.stagedFiles.some(f => f.path === file.path);

    if (targetSection === 'staged' && !isDraggedFromStaged) {
      // Stage the file
      const result = await gitService.stageFiles(this.repositoryPath, { paths: [file.path] });
      if (result.success) {
        await this.loadStatus();
      }
    } else if (targetSection === 'unstaged' && isDraggedFromStaged) {
      // Unstage the file
      const result = await gitService.unstageFiles(this.repositoryPath, { paths: [file.path] });
      if (result.success) {
        await this.loadStatus();
      }
    }
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
      <div
        class="section ${this.dropTargetSection === 'staged' ? 'drop-target drop-target-stage' : ''}"
        @dragover=${(e: DragEvent) => this.handleSectionDragOver(e, 'staged')}
        @dragenter=${(e: DragEvent) => this.handleSectionDragEnter(e, 'staged')}
        @dragleave=${(e: DragEvent) => this.handleSectionDragLeave(e, 'staged')}
        @drop=${(e: DragEvent) => this.handleSectionDrop(e, 'staged')}
      >
        <div class="section-header" @click=${() => this.stagedExpanded = !this.stagedExpanded}>
          <svg class="chevron ${this.stagedExpanded ? 'expanded' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          <span class="section-title">Staged</span>
          <span class="section-count">${this.stagedFiles.length}</span>
          ${this.stagedFiles.length > 0 ? html`
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
          ` : nothing}
        </div>
        ${this.stagedFiles.length > 0 && this.stagedExpanded ? html`
          <ul class="file-list">
            ${this.stagedFiles.map((f) => this.renderFileItem(f, true))}
          </ul>
        ` : nothing}
        <div class="drop-hint">Drop files here to stage</div>
      </div>

      <!-- Unstaged changes -->
      <div
        class="section ${this.dropTargetSection === 'unstaged' ? 'drop-target drop-target-unstage' : ''}"
        @dragover=${(e: DragEvent) => this.handleSectionDragOver(e, 'unstaged')}
        @dragenter=${(e: DragEvent) => this.handleSectionDragEnter(e, 'unstaged')}
        @dragleave=${(e: DragEvent) => this.handleSectionDragLeave(e, 'unstaged')}
        @drop=${(e: DragEvent) => this.handleSectionDrop(e, 'unstaged')}
      >
        <div class="section-header" @click=${() => this.unstagedExpanded = !this.unstagedExpanded}>
          <svg class="chevron ${this.unstagedExpanded ? 'expanded' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          <span class="section-title">Changes</span>
          <span class="section-count">${this.unstagedFiles.length}</span>
          ${this.unstagedFiles.length > 0 ? html`
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
          ` : nothing}
        </div>
        ${this.unstagedFiles.length > 0 && this.unstagedExpanded ? html`
          <ul class="file-list">
            ${this.unstagedFiles.map((f) => this.renderFileItem(f, false))}
          </ul>
        ` : nothing}
        <div class="drop-hint">Drop files here to unstage</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-file-status': LvFileStatus;
  }
}
