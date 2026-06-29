#!/usr/bin/env tsx
/**
 * Rapid7 Extensions Crawler
 * Fetches extension metadata from extensions-api.rapid7.com and
 * full documentation (help.md) from CDN. No browser automation needed.
 *
 * Usage:
 *   npx tsx crawl-extensions.ts                    # Crawl all extensions
 *   npx tsx crawl-extensions.ts --slug splunk      # Crawl one extension
 *   npx tsx crawl-extensions.ts --list             # List first page of extensions
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  DOCS_DIR,
  IndexEntry,
  ensureDir,
  updateIndex,
  buildSearchIndex,
  sleep,
  parallelMap,
} from './src/crawl-utils.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const API_BASE = 'https://extensions-api.rapid7.com/v2/public/extensions';
const EXTENSIONS_URL = 'https://extensions.rapid7.com/extension';
const PAGE_SIZE = 40;
const EXTENSIONS_DIR = path.join(DOCS_DIR, 'extensions');
const CONCURRENCY = parseInt(process.env.CRAWL_CONCURRENCY || '5');
const FETCH_DELAY_MS = parseInt(process.env.CRAWL_DELAY_MS || '50'); // per-request delay within workers
const USER_AGENT = 'Rapid7-Docs-MCP-Crawler/1.0 (personal homelab indexer)';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExtensionResult {
  name: string; // slug: "abnormal-security"
  title: string; // "Abnormal Security"
  overview?: string;
  description?: string;
  keyFeatures?: string[];
  requirements?: string[];
  versionHistory?: Array<{
    version: string;
    date?: string;
    changes?: string;
  }>;
  tags?: Array<{ name: string; displayName: string; type: string }>;
  publisher?: string;
  type?: string;
  documentation?: { type?: string; source?: string }; // type "file" = CDN help.md, "url" = HTML page (skip)
  version?: string;
}

interface APIResponse {
  pageInfo: {
    endCursor: string;
    hasNextPage: boolean;
  };
  totalCount: number;
  results: ExtensionResult[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return cheerio.load(html).text().trim();
}

// ─── API fetcher ─────────────────────────────────────────────────────────────

async function fetchExtensionsPage(cursor?: string): Promise<APIResponse | null> {
  try {
    let url = `${API_BASE}?first=${PAGE_SIZE}&sort=relevance`;
    if (cursor) url += `&after=${cursor}`;

    const resp = await axios.get<APIResponse>(url, {
      timeout: 30000,
      headers: { 'User-Agent': USER_AGENT },
    });

    return resp.data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ API fetch failed: ${msg}`);
    return null;
  }
}

async function fetchHelpMd(url: string): Promise<string | null> {
  try {
    const resp = await axios.get<string>(url, {
      timeout: 30000,
      headers: { 'User-Agent': USER_AGENT },
      responseType: 'text',
    });
    return resp.data;
  } catch {
    return null; // Many extensions don't have help.md — that's fine
  }
}

// ─── Single extension → markdown ─────────────────────────────────────────────

async function fetchSingleExtension(slug: string): Promise<ExtensionResult | null> {
  try {
    // Direct endpoint returns the full extension object
    const resp = await axios.get<ExtensionResult>(`${API_BASE}/${slug}`, {
      timeout: 30000,
      headers: { 'User-Agent': USER_AGENT },
    });
    return resp.data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ API fetch failed for "${slug}": ${msg}`);
    return null;
  }
}

function buildMarkdown(ext: ExtensionResult, helpMd: string | null): string {
  const parts: string[] = [];

  // Header
  parts.push(`# ${ext.title}`);
  parts.push('');

  // Metadata line
  const meta: string[] = [];
  if (ext.publisher) meta.push(`**Publisher:** ${ext.publisher}`);
  if (ext.type) meta.push(`**Type:** ${ext.type}`);
  if (ext.version) meta.push(`**Version:** ${ext.version}`);
  if (meta.length) parts.push(meta.join(' | '));

  // Tags
  if (ext.tags?.length) {
    parts.push('');
    parts.push(`**Tags:** ${ext.tags.map((t) => t.displayName || t.name).join(', ')}`);
  }

  parts.push('');

  // Overview
  if (ext.overview) {
    parts.push('## Overview');
    parts.push('');
    parts.push(ext.overview);
    parts.push('');
  }

  // Description (if different from overview)
  if (ext.description && ext.description !== ext.overview) {
    parts.push('## Description');
    parts.push('');
    parts.push(ext.description);
    parts.push('');
  }

  // Key Features
  if (ext.keyFeatures?.length) {
    parts.push('## Key Features');
    parts.push('');
    for (const feature of ext.keyFeatures) {
      parts.push(`- ${feature}`);
    }
    parts.push('');
  }

  // Requirements
  if (ext.requirements?.length) {
    parts.push('## Requirements');
    parts.push('');
    for (const req of ext.requirements) {
      parts.push(`- ${req}`);
    }
    parts.push('');
  }

  // Version History (last 10 entries)
  if (ext.versionHistory?.length) {
    const recent = ext.versionHistory.slice(0, 10);
    parts.push('## Version History');
    parts.push('');
    parts.push('| Version | Date | Changes |');
    parts.push('|---------|------|---------|');
    for (const v of recent) {
      const changes = v.changes ? stripHtml(v.changes).replace(/\n/g, ' ').slice(0, 200) : '';
      const date = v.date ? v.date.split('T')[0] : '';
      parts.push(`| ${v.version} | ${date} | ${changes} |`);
    }
    parts.push('');
  }

  // Full Documentation (help.md from CDN)
  if (helpMd) {
    parts.push('## Documentation');
    parts.push('');
    parts.push(helpMd);
    parts.push('');
  } else if (ext.documentation?.source && ext.documentation.type === 'url') {
    // Event source extensions link to full docs on docs.rapid7.com
    parts.push('## Documentation');
    parts.push('');
    parts.push(`**Full documentation:** [${ext.documentation.source}](${ext.documentation.source})`);
    parts.push('');
  }

  return parts.join('\n');
}

// ─── Process a single extension ──────────────────────────────────────────────

async function processExtension(ext: ExtensionResult): Promise<IndexEntry | null> {
  const slug = ext.name;
  const filePath = path.join(EXTENSIONS_DIR, `${slug}.md`);
  const relativePath = path.relative(DOCS_DIR, filePath);
  const pageUrl = `${EXTENSIONS_URL}/${slug}`;

  // Courteous rate limiting — small delay between concurrent CDN requests
  await sleep(FETCH_DELAY_MS);

  // Fetch full docs from CDN — only for type "file" (clean markdown).
  // type "url" points to docs.rapid7.com HTML pages (2MB+ of raw HTML with
  // sidebar nav), which are already indexed by crawl.ts under their product section.
  let helpMd: string | null = null;
  if (ext.documentation?.source && ext.documentation.type === 'file') {
    helpMd = await fetchHelpMd(ext.documentation.source);
  }

  const markdown = buildMarkdown(ext, helpMd);

  // Content-hash check — skip if unchanged
  const newHash = createHash('md5').update(markdown).digest('hex');
  const existingHash = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf-8').match(/^hash: "([a-f0-9]+)"$/m)?.[1]
    : undefined;

  if (existingHash === newHash) {
    process.stdout.write(`↩`);
    return { path: relativePath, title: ext.title, url: pageUrl };
  }

  ensureDir(filePath);
  const content = [
    '---',
    `title: "${ext.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    `url: "${pageUrl}"`,
    `crawled: "${new Date().toISOString()}"`,
    `hash: "${newHash}"`,
    '---',
    '',
    markdown,
  ].join('\n');

  fs.writeFileSync(filePath, content, 'utf-8');
  process.stdout.write(`✓`);

  return { path: relativePath, title: ext.title, url: pageUrl };
}

// ─── Main crawl ──────────────────────────────────────────────────────────────

async function crawlAllExtensions(): Promise<void> {
  console.log('\n🔌 Crawling Rapid7 Extensions...');

  let cursor: string | undefined;
  let hasNext = true;
  let total = 0;
  let skipped = 0;
  let page = 0;
  const newEntries: IndexEntry[] = [];
  const seen = new Set<string>(); // deduplicate across pagination boundaries

  while (hasNext) {
    page++;
    process.stdout.write(`\n  Page ${page}: `);

    const data = await fetchExtensionsPage(cursor);
    if (!data || data.results.length === 0) break;

    if (page === 1) {
      console.log(`(${data.totalCount} total extensions)`);
      process.stdout.write('  ');
    }

    // Deduplicate within the page
    const unique = data.results.filter((ext) => {
      if (seen.has(ext.name)) {
        skipped++;
        return false;
      }
      seen.add(ext.name);
      return true;
    });

    // Process page with bounded concurrency
    const entries = await parallelMap(unique, processExtension, CONCURRENCY);
    for (const entry of entries) {
      if (entry) newEntries.push(entry);
    }
    total += unique.length;

    hasNext = data.pageInfo.hasNextPage;
    cursor = data.pageInfo.endCursor;
  }

  updateIndex(newEntries);
  console.log(`\n\n✅ Processed ${total} extensions${skipped ? ` (${skipped} duplicates skipped)` : ''}`);
}

async function crawlSingleExtension(slug: string): Promise<void> {
  console.log(`\n🔌 Fetching extension: ${slug}`);

  const ext = await fetchSingleExtension(slug);
  if (!ext) {
    console.error(`  ✗ Extension "${slug}" not found`);
    process.exit(1);
  }

  process.stdout.write(`  ${ext.title} ... `);

  const entry = await processExtension(ext);
  if (entry) {
    updateIndex([entry]);
    console.log(`\n\n✅ Indexed: ${ext.title}`);
  }
}

// ─── Toolkit types ──────────────────────────────────────────────────────────

interface ToolkitSlugRef {
  options?: string[];
  slugName: string;
}

interface ToolkitWorkflow {
  name: string;
  configurable?: string;
  options?: string[];
  slugNames?: ToolkitSlugRef[];
  extendedDescription?: string;
}

interface ToolkitSubTopic {
  title: string;
  description: string;
  link: string;
  content: {
    sections?: Array<{
      sectionTitle: string;
      sectionCopy: string;
      sectionItems?: Array<{ name: string }>;
    }>;
    workflowList: {
      workflowSectionTitle: string;
      workflows: ToolkitWorkflow[];
    };
  };
}

interface ToolkitData {
  title: string;
  description: string;
  link: string;
  subTopics: ToolkitSubTopic[];
}

interface ToolkitsJson {
  headerCards: Array<{ title: string; description: string; totalNumber: number; url: string }>;
  overviewCards: Array<{ title: string; description: string; link: string; comingSoon?: boolean }>;
  toolkits: ToolkitData[];
}

// ─── Toolkit → markdown ─────────────────────────────────────────────────────

function buildToolkitMarkdown(toolkit: ToolkitData): string {
  const parts: string[] = [];

  parts.push(`# ${toolkit.title}`);
  parts.push('');
  parts.push(toolkit.description.trim());
  parts.push('');

  for (const sub of toolkit.subTopics) {
    parts.push(`## ${sub.title}`);
    parts.push('');
    parts.push(sub.description);
    parts.push('');

    // "How It Works" steps
    const howItWorks = sub.content.sections?.find((s) => s.sectionTitle === 'How It Works');
    if (howItWorks) {
      parts.push(`### How It Works`);
      parts.push('');
      parts.push(howItWorks.sectionCopy);
      parts.push('');
      if (howItWorks.sectionItems?.length) {
        for (const item of howItWorks.sectionItems) {
          parts.push(`- ${item.name.trim()}`);
        }
        parts.push('');
      }
    }

    // Workflow table
    const workflows = sub.content.workflowList.workflows;
    if (workflows.length) {
      parts.push(`### ${sub.content.workflowList.workflowSectionTitle}`);
      parts.push('');
      parts.push('| Workflow | Platforms | Extension |');
      parts.push('|----------|-----------|-----------|');
      for (const wf of workflows) {
        const platforms = wf.options?.join(', ') || '';
        const links = (wf.slugNames || [])
          .map((s) => `[${s.options?.join('/') || 'Link'}](https://extensions.rapid7.com/extension/${s.slugName})`)
          .join(', ');
        parts.push(`| ${wf.name} | ${platforms} | ${links || 'N/A'} |`);
      }
      parts.push('');

      // Extended descriptions for workflows that have them
      const withDesc = workflows.filter((wf) => wf.extendedDescription);
      if (withDesc.length) {
        parts.push('**Workflow Details:**');
        parts.push('');
        for (const wf of withDesc) {
          parts.push(`- **${wf.name}:** ${wf.extendedDescription}`);
        }
        parts.push('');
      }
    }
  }

  return parts.join('\n');
}

function buildToolkitsIndexMarkdown(toolkits: ToolkitsJson): string {
  const parts: string[] = [];
  parts.push('# Rapid7 InsightConnect Toolkits');
  parts.push('');
  parts.push('Curated collections of InsightConnect workflow extensions, organized by security use case.');
  parts.push('');

  for (const tk of toolkits.toolkits) {
    const overview = toolkits.overviewCards.find((o) => o.link === tk.link);
    const header = toolkits.headerCards.find((h) => h.url.includes(tk.link));
    const desc = overview?.description || tk.description;
    const count = header?.totalNumber || tk.subTopics.reduce((n, s) => n + s.content.workflowList.workflows.length, 0);

    parts.push(`## [${tk.title}](https://extensions.rapid7.com/wfh-playbook/${tk.link})`);
    parts.push('');
    parts.push(`${desc.trim()}`);
    parts.push('');
    parts.push(
      `**${count} workflows** across ${tk.subTopics.length} categories: ${tk.subTopics.map((s) => s.title).join(', ')}`,
    );
    parts.push('');
  }

  // Coming soon
  const comingSoon = toolkits.overviewCards.filter((o) => o.comingSoon);
  if (comingSoon.length) {
    parts.push('## Coming Soon');
    parts.push('');
    for (const o of comingSoon) {
      parts.push(`- **${o.title}:** ${o.description}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

async function crawlToolkits(): Promise<void> {
  const toolkitsFile = path.join(process.cwd(), 'toolkits_complete.json');
  if (!fs.existsSync(toolkitsFile)) {
    console.log('\n⏭  No toolkits_complete.json found — skipping toolkit generation');
    return;
  }

  console.log('\n🧰 Generating toolkit docs...');
  const toolkits: ToolkitsJson = JSON.parse(fs.readFileSync(toolkitsFile, 'utf-8'));
  const toolkitsDir = path.join(EXTENSIONS_DIR, 'toolkits');
  fs.mkdirSync(toolkitsDir, { recursive: true });

  const newEntries: IndexEntry[] = [];

  // Index page
  const indexMd = buildToolkitsIndexMarkdown(toolkits);
  const indexPath = path.join(toolkitsDir, 'index.md');
  const indexRelative = path.relative(DOCS_DIR, indexPath);
  const indexHash = createHash('md5').update(indexMd).digest('hex');
  const existingIndexHash = fs.existsSync(indexPath)
    ? fs.readFileSync(indexPath, 'utf-8').match(/^hash: "([a-f0-9]+)"$/m)?.[1]
    : undefined;

  if (existingIndexHash !== indexHash) {
    const content = [
      '---',
      `title: "Rapid7 InsightConnect Toolkits"`,
      `url: "https://extensions.rapid7.com/wfh-playbook"`,
      `crawled: "${new Date().toISOString()}"`,
      `hash: "${indexHash}"`,
      '---',
      '',
      indexMd,
    ].join('\n');
    fs.writeFileSync(indexPath, content, 'utf-8');
    process.stdout.write('  toolkits/index.md ✓\n');
  } else {
    process.stdout.write('  toolkits/index.md ↩\n');
  }
  newEntries.push({
    path: indexRelative,
    title: 'Rapid7 InsightConnect Toolkits',
    url: 'https://extensions.rapid7.com/wfh-playbook',
  });

  // Individual toolkit pages
  for (const tk of toolkits.toolkits) {
    const markdown = buildToolkitMarkdown(tk);
    const filePath = path.join(toolkitsDir, `${tk.link}.md`);
    const relativePath = path.relative(DOCS_DIR, filePath);
    const pageUrl = `https://extensions.rapid7.com/wfh-playbook/${tk.link}`;
    const newHash = createHash('md5').update(markdown).digest('hex');
    const existingHash = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, 'utf-8').match(/^hash: "([a-f0-9]+)"$/m)?.[1]
      : undefined;

    if (existingHash !== newHash) {
      const content = [
        '---',
        `title: "${tk.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
        `url: "${pageUrl}"`,
        `crawled: "${new Date().toISOString()}"`,
        `hash: "${newHash}"`,
        '---',
        '',
        markdown,
      ].join('\n');
      fs.writeFileSync(filePath, content, 'utf-8');
      process.stdout.write(`  toolkits/${tk.link}.md ✓\n`);
    } else {
      process.stdout.write(`  toolkits/${tk.link}.md ↩\n`);
    }

    newEntries.push({ path: relativePath, title: tk.title, url: pageUrl });
  }

  updateIndex(newEntries);
  console.log(`✅ Generated ${newEntries.length} toolkit docs`);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });

  if (args.includes('--list')) {
    console.log('\n📋 Fetching extensions list...\n');
    const data = await fetchExtensionsPage();
    if (!data) {
      console.error('Failed to fetch extensions');
      process.exit(1);
    }
    console.log(`Total extensions: ${data.totalCount}\n`);
    for (const ext of data.results) {
      const tags =
        ext.tags
          ?.slice(0, 3)
          .map((t) => t.displayName || t.name)
          .join(', ') || '';
      console.log(`  ${ext.name.padEnd(40)} ${ext.title.padEnd(35)} ${tags}`);
    }
    console.log(`\n  ... and ${data.totalCount - data.results.length} more. Run without --list to crawl all.`);
    return;
  }

  const slugIdx = args.indexOf('--slug');
  if (slugIdx !== -1) {
    const slug = args[slugIdx + 1];
    if (!slug) {
      console.error('Missing --slug value');
      process.exit(1);
    }
    await crawlSingleExtension(slug);
  } else {
    await crawlAllExtensions();
  }

  // Generate toolkit docs from SPA-extracted data
  await crawlToolkits();

  // Rebuild search index with extensions + toolkits included
  buildSearchIndex();
}

main().catch((err) => {
  console.error('Extensions crawl failed:', err);
  process.exit(1);
});
