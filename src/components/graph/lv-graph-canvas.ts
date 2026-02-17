import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
import { loggers, openExternalUrl } from '../../utils/index.ts';

const log = loggers.graph;
import {
  computeGraphLayout,
  type GraphLayout,
  type LayoutNode,
} from '../../graph/graph-layout.service.ts';
import { type GraphCommit } from '../../graph/lane-assignment.ts';
import { SpatialIndex, type HitTestResult } from '../../graph/spatial-index.ts';
import {
  VirtualScrollManager,
  ScrollStateManager,
  type Viewport,
  type RenderData,
} from '../../graph/virtual-scroll.ts';
import { CanvasRenderer, getThemeFromCSS } from '../../graph/canvas-renderer.ts';
import {
  getCommitHistory,
  getRefsByCommit,
  getCommitsStats,
  getCommitsSignatures,
  searchCommits,
  detectGitHubRepo,
  listPullRequests,
  checkGitHubConnection,
} from '../../services/git.service.ts';
import type { Commit, RefsByCommit, RefInfo } from '../../types/git.types.ts';
import type { GraphPullRequest } from '../../graph/virtual-scroll.ts';
import { searchIndexService } from '../../services/search-index.service.ts';

export interface CommitSelectedEvent {
  commit: Commit | null;
  commits: Commit[]; // All selected commits for multi-select
  refs: RefInfo[];
}

/**
 * Convert a real git Commit to GraphCommit format for graph layout
 */
function commitToGraphCommit(commit: Commit): GraphCommit {
  return {
    oid: commit.oid,
    parentIds: commit.parentIds,
    timestamp: commit.timestamp,
    message: commit.summary,
    author: commit.author.name,
  };
}

/**
 * Optimized Graph Canvas Component
 *
 * High-performance graph visualization with:
 * - Virtual scrolling (only renders visible content)
 * - Spatial index for O(1) hit testing
 * - 60fps rendering with FPS monitoring
 * - Smooth momentum scrolling
 */
@customElement('lv-graph-canvas')
export class LvGraphCanvas extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }

      .container {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--color-bg-primary);
      }

      .canvas-container {
        flex: 1;
        overflow: hidden;
        position: relative;
      }

      canvas {
        display: block;
        position: absolute;
        top: 0;
        left: 0;
        cursor: default;
        outline: none;
        z-index: 2; /* Above scroll container but scrollbar is outside canvas bounds */
      }

      canvas:focus {
        outline: 2px solid var(--color-primary);
        outline-offset: -2px;
      }

      canvas.pointer {
        cursor: pointer;
      }

      .scroll-container {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: 12px;
        overflow-y: scroll;
        overflow-x: hidden;
        z-index: 3; /* Above canvas for scrollbar interaction */
      }

      .scroll-container::-webkit-scrollbar {
        width: 12px;
      }

      .scroll-container::-webkit-scrollbar-track {
        background: var(--color-bg-secondary);
        border-left: 1px solid var(--color-border);
      }

      .scroll-container::-webkit-scrollbar-thumb {
        background: var(--color-text-muted);
        border-radius: 6px;
        border: 3px solid var(--color-bg-secondary);
      }

      .scroll-container::-webkit-scrollbar-thumb:hover {
        background: var(--color-text-secondary);
      }

      .scroll-content {
        position: relative;
      }

      .overlay-canvas {
        position: absolute;
        top: 0;
        left: 0;
        pointer-events: none;
      }

      .info-panel {
        position: absolute;
        bottom: var(--spacing-md);
        left: var(--spacing-md);
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
        max-width: 350px;
        box-shadow: var(--shadow-md);
      }

      .info-panel .oid {
        font-family: var(--font-family-mono);
        color: var(--color-primary);
        font-size: var(--font-size-xs);
      }

      .info-panel .message {
        margin-top: var(--spacing-xs);
        color: var(--color-text-primary);
        font-weight: var(--font-weight-medium);
      }

      .info-panel .meta {
        margin-top: var(--spacing-xs);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
      }

      .avatar-tooltip {
        position: fixed;
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
        box-shadow: var(--shadow-md);
        pointer-events: none;
        z-index: var(--z-tooltip, 1000);
        white-space: nowrap;
        opacity: 0;
        transition: opacity 0.15s ease;
      }

      .avatar-tooltip.visible {
        opacity: 1;
      }

      .avatar-tooltip .author-name {
        font-weight: var(--font-weight-medium);
      }

      .avatar-tooltip .author-email {
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        margin-top: 2px;
      }

      .loading-indicator {
        position: absolute;
        bottom: var(--spacing-md);
        right: calc(var(--spacing-md) + 12px); /* Account for scrollbar */
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        box-shadow: var(--shadow-sm);
        opacity: 0.9;
        z-index: 10;
      }

      .loading-indicator .spinner {
        width: 12px;
        height: 12px;
        border: 2px solid var(--color-border);
        border-top-color: var(--color-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .graph-toolbar {
        position: absolute;
        top: 0;
        right: calc(var(--spacing-md) + 12px);
        height: 28px;
        display: flex;
        align-items: center;
        gap: 2px;
        z-index: 10;
      }

      .toolbar-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 22px;
        padding: 0 var(--spacing-xs);
        gap: 4px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: var(--color-bg-secondary);
        color: var(--color-text-secondary);
        cursor: pointer;
        font-size: 10px;
        transition: background 0.15s ease, color 0.15s ease;
      }

      .toolbar-btn svg {
        width: 12px;
        height: 12px;
      }

      .toolbar-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .toolbar-btn.active {
        background: var(--color-primary);
        color: white;
      }

      .branch-panel {
        position: absolute;
        top: 36px;
        right: calc(var(--spacing-md) + 12px);
        width: 260px;
        max-height: 400px;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        z-index: 20;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .branch-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        border-bottom: 1px solid var(--color-border);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-primary);
      }

      .branch-panel-actions {
        display: flex;
        gap: var(--spacing-xs);
      }

      .branch-panel-actions button {
        font-size: var(--font-size-xs);
        padding: 2px 6px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: var(--color-bg-primary);
        color: var(--color-text-secondary);
        cursor: pointer;
      }

      .branch-panel-actions button:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }

      .branch-panel-list {
        overflow-y: auto;
        padding: var(--spacing-xs) 0;
        flex: 1;
      }

      .branch-group-label {
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        padding: var(--spacing-xs) var(--spacing-md);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        font-weight: var(--font-weight-medium);
      }

      .branch-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: 3px var(--spacing-md);
        cursor: pointer;
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
      }

      .branch-item:hover {
        background: var(--color-bg-hover);
      }

      .branch-item input[type="checkbox"] {
        margin: 0;
        cursor: pointer;
      }

      .branch-item .branch-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }

      .export-menu {
        position: absolute;
        top: 36px;
        right: calc(var(--spacing-md) + 12px + 32px);
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        z-index: 20;
        overflow: hidden;
        min-width: 160px;
      }

      .export-menu-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        cursor: pointer;
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
        border: none;
        background: none;
        width: 100%;
        text-align: left;
      }

      .export-menu-item:hover {
        background: var(--color-bg-hover);
      }

      .resize-handle {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 6px;
        cursor: col-resize;
        background: transparent;
        z-index: 10;
        margin-left: -3px;
      }

      .resize-handle:hover,
      .resize-handle.dragging {
        background: var(--color-primary);
        opacity: 0.5;
      }
    `,
  ];

  @property({ type: Number }) commitCount = 1000;
  @property({ type: String }) repositoryPath = '';
  @property({ type: Object }) searchFilter: { query: string; author: string; dateFrom: string; dateTo: string; filePath: string; branch: string } | null = null;

  @state() private layout: GraphLayout | null = null;
  @state() private selectedNode: LayoutNode | null = null; // Primary selection (for details panel)
  @state() private selectedNodes: Set<string> = new Set(); // All selected OIDs (for multi-select)
  @state() private lastClickedNode: LayoutNode | null = null; // For Shift-click range selection
  @state() private hoveredNode: LayoutNode | null = null;
  @state() private fps = 0;
  @state() private renderTimeMs = 0;
  @state() private visibleNodes = 0;
  @state() private isLoading = false;
  @state() private isLoadingStats = false;
  @state() private loadError: string | null = null;
  @state() private tooltipVisible = false;
  @state() private tooltipX = 0;
  @state() private tooltipY = 0;
  @state() private tooltipAuthorName = '';
  @state() private tooltipAuthorEmail = '';

  // Branch visibility
  @state() private hiddenBranches: Set<string> = new Set();
  @state() private showBranchPanel = false;

  // Export
  @state() private showExportMenu = false;

  // Infinite scroll pagination
  @state() private isLoadingMore = false;
  @state() private hasMoreCommits = true;
  private totalLoadedCommits = 0;

  // Column resize state
  @state() private refsColumnWidth = 130;
  @state() private statsColumnWidth = 80;
  @state() private resizing: 'refs' | 'stats' | null = null;
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private readonly COLUMN_STORAGE_KEY = 'leviathan-graph-columns';
  private readonly BRANCH_VISIBILITY_KEY = 'leviathan-hidden-branches';

  @query('.canvas-container') private containerEl!: HTMLDivElement;
  @query('canvas') private canvasEl!: HTMLCanvasElement;
  @query('.scroll-container') private scrollEl!: HTMLDivElement;

  private commits: GraphCommit[] = [];
  private realCommits: Map<string, Commit> = new Map();
  private matchedCommitOids: Set<string> = new Set(); // For search highlighting
  private refsByCommit: RefsByCommit = {};
  private loadVersion = 0; // Incremented on each load to cancel stale requests
  private statsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLoadedRepoPath: string | null = null; // Track the last repo that completed loading
  private pullRequestsByCommit: Record<string, GraphPullRequest[]> = {};
  private githubRepo: { owner: string; repo: string } | null = null;
  private renderer: CanvasRenderer | null = null;
  private virtualScroll: VirtualScrollManager | null = null;
  private spatialIndex: SpatialIndex | null = null;
  private scrollState: ScrollStateManager | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private mediaQuery: MediaQueryList | null = null;
  private animationFrame = 0;
  private lastRenderData: RenderData | null = null;
  private sortedNodesByRow: LayoutNode[] = [];

  // Config - compact size
  private readonly ROW_HEIGHT = 22;
  private readonly LANE_WIDTH = 16;
  private readonly PADDING = 20;
  private readonly NODE_RADIUS = 6;
  private readonly HEADER_HEIGHT = 28; // Must match canvas-renderer.ts

  connectedCallback(): void {
    super.connectedCallback();
    this.loadColumnWidths();
    this.loadHiddenBranches();
  }

  async firstUpdated(): Promise<void> {
    await this.updateComplete;
    this.initializeSystems();
    this.generateAndLayout();
    this.setupEventListeners();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.cleanup();
  }

  willUpdate(changedProperties: Map<string, unknown>): void {
    // Reload when repository path changes
    if (changedProperties.has('repositoryPath') && changedProperties.get('repositoryPath') !== undefined) {
      // Clear existing state when switching repositories
      this.layout = null;
      this.selectedNode = null;
      this.hoveredNode = null;
      this.realCommits.clear();
      this.refsByCommit = {};

      // Reload hidden branches for the new repository
      this.loadHiddenBranches();

      // Reload commits for the new repository
      this.loadCommits();
    }

    // Reload when search filter changes
    if (changedProperties.has('searchFilter')) {
      this.loadCommits();
    }
  }

  private initializeSystems(): void {
    // Initialize virtual scroll manager
    this.virtualScroll = new VirtualScrollManager({
      rowHeight: this.ROW_HEIGHT,
      laneWidth: this.LANE_WIDTH,
      padding: this.PADDING,
      overscanRows: 15,
    });

    // Initialize spatial index
    this.spatialIndex = new SpatialIndex({
      cellSize: 60,
      nodeRadius: this.NODE_RADIUS + 6,
      edgeTolerance: 6,
    });
    this.spatialIndex.configure({
      offsetX: this.PADDING,
      offsetY: this.PADDING,
      rowHeight: this.ROW_HEIGHT,
      laneWidth: this.LANE_WIDTH,
    });

    // Initialize renderer with theme from CSS variables
    this.renderer = new CanvasRenderer(
      this.canvasEl,
      {
        rowHeight: this.ROW_HEIGHT,
        laneWidth: this.LANE_WIDTH,
        nodeRadius: this.NODE_RADIUS,
        lineWidth: 2,
        showLabels: true,
        showFps: false, // We show our own FPS
        refsColumnWidth: this.refsColumnWidth,
        statsColumnWidth: this.statsColumnWidth,
      },
      getThemeFromCSS()
    );

    // Listen for theme changes via data-theme attribute
    this.themeObserver = new MutationObserver(() => {
      this.renderer?.setTheme(getThemeFromCSS());
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    // Also listen for system theme changes
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.mediaQuery.addEventListener('change', this.handleThemeChange);

    // Initialize scroll state
    this.scrollState = new ScrollStateManager((scrollTop, scrollLeft) => {
      this.onScroll(scrollTop, scrollLeft);
    });

    // Setup resize observer
    this.resizeObserver = new ResizeObserver(() => {
      this.onResize();
    });
    this.resizeObserver.observe(this.containerEl);

    // Initial resize
    this.onResize();
  }

  private setupEventListeners(): void {
    if (!this.containerEl || !this.canvasEl) {
      return;
    }

    // Wheel scrolling on canvas
    this.canvasEl.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });

    // Native scroll on scrollbar container - sync with internal state
    this.scrollEl.addEventListener('scroll', this.handleNativeScroll.bind(this));

    // Mouse interactions
    this.canvasEl.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvasEl.addEventListener('click', this.handleClick.bind(this));
    this.canvasEl.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
    this.canvasEl.addEventListener('contextmenu', this.handleContextMenu.bind(this));

    // Keyboard navigation
    this.canvasEl.addEventListener('keydown', this.handleKeyDown.bind(this));
  }

  private cleanup(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    if (this.statsDebounceTimer) {
      clearTimeout(this.statsDebounceTimer);
    }
    // Clean up resize listeners if still attached
    document.removeEventListener('mousemove', this.handleResizeMove);
    document.removeEventListener('mouseup', this.handleResizeEnd);
    this.renderer?.destroy();
    this.scrollState?.destroy();
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.mediaQuery?.removeEventListener('change', this.handleThemeChange);
  }

  private handleThemeChange = (): void => {
    this.renderer?.setTheme(getThemeFromCSS());
  };

  private async generateAndLayout(): Promise<void> {
    await this.loadCommits();
  }

  private hasActiveSearch(): boolean {
    if (!this.searchFilter) return false;
    return !!(
      this.searchFilter.query ||
      this.searchFilter.author ||
      this.searchFilter.dateFrom ||
      this.searchFilter.dateTo ||
      this.searchFilter.filePath ||
      this.searchFilter.branch
    );
  }

  private async loadCommits(): Promise<void> {
    if (!this.repositoryPath) {
      this.loadError = 'No repository path specified';
      return;
    }

    // Increment version to cancel any in-flight requests from previous loads
    this.loadVersion++;
    const currentVersion = this.loadVersion;
    const repoPath = this.repositoryPath;

    this.isLoading = true;
    this.loadError = null;
    const startTime = performance.now();

    try {
      const hasSearch = this.hasActiveSearch();

      // Always fetch all commits first
      const [commitsResult, refsResult, githubRepoResult] = await Promise.all([
        getCommitHistory({
          path: repoPath,
          limit: this.commitCount,
          allBranches: true,
        }),
        getRefsByCommit(repoPath),
        detectGitHubRepo(repoPath),
      ]);

      // Abort if a newer load has started
      if (this.loadVersion !== currentVersion) return;

      // Check if we have a GitHub repo and fetch PRs
      if (githubRepoResult.success && githubRepoResult.data) {
        this.githubRepo = {
          owner: githubRepoResult.data.owner,
          repo: githubRepoResult.data.repo,
        };
        // Load PRs in background (don't block render)
        this.loadPullRequests();
      } else {
        this.githubRepo = null;
        this.pullRequestsByCommit = {};
      }

      if (!commitsResult.success || !commitsResult.data) {
        this.loadError = commitsResult.error?.message ?? 'Failed to load commits';
        this.isLoading = false;
        return;
      }

      // Store real commits for details panel
      this.realCommits.clear();
      for (const commit of commitsResult.data) {
        this.realCommits.set(commit.oid, commit);
      }

      // Store refs
      this.refsByCommit = refsResult.success && refsResult.data ? refsResult.data : {};

      // If search is active, also fetch matching commits for highlighting
      this.matchedCommitOids.clear();
      if (hasSearch) {
        // Try the search index first for faster results
        const indexResults = await searchIndexService.search(repoPath, {
          query: this.searchFilter?.query || undefined,
          author: this.searchFilter?.author || undefined,
          dateFrom: this.searchFilter?.dateFrom
            ? new Date(this.searchFilter.dateFrom).getTime() / 1000
            : undefined,
          dateTo: this.searchFilter?.dateTo
            ? new Date(this.searchFilter.dateTo).getTime() / 1000
            : undefined,
          limit: this.commitCount,
        });

        // Abort if a newer load has started
        if (this.loadVersion !== currentVersion) return;

        if (indexResults) {
          for (const commit of indexResults) {
            this.matchedCommitOids.add(commit.oid);
          }
        } else {
          // Fallback to direct search
          const matchResult = await searchCommits(repoPath, {
            query: this.searchFilter?.query || undefined,
            author: this.searchFilter?.author || undefined,
            dateFrom: this.searchFilter?.dateFrom
              ? new Date(this.searchFilter.dateFrom).getTime() / 1000
              : undefined,
            dateTo: this.searchFilter?.dateTo
              ? new Date(this.searchFilter.dateTo).getTime() / 1000
              : undefined,
            filePath: this.searchFilter?.filePath || undefined,
            branch: this.searchFilter?.branch || undefined,
            limit: this.commitCount,
          });

          // Abort if a newer load has started
          if (this.loadVersion !== currentVersion) return;

          if (matchResult.success && matchResult.data) {
            for (const commit of matchResult.data) {
              this.matchedCommitOids.add(commit.oid);
            }
          }
        }
        log.debug(`Search matched ${this.matchedCommitOids.size} commits`);
      }

      // Convert commits to GraphCommit format for layout
      this.commits = commitsResult.data.map(commitToGraphCommit);
      this.totalLoadedCommits = commitsResult.data.length;
      this.hasMoreCommits = commitsResult.data.length >= this.commitCount;
      this.processLayout();
      const searchInfo = hasSearch ? ` (${this.matchedCommitOids.size} matches highlighted)` : '';
      log.debug(`Loaded ${this.commits.length} commits${searchInfo} in ${(performance.now() - startTime).toFixed(2)}ms`);
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : 'Unknown error loading commits';
    } finally {
      this.isLoading = false;
    }
  }

  private async loadMoreCommits(): Promise<void> {
    if (this.isLoadingMore || !this.hasMoreCommits || !this.repositoryPath) return;
    this.isLoadingMore = true;
    const batchSize = 500;
    const currentVersion = this.loadVersion;

    try {
      const result = await getCommitHistory({
        path: this.repositoryPath,
        limit: batchSize,
        skip: this.totalLoadedCommits,
        allBranches: true,
      });

      if (this.loadVersion !== currentVersion) return;
      if (!result.success || !result.data?.length) {
        this.hasMoreCommits = false;
        return;
      }

      for (const commit of result.data) {
        this.realCommits.set(commit.oid, commit);
      }
      this.commits = [...this.commits, ...result.data.map(commitToGraphCommit)];
      this.totalLoadedCommits += result.data.length;
      this.hasMoreCommits = result.data.length >= batchSize;
      this.processLayout();
    } finally {
      this.isLoadingMore = false;
    }
  }

  private checkLoadMore(): void {
    if (!this.virtualScroll || !this.hasMoreCommits || this.isLoadingMore) return;
    const contentSize = this.virtualScroll.getContentSize();
    const scrollTop = this.scrollState?.getScroll().scrollTop ?? 0;
    const viewportHeight = this.containerEl?.clientHeight ?? 0;
    if (contentSize.height - (scrollTop + viewportHeight) < 500) {
      this.loadMoreCommits();
    }
  }

  /**
   * Load pull requests for GitHub repositories
   * Maps PRs to their head commit SHA for display
   */
  private async loadPullRequests(): Promise<void> {
    if (!this.githubRepo) {
      return;
    }

    try {
      // Check if GitHub is connected
      const connectionResult = await checkGitHubConnection();
      if (!connectionResult.success || !connectionResult.data?.connected) {
        return; // Not connected, skip PR loading
      }

      // Fetch open PRs (and recently closed for context)
      const [openPrs, closedPrs] = await Promise.all([
        listPullRequests(this.githubRepo.owner, this.githubRepo.repo, 'open', 50),
        listPullRequests(this.githubRepo.owner, this.githubRepo.repo, 'closed', 20),
      ]);

      const prsByCommit: Record<string, GraphPullRequest[]> = {};

      // Build a set of all commit OIDs in the graph for fast lookup
      const graphCommitOids = new Set(this.commits.map(c => c.oid));

      // Helper to add PR to commit map
      const addPr = (headSha: string, headRef: string, pr: GraphPullRequest) => {
        // Primary: Match by commit SHA directly
        if (graphCommitOids.has(headSha)) {
          if (!prsByCommit[headSha]) {
            prsByCommit[headSha] = [];
          }
          if (!prsByCommit[headSha].some(p => p.number === pr.number)) {
            prsByCommit[headSha].push(pr);
          }
          return;
        }

        // Fallback: Match by branch ref name (for PRs whose commits aren't directly in graph)
        for (const [oid, refs] of Object.entries(this.refsByCommit)) {
          const hasMatchingRef = refs.some(ref =>
            ref.shorthand === headRef ||
            ref.shorthand.endsWith('/' + headRef)
          );
          if (hasMatchingRef) {
            if (!prsByCommit[oid]) {
              prsByCommit[oid] = [];
            }
            if (!prsByCommit[oid].some(p => p.number === pr.number)) {
              prsByCommit[oid].push(pr);
            }
            break;
          }
        }
      };

      // Process open PRs
      if (openPrs.success && openPrs.data) {
        for (const pr of openPrs.data) {
          addPr(pr.headSha, pr.headRef, {
            number: pr.number,
            state: pr.state,
            draft: pr.draft,
            url: pr.htmlUrl,
          });
        }
      }

      // Process closed PRs - use mergedAt to determine actual state
      if (closedPrs.success && closedPrs.data) {
        for (const pr of closedPrs.data) {
          addPr(pr.headSha, pr.headRef, {
            number: pr.number,
            state: pr.mergedAt ? 'merged' : pr.state,
            draft: pr.draft,
            url: pr.htmlUrl,
          });
        }
      }

      this.pullRequestsByCommit = prsByCommit;

      // Update virtual scroll and re-render
      this.virtualScroll?.setPullRequests(this.pullRequestsByCommit);
      this.renderer?.markDirty();
      this.scheduleRender();
    } catch {
      // Failed to load pull requests, continue without them
    }
  }

  private processLayout(): void {
    // Compute layout (use simple algorithm for cleaner one-commit-per-row layout)
    const result = computeGraphLayout(this.commits, { optimized: false });
    this.layout = result.layout;

    // Build sorted nodes array for keyboard navigation
    this.sortedNodesByRow = [...this.layout.nodes.values()].sort((a, b) => a.row - b.row);

    // Extract author emails for avatar loading
    const authorEmails: Record<string, string> = {};
    for (const [oid, commit] of this.realCommits) {
      authorEmails[oid] = commit.author.email;
    }

    // Update virtual scroll
    this.virtualScroll?.setLayout(this.layout);
    this.virtualScroll?.setRefs(this.refsByCommit);
    this.virtualScroll?.setAuthorEmails(authorEmails);
    this.virtualScroll?.setPullRequests(this.pullRequestsByCommit);

    // Update scroll content size
    this.updateScrollContentSize();

    // Rebuild spatial index
    this.rebuildSpatialIndex();

    // Set highlighted commits for search results
    this.renderer?.setHighlightedCommits(this.matchedCommitOids);

    // Mark dirty and render
    this.renderer?.markDirty();
    this.scheduleRender();

    // Fetch real commit stats and signatures asynchronously (don't block initial render)
    // Use debouncing for stats to handle rapid repo changes during startup
    this.scheduleStatsFetch();
    this.fetchCommitSignatures();
  }

  /**
   * Schedule stats fetch with debouncing to avoid race conditions during rapid repo changes
   */
  private scheduleStatsFetch(): void {
    const repoPath = this.repositoryPath;
    log.debug(`scheduleStatsFetch: scheduling for ${repoPath}, version=${this.loadVersion}`);

    // Cancel any pending stats fetch
    if (this.statsDebounceTimer) {
      clearTimeout(this.statsDebounceTimer);
      log.debug(`scheduleStatsFetch: cancelled previous pending fetch`);
    }

    // Wait a short time before fetching to let rapid changes settle
    // Use 300ms to handle startup where multiple repos are loaded quickly
    this.statsDebounceTimer = setTimeout(() => {
      this.statsDebounceTimer = null;
      // Check if repo is still the same before fetching
      if (this.repositoryPath === repoPath) {
        log.debug(`scheduleStatsFetch: timer fired, fetching for ${repoPath}`);
        this.fetchCommitStats();
      } else {
        log.debug(`scheduleStatsFetch: timer fired but repo changed from ${repoPath} to ${this.repositoryPath}, skipping`);
      }
    }, 300);
  }

  private async fetchCommitStats(): Promise<void> {
    if (!this.repositoryPath || this.realCommits.size === 0) return;

    // Capture state at start to avoid race conditions when repository changes
    const repoPath = this.repositoryPath;
    const commitOids = [...this.realCommits.keys()];
    const version = this.loadVersion;
    const startTime = Date.now();
    const MIN_LOADING_DISPLAY_MS = 400; // Minimum time to show loading indicator

    log.debug(`fetchCommitStats: starting for ${commitOids.length} commits, version=${version}`);
    this.isLoadingStats = true;

    try {
      // Fetch in batches to avoid overwhelming the backend
      const batchSize = 100;
      const allStats = new Map<string, { additions: number; deletions: number; filesChanged: number }>();

      for (let i = 0; i < commitOids.length; i += batchSize) {
        // Abort if we switched to a different repository (not just version change)
        if (this.repositoryPath !== repoPath) {
          log.debug(`fetchCommitStats: aborting at batch ${i / batchSize}, repo changed from ${repoPath} to ${this.repositoryPath}`);
          return;
        }

        const batch = commitOids.slice(i, i + batchSize);
        const result = await getCommitsStats(repoPath, batch);

        if (result.success && result.data) {
          log.debug(`fetchCommitStats: batch ${i / batchSize} returned ${result.data.length}/${batch.length} stats`);
          for (const stat of result.data) {
            allStats.set(stat.oid, {
              additions: stat.additions,
              deletions: stat.deletions,
              filesChanged: stat.filesChanged,
            });
          }
        } else {
          log.warn(`fetchCommitStats: batch ${i / batchSize} failed: ${result.error}`);
        }
      }

      // Only update if we're still on the same repository (use path check, not version)
      // This allows stats to be applied even if a refresh happened during fetching
      if (this.repositoryPath === repoPath && allStats.size > 0) {
        log.debug(`fetchCommitStats: complete, got stats for ${allStats.size}/${commitOids.length} commits`);
        this.renderer?.setCommitStats(allStats);
        this.renderer?.markDirty();
        this.scheduleRender();
      } else if (this.repositoryPath !== repoPath) {
        log.debug(`fetchCommitStats: discarding stats for ${repoPath}, now on ${this.repositoryPath}`);
      }
    } finally {
      // Only clear loading state if we're still on the same repo
      if (this.repositoryPath === repoPath) {
        // Ensure loading indicator is visible for minimum time
        const elapsed = Date.now() - startTime;
        if (elapsed < MIN_LOADING_DISPLAY_MS) {
          await new Promise(resolve => setTimeout(resolve, MIN_LOADING_DISPLAY_MS - elapsed));
        }
        this.isLoadingStats = false;
      }
    }
  }

  private async fetchCommitSignatures(): Promise<void> {
    if (!this.repositoryPath || this.realCommits.size === 0) return;

    // Capture state at start to avoid race conditions when repository changes
    const repoPath = this.repositoryPath;
    const commitOids = [...this.realCommits.keys()];
    const version = this.loadVersion;

    // Fetch in batches to avoid overwhelming the backend
    const batchSize = 50;
    const allSignatures = new Map<string, { signed: boolean; valid: boolean }>();

    for (let i = 0; i < commitOids.length; i += batchSize) {
      // Abort if a newer load has started
      if (this.loadVersion !== version) {
        return;
      }

      const batch = commitOids.slice(i, i + batchSize);
      const result = await getCommitsSignatures(repoPath, batch);

      if (result.success && result.data) {
        for (const [oid, sig] of result.data) {
          allSignatures.set(oid, { signed: sig.signed, valid: sig.valid });
        }
      }
    }

    // Only update if no newer load has started
    if (this.loadVersion === version && allSignatures.size > 0) {
      this.renderer?.setCommitSignatures(allSignatures);
      this.renderer?.markDirty();
      this.scheduleRender();
    }
  }

  private updateScrollContentSize(): void {
    if (!this.virtualScroll || !this.scrollEl) return;

    const size = this.virtualScroll.getContentSize();
    const scrollContent = this.scrollEl.querySelector('.scroll-content') as HTMLDivElement;
    if (scrollContent) {
      scrollContent.style.width = `${size.width}px`;
      scrollContent.style.height = `${size.height}px`;
    }
  }

  private rebuildSpatialIndex(): void {
    if (!this.layout || !this.spatialIndex) return;

    // Configure spatial index with current maxLane for mirrored coordinates
    this.spatialIndex.configure({
      offsetX: this.PADDING,
      offsetY: this.PADDING,
      rowHeight: this.ROW_HEIGHT,
      laneWidth: this.LANE_WIDTH,
      maxLane: this.layout.maxLane,
    });

    const viewport = this.getViewport();
    const range = this.virtualScroll?.getVisibleRange(viewport);

    if (range) {
      // Build index only for visible area (+ buffer)
      const visibleNodes = [...this.layout.nodes.values()].filter(
        (n) => n.row >= range.startRow && n.row <= range.endRow
      );
      const visibleEdges = this.layout.edges.filter((e) => {
        const minRow = Math.min(e.fromRow, e.toRow);
        const maxRow = Math.max(e.fromRow, e.toRow);
        return maxRow >= range.startRow && minRow <= range.endRow;
      });

      this.spatialIndex.build(visibleNodes, visibleEdges);
    }
  }

  private getViewport(): Viewport {
    const scroll = this.scrollState?.getScroll() ?? { scrollTop: 0, scrollLeft: 0 };
    return {
      scrollTop: scroll.scrollTop,
      scrollLeft: scroll.scrollLeft,
      width: this.containerEl?.clientWidth ?? 800,
      height: this.containerEl?.clientHeight ?? 600,
    };
  }

  private onResize(): void {
    if (!this.containerEl || !this.renderer) return;

    const scrollbarWidth = 12; // Match CSS scrollbar width
    const width = this.containerEl.clientWidth - scrollbarWidth;
    const height = this.containerEl.clientHeight;

    this.renderer.resize(width, height);
    this.scheduleRender();
  }

  private onScroll(_scrollTop: number, _scrollLeft: number): void {
    // Rebuild spatial index for new viewport
    this.rebuildSpatialIndex();
    // Mark renderer dirty so it actually redraws
    this.renderer?.markDirty();
    this.scheduleRender();
    this.checkLoadMore();
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();

    if (!this.scrollState || !this.virtualScroll) {
      return;
    }

    const size = this.virtualScroll.getContentSize();
    const viewport = this.getViewport();

    const maxScrollX = Math.max(0, size.width - viewport.width);
    const maxScrollY = Math.max(0, size.height - viewport.height);

    this.scrollState.handleWheel(e.deltaX, e.deltaY, maxScrollX, maxScrollY);

    // Sync the native scrollbar position
    this.syncScrollbarPosition();
  }

  private handleNativeScroll(): void {
    if (!this.scrollEl || !this.scrollState || this.isSyncingScroll) {
      return;
    }

    // Update internal scroll state from native scrollbar
    const scrollTop = this.scrollEl.scrollTop;
    const scrollLeft = this.scrollEl.scrollLeft;

    this.scrollState.setScroll(scrollTop, scrollLeft);
    this.checkLoadMore();
  }

  private isSyncingScroll = false;

  private syncScrollbarPosition(): void {
    if (!this.scrollEl || !this.scrollState) return;

    const scroll = this.scrollState.getScroll();

    // Prevent feedback loop
    this.isSyncingScroll = true;
    this.scrollEl.scrollTop = scroll.scrollTop;
    this.scrollEl.scrollLeft = scroll.scrollLeft;

    // Reset flag after scroll event processes
    requestAnimationFrame(() => {
      this.isSyncingScroll = false;
    });
  }

  private handleMouseMove(e: MouseEvent): void {
    const result = this.hitTest(e);

    if (result.type === 'node' && result.node) {
      this.hoveredNode = result.node;
      this.canvasEl.classList.add('pointer');
    } else {
      this.hoveredNode = null;
      this.canvasEl.classList.remove('pointer');
    }

    // Check for avatar or ref label hover for tooltip
    if (this.renderer) {
      const rect = this.canvasEl.getBoundingClientRect();

      // Convert screen coords to canvas coords (hitboxes are in canvas space)
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;

      // Check avatars first
      const avatarHit = this.renderer.getAvatarAtPoint(canvasX, canvasY);
      if (avatarHit) {
        this.tooltipVisible = true;
        this.tooltipX = e.clientX + 12;
        this.tooltipY = e.clientY - 8;
        this.tooltipAuthorName = avatarHit.authorName;
        this.tooltipAuthorEmail = avatarHit.authorEmail;
      } else {
        // Check ref labels
        const refLabelHit = this.renderer.getRefLabelAtPoint(canvasX, canvasY);
        if (refLabelHit) {
          this.tooltipVisible = true;
          this.tooltipX = e.clientX + 12;
          this.tooltipY = e.clientY - 8;
          this.tooltipAuthorName = refLabelHit.fullName;
          this.tooltipAuthorEmail = refLabelHit.refType === 'pullRequest'
            ? 'Click to open'
            : this.getRefTypeLabel(refLabelHit.refType);
        } else {
          // Check overflow indicator
          const overflowHit = this.renderer.getOverflowAtPoint(canvasX, canvasY);
          if (overflowHit) {
            this.tooltipVisible = true;
            this.tooltipX = e.clientX + 12;
            this.tooltipY = e.clientY - 8;
            this.tooltipAuthorName = 'Hidden labels:';
            this.tooltipAuthorEmail = overflowHit.hiddenLabels.join(', ');
          } else {
            this.tooltipVisible = false;
          }
        }
      }
    }

    this.renderer?.setMultiSelection(
      this.selectedNodes,
      this.hoveredNode?.oid ?? null
    );
    this.renderer?.markDirty();
    this.scheduleRender();
  }

  private handleClick(e: MouseEvent): void {
    // Check for ref label click first (checkout on branch label click)
    if (this.renderer) {
      const rect = this.canvasEl.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;

      const refLabelHit = this.renderer.getRefLabelAtPoint(canvasX, canvasY);
      if (refLabelHit && refLabelHit.refType === 'localBranch') {
        // Dispatch checkout event for local branches
        this.dispatchEvent(
          new CustomEvent('checkout-branch', {
            detail: { branchName: refLabelHit.label },
            bubbles: true,
            composed: true,
          })
        );
        return;
      }

      // Handle PR label click - open in browser
      if (refLabelHit && refLabelHit.refType === 'pullRequest') {
        const prUrl = refLabelHit.fullName;
        if (prUrl && prUrl.startsWith('http')) {
          openExternalUrl(prUrl);
        }
        return;
      }
    }

    const result = this.hitTest(e);

    if (result.type === 'node' && result.node) {
      const clickedOid = result.node.oid;

      if (e.shiftKey && this.lastClickedNode) {
        // Shift+click: Range selection between last clicked and current
        this.handleRangeSelect(result.node);
        this.selectedNode = result.node;
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd+click: Toggle individual selection
        if (this.selectedNodes.has(clickedOid)) {
          this.selectedNodes.delete(clickedOid);
          // If we removed the primary selection, pick another
          if (this.selectedNode?.oid === clickedOid) {
            const remaining = Array.from(this.selectedNodes);
            this.selectedNode = remaining.length > 0
              ? this.sortedNodesByRow.find(n => n.oid === remaining[remaining.length - 1]) ?? null
              : null;
          }
        } else {
          this.selectedNodes.add(clickedOid);
          this.selectedNode = result.node;
        }
        this.lastClickedNode = result.node;
      } else {
        // Regular click: Clear selection and select single node
        this.selectedNodes.clear();
        this.selectedNodes.add(clickedOid);
        this.selectedNode = result.node;
        this.lastClickedNode = result.node;
      }
    } else {
      // Click on empty space: Clear selection (unless Ctrl/Cmd held)
      if (!e.ctrlKey && !e.metaKey) {
        this.selectedNodes.clear();
        this.selectedNode = null;
        this.lastClickedNode = null;
      }
    }

    // Focus canvas for keyboard navigation
    this.canvasEl.focus();

    // Dispatch selection event
    this.dispatchSelectionEvent();

    this.renderer?.setMultiSelection(
      this.selectedNodes,
      this.hoveredNode?.oid ?? null
    );
    this.renderer?.markDirty();
    this.scheduleRender();
  }

  private handleRangeSelect(endNode: LayoutNode): void {
    if (!this.lastClickedNode) return;

    const startRow = this.lastClickedNode.row;
    const endRow = endNode.row;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    // Select all nodes in the row range
    for (const node of this.sortedNodesByRow) {
      if (node.row >= minRow && node.row <= maxRow) {
        this.selectedNodes.add(node.oid);
      }
    }
  }

  private handleMouseLeave(): void {
    this.hoveredNode = null;
    this.tooltipVisible = false;
    this.canvasEl.classList.remove('pointer');
    this.renderer?.setMultiSelection(this.selectedNodes, null);
    this.renderer?.markDirty();
    this.scheduleRender();
  }

  private handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();

    // Check for ref label right-click first
    if (this.renderer) {
      const rect = this.canvasEl.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;

      const refLabelHit = this.renderer.getRefLabelAtPoint(canvasX, canvasY);
      if (refLabelHit && refLabelHit.refType !== 'pullRequest') {
        // Dispatch ref context menu event for branches and tags
        this.dispatchEvent(
          new CustomEvent('ref-context-menu', {
            detail: {
              refName: refLabelHit.label,
              fullName: refLabelHit.fullName,
              refType: refLabelHit.refType,
              position: {
                x: e.clientX,
                y: e.clientY,
              },
            },
            bubbles: true,
            composed: true,
          })
        );
        return;
      }
    }

    const result = this.hitTest(e);

    if (result.type === 'node' && result.node) {
      const commit = this.realCommits.get(result.node.oid);
      if (commit) {
        // Select the commit on right-click
        this.selectedNode = result.node;
        this.dispatchSelectionEvent();

        // Dispatch context menu event
        this.dispatchEvent(
          new CustomEvent('commit-context-menu', {
            detail: {
              commit,
              refs: this.refsByCommit[result.node.oid] || [],
              position: {
                x: e.clientX,
                y: e.clientY,
              },
            },
            bubbles: true,
            composed: true,
          })
        );

        this.renderer?.setMultiSelection(
          this.selectedNodes,
          this.hoveredNode?.oid ?? null
        );
        this.renderer?.markDirty();
        this.scheduleRender();
      }
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.sortedNodesByRow.length === 0) return;

    let newIndex = -1;
    const currentIndex = this.selectedNode
      ? this.sortedNodesByRow.findIndex((n) => n.oid === this.selectedNode!.oid)
      : -1;

    switch (e.key) {
      case 'ArrowDown':
      case 'j': // Vim-style navigation
        e.preventDefault();
        if (currentIndex === -1) {
          newIndex = 0;
        } else if (currentIndex < this.sortedNodesByRow.length - 1) {
          newIndex = currentIndex + 1;
        }
        break;

      case 'ArrowUp':
      case 'k': // Vim-style navigation
        e.preventDefault();
        if (currentIndex === -1) {
          newIndex = 0;
        } else if (currentIndex > 0) {
          newIndex = currentIndex - 1;
        }
        break;

      case 'Home':
        e.preventDefault();
        newIndex = 0;
        break;

      case 'End':
        e.preventDefault();
        newIndex = this.sortedNodesByRow.length - 1;
        break;

      case 'PageDown':
        e.preventDefault();
        if (currentIndex === -1) {
          newIndex = 0;
        } else {
          const pageSize = Math.floor((this.containerEl?.clientHeight ?? 600) / this.ROW_HEIGHT);
          newIndex = Math.min(currentIndex + pageSize, this.sortedNodesByRow.length - 1);
        }
        break;

      case 'PageUp':
        e.preventDefault();
        if (currentIndex === -1) {
          newIndex = 0;
        } else {
          const pageSize = Math.floor((this.containerEl?.clientHeight ?? 600) / this.ROW_HEIGHT);
          newIndex = Math.max(currentIndex - pageSize, 0);
        }
        break;

      case 'Escape':
        e.preventDefault();
        this.selectedNode = null;
        this.selectedNodes.clear();
        this.lastClickedNode = null;
        this.dispatchSelectionEvent();
        this.renderer?.setMultiSelection(this.selectedNodes, this.hoveredNode?.oid ?? null);
        this.renderer?.markDirty();
        this.scheduleRender();
        return;

      case 'c':
        // Copy commit SHA to clipboard (Ctrl/Cmd+C)
        if ((e.ctrlKey || e.metaKey) && this.selectedNode) {
          e.preventDefault();
          navigator.clipboard.writeText(this.selectedNode.oid);
          // Dispatch event for toast notification
          this.dispatchEvent(
            new CustomEvent('copy-sha', {
              detail: { sha: this.selectedNode.oid.substring(0, 7) },
              bubbles: true,
              composed: true,
            })
          );
        }
        return;

      default:
        return;
    }

    if (newIndex >= 0 && newIndex !== currentIndex) {
      this.selectedNode = this.sortedNodesByRow[newIndex];
      // Keyboard nav clears multi-select unless Shift is held
      this.selectedNodes.clear();
      this.selectedNodes.add(this.selectedNode.oid);
      this.lastClickedNode = this.selectedNode;
      this.dispatchSelectionEvent();
      this.scrollToNode(this.selectedNode);
      this.renderer?.setMultiSelection(this.selectedNodes, this.hoveredNode?.oid ?? null);
      this.renderer?.markDirty();
      this.scheduleRender();
    }
  }

  private scrollToNode(node: LayoutNode): void {
    if (!this.scrollState || !this.virtualScroll) return;

    const viewport = this.getViewport();
    const nodeY = this.PADDING + node.row * this.ROW_HEIGHT;
    const nodeX = this.PADDING + node.lane * this.LANE_WIDTH;

    // Calculate visible area
    const visibleTop = viewport.scrollTop;
    const visibleBottom = viewport.scrollTop + viewport.height;
    const visibleLeft = viewport.scrollLeft;
    const visibleRight = viewport.scrollLeft + viewport.width;

    // Scroll margins for keeping node comfortably in view
    const marginY = this.ROW_HEIGHT * 2;
    const marginX = this.LANE_WIDTH * 2;

    let targetScrollTop = viewport.scrollTop;
    let targetScrollLeft = viewport.scrollLeft;

    // Vertical scrolling
    if (nodeY < visibleTop + marginY) {
      targetScrollTop = Math.max(0, nodeY - marginY);
    } else if (nodeY > visibleBottom - marginY - this.ROW_HEIGHT) {
      const size = this.virtualScroll.getContentSize();
      const maxScrollY = Math.max(0, size.height - viewport.height);
      targetScrollTop = Math.min(maxScrollY, nodeY - viewport.height + marginY + this.ROW_HEIGHT);
    }

    // Horizontal scrolling
    if (nodeX < visibleLeft + marginX) {
      targetScrollLeft = Math.max(0, nodeX - marginX);
    } else if (nodeX > visibleRight - marginX - this.LANE_WIDTH) {
      const size = this.virtualScroll.getContentSize();
      const maxScrollX = Math.max(0, size.width - viewport.width);
      targetScrollLeft = Math.min(maxScrollX, nodeX - viewport.width + marginX + this.LANE_WIDTH);
    }

    // Apply scroll if needed
    if (targetScrollTop !== viewport.scrollTop || targetScrollLeft !== viewport.scrollLeft) {
      this.scrollState.setScroll(targetScrollTop, targetScrollLeft);
      this.syncScrollbarPosition();
    }
  }

  /**
   * Public method to get all loaded commits (for command palette search)
   */
  public getLoadedCommits(): Commit[] {
    return Array.from(this.realCommits.values());
  }

  /**
   * Public method to select and scroll to a commit by OID
   * Used by other components (like commit details panel) to navigate the graph
   */
  public selectCommit(oid: string): boolean {
    if (!this.layout) {
      return false;
    }

    const node = this.layout.nodes.get(oid);
    if (!node) {
      return false;
    }

    // Update selection state first
    this.selectedNode = node;
    this.selectedNodes.clear();
    this.selectedNodes.add(node.oid);
    this.lastClickedNode = node;
    this.renderer?.setMultiSelection(this.selectedNodes, this.hoveredNode?.oid ?? null);

    // Scroll to node - this updates scroll state
    this.scrollToNode(node);

    // Focus canvas for keyboard navigation
    this.canvasEl.focus();

    // Dispatch selection event after scroll is set
    this.dispatchSelectionEvent();

    // Force rebuild spatial index for new viewport and render
    this.rebuildSpatialIndex();
    this.renderer?.markDirty();
    this.scheduleRender();

    return true;
  }

  /**
   * Navigate to the previous commit (up in the list)
   */
  public navigatePrevious(): void {
    if (this.sortedNodesByRow.length === 0) return;

    const currentIndex = this.selectedNode
      ? this.sortedNodesByRow.findIndex((n) => n.oid === this.selectedNode!.oid)
      : -1;

    if (currentIndex === -1) {
      this.selectByIndex(0);
    } else if (currentIndex > 0) {
      this.selectByIndex(currentIndex - 1);
    }
  }

  /**
   * Navigate to the next commit (down in the list)
   */
  public navigateNext(): void {
    if (this.sortedNodesByRow.length === 0) return;

    const currentIndex = this.selectedNode
      ? this.sortedNodesByRow.findIndex((n) => n.oid === this.selectedNode!.oid)
      : -1;

    if (currentIndex === -1) {
      this.selectByIndex(0);
    } else if (currentIndex < this.sortedNodesByRow.length - 1) {
      this.selectByIndex(currentIndex + 1);
    }

    // Load more when navigating near the end
    if (currentIndex >= this.sortedNodesByRow.length - 5) {
      this.checkLoadMore();
    }
  }

  /**
   * Navigate to the first commit (top of the list)
   */
  public navigateFirst(): void {
    if (this.sortedNodesByRow.length === 0) return;
    this.selectByIndex(0);
  }

  /**
   * Navigate to the last commit (bottom of the list)
   */
  public navigateLast(): void {
    if (this.sortedNodesByRow.length === 0) return;
    this.selectByIndex(this.sortedNodesByRow.length - 1);
  }

  /**
   * Navigate up by a page (half viewport height worth of commits)
   */
  public navigatePageUp(): void {
    if (this.sortedNodesByRow.length === 0) return;

    const currentIndex = this.selectedNode
      ? this.sortedNodesByRow.findIndex((n) => n.oid === this.selectedNode!.oid)
      : 0;

    // Calculate page size based on viewport (roughly half the visible rows)
    const viewport = this.getViewport();
    const pageSize = Math.max(1, Math.floor(viewport.height / this.ROW_HEIGHT / 2));
    const newIndex = Math.max(0, currentIndex - pageSize);
    this.selectByIndex(newIndex);
  }

  /**
   * Navigate down by a page (half viewport height worth of commits)
   */
  public navigatePageDown(): void {
    if (this.sortedNodesByRow.length === 0) return;

    const currentIndex = this.selectedNode
      ? this.sortedNodesByRow.findIndex((n) => n.oid === this.selectedNode!.oid)
      : 0;

    // Calculate page size based on viewport (roughly half the visible rows)
    const viewport = this.getViewport();
    const pageSize = Math.max(1, Math.floor(viewport.height / this.ROW_HEIGHT / 2));
    const newIndex = Math.min(this.sortedNodesByRow.length - 1, currentIndex + pageSize);
    this.selectByIndex(newIndex);
  }

  /**
   * Refresh the commit graph
   */
  public refresh(): void {
    this.loadCommits();
  }

  private selectByIndex(index: number): void {
    if (index < 0 || index >= this.sortedNodesByRow.length) return;

    this.selectedNode = this.sortedNodesByRow[index];
    this.selectedNodes.clear();
    this.selectedNodes.add(this.selectedNode.oid);
    this.lastClickedNode = this.selectedNode;
    this.dispatchSelectionEvent();
    this.scrollToNode(this.selectedNode);
    this.renderer?.setMultiSelection(this.selectedNodes, this.hoveredNode?.oid ?? null);
    this.renderer?.markDirty();
    this.scheduleRender();
  }

  private hitTest(e: MouseEvent): HitTestResult {
    const rect = this.canvasEl.getBoundingClientRect();
    const viewport = this.getViewport();

    // Convert screen coords to graph coords, accounting for header offset
    const graphX = e.clientX - rect.left + viewport.scrollLeft;
    const graphY = e.clientY - rect.top + viewport.scrollTop - this.HEADER_HEIGHT;

    // First check spatial index for node hits
    if (this.spatialIndex) {
      const result = this.spatialIndex.hitTest(graphX, graphY);
      if (result.type === 'node' && result.node) {
        return result;
      }
    }

    // If no node hit, check if we clicked in a row (for message/label area)
    // Calculate which row was clicked based on Y coordinate
    // Use Math.round so the click region is centered around each node
    const adjustedY = graphY - this.PADDING;
    if (adjustedY >= 0 && this.layout) {
      const row = Math.round(adjustedY / this.ROW_HEIGHT);

      // Find the node at this row
      for (const node of this.layout.nodes.values()) {
        if (node.row === row) {
          return { type: 'node', node, distance: 0 };
        }
      }
    }

    return { type: 'none', distance: Infinity };
  }

  /**
   * Get human-readable label for ref type
   */
  private getRefTypeLabel(refType: string): string {
    switch (refType) {
      case 'localBranch':
        return 'Local branch';
      case 'remoteBranch':
        return 'Remote branch';
      case 'tag':
        return 'Tag';
      case 'pullRequest':
        return 'Pull request';
      default:
        return 'Reference';
    }
  }

  private dispatchSelectionEvent(): void {
    let commit: Commit | null = null;
    let refs: RefInfo[] = [];
    const commits: Commit[] = [];

    // Get all selected commits
    for (const oid of this.selectedNodes) {
      const c = this.realCommits.get(oid);
      if (c) {
        commits.push(c);
      }
    }

    if (this.selectedNode) {
      // Get real commit data if available (primary selection for details panel)
      commit = this.realCommits.get(this.selectedNode.oid) ?? null;
      // Get refs for this commit
      refs = this.refsByCommit[this.selectedNode.oid] ?? [];
    }

    this.dispatchEvent(
      new CustomEvent<CommitSelectedEvent>('commit-selected', {
        detail: { commit, commits, refs },
        bubbles: true,
        composed: true,
      })
    );
  }

  private scheduleRender(): void {
    if (this.animationFrame) return;

    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = 0;
      this.renderGraph();
    });
  }

  // Column resize methods
  private loadColumnWidths(): void {
    try {
      const saved = localStorage.getItem(this.COLUMN_STORAGE_KEY);
      if (saved) {
        const { refs, stats } = JSON.parse(saved);
        this.refsColumnWidth = refs ?? 130;
        this.statsColumnWidth = stats ?? 80;
      }
    } catch {
      // Ignore parse errors, use defaults
    }
  }

  private saveColumnWidths(): void {
    try {
      localStorage.setItem(this.COLUMN_STORAGE_KEY, JSON.stringify({
        refs: this.refsColumnWidth,
        stats: this.statsColumnWidth,
      }));
    } catch {
      // Ignore storage errors
    }
  }

  // Branch visibility methods
  private getBranchStorageKey(): string {
    return `${this.BRANCH_VISIBILITY_KEY}-${this.repositoryPath}`;
  }

  private loadHiddenBranches(): void {
    try {
      const saved = localStorage.getItem(this.getBranchStorageKey());
      if (saved) {
        this.hiddenBranches = new Set(JSON.parse(saved));
      }
    } catch {
      // Ignore parse errors
    }
  }

  private saveHiddenBranches(): void {
    try {
      localStorage.setItem(
        this.getBranchStorageKey(),
        JSON.stringify([...this.hiddenBranches])
      );
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Get all available branch names from refs data
   */
  public getAvailableBranches(): { local: string[]; remote: string[] } {
    const localBranches = new Set<string>();
    const remoteBranches = new Set<string>();

    for (const refs of Object.values(this.refsByCommit)) {
      for (const ref of refs) {
        if (ref.refType === 'localBranch') {
          localBranches.add(ref.shorthand);
        } else if (ref.refType === 'remoteBranch') {
          remoteBranches.add(ref.shorthand);
        }
      }
    }

    return {
      local: [...localBranches].sort(),
      remote: [...remoteBranches].sort(),
    };
  }

  /**
   * Toggle branch visibility and re-filter the graph
   */
  public toggleBranch(branch: string): void {
    if (this.hiddenBranches.has(branch)) {
      this.hiddenBranches.delete(branch);
    } else {
      this.hiddenBranches.add(branch);
    }
    this.hiddenBranches = new Set(this.hiddenBranches); // trigger reactivity
    this.saveHiddenBranches();
    this.applyBranchFilter();
  }

  private showAllBranches(): void {
    this.hiddenBranches = new Set();
    this.saveHiddenBranches();
    this.applyBranchFilter();
  }

  private hideAllBranches(): void {
    const branches = this.getAvailableBranches();
    this.hiddenBranches = new Set([...branches.local, ...branches.remote]);
    this.saveHiddenBranches();
    this.applyBranchFilter();
  }

  private applyBranchFilter(): void {
    if (this.hiddenBranches.size === 0) {
      // No filter — use all commits
      this.processLayout();
    } else {
      // Build set of visible branch names
      const visibleBranchOids = new Set<string>();

      // Find all commit OIDs that belong to visible branches
      for (const [oid, refs] of Object.entries(this.refsByCommit)) {
        const hasVisibleBranch = refs.some(
          (ref) =>
            (ref.refType === 'localBranch' || ref.refType === 'remoteBranch') &&
            !this.hiddenBranches.has(ref.shorthand)
        );
        if (hasVisibleBranch) {
          visibleBranchOids.add(oid);
        }
      }

      // Also keep commits that have no branch refs (ancestors)
      // and commits that have tags (tags should always be visible)
      for (const [oid, refs] of Object.entries(this.refsByCommit)) {
        const hasBranchRef = refs.some(
          (ref) => ref.refType === 'localBranch' || ref.refType === 'remoteBranch'
        );
        if (!hasBranchRef) {
          visibleBranchOids.add(oid);
        }
      }

      // Include commits with no refs at all (most commits)
      for (const commit of this.commits) {
        if (!this.refsByCommit[commit.oid]) {
          visibleBranchOids.add(commit.oid);
        }
      }

      this.processLayout();
    }

    this.renderer?.markDirty();
    this.scheduleRender();
  }

  // Export methods
  /**
   * Export graph as PNG image
   */
  public exportAsImage(): void {
    if (!this.renderer || !this.virtualScroll || !this.layout) return;

    const contentSize = this.virtualScroll.getContentSize();

    // Limit export size for very large graphs
    const maxHeight = Math.min(contentSize.height + this.HEADER_HEIGHT + 40, 50000);
    const width = Math.max(contentSize.width, this.containerEl?.clientWidth ?? 800);

    // Create offscreen canvas
    const offscreen = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    offscreen.width = width * dpr;
    offscreen.height = maxHeight * dpr;

    // Create temporary renderer on offscreen canvas
    const tempRenderer = new CanvasRenderer(
      offscreen,
      {
        rowHeight: this.ROW_HEIGHT,
        laneWidth: this.LANE_WIDTH,
        nodeRadius: this.NODE_RADIUS,
        lineWidth: 2,
        showLabels: true,
        showFps: false,
        refsColumnWidth: this.refsColumnWidth,
        statsColumnWidth: this.statsColumnWidth,
      },
      getThemeFromCSS()
    );

    // Copy state to temp renderer
    if (this.renderer) {
      const stats = new Map<string, { additions: number; deletions: number; filesChanged: number }>();
      tempRenderer.setCommitStats(stats);
      tempRenderer.setHighlightedCommits(this.matchedCommitOids);
      tempRenderer.setMultiSelection(this.selectedNodes, null);
    }

    // Generate full render data (entire graph, no viewport clipping)
    const fullViewport = {
      scrollTop: 0,
      scrollLeft: 0,
      width,
      height: maxHeight,
    };
    const renderData = this.virtualScroll.getRenderData(fullViewport);
    tempRenderer.render(renderData);

    // Convert to blob and download
    offscreen.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `graph-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      URL.revokeObjectURL(url);
      tempRenderer.destroy();
    }, 'image/png');

    this.showExportMenu = false;
  }

  /**
   * Export graph as SVG
   */
  public exportAsSvg(): void {
    if (!this.layout || !this.virtualScroll) return;

    const contentSize = this.virtualScroll.getContentSize();
    const width = Math.max(contentSize.width, this.containerEl?.clientWidth ?? 800);
    const height = contentSize.height + this.HEADER_HEIGHT + 40;
    const theme = getThemeFromCSS();

    const svgParts: string[] = [];
    svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
    svgParts.push(`<rect width="100%" height="100%" fill="${theme.background}"/>`);

    const offsetX = this.PADDING;
    const offsetY = this.PADDING + this.HEADER_HEIGHT;
    const maxLane = this.layout.maxLane;

    // Draw edges
    for (const edge of this.layout.edges) {
      const fromX = offsetX + (maxLane - edge.fromLane) * this.LANE_WIDTH;
      const fromY = offsetY + edge.fromRow * this.ROW_HEIGHT;
      const toX = offsetX + (maxLane - edge.toLane) * this.LANE_WIDTH;
      const toY = offsetY + edge.toRow * this.ROW_HEIGHT;
      const color = theme.laneColors[edge.fromLane % theme.laneColors.length];

      if (edge.fromLane === edge.toLane) {
        svgParts.push(`<line x1="${fromX}" y1="${fromY}" x2="${toX}" y2="${toY}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`);
      } else {
        const midY = fromY + (toY - fromY) * 0.5;
        svgParts.push(`<path d="M${fromX},${fromY} C${fromX},${midY} ${toX},${midY} ${toX},${toY}" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round"/>`);
      }
    }

    // Draw nodes
    for (const node of this.layout.nodes.values()) {
      const x = offsetX + (maxLane - node.lane) * this.LANE_WIDTH;
      const y = offsetY + node.row * this.ROW_HEIGHT;
      const color = theme.laneColors[node.lane % theme.laneColors.length];
      const commit = this.realCommits.get(node.oid);
      const isMerge = commit && commit.parentIds.length > 1;

      if (isMerge) {
        svgParts.push(`<circle cx="${x}" cy="${y}" r="${this.NODE_RADIUS}" fill="${theme.background}" stroke="${color}" stroke-width="2"/>`);
      } else {
        svgParts.push(`<circle cx="${x}" cy="${y}" r="${this.NODE_RADIUS}" fill="${color}"/>`);
      }

      // Add commit message text
      if (commit) {
        const textX = offsetX + (maxLane + 1) * this.LANE_WIDTH + 50;
        const escapedMessage = commit.summary
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        svgParts.push(`<text x="${textX}" y="${y + 4}" fill="${theme.textColor}" font-family="system-ui, sans-serif" font-size="12">${escapedMessage}</text>`);
      }

      // Add ref labels
      const refs = this.refsByCommit[node.oid];
      if (refs?.length) {
        const labelX = offsetX + (maxLane + 1) * this.LANE_WIDTH + 30;
        for (let i = 0; i < Math.min(refs.length, 3); i++) {
          const ref = refs[i];
          const lx = labelX + i * 80;
          const escapedLabel = ref.shorthand
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          let bgColor = theme.refColors.localBranch;
          if (ref.refType === 'remoteBranch') bgColor = theme.refColors.remoteBranch;
          else if (ref.refType === 'tag') bgColor = theme.refColors.tag;
          svgParts.push(`<rect x="${lx}" y="${y - 8}" width="70" height="16" rx="3" fill="${bgColor}" opacity="0.8"/>`);
          svgParts.push(`<text x="${lx + 4}" y="${y + 3}" fill="white" font-family="system-ui, sans-serif" font-size="10">${escapedLabel}</text>`);
        }
      }
    }

    svgParts.push('</svg>');

    const svgContent = svgParts.join('\n');
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `graph-${new Date().toISOString().slice(0, 10)}.svg`;
    a.click();
    URL.revokeObjectURL(url);

    this.showExportMenu = false;
  }

  private updateRendererColumnWidths(): void {
    this.renderer?.setConfig({
      refsColumnWidth: this.refsColumnWidth,
      statsColumnWidth: this.statsColumnWidth,
    });
  }

  private handleResizeStart(e: MouseEvent, column: 'refs' | 'stats'): void {
    e.preventDefault();
    e.stopPropagation();
    this.resizing = column;
    this.resizeStartX = e.clientX;
    this.resizeStartWidth = column === 'refs'
      ? this.refsColumnWidth
      : this.statsColumnWidth;

    document.addEventListener('mousemove', this.handleResizeMove);
    document.addEventListener('mouseup', this.handleResizeEnd);
  }

  private handleResizeMove = (e: MouseEvent): void => {
    if (!this.resizing) return;

    const delta = e.clientX - this.resizeStartX;

    if (this.resizing === 'refs') {
      // Refs column: wider when dragging right
      this.refsColumnWidth = Math.max(80, Math.min(250, this.resizeStartWidth + delta));
    } else {
      // Stats column: wider when dragging left (inverted)
      this.statsColumnWidth = Math.max(50, Math.min(150, this.resizeStartWidth - delta));
    }

    this.updateRendererColumnWidths();
    this.renderer?.markDirty();
    this.scheduleRender();
  };

  private handleResizeEnd = (): void => {
    this.resizing = null;
    document.removeEventListener('mousemove', this.handleResizeMove);
    document.removeEventListener('mouseup', this.handleResizeEnd);
    this.saveColumnWidths();
  };

  private getResizeHandlePositions(): { refsEnd: number; statsStart: number } | null {
    if (!this.renderer || !this.layout) return null;
    return this.renderer.getColumnBoundaries(this.layout.maxLane, this.PADDING);
  }

  private renderGraph(): void {
    if (!this.renderer || !this.virtualScroll || !this.layout) return;

    const startTime = performance.now();

    const viewport = this.getViewport();
    const renderData = this.virtualScroll.getRenderData(viewport);

    this.lastRenderData = renderData;
    this.visibleNodes = renderData.nodes.length;

    this.renderer.render(renderData);

    const stats = this.renderer.getPerformanceStats();
    this.fps = stats.fps;
    this.renderTimeMs = performance.now() - startTime;
  }

  private renderBranchPanel() {
    const branches = this.getAvailableBranches();

    return html`
      <div class="branch-panel">
        <div class="branch-panel-header">
          <span>Branch Visibility</span>
          <div class="branch-panel-actions">
            <button @click=${() => this.showAllBranches()}>Show All</button>
            <button @click=${() => this.hideAllBranches()}>Hide All</button>
          </div>
        </div>
        <div class="branch-panel-list">
          ${branches.local.length > 0
            ? html`
                <div class="branch-group-label">Local</div>
                ${branches.local.map(
                  (branch) => html`
                    <label class="branch-item">
                      <input
                        type="checkbox"
                        .checked=${!this.hiddenBranches.has(branch)}
                        @change=${() => this.toggleBranch(branch)}
                      />
                      <span class="branch-name">${branch}</span>
                    </label>
                  `
                )}
              `
            : ''}
          ${branches.remote.length > 0
            ? html`
                <div class="branch-group-label">Remote</div>
                ${branches.remote.map(
                  (branch) => html`
                    <label class="branch-item">
                      <input
                        type="checkbox"
                        .checked=${!this.hiddenBranches.has(branch)}
                        @change=${() => this.toggleBranch(branch)}
                      />
                      <span class="branch-name">${branch}</span>
                    </label>
                  `
                )}
              `
            : ''}
        </div>
      </div>
    `;
  }

  private renderExportMenu() {
    return html`
      <div class="export-menu">
        <button class="export-menu-item" @click=${() => this.exportAsImage()}>
          Export as PNG
        </button>
        <button class="export-menu-item" @click=${() => this.exportAsSvg()}>
          Export as SVG
        </button>
      </div>
    `;
  }

  render() {
    const handlePositions = this.getResizeHandlePositions();

    return html`
      <div class="container">
        <div class="canvas-container">
          <div class="scroll-container">
            <div class="scroll-content"></div>
          </div>
          <canvas tabindex="0"></canvas>

          ${handlePositions
            ? html`
                <div
                  class="resize-handle ${this.resizing === 'refs' ? 'dragging' : ''}"
                  style="left: ${handlePositions.refsEnd}px"
                  @mousedown=${(e: MouseEvent) => this.handleResizeStart(e, 'refs')}
                ></div>
                <div
                  class="resize-handle ${this.resizing === 'stats' ? 'dragging' : ''}"
                  style="left: ${handlePositions.statsStart}px"
                  @mousedown=${(e: MouseEvent) => this.handleResizeStart(e, 'stats')}
                ></div>
              `
            : ''}

          ${this.loadError
            ? html`
                <div class="info-panel" style="background: var(--color-error-bg, #fee); border-color: var(--color-error, #f00);">
                  <div style="color: var(--color-error, #f00); font-weight: bold;">Error</div>
                  <div class="message">${this.loadError}</div>
                </div>
              `
            : ''}

          <div
            class="avatar-tooltip ${this.tooltipVisible ? 'visible' : ''}"
            style="left: ${this.tooltipX}px; top: ${this.tooltipY}px;"
          >
            <div class="author-name">${this.tooltipAuthorName}</div>
            ${this.tooltipAuthorEmail
              ? html`<div class="author-email">${this.tooltipAuthorEmail}</div>`
              : ''}
          </div>

          ${this.isLoadingStats
            ? html`
                <div class="loading-indicator">
                  <div class="spinner"></div>
                  <span>Loading stats...</span>
                </div>
              `
            : ''}

          ${this.isLoadingMore
            ? html`
                <div class="loading-indicator">
                  <div class="spinner"></div>
                  <span>Loading more commits...</span>
                </div>
              `
            : ''}

          <div class="graph-toolbar">
            <button
              class="toolbar-btn ${this.showBranchPanel ? 'active' : ''}"
              title="Toggle branch visibility"
              @click=${() => { this.showBranchPanel = !this.showBranchPanel; this.showExportMenu = false; }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="6" y1="3" x2="6" y2="15"></line>
                <circle cx="18" cy="6" r="3"></circle>
                <circle cx="6" cy="18" r="3"></circle>
                <path d="M18 9a9 9 0 01-9 9"></path>
              </svg>
              Branches
            </button>
            <button
              class="toolbar-btn ${this.showExportMenu ? 'active' : ''}"
              title="Export graph"
              @click=${() => { this.showExportMenu = !this.showExportMenu; this.showBranchPanel = false; }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Export
            </button>
          </div>

          ${this.showBranchPanel ? this.renderBranchPanel() : ''}
          ${this.showExportMenu ? this.renderExportMenu() : ''}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-graph-canvas': LvGraphCanvas;
  }
}
