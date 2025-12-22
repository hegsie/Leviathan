import { LitElement, html, css, nothing, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import { tokenizeLine, detectLanguage, getTokenColor } from '../../utils/syntax-highlighter.ts';
import type { DiffFile, DiffHunk, DiffLine, StatusEntry } from '../../types/git.types.ts';

type DiffViewMode = 'unified' | 'split';

interface SplitLine {
  left: DiffLine | null;
  right: DiffLine | null;
}

/**
 * Diff view component
 * Displays file diff with syntax highlighting and line numbers
 * Supports unified and split view modes
 */
@customElement('lv-diff-view')
export class LvDiffView extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        font-family: var(--font-family-mono);
        font-size: var(--font-size-xs);

        /* Syntax highlighting colors */
        --syntax-keyword: #c678dd;
        --syntax-string: #98c379;
        --syntax-number: #d19a66;
        --syntax-comment: #5c6370;
        --syntax-operator: #56b6c2;
        --syntax-function: #61afef;
        --syntax-type: #e5c07b;
        --syntax-variable: #abb2bf;
        --syntax-punctuation: #abb2bf;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
      }

      .file-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        flex: 1;
        min-width: 0;
      }

      .file-path {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        overflow: hidden;
      }

      .file-path span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .file-status {
        padding: 2px 6px;
        border-radius: var(--radius-sm);
        font-size: 10px;
        font-weight: var(--font-weight-bold);
        text-transform: uppercase;
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

      .file-stats {
        display: flex;
        gap: var(--spacing-sm);
        font-size: var(--font-size-xs);
        flex-shrink: 0;
      }

      .additions {
        color: var(--color-success);
      }

      .deletions {
        color: var(--color-error);
      }

      .view-controls {
        display: flex;
        gap: var(--spacing-xs);
        flex-shrink: 0;
        margin-left: var(--spacing-md);
      }

      .view-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xs) var(--spacing-sm);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: var(--color-bg-primary);
        color: var(--color-text-secondary);
        font-size: var(--font-size-xs);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .view-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .view-btn.active {
        background: var(--color-primary);
        color: var(--color-text-inverse);
        border-color: var(--color-primary);
      }

      .view-btn svg {
        width: 14px;
        height: 14px;
      }

      .diff-content {
        flex: 1;
        overflow: auto;
      }

      /* Unified view styles */
      .hunk {
        border-bottom: 1px solid var(--color-border);
      }

      .hunk:last-child {
        border-bottom: none;
      }

      .hunk-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-tertiary);
        color: var(--color-text-muted);
        font-style: italic;
        border-bottom: 1px solid var(--color-border);
      }

      .hunk-header-text {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .hunk-actions {
        display: flex;
        gap: var(--spacing-xs);
        flex-shrink: 0;
        margin-left: var(--spacing-sm);
      }

      .stage-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: var(--color-bg-primary);
        color: var(--color-text-secondary);
        font-size: 11px;
        font-style: normal;
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .stage-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
        border-color: var(--color-text-muted);
      }

      .stage-btn.stage:hover {
        background: var(--color-success-bg);
        color: var(--color-success);
        border-color: var(--color-success);
      }

      .stage-btn.unstage:hover {
        background: var(--color-warning-bg);
        color: var(--color-warning);
        border-color: var(--color-warning);
      }

      .stage-btn svg {
        width: 12px;
        height: 12px;
      }

      .line {
        display: flex;
        min-height: 20px;
        line-height: 20px;
      }

      .line:hover {
        filter: brightness(1.1);
      }

      .line-numbers {
        display: flex;
        flex-shrink: 0;
        user-select: none;
      }

      .line-no {
        width: 50px;
        padding: 0 var(--spacing-xs);
        text-align: right;
        color: var(--color-text-muted);
        background: var(--color-bg-secondary);
        border-right: 1px solid var(--color-border);
      }

      .line-no.old {
        border-right: none;
      }

      .line-origin {
        width: 20px;
        text-align: center;
        flex-shrink: 0;
        font-weight: var(--font-weight-bold);
      }

      .line-content {
        flex: 1;
        padding: 0 var(--spacing-sm);
        white-space: pre;
        overflow-x: auto;
      }

      .line.addition {
        background: var(--color-diff-add-bg);
      }

      .line.addition .line-origin {
        color: var(--color-success);
      }

      .line.addition .line-no {
        background: var(--color-diff-add-line-bg);
      }

      .line.deletion {
        background: var(--color-diff-del-bg);
      }

      .line.deletion .line-origin {
        color: var(--color-error);
      }

      .line.deletion .line-no {
        background: var(--color-diff-del-line-bg);
      }

      /* Split view styles */
      .split-container {
        display: flex;
        flex: 1;
        overflow: hidden;
      }

      .split-pane {
        flex: 1;
        overflow: auto;
        min-width: 0;
      }

      .split-pane:first-child {
        border-right: 1px solid var(--color-border);
      }

      .split-pane-header {
        position: sticky;
        top: 0;
        z-index: 1;
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-bottom: 1px solid var(--color-border);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
        text-align: center;
      }

      .split-line {
        display: flex;
        min-height: 20px;
        line-height: 20px;
      }

      .split-line:hover {
        filter: brightness(1.1);
      }

      .split-line-no {
        width: 50px;
        padding: 0 var(--spacing-xs);
        text-align: right;
        color: var(--color-text-muted);
        background: var(--color-bg-secondary);
        border-right: 1px solid var(--color-border);
        flex-shrink: 0;
        user-select: none;
      }

      .split-line-content {
        flex: 1;
        padding: 0 var(--spacing-sm);
        white-space: pre;
        overflow-x: auto;
      }

      .split-line.empty {
        background: var(--color-bg-tertiary);
      }

      .split-line.addition {
        background: var(--color-diff-add-bg);
      }

      .split-line.addition .split-line-no {
        background: var(--color-diff-add-line-bg);
      }

      .split-line.deletion {
        background: var(--color-diff-del-bg);
      }

      .split-line.deletion .split-line-no {
        background: var(--color-diff-del-line-bg);
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--color-text-muted);
      }

      .error {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--color-error);
        padding: var(--spacing-md);
        text-align: center;
      }

      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--color-text-muted);
        text-align: center;
        padding: var(--spacing-lg);
      }

      .empty svg {
        width: 48px;
        height: 48px;
        margin-bottom: var(--spacing-sm);
        opacity: 0.5;
      }

      .binary-notice {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--color-text-muted);
        font-style: italic;
      }
    `,
  ];

  @property({ type: String }) repositoryPath: string = '';
  @property({ type: Object }) file: StatusEntry | null = null;
  @property({ type: Object }) commitFile: { commitOid: string; filePath: string } | null = null;

  @state() private diff: DiffFile | null = null;
  @state() private loading = false;
  @state() private error: string | null = null;
  @state() private viewMode: DiffViewMode = 'unified';

  private language: string | null = null;

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('file') && this.file) {
      await this.loadWorkingDiff();
    }
    if (changedProperties.has('commitFile') && this.commitFile) {
      await this.loadCommitDiff();
    }
  }

  private async loadWorkingDiff(): Promise<void> {
    if (!this.repositoryPath || !this.file) return;

    this.loading = true;
    this.error = null;
    this.diff = null;

    try {
      const result = await gitService.getFileDiff(
        this.repositoryPath,
        this.file.path,
        this.file.isStaged
      );

      if (result.success) {
        this.diff = result.data!;
        this.language = detectLanguage(this.file.path);
      } else {
        this.error = result.error?.message ?? 'Failed to load diff';
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      this.loading = false;
    }
  }

  private async loadCommitDiff(): Promise<void> {
    if (!this.repositoryPath || !this.commitFile) return;

    this.loading = true;
    this.error = null;
    this.diff = null;

    try {
      const result = await gitService.getCommitFileDiff(
        this.repositoryPath,
        this.commitFile.commitOid,
        this.commitFile.filePath
      );

      if (result.success) {
        this.diff = result.data!;
        this.language = detectLanguage(this.commitFile.filePath);
      } else {
        this.error = result.error?.message ?? 'Failed to load diff';
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      this.loading = false;
    }
  }

  private setViewMode(mode: DiffViewMode): void {
    this.viewMode = mode;
  }

  /**
   * Build a patch string for a specific hunk
   * The patch format requires diff headers and the hunk content
   */
  private buildHunkPatch(hunk: DiffHunk): string {
    if (!this.diff || !this.file) return '';

    const filePath = this.file.path;
    const fileStatus = this.diff.status;
    const lines: string[] = [];

    // Add diff header - use /dev/null for new/untracked files
    if (fileStatus === 'new' || fileStatus === 'untracked') {
      lines.push('--- /dev/null');
    } else {
      lines.push(`--- a/${filePath}`);
    }

    if (fileStatus === 'deleted') {
      lines.push('+++ /dev/null');
    } else {
      lines.push(`+++ b/${filePath}`);
    }

    // Add hunk header - trim whitespace and ensure clean format
    const header = hunk.header.trim();
    lines.push(header);

    // Add hunk lines with proper prefixes
    for (const line of hunk.lines) {
      // Skip metadata lines that shouldn't be in the patch content
      if (line.origin === 'hunk-header' || line.origin === 'file-header' || line.origin === 'binary') {
        continue;
      }

      // Handle "no newline at end of file" markers
      if (line.origin === 'del-eofnl' || line.origin === 'add-eofnl') {
        lines.push('\\ No newline at end of file');
        continue;
      }

      // Determine prefix based on origin
      let prefix = ' ';
      if (line.origin === 'addition') prefix = '+';
      else if (line.origin === 'deletion') prefix = '-';

      // Get content and strip only trailing newline
      const content = line.content.replace(/\n$/, '').replace(/\r$/, '');

      lines.push(prefix + content);
    }

    // Ensure patch ends with newline
    return lines.join('\n') + '\n';
  }

  /**
   * Stage a specific hunk
   */
  private async handleStageHunk(hunk: DiffHunk, e: Event): Promise<void> {
    e.stopPropagation();
    if (!this.repositoryPath || !this.file) return;

    const patch = this.buildHunkPatch(hunk);
    if (!patch) return;

    try {
      const result = await gitService.stageHunk(this.repositoryPath, patch);
      if (result.success) {
        // Dispatch event to refresh status
        this.dispatchEvent(new CustomEvent('status-changed', {
          bubbles: true,
          composed: true,
        }));
        // Reload diff - if file is fully staged, clear the view
        await this.loadWorkingDiff();
        // Check if we got a "not found" error (file fully staged)
        if (this.error?.includes('not found in diff')) {
          this.error = null;
          this.diff = null;
          this.file = null;
          this.dispatchEvent(new CustomEvent('file-cleared', {
            bubbles: true,
            composed: true,
          }));
        }
      } else {
        console.error('Failed to stage hunk:', result.error);
      }
    } catch (err) {
      console.error('Failed to stage hunk:', err);
    }
  }

  /**
   * Unstage a specific hunk
   */
  private async handleUnstageHunk(hunk: DiffHunk, e: Event): Promise<void> {
    e.stopPropagation();
    if (!this.repositoryPath || !this.file) return;

    const patch = this.buildHunkPatch(hunk);
    if (!patch) return;

    try {
      const result = await gitService.unstageHunk(this.repositoryPath, patch);
      if (result.success) {
        // Dispatch event to refresh status
        this.dispatchEvent(new CustomEvent('status-changed', {
          bubbles: true,
          composed: true,
        }));
        // Reload diff to show updated state
        await this.loadWorkingDiff();
      } else {
        console.error('Failed to unstage hunk:', result.error);
      }
    } catch (err) {
      console.error('Failed to unstage hunk:', err);
    }
  }

  private getLineClass(origin: string): string {
    switch (origin) {
      case 'addition':
        return 'addition';
      case 'deletion':
        return 'deletion';
      default:
        return 'context';
    }
  }

  private getOriginChar(origin: string): string {
    switch (origin) {
      case 'addition':
        return '+';
      case 'deletion':
        return '-';
      default:
        return ' ';
    }
  }

  private renderHighlightedContent(content: string): TemplateResult {
    const tokens = tokenizeLine(content, this.language);
    return html`${tokens.map(
      (token) => html`<span style="color: ${getTokenColor(token.type)}">${token.value}</span>`
    )}`;
  }

  private renderLine(line: DiffLine) {
    const lineClass = this.getLineClass(line.origin);
    const originChar = this.getOriginChar(line.origin);

    return html`
      <div class="line ${lineClass}">
        <div class="line-numbers">
          <span class="line-no old">${line.oldLineNo ?? ''}</span>
          <span class="line-no new">${line.newLineNo ?? ''}</span>
        </div>
        <span class="line-origin">${originChar}</span>
        <span class="line-content">${this.renderHighlightedContent(line.content)}</span>
      </div>
    `;
  }

  private renderHunk(hunk: DiffHunk, _index: number) {
    // Only show stage/unstage button for working directory diffs (not commit diffs)
    const showStageButton = this.file !== null && !this.commitFile;
    const isStaged = this.file?.isStaged ?? false;

    return html`
      <div class="hunk">
        <div class="hunk-header">
          <span class="hunk-header-text">${hunk.header}</span>
          ${showStageButton ? html`
            <div class="hunk-actions">
              ${isStaged ? html`
                <button
                  class="stage-btn unstage"
                  @click=${(e: Event) => this.handleUnstageHunk(hunk, e)}
                  title="Unstage this hunk"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                  Unstage
                </button>
              ` : html`
                <button
                  class="stage-btn stage"
                  @click=${(e: Event) => this.handleStageHunk(hunk, e)}
                  title="Stage this hunk"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                  Stage
                </button>
              `}
            </div>
          ` : nothing}
        </div>
        ${hunk.lines.map((line) => this.renderLine(line))}
      </div>
    `;
  }

  private convertToSplitLines(hunks: DiffHunk[]): SplitLine[] {
    const splitLines: SplitLine[] = [];

    for (const hunk of hunks) {
      // Add hunk header as a special line
      splitLines.push({
        left: { content: hunk.header, origin: 'hunk-header', oldLineNo: null, newLineNo: null },
        right: { content: hunk.header, origin: 'hunk-header', oldLineNo: null, newLineNo: null },
      });

      const deletions: DiffLine[] = [];
      const additions: DiffLine[] = [];

      for (const line of hunk.lines) {
        if (line.origin === 'deletion') {
          deletions.push(line);
        } else if (line.origin === 'addition') {
          additions.push(line);
        } else {
          // Context line - flush any pending deletions/additions first
          while (deletions.length || additions.length) {
            splitLines.push({
              left: deletions.shift() ?? null,
              right: additions.shift() ?? null,
            });
          }
          // Add context line to both sides
          splitLines.push({ left: line, right: line });
        }
      }

      // Flush remaining deletions/additions
      while (deletions.length || additions.length) {
        splitLines.push({
          left: deletions.shift() ?? null,
          right: additions.shift() ?? null,
        });
      }
    }

    return splitLines;
  }

  private renderSplitLine(line: DiffLine | null, side: 'left' | 'right') {
    if (!line) {
      return html`
        <div class="split-line empty">
          <span class="split-line-no"></span>
          <span class="split-line-content"></span>
        </div>
      `;
    }

    if (line.origin === 'hunk-header') {
      return html`
        <div class="split-line" style="background: var(--color-bg-tertiary); font-style: italic; color: var(--color-text-muted);">
          <span class="split-line-no"></span>
          <span class="split-line-content">${line.content}</span>
        </div>
      `;
    }

    const lineNo = side === 'left' ? line.oldLineNo : line.newLineNo;
    let lineClass = '';
    if (line.origin === 'deletion') lineClass = 'deletion';
    else if (line.origin === 'addition') lineClass = 'addition';

    return html`
      <div class="split-line ${lineClass}">
        <span class="split-line-no">${lineNo ?? ''}</span>
        <span class="split-line-content">${this.renderHighlightedContent(line.content)}</span>
      </div>
    `;
  }

  private renderSplitView() {
    if (!this.diff) return nothing;

    const splitLines = this.convertToSplitLines(this.diff.hunks);

    return html`
      <div class="split-container">
        <div class="split-pane">
          <div class="split-pane-header">Original</div>
          ${splitLines.map((sl) => this.renderSplitLine(sl.left, 'left'))}
        </div>
        <div class="split-pane">
          <div class="split-pane-header">Modified</div>
          ${splitLines.map((sl) => this.renderSplitLine(sl.right, 'right'))}
        </div>
      </div>
    `;
  }

  private renderUnifiedView() {
    if (!this.diff) return nothing;

    return html`
      <div class="diff-content">
        ${this.diff.hunks.length === 0
          ? html`<div class="empty">No changes in this file</div>`
          : this.diff.hunks.map((hunk, i) => this.renderHunk(hunk, i))}
      </div>
    `;
  }

  render() {
    if (!this.file && !this.commitFile) {
      return html`<div class="empty">No file selected</div>`;
    }

    if (this.loading) {
      return html`<div class="loading">Loading diff...</div>`;
    }

    if (this.error) {
      return html`<div class="error">${this.error}</div>`;
    }

    if (!this.diff) {
      return html`<div class="empty">No changes to display</div>`;
    }

    if (this.diff.isBinary) {
      return html`<div class="binary-notice">Binary file - cannot display diff</div>`;
    }

    return html`
      <div class="header">
        <div class="file-info">
          <span class="file-status ${this.diff.status}">${this.diff.status}</span>
          <div class="file-stats">
            <span class="additions">+${this.diff.additions}</span>
            <span class="deletions">-${this.diff.deletions}</span>
          </div>
        </div>
        <div class="view-controls">
          <button
            class="view-btn ${this.viewMode === 'unified' ? 'active' : ''}"
            @click=${() => this.setViewMode('unified')}
            title="Unified view"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"></rect>
              <line x1="3" y1="9" x2="21" y2="9"></line>
              <line x1="3" y1="15" x2="21" y2="15"></line>
            </svg>
          </button>
          <button
            class="view-btn ${this.viewMode === 'split' ? 'active' : ''}"
            @click=${() => this.setViewMode('split')}
            title="Split view"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"></rect>
              <line x1="12" y1="3" x2="12" y2="21"></line>
            </svg>
          </button>
        </div>
      </div>
      ${this.viewMode === 'split' ? this.renderSplitView() : this.renderUnifiedView()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-diff-view': LvDiffView;
  }
}
