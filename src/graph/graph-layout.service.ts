/**
 * Graph Layout Service
 *
 * Provides high-level API for graph layout calculations
 * with caching and performance optimizations.
 */

import {
  assignLanes,
  assignLanesOptimized,
  validateLayout,
  type GraphCommit,
  type GraphLayout,
  type LayoutNode,
  type LayoutEdge,
} from './lane-assignment.ts';

export interface GraphLayoutOptions {
  /** Use optimized algorithm (better quality, slightly slower) */
  optimized?: boolean;
  /** Enable validation checks (development only) */
  validate?: boolean;
}

export interface LayoutMetrics {
  /** Time to compute layout in milliseconds */
  computeTimeMs: number;
  /** Number of commits processed */
  commitCount: number;
  /** Maximum lane used */
  maxLane: number;
  /** Number of edge crossings (lower is better) */
  edgeCrossings: number;
  /** Average lane changes per commit path */
  avgLaneChanges: number;
}

export interface GraphLayoutResult {
  layout: GraphLayout;
  metrics: LayoutMetrics;
  errors: string[];
}

/**
 * Compute graph layout for commits
 */
export function computeGraphLayout(
  commits: GraphCommit[],
  options: GraphLayoutOptions = {}
): GraphLayoutResult {
  const { optimized = true, validate = false } = options;

  const startTime = performance.now();

  // Compute layout
  const layout = optimized ? assignLanesOptimized(commits) : assignLanes(commits);

  const computeTimeMs = performance.now() - startTime;

  // Validate if requested
  const errors = validate ? validateLayout(layout, commits) : [];

  // Calculate metrics
  const metrics = calculateMetrics(layout, computeTimeMs, commits.length);

  return { layout, metrics, errors };
}

/**
 * Calculate quality metrics for a layout
 */
function calculateMetrics(
  layout: GraphLayout,
  computeTimeMs: number,
  commitCount: number
): LayoutMetrics {
  // Count edge crossings
  const edgeCrossings = countEdgeCrossings(layout.edges);

  // Calculate average lane changes
  const avgLaneChanges = calculateAvgLaneChanges(layout);

  return {
    computeTimeMs,
    commitCount,
    maxLane: layout.maxLane,
    edgeCrossings,
    avgLaneChanges,
  };
}

/**
 * Count the number of edge crossings in the graph
 * Two edges cross if they span overlapping row ranges and cross lanes
 */
function countEdgeCrossings(edges: LayoutEdge[]): number {
  let crossings = 0;

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (edgesCross(edges[i], edges[j])) {
        crossings++;
      }
    }
  }

  return crossings;
}

/**
 * Check if two edges cross
 */
function edgesCross(e1: LayoutEdge, e2: LayoutEdge): boolean {
  // Check if row ranges overlap
  const e1MinRow = Math.min(e1.fromRow, e1.toRow);
  const e1MaxRow = Math.max(e1.fromRow, e1.toRow);
  const e2MinRow = Math.min(e2.fromRow, e2.toRow);
  const e2MaxRow = Math.max(e2.fromRow, e2.toRow);

  // No overlap in rows = no crossing
  if (e1MaxRow <= e2MinRow || e2MaxRow <= e1MinRow) {
    return false;
  }

  // Check if lanes cross
  // Edges cross if one goes left-to-right and other goes right-to-left
  // in the overlapping region
  const e1Dir = e1.toLane - e1.fromLane;
  const e2Dir = e2.toLane - e2.fromLane;

  // Same direction = no crossing
  if (e1Dir * e2Dir >= 0) {
    // Check if they overlap in lane space
    const e1MinLane = Math.min(e1.fromLane, e1.toLane);
    const e1MaxLane = Math.max(e1.fromLane, e1.toLane);
    const e2MinLane = Math.min(e2.fromLane, e2.toLane);
    const e2MaxLane = Math.max(e2.fromLane, e2.toLane);

    if (e1MaxLane < e2MinLane || e2MaxLane < e1MinLane) {
      return false;
    }
  }

  // Opposite directions in overlapping region = crossing
  if (e1Dir !== 0 && e2Dir !== 0 && e1Dir * e2Dir < 0) {
    return true;
  }

  return false;
}

/**
 * Calculate average lane changes following parent paths
 */
function calculateAvgLaneChanges(layout: GraphLayout): number {
  if (layout.nodes.size === 0) return 0;

  let totalChanges = 0;
  let pathCount = 0;

  for (const node of layout.nodes.values()) {
    for (const parentLane of node.parentLanes) {
      if (parentLane !== node.lane) {
        totalChanges++;
      }
      pathCount++;
    }
  }

  return pathCount > 0 ? totalChanges / pathCount : 0;
}

/**
 * Get visible nodes for a viewport (for virtual scrolling)
 */
export function getVisibleNodes(
  layout: GraphLayout,
  startRow: number,
  endRow: number,
  overscan: number = 5
): LayoutNode[] {
  const minRow = Math.max(0, startRow - overscan);
  const maxRow = Math.min(layout.totalRows - 1, endRow + overscan);

  const visible: LayoutNode[] = [];

  for (const node of layout.nodes.values()) {
    if (node.row >= minRow && node.row <= maxRow) {
      visible.push(node);
    }
  }

  return visible.sort((a, b) => a.row - b.row);
}

/**
 * Get edges that are visible in a viewport
 */
export function getVisibleEdges(
  layout: GraphLayout,
  startRow: number,
  endRow: number,
  overscan: number = 5
): LayoutEdge[] {
  const minRow = Math.max(0, startRow - overscan);
  const maxRow = Math.min(layout.totalRows - 1, endRow + overscan);

  return layout.edges.filter((edge) => {
    const edgeMinRow = Math.min(edge.fromRow, edge.toRow);
    const edgeMaxRow = Math.max(edge.fromRow, edge.toRow);
    return edgeMaxRow >= minRow && edgeMinRow <= maxRow;
  });
}

/**
 * Color palette for branch lanes
 */
const LANE_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#ef4444', // red
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
  '#f97316', // orange
  '#6366f1', // indigo
];

/**
 * Get color for a lane
 */
export function getLaneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

/**
 * Convert layout to a simple ASCII representation for debugging
 */
export function layoutToAscii(layout: GraphLayout): string {
  if (layout.nodes.size === 0) return '(empty)';

  const lines: string[] = [];
  const width = (layout.maxLane + 1) * 4;

  // Sort nodes by row
  const sortedNodes = [...layout.nodes.values()].sort((a, b) => a.row - b.row);

  for (const node of sortedNodes) {
    let line = ' '.repeat(width);
    const pos = node.lane * 4;

    // Place the node
    const chars = line.split('');
    chars[pos] = '*';

    // Add short OID
    const shortOid = node.oid.substring(0, 3);
    for (let i = 0; i < shortOid.length && pos + 1 + i < chars.length; i++) {
      chars[pos + 1 + i] = shortOid[i];
    }

    lines.push(chars.join(''));
  }

  return lines.join('\n');
}

// Re-export types
export type { GraphLayout, LayoutNode, LayoutEdge };
