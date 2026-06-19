# Project Architecture & Concepts

> 35 nodes

## Key Concepts

- **Rapid7 Docs MCP Server Project** (10 connections) — `README.md`
- **Two-Service Docker Model** (7 connections) — `AGENTS.md`
- **Six MCP Search Tools** (7 connections) — `README.md`
- **Crawl Pipeline** (5 connections) — `AGENTS.md`
- **MCP Server for Rapid7 Documentation** (4 connections) — `AGENTS.md`
- **Environment Variable Configuration** (4 connections) — `README.md`
- **Search Design with Inverted Index** (3 connections) — `AGENTS.md`
- **Cron-Scheduled Re-Crawls** (3 connections) — `AGENTS.md`
- **Streamable HTTP Transport on Port 8002** (3 connections) — `README.md`
- **SSE Transport on Port 8004** (3 connections) — `README.md`
- **MCP_API_KEYS Authentication** (3 connections) — `README.md`
- **mcp-server Service Definition** (3 connections) — `docker-compose.yml`
- **Docker Publish CI Workflow** (3 connections) — `.github/workflows/docker-publish.yml`
- **Auth Middleware Stack** (2 connections) — `AGENTS.md`
- **Health Endpoint on Port 8001** (2 connections) — `AGENTS.md`
- **Shared Volume Contract (docs_data, site_data)** (2 connections) — `AGENTS.md`
- **docs_search Tool** (2 connections) — `README.md`
- **Manual Crawl Commands** (2 connections) — `README.md`
- **GHCR Pre-Built Docker Images** (2 connections) — `README.md`
- **crawler Service Definition** (2 connections) — `docker-compose.yml`
- **First Boot Takes 10-30 Minutes** (1 connections) — `AGENTS.md`
- **CRAWL_EXTERNAL Flag for GitHub/OpenAPI** (1 connections) — `AGENTS.md`
- **Docs Crawler with Domain Routing** (1 connections) — `AGENTS.md`
- **SSE Transport Health Endpoint Limitation** (1 connections) — `AGENTS.md`
- **FastMCP Framework** (1 connections) — `README.md`
- *... and 10 more nodes in this community*

## Relationships

- [[CI/CD & Code Quality]] (1 shared connections)

## Source Files

- `.github/workflows/docker-publish.yml`
- `.github/workflows/main.yml`
- `.github/workflows/nightly.yml`
- `AGENTS.md`
- `README.md`
- `docker-compose.yml`

## Audit Trail

- EXTRACTED: 67 (77%)
- INFERRED: 20 (23%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*