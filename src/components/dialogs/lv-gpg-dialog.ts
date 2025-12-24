/**
 * GPG Dialog Component
 * Manage GPG signing configuration
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import type { GpgConfig, GpgKey } from '../../services/git.service.ts';

@customElement('lv-gpg-dialog')
export class LvGpgDialog extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      .dialog-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: var(--z-modal);
      }

      .dialog {
        background: var(--color-bg-primary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        width: 500px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: var(--shadow-xl);
      }

      .dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md);
        border-bottom: 1px solid var(--color-border);
      }

      .dialog-title {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .dialog-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-md);
      }

      .dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
        padding: var(--spacing-md);
        border-top: 1px solid var(--color-border);
      }

      .close-btn {
        background: none;
        border: none;
        padding: var(--spacing-xs);
        cursor: pointer;
        color: var(--color-text-secondary);
        border-radius: var(--radius-sm);
      }

      .close-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      /* Status section */
      .status-section {
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        margin-bottom: var(--spacing-md);
      }

      .status-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .status-label {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
      }

      .status-value {
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
      }

      .status-badge {
        padding: 2px 8px;
        border-radius: var(--radius-xs);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
      }

      .status-badge.available {
        background: var(--color-success-bg);
        color: var(--color-success);
      }

      .status-badge.unavailable {
        background: var(--color-error-bg);
        color: var(--color-error);
      }

      /* Section */
      .section {
        margin-bottom: var(--spacing-lg);
      }

      .section-title {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
        margin-bottom: var(--spacing-sm);
      }

      /* Toggle */
      .toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) 0;
        border-bottom: 1px solid var(--color-border);
      }

      .toggle-row:last-child {
        border-bottom: none;
      }

      .toggle-label {
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
      }

      .toggle-desc {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        margin-top: 2px;
      }

      .toggle {
        position: relative;
        width: 40px;
        height: 22px;
        flex-shrink: 0;
      }

      .toggle input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .toggle-slider {
        position: absolute;
        cursor: pointer;
        inset: 0;
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: 11px;
        transition: all var(--transition-fast);
      }

      .toggle-slider::before {
        position: absolute;
        content: "";
        height: 16px;
        width: 16px;
        left: 2px;
        bottom: 2px;
        background: var(--color-text-muted);
        border-radius: 50%;
        transition: all var(--transition-fast);
      }

      .toggle input:checked + .toggle-slider {
        background: var(--color-primary);
        border-color: var(--color-primary);
      }

      .toggle input:checked + .toggle-slider::before {
        transform: translateX(18px);
        background: white;
      }

      /* Key list */
      .key-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .key-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm);
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .key-item:hover {
        background: var(--color-bg-hover);
      }

      .key-item.selected {
        border-color: var(--color-primary);
        background: rgba(59, 130, 246, 0.05);
      }

      .key-radio {
        width: 16px;
        height: 16px;
        border: 2px solid var(--color-border);
        border-radius: 50%;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .key-item.selected .key-radio {
        border-color: var(--color-primary);
      }

      .key-item.selected .key-radio::after {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--color-primary);
      }

      .key-info {
        flex: 1;
        min-width: 0;
      }

      .key-user {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .key-details {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        font-family: var(--font-family-mono);
      }

      .key-badge {
        padding: 2px 6px;
        border-radius: var(--radius-xs);
        font-size: var(--font-size-xs);
        background: var(--color-bg-tertiary);
        color: var(--color-text-secondary);
      }

      .empty-text {
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
        text-align: center;
        padding: var(--spacing-md);
      }

      /* Buttons */
      .btn {
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .btn-secondary {
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        color: var(--color-text-primary);
      }

      .btn-secondary:hover {
        background: var(--color-bg-hover);
      }

      .btn-primary {
        background: var(--color-primary);
        border: 1px solid var(--color-primary);
        color: white;
      }

      .btn-primary:hover {
        background: var(--color-primary-hover);
      }

      .message {
        padding: var(--spacing-sm);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);
        margin-bottom: var(--spacing-md);
      }

      .message.error {
        background: var(--color-error-bg);
        border: 1px solid var(--color-error);
        color: var(--color-error);
      }

      .message.success {
        background: var(--color-success-bg);
        border: 1px solid var(--color-success);
        color: var(--color-success);
      }

      .message.warning {
        background: rgba(245, 158, 11, 0.1);
        border: 1px solid rgb(245, 158, 11);
        color: rgb(245, 158, 11);
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-lg);
        color: var(--color-text-secondary);
      }

      /* Scope toggle */
      .scope-toggle {
        display: flex;
        gap: var(--spacing-xs);
        margin-bottom: var(--spacing-md);
      }

      .scope-btn {
        padding: var(--spacing-xs) var(--spacing-sm);
        border: 1px solid var(--color-border);
        background: var(--color-bg-secondary);
        color: var(--color-text-secondary);
        font-size: var(--font-size-xs);
        border-radius: var(--radius-sm);
        cursor: pointer;
      }

      .scope-btn.active {
        background: var(--color-primary);
        border-color: var(--color-primary);
        color: white;
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: String }) repositoryPath = '';

  @state() private config: GpgConfig | null = null;
  @state() private keys: GpgKey[] = [];
  @state() private selectedKey: string | null = null;
  @state() private loading = false;
  @state() private error = '';
  @state() private success = '';
  @state() private globalScope = false;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    if (this.open) {
      await this.loadData();
    }
  }

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('open') && this.open) {
      await this.loadData();
    }
  }

  private async loadData(): Promise<void> {
    this.loading = true;
    this.error = '';

    const [configResult, keysResult] = await Promise.all([
      gitService.getGpgConfig(this.repositoryPath),
      gitService.getGpgKeys(this.repositoryPath),
    ]);

    if (configResult.success && configResult.data) {
      this.config = configResult.data;
      this.selectedKey = configResult.data.signingKey;
    } else {
      this.error = configResult.error?.message || 'Failed to load GPG config';
    }

    if (keysResult.success && keysResult.data) {
      this.keys = keysResult.data;
    }

    this.loading = false;
  }

  private async handleToggleCommitSigning(): Promise<void> {
    if (!this.config) return;

    this.loading = true;
    this.error = '';

    const result = await gitService.setCommitSigning(
      this.repositoryPath,
      !this.config.signCommits,
      this.globalScope
    );

    if (result.success) {
      this.config = { ...this.config, signCommits: !this.config.signCommits };
      this.success = `Commit signing ${this.config.signCommits ? 'enabled' : 'disabled'}`;
      this.dispatchEvent(new CustomEvent('gpg-changed'));
    } else {
      this.error = result.error?.message || 'Failed to update setting';
    }

    this.loading = false;
  }

  private async handleToggleTagSigning(): Promise<void> {
    if (!this.config) return;

    this.loading = true;
    this.error = '';

    const result = await gitService.setTagSigning(
      this.repositoryPath,
      !this.config.signTags,
      this.globalScope
    );

    if (result.success) {
      this.config = { ...this.config, signTags: !this.config.signTags };
      this.success = `Tag signing ${this.config.signTags ? 'enabled' : 'disabled'}`;
      this.dispatchEvent(new CustomEvent('gpg-changed'));
    } else {
      this.error = result.error?.message || 'Failed to update setting';
    }

    this.loading = false;
  }

  private async handleSelectKey(keyId: string): Promise<void> {
    this.loading = true;
    this.error = '';

    const result = await gitService.setSigningKey(
      this.repositoryPath,
      keyId,
      this.globalScope
    );

    if (result.success) {
      this.selectedKey = keyId;
      this.success = 'Signing key updated';
      this.dispatchEvent(new CustomEvent('gpg-changed'));
    } else {
      this.error = result.error?.message || 'Failed to set signing key';
    }

    this.loading = false;
  }

  private handleClose(): void {
    this.dispatchEvent(new CustomEvent('close'));
  }

  render() {
    if (!this.open) return null;

    return html`
      <div class="dialog-overlay" @click=${this.handleClose}>
        <div class="dialog" @click=${(e: Event) => e.stopPropagation()}>
          <div class="dialog-header">
            <span class="dialog-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              GPG Signing
            </span>
            <button class="close-btn" @click=${this.handleClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <div class="dialog-content">
            ${this.loading ? html`<div class="loading">Loading...</div>` : ''}

            ${this.error ? html`<div class="message error">${this.error}</div>` : ''}

            ${this.success ? html`<div class="message success">${this.success}</div>` : ''}

            ${!this.loading && this.config ? this.renderContent() : ''}
          </div>

          <div class="dialog-footer">
            <button class="btn btn-secondary" @click=${this.handleClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderContent() {
    if (!this.config) return '';

    if (!this.config.gpgAvailable) {
      return html`
        <div class="message warning">
          GPG is not installed or not available in PATH.
          <br><br>
          Install GPG to enable commit and tag signing.
        </div>
      `;
    }

    return html`
      <div class="status-section">
        <div class="status-row">
          <span class="status-label">GPG Status</span>
          <span class="status-badge available">Available</span>
        </div>
        <div class="status-row" style="margin-top: var(--spacing-xs);">
          <span class="status-label">Version</span>
          <span class="status-value">${this.config.gpgVersion || 'Unknown'}</span>
        </div>
      </div>

      <div class="scope-toggle">
        <button
          class="scope-btn ${!this.globalScope ? 'active' : ''}"
          @click=${() => { this.globalScope = false; }}
        >
          This Repository
        </button>
        <button
          class="scope-btn ${this.globalScope ? 'active' : ''}"
          @click=${() => { this.globalScope = true; }}
        >
          Global
        </button>
      </div>

      <div class="section">
        <div class="section-title">Signing Options</div>
        <div class="toggle-row">
          <div>
            <div class="toggle-label">Sign commits</div>
            <div class="toggle-desc">Automatically sign all commits with GPG</div>
          </div>
          <label class="toggle">
            <input
              type="checkbox"
              .checked=${this.config.signCommits}
              @change=${this.handleToggleCommitSigning}
              ?disabled=${this.loading}
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="toggle-row">
          <div>
            <div class="toggle-label">Sign tags</div>
            <div class="toggle-desc">Automatically sign all tags with GPG</div>
          </div>
          <label class="toggle">
            <input
              type="checkbox"
              .checked=${this.config.signTags}
              @change=${this.handleToggleTagSigning}
              ?disabled=${this.loading}
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Signing Key</div>
        ${this.keys.length === 0
          ? html`
              <div class="empty-text">
                No GPG keys found. Generate a key with:<br>
                <code style="font-size: var(--font-size-xs);">gpg --full-generate-key</code>
              </div>
            `
          : html`
              <div class="key-list">
                ${this.keys.map(
                  (key) => html`
                    <div
                      class="key-item ${this.selectedKey === key.keyId || this.selectedKey === key.keyIdLong ? 'selected' : ''}"
                      @click=${() => this.handleSelectKey(key.keyIdLong)}
                    >
                      <div class="key-radio"></div>
                      <div class="key-info">
                        <div class="key-user">${key.userId || key.email}</div>
                        <div class="key-details">${key.keyType} ${key.keySize} / ${key.keyId}</div>
                      </div>
                      <span class="key-badge">${key.trust}</span>
                    </div>
                  `
                )}
              </div>
            `}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-gpg-dialog': LvGpgDialog;
  }
}
