#!/usr/bin/env node
/**
 * Sync version from package.json to Python source files.
 *
 * Reads `package.json` version field and writes:
 *   - server/__init__.py: __version__ = "x.y.z"
 *   - server/pyproject.toml: project.version = "x.y.z" (via @iarna/toml)
 *
 * Invoked by commit-and-tag-version's `postbump` hook.
 * Can also be run manually: `node scripts/version-sync.mjs`
 *
 * No external CLI dependencies — uses @iarna/toml (a pure-JS TOML parser)
 * so the script works in any environment with Node and the package's
 * devDependencies installed.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import * as toml from '@iarna/toml';

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

function writePythonVersion(version) {
  const root = findRepoRoot(cwd) || repoRoot;
  const initPath = join(root, 'server', '__init__.py');
  const content = readFileSync(initPath, 'utf8');

  const updated = content.match(/^__version__\s*=/m)
    ? content.replace(/^__version__\s*=.*$/m, `__version__ = "${version}"`)
    : content + `\n__version__ = "${version}"\n`;

  writeFileSync(initPath, updated, 'utf8');
  console.log(`  → server/__init__.py: __version__ = "${version}"`);
}

function writePyprojectVersion(version) {
  const root = findRepoRoot(cwd) || repoRoot;
  const pyprojectPath = join(root, 'server', 'pyproject.toml');
  // Use @iarna/toml — a pure-JS parser, no external CLI needed.
  const data = toml.parse(readFileSync(pyprojectPath, 'utf8'));
  if (!data.project) data.project = {};
  data.project.version = version;
  writeFileSync(pyprojectPath, toml.stringify(data), 'utf8');
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
