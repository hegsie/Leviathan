/**
 * Clone Repository Dialog Component
 * Allows users to clone a remote repository
 */

import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { cloneRepository } from '../../services/git.service.ts';
import { openCloneDestinationDialog } from '../../services/dialog.service.ts';
import { repositoryStore } from '../../stores/index.ts';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import './lv-modal.ts';
import type { LvModal } from './lv-modal.ts';

interface CloneProgress {
  stage: string;
  received_objects: number;
  total_objects: number;
  indexed_objects: number;
  received_bytes: number;
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
    `,
  ];

  @state() private url = '';
  @state() private destination = '';
  @state() private repoName = '';
  @state() private isCloning = false;
  @state() private progress = 0;
  @state() private progressText = '';
  @state() private error = '';

  @query('lv-modal') private modal!: LvModal;

  private unlistenProgress?: UnlistenFn;

  public open(): void {
    this.reset();
    this.modal.open = true;
  }

  public close(): void {
    this.modal.open = false;
    this.cleanupListener();
  }

  private cleanupListener(): void {
    if (this.unlistenProgress) {
      this.unlistenProgress();
      this.unlistenProgress = undefined;
    }
  }

  private reset(): void {
    this.url = '';
    this.destination = '';
    this.repoName = '';
    this.isCloning = false;
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
  }

  private handleDestinationChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.destination = input.value;
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
        const { stage, received_objects, total_objects, received_bytes, percent } = event.payload;
        this.progress = percent;

        if (stage === 'Complete') {
          this.progressText = 'Clone complete!';
        } else if (total_objects > 0) {
          this.progressText = `${stage}: ${received_objects}/${total_objects} (${this.formatBytes(received_bytes)})`;
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
      });

      if (result.success && result.data) {
        this.progress = 100;
        this.progressText = 'Clone complete!';

        // Add the repository to the store
        const store = repositoryStore.getState();
        store.addRepository(result.data);

        // Close dialog after a brief delay
        setTimeout(() => {
          this.close();
        }, 500);
      } else {
        this.error = result.error?.message ?? 'Failed to clone repository';
        this.isCloning = false;
        this.cleanupListener();
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unknown error occurred';
      this.isCloning = false;
      this.cleanupListener();
    }
  }

  private handleModalClose(): void {
    if (!this.isCloning) {
      this.reset();
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
            @click=${this.close}
            ?disabled=${this.isCloning}
          >
            Cancel
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
