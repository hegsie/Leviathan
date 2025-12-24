import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { settingsStore, type Theme, type FontSize } from '../../stores/settings.store.ts';
import { sharedStyles } from '../../styles/shared-styles.ts';

@customElement('lv-settings-dialog')
export class LvSettingsDialog extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      .settings-content {
        display: flex;
        flex-direction: column;
        gap: 24px;
        padding: 16px 0;
        max-height: 60vh;
        overflow-y: auto;
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
        border-top: 1px solid var(--border-color);
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
    `,
  ];

  @state() private theme: Theme = 'dark';
  @state() private fontSize: FontSize = 'medium';
  @state() private defaultBranchName = 'main';
  @state() private showAvatars = true;
  @state() private showCommitSize = true;
  @state() private wordWrap = true;
  @state() private confirmBeforeDiscard = true;

  connectedCallback(): void {
    super.connectedCallback();
    this.loadSettings();
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
        </div>
      </div>

      <div class="footer">
        <button class="danger" @click=${this.handleReset}>Reset to Defaults</button>
        <button class="primary" @click=${this.handleClose}>Done</button>
      </div>
    `;
  }
}
