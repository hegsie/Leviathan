/**
 * Profile Manager Dialog Component
 * Full CRUD interface for managing Git identity profiles
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import { workflowStore } from '../../stores/workflow.store.ts';
import type { GitProfile } from '../../types/workflow.types.ts';
import { PROFILE_COLORS } from '../../types/workflow.types.ts';
import { showToast } from '../../services/notification.service.ts';

type ViewMode = 'list' | 'edit' | 'create';

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
        width: 600px;
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

      .profile-patterns {
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
      .form-group textarea {
        width: 100%;
        padding: var(--spacing-sm);
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
      }

      .form-group input:focus,
      .form-group textarea:focus {
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
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: String }) repoPath = '';

  @state() private viewMode: ViewMode = 'list';
  @state() private profiles: GitProfile[] = [];
  @state() private editingProfile: Partial<GitProfile> | null = null;
  @state() private isLoading = false;
  @state() private isSaving = false;

  connectedCallback(): void {
    super.connectedCallback();
    // Subscribe to store changes
    workflowStore.subscribe((state) => {
      this.profiles = state.profiles;
      this.isLoading = state.isLoadingProfiles;
    });
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('open') && this.open) {
      this.loadProfiles();
    }
  }

  private async loadProfiles(): Promise<void> {
    await gitService.loadProfiles();
  }

  private handleClose(): void {
    this.open = false;
    this.viewMode = 'list';
    this.editingProfile = null;
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
    };
    this.viewMode = 'create';
  }

  private handleEdit(profile: GitProfile): void {
    this.editingProfile = { ...profile };
    this.viewMode = 'edit';
  }

  private handleBack(): void {
    this.viewMode = 'list';
    this.editingProfile = null;
  }

  private async handleDelete(profile: GitProfile, e: Event): Promise<void> {
    e.stopPropagation();
    if (!confirm(`Delete profile "${profile.name}"?`)) {
      return;
    }

    const result = await gitService.deleteProfile(profile.id);
    if (result.success) {
      showToast('Profile deleted', 'success');
    } else {
      showToast(`Failed to delete profile: ${result.error?.message}`, 'error');
    }
  }

  private async handleApply(profile: GitProfile, e: Event): Promise<void> {
    e.stopPropagation();
    if (!this.repoPath) {
      showToast('No repository open', 'error');
      return;
    }

    const result = await gitService.applyProfile(this.repoPath, profile.id);
    if (!result.success) {
      showToast(`Failed to apply profile: ${result.error?.message}`, 'error');
    }
  }

  private updateEditingProfile(field: keyof GitProfile, value: unknown): void {
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

    const profile: GitProfile = {
      id: this.editingProfile.id ?? crypto.randomUUID(),
      name: this.editingProfile.name.trim(),
      gitName: this.editingProfile.gitName.trim(),
      gitEmail: this.editingProfile.gitEmail.trim(),
      signingKey: this.editingProfile.signingKey?.trim() || null,
      urlPatterns: this.editingProfile.urlPatterns ?? [],
      isDefault: this.editingProfile.isDefault ?? false,
      color: this.editingProfile.color ?? PROFILE_COLORS[0],
    };

    const result = await gitService.saveProfile(profile);
    this.isSaving = false;

    if (result.success) {
      showToast(this.viewMode === 'create' ? 'Profile created' : 'Profile saved', 'success');
      this.handleBack();
    } else {
      showToast(`Failed to save profile: ${result.error?.message}`, 'error');
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

  render() {
    if (!this.open) return nothing;

    return html`
      <div class="dialog-overlay" @click=${(e: Event) => e.target === e.currentTarget && this.handleClose()}>
        <div class="dialog">
          <div class="dialog-header">
            <div class="dialog-title">
              ${this.viewMode !== 'list'
                ? html`
                    <button class="back-btn" @click=${this.handleBack} title="Back to list">
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
              ${this.viewMode === 'list'
                ? 'Git Profiles'
                : this.viewMode === 'create'
                  ? 'New Profile'
                  : 'Edit Profile'}
            </div>
            <button class="close-btn" @click=${this.handleClose}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="dialog-content">
            ${this.viewMode === 'list' ? this.renderProfileList() : this.renderProfileForm()}
          </div>
          <div class="dialog-footer">
            ${this.viewMode === 'list'
              ? html`
                  <button class="btn btn-primary" @click=${this.handleCreateNew}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    New Profile
                  </button>
                `
              : html`
                  <button class="btn btn-secondary" @click=${this.handleBack}>Cancel</button>
                  <button class="btn btn-primary" @click=${this.handleSave} ?disabled=${this.isSaving}>
                    ${this.isSaving ? 'Saving...' : 'Save Profile'}
                  </button>
                `}
          </div>
        </div>
      </div>
    `;
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
            Create profiles to quickly switch between different Git identities
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
                ${profile.urlPatterns.length > 0
                  ? html`<div class="profile-patterns">${profile.urlPatterns.join(', ')}</div>`
                  : nothing}
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
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-profile-manager-dialog': LvProfileManagerDialog;
  }
}
