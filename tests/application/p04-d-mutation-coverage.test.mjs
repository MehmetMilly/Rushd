// P04-D1 mechanical mutation-coverage test.
// Run: node tests/application/p04-d-mutation-coverage.test.mjs
//
// Re-derives the writer set from `src/app/root-controller.js`: every methods
// entry with a direct v1 persistence signal (DB writes, Store mutations,
// localStorage writes), closed transitively over `this.<writer>()` calls. A
// missing inventory row or a doubly-owned action fails here by design.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MUTATION_COVERAGE_INVENTORY,
  findDuplicateOwners,
  findMissingOwners,
  findStaleEntries,
} from '../../src/application/p04-d/mutation-coverage.js';

const CONTROLLER_PATH = 'src/app/root-controller.js';
const source = await readFile(CONTROLLER_PATH, 'utf8');

const methodsStart = source.indexOf('methods: {');
assert.ok(methodsStart !== -1, 'controller must contain a methods block');
const methodsEnd = source.indexOf('mounted()', methodsStart);
assert.ok(methodsEnd !== -1, 'controller must contain mounted() after methods');
const methodsSource = source.slice(methodsStart, methodsEnd);

const HEADER_PATTERN = /^ {16}(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\((?:[^()]|\([^()]*\))*\)\s*\{\s*$/gm;
const NON_METHODS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'alert',
  'setTimeout',
  'clearTimeout',
  'console',
  'JSON',
  'Promise',
  'Object',
  'Array',
  'Math',
  'Number',
  'String',
  'Date',
]);

const headers = [];
for (const match of methodsSource.matchAll(HEADER_PATTERN)) {
  if (NON_METHODS.has(match[1])) continue;
  headers.push({ name: match[1], index: match.index });
}
assert.ok(headers.length > 50, `expected a large controller surface, found ${headers.length}`);

const bodies = new Map();
for (let i = 0; i < headers.length; i += 1) {
  const start = headers[i].index;
  const end = i + 1 < headers.length ? headers[i + 1].index : methodsSource.length;
  bodies.set(headers[i].name, methodsSource.slice(start, end));
}

// Direct v1 persistence signals. Reads (getSetting/getTemplates/getAllExpenses,
// getExpensesByDate, buildTemplateApplyPlan, loadDay) are intentionally absent:
// they cannot change finance/settings/import/reset state.
const DB_WRITE = /DB\.(setSetting|saveTemplate|deleteTemplate|saveExpense|deleteExpense|setSettingsEntries|applyExpenseWritePlan|restoreBackupRecords|resolveMonthEndSettlement|factoryReset)\b/;
const STORE_WRITE = /store\.(addExpense|updateExpense|deleteExpense|autoFillDay|applyTemplatesFrom|settleMonthEnd\w*|addVaultGoal|deleteVaultGoal|addVaultTransaction|persistVaultState|persistMonthEndSettlements|recordCurrentMonthBaseAllowance|upsertMonthlyTemplateAssignment|ensureTemplateProfilesState|init)\b/;
const STORAGE_WRITE = /localStorage\.(setItem|removeItem|clear)\b/;

function hasDirectSignal(body) {
  return DB_WRITE.test(body) || STORE_WRITE.test(body) || STORAGE_WRITE.test(body);
}

const CALL_PATTERN = /this\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
function calledMethods(body) {
  const called = new Set();
  for (const match of body.matchAll(CALL_PATTERN)) {
    if (match[1] === 'store' || match[1] === 'core') continue;
    called.add(match[1]);
  }
  return called;
}

// Fixpoint: seed with direct writers, then absorb transitive callers.
const writers = new Set();
for (const [name, body] of bodies) {
  if (hasDirectSignal(body)) writers.add(name);
}
let grew = true;
while (grew) {
  grew = false;
  for (const [name, body] of bodies) {
    if (writers.has(name)) continue;
    for (const called of calledMethods(body)) {
      if (writers.has(called)) {
        writers.add(name);
        grew = true;
        break;
      }
    }
  }
}

const detected = [...writers].sort();

// 1. No action may have two owners (or two rows).
assert.deepEqual(findDuplicateOwners(), [], 'mutation inventory has duplicate owners');

// 2. Every mechanically detected writer must have exactly one owning port.
assert.deepEqual(
  findMissingOwners(detected),
  [],
  `mutation inventory is missing owners for: ${findMissingOwners(detected).join(', ')}`,
);

// 3. Every inventory row must name a real controller method.
const allMethods = headers.map((header) => header.name);
assert.deepEqual(
  findStaleEntries(allMethods),
  [],
  `mutation inventory names unknown actions: ${findStaleEntries(allMethods).join(', ')}`,
);

// 4. The inventory must stay complete: no silent extras gap in either
// direction beyond documented read-only ports (authority/insights are
// read-only in D1 by design).
const covered = new Set(MUTATION_COVERAGE_INVENTORY.map((entry) => entry.action));
const undetectedButListed = [...covered].filter((action) => !writers.has(action));
assert.deepEqual(
  undetectedButListed,
  [],
  `inventory lists non-writers (parser drift?): ${undetectedButListed.join(', ')}`,
);

