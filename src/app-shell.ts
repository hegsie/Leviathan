import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { sharedStyles } from './styles/shared-styles.ts';
import { repositoryStore, uiStore, type OpenRepository } from './stores/index.ts';
import { registerDefaultShortcuts } from './services/keyboard.service.ts';
import './components/toolbar/lv-toolbar.ts';
import './components/welcome/lv-welcome.ts';
import './components/graph/lv-graph-canvas.ts';
import './components/panels/lv-diff-view.ts';
import './components/panels/lv-blame-view.ts';
import './components/sidebar/lv-left-panel.ts';
import './components/sidebar/lv-right-panel.ts';
import './components/dialogs/lv-settings-dialog.ts';
import './components/dialogs/lv-conflict-resolution-dialog.ts';
import type { CommitSelectedEvent, LvGraphCanvas } from './components/graph/lv-graph-canvas.ts';
import type { Commit, RefInfo, StatusEntry, Tag, Branch } from './types/git.types.ts';
import type { SearchFilter } from './components/toolbar/lv-search-bar.ts';

/**
 * Main application shell component
 * Provides the top-level layout and routing
 */
@customElement('lv-app-shell')
export class AppShell extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100vh;
        width: 100vw;
        overflow: hidden;
        background: var(--color-bg-primary);
        color: var(--color-text-primary);
      }

      .main-content {
        display: flex;
        flex: 1;
        overflow: hidden;
      }

      .left-panel {
        display: flex;
        flex-direction: column;
        background: var(--color-bg-secondary);
        border-right: 1px solid var(--color-border);
        overflow: hidden;
      }

      .center-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        min-width: 400px;
        position: relative;
      }

      .graph-area {
        flex: 1;
        overflow: hidden;
        background: var(--color-bg-primary);
      }

      .diff-area {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        flex-direction: column;
        background: var(--color-bg-primary);
        z-index: 10;
      }

      .diff-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
      }

      .diff-header-left {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        min-width: 0;
        flex: 1;
      }

      .diff-title {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }

      .diff-path {
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        font-family: var(--font-family-mono);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .diff-close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all var(--transition-fast);
        flex-shrink: 0;
      }

      .diff-close-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .diff-close-btn svg {
        width: 16px;
        height: 16px;
      }

      .diff-content {
        flex: 1;
        overflow: hidden;
      }

      .right-panel {
        display: flex;
        flex-direction: column;
        background: var(--color-bg-secondary);
        border-left: 1px solid var(--color-border);
        overflow: hidden;
      }

      .resize-handle-h {
        width: 4px;
        cursor: col-resize;
        background: transparent;
        transition: background-color 0.15s ease;
        flex-shrink: 0;
        z-index: 10;
      }

      .resize-handle-h:hover,
      .resize-handle-h.dragging {
        background: var(--color-primary);
      }

      .status-bar {
        display: flex;
        align-items: center;
        height: 24px;
        padding: 0 var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-top: 1px solid var(--color-border);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
      }

      lv-welcome {
        flex: 1;
      }

      :host(.resizing) {
        user-select: none;
      }

      :host(.resizing-h) * {
        cursor: col-resize !important;
      }

      /* Context Menu */
      .context-menu {
        position: fixed;
        z-index: var(--z-dropdown);
        min-width: 200px;
        max-width: 300px;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        padding: var(--spacing-xs) 0;
      }

      .context-menu-header {
        padding: var(--spacing-xs) var(--spacing-md);
        border-bottom: 1px solid var(--color-border);
        margin-bottom: var(--spacing-xs);
      }

      .context-menu-oid {
        font-family: var(--font-family-mono);
        font-size: var(--font-size-xs);
        color: var(--color-primary);
        margin-right: var(--spacing-sm);
      }

      .context-menu-summary {
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: block;
        margin-top: 2px;
      }

      .context-menu-divider {
        height: 1px;
        background: var(--color-border);
        margin: var(--spacing-xs) 0;
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

      .context-menu-item.danger:hover {
        background: var(--color-error-bg);
      }

      .context-menu-submenu {
        padding: var(--spacing-xs) 0;
      }

      .context-menu-label {
        display: block;
        padding: var(--spacing-xs) var(--spacing-md);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        font-weight: var(--font-weight-medium);
      }

      /* Blame view uses the same diff-area styling */
    `,
  ];

  @state() private activeRepository: OpenRepository | null = null;
  @state() private selectedCommit: Commit | null = null;
  @state() private selectedCommitRefs: RefInfo[] = [];

  // Diff view state
  @state() private showDiff = false;
  @state() private diffFile: StatusEntry | null = null;
  @state() private diffCommitFile: { commitOid: string; filePath: string } | null = null;

  // Blame view state
  @state() private showBlame = false;
  @state() private blameFile: string | null = null;
  @state() private blameCommitOid: string | null = null;

  // Settings dialog
  @state() private showSettings = false;

  // Search/filter
  @state() private searchFilter: SearchFilter | null = null;

  // Commit context menu
  @state() private contextMenu: {
    visible: boolean;
    x: number;
    y: number;
    commit: Commit | null;
  } = { visible: false, x: 0, y: 0, commit: null };

  // Conflict resolution dialog
  @state() private showConflictDialog = false;
  @state() private conflictOperationType: 'merge' | 'rebase' | 'cherry-pick' | 'revert' = 'merge';

  // Panel dimensions
  @state() private leftPanelWidth = 220;
  @state() private rightPanelWidth = 350;

  // Resize state
  private resizing: 'left' | 'right' | null = null;
  private resizeStartPos = 0;
  private resizeStartValue = 0;

  @query('lv-graph-canvas') private graphCanvas?: LvGraphCanvas;

  private unsubscribe?: () => void;

  // Bound event handlers for cleanup
  private boundHandleMouseMove = this.handleResizeMove.bind(this);
  private boundHandleMouseUp = this.handleResizeEnd.bind(this);

  private boundHandleKeyDown = this.handleKeyDown.bind(this);

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = repositoryStore.subscribe((state) => {
      this.activeRepository = state.getActiveRepository();
    });
    document.addEventListener('keydown', this.boundHandleKeyDown);
    document.addEventListener('click', this.handleDocumentClick);

    // Register keyboard shortcuts
    registerDefaultShortcuts({
      navigateUp: () => this.graphCanvas?.navigatePrevious?.(),
      navigateDown: () => this.graphCanvas?.navigateNext?.(),
      selectCommit: () => {/* handled by graph canvas */},
      stageAll: () => this.handleStageAll(),
      unstageAll: () => this.handleUnstageAll(),
      commit: () => {/* handled by commit panel */},
      refresh: () => this.handleRefresh(),
      search: () => this.handleToggleSearch(),
      openSettings: () => this.showSettings = true,
      toggleLeftPanel: () => uiStore.getState().togglePanel('left'),
      toggleRightPanel: () => uiStore.getState().togglePanel('right'),
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);
    document.removeEventListener('keydown', this.boundHandleKeyDown);
    document.removeEventListener('click', this.handleDocumentClick);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.contextMenu.visible) {
        this.contextMenu = { ...this.contextMenu, visible: false };
      } else if (this.showDiff) {
        this.handleCloseDiff();
      } else if (this.showBlame) {
        this.handleCloseBlame();
      }
    }
  }

  private handleDocumentClick = (): void => {
    if (this.contextMenu.visible) {
      this.contextMenu = { ...this.contextMenu, visible: false };
    }
  };

  private handleCommitContextMenu(e: CustomEvent): void {
    const { commit, position } = e.detail as {
      commit: Commit;
      refs: RefInfo[];
      position: { x: number; y: number };
    };

    this.contextMenu = {
      visible: true,
      x: position.x,
      y: position.y,
      commit,
    };
  }

  private async handleCherryPick(): Promise<void> {
    const commit = this.contextMenu.commit;
    if (!commit || !this.activeRepository) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    const result = await import('./services/git.service.ts').then((m) =>
      m.cherryPick({
        path: this.activeRepository!.repository.path,
        commit_oid: commit.oid,
      })
    );

    if (result.success) {
      this.graphCanvas?.refresh?.();
    } else if (result.error?.code === 'CHERRY_PICK_CONFLICT') {
      // Show conflict resolution dialog
      this.conflictOperationType = 'cherry-pick';
      this.showConflictDialog = true;
    } else {
      console.error('Cherry-pick failed:', result.error);
    }
  }

  private async handleRevertCommit(): Promise<void> {
    const commit = this.contextMenu.commit;
    if (!commit || !this.activeRepository) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    const result = await import('./services/git.service.ts').then((m) =>
      m.revert({
        path: this.activeRepository!.repository.path,
        commit_oid: commit.oid,
      })
    );

    if (result.success) {
      this.graphCanvas?.refresh?.();
    } else if (result.error?.code === 'REVERT_CONFLICT') {
      // Show conflict resolution dialog
      this.conflictOperationType = 'revert';
      this.showConflictDialog = true;
    } else {
      console.error('Revert failed:', result.error);
    }
  }

  private async handleResetToCommit(mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    const commit = this.contextMenu.commit;
    if (!commit || !this.activeRepository) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    // Confirm for hard reset
    if (mode === 'hard') {
      const confirmed = confirm(
        `Are you sure you want to hard reset to "${commit.summary}"?\n\nThis will discard all uncommitted changes.`
      );
      if (!confirmed) return;
    }

    const result = await import('./services/git.service.ts').then((m) =>
      m.reset({
        path: this.activeRepository!.repository.path,
        target_ref: commit.oid,
        mode,
      })
    );

    if (result.success) {
      this.graphCanvas?.refresh?.();
    } else {
      console.error('Reset failed:', result.error);
    }
  }

  private handleConflictResolved(): void {
    this.showConflictDialog = false;
    this.graphCanvas?.refresh?.();
  }

  private handleConflictAborted(): void {
    this.showConflictDialog = false;
    this.graphCanvas?.refresh?.();
  }

  private handleResizeStart(e: MouseEvent, type: 'left' | 'right'): void {
    e.preventDefault();
    this.resizing = type;
    this.resizeStartPos = e.clientX;
    this.resizeStartValue = type === 'left' ? this.leftPanelWidth : this.rightPanelWidth;
    this.classList.add('resizing', 'resizing-h');

    document.addEventListener('mousemove', this.boundHandleMouseMove);
    document.addEventListener('mouseup', this.boundHandleMouseUp);
  }

  private handleResizeMove(e: MouseEvent): void {
    if (!this.resizing) return;

    const delta = e.clientX - this.resizeStartPos;
    if (this.resizing === 'left') {
      const newWidth = Math.max(150, Math.min(400, this.resizeStartValue + delta));
      this.leftPanelWidth = newWidth;
    } else {
      const newWidth = Math.max(280, Math.min(600, this.resizeStartValue - delta));
      this.rightPanelWidth = newWidth;
    }
  }

  private handleResizeEnd(): void {
    this.resizing = null;
    this.classList.remove('resizing', 'resizing-h');
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);
  }

  private handleCommitSelected(e: CustomEvent<CommitSelectedEvent>): void {
    this.selectedCommit = e.detail.commit;
    this.selectedCommitRefs = e.detail.refs;
  }

  private handleSelectCommit(e: CustomEvent<{ oid: string }>): void {
    this.graphCanvas?.selectCommit(e.detail.oid);
  }

  private handleFileSelected(e: CustomEvent<{ file: StatusEntry }>): void {
    // Close blame if open
    this.showBlame = false;
    this.blameFile = null;
    this.blameCommitOid = null;
    // Working directory file selected - show diff
    this.diffFile = e.detail.file;
    this.diffCommitFile = null;
    this.showDiff = true;
  }

  private handleCommitFileSelected(e: CustomEvent<{ commitOid: string; filePath: string }>): void {
    // Close blame if open
    this.showBlame = false;
    this.blameFile = null;
    this.blameCommitOid = null;
    // Commit file selected - show diff
    this.diffCommitFile = {
      commitOid: e.detail.commitOid,
      filePath: e.detail.filePath,
    };
    this.diffFile = null;
    this.showDiff = true;
  }

  private handleCloseDiff(): void {
    this.showDiff = false;
    this.diffFile = null;
    this.diffCommitFile = null;
  }

  private handleTagSelected(e: CustomEvent<{ tag: Tag }>): void {
    const tag = e.detail.tag;
    if (tag.targetOid) {
      this.graphCanvas?.selectCommit(tag.targetOid);
    }
  }

  private handleBranchSelected(e: CustomEvent<{ branch: Branch }>): void {
    const branch = e.detail.branch;
    if (branch.targetOid) {
      this.graphCanvas?.selectCommit(branch.targetOid);
    }
  }

  private getDiffTitle(): string {
    if (this.diffFile) {
      return this.diffFile.isStaged ? 'Staged Changes' : 'Working Changes';
    }
    if (this.diffCommitFile) {
      return `Commit ${this.diffCommitFile.commitOid.substring(0, 7)}`;
    }
    return 'Diff';
  }

  private getDiffPath(): string {
    if (this.diffFile) {
      return this.diffFile.path;
    }
    if (this.diffCommitFile) {
      return this.diffCommitFile.filePath;
    }
    return '';
  }

  private handleStageAll(): void {
    window.dispatchEvent(new CustomEvent('stage-all'));
  }

  private handleUnstageAll(): void {
    window.dispatchEvent(new CustomEvent('unstage-all'));
  }

  private handleRefresh(): void {
    // Trigger refresh of the graph
    this.graphCanvas?.refresh?.();
  }

  private handleToggleSearch(): void {
    const toolbar = this.shadowRoot?.querySelector('lv-toolbar');
    if (toolbar) {
      (toolbar as HTMLElement).dispatchEvent(new CustomEvent('focus-search'));
    }
  }

  private handleCloseSettings(): void {
    this.showSettings = false;
  }

  private handleBlameCommitClick(e: CustomEvent<{ oid: string }>): void {
    this.showBlame = false;
    this.graphCanvas?.selectCommit(e.detail.oid);
  }

  private handleCloseBlame(): void {
    this.showBlame = false;
    this.blameFile = null;
    this.blameCommitOid = null;
  }

  private handleShowBlame(e: CustomEvent<{ filePath: string; commitOid?: string }>): void {
    // Close diff if open
    this.showDiff = false;
    this.diffFile = null;
    this.diffCommitFile = null;
    // Open blame
    this.blameFile = e.detail.filePath;
    this.blameCommitOid = e.detail.commitOid ?? null;
    this.showBlame = true;
  }

  private handleSearchChange(e: CustomEvent<{ filter: SearchFilter }>): void {
    this.searchFilter = e.detail.filter;
    // Pass filter to graph canvas
    if (this.graphCanvas) {
      this.graphCanvas.searchFilter = this.searchFilter;
    }
  }

  render() {
    return html`
      <lv-toolbar></lv-toolbar>

      ${this.activeRepository
        ? html`
            <div class="main-content">
              <aside
                class="left-panel"
                style="width: ${this.leftPanelWidth}px"
                @tag-selected=${this.handleTagSelected}
                @branch-selected=${this.handleBranchSelected}
              >
                <lv-left-panel></lv-left-panel>
              </aside>

              <div
                class="resize-handle-h ${this.resizing === 'left' ? 'dragging' : ''}"
                @mousedown=${(e: MouseEvent) => this.handleResizeStart(e, 'left')}
              ></div>

              <main class="center-panel">
                <div class="graph-area">
                  <lv-graph-canvas
                    repositoryPath=${this.activeRepository.repository.path}
                    @commit-selected=${this.handleCommitSelected}
                    @commit-context-menu=${this.handleCommitContextMenu}
                  ></lv-graph-canvas>
                </div>

                ${this.showDiff
                  ? html`
                      <div class="diff-area">
                        <div class="diff-header">
                          <div class="diff-header-left">
                            <span class="diff-title">${this.getDiffTitle()}</span>
                            <span class="diff-path" title="${this.getDiffPath()}">${this.getDiffPath()}</span>
                          </div>
                          <button
                            class="diff-close-btn"
                            @click=${this.handleCloseDiff}
                            title="Close diff (Esc)"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                              <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                          </button>
                        </div>
                        <div class="diff-content">
                          <lv-diff-view
                            .repositoryPath=${this.activeRepository.repository.path}
                            .file=${this.diffFile}
                            .commitFile=${this.diffCommitFile}
                          ></lv-diff-view>
                        </div>
                      </div>
                    `
                  : this.showBlame && this.blameFile
                    ? html`
                        <div class="diff-area">
                          <lv-blame-view
                            .repositoryPath=${this.activeRepository.repository.path}
                            .filePath=${this.blameFile}
                            .commitOid=${this.blameCommitOid}
                            @close=${this.handleCloseBlame}
                            @commit-click=${this.handleBlameCommitClick}
                          ></lv-blame-view>
                        </div>
                      `
                    : ''}
              </main>

              <div
                class="resize-handle-h ${this.resizing === 'right' ? 'dragging' : ''}"
                @mousedown=${(e: MouseEvent) => this.handleResizeStart(e, 'right')}
              ></div>

              <aside
                class="right-panel"
                style="width: ${this.rightPanelWidth}px"
                @file-selected=${this.handleFileSelected}
                @select-commit=${this.handleSelectCommit}
                @commit-file-selected=${this.handleCommitFileSelected}
                @show-blame=${this.handleShowBlame}
              >
                <lv-right-panel
                  .commit=${this.selectedCommit}
                  .refs=${this.selectedCommitRefs}
                ></lv-right-panel>
              </aside>
            </div>

            <footer class="status-bar">
              <span>${this.activeRepository.repository.path}</span>
            </footer>
          `
        : html`<lv-welcome></lv-welcome>`}

      ${this.showSettings
        ? html`
            <lv-settings-dialog
              @close=${this.handleCloseSettings}
            ></lv-settings-dialog>
          `
        : ''}

      ${this.showConflictDialog && this.activeRepository
        ? html`
            <lv-conflict-resolution-dialog
              open
              repositoryPath=${this.activeRepository.repository.path}
              operationType=${this.conflictOperationType}
              @operation-completed=${this.handleConflictResolved}
              @operation-aborted=${this.handleConflictAborted}
            ></lv-conflict-resolution-dialog>
          `
        : ''}

      ${this.contextMenu.visible && this.contextMenu.commit
        ? html`
            <div
              class="context-menu"
              style="left: ${this.contextMenu.x}px; top: ${this.contextMenu.y}px;"
              @click=${(e: Event) => e.stopPropagation()}
            >
              <div class="context-menu-header">
                <span class="context-menu-oid">${this.contextMenu.commit.oid.substring(0, 7)}</span>
                <span class="context-menu-summary">${this.contextMenu.commit.summary}</span>
              </div>
              <div class="context-menu-divider"></div>
              <button class="context-menu-item" @click=${this.handleCherryPick}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z"/>
                  <path d="M8 5v6M5 8h6" stroke="currentColor" stroke-width="1.5" fill="none"/>
                </svg>
                Cherry-pick
              </button>
              <button class="context-menu-item" @click=${this.handleRevertCommit}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0zM8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3z"/>
                  <path d="M8 4v4l3 2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
                </svg>
                Revert
              </button>
              <div class="context-menu-divider"></div>
              <div class="context-menu-submenu">
                <span class="context-menu-label">Reset to this commit</span>
                <button class="context-menu-item" @click=${() => this.handleResetToCommit('soft')}>
                  Soft (keep changes staged)
                </button>
                <button class="context-menu-item" @click=${() => this.handleResetToCommit('mixed')}>
                  Mixed (keep changes unstaged)
                </button>
                <button class="context-menu-item danger" @click=${() => this.handleResetToCommit('hard')}>
                  Hard (discard all changes)
                </button>
              </div>
            </div>
          `
        : ''}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-app-shell': AppShell;
  }
}
