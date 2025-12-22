/**
 * Init Repository Dialog Component
 * Allows users to initialize a new Git repository
 */

import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { initRepository } from '../../services/git.service.ts';
import { openDialog } from '../../services/dialog.service.ts';
import { useRepositoryStore } from '../../stores/index.ts';
import './lv-modal.ts';
import type { LvModal } from './lv-modal.ts';

@customElement('lv-init-dialog')
export class LvInitDialog extends LitElement {
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

      .checkbox-field {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .checkbox-field input[type="checkbox"] {
        width: 16px;
        height: 16px;
        accent-color: var(--color-primary);
      }

      .checkbox-field label {
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
        cursor: pointer;
      }

      .checkbox-hint {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        margin-left: 24px;
      }

      .info-box {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-sm);
        padding: var(--spacing-md);
        background: var(--color-info-bg);
        border: 1px solid var(--color-info);
        border-radius: var(--radius-md);
      }

      .info-box svg {
        flex-shrink: 0;
        width: 16px;
        height: 16px;
        color: var(--color-info);
      }

      .info-box-text {
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
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

  @state() private path = '';
  @state() private bare = false;
  @state() private isInitializing = false;
  @state() private error = '';

  @query('lv-modal') private modal!: LvModal;

  public open(): void {
    this.reset();
    this.modal.open = true;
  }

  public close(): void {
    this.modal.open = false;
  }

  private reset(): void {
    this.path = '';
    this.bare = false;
    this.isInitializing = false;
    this.error = '';
  }

  private handlePathChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.path = input.value;
    this.error = '';
  }

  private handleBareChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.bare = input.checked;
  }

  private async handleBrowse(): Promise<void> {
    const result = await openDialog({
      title: 'Select Folder for New Repository',
      directory: true,
      multiple: false,
      defaultPath: this.path || undefined,
    });

    if (result && !Array.isArray(result)) {
      this.path = result;
    } else if (Array.isArray(result) && result.length > 0) {
      this.path = result[0];
    }
  }

  private async handleInit(): Promise<void> {
    if (!this.path.trim()) {
      this.error = 'Please select a folder';
      return;
    }

    this.isInitializing = true;
    this.error = '';

    try {
      const result = await initRepository({
        path: this.path.trim(),
        bare: this.bare,
      });

      if (result.success && result.data) {
        // Add the repository to the store
        const store = useRepositoryStore.getState();
        store.addRepository(result.data);

        // Close dialog
        this.close();
      } else {
        this.error = result.error?.message ?? 'Failed to initialize repository';
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unknown error occurred';
    } finally {
      this.isInitializing = false;
    }
  }

  private handleModalClose(): void {
    if (!this.isInitializing) {
      this.reset();
    }
  }

  private get canInit(): boolean {
    return Boolean(this.path.trim() && !this.isInitializing);
  }

  private get folderName(): string {
    if (!this.path) return '';
    const segments = this.path.split(/[\/\\]/).filter(Boolean);
    return segments[segments.length - 1] || '';
  }

  render() {
    return html`
      <lv-modal
        modalTitle="Initialize Repository"
        @close=${this.handleModalClose}
      >
        <div class="form">
          <div class="info-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <div class="info-box-text">
              Initialize a new Git repository in the selected folder.
              This will create a .git directory to track your project's history.
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="path">Repository Location</label>
              <input
                id="path"
                type="text"
                placeholder="/path/to/folder"
                .value=${this.path}
                @input=${this.handlePathChange}
                ?disabled=${this.isInitializing}
              />
            </div>
            <button
              class="browse-btn"
              @click=${this.handleBrowse}
              ?disabled=${this.isInitializing}
            >
              Browse...
            </button>
          </div>

          <div class="checkbox-field">
            <input
              id="bare"
              type="checkbox"
              .checked=${this.bare}
              @change=${this.handleBareChange}
              ?disabled=${this.isInitializing}
            />
            <label for="bare">Create a bare repository</label>
          </div>
          <div class="checkbox-hint">
            Bare repositories are typically used as central repositories for collaboration.
          </div>

          ${this.error
            ? html`<div class="error-message">${this.error}</div>`
            : ''}
        </div>

        <div slot="footer">
          <button
            class="btn btn-secondary"
            @click=${this.close}
            ?disabled=${this.isInitializing}
          >
            Cancel
          </button>
          <button
            class="btn btn-primary"
            @click=${this.handleInit}
            ?disabled=${!this.canInit}
          >
            ${this.isInitializing ? 'Initializing...' : 'Initialize Repository'}
          </button>
        </div>
      </lv-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-init-dialog': LvInitDialog;
  }
}
