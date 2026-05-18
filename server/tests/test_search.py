"""Search engine tests using mock crawl data.

Creates temporary docs/ and data/ directories with realistic
index.json and search-index.json to validate search accuracy.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

# Patch the DOCS_DIR and DATA_DIR before importing search
import server.search as search_mod


@pytest.fixture
def mock_data(tmp_path: Path):
    """Set up a mock docs/ and data/ directory with sample crawl output."""
    docs_dir = tmp_path / "docs"
    data_dir = tmp_path / "data"
    docs_dir.mkdir()
    data_dir.mkdir()
    (data_dir / "products").mkdir()

    # index.json — 3 sample pages
    index = [
        {"path": "insightidr/docs/log-sources.md", "title": "Configure Log Sources", "url": "https://docs.rapid7.com/insightidr/docs/log-sources"},
        {"path": "insightidr/docs/uas-setup.md", "title": "Universal Agent Setup", "url": "https://docs.rapid7.com/insightidr/docs/uas-setup"},
        {"path": "insightvm/docs/scanning.md", "title": "Scanning Vulnerabilities", "url": "https://docs.rapid7.com/insightvm/docs/scanning"},
    ]
    (docs_dir / "index.json").write_text(json.dumps(index))

    # search-index.json — inverted index built from these docs
    search_index = {
        "p": [
            "insightidr/docs/log-sources.md",
            "insightidr/docs/uas-setup.md",
            "insightvm/docs/scanning.md",
        ],
        "i": {
            "configur": [0],         # from "Configure"
            "log": [0],              # from "Log"
            "sourc": [0],            # from "Sources"
            "univers": [1],          # from "Universal"
            "agent": [1],            # from "Agent"
            "setup": [1],            # from "Setup"
            "scan": [2],             # from "Scanning" → stem("scanning")=scan
            "vulner": [2],           # from "Vulnerabilities" → stem("vulnerabilities")=vulner
        },
    }
    (docs_dir / "search-index.json").write_text(json.dumps(search_index))

    # Markdown files
    (docs_dir / "insightidr/docs").mkdir(parents=True)
    (docs_dir / "insightvm/docs").mkdir(parents=True)

    (docs_dir / "insightidr/docs/log-sources.md").write_text(
        "---\ntitle: Configure Log Sources\n---\n\nLearn how to configure log sources for InsightIDR. This page covers log sources configuration."
    )
    (docs_dir / "insightidr/docs/uas-setup.md").write_text(
        "---\ntitle: Universal Agent Setup\n---\n\nThe Universal Agent setup guide for InsightIDR."
    )
    (docs_dir / "insightvm/docs/scanning.md").write_text(
        "---\ntitle: Scanning Vulnerabilities\n---\n\nHow to scan for vulnerabilities in InsightVM. This covers scanning configuration."
    )

    # blog data
    blog = [
        {"title": "New MDR Features", "url": "https://rapid7.com/blog/mdr", "date": "2025-01-15", "category": "Products and Tools"},
        {"title": "Ransomware Threat Report", "url": "https://rapid7.com/blog/ransomware", "date": "2025-02-20", "category": "Threat Research"},
    ]
    (data_dir / "blog-index.json").write_text(json.dumps(blog))

    # resources data
    resources = [
        {"title": "SIEM Buyer's Guide", "url": "https://rapid7.com/resources/siem-guide", "type": "Whitepaper", "description": "How to choose a SIEM"},
        {"title": "Cloud Security Webinar", "url": "https://rapid7.com/resources/cloud", "type": "Webinar", "description": "Cloud security best practices"},
    ]
    (data_dir / "resources.json").write_text(json.dumps(resources))

    # product data
    (data_dir / "products" / "insightidr.md").write_text(
        "---\ntitle: InsightIDR\n---\n\n# InsightIDR\n\nCloud-native SIEM and XDR."
    )
    (data_dir / "products" / "insightvm.md").write_text(
        "---\ntitle: InsightVM\n---\n\n# InsightVM\n\nVulnerability management."
    )

    # Temporarily override paths in the search module.
    # INDEX_FILE and SEARCH_INDEX_FILE are derived at import time from DOCS_DIR,
    # so we must override them too.
    orig_docs = search_mod.DOCS_DIR
    orig_data = search_mod.DATA_DIR
    orig_index = search_mod.INDEX_FILE
    orig_search_index = search_mod.SEARCH_INDEX_FILE

    search_mod.DOCS_DIR = docs_dir
    search_mod.DATA_DIR = data_dir
    search_mod.INDEX_FILE = docs_dir / "index.json"
    search_mod.SEARCH_INDEX_FILE = docs_dir / "search-index.json"

    # Clear all caches
    search_mod._index_cache = None
    search_mod._search_index_cache = None
    search_mod._blog_cache = None
    search_mod._resources_cache = None
    search_mod._doc_cache.clear()

    yield docs_dir

    # Restore
    search_mod.DOCS_DIR = orig_docs
    search_mod.DATA_DIR = orig_data
    search_mod.INDEX_FILE = orig_index
    search_mod.SEARCH_INDEX_FILE = orig_search_index
    search_mod._index_cache = None
    search_mod._search_index_cache = None
    search_mod._blog_cache = None
    search_mod._resources_cache = None
    search_mod._doc_cache.clear()


class TestSearchDocs:
    def test_search_finds_matching_docs(self, mock_data):
        results = search_mod.search_docs("log sources")
        assert len(results) > 0
        titles = [r.entry.title for r in results]
        assert "Configure Log Sources" in titles

    def test_search_returns_no_results_for_nonsense(self, mock_data):
        results = search_mod.search_docs("xyznonexistent")
        assert results == []

    def test_section_filter_works(self, mock_data):
        results = search_mod.search_docs("scan", section="insightvm")
        assert len(results) > 0
        for r in results:
            assert r.entry.path.startswith("insightvm/")

    def test_search_score_order(self, mock_data):
        results = search_mod.search_docs("configure scan")
        # "configure" should hit both log-sources.md (title+body) and
        # scanning.md (body only) — but title hits get +10
        scores = [r.score for r in results]
        assert scores == sorted(scores, reverse=True), f"Scores should be descending: {scores}"

    def test_search_finds_by_url_via_index(self, mock_data):
        # docs_read lookup by URL
        path = "https://docs.rapid7.com/insightvm/docs/scanning"
        index = search_mod.load_index()
        entry = next((e for e in index if e.url == path), None)
        assert entry is not None
        assert entry.path == "insightvm/docs/scanning.md"


class TestDocReader:
    def test_reads_existing_doc(self, mock_data):
        content = search_mod.read_doc("insightidr/docs/log-sources.md")
        assert content is not None
        assert "Configure Log Sources" in content

    def test_returns_none_for_missing_doc(self, mock_data):
        content = search_mod.read_doc("nonexistent/file.md")
        assert content is None

    def test_path_traversal_blocked(self, mock_data):
        content = search_mod.read_doc("../../../etc/passwd")
        assert content is None


class TestBlogSearch:
    def test_loads_blog_index(self, mock_data):
        posts = search_mod.load_blog_index()
        assert len(posts) == 2

    def test_searches_blog_by_keyword(self, mock_data):
        posts = search_mod.load_blog_index()
        matching = [p for p in posts if "ransomware" in p.title.lower()]
        assert len(matching) == 1
        assert matching[0].url == "https://rapid7.com/blog/ransomware"


class TestResourcesSearch:
    def test_loads_resources(self, mock_data):
        resources = search_mod.load_resources()
        assert len(resources) == 2

    def test_searches_resources(self, mock_data):
        resources = search_mod.load_resources()
        matching = [r for r in resources if "siem" in r.title.lower()]
        assert len(matching) == 1


class TestProducts:
    def test_reads_product(self, mock_data):
        content = search_mod.read_product("insightidr")
        assert content is not None
        assert "SIEM" in content

    def test_lists_products(self, mock_data):
        products = search_mod.list_products()
        assert "insightidr" in products
        assert "insightvm" in products

    def test_returns_none_for_unknown_product(self, mock_data):
        content = search_mod.read_product("nonexistent")
        assert content is None
