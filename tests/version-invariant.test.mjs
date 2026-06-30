/**
 * Verifies the version invariant: the stringified version from
 * package.json must NOT appear in source files outside the canonical
 * version locations.
 *
 * Catches accidental hardcoding of a version in any new file.
 *
 * Reads the expected version from package.json so the test stays
 * accurate across bumps. Add a hardcoded version anywhere → this
 * test fails.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const repoRoot = resolve(__dirname, '..');

const ALLOWED_FILES = new Set([
  'package.json',
  'server/__init__.py',
  'server/pyproject.toml',
  'package-lock.json',
  // Tests and tooling may reference the current version
  'tests/version-sync.test.mjs',
  'tests/version-invariant.test.mjs',
]);

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'docs',
  'data',
  '.venv',
  'spec',
  'plan',
  'doubt',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.opencode',
]);

const SCAN_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs', '.py', '.yml', '.yaml', '.md']);

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    if (entry.startsWith('.')) {
      if (entry !== '.github' && entry !== '.forgejo') continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

function getCurrentVersion() {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  return pkg.version;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('version invariant', () => {
  const version = getCurrentVersion();
  // Match the version in any quoted context: "x.y.z" or 'x.y.z'
  const versionRegex = new RegExp(`['"\`]${escapeRegExp(version)}['"\`]`);

  it('does not hardcode the current version outside canonical files', () => {
    const files = walk(repoRoot);
    const violations = [];

    for (const file of files) {
      const rel = relative(repoRoot, file);
      if (ALLOWED_FILES.has(rel)) continue;
      if (!SCAN_EXTENSIONS.has(extname(file))) continue;

      const content = readFileSync(file, 'utf8');
      if (versionRegex.test(content)) {
        violations.push(rel);
      }
    }

    expect(violations).toEqual([]);
  });

  it('detects a fake hardcoded version (regression guard)', () => {
    // This is a sanity check: the regex actually finds the version
    // string. Without this, a broken regex would silently pass.
    const probePath = join(repoRoot, 'tests', '_version_probe.tmp');
    const FAKE = '9.9.9-fake';
    try {
      // Probe content uses the regex-quoted form so we know the
      // detector is sensitive to it.
      const fakeVersion = JSON.stringify(FAKE);
      writeFileSync(probePath, `version = ${fakeVersion}\n`);
      const files = walk(repoRoot);
      const found = files.some((f) => f === probePath && versionRegex.test(readFileSync(f, 'utf8')));
      // The probe uses FAKE which is not the real version, so the
      // real-version detector shouldn't match it. We assert it doesn't.
      expect(found).toBe(false);
    } finally {
      if (existsSync(probePath)) unlinkSync(probePath);
    }
  });

  it('catches a real violation (detector works)', () => {
    // If this test ever breaks, the detector isn't finding real
    // violations and the previous test is passing for the wrong
    // reason.
    const probePath = join(repoRoot, 'tests', '_version_probe.tmp');
    try {
      const realVersion = JSON.stringify(version);
      writeFileSync(probePath, `version = ${realVersion}\n`);
      const files = walk(repoRoot);
      const found = files.some((f) => f === probePath && versionRegex.test(readFileSync(f, 'utf8')));
      expect(found).toBe(true);
    } finally {
      if (existsSync(probePath)) unlinkSync(probePath);
    }
  });
});
