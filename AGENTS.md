# AGENTS.md

## Project overview

An MCP server that makes Rapid7's public documentation, blog posts, product pages, and resources searchable from any MCP-compatible AI client. A Node.js crawler scrapes rapid7.com domains into local markdown and builds a full-text inverted index, while a Python FastMCP server exposes six search/read tools over Streamable HTTP (with optional SSE fallback). Everything runs in Docker with cron-scheduled re-crawls.

## Running and testing

```bash
# Start everything (crawler + MCP server)
docker compose up -d

# SSE endpoint for legacy clients
docker compose --profile sse up -d

# Manual re-crawl
docker compose run --rm crawler npm run crawl
docker compose run --rm crawler npm run crawl -- --section insightidr

# Run TypeScript tests
docker compose run --rm crawler npm test

# Run Python tests
cd server && pip install -e .[dev] && pytest
```

## Architecture

**Two-service Docker model**: `crawler` (Node.js) writes markdown + JSON indexes to shared volumes (`docs_data`, `site_data`). `mcp-server` (Python/FastMCP) reads those volumes read-only. They never communicate directly — the volumes are the contract.

**Crawl pipeline**: Four independent crawlers (`crawl.ts` for docs, `crawl-extensions.ts`, `crawl-site.ts`, `crawl-external.ts`) each write to distinct directories under `docs/` or `data/`. The docs crawler routes by domain — `documentation.rapid7.com` pages use sitemap-seeded crawling, `docs.rapid7.com` uses one-page-at-a-time breadth-first link discovery, and `help.rapid7.com` follows API doc link trees.

**Search design**: The crawler builds an inverted index (`search-index.json`) mapping stemmed terms to document IDs. The Python server loads this at query time (with mtime-based cache invalidation) and falls back to a full-scan if the index doesn't exist yet. Both sides use an identical stemmer/stop-word list — divergence between `src/text.ts` and `server/text.py` breaks search.

**Auth middleware**: FastMCP middleware stack: `AuthMiddleware` (API key check, disabled when `MCP_API_KEYS` is empty) → `RateLimitMiddleware` (token bucket per key, default 60 req/min).

## Conventions

- **Shared text logic**: `stem()` and `tokenize()` exist in both `src/text.ts` (crawler) and `server/text.py` (server). They must stay byte-for-byte identical. Any change to one requires the mirror change in the other, followed by a full re-crawl (`npm run crawl`) to rebuild the search index.
- **TypeScript imports use `.js` extensions**: The project is ESM (`"type": "module"`), so local imports end in `.js` (e.g., `import { stem } from './text.js'`).
- **Markdown files include YAML frontmatter** with `title` and `url` fields. The search engine strips frontmatter before indexing/scoring so hashes and dates don't pollute results.
- **URL-to-path lookup**: `docs_read` accepts a live URL and resolves it to a file path by scanning `index.json`. No HTTP requests at search time — everything is local.
- **Health endpoint**: A bare `http.server` on port 8001 (not part of FastMCP) serves `/health` (JSON status of the index) and `/metrics` (placeholder). This lets Docker healthchecks and load balancers probe without hitting the MCP endpoint.
- **Cron in the crawler container**: `docker-entrypoint.sh` runs an initial crawl if no index exists, then schedules re-crawls via `crond`. The MCP server container has no cron — it just reads the shared volumes.

## Gotchas

- **First boot takes 10–30 minutes**: The crawler indexes ~2,000 pages on first run. MCP tools return "run the crawler first" messages during this window. Health endpoint returns 503.
- **Stemmer parity is critical**: If `server/text.py` and `src/text.ts` diverge (even in stop-word casing or suffix order), queries stop matching indexed documents. Run `npm test && cd server && pytest` after touching either file.
- **`CRAWL_EXTERNAL` is off by default**: GitHub wiki/OpenAPI crawling requires a `GITHUB_TOKEN` env var for rate limits. Enable with `CRAWL_EXTERNAL=true`.
- **Volumes must match**: Both services mount the same named volumes (`docs_data`, `site_data`). If one container uses a bind mount or a different volume name, the server sees empty data.
- **Python imports use the package**: Tests run with `PYTHONPATH` pointing at the repo root, so imports use `from server.search import ...`. Running `python server/mcp_server.py` directly fails — use `python -m server.mcp_server` instead (as the Dockerfile does).
- **SSE transport doesn't support health endpoint**: The `mcp-server-sse` container runs only FastMCP on port 8000 — no separate health port. Only the Streamable HTTP variant (`mcp-server`) exposes both MCP (8000) and health (8001).

## CI

The Forgejo Actions workflows live in `.forgejo/workflows/`. The dockhand self-hosted runner has labels `docker`, `ubuntu-latest`, `ubuntu-22.04`. **`runs-on: docker` is broken on this runner** — it tries to use the project's `Dockerfile` as the job image and fails on `docker-entrypoint.sh`. Always use `runs-on: ubuntu-22.04` for jobs that need real toolchains.

After editing any file under `.forgejo/workflows/` or `.github/workflows/`, run `./scripts/ci-local.sh` before pushing. It uses `act` with the same `ghcr.io/catthehacker/ubuntu:act-latest` image as the runner, so it produces the same errors locally without the push-and-wait cycle. Forgejo 1.22 has no `actions/runs/{id}/logs` API, so the script is the only fast way to debug CI failures.

See `doubt/cicd-versioning-releases.md` for the full runner-notes section.


