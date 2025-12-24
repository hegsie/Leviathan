import { LitElement, html, css, nothing, TemplateResult } from 'lit';
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
import type { DiffFile, DiffHunk, DiffLine, StatusEntry } from '../../types/git.types.ts';
import './lv-image-diff.ts';

type DiffViewMode = 'unified' | 'split';

interface SplitLine {
  left: DiffLine | null;
  right: DiffLine | null;
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

      .conflict-btn.ours {
        background: rgba(34, 197, 94, 0.15);
        border: 1px solid var(--color-success);
        color: var(--color-success);
      }

      .conflict-btn.ours:hover {
        background: rgba(34, 197, 94, 0.25);
      }

      .conflict-btn.theirs {
        background: rgba(59, 130, 246, 0.15);
        border: 1px solid var(--color-info);
        color: var(--color-info);
      }

      .conflict-btn.theirs:hover {
        background: rgba(59, 130, 246, 0.25);
      }

      .conflict-btn.both {
        background: rgba(168, 85, 247, 0.15);
        border: 1px solid #a855f7;
        color: #a855f7;
      }

      .conflict-btn.both:hover {
        background: rgba(168, 85, 247, 0.25);
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

      .conflict-inline-btn.ours {
        background: var(--color-success-bg);
        border: 1px solid var(--color-success);
        color: var(--color-success);
      }

      .conflict-inline-btn.theirs {
        background: var(--color-info-bg);
        border: 1px solid var(--color-info);
        color: var(--color-info);
      }

      .conflict-inline-btn.both {
        background: rgba(168, 85, 247, 0.15);
        border: 1px solid #a855f7;
        color: #a855f7;
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
  @state() private editMode = false;
  @state() private editContent = '';
  @state() private originalContent = '';
  @state() private saving = false;
  @state() private conflictRegions: ConflictRegion[] = [];
  @state() private hasConflicts = false;

  private language: BundledLanguage | null = null;

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
      // Initialize highlighter and detect language
      await initHighlighter();
      this.language = detectLanguage(this.file.path);
      if (this.language) {
        await preloadLanguage(this.language);
      }

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

    try {
      // Initialize highlighter and detect language
      await initHighlighter();
      this.language = detectLanguage(this.commitFile.filePath);
      if (this.language) {
        await preloadLanguage(this.language);
      }

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
    const tokens = highlightLineSync(content, this.language);
    return html`${tokens.map(
      (token) => html`<span style="color: ${token.color}">${token.content}</span>`
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
                  class="conflict-btn ours"
                  @click=${() => this.resolveAllConflicts('ours')}
                  title="Accept all changes from current branch"
                >
                  Accept All Ours
                </button>
                <button
                  class="conflict-btn theirs"
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
    `;
  }

  /**
   * Render a conflict region with inline resolution buttons
   */
  private renderConflictActions(region: ConflictRegion) {
    return html`
      <div class="conflict-inline-actions">
        <button
          class="conflict-inline-btn ours"
          @click=${() => this.resolveConflict(region, 'ours')}
          title="Accept current branch version"
        >
          Ours
        </button>
        <button
          class="conflict-inline-btn theirs"
          @click=${() => this.resolveConflict(region, 'theirs')}
          title="Accept incoming branch version"
        >
          Theirs
        </button>
        <button
          class="conflict-inline-btn both"
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
