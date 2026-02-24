import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import type { ConfigEntry, GitAlias, UserIdentity } from '../../services/git.service.ts';
import { showConfirm } from '../../services/dialog.service.ts';
import './lv-modal.ts';

type TabId = 'identity' | 'settings' | 'aliases';

/**
 * Git Configuration Dialog
 * Manage git configuration settings, identity, and aliases
 */
@customElement('lv-config-dialog')
export class LvConfigDialog extends LitElement {
  static styles = [
    sharedStyles,
    css`
      .content {
        padding: var(--spacing-md);
        min-width: 550px;
      }

      .tabs {
        display: flex;
        gap: var(--spacing-xs);
        margin-bottom: var(--spacing-md);
        border-bottom: 1px solid var(--color-border);
        padding-bottom: var(--spacing-xs);
      }

      .tab {
        padding: var(--spacing-xs) var(--spacing-md);
        border: none;
        background: none;
        color: var(--color-text-secondary);
        cursor: pointer;
        font-size: var(--font-size-sm);
        border-radius: var(--radius-sm) var(--radius-sm) 0 0;
        transition: all var(--transition-fast);
      }

      .tab:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
      }

      .tab.active {
        color: var(--color-primary);
        background: var(--color-bg-tertiary);
        font-weight: var(--font-weight-medium);
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

      .error-banner {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm);
        background: var(--color-error-bg);
        color: var(--color-error);
        border-radius: var(--radius-md);
        margin-bottom: var(--spacing-md);
        font-size: var(--font-size-sm);
      }

      .form-group {
        margin-bottom: var(--spacing-md);
      }

      .form-group label {
        display: block;
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        margin-bottom: var(--spacing-xs);
        color: var(--color-text-secondary);
      }

      .form-group input,
      .form-group select {
        width: 100%;
        padding: var(--spacing-sm);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-primary);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
      }

      .form-group input:focus,
      .form-group select:focus {
        outline: none;
        border-color: var(--color-primary);
      }

      .form-group .hint {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        margin-top: var(--spacing-xs);
      }

      .scope-badge {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        background: var(--color-bg-secondary);
        padding: 2px 6px;
        border-radius: var(--radius-sm);
        margin-left: var(--spacing-xs);
      }

      .form-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-lg);
      }

      .scope-toggle {
        display: flex;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-md);
      }

      .scope-btn {
        flex: 1;
        padding: var(--spacing-sm);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-tertiary);
        color: var(--color-text-secondary);
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .scope-btn:hover {
        border-color: var(--color-primary);
      }

      .scope-btn.active {
        border-color: var(--color-primary);
        background: var(--color-primary-bg);
        color: var(--color-primary);
      }

      .settings-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        max-height: 350px;
        overflow-y: auto;
      }

      .setting-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-border);
      }

      .setting-key {
        font-family: var(--font-family-mono);
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
      }

      .setting-value {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .setting-value input {
        width: 200px;
        padding: var(--spacing-xs) var(--spacing-sm);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: var(--color-bg-primary);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        font-family: var(--font-family-mono);
      }

      .alias-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        max-height: 300px;
        overflow-y: auto;
        margin-bottom: var(--spacing-md);
      }

      .alias-item {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        padding: var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-border);
      }

      .alias-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .alias-name {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
        font-family: var(--font-family-mono);
      }

      .alias-command {
        font-family: var(--font-family-mono);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        white-space: pre-wrap;
        word-break: break-all;
        padding: var(--spacing-xs);
        background: var(--color-bg-primary);
        border-radius: var(--radius-sm);
      }

      .add-alias-form {
        padding: var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-border);
      }

      .add-alias-form h4 {
        margin: 0 0 var(--spacing-md) 0;
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
      }

      .btn-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .btn-icon:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .btn-icon.danger:hover {
        background: var(--color-error-bg);
        color: var(--color-error);
      }

      .btn-icon svg {
        width: 16px;
        height: 16px;
      }

      .empty-state {
        text-align: center;
        padding: var(--spacing-xl);
        color: var(--color-text-muted);
      }

      .loading-indicator {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-lg);
        color: var(--color-text-muted);
      }

      .inline-form {
        display: flex;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-sm);
      }

      .inline-form input {
        flex: 1;
        padding: var(--spacing-sm);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-primary);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
      }

      .inline-form input:focus {
        outline: none;
        border-color: var(--color-primary);
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: String }) repositoryPath = '';

  @state() private activeTab: TabId = 'identity';
  @state() private loading = false;
  @state() private error: string | null = null;
  @state() private saveScope: 'local' | 'global' = 'local';

  // Identity state
  @state() private identity: UserIdentity | null = null;
  @state() private editName = '';
  @state() private editEmail = '';
  @state() private saving = false;

  // Settings state
  @state() private settings: ConfigEntry[] = [];

  // Aliases state
  @state() private aliases: GitAlias[] = [];
  @state() private newAliasName = '';
  @state() private newAliasCommand = '';

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('open') && this.open) {
      this.loadData();
    }
  }

  private async loadData(): Promise<void> {
    this.loading = true;
    this.error = null;

    try {
      const [identityResult, settingsResult, aliasesResult] = await Promise.all([
        gitService.getUserIdentity(this.repositoryPath),
        gitService.getCommonSettings(this.repositoryPath),
        gitService.getAliases(this.repositoryPath),
      ]);

      if (identityResult.success && identityResult.data) {
        this.identity = identityResult.data;
        this.editName = identityResult.data.name || '';
        this.editEmail = identityResult.data.email || '';
      }

      if (settingsResult.success && settingsResult.data) {
        this.settings = settingsResult.data;
      }

      if (aliasesResult.success && aliasesResult.data) {
        this.aliases = aliasesResult.data;
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to load configuration';
    } finally {
      this.loading = false;
    }
  }

  private handleClose(): void {
    this.dispatchEvent(new CustomEvent('close'));
  }

  private async handleSaveIdentity(): Promise<void> {
    this.saving = true;
    this.error = null;

    try {
      const result = await gitService.setUserIdentity(
        this.saveScope === 'local' ? this.repositoryPath : null,
        this.editName,
        this.editEmail,
        this.saveScope === 'global'
      );

      if (result.success) {
        await this.loadData();
      } else {
        this.error = result.error?.message || 'Failed to save identity';
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to save identity';
    } finally {
      this.saving = false;
    }
  }

  private async handleSaveSetting(key: string, value: string): Promise<void> {
    this.error = null;

    try {
      const result = await gitService.setConfigValue(
        this.repositoryPath,
        key,
        value,
        false // local
      );

      if (!result.success) {
        this.error = result.error?.message || 'Failed to save setting';
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to save setting';
    }
  }

  private async handleAddAlias(): Promise<void> {
    if (!this.newAliasName || !this.newAliasCommand) return;

    this.error = null;

    try {
      const result = await gitService.setAlias(
        this.saveScope === 'local' ? this.repositoryPath : null,
        this.newAliasName,
        this.newAliasCommand,
        this.saveScope === 'global'
      );

      if (result.success) {
        this.newAliasName = '';
        this.newAliasCommand = '';
        await this.loadData();
      } else {
        this.error = result.error?.message || 'Failed to add alias';
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to add alias';
    }
  }

  private async handleDeleteAlias(alias: GitAlias): Promise<void> {
    const confirmed = await showConfirm('Delete Alias', `Delete alias "${alias.name}"?`, 'warning');
    if (!confirmed) return;

    this.error = null;

    try {
      const result = await gitService.deleteAlias(
        alias.isGlobal ? null : this.repositoryPath,
        alias.name,
        alias.isGlobal
      );

      if (result.success) {
        await this.loadData();
      } else {
        this.error = result.error?.message || 'Failed to delete alias';
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to delete alias';
    }
  }

  private renderIdentityTab() {
    if (this.loading) {
      return html`<div class="loading-indicator">Loading...</div>`;
    }

    return html`
      <div class="scope-toggle">
        <button
          class="scope-btn ${this.saveScope === 'local' ? 'active' : ''}"
          @click=${() => (this.saveScope = 'local')}
        >
          Repository
        </button>
        <button
          class="scope-btn ${this.saveScope === 'global' ? 'active' : ''}"
          @click=${() => (this.saveScope = 'global')}
        >
          Global
        </button>
      </div>

      <div class="form-group">
        <label>
          Name
          ${this.identity?.nameIsGlobal
            ? html`<span class="scope-badge">from global</span>`
            : ''}
        </label>
        <input
          type="text"
          placeholder="Your Name"
          .value=${this.editName}
          @input=${(e: Event) => (this.editName = (e.target as HTMLInputElement).value)}
        />
        <div class="hint">The name that will appear in your commits</div>
      </div>

      <div class="form-group">
        <label>
          Email
          ${this.identity?.emailIsGlobal
            ? html`<span class="scope-badge">from global</span>`
            : ''}
        </label>
        <input
          type="email"
          placeholder="you@example.com"
          .value=${this.editEmail}
          @input=${(e: Event) => (this.editEmail = (e.target as HTMLInputElement).value)}
        />
        <div class="hint">The email that will appear in your commits</div>
      </div>

      <div class="form-actions">
        <button
          class="btn btn-primary"
          ?disabled=${this.saving}
          @click=${this.handleSaveIdentity}
        >
          ${this.saving ? 'Saving...' : `Save to ${this.saveScope}`}
        </button>
      </div>
    `;
  }

  private renderSettingsTab() {
    if (this.loading) {
      return html`<div class="loading-indicator">Loading...</div>`;
    }

    if (this.settings.length === 0) {
      return html`
        <div class="empty-state">
          <p>No common settings configured</p>
        </div>
      `;
    }

    return html`
      <div class="settings-list">
        ${this.settings.map(
          (setting) => html`
            <div class="setting-item">
              <div>
                <span class="setting-key">${setting.key}</span>
                <span class="scope-badge">${setting.scope}</span>
              </div>
              <div class="setting-value">
                <input
                  type="text"
                  .value=${setting.value}
                  @change=${(e: Event) =>
                    this.handleSaveSetting(setting.key, (e.target as HTMLInputElement).value)}
                />
              </div>
            </div>
          `
        )}
      </div>

      <div class="form-group" style="margin-top: var(--spacing-md)">
        <div class="hint">
          Changes are saved automatically when you modify a value.
          Configure additional settings via git config command.
        </div>
      </div>
    `;
  }

  private renderAliasesTab() {
    if (this.loading) {
      return html`<div class="loading-indicator">Loading...</div>`;
    }

    return html`
      ${this.aliases.length > 0
        ? html`
            <div class="alias-list">
              ${this.aliases.map(
                (alias) => html`
                  <div class="alias-item">
                    <div class="alias-header">
                      <span class="alias-name">
                        git ${alias.name}
                        <span class="scope-badge">${alias.isGlobal ? 'global' : 'local'}</span>
                      </span>
                      <button
                        class="btn-icon danger"
                        title="Delete alias"
                        @click=${() => this.handleDeleteAlias(alias)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                      </button>
                    </div>
                    <div class="alias-command">${alias.command}</div>
                  </div>
                `
              )}
            </div>
          `
        : html`
            <div class="empty-state" style="padding: var(--spacing-md)">
              <p>No aliases configured</p>
            </div>
          `}

      <div class="add-alias-form">
        <h4>Add New Alias</h4>
        <div class="scope-toggle" style="margin-bottom: var(--spacing-sm)">
          <button
            class="scope-btn ${this.saveScope === 'local' ? 'active' : ''}"
            @click=${() => (this.saveScope = 'local')}
          >
            Repository
          </button>
          <button
            class="scope-btn ${this.saveScope === 'global' ? 'active' : ''}"
            @click=${() => (this.saveScope = 'global')}
          >
            Global
          </button>
        </div>
        <div class="inline-form">
          <input
            type="text"
            placeholder="Alias name (e.g., co)"
            .value=${this.newAliasName}
            @input=${(e: Event) => (this.newAliasName = (e.target as HTMLInputElement).value)}
            style="flex: 0 0 150px"
          />
          <input
            type="text"
            placeholder="Command (e.g., checkout)"
            .value=${this.newAliasCommand}
            @input=${(e: Event) => (this.newAliasCommand = (e.target as HTMLInputElement).value)}
          />
          <button
            class="btn btn-primary"
            ?disabled=${!this.newAliasName || !this.newAliasCommand}
            @click=${this.handleAddAlias}
          >
            Add
          </button>
        </div>
        <div class="hint" style="margin-top: var(--spacing-xs)">
          Example: name "co" with command "checkout" creates "git co" as alias for "git checkout"
        </div>
      </div>
    `;
  }

  render() {
    if (!this.open) return null;

    return html`
      <lv-modal modalTitle="Git Configuration" open @close=${this.handleClose}>
        <div class="content">
          ${this.error
            ? html`
                <div class="error-banner">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="15" y1="9" x2="9" y2="15"></line>
                    <line x1="9" y1="9" x2="15" y2="15"></line>
                  </svg>
                  ${this.error}
                </div>
              `
            : ''}

          <div class="tabs">
            <button
              class="tab ${this.activeTab === 'identity' ? 'active' : ''}"
              @click=${() => (this.activeTab = 'identity')}
            >
              Identity
            </button>
            <button
              class="tab ${this.activeTab === 'settings' ? 'active' : ''}"
              @click=${() => (this.activeTab = 'settings')}
            >
              Settings
            </button>
            <button
              class="tab ${this.activeTab === 'aliases' ? 'active' : ''}"
              @click=${() => (this.activeTab = 'aliases')}
            >
              Aliases
            </button>
          </div>

          ${this.activeTab === 'identity'
            ? this.renderIdentityTab()
            : this.activeTab === 'settings'
              ? this.renderSettingsTab()
              : this.renderAliasesTab()}
        </div>
      </lv-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-config-dialog': LvConfigDialog;
  }
}
