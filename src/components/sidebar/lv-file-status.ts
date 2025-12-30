import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import * as watcherService from '../../services/watcher.service.ts';
import { showConfirm } from '../../services/dialog.service.ts';
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
        gap: 6px;
        padding: 4px 8px;
        cursor: pointer;
        user-select: none;
        font-size: var(--font-size-xs);
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
        gap: 6px;
        padding: 3px 8px;
        padding-left: 22px;
        cursor: default;
        font-size: var(--font-size-xs);
        min-height: 22px;
      }

      .file-item:hover {
        background: var(--color-bg-hover);
      }

      .file-item.selected {
        background: var(--color-primary-bg);
      }

      .file-item.focused {
        outline: 1px solid var(--color-primary);
        outline-offset: -1px;
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

      .file-name-container {
        flex: 1;
        display: flex;
        align-items: baseline;
        gap: 6px;
        overflow: hidden;
        min-width: 0;
      }

      .file-name {
        font-family: var(--font-family-mono);
        font-size: 11px;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .file-dir {
        color: var(--color-text-muted);
        font-family: var(--font-family-mono);
        font-size: 10px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex-shrink: 1;
        min-width: 0;
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

      /* Tree view styles */
      .folder-item {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        padding-left: calc(22px + var(--tree-depth, 0) * 12px);
        cursor: pointer;
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        user-select: none;
      }

      .folder-item:hover {
        background: var(--color-bg-hover);
      }

      .folder-item .folder-icon {
        width: 14px;
        height: 14px;
        color: var(--color-warning);
      }

      .folder-item .folder-name {
        font-family: var(--font-family-mono);
        font-size: 11px;
      }

      .folder-children {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .tree-file-item {
        padding-left: calc(34px + var(--tree-depth, 0) * 12px);
      }

      .tree-file-item .file-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .toolbar {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding: 4px 8px;
        border-bottom: 1px solid var(--color-border);
        background: var(--color-bg-secondary);
      }

      .view-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        cursor: pointer;
        font-size: var(--font-size-xs);
      }

      .view-toggle:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .view-toggle.active {
        color: var(--color-primary);
        background: var(--color-primary-bg);
      }

      .view-toggle svg {
        width: 14px;
        height: 14px;
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
  @state() private focusedIndex: number = -1;
  @state() private viewMode: 'flat' | 'tree' = 'flat';
  @state() private expandedFolders: Set<string> = new Set();

  /** Tree node structure for tree view */
  private buildFileTree(files: StatusEntry[]): Map<string, { file?: StatusEntry; children: Map<string, unknown> }> {
    const root = new Map<string, { file?: StatusEntry; children: Map<string, unknown> }>();

    for (const file of files) {
      const parts = file.path.split('/');
      let current = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1;

        if (!current.has(part)) {
          current.set(part, { children: new Map() });
        }

        const node = current.get(part)!;
        if (isFile) {
          node.file = file;
        }
        current = node.children as Map<string, { file?: StatusEntry; children: Map<string, unknown> }>;
      }
    }

    return root;
  }

  private toggleFolder(folderPath: string): void {
    const newSet = new Set(this.expandedFolders);
    if (newSet.has(folderPath)) {
      newSet.delete(folderPath);
    } else {
      newSet.add(folderPath);
    }
    this.expandedFolders = newSet;
  }

  private toggleViewMode(): void {
    this.viewMode = this.viewMode === 'flat' ? 'tree' : 'flat';
    // Expand all folders by default when switching to tree view
    if (this.viewMode === 'tree') {
      const allFolders = new Set<string>();
      const collectFolders = (files: StatusEntry[]) => {
        for (const file of files) {
          const parts = file.path.split('/');
          let path = '';
          for (let i = 0; i < parts.length - 1; i++) {
            path = path ? `${path}/${parts[i]}` : parts[i];
            allFolders.add(path);
          }
        }
      };
      collectFolders(this.stagedFiles);
      collectFolders(this.unstagedFiles);
      this.expandedFolders = allFolders;
    }
  }

  private unsubscribeWatcher: (() => void) | null = null;
  private statusRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private hasInitiallyLoaded = false;
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

    // Listen for global stage-all, unstage-all, and refresh events
    this.boundHandleStageAllEvent = () => this.handleStageAll();
    this.boundHandleUnstageAllEvent = () => this.handleUnstageAll();
    this.boundHandleRefreshEvent = () => this.refresh();
    window.addEventListener('stage-all', this.boundHandleStageAllEvent);
    window.addEventListener('unstage-all', this.boundHandleUnstageAllEvent);
    window.addEventListener('status-refresh', this.boundHandleRefreshEvent);

    // Listen for keyboard events
    this.addEventListener('keydown', this.handleKeyDown);
    this.setAttribute('tabindex', '0');

    await this.loadStatus();
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    const allFiles = this.getAllVisibleFiles();
    if (allFiles.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        e.preventDefault();
        this.focusedIndex = Math.min(this.focusedIndex + 1, allFiles.length - 1);
        if (this.focusedIndex < 0) this.focusedIndex = 0;
        this.scrollFocusedIntoView();
        break;

      case 'ArrowUp':
      case 'k':
        e.preventDefault();
        this.focusedIndex = Math.max(this.focusedIndex - 1, 0);
        this.scrollFocusedIntoView();
        break;

      case 'Enter':
      case ' ':
        e.preventDefault();
        if (this.focusedIndex >= 0 && this.focusedIndex < allFiles.length) {
          this.handleFileClick(allFiles[this.focusedIndex]);
        }
        break;

      case 's':
        // Stage focused file
        if (this.focusedIndex >= 0 && this.focusedIndex < allFiles.length) {
          const file = allFiles[this.focusedIndex];
          if (!this.stagedFiles.some(f => f.path === file.path)) {
            e.preventDefault();
            this.handleStageFile(file, e);
          }
        }
        break;

      case 'u':
        // Unstage focused file
        if (this.focusedIndex >= 0 && this.focusedIndex < allFiles.length) {
          const file = allFiles[this.focusedIndex];
          if (this.stagedFiles.some(f => f.path === file.path)) {
            e.preventDefault();
            this.handleUnstageFile(file, e);
          }
        }
        break;

      case 'Home':
        e.preventDefault();
        this.focusedIndex = 0;
        this.scrollFocusedIntoView();
        break;

      case 'End':
        e.preventDefault();
        this.focusedIndex = allFiles.length - 1;
        this.scrollFocusedIntoView();
        break;
    }
  };

  private getAllVisibleFiles(): StatusEntry[] {
    const files: StatusEntry[] = [];
    if (this.stagedExpanded) {
      files.push(...this.stagedFiles);
    }
    if (this.unstagedExpanded) {
      files.push(...this.unstagedFiles);
    }
    return files;
  }

  private scrollFocusedIntoView(): void {
    requestAnimationFrame(() => {
      const item = this.shadowRoot?.querySelector(`[data-index="${this.focusedIndex}"]`);
      item?.scrollIntoView({ block: 'nearest' });
    });
  }

  private boundHandleStageAllEvent: (() => void) | null = null;
  private boundHandleUnstageAllEvent: (() => void) | null = null;
  private boundHandleRefreshEvent: (() => void) | null = null;

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
    if (this.boundHandleRefreshEvent) {
      window.removeEventListener('status-refresh', this.boundHandleRefreshEvent);
    }

    // Remove keyboard listener
    this.removeEventListener('keydown', this.handleKeyDown);
  }

  /**
   * Debounced version of loadStatus to prevent excessive refreshes
   * when multiple file changes occur in rapid succession.
   */
  private debouncedLoadStatus(): void {
    if (this.statusRefreshTimeout) {
      clearTimeout(this.statusRefreshTimeout);
    }
    this.statusRefreshTimeout = setTimeout(() => {
      this.statusRefreshTimeout = null;
      this.loadStatus();
    }, LvFileStatus.STATUS_REFRESH_DEBOUNCE_MS);
  }

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('repositoryPath') && this.repositoryPath) {
      // Reset for new repository so we show loading on first load
      this.hasInitiallyLoaded = false;
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

    // Only show loading indicator on the very first load
    if (!this.hasInitiallyLoaded) {
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
      this.hasInitiallyLoaded = true;
    }
  }

  /**
   * Public method to refresh the status
   * Can be called from outside the component
   */
  public refresh(): void {
    this.loadStatus();
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

  private getFileNameAndDir(path: string): { name: string; dir: string } {
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash === -1) {
      return { name: path, dir: '' };
    }
    return {
      name: path.slice(lastSlash + 1),
      dir: path.slice(0, lastSlash),
    };
  }

  private renderFileItem(file: StatusEntry, staged: boolean, index: number) {
    const isFocused = this.focusedIndex === index;
    const isSelected = this.selectedFile === file.path;
    const { name, dir } = this.getFileNameAndDir(file.path);

    return html`
      <li
        class="file-item ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''}"
        @click=${() => this.handleFileClick(file)}
        title="${file.path}"
        data-index="${index}"
      >
        <span class="file-status ${file.status}">${this.getStatusLabel(file.status)}</span>
        <span class="file-name-container">
          <span class="file-name">${name}</span>
          ${dir ? html`<span class="file-dir">${dir}</span>` : nothing}
        </span>
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

  private renderTreeNode(
    name: string,
    node: { file?: StatusEntry; children: Map<string, unknown> },
    path: string,
    depth: number,
    staged: boolean,
    indexOffset: number
  ): unknown {
    // If this node has a file, render it as a file item
    if (node.file) {
      const file = node.file;
      const index = indexOffset;
      const isFocused = this.focusedIndex === index;
      const isSelected = this.selectedFile === file.path;

      return html`
        <li
          class="file-item tree-file-item ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''}"
          style="--tree-depth: ${depth}"
          @click=${() => this.handleFileClick(file)}
          title="${file.path}"
          data-index="${index}"
        >
          <span class="file-status ${file.status}">${this.getStatusLabel(file.status)}</span>
          <span class="file-name"><span>${name}</span></span>
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

    // Otherwise, render as a folder with children
    const isExpanded = this.expandedFolders.has(path);
    const children = Array.from(node.children.entries());
    let currentIndex = indexOffset;

    return html`
      <li class="folder-item" style="--tree-depth: ${depth}" @click=${() => this.toggleFolder(path)}>
        <svg class="chevron ${isExpanded ? 'expanded' : ''}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
        <svg class="folder-icon" viewBox="0 0 24 24" fill="currentColor">
          ${isExpanded
            ? html`<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>`
            : html`<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11z"></path>`
          }
        </svg>
        <span class="folder-name">${name}</span>
      </li>
      ${isExpanded ? html`
        <ul class="folder-children">
          ${children.map(([childName, childNode]) => {
            const childPath = path ? `${path}/${childName}` : childName;
            const result = this.renderTreeNode(
              childName,
              childNode as { file?: StatusEntry; children: Map<string, unknown> },
              childPath,
              depth + 1,
              staged,
              currentIndex
            );
            // Count files in this subtree for index calculation
            const countFiles = (n: { file?: StatusEntry; children: Map<string, unknown> }): number => {
              if (n.file) return 1;
              let count = 0;
              for (const child of n.children.values()) {
                count += countFiles(child as { file?: StatusEntry; children: Map<string, unknown> });
              }
              return count;
            };
            currentIndex += countFiles(childNode as { file?: StatusEntry; children: Map<string, unknown> });
            return result;
          })}
        </ul>
      ` : nothing}
    `;
  }

  private renderFileList(files: StatusEntry[], staged: boolean, indexOffset: number) {
    if (this.viewMode === 'tree') {
      const tree = this.buildFileTree(files);
      let currentIndex = indexOffset;

      return html`
        <ul class="file-list">
          ${Array.from(tree.entries()).map(([name, node]) => {
            const result = this.renderTreeNode(name, node, name, 0, staged, currentIndex);
            // Count files for index calculation
            const countFiles = (n: { file?: StatusEntry; children: Map<string, unknown> }): number => {
              if (n.file) return 1;
              let count = 0;
              for (const child of n.children.values()) {
                count += countFiles(child as { file?: StatusEntry; children: Map<string, unknown> });
              }
              return count;
            };
            currentIndex += countFiles(node);
            return result;
          })}
        </ul>
      `;
    }

    return html`
      <ul class="file-list">
        ${files.map((f, i) => this.renderFileItem(f, staged, indexOffset + i))}
      </ul>
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
      <!-- Toolbar -->
      <div class="toolbar">
        <button
          class="view-toggle ${this.viewMode === 'tree' ? 'active' : ''}"
          title="${this.viewMode === 'tree' ? 'Switch to flat view' : 'Switch to tree view'}"
          @click=${() => this.toggleViewMode()}
        >
          ${this.viewMode === 'tree'
            ? html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`
            : html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>`
          }
          <span>${this.viewMode === 'tree' ? 'Tree' : 'Flat'}</span>
        </button>
      </div>

      <!-- Staged changes -->
      <div class="section">
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
        ${this.stagedFiles.length > 0 && this.stagedExpanded
          ? this.renderFileList(this.stagedFiles, true, 0)
          : nothing}
      </div>

      <!-- Unstaged changes -->
      <div class="section">
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
        ${this.unstagedFiles.length > 0 && this.unstagedExpanded
          ? this.renderFileList(this.unstagedFiles, false, this.stagedExpanded ? this.stagedFiles.length : 0)
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-file-status': LvFileStatus;
  }
}
