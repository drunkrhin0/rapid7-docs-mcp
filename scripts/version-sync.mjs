#!/usr/bin/env node
/**
 * Sync version from package.json to Python source files.
 *
 * Reads `package.json` version field and writes:
 *   - server/__init__.py: __version__ = "x.y.z"
 *   - server/pyproject.toml: project.version = "x.y.z"
 *
 * Uses differential updates (string-replace on the version line only)
 * rather than parse-and-reserialize, so:
 *   - Comments and formatting in pyproject.toml are preserved
 *   - No TOML library needed (no extra dependency to audit)
 *   - The output is byte-identical except for the version line
 *
 * Invoked by commit-and-tag-version's `postbump` hook.
 * Can also be run manually: `node scripts/version-sync.mjs`
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const cwd = process.cwd();

function findRepoRoot(start) {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readPackageVersion() {
  const root = findRepoRoot(cwd) || repoRoot;
  const pkgPath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (!pkg.version) {
    throw new Error('package.json has no "version" field');
  }
  return pkg.version;
}

/** Write to a temp file, then rename atomically. POSIX rename is atomic. */
function writeFileAtomic(path, content) {
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmpPath, content, 'utf8');
    renameSync(tmpPath, path);
  } catch (err) {
    try {
      // Clean up the temp file on failure
      const fs = require('node:fs');
      if (existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
    throw new Error(`Failed to write ${path}: ${err.message}`);
  }
}

function writePythonVersion(version) {
  const root = findRepoRoot(cwd) || repoRoot;
  const initPath = join(root, 'server', '__init__.py');

  let content;
  try {
    content = readFileSync(initPath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read ${initPath}: ${err.message}`);
  }

  const VERSION_RE = /^__version__\s*=(.*)$/m;
  const updated = VERSION_RE.test(content)
    ? content.replace(VERSION_RE, `__version__ = "${version}"`)
    : content.replace(/\n?$/, '') + `\n__version__ = "${version}"\n`;

  writeFileAtomic(initPath, updated);
  console.log(`  → server/__init__.py: __version__ = "${version}"`);
}

function writePyprojectVersion(version) {
  const root = findRepoRoot(cwd) || repoRoot;
  const pyprojectPath = join(root, 'server', 'pyproject.toml');

  let content;
  try {
    content = readFileSync(pyprojectPath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read ${pyprojectPath}: ${err.message}`);
  }

  // Differential update: replace the line under [project] that sets
  // version. Matches `version = "..."` immediately following the
  // [project] header (with optional whitespace/comments between).
  // Falls back to inserting after [project] if the field is missing.
  const PROJECT_VERSION_RE = /(\[project\][^\[]*?)(\nversion\s*=\s*")[^"]*(")/s;

  let updated;
  if (PROJECT_VERSION_RE.test(content)) {
    updated = content.replace(PROJECT_VERSION_RE, `$1$2${version}$3`);
  } else {
    // Insert a `version = "x.y.z"` line under [project]. Place it
    // immediately after the header. We don't try to be clever about
    // other fields because the project's pyproject.toml always has
    // version directly under [project].
    updated = content.replace(/(\[project\][ \t]*\r?\n)/, `$1version = "${version}"\n`);
  }

  writeFileAtomic(pyprojectPath, updated);
  console.log(`  → server/pyproject.toml: project.version = "${version}"`);
}

function main() {
  const version = readPackageVersion();
  console.log(`Syncing version ${version} to Python sources...`);
  writePythonVersion(version);
  writePyprojectVersion(version);
  console.log('Done.');
}

main();
