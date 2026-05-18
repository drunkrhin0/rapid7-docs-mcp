# Rapid7 Docs MCP Server

An MCP server that crawls Rapid7 documentation, extensions, product pages, blog, and resources — then exposes them as tools for any MCP-compatible AI client.

Built on [FastMCP](https://gofastmcp.com) with authentication, rate limiting, and a health endpoint. The MCP server runs as a Streamable HTTP service; crawlers run as a companion container. Everything ships as a single `docker compose up`.

Disclaimers: Vibe coded with Claude Code. Created in personal time and is not officially supported or associated with Rapid7 and only uses public resources. Use at your own risk.

## How it works

```
docs.rapid7.com              ──┐
documentation.rapid7.com     ──┤
extensions.rapid7.com        ──┼── crawlers (Node.js) ──► docs/ & data/ ──► FastMCP server (Python) ──► MCP clients
rapid7.com/products          ──┘                                                     │
                                                                                    ├── API key auth
                                                                                    ├── Rate limiting
                                                                                    └── /health
```

Two services in `docker-compose.yml`:

- **crawler** — Node.js container running four crawlers on a cron schedule and on first boot. Writes markdown files and JSON indexes to shared Docker volumes.
- **mcp-server** — Python/FastMCP container exposing 6 MCP tools via Streamable HTTP. Reads the crawl output from the same volumes.

Four crawlers build a local knowledge base:

- **`crawl.ts`** — [technical documentation](https://docs.rapid7.com) on both docs.rapid7.com and documentation.rapid7.com (auto-discovers products via homepage)
- **`crawl-extensions.ts`** — [extensions site](https://extensions.rapid7.com) (including toolkits)
- **`crawl-site.ts`** — [base site](https://rapid7.com) (feature comparison tables, blog index, resources)
- **`crawl-external.ts`** — GitHub docs + public OpenAPI/Swagger specs (Metasploit wiki, Velociraptor, all product APIs)

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

### Quick Start (Docker Compose)

**Prerequisites:** Docker + Docker Compose.

```bash
git clone https://github.com/<user>/rapid7-docs-mcp
cd rapid7-docs-mcp

# Start the stack (crawler + MCP server)
docker compose up -d
```

On first boot, the crawler indexes all Rapid7 documentation sections automatically (may take 10–30 minutes). Subsequent starts are instant — data persists in Docker volumes.

The MCP server is available at `http://localhost:8000/mcp`.

### Configure an MCP Client

Point your MCP client to the Streamable HTTP endpoint:

| Client | URL |
|--------|-----|
| Claude Desktop | `http://localhost:8000/mcp` |
| Claude Code | `http://localhost:8000/mcp` |
| Cursor | `http://localhost:8000/mcp` |
| Any MCP-compatible client | `http://<host>:8000/mcp` |

If you've set `MCP_API_KEYS`, add the API key to your client's transport config.

### Authentication

API key auth is optional. Set the `MCP_API_KEYS` environment variable to a comma-separated list of keys:

```bash
MCP_API_KEYS=key1,key2,key3 docker compose up -d
```

If unset, the server runs open (no auth) — useful for local development or trusted networks.

For OAuth (Auth0, Azure, Google, GitHub, etc.), FastMCP supports 15+ identity providers natively. Configure via `fastmcp.json` or environment variables — see the [FastMCP auth docs](https://gofastmcp.com).

### Health & Metrics

| Endpoint | Description |
|----------|-------------|
| `http://localhost:8001/health` | JSON status: `{"status":"healthy","pages_indexed":2048,"last_crawled":"..."}` |
| `http://localhost:8001/metrics` | Prometheus metrics (placeholder — add `prometheus_client` for full metrics) |

Returns HTTP 503 if no docs are indexed yet.

---

## Manual Crawl Triggers

Crawlers run on a cron schedule by default, but you can trigger them manually:

```bash
# Crawl all documentation sections
docker compose run --rm crawler npm run crawl

# Crawl a single section
docker compose run --rm crawler npm run crawl -- --section insightidr

# Crawl extensions
docker compose run --rm crawler npm run crawl:extensions

# Crawl site content (products, blog, resources)
docker compose run --rm crawler npm run crawl:site

# Crawl external docs (GitHub + OpenAPI specs)
docker compose run --rm crawler npm run crawl:external -- --insightvm-api
```

See the [crawling reference](#crawling-reference) below for full CLI options.

---

## Environment Variables

### MCP Server

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_PORT` | `8000` | MCP server port (Streamable HTTP) |
| `HEALTH_PORT` | `8001` | Health/metrics endpoint port |
| `MCP_API_KEYS` | *(empty = open)* | Comma-separated API keys for authentication |
| `MCP_RATE_LIMIT` | `60` | Max requests per minute per API key |

### Crawler

| Variable | Default | Description |
|----------|---------|-------------|
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

---

## Crawling Reference

All crawlers support incremental updates — unchanged pages are skipped using content hashing. Pages not seen for 14 days are automatically removed.

### Documentation (docs.rapid7.com + documentation.rapid7.com)

```bash
npm run crawl                          # all sections (auto-discovered from homepage)
npm run crawl -- --section insightidr  # single section
npm run crawl -- --url https://documentation.rapid7.com/incident-command/  # specific URL
npm run crawl -- --list                # list available sections (live from homepage)
npm run crawl -- --verbose             # per-page output
```

Run `npm run crawl -- --list` to see all available sections — products are auto-discovered from the `documentation.rapid7.com` homepage at runtime.

### Extensions (extensions.rapid7.com)

```bash
npm run crawl:extensions
```

### Site content (rapid7.com)

```bash
npm run crawl:site                         # everything
npm run crawl:site -- --products           # product pages only
npm run crawl:site -- --blog               # blog index only
npm run crawl:site -- --resources          # resources only
npm run crawl:site -- --product command    # single product
```

Available products: `command`, `insightappsec`, `insightcloudsec`, `insightvm`, `metasploit`, `nexpose`, `siem`, `threat-command`, `velociraptor`

### External docs (GitHub + OpenAPI specs)

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
npm run crawl:external -- --insightidr-detection-api # InsightIDR Detection Rules API v1

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

---

## Project Structure

```
rapid7-docs-mcp/
  server/                        # FastMCP server (Python)
    __init__.py
    mcp_server.py                # 6 MCP tools + auth + health endpoint
    search.py                    # Search engine (inverted index)
    text.py                      # Stemmer + tokenizer (identical to TypeScript)
    middleware.py                 # Rate limiter
    pyproject.toml               # Python dependencies
    Dockerfile
    tests/
      test_text.py               # Stemmer parity tests
      test_search.py             # Search engine tests
  crawl.ts                       # Documentation crawler
  crawl-extensions.ts            # Extensions crawler
  crawl-site.ts                  # Site content crawler
  crawl-external.ts              # External docs crawler
  src/
    text.ts                      # Stemmer (source of truth — used by crawlers)
    crawl-utils.ts               # Shared crawl utilities + search index builder
  tests/
    crawl.test.ts                # Crawler tests
  docker-compose.yml             # 2-service orchestration
  Dockerfile                     # Crawler container (Node.js)
  docker-entrypoint.sh           # Crawler entrypoint (cron)
  docs/                          # Crawled documentation (gitignored)
  data/                          # Crawled site content (gitignored)
```

---

## Security

- **API key authentication** — configurable via `MCP_API_KEYS`
- **Rate limiting** — configurable per API key via `MCP_RATE_LIMIT`
- **Path traversal protection** — `docs_read` cannot escape the docs directory
- **CodeQL** — static analysis on every PR (Python + TypeScript)
- **Trivy** — container image scanning for HIGH/CRITICAL CVEs
- **pip-audit + npm audit** — dependency vulnerability scanning on every PR
- **gitleaks** — pre-commit secret scanning
- **Dependabot** — weekly dependency updates for npm, pip, Docker, and GitHub Actions

CI/CD workflows: `.github/workflows/pr.yml` (lint, test, SAST, vuln scan), `.github/workflows/main.yml` (build & push), `.github/workflows/nightly.yml` (smoke test, CVE rescan).
