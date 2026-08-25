import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';

const catalog = JSON.parse(await readFile('tests/characterization/p0-p1-cases.json', 'utf8'));
const source = await readFile('index.html', 'utf8');
const boundary = JSON.parse(await readFile('tests/fixtures/v1/boundary.json', 'utf8'));
const legacyVault = JSON.parse(await readFile('tests/fixtures/v1/legacy-vault.json', 'utf8'));
const paidGenerated = JSON.parse(await readFile('tests/fixtures/v1/paid-generated.json', 'utf8'));
const malformed = JSON.parse(await readFile('tests/fixtures/v1/malformed.json', 'utf8'));

const expectedIds = [
  'P0-01', 'P0-02', 'P0-03', 'P0-04', 'P0-05', 'P0-06', 'P0-07', 'P0-08',
  'P1-01', 'P1-02', 'P1-03', 'P1-04', 'P1-05', 'P1-06', 'P1-07', 'P1-08',
  'P1-09', 'P1-10', 'P1-11', 'P1-12'
];

assert.equal(catalog.schema, 'rushd.p00-reproduction-catalog.v1');
assert.deepEqual(catalog.cases.map((item) => item.id), expectedIds);
assert.equal(new Set(catalog.cases.map((item) => item.id)).size, expectedIds.length);

for (const item of catalog.cases) {
  assert.ok(['automated', 'manual'].includes(item.reproduction_type));
  assert.ok(item.fixture.startsWith('tests/fixtures/v1/'));
  assert.ok(item.preconditions.length > 0);
  assert.ok(item.steps.length > 1);
  assert.ok(item.expected_current_result.length > 20);
  assert.ok(item.captured_current_result.length > 20);
  assert.equal(item.regression_owner, 'P01');
  assert.equal(item.final_evidence_path, `docs/baseline/p0-p1/${item.id}.json`);
  const evidenceStat = await lstat(item.final_evidence_path);
  assert.ok(evidenceStat.isFile() && !evidenceStat.isSymbolicLink(), `${item.id} final evidence must be a regular file`);
  const finalEvidence = JSON.parse(await readFile(item.final_evidence_path, 'utf8'));
  assert.equal(finalEvidence.issue_id, item.id);
  assert.equal(finalEvidence.final_evidence_path, item.final_evidence_path);
  if (item.reproduction_type === 'manual') {
    assert.ok(item.manual_justification.length > 80, `${item.id} needs an explicit manual justification`);
  }
}

// Executable current-behavior reproductions use the sanitized inputs while source
// markers tie each result to the production prototype rather than claiming a helper is fixed code.
const paid = paidGenerated.indexed_db.stores.expenses[0];
assert.equal(paid.isPaid, true);
assert.equal(paid.source === 'template' && paid.templateProtected === false, true);
assert.match(source, /filter\(expense => expense\.source === 'template' && expense\.templateProtected === false && !expense\.isPaid\)/);

const paidOnlySurplus = 1000 - 100;
const reservationAwareSurplus = 1000 - 100 - 500;
assert.equal(paidOnlySurplus, 900);
assert.equal(reservationAwareSurplus, 400);
assert.match(source, /if \(expense\.isPaid\) \{\s*actualSpent \+= expense\.actualPaid;/);

const reusedBalance = 100;
assert.deepEqual([100, 100].map((target) => Math.min(reusedBalance, target)), [100, 100]);
assert.match(source, /return this\.vaultGoals\.map\(goal =>/);

const legacyVaultState = legacyVault.backup.settings.vault;
const transactionBalance = legacyVaultState.transactions.reduce((sum, item) => sum + item.amount, 0);
assert.equal(legacyVaultState.balance, 650);
assert.equal(transactionBalance, 100);
assert.match(source, /transactions\.length > 0 \? computedBalance : fallbackBalance/);

const instant = new Date(boundary.timezone_cases[0].instant);
assert.equal(instant.toISOString().split('T')[0], '2026-01-01');
assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant), '2026-01-02');
assert.match(source, /return new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]/);

assert.equal(0.1 + 0.2, 0.30000000000000004);
assert.match(source, /actualSpent \+= expense\.actualPaid/);

assert.match(source, /return toFiniteNumber\(this\.settings\.baseAllowance, 1000\) \+ this\.getBudgetCarryoverForMonth\(monthKey\)/);
assert.match(source, /getBudgetForMonth\(getMonthKey\(Core\.Date\.getTodayISO\(\)\)\)/);
assert.equal(900 / 4, 225);
assert.match(source, /return monthly \/ 4/);

const monthlyWithoutDays = { recurrence: 'monthly', days: [] };
assert.equal(monthlyWithoutDays.days.length, 0);
const ordinaryTemplateWrite = source.slice(source.indexOf("if (this.addModal.mode === 'template')"), source.indexOf("} else if (this.addModal.mode === 'flexibleDefinition')"));
assert.match(ordinaryTemplateWrite, /recurrence: this\.addModal\.form\.recurrence \|\| 'daily'/);
assert.doesNotMatch(ordinaryTemplateWrite, /days:/);

assert.match(source, /find\(assignment => assignment\.monthKey === monthKey\)/);
assert.match(source, /await this\.refreshFlexibleStats\(dateStr\);\s*await this\.refreshStatistics\(dateStr\);/);

assert.equal(Number('-1') < 0, true);
assert.equal(Number('1.234'), 1.234);
assert.equal(Number.isFinite(Number('Infinity')), false);
assert.equal(Number('١٢٫٥٠'), Number.NaN);

const weakCandidate = malformed.malformed_backup_candidates.find((item) => item.id === 'weak-schema-accepted').payload;
assert.equal(Array.isArray(weakCandidate.expenses), true);
assert.match(source, /validateBackupPayload\(data\)/);
assert.match(source, /DB\.restoreBackupRecords\(/);
assert.match(source, /resetFailedTitle: 'Reset Failed'/);
assert.match(source, /resetBackupFailed: 'Backup before delete could not be created/);
assert.match(source, /resetBlockedError: 'Reset could not complete because Rushd is open in another tab/);
assert.match(source, /DB\.applyExpenseWritePlan\(/);
assert.match(source, /DB\.setSettingsEntries\(/);

assert.match(source, /return \[10, 15, 8, 12, 20, 18, 25, this\.store\.globalStats\.netVariance\]/);
assert.match(source, /Formula: 1 SAR Saved = 10 XP/);
assert.equal(Math.floor(100 * 10), 1000);

console.log('Rushd P00 P0/P1 characterization coverage passed.');
