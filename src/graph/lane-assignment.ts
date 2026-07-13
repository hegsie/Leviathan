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
  /**
   * Lane-engine state at the end of the layout, enabling appendLanes() to
   * extend it with older pages without recomputing existing rows.
   */
  appendState?: LayoutAppendState;
}

export interface LayoutAppendState {
  /** Lane occupancy at the end of the laid-out rows (null = free) */
  lanes: (string | null)[];
  /** Next unused branch color index */
  nextColorIndex: number;
  /** Number of lanes reserved for the mainline (0 or 1) */
  reservedLanes: number;
  /** First-parent OID continuing the mainline beyond the laid-out set */
  mainlineContinuation?: string;
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
 * Compute the first-parent chain of a commit within the given set.
 * `continuation` is the first-parent OID where the chain leaves the set
 * (undefined when the chain ends at a root).
 */
function firstParentChain(
  startOid: string | undefined,
  commitMap: Map<string, GraphCommit>
): { chain: Set<string>; continuation?: string } {
  const chain = new Set<string>();
  let current = startOid;
  while (current !== undefined && commitMap.has(current) && !chain.has(current)) {
    chain.add(current);
    current = commitMap.get(current)!.parentIds[0];
  }
  return {
    chain,
    continuation: current !== undefined && !chain.has(current) ? current : undefined,
  };
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
 *
 * The returned layout carries `appendState`, which lets `appendLanes()`
 * extend it with older pages without disturbing already-assigned rows,
 * lanes, or colors.
 */
export function assignLanes(
  commits: GraphCommit[],
  options: AssignLanesOptions = {}
): GraphLayout {
  const layout: GraphLayout = { nodes: new Map(), edges: [], maxLane: 0, totalRows: 0 };

  const commitMap = new Map<string, GraphCommit>(commits.map((c) => [c.oid, c]));
  const { chain, continuation } = firstParentChain(options.headOid, commitMap);
  const state: LayoutAppendState = {
    lanes: [],
    reservedLanes: chain.size > 0 ? 1 : 0,
    // Color 0 belongs to the mainline
    nextColorIndex: chain.size > 0 ? 1 : 0,
    mainlineContinuation: continuation,
  };

  layoutInto(layout, commits, chain, state);
  return layout;
}

/**
 * Append a page of OLDER commits to an existing layout without recomputing
 * it: rows, lanes and colors of already-laid-out commits stay exactly as
 * they are, so "load more" doesn't make the visible graph jump. Edges from
 * new commits to already-visible children are created, and boundary nodes
 * whose parents just arrived lose their "history continues" stub.
 *
 * Falls back are the caller's job: a changed filter or a refresh needs a
 * full `assignLanes()` recompute.
 */
export function appendLanes(layout: GraphLayout, newCommits: GraphCommit[]): GraphLayout {
  const state = layout.appendState;
  if (!state) {
    throw new Error('appendLanes requires a layout produced by assignLanes');
  }

  const fresh = newCommits.filter((c) => !layout.nodes.has(c.oid));
  if (fresh.length === 0) {
    return layout;
  }

  // Continue the mainline chain into the new page
  const freshMap = new Map<string, GraphCommit>(fresh.map((c) => [c.oid, c]));
  const { chain, continuation } = firstParentChain(state.mainlineContinuation, freshMap);
  state.mainlineContinuation = continuation;

  // Re-reserve lanes of boundary lines that continue below the appended
  // rows, so new branch lines don't get placed on top of them
  for (const node of layout.nodes.values()) {
    if (!node.hasMissingParents) continue;
    const firstParent = node.commit.parentIds[0];
    if (
      firstParent !== undefined &&
      !layout.nodes.has(firstParent) &&
      node.lane >= state.reservedLanes
    ) {
      while (state.lanes.length <= node.lane) {
        state.lanes.push(null);
      }
      state.lanes[node.lane] = node.oid;
    }
  }

  layoutInto(layout, fresh, chain, state);
  return layout;
}

/**
 * Core layout pass shared by assignLanes (empty layout) and appendLanes
 * (existing layout). Lays out `commits` below the current rows, threading
 * lane occupancy and color allocation through `state`.
 */
function layoutInto(
  layout: GraphLayout,
  commits: GraphCommit[],
  mainline: Set<string>,
  state: LayoutAppendState
): void {
  layout.appendState = state;
  if (commits.length === 0) {
    return;
  }

  const { nodes, edges } = layout;
  const { lanes, reservedLanes } = state;
  const freshOids = new Set(commits.map((c) => c.oid));

  // Children within this batch...
  const childrenMap = new Map<string, string[]>();
  for (const commit of commits) {
    for (const parentId of commit.parentIds) {
      const children = childrenMap.get(parentId) || [];
      children.push(commit.oid);
      childrenMap.set(parentId, children);
    }
  }
  // ...plus already-laid-out boundary nodes whose parents arrive in this batch
  const boundaryNodes: LayoutNode[] = [];
  for (const node of nodes.values()) {
    if (!node.hasMissingParents) continue;
    boundaryNodes.push(node);
    for (const pid of node.commit.parentIds) {
      if (freshOids.has(pid)) {
        const children = childrenMap.get(pid) || [];
        children.push(node.oid);
        childrenMap.set(pid, children);
      }
    }
  }

  // A commit counts as "in the window" when it is in this batch or already laid out
  const inWindow = (oid: string): boolean => freshOids.has(oid) || nodes.has(oid);

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

  const sortedCommits = topologicalOrder(commits);
  const startRow = layout.totalRows;

  // Process commits from newest to oldest, rows continuing below the
  // existing layout
  for (let i = 0; i < sortedCommits.length; i++) {
    const commit = sortedCommits[i];
    const row = startRow + i;
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
        const childNode = nodes.get(childOid);

        if (childNode && childNode.commit.parentIds[0] === commit.oid) {
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
      colorIndex = state.nextColorIndex++;
    }

    occupyLane(lane, commit.oid);

    // Create layout node (children — in this batch or already laid out —
    // are always placed before their parents, so childLanes is complete)
    const childLanes = children
      .map((c) => nodes.get(c)?.lane)
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
      const childNode = nodes.get(childOid);

      if (childNode && childNode.oid !== commit.oid) {
        const childLane = childNode.lane;
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
          const allParentsProcessed = childNode.commit.parentIds.every(
            (pid) => !inWindow(pid) || nodes.has(pid) || pid === commit.oid
          );
          if (allParentsProcessed) {
            releaseLane(childLane);
          }
        }
      }
    }

    // Release this lane if commit has no parents in the window
    const hasParentsInWindow = commit.parentIds.some((pid) => inWindow(pid));
    if (!hasParentsInWindow) {
      releaseLane(lane);
    }
  }

  // Second pass: parent lanes and missing-parent flags for the new nodes,
  // plus a refresh of boundary nodes whose parents just arrived
  const refreshNode = (node: LayoutNode): void => {
    node.parentLanes = node.commit.parentIds
      .map((pid) => nodes.get(pid)?.lane)
      .filter((l): l is number => l !== undefined);
    node.hasMissingParents = node.commit.parentIds.some((pid) => !nodes.has(pid));
  };
  for (const commit of sortedCommits) {
    refreshNode(nodes.get(commit.oid)!);
  }
  for (const node of boundaryNodes) {
    refreshNode(node);
  }

  // Extend max lane and total rows
  let maxLane = layout.maxLane;
  for (const commit of sortedCommits) {
    const lane = nodes.get(commit.oid)!.lane;
    if (lane > maxLane) {
      maxLane = lane;
    }
  }
  layout.maxLane = maxLane;
  layout.totalRows = startRow + sortedCommits.length;
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
