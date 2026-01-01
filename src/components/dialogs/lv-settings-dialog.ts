import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { settingsStore, type Theme, type FontSize } from '../../stores/settings.store.ts';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { getAppVersion, checkForUpdate } from '../../services/update.service.ts';
import * as aiService from '../../services/ai.service.ts';
import type { AiProviderInfo, AiProviderType } from '../../services/ai.service.ts';

@customElement('lv-settings-dialog')
export class LvSettingsDialog extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        width: 500px;
      }

      .settings-content {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .settings-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .section-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
        border-bottom: 1px solid var(--border-color);
        padding-bottom: 8px;
      }

      .setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }

      .setting-label {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .setting-name {
        font-size: 13px;
        color: var(--text-primary);
      }

      .setting-description {
        font-size: 11px;
        color: var(--text-secondary);
      }

      select, input[type="text"], input[type="number"] {
        padding: 6px 10px;
        border: 1px solid var(--border-color);
        border-radius: 4px;
        background: var(--input-background);
        color: var(--text-primary);
        font-size: 13px;
        min-width: 150px;
      }

      select:focus, input:focus {
        outline: none;
        border-color: var(--accent-color);
      }

      input[type="checkbox"] {
        width: 16px;
        height: 16px;
        accent-color: var(--accent-color);
      }

      .toggle-switch {
        position: relative;
        width: 40px;
        height: 22px;
      }

      .toggle-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .toggle-slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--border-color);
        transition: 0.2s;
        border-radius: 22px;
      }

      .toggle-slider:before {
        position: absolute;
        content: "";
        height: 16px;
        width: 16px;
        left: 3px;
        bottom: 3px;
        background-color: var(--toggle-knob-color, #ffffff);
        transition: 0.2s;
        border-radius: 50%;
      }

      input:checked + .toggle-slider {
        background-color: var(--accent-color);
      }

      input:checked + .toggle-slider:before {
        transform: translateX(18px);
      }

      .footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding-top: 16px;
      }

      button {
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 13px;
        cursor: pointer;
        border: 1px solid var(--border-color);
        background: var(--button-background);
        color: var(--text-primary);
      }

      button:hover {
        background: var(--button-hover-background);
      }

      button.primary {
        background: var(--accent-color);
        border-color: var(--accent-color);
        color: white;
      }

      button.primary:hover {
        opacity: 0.9;
      }

      button.danger {
        color: var(--error-color);
      }

      .version-info {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .version-text {
        font-size: 13px;
        color: var(--text-secondary);
      }

      .version-number {
        font-weight: 600;
        color: var(--text-primary);
      }

      .update-status {
        font-size: 12px;
        color: var(--text-secondary);
      }

      .update-status.available {
        color: var(--accent-color);
      }

      .check-update-btn {
        padding: 4px 8px;
        font-size: 12px;
        min-width: auto;
      }

      .progress-bar {
        height: 4px;
        background: var(--border-color);
        border-radius: 2px;
        overflow: hidden;
        margin-top: 8px;
      }

      .progress-fill {
        height: 100%;
        background: var(--accent-color);
        transition: width 0.2s ease;
      }

      .progress-text {
        font-size: 11px;
        color: var(--text-secondary);
        margin-top: 4px;
      }

      .model-status {
        font-size: 11px;
        color: var(--text-secondary);
      }

      .model-status.available {
        color: var(--success-color, #22c55e);
      }

      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .error-text {
        font-size: 11px;
        color: var(--error-color);
        margin-top: 4px;
      }

      .status-indicator {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 4px;
      }

      .status-indicator.configured {
        color: var(--success-color, #22c55e);
        background: rgba(34, 197, 94, 0.1);
      }

      .status-indicator.not-configured {
        color: var(--text-secondary);
        background: var(--border-color);
      }

      .status-indicator.testing {
        color: var(--accent-color);
      }

      .status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
      }

      .provider-status-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 4px;
      }
    `,
  ];

  @state() private theme: Theme = 'dark';
  @state() private appVersion = '';
  @state() private updateStatus: 'idle' | 'checking' | 'available' | 'up-to-date' = 'idle';
  @state() private latestVersion = '';
  @state() private fontSize: FontSize = 'medium';
  @state() private defaultBranchName = 'main';
  @state() private showAvatars = true;
  @state() private showCommitSize = true;
  @state() private wordWrap = true;
  @state() private confirmBeforeDiscard = true;
  @state() private staleBranchDays = 90;

  // AI settings
  @state() private aiProviders: AiProviderInfo[] = [];
  @state() private activeProvider: AiProviderType | null = null;
  @state() private aiError: string | null = null;
  @state() private testingProvider: AiProviderType | null = null;
  @state() private providerTestStatus: Record<string, 'untested' | 'success' | 'failed'> = {};
  @state() private apiKeyInputs: Record<string, string> = {};

  connectedCallback(): void {
    super.connectedCallback();
    this.loadSettings();
    this.loadVersion();
    this.loadAiProviders();
  }

  private async loadVersion(): Promise<void> {
    this.appVersion = await getAppVersion();
  }

  private async loadAiProviders(): Promise<void> {
    const [providersResult, activeResult] = await Promise.all([
      aiService.getAiProviders(),
      aiService.getActiveAiProvider(),
    ]);

    if (providersResult.success && providersResult.data) {
      this.aiProviders = providersResult.data;
    }

    if (activeResult.success && activeResult.data !== undefined) {
      this.activeProvider = activeResult.data;
    }
  }

  private async handleProviderSelect(providerType: AiProviderType): Promise<void> {
    this.aiError = null;
    const result = await aiService.setAiProvider(providerType);
    if (result.success) {
      this.activeProvider = providerType;
    } else {
      this.aiError = result.error?.message ?? 'Failed to set provider';
    }
  }

  private async handleApiKeyChange(providerType: AiProviderType, apiKey: string): Promise<void> {
    this.apiKeyInputs = { ...this.apiKeyInputs, [providerType]: apiKey };
  }

  private async handleSaveApiKey(providerType: AiProviderType): Promise<void> {
    this.aiError = null;
    const apiKey = this.apiKeyInputs[providerType] || '';
    const result = await aiService.setAiApiKey(providerType, apiKey || null);
    if (result.success) {
      await this.loadAiProviders();
    } else {
      this.aiError = result.error?.message ?? 'Failed to save API key';
    }
  }

  private async handleModelChange(providerType: AiProviderType, model: string): Promise<void> {
    this.aiError = null;
    const result = await aiService.setAiModel(providerType, model || null);
    if (result.success) {
      await this.loadAiProviders();
    } else {
      this.aiError = result.error?.message ?? 'Failed to set model';
    }
  }

  private async handleTestProvider(providerType: AiProviderType): Promise<void> {
    this.testingProvider = providerType;
    this.aiError = null;

    const result = await aiService.testAiProvider(providerType);
    this.testingProvider = null;

    if (result.success && result.data) {
      this.providerTestStatus = { ...this.providerTestStatus, [providerType]: 'success' };
    } else {
      this.providerTestStatus = { ...this.providerTestStatus, [providerType]: 'failed' };
      this.aiError = `${aiService.getProviderDisplayName(providerType)} is not available. Check your API key and try again.`;
    }
  }

  private async handleCheckForUpdate(): Promise<void> {
    this.updateStatus = 'checking';
    const result = await checkForUpdate();
    if (result) {
      if (result.updateAvailable) {
        this.updateStatus = 'available';
        this.latestVersion = result.latestVersion ?? '';
      } else {
        this.updateStatus = 'up-to-date';
      }
    } else {
      this.updateStatus = 'idle';
    }
  }

  private loadSettings(): void {
    const settings = settingsStore.getState();
    this.theme = settings.theme;
    this.fontSize = settings.fontSize;
    this.defaultBranchName = settings.defaultBranchName;
    this.showAvatars = settings.showAvatars;
    this.showCommitSize = settings.showCommitSize;
    this.wordWrap = settings.wordWrap;
    this.confirmBeforeDiscard = settings.confirmBeforeDiscard;
    this.staleBranchDays = settings.staleBranchDays;
  }

  private handleThemeChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    this.theme = select.value as Theme;
    settingsStore.getState().setTheme(this.theme);
  }

  private handleFontSizeChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    this.fontSize = select.value as FontSize;
    settingsStore.getState().setFontSize(this.fontSize);
  }

  private handleBranchNameChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.defaultBranchName = input.value;
    settingsStore.getState().setDefaultBranchName(this.defaultBranchName);
  }

  private handleStaleBranchDaysChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    const value = Math.max(0, parseInt(input.value, 10) || 0);
    this.staleBranchDays = value;
    settingsStore.getState().setStaleBranchDays(value);
  }

  private handleToggle(setting: string, e: Event): void {
    const input = e.target as HTMLInputElement;
    const value = input.checked;
    const store = settingsStore.getState();

    switch (setting) {
      case 'showAvatars':
        this.showAvatars = value;
        store.setShowAvatars(value);
        break;
      case 'showCommitSize':
        this.showCommitSize = value;
        store.setShowCommitSize(value);
        break;
      case 'wordWrap':
        this.wordWrap = value;
        store.setWordWrap(value);
        break;
      case 'confirmBeforeDiscard':
        this.confirmBeforeDiscard = value;
        store.setConfirmBeforeDiscard(value);
        break;
    }
  }

  private handleReset(): void {
    settingsStore.getState().resetToDefaults();
    this.loadSettings();
  }

  private handleClose(): void {
    this.dispatchEvent(new CustomEvent('close'));
  }

  private renderToggle(checked: boolean, setting: string): unknown {
    return html`
      <label class="toggle-switch">
        <input
          type="checkbox"
          .checked=${checked}
          @change=${(e: Event) => this.handleToggle(setting, e)}
        />
        <span class="toggle-slider"></span>
      </label>
    `;
  }

  render() {
    return html`
      <div class="settings-content">
        <div class="settings-section">
          <div class="section-title">Appearance</div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Theme</span>
              <span class="setting-description">Choose your preferred color scheme</span>
            </div>
            <select .value=${this.theme} @change=${this.handleThemeChange}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Font Size</span>
              <span class="setting-description">Adjust the base font size</span>
            </div>
            <select .value=${this.fontSize} @change=${this.handleFontSizeChange}>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
        </div>

        <div class="settings-section">
          <div class="section-title">Graph</div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Show Avatars</span>
              <span class="setting-description">Display author avatars in commit nodes</span>
            </div>
            ${this.renderToggle(this.showAvatars, 'showAvatars')}
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Show Commit Size</span>
              <span class="setting-description">Scale node size based on changes</span>
            </div>
            ${this.renderToggle(this.showCommitSize, 'showCommitSize')}
          </div>
        </div>

        <div class="settings-section">
          <div class="section-title">Git Defaults</div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Default Branch Name</span>
              <span class="setting-description">Used when initializing new repositories</span>
            </div>
            <input
              type="text"
              .value=${this.defaultBranchName}
              @change=${this.handleBranchNameChange}
            />
          </div>
        </div>

        <div class="settings-section">
          <div class="section-title">Editor</div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Word Wrap</span>
              <span class="setting-description">Wrap long lines in diff view</span>
            </div>
            ${this.renderToggle(this.wordWrap, 'wordWrap')}
          </div>
        </div>

        <div class="settings-section">
          <div class="section-title">Behavior</div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Confirm Before Discard</span>
              <span class="setting-description">Ask for confirmation when discarding changes</span>
            </div>
            ${this.renderToggle(this.confirmBeforeDiscard, 'confirmBeforeDiscard')}
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Stale Branch Threshold</span>
              <span class="setting-description">Days without commits before a branch is marked stale (0 to disable)</span>
            </div>
            <input
              type="number"
              min="0"
              .value=${String(this.staleBranchDays)}
              @change=${this.handleStaleBranchDaysChange}
              style="width: 80px;"
            />
          </div>
        </div>

        <div class="settings-section">
          <div class="section-title">AI Features</div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">AI Provider</span>
              <span class="setting-description">
                Select an AI provider for commit message generation
              </span>
            </div>
            <select
              .value=${this.activeProvider || ''}
              @change=${(e: Event) => {
                const value = (e.target as HTMLSelectElement).value;
                if (value) this.handleProviderSelect(value as AiProviderType);
              }}
            >
              <option value="">Select provider...</option>
              ${this.aiProviders.map(
                (p) => html`
                  <option value=${p.providerType} ?selected=${this.activeProvider === p.providerType}>
                    ${p.name} ${p.available ? '(Available)' : p.requiresApiKey && !p.hasApiKey ? '(API key required)' : '(Unavailable)'}
                  </option>
                `
              )}
            </select>
          </div>

          ${this.aiError ? html`
            <div class="setting-row">
              <span class="error-text">${this.aiError}</span>
            </div>
          ` : nothing}

          ${this.aiProviders.filter(p => p.requiresApiKey).map(provider => {
            const testStatus = this.providerTestStatus[provider.providerType];
            const isTesting = this.testingProvider === provider.providerType;
            return html`
              <div class="setting-row">
                <div class="setting-label">
                  <span class="setting-name">${provider.name} API Key</span>
                  <div class="provider-status-row">
                    ${provider.hasApiKey ? html`
                      <span class="status-indicator configured">
                        <span class="status-dot"></span>
                        Configured
                      </span>
                    ` : html`
                      <span class="status-indicator not-configured">
                        <span class="status-dot"></span>
                        Not configured
                      </span>
                    `}
                    ${testStatus === 'success' ? html`
                      <span class="status-indicator configured">
                        ✓ Working
                      </span>
                    ` : testStatus === 'failed' ? html`
                      <span class="status-indicator" style="color: var(--error-color); background: rgba(239, 68, 68, 0.1);">
                        ✗ Failed
                      </span>
                    ` : nothing}
                  </div>
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                  <input
                    type="password"
                    placeholder=${provider.hasApiKey ? '••••••••' : 'Enter API key...'}
                    .value=${this.apiKeyInputs[provider.providerType] || ''}
                    @input=${(e: Event) =>
                      this.handleApiKeyChange(
                        provider.providerType,
                        (e.target as HTMLInputElement).value
                      )}
                    style="width: 180px;"
                  />
                  <button
                    @click=${() => this.handleSaveApiKey(provider.providerType)}
                    ?disabled=${!this.apiKeyInputs[provider.providerType]}
                  >
                    Save
                  </button>
                  <button
                    @click=${() => this.handleTestProvider(provider.providerType)}
                    ?disabled=${isTesting || !provider.hasApiKey}
                  >
                    ${isTesting ? 'Testing...' : 'Test'}
                  </button>
                </div>
              </div>
            `;
          })}

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Local Providers</span>
              <span class="setting-description">
                Ollama and LM Studio are auto-detected when running locally
              </span>
            </div>
            <button
              @click=${() => this.loadAiProviders()}
            >
              Refresh
            </button>
          </div>
        </div>

        <div class="settings-section">
          <div class="section-title">About</div>

          <div class="setting-row">
            <div class="version-info">
              <span class="version-text">
                Version: <span class="version-number">${this.appVersion || 'Loading...'}</span>
              </span>
              ${this.updateStatus === 'checking' ? html`
                <span class="update-status">Checking for updates...</span>
              ` : this.updateStatus === 'available' ? html`
                <span class="update-status available">Update available: v${this.latestVersion}</span>
              ` : this.updateStatus === 'up-to-date' ? html`
                <span class="update-status">You're up to date!</span>
              ` : ''}
            </div>
            <button
              class="check-update-btn"
              @click=${this.handleCheckForUpdate}
              ?disabled=${this.updateStatus === 'checking'}
            >
              ${this.updateStatus === 'checking' ? 'Checking...' : 'Check for Updates'}
            </button>
          </div>
        </div>
      </div>

      <div class="footer">
        <button class="danger" @click=${this.handleReset}>Reset to Defaults</button>
        <button class="primary" @click=${this.handleClose}>Done</button>
      </div>
    `;
  }
}
