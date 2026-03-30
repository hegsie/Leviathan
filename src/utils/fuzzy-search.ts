/**
 * Fuzzy search utilities for matching and highlighting text
 */

/**
 * Escape HTML special characters to prevent XSS when inserting user text into HTML.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Calculate a fuzzy match score between text and a query.
 * Returns 0 if no match, higher scores for better matches.
 */
export function fuzzyScore(text: string, query: string): number {
  if (!query) return 0;

  const textLower = text.toLowerCase();

  // Exact match gets highest score
  if (textLower === query) return 100;

  // Starts with query gets high score
  if (textLower.startsWith(query)) return 80;

  // Contains query as substring
  if (textLower.includes(query)) return 60;

  // Fuzzy match - all chars present in order
  let score = 0;
  let textIndex = 0;
  let consecutive = 0;

  for (const char of query) {
    const foundIndex = textLower.indexOf(char, textIndex);
    if (foundIndex === -1) return 0;

    // Bonus for consecutive matches
    if (foundIndex === textIndex) {
      consecutive++;
      score += consecutive * 2;
    } else {
      consecutive = 0;
    }

    // Bonus for matching at word boundaries
    if (foundIndex === 0 || text[foundIndex - 1] === ' ' || text[foundIndex - 1] === '/') {
      score += 5;
    }

    score += 1;
    textIndex = foundIndex + 1;
  }

  return score;
}

/**
 * Generate HTML string with `<mark>` tags highlighting matched characters.
 */
export function highlightMatch(text: string, query: string): string {
  if (!query) return escapeHtml(text);

  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();

  // Try substring match first
  const index = textLower.indexOf(queryLower);
  if (index !== -1) {
    return (
      escapeHtml(text.slice(0, index)) +
      '<mark>' + escapeHtml(text.slice(index, index + query.length)) + '</mark>' +
      escapeHtml(text.slice(index + query.length))
    );
  }

  // Fuzzy highlight
  let result = '';
  let textIndex = 0;

  for (const char of queryLower) {
    const foundIndex = textLower.indexOf(char, textIndex);
    if (foundIndex === -1) return escapeHtml(text);

    result += escapeHtml(text.slice(textIndex, foundIndex));
    result += '<mark>' + escapeHtml(text[foundIndex]) + '</mark>';
    textIndex = foundIndex + 1;
  }

  result += escapeHtml(text.slice(textIndex));
  return result;
}
