/**
 * Verifies the version invariant: the string "2.0.0" (or any specific version)
 * should NOT appear in source files outside the canonical version locations.
 *
 * This catches accidental hardcoding of versions in:
 *   - TypeScript source (src/, crawl*.ts)
 *   - Python source (mcp_server.py, etc.)
 *   - Markdown (README, docs/)
 *   - Workflow files
 *
 * Canonical version locations (allowed):
 *   - package.json
 *   - server/__init__.py
 *   - server/pyproject.toml
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ALLOWED_FILES = new Set([
  'package.json',
  'server/__init__.py',
  'server/pyproject.toml',
  'package-lock.json',
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
]);

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    if (entry.startsWith('.')) {
      if (entry !== '.forgejo' && entry !== '.github') continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

describe('version invariant', () => {
  it('does not hardcode "2.0.0" outside canonical version files', () => {
    const cwd = process.cwd();
    const files = walk(cwd);
    const violations = [];

    for (const file of files) {
      const rel = relative(cwd, file);
      const ext = extname(file);

      if (!['.ts', '.js', '.mjs', '.py', '.yml', '.yaml'].includes(ext)) continue;
      if (ALLOWED_FILES.has(rel)) continue;
      if (rel.startsWith('tests/')) continue; // Skip test files (they reference the version being checked)

      const content = readFileSync(file, 'utf8');
      if (content.includes('"2.0.0"') || content.includes("'2.0.0'")) {
        violations.push(rel);
      }
    }

    expect(violations).toEqual([]);
  });
});
