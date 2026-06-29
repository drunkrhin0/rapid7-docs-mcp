/**
 * Shared text processing for crawler and MCP server.
 * stem() and tokenize() MUST be identical at index-build and query time.
 * If you change anything here, rebuild the search index: npm run crawl
 */

export const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'as',
  'is',
  'was',
  'are',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'can',
  'shall',
  'must',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'i',
  'you',
  'he',
  'she',
  'we',
  'they',
  'my',
  'your',
  'his',
  'her',
  'our',
  'their',
  'what',
  'which',
  'who',
  'whom',
  'how',
  'when',
  'where',
  'why',
  'not',
  'no',
  'nor',
  'if',
  'then',
  'than',
  'so',
  'just',
  'also',
  'about',
  'up',
  'out',
  'into',
  'over',
  'after',
  'before',
  'between',
  'through',
  'during',
  'above',
  'below',
  'each',
  'all',
  'any',
  'both',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'only',
  'own',
  'same',
  'very',
  'too',
  'quite',
]);

/**
 * Simple suffix-stripping stemmer for English technical documentation.
 * Handles the most common inflections so that related forms share a stem:
 *   configure / configuration / configured / configuring → "configur"
 *   scan / scanning / scanned / scanner → "scan"
 *   log / logs / logging / logged → "log"
 */
export function stem(word: string): string {
  if (word.length < 4) return word;
  // -ation (configuration → configur)
  if (word.length > 7 && word.endsWith('ation')) return word.slice(0, -5);
  // -ment (management → manag)
  if (word.length > 6 && word.endsWith('ment')) return word.slice(0, -4);
  // -ness (awareness → aware)
  if (word.length > 6 && word.endsWith('ness')) return word.slice(0, -4);
  // -able/-ible (configurable → configur)
  if (word.length > 6 && (word.endsWith('able') || word.endsWith('ible'))) return word.slice(0, -4);
  // -ing + doubled-consonant correction (scanning → scan, configuring → configur)
  if (word.length > 5 && word.endsWith('ing')) {
    const b = word.slice(0, -3);
    return b.length > 2 && b[b.length - 1] === b[b.length - 2] ? b.slice(0, -1) : b;
  }
  // -ed + doubled-consonant correction (scanned → scan, configured → configur)
  if (word.length > 4 && word.endsWith('ed')) {
    const b = word.slice(0, -2);
    return b.length > 2 && b[b.length - 1] === b[b.length - 2] ? b.slice(0, -1) : b;
  }
  // Plurals
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'i';
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && word.length > 3) return word.slice(0, -1);
  // -ly (automatically → automatical)
  if (word.length > 4 && word.endsWith('ly')) return word.slice(0, -2);
  // -er + doubled-consonant correction (scanner → scan)
  if (word.length > 4 && word.endsWith('er')) {
    const b = word.slice(0, -2);
    return b.length > 2 && b[b.length - 1] === b[b.length - 2] ? b.slice(0, -1) : b;
  }
  // Trailing -e (configure → configur, update → updat)
  if (word.length > 4 && word.endsWith('e')) return word.slice(0, -1);
  return word;
}

/** Tokenize text into lowercase terms for indexing/searching. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}
