/**
 * Prompt Dialog Component
 * Themed replacement for native prompt() — managed as a singleton by dialog.service.ts
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles, buttonStyles, inputStyles } from '../../styles/shared-styles.ts';
import './lv-modal.ts';
import type { LvModal } from './lv-modal.ts';

export interface PromptDialogOptions {
  title: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

@customElement('lv-prompt-dialog')
export class LvPromptDialog extends LitElement {
  static styles = [
    sharedStyles,
    buttonStyles,
    inputStyles,
    css`
      .prompt-message {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
        margin-bottom: var(--spacing-md);
      }

      .prompt-input {
        width: 100%;
        padding: var(--spacing-sm) var(--spacing-md);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-primary);
        color: var(--color-text-primary);
        font-size: var(--font-size-md);
        font-family: inherit;
      }

      .prompt-input:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 2px var(--color-primary-light);
      }

      .prompt-input::placeholder {
        color: var(--color-text-muted);
      }
    `,
  ];

  @state() private promptTitle = '';
  @state() private message = '';
  @state() private value = '';
  @state() private placeholder = '';
  @state() private confirmLabel = 'OK';
  @state() private cancelLabel = 'Cancel';

  private resolve: ((value: string | null) => void) | null = null;

  open(options: PromptDialogOptions): Promise<string | null> {
    this.promptTitle = options.title;
    this.message = options.message;
    this.value = options.defaultValue ?? '';
    this.placeholder = options.placeholder ?? '';
    this.confirmLabel = options.confirmLabel ?? 'OK';
    this.cancelLabel = options.cancelLabel ?? 'Cancel';

    const modal = this.shadowRoot?.querySelector<LvModal>('lv-modal');
    if (modal) {
      modal.open = true;
    }

    return new Promise<string | null>((resolve) => {
      this.resolve = resolve;
      // Auto-focus and select input after render
      this.updateComplete.then(() => {
        const input = this.shadowRoot?.querySelector<HTMLInputElement>('.prompt-input');
        if (input) {
          input.focus();
          input.select();
        }
      });
    });
  }

  private handleConfirm(): void {
    if (!this.resolve) return;
    const resolve = this.resolve;
    this.resolve = null;
    const modal = this.shadowRoot?.querySelector<LvModal>('lv-modal');
    if (modal) {
      modal.open = false;
    }
    resolve(this.value);
  }

  private handleCancel(): void {
    if (!this.resolve) return;
    const resolve = this.resolve;
    this.resolve = null;
    const modal = this.shadowRoot?.querySelector<LvModal>('lv-modal');
    if (modal) {
      modal.open = false;
    }
    resolve(null);
  }

  private handleModalClose(): void {
    // Idempotent — no-op if resolve is already null (e.g., Cancel click already resolved)
    if (!this.resolve) return;
    const resolve = this.resolve;
    this.resolve = null;
    resolve(null);
  }

  private handleInput(e: Event): void {
    this.value = (e.target as HTMLInputElement).value;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.handleConfirm();
    }
  }

  render() {
    return html`
      <lv-modal
        .modalTitle=${this.promptTitle}
        @close=${this.handleModalClose}
      >
        <div class="prompt-message">${this.message}</div>
        <input
          class="prompt-input"
          type="text"
          .value=${this.value}
          placeholder=${this.placeholder}
          @input=${this.handleInput}
          @keydown=${this.handleKeyDown}
        />
        <div slot="footer">
          <button class="btn btn-secondary" @click=${this.handleCancel}>
            ${this.cancelLabel}
          </button>
          <button class="btn btn-primary" @click=${this.handleConfirm}>
            ${this.confirmLabel}
          </button>
        </div>
      </lv-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-prompt-dialog': LvPromptDialog;
  }
}
