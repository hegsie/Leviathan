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
 *
 * Conflict markers (<<<<<<< / ======= / >>>>>>>) are an internal, on-disk
 * representation ONLY. They are parsed once into structured segments when the
 * file loads and are never rendered anywhere in the UI. The output pane is a
 * list of segments: resolved text (editable in place) and conflict blocks
 * (ours/theirs side by side with Use Ours / Use Theirs / Use Both / Edit
 * actions). The file is only written back once no conflict blocks remain, so
 * markers can never round-trip into a "resolved" file.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { codeStyles } from '../../styles/code-styles.ts';
import * as gitService from '../../services/git.service.ts';
import * as aiService from '../../services/ai.service.ts';
import { showToast } from '../../services/notification.service.ts';
import { showConfirm } from '../../services/dialog.service.ts';
import { CodeRenderMixin } from '../../mixins/code-render-mixin.ts';
import type { ConflictFile } from '../../types/git.types.ts';
import {
  isWhitespaceOnlyChange,
  computeInlineWhitespaceDiff,
  alignThreeWay,
  type ThreeWayRow,
} from '../../utils/diff-utils.ts';

export type MergeOperationType = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'stash';

type SegmentOrigin = 'ours' | 'theirs' | 'both' | 'base' | 'manual' | 'ai';

interface OutputSegment {
  id: number;
  type: 'resolved' | 'conflict';
  /** Resolved output lines (empty while type === 'conflict'). */
  lines: string[];
  /** Conflict side content — kept after resolution so the block can be reset. */
  oursLines: string[];
  theirsLines: string[];
  oursLabel: string;
  theirsLabel: string;
  /** How a resolved segment was produced (colors the gutter). */
  origin: SegmentOrigin | null;
  /** True when a resolved segment came from a conflict block (enables Reset). */
  fromConflict: boolean;
}

/** Per-operation pane labels: during a rebase the sides are semantically
 * swapped (ours = the branch being rebased onto, theirs = your own commit). */
const SIDE_LABELS: Record<MergeOperationType, { ours: string; theirs: string }> = {
  merge: { ours: 'Ours (Current Branch)', theirs: 'Theirs (Incoming)' },
  rebase: { ours: 'Ours (Rebasing Onto)', theirs: 'Theirs (Your Commit)' },
  'cherry-pick': { ours: 'Ours (Current Branch)', theirs: 'Theirs (Picked Commit)' },
  revert: { ours: 'Ours (Current Branch)', theirs: 'Theirs (Revert Changes)' },
  stash: { ours: 'Ours (Working Tree)', theirs: 'Theirs (Stashed Changes)' },
};

const ORIGIN_LABELS: Record<SegmentOrigin, string> = {
  ours: 'Ours',
  theirs: 'Theirs',
  both: 'Both',
  base: 'Base',
  manual: 'Edited',
  ai: 'AI',
};

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

      .btn:hover:not(:disabled) {
        background: var(--color-bg-hover);
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-primary {
        background: var(--color-primary);
        color: var(--color-text-inverse);
        border-color: var(--color-primary);
      }

      .btn-primary:hover:not(:disabled) {
        background: var(--color-primary-hover);
      }

      .btn-ours {
        background: rgba(var(--color-success-rgb, 34, 197, 94), 0.15);
        border-color: var(--color-success);
        color: var(--color-success);
      }

      .btn-ours:hover:not(:disabled) {
        background: rgba(var(--color-success-rgb, 34, 197, 94), 0.25);
      }

      .btn-theirs {
        background: rgba(var(--color-info-rgb, 59, 130, 246), 0.15);
        border-color: var(--color-info);
        color: var(--color-info);
      }

      .btn-theirs:hover:not(:disabled) {
        background: rgba(var(--color-info-rgb, 59, 130, 246), 0.25);
      }

      .btn-both {
        background: rgba(168, 85, 247, 0.15);
        border-color: #a855f7;
        color: #a855f7;
      }

      .btn-both:hover:not(:disabled) {
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

      .line-changed {
        background: rgba(var(--color-warning-rgb, 234, 179, 8), 0.2);
      }

      .line-changed .line-number {
        background: rgba(var(--color-warning-rgb, 234, 179, 8), 0.3);
      }

      .line-removed-filler .line-content {
        background: repeating-linear-gradient(
          -45deg,
          transparent,
          transparent 4px,
          rgba(var(--color-text-muted-rgb, 128, 128, 128), 0.12) 4px,
          rgba(var(--color-text-muted-rgb, 128, 128, 128), 0.12) 8px
        );
      }

      /* Resolved-segment origin highlighting in output */
      .output-segment.resolved-ours .line-number {
        border-left: 3px solid var(--color-success);
      }

      .output-segment.resolved-ours .line-content {
        background: rgba(var(--color-success-rgb, 34, 197, 94), 0.1);
      }

      .output-segment.resolved-theirs .line-number {
        border-left: 3px solid var(--color-info);
      }

      .output-segment.resolved-theirs .line-content {
        background: rgba(var(--color-info-rgb, 59, 130, 246), 0.1);
      }

      .output-segment.resolved-both .line-number,
      .output-segment.resolved-ai .line-number {
        border-left: 3px solid #a855f7;
      }

      .output-segment.resolved-both .line-content,
      .output-segment.resolved-ai .line-content {
        background: rgba(168, 85, 247, 0.1);
      }

      .output-segment.resolved-manual .line-number {
        border-left: 3px solid var(--color-warning);
      }

      .output-segment.resolved-manual .line-content {
        background: rgba(var(--color-warning-rgb, 234, 179, 8), 0.08);
      }

      .output-segment {
        position: relative;
      }

      .segment-actions {
        position: absolute;
        top: 2px;
        right: var(--spacing-sm);
        display: none;
        gap: var(--spacing-xs);
        align-items: center;
        z-index: 1;
      }

      .output-segment:hover .segment-actions {
        display: flex;
      }

      .segment-origin-chip {
        font-size: 10px;
        font-weight: var(--font-weight-bold);
        text-transform: uppercase;
        padding: 1px 6px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--color-border);
        color: var(--color-text-muted);
        background: var(--color-bg-secondary);
      }

      .segment-btn {
        padding: 1px 6px;
        font-size: var(--font-size-xs);
        border-radius: var(--radius-sm);
        cursor: pointer;
        border: 1px solid var(--color-border);
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
      }

      .segment-btn:hover {
        background: var(--color-bg-hover);
      }

      /* Inline segment editing */
      .segment-editor {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        padding: var(--spacing-xs) var(--spacing-sm);
        border: 1px solid var(--color-primary);
        border-radius: var(--radius-sm);
        margin: 2px 0;
        background: var(--color-bg-primary);
      }

      .segment-editor textarea {
        width: 100%;
        border: none;
        background: var(--color-bg-primary);
        color: var(--color-text-primary);
        font-family: var(--font-family-mono);
        font-size: var(--font-size-sm);
        line-height: 1.5;
        resize: vertical;
        white-space: pre;
        tab-size: 4;
      }

      .segment-editor textarea:focus {
        outline: none;
      }

      .segment-editor-actions {
        display: flex;
        gap: var(--spacing-sm);
        justify-content: flex-end;
      }

      /* Side-by-side conflict block body */
      .conflict-sides {
        display: grid;
        grid-template-columns: 1fr 1px 1fr;
        align-items: stretch;
      }

      .conflict-side-empty {
        padding: var(--spacing-xs) var(--spacing-sm);
        color: var(--color-text-muted);
        font-style: italic;
        font-size: var(--font-size-xs);
      }

      /* Placeholder row for a resolution that removed all lines — keeps the
         segment hoverable so its Edit/Reset actions stay reachable */
      .segment-empty-note {
        color: var(--color-text-muted);
        font-style: italic;
        font-size: var(--font-size-xs);
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

      .output-error {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-md);
        height: 100%;
        color: var(--color-text-muted);
      }

      .diff-indicator {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-left: var(--spacing-xs);
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

      .conflict-count {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        margin-left: auto;
      }

      .btn-ai {
        background: rgba(168, 85, 247, 0.15);
        border-color: #a855f7;
        color: #a855f7;
      }

      .btn-ai:hover:not(:disabled) {
        background: rgba(168, 85, 247, 0.25);
      }

      .ai-explanation {
        padding: var(--spacing-xs) var(--spacing-sm);
        background: rgba(168, 85, 247, 0.08);
        border-left: 3px solid #a855f7;
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        margin: var(--spacing-xs) 0;
      }
    `,
  ];

  @property({ type: String }) repositoryPath = '';
  @property({ type: Object }) conflictFile: ConflictFile | null = null;
  /** Which git operation produced the conflict — controls the side labels. */
  @property({ type: String }) operationType: MergeOperationType = 'merge';
  /**
   * Set by the host while its own destructive flows (abort/complete) run —
   * launching an external tool then would race them.
   */
  @property({ type: Boolean }) externalToolLocked = false;

  @state() private baseContent = '';
  @state() private oursContent = '';
  @state() private theirsContent = '';
  @state() private segments: OutputSegment[] = [];
  @state() private loading = false;
  @state() private loadFailed = false;
  @state() private launchingExternalTool = false;
  @state() private hasMergeTool = false;
  @state() private aiAvailable = false;
  @state() private suggestingSegment: number | null = null;
  @state() private suggestingAll = false;
  /** True while a resolve/take-side backend call is in flight. */
  @state() private resolving = false;
  @state() private editingSegmentId: number | null = null;
  @state() private editDraft = '';
  @state() private aiExplanations: Map<number, string> = new Map();

  private nextSegmentId = 1;
  /** Invalidates in-flight loads when a newer one starts (rapid file switches). */
  private loadEpoch = 0;
  /** Ownership tokens so stale async completions can't clobber newer state. */
  private resolveToken = 0;
  private aiResolveAllToken = 0;
  private baseLines: string[] = [];
  private oursLines: string[] = [];
  private theirsLines: string[] = [];
  /** Per-pane read failures — that pane shows an error, not fake content. */
  private sideReadErrors = { base: false, ours: false, theirs: false };
  private alignmentRows: ThreeWayRow[] = [];
  /** Guards against scroll-sync feedback loops between the panes. */
  private syncingScroll = false;

  private boundHandleAiSettingsChanged = async () => {
    this.aiAvailable = await aiService.isAiAvailable();
  };

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('ai-settings-changed', this.boundHandleAiSettingsChanged);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('ai-settings-changed', this.boundHandleAiSettingsChanged);
  }

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('conflictFile') && this.conflictFile) {
      await this.loadContents();
    }
    if (changedProperties.has('repositoryPath') && this.repositoryPath) {
      await this.checkMergeToolAvailability();
      this.aiAvailable = await aiService.isAiAvailable();
    }
  }

  private async checkMergeToolAvailability(): Promise<void> {
    if (!this.repositoryPath) return;
    try {
      const result = await gitService.getMergeToolConfig(this.repositoryPath);
      this.hasMergeTool = result.success && !!result.data?.toolName;
    } catch {
      this.hasMergeTool = false;
    }
  }

  private async handleOpenExternalMergeTool(): Promise<void> {
    if (
      !this.repositoryPath ||
      !this.conflictFile ||
      this.externalToolLocked ||
      this.launchingExternalTool ||
      this.resolving
    ) {
      return;
    }

    const file = this.conflictFile;
    // The tool edits the ON-DISK file, which doesn't have the editor's
    // unsaved picks — its output will replace them on reload. Confirm first.
    if (this.hasUnsavedResolutions()) {
      const proceed = await showConfirm(
        'Discard in-progress resolution?',
        'The external tool works on the file as saved on disk — your unsaved picks here will be replaced by its result.',
        'warning',
      );
      if (!proceed) return;
    }

    this.launchingExternalTool = true;
    // Tell the host a tool session is open so its Abort/Complete stay inert —
    // they would otherwise race the tool's eventual save.
    this.dispatchEvent(
      new CustomEvent('external-tool-started', { bubbles: true, composed: true })
    );
    try {
      const result = await gitService.launchMergeTool(this.repositoryPath, file.path);
      if (result.success && result.data?.success) {
        // The tool may have fully resolved (and staged) the file — verify
        // against the index and let the host mark it, so this path behaves
        // like the dialog's own external tool instead of leaving the file
        // listed unresolved until an extra Mark Resolved click.
        const conflictsResult = await gitService.getConflicts(this.repositoryPath);
        const stillConflicted =
          !conflictsResult.success ||
          (conflictsResult.data ?? []).some((c) => c.path === file.path);
        // Reload ONLY when the tool's file is still the one on screen: it
        // must show the tool's output (a stale parse could be written over
        // the tool's merge if this was the last file and selection stays),
        // but after a mid-session switch a reload would wipe the picks of
        // the file the user is now working on.
        if (this.conflictFile?.path === file.path) {
          await this.loadContents();
        }
        // Mirror the dialog's launcher: success only when the index confirms
        // the resolution — a green toast over "N conflicts remaining" would
        // read as success for an unfinished merge.
        if (stillConflicted) {
          showToast('File still has conflicts', 'warning');
        } else {
          showToast('Merge tool completed', 'success');
          this.dispatchEvent(new CustomEvent('conflict-resolved', {
            detail: { file },
            bubbles: true,
            composed: true,
          }));
        }
      } else {
        showToast(result.data?.message ?? result.error?.message ?? 'Merge tool failed', 'error');
      }
    } catch {
      showToast('Failed to launch merge tool', 'error');
    } finally {
      this.launchingExternalTool = false;
      this.dispatchEvent(
        new CustomEvent('external-tool-finished', { bubbles: true, composed: true })
      );
    }
  }

  private async loadContents(): Promise<void> {
    if (!this.repositoryPath || !this.conflictFile) return;

    // Rapid file switches start overlapping loads; only the NEWEST may write
    // state, or a slow earlier load would overwrite the panes/segments with
    // another file's content under the current file's path — and Mark
    // Resolved would then stage that wrong content.
    const epoch = ++this.loadEpoch;
    const file = this.conflictFile;

    this.loading = true;
    this.loadFailed = false;
    // Per-file UI state must not leak between files.
    this.editingSegmentId = null;
    this.aiExplanations = new Map();
    this.suggestingSegment = null;
    // A resolve or resolve-all bound to the previous file must not keep the
    // new file's buttons disabled; bump the tokens so their finally blocks
    // can't clear state a newer operation owns.
    this.resolving = false;
    this.resolveToken++;
    this.suggestingAll = false;
    this.aiResolveAllToken++;
    this.lastSavedContent = null;
    this.userTouched = false;
    this.sideReadErrors = { base: false, ours: false, theirs: false };

    try {
      // Initialize Shiki highlighter and detect language. Inside the try so
      // a highlighter failure cannot wedge the editor in a permanent
      // loading state (the finally below always clears it).
      await this.initCodeLanguage(file.path);

      // Load all three versions and the working directory file in parallel.
      // The working directory file contains git's authoritative diff3 merge.
      const [ancestorResult, oursResult, theirsResult, workdirResult] = await Promise.all([
        file.ancestor?.oid
          ? gitService.getBlobContent(this.repositoryPath, file.ancestor.oid)
          : Promise.resolve({ success: true, data: '' }),
        file.ours?.oid
          ? gitService.getBlobContent(this.repositoryPath, file.ours.oid)
          : Promise.resolve({ success: true, data: '' }),
        file.theirs?.oid
          ? gitService.getBlobContent(this.repositoryPath, file.theirs.oid)
          : Promise.resolve({ success: true, data: '' }),
        gitService.readFileContent(this.repositoryPath, file.path),
      ]);

      // A newer load superseded this one while it was awaiting.
      if (epoch !== this.loadEpoch) return;

      this.baseContent = ancestorResult.success ? (ancestorResult.data || '') : '';
      this.oursContent = oursResult.success ? (oursResult.data || '') : '';
      this.theirsContent = theirsResult.success ? (theirsResult.data || '') : '';

      // A side with no entry (add/add conflicts have no ancestor; delete/modify
      // conflicts miss one side) has ZERO lines — ''.split('\n') would invent a
      // phantom blank line that misaligns and miscolors the panes.
      this.baseLines = file.ancestor ? this.baseContent.split('\n') : [];
      this.oursLines = file.ours ? this.oursContent.split('\n') : [];
      this.theirsLines = file.theirs ? this.theirsContent.split('\n') : [];

      // A failed read of a side that EXISTS must not masquerade as empty
      // content — the panes would lie and whole-file Use Ours/Theirs would
      // truncate the file. Route it to the same Retry state as a failed
      // workdir read, track which pane failed, and drop its fabricated
      // ''-split line so nothing renders as fake content.
      this.sideReadErrors = {
        base: !!file.ancestor?.oid && !ancestorResult.success,
        ours: !!file.ours?.oid && !oursResult.success,
        theirs: !!file.theirs?.oid && !theirsResult.success,
      };
      if (this.sideReadErrors.base) this.baseLines = [];
      if (this.sideReadErrors.ours) this.oursLines = [];
      if (this.sideReadErrors.theirs) this.theirsLines = [];
      const sideReadFailed =
        this.sideReadErrors.base || this.sideReadErrors.ours || this.sideReadErrors.theirs;

      // Align AFTER dropping failed sides, or the rows would reference lines
      // that no longer exist and pane rendering would crash on them.
      this.alignmentRows = alignThreeWay(this.baseLines, this.oursLines, this.theirsLines);

      // Only git's own merge output is trustworthy. If the working directory
      // file can't be read, show an error state — never fabricate a merge.
      // An empty string is valid content (empty merged file), so test the
      // type, not truthiness.
      if (!sideReadFailed && workdirResult.success && typeof workdirResult.data === 'string') {
        this.segments = this.parseSegments(workdirResult.data);
      } else {
        this.segments = [];
        this.loadFailed = true;
      }
    } catch (err) {
      console.error('Failed to load conflict contents:', err);
      if (epoch === this.loadEpoch) {
        this.segments = [];
        this.loadFailed = true;
      }
    } finally {
      // A superseding load owns the loading flag now — don't clear it early.
      if (epoch === this.loadEpoch) {
        this.loading = false;
      }
    }
  }

  /**
   * Parse git's conflict-marker text into structured segments — the ONLY
   * place markers are ever interpreted; they never reach the DOM.
   * Handles diff3-style `|||||||` base sections (discarded) and tolerates an
   * unterminated conflict at EOF (kept as a conflict block).
   *
   * Git emits exactly seven marker characters, optionally followed by a
   * space and label (the `=======` separator is always bare). Content lines
   * that merely BEGIN with 7+ of the character — banner comments, Markdown
   * setext underlines, `====…` dividers — must not match, or the ours/theirs
   * split silently corrupts and the real separator leaks in as content.
   * Lines are compared with a trailing CR stripped so CRLF files parse, but
   * content lines are stored verbatim to round-trip their line endings.
   */
  private parseSegments(text: string): OutputSegment[] {
    const stripCr = (l: string): string => (l.endsWith('\r') ? l.slice(0, -1) : l);
    /**
     * Length of a marker run of `ch` at the start of the line, or 0 when the
     * line is not a marker (fewer than 7 chars, or followed by anything other
     * than a space/EOL). Repos can raise the run length above git's default 7
     * via the conflict-marker-size gitattribute, so the start marker's run
     * defines the size the rest of that conflict's markers must match exactly.
     */
    const markerRun = (l: string, ch: string): number => {
      const s = stripCr(l);
      let n = 0;
      while (n < s.length && s[n] === ch) n++;
      return n >= 7 && (s.length === n || s[n] === ' ') ? n : 0;
    };
    let markerSize = 7;
    const isBaseMarker = (l: string): boolean => markerRun(l, '|') === markerSize;
    const isSeparator = (l: string): boolean => stripCr(l) === '='.repeat(markerSize);
    const isConflictEnd = (l: string): boolean => markerRun(l, '>') === markerSize;

    const lines = text.split('\n');

    /**
     * A start-marker run of git's default size (7) always opens a conflict.
     * A LONGER run (raised conflict-marker-size gitattribute) only counts
     * when a matching exact-size separator follows later — otherwise a
     * content line like '<<<<<<<< not a marker' would swallow the rest of
     * the file into a phantom conflict.
     */
    const conflictStartSize = (index: number): number => {
      const n = markerRun(lines[index], '<');
      if (n === 0) return 0;
      if (n === 7) return 7;
      // A raised size must look like a REAL git conflict: both the exact-size
      // separator AND an exact-size end marker must follow. Requiring only
      // the separator would let a banner line plus one coincidental divider
      // swallow the rest of the file into a phantom conflict.
      const sep = '='.repeat(n);
      const rest = lines.slice(index + 1);
      const hasSeparator = rest.some((l) => stripCr(l) === sep);
      const hasEnd = rest.some((l) => markerRun(l, '>') === n);
      return hasSeparator && hasEnd ? n : 0;
    };

    const segments: OutputSegment[] = [];
    let currentResolved: string[] = [];
    let inConflict = false;
    let section: 'ours' | 'base' | 'theirs' = 'ours';
    let oursLines: string[] = [];
    let theirsLines: string[] = [];
    let oursLabel = '';
    let theirsLabel = '';

    const flushResolved = (): void => {
      if (currentResolved.length > 0) {
        segments.push(this.makeResolvedSegment(currentResolved, null, false));
        currentResolved = [];
      }
    };
    const pushConflict = (): void => {
      segments.push({
        id: this.nextSegmentId++,
        type: 'conflict',
        lines: [],
        oursLines: [...oursLines],
        theirsLines: [...theirsLines],
        oursLabel,
        theirsLabel,
        origin: null,
        fromConflict: false,
      });
    };

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const startSize = inConflict ? 0 : conflictStartSize(lineIndex);
      if (!inConflict && startSize > 0) {
        flushResolved();
        inConflict = true;
        section = 'ours';
        oursLines = [];
        theirsLines = [];
        markerSize = startSize;
        oursLabel = stripCr(line).slice(markerSize).trim() || 'OURS';
        theirsLabel = '';
      } else if (inConflict && section === 'ours' && isBaseMarker(line)) {
        // diff3 common-ancestor marker — begin discarding base lines. Only
        // valid directly after the ours section; anywhere else it's content.
        section = 'base';
      } else if (inConflict && section !== 'theirs' && isSeparator(line)) {
        section = 'theirs';
      } else if (inConflict && section === 'theirs' && isConflictEnd(line)) {
        // Git always emits '=======' before '>>>>>>>', so an end marker is
        // only valid in the theirs section — anywhere earlier it's content
        // (a quoted diff, docs about conflicts) and treating it as the end
        // would drop the real theirs side and leak the true markers.
        theirsLabel = stripCr(line).slice(markerSize).trim() || 'THEIRS';
        pushConflict();
        inConflict = false;
        section = 'ours';
        oursLines = [];
        theirsLines = [];
      } else if (inConflict) {
        // A nested '<<<<<<<' (or any non-marker line) while already inside a
        // conflict is treated as content, not as a new conflict start.
        if (section === 'ours') {
          oursLines.push(line);
        } else if (section === 'theirs') {
          theirsLines.push(line);
        }
        // section === 'base': discard — never leak base into ours
      } else {
        currentResolved.push(line);
      }
    }

    if (inConflict) {
      // Unterminated conflict (truncated file) — keep it as a conflict block
      // rather than silently promoting marker content to resolved text.
      theirsLabel = theirsLabel || 'THEIRS';
      pushConflict();
    } else {
      flushResolved();
    }

    return segments;
  }

  private makeResolvedSegment(
    lines: string[],
    origin: SegmentOrigin | null,
    fromConflict: boolean,
    conflictData?: Pick<OutputSegment, 'oursLines' | 'theirsLines' | 'oursLabel' | 'theirsLabel'>,
  ): OutputSegment {
    return {
      id: this.nextSegmentId++,
      type: 'resolved',
      lines,
      oursLines: conflictData?.oursLines ?? [],
      theirsLines: conflictData?.theirsLines ?? [],
      oursLabel: conflictData?.oursLabel ?? '',
      theirsLabel: conflictData?.theirsLabel ?? '',
      origin,
      fromConflict,
    };
  }

  /** Resolve writes and an open external tool must never overlap — both
   * mutate the same on-disk file and the last write would silently win.
   * The host lock counts too: the dialog sets it while ITS tool session or
   * abort/complete runs against this same file. */
  private get actionsBlocked(): boolean {
    return this.resolving || this.launchingExternalTool || this.externalToolLocked;
  }

  /** Serialized output of the last successful Mark Resolved for this file —
   * work matching it is on disk and safe to navigate away from. */
  private lastSavedContent: string | null = null;
  /** True once the user changed the output in this file (per-block picks,
   * edits, OR whole-file accepts — the latter carry no fromConflict flag). */
  private userTouched = false;

  /**
   * True when the output holds work not yet written to disk: per-block
   * resolutions, whole-file accepts, or an open inline edit. Nothing
   * persists until Mark Resolved, so hosts should confirm before
   * navigating away.
   */
  public hasUnsavedResolutions(): boolean {
    if (this.editingSegmentId !== null) return true;
    if (!this.userTouched) return false;
    return this.buildResolvedContent() !== this.lastSavedContent;
  }

  private get conflictCount(): number {
    return this.segments.filter((s) => s.type === 'conflict').length;
  }

  /** Serialize the output. Only valid once every conflict block is resolved. */
  private buildResolvedContent(): string {
    return this.segments.flatMap((s) => s.lines).join('\n');
  }

  // ── Segment operations ────────────────────────────────────────────────

  private updateSegment(id: number, update: Partial<OutputSegment>): void {
    this.segments = this.segments.map((s) => (s.id === id ? { ...s, ...update } : s));
  }

  /**
   * Drop a stored AI explanation once the segment's content no longer comes
   * from that suggestion (reset, re-picked, or hand-edited) — a stale
   * rationale under unrelated content is worse than none.
   */
  private clearAiExplanation(id: number): void {
    if (!this.aiExplanations.has(id)) return;
    const next = new Map(this.aiExplanations);
    next.delete(id);
    this.aiExplanations = next;
  }

  private resolveConflictSegment(id: number, choice: 'ours' | 'theirs' | 'both'): void {
    const segment = this.segments.find((s) => s.id === id);
    if (!segment || segment.type !== 'conflict') return;

    const lines =
      choice === 'ours'
        ? [...segment.oursLines]
        : choice === 'theirs'
          ? [...segment.theirsLines]
          : [...segment.oursLines, ...segment.theirsLines];
    this.clearAiExplanation(id);
    this.userTouched = true;
    this.updateSegment(id, { type: 'resolved', lines, origin: choice, fromConflict: true });
  }

  /** Revert a resolved-from-conflict segment back to an open conflict block. */
  private resetSegment(id: number): void {
    const segment = this.segments.find((s) => s.id === id);
    if (!segment || !segment.fromConflict) return;
    if (this.editingSegmentId === id) this.editingSegmentId = null;
    this.clearAiExplanation(id);
    this.updateSegment(id, { type: 'conflict', lines: [], origin: null, fromConflict: false });
  }

  private startEditSegment(segment: OutputSegment): void {
    this.editingSegmentId = segment.id;
    // Editing an open conflict starts from both sides so the user trims what
    // they don't want — never from marker text.
    this.editDraft =
      segment.type === 'conflict'
        ? [...segment.oursLines, ...segment.theirsLines].join('\n')
        : segment.lines.join('\n');
  }

  private applyEditSegment(): void {
    const id = this.editingSegmentId;
    if (id === null) return;
    const segment = this.segments.find((s) => s.id === id);
    if (!segment) {
      this.editingSegmentId = null;
      return;
    }

    this.clearAiExplanation(id);
    this.userTouched = true;
    this.updateSegment(id, {
      type: 'resolved',
      // An empty draft means ZERO lines (section removed) — ''.split('\n')
      // would silently turn it into one blank line.
      lines: this.editDraft === '' ? [] : this.editDraft.split('\n'),
      origin: 'manual',
      fromConflict: segment.type === 'conflict' ? true : segment.fromConflict,
    });
    this.editingSegmentId = null;
    this.editDraft = '';
  }

  private cancelEditSegment(): void {
    this.editingSegmentId = null;
    this.editDraft = '';
  }

  private handleEditDraftInput(e: Event): void {
    this.editDraft = (e.target as HTMLTextAreaElement).value;
  }

  // ── Whole-file operations ─────────────────────────────────────────────

  private acceptWholeFile(origin: 'ours' | 'theirs' | 'base'): void {
    // With a failed load the side contents are not trustworthy — accepting
    // one would replace the segments with fabricated (possibly empty) text.
    if (this.loadFailed) return;

    // A side with no entry DELETED the file — accepting it means staging the
    // deletion, not writing a 0-byte file from its empty content.
    if (
      (origin === 'ours' && !this.conflictFile?.ours) ||
      (origin === 'theirs' && !this.conflictFile?.theirs)
    ) {
      void this.handleTakeSide(origin);
      return;
    }

    const content =
      origin === 'ours' ? this.oursContent : origin === 'theirs' ? this.theirsContent : this.baseContent;
    this.editingSegmentId = null;
    this.userTouched = true;
    this.segments = [this.makeResolvedSegment(content.split('\n'), origin, false)];
  }

  private handleAcceptOurs(): void {
    this.acceptWholeFile('ours');
  }

  private handleAcceptTheirs(): void {
    this.acceptWholeFile('theirs');
  }

  private handleAcceptBase(): void {
    this.acceptWholeFile('base');
  }

  /** Re-read the on-disk merge, discarding all in-editor resolutions. */
  private async handleReload(): Promise<void> {
    await this.loadContents();
  }

  // ── AI resolution ─────────────────────────────────────────────────────

  /** Resolve one conflict block via AI. Returns false when the call failed. */
  private async handleSuggestSegment(id: number): Promise<boolean> {
    if (!this.conflictFile || this.suggestingSegment !== null) return false;
    const segment = this.segments.find((s) => s.id === id);
    if (!segment || segment.type !== 'conflict') return false;

    this.suggestingSegment = id;
    try {
      // Surrounding resolved context helps the model match style.
      const resolvedBefore: string[] = [];
      const resolvedAfter: string[] = [];
      let seenTarget = false;
      for (const s of this.segments) {
        if (s.id === id) {
          seenTarget = true;
        } else if (s.type === 'resolved') {
          (seenTarget ? resolvedAfter : resolvedBefore).push(...s.lines);
        }
      }

      const result = await aiService.suggestConflictResolution(
        this.conflictFile.path,
        segment.oursLines.join('\n'),
        segment.theirsLines.join('\n'),
        this.baseContent || undefined,
        resolvedBefore.slice(-20).join('\n') || undefined,
        resolvedAfter.slice(0, 20).join('\n') || undefined,
      );

      // The user may have resolved this block manually while the call was in
      // flight — their explicit pick wins; never overwrite it. Not a failure,
      // so Resolve All continues past it.
      const current = this.segments.find((s) => s.id === id);
      if (!current || current.type !== 'conflict') return true;

      if (result.success && result.data) {
        // AI output bypasses parseSegments, so it must be validated here:
        // a suggestion that echoes marker lines would otherwise render them
        // as "resolved" text and let them be written back to the file. Runs
        // of 7+ cover repos with a raised conflict-marker-size; being overly
        // conservative here just leaves the block unresolved, which is safe.
        if (/^(<{7,}|={7,}|>{7,}|\|{7,})( |\r?$)/m.test(result.data.resolvedContent)) {
          showToast('AI suggestion contained conflict markers — block left unresolved', 'error');
          return false;
        }
        this.userTouched = true;
        this.updateSegment(id, {
          type: 'resolved',
          // An empty suggestion means ZERO lines (remove the section) —
          // ''.split('\n') would fabricate one blank line.
          lines: result.data.resolvedContent === '' ? [] : result.data.resolvedContent.split('\n'),
          origin: 'ai',
          fromConflict: true,
        });
        if (result.data.explanation) {
          this.aiExplanations = new Map(this.aiExplanations);
          this.aiExplanations.set(id, result.data.explanation);
        }
        return true;
      }
      showToast(result.error?.message ?? 'AI suggestion failed', 'error');
      return false;
    } catch {
      showToast('Failed to get AI suggestion', 'error');
      return false;
    } finally {
      // Only clear the in-flight flag if it still tracks THIS call — a file
      // switch resets it and a newer suggestion may own it by now; clobbering
      // that would re-enable the AI buttons while a call is genuinely running.
      if (this.suggestingSegment === id) {
        this.suggestingSegment = null;
      }
    }
  }

  private async handleAiResolveAll(): Promise<void> {
    if (this.suggestingAll) return;

    const conflictIds = this.segments.filter((s) => s.type === 'conflict').map((s) => s.id);
    if (conflictIds.length === 0) return;

    const epoch = this.loadEpoch;
    const token = ++this.aiResolveAllToken;
    this.suggestingAll = true;
    try {
      for (const id of conflictIds) {
        // The file changed under the batch — its ids are stale; stop instead
        // of grinding through no-op calls while the new file's AI is locked.
        if (this.loadEpoch !== epoch) break;
        // The user may have resolved this block manually while the batch was
        // running — that's not a failure, just skip it.
        const segment = this.segments.find((s) => s.id === id);
        if (!segment || segment.type !== 'conflict') continue;
        // Stop on the first real failure — retrying would just repeat the error.
        if (!(await this.handleSuggestSegment(id))) break;
      }
    } finally {
      if (token === this.aiResolveAllToken) {
        this.suggestingAll = false;
      }
    }
  }

  // ── Completion ────────────────────────────────────────────────────────

  private async handleMarkResolved(): Promise<void> {
    if (!this.repositoryPath || !this.conflictFile || this.actionsBlocked) return;

    // The button is disabled in these states; the guards keep the invariant
    // even if invoked directly. A file with open conflict blocks must never
    // be written out (it would re-serialize markers), and a failed load has
    // no trustworthy content to write (it would truncate the file to empty).
    if (this.loadFailed) {
      showToast('The merged file could not be read — retry loading it before resolving', 'warning');
      return;
    }
    if (this.conflictCount > 0) {
      showToast('Resolve all conflict blocks before marking the file resolved', 'warning');
      return;
    }
    // An open inline edit holds an unapplied draft — writing now would stage
    // the PRE-edit text while the screen shows the draft, silently losing it.
    if (this.editingSegmentId !== null) {
      showToast('Apply or cancel the open edit before marking the file resolved', 'warning');
      return;
    }

    // Capture the file BEFORE the await: the user may select another file in
    // the dialog while the backend call runs, and dispatching that one would
    // mark the wrong file resolved (and let a stash Complete drop the stash
    // with a still-conflicted file).
    const file = this.conflictFile;
    const token = ++this.resolveToken;
    const content = this.buildResolvedContent();
    this.resolving = true;
    // Announce the write so the host can lock its own tool launcher against
    // it (same pattern as the external-tool session events).
    this.dispatchEvent(new CustomEvent('resolve-started', { bubbles: true, composed: true }));
    try {
      const result = await gitService.resolveConflict(
        this.repositoryPath,
        file.path,
        content
      );

      if (result.success) {
        // This exact output is on disk now — navigation away is safe.
        this.lastSavedContent = content;
        this.dispatchEvent(new CustomEvent('conflict-resolved', {
          detail: { file },
          bubbles: true,
          composed: true,
        }));
      } else {
        console.error('Failed to resolve conflict:', result.error);
        showToast(`Failed to mark file as resolved: ${result.error?.message ?? 'Unknown error'}`, 'error');
      }
    } finally {
      // Only the call that owns the flag may clear it — a file switch resets
      // it and a newer call may own it by now.
      if (token === this.resolveToken) {
        this.resolving = false;
      }
      this.dispatchEvent(new CustomEvent('resolve-finished', { bubbles: true, composed: true }));
    }
  }

  private get isBinaryConflict(): boolean {
    return this.conflictFile?.isBinary === true;
  }

  /**
   * Resolve the conflict by taking one whole side's blob verbatim.
   * Binary-safe, and correctly stages a deletion when the chosen side removed
   * the file (avoids the text pipeline truncating binary/deleted files).
   */
  private async handleTakeSide(side: 'ours' | 'theirs'): Promise<void> {
    if (!this.repositoryPath || !this.conflictFile || this.actionsBlocked) return;

    // Same capture-before-await as handleMarkResolved: the dispatched file
    // must be the one the call actually resolved.
    const file = this.conflictFile;
    const token = ++this.resolveToken;
    this.resolving = true;
    this.dispatchEvent(new CustomEvent('resolve-started', { bubbles: true, composed: true }));
    try {
      const result = await gitService.resolveConflictTakeSide(
        this.repositoryPath,
        file.path,
        side,
      );

      if (result.success) {
        this.dispatchEvent(new CustomEvent('conflict-resolved', {
          detail: { file },
          bubbles: true,
          composed: true,
        }));
      } else {
        console.error('Failed to resolve conflict:', result.error);
        showToast(`Failed to resolve conflict: ${result.error?.message ?? 'Unknown error'}`, 'error');
      }
    } finally {
      if (token === this.resolveToken) {
        this.resolving = false;
      }
      this.dispatchEvent(new CustomEvent('resolve-finished', { bubbles: true, composed: true }));
    }
  }

  // ── Scroll synchronization ────────────────────────────────────────────

  /**
   * All panes sync proportionally. The source panes share a row COUNT, but
   * line wrapping (`white-space: pre-wrap`) gives them different pixel
   * heights, so mirroring absolute scrollTop would misalign and, at the
   * bottom of a taller pane, snap the user's scroll back. Writes are skipped
   * when the target is already in place, so the echo scroll event a synced
   * pane fires (after the rAF guard has cleared) finds nothing to change and
   * the loop terminates instead of yanking the source pane around.
   */
  private syncScrollTo(target: HTMLElement, top: number): void {
    if (Math.abs(target.scrollTop - top) > 1) {
      target.scrollTop = top;
    }
  }

  private syncPanesFrom(source: HTMLElement, targetIds: string[]): void {
    if (this.syncingScroll) return;
    this.syncingScroll = true;

    const sourceMax = source.scrollHeight - source.clientHeight;
    const ratio = sourceMax > 0 ? source.scrollTop / sourceMax : 0;

    for (const id of targetIds) {
      const panel = this.shadowRoot?.getElementById(id);
      if (panel && panel !== source) {
        this.syncScrollTo(panel, ratio * (panel.scrollHeight - panel.clientHeight));
      }
    }

    requestAnimationFrame(() => {
      this.syncingScroll = false;
    });
  }

  private handleSourceScroll(e: Event): void {
    this.syncPanesFrom(e.target as HTMLElement, [
      'panel-ours',
      'panel-base',
      'panel-theirs',
      'panel-output',
    ]);
  }

  private handleOutputScroll(e: Event): void {
    this.syncPanesFrom(e.target as HTMLElement, ['panel-ours', 'panel-base', 'panel-theirs']);
  }

  // ── Change statistics ─────────────────────────────────────────────────

  private getChangeCount(side: 'ours' | 'theirs'): number {
    let changes = 0;
    for (const row of this.alignmentRows) {
      const idx = row[side];
      if (row.base === null) {
        if (idx !== null) changes++; // added
      } else if (idx === null) {
        changes++; // removed
      } else {
        const sideLine = side === 'ours' ? this.oursLines[idx] : this.theirsLines[idx];
        if (sideLine !== this.baseLines[row.base]) changes++; // modified
      }
    }
    return changes;
  }

  private getLineCount(content: string): number {
    return content ? content.split('\n').length : 0;
  }

  private formatChangeCount(count: number): string {
    return `${count} change${count === 1 ? '' : 's'} from base`;
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  /** Render one source pane from the shared three-way alignment rows. */
  private renderAlignedPane(side: 'ours' | 'base' | 'theirs'): ReturnType<typeof html> {
    if (this.sideReadErrors[side]) {
      return html`
        <div class="output-error">
          <div>Could not read this version.</div>
        </div>
      `;
    }

    const sideLines =
      side === 'ours' ? this.oursLines : side === 'theirs' ? this.theirsLines : this.baseLines;

    return html`
      <div class="code-view">
        ${this.alignmentRows.map((row) => {
          const idx = row[side];
          if (idx === null) {
            // Filler row keeps the panes vertically aligned. When base has a
            // line here, this side deleted it — show a struck-out filler.
            const removed = side !== 'base' && row.base !== null;
            return html`
              <div class="code-line ${removed ? 'line-removed-filler' : ''}">
                <span class="line-number"></span>
                <span class="line-content"></span>
              </div>
            `;
          }

          const line = sideLines[idx];
          let lineClass = '';
          let wsSegments: ReturnType<typeof computeInlineWhitespaceDiff> | null = null;
          // With an unreadable base there is nothing honest to diff against —
          // don't paint every line as an "addition" relative to a base we
          // never saw.
          if (side !== 'base' && !this.sideReadErrors.base) {
            if (row.base === null) {
              lineClass = 'code-addition';
            } else if (!this.sideReadErrors.base && line !== this.baseLines[row.base]) {
              if (isWhitespaceOnlyChange(this.baseLines[row.base], line)) {
                lineClass = 'code-ws-change';
                wsSegments = computeInlineWhitespaceDiff(this.baseLines[row.base], line);
              } else {
                lineClass = 'line-changed';
              }
            }
          }

          const lineContent = wsSegments
            ? this.renderInlineWhitespaceContent(wsSegments)
            : (this.renderHighlightedContent(line) || html`${' '}`);

          return html`
            <div class="code-line ${lineClass}">
              <span class="line-number">${idx + 1}</span>
              <span class="line-content">${lineContent}</span>
            </div>
          `;
        })}
      </div>
    `;
  }

  private renderSegmentEditor(): ReturnType<typeof html> {
    const rows = Math.min(Math.max(this.editDraft.split('\n').length + 1, 3), 20);
    return html`
      <div class="segment-editor">
        <textarea
          rows=${rows}
          .value=${this.editDraft}
          @input=${this.handleEditDraftInput}
          spellcheck="false"
        ></textarea>
        <div class="segment-editor-actions">
          <button class="btn" @click=${this.cancelEditSegment}>Cancel</button>
          <button class="btn btn-primary" @click=${this.applyEditSegment}>Apply</button>
        </div>
      </div>
    `;
  }

  private renderResolvedSegment(segment: OutputSegment, startLineNum: number): ReturnType<typeof html> {
    if (this.editingSegmentId === segment.id) {
      return this.renderSegmentEditor();
    }

    const originClass = segment.origin ? `resolved-${segment.origin}` : '';
    const explanation = this.aiExplanations.get(segment.id);

    return html`
      <div class="output-segment ${originClass}">
        <div class="segment-actions">
          ${segment.origin && segment.fromConflict
            ? html`<span class="segment-origin-chip">${ORIGIN_LABELS[segment.origin]}</span>`
            : nothing}
          <button
            class="segment-btn"
            @click=${() => this.startEditSegment(segment)}
            title="Edit this section"
          >
            Edit
          </button>
          ${segment.fromConflict
            ? html`
                <button
                  class="segment-btn"
                  @click=${() => this.resetSegment(segment.id)}
                  title="Undo this resolution and reopen the conflict"
                >
                  Reset
                </button>
              `
            : nothing}
        </div>
        ${segment.lines.length === 0
          ? html`
              <div class="code-line">
                <span class="line-number"></span>
                <span class="line-content segment-empty-note">(this resolution removed the section)</span>
              </div>
            `
          : segment.lines.map(
              (line, i) => html`
                <div class="code-line">
                  <span class="line-number">${startLineNum + i}</span>
                  <span class="line-content">${this.renderHighlightedContent(line) || html`${' '}`}</span>
                </div>
              `
            )}
        ${explanation ? html`<div class="ai-explanation">${explanation}</div>` : nothing}
      </div>
    `;
  }

  private renderConflictSegment(segment: OutputSegment): ReturnType<typeof html> {
    if (this.editingSegmentId === segment.id) {
      return this.renderSegmentEditor();
    }

    const labels = SIDE_LABELS[this.operationType] ?? SIDE_LABELS.merge;
    const isSuggesting = this.suggestingSegment === segment.id;
    // Surface the labels git recorded (branch names, commit refs) alongside
    // the generic role — they disambiguate the sides better than roles alone.
    const oursSideLabel = segment.oursLabel && segment.oursLabel !== 'OURS'
      ? `${labels.ours} · ${segment.oursLabel}`
      : labels.ours;
    const theirsSideLabel = segment.theirsLabel && segment.theirsLabel !== 'THEIRS'
      ? `${labels.theirs} · ${segment.theirsLabel}`
      : labels.theirs;

    // A side with a single empty string is one blank line, NOT empty —
    // choosing it inserts a blank line, so it must render as one.
    const renderSide = (lines: string[]) =>
      lines.length === 0
        ? html`<div class="conflict-side-empty">(no lines on this side)</div>`
        : lines.map(
            (line) => html`
              <div class="code-line">
                <span class="line-number"></span>
                <span class="line-content">${this.renderHighlightedContent(line) || html`${' '}`}</span>
              </div>
            `
          );

    return html`
      <div class="code-conflict-block">
        <div class="code-conflict-header">
          <span>Conflict</span>
          <div class="code-conflict-header-actions">
            <button
              class="btn btn-ours conflict-pick-btn"
              @click=${() => this.resolveConflictSegment(segment.id, 'ours')}
            >
              Use Ours
            </button>
            <button
              class="btn btn-theirs conflict-pick-btn"
              @click=${() => this.resolveConflictSegment(segment.id, 'theirs')}
            >
              Use Theirs
            </button>
            <button
              class="btn btn-both conflict-pick-btn"
              @click=${() => this.resolveConflictSegment(segment.id, 'both')}
            >
              Use Both
            </button>
            <button
              class="btn conflict-pick-btn"
              @click=${() => this.startEditSegment(segment)}
              title="Write this section by hand (starts from both sides)"
            >
              Edit
            </button>
            ${this.aiAvailable
              ? html`
                  <button
                    class="btn btn-ai conflict-pick-btn"
                    @click=${() => this.handleSuggestSegment(segment.id)}
                    ?disabled=${this.suggestingSegment !== null || this.suggestingAll}
                  >
                    ${isSuggesting ? 'AI...' : 'AI Suggest'}
                  </button>
                `
              : nothing}
          </div>
        </div>
        <div class="conflict-sides">
          <div class="code-conflict-side-ours">
            <div class="code-conflict-side-label">${oursSideLabel}</div>
            ${renderSide(segment.oursLines)}
          </div>
          <div class="code-conflict-divider"></div>
          <div class="code-conflict-side-theirs">
            <div class="code-conflict-side-label">${theirsSideLabel}</div>
            ${renderSide(segment.theirsLines)}
          </div>
        </div>
      </div>
    `;
  }

  private renderOutput(): ReturnType<typeof html> {
    if (this.loadFailed) {
      // Say what actually failed — blaming the working-directory file when
      // only a side blob was unreadable would be wrong and alarming.
      const sideFailed =
        this.sideReadErrors.base || this.sideReadErrors.ours || this.sideReadErrors.theirs;
      return html`
        <div class="output-error">
          <div>
            ${sideFailed
              ? 'Could not read all of this file’s versions.'
              : 'Could not read the merged file from the working directory.'}
          </div>
          <button class="btn btn-primary" @click=${this.handleReload}>Retry</button>
        </div>
      `;
    }

    let lineNum = 1;
    return html`
      <div class="code-view">
        ${this.segments.map((segment) => {
          if (segment.type === 'resolved') {
            const startLineNum = lineNum;
            lineNum += segment.lines.length;
            return this.renderResolvedSegment(segment, startLineNum);
          }
          return this.renderConflictSegment(segment);
        })}
      </div>
    `;
  }

  private renderBinaryConflict(): ReturnType<typeof html> {
    if (!this.conflictFile) {
      return html`<div class="empty">Select a file to resolve</div>`;
    }

    const oursDeleted = !this.conflictFile.ours;
    const theirsDeleted = !this.conflictFile.theirs;

    return html`
      <div class="toolbar">
        <span class="toolbar-title">${this.conflictFile.path}</span>
      </div>
      <div class="empty" style="flex-direction: column; gap: var(--spacing-md);">
        <div>
          <strong>Binary file conflict</strong>
        </div>
        <div style="font-style: normal; text-align: center; max-width: 420px;">
          This file is binary and cannot be merged as text. Choose which version to keep.
        </div>
        <div class="toolbar-actions">
          <button class="btn btn-ours" @click=${() => this.handleTakeSide('ours')} ?disabled=${this.actionsBlocked}>
            ${oursDeleted ? 'Use Ours (delete file)' : 'Use Ours'}
          </button>
          <button class="btn btn-theirs" @click=${() => this.handleTakeSide('theirs')} ?disabled=${this.actionsBlocked}>
            ${theirsDeleted ? 'Use Theirs (delete file)' : 'Use Theirs'}
          </button>
        </div>
      </div>
    `;
  }

  render() {
    if (!this.conflictFile) {
      return html`<div class="empty">Select a file to resolve</div>`;
    }

    if (this.loading) {
      return html`<div class="loading">Loading file contents...</div>`;
    }

    // Binary conflicts cannot be edited as text — editing would truncate the
    // file to 0 bytes. Offer whole-blob side selection instead.
    if (this.isBinaryConflict) {
      return this.renderBinaryConflict();
    }

    const labels = SIDE_LABELS[this.operationType] ?? SIDE_LABELS.merge;
    const conflictCount = this.conflictCount;

    return html`
      <div class="toolbar">
        <span class="toolbar-title">${this.conflictFile.path}</span>
        <div class="toolbar-actions">
          ${this.hasMergeTool ? html`
            <button
              class="btn"
              @click=${this.handleOpenExternalMergeTool}
              ?disabled=${this.launchingExternalTool || this.externalToolLocked || this.resolving}
              title="Open in external merge tool"
            >
              ${this.launchingExternalTool ? 'Waiting for tool...' : 'External Tool'}
            </button>
          ` : nothing}
          <button
            class="btn"
            @click=${this.handleReload}
            title="Reload the file from disk, discarding resolutions made here"
          >
            Reload
          </button>
          ${this.conflictFile.ancestor
            ? html`<button class="btn" @click=${this.handleAcceptBase} ?disabled=${this.loadFailed} title="Reset to common ancestor">
                Use Base
              </button>`
            : nothing}
          ${this.conflictFile && !this.conflictFile.ours
            ? html`<button class="btn btn-ours" @click=${() => this.handleTakeSide('ours')} ?disabled=${this.actionsBlocked} title="Ours deleted this file — keep it deleted">
                Use Ours (delete file)
              </button>`
            : html`<button class="btn btn-ours" @click=${this.handleAcceptOurs} ?disabled=${this.loadFailed} title="Use entire file from ${labels.ours}">
                Use Ours
              </button>`}
          ${this.conflictFile && !this.conflictFile.theirs
            ? html`<button class="btn btn-theirs" @click=${() => this.handleTakeSide('theirs')} ?disabled=${this.actionsBlocked} title="Theirs deleted this file — delete it">
                Use Theirs (delete file)
              </button>`
            : html`<button class="btn btn-theirs" @click=${this.handleAcceptTheirs} ?disabled=${this.loadFailed} title="Use entire file from ${labels.theirs}">
                Use Theirs
              </button>`}
          ${this.aiAvailable && conflictCount > 0 ? html`
            <button
              class="btn btn-ai"
              @click=${this.handleAiResolveAll}
              ?disabled=${this.suggestingAll || this.suggestingSegment !== null}
              title="Use AI to resolve all remaining conflicts"
            >
              ${this.suggestingAll ? 'AI Resolving...' : 'AI Resolve All'}
            </button>
          ` : nothing}
          <button
            class="btn btn-primary"
            @click=${this.handleMarkResolved}
            ?disabled=${conflictCount > 0 ||
              this.loadFailed ||
              this.editingSegmentId !== null ||
              this.actionsBlocked}
            title=${conflictCount > 0
              ? `Resolve the remaining ${conflictCount} conflict${conflictCount === 1 ? '' : 's'} first`
              : this.editingSegmentId !== null
                ? 'Apply or cancel the open edit first'
                : 'Stage this file as resolved'}
          >
            Mark Resolved
          </button>
        </div>
      </div>

      <div class="editor-container">
        <div class="source-panels">
          <div class="editor-panel">
            <div class="panel-header ours">
              ${labels.ours}
              <span class="panel-stats">
                ${this.sideReadErrors.ours
                  ? 'read failed'
                  : this.sideReadErrors.base
                    ? 'base unavailable'
                    : this.formatChangeCount(this.getChangeCount('ours'))}
              </span>
              <button
                class="panel-header-btn"
                @click=${this.conflictFile.ours ? this.handleAcceptOurs : () => this.handleTakeSide('ours')}
                ?disabled=${this.actionsBlocked || (this.conflictFile.ours ? this.loadFailed : false)}
                title=${this.conflictFile.ours ? 'Use this version' : 'This side deleted the file — stage the deletion'}
              >
                ${this.conflictFile.ours ? 'Use' : 'Use (delete)'}
              </button>
            </div>
            <div class="panel-content readonly" id="panel-ours" @scroll=${this.handleSourceScroll}>
              ${this.renderAlignedPane('ours')}
            </div>
          </div>

          <div class="editor-panel">
            <div class="panel-header base">
              Base (Common Ancestor)
              <span class="panel-stats">
                ${this.sideReadErrors.base ? 'read failed' : `${this.getLineCount(this.baseContent)} lines`}
              </span>
            </div>
            <div class="panel-content readonly" id="panel-base" @scroll=${this.handleSourceScroll}>
              ${this.renderAlignedPane('base')}
            </div>
          </div>

          <div class="editor-panel">
            <div class="panel-header theirs">
              ${labels.theirs}
              <span class="panel-stats">
                ${this.sideReadErrors.theirs
                  ? 'read failed'
                  : this.sideReadErrors.base
                    ? 'base unavailable'
                    : this.formatChangeCount(this.getChangeCount('theirs'))}
              </span>
              <button
                class="panel-header-btn"
                @click=${this.conflictFile.theirs ? this.handleAcceptTheirs : () => this.handleTakeSide('theirs')}
                ?disabled=${this.actionsBlocked || (this.conflictFile.theirs ? this.loadFailed : false)}
                title=${this.conflictFile.theirs ? 'Use this version' : 'This side deleted the file — stage the deletion'}
              >
                ${this.conflictFile.theirs ? 'Use' : 'Use (delete)'}
              </button>
            </div>
            <div class="panel-content readonly" id="panel-theirs" @scroll=${this.handleSourceScroll}>
              ${this.renderAlignedPane('theirs')}
            </div>
          </div>
        </div>

        <div class="output-panel">
          <div class="panel-header output">
            Output
            ${this.loadFailed
              ? html`<span class="conflict-count">load failed</span>`
              : conflictCount > 0
                ? html`<span class="conflict-count">${conflictCount} conflict${conflictCount === 1 ? '' : 's'} remaining</span>`
                : html`<span class="conflict-count">No conflicts</span>`}
          </div>
          <div class="panel-content" id="panel-output" @scroll=${this.handleOutputScroll}>
            ${this.renderOutput()}
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
