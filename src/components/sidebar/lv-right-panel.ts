import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { repositoryStore } from '../../stores/index.ts';
import * as gitService from '../../services/git.service.ts';
import './lv-file-status.ts';
import './lv-commit-panel.ts';
import '../panels/lv-commit-details.ts';
import type { Commit, RefInfo } from '../../types/git.types.ts';

/**
 * Right panel container component
 * Contains file status, commit panel, and commit details
 */
@customElement('lv-right-panel')
export class LvRightPanel extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }

      .section {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .section-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
        background: var(--color-bg-tertiary);
        border-bottom: 1px solid var(--color-border);
        user-select: none;
        cursor: pointer;
      }

      .section-header:hover {
        background: var(--color-bg-hover);
      }

      .section-header .chevron {
        width: 14px;
        height: 14px;
        transition: transform var(--transition-fast);
        flex-shrink: 0;
      }

      .section-header .chevron.expanded {
        transform: rotate(90deg);
      }

      .section-header .title {
        flex: 1;
      }

      .section-header .count {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        background: var(--color-bg-secondary);
        padding: 1px 6px;
        border-radius: var(--radius-full);
        font-weight: var(--font-weight-normal);
      }

      .section.collapsed .section-content {
        display: none;
      }

      .section.collapsed {
        flex: 0 0 auto;
        max-height: none;
      }

      .section-content {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
      }

      .changes-section {
        flex: 0 0 auto;
        max-height: 40%;
      }

      .commit-section {
        flex: 0 0 auto;
        border-top: 1px solid var(--color-border);
      }

      .commit-section .section-content {
        overflow: visible;
      }

      .details-section {
        flex: 1;
        border-top: 1px solid var(--color-border);
      }

      .placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: var(--spacing-md);
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
        text-align: center;
      }
    `,
  ];

  @property({ type: Object }) commit: Commit | null = null;
  @property({ type: Array }) refs: RefInfo[] = [];

  @state() private repositoryPath: string | null = null;
  @state() private stagedCount: number = 0;
  @state() private changesCount: number = 0;
  @state() private expandedSections = new Set<string>(['changes', 'details']);
  @state() private githubOwner: string = '';
  @state() private githubRepo: string = '';

  private unsubscribe?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    const initialState = repositoryStore.getState();
    this.repositoryPath = initialState.getActiveRepository()?.repository.path ?? null;
    if (this.repositoryPath) {
      this.detectGitHubRepo();
    }

    this.unsubscribe = repositoryStore.subscribe((state) => {
      const activeRepo = state.getActiveRepository();
      const newPath = activeRepo?.repository.path ?? null;
      if (newPath !== this.repositoryPath) {
        this.repositoryPath = newPath;
        if (newPath) {
          this.detectGitHubRepo();
        } else {
          this.githubOwner = '';
          this.githubRepo = '';
        }
      }
    });
  }

  private async detectGitHubRepo(): Promise<void> {
    if (!this.repositoryPath) return;

    try {
      const result = await gitService.detectGitHubRepo(this.repositoryPath);
      if (result.success && result.data) {
        this.githubOwner = result.data.owner;
        this.githubRepo = result.data.repo;
      } else {
        this.githubOwner = '';
        this.githubRepo = '';
      }
    } catch {
      this.githubOwner = '';
      this.githubRepo = '';
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }

  render() {
    if (!this.repositoryPath) {
      return html`<div class="placeholder">No repository open</div>`;
    }

    const changesExpanded = this.expandedSections.has('changes');
    const commitExpanded = this.expandedSections.has('commit');
    const detailsExpanded = this.expandedSections.has('details');

    return html`
      <!-- Changes Section -->
      <section class="section changes-section ${changesExpanded ? '' : 'collapsed'}">
        <header class="section-header" @click=${() => this.toggleSection('changes')}>
          ${this.renderChevron(changesExpanded)}
          <span class="title">Changes</span>
          ${this.changesCount > 0 ? html`<span class="count">${this.changesCount}</span>` : nothing}
        </header>
        <div class="section-content">
          <lv-file-status
            .repositoryPath=${this.repositoryPath}
            @status-changed=${this.handleStatusChanged}
          ></lv-file-status>
        </div>
      </section>

      <!-- Commit Section -->
      <section class="section commit-section ${commitExpanded ? '' : 'collapsed'}">
        <header class="section-header" @click=${() => this.toggleSection('commit')}>
          ${this.renderChevron(commitExpanded)}
          <span class="title">Commit</span>
          ${this.stagedCount > 0 ? html`<span class="count">${this.stagedCount} staged</span>` : nothing}
        </header>
        <div class="section-content">
          <lv-commit-panel
            .repositoryPath=${this.repositoryPath}
            .stagedCount=${this.stagedCount}
            @commit-created=${this.handleCommitCreated}
          ></lv-commit-panel>
        </div>
      </section>

      <!-- Commit Details Section -->
      <section class="section details-section ${detailsExpanded ? '' : 'collapsed'}">
        <header class="section-header" @click=${() => this.toggleSection('details')}>
          ${this.renderChevron(detailsExpanded)}
          <span class="title">Commit Details</span>
        </header>
        <div class="section-content">
          <lv-commit-details
            .repositoryPath=${this.repositoryPath}
            .commit=${this.commit}
            .refs=${this.refs}
            .githubOwner=${this.githubOwner}
            .githubRepo=${this.githubRepo}
          ></lv-commit-details>
        </div>
      </section>
    `;
  }

  private handleStatusChanged(e: CustomEvent<{ stagedCount: number; totalCount?: number }>): void {
    this.stagedCount = e.detail.stagedCount;
    if (e.detail.totalCount !== undefined) {
      this.changesCount = e.detail.totalCount;
    }
  }

  private handleCommitCreated(): void {
    this.dispatchEvent(new CustomEvent('repository-changed', { bubbles: true, composed: true }));
  }

  private toggleSection(section: string): void {
    const newExpanded = new Set(this.expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    this.expandedSections = newExpanded;
  }

  private renderChevron(expanded: boolean) {
    return html`
      <svg class="chevron ${expanded ? 'expanded' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-right-panel': LvRightPanel;
  }
}
