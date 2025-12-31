/**
 * Profile Manager Dialog Component
 * Full CRUD interface for managing unified profiles (git identity + integration accounts)
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { unifiedProfileStore } from '../../stores/unified-profile.store.ts';
import * as unifiedProfileService from '../../services/unified-profile.service.ts';
import type { UnifiedProfile, ProfileIntegrationAccount, IntegrationType, IntegrationConfig } from '../../types/unified-profile.types.ts';
import { PROFILE_COLORS, ACCOUNT_COLORS, INTEGRATION_TYPE_NAMES } from '../../types/unified-profile.types.ts';
import { showToast } from '../../services/notification.service.ts';

type ViewMode = 'list' | 'edit' | 'create' | 'add-account' | 'edit-account';

@customElement('lv-profile-manager-dialog')
export class LvProfileManagerDialog extends LitElement {
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
        width: 650px;
        max-height: 85vh;
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

      /* Button styles */
      .btn {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-sm) var(--spacing-md);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .btn:hover {
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

      .btn-secondary {
        background: var(--color-bg-tertiary);
        border-color: var(--color-border);
        color: var(--color-text-primary);
      }

      .btn-secondary:hover:not(:disabled) {
        background: var(--color-bg-hover);
      }

      .btn-sm {
        padding: var(--spacing-xs) var(--spacing-sm);
        font-size: var(--font-size-xs);
      }

      /* Profile list */
      .profile-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .profile-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .profile-item:hover {
        background: var(--color-bg-hover);
        border-color: var(--color-accent);
      }

      .profile-color {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .profile-info {
        flex: 1;
        min-width: 0;
      }

      .profile-name {
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
      }

      .default-badge {
        font-size: var(--font-size-xs);
        padding: 2px 6px;
        background: var(--color-accent-bg);
        color: var(--color-accent);
        border-radius: var(--radius-xs);
      }

      .profile-email {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
      }

      .profile-meta {
        font-size: var(--font-size-xs);
        color: var(--color-text-tertiary);
        margin-top: 2px;
        display: flex;
        gap: var(--spacing-sm);
      }

      .profile-actions {
        display: flex;
        gap: var(--spacing-xs);
      }

      .action-btn {
        padding: var(--spacing-xs);
        background: none;
        border: none;
        cursor: pointer;
        color: var(--color-text-secondary);
        border-radius: var(--radius-sm);
      }

      .action-btn:hover {
        background: var(--color-bg-tertiary);
        color: var(--color-text-primary);
      }

      .action-btn.delete:hover {
        color: var(--color-error);
      }

      /* Empty state */
      .empty-state {
        text-align: center;
        padding: var(--spacing-xl);
        color: var(--color-text-secondary);
      }

      .empty-state svg {
        width: 48px;
        height: 48px;
        margin-bottom: var(--spacing-md);
        opacity: 0.5;
      }

      /* Form */
      .form-section {
        margin-bottom: var(--spacing-lg);
      }

      .form-section-title {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
        margin-bottom: var(--spacing-sm);
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .form-group {
        margin-bottom: var(--spacing-md);
      }

      .form-group label {
        display: block;
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
        margin-bottom: var(--spacing-xs);
      }

      .form-group input,
      .form-group textarea,
      .form-group select {
        width: 100%;
        padding: var(--spacing-sm);
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
      }

      .form-group input:focus,
      .form-group textarea:focus,
      .form-group select:focus {
        outline: none;
        border-color: var(--color-accent);
      }

      .form-group textarea {
        min-height: 60px;
        resize: vertical;
        font-family: var(--font-mono);
      }

      .form-hint {
        font-size: var(--font-size-xs);
        color: var(--color-text-tertiary);
        margin-top: var(--spacing-xs);
      }

      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--spacing-md);
      }

      /* Color picker */
      .color-picker {
        display: flex;
        gap: var(--spacing-xs);
        flex-wrap: wrap;
      }

      .color-option {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .color-option:hover {
        transform: scale(1.1);
      }

      .color-option.selected {
        border-color: var(--color-text-primary);
      }

      /* Checkbox */
      .checkbox-row {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) 0;
      }

      .checkbox-row input[type="checkbox"] {
        width: 16px;
        height: 16px;
        accent-color: var(--color-accent);
      }

      .checkbox-row label {
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
        cursor: pointer;
      }

      /* Header with back button */
      .header-with-back {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .back-btn {
        padding: var(--spacing-xs);
        background: none;
        border: none;
        cursor: pointer;
        color: var(--color-text-secondary);
        border-radius: var(--radius-sm);
      }

      .back-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      /* Accounts section */
      .accounts-section {
        margin-top: var(--spacing-md);
        padding-top: var(--spacing-md);
        border-top: 1px solid var(--color-border);
      }

      .accounts-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--spacing-sm);
      }

      .accounts-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .account-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
      }

      .account-item:hover {
        background: var(--color-bg-hover);
      }

      .account-icon {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
      }

      .account-info {
        flex: 1;
        min-width: 0;
      }

      .account-name {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
      }

      .account-detail {
        font-size: var(--font-size-xs);
        color: var(--color-text-tertiary);
      }

      .account-actions {
        display: flex;
        gap: var(--spacing-xs);
      }

      .empty-accounts {
        text-align: center;
        padding: var(--spacing-md);
        color: var(--color-text-tertiary);
        font-size: var(--font-size-sm);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-sm);
      }

      .type-badge {
        font-size: 10px;
        padding: 1px 4px;
        background: var(--color-bg-secondary);
        border-radius: var(--radius-xs);
        color: var(--color-text-tertiary);
        text-transform: uppercase;
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: String }) repoPath = '';

  @state() private viewMode: ViewMode = 'list';
  @state() private profiles: UnifiedProfile[] = [];
  @state() private editingProfile: Partial<UnifiedProfile> | null = null;
  @state() private editingAccount: Partial<ProfileIntegrationAccount> | null = null;
  @state() private isLoading = false;
  @state() private isSaving = false;

  private unsubscribeStore?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    // Get initial state from unified profile store
    const initialState = unifiedProfileStore.getState();
    this.profiles = initialState.profiles;
    this.isLoading = initialState.isLoading;

    // Subscribe to store changes
    this.unsubscribeStore = unifiedProfileStore.subscribe((state) => {
      this.profiles = state.profiles;
      this.isLoading = state.isLoading;
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeStore?.();
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('open') && this.open) {
      this.loadProfiles();
    }
  }

  private async loadProfiles(): Promise<void> {
    await unifiedProfileService.loadUnifiedProfiles();
  }

  private handleClose(): void {
    this.open = false;
    this.viewMode = 'list';
    this.editingProfile = null;
    this.editingAccount = null;
    this.dispatchEvent(new CustomEvent('close'));
  }

  private handleCreateNew(): void {
    this.editingProfile = {
      name: '',
      gitName: '',
      gitEmail: '',
      signingKey: null,
      urlPatterns: [],
      isDefault: false,
      color: PROFILE_COLORS[0],
      integrationAccounts: [],
    };
    this.viewMode = 'create';
  }

  private handleEdit(profile: UnifiedProfile): void {
    this.editingProfile = { ...profile, integrationAccounts: [...profile.integrationAccounts] };
    this.viewMode = 'edit';
  }

  private handleBack(): void {
    if (this.viewMode === 'add-account' || this.viewMode === 'edit-account') {
      this.viewMode = this.editingProfile?.id ? 'edit' : 'create';
      this.editingAccount = null;
    } else {
      this.viewMode = 'list';
      this.editingProfile = null;
    }
  }

  private async handleDelete(profile: UnifiedProfile, e: Event): Promise<void> {
    e.stopPropagation();
    if (!confirm(`Delete profile "${profile.name}"? This will also remove all associated integration accounts.`)) {
      return;
    }

    try {
      await unifiedProfileService.deleteUnifiedProfile(profile.id);
      showToast('Profile deleted', 'success');
    } catch (error) {
      showToast(`Failed to delete profile: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }

  private async handleApply(profile: UnifiedProfile, e: Event): Promise<void> {
    e.stopPropagation();
    if (!this.repoPath) {
      showToast('No repository open', 'error');
      return;
    }

    try {
      await unifiedProfileService.applyUnifiedProfile(this.repoPath, profile.id);
      showToast(`Applied profile "${profile.name}"`, 'success');
    } catch (error) {
      showToast(`Failed to apply profile: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }

  private updateEditingProfile(field: keyof UnifiedProfile, value: unknown): void {
    if (this.editingProfile) {
      this.editingProfile = { ...this.editingProfile, [field]: value };
    }
  }

  private async handleSave(): Promise<void> {
    if (!this.editingProfile) return;

    // Validation
    if (!this.editingProfile.name?.trim()) {
      showToast('Profile name is required', 'error');
      return;
    }
    if (!this.editingProfile.gitName?.trim()) {
      showToast('Git name is required', 'error');
      return;
    }
    if (!this.editingProfile.gitEmail?.trim()) {
      showToast('Git email is required', 'error');
      return;
    }

    this.isSaving = true;

    const profile: UnifiedProfile = {
      id: this.editingProfile.id ?? crypto.randomUUID(),
      name: this.editingProfile.name.trim(),
      gitName: this.editingProfile.gitName.trim(),
      gitEmail: this.editingProfile.gitEmail.trim(),
      signingKey: this.editingProfile.signingKey?.trim() || null,
      urlPatterns: this.editingProfile.urlPatterns ?? [],
      isDefault: this.editingProfile.isDefault ?? false,
      color: this.editingProfile.color ?? PROFILE_COLORS[0],
      integrationAccounts: this.editingProfile.integrationAccounts ?? [],
    };

    try {
      await unifiedProfileService.saveUnifiedProfile(profile);
      showToast(this.viewMode === 'create' ? 'Profile created' : 'Profile saved', 'success');
      this.handleBack();
    } catch (error) {
      showToast(`Failed to save profile: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      this.isSaving = false;
    }
  }

  private handlePatternsChange(e: Event): void {
    const textarea = e.target as HTMLTextAreaElement;
    const patterns = textarea.value
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p);
    this.updateEditingProfile('urlPatterns', patterns);
  }

  // Account management
  private handleAddAccount(): void {
    this.editingAccount = {
      name: '',
      integrationType: 'github',
      config: { type: 'github' },
      color: null,
      cachedUser: null,
      isDefaultForType: false,
    };
    this.viewMode = 'add-account';
  }

  private handleEditAccount(account: ProfileIntegrationAccount): void {
    this.editingAccount = { ...account };
    this.viewMode = 'edit-account';
  }

  private handleRemoveAccount(accountId: string): void {
    if (!this.editingProfile || !confirm('Remove this account from the profile?')) return;

    const accounts = this.editingProfile.integrationAccounts?.filter((a) => a.id !== accountId) ?? [];
    this.editingProfile = { ...this.editingProfile, integrationAccounts: accounts };
  }

  private updateEditingAccount(field: keyof ProfileIntegrationAccount, value: unknown): void {
    if (this.editingAccount) {
      this.editingAccount = { ...this.editingAccount, [field]: value };
    }
  }

  private handleSaveAccount(): void {
    if (!this.editingAccount || !this.editingProfile) return;

    // Validation
    if (!this.editingAccount.name?.trim()) {
      showToast('Account name is required', 'error');
      return;
    }

    const integrationType = this.editingAccount.integrationType ?? 'github';
    const account: ProfileIntegrationAccount = {
      id: this.editingAccount.id ?? crypto.randomUUID(),
      name: this.editingAccount.name.trim(),
      integrationType,
      config: this.editingAccount.config ?? this.getDefaultConfigForType(integrationType),
      color: this.editingAccount.color ?? null,
      cachedUser: this.editingAccount.cachedUser ?? null,
      isDefaultForType: this.editingAccount.isDefaultForType ?? false,
    };

    const accounts = [...(this.editingProfile.integrationAccounts ?? [])];
    const existingIndex = accounts.findIndex((a) => a.id === account.id);

    if (existingIndex >= 0) {
      accounts[existingIndex] = account;
    } else {
      accounts.push(account);
    }

    // If this is default for type, unset others of same type
    if (account.isDefaultForType) {
      accounts.forEach((a) => {
        if (a.id !== account.id && a.integrationType === account.integrationType) {
          a.isDefaultForType = false;
        }
      });
    }

    this.editingProfile = { ...this.editingProfile, integrationAccounts: accounts };
    this.handleBack();
  }

  render() {
    if (!this.open) return nothing;

    return html`
      <div class="dialog-overlay" @click=${(e: Event) => e.target === e.currentTarget && this.handleClose()}>
        <div class="dialog">
          <div class="dialog-header">
            <div class="dialog-title">
              ${this.viewMode !== 'list'
                ? html`
                    <button class="back-btn" @click=${this.handleBack} title="Back">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="15 18 9 12 15 6"></polyline>
                      </svg>
                    </button>
                  `
                : nothing}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
              ${this.getDialogTitle()}
            </div>
            <button class="close-btn" @click=${this.handleClose}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="dialog-content">
            ${this.renderContent()}
          </div>
          <div class="dialog-footer">
            ${this.renderFooter()}
          </div>
        </div>
      </div>
    `;
  }

  private getDialogTitle(): string {
    switch (this.viewMode) {
      case 'list':
        return 'Profiles';
      case 'create':
        return 'New Profile';
      case 'edit':
        return 'Edit Profile';
      case 'add-account':
        return 'Add Account';
      case 'edit-account':
        return 'Edit Account';
      default:
        return 'Profiles';
    }
  }

  private renderContent() {
    switch (this.viewMode) {
      case 'list':
        return this.renderProfileList();
      case 'create':
      case 'edit':
        return this.renderProfileForm();
      case 'add-account':
      case 'edit-account':
        return this.renderAccountForm();
      default:
        return nothing;
    }
  }

  private renderFooter() {
    switch (this.viewMode) {
      case 'list':
        return html`
          <button class="btn btn-primary" @click=${this.handleCreateNew}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            New Profile
          </button>
        `;
      case 'create':
      case 'edit':
        return html`
          <button class="btn btn-secondary" @click=${this.handleBack}>Cancel</button>
          <button class="btn btn-primary" @click=${this.handleSave} ?disabled=${this.isSaving}>
            ${this.isSaving ? 'Saving...' : 'Save Profile'}
          </button>
        `;
      case 'add-account':
      case 'edit-account':
        return html`
          <button class="btn btn-secondary" @click=${this.handleBack}>Cancel</button>
          <button class="btn btn-primary" @click=${this.handleSaveAccount}>
            ${this.viewMode === 'add-account' ? 'Add Account' : 'Save Account'}
          </button>
        `;
      default:
        return nothing;
    }
  }

  private renderProfileList() {
    if (this.isLoading) {
      return html`<div class="empty-state">Loading profiles...</div>`;
    }

    if (this.profiles.length === 0) {
      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          <div>No profiles yet</div>
          <p style="font-size: var(--font-size-sm); margin-top: var(--spacing-sm);">
            Create profiles to manage git identities and integration accounts together
          </p>
        </div>
      `;
    }

    return html`
      <div class="profile-list">
        ${this.profiles.map(
          (profile) => html`
            <div class="profile-item" @click=${() => this.handleEdit(profile)}>
              <div
                class="profile-color"
                style="background: ${profile.color ?? PROFILE_COLORS[0]}"
              ></div>
              <div class="profile-info">
                <div class="profile-name">
                  ${profile.name}
                  ${profile.isDefault ? html`<span class="default-badge">Default</span>` : nothing}
                </div>
                <div class="profile-email">${profile.gitName} &lt;${profile.gitEmail}&gt;</div>
                <div class="profile-meta">
                  ${profile.integrationAccounts.length > 0
                    ? html`<span>${profile.integrationAccounts.length} account${profile.integrationAccounts.length > 1 ? 's' : ''}</span>`
                    : html`<span>No accounts</span>`}
                  ${profile.urlPatterns.length > 0
                    ? html`<span>· ${profile.urlPatterns.length} pattern${profile.urlPatterns.length > 1 ? 's' : ''}</span>`
                    : nothing}
                </div>
              </div>
              <div class="profile-actions">
                ${this.repoPath
                  ? html`
                      <button
                        class="action-btn"
                        @click=${(e: Event) => this.handleApply(profile, e)}
                        title="Apply to current repository"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </button>
                    `
                  : nothing}
                <button
                  class="action-btn delete"
                  @click=${(e: Event) => this.handleDelete(profile, e)}
                  title="Delete profile"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </div>
            </div>
          `
        )}
      </div>
    `;
  }

  private renderProfileForm() {
    if (!this.editingProfile) return nothing;

    return html`
      <div class="form-section">
        <div class="form-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          Profile Settings
        </div>

        <div class="form-group">
          <label>Profile Name</label>
          <input
            type="text"
            placeholder="e.g., Work, Personal, Open Source"
            .value=${this.editingProfile.name ?? ''}
            @input=${(e: Event) => this.updateEditingProfile('name', (e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Git Name</label>
            <input
              type="text"
              placeholder="John Doe"
              .value=${this.editingProfile.gitName ?? ''}
              @input=${(e: Event) => this.updateEditingProfile('gitName', (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="form-group">
            <label>Git Email</label>
            <input
              type="email"
              placeholder="john@example.com"
              .value=${this.editingProfile.gitEmail ?? ''}
              @input=${(e: Event) => this.updateEditingProfile('gitEmail', (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>

        <div class="form-group">
          <label>GPG Signing Key (optional)</label>
          <input
            type="text"
            placeholder="Key ID or fingerprint"
            .value=${this.editingProfile.signingKey ?? ''}
            @input=${(e: Event) => this.updateEditingProfile('signingKey', (e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="form-group">
          <label>URL Patterns (one per line)</label>
          <textarea
            placeholder="github.com/mycompany/*&#10;gitlab.com/work-projects/*"
            .value=${(this.editingProfile.urlPatterns ?? []).join('\n')}
            @input=${this.handlePatternsChange}
          ></textarea>
          <div class="form-hint">
            Auto-detect which profile to use based on repository URL. Supports wildcards (*).
          </div>
        </div>

        <div class="form-group">
          <label>Color</label>
          <div class="color-picker">
            ${PROFILE_COLORS.map(
              (color) => html`
                <div
                  class="color-option ${this.editingProfile?.color === color ? 'selected' : ''}"
                  style="background: ${color}"
                  @click=${() => this.updateEditingProfile('color', color)}
                ></div>
              `
            )}
          </div>
        </div>

        <div class="checkbox-row">
          <input
            type="checkbox"
            id="isDefault"
            .checked=${this.editingProfile.isDefault ?? false}
            @change=${(e: Event) => this.updateEditingProfile('isDefault', (e.target as HTMLInputElement).checked)}
          />
          <label for="isDefault">Set as default profile</label>
        </div>
      </div>

      <!-- Integration Accounts Section -->
      <div class="accounts-section">
        <div class="accounts-header">
          <div class="form-section-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            Integration Accounts
          </div>
          <button class="btn btn-sm" @click=${this.handleAddAccount}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add
          </button>
        </div>

        ${(this.editingProfile.integrationAccounts ?? []).length === 0
          ? html`
              <div class="empty-accounts">
                No integration accounts linked to this profile.
                <br />
                Add accounts to connect GitHub, GitLab, or Azure DevOps.
              </div>
            `
          : html`
              <div class="accounts-list">
                ${(this.editingProfile.integrationAccounts ?? []).map((account) => this.renderAccountItem(account))}
              </div>
            `}
      </div>
    `;
  }

  private renderAccountItem(account: ProfileIntegrationAccount) {
    return html`
      <div class="account-item">
        ${this.renderAccountIcon(account.integrationType)}
        <div class="account-info">
          <div class="account-name">
            ${account.name}
            ${account.isDefaultForType ? html`<span class="default-badge">Default</span>` : nothing}
            <span class="type-badge">${account.integrationType}</span>
          </div>
          ${account.cachedUser
            ? html`<div class="account-detail">${account.cachedUser.username || account.cachedUser.displayName}</div>`
            : this.getAccountConfigDetail(account)
              ? html`<div class="account-detail">${this.getAccountConfigDetail(account)}</div>`
              : nothing}
        </div>
        <div class="account-actions">
          <button class="action-btn" @click=${() => this.handleEditAccount(account)} title="Edit account">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="action-btn delete" @click=${() => this.handleRemoveAccount(account.id)} title="Remove account">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  private renderAccountIcon(type: IntegrationType) {
    switch (type) {
      case 'github':
        return html`
          <svg class="account-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
        `;
      case 'gitlab':
        return html`
          <svg class="account-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"/>
          </svg>
        `;
      case 'azure-devops':
        return html`
          <svg class="account-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M0 8.877L2.247 5.91l8.405-3.416V.022l7.37 5.393L2.966 8.338v8.225L0 15.707zm24-4.45v14.651l-5.753 4.9-9.303-3.057v3.056l-5.978-7.416 15.057 1.798V5.415z"/>
          </svg>
        `;
      default:
        return html`
          <svg class="account-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
          </svg>
        `;
    }
  }

  private getAccountConfigDetail(account: ProfileIntegrationAccount): string | null {
    if (account.config.type === 'gitlab' && account.config.instanceUrl) {
      return account.config.instanceUrl;
    }
    if (account.config.type === 'azure-devops' && account.config.organization) {
      return account.config.organization;
    }
    return null;
  }

  private getDefaultConfigForType(type: IntegrationType): IntegrationConfig {
    switch (type) {
      case 'github':
        return { type: 'github' };
      case 'gitlab':
        return { type: 'gitlab', instanceUrl: 'https://gitlab.com' };
      case 'azure-devops':
        return { type: 'azure-devops', organization: '' };
    }
  }

  private renderAccountForm() {
    if (!this.editingAccount) return nothing;

    return html`
      <div class="form-group">
        <label>Account Name</label>
        <input
          type="text"
          placeholder="e.g., Work GitHub, Personal GitLab"
          .value=${this.editingAccount.name ?? ''}
          @input=${(e: Event) => this.updateEditingAccount('name', (e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="form-group">
        <label>Integration Type</label>
        <select
          .value=${this.editingAccount.integrationType ?? 'github'}
          @change=${(e: Event) => this.updateEditingAccount('integrationType', (e.target as HTMLSelectElement).value as IntegrationType)}
        >
          <option value="github" ?selected=${this.editingAccount.integrationType === 'github'}>GitHub</option>
          <option value="gitlab" ?selected=${this.editingAccount.integrationType === 'gitlab'}>GitLab</option>
          <option value="azure-devops" ?selected=${this.editingAccount.integrationType === 'azure-devops'}>Azure DevOps</option>
        </select>
      </div>

      ${this.renderAccountConfigFields()}

      <div class="form-group">
        <label>Color (optional)</label>
        <div class="color-picker">
          <div
            class="color-option ${!this.editingAccount.color ? 'selected' : ''}"
            style="background: var(--color-bg-tertiary); border: 1px dashed var(--color-border);"
            @click=${() => this.updateEditingAccount('color', null)}
            title="Inherit from profile"
          ></div>
          ${ACCOUNT_COLORS.map(
            (color) => html`
              <div
                class="color-option ${this.editingAccount?.color === color ? 'selected' : ''}"
                style="background: ${color}"
                @click=${() => this.updateEditingAccount('color', color)}
              ></div>
            `
          )}
        </div>
        <div class="form-hint">Leave unset to inherit the profile color</div>
      </div>

      <div class="checkbox-row">
        <input
          type="checkbox"
          id="isDefaultForType"
          .checked=${this.editingAccount.isDefaultForType ?? false}
          @change=${(e: Event) => this.updateEditingAccount('isDefaultForType', (e.target as HTMLInputElement).checked)}
        />
        <label for="isDefaultForType">Set as default ${INTEGRATION_TYPE_NAMES[this.editingAccount.integrationType ?? 'github']} account for this profile</label>
      </div>

      <div class="form-hint" style="margin-top: var(--spacing-sm);">
        Note: Authentication tokens are configured separately in the integration dialogs (GitHub, GitLab, Azure DevOps).
      </div>
    `;
  }

  private renderAccountConfigFields() {
    const type = this.editingAccount?.integrationType;
    const config = this.editingAccount?.config;

    if (type === 'gitlab') {
      const instanceUrl = config?.type === 'gitlab' ? config.instanceUrl : '';
      return html`
        <div class="form-group">
          <label>GitLab Instance URL (optional)</label>
          <input
            type="url"
            placeholder="https://gitlab.com"
            .value=${instanceUrl ?? ''}
            @input=${(e: Event) => this.updateEditingAccount('config', {
              type: 'gitlab',
              instanceUrl: (e.target as HTMLInputElement).value || 'https://gitlab.com',
            })}
          />
          <div class="form-hint">Leave empty for gitlab.com, or enter your self-hosted GitLab URL</div>
        </div>
      `;
    }

    if (type === 'azure-devops') {
      const organization = config?.type === 'azure-devops' ? config.organization : '';
      return html`
        <div class="form-group">
          <label>Organization</label>
          <input
            type="text"
            placeholder="my-organization"
            .value=${organization ?? ''}
            @input=${(e: Event) => this.updateEditingAccount('config', {
              type: 'azure-devops',
              organization: (e.target as HTMLInputElement).value || '',
            })}
          />
          <div class="form-hint">Your Azure DevOps organization name</div>
        </div>
      `;
    }

    return nothing;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-profile-manager-dialog': LvProfileManagerDialog;
  }
}
