#!/usr/bin/env tsx
/**
 * External Docs Crawler
 * Fetches docs from sources outside docs.rapid7.com:
 *
 * GitHub sources (markdown fetched directly, no HTML conversion):
 *   - Metasploit Framework wiki  (rapid7/metasploit-framework — docs/metasploit-framework.wiki/)
 *   - Velociraptor docs          (Velocidex/velociraptor-docs — content/docs/)
 *
 * OpenAPI sources (public ReDoc/Swagger specs converted to per-tag markdown):
 *   - InsightVM / Nexpose API v3        (help.rapid7.com)
 *   - InsightVM Cloud Integrations v4   (help.rapid7.com)
 *   - InsightAppSec API v1              (help.rapid7.com)
 *   - InsightIDR (SIEM) API v1          (help.rapid7.com)
 *   - Insight Account API v1            (help.rapid7.com)
 *   - Platform Credential Management    (help.rapid7.com)
 *   - InsightConnect API v1             (docs.rapid7.com — YAML spec)
 *
 * Not crawled (requires authentication):
 *   - Threat Command / DRP API          (login required)
 *
 * Already covered by other crawlers:
 *   - Metasploit PRO REST + RPC API     → crawl.ts --section metasploit
 *   - Command Platform API overview     → crawl.ts --section insight
 *   - Velociraptor Server API           → this file, --velociraptor (content/docs/server_automation/)
 *
 * Usage:
 *   npx tsx crawl-external.ts                          # crawl all
 *   npx tsx crawl-external.ts --metasploit             # Metasploit wiki only
 *   npx tsx crawl-external.ts --velociraptor           # Velociraptor docs only
 *   npx tsx crawl-external.ts --insightvm-api          # InsightVM/Nexpose API v3
 *   npx tsx crawl-external.ts --insightvm-cloud-api    # InsightVM Cloud Integrations API v4
 *   npx tsx crawl-external.ts --insightappsec-api      # InsightAppSec API v1
 *   npx tsx crawl-external.ts --insightidr-api         # InsightIDR (SIEM) API v1
 *   npx tsx crawl-external.ts --insight-account-api    # Insight Account API v1
 *   npx tsx crawl-external.ts --credential-api         # Platform Credential Management API
 *   npx tsx crawl-external.ts --insightconnect-api     # InsightConnect API v1
 *   npx tsx crawl-external.ts --verbose                # per-file output
 *
 * Optional env:
 *   GITHUB_TOKEN  — GitHub PAT for higher API rate limits (5000/hr vs 60/hr).
 *                   Only the tree API request is rate-limited; raw.githubusercontent.com is not.
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import yaml from 'js-yaml';
import { DOCS_DIR, IndexEntry, ensureDir, updateIndex, buildSearchIndex, parallelMap } from './src/crawl-utils.js';

const VERBOSE    = process.argv.includes('--verbose');
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
  const yamlMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (yamlMatch) {
    const t = yamlMatch[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
    return { title: t?.[1]?.trim() || '', body: yamlMatch[2] };
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

// ─── GitHub source crawler ────────────────────────────────────────────────────

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

// ─── OpenAPI source crawler ───────────────────────────────────────────────────

interface ApiSource {
  flag: string;
  label: string;
  section: string;
  specUrl: string;
  pageBaseUrl: string;
}

/**
 * All public Rapid7 OpenAPI/Swagger specs.
 * Adding a new source = one entry here, no other code changes needed.
 */
const API_SOURCES: ApiSource[] = [
  {
    flag: '--insightvm-api',
    label: 'InsightVM/Nexpose API v3',
    section: 'insightvm-api',
    specUrl: 'https://help.rapid7.com/insightvm/en-us/api/api-v3.json',
    pageBaseUrl: 'https://help.rapid7.com/insightvm/en-us/api/index.html',
  },
  {
    flag: '--insightvm-cloud-api',
    label: 'InsightVM Cloud Integrations API v4',
    section: 'insightvm-cloud-api',
    specUrl: 'https://help.rapid7.com/insightvm/en-us/api/insightvm-api-v4.json',
    pageBaseUrl: 'https://help.rapid7.com/insightvm/en-us/api/integrations.html',
  },
  {
    flag: '--insightappsec-api',
    label: 'InsightAppSec API v1',
    section: 'insightappsec-api',
    specUrl: 'https://help.rapid7.com/insightappsec/en-us/api/v1/insightappsec-api-v1.json',
    pageBaseUrl: 'https://help.rapid7.com/insightappsec/en-us/api/v1/docs.html',
  },
  {
    flag: '--insightidr-api',
    label: 'InsightIDR (SIEM) API v1',
    section: 'insightidr-api',
    specUrl: 'https://help.rapid7.com/insightidr/en-us/api/v1/insightidr-api-v1.json',
    pageBaseUrl: 'https://help.rapid7.com/insightidr/en-us/api/v1/docs.html',
  },
  {
    flag: '--insight-account-api',
    label: 'Insight Account API v1',
    section: 'insight-account-api',
    specUrl: 'https://help.rapid7.com/insightAccount/en-us/api/v1/insightAccount-api-v1.json',
    pageBaseUrl: 'https://help.rapid7.com/insightAccount/en-us/api/v1/docs.html',
  },
  {
    flag: '--credential-api',
    label: 'Platform Credential Management API v1',
    section: 'credential-management-api',
    specUrl: 'https://help.rapid7.com/credentialmanagement/en-us/api/v1/credential-management-api-v1.json',
    pageBaseUrl: 'https://help.rapid7.com/credentialmanagement/en-us/api/v1/docs.html',
  },
  {
    flag: '--insightconnect-api',
    label: 'InsightConnect API v1',
    section: 'insightconnect-api',
    specUrl: 'https://docs.rapid7.com/_api/insightconnect-api-v1.yaml',
    pageBaseUrl: 'https://docs.rapid7.com/insightconnect/api/',
  },
  {
    flag: '--insightidr-detection-api',
    label: 'InsightIDR Detection Rules API v1',
    section: 'insightidr-detection-api',
    specUrl: 'https://docs.rapid7.com/_api/bifrost-api-v1.yaml',
    pageBaseUrl: 'https://docs.rapid7.com/insightidr/api/detection-rules/',
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchSpec(specUrl: string): Promise<any> {
  try {
    const resp = await axios.get(specUrl, {
      timeout: 30000,
      headers: { 'User-Agent': 'Rapid7-Docs-MCP-Crawler/1.0' },
      responseType: 'text',
    });
    const raw = resp.data as string;
    // YAML if the URL ends in .yaml/.yml or the content starts with "openapi:" / "swagger:"
    const isYaml = /\.(yaml|yml)$/i.test(specUrl) || /^(openapi|swagger):/m.test(raw.slice(0, 200));
    return isYaml ? yaml.load(raw) : JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ Failed to fetch spec: ${specUrl} — ${msg}`);
    return null;
  }
}

async function crawlOpenApiSpec(source: ApiSource): Promise<void> {
  const { label, section, specUrl, pageBaseUrl } = source;
  console.log(`\n🕷  Crawling ${label}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spec: any = await fetchSpec(specUrl);
  if (!spec) {
    console.error(`  ✗ Skipping ${label} — could not fetch spec`);
    return;
  }
  const totalPaths = Object.keys(spec.paths || {}).length;

  // Group operations by their first tag
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tagGroups = new Map<string, Array<{ method: string; pathStr: string; op: any }>>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const [pathStr, pathItem] of Object.entries(spec.paths || {}) as [string, any][]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const [method, operation] of Object.entries(pathItem) as [string, any][]) {
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;
      const tags: string[] = operation.tags?.length ? operation.tags : ['Uncategorized'];
      // Only assign to the first tag to avoid duplicating endpoints across groups
      const tag = tags[0];
      if (!tagGroups.has(tag)) tagGroups.set(tag, []);
      tagGroups.get(tag)!.push({ method: method.toUpperCase(), pathStr, op: operation });
    }
  }

  fs.mkdirSync(path.join(DOCS_DIR, section), { recursive: true });

  const entries: IndexEntry[] = [];
  const visitedFiles = new Set<string>();
  let updated = 0;

  for (const [tag, endpoints] of tagGroups) {
    const slug     = tag.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const filePath = path.join(DOCS_DIR, section, `${slug}.md`);
    const pageUrl  = `${pageBaseUrl}#tag/${encodeURIComponent(tag)}`;
    const title    = `${tag} - ${spec.info?.title || label}`;

    // ─── Build markdown body ────────────────────────────────────────────────

    let md = `# ${tag}\n\n`;
    md += `> ${spec.info?.title || label}\n`;
    md += `> Reference: ${pageUrl}\n\n`;

    for (const { method, pathStr, op } of endpoints) {
      md += `## ${method} ${pathStr}\n\n`;
      if (op.summary)     md += `**${op.summary}**\n\n`;
      if (op.description) md += `${String(op.description).trim()}\n\n`;

      // Parameters
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any[] = op.parameters || [];
      if (params.length > 0) {
        md += `**Parameters:**\n\n`;
        for (const p of params) {
          const req  = p.required ? ' *(required)*' : '';
          const desc = p.description ? ` — ${String(p.description).replace(/\n/g, ' ')}` : '';
          const type = p.schema?.type ? ` \`${p.schema.type}\`` : '';
          md += `- \`${p.name}\` (${p.in}${req})${type}${desc}\n`;
        }
        md += '\n';
      }

      // Request body (if any)
      if (op.requestBody) {
        const bodyDesc = op.requestBody.description || '';
        md += `**Request body:**${bodyDesc ? ` ${bodyDesc}` : ''}\n\n`;
      }

      // Responses
      if (op.responses) {
        md += `**Responses:**\n\n`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const [code, r] of Object.entries(op.responses) as [string, any][]) {
          md += `- \`${code}\` — ${r.description || ''}\n`;
        }
        md += '\n';
      }

      md += '---\n\n';
    }

    const newHash = hashContent(md);
    const fm = `---\ntitle: "${title.replace(/"/g, '\\"')}"\nurl: "${pageUrl}"\ncrawled: "${new Date().toISOString()}"\nhash: "${newHash}"\n---\n\n`;
    const changed = writeIfChanged(filePath, fm + md, newHash);

    if (changed) updated++;
    if (VERBOSE) console.log(`  ${changed ? '✓' : '↩'} ${tag} (${endpoints.length} endpoints)`);

    visitedFiles.add(filePath);
    entries.push({ path: path.relative(DOCS_DIR, filePath), title, url: pageUrl });
  }

  const staleRemoved = cleanStaleFiles(path.join(DOCS_DIR, section), visitedFiles);
  updateIndex(entries);
  console.log(`✅ ${section} — ${tagGroups.size} tag files, ${totalPaths} endpoints (${updated} updated, ${staleRemoved} stale removed)`);
}

// ─── GitHub source definitions ────────────────────────────────────────────────

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
  const args   = process.argv.slice(2).filter(a => a !== '--verbose');
  const runAll = args.length === 0;

  fs.mkdirSync(DOCS_DIR, { recursive: true });

  if (runAll || args.includes('--metasploit'))   await crawlMetasploit();
  if (runAll || args.includes('--velociraptor')) await crawlVelociraptor();

  for (const source of API_SOURCES) {
    if (runAll || args.includes(source.flag)) {
      await crawlOpenApiSpec(source);
    }
  }

  buildSearchIndex();
}

main().catch(err => {
  console.error('Crawl failed:', err);
  process.exit(1);
});
