# Middleware & Auth

> 21 nodes

## Key Concepts

- **RateLimitMiddleware** (13 connections) — `server/middleware.py`
- **MiddlewareContext** (10 connections) — `server/middleware.py`
- **CallNext** (10 connections) — `server/middleware.py`
- **AuthMiddleware** (8 connections) — `server/mcp_server.py`
- **BlogPost** (8 connections) — `server/search.py`
- **HealthHandler** (7 connections) — `server/mcp_server.py`
- **MiddlewareContext** (5 connections) — `server/mcp_server.py`
- **CallNext** (5 connections) — `server/mcp_server.py`
- **.on_call_tool()** (5 connections) — `server/middleware.py`
- **.on_call_tool()** (3 connections) — `server/mcp_server.py`
- **middleware.py** (3 connections) — `server/middleware.py`
- **Any** (3 connections) — `server/middleware.py`
- **Middleware** (2 connections)
- **.do_GET()** (2 connections) — `server/mcp_server.py`
- **._is_ok()** (2 connections) — `server/middleware.py`
- **Simple API key middleware for FastMCP.** (1 connections) — `server/mcp_server.py`
- **Simple health check handler. Returns index status and crawl freshness.** (1 connections) — `server/mcp_server.py`
- **.__init__()** (1 connections) — `server/middleware.py`
- **Rate limiting middleware for FastMCP server.  Configurable per-API-key token buc** (1 connections) — `server/middleware.py`
- **Token-bucket rate limiter per API key.** (1 connections) — `server/middleware.py`
- **.__init__()** (1 connections) — `server/search.py`

## Relationships

- [[MCP Server Entry & Tools]] (8 shared connections)

## Source Files

- `server/mcp_server.py`
- `server/middleware.py`
- `server/search.py`

## Audit Trail

- EXTRACTED: 46 (51%)
- INFERRED: 44 (49%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*