# Rapid7 Docs MCP Server

An MCP server that crawls Rapid7 documentation, extensions, product pages, blog, and resources — then exposes them as tools for any MCP-compatible AI client. This was created to improve my MCP knowledge and make searching public facing information easier.

Use Claude if you're sensible, otherwise use the full stack deployment for privacy.

Disclaimer: Vibe coded with Claude Code Opus 4.6. This was created in personal time and is not officially supported or associated with Rapid7 and only uses public resources. Use at your own risk.

## How it works

```
docs.rapid7.com        ──┐
extensions.rapid7.com  ──┼── crawlers ──► docs/ & data/ ──► MCP server ──► Claude/Ollama
rapid7.com/products    ──┘
```

Four crawlers build a local knowledge base:
- **`crawl.ts`** — [technical documentation](https://docs.rapid7.com)
- **`crawl-extensions.ts`** — [extensions site](https://extensions.rapid7.com) (including toolkits)
- **`crawl-site.ts`** — [base site](https://rapid7.com) (feature comparison tables, blog index, resources)
- **`crawl-external.ts`** — GitHub docs + public OpenAPI/Swagger specs (Metasploit wiki, Velociraptor, all product APIs)

The MCP server reads from `docs/` and `data/` at query time — no database required.

---

## Tools

| Tool | Description |
|------|-------------|
| `docs_search` | Full-text search across all crawled documentation with ranked results |
| `docs_read` | Read the full content of any indexed documentation page |
| `docs_list` | List available sections and page counts |
| `get_product_knowledge` | Marketing content, pricing tiers, and FAQs for a Rapid7 product |
| `search_blog` | Search the Rapid7 blog index (3,600+ posts) by keyword and category |
| `search_resources` | Search whitepapers, reports, and guides |

---

## Setup

<details>
<summary><b>Option 1: Claude Desktop / Claude Code (local, stdio)</b></summary>
<br>

**Prerequisites:** Node.js 18+

```bash
npm install

# Crawl (pick what you need)
npm run crawl                           # docs — all sections (~2000 pages)
npm run crawl -- --section insightidr   # docs — single section
npm run crawl:extensions                # extensions & toolkits
npm run crawl:site                      # products, blog, resources

# Build
npm run build
```

Add the server to your MCP config:

| Client | Config file |
|--------|-------------|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Code (per-project) | `.mcp.json` in project root |
| Claude Code (global) | `~/.claude.json` |

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

Restart Claude Desktop or start a new Claude Code session — the tools will become available.

</details>

<details>
<summary><b>Option 2: Docker + Open WebUI + Ollama (full stack)</b></summary>
<br>

Self-contained AI assistant with a web UI, local LLM, and Rapid7 docs tools. Runs entirely on your machine — no data leaves your network.

```
Ollama (native, GPU) ◄── Open WebUI (:8080) ──► MCPO (:8300) ──► MCP Server (:7000)
                          (chat UI)              (proxy)          (docs tools)
```

**Prerequisites:**

```bash
# Install Ollama natively (GPU-accelerated on Apple Silicon / NVIDIA)
brew install ollama && ollama serve

# Pull a model with tool-calling support
ollama pull qwen2.5
```

> Ollama must run natively (not in Docker) to use GPU acceleration on macOS. Docker on Mac is CPU-only.

**Start the stack:**

```bash
ollama serve #if not already done
docker compose -f docker-compose.ollama.yml up -d
```

Open `http://localhost:8080`, create an account, and select `qwen2.5` (or any tool-calling model). The Rapid7 docs tools are auto-registered via MCPO.

The compose file bind-mounts `./docs` and `./data` from the repo. If you've already crawled data locally, it's available instantly — no re-crawl needed. If the directories are empty, the MCP server will crawl on first boot.

**Tool-calling models:** `qwen2.5`, `llama3.1`, `mistral`, `command-r`

If the tools don't auto-register, add them manually: **Settings > Tools > +** → `http://mcpo:8300` with OpenAPI path `openapi.json`.

</details>

<details>
<summary><b>Option 3: Docker (standalone MCP server)</b></summary>
<br>

Runs the MCP server over HTTP/SSE. Useful for connecting from remote clients or shared environments. Crawls on first boot and on a cron schedule.

```bash
docker build -t rapid7-docs-mcp .
docker compose up -d
```

SSE endpoint: `http://localhost:7000/mcp`

If you've already crawled data locally, bind-mount it to skip the initial crawl — edit `docker-compose.yml` and replace the named volumes with:

```yaml
volumes:
  - ./docs:/app/docs
  - ./data:/app/data
```

</details>

<details>
<summary><b>Environment variables (Docker)</b></summary>
<br>

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `stdio` | Set to `http` for SSE transport |
| `PORT` | `3000` | HTTP server port (when `MCP_TRANSPORT=http`) |
| `CRAWL_SECTIONS` | *(empty = all)* | Space-separated list of doc sections to crawl |
| `CRAWL_SCHEDULE` | `0 2 * * *` | Cron schedule for docs crawl |
| `CRAWL_DELAY_MS` | `0` | Milliseconds between requests |
| `CRAWL_EXTENSIONS` | `true` | Enable extensions crawl |
| `EXTENSIONS_CRAWL_SCHEDULE` | `0 3 * * 0` | Cron schedule for extensions crawl |
| `CRAWL_SITE` | `true` | Enable site crawl (products/blog/resources) |
| `SITE_CRAWL_SCHEDULE` | `0 4 * * 0` | Cron schedule for site crawl |
| `CRAWL_EXTERNAL` | `false` | Enable external crawl (GitHub sources + OpenAPI specs) |
| `EXTERNAL_CRAWL_SCHEDULE` | `0 5 * * 0` | Cron schedule for external crawl |
| `TZ` | `UTC` | Timezone for cron schedules |

</details>

<details>
<summary><b>Crawling reference</b></summary>
<br>

All crawlers support incremental updates — unchanged pages are skipped using content hashing. Pages not seen for 14 days are automatically removed.

**Documentation (docs.rapid7.com):**

```bash
npm run crawl                          # all sections
npm run crawl -- --section insightidr  # single section
npm run crawl -- --list                # list available sections
npm run crawl -- --verbose             # per-page output
```

Available sections: `insightidr`, `insightvm`, `insightappsec`, `insightconnect`, `insightagent`, `insightcloudsec`, `metasploit`, `nexpose`, `appspider`, `insightops`, `threat-command`, `surface-command`

**Extensions (extensions.rapid7.com):**

```bash
npm run crawl:extensions
```

**Site content (rapid7.com):**

```bash
npm run crawl:site                         # everything
npm run crawl:site -- --products           # product pages only
npm run crawl:site -- --blog               # blog index only
npm run crawl:site -- --resources          # resources only
npm run crawl:site -- --product command    # single product
```

Available products: `command`, `insightappsec`, `insightcloudsec`, `insightvm`, `metasploit`, `nexpose`, `siem`, `threat-command`, `velociraptor`

**External docs (GitHub + OpenAPI specs):**

```bash
npm run crawl:external                              # everything below

# GitHub sources
npm run crawl:external -- --metasploit              # Metasploit Framework wiki
npm run crawl:external -- --velociraptor            # Velociraptor docs (includes server API)

# OpenAPI / Swagger sources (one markdown file per tag, searchable via docs_search)
npm run crawl:external -- --insightvm-api           # InsightVM/Nexpose API v3 (207 endpoints)
npm run crawl:external -- --insightvm-cloud-api     # InsightVM Cloud Integrations API v4
npm run crawl:external -- --insightappsec-api       # InsightAppSec API v1
npm run crawl:external -- --insightidr-api          # InsightIDR (SIEM) API v1
npm run crawl:external -- --insight-account-api     # Insight Account API v1
npm run crawl:external -- --credential-api          # Platform Credential Management API
npm run crawl:external -- --insightconnect-api      # InsightConnect (SOAR) API v1

npm run crawl:external -- --verbose                 # per-file output for any of the above
```

**GitHub sources** (Metasploit, Velociraptor) — fetched directly as markdown from GitHub, no HTML conversion needed:
- Metasploit: `rapid7/metasploit-framework` — `docs/metasploit-framework.wiki/`
- Velociraptor: `Velocidex/velociraptor-docs` — `content/docs/` (includes server automation + API)

Set `GITHUB_TOKEN` env var for higher API rate limits (5000/hr vs 60/hr unauthenticated).

**OpenAPI sources** — each spec is fetched once and split into one markdown file per tag, stored under `docs/{section}/`. Searchable via `docs_search` with the matching `section` filter.

> **Already covered by `crawl.ts`:** Metasploit PRO REST + RPC API and the Command Platform API overview are regular pages on `docs.rapid7.com` — run `npm run crawl -- --section metasploit` and `npm run crawl -- --section insight` to index them.
>
> **Cannot crawl:** Threat Command / DRP API requires authentication.

</details>

<details>
<summary><b>Project structure</b></summary>
<br>

```
rapid7-docs-mcp/
  src/
    index.ts          # MCP server (6 tools)
    text.ts           # Shared stemmer, stop words, tokenizer
    crawl-utils.ts    # Shared crawl utilities
  crawl.ts            # Documentation crawler (docs.rapid7.com)
  crawl-extensions.ts # Extensions crawler (extensions.rapid7.com)
  crawl-site.ts       # Site content crawler (products/blog/resources)
  crawl-external.ts   # External docs crawler (GitHub sources + OpenAPI specs for all product APIs)
  docs/               # Crawled documentation markdown + indexes (gitignored)
  data/               # Crawled site content — products, blog, resources (gitignored)
  docker-compose.yml          # Standalone MCP server
  docker-compose.ollama.yml   # Full stack: MCP + MCPO + Open WebUI + Ollama
```

</details>
