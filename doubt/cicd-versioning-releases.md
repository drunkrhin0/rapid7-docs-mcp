# Doubt: CI/CD, Versioning & Release Automation

Adversarial review of the plan from a fresh context perspective. The goal is to find failure modes that optimism hides.

## Critical issues (would cause production failures)

### 1. Server Dockerfile `COPY` list brittleness

**Risk**: The `server/Dockerfile` has an explicit `COPY` list:

```dockerfile
COPY server/mcp_server.py ./server/
COPY server/search.py ./server/
COPY server/text.py ./server/
COPY server/middleware.py ./server/
COPY server/__init__.py ./server/
COPY server/pyproject.toml .
```

If anyone adds a new file to `server/` in the future and forgets to add a `COPY` line, the container will raise `ModuleNotFoundError` on boot. This is the same class of bug that the original `version.py` import would have caused.

**Mitigation**: Add a comment block in the spec explicitly stating this constraint, OR change the Dockerfile to use `COPY server/ ./server/` (less surgical but more robust).

**Recommendation**: Keep the explicit list (it's audit-friendly) but add a CI check that fails if `server/` has any `.py` file not in the Dockerfile. Implementation: a simple shell script that diffs `git ls-files server/*.py` against the COPY lines.

### 2. Stemmer parity is not CI-enforced in the current codebase

**Risk**: The AGENTS.md says `src/text.ts` and `server/text.py` must produce identical output. Today, there is no automated check. The proposed plan adds one in Phase 4 (`stemmer-parity` job in `pr.yml`), but only "if `src/text.ts` or `server/text.py` changed" via path filter.

**Sub-risk**: If the path filter is wrong, parity won't be checked when it should be. If the path filter is missing entirely, parity won't be checked at all.

**Mitigation**: Make the stemmer-parity check run on EVERY PR, not just when those files change. The cost is low (sub-second) and the benefit is catching indirect breakage (e.g., a refactor in `crawl.ts` that affects what gets stemmed).

**Recommendation**: Run on every PR. No path filter.

### 3. `tsconfig.json` currently excludes root `.ts` files

**Risk**: `tsconfig.json` line 13: `"include": ["src/**/*"]`. The root `crawl.ts`, `crawl-extensions.ts`, `crawl-site.ts`, `crawl-external.ts` are NOT typechecked. The plan fixes this in Phase 1.7 by adding `"*.ts"` to include.

**Sub-risk**: When `tsc --noEmit` runs with the new include, it may find new type errors in root files that were never checked before. This could cause existing PRs to suddenly fail CI.

**Mitigation**: Run `npm run typecheck` locally with the new include before committing the change. Fix any latent type errors in root `.ts` files in the same commit.

**Recommendation**: Add `npm run typecheck` to the format/lint pass (Task 1.9) so any latent errors are caught and fixed at the same time as the format/lint pass.

## Important issues (could cause delays or confusion)

### 4. Renovate platform is undefined

**Risk**: The plan keeps `.github/renovate.json` and assumes Forgejo's Renovate integration reads it. If it doesn't, dependency updates stop.

**Mitigation**: Either:
- Document explicitly that Renovate runs as a Forgejo app and reads the config from `.github/` (verify with a test PR)
- Move the config to `.forgejo/renovate.json` for clarity
- Document the GitHub mirror's Renovate as a fallback

**Recommendation**: Test by triggering a manual Renovate run after the workflows are in place. If it doesn't work, move the config.

### 5. GHCR PAT scopes are not specified in the plan

**Risk**: If the GitHub mirror PAT has insufficient scopes, the mirror workflow fails silently. If it has too many scopes, it's a security risk.

**Required scopes** (assuming classic PAT):
- `repo` (for pushing to drunkrhin0/rapid7-docs-mcp)
- OR a fine-grained PAT with `contents: write` scoped to the single repository

**Required secrets in Forgejo**:
- `GH_PAT` (the token itself)
- `GITHUB_TOKEN` (auto-injected by Forgejo for the release workflow)

**Recommendation**: Add a section to the spec documenting these. The user has indicated a fine-grained PAT is in use, so document that explicitly.

### 6. Mirror workflow can race with release workflow

**Risk**: If `release.yml` and `mirror.yml` both trigger on `v*` tag push, they may execute in parallel. If the mirror pushes the tag to GitHub before the release workflow finishes, GitHub's old workflows (if not yet disabled) may fire and cause double builds.

**Mitigation**: Either:
- Use a `needs:` dependency in `mirror.yml` to wait for `release.yml` to complete
- Disable GitHub workflows (brownout) BEFORE pushing the first test tag

**Recommendation**: Both. Add explicit `needs: release` in mirror.yml. Also disable GitHub workflows in Phase 5 BEFORE the first test release.

### 7. Forgejo release API authentication method

**Risk**: Forgejo release creation requires authentication. The plan uses `softprops/action-gh-release` or `gitea-release-action` with the auto-injected `GITHUB_TOKEN`. But Forgejo's `GITHUB_TOKEN` may have different default scopes than GitHub's.

**Mitigation**: Test on a non-production tag first. Verify the release is created. If the token lacks `contents: write`, add it explicitly to the workflow's `permissions:` block.

**Recommendation**: Set `permissions: contents: write` explicitly in the release workflow to avoid surprises.

### 8. NPM audit / pip-audit failure handling

**Risk**: The plan includes `npm audit --audit-level=high` and `pip-audit` in the PR workflow. If a new vulnerability is disclosed, every PR will fail until the dependency is updated. This can block legitimate work.

**Mitigation**: Either:
- Mark these as `continue-on-error: true` (current behavior in the GitHub workflow)
- Set up automatic PR creation via Renovate so vulnerabilities are fixed proactively
- Document the policy for handling audit failures

**Recommendation**: Keep `continue-on-error: true` for now. Address the underlying issue with Renovate auto-PRs in a follow-up.

### 9. `gitleaks` is in `.gitleaks.toml` but not run in CI

**Risk**: The config exists but isn't enforced. The plan adds gitleaks to the PR workflow.

**Sub-risk**: The existing `.gitleaks.toml` allowlists `tests/.*` and `server/tests/.*` and `.gitallowed`. This is correct for those paths, but if a real secret ends up in a test file (e.g., a test API key), the scan won't catch it.

**Mitigation**: Audit the test files for any actual secrets. Move real test secrets to environment variables sourced from `.env` (which is gitignored).

**Recommendation**: Do a one-time scan with gitleaks before enabling the CI check. Fix any findings.

### 10. Python tests are not in `package.json` test script

**Risk**: The plan's `npm test` runs vitest. The Python tests (`pytest server/tests/`) are separate. Developers may run only one and miss the other.

**Mitigation**: Add a `test:py` script and a `test:all` script that runs both. Document this in the README.

**Recommendation**: Add `npm run test:all` that runs both vitest and pytest in sequence (with proper error handling).

## Nice-to-haves (worth considering)

### 11. Conventional commits scope isn't enforced

**Risk**: `@commitlint/config-conventional` allows scopes. The plan doesn't define what scopes are valid for this project. A scope of `feat(server): ...` works, but `feat(banana): ...` also works.

**Mitigation**: Add a `scope-enum` rule to `commitlint.config.js` listing the valid scopes (e.g., `crawler`, `server`, `ci`, `docs`, `deps`).

**Recommendation**: Add a basic scope-enum. Allow free-form for now, refine later.

### 12. No `dependabot.yml` for Forgejo

**Risk**: The plan uses Renovate. If Renovate is disabled, dependencies go stale.

**Mitigation**: None needed if Renovate works. Document Renovate as the primary tool.

### 13. Docker layer caching not configured

**Risk**: The `docker/build-push-action` v6 supports layer caching via `cache-from` and `cache-to`. Without it, every build re-installs all npm/pip dependencies.

**Mitigation**: Add cache configuration to `main.yml` and `release.yml` Docker build steps.

**Recommendation**: Add `cache-from: type=gha` and `cache-to: type=gha,mode=max` to speed up CI.

### 14. No SBOM or provenance generation

**Risk**: Modern supply-chain security practice generates SBOMs and provenance attestations for container images. The plan doesn't include this.

**Mitigation**: Add `--provenance=true --sbom=true` to the Docker buildx configuration.

**Recommendation**: Add these flags. Low cost, high security value.

### 15. No dependabot/renovate auto-merge for patch updates

**Risk**: Renovate is configured to automerge patch updates, but only if branch protection allows. If Forgejo's branch protection requires manual approval for everything, automerge never happens.

**Mitigation**: Configure branch protection on `main` to allow automerge for Renovate PRs.

**Recommendation**: Document this in a follow-up.

## Verdict

The plan is structurally sound. The three critical issues (Dockerfile brittleness, stemmer-parity CI enforcement, tsconfig scope) are all addressed in the plan with appropriate tasks. The important issues are real but addressable. Recommend proceeding with implementation while keeping the critical issues as testable acceptance criteria.

## Open questions (for the user)

1. Do you want me to add an `if: false` job-level disable to old GitHub workflows immediately, or wait until Phase 5?
2. Should the stemmer-parity check run on every PR, or only when text files change?
3. Are you OK with the `commit-and-tag-version` approach (creates a commit and tag for every release) or do you prefer a more hands-on process (manual tag, CI does the rest)?
4. Do you want the GitHub mirror PAT (`GH_PAT`) created in Forgejo secrets now, or after the workflows are in place?
5. The `softprops/action-gh-release` action is the most common choice for Forgejo releases — confirm this is acceptable, or do you have a preference for `gitea-release-action` or direct API calls?

## TDD audit (added after review)

Running the TDD review surfaced additional gaps:

1. **No tests for `scripts/version-sync.mjs`** — the script was implemented without tests. After writing `tests/version-sync.test.mjs` (7 cases), the very first test run failed because the script was hardcoded to read `package.json` from its own `__dirname` rather than from the test's cwd. TDD caught a real bug. The script now walks up from cwd to find the repo root. **All 7 tests now pass.**

2. **No version invariant test** — added `tests/version-invariant.test.mjs` which greps for hardcoded "2.0.0" outside the canonical version files. Catches accidental hardcoding in any new file.

3. **No `actionlint` in CI** — added a `workflow-lint` job to `pr.yml` that runs `actionlint` and `shellcheck`. Both are critical for catching workflow syntax errors before they reach production.

4. **Latent TypeScript errors surfaced by expanded tsconfig include** — two pre-existing type errors in `crawl-site.ts` and `crawl.ts` that were previously hidden because the old `tsconfig.json` excluded root `*.ts` files. These block `npm run typecheck`. Per the user's own coding rules ("don't improve adjacent code, flag pre-existing issues"), these are documented in `plan/tasks.md` as Phase 7 follow-up tasks rather than fixed in this branch.

5. **15 files need formatting** — the codebase hasn't been run through `prettier` yet. Documented as Phase 8 follow-up to keep the CI/CD diff focused.

## Runner notes (dockhand)

Quirks of the dockhand self-hosted Forgejo runner that future CI work on this repo will need:

- **`runs-on: docker` is broken.** The runner tries to use the project's `Dockerfile` as the job image, and fails with `exec: "docker-entrypoint.sh": executable file not found in $PATH` (the entrypoint script doesn't exist in the runner context). Use `runs-on: ubuntu-22.04` (one of the runner's labels) — it maps to a pre-built Ubuntu 22.04 image with standard tooling.
- **`data.forgejo.org` mirror is incomplete.** It doesn't have `gitleaks/gitleaks-action` or `aquasecurity/trivy-action`. Use direct Docker image references (`docker://zricethezav/gitleaks:...`, `docker://aquasec/trivy:...`) or skip the tools. The mirror does have `actions/checkout`, `actions/setup-node`, `actions/setup-python`, `docker/login-action`, `docker/metadata-action`, `docker/build-push-action`.
- **Forgejo 1.22 has no `actions/runs/{id}/logs` API.** The `/actions/tasks` endpoint works (lists job status by head SHA) but per-job log retrieval returns 404. To debug CI failures, use `./scripts/ci-local.sh` locally with `act` and the `ghcr.io/catthehacker/ubuntu:act-latest` image — it produces the same errors as the remote runner, much faster than the push-and-wait cycle.
- **SSH to dockhand (192.168.1.215) is locked down.** Can't `cat /var/lib/forgejo-runner/act/.../0_setup.txt` for live logs.
- **`continue-on-error: true` on jobs is honored by Forgejo Actions** — a failing step inside a `continue-on-error: true` job reports the step as failed but the job itself passes. Use this for audit/SAST-style jobs where findings are reports, not blockers.
- **Dep audit findings are real, not stale.** `npm audit` and `pip-audit` will find HIGH vulnerabilities in the current dep tree (esbuild, form-data, js-yaml, undici, vite, urllib3, yt-dlp). Renovate auto-PRs should keep these moving; for now, the audit job uses `|| true` so findings are visible without blocking PRs.
