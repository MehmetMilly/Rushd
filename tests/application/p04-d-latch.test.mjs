// P04-D1 latch tests. Run: node tests/application/p04-d-latch.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  P04D_D1_CANDIDATE_BLOCKED_REASON,
  describeAuthority,
  isAuthorityWritable,
  normalizeP04DBuildMode,
  resolveP04DAuthority,
} from '../../src/application/p04-d/authority-latch.js';

const legacyPorts = { name: 'legacy-stub-ports' };
const candidatePorts = { name: 'candidate-stub-ports' };

// 1. Ordinary production paths always resolve to legacy.
{
  const resolution = resolveP04DAuthority(undefined, legacyPorts);
  assert.equal(resolution.mode, 'legacy');
  assert.deepEqual(resolution.authority, { kind: 'legacy', writable: true });
  assert.equal(resolution.featurePorts, legacyPorts);
}
{
  const resolution = resolveP04DAuthority({}, legacyPorts);
  assert.equal(resolution.mode, 'legacy');
  assert.equal(resolution.authority.kind, 'legacy');
  assert.equal(isAuthorityWritable(resolution.authority), true);
}

// 2. No production runtime input can enable candidate mode: poison every
// forbidden channel, then resolve without explicit arguments.
{
  const savedLocalStorage = globalThis.localStorage;
  const savedLocation = globalThis.location;
  const savedDocument = globalThis.document;
  try {
    globalThis.localStorage = {
      getItem: () => 'canonicalCandidate',
      setItem: () => {},
      removeItem: () => {},
    };
    globalThis.location = { search: '?mode=canonicalCandidate&authority=canonicalCandidate' };
    globalThis.document = { cookie: 'p04d_mode=canonicalCandidate' };
    globalThis.__P04D_MODE__ = 'canonicalCandidate';
    globalThis.P04D_BUILD_MODE = 'canonicalCandidate';
    const resolution = resolveP04DAuthority(undefined, legacyPorts);
    assert.equal(resolution.mode, 'legacy');
    assert.equal(resolution.authority.kind, 'legacy');
    assert.equal(resolution.featurePorts, legacyPorts);
  } finally {
    if (savedLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = savedLocalStorage;
    if (savedLocation === undefined) delete globalThis.location;
    else globalThis.location = savedLocation;
    if (savedDocument === undefined) delete globalThis.document;
    else globalThis.document = savedDocument;
    delete globalThis.__P04D_MODE__;
    delete globalThis.P04D_BUILD_MODE;
  }
}

// 3. The latch implementation itself never reads those channels.
{
  const raw = await readFile('src/application/p04-d/authority-latch.js', 'utf8');
  // Strip comments: the doc contract names the forbidden channels, the code
  // itself must never touch them.
  const source = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
  for (const forbidden of [
    'localStorage',
    'sessionStorage',
    'location',
    'document',
    'cookie',
    'URLSearchParams',
    'imported',
  ]) {
    assert.ok(!source.includes(forbidden), `authority-latch must not reference ${forbidden}`);
  }
}

// 4. Explicit test/build injection is acknowledged structurally but stays
// blocked on the legacy port set: no v2 path opens in D1.
{
  const resolution = resolveP04DAuthority(
    { mode: 'canonicalCandidate', candidatePorts },
    legacyPorts,
  );
  assert.equal(resolution.mode, 'canonicalCandidate');
  assert.equal(resolution.authority.kind, 'canonicalPreparing');
  assert.equal(resolution.authority.writable, false);
  assert.equal(resolution.authority.reason, P04D_D1_CANDIDATE_BLOCKED_REASON);
  assert.equal(resolution.featurePorts, legacyPorts);
  assert.notEqual(resolution.featurePorts, candidatePorts);
  assert.equal(isAuthorityWritable(resolution.authority), false);
}

// 5. Candidate mode without explicitly injected ports falls back to legacy.
{
  const resolution = resolveP04DAuthority({ mode: 'canonicalCandidate' }, legacyPorts);
  assert.equal(resolution.mode, 'legacy');
  assert.equal(resolution.authority.kind, 'legacy');
  assert.equal(resolution.featurePorts, legacyPorts);
}

// 6. Mode normalization is exact-match only.
{
  assert.equal(normalizeP04DBuildMode('canonicalCandidate'), 'canonicalCandidate');
  for (const spoof of [
    'CanonicalCandidate',
    'CANONICALCANDIDATE',
    ' canonicalCandidate',
    'legacy',
    '',
    undefined,
    null,
    0,
    1,
    true,
    ['canonicalCandidate'],
    { mode: 'canonicalCandidate' },
  ]) {
    assert.equal(normalizeP04DBuildMode(spoof), 'legacy', `must normalize ${String(spoof)} to legacy`);
  }
}

// 7. Descriptions stay truthful for reports and blocked-action UI.
{
  assert.match(describeAuthority({ kind: 'legacy', writable: true }), /legacy/);
  assert.match(
    describeAuthority({ kind: 'canonicalPreparing', writable: false, reason: 'r' }),
    /canonicalPreparing/,
  );
  assert.match(
    describeAuthority({ kind: 'canonicalReady', writable: true, storageId: 's' }),
    /canonicalReady/,
  );
  assert.match(
    describeAuthority({ kind: 'unavailable', writable: false, reason: 'r' }),
    /unavailable/,
  );
  assert.equal(isAuthorityWritable({ kind: 'legacy', writable: true }), true);
  assert.equal(
    isAuthorityWritable({ kind: 'canonicalReady', writable: true, storageId: 's' }),
    true,
  );
  assert.equal(
    isAuthorityWritable({ kind: 'unavailable', writable: false, reason: 'r' }),
    false,
  );
}

