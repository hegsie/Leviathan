/**
 * Integration Card Component
 * Displays a single integration account with connection status
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { sharedStyles, animationStyles } from '../../styles/shared-styles.ts';
import type { IntegrationAccount, IntegrationType } from '../../types/unified-profile.types.ts';
import { INTEGRATION_TYPE_NAMES } from '../../types/integration-accounts.types.ts';
import type { ConnectionStatus } from '../../stores/unified-profile.store.ts';

@customElement('lv-integration-card')
export class LvIntegrationCard extends LitElement {
  static styles = [
    sharedStyles,
    animationStyles,
    css`
      :host {
        display: block;
      }

      .card {
        background: var(--color-bg-primary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        transition: all var(--transition-fast);
      }

      .card:hover {
        border-color: var(--color-border-strong);
        box-shadow: var(--shadow-sm);
      }

      .card.connected {
        border-left: 3px solid var(--color-success, #22c55e);
      }

      .card.disconnected {
        border-left: 3px solid var(--color-error, #ef4444);
      }

      .card.checking {
        border-left: 3px solid var(--color-warning, #f59e0b);
      }

      .card-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        margin-bottom: var(--spacing-sm);
      }

      .account-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        min-width: 0;
      }

      .integration-icon {
        width: 24px;
        height: 24px;
        flex-shrink: 0;
        color: var(--color-text-secondary);
      }

      .account-details {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .account-name {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
      }

      .type-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 6px;
        font-size: 10px;
        font-weight: var(--font-weight-medium);
        color: var(--color-text-tertiary);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-xs);
        text-transform: uppercase;
      }

      .default-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 6px;
        font-size: 10px;
        font-weight: var(--font-weight-medium);
        color: var(--color-accent);
        background: var(--color-accent-bg);
        border-radius: var(--radius-xs);
      }

      .card-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
      }

      .action-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-text-tertiary);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .action-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .action-btn svg {
        width: 14px;
        height: 14px;
      }

      .action-btn.spinning svg {
        animation: spin 1s linear infinite;
      }

      /* spin animation imported from animationStyles */

      /* User info */
      .user-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-sm);
        padding-top: var(--spacing-sm);
        border-top: 1px solid var(--color-border);
      }

      .user-avatar {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--color-bg-tertiary);
        overflow: hidden;
      }

      .user-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .avatar-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-tertiary);
      }

      .avatar-placeholder svg {
        width: 16px;
        height: 16px;
      }

      .user-details {
        display: flex;
        flex-direction: column;
        min-width: 0;
        flex: 1;
      }

      .user-name {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .user-handle {
        font-size: var(--font-size-xs);
        color: var(--color-text-tertiary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Status indicator */
      .status-indicator {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        font-size: var(--font-size-xs);
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }

      .status-dot.connected {
        background: var(--color-success, #22c55e);
      }

      .status-dot.disconnected {
        background: var(--color-error, #ef4444);
      }

      .status-dot.checking {
        background: var(--color-warning, #f59e0b);
        animation: pulse 1s ease-in-out infinite;
      }

      .status-dot.unknown {
        background: var(--color-text-tertiary);
        opacity: 0.5;
      }

      /* pulse animation imported from animationStyles */

      .status-text {
        color: var(--color-text-tertiary);
      }

      .status-text.connected {
        color: var(--color-success, #22c55e);
      }

      .status-text.disconnected {
        color: var(--color-error, #ef4444);
      }
    `,
  ];

  @property({ type: Object }) account: IntegrationAccount | null = null;
  @property({ type: String }) connectionStatus: ConnectionStatus = 'unknown';
  @property({ type: Boolean }) isProfileDefault = false;

  private handleOpenDialog(): void {
    this.dispatchEvent(new CustomEvent('open-dialog', { bubbles: true, composed: true }));
  }

  private handleRefresh(): void {
    if (!this.account) return;
    this.dispatchEvent(new CustomEvent('refresh-account', {
      detail: { accountId: this.account.id },
      bubbles: true,
      composed: true
    }));
  }

  private getIntegrationIcon(type: IntegrationType) {
    switch (type) {
      case 'github':
        return html`<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>`;
      case 'gitlab':
        return html`<svg viewBox="0 0 16 16" fill="currentColor"><path d="m15.734 6.1-.022-.058L13.534.358a.568.568 0 0 0-.563-.356.583.583 0 0 0-.328.122.582.582 0 0 0-.193.294l-1.47 4.499H5.025l-1.47-4.5a.572.572 0 0 0-.193-.294.583.583 0 0 0-.328-.122.568.568 0 0 0-.563.357L.289 6.04l-.022.057a4.044 4.044 0 0 0 1.342 4.681l.007.006.02.014 3.318 2.485 1.642 1.242 1 .755a.672.672 0 0 0 .814 0l1-.755 1.642-1.242 3.338-2.5.009-.007a4.046 4.046 0 0 0 1.34-4.678z"/></svg>`;
      case 'azure-devops':
        return html`<svg viewBox="0 0 16 16" fill="currentColor"><path d="M15 3.622v8.512L11.5 15l-5.425-1.975v1.958L3.004 10.97l8.951.7V4.005L15 3.622zm-2.984.428L6.994 1v2.001L2.383 4.356l-.383 8.087 1.575 1.557V6.563z"/></svg>`;
      case 'bitbucket':
        return html`<svg viewBox="0 0 16 16" fill="currentColor"><path d="M.778 1.211a.768.768 0 0 0-.768.892l2.06 12.484a1.044 1.044 0 0 0 1.02.88h9.947c.396 0 .736-.282.803-.68l2.06-12.684a.768.768 0 0 0-.768-.892H.778zM9.69 10.6H6.344l-.9-4.801h5.15l-.904 4.8z"/></svg>`;
    }
  }

  private getStatusText(): string {
    switch (this.connectionStatus) {
      case 'connected':
        return 'Connected';
      case 'disconnected':
        return 'Disconnected';
      case 'checking':
        return 'Checking...';
      default:
        return 'Unknown';
    }
  }

  render() {
    if (!this.account) {
      return nothing;
    }

    const { integrationType, name, cachedUser } = this.account;

    return html`
      <div class="card ${this.connectionStatus}">
        <div class="card-header">
          <div class="account-info">
            <div class="integration-icon">
              ${this.getIntegrationIcon(integrationType)}
            </div>
            <div class="account-details">
              <div class="account-name">
                ${name}
                ${this.isProfileDefault
                  ? html`<span class="default-badge">Default</span>`
                  : nothing}
              </div>
              <span class="type-badge">${INTEGRATION_TYPE_NAMES[integrationType]}</span>
            </div>
          </div>

          <div class="card-actions">
            <button
              class="action-btn ${this.connectionStatus === 'checking' ? 'spinning' : ''}"
              @click=${this.handleRefresh}
              title="Refresh connection"
              ?disabled=${this.connectionStatus === 'checking'}
            >
              <svg viewBox="0 0 16 16" fill="currentColor">
                <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
              </svg>
            </button>
            <button class="action-btn" @click=${this.handleOpenDialog} title="Open ${INTEGRATION_TYPE_NAMES[integrationType]}">
              <svg viewBox="0 0 16 16" fill="currentColor">
                <path fill-rule="evenodd" d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"/>
                <path fill-rule="evenodd" d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5z"/>
              </svg>
            </button>
          </div>
        </div>

        ${cachedUser
          ? html`
              <div class="user-info">
                <div class="user-avatar">
                  ${cachedUser.avatarUrl
                    ? html`<img src="${cachedUser.avatarUrl}" alt="${cachedUser.username}" />`
                    : html`
                        <div class="avatar-placeholder">
                          <svg viewBox="0 0 16 16" fill="currentColor">
                            <path d="M11 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"/>
                            <path fill-rule="evenodd" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8-7a7 7 0 0 0-5.468 11.37C3.242 11.226 4.805 10 8 10s4.757 1.225 5.468 2.37A7 7 0 0 0 8 1z"/>
                          </svg>
                        </div>
                      `}
                </div>
                <div class="user-details">
                  <span class="user-name">${cachedUser.displayName || cachedUser.username}</span>
                  <span class="user-handle">@${cachedUser.username}</span>
                </div>
                <div class="status-indicator">
                  <div class="status-dot ${this.connectionStatus}"></div>
                  <span class="status-text ${this.connectionStatus}">${this.getStatusText()}</span>
                </div>
              </div>
            `
          : html`
              <div class="user-info">
                <div class="status-indicator">
                  <div class="status-dot ${this.connectionStatus}"></div>
                  <span class="status-text ${this.connectionStatus}">${this.getStatusText()}</span>
                </div>
              </div>
            `}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-integration-card': LvIntegrationCard;
  }
}
