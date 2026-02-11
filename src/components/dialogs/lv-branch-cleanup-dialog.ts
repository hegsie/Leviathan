/**
 * Branch Cleanup Dialog Component
 * Provides a unified dialog for cleaning up merged, stale, and gone-upstream branches
 * with risk assessment and branch protection checks.
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, property, query } from 'lit/decorators.js';
import { sharedStyles, buttonStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import { showConfirm } from '../../services/dialog.service.ts';
import { showToast } from '../../services/notification.service.ts';
import { settingsStore } from '../../stores/settings.store.ts';
import type { Branch, CleanupCandidate } from '../../types/git.types.ts';
import './lv-modal.ts';
import type { LvModal } from './lv-modal.ts';

type CleanupTab = 'merged' | 'stale' | 'gone';
type RiskLevel = 'safe' | 'warning' | 'danger';

interface CleanupBranch {
  branch: Branch;
  risk: RiskLevel;
  riskReason: string;
  isProtected: boolean;
  protectedReason?: string;
}

const BUILTIN_PROTECTED = ['main', 'master', 'develop', 'development', 'staging', 'production'];

@customElement('lv-branch-cleanup-dialog')
export class LvBranchCleanupDialog extends LitElement {
  static styles = [
    sharedStyles,
    buttonStyles,
    css`
      .tabs {
        display: flex;
        border-bottom: 1px solid var(--color-border);
        padding: 0 var(--spacing-md);
        gap: 0;
      }

      .tab {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-sm) var(--spacing-md);
        border: none;
        background: none;
        color: var(--color-text-secondary);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: all var(--transition-fast);
      }

      .tab:hover {
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
      }

      .tab.active {
        color: var(--color-primary);
        border-bottom-color: var(--color-primary);
      }

      .tab-badge {
        font-size: 10px;
        font-weight: var(--font-weight-semibold);
        padding: 1px 6px;
        border-radius: var(--radius-full);
        background: var(--color-bg-tertiary);
        color: var(--color-text-muted);
      }

      .tab.active .tab-badge {
        background: var(--color-primary-bg);
        color: var(--color-primary);
      }

      .content-area {
        min-width: 500px;
        min-height: 300px;
        max-height: 400px;
        overflow-y: auto;
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
        gap: var(--spacing-sm);
      }

      .empty-state svg {
        width: 32px;
        height: 32px;
        opacity: 0.5;
      }

      .select-all {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs) var(--spacing-md);
        border-bottom: 1px solid var(--color-border);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
      }

      .select-all label {
        cursor: pointer;
        user-select: none;
      }

      .select-all input[type="checkbox"] {
        accent-color: var(--color-primary);
      }

      .branch-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .branch-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs) var(--spacing-md);
        font-size: var(--font-size-sm);
        border-bottom: 1px solid var(--color-border-light, var(--color-border));
      }

      .branch-item:last-child {
        border-bottom: none;
      }

      .branch-item.protected {
        opacity: 0.5;
      }

      .branch-item input[type="checkbox"] {
        flex-shrink: 0;
        accent-color: var(--color-primary);
      }

      .branch-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .branch-name {
        font-weight: var(--font-weight-medium);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .branch-detail {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .risk-badge {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        padding: 2px 8px;
        border-radius: var(--radius-full);
      }

      .risk-badge.safe {
        background: var(--color-success-bg);
        color: var(--color-success);
      }

      .risk-badge.warning {
        background: var(--color-warning-bg);
        color: var(--color-warning);
      }

      .risk-badge.danger {
        background: var(--color-error-bg, var(--color-warning-bg));
        color: var(--color-error);
      }

      .risk-badge svg {
        width: 12px;
        height: 12px;
      }

      .protected-badge {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        padding: 2px 8px;
        border-radius: var(--radius-full);
        background: var(--color-bg-tertiary);
      }

      .protected-badge svg {
        width: 12px;
        height: 12px;
      }

      .footer-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        gap: var(--spacing-md);
      }

      .footer-summary {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
      }

      .footer-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .btn-danger {
        background: var(--color-error);
        color: var(--color-text-inverse, #fff);
      }

      .btn-danger:hover:not(:disabled) {
        opacity: 0.9;
      }

      .prune-option {
        display: flex;
        align-items: center;
        padding: var(--spacing-xs) var(--spacing-md);
        border-top: 1px solid var(--color-border);
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
      }

      .prune-option label {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        cursor: pointer;
        user-select: none;
      }

      .prune-option input[type="checkbox"] {
        accent-color: var(--color-primary);
      }
    `,
  ];

  @property({ type: String }) repositoryPath = '';

  @state() private loading = true;
  @state() private mergedBranches: CleanupBranch[] = [];
  @state() private staleBranches: CleanupBranch[] = [];
  @state() private goneUpstreamBranches: CleanupBranch[] = [];
  @state() private selectedBranches = new Set<string>();
  @state() private activeTab: CleanupTab = 'merged';
  @state() private deleting = false;
  @state() private pruneRemotes = true;

  @query('lv-modal') private modal!: LvModal;

  public async open(): Promise<void> {
    this.reset();
    this.modal.open = true;
    await this.loadCleanupData();
  }

  public close(): void {
    this.modal.open = false;
  }

  private reset(): void {
    this.loading = true;
    this.mergedBranches = [];
    this.staleBranches = [];
    this.goneUpstreamBranches = [];
    this.selectedBranches = new Set();
    this.activeTab = 'merged';
    this.deleting = false;
    this.pruneRemotes = true;
  }

  private async loadCleanupData(): Promise<void> {
    this.loading = true;

    try {
      const { staleBranchDays } = settingsStore.getState();
      const result = await gitService.getCleanupCandidates(
        this.repositoryPath,
        staleBranchDays,
      );

      if (!result.success || !result.data) {
        showToast('Failed to load cleanup candidates', 'error');
        this.loading = false;
        return;
      }

      // Build CleanupBranch entries from backend candidates
      const merged: CleanupBranch[] = [];
      const stale: CleanupBranch[] = [];
      const gone: CleanupBranch[] = [];

      for (const candidate of result.data) {
        const branch: Branch = {
          name: candidate.name,
          shorthand: candidate.shorthand,
          isHead: false,
          isRemote: false,
          upstream: candidate.upstream,
          targetOid: '',
          aheadBehind: candidate.aheadBehind ?? undefined,
          lastCommitTimestamp: candidate.lastCommitTimestamp ?? undefined,
          isStale: candidate.category === 'stale',
        };

        const isProtected = candidate.isProtected || this.isBuiltinProtected(candidate.name);
        const protectedReason = isProtected ? this.getProtectedReason(candidate) : undefined;
        const risk = this.assessRisk(candidate);

        const entry: CleanupBranch = {
          branch,
          ...risk,
          isProtected,
          protectedReason,
        };

        switch (candidate.category) {
          case 'merged':
            merged.push(entry);
            break;
          case 'stale':
            stale.push(entry);
            break;
          case 'gone':
            gone.push(entry);
            break;
        }
      }

      this.mergedBranches = merged;
      this.staleBranches = stale;
      this.goneUpstreamBranches = gone;

      // Auto-select safe branches in merged and gone categories
      for (const cb of this.mergedBranches) {
        if (!cb.isProtected && cb.risk === 'safe') {
          this.selectedBranches.add(cb.branch.name);
        }
      }
      for (const cb of this.goneUpstreamBranches) {
        if (!cb.isProtected && cb.risk === 'safe') {
          this.selectedBranches.add(cb.branch.name);
        }
      }
      // Don't auto-select stale branches (they require more deliberate action)

      // Select the first non-empty tab
      if (this.mergedBranches.length > 0) {
        this.activeTab = 'merged';
      } else if (this.staleBranches.length > 0) {
        this.activeTab = 'stale';
      } else if (this.goneUpstreamBranches.length > 0) {
        this.activeTab = 'gone';
      }

      this.requestUpdate();
    } catch (err) {
      console.error('Failed to load cleanup data:', err);
      showToast('Failed to load cleanup data', 'error');
    } finally {
      this.loading = false;
    }
  }

  private assessRisk(candidate: CleanupCandidate): { risk: RiskLevel; riskReason: string } {
    const ahead = candidate.aheadBehind?.ahead ?? 0;

    if (ahead === 0) {
      return { risk: 'safe', riskReason: 'Fully merged into current branch' };
    }

    if (candidate.category === 'gone' && ahead > 0) {
      return {
        risk: 'danger',
        riskReason: `Remote deleted with ${ahead} unpushed commit${ahead !== 1 ? 's' : ''}`,
      };
    }

    if (ahead > 0) {
      return {
        risk: 'warning',
        riskReason: `Has ${ahead} unpushed commit${ahead !== 1 ? 's' : ''}`,
      };
    }

    if (!candidate.upstream) {
      return { risk: 'warning', riskReason: 'No upstream configured' };
    }

    return { risk: 'safe', riskReason: 'No unpushed work' };
  }

  private isBuiltinProtected(name: string): boolean {
    return BUILTIN_PROTECTED.includes(name);
  }

  private getProtectedReason(candidate: CleanupCandidate): string {
    if (BUILTIN_PROTECTED.includes(candidate.shorthand)) return 'Built-in protected branch';
    if (candidate.isProtected) return 'Protected by branch rule';
    return 'Protected';
  }

  private getActiveTabBranches(): CleanupBranch[] {
    switch (this.activeTab) {
      case 'merged':
        return this.mergedBranches;
      case 'stale':
        return this.staleBranches;
      case 'gone':
        return this.goneUpstreamBranches;
    }
  }

  private getSelectableBranches(): CleanupBranch[] {
    return this.getActiveTabBranches().filter((cb) => !cb.isProtected);
  }

  private isAllSelected(): boolean {
    const selectable = this.getSelectableBranches();
    if (selectable.length === 0) return false;
    return selectable.every((cb) => this.selectedBranches.has(cb.branch.name));
  }

  private handleSelectAll(): void {
    const selectable = this.getSelectableBranches();
    const allSelected = this.isAllSelected();

    if (allSelected) {
      for (const cb of selectable) {
        this.selectedBranches.delete(cb.branch.name);
      }
    } else {
      for (const cb of selectable) {
        this.selectedBranches.add(cb.branch.name);
      }
    }
    this.requestUpdate();
  }

  private handleToggleBranch(branchName: string): void {
    if (this.selectedBranches.has(branchName)) {
      this.selectedBranches.delete(branchName);
    } else {
      this.selectedBranches.add(branchName);
    }
    this.requestUpdate();
  }

  private handleTabChange(tab: CleanupTab): void {
    this.activeTab = tab;
  }

  private get totalSelected(): number {
    return this.selectedBranches.size;
  }

  private get hasWarningOrDanger(): boolean {
    const allBranches = [
      ...this.mergedBranches,
      ...this.staleBranches,
      ...this.goneUpstreamBranches,
    ];
    return allBranches.some(
      (cb) =>
        this.selectedBranches.has(cb.branch.name) &&
        (cb.risk === 'warning' || cb.risk === 'danger'),
    );
  }

  private async handleDelete(): Promise<void> {
    if (this.totalSelected === 0) return;

    // Build list of selected branches with their categories
    const allBranches = [
      ...this.mergedBranches,
      ...this.staleBranches,
      ...this.goneUpstreamBranches,
    ];

    // Deduplicate (a branch could appear in both stale and gone)
    const selectedMap = new Map<string, CleanupBranch>();
    for (const cb of allBranches) {
      if (this.selectedBranches.has(cb.branch.name) && !selectedMap.has(cb.branch.name)) {
        selectedMap.set(cb.branch.name, cb);
      }
    }

    const toDelete = Array.from(selectedMap.values());

    // Confirm if any are warning/danger
    if (this.hasWarningOrDanger) {
      const dangerCount = toDelete.filter(
        (cb) => cb.risk === 'warning' || cb.risk === 'danger',
      ).length;
      const confirmed = await showConfirm(
        'Delete Branches with Unpushed Work?',
        `${dangerCount} of the selected branches have unpushed commits that may be lost.\n\nThis action cannot be undone. Continue?`,
        'warning',
      );
      if (!confirmed) return;
    }

    this.deleting = true;
    let deleted = 0;
    let failed = 0;

    for (const cb of toDelete) {
      // Use force delete for warning/danger branches (not fully merged)
      const force = cb.risk === 'warning' || cb.risk === 'danger';
      const result = await gitService.deleteBranch(this.repositoryPath, cb.branch.name, force);
      if (result.success) {
        deleted++;
      } else {
        failed++;
        console.error(`Failed to delete ${cb.branch.name}:`, result.error);
      }
    }

    // Prune remote tracking branches if requested
    if (this.pruneRemotes) {
      await gitService.pruneRemoteTrackingBranches(this.repositoryPath);
    }

    this.deleting = false;

    if (deleted > 0) {
      const pruneNote = this.pruneRemotes ? ' (remotes pruned)' : '';
      const message =
        failed > 0
          ? `Deleted ${deleted} branch${deleted !== 1 ? 'es' : ''}, ${failed} failed${pruneNote}`
          : `Deleted ${deleted} branch${deleted !== 1 ? 'es' : ''}${pruneNote}`;
      showToast(message, failed > 0 ? 'warning' : 'success');

      this.dispatchEvent(
        new CustomEvent('cleanup-complete', {
          bubbles: true,
          composed: true,
        }),
      );
      this.close();
    } else if (failed > 0) {
      showToast(`Failed to delete ${failed} branch${failed !== 1 ? 'es' : ''}`, 'error');
    }
  }

  private handleModalClose(): void {
    if (!this.deleting) {
      this.reset();
    }
  }

  private formatTimeAgo(timestamp: number): string {
    const daysAgo = Math.floor((Date.now() / 1000 - timestamp) / (24 * 60 * 60));
    if (daysAgo < 1) return 'today';
    if (daysAgo === 1) return '1 day ago';
    if (daysAgo < 30) return `${daysAgo} days ago`;
    const months = Math.floor(daysAgo / 30);
    if (months === 1) return '1 month ago';
    if (months < 12) return `${months} months ago`;
    const years = Math.floor(months / 12);
    return years === 1 ? '1 year ago' : `${years} years ago`;
  }

  private renderTab(tab: CleanupTab, label: string, count: number) {
    return html`
      <button
        class="tab ${this.activeTab === tab ? 'active' : ''}"
        @click=${() => this.handleTabChange(tab)}
      >
        ${label}
        <span class="tab-badge">${count}</span>
      </button>
    `;
  }

  private renderRiskBadge(risk: RiskLevel, reason: string) {
    const icons = {
      safe: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
      warning: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
      danger: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
    };

    return html`
      <span class="risk-badge ${risk}" title=${reason}>
        ${icons[risk]}
        ${risk === 'safe' ? 'Safe' : risk === 'warning' ? 'Warning' : 'Danger'}
      </span>
    `;
  }

  private renderBranchItem(cb: CleanupBranch) {
    const { branch, risk, riskReason, isProtected, protectedReason } = cb;
    const isSelected = this.selectedBranches.has(branch.name);

    const detail = branch.lastCommitTimestamp
      ? `Last commit: ${this.formatTimeAgo(branch.lastCommitTimestamp)}`
      : '';

    return html`
      <li class="branch-item ${isProtected ? 'protected' : ''}">
        <input
          type="checkbox"
          .checked=${isSelected}
          ?disabled=${isProtected || this.deleting}
          @change=${() => this.handleToggleBranch(branch.name)}
          aria-label="Select ${branch.shorthand}"
        />
        <div class="branch-info">
          <span class="branch-name">${branch.shorthand}</span>
          ${detail ? html`<span class="branch-detail">${detail}</span>` : nothing}
          ${riskReason && !isProtected
            ? html`<span class="branch-detail">${riskReason}</span>`
            : nothing}
        </div>
        ${isProtected
          ? html`
              <span class="protected-badge" title=${protectedReason ?? 'Protected'}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0110 0v4"></path>
                </svg>
                Protected
              </span>
            `
          : this.renderRiskBadge(risk, riskReason)}
      </li>
    `;
  }

  private renderBranchList(branches: CleanupBranch[]) {
    if (branches.length === 0) {
      const messages: Record<CleanupTab, string> = {
        merged: 'No merged branches found',
        stale: 'No stale branches found',
        gone: 'No branches with deleted upstreams found',
      };

      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>${messages[this.activeTab]}</span>
        </div>
      `;
    }

    const selectable = branches.filter((cb) => !cb.isProtected);
    const allSelected = this.isAllSelected();

    return html`
      ${selectable.length > 0
        ? html`
            <div class="select-all">
              <input
                type="checkbox"
                .checked=${allSelected}
                @change=${this.handleSelectAll}
                ?disabled=${this.deleting}
                id="select-all-checkbox"
              />
              <label for="select-all-checkbox">
                ${allSelected ? 'Deselect all' : 'Select all'} (${selectable.length})
              </label>
            </div>
          `
        : nothing}
      <ul class="branch-list">
        ${branches.map((cb) => this.renderBranchItem(cb))}
      </ul>
    `;
  }

  render() {
    return html`
      <lv-modal modalTitle="Branch Cleanup" @close=${this.handleModalClose}>
        <div class="tabs">
          ${this.renderTab('merged', 'Merged', this.mergedBranches.length)}
          ${this.renderTab('stale', 'Stale', this.staleBranches.length)}
          ${this.renderTab('gone', 'Gone Upstream', this.goneUpstreamBranches.length)}
        </div>

        <div class="content-area">
          ${this.loading
            ? html`<div class="loading">Loading branches...</div>`
            : this.renderBranchList(this.getActiveTabBranches())}
        </div>

        <div class="prune-option">
          <label>
            <input
              type="checkbox"
              .checked=${this.pruneRemotes}
              @change=${(e: Event) => { this.pruneRemotes = (e.target as HTMLInputElement).checked; }}
              ?disabled=${this.deleting}
            />
            Also prune remote tracking branches
          </label>
        </div>

        <div slot="footer">
          <div class="footer-content">
            <span class="footer-summary">
              ${this.totalSelected > 0
                ? `${this.totalSelected} branch${this.totalSelected !== 1 ? 'es' : ''} selected`
                : 'No branches selected'}
            </span>
            <div class="footer-actions">
              <button class="btn btn-secondary" @click=${this.close} ?disabled=${this.deleting}>
                Cancel
              </button>
              <button
                class="btn btn-danger"
                @click=${this.handleDelete}
                ?disabled=${this.totalSelected === 0 || this.deleting}
              >
                ${this.deleting
                  ? 'Deleting...'
                  : `Delete Selected (${this.totalSelected})`}
              </button>
            </div>
          </div>
        </div>
      </lv-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-branch-cleanup-dialog': LvBranchCleanupDialog;
  }
}
