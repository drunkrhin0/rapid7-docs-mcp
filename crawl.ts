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
import { createHash } from 'crypto';
import { DOCS_DIR, IndexEntry, ensureDir, updateIndex, buildSearchIndex, sleep } from './src/crawl-utils.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = 'https://docs.rapid7.com';
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
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ Failed: ${pageUrl} — ${msg}`);
    return null;
  }
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
    const relativePath = path.relative(DOCS_DIR, filePath);

    // Only write if content has changed
    const newHash = createHash('md5').update(markdown).digest('hex');
    const existingHash = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, 'utf-8').match(/^hash: "([a-f0-9]+)"$/m)?.[1]
      : undefined;

    if (existingHash === newHash) {
      console.log(`↩ (unchanged)`);
    } else {
      ensureDir(filePath);
      const content = `---\ntitle: "${title.replace(/"/g, '\\"')}"\nurl: "${pageUrl}"\ncrawled: "${new Date().toISOString()}"\nhash: "${newHash}"\n---\n\n${markdown}`;
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`✓ ${title || '(untitled)'}`);
    }

    newEntries.push({ path: relativePath, title, url: pageUrl });

    // Enqueue new links
    for (const link of links) {
      if (!visited.has(link)) queue.push(link);
    }

    await sleep(DELAY_MS);
  }

  updateIndex(newEntries);
  console.log(`\n✅ Crawled ${count} pages from ${startPath}`);
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
