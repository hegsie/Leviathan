import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { codeStyles } from '../../styles/code-styles.ts';
import * as gitService from '../../services/git.service.ts';
import { CodeRenderMixin } from '../../mixins/code-render-mixin.ts';
import type { DiffFile, DiffHunk, DiffLine, StatusEntry } from '../../types/git.types.ts';
import {
  findWhitespaceOnlyPairs,
  computeInlineWhitespaceDiff,
  isWhitespaceOnlyChange,
  type InlineDiffSegment,
} from '../../utils/diff-utils.ts';
import './lv-image-diff.ts';

type DiffViewMode = 'unified' | 'split';

interface DiffSegment {
  text: string;
  changed: boolean;
}

interface WordDiffResult {
  oldSegments: DiffSegment[];
  newSegments: DiffSegment[];
}

/**
 * Compute word-level diff between two lines.
 * Splits lines into word tokens and uses an LCS algorithm to identify changed words.
 */
function computeWordDiff(oldLine: string, newLine: string): WordDiffResult {
  const tokenize = (line: string): string[] => {
    // Split on word boundaries: whitespace sequences and punctuation are separate tokens
    const tokens: string[] = [];
    const regex = /(\s+|[^\s\w]|[\w]+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      tokens.push(match[0]);
    }
    return tokens;
  };

  const oldTokens = tokenize(oldLine);
  const newTokens = tokenize(newLine);

  // Build LCS table
  const m = oldTokens.length;
  const n = newTokens.length;

  // Optimization: if either side is empty, everything on the other side is changed
  if (m === 0) {
    return {
      oldSegments: [],
      newSegments: newTokens.length > 0 ? [{ text: newLine, changed: true }] : [],
    };
  }
  if (n === 0) {
    return {
      oldSegments: oldTokens.length > 0 ? [{ text: oldLine, changed: true }] : [],
      newSegments: [],
    };
  }

  // Use a 2D table for LCS (kept simple for typical line lengths)
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldTokens[i - 1] === newTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find which tokens are in the LCS
  const oldInLCS = new Array<boolean>(m).fill(false);
  const newInLCS = new Array<boolean>(n).fill(false);
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (oldTokens[i - 1] === newTokens[j - 1]) {
      oldInLCS[i - 1] = true;
      newInLCS[j - 1] = true;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  // Build segments by merging consecutive tokens with same changed status
  const buildSegments = (tokens: string[], inLCS: boolean[]): DiffSegment[] => {
    const segments: DiffSegment[] = [];
    for (let k = 0; k < tokens.length; k++) {
      const changed = !inLCS[k];
      if (segments.length > 0 && segments[segments.length - 1].changed === changed) {
        segments[segments.length - 1].text += tokens[k];
      } else {
        segments.push({ text: tokens[k], changed });
      }
    }
    return segments;
  };

  return {
    oldSegments: buildSegments(oldTokens, oldInLCS),
    newSegments: buildSegments(newTokens, newInLCS),
  };
}

interface SplitLine {
  left: DiffLine | null;
  right: DiffLine | null;
  isWhitespaceOnly?: boolean;
  inlineSegments?: InlineDiffSegment[];
}

interface ConflictRegion {
  index: number;
  startLine: number;
  endLine: number;
  oursStart: number;
  oursEnd: number;
  theirsStart: number;
  theirsEnd: number;
  oursContent: string;
  theirsContent: string;
}

interface DiffContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  line: DiffLine | null;
  hunk: DiffHunk | null;
}

/** Unique key for a line within the diff */
type LineKey = `${number}-${number}`;

/**
 * Diff view component
 * Displays file diff with syntax highlighting and line numbers
 * Supports unified and split view modes
 */
@customElement('lv-diff-view')
export class LvDiffView extends CodeRenderMixin(LitElement) {
  static styles = [
    sharedStyles,
    codeStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        font-family: var(--font-family-mono);
        font-size: var(--font-size-xs);
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

      .hunk-separator {
        position: relative;
        height: 8px;
        display: flex;
        align-items: center;
        min-width: max-content;
      }

      .hunk-separator-line {
        flex: 1;
        height: 1px;
        background: var(--color-border);
      }

      .hunk-separator-actions {
        display: none;
        position: absolute;
        right: var(--spacing-sm);
        top: 50%;
        transform: translateY(-50%);
        z-index: 1;
      }

      .hunk-separator:hover .hunk-separator-actions {
        display: flex;
        gap: var(--spacing-xs);
      }

      .hunk-separator-split {
        height: 4px;
        border-top: 1px solid var(--color-border);
        min-width: max-content;
      }

      .hunk-actions {
        display: flex;
        gap: var(--spacing-xs);
        flex-shrink: 0;
        margin-left: var(--spacing-sm);
      }

      .hunk.active {
        border-left: 3px solid var(--color-primary);
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
        min-width: max-content;
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
      }

      .line.code-addition .line-origin {
        color: var(--color-success);
      }

      .line.code-deletion .line-origin {
        color: var(--color-error);
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
        min-width: max-content;
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
      }

      .split-line.empty {
        background: var(--color-bg-tertiary);
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

      .partial-staging-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-info-bg, rgba(56, 132, 255, 0.1));
        border-bottom: 1px solid var(--color-info, #3884ff);
        color: var(--color-info, #3884ff);
        font-size: var(--font-size-xs);
      }

      .partial-staging-info svg {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
      }

      /* Edit mode styles */
      .edit-btn {
        padding: var(--spacing-xs) var(--spacing-sm);
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-secondary);
        cursor: pointer;
        font-size: var(--font-size-xs);
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        transition: all 0.15s ease;
      }

      .edit-btn:hover {
        background: var(--color-bg-hover);
      }

      .edit-btn.active {
        background: var(--color-accent-bg);
        border-color: var(--color-accent);
        color: var(--color-accent);
      }

      .edit-btn svg {
        width: 14px;
        height: 14px;
      }

      .editor-container {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .editor-toolbar {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-bottom: 1px solid var(--color-border);
      }

      .editor-toolbar button {
        padding: var(--spacing-xs) var(--spacing-md);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .editor-toolbar .cancel-btn {
        background: transparent;
        border: 1px solid var(--color-border);
        color: var(--color-text-secondary);
      }

      .editor-toolbar .cancel-btn:hover {
        background: var(--color-bg-hover);
      }

      .editor-toolbar .save-btn {
        background: var(--color-accent);
        border: 1px solid var(--color-accent);
        color: white;
      }

      .editor-toolbar .save-btn:hover {
        filter: brightness(1.1);
      }

      .editor-toolbar .save-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .editor-textarea {
        flex: 1;
        width: 100%;
        padding: var(--spacing-sm);
        border: none;
        background: var(--color-bg-primary);
        color: var(--color-text-primary);
        font-family: var(--font-family-mono);
        font-size: var(--font-size-xs);
        line-height: 20px;
        resize: none;
        outline: none;
        tab-size: 2;
      }

      .editor-textarea:focus {
        outline: none;
      }

      .edit-indicator {
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-warning-bg);
        color: var(--color-warning);
        font-size: var(--font-size-xs);
        text-align: center;
      }

      /* Conflict resolution styles */
      .conflict-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm);
        background: var(--color-error-bg);
        border-bottom: 1px solid var(--color-error);
      }

      .conflict-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        color: var(--color-error);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
      }

      .conflict-actions {
        display: flex;
        gap: var(--spacing-sm);
      }

      .conflict-btn {
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        transition: all 0.15s ease;
      }


      .conflict-marker {
        display: flex;
        align-items: center;
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-error-bg);
        border-left: 3px solid var(--color-error);
        font-size: var(--font-size-xs);
        color: var(--color-error);
        font-weight: var(--font-weight-bold);
      }

      .conflict-inline-actions {
        display: flex;
        gap: var(--spacing-xs);
        margin-left: auto;
        padding-left: var(--spacing-md);
      }

      .conflict-inline-btn {
        padding: 2px 6px;
        border-radius: var(--radius-sm);
        font-size: 10px;
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        transition: all 0.15s ease;
      }


      /* Line selection mode */
      .line-selection-mode .line.code-addition,
      .line-selection-mode .line.code-deletion {
        cursor: pointer;
      }

      .line-selection-mode .line.code-addition:hover,
      .line-selection-mode .line.code-deletion:hover {
        filter: brightness(1.15);
      }

      .line.selected {
        outline: 2px solid var(--color-primary);
        outline-offset: -2px;
        position: relative;
      }

      .line.selected::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 4px;
        background: var(--color-primary);
      }

      .line-checkbox {
        display: none;
        width: 16px;
        height: 16px;
        margin: 0 4px;
        cursor: pointer;
        accent-color: var(--color-primary);
        flex-shrink: 0;
      }

      .line-selection-mode .line.code-addition .line-checkbox,
      .line-selection-mode .line.code-deletion .line-checkbox {
        display: inline-block;
      }

      .selection-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-primary-alpha);
        border-bottom: 1px solid var(--color-primary);
        font-size: var(--font-size-xs);
      }

      .selection-info {
        flex: 1;
        color: var(--color-primary);
        font-weight: var(--font-weight-medium);
      }

      .selection-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 12px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: var(--color-bg-primary);
        color: var(--color-text-secondary);
        font-size: 11px;
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .selection-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .selection-btn.primary {
        background: var(--color-primary);
        color: var(--color-text-inverse);
        border-color: var(--color-primary);
      }

      .selection-btn.primary:hover {
        filter: brightness(1.1);
      }

      .selection-btn svg {
        width: 12px;
        height: 12px;
      }

      /* Whitespace-only change origin color (diff-view specific) */
      .line.code-ws-change .line-origin {
        color: var(--color-warning);
      }

      /* Hunk navigation */
      .hunk-nav {
        display: flex;
        align-items: center;
        gap: 2px;
      }

      .hunk-counter {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        padding: 0 4px;
        min-width: 32px;
        text-align: center;
      }

      /* Context menu */
      .context-menu {
        position: fixed;
        z-index: var(--z-dropdown, 100);
        min-width: 180px;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        padding: var(--spacing-xs) 0;
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
        font-family: var(--font-family-base);
        text-align: left;
        cursor: pointer;
      }

      .context-menu-item:hover {
        background: var(--color-bg-hover);
      }

      .context-menu-item svg {
        width: 14px;
        height: 14px;
        color: var(--color-text-muted);
      }

      .context-menu-divider {
        height: 1px;
        background: var(--color-border);
        margin: var(--spacing-xs) 0;
      }

      /* Word wrap mode */
      .diff-content.word-wrap .line-content,
      .diff-content.word-wrap .split-line-content {
        white-space: pre-wrap;
        word-break: break-all;
      }

      .diff-content.word-wrap .line,
      .diff-content.word-wrap .hunk-header {
        min-width: 0;
      }

      .split-container.word-wrap .split-line-content {
        white-space: pre-wrap;
        word-break: break-all;
      }

      .split-container.word-wrap .split-line {
        min-width: 0;
      }

      /* Word-level diff highlighting */
      .word-changed-del {
        background: var(--color-diff-del-word-bg, rgba(248, 81, 73, 0.4));
        border-radius: 2px;
      }

      .word-changed-add {
        background: var(--color-diff-add-word-bg, rgba(63, 185, 80, 0.4));
        border-radius: 2px;
      }
    `,
  ];

  @property({ type: String }) repositoryPath: string = '';
  @property({ type: Object }) file: StatusEntry | null = null;
  @property({ type: Object }) commitFile: { commitOid: string; filePath: string } | null = null;
  @property({ type: Boolean }) hasPartialStaging = false;

  @state() private diff: DiffFile | null = null;
  @state() private loading = false;
  @state() private error: string | null = null;
  @state() private viewMode: DiffViewMode = 'unified';
  @state() private wordWrap: boolean = false;
  @state() private editMode = false;
  @state() private editContent = '';
  @state() private originalContent = '';
  @state() private saving = false;
  @state() private conflictRegions: ConflictRegion[] = [];
  @state() private hasConflicts = false;
  @state() private contextMenu: DiffContextMenuState = { visible: false, x: 0, y: 0, line: null, hunk: null };
  @state() private selectedLines: Set<LineKey> = new Set();
  @state() private lineSelectionMode = false;
  @state() private currentHunkIndex = 0;
  @state() private hasDiffTool = false;
  @state() private launchingDiffTool = false;

  private handleDocumentClick = (): void => {
    if (this.contextMenu.visible) {
      this.contextMenu = { ...this.contextMenu, visible: false };
    }
  };

  private handleKeydown = (e: KeyboardEvent): void => {
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      this.goToNextHunk();
    } else if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      this.goToPrevHunk();
    } else if (e.key === ']' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
      e.preventDefault();
      this.goToNextHunk();
    } else if (e.key === '[' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
      e.preventDefault();
      this.goToPrevHunk();
    }
  };

  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('click', this.handleDocumentClick);
    // Restore word wrap preference from localStorage
    const savedWordWrap = localStorage.getItem('leviathan-diff-word-wrap');
    if (savedWordWrap !== null) {
      this.wordWrap = savedWordWrap === 'true';
    }
    this.addEventListener('keydown', this.handleKeydown);
    // Make host focusable for keyboard shortcuts
    if (!this.hasAttribute('tabindex')) {
      this.setAttribute('tabindex', '0');
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('click', this.handleDocumentClick);
    this.removeEventListener('keydown', this.handleKeydown);
  }

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('file') && this.file) {
      await this.loadWorkingDiff();
    }
    if (changedProperties.has('commitFile') && this.commitFile) {
      await this.loadCommitDiff();
    }
    if (changedProperties.has('repositoryPath') && this.repositoryPath) {
      await this.checkDiffToolAvailability();
    }
  }

  private async checkDiffToolAvailability(): Promise<void> {
    if (!this.repositoryPath) return;
    try {
      const result = await gitService.getDiffToolConfig(this.repositoryPath);
      this.hasDiffTool = result.success && !!result.data?.tool;
    } catch {
      this.hasDiffTool = false;
    }
  }

  private async handleOpenDiffTool(): Promise<void> {
    if (!this.repositoryPath) return;

    const filePath = this.commitFile?.filePath ?? this.file?.path;
    if (!filePath) return;

    this.launchingDiffTool = true;
    try {
      const result = await gitService.launchDiffTool(
        this.repositoryPath,
        filePath,
        this.file?.isStaged,
        this.commitFile?.commitOid,
      );
      if (result.success && result.data?.success) {
        this.dispatchEvent(new CustomEvent('show-toast', {
          bubbles: true, composed: true,
          detail: { message: 'Diff tool completed', type: 'success' },
        }));
      } else {
        this.dispatchEvent(new CustomEvent('show-toast', {
          bubbles: true, composed: true,
          detail: { message: result.data?.message ?? result.error?.message ?? 'Diff tool failed', type: 'error' },
        }));
      }
    } catch {
      this.dispatchEvent(new CustomEvent('show-toast', {
        bubbles: true, composed: true,
        detail: { message: 'Failed to launch diff tool', type: 'error' },
      }));
    } finally {
      this.launchingDiffTool = false;
    }
  }

  private async loadWorkingDiff(): Promise<void> {
    if (!this.repositoryPath || !this.file) return;

    this.loading = true;
    this.error = null;
    this.diff = null;
    this.hunkLinePairsCache = new WeakMap();
    this.wordDiffCache = new WeakMap();

    try {
      // Initialize highlighter and detect language
      await this.initCodeLanguage(this.file.path);

      const result = await gitService.getFileDiff(
        this.repositoryPath,
        this.file.path,
        this.file.isStaged
      );

      if (result.success) {
        this.diff = result.data!;
        // Check for conflict markers in conflicted files
        await this.checkForConflicts();
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
    this.hunkLinePairsCache = new WeakMap();
    this.wordDiffCache = new WeakMap();

    try {
      // Initialize highlighter and detect language
      await this.initCodeLanguage(this.commitFile.filePath);

      const result = await gitService.getCommitFileDiff(
        this.repositoryPath,
        this.commitFile.commitOid,
        this.commitFile.filePath
      );

      if (result.success) {
        this.diff = result.data!;
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

  private toggleWordWrap(): void {
    this.wordWrap = !this.wordWrap;
    localStorage.setItem('leviathan-diff-word-wrap', String(this.wordWrap));
  }

  /**
   * Check if edit mode is available (only for working directory changes, not commit diffs)
   */
  private get canEdit(): boolean {
    return this.file !== null && this.commitFile === null && !this.diff?.isBinary;
  }

  /**
   * Toggle edit mode
   */
  private async toggleEditMode(): Promise<void> {
    if (!this.canEdit) return;

    if (!this.editMode) {
      // Enter edit mode - load file content
      await this.loadFileContent();
    } else {
      // Exit edit mode without saving
      this.editMode = false;
      this.editContent = '';
      this.originalContent = '';
    }
  }

  /**
   * Load file content for editing
   */
  private async loadFileContent(): Promise<void> {
    if (!this.repositoryPath || !this.file) return;

    const result = await gitService.readFileContent(
      this.repositoryPath,
      this.file.path,
      false // Read from working directory
    );

    if (result.success && result.data !== undefined) {
      this.originalContent = result.data;
      this.editContent = result.data;
      this.editMode = true;
    }
  }

  /**
   * Handle content change in editor
   */
  private handleEditorChange(e: Event): void {
    const textarea = e.target as HTMLTextAreaElement;
    this.editContent = textarea.value;
  }

  /**
   * Handle tab key in editor
   */
  private handleEditorKeydown(e: KeyboardEvent): void {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.target as HTMLTextAreaElement;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      this.editContent = this.editContent.substring(0, start) + '  ' + this.editContent.substring(end);
      // Set cursor position after the inserted spaces
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    } else if (e.key === 'Escape') {
      this.cancelEdit();
    } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.saveEdit();
    }
  }

  /**
   * Save edits
   */
  private async saveEdit(): Promise<void> {
    if (!this.repositoryPath || !this.file || this.saving) return;

    this.saving = true;

    const result = await gitService.writeFileContent(
      this.repositoryPath,
      this.file.path,
      this.editContent,
      false // Don't auto-stage
    );

    this.saving = false;

    if (result.success) {
      this.editMode = false;
      this.editContent = '';
      this.originalContent = '';
      // Reload the diff to show updated changes
      await this.loadWorkingDiff();
      // Dispatch event to notify parent to refresh status
      this.dispatchEvent(new CustomEvent('file-edited', {
        bubbles: true,
        composed: true,
        detail: { path: this.file.path }
      }));
    }
  }

  /**
   * Cancel editing
   */
  private cancelEdit(): void {
    this.editMode = false;
    this.editContent = '';
    this.originalContent = '';
  }

  /**
   * Check if content has been modified
   */
  private get hasChanges(): boolean {
    return this.editContent !== this.originalContent;
  }

  /**
   * Check if this is a conflicted file
   */
  private get isConflicted(): boolean {
    return this.file?.isConflicted ?? false;
  }

  /**
   * Check file content for conflict markers and parse regions
   */
  private async checkForConflicts(): Promise<void> {
    if (!this.isConflicted || !this.repositoryPath || !this.file) {
      this.hasConflicts = false;
      this.conflictRegions = [];
      return;
    }

    const result = await gitService.readFileContent(this.repositoryPath, this.file.path, false);
    if (!result.success || !result.data) {
      this.hasConflicts = false;
      this.conflictRegions = [];
      return;
    }

    this.parseConflictRegions(result.data);
  }

  /**
   * Parse conflict markers from file content
   */
  private parseConflictRegions(content: string): void {
    const lines = content.split('\n');
    const regions: ConflictRegion[] = [];
    let index = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('<<<<<<<')) {
        // Found start of conflict
        const region: ConflictRegion = {
          index: index++,
          startLine: i,
          endLine: -1,
          oursStart: i + 1,
          oursEnd: -1,
          theirsStart: -1,
          theirsEnd: -1,
          oursContent: '',
          theirsContent: '',
        };

        // Find the separator and end
        const oursLines: string[] = [];
        const theirsLines: string[] = [];
        let inTheirs = false;

        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].startsWith('=======')) {
            region.oursEnd = j - 1;
            region.theirsStart = j + 1;
            inTheirs = true;
          } else if (lines[j].startsWith('>>>>>>>')) {
            region.theirsEnd = j - 1;
            region.endLine = j;
            break;
          } else if (inTheirs) {
            theirsLines.push(lines[j]);
          } else {
            oursLines.push(lines[j]);
          }
        }

        region.oursContent = oursLines.join('\n');
        region.theirsContent = theirsLines.join('\n');
        regions.push(region);

        // Skip past this conflict
        i = region.endLine;
      }
    }

    this.conflictRegions = regions;
    this.hasConflicts = regions.length > 0;
  }

  /**
   * Resolve a single conflict region
   */
  private async resolveConflict(region: ConflictRegion, choice: 'ours' | 'theirs' | 'both'): Promise<void> {
    if (!this.repositoryPath || !this.file) return;

    const result = await gitService.readFileContent(this.repositoryPath, this.file.path, false);
    if (!result.success || !result.data) return;

    const lines = result.data.split('\n');
    let replacement: string[];

    switch (choice) {
      case 'ours':
        replacement = region.oursContent.split('\n');
        break;
      case 'theirs':
        replacement = region.theirsContent.split('\n');
        break;
      case 'both':
        replacement = [...region.oursContent.split('\n'), ...region.theirsContent.split('\n')];
        break;
    }

    // Replace the conflict region with the resolution
    const newLines = [
      ...lines.slice(0, region.startLine),
      ...replacement,
      ...lines.slice(region.endLine + 1),
    ];

    const newContent = newLines.join('\n');
    const writeResult = await gitService.writeFileContent(
      this.repositoryPath,
      this.file.path,
      newContent,
      false
    );

    if (writeResult.success) {
      // Reload the diff and re-check for conflicts
      await this.loadWorkingDiff();
      await this.checkForConflicts();

      this.dispatchEvent(new CustomEvent('file-edited', {
        bubbles: true,
        composed: true,
        detail: { path: this.file.path }
      }));
    }
  }

  /**
   * Resolve all conflicts with the same choice
   */
  private async resolveAllConflicts(choice: 'ours' | 'theirs'): Promise<void> {
    if (!this.repositoryPath || !this.file) return;

    const result = await gitService.readFileContent(this.repositoryPath, this.file.path, false);
    if (!result.success || !result.data) return;

    let content = result.data;

    // Process conflicts from end to start to maintain line numbers
    for (const region of [...this.conflictRegions].reverse()) {
      const lines = content.split('\n');
      const replacement = choice === 'ours' ? region.oursContent : region.theirsContent;

      const newLines = [
        ...lines.slice(0, region.startLine),
        ...replacement.split('\n'),
        ...lines.slice(region.endLine + 1),
      ];

      content = newLines.join('\n');
    }

    const writeResult = await gitService.writeFileContent(
      this.repositoryPath,
      this.file.path,
      content,
      false
    );

    if (writeResult.success) {
      await this.loadWorkingDiff();
      await this.checkForConflicts();

      this.dispatchEvent(new CustomEvent('file-edited', {
        bubbles: true,
        composed: true,
        detail: { path: this.file.path }
      }));
    }
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
   * Create a unique key for a line in the diff.
   *
   * The key is constructed from numeric indices (hunkIndex and lineIndex),
   * which guarantees no special characters in the key format.
   * This is used for tracking selected lines in the Set.
   */
  private getLineKey(hunkIndex: number, lineIndex: number): LineKey {
    return `${hunkIndex}-${lineIndex}`;
  }

  /**
   * Toggle line selection mode
   */
  private toggleLineSelectionMode(): void {
    this.lineSelectionMode = !this.lineSelectionMode;
    if (!this.lineSelectionMode) {
      this.selectedLines = new Set();
    }
  }

  /**
   * Toggle selection of a specific line
   */
  private toggleLineSelection(hunkIndex: number, lineIndex: number, line: DiffLine): void {
    // Only allow selecting additions and deletions
    if (line.origin !== 'addition' && line.origin !== 'deletion') return;

    const key = this.getLineKey(hunkIndex, lineIndex);
    const newSelected = new Set(this.selectedLines);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    this.selectedLines = newSelected;
  }

  /**
   * Check if a line is selected
   */
  private isLineSelected(hunkIndex: number, lineIndex: number): boolean {
    return this.selectedLines.has(this.getLineKey(hunkIndex, lineIndex));
  }

  /**
   * Clear all line selections
   */
  private clearLineSelection(): void {
    this.selectedLines = new Set();
  }

  /**
   * Select all lines in a hunk
   */
  private selectAllInHunk(hunkIndex: number): void {
    if (!this.diff) return;
    const hunk = this.diff.hunks[hunkIndex];
    if (!hunk) return;

    const newSelected = new Set(this.selectedLines);
    hunk.lines.forEach((line, lineIndex) => {
      if (line.origin === 'addition' || line.origin === 'deletion') {
        newSelected.add(this.getLineKey(hunkIndex, lineIndex));
      }
    });
    this.selectedLines = newSelected;
  }

  /**
   * Build a patch from selected lines only
   * This is more complex than buildHunkPatch because we need to:
   * 1. Group selected lines by hunk
   * 2. Include context lines around selected lines
   * 3. Adjust line numbers in hunk headers
   */
  private buildSelectedLinesPatch(): string {
    if (!this.diff || !this.file || this.selectedLines.size === 0) return '';

    const filePath = this.file.path;
    const fileStatus = this.diff.status;
    const patchLines: string[] = [];

    // Add diff header
    if (fileStatus === 'new' || fileStatus === 'untracked') {
      patchLines.push('--- /dev/null');
    } else {
      patchLines.push(`--- a/${filePath}`);
    }

    if (fileStatus === 'deleted') {
      patchLines.push('+++ /dev/null');
    } else {
      patchLines.push(`+++ b/${filePath}`);
    }

    // Group selected lines by hunk
    const selectedByHunk = new Map<number, Set<number>>();
    for (const key of this.selectedLines) {
      const [hunkIndex, lineIndex] = key.split('-').map(Number);
      if (!selectedByHunk.has(hunkIndex)) {
        selectedByHunk.set(hunkIndex, new Set());
      }
      selectedByHunk.get(hunkIndex)!.add(lineIndex);
    }

    // Process each hunk with selected lines
    for (const [hunkIndex, selectedLineIndices] of selectedByHunk) {
      const hunk = this.diff.hunks[hunkIndex];
      if (!hunk) continue;

      // Build the lines for this hunk patch
      // We need to include context lines and adjust for non-selected changes
      const hunkPatchLines: string[] = [];
      let oldLineCount = 0;
      let newLineCount = 0;
      const firstOldLine = hunk.oldStart;
      const firstNewLine = hunk.newStart;

      for (let i = 0; i < hunk.lines.length; i++) {
        const line = hunk.lines[i];
        const isSelected = selectedLineIndices.has(i);

        // Skip metadata lines
        if (line.origin === 'hunk-header' || line.origin === 'file-header' || line.origin === 'binary') {
          continue;
        }

        // Handle "no newline at end of file" markers
        if (line.origin === 'del-eofnl' || line.origin === 'add-eofnl') {
          // Only include if the corresponding line is selected
          continue;
        }

        const content = line.content.replace(/\n$/, '').replace(/\r$/, '');

        if (line.origin === 'context') {
          // Always include context lines
          hunkPatchLines.push(' ' + content);
          oldLineCount++;
          newLineCount++;
        } else if (line.origin === 'deletion') {
          if (isSelected) {
            // Include this deletion in the patch
            hunkPatchLines.push('-' + content);
            oldLineCount++;
          } else {
            // Unselected deletions become context lines in the patch.
            // This is correct for partial staging: the line remains in the index
            // (not staged for deletion) while the working tree still shows it as deleted.
            // The next diff will continue to show it as a deletion that can be staged.
            hunkPatchLines.push(' ' + content);
            oldLineCount++;
            newLineCount++;
          }
        } else if (line.origin === 'addition') {
          if (isSelected) {
            // Include this addition
            hunkPatchLines.push('+' + content);
            newLineCount++;
          }
          // Unselected additions are simply not included
        }
      }

      // Only add hunk if it has actual changes
      if (hunkPatchLines.some(l => l.startsWith('+') || l.startsWith('-'))) {
        // Create hunk header with adjusted counts
        const hunkHeader = `@@ -${firstOldLine},${oldLineCount} +${firstNewLine},${newLineCount} @@`;
        patchLines.push(hunkHeader);
        patchLines.push(...hunkPatchLines);
      }
    }

    // Return empty if no actual hunks were added
    if (patchLines.length <= 2) return '';

    return patchLines.join('\n') + '\n';
  }

  /**
   * Stage selected lines
   */
  private async stageSelectedLines(): Promise<void> {
    if (!this.repositoryPath || !this.file || this.selectedLines.size === 0) return;

    const patch = this.buildSelectedLinesPatch();
    if (!patch) return;

    try {
      const result = await gitService.stageHunk(this.repositoryPath, patch);
      if (result.success) {
        this.selectedLines = new Set();
        this.dispatchEvent(new CustomEvent('status-changed', {
          bubbles: true,
          composed: true,
        }));
        await this.loadWorkingDiff();
      } else {
        console.error('Failed to stage selected lines:', result.error);
      }
    } catch (err) {
      console.error('Failed to stage selected lines:', err);
    }
  }

  /**
   * Unstage selected lines
   */
  private async unstageSelectedLines(): Promise<void> {
    if (!this.repositoryPath || !this.file || this.selectedLines.size === 0) return;

    const patch = this.buildSelectedLinesPatch();
    if (!patch) return;

    try {
      const result = await gitService.unstageHunk(this.repositoryPath, patch);
      if (result.success) {
        this.selectedLines = new Set();
        this.dispatchEvent(new CustomEvent('status-changed', {
          bubbles: true,
          composed: true,
        }));
        await this.loadWorkingDiff();
      } else {
        console.error('Failed to unstage selected lines:', result.error);
      }
    } catch (err) {
      console.error('Failed to unstage selected lines:', err);
    }
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
        return 'code-addition';
      case 'deletion':
        return 'code-deletion';
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

  private get totalHunks(): number {
    return this.diff?.hunks.length ?? 0;
  }

  private goToNextHunk(): void {
    if (this.totalHunks === 0) return;
    this.currentHunkIndex = (this.currentHunkIndex + 1) % this.totalHunks;
    this.scrollToHunk(this.currentHunkIndex);
  }

  private goToPrevHunk(): void {
    if (this.totalHunks === 0) return;
    this.currentHunkIndex = (this.currentHunkIndex - 1 + this.totalHunks) % this.totalHunks;
    this.scrollToHunk(this.currentHunkIndex);
  }

  private scrollToHunk(index: number): void {
    const container = this.shadowRoot?.querySelector('.diff-content') ??
      this.shadowRoot?.querySelector('.split-container');
    if (!container) return;

    const hunks = container.querySelectorAll('.hunk');
    const separators = container.querySelectorAll('.hunk-separator');
    const target = hunks[index] ?? separators[index];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Context menu handlers
  private handleLineContextMenu(e: MouseEvent, line: DiffLine, hunk: DiffHunk): void {
    e.preventDefault();
    e.stopPropagation();
    this.contextMenu = { visible: true, x: e.clientX, y: e.clientY, line, hunk };
  }

  private async handleContextCopyLine(): Promise<void> {
    const line = this.contextMenu.line;
    if (!line) return;
    this.contextMenu = { ...this.contextMenu, visible: false };
    try {
      await navigator.clipboard.writeText(line.content);
    } catch (err) {
      console.error('Failed to copy line:', err);
    }
  }

  private async handleContextCopySelection(): Promise<void> {
    this.contextMenu = { ...this.contextMenu, visible: false };
    try {
      const selection = window.getSelection()?.toString() ?? '';
      if (selection) {
        await navigator.clipboard.writeText(selection);
      }
    } catch (err) {
      console.error('Failed to copy selection:', err);
    }
  }

  private async handleContextStageHunk(): Promise<void> {
    const hunk = this.contextMenu.hunk;
    if (!hunk) return;
    this.contextMenu = { ...this.contextMenu, visible: false };
    // Use the existing handleStageHunk method
    await this.handleStageHunk(hunk, new Event('click'));
  }

  private async handleContextUnstageHunk(): Promise<void> {
    const hunk = this.contextMenu.hunk;
    if (!hunk) return;
    this.contextMenu = { ...this.contextMenu, visible: false };
    await this.handleUnstageHunk(hunk, new Event('click'));
  }

  /**
   * Build a map of paired deletion/addition lines within each hunk for word-level diffing.
   * Pairs consecutive deletion blocks with following addition blocks.
   * Returns a Map from DiffLine to its paired DiffLine.
   */
  private buildLinePairs(hunk: DiffHunk): Map<DiffLine, DiffLine> {
    const pairs = new Map<DiffLine, DiffLine>();
    const lines = hunk.lines;
    let i = 0;

    while (i < lines.length) {
      // Collect consecutive deletions
      const deletions: DiffLine[] = [];
      while (i < lines.length && lines[i].origin === 'deletion') {
        deletions.push(lines[i]);
        i++;
      }
      // Collect consecutive additions
      const additions: DiffLine[] = [];
      while (i < lines.length && lines[i].origin === 'addition') {
        additions.push(lines[i]);
        i++;
      }
      // Pair them up (min of both lengths)
      const pairCount = Math.min(deletions.length, additions.length);
      for (let p = 0; p < pairCount; p++) {
        pairs.set(deletions[p], additions[p]);
        pairs.set(additions[p], deletions[p]);
      }
      // If we didn't consume anything (context line), skip it
      if (deletions.length === 0 && additions.length === 0) {
        i++;
      }
    }

    return pairs;
  }

  /**
   * Cache of line pairs per hunk to avoid recomputation on every render.
   */
  private hunkLinePairsCache = new WeakMap<DiffHunk, Map<DiffLine, DiffLine>>();

  private getLinePairs(hunk: DiffHunk): Map<DiffLine, DiffLine> {
    let pairs = this.hunkLinePairsCache.get(hunk);
    if (!pairs) {
      pairs = this.buildLinePairs(hunk);
      this.hunkLinePairsCache.set(hunk, pairs);
    }
    return pairs;
  }

  /**
   * Word diff result cache to avoid recomputation for the same line pair.
   */
  private wordDiffCache = new WeakMap<DiffLine, WordDiffResult>();

  private getWordDiff(delLine: DiffLine, addLine: DiffLine): WordDiffResult {
    let result = this.wordDiffCache.get(delLine);
    if (!result) {
      result = computeWordDiff(delLine.content, addLine.content);
      this.wordDiffCache.set(delLine, result);
    }
    return result;
  }

  /**
   * Render line content with word-level diff highlighting.
   * Segments marked as changed get a highlighted background.
   */
  private renderWordDiffContent(segments: DiffSegment[], cssClass: string): TemplateResult {
    // We cannot easily combine syntax highlighting with word diff spans,
    // so we use plain text with word-diff highlighting when a pair is available.
    return html`${segments.map(
      (seg) =>
        seg.changed
          ? html`<span class="${cssClass}">${seg.text}</span>`
          : html`<span>${seg.text}</span>`
    )}`;
  }

  /**
   * Stage a single line from context menu
   */
  private async handleContextStageLine(): Promise<void> {
    const line = this.contextMenu.line;
    const hunk = this.contextMenu.hunk;
    if (!line || !hunk || !this.diff) return;

    // Find hunk and line indices
    const hunkIndex = this.diff.hunks.indexOf(hunk);
    const lineIndex = hunk.lines.indexOf(line);
    if (hunkIndex === -1 || lineIndex === -1) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    // Temporarily select just this line and stage it
    const prevSelected = this.selectedLines;
    this.selectedLines = new Set([this.getLineKey(hunkIndex, lineIndex)]);
    await this.stageSelectedLines();
    this.selectedLines = prevSelected;
  }

  /**
   * Unstage a single line from context menu
   */
  private async handleContextUnstageLine(): Promise<void> {
    const line = this.contextMenu.line;
    const hunk = this.contextMenu.hunk;
    if (!line || !hunk || !this.diff) return;

    // Find hunk and line indices
    const hunkIndex = this.diff.hunks.indexOf(hunk);
    const lineIndex = hunk.lines.indexOf(line);
    if (hunkIndex === -1 || lineIndex === -1) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    // Temporarily select just this line and unstage it
    const prevSelected = this.selectedLines;
    this.selectedLines = new Set([this.getLineKey(hunkIndex, lineIndex)]);
    await this.unstageSelectedLines();
    this.selectedLines = prevSelected;
  }

  private renderLine(line: DiffLine, hunk: DiffHunk, hunkIndex: number, lineIndex: number) {
    const lineClass = this.getLineClass(line.origin);
    const originChar = this.getOriginChar(line.origin);
    const isSelectable = line.origin === 'addition' || line.origin === 'deletion';
    const isSelected = this.isLineSelected(hunkIndex, lineIndex);

    const handleClick = (e: MouseEvent) => {
      if (this.lineSelectionMode && isSelectable) {
        e.preventDefault();
        this.toggleLineSelection(hunkIndex, lineIndex, line);
      }
    };

    const handleCheckboxChange = (e: Event) => {
      e.stopPropagation();
      this.toggleLineSelection(hunkIndex, lineIndex, line);
    };

    // Check if this line has a word-diff pair
    const pairs = this.getLinePairs(hunk);
    const pairedLine = pairs.get(line);
    let contentHtml: TemplateResult;

    if (pairedLine && (line.origin === 'deletion' || line.origin === 'addition')) {
      const delLine = line.origin === 'deletion' ? line : pairedLine;
      const addLine = line.origin === 'addition' ? line : pairedLine;
      const wordDiff = this.getWordDiff(delLine, addLine);

      if (line.origin === 'deletion') {
        contentHtml = this.renderWordDiffContent(wordDiff.oldSegments, 'word-changed-del');
      } else {
        contentHtml = this.renderWordDiffContent(wordDiff.newSegments, 'word-changed-add');
      }
    } else {
      contentHtml = this.renderHighlightedContent(line.content);
    }

    return html`
      <div
        class="line ${lineClass} ${isSelected ? 'selected' : ''}"
        @contextmenu=${(e: MouseEvent) => this.handleLineContextMenu(e, line, hunk)}
        @click=${handleClick}
      >
        ${this.lineSelectionMode && isSelectable ? html`
          <input
            type="checkbox"
            class="line-checkbox"
            .checked=${isSelected}
            @change=${handleCheckboxChange}
            @click=${(e: Event) => e.stopPropagation()}
          />
        ` : nothing}
        <div class="line-numbers">
          <span class="line-no old">${line.oldLineNo ?? ''}</span>
          <span class="line-no new">${line.newLineNo ?? ''}</span>
        </div>
        <span class="line-origin">${originChar}</span>
        <span class="line-content">${contentHtml}</span>
      </div>
    `;
  }

  private renderWhitespaceOnlyLine(
    delLine: DiffLine,
    addLine: DiffLine,
    hunk: DiffHunk,
    hunkIndex: number,
    delIndex: number,
    addIndex: number,
  ) {
    const segments = computeInlineWhitespaceDiff(delLine.content, addLine.content);
    const isDelSelected = this.isLineSelected(hunkIndex, delIndex);
    const isAddSelected = this.isLineSelected(hunkIndex, addIndex);
    const isSelected = isDelSelected || isAddSelected;

    const handleClick = (e: MouseEvent) => {
      if (this.lineSelectionMode) {
        e.preventDefault();
        // Toggle both underlying lines together
        const newSelected = new Set(this.selectedLines);
        const delKey = this.getLineKey(hunkIndex, delIndex);
        const addKey = this.getLineKey(hunkIndex, addIndex);
        if (isSelected) {
          newSelected.delete(delKey);
          newSelected.delete(addKey);
        } else {
          newSelected.add(delKey);
          newSelected.add(addKey);
        }
        this.selectedLines = newSelected;
      }
    };

    const handleCheckboxChange = (e: Event) => {
      e.stopPropagation();
      const newSelected = new Set(this.selectedLines);
      const delKey = this.getLineKey(hunkIndex, delIndex);
      const addKey = this.getLineKey(hunkIndex, addIndex);
      if (isSelected) {
        newSelected.delete(delKey);
        newSelected.delete(addKey);
      } else {
        newSelected.add(delKey);
        newSelected.add(addKey);
      }
      this.selectedLines = newSelected;
    };

    return html`
      <div
        class="line code-ws-change ${isSelected ? 'selected' : ''}"
        @contextmenu=${(e: MouseEvent) => this.handleLineContextMenu(e, addLine, hunk)}
        @click=${handleClick}
      >
        ${this.lineSelectionMode ? html`
          <input
            type="checkbox"
            class="line-checkbox"
            style="display: inline-block"
            .checked=${isSelected}
            @change=${handleCheckboxChange}
            @click=${(e: Event) => e.stopPropagation()}
          />
        ` : nothing}
        <div class="line-numbers">
          <span class="line-no old">${delLine.oldLineNo ?? ''}</span>
          <span class="line-no new">${addLine.newLineNo ?? ''}</span>
        </div>
        <span class="line-origin">~</span>
        <span class="line-content">${this.renderInlineWhitespaceContent(segments)}</span>
      </div>
    `;
  }

  private renderHunk(hunk: DiffHunk, hunkIndex: number) {
    // Only show stage/unstage button for working directory diffs (not commit diffs)
    const showStageButton = this.file !== null && !this.commitFile;
    const isStaged = this.file?.isStaged ?? false;
    const isActive = this.currentHunkIndex === hunkIndex;

    // Find whitespace-only pairs for this hunk
    const wsPairs = findWhitespaceOnlyPairs(hunk.lines);
    const skipIndices = new Set(wsPairs.values());

    return html`
      <div class="hunk ${isActive ? 'active' : ''}">
        ${hunkIndex > 0 ? html`
          <div class="hunk-separator">
            <div class="hunk-separator-line"></div>
            ${showStageButton ? html`
              <div class="hunk-separator-actions">
                ${this.lineSelectionMode ? html`
                  <button
                    class="stage-btn"
                    @click=${() => this.selectAllInHunk(hunkIndex)}
                    title="Select all lines in this hunk"
                  >
                    Select All
                  </button>
                ` : nothing}
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
        ` : html`
          ${showStageButton ? html`
            <div class="hunk-separator" style="height: auto; padding: 2px var(--spacing-sm); justify-content: flex-end;">
              ${this.lineSelectionMode ? html`
                <button
                  class="stage-btn"
                  @click=${() => this.selectAllInHunk(hunkIndex)}
                  title="Select all lines in this hunk"
                >
                  Select All
                </button>
              ` : nothing}
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
        `}
        ${hunk.lines.map((line, lineIndex) => {
          // Skip addition lines that are part of a whitespace-only pair
          if (skipIndices.has(lineIndex)) return nothing;
          // Render whitespace-only pairs as a merged line
          if (wsPairs.has(lineIndex)) {
            const addIndex = wsPairs.get(lineIndex)!;
            return this.renderWhitespaceOnlyLine(
              line, hunk.lines[addIndex], hunk, hunkIndex, lineIndex, addIndex,
            );
          }
          return this.renderLine(line, hunk, hunkIndex, lineIndex);
        })}
      </div>
    `;
  }

  private convertToSplitLines(hunks: DiffHunk[]): SplitLine[] {
    const splitLines: SplitLine[] = [];

    for (const hunk of hunks) {
      // Add hunk separator as a special line
      splitLines.push({
        left: { content: hunk.header, origin: 'hunk-header', oldLineNo: null, newLineNo: null },
        right: { content: hunk.header, origin: 'hunk-header', oldLineNo: null, newLineNo: null },
      });

      const deletions: DiffLine[] = [];
      const additions: DiffLine[] = [];

      const flushPending = () => {
        // Check for whitespace-only pairs while flushing
        while (deletions.length || additions.length) {
          const del = deletions.shift() ?? null;
          const add = additions.shift() ?? null;

          if (del && add && isWhitespaceOnlyChange(del.content, add.content)) {
            const segments = computeInlineWhitespaceDiff(del.content, add.content);
            splitLines.push({
              left: del,
              right: add,
              isWhitespaceOnly: true,
              inlineSegments: segments,
            });
          } else {
            splitLines.push({ left: del, right: add });
          }
        }
      };

      for (const line of hunk.lines) {
        if (line.origin === 'deletion') {
          deletions.push(line);
        } else if (line.origin === 'addition') {
          additions.push(line);
        } else {
          // Context line - flush any pending deletions/additions first
          flushPending();
          // Add context line to both sides
          splitLines.push({ left: line, right: line });
        }
      }

      // Flush remaining deletions/additions
      flushPending();
    }

    return splitLines;
  }

  private renderSplitLineCell(
    line: DiffLine | null,
    side: 'left' | 'right',
    wsOnly?: boolean,
    segments?: InlineDiffSegment[],
  ) {
    if (!line) {
      return html`
        <div class="split-line empty">
          <span class="split-line-no"></span>
          <span class="split-line-content"></span>
        </div>
      `;
    }

    if (line.origin === 'hunk-header') {
      return html`<div class="hunk-separator-split"></div>`;
    }

    const lineNo = side === 'left' ? line.oldLineNo : line.newLineNo;

    if (wsOnly && segments) {
      // Whitespace-only: show inline diff with yellow background
      const filteredSegments = segments.filter(s =>
        side === 'left' ? s.type !== 'added' : s.type !== 'removed'
      );
      return html`
        <div class="split-line code-ws-change">
          <span class="split-line-no">${lineNo ?? ''}</span>
          <span class="split-line-content">${this.renderInlineWhitespaceContent(filteredSegments)}</span>
        </div>
      `;
    }

    let lineClass = '';
    if (line.origin === 'deletion') lineClass = 'code-deletion';
    else if (line.origin === 'addition') lineClass = 'code-addition';

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
      <div class="split-container ${this.wordWrap ? 'word-wrap' : ''}">
        <div class="split-pane">
          <div class="split-pane-header">Original</div>
          ${splitLines.map((sl) => this.renderSplitLineCell(sl.left, 'left', sl.isWhitespaceOnly, sl.inlineSegments))}
        </div>
        <div class="split-pane">
          <div class="split-pane-header">Modified</div>
          ${splitLines.map((sl) => this.renderSplitLineCell(sl.right, 'right', sl.isWhitespaceOnly, sl.inlineSegments))}
        </div>
      </div>
    `;
  }

  private renderUnifiedView() {
    if (!this.diff) return nothing;

    const isStaged = this.file?.isStaged ?? false;

    return html`
      ${this.lineSelectionMode && this.selectedLines.size > 0 ? html`
        <div class="selection-actions">
          <span class="selection-info">${this.selectedLines.size} line${this.selectedLines.size !== 1 ? 's' : ''} selected</span>
          <button class="selection-btn" @click=${this.clearLineSelection}>
            Clear
          </button>
          ${isStaged ? html`
            <button class="selection-btn primary" @click=${this.unstageSelectedLines}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Unstage Selected
            </button>
          ` : html`
            <button class="selection-btn primary" @click=${this.stageSelectedLines}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Stage Selected
            </button>
          `}
        </div>
      ` : nothing}
      <div class="diff-content ${this.wordWrap ? 'word-wrap' : ''} ${this.lineSelectionMode ? 'line-selection-mode' : ''}">
        ${this.diff.hunks.length === 0
          ? html`<div class="empty">No changes in this file</div>`
          : this.diff.hunks.map((hunk, i) => this.renderHunk(hunk, i))}
      </div>
    `;
  }

  private renderContextMenu() {
    if (!this.contextMenu.visible) return nothing;

    const { x, y, line, hunk } = this.contextMenu;
    const showStageButton = this.file !== null && !this.commitFile && hunk;
    const isStaged = this.file?.isStaged ?? false;
    const isChangeableLine = line && (line.origin === 'addition' || line.origin === 'deletion');

    return html`
      <div class="context-menu" style="left: ${x}px; top: ${y}px">
        <button class="context-menu-item" @click=${this.handleContextCopySelection}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          Copy selection
        </button>
        <button class="context-menu-item" @click=${this.handleContextCopyLine}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          Copy line
        </button>
        ${showStageButton && isChangeableLine ? html`
          <div class="context-menu-divider"></div>
          ${isStaged ? html`
            <button class="context-menu-item" @click=${this.handleContextUnstageLine}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Unstage line
            </button>
          ` : html`
            <button class="context-menu-item" @click=${this.handleContextStageLine}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Stage line
            </button>
          `}
        ` : nothing}
        ${showStageButton ? html`
          <div class="context-menu-divider"></div>
          ${isStaged ? html`
            <button class="context-menu-item" @click=${this.handleContextUnstageHunk}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Unstage hunk
            </button>
          ` : html`
            <button class="context-menu-item" @click=${this.handleContextStageHunk}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Stage hunk
            </button>
          `}
        ` : nothing}
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

    if (this.diff.isBinary && !this.diff.isImage) {
      return html`<div class="binary-notice">Binary file - cannot display diff</div>`;
    }

    // Render image diff component for image files
    if (this.diff.isImage) {
      const filePath = this.commitFile?.filePath ?? this.file?.path ?? '';
      const staged = this.file?.isStaged ?? false;
      const commitOid = this.commitFile?.commitOid;
      return html`
        <lv-image-diff
          .repoPath=${this.repositoryPath}
          .filePath=${filePath}
          .status=${this.diff.status}
          .staged=${staged}
          .commitOid=${commitOid}
        ></lv-image-diff>
      `;
    }

    // Render edit mode
    if (this.editMode) {
      return html`
        <div class="header">
          <div class="file-info">
            <span class="file-status ${this.diff.status}">${this.diff.status}</span>
            <span class="file-path">${this.file?.path ?? ''}</span>
          </div>
          <button
            class="edit-btn active"
            @click=${this.toggleEditMode}
            title="Exit edit mode"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            Editing
          </button>
        </div>
        ${this.hasChanges
          ? html`<div class="edit-indicator">Unsaved changes (Ctrl+S to save, Esc to cancel)</div>`
          : nothing}
        <div class="editor-container">
          <div class="editor-toolbar">
            <button class="cancel-btn" @click=${this.cancelEdit}>Cancel</button>
            <button
              class="save-btn"
              @click=${this.saveEdit}
              ?disabled=${!this.hasChanges || this.saving}
            >
              ${this.saving ? 'Saving...' : 'Save'}
            </button>
          </div>
          <textarea
            class="editor-textarea"
            .value=${this.editContent}
            @input=${this.handleEditorChange}
            @keydown=${this.handleEditorKeydown}
            spellcheck="false"
          ></textarea>
        </div>
      `;
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
          ${this.hasDiffTool ? html`
            <button
              class="view-btn"
              @click=${this.handleOpenDiffTool}
              ?disabled=${this.launchingDiffTool}
              title="Open in external diff tool"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </button>
          ` : nothing}
          ${this.file && !this.commitFile ? html`
            <button
              class="view-btn ${this.lineSelectionMode ? 'active' : ''}"
              @click=${this.toggleLineSelectionMode}
              title="Toggle line selection mode for staging individual lines"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 11l3 3L22 4"></path>
                <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"></path>
              </svg>
            </button>
          ` : nothing}
          ${this.totalHunks > 1 ? html`
            <div class="hunk-nav">
              <button
                class="view-btn"
                @click=${this.goToPrevHunk}
                title="Previous change (Alt+Up)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="18 15 12 9 6 15"></polyline>
                </svg>
              </button>
              <span class="hunk-counter">${this.currentHunkIndex + 1}/${this.totalHunks}</span>
              <button
                class="view-btn"
                @click=${this.goToNextHunk}
                title="Next change (Alt+Down)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
            </div>
          ` : nothing}
          ${this.canEdit
            ? html`
                <button
                  class="edit-btn"
                  @click=${this.toggleEditMode}
                  title="Edit file"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                  Edit
                </button>
              `
            : nothing}
          <button
            class="view-btn ${this.wordWrap ? 'active' : ''}"
            @click=${this.toggleWordWrap}
            title="Toggle word wrap"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="12" x2="15" y2="12"></line>
              <path d="M15 12a3 3 0 1 1 0 6H9"></path>
              <polyline points="12 15 9 18 12 21"></polyline>
            </svg>
          </button>
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
      ${this.hasPartialStaging && this.file && !this.file.isStaged
        ? html`
            <div class="partial-staging-info">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              This file has staged changes that will be included in the next commit.
            </div>
          `
        : nothing}
      ${this.hasConflicts
        ? html`
            <div class="conflict-banner">
              <div class="conflict-info">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                ${this.conflictRegions.length} conflict${this.conflictRegions.length !== 1 ? 's' : ''} found
              </div>
              <div class="conflict-actions">
                <button
                  class="conflict-btn code-conflict-btn-ours"
                  @click=${() => this.resolveAllConflicts('ours')}
                  title="Accept all changes from current branch"
                >
                  Accept All Ours
                </button>
                <button
                  class="conflict-btn code-conflict-btn-theirs"
                  @click=${() => this.resolveAllConflicts('theirs')}
                  title="Accept all changes from incoming branch"
                >
                  Accept All Theirs
                </button>
              </div>
            </div>
          `
        : nothing}
      ${this.viewMode === 'split' ? this.renderSplitView() : this.renderUnifiedView()}
      ${this.renderContextMenu()}
    `;
  }

  /**
   * Render a conflict region with inline resolution buttons
   */
  private renderConflictActions(region: ConflictRegion) {
    return html`
      <div class="conflict-inline-actions">
        <button
          class="conflict-inline-btn code-conflict-btn-ours"
          @click=${() => this.resolveConflict(region, 'ours')}
          title="Accept current branch version"
        >
          Ours
        </button>
        <button
          class="conflict-inline-btn code-conflict-btn-theirs"
          @click=${() => this.resolveConflict(region, 'theirs')}
          title="Accept incoming branch version"
        >
          Theirs
        </button>
        <button
          class="conflict-inline-btn code-conflict-btn-both"
          @click=${() => this.resolveConflict(region, 'both')}
          title="Keep both versions"
        >
          Both
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-diff-view': LvDiffView;
  }
}
