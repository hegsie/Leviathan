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
  }

  return segments;
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
