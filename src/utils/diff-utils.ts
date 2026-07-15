import type { DiffLine } from '../types/git.types.ts';

export interface InlineDiffSegment {
  text: string;
  type: 'unchanged' | 'added' | 'removed';
}

/**
 * Check if two strings differ only in whitespace.
 * Strips trailing newlines and compares non-whitespace characters.
 */
export function isWhitespaceOnlyChange(oldContent: string, newContent: string): boolean {
  const strip = (s: string) => s.replace(/\n$/, '').replace(/\s/g, '');
  return strip(oldContent) === strip(newContent);
}

/**
 * Compute inline diff segments between two strings that differ only in whitespace.
 * Walks both strings aligning on non-whitespace characters,
 * emitting removed/added segments for whitespace differences.
 */
export function computeInlineWhitespaceDiff(
  oldContent: string,
  newContent: string,
): InlineDiffSegment[] {
  const oldStr = oldContent.replace(/\n$/, '');
  const newStr = newContent.replace(/\n$/, '');
  const segments: InlineDiffSegment[] = [];

  let oi = 0;
  let ni = 0;

  while (oi < oldStr.length || ni < newStr.length) {
    // Collect whitespace runs from both
    const oldWsStart = oi;
    while (oi < oldStr.length && /\s/.test(oldStr[oi])) oi++;
    const oldWs = oldStr.slice(oldWsStart, oi);

    const newWsStart = ni;
    while (ni < newStr.length && /\s/.test(newStr[ni])) ni++;
    const newWs = newStr.slice(newWsStart, ni);

    if (oldWs !== newWs) {
      if (oldWs) segments.push({ text: oldWs, type: 'removed' });
      if (newWs) segments.push({ text: newWs, type: 'added' });
    } else if (oldWs) {
      segments.push({ text: oldWs, type: 'unchanged' });
    }

    // Collect non-whitespace run from new string (both should match)
    const nonWsStart = ni;
    while (ni < newStr.length && !/\s/.test(newStr[ni])) ni++;
    const nonWs = newStr.slice(nonWsStart, ni);

    // Advance old string past matching non-whitespace
    oi += nonWs.length;

    if (nonWs) {
      segments.push({ text: nonWs, type: 'unchanged' });
    }

    // Safety: if neither pointer advanced, collect remaining chars and break
    // to prevent infinite loop when strings have mismatched non-whitespace
    if (oi === oldWsStart && ni === newWsStart) {
      if (oi < oldStr.length) {
        segments.push({ text: oldStr.slice(oi), type: 'removed' });
      }
      if (ni < newStr.length) {
        segments.push({ text: newStr.slice(ni), type: 'added' });
      }
      break;
    }
  }

  return segments;
}

/**
 * One display row of a pairwise line alignment.
 * `a`/`b` are indices into the respective line arrays, or null when the row
 * is a filler on that side (insertion/deletion).
 */
export type AlignedPair = [a: number | null, b: number | null];

/**
 * A single display row aligning the three merge panes. Each field is an index
 * into that pane's line array, or null when the pane shows a filler row.
 */
export interface ThreeWayRow {
  base: number | null;
  ours: number | null;
  theirs: number | null;
}

/** Above this many DP cells the LCS falls back to index pairing (perf guard). */
const LCS_CELL_LIMIT = 1_000_000;

/**
 * Align two arrays of lines using an LCS diff, so equal lines share a row and
 * changed regions are paired index-wise (k-th removed line with k-th added
 * line), with null fillers for the unpaired remainder.
 *
 * Unlike naive index pairing, a single insertion/deletion does not misalign
 * everything after it.
 */
export function computeLineAlignment(a: string[], b: string[]): AlignedPair[] {
  // Trim common prefix/suffix so the DP only covers the changed middle.
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const rows: AlignedPair[] = [];
  for (let i = 0; i < prefix; i++) rows.push([i, i]);

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);

  // Matched index pairs (relative to the middle) in ascending order.
  let matches: Array<[number, number]>;
  if (midA.length * midB.length > LCS_CELL_LIMIT) {
    // Too large for DP — treat the whole middle as one replace block.
    matches = [];
  } else {
    matches = lcsMatches(midA, midB);
  }

  let ai = 0;
  let bi = 0;
  const emitReplaceBlock = (aEnd: number, bEnd: number): void => {
    // Pair the k-th removed line with the k-th added line; pad the rest.
    const aRun = aEnd - ai;
    const bRun = bEnd - bi;
    const paired = Math.min(aRun, bRun);
    for (let k = 0; k < paired; k++) rows.push([prefix + ai + k, prefix + bi + k]);
    for (let k = paired; k < aRun; k++) rows.push([prefix + ai + k, null]);
    for (let k = paired; k < bRun; k++) rows.push([null, prefix + bi + k]);
    ai = aEnd;
    bi = bEnd;
  };

  for (const [ma, mb] of matches) {
    emitReplaceBlock(ma, mb);
    rows.push([prefix + ma, prefix + mb]);
    ai = ma + 1;
    bi = mb + 1;
  }
  emitReplaceBlock(midA.length, midB.length);

  for (let i = 0; i < suffix; i++) {
    rows.push([a.length - suffix + i, b.length - suffix + i]);
  }

  return rows;
}

/** Standard DP LCS returning the matched index pairs in order. */
function lcsMatches(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return [];

  // dp[i][j] = LCS length of a[i..] and b[j..], flattened row-major.
  const width = n + 1;
  const dp = new Int32Array((m + 1) * width);
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }

  const matches: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      matches.push([i, j]);
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return matches;
}

/**
 * Align OURS and THEIRS against BASE into shared display rows, so all three
 * merge-editor panes render the same number of rows and equal content lines
 * up horizontally (Beyond Compare style). Insertions from ours and theirs
 * anchored at the same base position share rows.
 */
export function alignThreeWay(
  base: string[],
  ours: string[],
  theirs: string[],
): ThreeWayRow[] {
  const sideForBase = (side: string[]) => {
    const matched = new Array<number | null>(base.length).fill(null);
    // Insertions keyed by the base index they precede (base.length = trailing).
    const insertions = new Map<number, number[]>();
    let baseCursor = 0;
    for (const [b, s] of computeLineAlignment(base, side)) {
      if (b !== null) {
        matched[b] = s;
        baseCursor = b + 1;
      } else if (s !== null) {
        const list = insertions.get(baseCursor);
        if (list) list.push(s);
        else insertions.set(baseCursor, [s]);
      }
    }
    return { matched, insertions };
  };

  const o = sideForBase(ours);
  const t = sideForBase(theirs);

  const rows: ThreeWayRow[] = [];
  for (let b = 0; b <= base.length; b++) {
    const oIns = o.insertions.get(b) ?? [];
    const tIns = t.insertions.get(b) ?? [];
    const insRows = Math.max(oIns.length, tIns.length);
    for (let k = 0; k < insRows; k++) {
      rows.push({ base: null, ours: oIns[k] ?? null, theirs: tIns[k] ?? null });
    }
    if (b < base.length) {
      rows.push({ base: b, ours: o.matched[b], theirs: t.matched[b] });
    }
  }
  return rows;
}

/**
 * Scan hunk lines for consecutive deletion→addition pairs that differ only in whitespace.
 * Returns a Map from deletion line index to its paired addition line index.
 */
export function findWhitespaceOnlyPairs(lines: DiffLine[]): Map<number, number> {
  const pairs = new Map<number, number>();

  for (let i = 0; i < lines.length - 1; i++) {
    const cur = lines[i];
    const next = lines[i + 1];

    if (
      cur.origin === 'deletion' &&
      next.origin === 'addition' &&
      isWhitespaceOnlyChange(cur.content, next.content)
    ) {
      pairs.set(i, i + 1);
      i++; // skip the addition since it's now paired
    }
  }

  return pairs;
}
