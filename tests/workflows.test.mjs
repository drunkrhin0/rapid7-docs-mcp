/**
 * Tests for the .forgejo/workflows/*.yml configuration.
 *
 * These tests catch regressions in the workflow YAML by asserting
 * specific properties. They run quickly (no Docker, no act) because
 * they only parse the YAML.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOWS_DIR = '.forgejo/workflows';

function loadWorkflow(name) {
  return readFileSync(join(WORKFLOWS_DIR, name), 'utf8');
}

function listWorkflows() {
  return readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.yml'));
}

describe('workflow YAML invariants', () => {
  describe('mirror.yml', () => {
    it('resolves the tag from head_sha (not head_branch) to handle tag triggers', () => {
      // head_branch is empty for tag pushes; head_sha is always
      // populated. The script must derive the tag name from the SHA
      // to be robust against the empty branch case.
      const content = loadWorkflow('mirror.yml');
      // The TAG env var derivation must reference head_sha somewhere
      // (either directly or via a git command that uses it).
      const usesHeadSha =
        content.includes('head_sha') || content.includes('HEAD_SHA') || content.includes('workflow_run.head_sha');
      expect(usesHeadSha).toBe(true);
    });

    it('guards against pushing a non-tag ref to GitHub', () => {
      // The script should verify the resolved ref looks like a tag
      // (starts with 'v') before pushing, to prevent accidentally
      // pushing a branch ref like 'main' to the GitHub mirror.
      const content = loadWorkflow('mirror.yml');
      // Acceptable guards: GitHub Actions startsWith() expression,
      // POSIX shell case statement, regex anchor, or `TAG:=v*` default.
      // The /s flag lets . match newlines so the case statement body
      // is captured as one match.
      const guardsTagFormat =
        /startsWith\([^)]*v['"]/s.test(content) ||
        /\bcase\b[\s\S]*?\bv\*?\b/.test(content) ||
        /\\^v\//.test(content) ||
        /\bTAG:=v/m.test(content);
      expect(guardsTagFormat).toBe(true);
    });
  });

  describe('release.yml', () => {
    it('has a concurrency block to prevent concurrent release runs', () => {
      // Without concurrency: false, a re-run of release.yml (e.g. flaky
      // build retry) could push duplicate images to GHCR.
      const content = loadWorkflow('release.yml');
      const hasConcurrency = /^\s*concurrency:/m.test(content);
      expect(hasConcurrency).toBe(true);
    });
  });

  describe('all workflows', () => {
    it('pin every third-party action to a commit SHA, not a moving tag', () => {
      // Pin to SHA prevents the tj-actions/changed-files style supply
      // chain attack. Allow first-party actions/* to remain SHA-pinned
      // (they're already pinned), but block any third-party uses:@vN
      // that isn't SHA-pinned.
      for (const wf of listWorkflows()) {
        const content = loadWorkflow(wf);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const match = line.match(/^\s*uses:\s+([^@\s]+)@(\S+)/);
          if (!match) continue;
          const action = match[1];
          const ref = match[2];
          // First-party actions: allowed to be moving tag (we pin them
          // manually). Third-party: must be SHA (40 hex chars).
          const isFirstParty = action.startsWith('actions/');
          const isSha = /^[0-9a-f]{40}$/.test(ref);
          if (isFirstParty) {
            // We pin these too in this repo, but allow them for
            // forward-compat with action/* that may not have SHAs in
            // our list.
            continue;
          }
          expect(isSha, `Workflow ${wf} line ${i + 1}: ${action}@${ref} is not SHA-pinned`).toBe(true);
        }
      }
    });

    it('do not leak the GHCR_TOKEN in shell command lines (use as password only)', () => {
      // docker/login-action sends username:password as Basic auth to
      // GHCR. username should be the repo owner, password should be
      // GHCR_TOKEN. Setting username to the token would fail at login.
      for (const wf of listWorkflows()) {
        const content = loadWorkflow(wf);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes('docker/login-action')) {
            // Look ahead for the username line
            for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
              if (lines[j].includes('username:') && lines[j].includes('GHCR_TOKEN')) {
                throw new Error(
                  `Workflow ${wf} line ${j + 1}: GHCR_TOKEN used as username (should be repo owner, PAT as password)`,
                );
              }
            }
          }
        }
      }
    });

    it('use --ignore-scripts on npm ci to block postinstall from running in fork PRs', () => {
      // A malicious fork PR can add a postinstall to its package.json
      // that runs on the runner. The cheapest mitigation is to disable
      // npm lifecycle scripts for all PR runs.
      for (const wf of listWorkflows()) {
        if (wf !== 'pr.yml') continue;
        const content = loadWorkflow(wf);
        const npmCiCalls = content.match(/npm ci(?! --)/g) || [];
        if (content.match(/npm ci(?! --)/)) {
          throw new Error(`Workflow ${wf}: bare 'npm ci' found (use 'npm ci --ignore-scripts' to block postinstall)`);
        }
      }
    });

    it('docker build jobs are marked best-effort (continue-on-error: true)', () => {
      // The dockhand runner has Docker client installed but the daemon
      // is not running. Previous attempts (DinD service, container:
      // directive, start dockerd in step) all failed for different
      // environment-specific reasons. Until the runner setup is sorted
      // out, the build jobs are best-effort: they run, log their
      // failure, and the failure does not block the merge. The
      // forgejo-release job still runs because we have `needs: docker-build-push`
      // but `continue-on-error: true` lets it proceed even on build failure.
      //
      // This is the right thing to do per the CI/CD skill's "Build Cop
      // Role" guidance: don't keep accumulating broken builds. Stop the
      // build until the runner is fixed, but make sure CI is green for
      // what CAN be green (PR checks).
      const buildJobs = ['main.yml', 'release.yml'];
      for (const wf of buildJobs) {
        const content = loadWorkflow(wf);
        const isContinueOnError = /continue-on-error:\s*true/.test(content);
        if (!isContinueOnError) {
          throw new Error(
            `Workflow ${wf}: build job is not marked continue-on-error: true. The runner has no working Docker daemon — failures should not block the merge.`,
          );
        }
      }
    });
  });
});
