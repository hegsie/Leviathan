/**
 * Create Tag Dialog Component
 * Allows users to create a new tag (annotated or lightweight)
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, property, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { createTag } from '../../services/git.service.ts';
import './lv-modal.ts';
import type { LvModal } from './lv-modal.ts';

@customElement('lv-create-tag-dialog')
export class LvCreateTagDialog extends LitElement {
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

      .field input,
      .field textarea {
        padding: var(--spacing-sm) var(--spacing-md);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-primary);
        color: var(--color-text-primary);
        font-size: var(--font-size-md);
        font-family: inherit;
      }

      .field input:focus,
      .field textarea:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 2px var(--color-primary-light);
      }

      .field input::placeholder,
      .field textarea::placeholder {
        color: var(--color-text-muted);
      }

      .field textarea {
        min-height: 80px;
        resize: vertical;
      }

      .field-hint {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .toggle-field {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .toggle-switch {
        position: relative;
        width: 40px;
        height: 22px;
        flex-shrink: 0;
      }

      .toggle-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .toggle-slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--color-border);
        transition: 0.2s;
        border-radius: 22px;
      }

      .toggle-slider:before {
        position: absolute;
        content: "";
        height: 16px;
        width: 16px;
        left: 3px;
        bottom: 3px;
        background-color: var(--toggle-knob-color, #ffffff);
        transition: 0.2s;
        border-radius: 50%;
      }

      input:checked + .toggle-slider {
        background-color: var(--color-primary);
      }

      input:checked + .toggle-slider:before {
        transform: translateX(18px);
      }

      .toggle-label {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .toggle-label-main {
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
      }

      .toggle-label-hint {
        font-size: var(--font-size-xs);
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

  @state() private name = '';
  @state() private targetRef = '';
  @state() private message = '';
  @state() private isAnnotated = true;
  @state() private isCreating = false;
  @state() private error = '';

  @query('lv-modal') private modal!: LvModal;
  @query('#tag-name-input') private inputEl!: HTMLInputElement;

  public open(targetRef?: string): void {
    this.reset();
    if (targetRef) {
      this.targetRef = targetRef;
    }
    this.modal.open = true;
    // Focus input after modal opens
    setTimeout(() => this.inputEl?.focus(), 100);
  }

  public close(): void {
    this.modal.open = false;
  }

  private reset(): void {
    this.name = '';
    this.targetRef = '';
    this.message = '';
    this.isAnnotated = true;
    this.isCreating = false;
    this.error = '';
  }

  private handleNameChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    // Sanitize tag name (replace invalid characters)
    this.name = input.value.replace(/[^\w\-/.]/g, '-');
    this.error = '';
  }

  private handleTargetChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.targetRef = input.value;
    this.error = '';
  }

  private handleMessageChange(e: Event): void {
    const textarea = e.target as HTMLTextAreaElement;
    this.message = textarea.value;
    this.error = '';
  }

  private handleAnnotatedChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.isAnnotated = input.checked;
    if (!input.checked) {
      this.message = '';
    }
  }

  private async handleCreate(): Promise<void> {
    const tagName = this.name.trim();

    if (!tagName) {
      this.error = 'Please enter a tag name';
      return;
    }

    if (tagName.startsWith('-') || tagName.startsWith('.')) {
      this.error = 'Tag name cannot start with - or .';
      return;
    }

    if (this.isAnnotated && !this.message.trim()) {
      this.error = 'Please enter a message for the annotated tag';
      return;
    }

    this.isCreating = true;
    this.error = '';

    try {
      const result = await createTag({
        path: this.repositoryPath,
        name: tagName,
        target: this.targetRef || undefined,
        message: this.isAnnotated ? this.message.trim() : undefined,
      });

      if (result.success) {
        this.dispatchEvent(new CustomEvent('tag-created', {
          detail: { tag: result.data },
          bubbles: true,
          composed: true,
        }));
        this.close();
      } else {
        this.error = result.error?.message ?? 'Failed to create tag';
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unknown error occurred';
    } finally {
      this.isCreating = false;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && this.canCreate) {
      e.preventDefault();
      this.handleCreate();
    }
  }

  private handleModalClose(): void {
    if (!this.isCreating) {
      this.reset();
    }
  }

  private get canCreate(): boolean {
    const hasName = Boolean(this.name.trim());
    const hasMessageIfAnnotated = !this.isAnnotated || Boolean(this.message.trim());
    return hasName && hasMessageIfAnnotated && !this.isCreating;
  }

  render() {
    return html`
      <lv-modal
        modalTitle="Create Tag"
        @close=${this.handleModalClose}
      >
        <div class="form" @keydown=${this.handleKeyDown}>
          <div class="field">
            <label for="tag-name-input">Tag Name</label>
            <input
              id="tag-name-input"
              type="text"
              placeholder="v1.0.0"
              .value=${this.name}
              @input=${this.handleNameChange}
              ?disabled=${this.isCreating}
            />
            <span class="field-hint">Use semantic versioning (e.g., v1.0.0, v2.1.0-beta)</span>
          </div>

          <div class="field">
            <label for="target-input">Target (optional)</label>
            <input
              id="target-input"
              type="text"
              placeholder="HEAD"
              .value=${this.targetRef}
              @input=${this.handleTargetChange}
              ?disabled=${this.isCreating}
            />
            <span class="field-hint">Commit, branch, or tag to create from (defaults to HEAD)</span>
          </div>

          <div class="toggle-field">
            <label class="toggle-switch">
              <input
                type="checkbox"
                .checked=${this.isAnnotated}
                @change=${this.handleAnnotatedChange}
                ?disabled=${this.isCreating}
              />
              <span class="toggle-slider"></span>
            </label>
            <div class="toggle-label">
              <span class="toggle-label-main">Annotated Tag</span>
              <span class="toggle-label-hint">
                ${this.isAnnotated
                  ? 'Includes message, author, and date'
                  : 'Lightweight tag (just a reference to a commit)'}
              </span>
            </div>
          </div>

          ${this.isAnnotated ? html`
            <div class="field">
              <label for="message-input">Message</label>
              <textarea
                id="message-input"
                placeholder="Release notes or description..."
                .value=${this.message}
                @input=${this.handleMessageChange}
                ?disabled=${this.isCreating}
              ></textarea>
            </div>
          ` : nothing}

          ${this.error
            ? html`<div class="error-message">${this.error}</div>`
            : nothing}
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
            ${this.isCreating ? 'Creating...' : 'Create Tag'}
          </button>
        </div>
      </lv-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-create-tag-dialog': LvCreateTagDialog;
  }
}
