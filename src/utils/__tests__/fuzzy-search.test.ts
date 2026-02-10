import { expect } from '@open-wc/testing';
import { fuzzyScore, highlightMatch } from '../fuzzy-search.ts';

describe('fuzzyScore', () => {
  it('returns 100 for exact match', () => {
    expect(fuzzyScore('hello', 'hello')).to.equal(100);
  });

  it('is case insensitive', () => {
    expect(fuzzyScore('Hello', 'hello')).to.equal(100);
  });

  it('returns 80 for starts-with match', () => {
    expect(fuzzyScore('hello world', 'hello')).to.equal(80);
  });

  it('returns 60 for substring match', () => {
    expect(fuzzyScore('say hello', 'hello')).to.equal(60);
  });

  it('returns positive score for fuzzy match', () => {
    const score = fuzzyScore('feature/login', 'flog');
    expect(score).to.be.greaterThan(0);
  });

  it('returns 0 when no match at all', () => {
    expect(fuzzyScore('hello', 'xyz')).to.equal(0);
  });

  it('returns 0 when query chars not in order', () => {
    expect(fuzzyScore('abc', 'cba')).to.equal(0);
  });

  it('gives bonus for consecutive matches', () => {
    const consecutive = fuzzyScore('feature/test', 'feat');
    const scattered = fuzzyScore('f-e-a-t', 'feat');
    expect(consecutive).to.be.greaterThan(scattered);
  });

  it('gives bonus for word boundary matches', () => {
    const boundary = fuzzyScore('feature/login', 'fl');
    expect(boundary).to.be.greaterThan(0);
  });

  it('handles empty query', () => {
    // Empty query has no chars to match, so score is 0
    expect(fuzzyScore('hello', '')).to.equal(0);
  });

  it('handles empty text', () => {
    expect(fuzzyScore('', 'hello')).to.equal(0);
  });

  it('handles single character query', () => {
    const score = fuzzyScore('hello', 'h');
    expect(score).to.be.greaterThan(0);
  });

  it('handles slash-separated paths', () => {
    const score = fuzzyScore('feature/my-branch', 'fmb');
    expect(score).to.be.greaterThan(0);
  });
});

describe('highlightMatch', () => {
  it('returns original text when query is empty', () => {
    expect(highlightMatch('hello', '')).to.equal('hello');
  });

  it('wraps substring match in mark tags', () => {
    expect(highlightMatch('hello world', 'world')).to.equal('hello <mark>world</mark>');
  });

  it('wraps starting match in mark tags', () => {
    expect(highlightMatch('hello', 'hel')).to.equal('<mark>hel</mark>lo');
  });

  it('highlights case-insensitively but preserves original case', () => {
    expect(highlightMatch('Hello World', 'hello')).to.equal('<mark>Hello</mark> World');
  });

  it('highlights fuzzy matches with individual marks', () => {
    const result = highlightMatch('feature', 'ftr');
    expect(result).to.include('<mark>f</mark>');
    expect(result).to.include('<mark>t</mark>');
    expect(result).to.include('<mark>r</mark>');
  });

  it('returns original text when no match is possible', () => {
    expect(highlightMatch('hello', 'xyz')).to.equal('hello');
  });

  it('handles single character highlight', () => {
    const result = highlightMatch('hello', 'h');
    expect(result).to.equal('<mark>h</mark>ello');
  });
});
