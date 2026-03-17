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
 *   npx tsx crawl.ts --verbose                 # Show per-page crawl output
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { DOCS_DIR, IndexEntry, ensureDir, updateIndex, buildSearchIndex, sleep } from './src/crawl-utils.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = 'https://docs.rapid7.com';
const DELAY_MS = parseInt(process.env.CRAWL_DELAY_MS || '0'); // Sequential but no artificial delay — CDN-backed site handles it fine
const STALE_DAYS = 14; // Delete files not seen after this many days
const VERBOSE = process.argv.includes('--verbose');

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
  insight:          '/insight/',
  services:         '/services/',
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

function urlToFilePath(pageUrl: string): string {
  const parsed = new URL(pageUrl, BASE_URL);
  let pathname = parsed.pathname.replace(/\/$/, '') || '/index';
  if (!pathname.endsWith('.md')) pathname += '.md';
  return path.join(DOCS_DIR, pathname);
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
    if (VERBOSE) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Failed: ${pageUrl} — ${msg}`);
    }
    return null;
  }
}

// ─── Main crawl ───────────────────────────────────────────────────────────────

async function crawlSection(startPath: string): Promise<void> {
  const startUrl = `${BASE_URL}${startPath}`;
  const visited = new Set<string>();
  const queue: string[] = [startUrl];
  const newEntries: IndexEntry[] = [];
  const visitedFiles = new Set<string>(); // track files we saw this crawl
  let count = 0;
  let updated = 0;
  let failed = 0;

  console.log(`\n🕷  Crawling: ${startUrl}`);

  while (queue.length > 0) {
    const pageUrl = queue.shift()!;
    if (visited.has(pageUrl)) continue;
    visited.add(pageUrl);

    // Only crawl within the starting section
    if (!pageUrl.startsWith(`${BASE_URL}${startPath}`)) continue;
    count++;

    if (VERBOSE) process.stdout.write(`  [${count}] ${pageUrl.replace(BASE_URL, '')} ... `);

    const result = await fetchPage(pageUrl);
    if (!result) { failed++; continue; }

    const { markdown, links, title } = result;
    const filePath = urlToFilePath(pageUrl);
    const relativePath = path.relative(DOCS_DIR, filePath);
    visitedFiles.add(filePath);

    // Only write if content has changed
    const newHash = createHash('md5').update(markdown).digest('hex');
    const existingHash = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, 'utf-8').match(/^hash: "([a-f0-9]+)"$/m)?.[1]
      : undefined;

    if (existingHash === newHash) {
      if (VERBOSE) console.log(`↩ (unchanged)`);
    } else {
      updated++;
      ensureDir(filePath);
      const content = `---\ntitle: "${title.replace(/"/g, '\\"')}"\nurl: "${pageUrl}"\ncrawled: "${new Date().toISOString()}"\nhash: "${newHash}"\n---\n\n${markdown}`;
      fs.writeFileSync(filePath, content, 'utf-8');
      if (VERBOSE) console.log(`✓ ${title || '(untitled)'}`);
    }

    newEntries.push({ path: relativePath, title, url: pageUrl });

    // Enqueue new links
    for (const link of links) {
      if (!visited.has(link)) queue.push(link);
    }

    // Progress indicator for non-verbose mode
    if (!VERBOSE && count % 50 === 0) process.stdout.write(`\r  ${startPath} — ${count} pages crawled, ${updated} updated`);

    await sleep(DELAY_MS);
  }

  // Clean up stale files not seen this crawl
  const staleRemoved = cleanStaleFiles(startPath, visitedFiles);

  updateIndex(newEntries);

  if (!VERBOSE) process.stdout.write('\r');
  console.log(`✅ ${startPath} — ${count} pages (${updated} updated, ${failed} failed, ${staleRemoved} stale removed)`);
}

/**
 * Delete files in a section directory that weren't visited this crawl
 * and whose `crawled` timestamp is older than STALE_DAYS.
 */
function cleanStaleFiles(sectionPath: string, visitedFiles: Set<string>): number {
  const sectionDir = path.join(DOCS_DIR, sectionPath);
  if (!fs.existsSync(sectionDir)) return 0;

  const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        // Remove empty directories
        if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
      } else if (entry.name.endsWith('.md') && !visitedFiles.has(full)) {
        // Check crawled timestamp before deleting
        const content = fs.readFileSync(full, 'utf-8');
        const match = content.match(/^crawled: "([^"]+)"$/m);
        const crawledAt = match ? new Date(match[1]).getTime() : 0;
        if (crawledAt < cutoff) {
          fs.unlinkSync(full);
          removed++;
          if (VERBOSE) console.log(`  🗑 Stale: ${path.relative(DOCS_DIR, full)}`);
        }
      }
    }
  }

  walk(sectionDir);
  return removed;
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
