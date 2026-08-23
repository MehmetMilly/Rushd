import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const sandbox = await mkdtemp(resolve(tmpdir(), 'rushd-p00-guard-'));
const protectedArtifact = resolve(sandbox, 'docs/baseline/current/ar/dark/390x844/empty-dashboard.png');
await mkdir(resolve(protectedArtifact, '..'), { recursive: true });
await writeFile(protectedArtifact, 'immutable-p00-adversarial-sentinel\n');

const hash = async () => createHash('sha256').update(await readFile(protectedArtifact)).digest('hex');
const before = await hash();
const result = spawnSync('sh', [resolve('scripts/normalize-p00-images.sh')], {
  cwd: sandbox,
  encoding: 'utf8',
  env: { ...process.env, RUSHD_BASELINE_WRITE: '1', RUSHD_BASELINE_REPLACE: '' }
});
const after = await hash();

assert.equal(result.status, 3, `normalizer should refuse replacement without RUSHD_BASELINE_REPLACE=1: ${result.stderr}`);
assert.match(result.stderr, /RUSHD_BASELINE_REPLACE=1/);
assert.equal(after, before, 'write authorization alone overwrote immutable P00 evidence');

console.log('Rushd P00 immutable-artifact replacement guard passed.');
