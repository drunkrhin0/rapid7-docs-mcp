#!/usr/bin/env node
/**
 * Rapid7 Docs MCP Server
 * Exposes crawled Rapid7 documentation as MCP tools for Claude.
 *
 * Transport: stdio (for Claude Desktop)
 *
 * Tools:
 *   - docs_search   : Full-text search across all crawled docs
 *   - docs_read     : Read a specific doc page by path or URL
 *   - docs_list     : List available sections and page counts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

// ─── Config ──────────────────────────────────────────────────────────────────

const DOCS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'docs');
const INDEX_FILE = path.join(DOCS_DIR, 'index.json');
const MAX_RESULTS = 20;
const SNIPPET_CHARS = 300;

// ─── Types ────────────────────────────────────────────────────────────────────

interface IndexEntry {
  path: string;
  title: string;
  url: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadIndex(): IndexEntry[] {
  if (!fs.existsSync(INDEX_FILE)) return [];
  return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8')) as IndexEntry[];
}

function readDoc(relativePath: string): string | null {
  const fullPath = path.join(DOCS_DIR, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf-8');
}

function extractSnippet(content: string, query: string): string {
  const lower = content.toLowerCase();
  const queryLower = query.toLowerCase();
  const idx = lower.indexOf(queryLower);
  if (idx === -1) return content.slice(0, SNIPPET_CHARS) + '...';

  const start = Math.max(0, idx - 100);
  const end = Math.min(content.length, idx + query.length + 200);
  return (start > 0 ? '...' : '') + content.slice(start, end) + (end < content.length ? '...' : '');
}

function searchDocs(query: string, section?: string): Array<{ entry: IndexEntry; snippet: string; score: number }> {
  const index = loadIndex();
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results: Array<{ entry: IndexEntry; snippet: string; score: number }> = [];

  for (const entry of index) {
    // Section filter
    if (section && !entry.path.startsWith(section)) continue;

    const content = readDoc(entry.path);
    if (!content) continue;

    const lowerContent = content.toLowerCase();
    const lowerTitle = entry.title.toLowerCase();

    // Score: title matches worth more than body matches
    let score = 0;
    for (const term of queryTerms) {
      if (lowerTitle.includes(term)) score += 10;
      const bodyMatches = (lowerContent.match(new RegExp(term, 'g')) || []).length;
      score += bodyMatches;
    }

    if (score > 0) {
      results.push({
        entry,
        snippet: extractSnippet(content, query),
        score,
      });
    }
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
  - "What CVSS scoring does InsightVM use?" -> query="CVSS scoring", section="insightvm"`,
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
      content: [{ type: 'text', text }],
      structuredContent: { results: output },
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
Images are preserved as absolute URLs pointing to docs.rapid7.com.

Args:
  - path (string): Relative file path from docs_search results e.g. "insightidr/docs/log-sources.md"
                   OR a docs.rapid7.com URL

Returns:
  Full markdown content of the page including frontmatter with source URL.`,
    inputSchema: z.object({
      path: z.string().describe('Relative file path from search results, or a docs.rapid7.com URL'),
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
    description: `List all crawled Rapid7 documentation sections and their page counts.
Also shows when docs were last crawled.

Use this to understand what's available before searching, or to check if a section has been indexed.

Returns:
  Object with section names as keys and page counts as values, plus total pages and index date.`,
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const sections = getSections();
    const total = Object.values(sections).reduce((a, b) => a + b, 0);
    const indexStat = fs.existsSync(INDEX_FILE) ? fs.statSync(INDEX_FILE) : null;
    const lastCrawled = indexStat ? indexStat.mtime.toISOString() : 'Never';

    if (total === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No docs indexed yet.\n\nRun the crawler:\n  npm run crawl                     # all sections\n  npm run crawl:section insightidr  # one section',
        }],
      };
    }

    const sectionText = Object.entries(sections)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `  ${name.padEnd(25)} ${count} pages`)
      .join('\n');

    return {
      content: [{
        type: 'text',
        text: `**Rapid7 Docs Index**\nLast crawled: ${lastCrawled}\nTotal pages: ${total}\n\n**Sections:**\n${sectionText}`,
      }],
      structuredContent: { sections, total, lastCrawled },
    };
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Rapid7 Docs MCP server running (stdio)');
}

main().catch(err => {
  console.error('Server error:', err);
  process.exit(1);
});
