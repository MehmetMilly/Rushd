import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

const cases = [
  { id: 'empty', path: 'tests/fixtures/v1/backups/empty.backup.json', expected: 0 },
  { id: 'history-100', path: 'tests/fixtures/v1/backups/large-history-100.backup.json', expected: 100 },
  { id: 'history-1000', path: 'tests/fixtures/v1/backups/large-history.backup.json', expected: 1000 }
];

const results = [];
for (const fixtureCase of cases) {
  const raw = await readFile(fixtureCase.path, 'utf8');
  const samples = [];
  let parsed = null;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const started = performance.now();
    parsed = JSON.parse(raw);
    samples.push(performance.now() - started);
  }
  if (parsed.expenses.length !== fixtureCase.expected) {
    throw new Error(`${fixtureCase.id}: expected ${fixtureCase.expected} records, got ${parsed.expenses.length}`);
  }
  const sorted = [...samples].sort((left, right) => left - right);
  results.push({
    id: fixtureCase.id,
    path: fixtureCase.path,
    byte_length: Buffer.byteLength(raw),
    record_count: parsed.expenses.length,
    iterations: samples.length,
    parse_ms: {
      min: sorted[0],
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: sorted.at(-1)
    }
  });
}

const report = {
  schema: 'rushd.p00-fixture-performance.v1',
  captured_at: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  method: 'Fifty in-process JSON.parse samples per deterministic sanitized backup; this is an initial comparison baseline, not a product performance budget.',
  results
};

if (process.env.RUSHD_BASELINE_WRITE === '1') {
  const output = resolve('test-results/p00-browser/fixture-performance.json');
  await mkdir(resolve('test-results/p00-browser'), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify(report, null, 2));
