/**
 * Profile Selector Component
 * Dropdown for quick profile switching in the toolbar
 * Updated to use unified profiles (git identity + integration accounts)
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { unifiedProfileStore, type AccountConnectionStatus } from '../../stores/unified-profile.store.ts';
import * as unifiedProfileService from '../../services/unified-profile.service.ts';
import type { UnifiedProfile } from '../../types/unified-profile.types.ts';
import { PROFILE_COLORS } from '../../types/unified-profile.types.ts';

@customElement('lv-profile-selector')
export class LvProfileSelector extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        position: relative;
      }

      .selector-btn {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        height: 32px;
        padding: 0 var(--spacing-sm);
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-text-secondary);
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .selector-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .selector-btn svg {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }

      .profile-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .profile-name {
        max-width: 100px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .chevron {
        opacity: 0.5;
      }

      /* Dropdown */
      .dropdown {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: var(--spacing-xs);
        min-width: 200px;
        background: var(--color-bg-primary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        z-index: var(--z-dropdown);
        overflow: hidden;
      }

      .dropdown-header {
        padding: var(--spacing-sm) var(--spacing-md);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom: 1px solid var(--color-border);
      }

      .dropdown-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        width: 100%;
        padding: var(--spacing-sm) var(--spacing-md);
        border: none;
        background: none;
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        text-align: left;
        cursor: pointer;
        transition: background var(--transition-fast);
      }

      .dropdown-item:hover {
        background: var(--color-bg-hover);
      }

      .dropdown-item.active {
        background: var(--color-accent-bg);
      }

      .dropdown-item .profile-color {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .dropdown-item .profile-info {
        flex: 1;
        min-width: 0;
      }

      .dropdown-item .profile-display-name {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
      }

      .dropdown-item .profile-email {
        font-size: var(--font-size-xs);
        color: var(--color-text-tertiary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .dropdown-item .check-icon {
        color: var(--color-accent);
      }

      .dropdown-divider {
        height: 1px;
        background: var(--color-border);
        margin: var(--spacing-xs) 0;
      }

      .dropdown-action {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        width: 100%;
        padding: var(--spacing-sm) var(--spacing-md);
        border: none;
        background: none;
        color: var(--color-text-secondary);
        font-size: var(--font-size-sm);
        text-align: left;
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .dropdown-action:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .dropdown-action svg {
        width: 14px;
        height: 14px;
      }

      .empty-state {
        padding: var(--spacing-md);
        text-align: center;
        color: var(--color-text-tertiary);
        font-size: var(--font-size-sm);
      }

      /* Connection status indicators */
      .connection-status {
        display: flex;
        gap: 2px;
        margin-left: auto;
      }

      .status-dot {
        width: 6px;
        height: 6px;
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

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }

      .profile-accounts-status {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        font-size: var(--font-size-xs);
        color: var(--color-text-tertiary);
      }

      .selector-btn.loading {
        opacity: 0.7;
        pointer-events: none;
      }

      .loading-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid var(--color-text-tertiary);
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `,
  ];

  @property({ type: String }) repoPath = '';

  @state() private profiles: UnifiedProfile[] = [];
  @state() private activeProfile: UnifiedProfile | null = null;
  @state() private accountConnectionStatus: Record<string, AccountConnectionStatus> = {};
  @state() private isOpen = false;
  @state() private isApplyingProfile = false;

  private unsubscribe?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    // Get initial state from unified profile store
    const initialState = unifiedProfileStore.getState();
    this.profiles = initialState.profiles;
    this.activeProfile = initialState.activeProfile;
    this.accountConnectionStatus = initialState.accountConnectionStatus;

    // Subscribe to store changes
    this.unsubscribe = unifiedProfileStore.subscribe((state) => {
      this.profiles = state.profiles;
      this.activeProfile = state.activeProfile;
      this.accountConnectionStatus = state.accountConnectionStatus;
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', this.handleDocumentClick);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    document.removeEventListener('click', this.handleDocumentClick);
  }

  private handleDocumentClick = (e: MouseEvent): void => {
    if (!this.contains(e.target as Node)) {
      this.isOpen = false;
    }
  };

  private toggleDropdown(e: Event): void {
    e.stopPropagation();
    this.isOpen = !this.isOpen;
  }

  private async handleSelectProfile(profile: UnifiedProfile): Promise<void> {
    if (!this.repoPath || this.isApplyingProfile) return;

    this.isOpen = false;
    this.isApplyingProfile = true;

    try {
      // Apply the unified profile (sets git identity)
      await unifiedProfileService.applyUnifiedProfile(this.repoPath, profile.id);
    } finally {
      this.isApplyingProfile = false;
    }
  }

  private handleOpenManager(): void {
    this.isOpen = false;
    this.dispatchEvent(
      new CustomEvent('open-profile-manager', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private getAccountStatus(accountId: string): 'connected' | 'disconnected' | 'checking' | 'unknown' {
    return this.accountConnectionStatus[accountId]?.status ?? 'unknown';
  }

  private getProfileConnectionSummary(profile: UnifiedProfile): { connected: number; disconnected: number; checking: number; unknown: number } {
    const summary = { connected: 0, disconnected: 0, checking: 0, unknown: 0 };
    for (const account of profile.integrationAccounts) {
      const status = this.getAccountStatus(account.id);
      summary[status]++;
    }
    return summary;
  }

  render() {
    return html`
      <button class="selector-btn ${this.isApplyingProfile ? 'loading' : ''}" @click=${this.toggleDropdown} title="Git Profile">
        ${this.isApplyingProfile
          ? html`<span class="loading-spinner"></span>`
          : this.activeProfile
            ? html`
                <span
                  class="profile-indicator"
                  style="background: ${this.activeProfile.color ?? PROFILE_COLORS[0]}"
                ></span>
                <span class="profile-name">${this.activeProfile.name}</span>
              `
            : html`
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              `}
        <svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      ${this.isOpen ? this.renderDropdown() : nothing}
    `;
  }

  private renderDropdown() {
    return html`
      <div class="dropdown">
        <div class="dropdown-header">Profiles</div>
        ${this.profiles.length === 0
          ? html`<div class="empty-state">No profiles configured</div>`
          : this.profiles.map(
              (profile) => {
                const totalAccounts = profile.integrationAccounts.length;
                const connectionSummary = this.getProfileConnectionSummary(profile);
                return html`
                  <button
                    class="dropdown-item ${this.activeProfile?.id === profile.id ? 'active' : ''}"
                    @click=${() => this.handleSelectProfile(profile)}
                  >
                    <span
                      class="profile-color"
                      style="background: ${profile.color ?? PROFILE_COLORS[0]}"
                    ></span>
                    <span class="profile-info">
                      <span class="profile-display-name">
                        ${profile.name}
                        ${profile.isDefault ? html`<span style="font-size: 10px; opacity: 0.6">(default)</span>` : nothing}
                      </span>
                      <span class="profile-email">
                        ${profile.gitEmail}
                        ${totalAccounts > 0 ? html` · ${totalAccounts} account${totalAccounts > 1 ? 's' : ''}` : nothing}
                      </span>
                    </span>
                    ${totalAccounts > 0
                      ? html`
                          <span class="connection-status" title="${connectionSummary.connected} connected, ${connectionSummary.disconnected} disconnected">
                            ${connectionSummary.connected > 0 ? html`<span class="status-dot connected"></span>` : nothing}
                            ${connectionSummary.checking > 0 ? html`<span class="status-dot checking"></span>` : nothing}
                            ${connectionSummary.disconnected > 0 ? html`<span class="status-dot disconnected"></span>` : nothing}
                            ${connectionSummary.unknown > 0 && connectionSummary.connected === 0 && connectionSummary.disconnected === 0 && connectionSummary.checking === 0 ? html`<span class="status-dot unknown"></span>` : nothing}
                          </span>
                        `
                      : nothing}
                    ${this.activeProfile?.id === profile.id
                      ? html`
                          <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        `
                      : nothing}
                  </button>
                `;
              }
            )}
        <div class="dropdown-divider"></div>
        <button class="dropdown-action" @click=${this.handleOpenManager}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
          Manage Profiles...
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-profile-selector': LvProfileSelector;
  }
}
