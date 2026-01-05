/**
 * Context Dashboard Component
 * Expandable/collapsible dashboard showing repository context:
 * - Active profile with git identity
 * - Connected integration accounts with status
 * - Repository information
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles, animationStyles } from '../../styles/shared-styles.ts';
import { unifiedProfileStore, type AccountConnectionStatus, type ConnectionStatus } from '../../stores/unified-profile.store.ts';
import { repositoryStore, type OpenRepository } from '../../stores/repository.store.ts';
import * as unifiedProfileService from '../../services/unified-profile.service.ts';
import type { UnifiedProfile, IntegrationAccount, IntegrationType, ProfileAssignmentSource } from '../../types/unified-profile.types.ts';
import { INTEGRATION_TYPE_NAMES } from '../../types/integration-accounts.types.ts';
import './lv-profile-card.ts';
import './lv-integration-card.ts';
import './lv-repository-card.ts';

const STORAGE_KEY = 'lv-context-dashboard-expanded';

@customElement('lv-context-dashboard')
export class LvContextDashboard extends LitElement {
  static styles = [
    sharedStyles,
    animationStyles,
    css`
      :host {
        display: block;
      }

      /* Compact View */
      .dashboard-compact {
        display: flex;
        align-items: center;
        height: 36px;
        padding: 0 var(--spacing-md);
        background: var(--color-bg-secondary);
        border-bottom: 1px solid var(--color-border);
        gap: var(--spacing-md);
      }

      .compact-profile {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        min-width: 0;
      }

      .profile-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .profile-name {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        white-space: nowrap;
      }

      .compact-identity {
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 200px;
      }

      .compact-divider {
        width: 1px;
        height: 16px;
        background: var(--color-border);
      }

      .compact-accounts {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
      }

      .account-status-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        padding: 0;
        border: none;
        border-radius: 50%;
        background: transparent;
        cursor: pointer;
        transition: transform var(--transition-fast);
      }

      .account-status-btn:hover {
        transform: scale(1.2);
      }

      .account-status-btn:focus {
        outline: 2px solid var(--color-accent);
        outline-offset: 1px;
      }

      .account-status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        pointer-events: none;
      }

      .account-status-dot.connected {
        background: var(--color-success, #22c55e);
      }

      .account-status-dot.disconnected {
        background: var(--color-error, #ef4444);
      }

      .account-status-dot.checking {
        background: var(--color-warning, #f59e0b);
        animation: pulse 1s ease-in-out infinite;
      }

      .account-status-dot.unknown {
        background: var(--color-text-tertiary);
        opacity: 0.5;
      }

      /* Configure button for unconfigured integrations */
      .configure-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-xs) var(--spacing-sm);
        border: 1px dashed var(--color-border);
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-text-secondary);
        font-size: var(--font-size-xs);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .configure-btn:hover {
        border-color: var(--color-accent);
        color: var(--color-accent);
        background: var(--color-accent-bg);
      }

      /* Configure card for expanded view */
      .configure-card {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        background: var(--color-bg-primary);
        border: 1px dashed var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
      }

      .configure-card-icon {
        width: 32px;
        height: 32px;
        flex-shrink: 0;
        color: var(--color-text-tertiary);
      }

      .configure-card-icon svg {
        width: 100%;
        height: 100%;
      }

      .configure-card-content {
        flex: 1;
        min-width: 0;
      }

      .configure-card-title {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        margin-bottom: var(--spacing-xs);
      }

      .configure-card-description {
        font-size: var(--font-size-xs);
        color: var(--color-text-tertiary);
        line-height: 1.4;
      }

      .configure-card-btn {
        padding: var(--spacing-xs) var(--spacing-md);
        border: 1px solid var(--color-accent);
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-accent);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        transition: all var(--transition-fast);
        flex-shrink: 0;
      }

      .configure-card-btn:hover {
        background: var(--color-accent);
        color: white;
      }

      /* pulse animation imported from animationStyles */

      .expand-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        margin-left: auto;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-text-tertiary);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .expand-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .expand-btn svg {
        width: 16px;
        height: 16px;
        transition: transform var(--transition-fast);
      }

      .expand-btn.expanded svg {
        transform: rotate(180deg);
      }

      /* Expanded View */
      .dashboard-expanded {
        background: var(--color-bg-secondary);
        border-bottom: 1px solid var(--color-border);
        padding: var(--spacing-md);
        animation: slideDown 0.2s ease-out;
      }

      /* slideDown animation imported from animationStyles */

      .dashboard-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--spacing-md);
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
      }

      .dashboard-title {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: var(--spacing-md);
      }

      /* Empty states */
      .no-profile {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-size: var(--font-size-sm);
        color: var(--color-text-tertiary);
      }

      .no-profile-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-xs) var(--spacing-sm);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-text-secondary);
        font-size: var(--font-size-xs);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .no-profile-btn:hover {
        border-color: var(--color-accent);
        color: var(--color-accent);
      }

      .no-profile-btn svg {
        width: 12px;
        height: 12px;
      }

      /* Profile Selector */
      .profile-selector {
        position: relative;
      }

      .profile-selector-btn {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs) var(--spacing-sm);
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .profile-selector-btn:hover {
        background: var(--color-bg-hover);
      }

      .profile-selector-btn.loading {
        opacity: 0.7;
        pointer-events: none;
      }

      .profile-selector-btn .chevron {
        width: 12px;
        height: 12px;
        color: var(--color-text-tertiary);
        transition: transform var(--transition-fast);
      }

      .profile-selector-btn.open .chevron {
        transform: rotate(180deg);
      }

      .profile-dropdown {
        position: absolute;
        top: 100%;
        left: 0;
        margin-top: var(--spacing-xs);
        min-width: 220px;
        background: var(--color-bg-primary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        z-index: var(--z-dropdown, 100);
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

      .dropdown-item .default-tag {
        font-size: 10px;
        opacity: 0.6;
      }

      .dropdown-item .profile-email {
        font-size: var(--font-size-xs);
        color: var(--color-text-tertiary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .dropdown-item .check-icon {
        width: 14px;
        height: 14px;
        color: var(--color-accent);
        flex-shrink: 0;
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

      .dropdown-empty {
        padding: var(--spacing-md);
        text-align: center;
        color: var(--color-text-tertiary);
        font-size: var(--font-size-sm);
      }

      .loading-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid var(--color-text-tertiary);
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
    `,
  ];

  @state() private isExpanded = false;
  @state() private activeProfile: UnifiedProfile | null = null;
  @state() private profiles: UnifiedProfile[] = [];
  @state() private accounts: IntegrationAccount[] = [];
  @state() private accountConnectionStatus: Record<string, AccountConnectionStatus> = {};
  @state() private activeRepository: OpenRepository | null = null;
  @state() private repositoryAssignments: Record<string, string> = {};
  @state() private isProfileDropdownOpen = false;
  @state() private isApplyingProfile = false;

  private unsubscribeProfile?: () => void;
  private unsubscribeRepo?: () => void;

  connectedCallback(): void {
    super.connectedCallback();

    // Load persisted expand state (with fallback for private browsing)
    try {
      this.isExpanded = localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      this.isExpanded = false;
    }

    // Get initial state
    const profileState = unifiedProfileStore.getState();
    this.activeProfile = profileState.activeProfile;
    this.profiles = profileState.profiles;
    this.accounts = profileState.accounts;
    this.accountConnectionStatus = profileState.accountConnectionStatus;
    this.repositoryAssignments = profileState.config?.repositoryAssignments ?? {};

    const repoState = repositoryStore.getState();
    this.activeRepository = repoState.getActiveRepository();

    // Subscribe to store changes
    this.unsubscribeProfile = unifiedProfileStore.subscribe((state) => {
      this.activeProfile = state.activeProfile;
      this.profiles = state.profiles;
      this.accounts = state.accounts;
      this.accountConnectionStatus = state.accountConnectionStatus;
      this.repositoryAssignments = state.config?.repositoryAssignments ?? {};
    });

    this.unsubscribeRepo = repositoryStore.subscribe((state) => {
      this.activeRepository = state.getActiveRepository();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', this.handleDocumentClick);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeProfile?.();
    this.unsubscribeRepo?.();
    document.removeEventListener('click', this.handleDocumentClick);
  }

  private handleDocumentClick = (e: MouseEvent): void => {
    if (!this.contains(e.target as Node)) {
      this.isProfileDropdownOpen = false;
    }
  };

  private toggleExpanded(): void {
    this.isExpanded = !this.isExpanded;
    try {
      localStorage.setItem(STORAGE_KEY, String(this.isExpanded));
    } catch {
      // Ignore localStorage errors (e.g., private browsing mode)
    }
  }

  private toggleProfileDropdown(e: Event): void {
    e.stopPropagation();
    this.isProfileDropdownOpen = !this.isProfileDropdownOpen;
  }

  private async handleSelectProfile(profile: UnifiedProfile): Promise<void> {
    if (!this.activeRepository || this.isApplyingProfile) return;

    this.isProfileDropdownOpen = false;
    this.isApplyingProfile = true;

    try {
      await unifiedProfileService.applyUnifiedProfile(
        this.activeRepository.repository.path,
        profile.id
      );
    } finally {
      this.isApplyingProfile = false;
    }
  }

  private getAccountStatus(accountId: string): ConnectionStatus {
    return this.accountConnectionStatus[accountId]?.status ?? 'unknown';
  }

  private isProfileDefaultAccount(account: IntegrationAccount): boolean {
    if (!this.activeProfile) return false;
    const defaultAccountId = this.activeProfile.defaultAccounts[account.integrationType];
    return defaultAccountId === account.id;
  }

  private getProfileAssignmentSource(): ProfileAssignmentSource {
    if (!this.activeRepository || !this.activeProfile) return 'none';

    const repoPath = this.activeRepository.repository.path;

    // Check if manually assigned
    if (this.repositoryAssignments[repoPath] === this.activeProfile.id) {
      return 'manual';
    }

    // Check if matched by URL pattern against remote URLs
    if (this.activeProfile.urlPatterns.length > 0 && this.activeRepository.remotes?.length) {
      const matchesPattern = this.activeRepository.remotes.some((remote) =>
        this.activeProfile!.urlPatterns.some((pattern) =>
          this.matchUrlPattern(remote.url, pattern)
        )
      );
      if (matchesPattern) {
        return 'url-pattern';
      }
    }

    // Check if it's the default profile
    if (this.activeProfile.isDefault) {
      return 'default';
    }

    return 'none';
  }

  /**
   * Match a URL against a pattern with glob-style wildcards
   * Supports * for single segment and ** for multiple segments
   */
  private matchUrlPattern(url: string, pattern: string): boolean {
    // Normalize URL - remove protocol, .git suffix, and convert to lowercase
    const normalizedUrl = url.toLowerCase()
      .replace(/^(https?:\/\/|git@|ssh:\/\/)/, '')
      .replace(/\.git$/, '')
      .replace(':', '/'); // Convert git@host:path to host/path

    // Normalize pattern similarly
    const normalizedPattern = pattern.toLowerCase()
      .replace(/^(https?:\/\/|git@|ssh:\/\/)/, '')
      .replace(/\.git$/, '')
      .replace(':', '/');

    // Convert glob pattern to regex
    // Escape special regex chars except *
    const regexPattern = normalizedPattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/{{GLOBSTAR}}/g, '.*');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(normalizedUrl);
  }

  private detectProvider(): IntegrationType | null {
    if (!this.activeRepository?.remotes?.length) return null;

    for (const remote of this.activeRepository.remotes) {
      const url = remote.url.toLowerCase();
      if (url.includes('github.com')) return 'github';
      if (url.includes('gitlab.com') || url.includes('gitlab')) return 'gitlab';
      if (url.includes('dev.azure.com') || url.includes('visualstudio.com')) return 'azure-devops';
      if (url.includes('bitbucket.org') || url.includes('bitbucket')) return 'bitbucket';
    }

    return null;
  }

  /**
   * Get the relevant integration account for the current repository.
   * Returns the profile's default account for the detected provider, or null if not configured.
   */
  private getRelevantAccount(): IntegrationAccount | null {
    const provider = this.detectProvider();
    if (!provider) return null;

    // Get the default account ID for this provider from the active profile
    const defaultAccountId = this.activeProfile?.defaultAccounts[provider];
    if (defaultAccountId) {
      const account = this.accounts.find((a) => a.id === defaultAccountId);
      if (account) return account;
    }

    // Fall back to any account of this provider type
    return this.accounts.find((a) => a.integrationType === provider) ?? null;
  }

  private getProviderIcon(type: IntegrationType) {
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

  private openProfileManager(): void {
    this.dispatchEvent(new CustomEvent('open-profile-manager', { bubbles: true, composed: true }));
  }

  private openIntegrationDialog(type: IntegrationType): void {
    this.dispatchEvent(new CustomEvent(`open-${type}`, { bubbles: true, composed: true }));
  }

  private handleRefreshAccount(e: CustomEvent<{ accountId: string }>): void {
    this.dispatchEvent(new CustomEvent('refresh-account', {
      detail: e.detail,
      bubbles: true,
      composed: true
    }));
  }

  private renderProfileDropdown() {
    return html`
      <div class="profile-dropdown">
        <div class="dropdown-header">Switch Profile</div>
        ${this.profiles.length > 0
          ? this.profiles.map((profile) => html`
              <button
                class="dropdown-item ${profile.id === this.activeProfile?.id ? 'active' : ''}"
                @click=${() => this.handleSelectProfile(profile)}
              >
                <span
                  class="profile-color"
                  style="background: ${profile.color}"
                ></span>
                <div class="profile-info">
                  <div class="profile-display-name">
                    ${profile.name}
                    ${profile.isDefault ? html`<span class="default-tag">(default)</span>` : nothing}
                  </div>
                  <div class="profile-email">${profile.gitEmail}</div>
                </div>
                ${profile.id === this.activeProfile?.id
                  ? html`
                      <svg class="check-icon" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
                      </svg>
                    `
                  : nothing}
              </button>
            `)
          : html`<div class="dropdown-empty">No profiles configured</div>`}
        <div class="dropdown-divider"></div>
        <button class="dropdown-action" @click=${this.openProfileManager}>
          <svg viewBox="0 0 16 16" fill="currentColor">
            <path fill-rule="evenodd" d="M7.429 1.525a6.593 6.593 0 0 1 1.142 0c.036.003.108.036.137.146l.289 1.105c.147.56.55.967.997 1.189.174.086.341.183.501.29.417.278.97.423 1.53.27l1.102-.303c.11-.03.175.016.195.046.219.31.41.641.573.989.014.031.022.11-.059.19l-.815.806c-.411.406-.562.957-.53 1.456a4.588 4.588 0 0 1 0 .582c-.032.499.119 1.05.53 1.456l.815.806c.08.08.073.159.059.19a6.494 6.494 0 0 1-.573.99c-.02.029-.086.074-.195.045l-1.103-.303c-.559-.153-1.112-.008-1.529.27-.16.107-.327.204-.5.29-.449.222-.851.628-.998 1.189l-.289 1.105c-.029.11-.101.143-.137.146a6.613 6.613 0 0 1-1.142 0c-.036-.003-.108-.037-.137-.146l-.289-1.105c-.147-.56-.55-.967-.997-1.189a4.502 4.502 0 0 1-.501-.29c-.417-.278-.97-.423-1.53-.27l-1.102.303c-.11.03-.175-.016-.195-.046a6.492 6.492 0 0 1-.573-.989c-.014-.031-.022-.11.059-.19l.815-.806c.411-.406.562-.957.53-1.456a4.587 4.587 0 0 1 0-.582c.032-.499-.119-1.05-.53-1.456l-.815-.806c-.08-.08-.073-.159-.059-.19.162-.348.354-.68.573-.99.02-.029.086-.074.195-.045l1.103.303c.559.153 1.112.008 1.529-.27.16-.107.327-.204.5-.29.449-.222.851-.628.998-1.189l.289-1.105c.029-.11.101-.143.137-.146ZM8 0c-.236 0-.47.01-.701.03-.743.065-1.29.615-1.458 1.261l-.29 1.106c-.017.066-.078.158-.211.232a5.489 5.489 0 0 0-.594.344c-.12.08-.234.115-.327.096l-1.103-.303c-.648-.178-1.392.02-1.82.63a7.986 7.986 0 0 0-.704 1.217c-.315.675-.111 1.422.363 1.891l.815.806c.05.048.098.147.088.294a6.084 6.084 0 0 0 0 .772c.01.147-.038.246-.088.294l-.815.806c-.474.469-.678 1.216-.363 1.891.2.428.436.835.704 1.218.428.609 1.172.806 1.82.63l1.103-.303c.093-.02.207.016.327.096.185.124.38.237.594.344.133.074.194.166.211.232l.29 1.106c.167.646.714 1.196 1.457 1.26.23.02.465.031.701.031.236 0 .47-.01.701-.03.743-.065 1.29-.615 1.458-1.261l.29-1.106c.017-.066.078-.158.211-.232a5.49 5.49 0 0 0 .594-.344c.12-.08.234-.115.327-.096l1.103.303c.648.178 1.392-.02 1.82-.63.268-.383.505-.79.704-1.217.315-.675.111-1.422-.364-1.891l-.814-.806c-.05-.048-.098-.147-.088-.294a6.083 6.083 0 0 0 0-.772c-.01-.147.039-.246.088-.294l.814-.806c.475-.469.679-1.216.364-1.891a7.992 7.992 0 0 0-.704-1.218c-.428-.609-1.172-.806-1.82-.63l-1.103.303c-.093.02-.207-.016-.327-.096a5.49 5.49 0 0 0-.594-.344c-.133-.074-.194-.166-.211-.232l-.29-1.106C9.992.645 9.444.095 8.701.031A8.566 8.566 0 0 0 8 0Zm1.5 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>
          </svg>
          Manage Profiles
        </button>
      </div>
    `;
  }

  private renderCompactView() {
    return html`
      <div class="dashboard-compact">
        ${this.activeProfile
          ? html`
              <div class="profile-selector">
                <button
                  class="profile-selector-btn ${this.isProfileDropdownOpen ? 'open' : ''} ${this.isApplyingProfile ? 'loading' : ''}"
                  @click=${this.toggleProfileDropdown}
                  aria-expanded="${this.isProfileDropdownOpen}"
                  aria-haspopup="listbox"
                  aria-label="Switch profile. Currently: ${this.activeProfile.name}"
                >
                  ${this.isApplyingProfile
                    ? html`<div class="loading-spinner"></div>`
                    : html`
                        <div
                          class="profile-dot"
                          style="background: ${this.activeProfile.color}"
                        ></div>
                      `}
                  <span class="profile-name">${this.activeProfile.name}</span>
                  <svg class="chevron" viewBox="0 0 16 16" fill="currentColor">
                    <path fill-rule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"/>
                  </svg>
                </button>
                ${this.isProfileDropdownOpen ? this.renderProfileDropdown() : nothing}
              </div>
              <span class="compact-identity">
                ${this.activeProfile.gitName} &lt;${this.activeProfile.gitEmail}&gt;
              </span>
            `
          : html`
              <div class="no-profile">
                <span>No profile active</span>
                <button class="no-profile-btn" @click=${this.openProfileManager}>
                  <svg viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z"/>
                  </svg>
                  Set up profile
                </button>
              </div>
            `}

        ${(() => {
          const provider = this.detectProvider();
          const relevantAccount = this.getRelevantAccount();

          if (relevantAccount) {
            const status = this.getAccountStatus(relevantAccount.id);
            // Use cached username if available, otherwise fall back to account name
            const displayName = relevantAccount.cachedUser?.username
              ? `${INTEGRATION_TYPE_NAMES[relevantAccount.integrationType]} (@${relevantAccount.cachedUser.username})`
              : relevantAccount.name;
            const label = `${displayName}: ${status}`;
            return html`
              <div class="compact-divider"></div>
              <button
                class="account-status-btn"
                @click=${() => this.openIntegrationDialog(relevantAccount.integrationType)}
                aria-label="${label}. Click to open ${INTEGRATION_TYPE_NAMES[relevantAccount.integrationType]} dialog."
                title="${label}"
              >
                <span class="account-status-dot ${status}" aria-hidden="true"></span>
              </button>
            `;
          }

          // Show configure button if provider detected but no account
          if (provider) {
            return html`
              <div class="compact-divider"></div>
              <button
                class="configure-btn"
                @click=${() => this.openIntegrationDialog(provider)}
                title="Configure ${INTEGRATION_TYPE_NAMES[provider]}"
              >
                Configure ${INTEGRATION_TYPE_NAMES[provider]}
              </button>
            `;
          }

          return nothing;
        })()}

        <button
          class="expand-btn ${this.isExpanded ? 'expanded' : ''}"
          @click=${this.toggleExpanded}
          aria-expanded="${this.isExpanded}"
          aria-label="${this.isExpanded ? 'Collapse' : 'Expand'} repository context dashboard"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd"/>
          </svg>
        </button>
      </div>
    `;
  }

  private renderExpandedView() {
    const assignmentSource = this.getProfileAssignmentSource();
    const detectedProvider = this.detectProvider();

    return html`
      <div class="dashboard-expanded" role="region" aria-label="Repository context">
        <div class="dashboard-header">
          <div class="header-left">
            <span class="dashboard-title">Repository Context</span>
            ${this.activeProfile
              ? html`
                  <div class="profile-selector">
                    <button
                      class="profile-selector-btn ${this.isProfileDropdownOpen ? 'open' : ''} ${this.isApplyingProfile ? 'loading' : ''}"
                      @click=${this.toggleProfileDropdown}
                      aria-expanded="${this.isProfileDropdownOpen}"
                      aria-haspopup="listbox"
                      aria-label="Switch profile. Currently: ${this.activeProfile.name}"
                    >
                      ${this.isApplyingProfile
                        ? html`<div class="loading-spinner"></div>`
                        : html`
                            <div
                              class="profile-dot"
                              style="background: ${this.activeProfile.color}"
                            ></div>
                          `}
                      <span class="profile-name">${this.activeProfile.name}</span>
                      <svg class="chevron" viewBox="0 0 16 16" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"/>
                      </svg>
                    </button>
                    ${this.isProfileDropdownOpen ? this.renderProfileDropdown() : nothing}
                  </div>
                `
              : nothing}
          </div>
          <button
            class="expand-btn expanded"
            @click=${this.toggleExpanded}
            aria-expanded="${this.isExpanded}"
            aria-label="Collapse repository context dashboard"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd"/>
            </svg>
          </button>
        </div>

        <div class="card-grid">
          <lv-profile-card
            .profile=${this.activeProfile}
            .assignmentSource=${assignmentSource}
            @edit-profile=${this.openProfileManager}
          ></lv-profile-card>

          ${this.activeRepository
            ? html`
                <lv-repository-card
                  .repository=${this.activeRepository.repository}
                  .currentBranch=${this.activeRepository.currentBranch}
                  .remotes=${this.activeRepository.remotes}
                  .assignmentSource=${assignmentSource}
                  .detectedProvider=${detectedProvider}
                ></lv-repository-card>
              `
            : nothing}

          ${(() => {
            const relevantAccount = this.getRelevantAccount();

            if (relevantAccount) {
              return html`
                <lv-integration-card
                  .account=${relevantAccount}
                  .connectionStatus=${this.getAccountStatus(relevantAccount.id)}
                  .isProfileDefault=${this.isProfileDefaultAccount(relevantAccount)}
                  @open-dialog=${() => this.openIntegrationDialog(relevantAccount.integrationType)}
                  @refresh-account=${this.handleRefreshAccount}
                ></lv-integration-card>
              `;
            }

            // Show configure card if provider detected but no account
            if (detectedProvider) {
              return html`
                <div class="configure-card">
                  <div class="configure-card-icon">
                    ${this.getProviderIcon(detectedProvider)}
                  </div>
                  <div class="configure-card-content">
                    <div class="configure-card-title">${INTEGRATION_TYPE_NAMES[detectedProvider]} not configured</div>
                    <div class="configure-card-description">
                      This repository uses ${INTEGRATION_TYPE_NAMES[detectedProvider]}. Configure an account to enable integration features.
                    </div>
                  </div>
                  <button class="configure-card-btn" @click=${() => this.openIntegrationDialog(detectedProvider)}>
                    Configure
                  </button>
                </div>
              `;
            }

            return nothing;
          })()}
        </div>
      </div>
    `;
  }

  render() {
    if (!this.activeRepository) {
      return nothing;
    }

    return this.isExpanded ? this.renderExpandedView() : this.renderCompactView();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-context-dashboard': LvContextDashboard;
  }
}
