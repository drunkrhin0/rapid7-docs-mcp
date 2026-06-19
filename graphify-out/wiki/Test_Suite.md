# Test Suite

> 22 nodes

## Key Concepts

- **test_search.py** (8 connections) — `server/tests/test_search.py`
- **TestSearchDocs** (6 connections) — `server/tests/test_search.py`
- **TestDocReader** (4 connections) — `server/tests/test_search.py`
- **TestProducts** (4 connections) — `server/tests/test_search.py`
- **TestBlogSearch** (3 connections) — `server/tests/test_search.py`
- **TestResourcesSearch** (3 connections) — `server/tests/test_search.py`
- **.test_search_finds_matching_docs()** (1 connections) — `server/tests/test_search.py`
- **.test_search_returns_no_results_for_nonsense()** (1 connections) — `server/tests/test_search.py`
- **.test_section_filter_works()** (1 connections) — `server/tests/test_search.py`
- **.test_search_score_order()** (1 connections) — `server/tests/test_search.py`
- **.test_search_finds_by_url_via_index()** (1 connections) — `server/tests/test_search.py`
- **.test_reads_existing_doc()** (1 connections) — `server/tests/test_search.py`
- **.test_returns_none_for_missing_doc()** (1 connections) — `server/tests/test_search.py`
- **.test_path_traversal_blocked()** (1 connections) — `server/tests/test_search.py`
- **.test_loads_blog_index()** (1 connections) — `server/tests/test_search.py`
- **.test_searches_blog_by_keyword()** (1 connections) — `server/tests/test_search.py`
- **.test_loads_resources()** (1 connections) — `server/tests/test_search.py`
- **.test_searches_resources()** (1 connections) — `server/tests/test_search.py`
- **.test_reads_product()** (1 connections) — `server/tests/test_search.py`
- **.test_lists_products()** (1 connections) — `server/tests/test_search.py`
- **.test_returns_none_for_unknown_product()** (1 connections) — `server/tests/test_search.py`
- **Search engine tests using mock crawl data.  Creates temporary docs/ and data/ di** (1 connections) — `server/tests/test_search.py`

## Relationships

- [[MCP Server Entry & Tools]] (1 shared connections)
- [[Extensions Crawler]] (1 shared connections)

## Source Files

- `server/tests/test_search.py`

## Audit Trail

- EXTRACTED: 44 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*