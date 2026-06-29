"""
Rapid7 Docs MCP Server — FastMCP edition.

Tools:
  docs_search            — Full-text search across all crawled Rapid7 documentation
  docs_read              — Read a specific doc page by path or URL
  docs_list              — List available sections and page counts
  get_product_knowledge  — Marketing content, pricing, and FAQs for a Rapid7 product
  search_blog            — Search the Rapid7 blog index by keyword
  search_resources       — Search Rapid7 resources (whitepapers, reports, guides)

Transport: Streamable HTTP or SSE (set MCP_TRANSPORT env var, default: http).
Auth: API key (MCP_API_KEYS env var, comma-separated).
"""

import http.server
import json
import os
import sys
from pathlib import Path

from fastmcp import FastMCP
from fastmcp.server.middleware import CallNext, Middleware, MiddlewareContext

from . import __version__ as version
from .middleware import RateLimitMiddleware
from .search import (
    BlogPost,
    get_sections,
    list_products,
    load_blog_index,
    load_index,
    load_resources,
    read_doc,
    read_product,
    search_docs,
    strip_frontmatter,
)

# ─── Config ──────────────────────────────────────────────────────────────────

PORT = int(os.environ.get("MCP_PORT", "8000"))
TRANSPORT = os.environ.get("MCP_TRANSPORT", "streamable-http")
API_KEYS: set[str] = set(
    k.strip()
    for k in os.environ.get("MCP_API_KEYS", "").split(",")
    if k.strip()
)
# If no API keys set, auth is disabled (open access — for local dev)
AUTH_ENABLED = bool(API_KEYS)

INDEX_FILE = Path(__file__).resolve().parent.parent / "docs" / "index.json"


# ─── Auth middleware ──────────────────────────────────────────────────────────


class AuthMiddleware(Middleware):
    """Simple API key middleware for FastMCP."""

    async def on_call_tool(self, context: MiddlewareContext, call_next: CallNext):
        if AUTH_ENABLED:
            meta = getattr(context.message, "meta", None) or {}
            key = meta.get("api_key", "")
            if key not in API_KEYS:
                from fastmcp.exceptions import ToolError

                raise ToolError("Invalid or missing API key.")
        return await call_next(context)


# ─── Server ──────────────────────────────────────────────────────────────────

mcp = FastMCP(
    name="Rapid7 Docs",
    version=version,
    instructions="""Rapid7 documentation and resource search assistant.

Uses the Rapid7 Docs MCP server to search technical documentation, product
knowledge, blog posts, and resources from docs.rapid7.com,
documentation.rapid7.com, extensions.rapid7.com, and rapid7.com.

Use docs_search to find relevant documentation, then docs_read to get full
page content. Use get_product_knowledge for marketing/pricing/FAQs.
Use search_blog and search_resources for blog posts and whitepapers.""",
    mask_error_details=False,
)

mcp.add_middleware(AuthMiddleware())
mcp.add_middleware(RateLimitMiddleware())

# ─── Tools ───────────────────────────────────────────────────────────────────


@mcp.tool(
    name="docs_search",
    description="""Search across all crawled Rapid7 documentation pages using full-text search.

Returns ranked results with context snippets and links to the live docs page.
Images in results are linked as absolute URLs and can be fetched for visual reference.

Args:
  - query (str): Search terms, e.g. "DHCP sensor configuration" or "log aggregation API"
  - section (str, optional): Limit to a product section e.g. "insightidr", "insightvm"
  - limit (int, optional): Max results to return, 1-20 (default: 10)

Returns:
  Array of matching docs with title, url, file path, and a content snippet.

Examples:
  - "How do I configure log sources in InsightIDR?" -> query="log source configuration", section="insightidr"
  - "What CVSS scoring does InsightVM use?" -> query="CVSS scoring", section="insightvm"
  - "Find the Splunk extension plugin" -> query="Splunk", section="extensions\"""",
)
async def docs_search(
    query: str,
    section: str | None = None,
    limit: int = 10,
) -> str:
    limit = max(1, min(limit, 20))
    results = search_docs(query, section)[:limit]

    if not results:
        sec_msg = f' in section "{section}"' if section else ""
        return f'No results found for "{query}"{sec_msg}. Try broader terms or run the crawler to index more docs.'

    output = [
        {
            "rank": i + 1,
            "title": r.entry.title,
            "url": r.entry.url,
            "file": r.entry.path,
            "score": r.score,
            "snippet": r.snippet,
        }
        for i, r in enumerate(results)
    ]

    text = "\n---\n\n".join(
        f"**[{o['rank']}] {o['title']}**\nURL: {o['url']}\nFile: {o['file']}\n\n{o['snippet']}\n"
        for o in output
    )

    return text + "\n\n```json\n" + json.dumps({"results": output}, indent=2) + "\n```"


@mcp.tool(
    name="docs_read",
    description="""Read the full markdown content of a specific Rapid7 documentation page.

Use this after docs_search to get complete content of a result.
Images are preserved as absolute URLs.

Args:
  - path (str): Relative file path from docs_search results e.g. "insightidr/docs/log-sources.md"
                 OR a full URL from docs.rapid7.com or documentation.rapid7.com

Returns:
  Full markdown content of the page including frontmatter with source URL.""",
)
async def docs_read(path: str) -> str:
    # Allow passing a URL — look it up in the index
    if path.startswith("http"):
        index = load_index()
        entry = next(
            (e for e in index if e.url == path or e.url == path.rstrip("/")),
            None,
        )
        if not entry:
            return f"No cached page found for URL: {path}\nTry running the crawler first: docker compose run crawler npm run crawl"
        path = entry.path

    content = read_doc(path)
    if not content:
        return f'File not found: {path}\nRun the crawler to index docs first.'

    return content


@mcp.tool(
    name="docs_list",
    description="""List crawled Rapid7 documentation sections or browse pages within a section.

Without a section: shows all sections with page counts and last-crawled date.
With a section: lists every indexed page title and file path in that section.

Args:
  - section (str, optional): Product section to browse e.g. "insightidr", "insightvm", "extensions"

Use this to understand what's available, then use docs_search or docs_read.""",
)
async def docs_list(section: str | None = None) -> str:
    index = load_index()
    last_crawled = (
        INDEX_FILE.stat().st_mtime_ns // 1_000_000
        if INDEX_FILE.exists()
        else None
    )
    import datetime

    last_str = (
        datetime.datetime.fromtimestamp(last_crawled / 1000, tz=datetime.UTC).isoformat()
        if last_crawled
        else "Never"
    )

    if not index:
        return "No docs indexed yet.\n\nRun the crawler:\n  docker compose run crawler npm run crawl"

    # Section browse mode
    if section:
        prefix = section.rstrip("/") + "/"
        pages = [e for e in index if e.path.startswith(prefix)]
        if not pages:
            sections = get_sections()
            available = ", ".join(sorted(sections.keys()))
            return f'Section "{section}" not found or not indexed.\nAvailable sections: {available}'

        page_list = "\n".join(
            f"  {p.path.ljust(60)} {p.title}" for p in pages
        )
        page_data = {
            "section": section,
            "pages": [
                {"path": p.path, "title": p.title, "url": p.url}
                for p in pages
            ],
        }
        return f"**{section}** — {len(pages)} pages\n\n{page_list}\n\n```json\n{json.dumps(page_data, indent=2)}\n```"

    # Summary mode
    sections = get_sections()
    total = sum(sections.values())
    section_text = "\n".join(
        f"  {name.ljust(25)} {count} pages"
        for name, count in sorted(sections.items(), key=lambda x: -x[1])
    )
    summary = {"sections": sections, "total": total, "lastCrawled": last_str}
    return (
        f"**Rapid7 Docs Index**\n"
        f"Last crawled: {last_str}\n"
        f"Total pages: {total}\n\n"
        f"**Sections:**\n{section_text}\n\n"
        f"```json\n{json.dumps(summary, indent=2)}\n```"
    )


@mcp.tool(
    name="get_product_knowledge",
    description="""Get marketing content, feature descriptions, pricing tiers, and FAQ answers for a Rapid7 product.

Returns the full product page content including overview, features, tier comparisons, and frequently asked questions.

Args:
  - product (str): Product slug e.g. "command", "insightvm", "siem", "metasploit"

Available products: command, insightappsec, insightcloudsec, insightvm, metasploit, nexpose, siem, threat-command, velociraptor

Returns:
  Full markdown content of the product page with all scraped sections.""",
)
async def get_product_knowledge(product: str) -> str:
    content = read_product(product)
    if not content:
        available = list_products()
        if available:
            return f'Product "{product}" not found.\nAvailable products: {", ".join(available)}\n\nRun: docker compose run crawler npm run crawl:site -- --products'
        return (
            "No product data indexed yet.\n\n"
            "Run: docker compose run crawler npm run crawl:site -- --products"
        )
    return strip_frontmatter(content)


@mcp.tool(
    name="search_blog",
    description="""Search the Rapid7 blog index by keyword. Returns matching post titles, dates, categories, and URLs.

Does NOT return full blog content — just metadata for finding relevant posts.

Args:
  - query (str): Search terms e.g. "ransomware", "MDR", "vulnerability management" (empty for newest)
  - category (str, optional): Filter by category e.g. "Threat Research", "Products and Tools"
  - limit (int, optional): Max results to return, 1-50 (default: 20)

Returns:
  Matching blog posts with title, date, category, and URL.

Examples:
  - "latest ransomware research" -> query="ransomware", category="Threat Research"
  - "most recent posts" -> query="" (omit or empty to get newest posts sorted by date)
  - "recent MDR updates" -> query="MDR\"""",
)
async def search_blog(
    query: str = "",
    category: str | None = None,
    limit: int = 20,
) -> str:
    limit = max(1, min(limit, 50))
    posts = load_blog_index()

    if not posts:
        return "No blog data indexed yet.\n\nRun: docker compose run crawler npm run crawl:site -- --blog"

    terms = query.lower().split()
    has_query = bool(terms)

    if has_query:
        scored: list[tuple[BlogPost, int]] = []
        for p in posts:
            title_lower = p.title.lower()
            cat_lower = p.category.lower()
            score = 0
            for t in terms:
                if t in title_lower:
                    score += 10
                if t in cat_lower:
                    score += 3
            if score > 0:
                scored.append((p, score))

        if category:
            cat_filter = category.lower()
            scored = [(p, s) for p, s in scored if cat_filter in p.category.lower()]

        scored.sort(key=lambda x: (x[1], x[0].date or ""), reverse=True)
        candidates = [p for p, _ in scored]
    else:
        candidates = sorted(posts, key=lambda p: p.date or "", reverse=True)
        if category:
            cat_filter = category.lower()
            candidates = [p for p in candidates if cat_filter in p.category.lower()]

    results = candidates[:limit]

    if not results:
        msg = "No blog posts found"
        if has_query:
            msg += f' matching "{query}"'
        if category:
            msg += f' in category "{category}"'
        return f"{msg}. Total indexed: {len(posts)} posts."

    text = "\n\n".join(
        f"**[{i + 1}] {p.title}**\n"
        f"{'Date: ' + p.date if p.date else 'Date: N/A'}"
        f"{' | Category: ' + p.category if p.category else ''}\n"
        f"URL: {p.url}"
        for i, p in enumerate(results)
    )

    blog_data = {
        "results": [
            {"title": p.title, "date": p.date, "category": p.category, "url": p.url}
            for p in results
        ],
        "total": len(candidates),
        "indexed": len(posts),
    }
    return f"Found {len(results)} of {len(candidates)} matches ({len(posts)} total posts):\n\n{text}\n\n```json\n{json.dumps(blog_data, indent=2)}\n```"


@mcp.tool(
    name="search_resources",
    description="""Search the Rapid7 resources index (whitepapers, reports, guides, webinars).

Args:
  - query (str): Search terms e.g. "SIEM", "compliance", "cloud security"
  - type (str, optional): Filter by resource type e.g. "Whitepaper", "Report", "Webinar"
  - limit (int, optional): Max results to return, 1-50 (default: 20)

Returns:
  Matching resources with title, type, description, and URL.""",
)
async def search_resources(
    query: str,
    type: str | None = None,
    limit: int = 20,
) -> str:
    limit = max(1, min(limit, 50))
    resources = load_resources()

    if not resources:
        return "No resource data indexed yet.\n\nRun: docker compose run crawler npm run crawl:site -- --resources"

    query_lower = query.lower()
    terms = query_lower.split()

    filtered = [
        r
        for r in resources
        if any(
            t in f"{r.title} {r.description} {r.type}".lower()
            for t in terms
        )
    ]

    if type:
        type_lower = type.lower()
        filtered = [r for r in filtered if type_lower in r.type.lower()]

    results = filtered[:limit]

    if not results:
        msg = f'No resources found matching "{query}"'
        if type:
            msg += f' of type "{type}"'
        return f"{msg}. Total indexed: {len(resources)} resources."

    text = "\n\n".join(
        f"**[{i + 1}] {r.title}**"
        f"{'\nType: ' + r.type if r.type else ''}"
        f"{'\n' + r.description if r.description else ''}"
        f"{'\nURL: ' + r.url}"
        for i, r in enumerate(results)
    )

    resource_data = {
        "results": [
            {"title": r.title, "type": r.type, "description": r.description, "url": r.url}
            for r in results
        ],
        "total": len(resources),
    }
    return f"Found {len(results)} matches ({len(resources)} total resources):\n\n{text}\n\n```json\n{json.dumps(resource_data, indent=2)}\n```"


# ─── Health endpoint ──────────────────────────────────────────────────────────


class HealthHandler(http.server.BaseHTTPRequestHandler):
    """Simple health check handler. Returns index status and crawl freshness."""

    def do_GET(self) -> None:
        if self.path == "/health":
            import datetime

            index_exists = INDEX_FILE.exists()
            index_size = 0
            last_crawled = "Never"
            if index_exists:
                stat = INDEX_FILE.stat()
                index_size = len(load_index())
                last_crawled = datetime.datetime.fromtimestamp(
                    stat.st_mtime, tz=datetime.UTC
                ).isoformat()

            self.send_response(200 if index_exists else 503)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {
                        "status": "healthy" if index_exists else "degraded",
                        "pages_indexed": index_size,
                        "last_crawled": last_crawled,
                    }
                ).encode()
            )
        elif self.path == "/metrics":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(
                b"# Placeholder - metrics not yet implemented\n"
                b"# Add prometheus_client integration for full metrics\n"
            )
        else:
            self.send_response(404)
            self.end_headers()


# ─── Entry ───────────────────────────────────────────────────────────────────

def main() -> None:
    # Start health endpoint on a separate port in a background thread
    import threading

    health_port = int(os.environ.get("HEALTH_PORT", str(PORT + 1)))
    health_server = http.server.HTTPServer(("0.0.0.0", health_port), HealthHandler)
    health_thread = threading.Thread(target=health_server.serve_forever, daemon=True)
    health_thread.start()
    print(f"Health endpoint on :{health_port}", file=sys.stderr)

    mcp.run(
        transport=TRANSPORT,
        host="0.0.0.0",
        port=PORT,
    )


if __name__ == "__main__":
    main()
