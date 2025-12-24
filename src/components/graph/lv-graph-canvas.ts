import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { sharedStyles } from '../../styles/shared-styles.ts';
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
import { getCommitHistory, getRefsByCommit, getCommitsStats } from '../../services/git.service.ts';
import type { Commit, RefsByCommit, RefInfo } from '../../types/git.types.ts';

export interface CommitSelectedEvent {
  commit: Commit | null;
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
        left: 0;
        right: 0;
        bottom: 0;
        overflow: auto;
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
    `,
  ];

  @property({ type: Number }) commitCount = 1000;
  @property({ type: String }) repositoryPath = '';
  @property({ type: Object }) searchFilter: { query: string; author: string; dateFrom: string; dateTo: string } | null = null;

  @state() private layout: GraphLayout | null = null;
  @state() private selectedNode: LayoutNode | null = null;
  @state() private hoveredNode: LayoutNode | null = null;
  @state() private fps = 0;
  @state() private renderTimeMs = 0;
  @state() private visibleNodes = 0;
  @state() private isLoading = false;
  @state() private loadError: string | null = null;

  @query('.canvas-container') private containerEl!: HTMLDivElement;
  @query('canvas') private canvasEl!: HTMLCanvasElement;
  @query('.scroll-container') private scrollEl!: HTMLDivElement;

  private commits: GraphCommit[] = [];
  private realCommits: Map<string, Commit> = new Map();
  private refsByCommit: RefsByCommit = {};
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

  // Config - balanced size
  private readonly ROW_HEIGHT = 28;
  private readonly LANE_WIDTH = 24;
  private readonly PADDING = 20;
  private readonly NODE_RADIUS = 6;

  connectedCallback(): void {
    super.connectedCallback();
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

    // Wheel scrolling
    this.containerEl.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });

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

  private async loadCommits(): Promise<void> {
    if (!this.repositoryPath) {
      this.loadError = 'No repository path specified';
      return;
    }

    this.isLoading = true;
    this.loadError = null;
    const startTime = performance.now();

    try {
      // Fetch commits and refs in parallel
      const [commitsResult, refsResult] = await Promise.all([
        getCommitHistory({
          path: this.repositoryPath,
          limit: this.commitCount,
          allBranches: true,
        }),
        getRefsByCommit(this.repositoryPath),
      ]);

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

      // Convert commits to GraphCommit format for layout
      this.commits = commitsResult.data.map(commitToGraphCommit);
      this.processLayout();
      console.log(`Loaded ${this.commits.length} real commits in ${(performance.now() - startTime).toFixed(2)}ms`);
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : 'Unknown error loading commits';
    } finally {
      this.isLoading = false;
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

    // Update scroll content size
    this.updateScrollContentSize();

    // Rebuild spatial index
    this.rebuildSpatialIndex();

    // Mark dirty and render
    this.renderer?.markDirty();
    this.scheduleRender();

    // Fetch real commit stats asynchronously (don't block initial render)
    this.fetchCommitStats();
  }

  private async fetchCommitStats(): Promise<void> {
    if (!this.repositoryPath || this.realCommits.size === 0) return;

    const commitOids = [...this.realCommits.keys()];

    // Fetch in batches to avoid overwhelming the backend
    const batchSize = 100;
    const allStats = new Map<string, number>();

    for (let i = 0; i < commitOids.length; i += batchSize) {
      const batch = commitOids.slice(i, i + batchSize);
      const result = await getCommitsStats(this.repositoryPath, batch);

      if (result.success && result.data) {
        for (const stat of result.data) {
          // Total changes = additions + deletions
          allStats.set(stat.oid, stat.additions + stat.deletions);
        }
      }
    }

    // Update renderer with real stats
    if (allStats.size > 0) {
      this.renderer?.setCommitStats(allStats);
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

    const width = this.containerEl.clientWidth;
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

    this.renderer?.setSelection(
      this.selectedNode?.oid ?? null,
      this.hoveredNode?.oid ?? null
    );
    this.renderer?.markDirty();
    this.scheduleRender();
  }

  private handleClick(e: MouseEvent): void {
    const result = this.hitTest(e);

    if (result.type === 'node' && result.node) {
      this.selectedNode = result.node;
    } else {
      this.selectedNode = null;
    }

    // Focus canvas for keyboard navigation
    this.canvasEl.focus();

    // Dispatch selection event
    this.dispatchSelectionEvent();

    this.renderer?.setSelection(
      this.selectedNode?.oid ?? null,
      this.hoveredNode?.oid ?? null
    );
    this.renderer?.markDirty();
    this.scheduleRender();
  }

  private handleMouseLeave(): void {
    this.hoveredNode = null;
    this.canvasEl.classList.remove('pointer');
    this.renderer?.setSelection(this.selectedNode?.oid ?? null, null);
    this.renderer?.markDirty();
    this.scheduleRender();
  }

  private handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();

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

        this.renderer?.setSelection(
          this.selectedNode?.oid ?? null,
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
        this.dispatchSelectionEvent();
        this.renderer?.setSelection(null, this.hoveredNode?.oid ?? null);
        this.renderer?.markDirty();
        this.scheduleRender();
        return;

      default:
        return;
    }

    if (newIndex >= 0 && newIndex !== currentIndex) {
      this.selectedNode = this.sortedNodesByRow[newIndex];
      this.dispatchSelectionEvent();
      this.scrollToNode(this.selectedNode);
      this.renderer?.setSelection(this.selectedNode.oid, this.hoveredNode?.oid ?? null);
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
    }
  }

  /**
   * Public method to select and scroll to a commit by OID
   * Used by other components (like commit details panel) to navigate the graph
   */
  public selectCommit(oid: string): boolean {
    console.log('[graph] selectCommit called with oid:', oid);

    if (!this.layout) {
      console.log('[graph] selectCommit: no layout available');
      return false;
    }

    const node = this.layout.nodes.get(oid);
    if (!node) {
      console.log('[graph] selectCommit: node not found for oid:', oid);
      console.log('[graph] available nodes count:', this.layout.nodes.size);
      return false;
    }

    console.log('[graph] selectCommit: found node at row', node.row, 'lane', node.lane);

    // Update selection state first
    this.selectedNode = node;
    this.renderer?.setSelection(this.selectedNode.oid, this.hoveredNode?.oid ?? null);

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

    console.log('[graph] selectCommit: completed, viewport:', this.getViewport());

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
    this.dispatchSelectionEvent();
    this.scrollToNode(this.selectedNode);
    this.renderer?.setSelection(this.selectedNode.oid, this.hoveredNode?.oid ?? null);
    this.renderer?.markDirty();
    this.scheduleRender();
  }

  private hitTest(e: MouseEvent): HitTestResult {
    const rect = this.canvasEl.getBoundingClientRect();
    const viewport = this.getViewport();

    // Convert screen coords to graph coords
    const graphX = e.clientX - rect.left + viewport.scrollLeft;
    const graphY = e.clientY - rect.top + viewport.scrollTop;

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

  private dispatchSelectionEvent(): void {
    let commit: Commit | null = null;
    let refs: RefInfo[] = [];

    if (this.selectedNode) {
      // Get real commit data if available
      commit = this.realCommits.get(this.selectedNode.oid) ?? null;
      // Get refs for this commit
      refs = this.refsByCommit[this.selectedNode.oid] ?? [];
    }

    console.log('[graph] dispatching commit-selected:', {
      selectedNodeOid: this.selectedNode?.oid,
      commitFound: !!commit,
      commitOid: commit?.oid,
      refsCount: refs.length,
    });

    this.dispatchEvent(
      new CustomEvent<CommitSelectedEvent>('commit-selected', {
        detail: { commit, refs },
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

  render() {
    return html`
      <div class="container">
        <div class="canvas-container">
          <div class="scroll-container">
            <div class="scroll-content"></div>
          </div>
          <canvas tabindex="0"></canvas>

          ${this.loadError
            ? html`
                <div class="info-panel" style="background: var(--color-error-bg, #fee); border-color: var(--color-error, #f00);">
                  <div style="color: var(--color-error, #f00); font-weight: bold;">Error</div>
                  <div class="message">${this.loadError}</div>
                </div>
              `
            : ''}
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
