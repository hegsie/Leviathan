/**
 * Spatial Index for Fast Hit Testing
 *
 * Uses a grid-based spatial hash for O(1) average lookup time.
 * Essential for maintaining <1ms hit test latency with large graphs.
 */

import type { LayoutNode, LayoutEdge } from './lane-assignment.ts';

export interface SpatialIndexOptions {
  /** Cell size in pixels */
  cellSize?: number;
  /** Node hit radius in pixels */
  nodeRadius?: number;
  /** Edge hit tolerance in pixels */
  edgeTolerance?: number;
}

export interface HitTestResult {
  type: 'node' | 'edge' | 'none';
  node?: LayoutNode;
  edge?: LayoutEdge;
  distance: number;
}

interface GridCell {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

/**
 * Grid-based spatial index for fast hit testing
 */
export class SpatialIndex {
  private grid: Map<string, GridCell> = new Map();
  private cellSize: number;
  private nodeRadius: number;
  private edgeTolerance: number;

  // Coordinate transformation
  private offsetX: number = 0;
  private offsetY: number = 0;
  private rowHeight: number = 28;
  private laneWidth: number = 20;
  private maxLane: number = 0;

  constructor(options: SpatialIndexOptions = {}) {
    this.cellSize = options.cellSize ?? 50;
    this.nodeRadius = options.nodeRadius ?? 8;
    this.edgeTolerance = options.edgeTolerance ?? 5;
  }

  /**
   * Configure coordinate transformation
   */
  configure(params: {
    offsetX: number;
    offsetY: number;
    rowHeight: number;
    laneWidth: number;
    maxLane?: number;
  }): void {
    this.offsetX = params.offsetX;
    this.offsetY = params.offsetY;
    this.rowHeight = params.rowHeight;
    this.laneWidth = params.laneWidth;
    this.maxLane = params.maxLane ?? 0;
  }

  /**
   * Get X coordinate for a lane (mirrored: lane 0 on right)
   */
  private getLaneX(lane: number): number {
    const graphEndX = this.offsetX + (this.maxLane + 1) * this.laneWidth;
    return graphEndX - (lane + 1) * this.laneWidth + this.laneWidth / 2;
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.grid.clear();
  }

  /**
   * Build the index from layout data
   */
  build(nodes: LayoutNode[], edges: LayoutEdge[]): void {
    this.clear();

    // Index nodes
    for (const node of nodes) {
      const x = this.getLaneX(node.lane);
      const y = this.offsetY + node.row * this.rowHeight;
      this.addNodeToGrid(node, x, y);
    }

    // Index edges
    for (const edge of edges) {
      this.addEdgeToGrid(edge);
    }
  }

  /**
   * Build index for only visible nodes/edges (for virtual scrolling)
   */
  buildVisible(
    nodes: LayoutNode[],
    edges: LayoutEdge[],
    viewportTop: number,
    viewportBottom: number
  ): void {
    this.clear();

    // Only index nodes in viewport
    for (const node of nodes) {
      const y = this.offsetY + node.row * this.rowHeight;
      if (y >= viewportTop - this.cellSize && y <= viewportBottom + this.cellSize) {
        const x = this.getLaneX(node.lane);
        this.addNodeToGrid(node, x, y);
      }
    }

    // Only index edges that intersect viewport
    for (const edge of edges) {
      const y1 = this.offsetY + edge.fromRow * this.rowHeight;
      const y2 = this.offsetY + edge.toRow * this.rowHeight;
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);

      if (maxY >= viewportTop - this.cellSize && minY <= viewportBottom + this.cellSize) {
        this.addEdgeToGrid(edge);
      }
    }
  }

  /**
   * Add a node to the grid
   */
  private addNodeToGrid(node: LayoutNode, x: number, y: number): void {
    // Add node to all cells it might intersect (including radius)
    const minCellX = Math.floor((x - this.nodeRadius) / this.cellSize);
    const maxCellX = Math.floor((x + this.nodeRadius) / this.cellSize);
    const minCellY = Math.floor((y - this.nodeRadius) / this.cellSize);
    const maxCellY = Math.floor((y + this.nodeRadius) / this.cellSize);

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const key = `${cx},${cy}`;
        let cell = this.grid.get(key);
        if (!cell) {
          cell = { nodes: [], edges: [] };
          this.grid.set(key, cell);
        }
        cell.nodes.push(node);
      }
    }
  }

  /**
   * Add an edge to the grid
   */
  private addEdgeToGrid(edge: LayoutEdge): void {
    const x1 = this.getLaneX(edge.fromLane);
    const y1 = this.offsetY + edge.fromRow * this.rowHeight;
    const x2 = this.getLaneX(edge.toLane);
    const y2 = this.offsetY + edge.toRow * this.rowHeight;

    // Get bounding box of edge
    const minX = Math.min(x1, x2) - this.edgeTolerance;
    const maxX = Math.max(x1, x2) + this.edgeTolerance;
    const minY = Math.min(y1, y2) - this.edgeTolerance;
    const maxY = Math.max(y1, y2) + this.edgeTolerance;

    const minCellX = Math.floor(minX / this.cellSize);
    const maxCellX = Math.floor(maxX / this.cellSize);
    const minCellY = Math.floor(minY / this.cellSize);
    const maxCellY = Math.floor(maxY / this.cellSize);

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const key = `${cx},${cy}`;
        let cell = this.grid.get(key);
        if (!cell) {
          cell = { nodes: [], edges: [] };
          this.grid.set(key, cell);
        }
        cell.edges.push(edge);
      }
    }
  }

  /**
   * Hit test at a point
   */
  hitTest(x: number, y: number): HitTestResult {
    const cellX = Math.floor(x / this.cellSize);
    const cellY = Math.floor(y / this.cellSize);
    const key = `${cellX},${cellY}`;

    const cell = this.grid.get(key);
    if (!cell) {
      return { type: 'none', distance: Infinity };
    }

    // Check nodes first (they take priority)
    let closestNode: LayoutNode | undefined;
    let closestNodeDist = Infinity;

    for (const node of cell.nodes) {
      const nodeX = this.getLaneX(node.lane);
      const nodeY = this.offsetY + node.row * this.rowHeight;
      const dist = Math.sqrt((x - nodeX) ** 2 + (y - nodeY) ** 2);

      if (dist <= this.nodeRadius && dist < closestNodeDist) {
        closestNode = node;
        closestNodeDist = dist;
      }
    }

    if (closestNode) {
      return { type: 'node', node: closestNode, distance: closestNodeDist };
    }

    // Check edges
    let closestEdge: LayoutEdge | undefined;
    let closestEdgeDist = Infinity;

    for (const edge of cell.edges) {
      const dist = this.pointToEdgeDistance(x, y, edge);

      if (dist <= this.edgeTolerance && dist < closestEdgeDist) {
        closestEdge = edge;
        closestEdgeDist = dist;
      }
    }

    if (closestEdge) {
      return { type: 'edge', edge: closestEdge, distance: closestEdgeDist };
    }

    return { type: 'none', distance: Infinity };
  }

  /**
   * Calculate distance from point to edge
   */
  private pointToEdgeDistance(px: number, py: number, edge: LayoutEdge): number {
    const x1 = this.getLaneX(edge.fromLane);
    const y1 = this.offsetY + edge.fromRow * this.rowHeight;
    const x2 = this.getLaneX(edge.toLane);
    const y2 = this.offsetY + edge.toRow * this.rowHeight;

    if (edge.fromLane === edge.toLane) {
      // Straight vertical line
      if (py < Math.min(y1, y2) || py > Math.max(y1, y2)) {
        // Point is outside line segment
        return Math.min(
          Math.sqrt((px - x1) ** 2 + (py - y1) ** 2),
          Math.sqrt((px - x2) ** 2 + (py - y2) ** 2)
        );
      }
      return Math.abs(px - x1);
    }

    // For bezier curves, approximate with line segments
    // This is faster than exact bezier distance calculation
    const segments = 10;
    let minDist = Infinity;

    for (let i = 0; i < segments; i++) {
      const t1 = i / segments;
      const t2 = (i + 1) / segments;

      const p1 = this.bezierPoint(x1, y1, x2, y2, t1);
      const p2 = this.bezierPoint(x1, y1, x2, y2, t2);

      const dist = this.pointToSegmentDistance(px, py, p1.x, p1.y, p2.x, p2.y);
      minDist = Math.min(minDist, dist);
    }

    return minDist;
  }

  /**
   * Get point on bezier curve at parameter t
   */
  private bezierPoint(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    t: number
  ): { x: number; y: number } {
    const midY = (y1 + y2) / 2;
    // Cubic bezier: P = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
    // Control points: (x1, y1), (x1, midY), (x2, midY), (x2, y2)
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;

    return {
      x: mt3 * x1 + 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t3 * x2,
      y: mt3 * y1 + 3 * mt2 * t * midY + 3 * mt * t2 * midY + t3 * y2,
    };
  }

  /**
   * Distance from point to line segment
   */
  private pointToSegmentDistance(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;

    if (lengthSq === 0) {
      return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    }

    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    const nearestX = x1 + t * dx;
    const nearestY = y1 + t * dy;

    return Math.sqrt((px - nearestX) ** 2 + (py - nearestY) ** 2);
  }

  /**
   * Get statistics about the index
   */
  getStats(): { cellCount: number; avgNodesPerCell: number; avgEdgesPerCell: number } {
    let totalNodes = 0;
    let totalEdges = 0;

    for (const cell of this.grid.values()) {
      totalNodes += cell.nodes.length;
      totalEdges += cell.edges.length;
    }

    const cellCount = this.grid.size;

    return {
      cellCount,
      avgNodesPerCell: cellCount > 0 ? totalNodes / cellCount : 0,
      avgEdgesPerCell: cellCount > 0 ? totalEdges / cellCount : 0,
    };
  }
}
