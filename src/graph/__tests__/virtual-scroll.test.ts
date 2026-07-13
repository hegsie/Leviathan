/**
 * Unit tests for the virtual scrolling system: edge visibility queries over
 * the numeric edge index, and direct (momentum-free) wheel scrolling.
 */
import { expect } from '@open-wc/testing';
import { VirtualScrollManager, ScrollStateManager } from '../virtual-scroll.ts';
import { assignLanes, type GraphCommit } from '../lane-assignment.ts';

function makeCommit(oid: string, parentIds: string[], timestamp: number): GraphCommit {
  return { oid, parentIds, timestamp, message: `Commit ${oid}`, author: 'Test' };
}

/** Linear chain of n commits, c0 (newest tip) ... c{n-1} (root) */
function makeChain(n: number): GraphCommit[] {
  const commits: GraphCommit[] = [];
  for (let i = 0; i < n; i++) {
    commits.push(makeCommit(`c${i}`, i < n - 1 ? [`c${i + 1}`] : [], (n - i) * 1000));
  }
  return commits;
}

describe('VirtualScrollManager', () => {
  const ROW_HEIGHT = 22;

  function makeManager(commits: GraphCommit[]): VirtualScrollManager {
    const manager = new VirtualScrollManager({
      rowHeight: ROW_HEIGHT,
      laneWidth: 14,
      padding: 20,
      overscanRows: 2,
    });
    manager.setLayout(assignLanes(commits, { headOid: commits[0]?.oid }));
    return manager;
  }

  it('returns only nodes and edges near the viewport', () => {
    const manager = makeManager(makeChain(100));

    const data = manager.getRenderData({
      scrollTop: 0,
      scrollLeft: 0,
      width: 800,
      height: 10 * ROW_HEIGHT,
    });

    // ~10 visible rows + 2 overscan + padding slack, far fewer than 100
    expect(data.nodes.length).to.be.greaterThan(5);
    expect(data.nodes.length).to.be.lessThan(20);
    // Linear chain: an edge is visible iff it touches the visible rows
    expect(data.edges.length).to.be.greaterThan(0);
    expect(data.edges.length).to.be.lessThan(20);
  });

  it('includes long edges that span across the viewport', () => {
    // c0 tip merges c50 directly: edge spans rows 0..~50
    const commits = makeChain(100);
    commits[0] = makeCommit('c0', ['c1', 'c50'], 100 * 1000);
    const manager = makeManager(commits);

    // Scroll to the middle: rows ~20-30 visible; the long c0->c50 edge
    // spans across them and must be returned even though neither endpoint
    // is visible
    const data = manager.getRenderData({
      scrollTop: 25 * ROW_HEIGHT,
      scrollLeft: 0,
      width: 800,
      height: 5 * ROW_HEIGHT,
    });

    const longEdge = data.edges.find((e) => e.fromOid === 'c50' && e.toOid === 'c0');
    expect(longEdge).to.not.be.undefined;
  });

  it('returns edges below the viewport start but not past its end', () => {
    const manager = makeManager(makeChain(100));

    const data = manager.getRenderData({
      scrollTop: 50 * ROW_HEIGHT,
      scrollLeft: 0,
      width: 800,
      height: 10 * ROW_HEIGHT,
    });

    for (const edge of data.edges) {
      const minRow = Math.min(edge.fromRow, edge.toRow);
      const maxRow = Math.max(edge.fromRow, edge.toRow);
      // Every returned edge intersects the (overscanned) visible range
      expect(maxRow).to.be.greaterThan(40);
      expect(minRow).to.be.lessThan(70);
    }
  });
});

describe('ScrollStateManager', () => {
  it('applies wheel deltas immediately with clamping', () => {
    const changes: Array<{ top: number; left: number }> = [];
    const manager = new ScrollStateManager((top, left) => changes.push({ top, left }));

    manager.handleWheel(10, 30, 100, 200);
    expect(manager.getScroll()).to.deep.equal({ scrollTop: 30, scrollLeft: 10 });
    expect(changes).to.have.length(1);

    // Clamp at max
    manager.handleWheel(500, 500, 100, 200);
    expect(manager.getScroll()).to.deep.equal({ scrollTop: 200, scrollLeft: 100 });

    // Clamp at 0
    manager.handleWheel(-999, -999, 100, 200);
    expect(manager.getScroll()).to.deep.equal({ scrollTop: 0, scrollLeft: 0 });
  });

  it('does not keep scrolling after the wheel event (no synthetic momentum)', async () => {
    const manager = new ScrollStateManager();
    manager.handleWheel(0, 50, 1000, 1000);
    const after = manager.getScroll();

    // Wait a few frames — position must not drift
    await new Promise((r) => setTimeout(r, 100));
    expect(manager.getScroll()).to.deep.equal(after);
    manager.destroy();
  });
});
