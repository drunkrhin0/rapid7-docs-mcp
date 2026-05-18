#!/usr/bin/env node
/**
 * Rapid7 Docs MCP Server
 * Exposes crawled Rapid7 documentation as MCP tools for Claude.
 *
 * Transport: stdio (default) or HTTP (set MCP_TRANSPORT=http)
 *
 * Tools:
 *   - docs_search            : Full-text search across all crawled docs
 *   - docs_read              : Read a specific doc page by path or URL
 *   - docs_list              : List available sections and page counts
 *   - get_product_knowledge  : Marketing content, pricing, and FAQs for a Rapid7 product
 *   - search_blog            : Search the Rapid7 blog index by keyword
 *   - search_resources       : Search Rapid7 resources (whitepapers, reports, guides)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { fileURLToPath } from 'url';
import { STOP_WORDS, stem } from './text.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const INDEX_FILE = path.join(DOCS_DIR, 'index.json');
const SEARCH_INDEX_FILE = path.join(DOCS_DIR, 'search-index.json');
const MAX_RESULTS = 20;
const SNIPPET_CHARS = 300;

// ─── Types ────────────────────────────────────────────────────────────────────

interface IndexEntry {
  path: string;
  title: string;
  url: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// In-memory index cache with mtime-based invalidation
let _indexCache: IndexEntry[] | null = null;
let _indexMtime = 0;

function loadIndex(): IndexEntry[] {
  if (!fs.existsSync(INDEX_FILE)) return [];
  const mtime = fs.statSync(INDEX_FILE).mtimeMs;
  if (_indexCache && mtime === _indexMtime) return _indexCache;
  _indexCache = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8')) as IndexEntry[];
  _indexMtime = mtime;
  return _indexCache;
}

// search-index.json: { p: paths[], i: { stem → docId[] } }
interface SearchIndex {
  p: string[];
  i: Record<string, number[]>;
}

let _searchIndexCache: SearchIndex | null = null;
let _searchIndexMtime = 0;

function loadSearchIndex(): SearchIndex | null {
  if (!fs.existsSync(SEARCH_INDEX_FILE)) return null;
  const mtime = fs.statSync(SEARCH_INDEX_FILE).mtimeMs;
  if (_searchIndexCache && mtime === _searchIndexMtime) return _searchIndexCache;
  _searchIndexCache = JSON.parse(fs.readFileSync(SEARCH_INDEX_FILE, 'utf-8')) as SearchIndex;
  _searchIndexMtime = mtime;
  return _searchIndexCache;
}

const DOCS_DIR_RESOLVED = path.resolve(DOCS_DIR);

// LRU doc content cache — avoids re-reading the same files on every search
const _docCache = new Map<string, string>();
const DOC_CACHE_MAX = 500;

function readDoc(relativePath: string): string | null {
  const fullPath = path.resolve(path.join(DOCS_DIR, relativePath));
  // Prevent path traversal outside docs directory
  if (!fullPath.startsWith(DOCS_DIR_RESOLVED + path.sep) && fullPath !== DOCS_DIR_RESOLVED) {
    return null;
  }

  // Cache hit — move to end (most-recently-used)
  if (_docCache.has(relativePath)) {
    const cached = _docCache.get(relativePath)!;
    _docCache.delete(relativePath);
    _docCache.set(relativePath, cached);
    return cached;
  }

  if (!fs.existsSync(fullPath)) return null;
  const content = fs.readFileSync(fullPath, 'utf-8');

  // Evict oldest entry when at capacity
  if (_docCache.size >= DOC_CACHE_MAX) {
    _docCache.delete(_docCache.keys().next().value!);
  }
  _docCache.set(relativePath, content);
  return content;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip YAML frontmatter so snippets/scoring don't see hash/url/date noise */
function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n/, '');
}

function extractSnippet(content: string, queryTerms: string[]): string {
  const lower = content.toLowerCase();

  // Collect all positions where any query term appears
  const positions: number[] = [];
  for (const term of queryTerms) {
    const re = new RegExp(escapeRegex(term), 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) positions.push(m.index);
  }

  if (positions.length === 0) return content.slice(0, SNIPPET_CHARS) + '...';

  positions.sort((a, b) => a - b);

  // Sliding window: find the start position that covers the most hits within SNIPPET_CHARS
  let bestStart = positions[0];
  let bestCount = 0;
  let left = 0;
  for (let right = 0; right < positions.length; right++) {
    while (positions[right] - positions[left] > SNIPPET_CHARS) left++;
    if (right - left + 1 > bestCount) {
      bestCount = right - left + 1;
      bestStart = positions[left];
    }
  }

  const start = Math.max(0, bestStart - 40);
  const end = Math.min(content.length, start + SNIPPET_CHARS);
  return (start > 0 ? '...' : '') + content.slice(start, end) + (end < content.length ? '...' : '');
}

function searchDocs(query: string, section?: string): Array<{ entry: IndexEntry; snippet: string; score: number }> {
  const index = loadIndex();
  const rawTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

  // Stem query terms, filtering stop words
  const meaningful = rawTerms.filter(t => !STOP_WORDS.has(t));
  const stemmedTerms = (meaningful.length > 0 ? meaningful : rawTerms).map(t => stem(t));

  const sectionPrefix = section ? section.replace(/\/$/, '') + '/' : null;
  const entryMap = new Map(index.map(e => [e.path, e]));
  const docScores = new Map<string, number>();

  // Use both raw + stemmed terms for snippet highlighting
  const snippetTerms = [...new Set([...rawTerms, ...stemmedTerms])];

  const searchIdx = loadSearchIndex();

  if (searchIdx) {
    // Fast path: inverted index lookup — O(matching docs) instead of O(all docs)
    const candidatePaths = new Set<string>();
    for (const stemmed of stemmedTerms) {
      const docIds = searchIdx.i[stemmed];
      if (!docIds) continue;
      for (const id of docIds) {
        const docPath = searchIdx.p[id];
        if (docPath) candidatePaths.add(docPath);
      }
    }

    for (const docPath of candidatePaths) {
      if (sectionPrefix && !docPath.startsWith(sectionPrefix)) continue;
      const entry = entryMap.get(docPath);
      if (!entry) continue;
      const raw = readDoc(docPath);
      if (!raw) continue;
      const content = stripFrontmatter(raw);
      const lowerContent = content.toLowerCase();
      const lowerTitle = entry.title.toLowerCase();
      let score = 0;
      for (const stemmed of stemmedTerms) {
        if (lowerTitle.includes(stemmed)) score += 10;
        score += (lowerContent.match(new RegExp(escapeRegex(stemmed), 'g')) || []).length;
      }
      if (score > 0) docScores.set(docPath, score);
    }
  } else {
    // Slow path: full scan fallback (no search-index.json yet)
    for (const entry of index) {
      if (sectionPrefix && !entry.path.startsWith(sectionPrefix)) continue;
      const raw = readDoc(entry.path);
      if (!raw) continue;
      const content = stripFrontmatter(raw);
      const lowerContent = content.toLowerCase();
      const lowerTitle = entry.title.toLowerCase();
      let score = 0;
      for (const stemmed of stemmedTerms) {
        if (lowerTitle.includes(stemmed)) score += 10;
        score += (lowerContent.match(new RegExp(escapeRegex(stemmed), 'g')) || []).length;
      }
      if (score > 0) docScores.set(entry.path, score);
    }
  }

  // Build results
  const results: Array<{ entry: IndexEntry; snippet: string; score: number }> = [];
  for (const [docPath, score] of docScores) {
    const entry = entryMap.get(docPath);
    if (!entry) continue;
    const raw = readDoc(docPath);
    if (!raw) continue;
    results.push({ entry, snippet: extractSnippet(stripFrontmatter(raw), snippetTerms), score });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
}

function getSections(): Record<string, number> {
  const index = loadIndex();
  const sections: Record<string, number> = {};

  for (const entry of index) {
    const parts = entry.path.split('/');
    const section = parts[0] || 'root';
    sections[section] = (sections[section] || 0) + 1;
  }

  return sections;
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'rapid7-docs-mcp-server',
  version: '1.0.0',
});

// Tool: docs_search
server.registerTool(
  'docs_search',
  {
    title: 'Search Rapid7 Documentation',
    description: `Search across all crawled Rapid7 documentation pages using full-text search.

Returns ranked results with context snippets and links to the live docs page.
Images in results are linked as absolute URLs and can be fetched for visual reference.

Args:
  - query (string): Search terms, e.g. "DHCP sensor configuration" or "log aggregation API"
  - section (string, optional): Limit to a product section e.g. "insightidr", "insightvm"
  - limit (number, optional): Max results to return, 1-20 (default: 10)

Returns:
  Array of matching docs with title, url, file path, and a content snippet.

Examples:
  - "How do I configure log sources in InsightIDR?" -> query="log source configuration", section="insightidr"
  - "What CVSS scoring does InsightVM use?" -> query="CVSS scoring", section="insightvm"
  - "Find the Splunk extension plugin" -> query="Splunk", section="extensions"`,
    inputSchema: z.object({
      query: z.string().min(2).describe('Search terms'),
      section: z.string().optional().describe('Product section filter e.g. insightidr, insightvm'),
      limit: z.number().int().min(1).max(20).default(10).describe('Max results'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ query, section, limit }) => {
    const results = searchDocs(query, section).slice(0, limit);

    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `No results found for "${query}"${section ? ` in section "${section}"` : ''}. Try broader terms or run the crawler to index more docs.` }],
      };
    }

    const output = results.map((r, i) => ({
      rank: i + 1,
      title: r.entry.title,
      url: r.entry.url,
      file: r.entry.path,
      score: r.score,
      snippet: r.snippet,
    }));

    const text = output
      .map(r => `**[${r.rank}] ${r.title}**\nURL: ${r.url}\nFile: ${r.file}\n\n${r.snippet}\n`)
      .join('\n---\n\n');

    return {
      content: [{ type: 'text', text: text + '\n\n```json\n' + JSON.stringify({ results: output }, null, 2) + '\n```' }],
    };
  }
);

// Tool: docs_read
server.registerTool(
  'docs_read',
  {
    title: 'Read Rapid7 Doc Page',
    description: `Read the full markdown content of a specific Rapid7 documentation page.

Use this after docs_search to get complete content of a result.
Images are preserved as absolute URLs.

Args:
  - path (string): Relative file path from docs_search results e.g. "insightidr/docs/log-sources.md"
                   OR a full URL from docs.rapid7.com or documentation.rapid7.com

Returns:
  Full markdown content of the page including frontmatter with source URL.`,
    inputSchema: z.object({
      path: z.string().describe('Relative file path from search results, or a docs.rapid7.com / documentation.rapid7.com URL'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path: docPath }) => {
    // Allow passing a URL — look it up in the index
    if (docPath.startsWith('http')) {
      const index = loadIndex();
      const entry = index.find(e => e.url === docPath || e.url === docPath.replace(/\/$/, ''));
      if (!entry) {
        return {
          content: [{ type: 'text', text: `No cached page found for URL: ${docPath}\nTry running the crawler first: npm run crawl` }],
        };
      }
      docPath = entry.path;
    }

    const content = readDoc(docPath);
    if (!content) {
      return {
        content: [{ type: 'text', text: `File not found: ${docPath}\nRun "npm run crawl" to index docs first.` }],
      };
    }

    return {
      content: [{ type: 'text', text: content }],
    };
  }
);

// Tool: docs_list
server.registerTool(
  'docs_list',
  {
    title: 'List Rapid7 Docs Sections',
    description: `List crawled Rapid7 documentation sections or browse pages within a section.

Without a section: shows all sections with page counts and last-crawled date.
With a section: lists every indexed page title and file path in that section.

Args:
  - section (string, optional): Product section to browse e.g. "insightidr", "insightvm", "extensions"

Use this to understand what's available, then use docs_search or docs_read.`,
    inputSchema: z.object({
      section: z.string().optional().describe('Browse pages within a specific section e.g. insightidr'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ section }) => {
    const index = loadIndex();
    const indexStat = fs.existsSync(INDEX_FILE) ? fs.statSync(INDEX_FILE) : null;
    const lastCrawled = indexStat ? indexStat.mtime.toISOString() : 'Never';

    if (index.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No docs indexed yet.\n\nRun the crawler:\n  npm run crawl                     # all sections\n  npm run crawl:section insightidr  # one section',
        }],
      };
    }

    // Section browse mode
    if (section) {
      const prefix = section.replace(/\/$/, '') + '/';
      const pages = index.filter(e => e.path.startsWith(prefix));
      if (pages.length === 0) {
        const sections = getSections();
        const available = Object.keys(sections).join(', ');
        return {
          content: [{ type: 'text', text: `Section "${section}" not found or not indexed.\nAvailable sections: ${available}` }],
        };
      }
      const pageList = pages.map(p => `  ${p.path.padEnd(60)} ${p.title}`).join('\n');
      const pageData = { section, pages: pages.map(p => ({ path: p.path, title: p.title, url: p.url })) };
      return {
        content: [{ type: 'text', text: `**${section}** — ${pages.length} pages\n\n${pageList}\n\n\`\`\`json\n${JSON.stringify(pageData, null, 2)}\n\`\`\`` }],
      };
    }

    // Summary mode
    const sections = getSections();
    const total = Object.values(sections).reduce((a, b) => a + b, 0);
    const sectionText = Object.entries(sections)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `  ${name.padEnd(25)} ${count} pages`)
      .join('\n');

    const summary = { sections, total, lastCrawled };
    return {
      content: [{
        type: 'text',
        text: `**Rapid7 Docs Index**\nLast crawled: ${lastCrawled}\nTotal pages: ${total}\n\n**Sections:**\n${sectionText}\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\``,
      }],
    };
  }
);

// ─── Site data helpers ────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, '..', 'data');

interface BlogPost {
  title: string;
  url: string;
  date: string;
  category: string;
}

interface Resource {
  title: string;
  url: string;
  type: string;
  description: string;
}

let _blogCache: BlogPost[] | null = null;
let _blogMtime = 0;

function loadBlogIndex(): BlogPost[] {
  const filePath = path.join(DATA_DIR, 'blog-index.json');
  if (!fs.existsSync(filePath)) return [];
  const mtime = fs.statSync(filePath).mtimeMs;
  if (_blogCache && mtime === _blogMtime) return _blogCache;
  _blogCache = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as BlogPost[];
  _blogMtime = mtime;
  return _blogCache;
}

let _resourcesCache: Resource[] | null = null;
let _resourcesMtime = 0;

function loadResources(): Resource[] {
  const filePath = path.join(DATA_DIR, 'resources.json');
  if (!fs.existsSync(filePath)) return [];
  const mtime = fs.statSync(filePath).mtimeMs;
  if (_resourcesCache && mtime === _resourcesMtime) return _resourcesCache;
  _resourcesCache = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Resource[];
  _resourcesMtime = mtime;
  return _resourcesCache;
}

function readProduct(slug: string): string | null {
  const filePath = path.resolve(path.join(DATA_DIR, 'products', `${slug}.md`));
  // Prevent path traversal
  const productsDir = path.resolve(path.join(DATA_DIR, 'products'));
  if (!filePath.startsWith(productsDir + path.sep)) return null;
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

function listProducts(): string[] {
  const dir = path.join(DATA_DIR, 'products');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''));
}

// Tool: get_product_knowledge
server.registerTool(
  'get_product_knowledge',
  {
    title: 'Get Rapid7 Product Knowledge',
    description: `Get marketing content, feature descriptions, pricing tiers, and FAQ answers for a Rapid7 product.

Returns the full product page content including overview, features, tier comparisons, and frequently asked questions.

Args:
  - product (string): Product slug e.g. "command", "insightvm", "siem", "metasploit"

Available products: command, insightappsec, insightcloudsec, insightvm, metasploit, nexpose, siem, threat-command, velociraptor

Returns:
  Full markdown content of the product page with all scraped sections.`,
    inputSchema: z.object({
      product: z.string().describe('Product slug e.g. "command", "insightvm", "siem"'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ product }) => {
    const content = readProduct(product);
    if (!content) {
      const available = listProducts();
      return {
        content: [{
          type: 'text',
          text: available.length
            ? `Product "${product}" not found.\nAvailable products: ${available.join(', ')}\n\nRun: npx tsx crawl-site.ts --products`
            : 'No product data indexed yet.\n\nRun: npx tsx crawl-site.ts --products',
        }],
      };
    }
    return { content: [{ type: 'text', text: stripFrontmatter(content) }] };
  }
);

// Tool: search_blog
server.registerTool(
  'search_blog',
  {
    title: 'Search Rapid7 Blog',
    description: `Search the Rapid7 blog index by keyword. Returns matching post titles, dates, categories, and URLs.

Does NOT return full blog content — just metadata for finding relevant posts.

Args:
  - query (string): Search terms e.g. "ransomware", "MDR", "vulnerability management"
  - category (string, optional): Filter by category e.g. "Threat Research", "Products and Tools"
  - limit (number, optional): Max results to return, 1-50 (default: 20)

Returns:
  Matching blog posts with title, date, category, and URL.

Examples:
  - "latest ransomware research" -> query="ransomware", category="Threat Research"
  - "most recent posts" -> query="" (omit or empty to get newest posts sorted by date)
  - "recent MDR updates" -> query="MDR"`,
    inputSchema: z.object({
      query: z.string().default('').describe('Search terms — leave empty to get most recent posts sorted by date'),
      category: z.string().optional().describe('Category filter e.g. "Threat Research"'),
      limit: z.number().int().min(1).max(50).default(20).describe('Max results'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ query, category, limit }) => {
    const posts = loadBlogIndex();
    if (posts.length === 0) {
      return {
        content: [{ type: 'text', text: 'No blog data indexed yet.\n\nRun: npx tsx crawl-site.ts --blog' }],
      };
    }

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hasQuery = terms.length > 0;

    let candidates: BlogPost[];

    if (hasQuery) {
      // Keyword search: score then sort by score desc, date desc
      let scored = posts.map(p => {
        const titleLower = p.title.toLowerCase();
        const catLower = p.category.toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (titleLower.includes(t)) score += 10;
          if (catLower.includes(t)) score += 3;
        }
        return { post: p, score };
      }).filter(s => s.score > 0);

      if (category) {
        const catFilter = category.toLowerCase();
        scored = scored.filter(s => s.post.category.toLowerCase().includes(catFilter));
      }

      // Sort by score descending, then by date descending
      scored.sort((a, b) => b.score - a.score || (b.post.date || '').localeCompare(a.post.date || ''));
      candidates = scored.map(s => s.post);
    } else {
      // No query: return all posts sorted by date descending (most recent first)
      candidates = [...posts];
      if (category) {
        const catFilter = category.toLowerCase();
        candidates = candidates.filter(p => p.category.toLowerCase().includes(catFilter));
      }
      candidates.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }

    const results = candidates.slice(0, limit);

    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `No blog posts found${hasQuery ? ` matching "${query}"` : ''}${category ? ` in category "${category}"` : ''}. Total indexed: ${posts.length} posts.` }],
      };
    }

    const text = results
      .map((p, i) => `**[${i + 1}] ${p.title}**\n${p.date ? `Date: ${p.date}` : 'Date: N/A'}${p.category ? ` | Category: ${p.category}` : ''}\nURL: ${p.url}`)
      .join('\n\n');

    const blogData = { results, total: candidates.length, indexed: posts.length };
    return {
      content: [{ type: 'text', text: `Found ${results.length} of ${candidates.length} matches (${posts.length} total posts):\n\n${text}\n\n\`\`\`json\n${JSON.stringify(blogData, null, 2)}\n\`\`\`` }],
    };
  }
);

// Tool: search_resources
server.registerTool(
  'search_resources',
  {
    title: 'Search Rapid7 Resources',
    description: `Search the Rapid7 resources index (whitepapers, reports, guides, webinars).

Args:
  - query (string): Search terms e.g. "SIEM", "compliance", "cloud security"
  - type (string, optional): Filter by resource type e.g. "Whitepaper", "Report", "Webinar"
  - limit (number, optional): Max results to return, 1-50 (default: 20)

Returns:
  Matching resources with title, type, description, and URL.`,
    inputSchema: z.object({
      query: z.string().min(2).describe('Search terms'),
      type: z.string().optional().describe('Resource type filter e.g. "Whitepaper"'),
      limit: z.number().int().min(1).max(50).default(20).describe('Max results'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ query, type, limit }) => {
    const resources = loadResources();
    if (resources.length === 0) {
      return {
        content: [{ type: 'text', text: 'No resource data indexed yet.\n\nRun: npx tsx crawl-site.ts --resources' }],
      };
    }

    const queryLower = query.toLowerCase();
    const terms = queryLower.split(/\s+/).filter(Boolean);

    let filtered = resources.filter(r => {
      const searchable = `${r.title} ${r.description} ${r.type}`.toLowerCase();
      return terms.some(t => searchable.includes(t));
    });

    if (type) {
      const typeLower = type.toLowerCase();
      filtered = filtered.filter(r => r.type.toLowerCase().includes(typeLower));
    }

    const results = filtered.slice(0, limit);

    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `No resources found matching "${query}"${type ? ` of type "${type}"` : ''}. Total indexed: ${resources.length} resources.` }],
      };
    }

    const text = results
      .map((r, i) => `**[${i + 1}] ${r.title}**${r.type ? `\nType: ${r.type}` : ''}\n${r.description ? `${r.description}\n` : ''}URL: ${r.url}`)
      .join('\n\n');

    const resourceData = { results, total: resources.length };
    return {
      content: [{ type: 'text', text: `Found ${results.length} matches (${resources.length} total resources):\n\n${text}\n\n\`\`\`json\n${JSON.stringify(resourceData, null, 2)}\n\`\`\`` }],
    };
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.env.MCP_TRANSPORT === 'http') {
    const port = parseInt(process.env.PORT || '3000');
    const transports = new Map<string, SSEServerTransport>();

    const httpServer = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url!, `http://localhost:${port}`);

        if (reqUrl.pathname === '/mcp') {
          if (req.method === 'GET') {
            // Close previous transport to allow single-session reconnection
            // without calling server.close() (which would disrupt all sessions)
            for (const t of transports.values()) {
              try { await t.close(); } catch { /* already closed */ }
            }
            transports.clear();

            // DNS rebinding protection is disabled (default) — this server
            // is intended for localhost/private network use only.
            const transport = new SSEServerTransport('/mcp', res);
            transports.set(transport.sessionId, transport);

            // Send SSE keepalive comments every 30s to prevent proxy timeouts
            const keepalive = setInterval(() => {
              if (!res.destroyed) res.write(': keepalive\n\n');
            }, 30_000);
            res.on('close', () => {
              clearInterval(keepalive);
              transports.delete(transport.sessionId);
            });

            await server.connect(transport);
          } else if (req.method === 'POST') {
            const sessionId = reqUrl.searchParams.get('sessionId') ?? '';
            const transport = transports.get(sessionId);
            if (transport) {
              await transport.handlePostMessage(req, res);
            } else {
              res.writeHead(400).end('Unknown session');
            }
          } else {
            res.writeHead(405).end();
          }
        } else {
          res.writeHead(404).end();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Request error:', msg);
        if (!res.headersSent) res.writeHead(500).end(msg);
      }
    });

    httpServer.listen(port, () => {
      console.error(`Rapid7 Docs MCP server running (SSE on port ${port})`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Rapid7 Docs MCP server running (stdio)');
  }
}

main().catch(err => {
  console.error('Server error:', err);
  process.exit(1);
});
