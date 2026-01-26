/**
 * Repository Health Dialog
 * Shows repository health information and provides maintenance actions
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import { showToast } from '../../services/notification.service.ts';

interface HealthStats {
  objectCount: number;
  packCount: number;
  looseObjectCount: number;
  sizeKb: number;
  branchCount: number;
  tagCount: number;
  stashCount: number;
  lastGcDate: string | null;
  recommendations: string[];
}

@customElement('lv-repository-health-dialog')
export class LvRepositoryHealthDialog extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        width: 500px;
      }

      .content {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .stats-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }

      .stat-card {
        padding: 12px;
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .stat-label {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .stat-value {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }

      .stat-value.warning {
        color: var(--color-warning);
      }

      .stat-value.success {
        color: var(--color-success);
      }

      .section-title {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
        margin-bottom: 8px;
        border-bottom: 1px solid var(--color-border);
        padding-bottom: 8px;
      }

      .recommendations {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .recommendation {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 10px;
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        border-left: 3px solid var(--color-warning);
      }

      .recommendation-icon {
        width: 16px;
        height: 16px;
        color: var(--color-warning);
        flex-shrink: 0;
        margin-top: 2px;
      }

      .recommendation-text {
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
      }

      .no-recommendations {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px;
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-md);
        border-left: 3px solid var(--color-success);
        color: var(--color-success);
        font-size: var(--font-size-sm);
      }

      .actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .action-btn {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text-primary);
        cursor: pointer;
        transition: all var(--transition-fast);
        font-size: var(--font-size-sm);
      }

      .action-btn:hover:not(:disabled) {
        background: var(--color-bg-hover);
        border-color: var(--color-primary);
      }

      .action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .action-icon {
        width: 18px;
        height: 18px;
        color: var(--color-text-muted);
      }

      .action-info {
        flex: 1;
      }

      .action-title {
        font-weight: var(--font-weight-medium);
      }

      .action-desc {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        margin-top: 2px;
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px;
        color: var(--color-text-muted);
      }

      .footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding-top: 16px;
        border-top: 1px solid var(--color-border);
      }

      button.primary {
        background: var(--color-primary);
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: var(--font-size-sm);
      }

      button.primary:hover {
        opacity: 0.9;
      }
    `,
  ];

  @property({ type: String }) repositoryPath = '';

  @state() private loading = false;
  @state() private runningAction: string | null = null;
  @state() private stats: HealthStats | null = null;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    await this.loadHealthStats();
  }

  private async loadHealthStats(): Promise<void> {
    if (!this.repositoryPath) return;

    this.loading = true;

    try {
      // Get repository statistics
      const [countResult, packsResult, branchesResult, tagsResult, stashesResult] = await Promise.all([
        gitService.getRepositoryStats(this.repositoryPath),
        gitService.getPackInfo(this.repositoryPath),
        gitService.getBranches(this.repositoryPath),
        gitService.getTags(this.repositoryPath),
        gitService.getStashes(this.repositoryPath),
      ]);

      // Calculate recommendations
      const recommendations: string[] = [];
      let looseObjectCount = 0;
      let totalObjects = 0;
      let sizeKb = 0;
      let packCount = 0;

      if (countResult.success && countResult.data) {
        totalObjects = countResult.data.count;
        looseObjectCount = countResult.data.loose;
        sizeKb = countResult.data.sizeKb;

        // Recommend GC if too many loose objects
        if (looseObjectCount > 500) {
          recommendations.push('Many loose objects detected. Running garbage collection will improve performance.');
        }
      }

      if (packsResult.success && packsResult.data) {
        packCount = packsResult.data.packCount;

        // Recommend repack if too many pack files
        if (packCount > 10) {
          recommendations.push('Multiple pack files detected. Repacking will consolidate data and save space.');
        }
      }

      const branchCount = branchesResult.success && branchesResult.data
        ? branchesResult.data.length
        : 0;

      // Recommend cleanup if many branches
      if (branchCount > 50) {
        recommendations.push('Many branches detected. Consider cleaning up merged branches.');
      }

      const tagCount = tagsResult.success && tagsResult.data
        ? tagsResult.data.length
        : 0;

      const stashCount = stashesResult.success && stashesResult.data
        ? stashesResult.data.length
        : 0;

      // Recommend stash cleanup if many stashes
      if (stashCount > 10) {
        recommendations.push('Many stashes detected. Consider cleaning up old stashes.');
      }

      this.stats = {
        objectCount: totalObjects,
        packCount,
        looseObjectCount,
        sizeKb,
        branchCount,
        tagCount,
        stashCount,
        lastGcDate: null, // Would need to check git logs
        recommendations,
      };
    } catch (error) {
      console.error('Failed to load health stats:', error);
      showToast('Failed to load repository health information', 'error');
    } finally {
      this.loading = false;
    }
  }

  private async runGc(aggressive: boolean): Promise<void> {
    if (!this.repositoryPath || this.runningAction) return;

    this.runningAction = aggressive ? 'gc-aggressive' : 'gc';

    try {
      const result = await gitService.runGc({
        path: this.repositoryPath,
        aggressive,
      });

      if (result.success) {
        showToast(aggressive ? 'Aggressive garbage collection completed' : 'Garbage collection completed', 'success');
        await this.loadHealthStats();
      } else {
        showToast(`Garbage collection failed: ${result.error?.message}`, 'error');
      }
    } finally {
      this.runningAction = null;
    }
  }

  private async runFsck(): Promise<void> {
    if (!this.repositoryPath || this.runningAction) return;

    this.runningAction = 'fsck';

    try {
      const result = await gitService.runFsck({
        path: this.repositoryPath,
        full: true,
      });

      if (result.success) {
        showToast('File system check completed - no issues found', 'success');
      } else {
        showToast(`File system check found issues: ${result.error?.message}`, 'warning');
      }
    } finally {
      this.runningAction = null;
    }
  }

  private async runPrune(): Promise<void> {
    if (!this.repositoryPath || this.runningAction) return;

    this.runningAction = 'prune';

    try {
      const result = await gitService.runPrune({
        path: this.repositoryPath,
      });

      if (result.success) {
        showToast('Pruned unreachable objects', 'success');
        await this.loadHealthStats();
      } else {
        showToast(`Prune failed: ${result.error?.message}`, 'error');
      }
    } finally {
      this.runningAction = null;
    }
  }

  private handleClose(): void {
    this.dispatchEvent(new CustomEvent('close'));
  }

  private formatSize(kb: number): string {
    if (kb < 1024) return `${kb} KB`;
    if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`;
    return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
  }

  render() {
    if (this.loading) {
      return html`
        <div class="loading">Loading repository health information...</div>
      `;
    }

    if (!this.stats) {
      return html`
        <div class="loading">Failed to load health information</div>
      `;
    }

    return html`
      <div class="content">
        <!-- Statistics -->
        <div>
          <div class="section-title">Repository Statistics</div>
          <div class="stats-grid">
            <div class="stat-card">
              <span class="stat-label">Total Objects</span>
              <span class="stat-value">${this.stats.objectCount.toLocaleString()}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Repository Size</span>
              <span class="stat-value">${this.formatSize(this.stats.sizeKb)}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Loose Objects</span>
              <span class="stat-value ${this.stats.looseObjectCount > 500 ? 'warning' : ''}">${this.stats.looseObjectCount.toLocaleString()}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Pack Files</span>
              <span class="stat-value ${this.stats.packCount > 10 ? 'warning' : ''}">${this.stats.packCount}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Branches</span>
              <span class="stat-value">${this.stats.branchCount}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Tags</span>
              <span class="stat-value">${this.stats.tagCount}</span>
            </div>
          </div>
        </div>

        <!-- Recommendations -->
        <div>
          <div class="section-title">Recommendations</div>
          ${this.stats.recommendations.length > 0 ? html`
            <div class="recommendations">
              ${this.stats.recommendations.map(rec => html`
                <div class="recommendation">
                  <svg class="recommendation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                  <span class="recommendation-text">${rec}</span>
                </div>
              `)}
            </div>
          ` : html`
            <div class="no-recommendations">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              Repository is healthy - no maintenance needed
            </div>
          `}
        </div>

        <!-- Maintenance Actions -->
        <div>
          <div class="section-title">Maintenance Actions</div>
          <div class="actions">
            <button
              class="action-btn"
              @click=${() => this.runGc(false)}
              ?disabled=${!!this.runningAction}
            >
              <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
              </svg>
              <div class="action-info">
                <div class="action-title">
                  ${this.runningAction === 'gc' ? 'Running...' : 'Garbage Collection'}
                </div>
                <div class="action-desc">Clean up loose objects and optimize repository</div>
              </div>
            </button>

            <button
              class="action-btn"
              @click=${() => this.runGc(true)}
              ?disabled=${!!this.runningAction}
            >
              <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <div class="action-info">
                <div class="action-title">
                  ${this.runningAction === 'gc-aggressive' ? 'Running...' : 'Aggressive GC'}
                </div>
                <div class="action-desc">Thorough cleanup - may take longer</div>
              </div>
            </button>

            <button
              class="action-btn"
              @click=${this.runFsck}
              ?disabled=${!!this.runningAction}
            >
              <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="12" y1="18" x2="12" y2="12"></line>
                <line x1="9" y1="15" x2="15" y2="15"></line>
              </svg>
              <div class="action-info">
                <div class="action-title">
                  ${this.runningAction === 'fsck' ? 'Running...' : 'File System Check'}
                </div>
                <div class="action-desc">Verify repository integrity</div>
              </div>
            </button>

            <button
              class="action-btn"
              @click=${this.runPrune}
              ?disabled=${!!this.runningAction}
            >
              <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              <div class="action-info">
                <div class="action-title">
                  ${this.runningAction === 'prune' ? 'Running...' : 'Prune Unreachable Objects'}
                </div>
                <div class="action-desc">Remove orphaned objects not reachable from any ref</div>
              </div>
            </button>
          </div>
        </div>
      </div>

      <div class="footer">
        <button class="primary" @click=${this.handleClose}>Done</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-repository-health-dialog': LvRepositoryHealthDialog;
  }
}
