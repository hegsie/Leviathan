/**
 * Lane Assignment Algorithm for Git Graph Visualization
 *
 * This algorithm assigns each commit to a horizontal lane (column) to create
 * a readable visualization of git history. The goals are:
 * 1. Order commits topologically (a parent never appears above its child)
 * 2. Pin the HEAD first-parent chain (the mainline) to lane 0
 * 3. Keep related commits (same branch line) in the same lane and color
 * 4. Reuse lanes when branches end
 * 5. Handle merge commits with multiple parents
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
  /**
   * Stable color identity for the branch line this commit belongs to.
   * Propagated along first-parent chains so a branch keeps one color even
   * when its lane shifts; unrelated branches that reuse a lane get
   * different colors. Index 0 is the HEAD mainline.
   */
  colorIndex: number;
  /**
   * True when the commit has parents that are NOT in the laid-out set
   * (outside the loaded pagination window or hidden by a branch filter).
   * The renderer draws a fading "history continues" stub below such nodes
   * so the history doesn't look like it dead-ends.
   */
  hasMissingParents: boolean;
}

export interface LayoutEdge {
  fromOid: string;
  toOid: string;
  fromRow: number;
  toRow: number;
  fromLane: number;
  toLane: number;
  /**
   * True when this edge connects a merge commit to one of its NON-first
   * parents (i.e. it is the "merged branch" side of a merge), not merely
   * when the child happens to be a merge commit.
   */
  isMerge: boolean;
  /** Color identity of the branch line this edge belongs to */
  colorIndex: number;
}

export interface GraphLayout {
  nodes: Map<string, LayoutNode>;
  edges: LayoutEdge[];
  maxLane: number;
  totalRows: number;
}

export interface AssignLanesOptions {
  /**
   * OID of the commit HEAD points at. Its first-parent chain is treated as
   * the mainline: pinned to lane 0 and colored with index 0.
   */
  headOid?: string;
}

/**
 * Order commits topologically, children before parents, using commit
 * timestamps only as a tie-break among commits whose children are all
 * placed. Unlike a plain timestamp sort this is robust to clock skew and
 * rewritten history, where a parent can carry a NEWER timestamp than its
 * child.
 */
function topologicalOrder(commits: GraphCommit[]): GraphCommit[] {
  const commitMap = new Map<string, GraphCommit>();
  for (const commit of commits) {
    commitMap.set(commit.oid, commit);
  }

  // Number of children (within the loaded set) still unplaced per commit
  const pendingChildren = new Map<string, number>();
  for (const commit of commits) {
    for (const pid of commit.parentIds) {
      if (commitMap.has(pid)) {
        pendingChildren.set(pid, (pendingChildren.get(pid) ?? 0) + 1);
      }
    }
  }

  // Max-heap on timestamp (oid as deterministic tie-break)
  const heap: GraphCommit[] = [];
  const newer = (a: GraphCommit, b: GraphCommit): boolean =>
    a.timestamp !== b.timestamp ? a.timestamp > b.timestamp : a.oid < b.oid;
  const push = (c: GraphCommit): void => {
    heap.push(c);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (newer(heap[i], heap[parent])) {
        [heap[i], heap[parent]] = [heap[parent], heap[i]];
        i = parent;
      } else {
        break;
      }
    }
  };
  const pop = (): GraphCommit => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let largest = i;
        if (left < heap.length && newer(heap[left], heap[largest])) largest = left;
        if (right < heap.length && newer(heap[right], heap[largest])) largest = right;
        if (largest === i) break;
        [heap[i], heap[largest]] = [heap[largest], heap[i]];
        i = largest;
      }
    }
    return top;
  };

  // Start from tips: commits with no children in the set
  for (const commit of commits) {
    if (!pendingChildren.has(commit.oid)) {
      push(commit);
    }
  }

  const order: GraphCommit[] = [];
  const placed = new Set<string>();
  while (heap.length > 0) {
    const commit = pop();
    if (placed.has(commit.oid)) continue;
    placed.add(commit.oid);
    order.push(commit);
    for (const pid of commit.parentIds) {
      const remaining = pendingChildren.get(pid);
      if (remaining === undefined) continue;
      if (remaining <= 1) {
        pendingChildren.delete(pid);
        const parent = commitMap.get(pid);
        if (parent && !placed.has(pid)) {
          push(parent);
        }
      } else {
        pendingChildren.set(pid, remaining - 1);
      }
    }
  }

  // Defensive: git history is acyclic, but corrupt input must not drop
  // commits from the graph
  if (order.length < commits.length) {
    const remaining = commits
      .filter((c) => !placed.has(c.oid))
      .sort((a, b) => b.timestamp - a.timestamp);
    order.push(...remaining);
  }

  return order;
}

/**
 * Compute the first-parent chain of a commit within the loaded set
 */
function firstParentChain(
  headOid: string | undefined,
  commitMap: Map<string, GraphCommit>
): Set<string> {
  const chain = new Set<string>();
  let current = headOid;
  while (current !== undefined && commitMap.has(current) && !chain.has(current)) {
    chain.add(current);
    current = commitMap.get(current)!.parentIds[0];
  }
  return chain;
}

/**
 * Assigns rows, lanes and colors to commits.
 *
 * - Rows follow a topological order (children above parents), one commit
 *   per row.
 * - The HEAD first-parent chain is pinned to lane 0 / color 0.
 * - Other commits inherit the lane and color of a child they are the first
 *   parent of; commits starting a new branch line get the leftmost free
 *   lane (never lane 0 while a mainline exists) and a fresh color.
 * - A lane is released for reuse when its line ends.
 */
export function assignLanes(
  commits: GraphCommit[],
  options: AssignLanesOptions = {}
): GraphLayout {
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

  const sortedCommits = topologicalOrder(commits);
  const commitOidSet = new Set(commits.map((c) => c.oid));

  // Mainline: HEAD's first-parent chain is pinned to lane 0 / color 0
  const mainline = firstParentChain(options.headOid, commitMap);
  const reservedLanes = mainline.size > 0 ? 1 : 0;

  // Lane management - null means lane is free
  const lanes: (string | null)[] = [];
  const nodes = new Map<string, LayoutNode>();
  const edges: LayoutEdge[] = [];
  const oidToLane = new Map<string, number>();
  let nextColorIndex = reservedLanes; // color 0 belongs to the mainline

  function getFreeLane(): number {
    // Lane 0 stays reserved for the mainline while one exists
    for (let i = reservedLanes; i < lanes.length; i++) {
      if (lanes[i] === null) {
        return i;
      }
    }
    lanes.push(null);
    return Math.max(lanes.length - 1, reservedLanes);
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

  // Process commits from newest (row 0) to oldest
  for (let row = 0; row < sortedCommits.length; row++) {
    const commit = sortedCommits[row];
    const children = childrenMap.get(commit.oid) || [];

    let lane: number | undefined;
    let colorIndex: number | undefined;

    if (mainline.has(commit.oid)) {
      // Mainline commits always sit in lane 0 with color 0
      lane = 0;
      colorIndex = 0;
    } else {
      // Inherit lane and color from a child we are the first parent of —
      // that child's branch line continues through this commit
      for (const childOid of children) {
        const childCommit = commitMap.get(childOid);
        const childNode = nodes.get(childOid);

        if (childCommit && childNode && childCommit.parentIds[0] === commit.oid) {
          // Never inherit the reserved mainline lane for non-mainline commits
          if (childNode.lane === 0 && reservedLanes > 0) {
            continue;
          }
          lane = childNode.lane;
          colorIndex = childNode.colorIndex;
          break;
        }
      }
    }

    // No lane inherited: this commit starts a new branch line
    if (lane === undefined) {
      lane = getFreeLane();
    }
    if (colorIndex === undefined) {
      colorIndex = nextColorIndex++;
    }

    occupyLane(lane, commit.oid);
    oidToLane.set(commit.oid, lane);

    // Create layout node (children are always processed before parents in
    // topological order, so childLanes is complete here)
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
      colorIndex,
      hasMissingParents: false,
    };
    nodes.set(commit.oid, node);

    // Create edges to children and check for lane releases
    for (const childOid of children) {
      const childLane = oidToLane.get(childOid);
      const childNode = nodes.get(childOid);

      if (childLane !== undefined && childNode) {
        const parentIndex = childNode.commit.parentIds.indexOf(commit.oid);
        const isMergeEdge = parentIndex > 0;
        edges.push({
          fromOid: commit.oid,
          toOid: childOid,
          fromRow: row,
          toRow: childNode.row,
          fromLane: lane,
          toLane: childLane,
          isMerge: isMergeEdge,
          // A first-parent edge continues the child's branch line; a merge
          // edge belongs to the merged (this commit's) branch line
          colorIndex: isMergeEdge ? colorIndex : childNode.colorIndex,
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

  // Second pass: fill in parent lanes and flag parents outside the set
  for (const node of nodes.values()) {
    node.parentLanes = node.commit.parentIds
      .map((pid) => oidToLane.get(pid))
      .filter((l): l is number => l !== undefined);
    node.hasMissingParents = node.commit.parentIds.some((pid) => !nodes.has(pid));
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

  // Check topological ordering: a parent must never be above its child
  for (const node of layout.nodes.values()) {
    for (const pid of node.commit.parentIds) {
      const parent = layout.nodes.get(pid);
      if (parent && parent.row <= node.row) {
        errors.push(
          `Parent ${pid} (row ${parent.row}) is not below child ${node.oid} (row ${node.row})`
        );
      }
    }
  }

  return errors;
}
