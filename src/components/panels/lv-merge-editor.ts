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
import { codeStyles } from '../../styles/code-styles.ts';
import * as gitService from '../../services/git.service.ts';
import { CodeRenderMixin } from '../../mixins/code-render-mixin.ts';
import type { ConflictFile } from '../../types/git.types.ts';
import { isWhitespaceOnlyChange, computeInlineWhitespaceDiff } from '../../utils/diff-utils.ts';

interface OutputSegment {
  type: 'resolved' | 'conflict';
  lines: string[];
  oursLines: string[];
  theirsLines: string[];
  oursLabel: string;
  theirsLabel: string;
}

@customElement('lv-merge-editor')
export class LvMergeEditor extends CodeRenderMixin(LitElement) {
  static styles = [
    sharedStyles,
    codeStyles,
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

      .btn-both {
        background: rgba(168, 85, 247, 0.15);
        border-color: #a855f7;
        color: #a855f7;
      }

      .btn-both:hover {
        background: rgba(168, 85, 247, 0.25);
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
        font-family: var(--font-family-mono);
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

      .line-conflict {
        background: rgba(var(--color-warning-rgb, 234, 179, 8), 0.2);
      }

      .line-conflict .line-content {
        background: rgba(var(--color-warning-rgb, 234, 179, 8), 0.2);
      }

      .line-conflict .line-number {
        background: rgba(var(--color-warning-rgb, 234, 179, 8), 0.3);
      }

      /* Resolved line origin highlighting in output */
      .resolved-ours .line-content {
        background: rgba(var(--color-success-rgb, 34, 197, 94), 0.1);
      }

      .resolved-ours .line-number {
        border-left: 3px solid var(--color-success);
      }

      .resolved-theirs .line-content {
        background: rgba(var(--color-info-rgb, 59, 130, 246), 0.1);
      }

      .resolved-theirs .line-number {
        border-left: 3px solid var(--color-info);
      }

      .resolved-both .line-content {
        background: rgba(168, 85, 247, 0.1);
      }

      .resolved-both .line-number {
        border-left: 3px solid #a855f7;
      }

      .panel-content textarea {
        width: 100%;
        height: 100%;
        border: none;
        background: var(--color-bg-primary);
        color: var(--color-text-primary);
        font-family: var(--font-family-mono);
        font-size: var(--font-size-sm);
        line-height: 1.5;
        padding: var(--spacing-sm);
        resize: none;
      }

      .panel-content textarea:focus {
        outline: none;
      }

      /* Editable code view with line gutter */
      .editable-code-container {
        display: flex;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }

      .line-gutter {
        flex-shrink: 0;
        width: 50px;
        background: var(--color-bg-tertiary);
        border-right: 1px solid var(--color-border);
        overflow: hidden;
        user-select: none;
      }

      .gutter-line {
        height: 1.5em;
        padding: 0 var(--spacing-sm);
        text-align: right;
        font-family: var(--font-family-mono);
        font-size: var(--font-size-sm);
        line-height: 1.5;
        color: var(--color-text-muted);
      }

      .editable-textarea {
        flex: 1;
        font-family: var(--font-family-mono);
        font-size: var(--font-size-sm);
        line-height: 1.5;
        padding: 0 var(--spacing-sm);
        margin: 0;
        border: none;
        background: var(--color-bg-primary);
        color: var(--color-text-primary);
        resize: none;
        overflow: auto;
        white-space: pre;
        tab-size: 4;
      }

      .editable-textarea:focus {
        outline: none;
      }

      .editable-textarea::selection {
        background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.3);
      }

      /* Line highlighting for conflict markers */
      .line-conflict-marker {
        background: rgba(var(--color-warning-rgb, 234, 179, 8), 0.3);
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

      .conflict-pick-btn {
        padding: 2px 8px;
        font-size: var(--font-size-xs);
      }

      .output-mode-toggle {
        margin-left: var(--spacing-sm);
      }

      .conflict-count {
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
  @state() private outputEditMode: 'visual' | 'raw' = 'visual';

  /**
   * Maps output line index (within resolved segments) to resolution origin.
   * Used to color-code resolved lines in the output visual.
   */
  private lineOrigins: Map<number, 'ours' | 'theirs' | 'both'> = new Map();

  /**
   * Compute line origins by comparing resolved output lines against base/ours/theirs.
   * Lines not present in base but present in ours → 'ours', in theirs → 'theirs'.
   */
  private computeLineOrigins(): void {
    const baseLines = this.baseContent.split('\n');
    const oursLines = this.oursContent.split('\n');
    const theirsLines = this.theirsContent.split('\n');

    const baseSet = new Set(baseLines);
    const oursNewLines = new Set(oursLines.filter(l => !baseSet.has(l)));
    const theirsNewLines = new Set(theirsLines.filter(l => !baseSet.has(l)));

    const newOrigins = new Map<number, 'ours' | 'theirs' | 'both'>();
    const segments = this.parseOutputSegments();
    let lineIdx = 0;

    for (const segment of segments) {
      if (segment.type === 'resolved') {
        for (const line of segment.lines) {
          if (!baseSet.has(line)) {
            const inOurs = oursNewLines.has(line);
            const inTheirs = theirsNewLines.has(line);

            if (inOurs && !inTheirs) {
              newOrigins.set(lineIdx, 'ours');
            } else if (inTheirs && !inOurs) {
              newOrigins.set(lineIdx, 'theirs');
            } else if (inOurs && inTheirs) {
              newOrigins.set(lineIdx, 'both');
            }
          }
          lineIdx++;
        }
      } else {
        // Skip conflict marker lines in the old output
        lineIdx += 1 + segment.oursLines.length + 1 + segment.theirsLines.length + 1;
      }
    }

    this.lineOrigins = newOrigins;
  }

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('conflictFile') && this.conflictFile) {
      await this.loadContents();
    }
  }

  private async loadContents(): Promise<void> {
    if (!this.repositoryPath || !this.conflictFile) return;

    this.loading = true;

    // Initialize Shiki highlighter and detect language
    await this.initCodeLanguage(this.conflictFile.path);

    try {
      // Load all three versions and the working directory file in parallel
      // The working directory file contains git's proper 3-way merge with conflict markers
      const [ancestorResult, oursResult, theirsResult, workdirResult] = await Promise.all([
        this.conflictFile.ancestor?.oid
          ? gitService.getBlobContent(this.repositoryPath, this.conflictFile.ancestor.oid)
          : Promise.resolve({ success: true, data: '' }),
        this.conflictFile.ours?.oid
          ? gitService.getBlobContent(this.repositoryPath, this.conflictFile.ours.oid)
          : Promise.resolve({ success: true, data: '' }),
        this.conflictFile.theirs?.oid
          ? gitService.getBlobContent(this.repositoryPath, this.conflictFile.theirs.oid)
          : Promise.resolve({ success: true, data: '' }),
        // Read the working directory file - git has already done a proper diff3 merge
        gitService.readFileContent(this.repositoryPath, this.conflictFile.path),
      ]);

      this.baseContent = ancestorResult.success ? (ancestorResult.data || '') : '';
      this.oursContent = oursResult.success ? (oursResult.data || '') : '';
      this.theirsContent = theirsResult.success ? (theirsResult.data || '') : '';

      // Use git's merged output from the working directory (has proper conflict markers)
      // Fall back to naive merge only if we can't read the working directory file
      this.outputContent = workdirResult.success && workdirResult.data
        ? workdirResult.data
        : this.performAutoMerge();
      // Compute which output lines came from which branch
      this.computeLineOrigins();
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

  private parseOutputSegments(): OutputSegment[] {
    const lines = this.outputContent.split('\n');
    const segments: OutputSegment[] = [];
    let currentResolved: string[] = [];
    let inConflict = false;
    let inOurs = false;
    let oursLines: string[] = [];
    let theirsLines: string[] = [];
    let oursLabel = '';
    let theirsLabel = '';

    for (const line of lines) {
      if (line.startsWith('<<<<<<<')) {
        // Flush any accumulated resolved lines
        if (currentResolved.length > 0) {
          segments.push({
            type: 'resolved',
            lines: currentResolved,
            oursLines: [],
            theirsLines: [],
            oursLabel: '',
            theirsLabel: '',
          });
          currentResolved = [];
        }
        inConflict = true;
        inOurs = true;
        oursLines = [];
        theirsLines = [];
        oursLabel = line.slice(7).trim() || 'OURS';
        theirsLabel = '';
      } else if (line.startsWith('=======') && inConflict) {
        inOurs = false;
      } else if (line.startsWith('>>>>>>>') && inConflict) {
        theirsLabel = line.slice(7).trim() || 'THEIRS';
        segments.push({
          type: 'conflict',
          lines: [],
          oursLines: [...oursLines],
          theirsLines: [...theirsLines],
          oursLabel,
          theirsLabel,
        });
        inConflict = false;
        inOurs = false;
        oursLines = [];
        theirsLines = [];
      } else if (inConflict) {
        if (inOurs) {
          oursLines.push(line);
        } else {
          theirsLines.push(line);
        }
      } else {
        currentResolved.push(line);
      }
    }

    // Flush remaining resolved lines
    if (currentResolved.length > 0) {
      segments.push({
        type: 'resolved',
        lines: currentResolved,
        oursLines: [],
        theirsLines: [],
        oursLabel: '',
        theirsLabel: '',
      });
    }

    return segments;
  }

  private handleOutputChange(e: Event): void {
    const textarea = e.target as HTMLTextAreaElement;
    this.outputContent = textarea.value;
  }

  private handleAcceptOurs(): void {
    this.outputContent = this.oursContent;
    this.computeLineOrigins();
  }

  private handleAcceptTheirs(): void {
    this.outputContent = this.theirsContent;
    this.computeLineOrigins();
  }

  private handleAcceptBase(): void {
    this.outputContent = this.baseContent;
    this.computeLineOrigins();
  }

  private handleAcceptOursPanel(): void {
    this.outputContent = this.oursContent;
    this.computeLineOrigins();
  }

  private handleAcceptTheirsPanel(): void {
    this.outputContent = this.theirsContent;
    this.computeLineOrigins();
  }

  private async handleMarkResolved(): Promise<void> {
    if (!this.repositoryPath || !this.conflictFile) return;

    // Check for remaining conflicts using segment parsing
    const segments = this.parseOutputSegments();
    const unresolvedCount = segments.filter(s => s.type === 'conflict').length;
    if (unresolvedCount > 0) {
      const proceed = confirm(
        `There ${unresolvedCount === 1 ? 'is' : 'are'} ${unresolvedCount} unresolved conflict${unresolvedCount === 1 ? '' : 's'}. Are you sure you want to mark this as resolved?`
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

  private renderCodeView(content: string, diffAgainst?: string): ReturnType<typeof html> {
    const lines = content.split('\n');
    const compareLines = diffAgainst?.split('\n') ?? [];

    return html`
      <div class="code-view">
        ${lines.map((line, index) => {
          const compareLine = compareLines[index];
          let lineClass = '';
          let wsSegments: ReturnType<typeof computeInlineWhitespaceDiff> | null = null;

          if (diffAgainst !== undefined) {
            if (compareLine === undefined) {
              lineClass = 'code-addition';
            } else if (line !== compareLine) {
              if (isWhitespaceOnlyChange(compareLine, line)) {
                lineClass = 'code-ws-change';
                wsSegments = computeInlineWhitespaceDiff(compareLine, line);
              } else {
                lineClass = 'line-conflict';
              }
            }
          }

          const lineContent = wsSegments
            ? this.renderInlineWhitespaceContent(wsSegments)
            : (this.renderHighlightedContent(line) || html`${' '}`);

          return html`
            <div class="code-line ${lineClass}">
              <span class="line-number">${index + 1}</span>
              <span class="line-content">${lineContent}</span>
            </div>
          `;
        })}
      </div>
    `;
  }

  /**
   * Render an editable code view with line numbers
   * Uses a synchronized gutter approach for reliable display
   */
  private renderEditableCodeView(content: string): ReturnType<typeof html> {
    const lineCount = content.split('\n').length;

    return html`
      <div class="editable-code-container">
        <div class="line-gutter" id="output-gutter">
          ${Array.from({ length: lineCount }, (_, i) => html`
            <div class="gutter-line">${i + 1}</div>
          `)}
        </div>
        <textarea
          class="editable-textarea"
          .value=${content}
          @input=${this.handleOutputChange}
          @scroll=${this.handleTextareaScroll}
          spellcheck="false"
        ></textarea>
      </div>
    `;
  }

  private renderOutputVisual(): ReturnType<typeof html> {
    const segments = this.parseOutputSegments();
    let lineNum = 1;
    let lineIdx = 0;

    return html`
      <div class="code-view">
        ${segments.map((segment, segIdx) => {
          if (segment.type === 'resolved') {
            return html`${segment.lines.map((line) => {
              const num = lineNum++;
              const origin = this.lineOrigins.get(lineIdx);
              lineIdx++;
              const originClass = origin === 'ours' ? 'resolved-ours'
                : origin === 'theirs' ? 'resolved-theirs'
                : origin === 'both' ? 'resolved-both'
                : '';
              return html`
                <div class="code-line ${originClass}">
                  <span class="line-number">${num}</span>
                  <span class="line-content">${this.renderHighlightedContent(line) || html`${' '}`}</span>
                </div>
              `;
            })}`;
          }
          // Skip conflict marker lines for lineIdx tracking
          lineIdx += 1 + segment.oursLines.length + 1 + segment.theirsLines.length + 1;
          // Conflict segment
          const oursStart = lineNum;
          const oursEnd = oursStart + segment.oursLines.length;
          const theirsEnd = oursEnd + segment.theirsLines.length;
          // Advance lineNum past all conflict content lines
          lineNum = theirsEnd;

          return html`
            <div class="code-conflict-block">
              <div class="code-conflict-header">
                <span>Conflict</span>
                <div class="code-conflict-header-actions">
                  <button class="btn btn-ours conflict-pick-btn" @click=${() => this.resolveOutputConflict(segIdx, 'ours')}>
                    Use Ours
                  </button>
                  <button class="btn btn-theirs conflict-pick-btn" @click=${() => this.resolveOutputConflict(segIdx, 'theirs')}>
                    Use Theirs
                  </button>
                  <button class="btn btn-both conflict-pick-btn" @click=${() => this.resolveOutputConflict(segIdx, 'both')}>
                    Use Both
                  </button>
                </div>
              </div>
              <div class="code-conflict-side-ours">
                <div class="code-conflict-side-label">${segment.oursLabel}</div>
                ${segment.oursLines.map((line, i) => html`
                  <div class="code-line">
                    <span class="line-number">${oursStart + i}</span>
                    <span class="line-content">${this.renderHighlightedContent(line) || html`${' '}`}</span>
                  </div>
                `)}
              </div>
              <div class="code-conflict-divider"></div>
              <div class="code-conflict-side-theirs">
                <div class="code-conflict-side-label">${segment.theirsLabel}</div>
                ${segment.theirsLines.map((line, i) => html`
                  <div class="code-line">
                    <span class="line-number">${oursEnd + i}</span>
                    <span class="line-content">${this.renderHighlightedContent(line) || html`${' '}`}</span>
                  </div>
                `)}
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }

  private resolveOutputConflict(segmentIndex: number, choice: 'ours' | 'theirs' | 'both'): void {
    const segments = this.parseOutputSegments();

    const resultLines: string[] = [];
    let conflictIdx = 0;

    for (const segment of segments) {
      if (segment.type === 'resolved') {
        resultLines.push(...segment.lines);
      } else {
        if (conflictIdx === segmentIndex) {
          if (choice === 'ours' || choice === 'both') {
            resultLines.push(...segment.oursLines);
          }
          if (choice === 'theirs' || choice === 'both') {
            resultLines.push(...segment.theirsLines);
          }
        } else {
          // Keep conflict markers for unresolved conflicts
          resultLines.push(`<<<<<<< ${segment.oursLabel}`);
          resultLines.push(...segment.oursLines);
          resultLines.push('=======');
          resultLines.push(...segment.theirsLines);
          resultLines.push(`>>>>>>> ${segment.theirsLabel}`);
        }
        conflictIdx++;
      }
    }

    this.outputContent = resultLines.join('\n');
    this.computeLineOrigins();
  }

  private toggleOutputEditMode(): void {
    this.outputEditMode = this.outputEditMode === 'visual' ? 'raw' : 'visual';
  }

  /**
   * Sync scroll position from the output panel to all source panels.
   * Uses scroll percentage to handle panels with different content heights.
   */
  private handleOutputScroll(e: Event): void {
    const output = e.target as HTMLElement;
    const scrollRatio = output.scrollHeight > output.clientHeight
      ? output.scrollTop / (output.scrollHeight - output.clientHeight)
      : 0;

    const panelIds = ['panel-ours', 'panel-base', 'panel-theirs'];
    for (const id of panelIds) {
      const panel = this.shadowRoot?.getElementById(id);
      if (panel) {
        const maxScroll = panel.scrollHeight - panel.clientHeight;
        panel.scrollTop = scrollRatio * maxScroll;
      }
    }
  }

  /**
   * Sync scroll position between textarea and line gutter
   */
  private handleTextareaScroll(e: Event): void {
    const textarea = e.target as HTMLTextAreaElement;
    const gutter = this.shadowRoot?.getElementById('output-gutter');
    if (gutter) {
      gutter.scrollTop = textarea.scrollTop;
    }
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
    const outputSegments = this.parseOutputSegments();
    const conflictCount = outputSegments.filter(s => s.type === 'conflict').length;

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
            <div class="panel-content readonly" id="panel-ours">
              ${this.renderCodeView(this.oursContent, this.baseContent)}
            </div>
          </div>

          <div class="editor-panel">
            <div class="panel-header base">
              Base (Common Ancestor)
              <span class="panel-stats">${this.getLineCount(this.baseContent)} lines</span>
            </div>
            <div class="panel-content readonly" id="panel-base">
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
            <div class="panel-content readonly" id="panel-theirs">
              ${this.renderCodeView(this.theirsContent, this.baseContent)}
            </div>
          </div>
        </div>

        <div class="output-panel">
          <div class="panel-header output">
            Output
            ${conflictCount > 0
              ? html`<span class="conflict-count">${conflictCount} conflict${conflictCount === 1 ? '' : 's'} remaining</span>`
              : html`<span class="conflict-count">No conflicts</span>`}
            <button class="panel-header-btn output-mode-toggle" @click=${this.toggleOutputEditMode}>
              ${this.outputEditMode === 'visual' ? 'Raw Edit' : 'Visual'}
            </button>
          </div>
          <div
            class="panel-content${this.outputEditMode === 'visual' ? ' readonly' : ''}"
            id="panel-output"
            @scroll=${this.handleOutputScroll}
          >
            ${this.outputEditMode === 'visual'
              ? this.renderOutputVisual()
              : this.renderEditableCodeView(this.outputContent)}
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
