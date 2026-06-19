# CI/CD & Code Quality

> 9 nodes

## Key Concepts

- **PR Checks Workflow** (5 connections) — `.github/workflows/pr.yml`
- **Test Jobs (Python pytest, TypeScript vitest)** (3 connections) — `.github/workflows/pr.yml`
- **Stemmer/Stop-Word Parity Between TypeScript and Python** (2 connections) — `AGENTS.md`
- **Lint Jobs (Dockerfile, Python, TypeScript)** (2 connections) — `.github/workflows/pr.yml`
- **TypeScript ESM Import Convention (.js extension)** (1 connections) — `AGENTS.md`
- **Python Package Import Convention** (1 connections) — `AGENTS.md`
- **CodeQL SAST Job** (1 connections) — `.github/workflows/pr.yml`
- **Dependency Vulnerability Job** (1 connections) — `.github/workflows/pr.yml`
- **Trivy Docker Scan Job** (1 connections) — `.github/workflows/pr.yml`

## Relationships

- [[Project Architecture & Concepts]] (1 shared connections)

## Source Files

- `.github/workflows/pr.yml`
- `AGENTS.md`

## Audit Trail

- EXTRACTED: 11 (65%)
- INFERRED: 6 (35%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*