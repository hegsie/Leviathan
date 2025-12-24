/**
 * Virtual Scrolling System for Graph Rendering
 *
 * Only renders visible content plus an overscan buffer.
 * Essential for maintaining 60fps with large graphs.
 */

import type { LayoutNode, LayoutEdge, GraphLayout } from './lane-assignment.ts';
import type { RefsByCommit } from '../types/git.types.ts';

export interface VirtualScrollConfig {
  /** Height of each row in pixels */
  rowHeight: number;
  /** Width of each lane in pixels */
  laneWidth: number;
  /** Padding around the graph */
  padding: number;
  /** Number of rows to render outside viewport (overscan) */
  overscanRows: number;
}

export interface Viewport {
  /** Scroll position from top */
  scrollTop: number;
  /** Scroll position from left */
  scrollLeft: number;
  /** Visible width */
  width: number;
  /** Visible height */
  height: number;
}

export interface VisibleRange {
  /** First visible row (inclusive) */
  startRow: number;
  /** Last visible row (inclusive) */
  endRow: number;
  /** First visible lane (inclusive) */
  startLane: number;
  /** Last visible lane (inclusive) */
  endLane: number;
}

/** Pull request info for graph display */
export interface GraphPullRequest {
  /** PR number */
  number: number;
  /** PR state (open, closed, merged) */
  state: string;
  /** Whether it's a draft */
  draft: boolean;
  /** URL to open in browser */
  url: string;
}

export interface RenderData {
  /** Nodes to render */
  nodes: LayoutNode[];
  /** Edges to render */
  edges: LayoutEdge[];
  /** Visible range */
  range: VisibleRange;
  /** Offset for rendering (accounts for scroll position) */
  offsetX: number;
  offsetY: number;
  /** Refs by commit OID */
  refsByCommit: RefsByCommit;
  /** Author emails by commit OID for avatar loading */
  authorEmails: Record<string, string>;
  /** Maximum lane in the graph (for label positioning) */
  maxLane: number;
  /** Pull requests by commit SHA (head commit of PR) */
  pullRequestsByCommit?: Record<string, GraphPullRequest[]>;
}

const DEFAULT_CONFIG: VirtualScrollConfig = {
  rowHeight: 28,
  laneWidth: 24,
  padding: 20,
  overscanRows: 15,
};

/**
 * Virtual scroll manager for graph rendering
 */
export class VirtualScrollManager {
  private config: VirtualScrollConfig;
  private layout: GraphLayout | null = null;
  private nodesByRow: Map<number, LayoutNode[]> = new Map();
  private edgesByRowRange: Map<string, LayoutEdge[]> = new Map();
  private refsByCommit: RefsByCommit = {};
  private authorEmails: Record<string, string> = {};
  private pullRequestsByCommit: Record<string, GraphPullRequest[]> = {};

  constructor(config: Partial<VirtualScrollConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set refs by commit
   */
  setRefs(refs: RefsByCommit): void {
    this.refsByCommit = refs;
  }

  /**
   * Set author emails by commit OID
   */
  setAuthorEmails(emails: Record<string, string>): void {
    this.authorEmails = emails;
  }

  /**
   * Set pull requests by commit SHA
   */
  setPullRequests(prs: Record<string, GraphPullRequest[]>): void {
    this.pullRequestsByCommit = prs;
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<VirtualScrollConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set the layout to virtualize
   */
  setLayout(layout: GraphLayout): void {
    this.layout = layout;
    this.buildIndices();
  }

  /**
   * Build row-based indices for fast lookup
   */
  private buildIndices(): void {
    this.nodesByRow.clear();
    this.edgesByRowRange.clear();

    if (!this.layout) return;

    // Index nodes by row
    for (const node of this.layout.nodes.values()) {
      let rowNodes = this.nodesByRow.get(node.row);
      if (!rowNodes) {
        rowNodes = [];
        this.nodesByRow.set(node.row, rowNodes);
      }
      rowNodes.push(node);
    }

    // Index edges by row range (for quick filtering)
    // Group edges by their row span to optimize lookups
    for (const edge of this.layout.edges) {
      const minRow = Math.min(edge.fromRow, edge.toRow);
      const maxRow = Math.max(edge.fromRow, edge.toRow);
      const key = `${minRow}-${maxRow}`;

      let rangeEdges = this.edgesByRowRange.get(key);
      if (!rangeEdges) {
        rangeEdges = [];
        this.edgesByRowRange.set(key, rangeEdges);
      }
      rangeEdges.push(edge);
    }
  }

  /**
   * Calculate total content dimensions
   */
  getContentSize(): { width: number; height: number } {
    if (!this.layout) {
      return { width: 0, height: 0 };
    }

    const width =
      (this.layout.maxLane + 1) * this.config.laneWidth + this.config.padding * 2;
    const height =
      this.layout.totalRows * this.config.rowHeight + this.config.padding * 2;

    return { width, height };
  }

  /**
   * Calculate visible range from viewport
   */
  getVisibleRange(viewport: Viewport): VisibleRange {
    if (!this.layout) {
      return { startRow: 0, endRow: 0, startLane: 0, endLane: 0 };
    }

    const { rowHeight, laneWidth, padding, overscanRows } = this.config;

    // Calculate visible rows
    const startRow = Math.max(
      0,
      Math.floor((viewport.scrollTop - padding) / rowHeight) - overscanRows
    );
    const endRow = Math.min(
      this.layout.totalRows - 1,
      Math.ceil((viewport.scrollTop + viewport.height - padding) / rowHeight) + overscanRows
    );

    // Calculate visible lanes
    const startLane = Math.max(
      0,
      Math.floor((viewport.scrollLeft - padding) / laneWidth) - 2
    );
    const endLane = Math.min(
      this.layout.maxLane,
      Math.ceil((viewport.scrollLeft + viewport.width - padding) / laneWidth) + 2
    );

    return { startRow, endRow, startLane, endLane };
  }

  /**
   * Get render data for current viewport
   */
  getRenderData(viewport: Viewport): RenderData {
    const range = this.getVisibleRange(viewport);
    const nodes = this.getVisibleNodes(range);
    const edges = this.getVisibleEdges(range);

    return {
      nodes,
      edges,
      range,
      offsetX: this.config.padding - viewport.scrollLeft,
      offsetY: this.config.padding - viewport.scrollTop,
      refsByCommit: this.refsByCommit,
      authorEmails: this.authorEmails,
      maxLane: this.layout?.maxLane ?? 0,
      pullRequestsByCommit: this.pullRequestsByCommit,
    };
  }

  /**
   * Get nodes in visible range
   */
  private getVisibleNodes(range: VisibleRange): LayoutNode[] {
    const nodes: LayoutNode[] = [];

    for (let row = range.startRow; row <= range.endRow; row++) {
      const rowNodes = this.nodesByRow.get(row);
      if (rowNodes) {
        for (const node of rowNodes) {
          if (node.lane >= range.startLane && node.lane <= range.endLane) {
            nodes.push(node);
          }
        }
      }
    }

    return nodes;
  }

  /**
   * Get edges that intersect visible range
   */
  private getVisibleEdges(range: VisibleRange): LayoutEdge[] {
    if (!this.layout) return [];

    const edges: LayoutEdge[] = [];
    const seen = new Set<LayoutEdge>();

    // Check all edge row ranges that might intersect our viewport
    for (const [key, rangeEdges] of this.edgesByRowRange) {
      const [minRowStr, maxRowStr] = key.split('-');
      const minRow = parseInt(minRowStr, 10);
      const maxRow = parseInt(maxRowStr, 10);

      // Check if this range intersects viewport
      if (maxRow >= range.startRow && minRow <= range.endRow) {
        for (const edge of rangeEdges) {
          if (seen.has(edge)) continue;

          // Check lane intersection
          const minLane = Math.min(edge.fromLane, edge.toLane);
          const maxLane = Math.max(edge.fromLane, edge.toLane);

          if (maxLane >= range.startLane && minLane <= range.endLane) {
            edges.push(edge);
            seen.add(edge);
          }
        }
      }
    }

    return edges;
  }

  /**
   * Convert screen coordinates to graph coordinates
   */
  screenToGraph(
    screenX: number,
    screenY: number,
    viewport: Viewport
  ): { row: number; lane: number; x: number; y: number } {
    const graphX = screenX + viewport.scrollLeft - this.config.padding;
    const graphY = screenY + viewport.scrollTop - this.config.padding;

    return {
      row: Math.floor(graphY / this.config.rowHeight),
      lane: Math.floor(graphX / this.config.laneWidth),
      x: graphX,
      y: graphY,
    };
  }

  /**
   * Convert graph coordinates to screen coordinates
   */
  graphToScreen(
    row: number,
    lane: number,
    viewport: Viewport
  ): { x: number; y: number } {
    return {
      x: lane * this.config.laneWidth + this.config.padding - viewport.scrollLeft,
      y: row * this.config.rowHeight + this.config.padding - viewport.scrollTop,
    };
  }

  /**
   * Scroll to bring a specific node into view
   */
  scrollToNode(
    node: LayoutNode,
    viewport: Viewport,
    align: 'start' | 'center' | 'end' = 'center'
  ): { scrollTop: number; scrollLeft: number } {
    const nodeY = node.row * this.config.rowHeight + this.config.padding;
    const nodeX = node.lane * this.config.laneWidth + this.config.padding;

    let scrollTop: number;
    let scrollLeft: number;

    switch (align) {
      case 'start':
        scrollTop = nodeY - this.config.padding;
        scrollLeft = nodeX - this.config.padding;
        break;
      case 'end':
        scrollTop = nodeY - viewport.height + this.config.rowHeight + this.config.padding;
        scrollLeft = nodeX - viewport.width + this.config.laneWidth + this.config.padding;
        break;
      case 'center':
      default:
        scrollTop = nodeY - viewport.height / 2;
        scrollLeft = nodeX - viewport.width / 2;
    }

    // Clamp to valid range
    const { width, height } = this.getContentSize();
    scrollTop = Math.max(0, Math.min(scrollTop, height - viewport.height));
    scrollLeft = Math.max(0, Math.min(scrollLeft, width - viewport.width));

    return { scrollTop, scrollLeft };
  }
}

/**
 * Scroll state manager with momentum scrolling support
 */
export class ScrollStateManager {
  private scrollTop = 0;
  private scrollLeft = 0;
  private velocityY = 0;
  private velocityX = 0;
  private isAnimating = false;
  private animationFrame: number = 0;
  private friction = 0.95;
  private minVelocity = 0.5;

  private onChange?: (scrollTop: number, scrollLeft: number) => void;

  constructor(onChange?: (scrollTop: number, scrollLeft: number) => void) {
    this.onChange = onChange;
  }

  getScroll(): { scrollTop: number; scrollLeft: number } {
    return { scrollTop: this.scrollTop, scrollLeft: this.scrollLeft };
  }

  setScroll(scrollTop: number, scrollLeft: number): void {
    this.scrollTop = scrollTop;
    this.scrollLeft = scrollLeft;
    this.onChange?.(this.scrollTop, this.scrollLeft);
  }

  /**
   * Handle wheel event with momentum
   */
  handleWheel(deltaX: number, deltaY: number, maxScrollX: number, maxScrollY: number): void {
    // Cancel any ongoing momentum animation
    this.stopMomentum();

    // Apply scroll
    this.scrollTop = Math.max(0, Math.min(this.scrollTop + deltaY, maxScrollY));
    this.scrollLeft = Math.max(0, Math.min(this.scrollLeft + deltaX, maxScrollX));

    // Set velocity for momentum
    this.velocityY = deltaY * 0.5;
    this.velocityX = deltaX * 0.5;

    this.onChange?.(this.scrollTop, this.scrollLeft);

    // Start momentum animation
    this.startMomentum(maxScrollX, maxScrollY);
  }

  private startMomentum(maxScrollX: number, maxScrollY: number): void {
    if (this.isAnimating) return;

    const animate = () => {
      // Apply friction
      this.velocityX *= this.friction;
      this.velocityY *= this.friction;

      // Check if we should stop
      if (
        Math.abs(this.velocityX) < this.minVelocity &&
        Math.abs(this.velocityY) < this.minVelocity
      ) {
        this.stopMomentum();
        return;
      }

      // Apply velocity
      this.scrollTop = Math.max(0, Math.min(this.scrollTop + this.velocityY, maxScrollY));
      this.scrollLeft = Math.max(0, Math.min(this.scrollLeft + this.velocityX, maxScrollX));

      this.onChange?.(this.scrollTop, this.scrollLeft);

      this.animationFrame = requestAnimationFrame(animate);
    };

    this.isAnimating = true;
    this.animationFrame = requestAnimationFrame(animate);
  }

  stopMomentum(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    this.isAnimating = false;
    this.velocityX = 0;
    this.velocityY = 0;
  }

  destroy(): void {
    this.stopMomentum();
  }
}
