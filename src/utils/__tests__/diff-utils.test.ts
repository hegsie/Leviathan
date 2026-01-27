import { expect } from '@open-wc/testing';
import {
  isWhitespaceOnlyChange,
  computeInlineWhitespaceDiff,
  findWhitespaceOnlyPairs,
} from '../diff-utils.ts';
import type { DiffLine } from '../../types/git.types.ts';

describe('diff-utils', () => {
  describe('isWhitespaceOnlyChange', () => {
    it('should return true when only indentation differs', () => {
      expect(isWhitespaceOnlyChange('  hello world\n', '    hello world\n')).to.be.true;
    });

    it('should return true when tabs vs spaces differ', () => {
      expect(isWhitespaceOnlyChange('\thello\n', '  hello\n')).to.be.true;
    });

    it('should return true when trailing whitespace differs', () => {
      expect(isWhitespaceOnlyChange('hello  \n', 'hello\n')).to.be.true;
    });

    it('should return false when non-whitespace content differs', () => {
      expect(isWhitespaceOnlyChange('hello\n', 'world\n')).to.be.false;
    });

    it('should return false when content is added', () => {
      expect(isWhitespaceOnlyChange('hello\n', 'hello world\n')).to.be.false;
    });

    it('should return true for identical strings', () => {
      expect(isWhitespaceOnlyChange('hello\n', 'hello\n')).to.be.true;
    });

    it('should return true for empty strings', () => {
      expect(isWhitespaceOnlyChange('', '')).to.be.true;
    });

    it('should return true when only internal whitespace differs', () => {
      expect(isWhitespaceOnlyChange('a  b\n', 'a b\n')).to.be.true;
    });

    it('should strip trailing newlines before comparison', () => {
      expect(isWhitespaceOnlyChange('hello\n', 'hello')).to.be.true;
    });
  });

  describe('computeInlineWhitespaceDiff', () => {
    it('should identify changed leading whitespace', () => {
      const segments = computeInlineWhitespaceDiff('  hello\n', '    hello\n');
      expect(segments.length).to.be.greaterThan(0);

      // Should have removed (old ws), added (new ws), and unchanged (text)
      const types = segments.map(s => s.type);
      expect(types).to.include('removed');
      expect(types).to.include('added');
      expect(types).to.include('unchanged');
    });

    it('should mark identical whitespace as unchanged', () => {
      const segments = computeInlineWhitespaceDiff('  hello\n', '  hello\n');
      // Everything should be unchanged
      expect(segments.every(s => s.type === 'unchanged')).to.be.true;
    });

    it('should handle tab-to-space conversion', () => {
      const segments = computeInlineWhitespaceDiff('\thello\n', '  hello\n');
      const removedSeg = segments.find(s => s.type === 'removed');
      const addedSeg = segments.find(s => s.type === 'added');

      expect(removedSeg).to.exist;
      expect(removedSeg!.text).to.equal('\t');
      expect(addedSeg).to.exist;
      expect(addedSeg!.text).to.equal('  ');
    });

    it('should handle trailing whitespace difference', () => {
      const segments = computeInlineWhitespaceDiff('hello  \n', 'hello\n');
      // Old has trailing spaces (removed), new has none
      const removed = segments.filter(s => s.type === 'removed');
      expect(removed.length).to.be.greaterThan(0);
    });

    it('should return unchanged segments for identical content', () => {
      const segments = computeInlineWhitespaceDiff('hello\n', 'hello\n');
      expect(segments.length).to.equal(1);
      expect(segments[0].type).to.equal('unchanged');
      expect(segments[0].text).to.equal('hello');
    });

    it('should handle empty strings', () => {
      const segments = computeInlineWhitespaceDiff('\n', '\n');
      expect(segments.length).to.equal(0);
    });
  });

  describe('findWhitespaceOnlyPairs', () => {
    it('should find consecutive deletion-addition pairs with whitespace-only changes', () => {
      const lines: DiffLine[] = [
        { content: '  hello\n', origin: 'deletion', oldLineNo: 1, newLineNo: null },
        { content: '    hello\n', origin: 'addition', oldLineNo: null, newLineNo: 1 },
      ];

      const pairs = findWhitespaceOnlyPairs(lines);
      expect(pairs.size).to.equal(1);
      expect(pairs.get(0)).to.equal(1);
    });

    it('should not pair deletion-addition with different content', () => {
      const lines: DiffLine[] = [
        { content: 'hello\n', origin: 'deletion', oldLineNo: 1, newLineNo: null },
        { content: 'world\n', origin: 'addition', oldLineNo: null, newLineNo: 1 },
      ];

      const pairs = findWhitespaceOnlyPairs(lines);
      expect(pairs.size).to.equal(0);
    });

    it('should not pair non-consecutive deletion and addition', () => {
      const lines: DiffLine[] = [
        { content: '  hello\n', origin: 'deletion', oldLineNo: 1, newLineNo: null },
        { content: 'context line\n', origin: 'context', oldLineNo: 2, newLineNo: 2 },
        { content: '    hello\n', origin: 'addition', oldLineNo: null, newLineNo: 3 },
      ];

      const pairs = findWhitespaceOnlyPairs(lines);
      expect(pairs.size).to.equal(0);
    });

    it('should find multiple pairs in a sequence', () => {
      const lines: DiffLine[] = [
        { content: '  a\n', origin: 'deletion', oldLineNo: 1, newLineNo: null },
        { content: '    a\n', origin: 'addition', oldLineNo: null, newLineNo: 1 },
        { content: '  b\n', origin: 'deletion', oldLineNo: 2, newLineNo: null },
        { content: '    b\n', origin: 'addition', oldLineNo: null, newLineNo: 2 },
      ];

      const pairs = findWhitespaceOnlyPairs(lines);
      expect(pairs.size).to.equal(2);
      expect(pairs.get(0)).to.equal(1);
      expect(pairs.get(2)).to.equal(3);
    });

    it('should skip pairs where addition comes before deletion', () => {
      const lines: DiffLine[] = [
        { content: '    hello\n', origin: 'addition', oldLineNo: null, newLineNo: 1 },
        { content: '  hello\n', origin: 'deletion', oldLineNo: 1, newLineNo: null },
      ];

      const pairs = findWhitespaceOnlyPairs(lines);
      expect(pairs.size).to.equal(0);
    });

    it('should handle context lines mixed with pairs', () => {
      const lines: DiffLine[] = [
        { content: 'unchanged\n', origin: 'context', oldLineNo: 1, newLineNo: 1 },
        { content: '  hello\n', origin: 'deletion', oldLineNo: 2, newLineNo: null },
        { content: '    hello\n', origin: 'addition', oldLineNo: null, newLineNo: 2 },
        { content: 'also unchanged\n', origin: 'context', oldLineNo: 3, newLineNo: 3 },
      ];

      const pairs = findWhitespaceOnlyPairs(lines);
      expect(pairs.size).to.equal(1);
      expect(pairs.get(1)).to.equal(2);
    });

    it('should return empty map for no lines', () => {
      const pairs = findWhitespaceOnlyPairs([]);
      expect(pairs.size).to.equal(0);
    });
  });
});
