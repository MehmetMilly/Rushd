#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { isSha256, loadJson, sha256File } from './workflow-lib.mjs';

const [baseInput, manifestInput, destinationInput] = process.argv.slice(2);
if (!baseInput || !manifestInput || !destinationInput) {
  console.error('Usage: create-worktree-snapshot.mjs <base-sha> <patch-manifest.json> <new-worktree-path>');
  process.exit(2);
}

const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const baseSha = execFileSync('git', ['rev-parse', '--verify', `${baseInput}^{commit}`], { encoding: 'utf8' }).trim();
const manifest = loadJson(manifestInput);
const destination = resolve(destinationInput);
const destinationRelative = relative(repositoryRoot, destination);
if (destination === repositoryRoot || destinationRelative === '' || (!destinationRelative.startsWith('..') && !isAbsolute(destinationRelative))) {
  throw new Error('Snapshot worktree must be outside the implementation checkout');
}
if (existsSync(destination)) throw new Error(`Snapshot destination already exists: ${destination}`);
if (manifest.schema !== 'rushd.patch-manifest.v1' || manifest.base_sha !== baseSha || !isSha256(manifest.patch_sha256)) throw new Error('Manifest/base is invalid');

for (const file of manifest.files) {
  if (typeof file.path !== 'string' || isAbsolute(file.path) || file.path.split('/').includes('..')) throw new Error(`Unsafe manifest path: ${String(file.path)}`);
  if (file.state === 'present') {
    const source = resolve(repositoryRoot, file.path);
    let sourceStat;
    try { sourceStat = lstatSync(source); } catch { throw new Error(`Snapshot source is missing: ${file.path}`); }
    let actualHash;
    if (sourceStat.isSymbolicLink()) {
      const target = readlinkSync(source);
      actualHash = createHash('sha256').update(Buffer.from(target)).digest('hex');
    } else actualHash = sha256File(source);
    if (actualHash !== file.sha256) throw new Error(`Snapshot source changed after manifest: ${file.path}`);
  }
}

execFileSync('git', ['worktree', 'add', '--detach', destination, baseSha], { stdio: 'inherit' });
try {
  for (const file of manifest.files) {
    const target = resolve(destination, file.path);
    if (file.state === 'deleted') {
      rmSync(target, { force: true, recursive: true });
      continue;
    }
    const source = resolve(repositoryRoot, file.path);
    mkdirSync(dirname(target), { recursive: true });
    rmSync(target, { force: true, recursive: true });
    if (file.kind === 'symlink') symlinkSync(readlinkSync(source), target);
    else {
      copyFileSync(source, target);
      chmodSync(target, file.executable ? 0o755 : 0o644);
    }
  }
  const script = resolve(import.meta.dirname, 'compute-patch-hash.mjs');
  const snapshot = JSON.parse(execFileSync(process.execPath, [script, baseSha], { cwd: destination, encoding: 'utf8' }));
  if (JSON.stringify(snapshot.files) !== JSON.stringify(manifest.files) || snapshot.patch_sha256 !== manifest.patch_sha256) throw new Error('Constructed worktree does not match manifest');
  process.stdout.write(`${JSON.stringify({ worktree_path: destination, base_sha: baseSha, patch_sha256: manifest.patch_sha256 }, null, 2)}\n`);
} catch (error) {
  try { execFileSync('git', ['worktree', 'remove', '--force', destination]); } catch { /* preserve original error */ }
  throw error;
}
