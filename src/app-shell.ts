import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { sharedStyles } from './styles/shared-styles.ts';
import { repositoryStore, uiStore, type OpenRepository } from './stores/index.ts';
import { registerDefaultShortcuts, keyboardService } from './services/keyboard.service.ts';
import { loggers } from './utils/logger.ts';

const log = loggers.app;
import './components/toolbar/lv-toolbar.ts';
import './components/welcome/lv-welcome.ts';
import './components/graph/lv-graph-canvas.ts';
import './components/panels/lv-diff-view.ts';
import './components/panels/lv-blame-view.ts';
import './components/sidebar/lv-left-panel.ts';
import './components/sidebar/lv-right-panel.ts';
import './components/dialogs/lv-settings-dialog.ts';
import './components/dialogs/lv-modal.ts';
import './components/dialogs/lv-conflict-resolution-dialog.ts';
import './components/dialogs/lv-command-palette.ts';
import './components/dialogs/lv-reflog-dialog.ts';
import './components/dialogs/lv-keyboard-shortcuts-dialog.ts';
import './components/dialogs/lv-remote-dialog.ts';
import './components/dialogs/lv-clean-dialog.ts';
import './components/dialogs/lv-bisect-dialog.ts';
import './components/dialogs/lv-submodule-dialog.ts';
import './components/dialogs/lv-worktree-dialog.ts';
import './components/dialogs/lv-lfs-dialog.ts';
import './components/dialogs/lv-gpg-dialog.ts';
import './components/dialogs/lv-ssh-dialog.ts';
import './components/dialogs/lv-config-dialog.ts';
import './components/dialogs/lv-credentials-dialog.ts';
import './components/dialogs/lv-github-dialog.ts';
import './components/dialogs/lv-gitlab-dialog.ts';
import './components/dialogs/lv-bitbucket-dialog.ts';
import './components/dialogs/lv-azure-devops-dialog.ts';
import './components/dialogs/lv-profile-manager-dialog.ts';
import './components/dialogs/lv-migration-dialog.ts';
import './components/panels/lv-file-history.ts';
import './components/common/lv-toast-container.ts';
import './components/dashboard/lv-context-dashboard.ts';
import type { CommitSelectedEvent, LvGraphCanvas } from './components/graph/lv-graph-canvas.ts';
import type { Commit, RefInfo, StatusEntry, Tag, Branch } from './types/git.types.ts';
import type { SearchFilter } from './components/toolbar/lv-search-bar.ts';
import type { PaletteCommand } from './components/dialogs/lv-command-palette.ts';
import * as gitService from './services/git.service.ts';
import * as updateService from './services/update.service.ts';
import * as unifiedProfileService from './services/unified-profile.service.ts';
import { showToast } from './services/notification.service.ts';
import { initOAuthListener } from './services/oauth.service.ts';
import type { UnlistenFn } from '@tauri-apps/api/event';

/**
 * Main application shell component
 * Provides the top-level layout and routing
 */
@customElement('lv-app-shell')
export class AppShell extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100vh;
        width: 100vw;
        overflow: hidden;
        background: var(--color-bg-primary);
        color: var(--color-text-primary);
      }

      .main-content {
        display: flex;
        flex: 1;
        overflow: hidden;
      }

      .left-panel {
        display: flex;
        flex-direction: column;
        background: var(--color-bg-secondary);
        border-right: 1px solid var(--color-border);
        overflow: hidden;
      }

      .center-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        min-width: 400px;
        position: relative;
      }

      .graph-area {
        flex: 1;
        overflow: hidden;
        background: var(--color-bg-primary);
      }

      .diff-area {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        flex-direction: column;
        background: var(--color-bg-primary);
        z-index: 10;
      }

      .diff-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
      }

      .diff-header-left {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        min-width: 0;
        flex: 1;
      }

      .diff-title {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }

      .diff-path {
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        font-family: var(--font-family-mono);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .diff-close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all var(--transition-fast);
        flex-shrink: 0;
      }

      .diff-close-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .diff-close-btn svg {
        width: 16px;
        height: 16px;
      }

      .diff-content {
        flex: 1;
        overflow: hidden;
      }

      .right-panel {
        display: flex;
        flex-direction: column;
        background: var(--color-bg-secondary);
        border-left: 1px solid var(--color-border);
        overflow: hidden;
      }

      .resize-handle-h {
        width: 4px;
        cursor: col-resize;
        background: transparent;
        transition: background-color 0.15s ease;
        flex-shrink: 0;
        z-index: 10;
      }

      .resize-handle-h:hover,
      .resize-handle-h.dragging {
        background: var(--color-primary);
      }

      .status-bar {
        display: flex;
        align-items: center;
        height: 24px;
        padding: 0 var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-top: 1px solid var(--color-border);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
      }

      lv-welcome {
        flex: 1;
      }

      :host(.resizing) {
        user-select: none;
      }

      :host(.resizing-h) * {
        cursor: col-resize !important;
      }

      /* Context Menu */
      .context-menu {
        position: fixed;
        z-index: var(--z-dropdown);
        min-width: 200px;
        max-width: 300px;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        padding: var(--spacing-xs) 0;
      }

      .context-menu-header {
        padding: var(--spacing-xs) var(--spacing-md);
        border-bottom: 1px solid var(--color-border);
        margin-bottom: var(--spacing-xs);
      }

      .context-menu-oid {
        font-family: var(--font-family-mono);
        font-size: var(--font-size-xs);
        color: var(--color-primary);
        margin-right: var(--spacing-sm);
      }

      .context-menu-summary {
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: block;
        margin-top: 2px;
      }

      .context-menu-divider {
        height: 1px;
        background: var(--color-border);
        margin: var(--spacing-xs) 0;
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

      .context-menu-item.danger:hover {
        background: var(--color-error-bg);
      }

      .context-menu-submenu {
        padding: var(--spacing-xs) 0;
      }

      .context-menu-label {
        display: block;
        padding: var(--spacing-xs) var(--spacing-md);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        font-weight: var(--font-weight-medium);
      }

      /* Blame view uses the same diff-area styling */
    `,
  ];

  @state() private activeRepository: OpenRepository | null = null;
  @state() private selectedCommit: Commit | null = null;
  @state() private selectedCommitRefs: RefInfo[] = [];

  // Diff view state
  @state() private showDiff = false;
  @state() private diffFile: StatusEntry | null = null;
  @state() private diffCommitFile: { commitOid: string; filePath: string } | null = null;

  // Blame view state
  @state() private showBlame = false;
  @state() private blameFile: string | null = null;
  @state() private blameCommitOid: string | null = null;

  // Settings dialog
  @state() private showSettings = false;

  // Search/filter
  @state() private searchFilter: SearchFilter | null = null;

  // Commit context menu
  @state() private contextMenu: {
    visible: boolean;
    x: number;
    y: number;
    commit: Commit | null;
  } = { visible: false, x: 0, y: 0, commit: null };

  // Conflict resolution dialog
  @state() private showConflictDialog = false;
  @state() private conflictOperationType: 'merge' | 'rebase' | 'cherry-pick' | 'revert' = 'merge';

  // Command palette
  @state() private showCommandPalette = false;
  @state() private branches: Branch[] = [];

  // File history
  @state() private showFileHistory = false;
  @state() private fileHistoryPath: string | null = null;

  // Reflog dialog
  @state() private showReflog = false;

  // Keyboard shortcuts dialog
  @state() private showShortcuts = false;
  @state() private vimMode = false;

  // Remote management dialog
  @state() private showRemotes = false;

  // Clean dialog
  @state() private showClean = false;

  // Bisect dialog
  @state() private showBisect = false;

  // Submodule dialog
  @state() private showSubmodules = false;

  // Worktree dialog
  @state() private showWorktrees = false;

  // LFS dialog
  @state() private showLfs = false;

  // GPG dialog
  @state() private showGpg = false;

  // SSH dialog
  @state() private showSsh = false;

  // Config dialog
  @state() private showConfig = false;

  // Credentials dialog
  @state() private showCredentials = false;

  // GitHub dialog
  @state() private showGitHub = false;

  // GitLab dialog
  @state() private showGitLab = false;

  // Bitbucket dialog
  @state() private showBitbucket = false;

  // Azure DevOps dialog
  @state() private showAzureDevOps = false;

  // Profile Manager dialog
  @state() private showProfileManager = false;

  // Migration dialog
  @state() private showMigrationDialog = false;

  // Panel dimensions
  @state() private leftPanelWidth = 220;
  @state() private rightPanelWidth = 350;

  // Panel visibility
  @state() private leftPanelVisible = true;
  @state() private rightPanelVisible = true;

  // Resize state
  private resizing: 'left' | 'right' | null = null;
  private resizeStartPos = 0;
  private resizeStartValue = 0;

  @query('lv-graph-canvas') private graphCanvas?: LvGraphCanvas;

  private unsubscribe?: () => void;
  private unsubscribeUi?: () => void;
  private updateUnlisteners: UnlistenFn[] = [];
  private shownIntegrationSuggestions: Set<string> = new Set();
  private isRestoringRepositories = false;

  // Bound event handlers for cleanup
  private boundHandleMouseMove = this.handleResizeMove.bind(this);
  private boundHandleMouseUp = this.handleResizeEnd.bind(this);

  private boundHandleKeyDown = this.handleKeyDown.bind(this);

  // Prevent browser default context menu globally
  private handleContextMenu = (e: MouseEvent): void => {
    // Allow context menu in text inputs/textareas for copy/paste
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }
    e.preventDefault();
  };

  // Handle repository-refresh events from window (e.g., after commit)
  private handleWindowRefresh = (): void => {
    this.graphCanvas?.refresh?.();
  };

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = repositoryStore.subscribe((state) => {
      const newActiveRepo = state.getActiveRepository();
      const repoChanged = this.activeRepository?.repository.path !== newActiveRepo?.repository.path;
      this.activeRepository = newActiveRepo;

      // Clear view state when switching repositories
      if (repoChanged) {
        // Clear selected commit and refs
        this.selectedCommit = null;
        this.selectedCommitRefs = [];

        // Close any open overlays
        this.showDiff = false;
        this.diffFile = null;
        this.diffCommitFile = null;
        this.showBlame = false;
        this.blameFile = null;
        this.blameCommitOid = null;
        this.showFileHistory = false;
        this.fileHistoryPath = null;

        // Clear search filter
        this.searchFilter = null;

        // Load profile for new repository and check integration
        if (newActiveRepo) {
          gitService.loadProfileForRepository(newActiveRepo.repository.path);
          // Only check integration if not restoring repos on startup
          if (!this.isRestoringRepositories) {
            this.checkRepositoryIntegration(newActiveRepo.repository.path);
          }
          // Load remotes if not already loaded
          if (!newActiveRepo.remotes || newActiveRepo.remotes.length === 0) {
            this.loadRepositoryRemotes(newActiveRepo.repository.path);
          }
        }
      }
    });
    this.unsubscribeUi = uiStore.subscribe((state) => {
      this.leftPanelVisible = state.panels.left.isVisible;
      this.rightPanelVisible = state.panels.right.isVisible;
    });
    document.addEventListener('keydown', this.boundHandleKeyDown);
    document.addEventListener('click', this.handleDocumentClick);
    document.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('repository-refresh', this.handleWindowRefresh);

    // Load vim mode from keyboard service
    this.vimMode = keyboardService.isVimMode();

    // Set up remote operation event listeners (for auto-fetch notifications)
    gitService.setupRemoteOperationListeners();

    // Load profiles
    gitService.loadProfiles();

    // Check for unified profiles migration
    this.checkUnifiedProfilesMigration();

    // Start periodic token validation for integration accounts
    unifiedProfileService.startPeriodicTokenValidation();

    // Restore previously open repositories
    this.restorePersistedRepositories();

    // Set up update notification listeners
    this.setupUpdateListeners();

    // Initialize OAuth deep link listener
    initOAuthListener().catch((e) => {
      log.warn('Failed to initialize OAuth listener:', e);
    });

    // Register keyboard shortcuts
    registerDefaultShortcuts({
      navigateUp: () => this.graphCanvas?.navigatePrevious?.(),
      navigateDown: () => this.graphCanvas?.navigateNext?.(),
      navigateFirst: () => this.graphCanvas?.navigateFirst?.(),
      navigateLast: () => this.graphCanvas?.navigateLast?.(),
      pageUp: () => this.graphCanvas?.navigatePageUp?.(),
      pageDown: () => this.graphCanvas?.navigatePageDown?.(),
      selectCommit: () => {/* handled by graph canvas */},
      stageAll: () => this.handleStageAll(),
      unstageAll: () => this.handleUnstageAll(),
      commit: () => {/* handled by commit panel */},
      refresh: () => this.handleRefresh(),
      search: () => this.handleToggleSearch(),
      openSettings: () => { this.showSettings = true; },
      openShortcuts: () => { this.showShortcuts = true; },
      toggleLeftPanel: () => uiStore.getState().togglePanel('left'),
      toggleRightPanel: () => uiStore.getState().togglePanel('right'),
      openCommandPalette: () => this.openCommandPalette(),
      openReflog: () => { this.showReflog = true; },
      fetch: () => this.handleFetch(),
      pull: () => this.handlePull(),
      push: () => this.handlePush(),
      createStash: () => this.handleCreateStash(),
      closeDiff: () => this.handleCloseOverlay(),
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribeUi?.();
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);
    document.removeEventListener('keydown', this.boundHandleKeyDown);
    document.removeEventListener('click', this.handleDocumentClick);
    document.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('repository-refresh', this.handleWindowRefresh);
    gitService.cleanupRemoteOperationListeners();
    // Stop periodic token validation
    unifiedProfileService.stopPeriodicTokenValidation();
    // Clean up update listeners
    this.updateUnlisteners.forEach((unlisten) => unlisten());
    this.updateUnlisteners = [];
  }

  private async checkUnifiedProfilesMigration(): Promise<void> {
    try {
      // Initialize unified profiles - this loads profiles and checks migration
      await unifiedProfileService.initializeUnifiedProfiles();

      // Check if migration is still needed (user hasn't migrated yet)
      const needsMigration = await unifiedProfileService.checkMigrationNeeded();
      if (needsMigration) {
        // Show migration dialog after a short delay to let the UI settle
        setTimeout(() => {
          this.showMigrationDialog = true;
        }, 500);
      }
    } catch (error) {
      log.error('Failed to initialize unified profiles:', error);
    }
  }

  private async setupUpdateListeners(): Promise<void> {
    // Update available - show notification
    const unlistenAvailable = await updateService.onUpdateAvailable((event) => {
      showToast(
        `Update available: v${event.latestVersion}`,
        'info',
        10000
      );
    });
    this.updateUnlisteners.push(unlistenAvailable);

    // Update downloading
    const unlistenDownloading = await updateService.onUpdateDownloading(() => {
      showToast('Downloading update...', 'info', 5000);
    });
    this.updateUnlisteners.push(unlistenDownloading);

    // Update ready - will restart
    const unlistenReady = await updateService.onUpdateReady(() => {
      showToast('Update installed - restarting...', 'success', 3000);
    });
    this.updateUnlisteners.push(unlistenReady);

    // Update error
    const unlistenError = await updateService.onUpdateError((error) => {
      showToast(`Update failed: ${error.message}`, 'error', 8000);
    });
    this.updateUnlisteners.push(unlistenError);
  }

  /**
   * Check if repository has integration configured and suggest if not
   */
  private async checkRepositoryIntegration(repoPath: string): Promise<void> {
    // Don't check the same repo twice - add immediately to prevent race conditions
    if (this.shownIntegrationSuggestions.has(repoPath)) {
      return;
    }
    this.shownIntegrationSuggestions.add(repoPath);

    try {
      const suggestion = await gitService.detectRepositoryIntegration(repoPath);

      if (suggestion && !suggestion.isConfigured) {
        const features = suggestion.features.slice(0, 2).join(', ');
        showToast(
          `${suggestion.providerName} repository detected. Connect to enable ${features}.`,
          'info',
          12000,
          {
            label: 'Configure',
            callback: () => this.openIntegrationDialog(suggestion.provider),
          }
        );
      }
    } catch {
      // Silently fail - this is a nice-to-have feature
    }
  }

  private openIntegrationDialog(provider: string | null): void {
    switch (provider) {
      case 'github':
        this.showGitHub = true;
        break;
      case 'gitlab':
        this.showGitLab = true;
        break;
      case 'bitbucket':
        this.showBitbucket = true;
        break;
      case 'ado':
        this.showAzureDevOps = true;
        break;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Keyboard shortcuts are now handled by the keyboard service
    // Only handle special cases here

    // ? to show shortcuts help (need to handle separately due to shift key)
    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      this.showShortcuts = true;
      return;
    }
  }

  private handleCloseOverlay(): void {
    // Close any open overlay in priority order
    if (this.showShortcuts) {
      this.showShortcuts = false;
    } else if (this.showCommandPalette) {
      this.showCommandPalette = false;
    } else if (this.showReflog) {
      this.showReflog = false;
    } else if (this.contextMenu.visible) {
      this.contextMenu = { ...this.contextMenu, visible: false };
    } else if (this.showDiff) {
      this.handleCloseDiff();
    } else if (this.showBlame) {
      this.handleCloseBlame();
    } else if (this.showFileHistory) {
      this.handleCloseFileHistory();
    }
  }

  private handleDocumentClick = (): void => {
    if (this.contextMenu.visible) {
      this.contextMenu = { ...this.contextMenu, visible: false };
    }
  };

  private handleCommitContextMenu(e: CustomEvent): void {
    const { commit, position } = e.detail as {
      commit: Commit;
      refs: RefInfo[];
      position: { x: number; y: number };
    };

    this.contextMenu = {
      visible: true,
      x: position.x,
      y: position.y,
      commit,
    };
  }

  private async handleCherryPick(): Promise<void> {
    const commit = this.contextMenu.commit;
    if (!commit || !this.activeRepository) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    const result = await import('./services/git.service.ts').then((m) =>
      m.cherryPick({
        path: this.activeRepository!.repository.path,
        commit_oid: commit.oid,
      })
    );

    if (result.success) {
      this.graphCanvas?.refresh?.();
    } else if (result.error?.code === 'CHERRY_PICK_CONFLICT') {
      // Show conflict resolution dialog
      this.conflictOperationType = 'cherry-pick';
      this.showConflictDialog = true;
    } else {
      log.error('Cherry-pick failed:', result.error);
      showToast(result.error?.message || 'Cherry-pick failed', 'error');
    }
  }

  private async handleRevertCommit(): Promise<void> {
    const commit = this.contextMenu.commit;
    if (!commit || !this.activeRepository) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    const result = await import('./services/git.service.ts').then((m) =>
      m.revert({
        path: this.activeRepository!.repository.path,
        commit_oid: commit.oid,
      })
    );

    if (result.success) {
      this.graphCanvas?.refresh?.();
    } else if (result.error?.code === 'REVERT_CONFLICT') {
      // Show conflict resolution dialog
      this.conflictOperationType = 'revert';
      this.showConflictDialog = true;
    } else {
      log.error('Revert failed:', result.error);
      showToast(result.error?.message || 'Revert failed', 'error');
    }
  }

  private async handleResetToCommit(mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    const commit = this.contextMenu.commit;
    if (!commit || !this.activeRepository) return;

    this.contextMenu = { ...this.contextMenu, visible: false };

    // Confirm for hard reset
    if (mode === 'hard') {
      const confirmed = confirm(
        `Are you sure you want to hard reset to "${commit.summary}"?\n\nThis will discard all uncommitted changes.`
      );
      if (!confirmed) return;
    }

    const result = await import('./services/git.service.ts').then((m) =>
      m.reset({
        path: this.activeRepository!.repository.path,
        target_ref: commit.oid,
        mode,
      })
    );

    if (result.success) {
      this.graphCanvas?.refresh?.();
    } else {
      log.error('Reset failed:', result.error);
      showToast(result.error?.message || 'Reset failed', 'error');
    }
  }

  private handleConflictResolved(): void {
    this.showConflictDialog = false;
    this.graphCanvas?.refresh?.();
  }

  private handleConflictAborted(): void {
    this.showConflictDialog = false;
    this.graphCanvas?.refresh?.();
  }

  private handleResizeStart(e: MouseEvent, type: 'left' | 'right'): void {
    e.preventDefault();
    this.resizing = type;
    this.resizeStartPos = e.clientX;
    this.resizeStartValue = type === 'left' ? this.leftPanelWidth : this.rightPanelWidth;
    this.classList.add('resizing', 'resizing-h');

    document.addEventListener('mousemove', this.boundHandleMouseMove);
    document.addEventListener('mouseup', this.boundHandleMouseUp);
  }

  private handleResizeMove(e: MouseEvent): void {
    if (!this.resizing) return;

    const delta = e.clientX - this.resizeStartPos;
    if (this.resizing === 'left') {
      const newWidth = Math.max(150, Math.min(400, this.resizeStartValue + delta));
      this.leftPanelWidth = newWidth;
    } else {
      const newWidth = Math.max(280, Math.min(600, this.resizeStartValue - delta));
      this.rightPanelWidth = newWidth;
    }
  }

  private handleResizeEnd(): void {
    this.resizing = null;
    this.classList.remove('resizing', 'resizing-h');
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);
  }

  private handleCommitSelected(e: CustomEvent<CommitSelectedEvent>): void {
    this.selectedCommit = e.detail.commit;
    this.selectedCommitRefs = e.detail.refs;
  }

  private handleSelectCommit(e: CustomEvent<{ oid: string }>): void {
    this.graphCanvas?.selectCommit(e.detail.oid);
  }

  private async handleCheckoutBranchFromGraph(e: CustomEvent<{ branchName: string }>): Promise<void> {
    if (!this.activeRepository) return;

    const branchName = e.detail.branchName;
    const result = await gitService.checkout(this.activeRepository.repository.path, { ref: branchName });

    if (result.success) {
      this.handleRefresh();
    } else {
      log.error('Failed to checkout branch:', result.error);
      showToast(result.error?.message || 'Failed to checkout branch', 'error');
    }
  }

  private handleCopySha(e: CustomEvent<{ sha: string }>): void {
    // Show brief feedback that SHA was copied
    log.debug(`Copied ${e.detail.sha} to clipboard`);
  }

  private handleFileSelected(e: CustomEvent<{ file: StatusEntry }>): void {
    // Close blame if open
    this.showBlame = false;
    this.blameFile = null;
    this.blameCommitOid = null;
    // Working directory file selected - show diff
    this.diffFile = e.detail.file;
    this.diffCommitFile = null;
    this.showDiff = true;
  }

  private handleCommitFileSelected(e: CustomEvent<{ commitOid: string; filePath: string }>): void {
    // Close blame if open
    this.showBlame = false;
    this.blameFile = null;
    this.blameCommitOid = null;
    // Commit file selected - show diff
    this.diffCommitFile = {
      commitOid: e.detail.commitOid,
      filePath: e.detail.filePath,
    };
    this.diffFile = null;
    this.showDiff = true;
  }

  private handleCloseDiff(): void {
    this.showDiff = false;
    this.diffFile = null;
    this.diffCommitFile = null;
  }

  private handleTagSelected(e: CustomEvent<{ tag: Tag }>): void {
    const tag = e.detail.tag;
    if (tag.targetOid) {
      this.graphCanvas?.selectCommit(tag.targetOid);
    }
  }

  private handleBranchSelected(e: CustomEvent<{ branch: Branch }>): void {
    const branch = e.detail.branch;
    if (branch.targetOid) {
      this.graphCanvas?.selectCommit(branch.targetOid);
    }
  }

  private getDiffTitle(): string {
    if (this.diffFile) {
      return this.diffFile.isStaged ? 'Staged Changes' : 'Working Changes';
    }
    if (this.diffCommitFile) {
      return `Commit ${this.diffCommitFile.commitOid.substring(0, 7)}`;
    }
    return 'Diff';
  }

  private getDiffPath(): string {
    if (this.diffFile) {
      return this.diffFile.path;
    }
    if (this.diffCommitFile) {
      return this.diffCommitFile.filePath;
    }
    return '';
  }

  private handleStageAll(): void {
    window.dispatchEvent(new CustomEvent('stage-all'));
  }

  private handleUnstageAll(): void {
    window.dispatchEvent(new CustomEvent('unstage-all'));
  }

  private handleRefresh(): void {
    // Trigger refresh of the graph
    this.graphCanvas?.refresh?.();
    // Dispatch event for other components (like context dashboard) to update
    window.dispatchEvent(new CustomEvent('repository-refresh'));
  }

  private async handleRefreshAccount(e: CustomEvent<{ accountId: string }>): Promise<void> {
    const { accountId } = e.detail;
    try {
      const account = await unifiedProfileService.getGlobalAccount(accountId);
      if (account) {
        await unifiedProfileService.refreshAccountCachedUser(account);
      }
    } catch (error) {
      log.error('Failed to refresh account', error);
      showToast('Failed to refresh account connection', 'error');
    }
  }

  private handleToggleSearch(): void {
    const toolbar = this.shadowRoot?.querySelector('lv-toolbar');
    if (toolbar) {
      (toolbar as HTMLElement).dispatchEvent(new CustomEvent('focus-search'));
    }
  }

  private handleCloseSettings(): void {
    this.showSettings = false;
  }

  private handleBlameCommitClick(e: CustomEvent<{ oid: string }>): void {
    this.showBlame = false;
    this.graphCanvas?.selectCommit(e.detail.oid);
  }

  private handleCloseBlame(): void {
    this.showBlame = false;
    this.blameFile = null;
    this.blameCommitOid = null;
  }

  private handleShowBlame(e: CustomEvent<{ filePath: string; commitOid?: string }>): void {
    // Close diff if open
    this.showDiff = false;
    this.diffFile = null;
    this.diffCommitFile = null;
    // Open blame
    this.blameFile = e.detail.filePath;
    this.blameCommitOid = e.detail.commitOid ?? null;
    this.showBlame = true;
  }

  private handleSearchChange(e: CustomEvent<{ filter: SearchFilter }>): void {
    this.searchFilter = e.detail.filter;
    // Pass filter to graph canvas
    if (this.graphCanvas) {
      this.graphCanvas.searchFilter = this.searchFilter;
    }
  }

  private async openCommandPalette(): Promise<void> {
    // Fetch branches for quick switching
    if (this.activeRepository) {
      const result = await gitService.getBranches(this.activeRepository.repository.path);
      if (result.success && result.data) {
        this.branches = result.data;
      }
    }
    this.showCommandPalette = true;
  }

  private requiresRepository(action: () => void): () => void {
    return () => {
      if (!this.activeRepository) {
        uiStore.getState().addToast({
          type: 'warning',
          message: 'Please open a repository first',
          duration: 3000,
        });
        return;
      }
      action();
    };
  }

  private getPaletteCommands(): PaletteCommand[] {
    const isMac = navigator.platform.includes('Mac');
    const mod = isMac ? '⌘' : 'Ctrl';

    const commands: PaletteCommand[] = [
      {
        id: 'fetch',
        label: 'Fetch from remote',
        category: 'action',
        icon: 'fetch',
        action: () => this.handleFetch(),
      },
      {
        id: 'pull',
        label: 'Pull from remote',
        category: 'action',
        icon: 'pull',
        action: () => this.handlePull(),
      },
      {
        id: 'push',
        label: 'Push to remote',
        category: 'action',
        icon: 'push',
        action: () => this.handlePush(),
      },
      {
        id: 'refresh',
        label: 'Refresh repository',
        category: 'action',
        icon: 'refresh',
        shortcut: `${mod}R`,
        action: () => this.handleRefresh(),
      },
      {
        id: 'stash',
        label: 'Create stash',
        category: 'action',
        icon: 'stash',
        action: () => this.handleCreateStash(),
      },
      {
        id: 'settings',
        label: 'Open settings',
        category: 'action',
        icon: 'settings',
        shortcut: `${mod},`,
        action: () => { this.showSettings = true; },
      },
      {
        id: 'remotes',
        label: 'Manage remotes',
        category: 'action',
        icon: 'globe',
        action: this.requiresRepository(() => { this.showRemotes = true; }),
      },
      {
        id: 'clean',
        label: 'Clean working directory',
        category: 'action',
        icon: 'trash',
        action: this.requiresRepository(() => { this.showClean = true; }),
      },
      {
        id: 'bisect',
        label: 'Start bisect (find bug)',
        category: 'action',
        icon: 'search',
        action: this.requiresRepository(() => { this.showBisect = true; }),
      },
      {
        id: 'submodules',
        label: 'Manage submodules',
        category: 'action',
        icon: 'folder',
        action: this.requiresRepository(() => { this.showSubmodules = true; }),
      },
      {
        id: 'worktrees',
        label: 'Manage worktrees',
        category: 'action',
        icon: 'folder',
        action: this.requiresRepository(() => { this.showWorktrees = true; }),
      },
      {
        id: 'lfs',
        label: 'Manage Git LFS',
        category: 'action',
        icon: 'folder',
        action: this.requiresRepository(() => { this.showLfs = true; }),
      },
      {
        id: 'gpg',
        label: 'GPG Signing Settings',
        category: 'action',
        icon: 'key',
        action: this.requiresRepository(() => { this.showGpg = true; }),
      },
      {
        id: 'ssh',
        label: 'SSH Key Management',
        category: 'action',
        icon: 'key',
        action: () => { this.showSsh = true; },
      },
      {
        id: 'config',
        label: 'Git Configuration',
        category: 'action',
        icon: 'settings',
        action: this.requiresRepository(() => { this.showConfig = true; }),
      },
      {
        id: 'credentials',
        label: 'Credential Management',
        category: 'action',
        icon: 'key',
        action: this.requiresRepository(() => { this.showCredentials = true; }),
      },
      {
        id: 'github',
        label: 'GitHub Integration',
        category: 'action',
        icon: 'github',
        action: this.requiresRepository(() => { this.showGitHub = true; }),
      },
      {
        id: 'gitlab',
        label: 'GitLab Integration',
        category: 'action',
        icon: 'gitlab',
        action: this.requiresRepository(() => { this.showGitLab = true; }),
      },
      {
        id: 'bitbucket',
        label: 'Bitbucket Integration',
        category: 'action',
        icon: 'bitbucket',
        action: this.requiresRepository(() => { this.showBitbucket = true; }),
      },
      {
        id: 'azure-devops',
        label: 'Azure DevOps Integration',
        category: 'action',
        icon: 'azure',
        action: this.requiresRepository(() => { this.showAzureDevOps = true; }),
      },
      {
        id: 'profiles',
        label: 'Git Profiles',
        category: 'action',
        icon: 'user',
        action: () => { this.showProfileManager = true; },
      },
      {
        id: 'search',
        label: 'Search commits',
        category: 'action',
        icon: 'search',
        shortcut: `${mod}F`,
        action: () => this.handleToggleSearch(),
      },
      {
        id: 'stage-all',
        label: 'Stage all changes',
        category: 'action',
        icon: 'commit',
        action: () => this.handleStageAll(),
      },
      {
        id: 'unstage-all',
        label: 'Unstage all changes',
        category: 'action',
        icon: 'commit',
        action: () => this.handleUnstageAll(),
      },
      {
        id: 'toggle-left-panel',
        label: 'Toggle left panel',
        category: 'navigation',
        shortcut: `${mod}B`,
        action: () => uiStore.getState().togglePanel('left'),
      },
      {
        id: 'toggle-right-panel',
        label: 'Toggle right panel',
        category: 'navigation',
        shortcut: `${mod}J`,
        action: () => uiStore.getState().togglePanel('right'),
      },
      {
        id: 'undo',
        label: 'Undo (open reflog)',
        category: 'action',
        icon: 'refresh',
        shortcut: `${mod}Z`,
        action: this.requiresRepository(() => { this.showReflog = true; }),
      },
    ];

    return commands;
  }

  private async restorePersistedRepositories(): Promise<void> {
    const persistedRepos = repositoryStore.getState().getPersistedOpenRepos();
    if (persistedRepos.length === 0) return;

    // Set flag to prevent duplicate notifications during restore
    this.isRestoringRepositories = true;

    // Open each persisted repository
    for (const persisted of persistedRepos) {
      try {
        const result = await gitService.openRepository({ path: persisted.path });
        if (result.success && result.data) {
          repositoryStore.getState().addRepository(result.data);
          // Load remotes for this repository
          await this.loadRepositoryRemotes(persisted.path);
        }
      } catch (error) {
        console.warn(`Failed to restore repository: ${persisted.path}`, error);
      }
    }

    // Restore active index (already persisted, will be set from storage)
    this.isRestoringRepositories = false;

    // Check integration for the final active repo only
    const activeRepo = repositoryStore.getState().getActiveRepository();
    if (activeRepo) {
      this.checkRepositoryIntegration(activeRepo.repository.path);
    }
  }

  /**
   * Load remotes for a repository and update the store
   */
  private async loadRepositoryRemotes(repoPath: string): Promise<void> {
    try {
      const remotesResult = await gitService.getRemotes(repoPath);
      if (remotesResult.success && remotesResult.data) {
        // Need to set active index to the repo first, then set remotes
        const store = repositoryStore.getState();
        const repoIndex = store.openRepositories.findIndex(r => r.repository.path === repoPath);
        if (repoIndex >= 0) {
          const currentIndex = store.activeIndex;
          store.setActiveIndex(repoIndex);
          store.setRemotes(remotesResult.data);
          // Restore active index if different
          if (currentIndex !== repoIndex && currentIndex >= 0) {
            store.setActiveIndex(currentIndex);
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to load remotes for ${repoPath}:`, error);
    }
  }

  private async handleFetch(): Promise<void> {
    if (!this.activeRepository) return;
    await gitService.fetch({ path: this.activeRepository.repository.path });
    this.handleRefresh();
  }

  private async handlePull(): Promise<void> {
    if (!this.activeRepository) return;
    await gitService.pull({ path: this.activeRepository.repository.path });
    this.handleRefresh();
  }

  private async handlePush(): Promise<void> {
    if (!this.activeRepository) return;
    await gitService.push({ path: this.activeRepository.repository.path });
    this.handleRefresh();
  }

  private async handleCreateStash(): Promise<void> {
    if (!this.activeRepository) return;
    await gitService.createStash({ path: this.activeRepository.repository.path });
    this.handleRefresh();
  }

  private async handleCheckoutBranch(e: CustomEvent<{ branch: string }>): Promise<void> {
    if (!this.activeRepository) return;
    await gitService.checkout(this.activeRepository.repository.path, { ref: e.detail.branch });
    this.handleRefresh();
  }

  private handleShowFileHistory(e: CustomEvent<{ filePath: string }>): void {
    this.fileHistoryPath = e.detail.filePath;
    this.showFileHistory = true;
  }

  private handleCloseFileHistory(): void {
    this.showFileHistory = false;
    this.fileHistoryPath = null;
  }

  private handleFileHistoryCommitSelected(e: CustomEvent<{ commit: Commit }>): void {
    // Select the commit in the graph
    this.selectedCommit = e.detail.commit;
  }

  private handleFileHistoryViewDiff(e: CustomEvent<{ commitOid: string; filePath: string }>): void {
    // Open the diff view for this file at the specific commit
    this.diffCommitFile = {
      commitOid: e.detail.commitOid,
      filePath: e.detail.filePath,
    };
    this.showDiff = true;
  }

  private handleVimModeChange(e: CustomEvent<{ enabled: boolean }>): void {
    this.vimMode = e.detail.enabled;
    keyboardService.setVimMode(e.detail.enabled);
  }

  render() {
    return html`
      <lv-toolbar
        @open-settings=${() => { this.showSettings = true; }}
        @open-shortcuts=${() => { this.showShortcuts = true; }}
        @open-command-palette=${() => { this.showCommandPalette = true; }}
        @open-profile-manager=${() => { this.showProfileManager = true; }}
        @repository-refresh=${() => this.handleRefresh()}
      ></lv-toolbar>

      ${this.activeRepository
        ? html`
            <lv-context-dashboard
              @open-profile-manager=${() => { this.showProfileManager = true; }}
              @open-github=${() => { this.showGitHub = true; }}
              @open-gitlab=${() => { this.showGitLab = true; }}
              @open-bitbucket=${() => { this.showBitbucket = true; }}
              @open-azure-devops=${() => { this.showAzureDevOps = true; }}
              @refresh-account=${this.handleRefreshAccount}
              @repository-refresh=${() => this.handleRefresh()}
            ></lv-context-dashboard>

            <div class="main-content">
              ${this.leftPanelVisible ? html`
                <aside
                  class="left-panel"
                  style="width: ${this.leftPanelWidth}px"
                  @tag-selected=${this.handleTagSelected}
                  @branch-selected=${this.handleBranchSelected}
                  @repository-changed=${() => this.handleRefresh()}
                >
                  <lv-left-panel></lv-left-panel>
                </aside>

                <div
                  class="resize-handle-h ${this.resizing === 'left' ? 'dragging' : ''}"
                  @mousedown=${(e: MouseEvent) => this.handleResizeStart(e, 'left')}
                ></div>
              ` : ''}

              <main class="center-panel">
                <div class="graph-area">
                  <lv-graph-canvas
                    repositoryPath=${this.activeRepository.repository.path}
                    @commit-selected=${this.handleCommitSelected}
                    @commit-context-menu=${this.handleCommitContextMenu}
                    @checkout-branch=${this.handleCheckoutBranchFromGraph}
                    @copy-sha=${this.handleCopySha}
                  ></lv-graph-canvas>
                </div>

                ${this.showDiff
                  ? html`
                      <div class="diff-area">
                        <div class="diff-header">
                          <div class="diff-header-left">
                            <span class="diff-title">${this.getDiffTitle()}</span>
                            <span class="diff-path" title="${this.getDiffPath()}">${this.getDiffPath()}</span>
                          </div>
                          <button
                            class="diff-close-btn"
                            @click=${this.handleCloseDiff}
                            title="Close diff (Esc)"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                              <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                          </button>
                        </div>
                        <div class="diff-content">
                          <lv-diff-view
                            .repositoryPath=${this.activeRepository.repository.path}
                            .file=${this.diffFile}
                            .commitFile=${this.diffCommitFile}
                          ></lv-diff-view>
                        </div>
                      </div>
                    `
                  : this.showBlame && this.blameFile
                    ? html`
                        <div class="diff-area">
                          <lv-blame-view
                            .repositoryPath=${this.activeRepository.repository.path}
                            .filePath=${this.blameFile}
                            .commitOid=${this.blameCommitOid}
                            @close=${this.handleCloseBlame}
                            @commit-click=${this.handleBlameCommitClick}
                          ></lv-blame-view>
                        </div>
                      `
                    : this.showFileHistory && this.fileHistoryPath
                      ? html`
                          <div class="diff-area">
                            <lv-file-history
                              .repositoryPath=${this.activeRepository.repository.path}
                              .filePath=${this.fileHistoryPath}
                              @close=${this.handleCloseFileHistory}
                              @commit-selected=${this.handleFileHistoryCommitSelected}
                              @view-diff=${this.handleFileHistoryViewDiff}
                            ></lv-file-history>
                          </div>
                        `
                      : ''}
              </main>

              ${this.rightPanelVisible ? html`
                <div
                  class="resize-handle-h ${this.resizing === 'right' ? 'dragging' : ''}"
                  @mousedown=${(e: MouseEvent) => this.handleResizeStart(e, 'right')}
                ></div>

                <aside
                  class="right-panel"
                  style="width: ${this.rightPanelWidth}px"
                  @file-selected=${this.handleFileSelected}
                  @select-commit=${this.handleSelectCommit}
                  @commit-file-selected=${this.handleCommitFileSelected}
                  @show-blame=${this.handleShowBlame}
                  @show-file-history=${this.handleShowFileHistory}
                  @repository-changed=${() => this.handleRefresh()}
                >
                  <lv-right-panel
                    .commit=${this.selectedCommit}
                    .refs=${this.selectedCommitRefs}
                    @open-settings=${() => { this.showSettings = true; }}
                  ></lv-right-panel>
                </aside>
              ` : ''}
            </div>

            <footer class="status-bar">
              <span>${this.activeRepository.repository.path}</span>
            </footer>
          `
        : html`<lv-welcome></lv-welcome>`}

      ${this.showSettings
        ? html`
            <lv-modal
              open
              modalTitle="Settings"
              @close=${this.handleCloseSettings}
            >
              <lv-settings-dialog
                @close=${this.handleCloseSettings}
              ></lv-settings-dialog>
            </lv-modal>
          `
        : ''}

      ${this.showConflictDialog && this.activeRepository
        ? html`
            <lv-conflict-resolution-dialog
              open
              repositoryPath=${this.activeRepository.repository.path}
              operationType=${this.conflictOperationType}
              @operation-completed=${this.handleConflictResolved}
              @operation-aborted=${this.handleConflictAborted}
            ></lv-conflict-resolution-dialog>
          `
        : ''}

      ${this.contextMenu.visible && this.contextMenu.commit
        ? html`
            <div
              class="context-menu"
              style="left: ${this.contextMenu.x}px; top: ${this.contextMenu.y}px;"
              @click=${(e: Event) => e.stopPropagation()}
            >
              <div class="context-menu-header">
                <span class="context-menu-oid">${this.contextMenu.commit.oid.substring(0, 7)}</span>
                <span class="context-menu-summary">${this.contextMenu.commit.summary}</span>
              </div>
              <div class="context-menu-divider"></div>
              <button class="context-menu-item" @click=${this.handleCherryPick}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z"/>
                  <path d="M8 5v6M5 8h6" stroke="currentColor" stroke-width="1.5" fill="none"/>
                </svg>
                Cherry-pick
              </button>
              <button class="context-menu-item" @click=${this.handleRevertCommit}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0zM8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3z"/>
                  <path d="M8 4v4l3 2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
                </svg>
                Revert
              </button>
              <div class="context-menu-divider"></div>
              <div class="context-menu-submenu">
                <span class="context-menu-label">Reset to this commit</span>
                <button class="context-menu-item" @click=${() => this.handleResetToCommit('soft')}>
                  Soft (keep changes staged)
                </button>
                <button class="context-menu-item" @click=${() => this.handleResetToCommit('mixed')}>
                  Mixed (keep changes unstaged)
                </button>
                <button class="context-menu-item danger" @click=${() => this.handleResetToCommit('hard')}>
                  Hard (discard all changes)
                </button>
              </div>
            </div>
          `
        : ''}

      <lv-command-palette
        ?open=${this.showCommandPalette}
        .commands=${this.getPaletteCommands()}
        .branches=${this.branches}
        @close=${() => { this.showCommandPalette = false; }}
        @checkout-branch=${this.handleCheckoutBranch}
      ></lv-command-palette>

      ${this.activeRepository ? html`
        <lv-reflog-dialog
          ?open=${this.showReflog}
          .repositoryPath=${this.activeRepository.repository.path}
          @close=${() => { this.showReflog = false; }}
          @undo-complete=${() => { this.showReflog = false; this.handleRefresh(); }}
        ></lv-reflog-dialog>
      ` : ''}

      <lv-keyboard-shortcuts-dialog
        ?open=${this.showShortcuts}
        ?vimMode=${this.vimMode}
        @close=${() => { this.showShortcuts = false; }}
        @vim-mode-change=${this.handleVimModeChange}
      ></lv-keyboard-shortcuts-dialog>

      ${this.activeRepository ? html`
        <lv-remote-dialog
          ?open=${this.showRemotes}
          .repositoryPath=${this.activeRepository.repository.path}
          @close=${() => { this.showRemotes = false; }}
          @remotes-changed=${() => this.handleRefresh()}
        ></lv-remote-dialog>
      ` : ''}

      ${this.activeRepository ? html`
        <lv-clean-dialog
          ?open=${this.showClean}
          .repositoryPath=${this.activeRepository.repository.path}
          @close=${() => { this.showClean = false; }}
          @files-cleaned=${() => this.handleRefresh()}
        ></lv-clean-dialog>
      ` : ''}

      ${this.activeRepository ? html`
        <lv-bisect-dialog
          ?open=${this.showBisect}
          .repositoryPath=${this.activeRepository.repository.path}
          @close=${() => { this.showBisect = false; }}
          @bisect-step=${() => this.handleRefresh()}
          @bisect-complete=${() => { this.showBisect = false; this.handleRefresh(); }}
        ></lv-bisect-dialog>
      ` : ''}

      ${this.activeRepository ? html`
        <lv-submodule-dialog
          ?open=${this.showSubmodules}
          .repositoryPath=${this.activeRepository.repository.path}
          @close=${() => { this.showSubmodules = false; }}
          @submodules-changed=${() => this.handleRefresh()}
        ></lv-submodule-dialog>
      ` : ''}

      ${this.activeRepository ? html`
        <lv-worktree-dialog
          ?open=${this.showWorktrees}
          .repositoryPath=${this.activeRepository.repository.path}
          @close=${() => { this.showWorktrees = false; }}
          @worktrees-changed=${() => this.handleRefresh()}
        ></lv-worktree-dialog>
      ` : ''}

      ${this.activeRepository ? html`
        <lv-lfs-dialog
          ?open=${this.showLfs}
          .repositoryPath=${this.activeRepository.repository.path}
          @close=${() => { this.showLfs = false; }}
          @lfs-changed=${() => this.handleRefresh()}
        ></lv-lfs-dialog>
      ` : ''}

      ${this.activeRepository ? html`
        <lv-gpg-dialog
          ?open=${this.showGpg}
          .repositoryPath=${this.activeRepository.repository.path}
          @close=${() => { this.showGpg = false; }}
        ></lv-gpg-dialog>
      ` : ''}

      <lv-ssh-dialog
        ?open=${this.showSsh}
        @close=${() => { this.showSsh = false; }}
      ></lv-ssh-dialog>

      ${this.activeRepository ? html`
        <lv-config-dialog
          ?open=${this.showConfig}
          .repositoryPath=${this.activeRepository.repository.path}
          @close=${() => { this.showConfig = false; }}
        ></lv-config-dialog>
      ` : ''}

      ${this.activeRepository ? html`
        <lv-credentials-dialog
          ?open=${this.showCredentials}
          .repositoryPath=${this.activeRepository.repository.path}
          @close=${() => { this.showCredentials = false; }}
        ></lv-credentials-dialog>
      ` : ''}

      ${this.activeRepository ? html`
        <lv-github-dialog
          ?open=${this.showGitHub}
          .repositoryPath=${this.activeRepository.repository.path}
          @close=${() => { this.showGitHub = false; }}
          @manage-accounts=${() => { this.showProfileManager = true; }}
        ></lv-github-dialog>
      ` : ''}

      ${this.activeRepository ? html`
        <lv-gitlab-dialog
          ?open=${this.showGitLab}
          .repositoryPath=${this.activeRepository.repository.path}
          @close=${() => { this.showGitLab = false; }}
          @manage-accounts=${() => { this.showProfileManager = true; }}
        ></lv-gitlab-dialog>
      ` : ''}

      ${this.activeRepository ? html`
        <lv-bitbucket-dialog
          ?open=${this.showBitbucket}
          .repositoryPath=${this.activeRepository.repository.path}
          @close=${() => { this.showBitbucket = false; }}
          @manage-accounts=${() => { this.showProfileManager = true; }}
        ></lv-bitbucket-dialog>
      ` : ''}

      ${this.activeRepository ? html`
        <lv-azure-devops-dialog
          ?open=${this.showAzureDevOps}
          .repositoryPath=${this.activeRepository.repository.path}
          @close=${() => { this.showAzureDevOps = false; }}
          @manage-accounts=${() => { this.showProfileManager = true; }}
        ></lv-azure-devops-dialog>
      ` : ''}

      <lv-profile-manager-dialog
        ?open=${this.showProfileManager}
        .repoPath=${this.activeRepository?.repository.path ?? ''}
        @close=${() => { this.showProfileManager = false; }}
        @open-github=${() => { this.showProfileManager = false; this.showGitHub = true; }}
        @open-gitlab=${() => { this.showProfileManager = false; this.showGitLab = true; }}
        @open-bitbucket=${() => { this.showProfileManager = false; this.showBitbucket = true; }}
        @open-azure-devops=${() => { this.showProfileManager = false; this.showAzureDevOps = true; }}
      ></lv-profile-manager-dialog>

      <lv-migration-dialog
        ?open=${this.showMigrationDialog}
        @close=${() => { this.showMigrationDialog = false; }}
        @open-profile-manager=${() => { this.showProfileManager = true; }}
      ></lv-migration-dialog>

      <lv-toast-container></lv-toast-container>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-app-shell': AppShell;
  }
}
