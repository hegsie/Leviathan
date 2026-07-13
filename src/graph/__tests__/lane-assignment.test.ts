/**
 * Unit tests for the lane assignment algorithm: topological ordering,
 * mainline pinning to lane 0, stable per-branch colors, merge-edge
 * semantics, and lane reuse.
 */
import { expect } from '@open-wc/testing';
import {
  assignLanes,
  appendLanes,
  validateLayout,
  type GraphCommit,
} from '../lane-assignment.ts';

function makeCommit(
  oid: string,
  parentIds: string[],
  timestamp: number
): GraphCommit {
  return {
    oid,
    parentIds,
    timestamp,
    message: `Commit ${oid}`,
    author: 'Test Author',
  };
}

describe('assignLanes', () => {
  it('returns an empty layout for no commits', () => {
    const layout = assignLanes([]);
    expect(layout.nodes.size).to.equal(0);
    expect(layout.edges).to.have.length(0);
    expect(layout.totalRows).to.equal(0);
  });

  it('lays out linear history in a single lane with a single color', () => {
    const commits = [
      makeCommit('c3', ['c2'], 3000),
      makeCommit('c2', ['c1'], 2000),
      makeCommit('c1', [], 1000),
    ];
    const layout = assignLanes(commits, { headOid: 'c3' });

    expect(layout.maxLane).to.equal(0);
    for (const node of layout.nodes.values()) {
      expect(node.lane).to.equal(0);
      expect(node.colorIndex).to.equal(0);
    }
    expect(validateLayout(layout, commits)).to.deep.equal([]);
  });

  it('orders topologically even when a parent has a NEWER timestamp than its child (clock skew)', () => {
    const commits = [
      makeCommit('child', ['parent'], 1000),
      // Parent committed "later" according to its clock
      makeCommit('parent', [], 5000),
    ];
    const layout = assignLanes(commits);

    const childRow = layout.nodes.get('child')!.row;
    const parentRow = layout.nodes.get('parent')!.row;
    expect(childRow).to.be.lessThan(parentRow);
    expect(validateLayout(layout, commits)).to.deep.equal([]);
  });

  it('pins the HEAD first-parent chain to lane 0 even when a side branch is newer', () => {
    // Side branch tip is the newest commit; without pinning it would grab lane 0
    const commits = [
      makeCommit('side2', ['side1'], 9000),
      makeCommit('side1', ['base'], 8000),
      makeCommit('head', ['base'], 3000),
      makeCommit('base', [], 1000),
    ];
    const layout = assignLanes(commits, { headOid: 'head' });

    expect(layout.nodes.get('head')!.lane).to.equal(0);
    expect(layout.nodes.get('base')!.lane).to.equal(0);
    expect(layout.nodes.get('head')!.colorIndex).to.equal(0);
    expect(layout.nodes.get('base')!.colorIndex).to.equal(0);

    // The side branch lives in a different lane with a different color
    expect(layout.nodes.get('side1')!.lane).to.be.greaterThan(0);
    expect(layout.nodes.get('side1')!.colorIndex).to.be.greaterThan(0);
    expect(validateLayout(layout, commits)).to.deep.equal([]);
  });

  it('keeps one color along a branch line', () => {
    const commits = [
      makeCommit('main2', ['main1'], 9000),
      makeCommit('side2', ['side1'], 8000),
      makeCommit('side1', ['main1'], 7000),
      makeCommit('main1', [], 1000),
    ];
    const layout = assignLanes(commits, { headOid: 'main2' });

    const side1 = layout.nodes.get('side1')!;
    const side2 = layout.nodes.get('side2')!;
    expect(side1.colorIndex).to.equal(side2.colorIndex);
    expect(side1.colorIndex).to.not.equal(0);
  });

  it('gives unrelated branches different colors even if they reuse a lane', () => {
    // branchA ends (merges into main), then branchB starts — it may reuse
    // branchA's lane but must NOT reuse its color
    const commits = [
      makeCommit('merge', ['main2', 'a1'], 9000),
      makeCommit('main2', ['main1'], 8000),
      makeCommit('a1', ['main1'], 7000),
      makeCommit('main1', ['main0', 'b1'], 6000),
      makeCommit('b1', ['main0'], 5000),
      makeCommit('main0', [], 1000),
    ];
    const layout = assignLanes(commits, { headOid: 'merge' });

    const a1 = layout.nodes.get('a1')!;
    const b1 = layout.nodes.get('b1')!;
    expect(a1.colorIndex).to.not.equal(b1.colorIndex);
    expect(validateLayout(layout, commits)).to.deep.equal([]);
  });

  it('flags only second-parent edges as merge edges', () => {
    const commits = [
      makeCommit('merge', ['main1', 'side1'], 9000),
      makeCommit('side1', ['main0'], 5000),
      makeCommit('main1', ['main0'], 4000),
      makeCommit('main0', [], 1000),
    ];
    const layout = assignLanes(commits, { headOid: 'merge' });

    const firstParentEdge = layout.edges.find(
      (e) => e.fromOid === 'main1' && e.toOid === 'merge'
    )!;
    const mergeEdge = layout.edges.find(
      (e) => e.fromOid === 'side1' && e.toOid === 'merge'
    )!;

    // Both edges point at a merge commit, but only the second-parent edge
    // is a merge edge
    expect(firstParentEdge.isMerge).to.be.false;
    expect(mergeEdge.isMerge).to.be.true;
  });

  it('colors a merge edge with the merged branch color, not the mainline color', () => {
    const commits = [
      makeCommit('merge', ['main1', 'side1'], 9000),
      makeCommit('side1', ['main0'], 5000),
      makeCommit('main1', ['main0'], 4000),
      makeCommit('main0', [], 1000),
    ];
    const layout = assignLanes(commits, { headOid: 'merge' });

    const side1 = layout.nodes.get('side1')!;
    const mergeEdge = layout.edges.find(
      (e) => e.fromOid === 'side1' && e.toOid === 'merge'
    )!;
    const firstParentEdge = layout.edges.find(
      (e) => e.fromOid === 'main1' && e.toOid === 'merge'
    )!;

    expect(mergeEdge.colorIndex).to.equal(side1.colorIndex);
    expect(firstParentEdge.colorIndex).to.equal(0); // mainline
  });

  it('reuses a freed lane for a later branch', () => {
    // branchA (a1) merges back before branchB (b1) starts, so branchB can
    // reuse branchA's lane
    const commits = [
      makeCommit('m4', ['m3', 'b1'], 9000),
      makeCommit('m3', ['m2'], 8000),
      makeCommit('b1', ['m2'], 7000),
      makeCommit('m2', ['m1', 'a1'], 6000),
      makeCommit('m1', ['m0'], 5000),
      makeCommit('a1', ['m0'], 4000),
      makeCommit('m0', [], 1000),
    ];
    const layout = assignLanes(commits, { headOid: 'm4' });

    // Two concurrent lines at most: mainline + one branch at a time
    expect(layout.maxLane).to.equal(1);
    expect(layout.nodes.get('a1')!.lane).to.equal(1);
    expect(layout.nodes.get('b1')!.lane).to.equal(1);
    // ...but the reused lane does not reuse the color
    expect(layout.nodes.get('a1')!.colorIndex).to.not.equal(
      layout.nodes.get('b1')!.colorIndex
    );
    expect(validateLayout(layout, commits)).to.deep.equal([]);
  });

  it('assigns exactly one row per commit', () => {
    const commits = [
      makeCommit('c3', ['c1'], 3000),
      makeCommit('c2', ['c1'], 2500),
      makeCommit('c1', [], 1000),
    ];
    const layout = assignLanes(commits, { headOid: 'c3' });

    const rows = [...layout.nodes.values()].map((n) => n.row).sort((a, b) => a - b);
    expect(rows).to.deep.equal([0, 1, 2]);
    expect(layout.totalRows).to.equal(3);
  });

  it('works without a headOid (no mainline pinning, colors still stable)', () => {
    const commits = [
      makeCommit('c2', ['c1'], 2000),
      makeCommit('c1', [], 1000),
    ];
    const layout = assignLanes(commits);

    expect(layout.nodes.get('c2')!.lane).to.equal(0);
    expect(layout.nodes.get('c1')!.lane).to.equal(0);
    expect(layout.nodes.get('c1')!.colorIndex).to.equal(
      layout.nodes.get('c2')!.colorIndex
    );
    expect(validateLayout(layout, commits)).to.deep.equal([]);
  });

  it('handles parents outside the loaded window without crashing', () => {
    const commits = [
      makeCommit('c2', ['c1'], 2000),
      makeCommit('c1', ['outside-window'], 1000),
    ];
    const layout = assignLanes(commits, { headOid: 'c2' });

    expect(layout.nodes.size).to.equal(2);
    expect(validateLayout(layout, commits)).to.deep.equal([]);
  });

  it('flags commits whose parents are outside the loaded window', () => {
    const commits = [
      makeCommit('c2', ['c1'], 2000),
      makeCommit('c1', ['not-loaded'], 1000),
    ];
    const layout = assignLanes(commits, { headOid: 'c2' });

    // c1's parent is beyond the pagination window — history continues
    expect(layout.nodes.get('c1')!.hasMissingParents).to.be.true;
    // c2's parent (c1) is loaded
    expect(layout.nodes.get('c2')!.hasMissingParents).to.be.false;
  });

  it('does not flag a merge whose first-parent chain is loaded but merged branch is missing', () => {
    const commits = [
      makeCommit('merge', ['main1', 'unloaded-side'], 3000),
      makeCommit('main1', [], 1000),
    ];
    const layout = assignLanes(commits, { headOid: 'merge' });

    // The merge's OWN line continues via the loaded first parent — no
    // dead-end stub over the real mainline edge
    expect(layout.nodes.get('merge')!.hasMissingParents).to.be.false;
  });

  it('reserves lane 0 / color 0 for the mainline even when HEAD is not in the first page', () => {
    // Detached HEAD on an older commit: page 1 holds only newer branch
    // commits; the mainline arrives in page 2
    const page1 = [
      makeCommit('branch2', ['branch1'], 9000),
      makeCommit('branch1', ['old-base'], 8000),
    ];
    const layout = assignLanes(page1, { headOid: 'head-commit' });

    // The unrelated branch must NOT take the mainline's lane 0 / color 0
    expect(layout.nodes.get('branch2')!.lane).to.be.greaterThan(0);
    expect(layout.nodes.get('branch2')!.colorIndex).to.be.greaterThan(0);

    appendLanes(layout, [
      makeCommit('head-commit', ['old-base'], 3000),
      makeCommit('old-base', [], 1000),
    ]);

    expect(layout.nodes.get('head-commit')!.lane).to.equal(0);
    expect(layout.nodes.get('head-commit')!.colorIndex).to.equal(0);
    expect(layout.nodes.get('old-base')!.lane).to.equal(0);
  });

  it('does not flag true root commits as having missing parents', () => {
    const commits = [
      makeCommit('c2', ['c1'], 2000),
      makeCommit('c1', [], 1000),
    ];
    const layout = assignLanes(commits, { headOid: 'c2' });

    expect(layout.nodes.get('c1')!.hasMissingParents).to.be.false;
  });

  it('produces a valid layout for a complex branchy history', () => {
    const commits = [
      makeCommit('h', ['g', 'f'], 9000),
      makeCommit('g', ['e'], 8000),
      makeCommit('f', ['d'], 7000),
      makeCommit('e', ['d', 'c'], 6000),
      makeCommit('d', ['b'], 5000),
      makeCommit('c', ['b'], 4000),
      makeCommit('b', ['a'], 2000),
      makeCommit('a', [], 1000),
    ];
    const layout = assignLanes(commits, { headOid: 'h' });

    expect(layout.nodes.size).to.equal(8);
    expect(validateLayout(layout, commits)).to.deep.equal([]);
    // Mainline chain h -> g -> e -> d -> b -> a pinned to lane 0
    for (const oid of ['h', 'g', 'e', 'd', 'b', 'a']) {
      expect(layout.nodes.get(oid)!.lane).to.equal(0, `expected ${oid} in lane 0`);
      expect(layout.nodes.get(oid)!.colorIndex).to.equal(0, `expected ${oid} color 0`);
    }
  });
});

describe('appendLanes', () => {
  it('does not disturb rows, lanes, or colors of already-laid-out commits', () => {
    const page1 = [
      makeCommit('m3', ['m2'], 9000),
      makeCommit('side1', ['m1'], 8500),
      makeCommit('m2', ['m1'], 8000),
      makeCommit('m1', ['m0'], 7000), // m0 is beyond the window
    ];
    const layout = assignLanes(page1, { headOid: 'm3' });

    const before = new Map(
      [...layout.nodes.values()].map((n) => [
        n.oid,
        { row: n.row, lane: n.lane, colorIndex: n.colorIndex },
      ])
    );

    appendLanes(layout, [makeCommit('m0', [], 1000)]);

    for (const [oid, snapshot] of before) {
      const node = layout.nodes.get(oid)!;
      expect(node.row).to.equal(snapshot.row, `row of ${oid}`);
      expect(node.lane).to.equal(snapshot.lane, `lane of ${oid}`);
      expect(node.colorIndex).to.equal(snapshot.colorIndex, `color of ${oid}`);
    }
  });

  it('creates edges from appended parents to already-visible children', () => {
    const page1 = [
      makeCommit('c2', ['c1'], 3000),
      makeCommit('c1', ['c0'], 2000),
    ];
    const layout = assignLanes(page1, { headOid: 'c2' });
    expect(layout.edges).to.have.length(1);

    appendLanes(layout, [makeCommit('c0', [], 1000)]);

    const boundaryEdge = layout.edges.find(
      (e) => e.fromOid === 'c0' && e.toOid === 'c1'
    );
    expect(boundaryEdge).to.not.be.undefined;
    expect(boundaryEdge!.fromRow).to.equal(2);
    expect(boundaryEdge!.toRow).to.equal(1);
  });

  it('clears the history-continues flag once the missing parent arrives', () => {
    const layout = assignLanes(
      [makeCommit('c1', ['c0'], 2000)],
      { headOid: 'c1' }
    );
    expect(layout.nodes.get('c1')!.hasMissingParents).to.be.true;

    appendLanes(layout, [makeCommit('c0', [], 1000)]);

    expect(layout.nodes.get('c1')!.hasMissingParents).to.be.false;
    expect(layout.nodes.get('c0')!.hasMissingParents).to.be.false;
    expect(layout.nodes.get('c1')!.parentLanes).to.deep.equal([0]);
  });

  it('creates a merge edge when the missing SECOND parent arrives in a later page', () => {
    // merge's first parent is loaded, second parent pages in later — the
    // merge edge across the page boundary must still be created
    const page1 = [
      makeCommit('merge', ['main1', 'side1'], 3000),
      makeCommit('main1', [], 1000),
    ];
    const layout = assignLanes(page1, { headOid: 'merge' });
    expect(layout.nodes.get('merge')!.hasMissingParents).to.be.false;

    appendLanes(layout, [makeCommit('side1', [], 500)]);

    const mergeEdge = layout.edges.find(
      (e) => e.fromOid === 'side1' && e.toOid === 'merge'
    );
    expect(mergeEdge).to.not.be.undefined;
    expect(mergeEdge!.isMerge).to.be.true;
  });

  it('continues the mainline into the appended page (lane 0, color 0)', () => {
    const page1 = [
      makeCommit('m2', ['m1'], 9000),
      makeCommit('side', ['m1'], 8500),
      makeCommit('m1', ['m0'], 8000),
    ];
    const layout = assignLanes(page1, { headOid: 'm2' });

    appendLanes(layout, [
      makeCommit('m0', ['root'], 2000),
      makeCommit('root', [], 1000),
    ]);

    expect(layout.nodes.get('m0')!.lane).to.equal(0);
    expect(layout.nodes.get('m0')!.colorIndex).to.equal(0);
    expect(layout.nodes.get('root')!.lane).to.equal(0);
    expect(layout.nodes.get('root')!.colorIndex).to.equal(0);
  });

  it('continues a side branch line with its original color', () => {
    const page1 = [
      makeCommit('m2', ['m1'], 9000),
      makeCommit('side2', ['side1'], 8500), // side1 beyond the window
      makeCommit('m1', ['m0'], 8000),
    ];
    const layout = assignLanes(page1, { headOid: 'm2' });
    const sideColor = layout.nodes.get('side2')!.colorIndex;
    const sideLane = layout.nodes.get('side2')!.lane;

    appendLanes(layout, [
      makeCommit('m0', [], 2000),
      makeCommit('side1', ['m0'], 1500),
    ]);

    expect(layout.nodes.get('side1')!.colorIndex).to.equal(sideColor);
    expect(layout.nodes.get('side1')!.lane).to.equal(sideLane);
  });

  it('appends rows below the existing layout and updates totals', () => {
    const layout = assignLanes(
      [makeCommit('c1', ['c0'], 2000)],
      { headOid: 'c1' }
    );
    expect(layout.totalRows).to.equal(1);

    appendLanes(layout, [makeCommit('c0', [], 1000)]);

    expect(layout.totalRows).to.equal(2);
    expect(layout.nodes.get('c0')!.row).to.equal(1);
  });

  it('skips commits that are already laid out', () => {
    const layout = assignLanes(
      [makeCommit('c1', ['c0'], 2000), makeCommit('c0', [], 1000)],
      { headOid: 'c1' }
    );

    appendLanes(layout, [makeCommit('c0', [], 1000)]);

    expect(layout.nodes.size).to.equal(2);
    expect(layout.totalRows).to.equal(2);
  });

  it('produces a valid combined layout across several pages', () => {
    // Linear history split into three pages
    const all: GraphCommit[] = [];
    for (let i = 0; i < 12; i++) {
      all.push(
        makeCommit(`c${i}`, i < 11 ? [`c${i + 1}`] : [], (12 - i) * 1000)
      );
    }
    const layout = assignLanes(all.slice(0, 4), { headOid: 'c0' });
    appendLanes(layout, all.slice(4, 8));
    appendLanes(layout, all.slice(8));

    expect(layout.nodes.size).to.equal(12);
    expect(validateLayout(layout, all)).to.deep.equal([]);
    // Whole chain is the mainline
    for (const node of layout.nodes.values()) {
      expect(node.lane).to.equal(0);
      expect(node.colorIndex).to.equal(0);
    }
  });

  it('matches assignLanes totals when appending a branchy page', () => {
    const all = [
      makeCommit('h', ['g', 'f'], 9000),
      makeCommit('g', ['e'], 8000),
      makeCommit('f', ['d'], 7000),
      makeCommit('e', ['d', 'c'], 6000),
      makeCommit('d', ['b'], 5000),
      makeCommit('c', ['b'], 4000),
      makeCommit('b', ['a'], 2000),
      makeCommit('a', [], 1000),
    ];
    const layout = assignLanes(all.slice(0, 4), { headOid: 'h' });
    appendLanes(layout, all.slice(4));

    expect(layout.nodes.size).to.equal(8);
    expect(validateLayout(layout, all)).to.deep.equal([]);
    // Mainline chain stays in lane 0 across the page boundary
    for (const oid of ['h', 'g', 'e', 'd', 'b', 'a']) {
      expect(layout.nodes.get(oid)!.lane).to.equal(0, `lane of ${oid}`);
    }
  });

  it('throws on a layout without append state', () => {
    const layout = {
      nodes: new Map(),
      edges: [],
      maxLane: 0,
      totalRows: 0,
    };
    expect(() => appendLanes(layout, [makeCommit('x', [], 1)])).to.throw();
  });
});

describe('appendLanes lane continuation collisions', () => {
  /** Fails if any same-lane edge passes straight through an unrelated node */
  function assertNoEdgeThroughNode(layout: ReturnType<typeof assignLanes>): void {
    for (const edge of layout.edges) {
      if (edge.fromLane !== edge.toLane) continue;
      const minRow = Math.min(edge.fromRow, edge.toRow);
      const maxRow = Math.max(edge.fromRow, edge.toRow);
      for (const node of layout.nodes.values()) {
        if (node.oid === edge.fromOid || node.oid === edge.toOid) continue;
        expect(
          node.lane === edge.fromLane && node.row > minRow && node.row < maxRow,
          `edge ${edge.fromOid}->${edge.toOid} in lane ${edge.fromLane} passes through ${node.oid} at row ${node.row}`
        ).to.be.false;
      }
    }
  }

  it('does not route two continuations of a time-shared lane into the same lane', () => {
    // Page 1: A and B both branch off the mainline; each one's parent is
    // beyond the window, so each released its lane and they time-share
    // lane 1 at different rows
    const page1 = [
      makeCommit('m0', ['m1'], 9000),
      makeCommit('A', ['pA'], 8500),
      makeCommit('m1', ['m2'], 8000),
      makeCommit('B', ['pB'], 7500),
      makeCommit('m2', ['pM'], 7000),
    ];
    const layout = assignLanes(page1, { headOid: 'm0' });
    expect(layout.nodes.get('A')!.lane).to.equal(layout.nodes.get('B')!.lane);

    // Page 2: both parents arrive. Only ONE continuation may keep the
    // shared lane; the other must take a free lane or its edge would be a
    // straight line THROUGH the other branch's commit
    appendLanes(layout, [
      makeCommit('pA', [], 3000),
      makeCommit('pB', [], 2000),
      makeCommit('pM', [], 1000),
    ]);

    expect(layout.nodes.get('pA')!.lane).to.not.equal(layout.nodes.get('pB')!.lane);
    assertNoEdgeThroughNode(layout);

    // Both continuations keep their branch line's COLOR even when re-laned
    expect(layout.nodes.get('pA')!.colorIndex).to.equal(layout.nodes.get('A')!.colorIndex);
    expect(layout.nodes.get('pB')!.colorIndex).to.equal(layout.nodes.get('B')!.colorIndex);
    // Mainline continuation unaffected
    expect(layout.nodes.get('pM')!.lane).to.equal(0);
  });

  it('still inherits the lane for an uncontested continuation', () => {
    const page1 = [
      makeCommit('m0', ['m1'], 9000),
      makeCommit('side', ['pSide'], 8500),
      makeCommit('m1', ['pM'], 8000),
    ];
    const layout = assignLanes(page1, { headOid: 'm0' });
    const sideLane = layout.nodes.get('side')!.lane;

    appendLanes(layout, [
      makeCommit('pSide', [], 2000),
      makeCommit('pM', [], 1000),
    ]);

    expect(layout.nodes.get('pSide')!.lane).to.equal(sideLane);
    assertNoEdgeThroughNode(layout);
  });
});
