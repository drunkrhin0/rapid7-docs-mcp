/**
 * Shared crawler utilities used by both crawl.ts and crawl-extensions.ts.
 * Keeps index management, directory helpers, and search-index building in one place.
 */

import * as fs from 'fs';
import * as path from 'path';
import { STOP_WORDS, stem, tokenize } from './text.js';

// ─── Config ──────────────────────────────────────────────────────────────────

export const DOCS_DIR = path.join(process.cwd(), 'docs');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IndexEntry {
  path: string;
  title: string;
  url: string;
}

// ─── Common helpers ─────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

/**
 * Run async tasks with bounded concurrency.
 * Returns results in the same order as the input items.
 */
export async function parallelMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

// ─── Index management ────────────────────────────────────────────────────────

export function updateIndex(entries: IndexEntry[]): void {
  const indexPath = path.join(DOCS_DIR, 'index.json');
  let existing: IndexEntry[] = [];

  if (fs.existsSync(indexPath)) {
    existing = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  }

  // Merge by path, dedup
  const map = new Map(existing.map(e => [e.path, e]));
  for (const entry of entries) map.set(entry.path, entry);

  // Remove entries whose files no longer exist on disk
  for (const [entryPath] of map) {
    if (!fs.existsSync(path.join(DOCS_DIR, entryPath))) map.delete(entryPath);
  }

  fs.writeFileSync(indexPath, JSON.stringify(Array.from(map.values()), null, 2));
}

// ─── Search index builder ────────────────────────────────────────────────────

export function buildSearchIndex(): void {
  const indexPath = path.join(DOCS_DIR, 'index.json');
  if (!fs.existsSync(indexPath)) return;

  const entries: IndexEntry[] = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const paths: string[] = [];
  const invertedIndex: Record<string, Set<number>> = {};

  for (const entry of entries) {
    const id = paths.length;
    paths.push(entry.path);

    const filePath = path.join(DOCS_DIR, entry.path);
    if (!fs.existsSync(filePath)) continue;

    const raw = fs.readFileSync(filePath, 'utf-8');
    // Strip YAML frontmatter (---...---) so hash/url/date don't pollute the index
    const content = raw.replace(/^---\n[\s\S]*?\n---\n/, '');
    const allTokens = tokenize(entry.title + ' ' + content);
    const stems = new Set<string>();
    for (const token of allTokens) {
      if (!STOP_WORDS.has(token)) stems.add(stem(token));
    }

    for (const s of stems) {
      if (!invertedIndex[s]) invertedIndex[s] = new Set();
      invertedIndex[s].add(id);
    }
  }

  // Convert Sets to sorted arrays for JSON serialization
  const serialized: Record<string, number[]> = {};
  for (const [term, ids] of Object.entries(invertedIndex)) {
    serialized[term] = Array.from(ids).sort((a, b) => a - b);
  }

  fs.writeFileSync(
    path.join(DOCS_DIR, 'search-index.json'),
    JSON.stringify({ p: paths, i: serialized })
  );

  console.log(`\n📇 Search index: ${Object.keys(serialized).length} stems across ${entries.length} docs`);
}
