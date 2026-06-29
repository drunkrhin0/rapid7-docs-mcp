# Plan: CI/CD, Versioning & Release Automation

## Approach

Implement in 6 phases. Each phase ends with a verification gate. The user reviews before moving to the next phase.

## Phase 0: Documentation (this phase)

Write all four governance documents first so future contributors understand the design:

- `spec/cicd-versioning-releases.md` — the spec
- `plan/cicd-versioning-releases.md` — this file
- `plan/tasks.md` — discrete task breakdown
- `doubt/cicd-versioning-releases.md` — adversarial review

**Verify:** All four files exist and are reviewed.

## Phase 1: Pre-format + Tooling (no version changes yet)

Get the codebase into a state where the new format and lint checks will pass on first run. Without this, every PR is a snowflake.

1. Create config files: `.prettierrc`, `.prettierignore`, `eslint.config.js`, `commitlint.config.js`, `.versionrc`
2. Create `scripts/version-sync.mjs` (skeleton — to be wired in Phase 3)
3. Update `package.json` to add scripts and devDependencies
4. Update `tsconfig.json` to include root `*.ts` files
5. Run `npm install` to install new devDependencies
6. Run `npm run format` to format the existing codebase — commit with `[skip ci]`
7. Run `npm run lint --fix` to auto-fix any lint issues — commit with `[skip ci]`

**Verify:** `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm test` all pass locally. Existing GitHub workflows still pass (they don't check format/lint, so this is mostly a sanity check).

## Phase 2: Python version plumbing

Make the Python side import the version from a single location. This is a small change that should not affect runtime.

1. Add `__version__ = "2.0.0"` to `server/__init__.py`
2. Edit `server/mcp_server.py` to import `from server import __version__ as VERSION` and use `version=VERSION`
3. Verify: import works (`python -c "from server.mcp_server import mcp"`)
4. Verify: `pytest server/tests/` passes
5. Verify: `server/Dockerfile` still has the right `COPY` lines (no new file added, so no change needed)

**Verify:** No version hardcoding remains. `grep -r '2\.0\.0' server/` only matches in `__init__.py` and `pyproject.toml` (which the sync script will manage).

## Phase 3: Version sync script + commit-and-tag-version

Wire up the version sync mechanism.

1. Implement `scripts/version-sync.mjs` (reads `package.json`, writes `__init__.py`, updates `pyproject.toml` via `toml-cli`)
2. Configure `.versionrc` with `bumpFiles` and `scripts.postbump`
3. Add `commit-and-tag-version` to devDependencies
4. Test: `npx commit-and-tag-version --dry-run` shows the expected changes
5. Test: bump patch version locally, verify all three locations update
6. Reset to "2.0.0" before committing (we're not actually releasing)

**Verify:** A local version bump correctly updates all three files. `git diff` shows only the three version fields changed.

## Phase 4: Forgejo workflows

Create the five workflow files. Each is self-contained and can be created independently.

1. `.forgejo/workflows/pr.yml` — PR quality gates (lint, typecheck, test, format check, commitlint, stemmer-parity, audit, SAST)
2. `.forgejo/workflows/main.yml` — Build+push on push to main
3. `.forgejo/workflows/release.yml` — Triggered by v* tag: quality gates → build+push → Forgejo release
4. `.forgejo/workflows/nightly.yml` — Scheduled: dep audit + smoke test
5. `.forgejo/workflows/mirror.yml` — Triggered by v* tag: push tag to GitHub

**Verify:** Each workflow file is valid YAML. Run `act` locally if available to test, otherwise just lint with `yamllint`.

## Phase 5: Brownout GitHub workflows

Disable (don't delete yet) the old `.github/workflows/*.yml` files.

1. Add `if: false` to all jobs in `.github/workflows/*.yml` (or rename to `*.yml.disabled`)
2. Verify: a test PR doesn't trigger GitHub workflows
3. Verify: a test tag push doesn't trigger GitHub workflows
4. Wait for 2 successful Forgejo release cycles
5. Delete the old workflow files

**Verify:** GitHub shows no recent workflow runs on the disabled files. Forgejo shows successful runs on the new files.

## Phase 6: First release + end-to-end test

Run a full release cycle to confirm everything works.

1. Create a test tag like `v2.0.1-test.1`
2. Push the tag
3. Verify: `release.yml` runs all jobs successfully
4. Verify: GHCR images exist with the correct tags
5. Verify: Forgejo release is created
6. Verify: GitHub mirror receives the tag
7. Delete the test tag locally and remotely

**Verify:** A complete release cycle from tag push to GitHub mirror sync works without manual intervention.

## Dependencies

### Order of operations (sequential dependencies)

```
Phase 0 (docs)
  └── Phase 1 (tooling)
        └── Phase 2 (Python plumbing)
              └── Phase 3 (version sync)
                    └── Phase 4 (workflows)
                          └── Phase 5 (brownout)
                                └── Phase 6 (release)
```

### What can be parallelised

- Within Phase 1: config files can be created in parallel
- Within Phase 4: workflow files are independent of each other
- Phases 5 and 6 depend on Phase 4 completion

### Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Stemmer parity test fails on existing code | Low | High | Run parity test against current code before adding it to CI. Should pass immediately. |
| `commit-and-tag-version` configuration misbehaves | Medium | High | Use `--dry-run` first. Test with patch bump before any real release. |
| Forgejo Actions syntax differs from GitHub Actions | Low | Medium | Most actions are compatible. `gitea-release-action` and `softprops/action-gh-release` both work on Forgejo. |
| Server Dockerfile `COPY` list misses new files | Medium | High | Phase 2 explicitly verifies no new files were added. |
| GHCR PAT has insufficient scopes | Low | High | Document required scopes in `release.yml` comments and `doubt/cicd-versioning-releases.md`. |
| Mirror workflow races with release workflow | Low | Medium | Mirror workflow only fires on `v*` tag push, after release workflow has built images. |
| Branch protection on Forgejo not configured | Medium | Medium | Manual step for user — not in scope of this implementation. |
| Renovate runs on the wrong platform | Low | Low | Document choice in spec. Keep `.github/renovate.json` and assume Forgejo reads it. |

## Verification gates between phases

- **End of Phase 0:** Four governance docs exist and reviewed.
- **End of Phase 1:** `npm test`, `npm run lint`, `npm run format:check`, `npm run typecheck` all pass locally.
- **End of Phase 2:** `python -c "import server.mcp_server"` works. `pytest` passes. No hardcoded versions in Python source.
- **End of Phase 3:** `npx commit-and-tag-version --dry-run` shows the expected three-file diff.
- **End of Phase 4:** All five workflow files exist. `yamllint` passes.
- **End of Phase 5:** No recent GitHub workflow runs. Two Forgejo release cycles have completed successfully.
- **End of Phase 6:** Test tag release produces images + Forgejo release + GitHub mirror tag.

## Out of scope

- Branch protection configuration (user's responsibility)
- Secret management setup in Forgejo (user's responsibility)
- Renovate reconfiguration
- Pre-commit hooks (explicitly excluded per user decision)
- Container signing or supply-chain hardening
- Auto-merge on PRs
- Release notes auto-generation beyond what `commit-and-tag-version` provides
