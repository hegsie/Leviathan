import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import type { CommitTemplate, ConventionalType } from '../../services/git.service.ts';
import type { Commit } from '../../types/git.types.ts';

/**
 * Commit panel component
 * Allows users to write commit messages and create commits
 */
@customElement('lv-commit-panel')
export class LvCommitPanel extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        padding: var(--spacing-sm);
        gap: var(--spacing-sm);
        background: var(--color-bg-secondary);
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
      }

      .staged-count {
        font-weight: var(--font-weight-medium);
      }

      .staged-count.has-staged {
        color: var(--color-success);
      }

      .template-row {
        display: flex;
        gap: var(--spacing-xs);
        align-items: center;
      }

      .template-select {
        flex: 1;
        padding: var(--spacing-xs);
        background: var(--color-bg-primary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-size: var(--font-size-xs);
        cursor: pointer;
      }

      .template-select:focus {
        outline: none;
        border-color: var(--color-primary);
      }

      .icon-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .icon-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .icon-btn svg {
        width: 14px;
        height: 14px;
      }

      .conventional-row {
        display: flex;
        gap: var(--spacing-xs);
        align-items: center;
      }

      .type-select {
        width: 100px;
        padding: var(--spacing-xs);
        background: var(--color-bg-primary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-size: var(--font-size-xs);
        cursor: pointer;
      }

      .type-select:focus {
        outline: none;
        border-color: var(--color-primary);
      }

      .scope-input {
        flex: 1;
        padding: var(--spacing-xs);
        background: var(--color-bg-primary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-size: var(--font-size-xs);
      }

      .scope-input:focus {
        outline: none;
        border-color: var(--color-primary);
      }

      .scope-input::placeholder {
        color: var(--color-text-muted);
      }

      .message-container {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .summary-input {
        width: 100%;
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-primary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        font-family: inherit;
        resize: none;
        transition: border-color var(--transition-fast);
      }

      .summary-input:focus {
        outline: none;
        border-color: var(--color-primary);
      }

      .summary-input::placeholder {
        color: var(--color-text-muted);
      }

      .summary-input.over-limit {
        border-color: var(--color-warning);
      }

      .description-input {
        width: 100%;
        min-height: 60px;
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-primary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        font-family: inherit;
        resize: vertical;
        transition: border-color var(--transition-fast);
      }

      .description-input:focus {
        outline: none;
        border-color: var(--color-primary);
      }

      .description-input::placeholder {
        color: var(--color-text-muted);
      }

      .char-count {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        text-align: right;
      }

      .char-count.over-limit {
        color: var(--color-warning);
      }

      .options-row {
        display: flex;
        gap: var(--spacing-sm);
        align-items: center;
        flex-wrap: wrap;
      }

      .actions {
        display: flex;
        gap: var(--spacing-xs);
      }

      .commit-btn {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-sm);
        background: var(--color-primary);
        color: var(--color-text-inverse);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        transition: background var(--transition-fast);
      }

      .commit-btn:hover:not(:disabled) {
        background: var(--color-primary-hover);
      }

      .commit-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .commit-btn svg {
        width: 16px;
        height: 16px;
      }

      .amend-toggle {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        cursor: pointer;
        user-select: none;
      }

      .amend-toggle input {
        margin: 0;
      }

      .conventional-toggle {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        cursor: pointer;
        user-select: none;
      }

      .conventional-toggle input {
        margin: 0;
      }

      .error {
        padding: var(--spacing-xs);
        background: var(--color-error-bg);
        border-radius: var(--radius-sm);
        color: var(--color-error);
        font-size: var(--font-size-xs);
      }

      .success {
        padding: var(--spacing-xs);
        background: var(--color-success-bg);
        border-radius: var(--radius-sm);
        color: var(--color-success);
        font-size: var(--font-size-xs);
      }
    `,
  ];

  @property({ type: String }) repositoryPath: string = '';
  @property({ type: Number }) stagedCount: number = 0;

  @state() private summary: string = '';
  @state() private description: string = '';
  @state() private amend: boolean = false;
  @state() private isCommitting: boolean = false;
  @state() private error: string | null = null;
  @state() private success: string | null = null;
  @state() private lastCommit: Commit | null = null;

  // Template state
  @state() private templates: CommitTemplate[] = [];
  @state() private selectedTemplateId: string = '';

  // Conventional commit state
  @state() private conventionalMode: boolean = false;
  @state() private conventionalTypes: ConventionalType[] = [];
  @state() private selectedType: string = 'feat';
  @state() private scope: string = '';

  // Store original input before amend pre-population
  private originalSummary: string = '';
  private originalDescription: string = '';

  @query('.summary-input') private summaryInput!: HTMLTextAreaElement;

  private readonly SUMMARY_LIMIT = 72;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    await this.loadTemplates();
    await this.loadConventionalTypes();
    await this.loadGitTemplate();
  }

  private async loadTemplates(): Promise<void> {
    const result = await gitService.listTemplates();
    if (result.success && result.data) {
      this.templates = result.data;
    }
  }

  private async loadConventionalTypes(): Promise<void> {
    const result = await gitService.getConventionalTypes();
    if (result.success && result.data) {
      this.conventionalTypes = result.data;
    }
  }

  private async loadGitTemplate(): Promise<void> {
    if (!this.repositoryPath) return;
    const result = await gitService.getCommitTemplate(this.repositoryPath);
    if (result.success && result.data) {
      // Parse the template - first line is summary, rest is description
      const lines = result.data.split('\n');
      const nonCommentLines = lines.filter(l => !l.startsWith('#'));
      if (nonCommentLines.length > 0) {
        this.summary = nonCommentLines[0].trim();
        if (nonCommentLines.length > 1) {
          this.description = nonCommentLines.slice(1).join('\n').trim();
        }
      }
    }
  }

  private handleTemplateChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    this.selectedTemplateId = select.value;

    if (this.selectedTemplateId) {
      const template = this.templates.find(t => t.id === this.selectedTemplateId);
      if (template) {
        // Parse template content - first line is summary, rest is description
        const lines = template.content.split('\n');
        this.summary = lines[0] || '';
        this.description = lines.slice(1).join('\n').trim();
        this.conventionalMode = template.isConventional;
      }
    }
  }

  private async handleSaveTemplate(): Promise<void> {
    const name = prompt('Enter template name:');
    if (!name) return;

    const content = this.description
      ? `${this.summary}\n${this.description}`
      : this.summary;

    const template: CommitTemplate = {
      id: `template-${Date.now()}`,
      name,
      content,
      isConventional: this.conventionalMode,
      createdAt: Date.now(),
    };

    const result = await gitService.saveTemplate(template);
    if (result.success) {
      await this.loadTemplates();
      this.selectedTemplateId = template.id;
    }
  }

  private handleConventionalToggle(e: Event): void {
    const target = e.target as HTMLInputElement;
    this.conventionalMode = target.checked;
  }

  private handleTypeChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    this.selectedType = select.value;
  }

  private handleScopeInput(e: Event): void {
    const target = e.target as HTMLInputElement;
    this.scope = target.value;
  }

  private buildCommitMessage(): string {
    let summary = this.summary;

    // If conventional mode, prepend type and scope
    if (this.conventionalMode && this.selectedType) {
      const scopePart = this.scope ? `(${this.scope})` : '';
      summary = `${this.selectedType}${scopePart}: ${summary}`;
    }

    return this.description ? `${summary}\n\n${this.description}` : summary;
  }

  private get canCommit(): boolean {
    return (
      this.summary.trim().length > 0 &&
      (this.stagedCount > 0 || this.amend) &&
      !this.isCommitting
    );
  }

  private handleSummaryInput(e: Event): void {
    const target = e.target as HTMLTextAreaElement;
    this.summary = target.value;
    this.error = null;
    this.success = null;
  }

  private handleDescriptionInput(e: Event): void {
    const target = e.target as HTMLTextAreaElement;
    this.description = target.value;
  }

  private async handleAmendToggle(e: Event): Promise<void> {
    const target = e.target as HTMLInputElement;
    this.amend = target.checked;

    if (this.amend) {
      // Store current input before pre-populating
      this.originalSummary = this.summary;
      this.originalDescription = this.description;

      // Fetch last commit and pre-populate message
      await this.fetchLastCommitMessage();
    } else {
      // Restore original input when toggling off
      this.summary = this.originalSummary;
      this.description = this.originalDescription;
      this.lastCommit = null;
    }
  }

  private async fetchLastCommitMessage(): Promise<void> {
    if (!this.repositoryPath) return;

    try {
      const result = await gitService.getCommitHistory({
        path: this.repositoryPath,
        limit: 1,
      });

      if (result.success && result.data && result.data.length > 0) {
        this.lastCommit = result.data[0];
        this.summary = this.lastCommit.summary;
        this.description = this.lastCommit.body ?? '';
      }
    } catch (err) {
      console.error('Failed to fetch last commit:', err);
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Cmd/Ctrl + Enter to commit
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && this.canCommit) {
      e.preventDefault();
      this.handleCommit();
    }
  }

  private async handleCommit(): Promise<void> {
    if (!this.canCommit) return;

    this.isCommitting = true;
    this.error = null;
    this.success = null;

    try {
      const message = this.buildCommitMessage();

      const result = await gitService.createCommit(this.repositoryPath, {
        message,
        amend: this.amend,
      });

      if (result.success) {
        this.success = `Created commit ${result.data?.shortId}`;
        this.summary = '';
        this.description = '';
        this.amend = false;
        this.lastCommit = null;
        this.originalSummary = '';
        this.originalDescription = '';

        // Notify parent to refresh
        this.dispatchEvent(new CustomEvent('commit-created', {
          detail: { commit: result.data },
          bubbles: true,
          composed: true,
        }));

        // Clear success message after a delay
        setTimeout(() => {
          this.success = null;
        }, 3000);
      } else {
        this.error = result.error?.message ?? 'Failed to create commit';
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      this.isCommitting = false;
    }
  }

  render() {
    const summaryOverLimit = this.summary.length > this.SUMMARY_LIMIT;

    return html`
      <div class="header">
        <span>Commit</span>
        <span class="staged-count ${this.stagedCount > 0 ? 'has-staged' : ''}">
          ${this.stagedCount} staged ${this.stagedCount === 1 ? 'file' : 'files'}
        </span>
      </div>

      ${this.templates.length > 0 ? html`
        <div class="template-row">
          <select
            class="template-select"
            .value=${this.selectedTemplateId}
            @change=${this.handleTemplateChange}
          >
            <option value="">Select template...</option>
            ${this.templates.map(t => html`
              <option value=${t.id}>${t.name}</option>
            `)}
          </select>
          <button
            class="icon-btn"
            @click=${this.handleSaveTemplate}
            title="Save as template"
            ?disabled=${!this.summary.trim()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
              <polyline points="17 21 17 13 7 13 7 21"></polyline>
              <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
          </button>
        </div>
      ` : html`
        <div class="template-row">
          <button
            class="icon-btn"
            @click=${this.handleSaveTemplate}
            title="Save as template"
            ?disabled=${!this.summary.trim()}
            style="margin-left: auto;"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
              <polyline points="17 21 17 13 7 13 7 21"></polyline>
              <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
          </button>
        </div>
      `}

      ${this.conventionalMode ? html`
        <div class="conventional-row">
          <select
            class="type-select"
            .value=${this.selectedType}
            @change=${this.handleTypeChange}
          >
            ${this.conventionalTypes.map(t => html`
              <option value=${t.typeName} title=${t.description}>
                ${t.emoji ? `${t.emoji} ` : ''}${t.typeName}
              </option>
            `)}
          </select>
          <input
            type="text"
            class="scope-input"
            placeholder="scope (optional)"
            .value=${this.scope}
            @input=${this.handleScopeInput}
          />
        </div>
      ` : nothing}

      <div class="message-container">
        <textarea
          class="summary-input ${summaryOverLimit ? 'over-limit' : ''}"
          placeholder="${this.conventionalMode ? 'Description (required)' : 'Summary (required)'}"
          rows="1"
          .value=${this.summary}
          @input=${this.handleSummaryInput}
          @keydown=${this.handleKeyDown}
        ></textarea>

        <div class="char-count ${summaryOverLimit ? 'over-limit' : ''}">
          ${this.summary.length}/${this.SUMMARY_LIMIT}
        </div>

        <textarea
          class="description-input"
          placeholder="Body (optional)"
          .value=${this.description}
          @input=${this.handleDescriptionInput}
          @keydown=${this.handleKeyDown}
        ></textarea>
      </div>

      <div class="options-row">
        <label class="amend-toggle">
          <input
            type="checkbox"
            .checked=${this.amend}
            @change=${this.handleAmendToggle}
          />
          Amend${this.amend && this.lastCommit ? ` (${this.lastCommit.shortId})` : ''}
        </label>

        <label class="conventional-toggle">
          <input
            type="checkbox"
            .checked=${this.conventionalMode}
            @change=${this.handleConventionalToggle}
          />
          Conventional
        </label>
      </div>

      ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
      ${this.success ? html`<div class="success">${this.success}</div>` : nothing}

      <div class="actions">
        <button
          class="commit-btn"
          ?disabled=${!this.canCommit}
          @click=${this.handleCommit}
          title="Commit staged changes (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          ${this.isCommitting ? 'Committing...' : 'Commit'}
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-commit-panel': LvCommitPanel;
  }
}
