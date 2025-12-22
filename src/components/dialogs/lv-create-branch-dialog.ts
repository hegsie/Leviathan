/**
 * Create Branch Dialog Component
 * Allows users to create a new branch from current HEAD or a specific ref
 */

import { LitElement, html, css } from 'lit';
import { customElement, state, property, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { createBranch } from '../../services/git.service.ts';
import './lv-modal.ts';
import type { LvModal } from './lv-modal.ts';

@customElement('lv-create-branch-dialog')
export class LvCreateBranchDialog extends LitElement {
  static styles = [
    sharedStyles,
    css`
      .form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        min-width: 400px;
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

      .field-hint {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
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

  @property({ type: String }) repositoryPath = '';
  @property({ type: String }) startPoint = '';

  @state() private branchName = '';
  @state() private checkoutAfterCreate = true;
  @state() private isCreating = false;
  @state() private error = '';

  @query('lv-modal') private modal!: LvModal;
  @query('#branch-name-input') private inputEl!: HTMLInputElement;

  public open(startPoint?: string): void {
    this.reset();
    if (startPoint) {
      this.startPoint = startPoint;
    }
    this.modal.open = true;
    // Focus input after modal opens
    setTimeout(() => this.inputEl?.focus(), 100);
  }

  public close(): void {
    this.modal.open = false;
  }

  private reset(): void {
    this.branchName = '';
    this.checkoutAfterCreate = true;
    this.isCreating = false;
    this.error = '';
  }

  private handleNameChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    // Sanitize branch name (replace invalid characters)
    this.branchName = input.value.replace(/[^\w\-\/\.]/g, '-');
    this.error = '';
  }

  private handleCheckoutChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.checkoutAfterCreate = input.checked;
  }

  private async handleCreate(): Promise<void> {
    const name = this.branchName.trim();

    if (!name) {
      this.error = 'Please enter a branch name';
      return;
    }

    if (name.startsWith('-') || name.startsWith('.')) {
      this.error = 'Branch name cannot start with - or .';
      return;
    }

    this.isCreating = true;
    this.error = '';

    try {
      const result = await createBranch(this.repositoryPath, {
        name,
        startPoint: this.startPoint || undefined,
        checkout: this.checkoutAfterCreate,
      });

      if (result.success) {
        this.dispatchEvent(new CustomEvent('branch-created', {
          detail: { branch: result.data, checkedOut: this.checkoutAfterCreate },
          bubbles: true,
          composed: true,
        }));
        this.close();
      } else {
        this.error = result.error?.message ?? 'Failed to create branch';
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unknown error occurred';
    } finally {
      this.isCreating = false;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && this.canCreate) {
      this.handleCreate();
    }
  }

  private handleModalClose(): void {
    if (!this.isCreating) {
      this.reset();
    }
  }

  private get canCreate(): boolean {
    return Boolean(this.branchName.trim() && !this.isCreating);
  }

  render() {
    return html`
      <lv-modal
        modalTitle="Create Branch"
        @close=${this.handleModalClose}
      >
        <div class="form" @keydown=${this.handleKeyDown}>
          <div class="field">
            <label for="branch-name-input">Branch Name</label>
            <input
              id="branch-name-input"
              type="text"
              placeholder="feature/my-new-feature"
              .value=${this.branchName}
              @input=${this.handleNameChange}
              ?disabled=${this.isCreating}
            />
            <span class="field-hint">Use / to organize branches (e.g., feature/, bugfix/)</span>
          </div>

          ${this.startPoint ? html`
            <div class="field">
              <label>Based on</label>
              <input
                type="text"
                .value=${this.startPoint}
                disabled
                style="background: var(--color-bg-tertiary);"
              />
            </div>
          ` : ''}

          <div class="checkbox-field">
            <input
              id="checkout-after"
              type="checkbox"
              .checked=${this.checkoutAfterCreate}
              @change=${this.handleCheckoutChange}
              ?disabled=${this.isCreating}
            />
            <label for="checkout-after">Checkout new branch after creation</label>
          </div>

          ${this.error
            ? html`<div class="error-message">${this.error}</div>`
            : ''}
        </div>

        <div slot="footer">
          <button
            class="btn btn-secondary"
            @click=${this.close}
            ?disabled=${this.isCreating}
          >
            Cancel
          </button>
          <button
            class="btn btn-primary"
            @click=${this.handleCreate}
            ?disabled=${!this.canCreate}
          >
            ${this.isCreating ? 'Creating...' : 'Create Branch'}
          </button>
        </div>
      </lv-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-create-branch-dialog': LvCreateBranchDialog;
  }
}
