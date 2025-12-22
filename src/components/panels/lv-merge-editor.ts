/**
 * Merge Editor Component
 * A 3-way merge editor for resolving conflicts (Beyond Compare style)
 *
 * Layout:
 * +------------------+------------------+------------------+
 * |      OURS        |       BASE       |      THEIRS      |
 * |  (Current Branch)|    (Ancestor)    |    (Incoming)    |
 * +------------------+------------------+------------------+
 * |                     OUTPUT (Editable)                  |
 * +-------------------------------------------------------+
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import {
  initHighlighter,
  detectLanguage,
  highlightLineSync,
  preloadLanguage,
} from '../../utils/shiki-highlighter.ts';
import type { BundledLanguage } from 'shiki';
import type { ConflictFile } from '../../types/git.types.ts';

@customElement('lv-merge-editor')
export class LvMergeEditor extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--color-bg-primary);
      }

      .toolbar {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-bg-secondary);
        border-bottom: 1px solid var(--color-border);
      }

      .toolbar-title {
        flex: 1;
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .toolbar-actions {
        display: flex;
        gap: var(--spacing-sm);
      }

      .btn {
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        border: 1px solid var(--color-border);
        background: var(--color-bg-primary);
        color: var(--color-text-primary);
        transition: all var(--transition-fast);
      }

      .btn:hover {
        background: var(--color-bg-hover);
      }

      .btn-primary {
        background: var(--color-primary);
        color: var(--color-text-inverse);
        border-color: var(--color-primary);
      }

      .btn-primary:hover {
        background: var(--color-primary-hover);
      }

      .btn-ours {
        background: rgba(var(--color-success-rgb, 34, 197, 94), 0.15);
        border-color: var(--color-success);
        color: var(--color-success);
      }

      .btn-ours:hover {
        background: rgba(var(--color-success-rgb, 34, 197, 94), 0.25);
      }

      .btn-theirs {
        background: rgba(var(--color-info-rgb, 59, 130, 246), 0.15);
        border-color: var(--color-info);
        color: var(--color-info);
      }

      .btn-theirs:hover {
        background: rgba(var(--color-info-rgb, 59, 130, 246), 0.25);
      }

      .editor-container {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
      }

      .source-panels {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        height: 50%;
        min-height: 200px;
        border-bottom: 2px solid var(--color-border);
      }

      .output-panel {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 200px;
      }

      .editor-panel {
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--color-border);
        overflow: hidden;
      }

      .editor-panel:last-child {
        border-right: none;
      }

      .panel-header {
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-bottom: 1px solid var(--color-border);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-secondary);
        text-align: center;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
      }

      .panel-header.ours {
        background: rgba(var(--color-success-rgb, 34, 197, 94), 0.1);
        color: var(--color-success);
      }

      .panel-header.base {
        background: rgba(var(--color-text-muted-rgb, 128, 128, 128), 0.1);
        color: var(--color-text-muted);
      }

      .panel-header.theirs {
        background: rgba(var(--color-info-rgb, 59, 130, 246), 0.1);
        color: var(--color-info);
      }

      .panel-header.output {
        background: rgba(var(--color-warning-rgb, 234, 179, 8), 0.1);
        color: var(--color-warning);
      }

      .panel-header-btn {
        padding: 2px 6px;
        font-size: var(--font-size-xs);
        border-radius: var(--radius-xs);
        cursor: pointer;
        border: 1px solid currentColor;
        background: transparent;
        color: inherit;
        opacity: 0.8;
      }

      .panel-header-btn:hover {
        opacity: 1;
        background: rgba(255, 255, 255, 0.1);
      }

      .panel-content {
        flex: 1;
        overflow: auto;
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        line-height: 1.5;
        background: var(--color-bg-primary);
      }

      .panel-content.readonly {
        background: var(--color-bg-secondary);
      }

      .code-view {
        display: table;
        width: 100%;
        border-collapse: collapse;
      }

      .code-line {
        display: table-row;
      }

      .code-line:hover {
        background: var(--color-bg-hover);
      }

      .line-number {
        display: table-cell;
        width: 40px;
        padding: 0 var(--spacing-sm);
        text-align: right;
        color: var(--color-text-muted);
        background: var(--color-bg-tertiary);
        border-right: 1px solid var(--color-border);
        user-select: none;
        font-size: var(--font-size-xs);
      }

      .line-content {
        display: table-cell;
        padding: 0 var(--spacing-sm);
        white-space: pre-wrap;
        word-break: break-all;
      }

      .line-added {
        background: rgba(var(--color-success-rgb, 34, 197, 94), 0.15);
      }

      .line-removed {
        background: rgba(var(--color-error-rgb, 239, 68, 68), 0.15);
      }

      .line-conflict {
        background: rgba(var(--color-warning-rgb, 234, 179, 8), 0.2);
      }

      .panel-content textarea {
        width: 100%;
        height: 100%;
        border: none;
        background: var(--color-bg-primary);
        color: var(--color-text-primary);
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        line-height: 1.5;
        padding: var(--spacing-sm);
        resize: none;
      }

      .panel-content textarea:focus {
        outline: none;
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--color-text-muted);
      }

      .empty {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--color-text-muted);
        font-style: italic;
      }

      .resize-handle {
        height: 4px;
        background: var(--color-border);
        cursor: row-resize;
        transition: background var(--transition-fast);
      }

      .resize-handle:hover {
        background: var(--color-primary);
      }

      .diff-indicator {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-left: var(--spacing-xs);
      }

      .diff-indicator.has-changes {
        background: var(--color-warning);
      }

      .diff-indicator.no-changes {
        background: var(--color-success);
      }

      .panel-stats {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        margin-left: auto;
      }
    `,
  ];

  @property({ type: String }) repositoryPath = '';
  @property({ type: Object }) conflictFile: ConflictFile | null = null;

  @state() private baseContent = '';
  @state() private oursContent = '';
  @state() private theirsContent = '';
  @state() private outputContent = '';
  @state() private loading = false;

  private language: BundledLanguage | null = null;

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('conflictFile') && this.conflictFile) {
      await this.loadContents();
    }
  }

  private async loadContents(): Promise<void> {
    if (!this.repositoryPath || !this.conflictFile) return;

    this.loading = true;

    // Initialize Shiki highlighter and detect language
    await initHighlighter();
    this.language = detectLanguage(this.conflictFile.path);
    if (this.language) {
      await preloadLanguage(this.language);
    }

    try {
      // Load all three versions in parallel
      const [ancestorResult, oursResult, theirsResult] = await Promise.all([
        this.conflictFile.ancestor?.oid
          ? gitService.getBlobContent(this.repositoryPath, this.conflictFile.ancestor.oid)
          : Promise.resolve({ success: true, data: '' }),
        this.conflictFile.ours?.oid
          ? gitService.getBlobContent(this.repositoryPath, this.conflictFile.ours.oid)
          : Promise.resolve({ success: true, data: '' }),
        this.conflictFile.theirs?.oid
          ? gitService.getBlobContent(this.repositoryPath, this.conflictFile.theirs.oid)
          : Promise.resolve({ success: true, data: '' }),
      ]);

      this.baseContent = ancestorResult.success ? (ancestorResult.data || '') : '';
      this.oursContent = oursResult.success ? (oursResult.data || '') : '';
      this.theirsContent = theirsResult.success ? (theirsResult.data || '') : '';

      // Start with a 3-way merge attempt
      this.outputContent = this.performAutoMerge();
    } catch (err) {
      console.error('Failed to load conflict contents:', err);
    } finally {
      this.loading = false;
    }
  }

  /**
   * Attempt automatic 3-way merge
   * If there are conflicts, insert conflict markers
   */
  private performAutoMerge(): string {
    const baseLines = this.baseContent.split('\n');
    const oursLines = this.oursContent.split('\n');
    const theirsLines = this.theirsContent.split('\n');

    // Simple line-by-line merge algorithm
    const result: string[] = [];
    const maxLen = Math.max(baseLines.length, oursLines.length, theirsLines.length);

    let i = 0;
    while (i < maxLen) {
      const baseLine = baseLines[i] ?? '';
      const oursLine = oursLines[i] ?? '';
      const theirsLine = theirsLines[i] ?? '';

      if (oursLine === theirsLine) {
        // Both sides agree
        result.push(oursLine);
      } else if (oursLine === baseLine) {
        // Only theirs changed
        result.push(theirsLine);
      } else if (theirsLine === baseLine) {
        // Only ours changed
        result.push(oursLine);
      } else {
        // Conflict - both sides changed differently
        result.push('<<<<<<< OURS');
        result.push(oursLine);
        result.push('=======');
        result.push(theirsLine);
        result.push('>>>>>>> THEIRS');
      }
      i++;
    }

    return result.join('\n');
  }

  private handleOutputChange(e: Event): void {
    const textarea = e.target as HTMLTextAreaElement;
    this.outputContent = textarea.value;
  }

  private handleAcceptOurs(): void {
    this.outputContent = this.oursContent;
  }

  private handleAcceptTheirs(): void {
    this.outputContent = this.theirsContent;
  }

  private handleAcceptBase(): void {
    this.outputContent = this.baseContent;
  }

  private handleAcceptOursPanel(): void {
    this.outputContent = this.oursContent;
  }

  private handleAcceptTheirsPanel(): void {
    this.outputContent = this.theirsContent;
  }

  private async handleMarkResolved(): Promise<void> {
    if (!this.repositoryPath || !this.conflictFile) return;

    // Check for remaining conflict markers
    if (this.outputContent.includes('<<<<<<<') ||
        this.outputContent.includes('=======') ||
        this.outputContent.includes('>>>>>>>')) {
      const proceed = confirm(
        'The output still contains conflict markers. Are you sure you want to mark this as resolved?'
      );
      if (!proceed) return;
    }

    const result = await gitService.resolveConflict(
      this.repositoryPath,
      this.conflictFile.path,
      this.outputContent
    );

    if (result.success) {
      this.dispatchEvent(new CustomEvent('conflict-resolved', {
        detail: { file: this.conflictFile },
        bubbles: true,
        composed: true,
      }));
    } else {
      console.error('Failed to resolve conflict:', result.error);
    }
  }

  public getResolvedContent(): string {
    return this.outputContent;
  }

  private renderHighlightedContent(content: string) {
    const tokens = highlightLineSync(content, this.language);
    return html`${tokens.map(
      (token) => html`<span style="color: ${token.color}">${token.content}</span>`
    )}`;
  }

  private renderCodeView(content: string, diffAgainst?: string): ReturnType<typeof html> {
    const lines = content.split('\n');
    const compareLines = diffAgainst?.split('\n') ?? [];

    return html`
      <div class="code-view">
        ${lines.map((line, index) => {
          const compareLine = compareLines[index];
          let lineClass = '';

          if (diffAgainst !== undefined) {
            if (compareLine === undefined) {
              lineClass = 'line-added';
            } else if (line !== compareLine) {
              lineClass = 'line-conflict';
            }
          }

          return html`
            <div class="code-line ${lineClass}">
              <span class="line-number">${index + 1}</span>
              <span class="line-content">${this.renderHighlightedContent(line) || ' '}</span>
            </div>
          `;
        })}
      </div>
    `;
  }

  private getLineCount(content: string): number {
    return content ? content.split('\n').length : 0;
  }

  private getDiffCount(content: string, base: string): number {
    const lines = content.split('\n');
    const baseLines = base.split('\n');
    let diffs = 0;

    const maxLen = Math.max(lines.length, baseLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (lines[i] !== baseLines[i]) diffs++;
    }

    return diffs;
  }

  render() {
    if (!this.conflictFile) {
      return html`<div class="empty">Select a file to resolve</div>`;
    }

    if (this.loading) {
      return html`<div class="loading">Loading file contents...</div>`;
    }

    const oursChanges = this.getDiffCount(this.oursContent, this.baseContent);
    const theirsChanges = this.getDiffCount(this.theirsContent, this.baseContent);
    const hasConflictMarkers = this.outputContent.includes('<<<<<<<');

    return html`
      <div class="toolbar">
        <span class="toolbar-title">${this.conflictFile.path}</span>
        <div class="toolbar-actions">
          <button class="btn" @click=${this.handleAcceptBase} title="Reset to common ancestor">
            Use Base
          </button>
          <button class="btn btn-ours" @click=${this.handleAcceptOurs} title="Use entire file from current branch">
            Use Ours
          </button>
          <button class="btn btn-theirs" @click=${this.handleAcceptTheirs} title="Use entire file from incoming branch">
            Use Theirs
          </button>
          <button class="btn btn-primary" @click=${this.handleMarkResolved}>
            Mark Resolved
          </button>
        </div>
      </div>

      <div class="editor-container">
        <div class="source-panels">
          <div class="editor-panel">
            <div class="panel-header ours">
              Ours (Current Branch)
              <span class="panel-stats">${oursChanges} changes from base</span>
              <button class="panel-header-btn" @click=${this.handleAcceptOursPanel} title="Use this version">
                Use
              </button>
            </div>
            <div class="panel-content readonly">
              ${this.renderCodeView(this.oursContent, this.baseContent)}
            </div>
          </div>

          <div class="editor-panel">
            <div class="panel-header base">
              Base (Common Ancestor)
              <span class="panel-stats">${this.getLineCount(this.baseContent)} lines</span>
            </div>
            <div class="panel-content readonly">
              ${this.renderCodeView(this.baseContent)}
            </div>
          </div>

          <div class="editor-panel">
            <div class="panel-header theirs">
              Theirs (Incoming)
              <span class="panel-stats">${theirsChanges} changes from base</span>
              <button class="panel-header-btn" @click=${this.handleAcceptTheirsPanel} title="Use this version">
                Use
              </button>
            </div>
            <div class="panel-content readonly">
              ${this.renderCodeView(this.theirsContent, this.baseContent)}
            </div>
          </div>
        </div>

        <div class="output-panel">
          <div class="panel-header output">
            Output (Edit to Resolve)
            ${hasConflictMarkers
              ? html`<span class="diff-indicator has-changes" title="Contains conflict markers"></span>`
              : html`<span class="diff-indicator no-changes" title="No conflict markers"></span>`}
            <span class="panel-stats">${this.getLineCount(this.outputContent)} lines</span>
          </div>
          <div class="panel-content">
            <textarea
              .value=${this.outputContent}
              @input=${this.handleOutputChange}
              spellcheck="false"
            ></textarea>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-merge-editor': LvMergeEditor;
  }
}
