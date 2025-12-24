/**
 * Keyboard Shortcuts Help Dialog
 * Shows all available keyboard shortcuts organized by category
 */

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { keyboardService, type Shortcut } from '../../services/keyboard.service.ts';

@customElement('lv-keyboard-shortcuts-dialog')
export class LvKeyboardShortcutsDialog extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: var(--z-modal, 200);
      }

      :host([open]) {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(2px);
      }

      .dialog {
        position: relative;
        display: flex;
        flex-direction: column;
        width: 600px;
        max-width: 90vw;
        max-height: 80vh;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        overflow: hidden;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);
        background: var(--color-bg-tertiary);
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .header-icon {
        width: 20px;
        height: 20px;
        color: var(--color-primary);
      }

      .title {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }

      .close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .close-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .close-btn svg {
        width: 16px;
        height: 16px;
      }

      .content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-md);
      }

      .category {
        margin-bottom: var(--spacing-lg);
      }

      .category:last-child {
        margin-bottom: 0;
      }

      .category-title {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: var(--spacing-sm);
        padding: 0 var(--spacing-xs);
      }

      .shortcuts-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .shortcut-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-md);
        transition: background var(--transition-fast);
      }

      .shortcut-row:hover {
        background: var(--color-bg-hover);
      }

      .shortcut-description {
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
      }

      .shortcut-keys {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .key {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 24px;
        height: 24px;
        padding: 0 6px;
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        box-shadow: 0 1px 0 var(--color-border);
      }

      .key-separator {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        border-top: 1px solid var(--color-border);
        background: var(--color-bg-tertiary);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .vim-toggle {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .vim-toggle label {
        cursor: pointer;
      }

      .toggle-switch {
        position: relative;
        width: 36px;
        height: 20px;
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .toggle-switch.active {
        background: var(--color-primary);
        border-color: var(--color-primary);
      }

      .toggle-switch::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        background: white;
        border-radius: 50%;
        transition: transform var(--transition-fast);
      }

      .toggle-switch.active::after {
        transform: translateX(16px);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: Boolean }) vimMode = false;

  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('keydown', this.handleKeyDown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.open) {
      this.close();
    }
  };

  private handleOverlayClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) {
      this.close();
    }
  }

  private close(): void {
    this.open = false;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private toggleVimMode(): void {
    this.vimMode = !this.vimMode;
    this.dispatchEvent(
      new CustomEvent('vim-mode-change', {
        detail: { enabled: this.vimMode },
        bubbles: true,
        composed: true,
      })
    );
  }

  private formatKeyCombo(shortcut: Shortcut): string[] {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const keys: string[] = [];

    if (shortcut.ctrl || shortcut.meta) {
      keys.push(isMac ? '⌘' : 'Ctrl');
    }
    if (shortcut.shift) keys.push(isMac ? '⇧' : 'Shift');
    if (shortcut.alt) keys.push(isMac ? '⌥' : 'Alt');

    // Format special keys
    let keyDisplay = shortcut.key;
    switch (shortcut.key.toLowerCase()) {
      case 'arrowup': keyDisplay = '↑'; break;
      case 'arrowdown': keyDisplay = '↓'; break;
      case 'arrowleft': keyDisplay = '←'; break;
      case 'arrowright': keyDisplay = '→'; break;
      case 'enter': keyDisplay = '↵'; break;
      case 'escape': keyDisplay = 'Esc'; break;
      case ' ': keyDisplay = 'Space'; break;
      default: keyDisplay = shortcut.key.toUpperCase();
    }
    keys.push(keyDisplay);

    return keys;
  }

  private renderShortcut(shortcut: Shortcut) {
    const keys = this.formatKeyCombo(shortcut);
    return html`
      <div class="shortcut-row">
        <span class="shortcut-description">${shortcut.description}</span>
        <div class="shortcut-keys">
          ${keys.map((key, i) => html`
            <span class="key">${key}</span>
            ${i < keys.length - 1 ? html`<span class="key-separator"></span>` : ''}
          `)}
        </div>
      </div>
    `;
  }

  render() {
    const shortcutsByCategory = keyboardService.getShortcutsByCategory();
    const categories = Array.from(shortcutsByCategory.entries());

    return html`
      <div class="overlay" @click=${this.handleOverlayClick}></div>
      <div class="dialog">
        <div class="header">
          <div class="header-left">
            <svg class="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="4" width="20" height="16" rx="2"></rect>
              <line x1="6" y1="8" x2="6" y2="8"></line>
              <line x1="10" y1="8" x2="10" y2="8"></line>
              <line x1="14" y1="8" x2="14" y2="8"></line>
              <line x1="18" y1="8" x2="18" y2="8"></line>
              <line x1="6" y1="12" x2="18" y2="12"></line>
              <line x1="6" y1="16" x2="6" y2="16"></line>
              <line x1="10" y1="16" x2="14" y2="16"></line>
              <line x1="18" y1="16" x2="18" y2="16"></line>
            </svg>
            <span class="title">Keyboard Shortcuts</span>
          </div>
          <button class="close-btn" @click=${this.close}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="content">
          ${categories.map(([category, shortcuts]) => html`
            <div class="category">
              <div class="category-title">${category}</div>
              <div class="shortcuts-list">
                ${shortcuts.map(s => this.renderShortcut(s))}
              </div>
            </div>
          `)}

          ${this.vimMode ? html`
            <div class="category">
              <div class="category-title">Vim Mode</div>
              <div class="shortcuts-list">
                <div class="shortcut-row">
                  <span class="shortcut-description">Previous commit</span>
                  <div class="shortcut-keys"><span class="key">K</span></div>
                </div>
                <div class="shortcut-row">
                  <span class="shortcut-description">Next commit</span>
                  <div class="shortcut-keys"><span class="key">J</span></div>
                </div>
                <div class="shortcut-row">
                  <span class="shortcut-description">First commit</span>
                  <div class="shortcut-keys">
                    <span class="key">G</span><span class="key">G</span>
                  </div>
                </div>
                <div class="shortcut-row">
                  <span class="shortcut-description">Last commit</span>
                  <div class="shortcut-keys">
                    <span class="key">Shift</span><span class="key">G</span>
                  </div>
                </div>
              </div>
            </div>
          ` : ''}
        </div>

        <div class="footer">
          <span>Press <span class="key">?</span> to toggle this help</span>
          <div class="vim-toggle">
            <label @click=${this.toggleVimMode}>Vim-style navigation</label>
            <div
              class="toggle-switch ${this.vimMode ? 'active' : ''}"
              @click=${this.toggleVimMode}
            ></div>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-keyboard-shortcuts-dialog': LvKeyboardShortcutsDialog;
  }
}
