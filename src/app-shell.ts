import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { sharedStyles } from './styles/shared-styles.ts';
import { useRepositoryStore, type OpenRepository } from './stores/index.ts';
import './components/toolbar/lv-toolbar.ts';
import './components/welcome/lv-welcome.ts';
import './components/graph/lv-graph-canvas.ts';
import './components/panels/lv-diff-view.ts';
import './components/sidebar/lv-left-panel.ts';
import './components/sidebar/lv-right-panel.ts';
import type { CommitSelectedEvent, LvGraphCanvas } from './components/graph/lv-graph-canvas.ts';
import type { Commit, RefInfo, StatusEntry, Tag, Branch } from './types/git.types.ts';

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
    `,
  ];

  @state() private activeRepository: OpenRepository | null = null;
  @state() private selectedCommit: Commit | null = null;
  @state() private selectedCommitRefs: RefInfo[] = [];

  // Diff view state
  @state() private showDiff = false;
  @state() private diffFile: StatusEntry | null = null;
  @state() private diffCommitFile: { commitOid: string; filePath: string } | null = null;

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
    this.unsubscribe = useRepositoryStore.subscribe((state) => {
      this.activeRepository = state.getActiveRepository();
    });
    document.addEventListener('keydown', this.boundHandleKeyDown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);
    document.removeEventListener('keydown', this.boundHandleKeyDown);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.showDiff) {
      this.handleCloseDiff();
    }
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
    // Working directory file selected - show diff
    this.diffFile = e.detail.file;
    this.diffCommitFile = null;
    this.showDiff = true;
  }

  private handleCommitFileSelected(e: CustomEvent<{ commitOid: string; filePath: string }>): void {
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
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-app-shell': AppShell;
  }
}
