/**
 * Interactive Rebase Dialog Component
 * Allows users to reorder, squash, edit, and drop commits
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, property, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import './lv-modal.ts';
import type { LvModal } from './lv-modal.ts';
import type { RebaseCommit, RebaseAction } from '../../types/git.types.ts';

interface EditableRebaseCommit extends RebaseCommit {
  action: RebaseAction;
}

@customElement('lv-interactive-rebase-dialog')
export class LvInteractiveRebaseDialog extends LitElement {
  static styles = [
    sharedStyles,
    css`
      .form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        min-width: 600px;
        max-width: 800px;
      }

      .header-info {
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
      }

      .header-info strong {
        color: var(--color-primary);
      }

      .commits-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        max-height: 400px;
        overflow-y: auto;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--spacing-sm);
      }

      .commit-row {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm);
        background: var(--color-bg-secondary);
        border-radius: var(--radius-sm);
        cursor: grab;
      }

      .commit-row:hover {
        background: var(--color-bg-hover);
      }

      .commit-row.dragging {
        opacity: 0.5;
      }

      .commit-row.drop-target {
        border-top: 2px solid var(--color-primary);
      }

      .drag-handle {
        color: var(--color-text-muted);
        cursor: grab;
      }

      .drag-handle svg {
        width: 16px;
        height: 16px;
      }

      .action-select {
        padding: var(--spacing-xs) var(--spacing-sm);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: var(--color-bg-primary);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        min-width: 90px;
      }

      .action-select:focus {
        outline: none;
        border-color: var(--color-primary);
      }

      .action-select option {
        background: var(--color-bg-primary);
      }

      .commit-info {
        flex: 1;
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        min-width: 0;
      }

      .commit-hash {
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        color: var(--color-primary);
        background: var(--color-bg-tertiary);
        padding: 2px 6px;
        border-radius: var(--radius-sm);
        flex-shrink: 0;
      }

      .commit-message {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: var(--font-size-sm);
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-lg);
        color: var(--color-text-muted);
      }

      .empty {
        padding: var(--spacing-lg);
        text-align: center;
        color: var(--color-text-muted);
      }

      .error-message {
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-error-bg);
        border: 1px solid var(--color-error);
        border-radius: var(--radius-md);
        color: var(--color-error);
        font-size: var(--font-size-sm);
      }

      .help-text {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        line-height: 1.5;
      }

      .help-text ul {
        margin: var(--spacing-xs) 0 0 var(--spacing-md);
        padding: 0;
      }

      .btn {
        padding: var(--spacing-sm) var(--spacing-lg);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .btn-primary {
        background: var(--color-primary);
        color: var(--color-text-inverse);
        border: none;
      }

      .btn-primary:hover:not(:disabled) {
        background: var(--color-primary-hover);
      }

      .btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-secondary {
        background: transparent;
        color: var(--color-text-secondary);
        border: 1px solid var(--color-border);
      }

      .btn-secondary:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }
    `,
  ];

  @property({ type: String }) repositoryPath = '';

  @state() private onto = '';
  @state() private commits: EditableRebaseCommit[] = [];
  @state() private loading = false;
  @state() private executing = false;
  @state() private error = '';
  @state() private draggedIndex: number | null = null;
  @state() private dropTargetIndex: number | null = null;

  @query('lv-modal') private modal!: LvModal;

  public async open(onto: string): Promise<void> {
    this.reset();
    this.onto = onto;
    this.modal.open = true;
    await this.loadCommits();
  }

  public close(): void {
    this.modal.open = false;
  }

  private reset(): void {
    this.onto = '';
    this.commits = [];
    this.loading = false;
    this.executing = false;
    this.error = '';
    this.draggedIndex = null;
    this.dropTargetIndex = null;
  }

  private async loadCommits(): Promise<void> {
    if (!this.repositoryPath || !this.onto) return;

    this.loading = true;
    this.error = '';

    try {
      const result = await gitService.getRebaseCommits(this.repositoryPath, this.onto);

      if (result.success) {
        this.commits = (result.data || []).map(c => ({
          ...c,
          action: 'pick' as RebaseAction,
        }));
      } else {
        this.error = result.error?.message ?? 'Failed to load commits';
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unknown error occurred';
    } finally {
      this.loading = false;
    }
  }

  private handleActionChange(index: number, e: Event): void {
    const select = e.target as HTMLSelectElement;
    this.commits = this.commits.map((c, i) =>
      i === index ? { ...c, action: select.value as RebaseAction } : c
    );
  }

  private handleDragStart(index: number, e: DragEvent): void {
    this.draggedIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
  }

  private handleDragOver(index: number, e: DragEvent): void {
    e.preventDefault();
    if (this.draggedIndex !== null && this.draggedIndex !== index) {
      this.dropTargetIndex = index;
    }
  }

  private handleDragLeave(): void {
    this.dropTargetIndex = null;
  }

  private handleDrop(index: number, e: DragEvent): void {
    e.preventDefault();
    if (this.draggedIndex !== null && this.draggedIndex !== index) {
      const newCommits = [...this.commits];
      const [removed] = newCommits.splice(this.draggedIndex, 1);
      newCommits.splice(index, 0, removed);
      this.commits = newCommits;
    }
    this.draggedIndex = null;
    this.dropTargetIndex = null;
  }

  private handleDragEnd(): void {
    this.draggedIndex = null;
    this.dropTargetIndex = null;
  }

  private async handleExecute(): Promise<void> {
    if (this.executing || this.commits.length === 0) return;

    this.executing = true;
    this.error = '';

    try {
      // Generate the todo file content
      const todo = this.commits
        .map(c => `${c.action} ${c.shortId} ${c.summary}`)
        .join('\n');

      const result = await gitService.executeInteractiveRebase(
        this.repositoryPath,
        this.onto,
        todo
      );

      if (result.success) {
        this.dispatchEvent(new CustomEvent('rebase-complete', {
          bubbles: true,
          composed: true,
        }));
        this.close();
      } else {
        if (result.error?.code === 'REBASE_CONFLICT') {
          this.error = 'Rebase encountered conflicts. Please resolve them and continue.';
        } else {
          this.error = result.error?.message ?? 'Failed to execute rebase';
        }
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unknown error occurred';
    } finally {
      this.executing = false;
    }
  }

  private handleModalClose(): void {
    if (!this.executing) {
      this.reset();
    }
  }

  private get canExecute(): boolean {
    return this.commits.length > 0 && !this.executing;
  }

  private renderCommitRow(commit: EditableRebaseCommit, index: number) {
    const isDragging = this.draggedIndex === index;
    const isDropTarget = this.dropTargetIndex === index;

    return html`
      <div
        class="commit-row ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}"
        draggable="true"
        @dragstart=${(e: DragEvent) => this.handleDragStart(index, e)}
        @dragover=${(e: DragEvent) => this.handleDragOver(index, e)}
        @dragleave=${this.handleDragLeave}
        @drop=${(e: DragEvent) => this.handleDrop(index, e)}
        @dragend=${this.handleDragEnd}
      >
        <div class="drag-handle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="8" y1="6" x2="16" y2="6"></line>
            <line x1="8" y1="12" x2="16" y2="12"></line>
            <line x1="8" y1="18" x2="16" y2="18"></line>
          </svg>
        </div>

        <select
          class="action-select"
          .value=${commit.action}
          @change=${(e: Event) => this.handleActionChange(index, e)}
          ?disabled=${this.executing}
        >
          <option value="pick">pick</option>
          <option value="reword">reword</option>
          <option value="edit">edit</option>
          <option value="squash">squash</option>
          <option value="fixup">fixup</option>
          <option value="drop">drop</option>
        </select>

        <div class="commit-info">
          <span class="commit-hash">${commit.shortId}</span>
          <span class="commit-message" title="${commit.summary}">${commit.summary}</span>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <lv-modal
        modalTitle="Interactive Rebase"
        @close=${this.handleModalClose}
      >
        <div class="form">
          <div class="header-info">
            Rebasing current branch onto <strong>${this.onto}</strong>
          </div>

          ${this.loading ? html`
            <div class="loading">Loading commits...</div>
          ` : this.commits.length === 0 ? html`
            <div class="empty">No commits to rebase</div>
          ` : html`
            <div class="commits-list">
              ${this.commits.map((commit, index) => this.renderCommitRow(commit, index))}
            </div>
          `}

          <div class="help-text">
            <ul>
              <li><strong>pick</strong> - use commit as-is</li>
              <li><strong>reword</strong> - use commit, but edit message</li>
              <li><strong>squash</strong> - meld into previous commit</li>
              <li><strong>fixup</strong> - like squash, but discard message</li>
              <li><strong>drop</strong> - remove commit</li>
            </ul>
            Drag rows to reorder commits.
          </div>

          ${this.error
            ? html`<div class="error-message">${this.error}</div>`
            : nothing}
        </div>

        <div slot="footer">
          <button
            class="btn btn-secondary"
            @click=${this.close}
            ?disabled=${this.executing}
          >
            Cancel
          </button>
          <button
            class="btn btn-primary"
            @click=${this.handleExecute}
            ?disabled=${!this.canExecute}
          >
            ${this.executing ? 'Rebasing...' : 'Start Rebase'}
          </button>
        </div>
      </lv-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-interactive-rebase-dialog': LvInteractiveRebaseDialog;
  }
}
