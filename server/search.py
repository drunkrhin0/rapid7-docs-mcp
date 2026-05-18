"""
Search engine — reads crawl output and performs full-text search.

Must produce identical results to the search logic in the original src/index.ts
because the data files are written by the TypeScript crawlers and read here.
"""

import json
import os
import re
from collections import OrderedDict
from pathlib import Path
from typing import Any

from .text import STOP_WORDS, stem

# ─── Config ──────────────────────────────────────────────────────────────────

MAX_RESULTS = 20
SNIPPET_CHARS = 300
DOC_CACHE_MAX = 500

DOCS_DIR: Path = Path(__file__).resolve().parent.parent / "docs"
DATA_DIR: Path = Path(__file__).resolve().parent.parent / "data"

INDEX_FILE: Path = DOCS_DIR / "index.json"
SEARCH_INDEX_FILE: Path = DOCS_DIR / "search-index.json"


# ─── Types ────────────────────────────────────────────────────────────────────


class IndexEntry:
    __slots__ = ("path", "title", "url")

    def __init__(self, path: str, title: str, url: str) -> None:
        self.path = path
        self.title = title
        self.url = url


class SearchResult:
    __slots__ = ("entry", "snippet", "score")

    def __init__(self, entry: IndexEntry, snippet: str, score: int) -> None:
        self.entry = entry
        self.snippet = snippet
        self.score = score


# ─── File loaders (mtime-based invalidation, same as TypeScript) ──────────────

_index_cache: list[IndexEntry] | None = None
_index_mtime: float = 0.0


def load_index() -> list[IndexEntry]:
    global _index_cache, _index_mtime
    if not INDEX_FILE.exists():
        return []
    mtime = INDEX_FILE.stat().st_mtime
    if _index_cache is not None and mtime == _index_mtime:
        return _index_cache
    raw = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    _index_cache = [IndexEntry(**item) for item in raw]
    _index_mtime = mtime
    return _index_cache


_search_index_cache: dict[str, Any] | None = None
_search_index_mtime: float = 0.0


def load_search_index() -> dict[str, Any] | None:
    """Returns {p: paths[], i: {stem → docId[]}} or None if not yet built."""
    global _search_index_cache, _search_index_mtime
    if not SEARCH_INDEX_FILE.exists():
        return None
    mtime = SEARCH_INDEX_FILE.stat().st_mtime
    if _search_index_cache is not None and mtime == _search_index_mtime:
        return _search_index_cache
    _search_index_cache = json.loads(SEARCH_INDEX_FILE.read_text(encoding="utf-8"))
    _search_index_mtime = mtime
    return _search_index_cache


# ─── Doc reader ───────────────────────────────────────────────────────────────

# LRU doc content cache
_doc_cache: OrderedDict[str, str] = OrderedDict()


def read_doc(relative_path: str) -> str | None:
    """Read a markdown doc by relative path, with LRU cache and path traversal protection."""
    global _doc_cache
    docs_resolved = DOCS_DIR.resolve()
    full_path = (DOCS_DIR / relative_path).resolve()

    # Prevent path traversal outside docs directory
    if not (str(full_path) + os.sep).startswith(str(docs_resolved) + os.sep) and str(full_path) != str(docs_resolved):
        return None

    # Cache hit — move to end (most-recently-used)
    if relative_path in _doc_cache:
        _doc_cache.move_to_end(relative_path)
        return _doc_cache[relative_path]

    if not full_path.exists():
        return None

    content = full_path.read_text(encoding="utf-8")

    # Evict oldest entry when at capacity
    if len(_doc_cache) >= DOC_CACHE_MAX:
        _doc_cache.popitem(last=False)

    _doc_cache[relative_path] = content
    return content


# ─── Text utilities ───────────────────────────────────────────────────────────

_FRONTMATTER_RE = re.compile(r"^---\n[\s\S]*?\n---\n")


def strip_frontmatter(content: str) -> str:
    """Strip YAML frontmatter so snippets/scoring don't see hash/url/date noise."""
    return _FRONTMATTER_RE.sub("", content)


def _escape_regex(s: str) -> str:
    return re.escape(s)


def extract_snippet(content: str, query_terms: list[str]) -> str:
    """Find the best 300-char window covering the most query term hits."""
    lower = content.lower()
    positions: list[int] = []

    for term in query_terms:
        pattern = re.compile(_escape_regex(term))
        for m in pattern.finditer(lower):
            positions.append(m.start())

    if not positions:
        return content[:SNIPPET_CHARS] + "..."

    positions.sort()
    best_start = positions[0]
    best_count = 0
    left = 0

    for right in range(len(positions)):
        while positions[right] - positions[left] > SNIPPET_CHARS:
            left += 1
        if right - left + 1 > best_count:
            best_count = right - left + 1
            best_start = positions[left]

    start = max(0, best_start - 40)
    end = min(len(content), start + SNIPPET_CHARS)
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(content) else ""
    return prefix + content[start:end] + suffix


# ─── Search ───────────────────────────────────────────────────────────────────


def search_docs(
    query: str, section: str | None = None
) -> list[SearchResult]:
    """Full-text search across crawled docs. Returns up to MAX_RESULTS ranked results."""
    index = load_index()
    raw_terms = query.lower().split()

    # Stem query terms, filtering stop words
    meaningful = [t for t in raw_terms if t not in STOP_WORDS]
    stemmed_terms = [stem(t) for t in (meaningful if meaningful else raw_terms)]

    section_prefix = section.rstrip("/") + "/" if section else None
    entry_map: dict[str, IndexEntry] = {e.path: e for e in index}
    doc_scores: dict[str, int] = {}

    snippet_terms = list(dict.fromkeys(raw_terms + stemmed_terms))

    search_idx = load_search_index()

    if search_idx:
        # Fast path: inverted index lookup
        candidate_paths: set[str] = set()
        for stemmed in stemmed_terms:
            doc_ids = search_idx["i"].get(stemmed, [])
            for doc_id in doc_ids:
                doc_path = search_idx["p"][doc_id] if doc_id < len(search_idx["p"]) else None
                if doc_path:
                    candidate_paths.add(doc_path)

        for doc_path in candidate_paths:
            if section_prefix and not doc_path.startswith(section_prefix):
                continue
            entry = entry_map.get(doc_path)
            if not entry:
                continue
            raw = read_doc(doc_path)
            if not raw:
                continue

            content = strip_frontmatter(raw)
            lower_content = content.lower()
            lower_title = entry.title.lower()
            score = 0

            for stemmed in stemmed_terms:
                if stemmed in lower_title:
                    score += 10
                score += lower_content.count(stemmed)

            if score > 0:
                doc_scores[doc_path] = score
    else:
        # Slow path: full scan fallback (no search-index.json yet)
        for entry in index:
            if section_prefix and not entry.path.startswith(section_prefix):
                continue
            raw = read_doc(entry.path)
            if not raw:
                continue

            content = strip_frontmatter(raw)
            lower_content = content.lower()
            lower_title = entry.title.lower()
            score = 0

            for stemmed in stemmed_terms:
                if stemmed in lower_title:
                    score += 10
                score += lower_content.count(stemmed)

            if score > 0:
                doc_scores[entry.path] = score

    # Build results
    results: list[SearchResult] = []
    for doc_path, score in doc_scores.items():
        entry = entry_map.get(doc_path)
        if not entry:
            continue
        raw = read_doc(doc_path)
        if not raw:
            continue
        snippet = extract_snippet(strip_frontmatter(raw), snippet_terms)
        results.append(SearchResult(entry=entry, snippet=snippet, score=score))

    results.sort(key=lambda r: r.score, reverse=True)
    return results[:MAX_RESULTS]


def get_sections() -> dict[str, int]:
    """Return all sections with page counts."""
    index = load_index()
    sections: dict[str, int] = {}
    for entry in index:
        parts = entry.path.split("/")
        section = parts[0] if parts[0] else "root"
        sections[section] = sections.get(section, 0) + 1
    return sections


# ─── Blog & Resources loaders ───────────────────────────────────────────────

class BlogPost:
    __slots__ = ("title", "url", "date", "category")

    def __init__(self, title: str, url: str, date: str = "", category: str = "") -> None:
        self.title = title
        self.url = url
        self.date = date
        self.category = category


class Resource:
    __slots__ = ("title", "url", "type", "description")

    def __init__(self, title: str, url: str, type: str = "", description: str = "") -> None:
        self.title = title
        self.url = url
        self.type = type
        self.description = description


_blog_cache: list[BlogPost] | None = None
_blog_mtime: float = 0.0


def load_blog_index() -> list[BlogPost]:
    global _blog_cache, _blog_mtime
    file_path = DATA_DIR / "blog-index.json"
    if not file_path.exists():
        return []
    mtime = file_path.stat().st_mtime
    if _blog_cache is not None and mtime == _blog_mtime:
        return _blog_cache
    raw = json.loads(file_path.read_text(encoding="utf-8"))
    _blog_cache = [BlogPost(**item) for item in raw]
    _blog_mtime = mtime
    return _blog_cache


_resources_cache: list[Resource] | None = None
_resources_mtime: float = 0.0


def load_resources() -> list[Resource]:
    global _resources_cache, _resources_mtime
    file_path = DATA_DIR / "resources.json"
    if not file_path.exists():
        return []
    mtime = file_path.stat().st_mtime
    if _resources_cache is not None and mtime == _resources_mtime:
        return _resources_cache
    raw = json.loads(file_path.read_text(encoding="utf-8"))
    _resources_cache = [Resource(**item) for item in raw]
    _resources_mtime = mtime
    return _resources_cache


def read_product(slug: str) -> str | None:
    """Read a product markdown file, with path traversal protection."""
    products_dir = (DATA_DIR / "products").resolve()
    file_path = (products_dir / f"{slug}.md").resolve()
    if not str(file_path).startswith(str(products_dir) + os.sep):
        return None
    if not file_path.exists():
        return None
    return file_path.read_text(encoding="utf-8")


def list_products() -> list[str]:
    dir_path = DATA_DIR / "products"
    if not dir_path.exists():
        return []
    return sorted(
        f.stem for f in dir_path.iterdir() if f.suffix == ".md"
    )
