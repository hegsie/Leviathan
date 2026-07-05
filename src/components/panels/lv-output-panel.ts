/**
 * Output Panel Component
 * Displays git command output log with timestamp, command, and collapsible output
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles, buttonStyles } from '../../styles/shared-styles.ts';
import {
  type OutputLogEntry,
  getLogEntries,
  clearLogEntries,
  subscribeOutputLog,
} from '../../services/output-log.service.ts';

// The log store lives in output-log.service.ts (populated by the IPC layer);
// re-export the store API here for existing consumers of this module.
export { logGitCommand, getLogEntries, clearLogEntries } from '../../services/output-log.service.ts';
export type { OutputLogEntry } from '../../services/output-log.service.ts';

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

@customElement('lv-output-panel')
export class LvOutputPanel extends LitElement {
  static styles = [
    sharedStyles,
    buttonStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-xs) var(--spacing-md);
        background: var(--color-bg-tertiary);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
      }

      .header-title {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
      }

      .header-actions {
        display: flex;
        gap: var(--spacing-xs);
      }

      .clear-btn {
        font-size: var(--font-size-xs);
        padding: 2px 8px;
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
      }

      .clear-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .close-btn {
        font-size: var(--font-size-xs);
        padding: 2px 8px;
        border-radius: var(--radius-sm);
        color: var(--color-text-muted);
      }

      .close-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .entries {
        flex: 1;
        overflow-y: auto;
        font-family: var(--font-family-mono);
        font-size: var(--font-size-xs);
      }

      .entry {
        border-bottom: 1px solid var(--color-border);
      }

      .entry-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs) var(--spacing-md);
        cursor: pointer;
      }

      .entry-header:hover {
        background: var(--color-bg-hover);
      }

      .expand-icon {
        width: 12px;
        height: 12px;
        flex-shrink: 0;
        color: var(--color-text-muted);
        transition: transform var(--transition-fast);
      }

      .expand-icon.expanded {
        transform: rotate(90deg);
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .status-dot.success {
        background: var(--color-success);
      }

      .status-dot.failure {
        background: var(--color-error);
      }

      .entry-timestamp {
        color: var(--color-text-muted);
        flex-shrink: 0;
      }

      .entry-command {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--color-text-primary);
      }

      .entry-command.success {
        color: var(--color-text-primary);
      }

      .entry-command.failure {
        color: var(--color-error);
      }

      .entry-output {
        padding: var(--spacing-xs) var(--spacing-md) var(--spacing-sm);
        padding-left: calc(var(--spacing-md) + 12px + var(--spacing-sm) + 8px + var(--spacing-sm));
        white-space: pre-wrap;
        word-break: break-all;
        color: var(--color-text-secondary);
        background: var(--color-bg-primary);
        border-top: 1px solid var(--color-border);
        max-height: 200px;
        overflow-y: auto;
      }

      .empty {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-lg);
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
      }

      .entry-count {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }
    `,
  ];

  /** When set (by the app shell), renders a close button that emits `close` */
  @property({ type: Boolean }) closable = false;

  /**
   * When set, only entries for this repository (plus repo-independent
   * entries) are shown — required for multi-repo sessions. Unset shows all.
   */
  @property({ type: String }) repositoryPath = '';

  @state() private entries: ReadonlyArray<OutputLogEntry> = [];
  @state() private expandedEntries = new Set<number>();

  private get visibleEntries(): OutputLogEntry[] {
    if (!this.repositoryPath) return [...this.entries];
    return this.entries.filter(
      (e) => !e.repoPath || e.repoPath === this.repositoryPath,
    );
  }

  willUpdate(changed: Map<string, unknown>): void {
    // Expansion indexes are positions within the filtered list — reset them
    // when switching repositories so stale indexes don't expand wrong rows
    if (changed.has('repositoryPath')) {
      this.expandedEntries = new Set();
    }
  }

  private unsubscribeLog?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    this.entries = getLogEntries();
    this.unsubscribeLog = subscribeOutputLog(this.handleLogUpdate);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeLog?.();
    this.unsubscribeLog = undefined;
  }

  private handleLogUpdate = (): void => {
    this.entries = [...getLogEntries()];
    this.requestUpdate();
  };

  private handleClear(): void {
    clearLogEntries();
    this.expandedEntries = new Set();
  }

  private toggleEntry(index: number): void {
    const next = new Set(this.expandedEntries);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    this.expandedEntries = next;
  }

  private renderEntry(entry: OutputLogEntry, index: number) {
    const expanded = this.expandedEntries.has(index);
    const statusClass = entry.success ? 'success' : 'failure';

    return html`
      <div class="entry">
        <div
          class="entry-header"
          @click=${() => this.toggleEntry(index)}
          title="${entry.command}"
        >
          <svg class="expand-icon ${expanded ? 'expanded' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          <span class="status-dot ${statusClass}"></span>
          <span class="entry-timestamp">${formatTimestamp(entry.timestamp)}</span>
          <span class="entry-command ${statusClass}">${entry.command}</span>
        </div>
        ${expanded && entry.output
          ? html`<div class="entry-output">${entry.output}</div>`
          : nothing}
      </div>
    `;
  }

  render() {
    const visible = this.visibleEntries;
    return html`
      <div class="header">
        <span class="header-title">
          Output
          ${visible.length > 0
            ? html`<span class="entry-count">(${visible.length})</span>`
            : nothing}
        </span>
        <div class="header-actions">
          ${visible.length > 0
            ? html`
                <button class="clear-btn" @click=${this.handleClear}>
                  Clear
                </button>
              `
            : nothing}
          ${this.closable
            ? html`
                <button
                  class="close-btn"
                  title="Close output panel"
                  aria-label="Close output panel"
                  @click=${() =>
                    this.dispatchEvent(
                      new CustomEvent('close', { bubbles: true, composed: true })
                    )}
                >
                  ✕
                </button>
              `
            : nothing}
        </div>
      </div>
      <div class="entries">
        ${visible.length === 0
          ? html`<div class="empty">No output yet</div>`
          : visible.map((entry, i) => this.renderEntry(entry, i))}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-output-panel': LvOutputPanel;
  }
}
