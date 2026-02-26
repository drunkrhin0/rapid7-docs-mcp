#!/usr/bin/env tsx
/**
 * Rapid7 Docs Crawler
 * Crawls docs.rapid7.com and converts pages to markdown files.
 * Preserves absolute image URLs so Claude can reference them live.
 *
 * Usage:
 *   npx tsx crawl.ts                          # Crawl all products
 *   npx tsx crawl.ts --section insightidr     # Crawl one product section
 *   npx tsx crawl.ts --url /insightidr/docs/  # Crawl a specific path
 *   npx tsx crawl.ts --list                   # List available product sections
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import * as fs from 'fs';
import * as path from 'path';
import { STOP_WORDS, stem, tokenize } from './src/text.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = 'https://docs.rapid7.com';
const DOCS_DIR = path.join(process.cwd(), 'docs');
const DELAY_MS = parseInt(process.env.CRAWL_DELAY_MS || '15'); // ~60 req/s — fine for a CDN-backed docs site

// Known Rapid7 product sections on docs.rapid7.com
const PRODUCT_SECTIONS: Record<string, string> = {
  insightidr:       '/insightidr/',
  insightvm:        '/insightvm/',
  insightappsec:    '/insightappsec/',
  insightconnect:   '/insightconnect/',
  insightagent:     '/insight-agent/',
  insightcloudsec:  '/insightcloudsec/',
  metasploit:       '/metasploit/',
  nexpose:          '/nexpose/',
  appspider:        '/appspider/',
  insightops:       '/insightops/',
  'threat-command': '/threat-command/',
  'surface-command':'/surface-command/',
};

// ─── Turndown setup ───────────────────────────────────────────────────────────

const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Preserve absolute image URLs instead of stripping them
td.addRule('images', {
  filter: 'img',
  replacement: (content, node) => {
    const el = node as HTMLImageElement;
    let src = el.getAttribute('src') || '';
    const alt = el.getAttribute('alt') || '';
    // Make relative URLs absolute
    if (src && !src.startsWith('http')) {
      src = src.startsWith('/') ? `${BASE_URL}${src}` : `${BASE_URL}/${src}`;
    }
    return src ? `![${alt}](${src})` : '';
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function urlToFilePath(pageUrl: string): string {
  const parsed = new URL(pageUrl, BASE_URL);
  let pathname = parsed.pathname.replace(/\/$/, '') || '/index';
  if (!pathname.endsWith('.md')) pathname += '.md';
  return path.join(DOCS_DIR, pathname);
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeUrl(href: string, fromUrl: string): string | null {
  try {
    const resolved = new URL(href, fromUrl);
    // Only follow same-domain doc links
    if (resolved.hostname !== 'docs.rapid7.com') return null;
    // Strip fragments and query params for deduplication
    resolved.hash = '';
    resolved.search = '';
    return resolved.toString();
  } catch {
    return null;
  }
}

// ─── Page crawler ─────────────────────────────────────────────────────────────

async function fetchPage(pageUrl: string): Promise<{ markdown: string; links: string[]; title: string } | null> {
  try {
    const resp = await axios.get(pageUrl, {
      timeout: 15000,
      headers: { 'User-Agent': 'Rapid7-Docs-MCP-Crawler/1.0 (personal homelab indexer)' },
    });

    const $ = cheerio.load(resp.data);

    const title = $('h1').first().text().trim() || $('title').text().trim();

    // Extract main content — try selectors in priority order, fall back to body
    const CONTENT_SELECTORS = ['main article', 'main .content', '[role="main"]', 'main', 'article'];
    let contentEl = $('body'); // fallback
    for (const sel of CONTENT_SELECTORS) {
      const el = $(sel).first();
      if (el.length) { contentEl = el; break; }
    }

    // Remove nav, sidebar, footer noise
    contentEl.find('nav, .nav, .sidebar, .toc, footer, .footer, .breadcrumb, script, style').remove();

    const html = contentEl.html() || '';
    const markdown = td.turndown(html);

    // Collect internal links for crawling
    const links: string[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const normalized = normalizeUrl(href, pageUrl);
      if (normalized) links.push(normalized);
    });

    return { markdown, links, title };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ Failed: ${pageUrl} — ${msg}`);
    return null;
  }
}

// ─── Index builder ────────────────────────────────────────────────────────────

interface IndexEntry {
  path: string;
  title: string;
  url: string;
}

function updateIndex(entries: IndexEntry[]): void {
  const indexPath = path.join(DOCS_DIR, 'index.json');
  let existing: IndexEntry[] = [];

  if (fs.existsSync(indexPath)) {
    existing = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  }

  // Merge by path, dedup
  const map = new Map(existing.map(e => [e.path, e]));
  for (const entry of entries) map.set(entry.path, entry);

  fs.writeFileSync(indexPath, JSON.stringify(Array.from(map.values()), null, 2));
}

// ─── Main crawl ───────────────────────────────────────────────────────────────

async function crawlSection(startPath: string): Promise<void> {
  const startUrl = `${BASE_URL}${startPath}`;
  const visited = new Set<string>();
  const queue: string[] = [startUrl];
  const newEntries: IndexEntry[] = [];
  let count = 0;

  console.log(`\n🕷  Crawling: ${startUrl}`);

  while (queue.length > 0) {
    const pageUrl = queue.shift()!;
    if (visited.has(pageUrl)) continue;
    visited.add(pageUrl);

    // Only crawl within the starting section
    if (!pageUrl.startsWith(`${BASE_URL}${startPath}`)) continue;

    process.stdout.write(`  [${++count}] ${pageUrl.replace(BASE_URL, '')} ... `);

    const result = await fetchPage(pageUrl);
    if (!result) continue;

    const { markdown, links, title } = result;
    const filePath = urlToFilePath(pageUrl);
    ensureDir(filePath);

    // Write markdown with frontmatter (h1 comes from the converted HTML, don't duplicate it)
    const content = `---\ntitle: "${title.replace(/"/g, '\\"')}"\nurl: "${pageUrl}"\ncrawled: "${new Date().toISOString()}"\n---\n\n${markdown}`;
    fs.writeFileSync(filePath, content, 'utf-8');

    const relativePath = path.relative(DOCS_DIR, filePath);
    newEntries.push({ path: relativePath, title, url: pageUrl });

    console.log(`✓ ${title || '(untitled)'}`);

    // Enqueue new links
    for (const link of links) {
      if (!visited.has(link)) queue.push(link);
    }

    await sleep(DELAY_MS);
  }

  updateIndex(newEntries);
  console.log(`\n✅ Crawled ${count} pages from ${startPath}`);
}

// ─── Search index builder ─────────────────────────────────────────────────────

function buildSearchIndex(): void {
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

    const content = fs.readFileSync(filePath, 'utf-8');
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

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    console.log('\nAvailable product sections:\n');
    for (const [name, sectionPath] of Object.entries(PRODUCT_SECTIONS)) {
      console.log(`  ${name.padEnd(20)} ${BASE_URL}${sectionPath}`);
    }
    return;
  }

  fs.mkdirSync(DOCS_DIR, { recursive: true });

  const sectionIdx = args.indexOf('--section');
  const urlIdx = args.indexOf('--url');

  if (sectionIdx !== -1) {
    const sectionName = args[sectionIdx + 1];
    const sectionPath = PRODUCT_SECTIONS[sectionName];
    if (!sectionPath) {
      console.error(`Unknown section: ${sectionName}. Run with --list to see options.`);
      process.exit(1);
    }
    await crawlSection(sectionPath);
  } else if (urlIdx !== -1) {
    const customPath = args[urlIdx + 1];
    await crawlSection(customPath);
  } else {
    // Crawl all sections
    for (const sectionPath of Object.values(PRODUCT_SECTIONS)) {
      await crawlSection(sectionPath);
    }
  }

  // Build inverted search index from all crawled docs
  buildSearchIndex();
}

main().catch(err => {
  console.error('Crawl failed:', err);
  process.exit(1);
});
