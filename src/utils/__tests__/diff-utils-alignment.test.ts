/**
 * Tests for the line-alignment utilities powering the merge editor's
 * Beyond-Compare-style panes: computeLineAlignment (pairwise LCS) and
 * alignThreeWay (base/ours/theirs shared display rows).
 */

import { expect } from '@open-wc/testing';
import { computeLineAlignment, alignThreeWay } from '../diff-utils.ts';

describe('computeLineAlignment', () => {
  it('aligns identical arrays one-to-one', () => {
    const rows = computeLineAlignment(['a', 'b'], ['a', 'b']);
    expect(rows).to.deep.equal([[0, 0], [1, 1]]);
  });

  it('keeps lines after an insertion aligned', () => {
    // b inserts "new" at the top; a's lines must still pair with themselves.
    const rows = computeLineAlignment(['a', 'b'], ['new', 'a', 'b']);
    expect(rows).to.deep.equal([[null, 0], [0, 1], [1, 2]]);
  });

  it('keeps lines after a deletion aligned', () => {
    const rows = computeLineAlignment(['a', 'gone', 'b'], ['a', 'b']);
    expect(rows).to.deep.equal([[0, 0], [1, null], [2, 1]]);
  });

  it('pairs replaced lines index-wise', () => {
    const rows = computeLineAlignment(['a', 'old', 'b'], ['a', 'new', 'b']);
    expect(rows).to.deep.equal([[0, 0], [1, 1], [2, 2]]);
  });

  it('pads an uneven replace block with fillers', () => {
    const rows = computeLineAlignment(['a', 'x', 'b'], ['a', 'y1', 'y2', 'b']);
    expect(rows).to.deep.equal([[0, 0], [1, 1], [null, 2], [2, 3]]);
  });

  it('handles empty inputs', () => {
    expect(computeLineAlignment([], [])).to.deep.equal([]);
    expect(computeLineAlignment(['a'], [])).to.deep.equal([[0, null]]);
    expect(computeLineAlignment([], ['b'])).to.deep.equal([[null, 0]]);
  });

  it('stays index-complete when the middle exceeds the LCS cell limit', () => {
    // 1100 x 1100 fully-distinct middles exceed the 1M-cell DP guard, forcing
    // the replace-block fallback — it must still emit every index exactly once.
    const a = ['same-head', ...Array.from({ length: 1100 }, (_, i) => `a-${i}`), 'same-tail'];
    const b = ['same-head', ...Array.from({ length: 1100 }, (_, i) => `b-${i}`), 'same-tail'];
    const rows = computeLineAlignment(a, b);

    const aIdx = rows.map(([x]) => x).filter((x) => x !== null);
    const bIdx = rows.map(([, y]) => y).filter((y) => y !== null);
    expect(aIdx).to.deep.equal(Array.from({ length: a.length }, (_, i) => i));
    expect(bIdx).to.deep.equal(Array.from({ length: b.length }, (_, i) => i));
    // Equal-length replace middles pair index-wise; head/tail stay matched.
    expect(rows[0]).to.deep.equal([0, 0]);
    expect(rows[rows.length - 1]).to.deep.equal([a.length - 1, b.length - 1]);
    expect(rows.length).to.equal(a.length);
  });

  it('produces a row for every index on both sides exactly once', () => {
    const a = ['1', '2', '3', '4', '5'];
    const b = ['0', '1', '3', 'x', '5', '6'];
    const rows = computeLineAlignment(a, b);
    const aIdx = rows.map(([x]) => x).filter((x) => x !== null);
    const bIdx = rows.map(([, y]) => y).filter((y) => y !== null);
    expect(aIdx).to.deep.equal([0, 1, 2, 3, 4]);
    expect(bIdx).to.deep.equal([0, 1, 2, 3, 4, 5]);
  });
});

describe('alignThreeWay', () => {
  it('gives every pane the same row count', () => {
    const rows = alignThreeWay(
      ['a', 'b', 'c'],
      ['x', 'y', 'a', 'b', 'c'],
      ['a', 'c'],
    );
    // Row count is shared by construction; each pane index appears exactly once.
    const ours = rows.map((r) => r.ours).filter((x) => x !== null);
    const base = rows.map((r) => r.base).filter((x) => x !== null);
    const theirs = rows.map((r) => r.theirs).filter((x) => x !== null);
    expect(ours).to.deep.equal([0, 1, 2, 3, 4]);
    expect(base).to.deep.equal([0, 1, 2]);
    expect(theirs).to.deep.equal([0, 1]);
  });

  it('aligns unchanged lines across all three panes', () => {
    const rows = alignThreeWay(['a', 'b'], ['a', 'b'], ['a', 'b']);
    expect(rows).to.deep.equal([
      { base: 0, ours: 0, theirs: 0 },
      { base: 1, ours: 1, theirs: 1 },
    ]);
  });

  it('shares insertion rows between ours and theirs at the same anchor', () => {
    const rows = alignThreeWay(['a'], ['new-ours', 'a'], ['new-theirs', 'a']);
    expect(rows).to.deep.equal([
      { base: null, ours: 0, theirs: 0 },
      { base: 0, ours: 1, theirs: 1 },
    ]);
  });

  it('marks a side-deleted base line with null on that side', () => {
    const rows = alignThreeWay(['a', 'gone', 'b'], ['a', 'b'], ['a', 'gone', 'b']);
    expect(rows).to.deep.equal([
      { base: 0, ours: 0, theirs: 0 },
      { base: 1, ours: null, theirs: 1 },
      { base: 2, ours: 1, theirs: 2 },
    ]);
  });

  it('anchors trailing insertions after the last base line', () => {
    const rows = alignThreeWay(['a'], ['a', 'tail'], ['a']);
    expect(rows).to.deep.equal([
      { base: 0, ours: 0, theirs: 0 },
      { base: null, ours: 1, theirs: null },
    ]);
  });
});
