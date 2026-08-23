import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('tests/fixtures/v1');
const expectedCases = ['boundary', 'empty', 'large-history', 'legacy-vault', 'malformed', 'paid-generated', 'plan-edit', 'populated'];
const files = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name).sort();
assert.deepEqual(files, expectedCases.map((name) => `${name}.json`));

for (const file of files) {
  const fixture = JSON.parse(await readFile(resolve(root, file), 'utf8'));
  assert.equal(fixture.schema, 'rushd.v1-fixture.v1');
  assert.equal(fixture.case_id, file.replace(/\.json$/, ''));
  assert.equal(fixture.sanitization.marker, 'SYNTHETIC_P00_ONLY');
  assert.equal(fixture.sanitization.contains_real_financial_data, false);
  assert.equal(fixture.indexed_db.name, 'MicroSaveOS_DB');
  assert.equal(fixture.indexed_db.version, 1);
  assert.ok(Array.isArray(fixture.indexed_db.stores.settings));
  assert.ok(Array.isArray(fixture.indexed_db.stores.templates));
  assert.ok(Array.isArray(fixture.indexed_db.stores.expenses));
  assert.equal(fixture.backup.version, '3.1');
  assert.ok(Array.isArray(fixture.backup.expenses));
  assert.equal(JSON.stringify(fixture).includes('/Users/'), false, `${file} must not contain local personal paths`);
}

for (const caseId of expectedCases) {
  const rawBackup = JSON.parse(await readFile(resolve(root, 'backups', `${caseId}.backup.json`), 'utf8'));
  assert.equal(rawBackup.version, '3.1');
  assert.ok(Array.isArray(rawBackup.expenses));
}

const large = JSON.parse(await readFile(resolve(root, 'large-history.json'), 'utf8'));
assert.equal(large.indexed_db.stores.expenses.length, 1000);
assert.equal(large.backup.expenses.length, 1000);
assert.equal(new Set(large.backup.expenses.map((item) => item.id)).size, 1000);
const mediumBackup = JSON.parse(await readFile(resolve(root, 'backups', 'large-history-100.backup.json'), 'utf8'));
assert.equal(mediumBackup.expenses.length, 100);

const malformed = JSON.parse(await readFile(resolve(root, 'malformed.json'), 'utf8'));
assert.deepEqual(malformed.malformed_backup_candidates.map((item) => item.id), [
  'missing-expenses', 'non-array-expenses', 'weak-schema-accepted', 'excess-precision'
]);

const boundary = JSON.parse(await readFile(resolve(root, 'boundary.json'), 'utf8'));
assert.ok(boundary.boundary_inputs.includes('١٢٫٥٠'));
assert.equal(boundary.timezone_cases[0].expected_local_date, '2026-01-02');

console.log('Rushd P00 fixture coverage passed.');
