import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import * as gitService from '../../services/git.service.ts';
import { showConfirm } from '../../services/dialog.service.ts';
import { dragDropService, type DragItem } from '../../services/drag-drop.service.ts';
import { settingsStore } from '../../stores/settings.store.ts';
import '../dialogs/lv-create-branch-dialog.ts';
import type { LvCreateBranchDialog } from '../dialogs/lv-create-branch-dialog.ts';
import '../dialogs/lv-interactive-rebase-dialog.ts';
import type { LvInteractiveRebaseDialog } from '../dialogs/lv-interactive-rebase-dialog.ts';
import type { Branch } from '../../types/git.types.ts';

interface BranchSubgroup {
  prefix: string | null;
  displayName: string;
  branches: Branch[];
}

interface BranchGroup {
  name: string;
  branches: Branch[];
  subgroups?: BranchSubgroup[];
  expanded: boolean;
}

interface LocalBranchGroup {
  prefix: string | null; // null means no prefix (e.g., main, develop)
  displayName: string;
  branches: Branch[];
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  branch: Branch | null;
}

/**
 * Branch list component
 * Displays local and remote branches with checkout and management functionality
 */
@customElement('lv-branch-list')
export class LvBranchList extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      .group {
        border-bottom: 1px solid var(--color-border);
      }

      .group:last-child {
        border-bottom: none;
      }

      .group-header {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        cursor: pointer;
        user-select: none;
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
      }

      .group-header:hover {
        background: var(--color-bg-hover);
      }

      .chevron {
        width: 16px;
        height: 16px;
        transition: transform var(--transition-fast);
      }

      .chevron.expanded {
        transform: rotate(90deg);
      }

      .group-icon {
        width: 16px;
        height: 16px;
        color: var(--color-text-muted);
      }

      .group-name {
        flex: 1;
        font-weight: var(--font-weight-medium);
      }

      .group-count {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        background: var(--color-bg-tertiary);
        padding: 1px 6px;
        border-radius: var(--radius-full);
      }

      .branch-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .local-section {
        padding: 2px 0;
      }

      .branch-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 12px;
        cursor: pointer;
        font-size: var(--font-size-sm);
      }

      .branch-item.nested {
        padding-left: 32px;
      }

      .subgroup {
        margin-left: 0;
      }

      .subgroup-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 12px;
        cursor: pointer;
        user-select: none;
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
      }

      .subgroup-header:hover {
        background: var(--color-bg-hover);
      }

      .subgroup-name {
        flex: 1;
        font-weight: var(--font-weight-medium);
      }

      .subgroup .chevron {
        width: 14px;
        height: 14px;
      }

      .prefix-icon {
        width: 14px;
        height: 14px;
        color: var(--color-text-muted);
      }

      .branch-item:hover {
        background: var(--color-bg-hover);
      }

      .branch-item.active {
        background: var(--color-primary-bg);
        color: var(--color-primary);
      }

      .branch-item.active .branch-icon {
        color: var(--color-primary);
      }

      .branch-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        color: var(--color-text-muted);
      }

      .branch-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ahead-behind {
        display: flex;
        gap: 4px;
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }

      .ahead {
        color: var(--color-success);
      }

      .behind {
        color: var(--color-warning);
      }

      .stale-indicator {
        display: flex;
        align-items: center;
        color: var(--color-text-muted);
        opacity: 0.7;
      }

      .stale-indicator svg {
        width: 12px;
        height: 12px;
      }

      .branch-item.stale .branch-name {
        color: var(--color-text-muted);
      }

      .branch-item.stale .branch-icon {
        opacity: 0.6;
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
      }

      .empty {
        padding: var(--spacing-sm);
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
        text-align: center;
      }

      /* Context menu */
      .context-menu {
        position: fixed;
        z-index: var(--z-dropdown, 100);
        min-width: 160px;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        padding: var(--spacing-xs) 0;
      }

      .context-menu-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        width: 100%;
        padding: var(--spacing-xs) var(--spacing-md);
        border: none;
        background: none;
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        text-align: left;
        cursor: pointer;
      }

      .context-menu-item:hover {
        background: var(--color-bg-hover);
      }

      .context-menu-item.danger {
        color: var(--color-error);
      }

      .context-menu-item svg {
        width: 14px;
        height: 14px;
        color: var(--color-text-muted);
      }

      .context-menu-item.danger svg {
        color: var(--color-error);
      }

      .context-menu-divider {
        height: 1px;
        background: var(--color-border);
        margin: var(--spacing-xs) 0;
      }

      /* Local section header */
      .local-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 2px 8px;
        border-bottom: 1px solid var(--color-border);
      }

      .local-header-title {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-secondary);
      }

      .cleanup-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border: none;
        background: none;
        color: var(--color-text-muted);
        font-size: var(--font-size-xs);
        cursor: pointer;
        border-radius: var(--radius-sm);
        transition: all var(--transition-fast);
      }

      .cleanup-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .cleanup-btn svg {
        width: 12px;
        height: 12px;
      }

      .cleanup-btn .badge {
        background: var(--color-warning-bg);
        color: var(--color-warning);
        padding: 0 4px;
        border-radius: var(--radius-full);
        font-size: 10px;
        font-weight: var(--font-weight-medium);
      }

      /* Drag and drop styles */
      .branch-item[draggable="true"] {
        cursor: grab;
      }

      .branch-item.dragging {
        opacity: 0.5;
        cursor: grabbing;
      }

      .branch-item.drop-target {
        background: var(--color-primary-bg);
        outline: 2px dashed var(--color-primary);
        outline-offset: -2px;
      }

      .branch-item.drop-target-merge {
        outline-color: var(--color-success);
        background: var(--color-success-bg);
      }

      .branch-item.drop-target-rebase {
        outline-color: var(--color-warning);
        background: var(--color-warning-bg);
      }

      .drop-indicator {
        position: absolute;
        right: var(--spacing-sm);
        padding: 2px 6px;
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        border-radius: var(--radius-sm);
        pointer-events: none;
      }

      .drop-indicator.merge {
        background: var(--color-success-bg);
        color: var(--color-success);
      }

      .drop-indicator.rebase {
        background: var(--color-warning-bg);
        color: var(--color-warning);
      }
    `,
  ];

  @property({ type: String }) repositoryPath: string = '';

  @state() private localBranchGroups: LocalBranchGroup[] = [];
  @state() private remoteGroups: BranchGroup[] = [];
  @state() private loading = true;
  @state() private error: string | null = null;
  @state() private expandedGroups = new Set<string>(['local', 'local-ungrouped']);
  @state() private contextMenu: ContextMenuState = { visible: false, x: 0, y: 0, branch: null };
  @state() private draggingBranch: Branch | null = null;
  @state() private dropTargetBranch: Branch | null = null;
  @state() private dropAction: 'merge' | 'rebase' | null = null;

  @query('lv-create-branch-dialog') private createBranchDialog!: LvCreateBranchDialog;
  @query('lv-interactive-rebase-dialog') private interactiveRebaseDialog!: LvInteractiveRebaseDialog;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    await this.loadBranches();
    document.addEventListener('click', this.handleDocumentClick);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('click', this.handleDocumentClick);
  }

  private handleDocumentClick = (): void => {
    if (this.contextMenu.visible) {
      this.contextMenu = { ...this.contextMenu, visible: false };
    }
  };

  async updated(changedProperties: Map<string, unknown>): Promise<void> {
    if (changedProperties.has('repositoryPath') && this.repositoryPath) {
      await this.loadBranches();
    }
  }

  public async refresh(): Promise<void> {
    await this.loadBranches();
  }

  private async loadBranches(): Promise<void> {
    if (!this.repositoryPath) return;

    this.loading = true;
    this.error = null;

    try {
      const [branchesResult] = await Promise.all([
        gitService.getBranches(this.repositoryPath),
        gitService.getRemotes(this.repositoryPath),
      ]);

      if (!branchesResult.success) {
        this.error = branchesResult.error?.message ?? 'Failed to load branches';
        return;
      }

      const branches = branchesResult.data!;

      // Separate local and remote branches
      const localBranches = branches.filter((b) => !b.isRemote);

      // Group local branches by prefix (feature/, fix/, hotfix/, etc.)
      const localGroupMap = new Map<string | null, Branch[]>();

      for (const branch of localBranches) {
        const slashIndex = branch.name.indexOf('/');
        const prefix = slashIndex > 0 ? branch.name.substring(0, slashIndex) : null;

        if (!localGroupMap.has(prefix)) {
          localGroupMap.set(prefix, []);
        }
        localGroupMap.get(prefix)!.push(branch);
      }

      // Sort groups: ungrouped first, then alphabetically by prefix
      const sortedPrefixes = Array.from(localGroupMap.keys()).sort((a, b) => {
        if (a === null) return -1;
        if (b === null) return 1;
        return a.localeCompare(b);
      });

      this.localBranchGroups = sortedPrefixes.map((prefix) => ({
        prefix,
        displayName: prefix ?? 'Branches',
        branches: localGroupMap.get(prefix)!.sort((a, b) => {
          // Sort HEAD branch first, then alphabetically
          if (a.isHead) return -1;
          if (b.isHead) return 1;
          return a.name.localeCompare(b.name);
        }),
      }));

      // Auto-expand prefix groups that have branches
      const newExpandedGroups = new Set(this.expandedGroups);
      for (const prefix of sortedPrefixes) {
        if (prefix !== null) {
          newExpandedGroups.add(`local-${prefix}`);
        }
      }
      this.expandedGroups = newExpandedGroups;

      // Group remote branches by remote name, then by prefix
      const remoteBranches = branches.filter((b) => b.isRemote);
      const remoteMap = new Map<string, Branch[]>();

      for (const branch of remoteBranches) {
        // Extract remote name from origin/main -> origin
        // or refs/remotes/origin/main -> origin
        const parts = branch.name.split('/');
        // If it starts with refs/remotes/, the remote is at index 2, otherwise index 0
        const remoteName = parts[0] === 'refs' ? parts[2] : parts[0];

        if (!remoteMap.has(remoteName)) {
          remoteMap.set(remoteName, []);
        }
        remoteMap.get(remoteName)!.push(branch);
      }

      // For each remote, group branches by prefix
      this.remoteGroups = Array.from(remoteMap.entries()).map(([name, branches]) => {
        // Group branches by prefix within this remote
        const prefixMap = new Map<string | null, Branch[]>();

        for (const branch of branches) {
          // shorthand is already stripped of remote name (e.g., "feature/my-fix" not "origin/feature/my-fix")
          const slashIndex = branch.shorthand.indexOf('/');
          const prefix = slashIndex > 0 ? branch.shorthand.substring(0, slashIndex) : null;

          if (!prefixMap.has(prefix)) {
            prefixMap.set(prefix, []);
          }
          prefixMap.get(prefix)!.push(branch);
        }

        // Sort prefixes: ungrouped first, then alphabetically
        const sortedPrefixes = Array.from(prefixMap.keys()).sort((a, b) => {
          if (a === null) return -1;
          if (b === null) return 1;
          return a.localeCompare(b);
        });

        // Create subgroups
        const subgroups = sortedPrefixes.map((prefix) => ({
          prefix,
          displayName: prefix ?? 'branches',
          branches: prefixMap.get(prefix)!.sort((a, b) => a.shorthand.localeCompare(b.shorthand)),
        }));

        // Auto-expand remote groups and prefix subgroups
        this.expandedGroups.add(`remote-${name}`);
        for (const prefix of sortedPrefixes) {
          if (prefix !== null) {
            this.expandedGroups.add(`remote-${name}-${prefix}`);
          }
        }

        return {
          name,
          branches,
          subgroups,
          expanded: true,
        };
      });

    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      this.loading = false;
    }
  }

  private toggleGroup(groupId: string): void {
    if (this.expandedGroups.has(groupId)) {
      this.expandedGroups.delete(groupId);
    } else {
      this.expandedGroups.add(groupId);
    }
    this.requestUpdate();
  }

  private handleCreateBranch(): void {
    this.createBranchDialog.open();
  }

  /**
   * Find all local branches that are merged into HEAD
   */
  private getMergedBranches(): Branch[] {
    const allLocal = this.localBranchGroups.flatMap(g => g.branches);
    // A branch is considered merged if it's:
    // 1. Not HEAD
    // 2. Behind 0 commits (meaning HEAD contains all its commits)
    // Note: This is a simple heuristic. For perfect accuracy,
    // we'd need to check if HEAD is a descendant of the branch.
    return allLocal.filter(b =>
      !b.isHead &&
      b.aheadBehind &&
      b.aheadBehind.ahead === 0
    );
  }

  /**
   * Delete all branches that are merged into HEAD
   */
  private async handleDeleteMergedBranches(): Promise<void> {
    const mergedBranches = this.getMergedBranches();

    if (mergedBranches.length === 0) {
      await showConfirm(
        'No Merged Branches',
        'There are no local branches that are fully merged into the current branch.',
        'info'
      );
      return;
    }

    const branchNames = mergedBranches.map(b => `  • ${b.shorthand}`).join('\n');
    const confirmed = await showConfirm(
      'Delete Merged Branches',
      `The following ${mergedBranches.length} branch${mergedBranches.length > 1 ? 'es are' : ' is'} merged and will be deleted:\n\n${branchNames}\n\nThis action cannot be undone.`,
      'warning'
    );

    if (!confirmed) return;

    // Delete branches one by one
    let deleted = 0;
    let failed = 0;

    for (const branch of mergedBranches) {
      const result = await gitService.deleteBranch(
        this.repositoryPath,
        branch.name,
        false
      );
      if (result.success) {
        deleted++;
      } else {
        failed++;
        console.error(`Failed to delete ${branch.name}:`, result.error);
      }
    }

    if (deleted > 0) {
      await this.loadBranches();
      this.dispatchEvent(new CustomEvent('branches-changed', {
        bubbles: true,
        composed: true,
      }));
    }

    if (failed > 0) {
      await showConfirm(
        'Partial Success',
        `Deleted ${deleted} branch${deleted !== 1 ? 'es' : ''}, but ${failed} failed to delete.`,
        'warning'
      );
    }
  }

  private async handleBranchCreated(): Promise<void> {
    await this.loadBranches();
    this.dispatchEvent(new CustomEvent('branches-changed', {
      bubbles: true,
      composed: true,
    }));
  }

  private handleBranchClick(branch: Branch): void {
    // Navigate to the branch's commit in the graph
    this.dispatchEvent(new CustomEvent('branch-selected', {
      detail: { branch },
      bubbles: true,
      composed: true,
    }));
  }

  private async handleCheckout(branch: Branch): Promise<void> {
    if (branch.isHead) return;

    const result = await gitService.checkout(this.repositoryPath, {
      ref: branch.isRemote ? branch.shorthand : branch.name
    });

    if (result.success) {
      await this.loadBranches();
      this.dispatchEvent(new CustomEvent('branch-checkout', {
        detail: { branch },
        bubbles: true,
        composed: true,
      }));
    } else {
      console.error('Checkout failed:', result.error);
    }
  }

  private handleContextMenu(e: MouseEvent, branch: Branch): void {
    e.preventDefault();
    e.stopPropagation();

    this.contextMenu = {
      visible: true,
      x: e.clientX,
      y: e.clientY,
      branch,
    };
  }

  private async handleRenameBranch(): Promise<void> {
    const branch = this.contextMenu.branch;
    if (!branch) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    // Cannot rename HEAD branch or remote branches
    if (branch.isHead || branch.isRemote) {
      return;
    }

    const newName = prompt(`Rename branch "${branch.name}" to:`, branch.name);
    if (!newName || newName === branch.name) {
      return;
    }

    const result = await gitService.renameBranch(this.repositoryPath, {
      oldName: branch.name,
      newName: newName.trim(),
    });

    if (result.success) {
      await this.loadBranches();
      this.dispatchEvent(new CustomEvent('branches-changed', {
        bubbles: true,
        composed: true,
      }));
    } else {
      console.error('Rename branch failed:', result.error);
    }
  }

  private async handleDeleteBranch(): Promise<void> {
    const branch = this.contextMenu.branch;
    if (!branch) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    // Cannot delete HEAD branch
    if (branch.isHead) {
      return;
    }

    const confirmed = await showConfirm(
      'Delete Branch',
      `Are you sure you want to delete the branch "${branch.shorthand}"?\n\nThis action cannot be undone.`,
      'warning'
    );

    if (!confirmed) return;

    const result = await gitService.deleteBranch(
      this.repositoryPath,
      branch.name,
      false
    );

    if (result.success) {
      await this.loadBranches();
      this.dispatchEvent(new CustomEvent('branches-changed', {
        bubbles: true,
        composed: true,
      }));
    } else {
      console.error('Delete branch failed:', result.error);
    }
  }

  private async handleMergeBranch(): Promise<void> {
    const branch = this.contextMenu.branch;
    if (!branch) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    const confirmed = await showConfirm(
      'Merge Branch',
      `Merge "${branch.shorthand}" into the current branch?`,
      'info'
    );

    if (!confirmed) return;

    const result = await gitService.merge({
      path: this.repositoryPath,
      source_ref: branch.shorthand,
    });

    if (result.success) {
      await this.loadBranches();
      this.dispatchEvent(new CustomEvent('branches-changed', {
        bubbles: true,
        composed: true,
      }));
    } else {
      // Check if it's a merge conflict
      if (result.error?.code === 'MERGE_CONFLICT') {
        const abortConfirmed = await showConfirm(
          'Merge Conflict',
          'There are merge conflicts. Would you like to abort the merge?',
          'warning'
        );
        if (abortConfirmed) {
          await gitService.abortMerge({ path: this.repositoryPath });
        }
      } else {
        console.error('Merge failed:', result.error);
      }
    }
  }

  private async handleRebaseBranch(): Promise<void> {
    const branch = this.contextMenu.branch;
    if (!branch) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    const confirmed = await showConfirm(
      'Rebase Branch',
      `Rebase current branch onto "${branch.shorthand}"?\n\nThis will rewrite commit history.`,
      'warning'
    );

    if (!confirmed) return;

    const result = await gitService.rebase({
      path: this.repositoryPath,
      onto: branch.shorthand,
    });

    if (result.success) {
      await this.loadBranches();
      this.dispatchEvent(new CustomEvent('branches-changed', {
        bubbles: true,
        composed: true,
      }));
    } else {
      // Check if it's a rebase conflict
      if (result.error?.code === 'REBASE_CONFLICT') {
        const abortConfirmed = await showConfirm(
          'Rebase Conflict',
          'There are rebase conflicts. Would you like to abort the rebase?',
          'warning'
        );
        if (abortConfirmed) {
          await gitService.abortRebase({ path: this.repositoryPath });
        }
      } else {
        console.error('Rebase failed:', result.error);
      }
    }
  }

  private handleInteractiveRebase(): void {
    const branch = this.contextMenu.branch;
    if (!branch) return;

    this.contextMenu = { ...this.contextMenu, visible: false };
    this.interactiveRebaseDialog.open(branch.shorthand);
  }

  private async handleRebaseComplete(): Promise<void> {
    await this.loadBranches();
    this.dispatchEvent(new CustomEvent('branches-changed', {
      bubbles: true,
      composed: true,
    }));
  }

  private handleCreateBranchFrom(): void {
    const branch = this.contextMenu.branch;
    if (!branch) return;

    this.contextMenu = { ...this.contextMenu, visible: false };
    this.createBranchDialog.open(branch.shorthand);
  }

  private renderBranchIcon(isHead: boolean) {
    if (isHead) {
      return html`
        <svg class="branch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `;
    }
    return html`
      <svg class="branch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="6" y1="3" x2="6" y2="15"></line>
        <circle cx="18" cy="6" r="3"></circle>
        <circle cx="6" cy="18" r="3"></circle>
        <path d="M18 9a9 9 0 01-9 9"></path>
      </svg>
    `;
  }

  private renderAheadBehind(branch: Branch) {
    if (!branch.aheadBehind) return nothing;

    const { ahead, behind } = branch.aheadBehind;
    if (ahead === 0 && behind === 0) return nothing;

    return html`
      <span class="ahead-behind">
        ${ahead > 0 ? html`<span class="ahead">↑${ahead}</span>` : nothing}
        ${behind > 0 ? html`<span class="behind">↓${behind}</span>` : nothing}
      </span>
    `;
  }

  /**
   * Check if a branch is stale based on user's staleBranchDays setting
   */
  private isBranchStale(branch: Branch): boolean {
    const { staleBranchDays } = settingsStore.getState();

    // If staleBranchDays is 0, feature is disabled
    if (staleBranchDays === 0) return false;

    // HEAD branch is never stale
    if (branch.isHead) return false;

    // Check if lastCommitTimestamp exists
    if (!branch.lastCommitTimestamp) return false;

    const nowSeconds = Date.now() / 1000;
    const staleThresholdSeconds = staleBranchDays * 24 * 60 * 60;

    return branch.lastCommitTimestamp < nowSeconds - staleThresholdSeconds;
  }

  private renderStaleIndicator(branch: Branch) {
    if (!this.isBranchStale(branch)) return nothing;

    // Calculate how long ago the last commit was
    const lastCommit = branch.lastCommitTimestamp;
    let title = 'Stale branch';
    if (lastCommit) {
      const daysAgo = Math.floor((Date.now() / 1000 - lastCommit) / (24 * 60 * 60));
      const months = Math.floor(daysAgo / 30);
      if (months >= 1) {
        title = `Last commit ${months} month${months > 1 ? 's' : ''} ago`;
      } else {
        title = `Last commit ${daysAgo} days ago`;
      }
    }

    return html`
      <span class="stale-indicator" title="${title}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
      </span>
    `;
  }

  private renderBranchItem(branch: Branch, nested = false, stripPrefix: string | null = null) {
    // Determine display name: strip prefix if provided
    let displayName = branch.shorthand;
    if (stripPrefix && displayName.startsWith(stripPrefix + '/')) {
      displayName = displayName.substring(stripPrefix.length + 1);
    }

    const isDragging = this.draggingBranch?.name === branch.name;
    const isDropTarget = this.dropTargetBranch?.name === branch.name;
    const dropClass = isDropTarget ? `drop-target drop-target-${this.dropAction}` : '';
    const staleClass = this.isBranchStale(branch) ? 'stale' : '';

    return html`
      <li
        class="branch-item ${branch.isHead ? 'active' : ''} ${nested ? 'nested' : ''} ${isDragging ? 'dragging' : ''} ${dropClass} ${staleClass}"
        draggable=${!branch.isHead ? 'true' : 'false'}
        @click=${() => this.handleBranchClick(branch)}
        @dblclick=${() => this.handleCheckout(branch)}
        @contextmenu=${(e: MouseEvent) => this.handleContextMenu(e, branch)}
        @dragstart=${(e: DragEvent) => this.handleDragStart(e, branch)}
        @dragend=${() => this.handleDragEnd()}
        @dragover=${(e: DragEvent) => this.handleDragOver(e, branch)}
        @dragenter=${(e: DragEvent) => this.handleDragEnter(e, branch)}
        @dragleave=${(e: DragEvent) => this.handleDragLeave(e, branch)}
        @drop=${(e: DragEvent) => this.handleDrop(e, branch)}
        title="${branch.name}"
      >
        ${this.renderBranchIcon(branch.isHead)}
        <span class="branch-name">${displayName}</span>
        ${this.renderAheadBehind(branch)}
        ${this.renderStaleIndicator(branch)}
        ${isDropTarget ? html`
          <span class="drop-indicator ${this.dropAction}">${this.dropAction === 'merge' ? 'Merge' : 'Rebase'}</span>
        ` : nothing}
      </li>
    `;
  }

  // Drag and drop handlers
  private handleDragStart(e: DragEvent, branch: Branch): void {
    if (branch.isHead) {
      e.preventDefault();
      return;
    }

    this.draggingBranch = branch;
    const item: DragItem = { type: 'branch', data: branch };
    e.dataTransfer?.setData('application/json', JSON.stringify(item));
    e.dataTransfer!.effectAllowed = 'move';
    dragDropService.startDrag(item);
  }

  private handleDragEnd(): void {
    this.draggingBranch = null;
    this.dropTargetBranch = null;
    this.dropAction = null;
    dragDropService.endDrag();
  }

  private handleDragOver(e: DragEvent, branch: Branch): void {
    // Can't drop on self or HEAD
    if (!this.draggingBranch || this.draggingBranch.name === branch.name) return;

    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';

    // Determine action based on alt key (alt = rebase, no alt = merge)
    this.dropAction = e.altKey ? 'rebase' : 'merge';
  }

  private handleDragEnter(e: DragEvent, branch: Branch): void {
    // Can't drop on self
    if (!this.draggingBranch || this.draggingBranch.name === branch.name) return;

    e.preventDefault();
    this.dropTargetBranch = branch;
    this.dropAction = e.altKey ? 'rebase' : 'merge';
  }

  private handleDragLeave(e: DragEvent, branch: Branch): void {
    // Only clear if we're actually leaving this element
    const target = e.currentTarget as HTMLElement;
    if (target.contains(e.relatedTarget as Node)) return;

    if (this.dropTargetBranch?.name === branch.name) {
      this.dropTargetBranch = null;
      this.dropAction = null;
    }
  }

  private async handleDrop(e: DragEvent, targetBranch: Branch): Promise<void> {
    e.preventDefault();

    const sourceBranch = this.draggingBranch;
    if (!sourceBranch || sourceBranch.name === targetBranch.name) return;

    // Determine action based on alt key
    const action = e.altKey ? 'rebase' : 'merge';

    // Clear drag state
    this.draggingBranch = null;
    this.dropTargetBranch = null;
    this.dropAction = null;
    dragDropService.endDrag();

    // If target is HEAD, merge source into current
    if (targetBranch.isHead) {
      if (action === 'merge') {
        // Merge source branch into current (HEAD)
        const confirmed = await showConfirm(
          'Merge Branch',
          `Merge "${sourceBranch.shorthand}" into the current branch?`,
          'info'
        );
        if (!confirmed) return;

        const result = await gitService.merge({
          path: this.repositoryPath,
          source_ref: sourceBranch.shorthand,
        });

        if (result.success) {
          await this.loadBranches();
          this.dispatchEvent(new CustomEvent('branches-changed', { bubbles: true, composed: true }));
        } else if (result.error?.code === 'MERGE_CONFLICT') {
          this.dispatchEvent(new CustomEvent('merge-conflict', { bubbles: true, composed: true }));
        }
      } else {
        // Rebase current branch onto source
        const confirmed = await showConfirm(
          'Rebase Branch',
          `Rebase current branch onto "${sourceBranch.shorthand}"?`,
          'warning'
        );
        if (!confirmed) return;

        const result = await gitService.rebase({
          path: this.repositoryPath,
          onto: sourceBranch.shorthand,
        });

        if (result.success) {
          await this.loadBranches();
          this.dispatchEvent(new CustomEvent('branches-changed', { bubbles: true, composed: true }));
        } else if (result.error?.code === 'REBASE_CONFLICT') {
          this.dispatchEvent(new CustomEvent('open-conflict-dialog', {
            bubbles: true,
            composed: true,
            detail: { operationType: 'rebase' },
          }));
        }
      }
    } else {
      // Dropping on a non-HEAD branch: need to checkout first, then merge/rebase
      const actionText = action === 'merge' ? 'merge' : 'rebase onto';
      const confirmed = await showConfirm(
        action === 'merge' ? 'Merge Branch' : 'Rebase Branch',
        `This will checkout "${targetBranch.shorthand}" and ${actionText} "${sourceBranch.shorthand}". Continue?`,
        action === 'merge' ? 'info' : 'warning'
      );
      if (!confirmed) return;

      // First checkout target branch
      const checkoutResult = await gitService.checkout(this.repositoryPath, {
        ref: targetBranch.shorthand
      });

      if (!checkoutResult.success) {
        console.error('Checkout failed:', checkoutResult.error);
        return;
      }

      // Then perform the action
      if (action === 'merge') {
        const result = await gitService.merge({
          path: this.repositoryPath,
          source_ref: sourceBranch.shorthand,
        });

        if (result.success) {
          await this.loadBranches();
          this.dispatchEvent(new CustomEvent('branches-changed', { bubbles: true, composed: true }));
        } else if (result.error?.code === 'MERGE_CONFLICT') {
          this.dispatchEvent(new CustomEvent('merge-conflict', { bubbles: true, composed: true }));
        }
      } else {
        const result = await gitService.rebase({
          path: this.repositoryPath,
          onto: sourceBranch.shorthand,
        });

        if (result.success) {
          await this.loadBranches();
          this.dispatchEvent(new CustomEvent('branches-changed', { bubbles: true, composed: true }));
        } else if (result.error?.code === 'REBASE_CONFLICT') {
          this.dispatchEvent(new CustomEvent('open-conflict-dialog', {
            bubbles: true,
            composed: true,
            detail: { operationType: 'rebase' },
          }));
        }
      }
    }
  }

  private renderLocalGroup(group: LocalBranchGroup) {
    // For ungrouped branches (no prefix), render them directly
    if (group.prefix === null) {
      return html`
        <ul class="branch-list">
          ${group.branches.map((b) => this.renderBranchItem(b))}
        </ul>
      `;
    }

    // For prefix groups, render as collapsible subgroup
    const groupId = `local-${group.prefix}`;
    const expanded = this.expandedGroups.has(groupId);

    return html`
      <div class="subgroup">
        <div class="subgroup-header" @click=${() => this.toggleGroup(groupId)}>
          <svg class="chevron ${expanded ? 'expanded' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          ${this.renderPrefixIcon(group.prefix)}
          <span class="subgroup-name">${group.displayName}</span>
          <span class="group-count">${group.branches.length}</span>
        </div>
        ${expanded ? html`
          <ul class="branch-list">
            ${group.branches.map((b) => this.renderBranchItem(b, true, group.prefix))}
          </ul>
        ` : nothing}
      </div>
    `;
  }

  private renderRemoteSubgroup(remoteName: string, subgroup: BranchSubgroup) {
    // For ungrouped branches (no prefix), render them directly
    if (subgroup.prefix === null) {
      return html`
        <ul class="branch-list">
          ${subgroup.branches.map((b) => this.renderBranchItem(b))}
        </ul>
      `;
    }

    // For prefix groups, render as collapsible subgroup
    const groupId = `remote-${remoteName}-${subgroup.prefix}`;
    const expanded = this.expandedGroups.has(groupId);

    return html`
      <div class="subgroup">
        <div class="subgroup-header" @click=${() => this.toggleGroup(groupId)}>
          <svg class="chevron ${expanded ? 'expanded' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          ${this.renderPrefixIcon(subgroup.prefix)}
          <span class="subgroup-name">${subgroup.displayName}</span>
          <span class="group-count">${subgroup.branches.length}</span>
        </div>
        ${expanded ? html`
          <ul class="branch-list">
            ${subgroup.branches.map((b) => this.renderBranchItem(b, true, subgroup.prefix))}
          </ul>
        ` : nothing}
      </div>
    `;
  }

  private renderPrefixIcon(prefix: string) {
    // Different icons for common prefixes
    switch (prefix.toLowerCase()) {
      case 'feature':
        return html`<svg class="prefix-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
        </svg>`;
      case 'fix':
      case 'bugfix':
      case 'hotfix':
        return html`<svg class="prefix-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4.93 4.93l4.24 4.24"></path>
          <path d="M14.83 9.17l4.24-4.24"></path>
          <path d="M14.83 14.83l4.24 4.24"></path>
          <path d="M9.17 14.83l-4.24 4.24"></path>
          <circle cx="12" cy="12" r="4"></circle>
        </svg>`;
      case 'release':
        return html`<svg class="prefix-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
        </svg>`;
      case 'chore':
        return html`<svg class="prefix-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"></path>
        </svg>`;
      case 'copilot':
      case 'ai':
      case 'claude':
        // Sparkles icon for AI-generated branches
        return html`<svg class="prefix-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"></path>
          <path d="M5 16l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"></path>
          <path d="M19 13l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5z"></path>
        </svg>`;
      default:
        return html`<svg class="prefix-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"></path>
        </svg>`;
    }
  }

  private renderContextMenu() {
    if (!this.contextMenu.visible || !this.contextMenu.branch) return nothing;

    const branch = this.contextMenu.branch;
    const isLocal = !branch.isRemote;
    const isHead = branch.isHead;

    return html`
      <div
        class="context-menu"
        style="left: ${this.contextMenu.x}px; top: ${this.contextMenu.y}px;"
        @click=${(e: Event) => e.stopPropagation()}
      >
        ${!isHead ? html`
          <button class="context-menu-item" @click=${() => this.handleCheckout(branch)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Checkout
          </button>
        ` : ''}

        <button class="context-menu-item" @click=${this.handleCreateBranchFrom}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Create branch from here
        </button>

        ${!isHead ? html`
          <button class="context-menu-item" @click=${this.handleMergeBranch}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="18" cy="18" r="3"></circle>
              <circle cx="6" cy="6" r="3"></circle>
              <path d="M6 21V9a9 9 0 009 9"></path>
            </svg>
            Merge into current branch
          </button>
          <button class="context-menu-item" @click=${this.handleRebaseBranch}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="6" cy="6" r="3"></circle>
              <circle cx="6" cy="18" r="3"></circle>
              <line x1="6" y1="9" x2="6" y2="15"></line>
              <path d="M18 6h-6a3 3 0 00-3 3v3"></path>
            </svg>
            Rebase current onto this
          </button>
          <button class="context-menu-item" @click=${this.handleInteractiveRebase}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="9" y1="9" x2="15" y2="9"></line>
              <line x1="9" y1="13" x2="15" y2="13"></line>
              <line x1="9" y1="17" x2="12" y2="17"></line>
            </svg>
            Interactive rebase onto this
          </button>
        ` : ''}

        ${isLocal && !isHead ? html`
          <div class="context-menu-divider"></div>
          <button class="context-menu-item" @click=${this.handleRenameBranch}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
            </svg>
            Rename
          </button>
          <button class="context-menu-item danger" @click=${this.handleDeleteBranch}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
            </svg>
            Delete branch
          </button>
        ` : ''}
      </div>
    `;
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">Loading branches...</div>`;
    }

    if (this.error) {
      return html`<div class="error">${this.error}</div>`;
    }

    return html`
      <lv-create-branch-dialog
        .repositoryPath=${this.repositoryPath}
        @branch-created=${this.handleBranchCreated}
      ></lv-create-branch-dialog>

      <lv-interactive-rebase-dialog
        .repositoryPath=${this.repositoryPath}
        @rebase-complete=${this.handleRebaseComplete}
      ></lv-interactive-rebase-dialog>

      <!-- Local branches -->
      ${this.localBranchGroups.length > 0 ? html`
        <div class="local-header">
          <span class="local-header-title">Local Branches</span>
          ${this.getMergedBranches().length > 0 ? html`
            <button
              class="cleanup-btn"
              @click=${this.handleDeleteMergedBranches}
              title="Delete branches that are merged into current branch"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
              </svg>
              Clean up
              <span class="badge">${this.getMergedBranches().length}</span>
            </button>
          ` : nothing}
        </div>
        <div class="local-section">
          ${this.localBranchGroups.map((group) => this.renderLocalGroup(group))}
        </div>
      ` : nothing}

      <!-- Remote branches -->
      ${this.remoteGroups.map((group) => {
        const groupId = `remote-${group.name}`;
        const expanded = this.expandedGroups.has(groupId);

        return html`
          <div class="group">
            <div class="group-header" @click=${() => this.toggleGroup(groupId)}>
              <svg class="chevron ${expanded ? 'expanded' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
              <svg class="group-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"></path>
              </svg>
              <span class="group-name">${group.name}</span>
              <span class="group-count">${group.branches.length}</span>
            </div>
            ${expanded ? html`
              ${group.subgroups?.map((subgroup) => this.renderRemoteSubgroup(group.name, subgroup))}
            ` : nothing}
          </div>
        `;
      })}

      ${this.renderContextMenu()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-branch-list': LvBranchList;
  }
}
