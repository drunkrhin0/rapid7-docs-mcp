#!/usr/bin/env tsx
/**
 * External Docs Crawler
 * Fetches markdown docs directly from GitHub for sources outside docs.rapid7.com:
 *   - Metasploit Framework wiki  (rapid7/metasploit-framework — docs/metasploit-framework.wiki/)
 *   - Velociraptor docs          (Velocidex/velociraptor-docs — content/docs/)
 *
 * Both use the GitHub tree API (1 request) + raw.githubusercontent.com for file content.
 * Output lands in docs/metasploit-framework/ and docs/velociraptor/,
 * picked up automatically by docs_search and docs_list.
 *
 * Usage:
 *   npx tsx crawl-external.ts                # crawl all
 *   npx tsx crawl-external.ts --metasploit   # Metasploit only
 *   npx tsx crawl-external.ts --velociraptor # Velociraptor only
 *   npx tsx crawl-external.ts --verbose      # per-file output
 *
 * Optional env:
 *   GITHUB_TOKEN  — GitHub PAT for higher API rate limits (5000/hr vs 60/hr).
 *                   Only the tree API request is rate-limited; raw.githubusercontent.com is not.
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { DOCS_DIR, IndexEntry, ensureDir, updateIndex, buildSearchIndex, parallelMap } from './src/crawl-utils.js';

const VERBOSE   = process.argv.includes('--verbose');
const STALE_DAYS = 14;
const CONCURRENCY = 5;

// ─── Shared helpers ───────────────────────────────────────────────────────────

function hashContent(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

function writeIfChanged(filePath: string, content: string, newHash: string): boolean {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf-8');
    if (existing.match(/^hash: "([a-f0-9]+)"$/m)?.[1] === newHash) return false;
  }
  ensureDir(filePath);
  fs.writeFileSync(filePath, content, 'utf-8');
  return true;
}

function cleanStaleFiles(sectionDir: string, visitedFiles: Set<string>): number {
  if (!fs.existsSync(sectionDir)) return 0;
  const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
      } else if (entry.name.endsWith('.md') && !visitedFiles.has(full)) {
        const raw = fs.readFileSync(full, 'utf-8');
        const match = raw.match(/^crawled: "([^"]+)"$/m);
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

function extractFrontmatterTitle(raw: string): { title: string; body: string } {
  // YAML frontmatter (Hugo/Jekyll)
  const yaml = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (yaml) {
    const t = yaml[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
    return { title: t?.[1]?.trim() || '', body: yaml[2] };
  }
  // TOML frontmatter
  const toml = raw.match(/^\+\+\+\n([\s\S]*?)\n\+\+\+\n([\s\S]*)$/);
  if (toml) {
    const t = toml[1].match(/^title\s*=\s*["']?(.+?)["']?\s*$/m);
    return { title: t?.[1]?.trim() || '', body: toml[2] };
  }
  // No frontmatter — infer title from first h1
  const h1 = raw.match(/^#\s+(.+)$/m);
  return { title: h1?.[1]?.trim() || '', body: raw };
}

interface GitHubTreeItem {
  path: string;
  type: 'blob' | 'tree';
}

function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'Rapid7-Docs-MCP-Crawler/1.0',
  };
  if (process.env.GITHUB_TOKEN) h['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function crawlGitHubDocs(opts: {
  label: string;
  section: string;
  repo: string;
  branch: string;
  prefix: string;
  toUrl: (ghPath: string) => string;
}): Promise<void> {
  const { label, section, repo, branch, prefix, toUrl } = opts;
  console.log(`\n🕷  Crawling ${label} (GitHub: ${repo})`);

  const treeResp = await axios.get(
    `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`,
    { headers: githubHeaders(), timeout: 15000 }
  );

  const mdFiles: GitHubTreeItem[] = (treeResp.data.tree as GitHubTreeItem[])
    .filter(item => item.type === 'blob' && item.path.startsWith(prefix) && item.path.endsWith('.md'));

  console.log(`  Found ${mdFiles.length} markdown files`);
  fs.mkdirSync(path.join(DOCS_DIR, section), { recursive: true });

  const entries: IndexEntry[] = [];
  const visitedFiles = new Set<string>();
  let updated = 0, failed = 0, count = 0;

  await parallelMap(mdFiles, async (item) => {
    const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${item.path}`;
    const localPath = path.join(DOCS_DIR, section, item.path.slice(prefix.length));
    const pageUrl   = toUrl(item.path);
    const idx = ++count;

    if (VERBOSE) process.stdout.write(`  [${idx}/${mdFiles.length}] ${item.path.slice(prefix.length)} ... `);

    try {
      const resp = await axios.get(rawUrl, {
        timeout: 15000,
        headers: { 'User-Agent': 'Rapid7-Docs-MCP-Crawler/1.0' },
        responseType: 'text',
      });

      const { title, body } = extractFrontmatterTitle(resp.data as string);
      const displayTitle = title || path.basename(item.path, '.md').replace(/[-_]/g, ' ');
      const newHash = hashContent(body);
      const fm = `---\ntitle: "${displayTitle.replace(/"/g, '\\"')}"\nurl: "${pageUrl}"\ncrawled: "${new Date().toISOString()}"\nhash: "${newHash}"\n---\n\n`;
      const changed = writeIfChanged(localPath, fm + body, newHash);

      if (changed) { updated++; if (VERBOSE) console.log(`✓ ${displayTitle}`); }
      else { if (VERBOSE) console.log('↩ (unchanged)'); }

      visitedFiles.add(localPath);
      entries.push({ path: path.relative(DOCS_DIR, localPath), title: displayTitle, url: pageUrl });
    } catch (err) {
      failed++;
      if (VERBOSE) console.error(`✗ ${err instanceof Error ? err.message : err}`);
    }
  }, CONCURRENCY);

  const staleRemoved = cleanStaleFiles(path.join(DOCS_DIR, section), visitedFiles);
  updateIndex(entries);
  console.log(`✅ ${section} — ${mdFiles.length} files (${updated} updated, ${failed} failed, ${staleRemoved} stale removed)`);
}

// ─── Source definitions ───────────────────────────────────────────────────────

async function crawlMetasploit(): Promise<void> {
  await crawlGitHubDocs({
    label:   'Metasploit Framework wiki',
    section: 'metasploit-framework',
    repo:    'rapid7/metasploit-framework',
    branch:  'master',
    prefix:  'docs/metasploit-framework.wiki/',
    toUrl: (p) => {
      const name = path.basename(p, '.md');
      return `https://github.com/rapid7/metasploit-framework/wiki/${name}`;
    },
  });
}

async function crawlVelociraptor(): Promise<void> {
  await crawlGitHubDocs({
    label:   'Velociraptor docs',
    section: 'velociraptor',
    repo:    'Velocidex/velociraptor-docs',
    branch:  'master',
    prefix:  'content/docs/',
    toUrl: (p) => {
      const rel = p
        .slice('content/docs/'.length)
        .replace(/\/?(_index|index|README)\.md$/, '/')
        .replace(/\.md$/, '/');
      return `https://docs.velociraptor.app/docs/${rel}`;
    },
  });
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter(a => a !== '--verbose');
  const doMetasploit   = args.length === 0 || args.includes('--metasploit');
  const doVelociraptor = args.length === 0 || args.includes('--velociraptor');

  fs.mkdirSync(DOCS_DIR, { recursive: true });

  if (doMetasploit)   await crawlMetasploit();
  if (doVelociraptor) await crawlVelociraptor();

  buildSearchIndex();
}

main().catch(err => {
  console.error('Crawl failed:', err);
  process.exit(1);
});
