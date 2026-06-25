---
type: community
members: 22
---

# Test Suite

**Members:** 22 nodes

## Members
- [[.test_lists_products()]] - code - server/tests/test_search.py
- [[.test_loads_blog_index()]] - code - server/tests/test_search.py
- [[.test_loads_resources()]] - code - server/tests/test_search.py
- [[.test_path_traversal_blocked()]] - code - server/tests/test_search.py
- [[.test_reads_existing_doc()]] - code - server/tests/test_search.py
- [[.test_reads_product()]] - code - server/tests/test_search.py
- [[.test_returns_none_for_missing_doc()]] - code - server/tests/test_search.py
- [[.test_returns_none_for_unknown_product()]] - code - server/tests/test_search.py
- [[.test_search_finds_by_url_via_index()]] - code - server/tests/test_search.py
- [[.test_search_finds_matching_docs()]] - code - server/tests/test_search.py
- [[.test_search_returns_no_results_for_nonsense()]] - code - server/tests/test_search.py
- [[.test_search_score_order()]] - code - server/tests/test_search.py
- [[.test_searches_blog_by_keyword()]] - code - server/tests/test_search.py
- [[.test_searches_resources()]] - code - server/tests/test_search.py
- [[.test_section_filter_works()]] - code - server/tests/test_search.py
- [[Search engine tests using mock crawl data.  Creates temporary docs and data di]] - rationale - server/tests/test_search.py
- [[TestBlogSearch]] - code - server/tests/test_search.py
- [[TestDocReader]] - code - server/tests/test_search.py
- [[TestProducts]] - code - server/tests/test_search.py
- [[TestResourcesSearch]] - code - server/tests/test_search.py
- [[TestSearchDocs]] - code - server/tests/test_search.py
- [[test_search.py]] - code - server/tests/test_search.py

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Test_Suite
SORT file.name ASC
```

## Connections to other communities
- 1 edge to [[_COMMUNITY_MCP Server Entry & Tools]]
- 1 edge to [[_COMMUNITY_Extensions Crawler]]

## Top bridge nodes
- [[test_search.py]] - degree 8, connects to 2 communities