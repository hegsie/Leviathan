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
 * Key insight: A lane can be reused when the commit that was using it
 * no longer needs it (i.e., when we've moved past its continuation point).
 *
 * The algorithm tracks "active lanes" - lanes that have a line continuing
 * to the next row. When a branch ends (merges into another branch or is
 * a root commit), its lane becomes available for reuse.
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
  // A lane is "active" if a commit in that lane has parents that haven't been processed yet
  // null means the lane is free for reuse
  const activeLanes: (string | null)[] = [];
  const nodes = new Map<string, LayoutNode>();
  const edges: LayoutEdge[] = [];
  const oidToLane = new Map<string, number>();

  // Track which commits still have unprocessed parents in their lane
  // Key: lane number, Value: OID of commit whose parent continues in this lane
  const laneOwner = new Map<number, string>();

  function getFreeLane(): number {
    // Find leftmost free lane
    for (let i = 0; i < activeLanes.length; i++) {
      if (activeLanes[i] === null) {
        return i;
      }
    }
    // Create new lane
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
      laneOwner.delete(lane);
    }
  }

  // Process each commit from newest to oldest
  for (let row = 0; row < sortedCommits.length; row++) {
    const commit = sortedCommits[row];
    const children = childrenMap.get(commit.oid) || [];

    let lane: number = 0;
    let inheritedLane = false;

    // Check if any child wants us to continue in their lane
    // A child wants us in their lane if we are their FIRST parent
    for (const childOid of children) {
      const childCommit = commitMap.get(childOid);
      const childLane = oidToLane.get(childOid);

      if (childCommit && childLane !== undefined) {
        // Check if this commit is the first parent of the child
        if (childCommit.parentIds[0] === commit.oid) {
          // We should continue in this child's lane
          lane = childLane;
          inheritedLane = true;

          // Release other children's lanes if they were waiting for different parents
          // This happens when a commit has multiple children (branch point)
          for (const otherChildOid of children) {
            if (otherChildOid !== childOid) {
              const otherChildLane = oidToLane.get(otherChildOid);
              const otherChild = commitMap.get(otherChildOid);
              if (
                otherChildLane !== undefined &&
                otherChild &&
                otherChild.parentIds[0] === commit.oid
              ) {
                // This other child also wants us - but we can only be in one lane
                // The other lane should continue to this commit's other parents or be released
              }
            }
          }
          break;
        }
      }
    }

    if (!inheritedLane) {
      // We're not continuing any child's lane
      // Either we're a branch tip (no children) or we're a merge parent (not first parent)

      // For merge parents, check if we should merge into an existing lane
      if (children.length > 0) {
        // We need a lane, prefer reusing a free one near our children
        lane = getFreeLane();
      } else {
        // Branch tip - get any free lane
        lane = getFreeLane();
      }
    }

    occupyLane(lane!, commit.oid);
    oidToLane.set(commit.oid, lane!);

    // Create node
    const childLanes = children
      .map((c) => oidToLane.get(c))
      .filter((l): l is number => l !== undefined);

    const node: LayoutNode = {
      oid: commit.oid,
      row,
      lane: lane!,
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
          fromLane: lane!,
          toLane: childLane,
          isMerge: childNode.commit.parentIds.length > 1,
        });

        // Check if we should release the child's lane
        // A child's lane can be released if:
        // 1. We are NOT continuing in that lane (lane != childLane)
        // 2. All of the child's parents have been processed
        if (lane !== childLane) {
          const childCommit = commitMap.get(childOid)!;
          const allParentsProcessed = childCommit.parentIds.every(
            (pid) => !commitOidSet.has(pid) || nodes.has(pid) || pid === commit.oid
          );
          if (allParentsProcessed) {
            // This child's lane is no longer needed
            releaseLane(childLane);
          }
        }
      }
    }

    // Check if this commit's lane should be released
    // Release if this commit has no parents in the commit set (root commit)
    // or if all parents are outside the loaded commit range
    const hasParentsInSet = commit.parentIds.some((pid) => commitOidSet.has(pid));
    if (!hasParentsInSet) {
      releaseLane(lane!);
    }
  }

  // Fill in parent lanes
  for (const node of nodes.values()) {
    node.parentLanes = node.commit.parentIds
      .map((pid) => oidToLane.get(pid))
      .filter((l): l is number => l !== undefined);
  }

  const maxLane = activeLanes.length > 0 ? activeLanes.length - 1 : 0;

  return {
    nodes,
    edges,
    maxLane,
    totalRows: sortedCommits.length,
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

  // Check rows are sequential
  const rows = [...layout.nodes.values()].map((n) => n.row).sort((a, b) => a - b);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] !== i) {
      errors.push(`Non-sequential rows: expected ${i}, got ${rows[i]}`);
      break;
    }
  }

  return errors;
}
