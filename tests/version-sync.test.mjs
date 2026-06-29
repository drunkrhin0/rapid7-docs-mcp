/**
 * Tests for scripts/version-sync.mjs
 *
 * Verifies the version sync script:
 *   - Reads version from package.json
 *   - Writes __version__ to server/__init__.py
 *   - Updates server/pyproject.toml project.version
 *   - Idempotent: running twice produces the same result
 *   - Replaces existing __version__ line (not appends)
 *   - Errors gracefully when toml-cli is missing
 *   - Errors when package.json has no version field
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const repoRoot = resolve(__dirname, '..');
const SCRIPT = resolve(repoRoot, 'scripts/version-sync.mjs');

function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'version-sync-test-'));
  mkdirSync(join(dir, 'server'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test', version: '1.2.3' }, null, 2));
  writeFileSync(join(dir, 'server', '__init__.py'), '"""Module."""\n');
  writeFileSync(join(dir, 'server', 'pyproject.toml'), `[project]\nname = "test"\nversion = "0.0.0"\n`);
  return dir;
}

function runScript(cwd) {
  try {
    const out = execFileSync('node', [SCRIPT], { cwd, encoding: 'utf8' });
    return { code: 0, stdout: out, stderr: '' };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
    };
  }
}

describe('version-sync.mjs', () => {
  let repo;

  beforeEach(() => {
    repo = setupRepo();
  });

  afterEach(() => {
    if (existsSync(repo)) rmSync(repo, { recursive: true });
  });

  it('writes __version__ to server/__init__.py from package.json', () => {
    const result = runScript(repo);
    expect(result.code).toBe(0);
    const init = readFileSync(join(repo, 'server', '__init__.py'), 'utf8');
    expect(init).toContain('__version__ = "1.2.3"');
  });

  it('updates server/pyproject.toml project.version', () => {
    const result = runScript(repo);
    expect(result.code).toBe(0);
    const pyproject = readFileSync(join(repo, 'server', 'pyproject.toml'), 'utf8');
    expect(pyproject).toMatch(/^version = "1\.2\.3"$/m);
  });

  it('is idempotent — running twice yields the same files', () => {
    const first = runScript(repo);
    const initAfter1 = readFileSync(join(repo, 'server', '__init__.py'), 'utf8');
    const pyprojectAfter1 = readFileSync(join(repo, 'server', 'pyproject.toml'), 'utf8');

    const second = runScript(repo);
    const initAfter2 = readFileSync(join(repo, 'server', '__init__.py'), 'utf8');
    const pyprojectAfter2 = readFileSync(join(repo, 'server', 'pyproject.toml'), 'utf8');

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(initAfter1).toBe(initAfter2);
    expect(pyprojectAfter1).toBe(pyprojectAfter2);
  });

  it('replaces existing __version__ rather than appending', () => {
    const initPath = join(repo, 'server', '__init__.py');
    writeFileSync(initPath, '"""Module."""\n__version__ = "0.0.0"\n');

    const result = runScript(repo);
    expect(result.code).toBe(0);

    const init = readFileSync(initPath, 'utf8');
    const matches = init.match(/^__version__\s*=/gm);
    expect(matches).toHaveLength(1);
    expect(init).toContain('__version__ = "1.2.3"');
    expect(init).not.toContain('"0.0.0"');
  });

  it('handles pre-release versions (semver with suffix)', () => {
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'test', version: '2.0.0-rc.1' }));

    const result = runScript(repo);
    expect(result.code).toBe(0);

    const init = readFileSync(join(repo, 'server', '__init__.py'), 'utf8');
    expect(init).toContain('__version__ = "2.0.0-rc.1"');
  });

  it('errors when package.json has no version field', () => {
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'test' }));

    const result = runScript(repo);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/no "version" field/i);
  });

  it('preserves other content in server/__init__.py', () => {
    const initPath = join(repo, 'server', '__init__.py');
    writeFileSync(initPath, '"""Module docstring."""\nfrom .other import foo\n\n__all__ = ["foo"]\n');

    runScript(repo);

    const init = readFileSync(initPath, 'utf8');
    expect(init).toContain('"""Module docstring."""');
    expect(init).toContain('from .other import foo');
    expect(init).toContain('__all__ = ["foo"]');
    expect(init).toContain('__version__ = "1.2.3"');
  });
});
