/**
 * Conflict Resolution Dialog
 * Full-screen dialog for resolving merge/rebase conflicts
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import { showToast } from '../../services/notification.service.ts';
import type { ConflictFile } from '../../types/git.types.ts';
import type { CommandResult } from '../../types/api.types.ts';
import '../panels/lv-merge-editor.ts';

/**
 * Context threaded through a conflicted git-flow finish so the dialog can COMPLETE
 * the finish after the merge conflict is resolved (tag, merge into develop, delete
 * the branch) instead of leaving it half-done.
 */
export interface GitflowFinishContext {
  kind: 'feature' | 'release' | 'hotfix';
  /** Name/version WITHOUT the branch prefix — what the backend finish expects. */
  name: string;
  /** Full prefixed branch name — used to delete the branch directly (squash case). */
  branchName: string;
  deleteBranch: boolean;
  /** Tag message for release/hotfix finish re-invocation. */
  tagMessage?: string;
  /**
   * True when a commit from THIS finish already landed before the conflict —
   * i.e. a release/hotfix whose master merge + version tag committed and then
   * conflicted on the develop merge. An Abort then only rolls back the develop
   * merge, so the dialog must say the master merge and tag survive.
   */
  priorFinishCommitLanded?: boolean;
}

@customElement('lv-conflict-resolution-dialog')
export class LvConflictResolutionDialog extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: none;
      }

      :host([open]) {
        display: block;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1000;
      }

      .backdrop {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
      }

      .dialog {
        position: absolute;
        top: 20px;
        left: 20px;
        right: 20px;
        bottom: 20px;
        background: var(--color-bg-primary);
        border-radius: var(--radius-lg);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: var(--shadow-xl);
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md) var(--spacing-lg);
        background: var(--color-bg-secondary);
        border-bottom: 1px solid var(--color-border);
      }

      .header-title {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }

      .header-subtitle {
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
        margin-top: var(--spacing-xs);
      }

      .header-actions {
        display: flex;
        gap: var(--spacing-sm);
      }

      .content {
        display: grid;
        grid-template-columns: 280px 1fr;
        flex: 1;
        overflow: hidden;
      }

      .file-list {
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--color-border);
        background: var(--color-bg-secondary);
        overflow-y: auto;
      }

      .file-list-header {
        padding: var(--spacing-sm) var(--spacing-md);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        border-bottom: 1px solid var(--color-border);
      }

      .file-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        cursor: pointer;
        border-bottom: 1px solid var(--color-border-subtle);
        transition: background var(--transition-fast);
      }

      .file-item:hover {
        background: var(--color-bg-hover);
      }

      .file-item.selected {
        background: var(--color-primary-alpha);
      }

      .file-item.resolved {
        opacity: 0.6;
      }

      .file-icon {
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .file-icon.conflict {
        color: var(--color-warning);
      }

      .file-icon.resolved {
        color: var(--color-success);
      }

      .file-name {
        flex: 1;
        font-size: var(--font-size-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Directory hint so same-named files in different folders are distinguishable */
      .file-dir {
        display: block;
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .editor-container {
        flex: 1;
        overflow: hidden;
      }

      lv-merge-editor {
        height: 100%;
      }

      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md) var(--spacing-lg);
        background: var(--color-bg-secondary);
        border-top: 1px solid var(--color-border);
      }

      .footer-info {
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
      }

      .footer-actions {
        display: flex;
        gap: var(--spacing-sm);
      }

      .btn {
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);
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

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-danger {
        background: var(--color-error);
        color: var(--color-text-inverse);
        border-color: var(--color-error);
      }

      .btn-danger:hover {
        background: var(--color-error-hover, #dc2626);
      }

      .btn-primary {
        background: var(--color-primary);
        color: var(--color-text-inverse);
        border-color: var(--color-primary);
      }

      .btn-primary:hover {
        background: var(--color-primary-hover);
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--color-text-muted);
        font-style: italic;
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--color-text-muted);
      }

      .nav-buttons {
        display: flex;
        gap: var(--spacing-xs);
      }

      .nav-btn {
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-secondary);
        cursor: pointer;
        font-size: var(--font-size-xs);
      }

      .nav-btn:hover:not(:disabled) {
        background: var(--color-bg-hover);
      }

      .nav-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .confirm-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10;
      }

      .confirm-dialog {
        background: var(--color-bg-primary);
        border-radius: var(--radius-lg);
        padding: var(--spacing-lg);
        max-width: 400px;
        box-shadow: var(--shadow-xl);
      }

      .confirm-title {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        margin-bottom: var(--spacing-sm);
      }

      .confirm-message {
        color: var(--color-text-secondary);
        margin-bottom: var(--spacing-lg);
      }

      .confirm-actions {
        display: flex;
        gap: var(--spacing-sm);
        justify-content: flex-end;
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) repositoryPath = '';
  @property({ type: String }) operationType: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'stash' = 'merge';
  /** The file the user clicked to get here — preselected over the first conflict. */
  @property({ attribute: false }) initialFilePath: string | null = null;
  /**
   * False when 'stash' was merely INFERRED from a clean repository state
   * (external `git stash apply`/`checkout -m`/`apply -3` — indistinguishable).
   * Messaging must then not promise the changes are safe in a stash entry
   * that may not exist.
   */
  @property({ type: Boolean }) stashSourceCertain = true;
  /** For 'stash' completion: which stash entry to drop once conflicts are resolved. */
  @property({ type: Number }) stashIndex = 0;
  /**
   * For 'stash' completion: whether to drop stash@{stashIndex} on Complete. Pop
   * semantics (auto-stash, explicit pop) drop it; a plain apply keeps it.
   */
  @property({ type: Boolean }) dropStashOnComplete = true;
  /**
   * For 'merge' completion: complete as a squash merge (single-parent commit)
   * rather than a two-parent merge commit. Set when the failed operation that
   * opened this dialog was a squash (e.g. a git-flow squash finish).
   */
  @property({ type: Boolean }) squashMerge = false;
  /**
   * When set, the conflicted merge that opened this dialog was one side of a
   * git-flow finish. After the merge is completed, the finish must be COMPLETED
   * (tag / merge develop / delete branch) rather than left half-done.
   */
  @property({ attribute: false }) gitflowFinish: GitflowFinishContext | null = null;

  @state() private conflicts: ConflictFile[] = [];
  @state() private resolvedFiles: Set<string> = new Set();
  @state() private selectedIndex = 0;
  @state() private loading = false;
  /**
   * Whether the last conflict load FAILED (as opposed to succeeding with zero
   * conflicts). The backend opened this dialog because it reported a conflict, so
   * a failed load means the index IS conflicted but we couldn't read it — we must
   * keep the dialog open with a Retry rather than auto-exiting or falsely treating
   * it as "nothing to resolve".
   */
  @state() private loadFailed = false;
  /**
   * True once commitMerge has succeeded for this dialog session. If the
   * git-flow completion step that follows fails, a retry must skip straight
   * to it — re-running commitMerge would fail with "No merge in progress".
   */
  private mergeCommitted = false;
  /**
   * True when an earlier commit from this git-flow finish (the master-side
   * merge and version tag) already landed — an Abort at the develop stage
   * only rolls back the develop merge and must say so.
   */
  private priorFinishCommitLanded = false;
  @state() private aborting = false;
  @state() private continuing = false;
  /** True while the EMBEDDED merge editor has an external tool session open. */
  @state() private editorToolActive = false;
  @state() private showAbortConfirm = false;
  @state() private hasMergeTool = false;
  @state() private launchingExternalTool: string | null = null;
  @state() private detectedMergeTool: string | null = null;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    document.addEventListener('keydown', this.handleKeyDown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  protected updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);

    // When open changes to true, load conflicts
    if (changedProperties.has('open') && this.open) {
      this.resolvedFiles = new Set();
      this.selectedIndex = 0;
      this.aborting = false;
      this.showAbortConfirm = false;
      this.mergeCommitted = false;
      // Seed from the finish context: a first-run release/hotfix whose master
      // merge + tag already landed before the develop conflict opens here with
      // this set, so Abort is honest about what survives even on this path
      // (not just the dialog-internal re-run).
      this.priorFinishCommitLanded = this.gitflowFinish?.priorFinishCommitLanded ?? false;
      this.loadConflicts();
    }
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.open) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      // Don't close on escape - require explicit abort/continue
    } else if (e.key === 'ArrowUp' && e.altKey) {
      e.preventDefault();
      this.handlePrevious();
    } else if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault();
      this.handleNext();
    }
  };

  private close(): void {
    this.open = false;
    this.conflicts = [];
    this.resolvedFiles = new Set();
    this.aborting = false;
    this.showAbortConfirm = false;
    this.mergeCommitted = false;
    this.priorFinishCommitLanded = false;
  }

  /** Re-run the conflict load after a failure, resetting resolution progress. */
  private handleRetryLoad = (): void => {
    this.resolvedFiles = new Set();
    this.selectedIndex = 0;
    void this.loadConflicts();
  };

  private async loadConflicts(): Promise<void> {
    if (!this.repositoryPath) return;

    this.loading = true;
    try {
      const result = await gitService.getConflicts(this.repositoryPath);
      if (result.success && result.data) {
        this.conflicts = result.data;
        this.loadFailed = false;
        // Open on the file the user clicked, when it's one of the conflicts.
        // (Continue-with-new-conflicts paths reset the index to 0 afterwards.)
        if (this.initialFilePath) {
          const initialIndex = this.conflicts.findIndex((c) => c.path === this.initialFilePath);
          if (initialIndex >= 0) {
            this.selectedIndex = initialIndex;
          }
        }
      } else {
        console.error('Failed to load conflicts:', result.error);
        showToast('Failed to load conflicts', 'error');
        this.conflicts = [];
        this.loadFailed = true;
      }
    } catch (err) {
      console.error('Failed to load conflicts:', err);
      showToast('Failed to load conflicts', 'error');
      this.conflicts = [];
      this.loadFailed = true;
    } finally {
      this.loading = false;
    }

    await this.checkMergeToolAvailability();

    // A 'stash' dialog that SUCCESSFULLY loaded with zero conflicts is an
    // inescapable trap: Complete is disabled and Escape is suppressed, leaving
    // only the destructive Abort. The stash was never applied, so auto-run the
    // safe non-destructive exit (keeps the stash, discards nothing).
    // A FAILED load must NOT trigger this: the backend reported a conflict, so the
    // index IS conflicted — we just couldn't read it. Keep the dialog open with a
    // Retry instead of abandoning the user.
    if (
      this.open &&
      this.operationType === 'stash' &&
      !this.loadFailed &&
      this.conflicts.length === 0
    ) {
      this.handleStashNotApplied();
    }
  }

  private async checkMergeToolAvailability(): Promise<void> {
    if (!this.repositoryPath) return;
    try {
      const result = await gitService.getMergeToolConfig(this.repositoryPath);
      this.hasMergeTool = result.success && !!result.data?.toolName;

      // If no tool configured, try auto-detecting one to show a hint
      if (!this.hasMergeTool) {
        const detectResult = await gitService.autoDetectMergeTool();
        this.detectedMergeTool = detectResult.success && detectResult.data
          ? detectResult.data.displayName
          : null;
      } else {
        this.detectedMergeTool = null;
      }
    } catch {
      this.hasMergeTool = false;
      this.detectedMergeTool = null;
    }
  }

  private async handleOpenExternalTool(conflictPath: string): Promise<void> {
    if (!this.repositoryPath) return;

    this.launchingExternalTool = conflictPath;
    try {
      const result = await gitService.launchMergeTool(this.repositoryPath, conflictPath);
      if (result.success && result.data?.success) {
        // The tool's exit code alone isn't authoritative — re-check the index to
        // confirm the file is no longer conflicted before marking it resolved.
        const conflictsResult = await gitService.getConflicts(this.repositoryPath);
        const stillConflicted =
          conflictsResult.success &&
          (conflictsResult.data ?? []).some((c) => c.path === conflictPath);
        if (stillConflicted) {
          showToast('File still has conflicts', 'warning');
        } else {
          this.resolvedFiles = new Set([...this.resolvedFiles, conflictPath]);
          this.requestUpdate();
          showToast('Merge tool completed', 'success');
        }
      } else {
        showToast(result.data?.message ?? result.error?.message ?? 'Merge tool failed', 'error');
      }
    } catch {
      showToast('Failed to launch merge tool', 'error');
    } finally {
      this.launchingExternalTool = null;
    }
  }

  private handleFileSelect(index: number): void {
    this.selectedIndex = index;
  }

  private handlePrevious(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
    }
  }

  private handleNext(): void {
    if (this.selectedIndex < this.conflicts.length - 1) {
      this.selectedIndex++;
    }
  }

  private handleConflictResolved(e: CustomEvent): void {
    const { file } = e.detail as { file: ConflictFile };
    this.resolvedFiles = new Set([...this.resolvedFiles, file.path]);
    this.requestUpdate();

    // Move to the next unresolved file, wrapping around so files skipped
    // earlier in the list are still reachable.
    const total = this.conflicts.length;
    for (let offset = 1; offset < total; offset++) {
      const i = (this.selectedIndex + offset) % total;
      if (!this.resolvedFiles.has(this.conflicts[i].path)) {
        this.selectedIndex = i;
        return;
      }
    }
  }

  private handleAbort(): void {
    // Mutually exclusive with Complete and the external merge tool: aborting
    // while a stash-drop Complete is in flight would revert the files AND
    // lose the stash entry; aborting under an open external tool would let
    // its later save re-dirty the just-aborted working tree.
    if (
      this.aborting ||
      this.continuing ||
      this.launchingExternalTool !== null ||
      this.editorToolActive
    ) {
      return;
    }
    // Once the merge commit has landed (only the follow-up git-flow finish
    // step failed), there is nothing to abort — exit directly WITHOUT the
    // "all resolved changes will be lost" confirm, which would be false here
    // (nothing is lost, nothing is rolled back). This is the user's safe exit
    // from a persistently-failing finish, not a destructive action.
    if (this.operationType === 'merge' && this.mergeCommitted) {
      this.exitAfterCommittedMerge();
      return;
    }
    this.showAbortConfirm = true;
  }

  /**
   * Leave the dialog when the merge is already committed and only the git-flow
   * finish step remains (and keeps failing). Nothing is rolled back.
   */
  private exitAfterCommittedMerge(): void {
    // A squash finish must NOT be re-run from the panel (its merge is not
    // idempotent once the squash commit landed) — only the branch deletion
    // remains; other finishes are idempotently re-runnable.
    showToast(
      this.gitflowFinish && this.squashMerge
        ? 'The squash commit is already on develop and cannot be rolled back — delete the feature branch from the branch list to finish'
        : 'The merge is already committed and cannot be rolled back — retry the finish from the Git Flow panel',
      'warning'
    );
    this.dispatchEvent(
      new CustomEvent('operation-aborted', { bubbles: true, composed: true })
    );
    this.close();
  }

  private handleAbortCancel(): void {
    this.showAbortConfirm = false;
  }

  private async handleAbortConfirm(): Promise<void> {
    if (
      !this.repositoryPath ||
      this.aborting ||
      this.continuing ||
      this.launchingExternalTool !== null ||
      this.editorToolActive
    ) {
      return;
    }

    // Safety net: if the merge was committed after the confirm opened, exit
    // without a no-op abort_merge. handleAbort normally routes here before the
    // confirm ever renders.
    if (this.operationType === 'merge' && this.mergeCommitted) {
      this.showAbortConfirm = false;
      this.exitAfterCommittedMerge();
      return;
    }

    this.aborting = true;
    this.showAbortConfirm = false;

    try {
      let result;
      switch (this.operationType) {
        case 'merge':
          result = await gitService.abortMerge({ path: this.repositoryPath });
          break;
        case 'rebase':
          result = await gitService.abortRebase({ path: this.repositoryPath });
          break;
        case 'cherry-pick':
          result = await gitService.abortCherryPick({ path: this.repositoryPath });
          break;
        case 'revert':
          result = await gitService.abortRevert({ path: this.repositoryPath });
          break;
        case 'stash': {
          // There's no backend "abort stash apply". A hard reset to HEAD would
          // destroy UNRELATED uncommitted changes when the stash was applied/popped
          // onto a dirty tree. Instead restore ONLY the conflicted files: unstage
          // them (clears the conflict index entries, resetting to HEAD) then discard
          // their working-tree changes (restores HEAD content). The stash entry is
          // never touched, so the stashed changes remain recoverable.
          // When the conflict LOAD failed, the local list is empty but the index
          // is genuinely conflicted — re-fetch so Abort restores the real paths
          // instead of no-opping with a false success message.
          let restoredCount = 0;
          let conflictPaths = this.conflicts.map((c) => c.path);
          if (this.loadFailed) {
            const refetch = await gitService.getConflicts(this.repositoryPath);
            if (!refetch.success || !refetch.data) {
              showToast(
                refetch.error?.message ?? 'Could not read conflicts — nothing was restored',
                'error',
              );
              this.aborting = false;
              return;
            }
            conflictPaths = refetch.data.map((c) => c.path);
          }
          if (conflictPaths.length === 0) {
            result = { success: true } as CommandResult<void>;
          } else {
            const unstageResult = await gitService.unstageFiles(this.repositoryPath, {
              paths: conflictPaths,
            });
            result = unstageResult.success
              ? await gitService.discardChanges(this.repositoryPath, conflictPaths)
              : unstageResult;
            if (result.success) restoredCount = conflictPaths.length;
          }
          if (result.success) {
            showToast(
              restoredCount === 0
                ? 'Nothing needed restoring'
                : this.stashSourceCertain
                  ? 'Conflicted files restored — your changes remain in the stash'
                  : 'Conflicted files restored to their committed (HEAD) state',
              'info',
            );
          }
          break;
        }
      }

      if (result.success) {
        if (this.operationType === 'merge' && this.priorFinishCommitLanded) {
          // Only the in-progress develop merge was rolled back — the master
          // merge and version tag from this finish are already committed.
          showToast(
            'The develop merge was aborted, but the master merge and version tag from this finish are already committed',
            'warning',
          );
        }
        this.dispatchEvent(
          new CustomEvent('operation-aborted', {
            bubbles: true,
            composed: true,
          })
        );
        this.close();
      } else {
        console.error('Failed to abort:', result.error);
        showToast(result.error?.message ?? `Failed to abort ${this.getOperationTitle()}`, 'error');
        this.aborting = false; // Allow retry
      }
    } catch (err) {
      console.error('Failed to abort:', err);
      showToast(`Failed to abort ${this.getOperationTitle()}`, 'error');
      this.aborting = false; // Allow retry
    }
  }

  /**
   * Close a stash dialog that has nothing to resolve WITHOUT dropping or
   * resetting anything. The backend reported a conflict but nothing was applied,
   * so the changes remain safe in the stash. Used both when the user clicks
   * Complete and automatically when the dialog loads with zero conflicts (which
   * would otherwise be an inescapable trap — Complete disabled, Escape suppressed).
   */
  private handleStashNotApplied(): void {
    showToast(
      this.stashSourceCertain
        ? 'The stash was not applied — your changes are still in the stash'
        : 'No conflicted files remain — nothing to resolve',
      this.stashSourceCertain ? 'warning' : 'info',
    );
    this.dispatchEvent(
      new CustomEvent('operation-aborted', {
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }

  private async handleContinue(): Promise<void> {
    // Re-entry guard: a double-click during the awaited backend call must not
    // run the flow twice — a duplicate dropStash would delete an UNRELATED
    // stash entry after the indices shift. Also mutually exclusive with Abort.
    if (
      !this.repositoryPath ||
      this.continuing ||
      this.aborting ||
      this.launchingExternalTool !== null ||
      this.editorToolActive
    ) {
      return;
    }
    this.continuing = true;
    try {
      await this.runContinue();
    } finally {
      this.continuing = false;
    }
  }

  private async runContinue(): Promise<void> {

    // A failed load leaves us with no conflict data even though the index IS
    // conflicted. Never proceed (or drop the stash) in that state — keep the
    // dialog open so the user can Retry.
    if (this.loadFailed) {
      showToast('Could not load conflicts. Please retry.', 'error');
      return;
    }

    // A 'stash' operation with NO conflicts (that LOADED successfully) means the
    // backend reported a conflict but nothing was actually applied — the changes
    // are still safe in the stash. Dropping it here would permanently destroy
    // never-applied changes, so refuse to drop and close without touching the stash.
    if (this.operationType === 'stash' && this.conflicts.length === 0) {
      this.handleStashNotApplied();
      return;
    }

    // Check all conflicts are resolved
    const unresolvedCount = this.conflicts.filter(
      (c) => !this.resolvedFiles.has(c.path)
    ).length;

    if (unresolvedCount > 0) {
      showToast(
        `Please resolve all ${unresolvedCount} remaining conflict(s) before continuing.`,
        'warning'
      );
      return;
    }

    try {
      let result;
      switch (this.operationType) {
        case 'rebase':
          result = await gitService.continueRebase({ path: this.repositoryPath });
          if (!result.success) {
            console.error('Failed to continue rebase:', result.error);
            // Might have more conflicts — reload and stay open if any appeared.
            await this.loadConflicts();
            if (this.conflicts.length > 0) {
              this.resolvedFiles = new Set();
              this.selectedIndex = 0;
              return;
            }
            // No new conflicts, but the operation genuinely failed — surface the
            // error and keep the dialog open instead of falsely reporting success.
            showToast(result.error?.message ?? 'Failed to continue rebase', 'error');
            return;
          }
          break;
        case 'cherry-pick':
          result = await gitService.continueCherryPick({ path: this.repositoryPath });
          if (!result.success) {
            console.error('Failed to continue cherry-pick:', result.error);
            if (result.error?.code === 'CHERRY_PICK_CONFLICT') {
              await this.loadConflicts();
              if (this.conflicts.length > 0) {
                this.resolvedFiles = new Set();
                this.selectedIndex = 0;
                return;
              }
            }
            showToast(result.error?.message ?? 'Failed to continue cherry-pick', 'error');
            return;
          }
          break;
        case 'revert':
          result = await gitService.continueRevert({ path: this.repositoryPath });
          if (!result.success) {
            console.error('Failed to continue revert:', result.error);
            if (result.error?.code === 'REVERT_CONFLICT') {
              await this.loadConflicts();
              if (this.conflicts.length > 0) {
                this.resolvedFiles = new Set();
                this.selectedIndex = 0;
                return;
              }
            }
            showToast(result.error?.message ?? 'Failed to continue revert', 'error');
            return;
          }
          break;
        case 'merge':
          // Commit the in-progress merge. When the failed operation was a squash
          // (e.g. a git-flow squash finish), complete it as a single-parent squash
          // commit rather than a two-parent merge commit. If a previous Continue
          // already committed the merge but the git-flow completion step failed,
          // skip straight to that step — re-running commitMerge would fail with
          // "No merge in progress" and make retry impossible.
          if (!this.mergeCommitted) {
            result = await gitService.commitMerge(this.repositoryPath, undefined, this.squashMerge);
            if (!result.success) {
              console.error('Failed to complete merge:', result.error);
              if (result.error?.code === 'MERGE_CONFLICT') {
                await this.loadConflicts();
                if (this.conflicts.length > 0) {
                  this.resolvedFiles = new Set();
                  this.selectedIndex = 0;
                  return;
                }
              }
              showToast(result.error?.message ?? 'Failed to complete merge', 'error');
              return;
            }
            this.mergeCommitted = true;
          }
          // If this merge was one side of a git-flow finish, the finish is only
          // PARTIALLY done (no tag, develop not merged, branch not deleted).
          // Complete it now; if it can't finish (routed back into the conflict
          // flow, or errored) stay open — the retry skips the committed merge.
          if (this.gitflowFinish && !(await this.completeGitflowFinish(this.gitflowFinish))) {
            return;
          }
          break;
        case 'stash':
          // All conflicts resolved. Drop the stash only for pop semantics
          // (dropAfter/pop/auto-stash) — a plain apply must keep the stash entry.
          if (this.dropStashOnComplete) {
            result = await gitService.dropStash({ path: this.repositoryPath, index: this.stashIndex });
            if (!result.success) {
              console.error('Failed to drop stash:', result.error);
              showToast(result.error?.message ?? 'Failed to drop stash', 'error');
              return;
            }
          }
          break;
      }

      this.dispatchEvent(
        new CustomEvent('operation-completed', {
          bubbles: true,
          composed: true,
        })
      );
      this.close();
    } catch (err) {
      console.error('Failed to continue:', err);
      showToast('Failed to continue', 'error');
    }
  }

  /**
   * Complete a git-flow finish whose merge just conflicted and was resolved.
   * Returns true when the finish is fully done (caller may close), false when the
   * dialog must stay open (a further conflict was routed back in, or an error was
   * surfaced via toast).
   */
  private async completeGitflowFinish(ctx: GitflowFinishContext): Promise<boolean> {
    // Squash feature: commitMerge already made the single-parent squash commit on
    // develop. The backend finish is NOT idempotent for squash — a squash commit
    // never makes the feature an ancestor of develop, so re-invoking it would
    // re-merge the same divergence forever. Just delete the feature branch here.
    if (ctx.kind === 'feature' && this.squashMerge) {
      if (ctx.deleteBranch) {
        const del = await gitService.deleteBranch(this.repositoryPath, ctx.branchName, true);
        if (!del.success) {
          showToast(del.error?.message ?? 'Failed to delete feature branch', 'error');
          return false;
        }
      }
      return true;
    }

    // Feature (non-squash), release, hotfix: the resolved merge is committed, so
    // re-invoking the (now idempotent) backend finish skips the up-to-date
    // master/develop merges, creates the version tag (release/hotfix), and deletes
    // the branch.
    let result: CommandResult<void>;
    switch (ctx.kind) {
      case 'feature':
        result = await gitService.gitFlowFinishFeature(
          this.repositoryPath,
          ctx.name,
          ctx.deleteBranch,
          false,
        );
        break;
      case 'release':
        result = await gitService.gitFlowFinishRelease(
          this.repositoryPath,
          ctx.name,
          ctx.tagMessage,
          ctx.deleteBranch,
        );
        break;
      case 'hotfix':
        result = await gitService.gitFlowFinishHotfix(
          this.repositoryPath,
          ctx.name,
          ctx.tagMessage,
          ctx.deleteBranch,
        );
        break;
    }

    if (!result.success) {
      // A develop-side conflict on the re-run (e.g. release/hotfix master side was
      // just resolved) reopens the conflict flow for the develop side. The next
      // Complete must commit THIS new merge before re-invoking finish, so the
      // committed-merge marker is reset — otherwise commitMerge would be skipped
      // and the finish re-run would hit the still-in-progress develop merge.
      if (result.error?.code === 'MERGE_CONFLICT') {
        // A MERGE_CONFLICT from the finish re-run always means a NEW merge is
        // in progress — reset the committed marker BEFORE loading conflicts,
        // so even a failed load (Retry path) leads Complete to commit this
        // merge instead of skipping it and stranding the finish. Remember
        // that a prior commit from this finish (master merge + tag) already
        // landed, so a later Abort can be honest about what survives.
        this.mergeCommitted = false;
        this.priorFinishCommitLanded = true;
        await this.loadConflicts();
        if (this.conflicts.length > 0) {
          this.resolvedFiles = new Set();
          this.selectedIndex = 0;
          return false;
        }
        if (this.loadFailed) {
          // Index is conflicted but unreadable — stay open with the Retry
          // affordance rather than falling through to a misleading toast.
          return false;
        }
      }
      showToast(result.error?.message ?? 'Failed to complete Git Flow finish', 'error');
      return false;
    }
    return true;
  }

  private get selectedConflict(): ConflictFile | null {
    return this.conflicts[this.selectedIndex] ?? null;
  }

  private get resolvedCount(): number {
    return this.resolvedFiles.size;
  }

  private get totalCount(): number {
    return this.conflicts.length;
  }

  private getOperationTitle(): string {
    switch (this.operationType) {
      case 'merge':
        return 'Merge';
      case 'rebase':
        return 'Rebase';
      case 'cherry-pick':
        return 'Cherry-pick';
      case 'revert':
        return 'Revert';
      case 'stash':
        return 'Stash';
      default:
        return 'Merge';
    }
  }

  render() {
    if (!this.open) return nothing;

    return html`
      <div class="backdrop"></div>
      <div class="dialog">
        <div class="header">
          <div>
            <div class="header-title">
              Resolve ${this.getOperationTitle()} Conflicts
            </div>
            <div class="header-subtitle">
              ${this.resolvedCount} of ${this.totalCount} file${this.totalCount === 1 ? '' : 's'} resolved
            </div>
          </div>
          <div class="header-actions">
            <div class="nav-buttons">
              <button
                class="nav-btn"
                @click=${this.handlePrevious}
                ?disabled=${this.selectedIndex === 0}
                title="Previous file (Alt+Up)"
              >
                ← Prev
              </button>
              <button
                class="nav-btn"
                @click=${this.handleNext}
                ?disabled=${this.selectedIndex >= this.conflicts.length - 1}
                title="Next file (Alt+Down)"
              >
                Next →
              </button>
            </div>
          </div>
        </div>

        <div class="content">
          <div class="file-list">
            <div class="file-list-header">
              Conflicted Files (${this.totalCount})
              ${this.detectedMergeTool ? html`
                <div style="font-size: 10px; text-transform: none; letter-spacing: normal; font-weight: normal; margin-top: 4px; color: var(--color-text-muted);">
                  ${this.detectedMergeTool} detected. Configure in Settings for external editing.
                </div>
              ` : nothing}
            </div>
            ${this.loading
              ? html`<div class="loading">Loading...</div>`
              : this.conflicts.map(
                  (conflict, index) => html`
                    <div
                      class="file-item ${index === this.selectedIndex ? 'selected' : ''} ${this.resolvedFiles.has(conflict.path) ? 'resolved' : ''}"
                      @click=${() => this.handleFileSelect(index)}
                    >
                      <span
                        class="file-icon ${this.resolvedFiles.has(conflict.path) ? 'resolved' : 'conflict'}"
                      >
                        ${this.resolvedFiles.has(conflict.path) ? '✓' : '⚠'}
                      </span>
                      <span class="file-name" title=${conflict.path}>
                        ${conflict.path.split('/').pop()}
                        ${conflict.path.includes('/')
                          ? html`<span class="file-dir">${conflict.path.slice(0, conflict.path.lastIndexOf('/'))}</span>`
                          : nothing}
                      </span>
                      ${this.hasMergeTool && !this.resolvedFiles.has(conflict.path) ? html`
                        <button
                          class="btn btn-sm"
                          style="margin-left: auto; padding: 2px 6px; font-size: 11px;"
                          @click=${(e: Event) => { e.stopPropagation(); this.handleOpenExternalTool(conflict.path); }}
                          ?disabled=${this.launchingExternalTool !== null || this.aborting || this.continuing}
                          title="Open in external merge tool"
                        >
                          ${this.launchingExternalTool === conflict.path ? '...' : 'External'}
                        </button>
                      ` : nothing}
                    </div>
                  `
                )}
          </div>

          <div class="editor-container">
            ${this.selectedConflict
              ? html`
                  <lv-merge-editor
                    .repositoryPath=${this.repositoryPath}
                    .conflictFile=${this.selectedConflict}
                    .operationType=${this.operationType}
                    .externalToolLocked=${this.continuing || this.aborting}
                    @conflict-resolved=${this.handleConflictResolved}
                    @external-tool-started=${() => { this.editorToolActive = true; }}
                    @external-tool-finished=${() => { this.editorToolActive = false; }}
                  ></lv-merge-editor>
                `
              : html`
                  <div class="empty-state">
                    ${this.loading
                      ? 'Loading conflicts...'
                      : this.loadFailed
                        ? html`
                            <div>Failed to load conflicts.</div>
                            <button
                              class="btn btn-primary"
                              style="margin-top: var(--spacing-md);"
                              @click=${this.handleRetryLoad}
                            >
                              Retry
                            </button>
                          `
                        : this.conflicts.length === 0
                          ? 'No conflicts to resolve'
                          : 'Select a file to resolve'}
                  </div>
                `}
          </div>
        </div>

        <div class="footer">
          <div class="footer-info">
            ${this.selectedConflict
              ? html`<strong>${this.selectedConflict.path}</strong>`
              : 'No file selected'}
          </div>
          <div class="footer-actions">
            <button
              class="btn btn-danger"
              @click=${this.handleAbort}
              ?disabled=${this.continuing ||
                this.aborting ||
                this.launchingExternalTool !== null ||
                this.editorToolActive}
            >
              Abort ${this.getOperationTitle()}
            </button>
            <button
              class="btn btn-primary"
              @click=${this.handleContinue}
              ?disabled=${this.continuing ||
                this.aborting ||
                this.launchingExternalTool !== null ||
                this.editorToolActive ||
                this.loadFailed ||
                this.resolvedCount < this.totalCount ||
                (this.operationType === 'stash' && this.conflicts.length === 0)}
            >
              ${this.operationType === 'merge'
                ? 'Complete Merge'
                : this.operationType === 'stash'
                  ? 'Complete'
                  : `Continue ${this.getOperationTitle()}`}
            </button>
          </div>
        </div>

        ${this.showAbortConfirm
          ? html`
              <div class="confirm-overlay">
                <div class="confirm-dialog">
                  <div class="confirm-title">Abort ${this.getOperationTitle()}?</div>
                  <div class="confirm-message">
                    ${this.operationType === 'stash'
                      ? this.stashSourceCertain
                        ? 'The conflicted files will be reverted to their committed (HEAD) state, discarding the applied stash changes in those files. Any unrelated uncommitted changes are kept, and the stash entry itself remains in the stash list.'
                        : 'The conflicted files will be reverted to their committed (HEAD) state, discarding those changes. If they did not come from a stash apply, they are not saved anywhere else — this cannot be undone.'
                      : 'All resolved changes will be lost. This cannot be undone.'}
                  </div>
                  <div class="confirm-actions">
                    <button class="btn" @click=${this.handleAbortCancel}>Cancel</button>
                    <button class="btn btn-danger" @click=${this.handleAbortConfirm}>
                      Abort
                    </button>
                  </div>
                </div>
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-conflict-resolution-dialog': LvConflictResolutionDialog;
  }
}
