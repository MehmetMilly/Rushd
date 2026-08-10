#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [baseSha, outputPath] = process.argv.slice(2);
if (!baseSha) {
  console.error('Usage: compute-patch-hash.mjs <base-sha> [manifest-path]');
  process.exit(2);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
git('rev-parse', '--verify', `${baseSha}^{commit}`);

const nulList = (value) => value.split('\0').filter(Boolean);
const tracked = nulList(git('diff', '--name-only', '-z', '--no-renames', baseSha, '--', '.'));
const untracked = nulList(git('ls-files', '--others', '--exclude-standard', '-z'));
const paths = [...new Set([...tracked, ...untracked])].sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));

const files = paths.map((path) => {
  const absolute = resolve(path);
  try {
    const stat = lstatSync(absolute);
    let kind = 'file';
    let bytes;
    if (stat.isSymbolicLink()) {
      kind = 'symlink';
      bytes = Buffer.from(readlinkSync(absolute));
    } else if (stat.isFile()) {
      bytes = readFileSync(absolute);
    } else {
      throw new Error(`Unsupported changed path type: ${path}`);
    }
    return {
      path,
      state: 'present',
      kind,
      executable: kind === 'file' && Boolean(stat.mode & 0o111),
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { path, state: 'deleted' };
    throw error;
  }
});

const manifest = {
  schema: 'rushd.patch-manifest.v1',
  base_sha: git('rev-parse', baseSha).trim(),
  files
};
const canonical = JSON.stringify(manifest);
const patchSha256 = createHash('sha256').update(canonical).digest('hex');
const output = `${JSON.stringify({ ...manifest, patch_sha256: patchSha256 }, null, 2)}\n`;

if (outputPath) writeFileSync(resolve(outputPath), output);
process.stdout.write(output);
