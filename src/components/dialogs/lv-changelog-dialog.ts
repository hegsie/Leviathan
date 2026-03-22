/**
 * Changelog Generation Dialog
 * AI-powered release notes generation from commit history
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as aiService from '../../services/ai.service.ts';
import * as gitService from '../../services/git.service.ts';
import type { Tag } from '../../types/git.types.ts';
import { showToast } from '../../services/notification.service.ts';
import './lv-modal.ts';

@customElement('lv-changelog-dialog')
export class LvChangelogDialog extends LitElement {
  static styles = [
    sharedStyles,
    css`
      .form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .field label {
        font-size: var(--font-size-sm);
        font-weight: 500;
        color: var(--color-text-secondary);
      }

      .field select,
      .field input {
        padding: 8px 12px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
      }

      .field select:focus,
      .field input:focus {
        outline: none;
        border-color: var(--color-accent);
      }

      .ref-row {
        display: flex;
        gap: var(--spacing-md);
      }

      .ref-row .field {
        flex: 1;
      }

      .result-area {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .result-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .result-label {
        font-size: var(--font-size-sm);
        font-weight: 500;
        color: var(--color-text-secondary);
      }

      .copy-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-text-secondary);
        font-size: var(--font-size-xs);
        cursor: pointer;
      }

      .copy-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      textarea.result {
        width: 100%;
        min-height: 250px;
        padding: 12px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: var(--color-bg-secondary);
        color: var(--color-text-primary);
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        line-height: 1.6;
        resize: vertical;
        box-sizing: border-box;
      }

      textarea.result:focus {
        outline: none;
        border-color: var(--color-accent);
      }

      .error-message {
        padding: 8px 12px;
        background: var(--color-bg-error);
        border: 1px solid var(--color-border-error);
        border-radius: var(--radius-sm);
        color: var(--color-text-error);
        font-size: var(--font-size-sm);
      }

      .generating {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 40px;
        color: var(--color-text-secondary);
        font-size: var(--font-size-sm);
      }

      .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid var(--color-border);
        border-top-color: var(--color-accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `,
  ];

  @property({ type: String }) repositoryPath = '';

  @state() private baseRef = '';
  @state() private compareRef = 'HEAD';
  @state() private result = '';
  @state() private isGenerating = false;
  @state() private error = '';
  @state() private tags: Tag[] = [];
  @state() private aiAvailable = false;

  @query('lv-modal') private modal!: HTMLElement & { open: boolean };

  public async open(): Promise<void> {
    this.reset();
    (this.modal as HTMLElement & { open: boolean }).open = true;
    await this.loadTags();
    this.aiAvailable = await aiService.isAiAvailable();
  }

  public close(): void {
    this.modal.open = false;
  }

  private reset(): void {
    this.baseRef = '';
    this.compareRef = 'HEAD';
    this.result = '';
    this.error = '';
    this.isGenerating = false;
  }

  private async loadTags(): Promise<void> {
    const result = await gitService.getTags(this.repositoryPath);
    if (result.success && result.data) {
      this.tags = result.data;
      // Default baseRef to the second most recent tag (previous release)
      if (this.tags.length >= 2) {
        this.baseRef = this.tags[1].name;
        this.compareRef = this.tags[0].name;
      } else if (this.tags.length === 1) {
        this.baseRef = this.tags[0].name;
        this.compareRef = 'HEAD';
      }
    }
  }

  private async handleGenerate(): Promise<void> {
    if (!this.baseRef) {
      this.error = 'Please select a base ref (e.g., a previous tag)';
      return;
    }

    this.isGenerating = true;
    this.error = '';
    this.result = '';

    const changelogResult = await aiService.generateChangelog(
      this.repositoryPath,
      this.baseRef,
      this.compareRef,
    );

    if (changelogResult.success && changelogResult.data) {
      this.result = changelogResult.data.content;
    } else {
      this.error = changelogResult.error?.message ?? 'Failed to generate changelog';
      showToast(this.error, 'error');
    }

    this.isGenerating = false;
  }

  private async handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.result);
      showToast('Changelog copied to clipboard', 'success');
    } catch {
      showToast('Failed to copy to clipboard', 'error');
    }
  }

  private handleModalClose(): void {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <lv-modal
        modalTitle="Generate Changelog"
        @close=${this.handleModalClose}
      >
        <div class="form">
          <div class="ref-row">
            <div class="field">
              <label>From (base ref)</label>
              ${this.tags.length > 0 ? html`
                <select
                  .value=${this.baseRef}
                  @change=${(e: Event) => { this.baseRef = (e.target as HTMLSelectElement).value; }}
                  ?disabled=${this.isGenerating}
                >
                  <option value="">Select a tag...</option>
                  ${this.tags.map(tag => html`
                    <option value=${tag.name} ?selected=${tag.name === this.baseRef}>${tag.name}</option>
                  `)}
                </select>
              ` : html`
                <input
                  type="text"
                  placeholder="v0.2.71 or commit SHA"
                  .value=${this.baseRef}
                  @input=${(e: Event) => { this.baseRef = (e.target as HTMLInputElement).value; }}
                  ?disabled=${this.isGenerating}
                />
              `}
            </div>
            <div class="field">
              <label>To (compare ref)</label>
              <input
                type="text"
                placeholder="HEAD"
                .value=${this.compareRef}
                @input=${(e: Event) => { this.compareRef = (e.target as HTMLInputElement).value; }}
                ?disabled=${this.isGenerating}
              />
            </div>
          </div>

          ${!this.aiAvailable ? html`
            <div class="error-message">
              No AI provider available. Configure one in Settings > AI Providers.
            </div>
          ` : nothing}

          ${this.error ? html`
            <div class="error-message">${this.error}</div>
          ` : nothing}

          ${this.isGenerating ? html`
            <div class="generating">
              <div class="spinner"></div>
              Generating changelog...
            </div>
          ` : nothing}

          ${this.result ? html`
            <div class="result-area">
              <div class="result-header">
                <span class="result-label">Generated Changelog</span>
                <button class="copy-btn" @click=${this.handleCopy}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/>
                    <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/>
                  </svg>
                  Copy
                </button>
              </div>
              <textarea class="result" .value=${this.result} readonly></textarea>
            </div>
          ` : nothing}
        </div>

        <div slot="footer">
          <button
            class="btn btn-primary"
            @click=${this.handleGenerate}
            ?disabled=${this.isGenerating || !this.aiAvailable || !this.baseRef}
          >
            ${this.isGenerating ? 'Generating...' : 'Generate'}
          </button>
        </div>
      </lv-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-changelog-dialog': LvChangelogDialog;
  }
}
