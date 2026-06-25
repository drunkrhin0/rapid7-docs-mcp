---
type: community
members: 35
---

# Project Architecture & Concepts

**Members:** 35 nodes

## Members
- [[Auth Middleware Stack]] - concept - AGENTS.md
- [[Build and Push CI Workflow]] - document - .github/workflows/main.yml
- [[CRAWL_EXTERNAL Flag for GitHubOpenAPI]] - concept - AGENTS.md
- [[Crawl Pipeline]] - concept - AGENTS.md
- [[Cron-Scheduled Re-Crawls]] - concept - AGENTS.md
- [[Docker Publish CI Workflow]] - document - .github/workflows/docker-publish.yml
- [[Docker Shared Volumes (docs_data, site_data)]] - concept - docker-compose.yml
- [[Docs Crawler with Domain Routing]] - concept - AGENTS.md
- [[Environment Variable Configuration]] - concept - README.md
- [[FastMCP Framework]] - concept - README.md
- [[First Boot Takes 10-30 Minutes]] - rationale - AGENTS.md
- [[GHCR Pre-Built Docker Images]] - concept - README.md
- [[Health Endpoint on Port 8001]] - concept - AGENTS.md
- [[MCP Server for Rapid7 Documentation]] - concept - AGENTS.md
- [[MCP_API_KEYS Authentication]] - concept - README.md
- [[Manual Crawl Commands]] - concept - README.md
- [[Nightly Dependency and Smoke Test Workflow]] - document - .github/workflows/nightly.yml
- [[Rapid7 Docs MCP Server Project]] - document - README.md
- [[SSE Transport Health Endpoint Limitation]] - rationale - AGENTS.md
- [[SSE Transport on Port 8004]] - concept - README.md
- [[Search Design with Inverted Index]] - concept - AGENTS.md
- [[Shared Volume Contract (docs_data, site_data)]] - rationale - AGENTS.md
- [[Six MCP Search Tools]] - concept - README.md
- [[Streamable HTTP Transport on Port 8002]] - concept - README.md
- [[Two-Service Docker Model]] - concept - AGENTS.md
- [[Vibe Coded with Claude Code and Opencode]] - rationale - README.md
- [[crawler Service Definition]] - document - docker-compose.yml
- [[docs_list Tool]] - concept - README.md
- [[docs_read Tool]] - concept - README.md
- [[docs_search Tool]] - concept - README.md
- [[get_product_knowledge Tool]] - concept - README.md
- [[mcp-server Service Definition]] - document - docker-compose.yml
- [[mcp-server-sse Service Definition (SSE Profile)]] - document - docker-compose.yml
- [[search_blog Tool]] - concept - README.md
- [[search_resources Tool]] - concept - README.md

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Project_Architecture__Concepts
SORT file.name ASC
```

## Connections to other communities
- 1 edge to [[_COMMUNITY_CICD & Code Quality]]

## Top bridge nodes
- [[Search Design with Inverted Index]] - degree 3, connects to 1 community