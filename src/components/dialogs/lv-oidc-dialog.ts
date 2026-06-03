/**
 * OIDC / Enterprise SSO Integration Dialog
 *
 * Connect to an OpenID Connect provider (Enterprise SSO). The user supplies an
 * issuer URL and client ID; "Discover" validates the issuer and shows the
 * discovered endpoints, and "Sign in" runs the OAuth (Authorization Code +
 * PKCE) round-trip via the loopback server. On completion the ID token is
 * decoded for user identity and a global IntegrationAccount is created with
 * `config: { type: 'oidc', issuerUrl, clientId }`.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { showToast } from '../../services/notification.service.ts';
import { showConfirm } from '../../services/dialog.service.ts';
import {
  unifiedProfileStore,
  getAccountsByType,
  getAccountById,
  selectDefaultGlobalAccount,
  getActiveProfilePreferredAccount,
} from '../../stores/unified-profile.store.ts';
import * as unifiedProfileService from '../../services/unified-profile.service.ts';
import type { IntegrationAccount } from '../../types/unified-profile.types.ts';
import * as credentialService from '../../services/credential.service.ts';
import * as oauthService from '../../services/oauth.service.ts';
import type { OidcDiscovery, OidcUserInfo } from '../../services/oauth.service.ts';
import type { OAuthFlowState, OAuthTokenResponse } from '../../types/oauth.types.ts';
import './lv-modal.ts';
import './lv-account-selector.ts';

@customElement('lv-oidc-dialog')
export class LvOidcDialog extends LitElement {
  static styles = [
    sharedStyles,
    css`
      .content {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        min-height: 360px;
        max-height: 70vh;
        overflow: auto;
      }

      .token-form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .form-group label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
      }

      .form-group input {
        padding: var(--spacing-sm);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
      }

      .form-group input:focus {
        outline: none;
        border-color: var(--color-primary);
      }

      .help-text {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .btn-row {
        display: flex;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-sm);
      }

      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .btn:hover:not(:disabled) {
        background: var(--color-bg-hover);
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-primary {
        background: var(--color-primary);
        border-color: var(--color-primary);
        color: white;
      }

      .btn-primary:hover:not(:disabled) {
        background: var(--color-primary-hover);
      }

      .btn-danger {
        color: var(--color-error);
        border-color: var(--color-error);
      }

      .btn-danger:hover:not(:disabled) {
        background: var(--color-error-bg);
      }

      .btn-danger-outline {
        background: transparent;
        color: var(--color-error);
        border-color: var(--color-error);
      }

      .btn-danger-outline:hover:not(:disabled) {
        background: var(--color-error);
        color: white;
      }

      .connection-status {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
      }

      .user-avatar-placeholder {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: var(--color-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-lg);
      }

      .avatar {
        width: 48px;
        height: 48px;
        border-radius: 50%;
      }

      .user-info {
        flex: 1;
      }

      .user-name {
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }

      .user-login {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
      }

      .connection-actions {
        display: flex;
        gap: var(--spacing-sm);
        margin-left: auto;
      }

      .discovery {
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
      }

      .discovery-row {
        display: flex;
        gap: var(--spacing-sm);
        margin-bottom: 4px;
        word-break: break-all;
      }

      .discovery-row .key {
        font-weight: var(--font-weight-medium);
        color: var(--color-text-muted);
        min-width: 110px;
      }

      .oauth-pending {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-lg);
      }

      .oauth-spinner {
        width: 28px;
        height: 28px;
        border: 3px solid var(--color-border);
        border-top-color: var(--color-primary);
        border-radius: 50%;
        animation: oidc-spin 0.8s linear infinite;
      }

      @keyframes oidc-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .error {
        padding: var(--spacing-md);
        background: var(--color-error-bg);
        color: var(--color-error);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  /**
   * Show a back arrow instead of a close ×. Set explicitly by the host ONLY when
   * this dialog was opened with a return target (the profile manager).
   */
  @property({ type: Boolean }) backButton = false;
  /** Profile name for the "Adding to <name>" breadcrumb; empty when standalone. */
  @property({ type: String }) attachToProfileName = '';

  @state() private nameInput = '';
  @state() private issuerUrlInput = '';
  @state() private clientIdInput = '';
  @state() private discovery: OidcDiscovery | null = null;
  @state() private connected = false;
  @state() private connectedUser: OidcUserInfo | null = null;
  @state() private isLoading = false;
  @state() private error: string | null = null;
  @state() private oauthState: OAuthFlowState = { status: 'idle' };

  // Multi-account support (global accounts)
  @state() private accounts: IntegrationAccount[] = [];
  @state() private selectedAccountId: string | null = null;

  private unsubscribeStore?: () => void;
  private oauthStateUnsubscribe?: () => void;
  private boundOAuthComplete = this.handleOAuthComplete.bind(this);

  connectedCallback(): void {
    super.connectedCallback();

    this.oauthStateUnsubscribe = oauthService.onOAuthStateChange((state) => {
      if (state.provider === 'oidc') {
        this.oauthState = state;
      }
    });

    window.addEventListener('oauth-complete', this.boundOAuthComplete as unknown as EventListener);

    let lastActiveProfileId = unifiedProfileStore.getState().activeProfile?.id ?? null;
    this.unsubscribeStore = unifiedProfileStore.subscribe((state) => {
      this.accounts = getAccountsByType('oidc');
      if (this.selectedAccountId && !this.accounts.some((a) => a.id === this.selectedAccountId)) {
        this.selectedAccountId = null;
      }
      const activeProfileId = state.activeProfile?.id ?? null;
      if (activeProfileId !== lastActiveProfileId) {
        const preferred = getActiveProfilePreferredAccount('oidc') ?? this.accounts[0];
        this.applyAccount(preferred);
        lastActiveProfileId = activeProfileId;
      } else if (!this.selectedAccountId && this.accounts.length > 0) {
        this.applyAccount(
          getActiveProfilePreferredAccount('oidc') ??
            selectDefaultGlobalAccount('oidc') ??
            this.accounts[0]
        );
      }
    });

    this.accounts = getAccountsByType('oidc');
    if (this.accounts.length > 0 && !this.selectedAccountId) {
      this.applyAccount(
        getActiveProfilePreferredAccount('oidc') ??
          selectDefaultGlobalAccount('oidc') ??
          this.accounts[0]
      );
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeStore?.();
    this.oauthStateUnsubscribe?.();
    window.removeEventListener('oauth-complete', this.boundOAuthComplete as unknown as EventListener);
  }

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('open') && this.open) {
      this.error = null;
      await this.loadInitialData();
    }
  }

  private applyAccount(account: IntegrationAccount | undefined): void {
    if (!account) return;
    this.selectedAccountId = account.id;
    if (account.config.type === 'oidc') {
      this.issuerUrlInput = account.config.issuerUrl;
      this.clientIdInput = account.config.clientId;
    }
    this.nameInput = account.name;
    this.connected = !!account.cachedUser;
    if (account.cachedUser) {
      this.connectedUser = {
        sub: '',
        email: account.cachedUser.email,
        name: account.cachedUser.displayName,
        preferredUsername: account.cachedUser.username,
        picture: account.cachedUser.avatarUrl,
      };
    } else {
      this.connectedUser = null;
    }
  }

  private async loadInitialData(): Promise<void> {
    this.isLoading = true;
    this.error = null;
    try {
      await unifiedProfileService.loadUnifiedProfiles();
      this.accounts = getAccountsByType('oidc');
      if (this.accounts.length > 0 && !this.selectedAccountId) {
        this.applyAccount(
          getActiveProfilePreferredAccount('oidc') ??
            selectDefaultGlobalAccount('oidc') ??
            this.accounts[0]
        );
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load accounts';
    } finally {
      this.isLoading = false;
    }
  }

  private async handleAccountChange(e: CustomEvent<{ account: IntegrationAccount }>): Promise<void> {
    const { account } = e.detail;
    this.error = null;
    this.discovery = null;
    this.applyAccount(account);
  }

  private handleAddAccount(): void {
    // Clear selection so the next sign-in creates a NEW account rather than
    // overwriting the previously-selected one's token/config.
    this.selectedAccountId = null;
    this.nameInput = '';
    this.issuerUrlInput = '';
    this.clientIdInput = '';
    this.discovery = null;
    this.connected = false;
    this.connectedUser = null;
    this.error = null;
  }

  private handleManageAccounts(): void {
    this.dispatchEvent(
      new CustomEvent('manage-accounts', {
        detail: { integrationType: 'oidc' },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Discover the OIDC provider configuration from the issuer URL. Surfaces
   * validation/SSRF errors (the backend returns descriptive strings) inline.
   */
  private async handleDiscover(): Promise<void> {
    const issuerUrl = this.issuerUrlInput.trim();
    if (!issuerUrl) {
      this.error = 'Enter an issuer URL to discover.';
      return;
    }

    this.isLoading = true;
    this.error = null;
    try {
      this.discovery = await oauthService.discoverOidcProvider(issuerUrl);
    } catch (err) {
      this.discovery = null;
      this.error = err instanceof Error ? err.message : 'Failed to discover OIDC provider';
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Start the OIDC OAuth flow. The issuer URL is passed as `instanceUrl` so the
   * backend runs discovery and builds the authorize/token requests against it.
   */
  private async handleStartOAuth(): Promise<void> {
    const issuerUrl = this.issuerUrlInput.trim();
    const clientId = this.clientIdInput.trim();
    if (!issuerUrl || !clientId) {
      this.error = 'Issuer URL and Client ID are required to sign in.';
      return;
    }

    this.error = null;
    await oauthService.startOAuth('oidc', clientId, issuerUrl);
  }

  private async handleOAuthComplete(
    event: CustomEvent<{ provider: string; tokens: OAuthTokenResponse; instanceUrl?: string }>
  ): Promise<void> {
    const { provider, tokens, instanceUrl } = event.detail;
    if (provider !== 'oidc') return;

    const wasOpen = this.open;
    this.isLoading = true;
    this.error = null;

    try {
      await unifiedProfileService.loadUnifiedProfiles();

      const issuerUrl = instanceUrl || this.issuerUrlInput.trim();
      const clientId = this.clientIdInput.trim();

      // Optionally decode the ID token for user identity. The access token
      // response carries an id_token for OIDC; fall back gracefully if absent.
      let user: OidcUserInfo | null = null;
      const idToken = tokens.idToken;
      if (idToken) {
        try {
          user = await oauthService.decodeOidcIdToken(idToken);
        } catch {
          // Identity is best-effort; a missing/invalid id_token must not block
          // persisting a successfully-authenticated account.
          user = null;
        }
      }

      const cachedUser = user
        ? {
            username: user.preferredUsername ?? user.sub,
            displayName: user.name ?? null,
            email: user.email ?? null,
            avatarUrl: user.picture ?? null,
          }
        : null;

      // Find existing account for this issuer, or use the selected account.
      const existingAccount = this.selectedAccountId
        ? getAccountById(this.selectedAccountId)
        : this.accounts.find(
            (a) => a.config.type === 'oidc' && a.config.issuerUrl === issuerUrl
          );

      if (existingAccount) {
        // If the user edited the Issuer URL / Client ID before re-signing in,
        // persist the new config so the stored account matches the issuer the
        // token was actually minted against (otherwise the next open restores
        // the stale issuer while holding a token for a different one).
        const cfg = existingAccount.config;
        const configChanged =
          cfg.type !== 'oidc' || cfg.issuerUrl !== issuerUrl || cfg.clientId !== clientId;
        if (configChanged) {
          await unifiedProfileService.saveGlobalAccount({
            ...existingAccount,
            config: { type: 'oidc', issuerUrl, clientId },
          });
        }
        await credentialService.storeAccountOAuthToken(
          'oidc',
          existingAccount.id,
          tokens.accessToken,
          tokens.refreshToken,
          tokens.expiresIn
        );
        if (cachedUser) {
          await unifiedProfileService.updateGlobalAccountCachedUser(existingAccount.id, cachedUser);
        }
        this.selectedAccountId = existingAccount.id;
      } else {
        const { createEmptyIntegrationAccount, generateId } = await import(
          '../../types/unified-profile.types.ts'
        );
        const displayName =
          this.nameInput.trim() ||
          (user?.preferredUsername
            ? `Enterprise SSO (${user.preferredUsername})`
            : 'Enterprise SSO');
        const newAccount: IntegrationAccount = {
          ...createEmptyIntegrationAccount('oidc', issuerUrl),
          id: generateId(),
          name: displayName,
          isDefault: this.accounts.length === 0,
          config: { type: 'oidc', issuerUrl, clientId },
          cachedUser,
        };

        const savedAccount = await unifiedProfileService.saveGlobalAccount(newAccount);
        await credentialService.storeAccountOAuthToken(
          'oidc',
          savedAccount.id,
          tokens.accessToken,
          tokens.refreshToken,
          tokens.expiresIn
        );
        this.selectedAccountId = savedAccount.id;

        await unifiedProfileService.loadUnifiedProfiles();
        this.accounts = getAccountsByType('oidc');
      }

      this.connected = true;
      this.connectedUser = user;
      this.oauthState = { status: 'idle' };
      this.syncSharedConnectionStatus(true);

      if (!wasOpen) {
        showToast(
          user?.preferredUsername
            ? `Connected Enterprise SSO (${user.preferredUsername})`
            : 'Connected Enterprise SSO account',
          'success'
        );
      } else {
        showToast('Connected Enterprise SSO account', 'success');
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to complete sign in';
    } finally {
      this.isLoading = false;
    }
  }

  private syncSharedConnectionStatus(connected: boolean): void {
    if (this.selectedAccountId) {
      unifiedProfileStore
        .getState()
        .setAccountConnectionStatus(this.selectedAccountId, connected ? 'connected' : 'disconnected');
    }
  }

  private async handleDisconnect(): Promise<void> {
    this.isLoading = true;
    this.error = null;
    try {
      if (this.selectedAccountId) {
        await credentialService.deleteAccountToken('oidc', this.selectedAccountId);
      }
      this.syncSharedConnectionStatus(false);
      this.connected = false;
      this.connectedUser = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to disconnect';
      showToast(this.error, 'error');
    } finally {
      this.isLoading = false;
    }
  }

  private async handleDeleteIntegration(): Promise<void> {
    if (!this.selectedAccountId) return;

    const selected = this.accounts.find((a) => a.id === this.selectedAccountId);
    const accountName = selected?.name ?? 'this account';
    const confirmed = await showConfirm(
      'Delete Enterprise SSO Integration',
      `Delete ${accountName}? The stored token will be removed and any profile that uses this account as its default will lose that reference.`,
      'warning'
    );
    if (!confirmed) return;

    this.isLoading = true;
    this.error = null;

    // Delete the record (source of truth) FIRST, then best-effort token cleanup.
    const accountId = this.selectedAccountId;
    try {
      await unifiedProfileService.deleteGlobalAccount(accountId);

      await unifiedProfileService.loadUnifiedProfiles();
      this.accounts = getAccountsByType('oidc');

      this.selectedAccountId = this.accounts.length > 0 ? this.accounts[0].id : null;
      this.connected = false;
      this.connectedUser = null;
      this.discovery = null;
      if (this.selectedAccountId) {
        this.applyAccount(this.accounts[0]);
      } else {
        this.nameInput = '';
        this.issuerUrlInput = '';
        this.clientIdInput = '';
      }

      try {
        await credentialService.deleteAccountToken('oidc', accountId);
      } catch (tokenErr) {
        const msg =
          tokenErr instanceof Error
            ? `Account deleted, but its stored token could not be removed: ${tokenErr.message}`
            : 'Account deleted, but its stored token could not be removed.';
        this.error = msg;
        showToast(msg, 'error');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete integration';
      this.error = msg;
      showToast(msg, 'error');
    } finally {
      this.isLoading = false;
    }
  }

  private handleClose(): void {
    this.dispatchEvent(new CustomEvent('close'));
  }

  private getInitials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  }

  private renderConnected() {
    const user = this.connectedUser;
    const label = user?.name ?? user?.preferredUsername ?? (this.nameInput || 'Enterprise SSO');
    const login = user?.preferredUsername ?? user?.email ?? this.issuerUrlInput;
    return html`
      <div class="connection-status">
        ${user?.picture
          ? html`<img class="avatar" src="${user.picture}" alt="${label}" />`
          : html`<div class="user-avatar-placeholder">${this.getInitials(label)}</div>`}
        <div class="user-info">
          <div class="user-name">${label}</div>
          <div class="user-login">${login}</div>
        </div>
        <div class="connection-actions">
          <button class="btn btn-danger" @click=${this.handleDisconnect} ?disabled=${this.isLoading}>
            Disconnect
          </button>
          <button
            class="btn btn-danger-outline"
            @click=${this.handleDeleteIntegration}
            ?disabled=${this.isLoading}
          >
            Delete
          </button>
        </div>
      </div>
    `;
  }

  private renderForm() {
    const isOAuthPending =
      this.oauthState.status === 'pending' || this.oauthState.status === 'exchanging';

    if (isOAuthPending) {
      return html`
        <div class="oauth-pending">
          <div class="oauth-spinner"></div>
          <p>
            ${this.oauthState.status === 'exchanging'
              ? 'Completing sign in...'
              : 'Waiting for authorization...'}
          </p>
          <p class="help-text">Complete the sign in in your browser</p>
          <button class="btn" @click=${() => oauthService.cancelOAuth('oidc')}>Cancel</button>
        </div>
      `;
    }

    return html`
      <div class="token-form">
        <div class="form-group">
          <label>Display Name</label>
          <input
            type="text"
            placeholder="e.g., Acme SSO"
            .value=${this.nameInput}
            @input=${(e: Event) => (this.nameInput = (e.target as HTMLInputElement).value)}
          />
          <span class="help-text">A label for this Enterprise SSO account.</span>
        </div>

        <div class="form-group">
          <label>Issuer URL</label>
          <input
            type="url"
            placeholder="https://auth.example.com"
            .value=${this.issuerUrlInput}
            @input=${(e: Event) => {
              this.issuerUrlInput = (e.target as HTMLInputElement).value;
              this.discovery = null;
            }}
          />
          <span class="help-text">
            The OpenID Connect issuer. Discovery reads
            <code>/.well-known/openid-configuration</code>.
          </span>
        </div>

        <div class="form-group">
          <label>Client ID</label>
          <input
            type="text"
            placeholder="your-client-id"
            .value=${this.clientIdInput}
            @input=${(e: Event) => (this.clientIdInput = (e.target as HTMLInputElement).value)}
          />
        </div>

        ${this.discovery
          ? html`
              <div class="discovery">
                <div class="discovery-row">
                  <span class="key">Issuer</span><span>${this.discovery.issuer}</span>
                </div>
                <div class="discovery-row">
                  <span class="key">Authorization</span>
                  <span>${this.discovery.authorizationEndpoint}</span>
                </div>
                <div class="discovery-row">
                  <span class="key">Token</span><span>${this.discovery.tokenEndpoint}</span>
                </div>
              </div>
            `
          : nothing}

        <div class="btn-row">
          <button
            class="btn discover-btn"
            @click=${this.handleDiscover}
            ?disabled=${this.isLoading || !this.issuerUrlInput.trim()}
          >
            Discover
          </button>
          <button
            class="btn btn-primary sign-in-btn"
            @click=${this.handleStartOAuth}
            ?disabled=${this.isLoading || !this.issuerUrlInput.trim() || !this.clientIdInput.trim()}
          >
            Sign in
          </button>
          ${this.selectedAccountId
            ? html`
                <button
                  class="btn btn-danger-outline"
                  @click=${this.handleDeleteIntegration}
                  ?disabled=${this.isLoading}
                >
                  Delete Integration
                </button>
              `
            : nothing}
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <lv-modal
        .open=${this.open}
        ?backButton=${this.backButton}
        modalTitle="Enterprise SSO (OIDC)"
        @close=${this.handleClose}
      >
        <div class="content">
          ${this.attachToProfileName
            ? html`<div class="attach-breadcrumb" data-testid="attach-breadcrumb">Adding to <strong>${this.attachToProfileName}</strong></div>`
            : nothing}
          ${this.accounts.length > 0 || this.connected
            ? html`
                <lv-account-selector
                  integrationType="oidc"
                  .selectedAccountId=${this.selectedAccountId}
                  @account-change=${this.handleAccountChange}
                  @add-account=${this.handleAddAccount}
                  @manage-accounts=${this.handleManageAccounts}
                ></lv-account-selector>
              `
            : nothing}

          ${this.error ? html`<div class="error">${this.error}</div>` : nothing}

          ${this.connected ? this.renderConnected() : this.renderForm()}
        </div>
      </lv-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-oidc-dialog': LvOidcDialog;
  }
}
