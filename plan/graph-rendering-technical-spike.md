# Technical Spike: Commit Graph Rendering

## Executive Summary

The commit graph is the centerpiece of any professional Git GUI. It must render complex branch histories with thousands of commits smoothly at 60fps while remaining interactive. This document analyzes approaches, trade-offs, and provides a recommended implementation path.

---

# Table of Contents

1. [Problem Definition](#1-problem-definition)
2. [Performance Targets](#2-performance-targets)
3. [Layout Algorithms](#3-layout-algorithms)
4. [Rendering Technologies](#4-rendering-technologies)
5. [Virtualization Strategies](#5-virtualization-strategies)
6. [Data Architecture](#6-data-architecture)
7. [Caching Strategy](#7-caching-strategy)
8. [Incremental Updates](#8-incremental-updates)
9. [Interaction Handling](#9-interaction-handling)
10. [Recommended Architecture](#10-recommended-architecture)
11. [Proof of Concept Plan](#11-proof-of-concept-plan)
12. [Open Source References](#12-open-source-references)

---

# 1. Problem Definition

## 1.1 What We're Rendering

```
Visual representation of a commit graph:

        ●──────────────────────────────● main
       /                              /
      ●────●────●────●───────────────● feature-a
     /          \                   /
    ●            ●────●────●───────● feature-b
   /                   \
  ●─────●───────────────●──────────● develop
                         \
                          ●────●───● hotfix
```

Each element we must render:

| Element | Count (Large Repo) | Complexity |
|---------|-------------------|------------|
| Commit nodes | 10,000 - 1,000,000+ | Circles with state (selected, hover) |
| Branch lines | 100 - 10,000 | Curved/straight paths, colors |
| Merge points | 1,000 - 100,000 | Multiple parent connections |
| Labels | 10 - 1,000 | Branch names, tags, HEAD |
| Columns | Variable | Commit message, author, date, SHA |

## 1.2 The Core Challenges

### Challenge 1: Layout Computation

Given a DAG (Directed Acyclic Graph) of commits, assign each commit:
- An X position (which "lane" or column)
- A Y position (vertical order)
- Connection paths to parent commits

This is a variant of the **Sugiyama framework** for layered graph drawing, which is computationally expensive.

### Challenge 2: Rendering at Scale

| Repository | Commits | Branches | Challenge |
|------------|---------|----------|-----------|
| Small project | 100-1,000 | 5-20 | None |
| Medium project | 1,000-10,000 | 20-100 | Needs virtualization |
| Large monorepo | 10,000-100,000 | 100-1,000 | Needs lazy loading + virtualization |
| Linux kernel | 1,000,000+ | 1,000+ | Extreme optimization required |

### Challenge 3: Smooth Interactions

- 60fps scrolling (16.67ms frame budget)
- Instant hover feedback
- Smooth zoom/pan
- Responsive selection
- No jank during background updates

---

# 2. Performance Targets

## 2.1 Frame Budget Analysis

At 60fps, we have **16.67ms per frame**.

| Task | Budget | Notes |
|------|--------|-------|
| JavaScript execution | 6ms | Layout, state updates |
| Style/Layout | 2ms | CSS calculations |
| Paint | 4ms | Actual rendering |
| Composite | 2ms | Layer composition |
| Buffer | 2.67ms | Safety margin |

## 2.2 Target Metrics

| Metric | Target | Stretch Goal |
|--------|--------|--------------|
| Initial render (1K commits) | < 100ms | < 50ms |
| Initial render (10K commits) | < 500ms | < 200ms |
| Initial render (100K commits) | < 2s | < 1s |
| Scroll FPS | 60fps | 120fps (high refresh) |
| Scroll latency | < 16ms | < 8ms |
| Click-to-select | < 50ms | < 16ms |
| Hover feedback | < 16ms | < 8ms |
| Memory (100K commits) | < 500MB | < 200MB |

## 2.3 Perceived Performance

Even if we can't hit targets, perceived performance matters:

- Show something immediately (progressive rendering)
- Prioritize visible viewport
- Use skeleton/placeholder for loading
- Smooth animations mask loading

---

# 3. Layout Algorithms

## 3.1 The Problem: Lane Assignment

Given commits with parent relationships, assign each to a "lane" (X column) such that:
1. Lines don't cross unnecessarily
2. Related commits stay close
3. The graph is readable
4. Layout is deterministic (same input = same output)

## 3.2 Algorithm Options

### Option A: Simple Stack-Based (git log --graph style)

```
How it works:
1. Process commits in topological order
2. Assign to leftmost available lane
3. When branch merges, free the lane

Pros:
- Very fast: O(n)
- Deterministic
- Simple to implement

Cons:
- Can create unnecessary crossings
- Lanes can "jump" unexpectedly
- Not optimal layout

Used by: git CLI, most simple git GUIs
```

**Implementation:**
```typescript
interface Lane {
  commit: string | null;
  color: string;
}

function assignLanes(commits: Commit[]): Map<string, number> {
  const lanes: Lane[] = [];
  const assignments = new Map<string, number>();
  
  for (const commit of commits) {
    // Find lane of first parent (if exists)
    let lane = lanes.findIndex(l => l.commit === commit.parents[0]);
    
    if (lane === -1) {
      // Find first empty lane or create new one
      lane = lanes.findIndex(l => l.commit === null);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push({ commit: null, color: generateColor() });
      }
    }
    
    // Assign this commit to the lane
    assignments.set(commit.sha, lane);
    lanes[lane].commit = commit.sha;
    
    // Handle additional parents (merge commits)
    for (let i = 1; i < commit.parents.length; i++) {
      // Additional parents need connection lines
      // (handled in rendering)
    }
  }
  
  return assignments;
}
```

### Option B: Sugiyama-Style Layered Layout

```
How it works:
1. Layer assignment (Y positions)
2. Crossing reduction (reorder within layers)
3. X coordinate assignment
4. Edge routing

Pros:
- Minimizes edge crossings
- Produces cleaner graphs
- More "professional" look

Cons:
- O(n²) or worse for crossing reduction
- Complex to implement correctly
- NP-hard to find optimal solution (we use heuristics)

Used by: Research papers, some high-end tools
```

**Crossing Reduction Heuristics:**
1. **Barycenter method**: Position node at average of neighbors
2. **Median method**: Position node at median of neighbors
3. **GANSNER method**: Linear programming approach

### Option C: Git-specific Optimized Algorithm

```
How it works:
1. Use git's first-parent as "main line"
2. Keep main branch in lane 0
3. Spawn new lanes for side branches
4. Merge lanes when branches merge
5. Optimize for common git workflows

Pros:
- Tailored for git's structure
- Fast for typical repositories
- Intuitive results

Cons:
- May not be optimal for unusual histories
- Requires git-specific assumptions

Used by: Fork, Sublime Merge, and other professional Git GUIs
```

**Key insight:** Most commits are on the "first parent" line. Optimize for this case.

```typescript
function gitOptimizedLayout(commits: Commit[]): LayoutResult {
  const lanes: LaneState[] = [];
  const result: LayoutResult = { nodes: [], edges: [] };
  
  // Track which commits are "reserved" for incoming merges
  const reservations = new Map<string, number>();
  
  for (const commit of topologicalSort(commits)) {
    let lane: number;
    
    // Check if we have a reservation (from a child's merge)
    if (reservations.has(commit.sha)) {
      lane = reservations.get(commit.sha)!;
      reservations.delete(commit.sha);
    } 
    // Follow first parent's lane if possible
    else if (commit.parents[0] && result.nodes.has(commit.parents[0])) {
      lane = result.nodes.get(commit.parents[0])!.lane;
    }
    // Find or create lane
    else {
      lane = findAvailableLane(lanes, commit);
    }
    
    // Reserve lanes for other parents (merge sources)
    for (let i = 1; i < commit.parents.length; i++) {
      const parentSha = commit.parents[i];
      if (!reservations.has(parentSha)) {
        const mergeLane = findAvailableLane(lanes, null);
        reservations.set(parentSha, mergeLane);
      }
    }
    
    result.nodes.set(commit.sha, { lane, y: result.nodes.size });
  }
  
  return result;
}
```

### Option D: Force-Directed Layout

```
How it works:
1. Treat commits as particles
2. Apply forces (repulsion between nodes, attraction along edges)
3. Simulate until equilibrium

Pros:
- Can produce organic-looking graphs
- Handles complex topologies well

Cons:
- Non-deterministic
- Can be slow to converge
- Not suitable for linear history view
- Users expect linear scrolling

Not recommended for primary view, but useful for "overview" visualization.
```

## 3.3 Recommendation

**Use Option C (Git-specific Optimized)** with fallback behaviors:

```
Primary: Git-optimized lane assignment
- O(n) complexity
- Optimized for first-parent traversal
- Predictable, deterministic output

Enhancements:
- Cache layout results
- Compute incrementally on new commits
- Optionally apply crossing reduction to visible area
```

---

# 4. Rendering Technologies

## 4.1 Option Comparison

| Technology | Render Time (10K nodes) | Memory | Interactivity | Complexity |
|------------|------------------------|--------|---------------|------------|
| DOM Elements | 🔴 ~2000ms | 🔴 High | 🟢 Native events | 🟢 Low |
| SVG | 🟠 ~800ms | 🟠 Medium | 🟢 Native events | 🟢 Low |
| Canvas 2D | 🟢 ~50ms | 🟢 Low | 🟠 Manual hit testing | 🟠 Medium |
| WebGL | 🟢 ~20ms | 🟢 Low | 🔴 Complex hit testing | 🔴 High |
| Hybrid | 🟢 ~60ms | 🟢 Low | 🟢 Best of both | 🟠 Medium |

## 4.2 DOM Elements

```typescript
// Each commit is a DOM element
render() {
  return html`
    <div class="graph">
      ${this.commits.map(commit => html`
        <div 
          class="commit-node" 
          style="left: ${commit.x}px; top: ${commit.y}px"
          @click=${() => this.selectCommit(commit)}
        >
          <div class="node-circle"></div>
          <span class="message">${commit.message}</span>
        </div>
      `)}
    </div>
  `;
}
```

**Verdict:** ❌ Not viable for large repos. DOM operations are too slow.

## 4.3 SVG

```typescript
render() {
  return svg`
    <svg class="graph" viewBox="0 0 ${this.width} ${this.height}">
      <!-- Edges first (below nodes) -->
      ${this.edges.map(edge => svg`
        <path 
          d=${this.computePath(edge)} 
          stroke=${edge.color}
          fill="none"
        />
      `)}
      
      <!-- Nodes -->
      ${this.nodes.map(node => svg`
        <circle 
          cx=${node.x} 
          cy=${node.y} 
          r="6"
          fill=${node.color}
          @click=${() => this.selectNode(node)}
        />
      `)}
    </svg>
  `;
}
```

**Verdict:** 🟠 Viable for small/medium repos. Can virtualize, but still limited.

## 4.4 Canvas 2D

```typescript
class GraphCanvas extends LitElement {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private animationFrame?: number;
  
  private render2D(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    
    // Only render visible commits
    const visible = this.getVisibleCommits();
    
    // Draw edges
    ctx.lineWidth = 2;
    for (const edge of visible.edges) {
      ctx.strokeStyle = edge.color;
      ctx.beginPath();
      ctx.moveTo(edge.x1, edge.y1);
      ctx.bezierCurveTo(
        edge.x1, edge.y1 + 20,
        edge.x2, edge.y2 - 20,
        edge.x2, edge.y2
      );
      ctx.stroke();
    }
    
    // Draw nodes
    for (const node of visible.nodes) {
      ctx.fillStyle = node.color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 6, 0, Math.PI * 2);
      ctx.fill();
      
      if (node.selected) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }
  
  // Hit testing for interactions
  private hitTest(x: number, y: number): GraphNode | null {
    for (const node of this.visibleNodes) {
      const dx = x - node.x;
      const dy = y - node.y;
      if (dx * dx + dy * dy < 64) { // radius squared
        return node;
      }
    }
    return null;
  }
}
```

**Verdict:** 🟢 Excellent for rendering. Need manual hit testing.

## 4.5 WebGL

```typescript
// Using regl or raw WebGL
import createREGL from 'regl';

class WebGLGraph {
  private regl: REGL.Regl;
  
  private drawNodes = this.regl({
    vert: `
      attribute vec2 position;
      attribute vec3 color;
      uniform mat4 projection;
      varying vec3 vColor;
      
      void main() {
        vColor = color;
        gl_Position = projection * vec4(position, 0, 1);
        gl_PointSize = 12.0;
      }
    `,
    frag: `
      precision mediump float;
      varying vec3 vColor;
      
      void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        if (length(coord) > 0.5) discard;
        gl_FragColor = vec4(vColor, 1.0);
      }
    `,
    attributes: {
      position: this.nodePositions,
      color: this.nodeColors,
    },
    uniforms: {
      projection: this.projectionMatrix,
    },
    count: this.nodeCount,
    primitive: 'points',
  });
}
```

**Verdict:** 🟢 Fastest, but complex. Good for 100K+ commits.

## 4.6 Hybrid Approach (Recommended)

```
┌─────────────────────────────────────────────────────────────┐
│                    HYBRID ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌─────────────────┐     ┌─────────────────────────────┐  │
│   │   Canvas Layer  │     │       DOM Layer             │  │
│   │                 │     │                             │  │
│   │  • Commit nodes │     │  • Branch labels            │  │
│   │  • Branch lines │     │  • Tooltips                 │  │
│   │  • Merge paths  │     │  • Context menus            │  │
│   │                 │     │  • Selection overlay        │  │
│   │  (WebGL for     │     │  • Keyboard focus indicator │  │
│   │   100K+ nodes)  │     │                             │  │
│   └─────────────────┘     └─────────────────────────────┘  │
│            ▲                          ▲                     │
│            │                          │                     │
│            ▼                          ▼                     │
│   ┌─────────────────────────────────────────────────────┐  │
│   │               Shared State Manager                   │  │
│   │                                                      │  │
│   │  • Viewport position    • Selection state           │  │
│   │  • Zoom level           • Hover state               │  │
│   │  • Visible range        • Layout data               │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**

```typescript
@customElement('ok-commit-graph')
export class CommitGraph extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: relative;
      overflow: hidden;
    }
    
    .canvas-layer {
      position: absolute;
      top: 0;
      left: 0;
    }
    
    .dom-layer {
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
    }
    
    .dom-layer .interactive {
      pointer-events: auto;
    }
  `;
  
  @state() private viewport = { x: 0, y: 0, zoom: 1 };
  @state() private hoveredNode: GraphNode | null = null;
  @state() private selectedNodes: Set<string> = new Set();
  
  private canvasController = new CanvasGraphController(this);
  
  render() {
    return html`
      <!-- Canvas layer: nodes and edges -->
      <canvas 
        class="canvas-layer"
        ${ref(this.canvasController.setCanvas)}
        @mousemove=${this.handleMouseMove}
        @click=${this.handleClick}
      ></canvas>
      
      <!-- DOM layer: labels, tooltips, overlays -->
      <div class="dom-layer">
        ${this.renderBranchLabels()}
        ${this.hoveredNode ? this.renderTooltip() : null}
        ${this.renderSelectionOverlay()}
      </div>
    `;
  }
  
  private renderBranchLabels() {
    // Only render visible labels
    return this.visibleBranches.map(branch => html`
      <ok-branch-label
        class="interactive"
        .branch=${branch}
        style=${this.getLabelStyle(branch)}
        @click=${() => this.checkoutBranch(branch)}
      ></ok-branch-label>
    `);
  }
  
  private handleMouseMove(e: MouseEvent) {
    const node = this.canvasController.hitTest(e.offsetX, e.offsetY);
    if (node !== this.hoveredNode) {
      this.hoveredNode = node;
    }
  }
}
```

---

# 5. Virtualization Strategies

## 5.1 The Problem

We cannot render all commits at once. For 100K commits at 30px height = 3,000,000px.

- Browsers have max scroll height (~33M px Chrome, varies)
- Rendering all would be slow and memory-intensive
- Most are off-screen anyway

## 5.2 Virtual Scrolling

```
┌─────────────────────────────────────────┐
│          Overscan Top (buffer)          │  Not rendered
├─────────────────────────────────────────┤
│                                         │
│          Visible Viewport               │  Rendered
│                                         │
├─────────────────────────────────────────┤
│          Overscan Bottom (buffer)       │  Not rendered
└─────────────────────────────────────────┘

Only render: Viewport + Overscan
Typical overscan: 5-10 items above/below
```

**Implementation:**

```typescript
interface VirtualScrollState {
  scrollTop: number;
  viewportHeight: number;
  totalHeight: number;
  itemHeight: number; // Fixed or estimated average
  overscan: number;
}

class VirtualScroller {
  getVisibleRange(state: VirtualScrollState): { start: number; end: number } {
    const { scrollTop, viewportHeight, itemHeight, overscan, totalItems } = state;
    
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const end = Math.min(
      totalItems,
      Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan
    );
    
    return { start, end };
  }
  
  getOffset(state: VirtualScrollState, index: number): number {
    // For fixed height items
    return index * state.itemHeight;
    
    // For variable height, use cumulative height cache
  }
}
```

## 5.3 Variable Height Rows

Commit rows may have variable height (expanded, multi-line messages).

**Solution: Height Cache with Estimation**

```typescript
class HeightCache {
  private heights = new Map<string, number>();
  private estimatedHeight = 32;
  private measuredCount = 0;
  private totalMeasured = 0;
  
  getHeight(sha: string): number {
    return this.heights.get(sha) ?? this.estimatedHeight;
  }
  
  setHeight(sha: string, height: number): void {
    if (!this.heights.has(sha)) {
      this.measuredCount++;
      this.totalMeasured += height;
      this.estimatedHeight = this.totalMeasured / this.measuredCount;
    }
    this.heights.set(sha, height);
  }
  
  getTotalHeight(count: number): number {
    let total = 0;
    let measured = 0;
    
    for (const [_, height] of this.heights) {
      total += height;
      measured++;
    }
    
    // Estimate unmeasured items
    const unmeasured = count - measured;
    total += unmeasured * this.estimatedHeight;
    
    return total;
  }
}
```

## 5.4 Horizontal Virtualization (Wide Graphs)

For repositories with many parallel branches:

```typescript
interface Viewport2D {
  x: number;      // Horizontal scroll position
  y: number;      // Vertical scroll position
  width: number;  // Viewport width
  height: number; // Viewport height
}

function getVisibleLanes(viewport: Viewport2D, laneWidth: number): Range {
  return {
    start: Math.floor(viewport.x / laneWidth),
    end: Math.ceil((viewport.x + viewport.width) / laneWidth),
  };
}

function getVisibleNodes(
  nodes: GraphNode[],
  viewport: Viewport2D,
  laneWidth: number,
  rowHeight: number
): GraphNode[] {
  const lanes = getVisibleLanes(viewport, laneWidth);
  const rows = getVisibleRows(viewport, rowHeight);
  
  return nodes.filter(node => 
    node.lane >= lanes.start && 
    node.lane <= lanes.end &&
    node.row >= rows.start &&
    node.row <= rows.end
  );
}
```

---

# 6. Data Architecture

## 6.1 Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         RUST BACKEND                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   git2-rs                                                        │
│      │                                                           │
│      ▼                                                           │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                 Commit Iterator                          │   │
│   │   (lazy, yields commits in topological order)            │   │
│   └─────────────────────────────────────────────────────────┘   │
│      │                                                           │
│      ▼                                                           │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                  Layout Engine                           │   │
│   │   (Rust-side lane assignment for performance)            │   │
│   └─────────────────────────────────────────────────────────┘   │
│      │                                                           │
│      ▼                                                           │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                  Serialization                           │   │
│   │   (efficient binary or JSON chunks)                      │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ IPC (chunks of 100-500 commits)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                  Commit Store                            │   │
│   │   (indexed by SHA, maintains order)                      │   │
│   └─────────────────────────────────────────────────────────┘   │
│      │                                                           │
│      ▼                                                           │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                  Graph Model                             │   │
│   │   (computed positions, connections)                      │   │
│   └─────────────────────────────────────────────────────────┘   │
│      │                                                           │
│      ▼                                                           │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                  Render State                            │   │
│   │   (visible subset, hit testing data)                     │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 6.2 Commit Data Structure

**Minimal commit data for graph rendering:**

```typescript
// Full commit data (fetched on demand)
interface Commit {
  sha: string;
  shortSha: string;
  message: string;
  body: string;
  author: {
    name: string;
    email: string;
    timestamp: number;
  };
  committer: {
    name: string;
    email: string;
    timestamp: number;
  };
  parents: string[];
  tree: string;
  refs: string[];  // branches, tags pointing here
}

// Minimal data for graph (kept in memory for all commits)
interface GraphCommit {
  sha: string;       // 40 chars, could use binary for memory savings
  parents: string[]; // Usually 1-2, rarely more
  lane: number;      // Assigned lane (X position)
  row: number;       // Y position in list
  refs: string[];    // Pre-computed for rendering
}

// Memory estimate for 100K commits:
// - sha: 40 bytes (or 20 bytes binary)
// - parents: ~64 bytes average (1.5 parents × 40 bytes + array overhead)
// - lane: 4 bytes
// - row: 4 bytes
// - refs: ~32 bytes average
// Total: ~144 bytes × 100K = ~14 MB
```

## 6.3 Layout Data Structure

```typescript
interface GraphLayout {
  nodes: Map<string, NodePosition>;
  edges: EdgePath[];
  lanes: LaneInfo[];
  totalHeight: number;
  maxLane: number;
}

interface NodePosition {
  x: number;       // Pixel position (lane × laneWidth)
  y: number;       // Pixel position (row × rowHeight)
  lane: number;    // Lane index
  row: number;     // Row index
}

interface EdgePath {
  fromSha: string;
  toSha: string;
  path: PathSegment[];  // Pre-computed bezier curves
  color: string;
}

interface PathSegment {
  type: 'M' | 'L' | 'C';  // MoveTo, LineTo, CurveTo
  points: number[];        // Coordinates
}
```

## 6.4 Streaming / Pagination

For large repos, load commits in chunks:

```typescript
// Rust command
#[tauri::command]
async fn get_commits(
  repo_path: &str,
  start: Option<&str>,  // Start SHA or null for HEAD
  limit: usize,         // Chunk size
  include_layout: bool, // Pre-compute lanes in Rust?
) -> Result<CommitChunk, Error> {
  // ...
}

interface CommitChunk {
  commits: GraphCommit[];
  hasMore: boolean;
  nextCursor: string | null;
  totalCount: number;  // Estimated if expensive to compute
}

// Frontend loading
class CommitLoader {
  private loaded: GraphCommit[] = [];
  private cursor: string | null = null;
  private loading = false;
  
  async loadMore(count: number = 500): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    
    try {
      const chunk = await invoke<CommitChunk>('get_commits', {
        repoPath: this.repoPath,
        start: this.cursor,
        limit: count,
        includeLayout: true,
      });
      
      this.loaded.push(...chunk.commits);
      this.cursor = chunk.nextCursor;
      this.hasMore = chunk.hasMore;
      
      this.emit('commits-loaded', chunk.commits);
    } finally {
      this.loading = false;
    }
  }
  
  // Load more when scrolling near end
  onScroll(scrollTop: number, viewportHeight: number, totalHeight: number) {
    const remaining = totalHeight - scrollTop - viewportHeight;
    if (remaining < viewportHeight * 2 && this.hasMore) {
      this.loadMore();
    }
  }
}
```

---

# 7. Caching Strategy

## 7.1 What to Cache

| Data | Cache Location | Invalidation |
|------|----------------|--------------|
| Commit objects | SQLite + Memory | On fetch/pull |
| Layout positions | Memory | On new commits |
| Rendered segments | Canvas ImageData | On scroll/zoom |
| Branch colors | LocalStorage | Never (user preference) |
| File contents (diff) | Memory LRU | On memory pressure |

## 7.2 Layout Cache

```typescript
class LayoutCache {
  private layouts = new Map<string, GraphLayout>();
  
  // Cache key includes factors that affect layout
  private getCacheKey(
    repoPath: string,
    headSha: string,
    branchFilter: string[],
  ): string {
    return `${repoPath}:${headSha}:${branchFilter.sort().join(',')}`;
  }
  
  get(key: string): GraphLayout | null {
    return this.layouts.get(key) ?? null;
  }
  
  set(key: string, layout: GraphLayout): void {
    // Limit cache size
    if (this.layouts.size > 10) {
      const oldest = this.layouts.keys().next().value;
      this.layouts.delete(oldest);
    }
    this.layouts.set(key, layout);
  }
  
  // Invalidate on relevant changes
  invalidate(repoPath: string): void {
    for (const key of this.layouts.keys()) {
      if (key.startsWith(repoPath)) {
        this.layouts.delete(key);
      }
    }
  }
}
```

## 7.3 Tile-Based Render Cache

For very large graphs, cache rendered tiles:

```typescript
interface RenderTile {
  x: number;           // Tile position
  y: number;
  width: number;       // Tile size (e.g., 512×512)
  height: number;
  imageData: ImageBitmap;
  version: number;     // Invalidation key
}

class TileCache {
  private tiles = new Map<string, RenderTile>();
  private maxTiles = 50;
  
  getTileKey(x: number, y: number, tileSize: number): string {
    return `${Math.floor(x / tileSize)},${Math.floor(y / tileSize)}`;
  }
  
  // Render visible tiles, use cached when available
  renderViewport(
    viewport: Viewport,
    tileSize: number,
    renderFn: (tile: Rect) => ImageBitmap,
  ): void {
    const startTileX = Math.floor(viewport.x / tileSize);
    const startTileY = Math.floor(viewport.y / tileSize);
    const endTileX = Math.ceil((viewport.x + viewport.width) / tileSize);
    const endTileY = Math.ceil((viewport.y + viewport.height) / tileSize);
    
    for (let ty = startTileY; ty < endTileY; ty++) {
      for (let tx = startTileX; tx < endTileX; tx++) {
        const key = `${tx},${ty}`;
        let tile = this.tiles.get(key);
        
        if (!tile || tile.version !== this.currentVersion) {
          // Render and cache tile
          const bitmap = renderFn({
            x: tx * tileSize,
            y: ty * tileSize,
            width: tileSize,
            height: tileSize,
          });
          
          tile = { x: tx * tileSize, y: ty * tileSize, 
                   width: tileSize, height: tileSize,
                   imageData: bitmap, version: this.currentVersion };
          this.tiles.set(key, tile);
        }
        
        // Draw cached tile
        this.ctx.drawImage(tile.imageData, tile.x - viewport.x, tile.y - viewport.y);
      }
    }
  }
}
```

---

# 8. Incremental Updates

## 8.1 Update Scenarios

| Scenario | Layout Impact | Handling |
|----------|--------------|----------|
| New local commit | Prepend, shift rows | Incremental |
| Fetch new commits | May insert anywhere | Full recalc |
| Branch creation | Add label only | No layout change |
| Branch deletion | Remove label only | No layout change |
| Checkout | HEAD indicator moves | No layout change |
| Rebase | Multiple commits change | Full recalc |
| Amend | Replace head commit | Incremental |

## 8.2 Efficient Update Strategy

```typescript
class GraphUpdater {
  // Detect what changed
  computeDelta(
    oldCommits: Map<string, GraphCommit>,
    newCommits: Map<string, GraphCommit>,
  ): GraphDelta {
    const added: GraphCommit[] = [];
    const removed: string[] = [];
    const modified: GraphCommit[] = [];
    
    for (const [sha, commit] of newCommits) {
      if (!oldCommits.has(sha)) {
        added.push(commit);
      } else if (this.commitChanged(oldCommits.get(sha)!, commit)) {
        modified.push(commit);
      }
    }
    
    for (const sha of oldCommits.keys()) {
      if (!newCommits.has(sha)) {
        removed.push(sha);
      }
    }
    
    return { added, removed, modified };
  }
  
  // Apply minimal update
  applyDelta(layout: GraphLayout, delta: GraphDelta): GraphLayout {
    // If changes are small and at head, do incremental update
    if (delta.removed.length === 0 && 
        delta.modified.length === 0 && 
        delta.added.length < 10 &&
        this.allAtHead(delta.added)) {
      return this.incrementalPrepend(layout, delta.added);
    }
    
    // Otherwise, full recalculation
    return this.fullRecalculate();
  }
  
  private incrementalPrepend(
    layout: GraphLayout, 
    newCommits: GraphCommit[]
  ): GraphLayout {
    // Shift all existing positions down
    for (const node of layout.nodes.values()) {
      node.row += newCommits.length;
      node.y += newCommits.length * ROW_HEIGHT;
    }
    
    // Add new commits at top
    for (let i = 0; i < newCommits.length; i++) {
      const commit = newCommits[i];
      layout.nodes.set(commit.sha, {
        lane: this.assignLane(commit, layout),
        row: i,
        x: this.assignLane(commit, layout) * LANE_WIDTH,
        y: i * ROW_HEIGHT,
      });
    }
    
    // Recalculate edges for new commits only
    this.addEdges(layout, newCommits);
    
    return layout;
  }
}
```

## 8.3 File System Watcher Integration

```typescript
// Backend: Watch for repository changes
#[tauri::command]
fn watch_repository(repo_path: &str, app: AppHandle) {
  let (tx, rx) = channel();
  
  let watcher = RecommendedWatcher::new(tx, Config::default())?;
  watcher.watch(Path::new(repo_path).join(".git"), RecursiveMode::Recursive)?;
  
  // Debounce events
  let debouncer = Debouncer::new(Duration::from_millis(100));
  
  for event in rx {
    if debouncer.should_emit() {
      let changes = analyze_changes(&event);
      app.emit_all("repo-changed", changes)?;
    }
  }
}

// Frontend: React to changes
class RepositoryWatcher {
  constructor() {
    listen<RepoChanges>('repo-changed', (event) => {
      this.handleChanges(event.payload);
    });
  }
  
  private async handleChanges(changes: RepoChanges) {
    if (changes.refsChanged || changes.headChanged) {
      // Fetch new commit data
      const newCommits = await this.fetchCommits();
      const delta = this.computeDelta(this.commits, newCommits);
      
      // Apply minimal update
      this.layout = this.applyDelta(this.layout, delta);
      this.requestRender();
    }
  }
}
```

---

# 9. Interaction Handling

## 9.1 Hit Testing

Since Canvas doesn't have native events, we need manual hit testing:

```typescript
class HitTester {
  // Spatial index for fast lookups
  private grid: Map<string, GraphNode[]> = new Map();
  private cellSize = 50;
  
  buildIndex(nodes: GraphNode[]): void {
    this.grid.clear();
    
    for (const node of nodes) {
      const cellKey = this.getCellKey(node.x, node.y);
      
      if (!this.grid.has(cellKey)) {
        this.grid.set(cellKey, []);
      }
      this.grid.get(cellKey)!.push(node);
    }
  }
  
  private getCellKey(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }
  
  hitTest(x: number, y: number, radius: number = 10): GraphNode | null {
    // Check current cell and neighbors
    const cellX = Math.floor(x / this.cellSize);
    const cellY = Math.floor(y / this.cellSize);
    
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cellX + dx},${cellY + dy}`;
        const nodes = this.grid.get(key) ?? [];
        
        for (const node of nodes) {
          const dist = Math.hypot(x - node.x, y - node.y);
          if (dist <= radius) {
            return node;
          }
        }
      }
    }
    
    return null;
  }
  
  // Hit test for edges (more complex)
  hitTestEdge(x: number, y: number, tolerance: number = 5): Edge | null {
    for (const edge of this.visibleEdges) {
      if (this.pointNearBezier(x, y, edge.path, tolerance)) {
        return edge;
      }
    }
    return null;
  }
}
```

## 9.2 Keyboard Navigation

```typescript
class GraphKeyboardController implements ReactiveController {
  host: ReactiveControllerHost;
  
  hostConnected() {
    window.addEventListener('keydown', this.handleKeyDown);
  }
  
  hostDisconnected() {
    window.removeEventListener('keydown', this.handleKeyDown);
  }
  
  private handleKeyDown = (e: KeyboardEvent) => {
    if (!this.graphFocused) return;
    
    switch (e.key) {
      case 'ArrowUp':
        this.selectPrevious();
        break;
      case 'ArrowDown':
        this.selectNext();
        break;
      case 'ArrowLeft':
        // Navigate to parent
        this.selectParent();
        break;
      case 'ArrowRight':
        // Navigate to child
        this.selectChild();
        break;
      case 'Home':
        this.scrollToHead();
        break;
      case 'End':
        this.scrollToTail();
        break;
      case 'Enter':
        this.activateSelection();
        break;
      case ' ':
        e.preventDefault();
        this.toggleSelection();
        break;
      case '/':
        e.preventDefault();
        this.focusSearch();
        break;
    }
  };
}
```

## 9.3 Drag and Drop

```typescript
class DragDropController {
  private dragState: DragState | null = null;
  
  startDrag(e: MouseEvent, source: DragSource): void {
    this.dragState = {
      source,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
    };
    
    document.addEventListener('mousemove', this.onDrag);
    document.addEventListener('mouseup', this.onDrop);
  }
  
  private onDrag = (e: MouseEvent) => {
    if (!this.dragState) return;
    
    this.dragState.currentX = e.clientX;
    this.dragState.currentY = e.clientY;
    
    // Determine drop target
    const target = this.findDropTarget(e);
    this.renderDragFeedback(this.dragState, target);
  };
  
  private onDrop = (e: MouseEvent) => {
    if (!this.dragState) return;
    
    const target = this.findDropTarget(e);
    if (target && this.isValidDrop(this.dragState.source, target)) {
      this.executeDrop(this.dragState.source, target);
    }
    
    this.dragState = null;
    document.removeEventListener('mousemove', this.onDrag);
    document.removeEventListener('mouseup', this.onDrop);
  };
  
  // Valid drops:
  // - Branch → Commit = Checkout / Create branch
  // - Branch → Branch = Merge / Rebase
  // - Commit → Branch = Cherry-pick
}
```

---

# 10. Recommended Architecture

## 10.1 Final Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ok-commit-graph                              │
│                      (Lit Element Component)                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │                    GraphController                          │   │
│   │              (Lit Reactive Controller)                      │   │
│   │                                                             │   │
│   │   • Manages data loading from Rust                          │   │
│   │   • Handles layout computation                              │   │
│   │   • Coordinates render/interaction                          │   │
│   └────────────────────────────────────────────────────────────┘   │
│          │                    │                     │               │
│          ▼                    ▼                     ▼               │
│   ┌────────────┐      ┌─────────────┐      ┌──────────────┐       │
│   │ CommitStore │      │ LayoutEngine │      │ RenderEngine │       │
│   │            │      │             │      │              │       │
│   │ • Commit   │      │ • Lane      │      │ • Canvas 2D  │       │
│   │   data     │      │   assignment│      │ • WebGL opt. │       │
│   │ • Refs     │      │ • Edge      │      │ • Tile cache │       │
│   │ • Search   │      │   routing   │      │ • Hit testing│       │
│   │   index    │      │ • Caching   │      │              │       │
│   └────────────┘      └─────────────┘      └──────────────┘       │
│          │                    │                     │               │
│          └────────────────────┼─────────────────────┘               │
│                               ▼                                      │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │                   InteractionManager                        │   │
│   │                                                             │   │
│   │   • Mouse events (click, hover, drag)                       │   │
│   │   • Keyboard navigation                                      │   │
│   │   • Touch support                                            │   │
│   │   • Context menus                                            │   │
│   │   • Selection management                                     │   │
│   └────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   Template:                                                          │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │  <div class="container">                                    │   │
│   │    <canvas class="graph-canvas"></canvas>  ← Main render    │   │
│   │    <div class="labels-layer">              ← DOM overlays   │   │
│   │      <ok-branch-label>                                      │   │
│   │      <ok-tag-label>                                         │   │
│   │      <ok-tooltip>                                           │   │
│   │    </div>                                                   │   │
│   │    <div class="columns">                   ← Scrollable     │   │
│   │      <ok-commit-row>                                        │   │
│   │    </div>                                                   │   │
│   │  </div>                                                     │   │
│   └────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## 10.2 Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout algorithm | Git-optimized (first-parent) | O(n), good results for git DAGs |
| Primary rendering | Canvas 2D | Best perf/complexity balance |
| WebGL | Optional enhancement | For 100K+ commit repos |
| Labels/tooltips | DOM overlay | Native accessibility, easy styling |
| Virtualization | Row-based | Simple, effective |
| Layout computation | Rust backend | Faster, off main thread |
| Hit testing | Spatial grid index | O(1) average lookup |
| Caching | Multi-layer | Layout + render tiles |

## 10.3 Component Structure

```typescript
// Main graph component
@customElement('ok-commit-graph')
export class CommitGraph extends LitElement {
  // Controllers
  private graphController = new GraphController(this);
  private keyboardController = new KeyboardController(this);
  private dragDropController = new DragDropController(this);
  
  // Properties
  @property({ type: String }) repository?: string;
  @property({ type: Array }) branchFilter: string[] = [];
  @property({ type: String }) searchQuery = '';
  
  // State
  @state() private selectedCommits: Set<string> = new Set();
  @state() private hoveredCommit: GraphCommit | null = null;
  @state() private viewport: Viewport = { x: 0, y: 0, width: 0, height: 0 };
  
  static styles = css`/* ... */`;
  
  render() {
    return html`
      <div class="graph-container" ${ref(this.containerRef)}>
        <!-- Graph canvas (nodes + edges) -->
        <canvas 
          class="graph-canvas"
          ${ref(this.canvasRef)}
          @wheel=${this.handleWheel}
          @pointerdown=${this.handlePointerDown}
          @pointermove=${this.handlePointerMove}
          @pointerup=${this.handlePointerUp}
        ></canvas>
        
        <!-- Branch/tag labels (DOM for accessibility) -->
        <div class="labels-layer">
          ${this.renderLabels()}
        </div>
        
        <!-- Tooltip -->
        ${this.hoveredCommit ? html`
          <ok-commit-tooltip
            .commit=${this.hoveredCommit}
            .position=${this.tooltipPosition}
          ></ok-commit-tooltip>
        ` : null}
        
        <!-- Context menu (slotted from parent) -->
        <slot name="context-menu"></slot>
      </div>
      
      <!-- Columns panel (message, author, date) -->
      <div class="columns-panel">
        <ok-virtual-list
          .items=${this.visibleCommits}
          .itemHeight=${32}
          .renderItem=${this.renderCommitRow}
          @scroll=${this.syncScroll}
        ></ok-virtual-list>
      </div>
    `;
  }
}
```

---

# 11. Proof of Concept Plan

## 11.1 POC Objectives

Validate key technical risks before full implementation:

1. ✅ Layout algorithm produces correct, readable graphs
2. ✅ Canvas rendering achieves 60fps with 10K commits
3. ✅ Virtualization works correctly
4. ✅ Hit testing is accurate and fast
5. ✅ Incremental updates work for common scenarios

## 11.2 POC Scope

| In Scope | Out of Scope |
|----------|--------------|
| Basic commit graph (nodes + edges) | Drag-and-drop |
| Lane assignment algorithm | Integration with real git |
| Canvas rendering | All label types |
| Virtual scrolling | Context menus |
| Basic click selection | Multiple selection |
| Hover highlighting | Search/filter |
| Simple bezier edges | Complex edge routing |

## 11.3 POC Implementation Plan

### Week 1: Data Model & Layout

**Day 1-2: Setup**
```
- Create Vite + Lit project
- Mock commit data generator
- Basic types/interfaces
```

**Day 3-4: Layout Algorithm**
```
- Implement git-optimized lane assignment
- Unit tests with known graphs
- Visual verification tool
```

**Day 5: Layout Output**
```
- Generate node positions
- Generate edge paths (straight lines first)
- Export to JSON for debugging
```

### Week 2: Canvas Rendering

**Day 1-2: Basic Canvas**
```
- Canvas component setup
- Render static nodes
- Render static edges
```

**Day 3-4: Interactions**
```
- Viewport/scroll handling
- Hit testing implementation
- Hover highlighting
- Click selection
```

**Day 5: Performance Testing**
```
- Generate 10K commit test data
- Profile rendering
- Identify bottlenecks
```

### Week 3: Virtualization & Polish

**Day 1-2: Virtual Scrolling**
```
- Implement visible range calculation
- Render only visible nodes/edges
- Smooth scrolling
```

**Day 3: Curved Edges**
```
- Bezier curve implementation
- Edge-edge crossing prevention
- Visual polish
```

**Day 4: Integration Test**
```
- Connect to real git data (via Tauri)
- Test with real repositories
- Performance validation
```

**Day 5: Documentation**
```
- Document findings
- Recommend architecture
- Identify remaining risks
```

## 11.4 POC Success Criteria

| Metric | Target | How to Measure |
|--------|--------|----------------|
| FPS (10K commits) | ≥ 60fps | Chrome DevTools Performance |
| Initial render (10K) | < 500ms | Performance.now() |
| Memory (10K commits) | < 100MB | Chrome Task Manager |
| Hit test latency | < 1ms | Performance.now() |
| Layout time (10K) | < 200ms | Performance.now() |

## 11.5 POC Code Structure

```
poc-graph/
├── src/
│   ├── components/
│   │   ├── poc-graph.ts          # Main component
│   │   └── poc-debug-panel.ts    # Debug controls
│   ├── core/
│   │   ├── layout.ts             # Lane assignment
│   │   ├── renderer.ts           # Canvas rendering
│   │   ├── hit-tester.ts         # Spatial indexing
│   │   └── virtual-scroll.ts     # Virtualization
│   ├── data/
│   │   ├── generator.ts          # Mock data generator
│   │   └── types.ts              # Interfaces
│   ├── utils/
│   │   ├── bezier.ts             # Curve math
│   │   └── profiler.ts           # Performance utils
│   └── index.ts
├── tests/
│   ├── layout.test.ts
│   ├── hit-tester.test.ts
│   └── renderer.test.ts
├── package.json
└── vite.config.ts
```

---

# 12. Open Source References

## 12.1 Existing Implementations to Study

| Project | Language | Graph Rendering | Notes |
|---------|----------|-----------------|-------|
| **gitgraph.js** | JS | SVG/Canvas | Educational, simple |
| **git-graph (VS Code)** | TS | SVG | VS Code extension, good reference |
| **Gittyup** | C++ (Qt) | Custom Qt | Open source, full featured |
| **lazygit** | Go | Terminal | TUI rendering |
| **GitUI** | Rust | Terminal | Rust TUI, git2-rs usage |
| **Sublime Merge** | C++ | Custom | Not OSS, but great UX to study |

## 12.2 Relevant Libraries

| Library | Purpose | URL |
|---------|---------|-----|
| **d3-dag** | DAG layout algorithms | github.com/erikbrinkman/d3-dag |
| **elkjs** | Layered graph layout | github.com/kieler/elkjs |
| **regl** | WebGL wrapper | github.com/regl-project/regl |
| **pixi.js** | 2D WebGL renderer | pixijs.com |
| **lit-virtualizer** | Lit virtual scrolling | github.com/nicholaswright/lit-virtualizer |

## 12.3 Research Papers

- "A Technique for Drawing Directed Graphs" - Gansner et al. (Sugiyama)
- "An Efficient Implementation of Sugiyama's Algorithm" - Eiglsperger et al.
- "Drawing Graphs with dot" - Graphviz documentation

---

# Appendix: Mock Data Generator

```typescript
// data/generator.ts

export interface MockCommit {
  sha: string;
  message: string;
  parents: string[];
  timestamp: number;
  author: string;
  refs: string[];
}

export function generateMockRepo(options: {
  commitCount: number;
  branchProbability: number;
  mergeProbability: number;
  maxBranches: number;
}): MockCommit[] {
  const commits: MockCommit[] = [];
  const activeBranches: string[] = []; // SHA of branch tips
  
  let timestamp = Date.now() - options.commitCount * 1000 * 60 * 60; // 1hr per commit
  
  for (let i = 0; i < options.commitCount; i++) {
    const sha = generateSha();
    const parents: string[] = [];
    
    // Determine parents
    if (commits.length === 0) {
      // First commit, no parents
    } else if (Math.random() < options.mergeProbability && activeBranches.length > 1) {
      // Merge commit
      parents.push(activeBranches[0]);
      const mergeFrom = Math.floor(Math.random() * (activeBranches.length - 1)) + 1;
      parents.push(activeBranches[mergeFrom]);
      activeBranches.splice(mergeFrom, 1);
    } else {
      // Regular commit on current branch
      parents.push(activeBranches[0] || commits[commits.length - 1].sha);
    }
    
    // Maybe start a new branch
    if (
      Math.random() < options.branchProbability &&
      activeBranches.length < options.maxBranches &&
      commits.length > 0
    ) {
      const branchFrom = commits[Math.floor(Math.random() * commits.length)];
      activeBranches.push(branchFrom.sha);
    }
    
    // Update branch tip
    if (activeBranches.length > 0) {
      activeBranches[0] = sha;
    } else {
      activeBranches.push(sha);
    }
    
    commits.push({
      sha,
      message: `Commit ${i}: ${generateMessage()}`,
      parents,
      timestamp,
      author: generateAuthor(),
      refs: i === 0 ? ['HEAD', 'main'] : [],
    });
    
    timestamp += 1000 * 60 * 60; // 1 hour
  }
  
  return commits.reverse(); // Newest first
}

function generateSha(): string {
  return Array.from({ length: 40 }, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

function generateMessage(): string {
  const verbs = ['Add', 'Fix', 'Update', 'Remove', 'Refactor', 'Implement'];
  const nouns = ['feature', 'bug', 'tests', 'docs', 'style', 'performance'];
  return `${verbs[Math.floor(Math.random() * verbs.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
}

function generateAuthor(): string {
  const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'];
  return names[Math.floor(Math.random() * names.length)];
}
```

---

*Document Version: 1.0*
*Created: December 2024*
*Purpose: Technical Spike for Graph Rendering*
