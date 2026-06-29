# Spec: CI/CD, Versioning & Release Automation

## Objective

Automate version management, quality gating, Docker publishing, and release creation for the rapid7-docs-mcp project using Forgejo Actions as the primary CI/CD platform. End state: a single tag push produces synced versions, built images, a Forgejo release, and a mirror tag on GitHub.

## Why this matters

- **Version drift is currently a problem.** `package.json`, `server/pyproject.toml`, and `server/mcp_server.py` each hardcode `"2.0.0"`. They will not stay in sync.
- **CI/CD currently runs on GitHub Actions.** The primary remote is Forgejo. We're moving to Forgejo-native workflows and treating GitHub as a read-only mirror.
- **Release process is manual.** Tagged releases are not automatically published as Docker images or as Forgejo releases.

## Architecture Decision — Version Sync

**Single source of truth: `package.json` version field.**

```
npm run version:sync
  ├── reads version from package.json
  ├── writes server/__init__.py → __version__ = "x.y.z"
  ├── updates server/pyproject.toml → project.version = "x.y.z" (via toml-cli)
  └── mcp_server.py reads from server import __version__ as VERSION
```

### Why `__init__.py` instead of `version.py`

- Standard Python convention (`from package import __version__`)
- `server/Dockerfile` already copies `__init__.py` — no COPY line to add
- No new file to maintain
- One less file to delete in the server container

### What the sync script does

Lives at `scripts/version-sync.mjs`. Runs as a `postbump` hook for `commit-and-tag-version`. Reads `package.json`, writes `server/__init__.py`, updates `server/pyproject.toml` via `toml set` (not sed — TOML is not line-oriented).

`server/__init__.py` is **committed**, not gitignored. The version is metadata, not build output.

## Tech Stack

| Layer | Tool | Version |
|---|---|---|
| CI/CD | Forgejo Actions | 1.0+ |
| Registry | GitHub Container Registry (ghcr.io) | n/a |
| Version bumping | `commit-and-tag-version` | ^12 |
| Linting (JS/TS) | ESLint flat config | ^9 |
| Linting (Python) | ruff | latest |
| Type checking (TS) | `tsc --noEmit` | ^5 |
| Type checking (Python) | mypy (strict) | latest |
| Formatting | Prettier | ^3 |
| Commit message lint | commitlint + conventional commits | ^19 |
| TOML editing | `toml-cli` (via pip) | latest |
| Container build | docker/build-push-action | v6 |

## Commands

```
# Version management
npm run version:sync        — Sync package.json version → Python files
npx commit-and-tag-version  — Manual bump (CLI, not CI)
# Default: patch bump
npx commit-and-tag-version --release-as major
npx commit-and-tag-version --release-as minor

# Quality gates (local)
npm run typecheck            — tsc --noEmit
npm run format               — prettier --write .
npm run format:check         — prettier --check .
npm run lint                 — eslint . --max-warnings=0
npm run lint:fix             — eslint . --fix
npm test                     — vitest run
npm run test:py              — pytest server/tests/
npm run audit                — npm audit --audit-level=high
```

## Project Structure (CI/CD additions)

```
.
├── .forgejo/
│   └── workflows/             — Forgejo CI/CD workflows (NEW primary)
│       ├── pr.yml             — PR quality gates
│       ├── main.yml           — Build+push to GHCR on push to main
│       ├── release.yml        — Triggered by v* tag: quality gates → build+push → release
│       ├── nightly.yml        — Scheduled: dep audit + smoke test
│       └── mirror.yml         — Triggered by v* tag: push tag to GitHub mirror
├── .github/
│   └── renovate.json          — Renovate config (stays)
├── .versionrc                 — commit-and-tag-version config (NEW)
├── .prettierrc                — Prettier options (NEW)
├── .prettierignore            — Prettier ignore (NEW)
├── eslint.config.js           — ESLint flat config (NEW)
├── commitlint.config.js       — Commitlint config (NEW)
├── scripts/
│   └── version-sync.mjs       — Version sync script (NEW)
├── spec/                      — Specs (NEW dir)
├── plan/                      — Implementation plans (NEW dir)
├── doubt/                     — Adversarial reviews (NEW dir)
└── [existing source dirs unchanged]
```

## Code Style

YAML workflow files use 2-space indentation. Node scripts use ESM (project is `"type": "module"`). TypeScript uses `.js` extensions in imports. Python uses ruff config already in `server/pyproject.toml` (line-length 120).

YAML anchor example for reusable workflow inputs:

```yaml
# .forgejo/workflows/_common.yml (referenced via uses:)
# Not created as a separate file — patterns inlined in each workflow for clarity
```

## Testing Strategy

| Layer | Tool | Where | Coverage |
|---|---|---|---|
| TypeScript unit | vitest | `tests/` | Existing tests pass |
| Python unit | pytest | `server/tests/` | Existing tests pass |
| Stemmer parity | Custom shell script | CI job | Cross-runs Node and Python stemmers on shared vector, exits non-zero on divergence |
| Lint (TS/JS) | eslint | CI job | `--max-warnings=0` |
| Lint (Python) | ruff | CI job | Default rules |
| Type check (TS) | tsc --noEmit | CI job | All `.ts` files (root + src/) |
| Type check (Python) | mypy strict | CI job | `server/` only |
| Format | prettier | CI job | `--check` |
| Commit message | commitlint | CI job | Conventional commits |
| Container scan | trivy | CI job | HIGH,CRITICAL severity |
| Secret scan | gitleaks | CI job | Local scan |
| Dep vulns | npm audit, pip-audit | CI job | --audit-level=high |

## Boundaries

### Always do

- Run `npm run version:sync` after any version bump (or use `commit-and-tag-version` which triggers it)
- Run `npm test` (both TS + Python) before pushing changes to `src/text.ts` or `server/text.py`
- Use conventional commits format for all commit messages (CI enforces this)
- Use `npm ci` (not `npm install`) in CI for reproducible installs
- Use pinned action versions in Forgejo workflows (`@v4`, not `@main`)

### Ask first

- Adding new CI workflows or jobs
- Changing the Docker image registry target
- Modifying the version sync script
- Changing lint rules
- Updating GitHub mirror PAT scopes
- Bumping major versions of lint/format tools

### Never do

- Hardcode the version string in `mcp_server.py` (must import from `__init__`)
- Update Python version fields manually — always use `npm run version:sync`
- Commit `version.py` to `server/` (we use `__init__.py` instead)
- Delete GitHub workflows before brownout period completes
- Skip the stemmer-parity check in CI by default
- Push Docker images to registries other than GHCR without explicit approval
- Mirror every commit to GitHub (tags only)

## Success Criteria

1. `npm run version:sync` propagates a version change from `package.json` to both `server/__init__.py` and `server/pyproject.toml` without manual intervention
2. PR workflow blocks merge if: lint fails, types fail, tests fail, stemmers diverge, format check fails, or commit message violates conventional commits
3. `docker compose build` succeeds for both images after version changes
4. Pushing a `v*` tag produces: 2 GHCR images with semver tags + a Forgejo release + a tag on the GitHub mirror
5. Old GitHub workflows can be safely deleted after 2 successful release cycles
6. `npm run typecheck` covers all `.ts` files in the project (including root-level crawlers)
7. The stemmer-parity CI check runs on every PR that touches `src/text.ts` or `server/text.py`

## Open Questions

- Renovate platform (GitHub or Forgejo) — assuming Forgejo reads `.github/renovate.json` fine for now
- Whether to use `gitea-release-action` or direct API calls for Forgejo releases — preferring `softprops/action-gh-release` for API compatibility
- Whether the GitHub mirror workflows should be removed entirely or kept as read-only references during brownout

## Gotchas

- The `server/Dockerfile` has an explicit `COPY` list. Any new Python file added to `server/` must be added there.
- The `tsconfig.json` only includes `src/**/*` by default — must expand to cover root `*.ts` files.
- `commit-and-tag-version` by default bumps `package.json` only — must configure `bumpFiles` and `scripts.postbump` to also sync Python versions.
- Renovate and the mirror workflow both target GitHub — they may race on tag creation if not ordered. Mirror workflow runs after release workflow by design.
- The MCP server runs the stemmer at query time and the crawler runs the stemmer at index time. They MUST produce identical output or searches return empty. The parity CI check is the only safeguard.

## Verification

- [ ] All four quality gate files (spec, plan, tasks, doubt) written and reviewed
- [ ] `npm run version:sync` tested locally with a version bump
- [ ] `npm test` passes after all changes
- [ ] `npm run lint` and `npm run format:check` pass
- [ ] Forgejo workflows run on a test PR and pass all gates
- [ ] A `v*` tag produces a full release end-to-end
- [ ] GitHub mirror receives the tag
- [ ] Old `.github/workflows/*.yml` disabled (then deleted after brownout)
