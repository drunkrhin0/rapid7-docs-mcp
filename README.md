# Rapid7 Docs MCP Server

Search Rapid7 documentation, product info, blog posts, and resources from any MCP-compatible AI client. Self-hostable, authenticated, runs in Docker.

Built on [FastMCP](https://gofastmcp.com). Uses **Streamable HTTP** — the modern MCP transport. No long-lived SSE connections required.

> Disclaimer: Vibe coded with Claude Code and Opencode. Created in personal time and is not officially supported or associated with Rapid7 and only uses public resources. Use at your own risk. Do not approach Rapid7 for support or issues regarding this project. Please open an issue instead.

## Quick Start

**Option 1: GHCR pre-built images**

```bash
curl -O https://raw.githubusercontent.com/drunkrhin0/rapid7-docs-mcp/main/docker-compose.yml
echo 'IMAGE_REGISTRY=ghcr.io/drunkrhin0/' > .env
docker compose pull
docker compose up -d
```

**Option 2: Build from source**

```bash
git clone https://github.com/drunkrhin0/rapid7-docs-mcp
cd rapid7-docs-mcp
docker compose up -d
```

On first boot, the crawler indexes ~2,000 docs pages (10–30 min). After that, starts instantly. Data persists in Docker volumes. Cron keeps it fresh.

Connect any MCP client to: **`http://localhost:8000/mcp`**

## How it works

Two containers sharing two volumes:

| Container | What it does |
|-----------|-------------|
| **crawler** (Node.js) | Scrapes docs.rapid7.com, documentation.rapid7.com, extensions.rapid7.com, rapid7.com → markdown + JSON indexes |
| **mcp-server** (Python/FastMCP) | Serves 6 search tools via Streamable HTTP with optional API key auth |

## Tools

| Tool | Description |
|------|-------------|
| `docs_search` | Full-text search with ranked results and snippets |
| `docs_read` | Read a page by path or URL |
| `docs_list` | Browse sections and page counts |
| `get_product_knowledge` | Product marketing, features, pricing, FAQs |
| `search_blog` | Search 3,600+ blog posts by keyword and category |
| `search_resources` | Search whitepapers, reports, guides |

## Authentication (optional)

Set `MCP_API_KEYS` in `.env` to require API keys. Omit for open access.

```bash
MCP_API_KEYS=key1,key2,key3
```

OAuth providers (Auth0, Google, GitHub, etc.) supported via [FastMCP auth docs](https://gofastmcp.com).

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_PORT` | `8000` | Server port |
| `MCP_API_KEYS` | *(open)* | Comma-separated API keys |
| `MCP_RATE_LIMIT` | `60` | Requests/min per key |
| `CRAWL_SECTIONS` | *(all)* | Space-separated section list |
| `CRAWL_SCHEDULE` | `0 2 * * *` | Docs crawl cron |
| `CRAWL_EXTENSIONS` | `true` | Crawl extensions site |
| `CRAWL_SITE` | `true` | Crawl products, blog, resources |
| `CRAWL_EXTERNAL` | `false` | Crawl GitHub + OpenAPI specs |
| `TZ` | `UTC` | Cron timezone |

Full env var reference: `docker-compose.yml`.

## Manual crawls

```bash
docker compose run --rm crawler npm run crawl                    # all docs
docker compose run --rm crawler npm run crawl -- --section insightidr  # one section
docker compose run --rm crawler npm run crawl:extensions         # extensions
docker compose run --rm crawler npm run crawl:site               # products, blog, resources
docker compose run --rm crawler npm run crawl:external -- --insightvm-api  # OpenAPI specs
```

Run `npm run crawl -- --list` inside the container to see available sections.

<details>
<summary>Full crawl CLI reference</summary>

**Docs:** `crawl -- --section insightidr | --url <url> | --list | --verbose`

**Site:** `crawl:site -- --products | --blog | --resources | --product command`

**External:** `crawl:external -- --metasploit | --velociraptor | --insightvm-api | --insightvm-cloud-api | --insightappsec-api | --insightidr-api | --insight-account-api | --credential-api | --insightconnect-api | --insightidr-detection-api`

GitHub sources (Metasploit wiki, Velociraptor docs) fetched as markdown. OpenAPI specs split into one file per tag. Set `GITHUB_TOKEN` for higher API rate limits.

> Cannot crawl: Threat Command / DRP API (requires authentication).

</details>
