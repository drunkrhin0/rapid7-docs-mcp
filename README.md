# Rapid7 Docs MCP Server

Reference docs.rapid7.com directly from Claude. Crawls the docs site into local markdown files, then serves them via MCP so Claude can search and read them on demand.

## How it works

```
docs.rapid7.com → crawl.ts → /docs/*.md → MCP server → Claude
```

1. **Crawler** scrapes Rapid7 docs, converts HTML → markdown, preserves image URLs
2. **MCP server** exposes three tools: `docs_search`, `docs_read`, `docs_list`
3. **Claude Desktop** connects via stdio — Claude calls the tools naturally during conversation

---

## Setup

### 1. Install dependencies

```bash
cd rapid7-docs-mcp
npm install
```

### 2. Crawl the docs

```bash
# Crawl a single product section (recommended for first run)
npm run crawl -- --section insightidr

# Crawl all sections (takes a while, ~2000 pages)
npm run crawl

# See available sections
npm run crawl -- --list

# Crawl a specific path
npm run crawl -- --url /insightidr/docs/log-sources/
```

Available sections: `insightidr`, `insightvm`, `insightappsec`, `insightconnect`, `insightagent`, `metasploit`, `nexpose`, `appspider`, `tcell`, `velociraptor`

### 3. Build the MCP server

```bash
npm run build
```

### 4. Connect to Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "rapid7-docs": {
      "command": "node",
      "args": ["/absolute/path/to/rapid7-docs-mcp/dist/index.js"]
    }
  }
}
```

On Linux (homelab), the config is at `~/.config/Claude/claude_desktop_config.json`.

Restart Claude Desktop — you'll see the 🔌 icon indicating MCP tools are active.

---

## Tools exposed to Claude

| Tool | Description |
|------|-------------|
| `docs_list` | See what's indexed and when it was last crawled |
| `docs_search` | Full-text search with section filtering and ranked results |
| `docs_read` | Read full content of any indexed page |

### Example prompts that trigger the tools

- *"Check the InsightIDR docs for how to set up a DHCP sensor"*
- *"What does Rapid7 say about the InsightVM API authentication?"*
- *"Find me the log aggregation configuration page for InsightIDR"*

---

## Keeping docs fresh

Run the crawler on a schedule to keep docs current:

```bash
# Add to crontab — recrawl InsightIDR every night at 2AM
0 2 * * * cd /path/to/rapid7-docs-mcp && npm run crawl -- --section insightidr
```

Or just re-run manually before a big project.

---

## Notes

- **Images**: Live absolute URLs are preserved in markdown. Claude can reference them directly.
- **Rate limiting**: Crawler defaults to 500ms between requests to be polite.
- **Storage**: Expect ~50-200MB for a full crawl depending on sections.
- **No RAG needed**: Claude handles semantic understanding — local search just finds candidate pages.
