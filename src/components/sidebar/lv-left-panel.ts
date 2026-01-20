import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { repositoryStore } from '../../stores/index.ts';
import './lv-branch-list.ts';
import './lv-stash-list.ts';
import './lv-tag-list.ts';

/**
 * Left panel container component
 * Contains branch list, stashes, and tags
 */
@customElement('lv-left-panel')
export class LvLeftPanel extends LitElement {
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
        gap: 6px;
        padding: 4px 12px;
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

      .section-action {
        width: 18px;
        height: 18px;
        padding: 0;
        border: none;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
        cursor: pointer;
        flex-shrink: 0;
        opacity: 0;
        transition: all var(--transition-fast);
      }

      .section-header:hover .section-action {
        opacity: 1;
      }

      .section-action:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
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

      .branches-section {
        flex: 1;
        min-height: 100px;
      }

      .refs-section {
        flex: 0 0 auto;
        max-height: 30%;
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

  @state() private repositoryPath: string | null = null;
  @state() private stashCount: number = 0;
  @state() private tagCount: number = 0;
  @state() private expandedSections = new Set<string>(['branches']);

  private unsubscribe?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    // Get initial state
    const initialState = repositoryStore.getState();
    this.repositoryPath = initialState.getActiveRepository()?.repository.path ?? null;

    // Subscribe to changes
    this.unsubscribe = repositoryStore.subscribe((state) => {
      const activeRepo = state.getActiveRepository();
      this.repositoryPath = activeRepo?.repository.path ?? null;
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }

  render() {
    if (!this.repositoryPath) {
      return html`<div class="placeholder">No repository open</div>`;
    }

    const branchesExpanded = this.expandedSections.has('branches');
    const stashesExpanded = this.expandedSections.has('stashes');
    const tagsExpanded = this.expandedSections.has('tags');

    return html`
      <!-- Branches Section -->
      <section class="section branches-section ${branchesExpanded ? '' : 'collapsed'}">
        <header class="section-header" @click=${() => this.toggleSection('branches')}>
          ${this.renderChevron(branchesExpanded)}
          <span class="title">Branches</span>
        </header>
        <div class="section-content">
          <lv-branch-list .repositoryPath=${this.repositoryPath}></lv-branch-list>
        </div>
      </section>

      <!-- Stashes Section - only show when there are stashes -->
      ${this.stashCount > 0 ? html`
        <section class="section refs-section ${stashesExpanded ? '' : 'collapsed'}">
          <header class="section-header" @click=${() => this.toggleSection('stashes')}>
            ${this.renderChevron(stashesExpanded)}
            <span class="title">Stashes</span>
            <span class="count">${this.stashCount}</span>
          </header>
          <div class="section-content">
            <lv-stash-list
              .repositoryPath=${this.repositoryPath}
              @stash-applied=${this.handleStashApplied}
              @stash-count-changed=${this.handleStashCountChanged}
            ></lv-stash-list>
          </div>
        </section>
      ` : html`
        <!-- Hidden stash-list to track count -->
        <lv-stash-list
          style="display: none;"
          .repositoryPath=${this.repositoryPath}
          @stash-applied=${this.handleStashApplied}
          @stash-count-changed=${this.handleStashCountChanged}
        ></lv-stash-list>
      `}

      <!-- Tags Section - always show header for discoverability -->
      <section class="section refs-section ${tagsExpanded ? '' : 'collapsed'}">
        <header class="section-header" @click=${() => this.toggleSection('tags')}>
          ${this.renderChevron(tagsExpanded)}
          <span class="title">Tags</span>
          ${this.tagCount > 0 ? html`<span class="count">${this.tagCount}</span>` : ''}
          <button
            class="section-action"
            title="Create tag"
            @click=${this.handleCreateTag}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        </header>
        ${this.tagCount > 0 ? html`
          <div class="section-content">
            <lv-tag-list
              .repositoryPath=${this.repositoryPath}
              @tags-changed=${this.handleTagsChanged}
              @tag-count-changed=${this.handleTagCountChanged}
            ></lv-tag-list>
          </div>
        ` : html`
          <lv-tag-list
            style="display: none;"
            .repositoryPath=${this.repositoryPath}
            @tags-changed=${this.handleTagsChanged}
            @tag-count-changed=${this.handleTagCountChanged}
          ></lv-tag-list>
        `}
      </section>
    `;
  }

  private handleStashApplied(): void {
    this.dispatchEvent(new CustomEvent('repository-changed', { bubbles: true, composed: true }));
  }

  private handleTagsChanged(): void {
    // Refresh repository state after tags changed
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

  private handleStashCountChanged(e: CustomEvent<{ count: number }>): void {
    this.stashCount = e.detail.count;
  }

  private handleTagCountChanged(e: CustomEvent<{ count: number }>): void {
    this.tagCount = e.detail.count;
  }

  private handleCreateTag(e: Event): void {
    e.stopPropagation();
    // Dispatch event for app-shell to handle (since the dialog in lv-tag-list may be hidden)
    this.dispatchEvent(new CustomEvent('create-tag', {
      bubbles: true,
      composed: true,
    }));
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
    'lv-left-panel': LvLeftPanel;
  }
}
