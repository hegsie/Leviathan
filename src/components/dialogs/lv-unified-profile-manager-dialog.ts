/**
 * Unified Profile Manager Dialog Component
 * Full CRUD interface for managing unified profiles with embedded integration accounts
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as unifiedProfileService from '../../services/unified-profile.service.ts';
import { unifiedProfileStore } from '../../stores/unified-profile.store.ts';
import { showToast } from '../../services/notification.service.ts';
import type {
  UnifiedProfile,
  ProfileIntegrationAccount,
  IntegrationType,
} from '../../types/unified-profile.types.ts';
import {
  PROFILE_COLORS,
  INTEGRATION_TYPE_NAMES,
  generateId,
  createEmptyUnifiedProfile,
  createEmptyGitHubProfileAccount,
  createEmptyGitLabProfileAccount,
  createEmptyAzureDevOpsProfileAccount,
} from '../../types/unified-profile.types.ts';

type ViewMode = 'list' | 'edit-profile' | 'create-profile' | 'edit-account' | 'create-account';

@customElement('lv-unified-profile-manager-dialog')
export class LvUnifiedProfileManagerDialog extends LitElement {
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
        width: 700px;
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

      .btn-sm {
        padding: var(--spacing-xs) var(--spacing-sm);
        font-size: var(--font-size-xs);
      }

      .btn-icon {
        padding: var(--spacing-xs);
        background: none;
        border: none;
      }

      /* Profile list */
      .profile-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .profile-card {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        overflow: hidden;
      }

      .profile-card-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        cursor: pointer;
        transition: background var(--transition-fast);
      }

      .profile-card-header:hover {
        background: var(--color-bg-hover);
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

      .profile-accounts-summary {
        font-size: var(--font-size-xs);
        color: var(--color-text-tertiary);
        margin-top: 2px;
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

      /* Accounts section in profile card */
      .profile-accounts {
        border-top: 1px solid var(--color-border);
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-bg-tertiary);
      }

      .accounts-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--spacing-sm);
      }

      .accounts-title {
        font-size: var(--font-size-xs);
        color: var(--color-text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .account-list {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-xs);
      }

      .account-chip {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: 4px 8px;
        background: var(--color-bg-primary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-xs);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .account-chip:hover {
        border-color: var(--color-accent);
      }

      .account-chip .type-icon {
        color: var(--color-text-tertiary);
      }

      .account-chip .default-indicator {
        color: var(--color-success);
      }

      .no-accounts {
        font-size: var(--font-size-xs);
        color: var(--color-text-tertiary);
        font-style: italic;
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

      /* Accounts section in edit form */
      .form-section {
        margin-top: var(--spacing-lg);
        padding-top: var(--spacing-lg);
        border-top: 1px solid var(--color-border);
      }

      .form-section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--spacing-md);
      }

      .form-section-title {
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
      }

      .account-edit-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm);
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        margin-bottom: var(--spacing-sm);
      }

      .account-edit-info {
        flex: 1;
        min-width: 0;
      }

      .account-edit-name {
        font-weight: var(--font-weight-medium);
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
      }

      .account-edit-type {
        font-size: var(--font-size-xs);
        color: var(--color-text-tertiary);
      }

      .account-edit-actions {
        display: flex;
        gap: var(--spacing-xs);
      }

      /* Add account menu */
      .add-account-menu {
        position: relative;
        display: inline-block;
      }

      .add-account-dropdown {
        position: absolute;
        top: 100%;
        left: 0;
        margin-top: var(--spacing-xs);
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        z-index: 100;
        min-width: 180px;
      }

      .add-account-option {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        width: 100%;
        padding: var(--spacing-sm) var(--spacing-md);
        background: none;
        border: none;
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        cursor: pointer;
        text-align: left;
      }

      .add-account-option:hover {
        background: var(--color-bg-hover);
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: String }) repoPath = '';

  @state() private viewMode: ViewMode = 'list';
  @state() private profiles: UnifiedProfile[] = [];
  @state() private editingProfile: Partial<UnifiedProfile> | null = null;
  @state() private editingAccount: Partial<ProfileIntegrationAccount> | null = null;
  @state() private editingProfileId: string | null = null;
  @state() private isLoading = false;
  @state() private isSaving = false;
  @state() private showAddAccountMenu = false;

  private unsubscribeStore?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
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
    this.editingProfileId = null;
    this.showAddAccountMenu = false;
    this.dispatchEvent(new CustomEvent('close'));
  }

  private handleCreateNewProfile(): void {
    this.editingProfile = {
      ...createEmptyUnifiedProfile(),
      id: generateId(),
    };
    this.viewMode = 'create-profile';
  }

  private handleEditProfile(profile: UnifiedProfile): void {
    this.editingProfile = { ...profile };
    this.editingProfileId = profile.id;
    this.viewMode = 'edit-profile';
  }

  private handleBack(): void {
    if (this.viewMode === 'edit-account' || this.viewMode === 'create-account') {
      this.viewMode = this.editingProfileId ? 'edit-profile' : 'list';
      this.editingAccount = null;
    } else {
      this.viewMode = 'list';
      this.editingProfile = null;
      this.editingProfileId = null;
    }
    this.showAddAccountMenu = false;
  }

  private async handleDeleteProfile(profile: UnifiedProfile, e: Event): Promise<void> {
    e.stopPropagation();
    if (!confirm(`Delete profile "${profile.name}"? This will also remove all associated accounts.`)) {
      return;
    }

    try {
      await unifiedProfileService.deleteUnifiedProfile(profile.id);
      showToast('Profile deleted', 'success');
    } catch (error) {
      showToast(`Failed to delete profile: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }

  private async handleApplyProfile(profile: UnifiedProfile, e: Event): Promise<void> {
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

  private async handleSaveProfile(): Promise<void> {
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
      id: this.editingProfile.id ?? generateId(),
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
      showToast(this.viewMode === 'create-profile' ? 'Profile created' : 'Profile saved', 'success');
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

  // Account management within profile
  private handleAddAccount(type: IntegrationType): void {
    this.showAddAccountMenu = false;

    let account: Omit<ProfileIntegrationAccount, 'id'>;
    switch (type) {
      case 'github':
        account = createEmptyGitHubProfileAccount();
        break;
      case 'gitlab':
        account = createEmptyGitLabProfileAccount();
        break;
      case 'azure-devops':
        account = createEmptyAzureDevOpsProfileAccount();
        break;
    }

    this.editingAccount = {
      ...account,
      id: generateId(),
    };
    this.viewMode = 'create-account';
  }

  private handleEditAccount(account: ProfileIntegrationAccount): void {
    this.editingAccount = { ...account };
    this.viewMode = 'edit-account';
  }

  private handleDeleteAccount(account: ProfileIntegrationAccount): void {
    if (!this.editingProfile) return;
    if (!confirm(`Remove "${account.name}" from this profile?`)) return;

    const accounts = (this.editingProfile.integrationAccounts ?? []).filter(
      (a) => a.id !== account.id
    );
    this.editingProfile = { ...this.editingProfile, integrationAccounts: accounts };
  }

  private updateEditingAccount(field: keyof ProfileIntegrationAccount, value: unknown): void {
    if (this.editingAccount) {
      this.editingAccount = { ...this.editingAccount, [field]: value };
    }
  }

  private handleSaveAccount(): void {
    if (!this.editingProfile || !this.editingAccount) return;

    // Validation
    if (!this.editingAccount.name?.trim()) {
      showToast('Account name is required', 'error');
      return;
    }

    const account: ProfileIntegrationAccount = {
      id: this.editingAccount.id ?? generateId(),
      name: this.editingAccount.name.trim(),
      integrationType: this.editingAccount.integrationType!,
      config: this.editingAccount.config!,
      color: this.editingAccount.color || null,
      cachedUser: this.editingAccount.cachedUser || null,
      isDefaultForType: this.editingAccount.isDefaultForType ?? false,
    };

    let accounts = [...(this.editingProfile.integrationAccounts ?? [])];

    // If setting as default, unset others of same type
    if (account.isDefaultForType) {
      accounts = accounts.map((a) =>
        a.integrationType === account.integrationType && a.id !== account.id
          ? { ...a, isDefaultForType: false }
          : a
      );
    }

    // Update or add
    const existingIdx = accounts.findIndex((a) => a.id === account.id);
    if (existingIdx >= 0) {
      accounts[existingIdx] = account;
    } else {
      accounts.push(account);
    }

    this.editingProfile = { ...this.editingProfile, integrationAccounts: accounts };
    this.editingAccount = null;
    this.viewMode = this.editingProfileId ? 'edit-profile' : 'create-profile';
  }

  private getAccountsSummary(profile: UnifiedProfile): string {
    const count = profile.integrationAccounts.length;
    if (count === 0) return 'No accounts';
    if (count === 1) return '1 account';
    return `${count} accounts`;
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
        return 'Unified Profiles';
      case 'create-profile':
        return 'New Profile';
      case 'edit-profile':
        return 'Edit Profile';
      case 'create-account':
        return 'Add Account';
      case 'edit-account':
        return 'Edit Account';
    }
  }

  private renderContent() {
    switch (this.viewMode) {
      case 'list':
        return this.renderProfileList();
      case 'create-profile':
      case 'edit-profile':
        return this.renderProfileForm();
      case 'create-account':
      case 'edit-account':
        return this.renderAccountForm();
    }
  }

  private renderFooter() {
    switch (this.viewMode) {
      case 'list':
        return html`
          <button class="btn btn-primary" @click=${this.handleCreateNewProfile}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            New Profile
          </button>
        `;
      case 'create-profile':
      case 'edit-profile':
        return html`
          <button class="btn" @click=${this.handleBack}>Cancel</button>
          <button class="btn btn-primary" @click=${this.handleSaveProfile} ?disabled=${this.isSaving}>
            ${this.isSaving ? 'Saving...' : 'Save Profile'}
          </button>
        `;
      case 'create-account':
      case 'edit-account':
        return html`
          <button class="btn" @click=${this.handleBack}>Cancel</button>
          <button class="btn btn-primary" @click=${this.handleSaveAccount}>
            ${this.viewMode === 'create-account' ? 'Add Account' : 'Save Account'}
          </button>
        `;
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
            Create unified profiles to manage your Git identity and platform accounts together.
          </p>
        </div>
      `;
    }

    return html`
      <div class="profile-list">
        ${this.profiles.map((profile) => this.renderProfileCard(profile))}
      </div>
    `;
  }

  private renderProfileCard(profile: UnifiedProfile) {
    return html`
      <div class="profile-card">
        <div class="profile-card-header" @click=${() => this.handleEditProfile(profile)}>
          <div class="profile-color" style="background: ${profile.color}"></div>
          <div class="profile-info">
            <div class="profile-name">
              ${profile.name}
              ${profile.isDefault ? html`<span class="default-badge">Default</span>` : nothing}
            </div>
            <div class="profile-email">${profile.gitName} &lt;${profile.gitEmail}&gt;</div>
            <div class="profile-accounts-summary">${this.getAccountsSummary(profile)}</div>
          </div>
          <div class="profile-actions">
            ${this.repoPath
              ? html`
                  <button
                    class="action-btn"
                    @click=${(e: Event) => this.handleApplyProfile(profile, e)}
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
              @click=${(e: Event) => this.handleDeleteProfile(profile, e)}
              title="Delete profile"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
        ${profile.integrationAccounts.length > 0
          ? html`
              <div class="profile-accounts">
                <div class="accounts-title">Linked Accounts</div>
                <div class="account-list">
                  ${profile.integrationAccounts.map(
                    (account) => html`
                      <span class="account-chip">
                        <span class="type-icon">${this.getIntegrationIcon(account.integrationType)}</span>
                        ${account.name}
                        ${account.isDefaultForType
                          ? html`<span class="default-indicator">★</span>`
                          : nothing}
                      </span>
                    `
                  )}
                </div>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private renderProfileForm() {
    if (!this.editingProfile) return nothing;

    return html`
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
          Use patterns to auto-detect which profile to use. Supports wildcards like * for matching.
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

      <!-- Integration Accounts Section -->
      <div class="form-section">
        <div class="form-section-header">
          <div class="form-section-title">Integration Accounts</div>
          <div class="add-account-menu">
            <button
              class="btn btn-sm"
              @click=${() => { this.showAddAccountMenu = !this.showAddAccountMenu; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Add Account
            </button>
            ${this.showAddAccountMenu
              ? html`
                  <div class="add-account-dropdown">
                    <button class="add-account-option" @click=${() => this.handleAddAccount('github')}>
                      ${this.getIntegrationIcon('github')} GitHub
                    </button>
                    <button class="add-account-option" @click=${() => this.handleAddAccount('gitlab')}>
                      ${this.getIntegrationIcon('gitlab')} GitLab
                    </button>
                    <button class="add-account-option" @click=${() => this.handleAddAccount('azure-devops')}>
                      ${this.getIntegrationIcon('azure-devops')} Azure DevOps
                    </button>
                  </div>
                `
              : nothing}
          </div>
        </div>

        ${(this.editingProfile.integrationAccounts ?? []).length === 0
          ? html`<div class="no-accounts">No accounts linked to this profile yet.</div>`
          : html`
              ${(this.editingProfile.integrationAccounts ?? []).map(
                (account) => html`
                  <div class="account-edit-item">
                    <div class="account-edit-info">
                      <div class="account-edit-name">
                        ${this.getIntegrationIcon(account.integrationType)}
                        ${account.name}
                        ${account.isDefaultForType
                          ? html`<span class="default-badge">Default</span>`
                          : nothing}
                      </div>
                      <div class="account-edit-type">${INTEGRATION_TYPE_NAMES[account.integrationType]}</div>
                    </div>
                    <div class="account-edit-actions">
                      <button class="action-btn" @click=${() => this.handleEditAccount(account)} title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                      </button>
                      <button class="action-btn delete" @click=${() => this.handleDeleteAccount(account)} title="Remove">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>
                  </div>
                `
              )}
            `}
      </div>
    `;
  }

  private renderAccountForm() {
    if (!this.editingAccount) return nothing;

    const type = this.editingAccount.integrationType;

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
        <label>Type</label>
        <input type="text" .value=${type ? INTEGRATION_TYPE_NAMES[type] : ''} disabled />
      </div>

      ${type === 'gitlab'
        ? html`
            <div class="form-group">
              <label>GitLab Instance URL</label>
              <input
                type="url"
                placeholder="https://gitlab.com"
                .value=${this.editingAccount.config?.type === 'gitlab'
                  ? (this.editingAccount.config as { type: 'gitlab'; instanceUrl: string }).instanceUrl
                  : 'https://gitlab.com'}
                @input=${(e: Event) => {
                  const url = (e.target as HTMLInputElement).value;
                  this.updateEditingAccount('config', { type: 'gitlab', instanceUrl: url });
                }}
              />
              <div class="form-hint">Leave as gitlab.com for GitLab.com, or enter your self-hosted instance URL.</div>
            </div>
          `
        : nothing}

      ${type === 'azure-devops'
        ? html`
            <div class="form-group">
              <label>Azure DevOps Organization</label>
              <input
                type="text"
                placeholder="myorganization"
                .value=${this.editingAccount.config?.type === 'azure-devops'
                  ? (this.editingAccount.config as { type: 'azure-devops'; organization: string }).organization
                  : ''}
                @input=${(e: Event) => {
                  const org = (e.target as HTMLInputElement).value;
                  this.updateEditingAccount('config', { type: 'azure-devops', organization: org });
                }}
              />
            </div>
          `
        : nothing}

      <div class="checkbox-row">
        <input
          type="checkbox"
          id="isDefaultForType"
          .checked=${this.editingAccount.isDefaultForType ?? false}
          @change=${(e: Event) =>
            this.updateEditingAccount('isDefaultForType', (e.target as HTMLInputElement).checked)}
        />
        <label for="isDefaultForType">Set as default ${type ? INTEGRATION_TYPE_NAMES[type] : ''} account for this profile</label>
      </div>

      <div class="form-hint" style="margin-top: var(--spacing-md);">
        Note: You'll need to configure the authentication token separately in the integration settings.
      </div>
    `;
  }

  private getIntegrationIcon(type: IntegrationType): ReturnType<typeof html> {
    switch (type) {
      case 'github':
        return html`<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>`;
      case 'gitlab':
        return html`<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"/></svg>`;
      case 'azure-devops':
        return html`<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M0 8.877L2.247 5.91l8.405-3.416V.022l7.37 5.393L2.966 8.338v8.225L0 15.707zm24-4.45v14.651l-5.753 4.9-9.303-3.057v3.056l-5.978-7.416 15.057 1.798V5.415z"/></svg>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-unified-profile-manager-dialog': LvUnifiedProfileManagerDialog;
  }
}
