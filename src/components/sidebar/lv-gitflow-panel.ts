/**
 * Git Flow Panel Component
 * Displays git flow status and provides controls for feature/release/hotfix workflows
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles, buttonStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import { showPrompt } from '../../services/dialog.service.ts';
import type { GitFlowConfig } from '../../services/git.service.ts';
import type { Branch } from '../../types/git.types.ts';

type GitFlowCategory = 'feature' | 'release' | 'hotfix';

interface ActiveItem {
  name: string;
  branch: string;
}

@customElement('lv-gitflow-panel')
export class LvGitflowPanel extends LitElement {
  static styles = [
    sharedStyles,
    buttonStyles,
    css`
      :host {
        display: block;
      }

      .panel {
        padding: var(--spacing-sm);
      }

      .init-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-md);
        text-align: center;
      }

      .init-description {
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
      }

      .section {
        margin-bottom: var(--spacing-sm);
      }

      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 8px;
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
        cursor: pointer;
        border-radius: var(--radius-sm);
      }

      .section-header:hover {
        background: var(--color-bg-hover);
      }

      .section-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        transition: transform var(--transition-fast);
      }

      .section-icon.collapsed {
        transform: rotate(-90deg);
      }

      .section-title {
        flex: 1;
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
      }

      .section-actions {
        display: flex;
        gap: 2px;
      }

      .action-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
      }

      .action-btn:hover:not(:disabled) {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .action-btn svg {
        width: 14px;
        height: 14px;
      }

      .item-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 12px 2px 24px;
        font-size: var(--font-size-sm);
      }

      .item:hover {
        background: var(--color-bg-hover);
      }

      .item-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        color: var(--color-text-muted);
      }

      .item-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .item-finish-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        opacity: 0;
        transition: opacity var(--transition-fast);
      }

      .item:hover .item-finish-btn {
        opacity: 1;
      }

      .item-finish-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-success);
      }

      .item-finish-btn svg {
        width: 12px;
        height: 12px;
      }

      .empty-section {
        padding: 2px 12px 2px 24px;
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        font-style: italic;
      }

      .config-summary {
        padding: 4px 8px;
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        border-top: 1px solid var(--color-border);
        margin-top: var(--spacing-sm);
      }

      .config-row {
        display: flex;
        justify-content: space-between;
        padding: 1px 0;
      }

      .config-label {
        color: var(--color-text-muted);
      }

      .config-value {
        font-family: var(--font-family-mono);
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-md);
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
      }

      .error {
        padding: var(--spacing-sm);
        color: var(--color-error);
        font-size: var(--font-size-sm);
        text-align: center;
      }

      .category-icon {
        width: 12px;
        height: 12px;
        flex-shrink: 0;
      }

      .feature-color {
        color: var(--color-primary);
      }

      .release-color {
        color: var(--color-success);
      }

      .hotfix-color {
        color: var(--color-error);
      }
    `,
  ];

  @property({ type: String }) repositoryPath: string = '';

  @state() private config: GitFlowConfig | null = null;
  @state() private loading = true;
  @state() private error: string | null = null;
  @state() private activeFeatures: ActiveItem[] = [];
  @state() private activeReleases: ActiveItem[] = [];
  @state() private activeHotfixes: ActiveItem[] = [];
  @state() private expandedSections = new Set<GitFlowCategory>(['feature', 'release', 'hotfix']);
  @state() private operationInProgress = false;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    await this.loadConfig();
  }

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('repositoryPath') && this.repositoryPath) {
      await this.loadConfig();
    }
  }

  public async refresh(): Promise<void> {
    await this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    if (!this.repositoryPath) return;

    this.loading = true;
    this.error = null;

    try {
      const result = await gitService.getGitFlowConfig(this.repositoryPath);
      if (result.success && result.data) {
        this.config = result.data;
        if (this.config.initialized) {
          await this.loadActiveItems();
        }
      } else {
        this.config = null;
      }
    } catch (err) {
      console.error('Failed to load git flow config:', err);
      this.error = 'Failed to load Git Flow configuration';
    } finally {
      this.loading = false;
    }
  }

  private async loadActiveItems(): Promise<void> {
    if (!this.config || !this.config.initialized) return;

    try {
      const branchResult = await gitService.getBranches(this.repositoryPath);
      if (!branchResult.success || !branchResult.data) return;

      const branches = branchResult.data.filter((b: Branch) => !b.isRemote);

      this.activeFeatures = this.extractActiveItems(branches, this.config.featurePrefix);
      this.activeReleases = this.extractActiveItems(branches, this.config.releasePrefix);
      this.activeHotfixes = this.extractActiveItems(branches, this.config.hotfixPrefix);
    } catch (err) {
      console.error('Failed to load active git flow items:', err);
    }
  }

  private extractActiveItems(branches: Branch[], prefix: string): ActiveItem[] {
    return branches
      .filter((b) => b.name.startsWith(prefix))
      .map((b) => ({
        name: b.name.slice(prefix.length),
        branch: b.name,
      }));
  }

  private async handleInitialize(): Promise<void> {
    if (this.operationInProgress) return;
    this.operationInProgress = true;

    try {
      const result = await gitService.initGitFlow(this.repositoryPath);
      if (result.success) {
        await this.loadConfig();
        this.dispatchEvent(new CustomEvent('gitflow-initialized', {
          bubbles: true,
          composed: true,
        }));
      } else {
        this.error = result.error?.message || 'Failed to initialize Git Flow';
      }
    } catch (err) {
      console.error('Failed to initialize git flow:', err);
      this.error = 'Failed to initialize Git Flow';
    } finally {
      this.operationInProgress = false;
    }
  }

  private async handleStartFeature(): Promise<void> {
    const name = await showPrompt({
      title: 'Start Feature',
      message: 'Enter feature name:',
      placeholder: 'feature-name',
    });
    if (!name || !name.trim()) return;

    this.operationInProgress = true;

    try {
      const result = await gitService.gitFlowStartFeature(this.repositoryPath, name.trim());
      if (result.success) {
        await this.loadActiveItems();
        this.dispatchEvent(new CustomEvent('gitflow-operation', {
          detail: { type: 'start-feature', name: name.trim() },
          bubbles: true,
          composed: true,
        }));
      } else {
        this.error = result.error?.message || 'Failed to start feature';
      }
    } catch (err) {
      console.error('Failed to start feature:', err);
      this.error = 'Failed to start feature';
    } finally {
      this.operationInProgress = false;
    }
  }

  private async handleFinishFeature(item: ActiveItem): Promise<void> {
    this.operationInProgress = true;

    try {
      const result = await gitService.gitFlowFinishFeature(
        this.repositoryPath,
        item.name,
        true,
        false,
      );
      if (result.success) {
        await this.loadActiveItems();
        this.dispatchEvent(new CustomEvent('gitflow-operation', {
          detail: { type: 'finish-feature', name: item.name },
          bubbles: true,
          composed: true,
        }));
      } else {
        this.error = result.error?.message || 'Failed to finish feature';
      }
    } catch (err) {
      console.error('Failed to finish feature:', err);
      this.error = 'Failed to finish feature';
    } finally {
      this.operationInProgress = false;
    }
  }

  private async handleStartRelease(): Promise<void> {
    const version = await showPrompt({
      title: 'Start Release',
      message: 'Enter release version:',
      placeholder: '1.0.0',
    });
    if (!version || !version.trim()) return;

    this.operationInProgress = true;

    try {
      const result = await gitService.gitFlowStartRelease(this.repositoryPath, version.trim());
      if (result.success) {
        await this.loadActiveItems();
        this.dispatchEvent(new CustomEvent('gitflow-operation', {
          detail: { type: 'start-release', name: version.trim() },
          bubbles: true,
          composed: true,
        }));
      } else {
        this.error = result.error?.message || 'Failed to start release';
      }
    } catch (err) {
      console.error('Failed to start release:', err);
      this.error = 'Failed to start release';
    } finally {
      this.operationInProgress = false;
    }
  }

  private async handleFinishRelease(item: ActiveItem): Promise<void> {
    const tagMessage = await showPrompt({
      title: 'Finish Release',
      message: `Enter tag message for release ${item.name}:`,
      defaultValue: `Release ${item.name}`,
    });
    if (tagMessage === null) return;

    this.operationInProgress = true;

    try {
      const result = await gitService.gitFlowFinishRelease(
        this.repositoryPath,
        item.name,
        tagMessage || undefined,
        true,
      );
      if (result.success) {
        await this.loadActiveItems();
        this.dispatchEvent(new CustomEvent('gitflow-operation', {
          detail: { type: 'finish-release', name: item.name },
          bubbles: true,
          composed: true,
        }));
      } else {
        this.error = result.error?.message || 'Failed to finish release';
      }
    } catch (err) {
      console.error('Failed to finish release:', err);
      this.error = 'Failed to finish release';
    } finally {
      this.operationInProgress = false;
    }
  }

  private async handleStartHotfix(): Promise<void> {
    const version = await showPrompt({
      title: 'Start Hotfix',
      message: 'Enter hotfix version:',
      placeholder: '1.0.1',
    });
    if (!version || !version.trim()) return;

    this.operationInProgress = true;

    try {
      const result = await gitService.gitFlowStartHotfix(this.repositoryPath, version.trim());
      if (result.success) {
        await this.loadActiveItems();
        this.dispatchEvent(new CustomEvent('gitflow-operation', {
          detail: { type: 'start-hotfix', name: version.trim() },
          bubbles: true,
          composed: true,
        }));
      } else {
        this.error = result.error?.message || 'Failed to start hotfix';
      }
    } catch (err) {
      console.error('Failed to start hotfix:', err);
      this.error = 'Failed to start hotfix';
    } finally {
      this.operationInProgress = false;
    }
  }

  private async handleFinishHotfix(item: ActiveItem): Promise<void> {
    const tagMessage = await showPrompt({
      title: 'Finish Hotfix',
      message: `Enter tag message for hotfix ${item.name}:`,
      defaultValue: `Hotfix ${item.name}`,
    });
    if (tagMessage === null) return;

    this.operationInProgress = true;

    try {
      const result = await gitService.gitFlowFinishHotfix(
        this.repositoryPath,
        item.name,
        tagMessage || undefined,
        true,
      );
      if (result.success) {
        await this.loadActiveItems();
        this.dispatchEvent(new CustomEvent('gitflow-operation', {
          detail: { type: 'finish-hotfix', name: item.name },
          bubbles: true,
          composed: true,
        }));
      } else {
        this.error = result.error?.message || 'Failed to finish hotfix';
      }
    } catch (err) {
      console.error('Failed to finish hotfix:', err);
      this.error = 'Failed to finish hotfix';
    } finally {
      this.operationInProgress = false;
    }
  }

  private toggleSection(category: GitFlowCategory): void {
    const next = new Set(this.expandedSections);
    if (next.has(category)) {
      next.delete(category);
    } else {
      next.add(category);
    }
    this.expandedSections = next;
  }

  private renderInitSection() {
    return html`
      <div class="init-section">
        <div class="init-description">
          Git Flow is not initialized for this repository.
        </div>
        <button
          class="btn btn-primary"
          @click=${this.handleInitialize}
          ?disabled=${this.operationInProgress}
        >
          ${this.operationInProgress ? 'Initializing...' : 'Initialize Git Flow'}
        </button>
      </div>
    `;
  }

  private renderCategorySection(
    category: GitFlowCategory,
    label: string,
    items: ActiveItem[],
    onStart: () => void,
    onFinish: (item: ActiveItem) => void,
    colorClass: string,
  ) {
    const expanded = this.expandedSections.has(category);

    return html`
      <div class="section">
        <div
          class="section-header"
          @click=${() => this.toggleSection(category)}
        >
          <div class="section-title">
            <svg class="section-icon ${expanded ? '' : 'collapsed'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
            <span class="${colorClass}">${label}</span>
            ${items.length > 0 ? html`<span style="font-size: var(--font-size-xs); color: var(--color-text-muted);">(${items.length})</span>` : nothing}
          </div>
          <div class="section-actions">
            <button
              class="action-btn"
              title="Start ${label}"
              @click=${(e: Event) => { e.stopPropagation(); onStart(); }}
              ?disabled=${this.operationInProgress}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </div>
        </div>
        ${expanded ? this.renderCategoryItems(category, items, onFinish) : nothing}
      </div>
    `;
  }

  private renderCategoryItems(
    _category: GitFlowCategory,
    items: ActiveItem[],
    onFinish: (item: ActiveItem) => void,
  ) {
    if (items.length === 0) {
      return html`<div class="empty-section">No active items</div>`;
    }

    return html`
      <ul class="item-list">
        ${items.map((item) => html`
          <li class="item">
            <svg class="item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="6" y1="3" x2="6" y2="15"></line>
              <circle cx="18" cy="6" r="3"></circle>
              <circle cx="6" cy="18" r="3"></circle>
              <path d="M18 9a9 9 0 01-9 9"></path>
            </svg>
            <span class="item-name" title="${item.branch}">${item.name}</span>
            <button
              class="item-finish-btn"
              title="Finish ${item.name}"
              @click=${() => onFinish(item)}
              ?disabled=${this.operationInProgress}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </button>
          </li>
        `)}
      </ul>
    `;
  }

  private renderConfigSummary() {
    if (!this.config || !this.config.initialized) return nothing;

    return html`
      <div class="config-summary">
        <div class="config-row">
          <span class="config-label">Master:</span>
          <span class="config-value">${this.config.masterBranch}</span>
        </div>
        <div class="config-row">
          <span class="config-label">Develop:</span>
          <span class="config-value">${this.config.developBranch}</span>
        </div>
        <div class="config-row">
          <span class="config-label">Feature:</span>
          <span class="config-value">${this.config.featurePrefix}*</span>
        </div>
        <div class="config-row">
          <span class="config-label">Release:</span>
          <span class="config-value">${this.config.releasePrefix}*</span>
        </div>
        <div class="config-row">
          <span class="config-label">Hotfix:</span>
          <span class="config-value">${this.config.hotfixPrefix}*</span>
        </div>
      </div>
    `;
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">Loading Git Flow...</div>`;
    }

    if (this.error) {
      return html`<div class="error">${this.error}</div>`;
    }

    if (!this.config || !this.config.initialized) {
      return this.renderInitSection();
    }

    return html`
      <div class="panel">
        ${this.renderCategorySection(
          'feature',
          'Feature',
          this.activeFeatures,
          () => this.handleStartFeature(),
          (item) => this.handleFinishFeature(item),
          'feature-color',
        )}
        ${this.renderCategorySection(
          'release',
          'Release',
          this.activeReleases,
          () => this.handleStartRelease(),
          (item) => this.handleFinishRelease(item),
          'release-color',
        )}
        ${this.renderCategorySection(
          'hotfix',
          'Hotfix',
          this.activeHotfixes,
          () => this.handleStartHotfix(),
          (item) => this.handleFinishHotfix(item),
          'hotfix-color',
        )}

        ${this.renderConfigSummary()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-gitflow-panel': LvGitflowPanel;
  }
}
