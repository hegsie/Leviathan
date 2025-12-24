/**
 * Conflict Resolution Dialog
 * Full-screen dialog for resolving merge/rebase conflicts
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import type { ConflictFile } from '../../types/git.types.ts';
import type { LvMergeEditor } from '../panels/lv-merge-editor.ts';
import '../panels/lv-merge-editor.ts';

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
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) repositoryPath = '';
  @property({ type: String }) operationType: 'merge' | 'rebase' | 'cherry-pick' | 'revert' = 'merge';

  @state() private conflicts: ConflictFile[] = [];
  @state() private resolvedFiles: Set<string> = new Set();
  @state() private selectedIndex = 0;
  @state() private loading = false;

  @query('lv-merge-editor') private mergeEditor?: LvMergeEditor;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    document.addEventListener('keydown', this.handleKeyDown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeyDown);
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

  async show(): Promise<void> {
    this.open = true;
    this.resolvedFiles = new Set();
    this.selectedIndex = 0;
    await this.loadConflicts();
  }

  private close(): void {
    this.open = false;
    this.conflicts = [];
    this.resolvedFiles = new Set();
  }

  private async loadConflicts(): Promise<void> {
    if (!this.repositoryPath) return;

    this.loading = true;
    try {
      const result = await gitService.getConflicts(this.repositoryPath);
      if (result.success && result.data) {
        this.conflicts = result.data;
      } else {
        console.error('Failed to load conflicts:', result.error);
      }
    } catch (err) {
      console.error('Failed to load conflicts:', err);
    } finally {
      this.loading = false;
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

    // Move to next unresolved file
    const nextUnresolved = this.conflicts.findIndex(
      (c, i) => i > this.selectedIndex && !this.resolvedFiles.has(c.path)
    );
    if (nextUnresolved !== -1) {
      this.selectedIndex = nextUnresolved;
    }
  }

  private async handleAbort(): Promise<void> {
    if (!this.repositoryPath) return;

    const confirmAbort = confirm(
      `Are you sure you want to abort the ${this.operationType}? All resolved changes will be lost.`
    );
    if (!confirmAbort) return;

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
      }

      if (result.success) {
        this.dispatchEvent(
          new CustomEvent('operation-aborted', {
            bubbles: true,
            composed: true,
          })
        );
        this.close();
      } else {
        console.error('Failed to abort:', result.error);
      }
    } catch (err) {
      console.error('Failed to abort:', err);
    }
  }

  private async handleContinue(): Promise<void> {
    if (!this.repositoryPath) return;

    // Check all conflicts are resolved
    const unresolvedCount = this.conflicts.filter(
      (c) => !this.resolvedFiles.has(c.path)
    ).length;

    if (unresolvedCount > 0) {
      alert(`Please resolve all ${unresolvedCount} remaining conflict(s) before continuing.`);
      return;
    }

    try {
      let result;
      switch (this.operationType) {
        case 'rebase':
          result = await gitService.continueRebase({ path: this.repositoryPath });
          if (!result.success) {
            console.error('Failed to continue rebase:', result.error);
            // Might have more conflicts
            await this.loadConflicts();
            if (this.conflicts.length > 0) {
              this.resolvedFiles = new Set();
              return;
            }
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
                return;
              }
            }
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
                return;
              }
            }
          }
          break;
        case 'merge':
          // Merge doesn't have a continue - just close after resolving
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
    }
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
              ${this.resolvedCount} of ${this.totalCount} conflicts resolved
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
            <div class="file-list-header">Conflicted Files (${this.totalCount})</div>
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
                      </span>
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
                    @conflict-resolved=${this.handleConflictResolved}
                  ></lv-merge-editor>
                `
              : html`
                  <div class="empty-state">
                    ${this.loading
                      ? 'Loading conflicts...'
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
            <button class="btn btn-danger" @click=${this.handleAbort}>
              Abort ${this.operationType === 'merge' ? 'Merge' : 'Rebase'}
            </button>
            <button
              class="btn btn-primary"
              @click=${this.handleContinue}
              ?disabled=${this.resolvedCount < this.totalCount}
            >
              ${this.operationType === 'merge' ? 'Complete Merge' : 'Continue Rebase'}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-conflict-resolution-dialog': LvConflictResolutionDialog;
  }
}
