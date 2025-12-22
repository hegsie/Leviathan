/**
 * Lane Assignment Algorithm for Git Graph Visualization
 *
 * This algorithm assigns each commit to a horizontal lane (column) to create
 * a readable visualization of git history. The goals are:
 * 1. Minimize lane crossings
 * 2. Keep related commits (same branch) in the same lane
 * 3. Reuse lanes when branches end
 * 4. Handle merge commits with multiple parents
 */

/**
 * Commit data required for graph layout
 */
export interface GraphCommit {
  oid: string;
  parentIds: string[];
  timestamp: number;
  message: string;
  author: string;
  branch?: string;
}

export interface LayoutNode {
  oid: string;
  row: number;
  lane: number;
  commit: GraphCommit;
  childLanes: number[];
  parentLanes: number[];
}

export interface LayoutEdge {
  fromOid: string;
  toOid: string;
  fromRow: number;
  toRow: number;
  fromLane: number;
  toLane: number;
  isMerge: boolean;
}

export interface GraphLayout {
  nodes: Map<string, LayoutNode>;
  edges: LayoutEdge[];
  maxLane: number;
  totalRows: number;
}


/**
 * Assigns lanes to commits using a lane-tracking approach with proper reuse.
 *
 * The key insight is to track "active lanes" - lanes that have a line continuing
 * downward (to older commits). A lane becomes free when:
 * 1. The commit in it has no parents (root commit)
 * 2. The commit in it is not the first parent of any child (merge parent)
 *
 * Algorithm overview:
 * 1. Sort commits by timestamp (newest first - top of graph)
 * 2. Process each commit:
 *    a. If commit is the first parent of a child, inherit that child's lane
 *    b. Otherwise, find the leftmost available lane
 * 3. Release lanes when they're no longer needed
 */
export function assignLanes(commits: GraphCommit[]): GraphLayout {
  if (commits.length === 0) {
    return { nodes: new Map(), edges: [], maxLane: 0, totalRows: 0 };
  }

  // Build lookup maps
  const commitMap = new Map<string, GraphCommit>();
  const childrenMap = new Map<string, string[]>();

  for (const commit of commits) {
    commitMap.set(commit.oid, commit);
    for (const parentId of commit.parentIds) {
      const children = childrenMap.get(parentId) || [];
      children.push(commit.oid);
      childrenMap.set(parentId, children);
    }
  }

  // Sort by timestamp descending (newest first = row 0)
  const sortedCommits = [...commits].sort((a, b) => b.timestamp - a.timestamp);
  const commitOidSet = new Set(commits.map((c) => c.oid));

  // Lane management - null means lane is free
  const lanes: (string | null)[] = [];
  const nodes = new Map<string, LayoutNode>();
  const edges: LayoutEdge[] = [];
  const oidToLane = new Map<string, number>();

  function getFreeLane(): number {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) {
        return i;
      }
    }
    lanes.push(null);
    return lanes.length - 1;
  }

  function occupyLane(lane: number, oid: string): void {
    while (lanes.length <= lane) {
      lanes.push(null);
    }
    lanes[lane] = oid;
  }

  function releaseLane(lane: number): void {
    if (lane < lanes.length) {
      lanes[lane] = null;
    }
  }

  // Process commits from newest to oldest
  for (let row = 0; row < sortedCommits.length; row++) {
    const commit = sortedCommits[row];
    const children = childrenMap.get(commit.oid) || [];

    let lane: number | undefined;

    // Check if we should inherit a lane from a child
    // We inherit if we're the first parent of that child
    for (const childOid of children) {
      const childCommit = commitMap.get(childOid);
      const childLane = oidToLane.get(childOid);

      if (childCommit && childLane !== undefined) {
        if (childCommit.parentIds[0] === commit.oid) {
          // We're the first parent - inherit this lane
          lane = childLane;
          break;
        }
      }
    }

    // If we didn't inherit a lane, get a free one
    if (lane === undefined) {
      lane = getFreeLane();
    }

    occupyLane(lane, commit.oid);
    oidToLane.set(commit.oid, lane);

    // Create layout node
    const childLanes = children
      .map((c) => oidToLane.get(c))
      .filter((l): l is number => l !== undefined);

    const node: LayoutNode = {
      oid: commit.oid,
      row,
      lane,
      commit,
      childLanes,
      parentLanes: [],
    };
    nodes.set(commit.oid, node);

    // Create edges to children and check for lane releases
    for (const childOid of children) {
      const childLane = oidToLane.get(childOid);
      const childNode = nodes.get(childOid);
      if (childLane !== undefined && childNode) {
        edges.push({
          fromOid: commit.oid,
          toOid: childOid,
          fromRow: row,
          toRow: childNode.row,
          fromLane: lane,
          toLane: childLane,
          isMerge: childNode.commit.parentIds.length > 1,
        });

        // Release child's lane if we're not using it and all its parents are done
        if (lane !== childLane) {
          const childCommit = commitMap.get(childOid)!;
          const allParentsProcessed = childCommit.parentIds.every(
            (pid) => !commitOidSet.has(pid) || nodes.has(pid) || pid === commit.oid
          );
          if (allParentsProcessed) {
            releaseLane(childLane);
          }
        }
      }
    }

    // Release this lane if commit has no parents in the set
    const hasParentsInSet = commit.parentIds.some((pid) => commitOidSet.has(pid));
    if (!hasParentsInSet) {
      releaseLane(lane);
    }
  }

  // Second pass: fill in parent lanes
  for (const node of nodes.values()) {
    node.parentLanes = node.commit.parentIds
      .map((pid) => oidToLane.get(pid))
      .filter((l): l is number => l !== undefined);
  }

  // Calculate max lane (find highest used lane)
  let maxLane = 0;
  for (const node of nodes.values()) {
    if (node.lane > maxLane) {
      maxLane = node.lane;
    }
  }

  return {
    nodes,
    edges,
    maxLane,
    totalRows: sortedCommits.length,
  };
}

/**
 * Optimized lane assignment using a lane-reuse algorithm
 * that minimizes the number of active lanes at any time.
 *
 * This version also supports dense row packing - multiple commits
 * can share the same row if they're in different lanes and don't
 * have direct parent-child relationships at that row.
 */
export function assignLanesOptimized(commits: GraphCommit[]): GraphLayout {
  if (commits.length === 0) {
    return { nodes: new Map(), edges: [], maxLane: 0, totalRows: 0 };
  }

  // Build adjacency information
  const commitMap = new Map<string, GraphCommit>();
  const childrenMap = new Map<string, string[]>();

  for (const commit of commits) {
    commitMap.set(commit.oid, commit);
    for (const parentId of commit.parentIds) {
      const children = childrenMap.get(parentId) || [];
      children.push(commit.oid);
      childrenMap.set(parentId, children);
    }
  }

  // Sort by timestamp descending (newest first = row 0)
  const sortedCommits = [...commits].sort((a, b) => b.timestamp - a.timestamp);

  // Create a set of all commit OIDs for quick lookup
  const commitOidSet = new Set(commits.map((c) => c.oid));

  // Active lanes: each lane tracks which OID is "continuing" through it
  const activeLanes: (string | null)[] = [];
  const nodes = new Map<string, LayoutNode>();
  const edges: LayoutEdge[] = [];
  const oidToLane = new Map<string, number>();

  // Track row occupancy per lane: Map<lane, Set<row>>
  const laneRowOccupancy = new Map<number, Set<number>>();

  // Track which rows have commits and their lanes
  const rowOccupancy = new Map<number, Map<number, string>>(); // row -> (lane -> oid)

  function getFreeLane(): number {
    for (let i = 0; i < activeLanes.length; i++) {
      if (activeLanes[i] === null) {
        return i;
      }
    }
    activeLanes.push(null);
    return activeLanes.length - 1;
  }

  function occupyLane(lane: number, oid: string): void {
    while (activeLanes.length <= lane) {
      activeLanes.push(null);
    }
    activeLanes[lane] = oid;
  }

  function releaseLane(lane: number): void {
    if (lane < activeLanes.length) {
      activeLanes[lane] = null;
    }
  }

  function occupyPosition(row: number, lane: number, oid: string): void {
    if (!rowOccupancy.has(row)) {
      rowOccupancy.set(row, new Map());
    }
    rowOccupancy.get(row)!.set(lane, oid);

    if (!laneRowOccupancy.has(lane)) {
      laneRowOccupancy.set(lane, new Set());
    }
    laneRowOccupancy.get(lane)!.add(row);
  }

  function isPositionFree(row: number, lane: number): boolean {
    const rowMap = rowOccupancy.get(row);
    if (!rowMap) return true;
    return !rowMap.has(lane);
  }

  function canPlaceAtRow(row: number, lane: number, childOids: string[]): boolean {
    // Check if position is free
    if (!isPositionFree(row, lane)) return false;

    // Check that no child is at this row (would create zero-length edge)
    for (const childOid of childOids) {
      const childNode = nodes.get(childOid);
      if (childNode && childNode.row === row) {
        return false;
      }
    }

    // Check that edges won't cross through occupied positions
    // For each child, check if there's a clear path
    for (const childOid of childOids) {
      const childNode = nodes.get(childOid);
      if (!childNode) continue;

      const childRow = childNode.row;
      const childLane = childNode.lane;

      // If same lane, check vertical path is clear
      if (lane === childLane) {
        for (let r = childRow + 1; r < row; r++) {
          if (!isPositionFree(r, lane)) return false;
        }
      }
    }

    return true;
  }

  function findBestRow(
    baseRow: number,
    lane: number,
    childOids: string[],
    previousCommitRow: number
  ): number {
    // Try to place at the same row as another commit if possible (dense packing)
    // Start from baseRow and work down

    // First, try the same row as the previous commit if we're in a different lane
    if (previousCommitRow >= 0 && canPlaceAtRow(previousCommitRow, lane, childOids)) {
      // Check if any child is in this row - if so, we need to be below
      let canUsePrevRow = true;
      for (const childOid of childOids) {
        const childNode = nodes.get(childOid);
        if (childNode && childNode.row >= previousCommitRow) {
          canUsePrevRow = false;
          break;
        }
      }
      if (canUsePrevRow) {
        return previousCommitRow;
      }
    }

    // Find minimum row we must be at (below all children)
    let minRow = 0;
    for (const childOid of childOids) {
      const childNode = nodes.get(childOid);
      if (childNode) {
        minRow = Math.max(minRow, childNode.row + 1);
      }
    }

    // Try to find an existing row we can share
    for (let row = minRow; row <= baseRow; row++) {
      if (canPlaceAtRow(row, lane, childOids)) {
        return row;
      }
    }

    // If no existing row works, use a new row
    return baseRow;
  }

  // Process each commit from newest to oldest
  let currentRow = 0;

  for (let i = 0; i < sortedCommits.length; i++) {
    const commit = sortedCommits[i];
    const children = childrenMap.get(commit.oid) || [];

    let lane: number = 0;
    let inheritedLane = false;

    // Check if any child wants us to continue in their lane
    for (const childOid of children) {
      const childCommit = commitMap.get(childOid);
      const childLane = oidToLane.get(childOid);

      if (childCommit && childLane !== undefined) {
        if (childCommit.parentIds[0] === commit.oid) {
          lane = childLane;
          inheritedLane = true;
          break;
        }
      }
    }

    if (!inheritedLane) {
      lane = getFreeLane();
    }

    occupyLane(lane, commit.oid);
    oidToLane.set(commit.oid, lane);

    // Find the best row for this commit (dense packing)
    const previousRow = i > 0 ? nodes.get(sortedCommits[i - 1].oid)?.row ?? -1 : -1;
    const row = findBestRow(currentRow, lane, children, previousRow);

    // Update currentRow if we used a new row
    if (row >= currentRow) {
      currentRow = row + 1;
    }

    occupyPosition(row, lane, commit.oid);

    // Create node
    const childLanes = children
      .map((c) => oidToLane.get(c))
      .filter((l): l is number => l !== undefined);

    const node: LayoutNode = {
      oid: commit.oid,
      row,
      lane,
      commit,
      childLanes,
      parentLanes: [],
    };
    nodes.set(commit.oid, node);

    // Create edges to children
    for (const childOid of children) {
      const childLane = oidToLane.get(childOid);
      const childNode = nodes.get(childOid);
      if (childLane !== undefined && childNode) {
        edges.push({
          fromOid: commit.oid,
          toOid: childOid,
          fromRow: row,
          toRow: childNode.row,
          fromLane: lane,
          toLane: childLane,
          isMerge: childNode.commit.parentIds.length > 1,
        });

        if (lane !== childLane) {
          const childCommit = commitMap.get(childOid)!;
          const allParentsProcessed = childCommit.parentIds.every(
            (pid) => !commitOidSet.has(pid) || nodes.has(pid) || pid === commit.oid
          );
          if (allParentsProcessed) {
            releaseLane(childLane);
          }
        }
      }
    }

    const hasParentsInSet = commit.parentIds.some((pid) => commitOidSet.has(pid));
    if (!hasParentsInSet) {
      releaseLane(lane);
    }
  }

  // Fill in parent lanes
  for (const node of nodes.values()) {
    node.parentLanes = node.commit.parentIds
      .map((pid) => oidToLane.get(pid))
      .filter((l): l is number => l !== undefined);
  }

  const maxLane = activeLanes.length > 0 ? activeLanes.length - 1 : 0;

  // Calculate actual total rows used
  let maxRow = 0;
  for (const node of nodes.values()) {
    maxRow = Math.max(maxRow, node.row);
  }

  return {
    nodes,
    edges,
    maxLane,
    totalRows: maxRow + 1,
  };
}

/**
 * Validate that a layout is correct
 */
export function validateLayout(layout: GraphLayout, commits: GraphCommit[]): string[] {
  const errors: string[] = [];

  // Check all commits have nodes
  for (const commit of commits) {
    if (!layout.nodes.has(commit.oid)) {
      errors.push(`Missing node for commit ${commit.oid}`);
    }
  }

  // Check all edges connect valid nodes
  for (const edge of layout.edges) {
    if (!layout.nodes.has(edge.fromOid)) {
      errors.push(`Edge from invalid node ${edge.fromOid}`);
    }
    if (!layout.nodes.has(edge.toOid)) {
      errors.push(`Edge to invalid node ${edge.toOid}`);
    }
  }

  // Check no two nodes share the same row and lane
  const positions = new Map<string, string>();
  for (const node of layout.nodes.values()) {
    const key = `${node.row},${node.lane}`;
    if (positions.has(key)) {
      errors.push(`Position conflict at row=${node.row}, lane=${node.lane}: ${positions.get(key)} and ${node.oid}`);
    }
    positions.set(key, node.oid);
  }

  // Check rows are valid (non-negative)
  for (const node of layout.nodes.values()) {
    if (node.row < 0) {
      errors.push(`Invalid row ${node.row} for commit ${node.oid}`);
    }
  }

  return errors;
}
