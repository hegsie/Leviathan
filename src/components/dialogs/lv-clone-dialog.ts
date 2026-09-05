/**
 * Clone Repository Dialog Component
 * Allows users to clone a remote repository
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import {
  isNetworkGateRefusal,
  cloneRepository,
  cancelClone,
  type ProviderRepository,
} from '../../services/git.service.ts';
import { openCloneDestinationDialog } from '../../services/dialog.service.ts';
import { repositoryStore } from '../../stores/index.ts';
import { settingsStore } from '../../stores/settings.store.ts';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import './lv-modal.ts';
import './lv-account-repo-picker.ts';
import type { LvModal } from './lv-modal.ts';

/** Where the repository to clone comes from. */
type CloneSource = 'url' | 'account';

interface CloneProgress {
  stage: string;
  receivedObjects: number;
  totalObjects: number;
  indexedObjects: number;
  receivedBytes: number;
  percent: number;
}

@customElement('lv-clone-dialog')
export class LvCloneDialog extends LitElement {
  static styles = [
    sharedStyles,
    css`
      .form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        min-width: 450px;
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .field label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
      }

      .field input {
        padding: var(--spacing-sm) var(--spacing-md);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-primary);
        color: var(--color-text-primary);
        font-size: var(--font-size-md);
        font-family: inherit;
      }

      .field input:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 2px var(--color-primary-light);
      }

      .field input::placeholder {
        color: var(--color-text-muted);
      }

      .field-row {
        display: flex;
        gap: var(--spacing-sm);
        align-items: flex-end;
      }

      .field-row .field {
        flex: 1;
      }

      .browse-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-sm) var(--spacing-md);
        height: 38px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-tertiary);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition: all var(--transition-fast);
        white-space: nowrap;
      }

      .browse-btn:hover {
        background: var(--color-bg-hover);
        border-color: var(--color-primary);
      }

      .repo-name-preview {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        margin-top: var(--spacing-xs);
      }

      .progress-section {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
      }

      .progress-text {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
      }

      .progress-bar {
        height: 4px;
        background: var(--color-border);
        border-radius: var(--radius-full);
        overflow: hidden;
      }

      .progress-bar-fill {
        height: 100%;
        background: var(--color-primary);
        transition: width 0.3s ease;
      }

      .error-message {
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-error-bg);
        border: 1px solid var(--color-error);
        border-radius: var(--radius-md);
        color: var(--color-error);
        font-size: var(--font-size-sm);
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

      /* Source selection ("From URL" / "From account"). Kept as its own block
         so the URL and options rows below stay exactly as they were. */
      .source-tabs {
        display: flex;
        gap: var(--spacing-xs);
      }

      .source-tab {
        padding: var(--spacing-xs) var(--spacing-md);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-secondary);
        color: var(--color-text-secondary);
        font-size: var(--font-size-sm);
        font-family: inherit;
        cursor: pointer;
      }

      .source-tab:hover:not(:disabled) {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .source-tab[aria-selected='true'] {
        border-color: var(--color-primary);
        background: var(--color-bg-primary);
        color: var(--color-text-primary);
        font-weight: var(--font-weight-medium);
      }

      .source-tab:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ];

  /**
   * Which source block is showing. The account picker is only rendered — and
   * therefore only fetches — while it is selected, so opening the dialog never
   * calls a provider API on its own.
   */
  @state() private source: CloneSource = 'url';
  /** "owner/name" of the repository picked from an account, for confirmation. */
  @state() private selectedRepoLabel = '';
  @state() private url = '';
  @state() private destination = '';
  @state() private repoName = '';
  @state() private depth: number | null = null;
  @state() private filter: string | null = null;
  @state() private singleBranch = false;
  @state() private isCloning = false;
  /**
   * The clone SUCCEEDED and the dialog is in its brief close delay.
   *
   * `isCloning` stays true across that delay (clearing it would re-enable the
   * Clone button and let a second clone start into the same destination), but
   * the footer button and the modal-close handler both route to cancellation
   * while it is set — so for those 500ms a finished clone still offered
   * "Cancel Clone", and Escape or the × fired a cancel request for an
   * operation that had already succeeded and been added to the store.
   */
  @state() private isComplete = false;
  /** Set while a cancellation request is in flight, so Cancel cannot be spammed. */
  @state() private isCancelling = false;
  @state() private progress = 0;
  @state() private progressText = '';
  @state() private error = '';

  @query('lv-modal') private modal!: LvModal;

  private unlistenProgress?: UnlistenFn;

  public open(): void {
    // A clone already in flight owns this component; reset() would
    // clear `isCloning` and re-enable the button for a second concurrent run,
    // and the first run's close() would then yank shut the reopened session.
    if (this.isCloning) return;
    this.reset();
    this.destination = settingsStore.getState().defaultClonePath;
    this.modal.open = true;
  }

  public close(): void {
    this.modal.open = false;
    // Cleared HERE, not just on the failure paths. The success branch closes
    // via setTimeout without clearing it, so `isCloning` stayed true for the
    // life of the component — and open()'s re-entrancy guard returns before
    // reset() can clear it, which made "Clone Repository" silently dead for
    // the rest of the session after the first successful clone.
    this.isCloning = false;
    this.isCancelling = false;
    this.isComplete = false;
    this.cleanupListener();
  }

  private cleanupListener(): void {
    if (this.unlistenProgress) {
      this.unlistenProgress();
      this.unlistenProgress = undefined;
    }
  }

  private reset(): void {
    this.source = 'url';
    this.selectedRepoLabel = '';
    this.url = '';
    this.destination = '';
    this.repoName = '';
    this.depth = null;
    this.isCloning = false;
    this.isCancelling = false;
    this.isComplete = false;
    this.progress = 0;
    this.progressText = '';
    this.error = '';
    this.cleanupListener();
  }

  private handleUrlChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.url = input.value;
    this.repoName = this.extractRepoName(this.url);
    this.error = '';
    // Typing over the URL means the picked repository is no longer what will
    // be cloned, so its confirmation line must not keep claiming otherwise.
    this.selectedRepoLabel = '';
  }

  /** Switch between pasting a URL and picking from a connected account. */
  private handleSourceChange(source: CloneSource): void {
    if (this.isCloning || this.source === source) return;
    this.source = source;
    this.error = '';
  }

  /**
   * A repository was picked from a connected account: fill in the URL and the
   * destination exactly as typing them would, so the clone below (progress,
   * cancellation, token resolution) runs completely unchanged.
   */
  private handleRepositorySelected(
    e: CustomEvent<{ repository: ProviderRepository }>,
  ): void {
    const repo = e.detail?.repository;
    if (!repo) return;
    this.url = repo.cloneUrl;
    // The provider's own name, not one parsed back out of the URL: a GitLab
    // project's path segment and its display name can differ.
    this.repoName = this.extractRepoName(repo.cloneUrl) || repo.name;
    this.selectedRepoLabel = repo.fullName;
    if (!this.destination) {
      this.destination = settingsStore.getState().defaultClonePath;
    }
    this.error = '';
  }

  /**
   * The picker asked for the accounts manager. Close this dialog first — the
   * manager opens as its own modal, and leaving the clone dialog stacked
   * underneath it traps the user between two dialogs. The event keeps
   * bubbling to the host, which opens the manager.
   */
  private handleManageAccounts(): void {
    if (this.isCloning) return;
    this.close();
    this.reset();
  }

  private handleDestinationChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.destination = input.value;
    this.error = '';
  }

  private handleDepthChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    const value = input.value.trim();
    this.depth = value ? parseInt(value, 10) || null : null;
    this.error = '';
  }

  private extractRepoName(url: string): string {
    if (!url) return '';

    // Handle various URL formats
    // https://github.com/user/repo.git
    // git@github.com:user/repo.git
    // https://github.com/user/repo

    let name = url.trim();

    // Remove trailing .git
    if (name.endsWith('.git')) {
      name = name.slice(0, -4);
    }

    // Remove trailing slash
    if (name.endsWith('/')) {
      name = name.slice(0, -1);
    }

    // Get last segment
    const segments = name.split(/[/:]/).filter(Boolean);
    return segments[segments.length - 1] || '';
  }

  private async handleBrowse(): Promise<void> {
    const path = await openCloneDestinationDialog(this.destination || undefined);
    if (path) {
      this.destination = path;
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private async handleClone(): Promise<void> {
    if (!this.url.trim()) {
      this.error = 'Please enter a repository URL';
      return;
    }

    if (!this.destination.trim()) {
      this.error = 'Please select a destination folder';
      return;
    }

    this.isCloning = true;
    this.progress = 0;
    this.progressText = 'Starting clone...';
    this.error = '';

    try {
      // Set up progress listener before starting clone
      this.unlistenProgress = await listen<CloneProgress>('clone-progress', (event) => {
        const { stage, receivedObjects, totalObjects, receivedBytes, percent } = event.payload;
        this.progress = percent;

        if (stage === 'Complete') {
          this.progressText = 'Clone complete!';
        } else if (totalObjects > 0) {
          this.progressText = `${stage}: ${receivedObjects}/${totalObjects} (${this.formatBytes(receivedBytes)})`;
        } else {
          this.progressText = stage;
        }
      });

      // Construct full path with repo name
      const fullPath = this.repoName
        ? `${this.destination}/${this.repoName}`
        : this.destination;

      const result = await cloneRepository({
        url: this.url.trim(),
        path: fullPath,
        ...(this.depth !== null ? { depth: this.depth } : {}),
        ...(this.filter ? { filter: this.filter } : {}),
        ...(this.singleBranch ? { singleBranch: true } : {}),
      });

      if (result.success && result.data) {
        this.progress = 100;
        this.progressText = 'Clone complete!';
        this.isComplete = true;

        // Add the repository to the store
        const store = repositoryStore.getState();
        store.addRepository(result.data);

        // Close dialog after a brief delay
        setTimeout(() => {
          this.close();
        }, 500);
      } else {
        // The gate already explained a block, and a declined confirm is the
        // user's own decision — showing "Cancelled" as a red error in the
        // dialog reports their click back to them as a failure.
        if (!isNetworkGateRefusal(result.error)) {
          this.error = result.error?.message ?? 'Failed to clone repository';
        }
        this.isCloning = false;
        // Cleared alongside isCloning: leaving it set keeps Cancel disabled, so
        // the dialog the cancellation was meant to release stays stuck.
        this.isCancelling = false;
        this.cleanupListener();
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unknown error occurred';
      this.isCloning = false;
      this.isCancelling = false;
      this.cleanupListener();
    }
  }

  private handleModalClose(): void {
    // A clone in flight must not be abandoned behind a hidden dialog: lv-modal
    // sets open=false BEFORE dispatching, so re-assert it and route Escape, the
    // overlay and the × into the same cancellation the Cancel button performs.
    // Previously this simply refused to close, and since the clone had no
    // cancellation and no timeout, a hung clone locked the modal for the life of
    // the app.
    if (this.isCloning && !this.isComplete) {
      this.modal.open = true;
      void this.handleCancelClone();
      return;
    }

    this.reset();
  }

  /**
   * Stop the clone in flight.
   *
   * The backend kills the `git clone` child process (CLI path) or aborts the
   * transfer (git2 path) and removes the partial destination, then
   * `handleClone` returns an error and clears `isCloning`, which releases the
   * dialog.
   */
  private async handleCancelClone(): Promise<void> {
    if (this.isCancelling) return;

    this.isCancelling = true;
    this.progressText = 'Cancelling…';

    const result = await cancelClone();
    if (!result.success) {
      // The dialog stays open, so the failure belongs inline rather than in a
      // toast — and Cancel must become pressable again.
      this.isCancelling = false;
      this.progressText = '';
      this.error = result.error?.message ?? 'Failed to cancel the clone';
    }
  }

  private get fullPath(): string {
    if (!this.destination) return '';
    if (!this.repoName) return this.destination;
    return `${this.destination}/${this.repoName}`;
  }

  private get canClone(): boolean {
    return Boolean(this.url.trim() && this.destination.trim() && !this.isCloning);
  }

  render() {
    return html`
      <lv-modal
        modalTitle="Clone Repository"
        @close=${this.handleModalClose}
      >
        <div class="form">
          <!-- Source selection. Deliberately a self-contained block above the
               URL/options rows rather than edits woven through them. -->
          <div class="source-tabs" role="tablist" aria-label="Repository source">
            <button
              class="source-tab"
              role="tab"
              id="source-url"
              aria-selected=${this.source === 'url'}
              @click=${() => this.handleSourceChange('url')}
              ?disabled=${this.isCloning}
            >
              From URL
            </button>
            <button
              class="source-tab"
              role="tab"
              id="source-account"
              aria-selected=${this.source === 'account'}
              @click=${() => this.handleSourceChange('account')}
              ?disabled=${this.isCloning}
            >
              From account
            </button>
          </div>

          ${this.source === 'account'
            ? html`
                <lv-account-repo-picker
                  ?disabled=${this.isCloning}
                  @repository-selected=${this.handleRepositorySelected}
                  @manage-accounts=${this.handleManageAccounts}
                ></lv-account-repo-picker>
                ${this.selectedRepoLabel
                  ? html`<div class="repo-name-preview">
                      Selected: ${this.selectedRepoLabel}
                    </div>`
                  : nothing}
              `
            : nothing}

          <div class="field">
            <label for="url">Repository URL</label>
            <input
              id="url"
              type="text"
              placeholder="https://github.com/user/repo.git"
              .value=${this.url}
              @input=${this.handleUrlChange}
              ?disabled=${this.isCloning}
              autofocus
            />
            ${this.repoName
              ? html`<div class="repo-name-preview">Repository name: ${this.repoName}</div>`
              : ''}
          </div>

          <div class="field-row">
            <div class="field">
              <label for="destination">Clone to</label>
              <input
                id="destination"
                type="text"
                placeholder="/path/to/folder"
                .value=${this.destination}
                @input=${this.handleDestinationChange}
                ?disabled=${this.isCloning}
              />
            </div>
            <button
              class="browse-btn"
              @click=${this.handleBrowse}
              ?disabled=${this.isCloning}
            >
              Browse...
            </button>
          </div>

          <div class="field">
            <label for="depth">Shallow clone depth (optional)</label>
            <input
              id="depth"
              type="number"
              min="1"
              placeholder="Leave empty for full clone"
              .value=${this.depth !== null ? String(this.depth) : ''}
              @input=${this.handleDepthChange}
              ?disabled=${this.isCloning}
            />
          </div>

          <div class="field">
            <label for="filter">Partial clone filter (optional)</label>
            <select
              id="filter"
              .value=${this.filter ?? ''}
              @change=${(e: Event) => { this.filter = (e.target as HTMLSelectElement).value || null; }}
              ?disabled=${this.isCloning}
            >
              <option value="">None (full clone)</option>
              <option value="blob:none">blob:none — Skip file contents, fetch on demand</option>
              <option value="tree:0">tree:0 — Skip trees and blobs, minimal clone</option>
            </select>
          </div>

          <div class="field" style="flex-direction:row;align-items:center;gap:8px">
            <input
              type="checkbox"
              id="single-branch"
              .checked=${this.singleBranch}
              @change=${(e: Event) => { this.singleBranch = (e.target as HTMLInputElement).checked; }}
              ?disabled=${this.isCloning}
            />
            <label for="single-branch" style="margin:0">Single branch only</label>
          </div>

          ${this.fullPath
            ? html`<div class="repo-name-preview">Full path: ${this.fullPath}</div>`
            : ''}

          ${this.isCloning
            ? html`
                <div class="progress-section">
                  <div class="progress-text">${this.progressText}</div>
                  <div class="progress-bar">
                    <div class="progress-bar-fill" style="width: ${this.progress}%"></div>
                  </div>
                </div>
              `
            : ''}

          ${this.error
            ? html`<div class="error-message">${this.error}</div>`
            : ''}
        </div>

        <div slot="footer">
          <button
            class="btn btn-secondary"
            @click=${this.isCloning && !this.isComplete ? this.handleCancelClone : this.close}
            ?disabled=${this.isCancelling}
          >
            ${this.isCloning && !this.isComplete
              ? (this.isCancelling ? 'Cancelling…' : 'Cancel Clone')
              : 'Cancel'}
          </button>
          <button
            class="btn btn-primary"
            @click=${this.handleClone}
            ?disabled=${!this.canClone}
          >
            ${this.isCloning ? 'Cloning...' : 'Clone'}
          </button>
        </div>
      </lv-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-clone-dialog': LvCloneDialog;
  }
}
