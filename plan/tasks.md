# Tasks: CI/CD, Versioning & Release Automation

Each task is sized for a single focused session. Ordered by dependency, not by importance.

## Phase 0: Documentation

- [ ] **Task 0.1**: Spec document
  - Acceptance: `spec/cicd-versioning-releases.md` exists with all six required sections (Objective, Tech Stack, Commands, Project Structure, Code Style, Testing Strategy, Boundaries, Success Criteria)
  - Verify: File present, sections complete, reviewed by user
  - Files: `spec/cicd-versioning-releases.md` (create)

- [ ] **Task 0.2**: Plan document
  - Acceptance: `plan/cicd-versioning-releases.md` exists with phases, dependencies, risks, verification gates
  - Verify: File present, all 6 phases documented, risks/mitigations table complete
  - Files: `plan/cicd-versioning-releases.md` (create)

- [ ] **Task 0.3**: Tasks breakdown
  - Acceptance: `plan/tasks.md` exists with discrete tasks, acceptance criteria, verification steps
  - Verify: File present, each task fits in one session
  - Files: `plan/tasks.md` (create)

- [ ] **Task 0.4**: Doubt review
  - Acceptance: `doubt/cicd-versioning-releases.md` exists with adversarial findings
  - Verify: File present, addresses the three critical issues from code-reviewer
  - Files: `doubt/cicd-versioning-releases.md` (create)

## Phase 1: Pre-format + Tooling

- [ ] **Task 1.1**: Create Prettier config
  - Acceptance: `.prettierrc` and `.prettierignore` exist with reasonable defaults (line-length 120, single quotes for JS, ignore docs/data/node_modules)
  - Verify: `npx prettier --check .` runs without error (after the format pass)
  - Files: `.prettierrc`, `.prettierignore` (create)

- [ ] **Task 1.2**: Create ESLint config
  - Acceptance: `eslint.config.js` (flat config) uses `@eslint/js` + `typescript-eslint`, covers root `*.ts` and `src/**/*.ts`
  - Verify: `npx eslint .` runs and reports current file count
  - Files: `eslint.config.js` (create)

- [ ] **Task 1.3**: Create commitlint config
  - Acceptance: `commitlint.config.js` extends `@commitlint/config-conventional`
  - Verify: `npx commitlint --from HEAD~1 --to HEAD` runs on a recent commit
  - Files: `commitlint.config.js` (create)

- [ ] **Task 1.4**: Create commit-and-tag-version config
  - Acceptance: `.versionrc` exists with `bumpFiles` array and `scripts.postbump` pointing to `node scripts/version-sync.mjs`
  - Verify: `npx commit-and-tag-version --dry-run` reads the config
  - Files: `.versionrc` (create)

- [ ] **Task 1.5**: Create version-sync script skeleton
  - Acceptance: `scripts/version-sync.mjs` exists with stub that logs "would sync from <version>"
  - Verify: `node scripts/version-sync.mjs` outputs the expected log
  - Files: `scripts/version-sync.mjs` (create)

- [ ] **Task 1.6**: Update `package.json` with new scripts and devDependencies
  - Acceptance: `scripts.typecheck`, `scripts.format`, `scripts.lint`, `scripts.version:sync`, `scripts.test:py` exist. devDependencies include eslint, prettier, commitlint, typescript-eslint
  - Verify: `npm install` succeeds. `npm run` lists all new scripts
  - Files: `package.json` (edit)

- [ ] **Task 1.7**: Update `tsconfig.json` to include root `*.ts`
  - Acceptance: `"include": ["src/**/*", "*.ts"]` (or equivalent)
  - Verify: `npm run typecheck` checks all `.ts` files in repo
  - Files: `tsconfig.json` (edit)

- [ ] **Task 1.8**: Format existing code (commit with `[skip ci]`)
  - Acceptance: All existing `.ts`, `.js`, `.json`, `.md` files are formatted to match `.prettierrc`
  - Verify: `npm run format:check` passes
  - Files: Multiple (auto-fix)
  - Commit: `[skip ci] chore: format codebase with prettier`

- [ ] **Task 1.9**: Auto-fix any lint issues (commit with `[skip ci]`)
  - Acceptance: `npm run lint` passes on existing code (or only reports pre-existing issues with no auto-fix available)
  - Verify: `npm run lint` exits 0
  - Files: Multiple (auto-fix)
  - Commit: `[skip ci] chore: apply eslint --fix`

## Phase 2: Python version plumbing

- [ ] **Task 2.1**: Add `__version__` to `server/__init__.py`
  - Acceptance: `__version__ = "2.0.0"` is the only content (along with any existing content)
  - Verify: `python -c "from server import __version__; print(__version__)"` outputs "2.0.0"
  - Files: `server/__init__.py` (edit)

- [ ] **Task 2.2**: Update `mcp_server.py` to import VERSION
  - Acceptance: Line 75 uses `version=VERSION`. Import statement: `from server import __version__ as VERSION`
  - Verify: `python -c "from server.mcp_server import mcp; print(mcp._version if hasattr(mcp, '_version') else 'ok')"` succeeds
  - Files: `server/mcp_server.py` (edit)

- [ ] **Task 2.3**: Verify Python tests still pass
  - Acceptance: All existing `pytest server/tests/` tests pass
  - Verify: `cd server && pytest -v` shows all tests pass
  - Files: None (verification only)

## Phase 3: Version sync script + commit-and-tag-version

- [ ] **Task 3.1**: Implement `scripts/version-sync.mjs` (real version)
  - Acceptance: Reads `package.json` version. Writes `server/__init__.py` with `__version__ = "x.y.z"`. Updates `server/pyproject.toml` project.version field via `toml set`
  - Verify: `node scripts/version-sync.mjs` after manual edit of `package.json` updates the Python files correctly
  - Files: `scripts/version-sync.mjs` (edit)

- [ ] **Task 3.2**: Test local patch bump
  - Acceptance: `npx commit-and-tag-version` (patch) updates all three files. Reset to "2.0.0" before committing.
  - Verify: `git diff` shows version change in all three files. `npm test` still passes.
  - Files: `package.json`, `server/__init__.py`, `server/pyproject.toml` (all reset before commit)

- [ ] **Task 3.3**: Add `commit-and-tag-version` to devDependencies
  - Acceptance: Listed in `package.json` devDependencies
  - Verify: `npm install` succeeds. `npx commit-and-tag-version --version` reports the version
  - Files: `package.json` (edit)

## Phase 4: Forgejo workflows

- [ ] **Task 4.1**: Create `.forgejo/workflows/pr.yml`
  - Acceptance: Workflow runs on `pull_request`. Jobs: lint, typecheck, test, format-check, commitlint, stemmer-parity, audit, sast
  - Verify: YAML is valid. `yamllint` passes if available.
  - Files: `.forgejo/workflows/pr.yml` (create)

- [ ] **Task 4.2**: Create `.forgejo/workflows/main.yml`
  - Acceptance: Workflow runs on `push` to `main`. Builds and pushes both Docker images to GHCR with sha/branch tags
  - Verify: YAML is valid
  - Files: `.forgejo/workflows/main.yml` (create)

- [ ] **Task 4.3**: Create `.forgejo/workflows/release.yml`
  - Acceptance: Workflow runs on `push` with tag `v*`. Quality gates → docker build+push with semver tags → Forgejo release creation
  - Verify: YAML is valid
  - Files: `.forgejo/workflows/release.yml` (create)

- [ ] **Task 4.4**: Create `.forgejo/workflows/nightly.yml`
  - Acceptance: Workflow runs on schedule `0 6 * * *`. Dep audit + smoke test
  - Verify: YAML is valid
  - Files: `.forgejo/workflows/nightly.yml` (create)

- [ ] **Task 4.5**: Create `.forgejo/workflows/mirror.yml`
  - Acceptance: Workflow runs on `push` with tag `v*`. Pushes the tag to GitHub mirror via `GH_PAT`
  - Verify: YAML is valid
  - Files: `.forgejo/workflows/mirror.yml` (create)

- [ ] **Task 4.6**: YAML validation pass
  - Acceptance: All five workflow files pass `yamllint` (if installed) or basic syntax check via Python `yaml.safe_load`
  - Verify: `python -c "import yaml; [yaml.safe_load(open(f)) for f in glob.glob('.forgejo/workflows/*.yml')]"` exits 0
  - Files: None (verification)

## Phase 5: Brownout GitHub workflows

- [ ] **Task 5.1**: Disable existing GitHub workflows
  - Acceptance: Each existing `.github/workflows/*.yml` has `if: false` at the job level, or is renamed to `.yml.disabled`
  - Verify: No GitHub workflow runs on a test push
  - Files: `.github/workflows/*.yml` (edit or rename)

- [ ] **Task 5.2**: Wait for 2 successful Forgejo release cycles
  - Acceptance: Two complete releases have run end-to-end on Forgejo
  - Verify: Forgejo shows 2 successful `release.yml` runs
  - Files: None (waiting)

- [ ] **Task 5.3**: Delete old GitHub workflow files
  - Acceptance: `.github/workflows/*.yml` files are removed
  - Verify: `ls .github/workflows/` shows no `.yml` files (renovate.json stays)
  - Files: `.github/workflows/*.yml` (delete)

## Phase 6: First release + end-to-end test

- [ ] **Task 6.1**: Create test tag and verify end-to-end
  - Acceptance: Tag `v2.0.1-test.1` is pushed. All workflows run successfully. GHCR images exist. Forgejo release created. GitHub mirror receives the tag.
  - Verify: All of the above observed
  - Files: None (action only)

- [ ] **Task 6.2**: Cleanup test tag
  - Acceptance: Test tag deleted locally and remotely
  - Verify: `git tag -l` does not show the test tag
  - Files: None (action only)

## Phase 7: Pre-existing TypeScript errors (follow-up)

These were discovered by expanding `tsconfig.json` to include root `*.ts` files. They are NOT in scope for this branch but block `npm run typecheck`. Fix in a separate PR.

- [ ] **Task 7.1**: Fix `crawl-site.ts` line 116 — `Type '"svg"' is not assignable to type 'keyof HTMLElementTagNameMap'`
  - Verify: `npm run typecheck` passes for crawl-site.ts
  - Files: `crawl-site.ts` (edit)

- [ ] **Task 7.2**: Fix `crawl.ts` line 166 — `Type 'Cheerio<AnyNode>' is not assignable to type 'Cheerio<Element>'`
  - Verify: `npm run typecheck` passes for crawl.ts
  - Files: `crawl.ts` (edit)

## Phase 8: Pre-existing format issues (follow-up)

The codebase has 15 files that don't match `.prettierrc` style. These were not formatted in this branch to keep the CI/CD diff focused. Run `npm run format` in a separate `[skip ci]` commit.

- [ ] **Task 8.1**: Format the codebase
  - Verify: `npm run format:check` passes
  - Files: 15 files (auto-fix)
  - Commit: `[skip ci] chore: format codebase with prettier`

## Task sizing notes

- Most tasks are 5-15 minutes of focused work
- Phase 4.1 (PR workflow) is the largest at ~30-45 minutes (most complex YAML)
- Phase 3.1 (version-sync script) is ~20 minutes (need to handle TOML editing)
- Each task includes its own verification step
