---
type: community
members: 9
---

# CI/CD & Code Quality

**Members:** 9 nodes

## Members
- [[CodeQL SAST Job]] - concept - .github/workflows/pr.yml
- [[Dependency Vulnerability Job]] - concept - .github/workflows/pr.yml
- [[Lint Jobs (Dockerfile, Python, TypeScript)]] - concept - .github/workflows/pr.yml
- [[PR Checks Workflow]] - document - .github/workflows/pr.yml
- [[Python Package Import Convention]] - rationale - AGENTS.md
- [[StemmerStop-Word Parity Between TypeScript and Python]] - rationale - AGENTS.md
- [[Test Jobs (Python pytest, TypeScript vitest)]] - concept - .github/workflows/pr.yml
- [[Trivy Docker Scan Job]] - concept - .github/workflows/pr.yml
- [[TypeScript ESM Import Convention (.js extension)]] - rationale - AGENTS.md

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/CI/CD__Code_Quality
SORT file.name ASC
```

## Connections to other communities
- 1 edge to [[_COMMUNITY_Project Architecture & Concepts]]

## Top bridge nodes
- [[StemmerStop-Word Parity Between TypeScript and Python]] - degree 2, connects to 1 community