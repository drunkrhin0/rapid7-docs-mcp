# Graph Report - rapid7-docs-mcp  (2026-06-19)

## Corpus Check
- 29 files · ~24,031 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 325 nodes · 503 edges · 20 communities (18 shown, 2 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 37 edges (avg confidence: 0.61)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `88894ce1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Extensions Crawler|Extensions Crawler]]
- [[_COMMUNITY_MCP Server Entry & Tools|MCP Server Entry & Tools]]
- [[_COMMUNITY_Project Architecture & Concepts|Project Architecture & Concepts]]
- [[_COMMUNITY_Stemmer & Text Processing|Stemmer & Text Processing]]
- [[_COMMUNITY_NPM Dependencies|NPM Dependencies]]
- [[_COMMUNITY_Site Crawler|Site Crawler]]
- [[_COMMUNITY_Test Suite|Test Suite]]
- [[_COMMUNITY_Middleware & Auth|Middleware & Auth]]
- [[_COMMUNITY_Docs Crawler|Docs Crawler]]
- [[_COMMUNITY_TypeScript Configuration|TypeScript Configuration]]
- [[_COMMUNITY_CICD & Code Quality|CI/CD & Code Quality]]
- [[_COMMUNITY_Renovate Config|Renovate Config]]
- [[_COMMUNITY_Docker Entrypoint|Docker Entrypoint]]
- [[_COMMUNITY_Document Conventions|Document Conventions]]
- [[_COMMUNITY_Image Tags|Image Tags]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]

## God Nodes (most connected - your core abstractions)
1. `stem()` - 20 edges
2. `TestStem` - 16 edges
3. `RateLimitMiddleware` - 13 edges
4. `search_docs()` - 11 edges
5. `crawlSection()` - 10 edges
6. `MiddlewareContext` - 10 edges
7. `CallNext` - 10 edges
8. `updateIndex()` - 10 edges
9. `compilerOptions` - 10 edges
10. `Rapid7 Docs MCP Server Project` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Manual Crawl Commands` --references--> `Crawl Pipeline`  [INFERRED]
  README.md → AGENTS.md
- `processExtension()` --calls--> `sleep()`  [EXTRACTED]
  crawl-extensions.ts → src/crawl-utils.ts
- `crawlSection()` --calls--> `ensureDir()`  [EXTRACTED]
  crawl.ts → src/crawl-utils.ts
- `crawlSection()` --calls--> `sleep()`  [EXTRACTED]
  crawl.ts → src/crawl-utils.ts
- `crawlSection()` --calls--> `updateIndex()`  [EXTRACTED]
  crawl.ts → src/crawl-utils.ts

## Import Cycles
- None detected.

## Communities (20 total, 2 thin omitted)

### Community 0 - "Extensions Crawler"
Cohesion: 0.08
Nodes (47): APIResponse, buildMarkdown(), buildToolkitMarkdown(), buildToolkitsIndexMarkdown(), CONCURRENCY, crawlAllExtensions(), crawlSingleExtension(), crawlToolkits() (+39 more)

### Community 1 - "MCP Server Entry & Tools"
Cohesion: 0.09
Nodes (33): Rapid7 Docs MCP Server — FastMCP edition., docs_list(), docs_read(), docs_search(), get_product_knowledge(), main(), Rapid7 Docs MCP Server — FastMCP edition.  Tools:   docs_search            — Ful, search_blog() (+25 more)

### Community 2 - "Project Architecture & Concepts"
Cohesion: 0.07
Nodes (35): Auth Middleware Stack, CRAWL_EXTERNAL Flag for GitHub/OpenAPI, Crawl Pipeline, Cron-Scheduled Re-Crawls, Docs Crawler with Domain Routing, First Boot Takes 10-30 Minutes, Health Endpoint on Port 8001, MCP Server for Rapid7 Documentation (+27 more)

### Community 3 - "Stemmer & Text Processing"
Cohesion: 0.10
Nodes (9): Stemmer, stop words, and tokenizer — MUST match src/text.ts exactly.  These func, Tokenize text into lowercase alphanumeric tokens >= 2 chars., Simple suffix-stripping stemmer for English technical documentation.     Must pr, stem(), tokenize(), Verify Python stemmer produces identical output to TypeScript stemmer in src/tex, TestStem, TestStopWords (+1 more)

### Community 4 - "NPM Dependencies"
Cohesion: 0.08
Nodes (23): dependencies, axios, cheerio, js-yaml, tsx, turndown, description, devDependencies (+15 more)

### Community 5 - "Site Crawler"
Cohesion: 0.15
Nodes (22): BlogPost, crawlBlog(), crawlProducts(), crawlResources(), DATA_DIR, DELAY_MS, extractJsonLdFaqs(), extractMainContent() (+14 more)

### Community 6 - "Test Suite"
Cohesion: 0.07
Nodes (9): Path, mock_data(), Search engine tests using mock crawl data.  Creates temporary docs/ and data/ di, Set up a mock docs/ and data/ directory with sample crawl output., TestBlogSearch, TestDocReader, TestProducts, TestResourcesSearch (+1 more)

### Community 7 - "Middleware & Auth"
Cohesion: 0.22
Nodes (14): Middleware, AuthMiddleware, HealthHandler, CallNext, MiddlewareContext, Simple health check handler. Returns index status and crawl freshness., Simple API key middleware for FastMCP., Any (+6 more)

### Community 8 - "Docs Crawler"
Cohesion: 0.18
Nodes (16): cleanStaleFiles(), crawlByUrl(), crawlMadCapSection(), crawlSection(), DELAY_MS, discoverProducts(), fetchJsonSpec(), fetchPage() (+8 more)

### Community 9 - "TypeScript Configuration"
Cohesion: 0.15
Nodes (12): compilerOptions, esModuleInterop, module, moduleResolution, outDir, resolveJsonModule, rootDir, skipLibCheck (+4 more)

### Community 10 - "CI/CD & Code Quality"
Cohesion: 0.22
Nodes (9): TypeScript ESM Import Convention (.js extension), Python Package Import Convention, Stemmer/Stop-Word Parity Between TypeScript and Python, Dependency Vulnerability Job, Trivy Docker Scan Job, Lint Jobs (Dockerfile, Python, TypeScript), PR Checks Workflow, CodeQL SAST Job (+1 more)

### Community 11 - "Renovate Config"
Cohesion: 0.40
Nodes (4): extends, labels, packageRules, $schema

### Community 12 - "Docker Entrypoint"
Cohesion: 0.83
Nodes (3): CRON_ENTRIES(), INITIAL_CRAWL(), docker-entrypoint.sh script

### Community 18 - "Community 18"
Cohesion: 0.25
Nodes (6): Architecture, Conventions, Gotchas, Graphify, Project overview, Running and testing

### Community 19 - "Community 19"
Cohesion: 0.25
Nodes (7): Authentication (optional), Configuration, How it works, Manual crawls, Quick Start, Rapid7 Docs MCP Server, Tools

## Knowledge Gaps
- **95 isolated node(s):** `$schema`, `extends`, `labels`, `packageRules`, `EXTENSIONS_DIR` (+90 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Path` connect `Test Suite` to `Docs Crawler`, `Extensions Crawler`, `Site Crawler`?**
  _High betweenness centrality (0.225) - this node is a cross-community bridge._
- **Why does `stem()` connect `Stemmer & Text Processing` to `MCP Server Entry & Tools`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `RateLimitMiddleware` (e.g. with `AuthMiddleware` and `HealthHandler`) actually correct?**
  _`RateLimitMiddleware` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `extends`, `labels` to the rest of the system?**
  _121 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Extensions Crawler` be split into smaller, more focused modules?**
  _Cohesion score 0.07692307692307693 - nodes in this community are weakly interconnected._
- **Should `MCP Server Entry & Tools` be split into smaller, more focused modules?**
  _Cohesion score 0.08974358974358974 - nodes in this community are weakly interconnected._
- **Should `Project Architecture & Concepts` be split into smaller, more focused modules?**
  _Cohesion score 0.07226890756302522 - nodes in this community are weakly interconnected._