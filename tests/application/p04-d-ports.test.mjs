// P04-D1 legacy-port delegation tests. Run: node tests/application/p04-d-ports.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  bindAuthorityState,
  createLegacyFeaturePorts,
} from '../../src/application/p04-d/legacy-ports.js';

const calls = [];
function makeRuntime() {
  calls.length = 0;
  const store = {
    currentDate: '2026-09-12',
    safeToSpend: 42.5,
    currentViewExpenses: [
      {
        id: 'e1',
        name: 'bread',
        expectedCost: 10,
        actualPaid: 8,
        isPaid: true,
        category: 'food',
        classification: 'essential',
        date: '2026-09-12',
      },
      {
        id: 'e2',
        name: 'bus',
        expectedCost: 7,
        actualPaid: 0,
        isPaid: false,
        category: 'transport',
        classification: 'essential',
        date: '2026-09-12',
      },
    ],
    settings: {
      baseAllowance: 1000,
      theme: 'dark',
      motionLevel: 'auto',
      activeTemplateProfileId: 'legacy',
      templateProfiles: [{ id: 'legacy', name: 'Legacy', offdays: [5, 6] }],
      vault: { balance: 100, transactions: [], goals: [] },
    },
    statistics: {
      monthKey: '2026-09',
      budgetKnown: true,
      budget: 1000,
      paidSpent: 8,
      unpaidEssential: 7,
      safeToSpend: 42.5,
      projectedBalance: 42.5,
      categoryBreakdown: [{ category: 'food', amount: 8, count: 1 }],
      weeklySpending: [{ week: 1, amount: 8 }],
    },
    templates: [],
    loadDay: async (date) => {
      calls.push(['loadDay', date]);
      store.currentDate = date;
    },
    addExpense: async (expense) => {
      calls.push(['addExpense', expense]);
      expense.id = 'new-1';
    },
    updateExpense: async (expense) => {
      calls.push(['updateExpense', expense]);
    },
    deleteExpense: async (id) => {
      calls.push(['deleteExpense', id]);
    },
    autoFillDay: async (date) => {
      calls.push(['autoFillDay', date]);
      return 2;
    },
    refreshFlexibleStats: async () => {
      calls.push(['refreshFlexibleStats']);
    },
    refreshStatistics: async () => {
      calls.push(['refreshStatistics']);
    },
  };
  const db = {
    getAllExpenses: async () => {
      calls.push(['getAllExpenses']);
      return store.currentViewExpenses;
    },
    getExpensesByDate: async (date) => {
      calls.push(['getExpensesByDate', date]);
      return store.currentViewExpenses.filter((entry) => entry.date === date);
    },
    setSetting: async (key, value) => {
      calls.push(['setSetting', key, value]);
    },
    saveTemplate: async (template) => {
      calls.push(['saveTemplate', template]);
    },
    deleteTemplate: async (id) => {
      calls.push(['deleteTemplate', id]);
    },
  };
  return {
    Core: { UUID: () => 'uuid-test-1' },
    Store: store,
    DB: db,
    validateBackupPayload: () => ({ ok: false, reason: 'test-gate' }),
    parseMoneyInput: (value) => value,
    DEFAULT_PROFILE_OFFDAYS: [5, 6],
    normalizeProfileOffdays: (days) => days,
    normalizeMotionLevel: (level) => level,
    normalizePersistedMoney: (value) => value,
    normalizeMonthlyBaseAllowances: (value) => value,
    isPlainObjectRecord: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
    ONBOARDING_STATE_KEY: 'onboardingState',
    MONTH_START_PROMPT_DEFER_KEY: 'rushd_month_start_prompt_deferred',
    MONTH_END_PROMPT_DEFER_KEY: 'rushd_month_end_prompt_deferred',
  };
}

const environment = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
const ports = createLegacyFeaturePorts(makeRuntime(), environment);

// Authority defaults to writable legacy.
assert.equal(ports.authority.getState().kind, 'legacy');
assert.equal(ports.authority.getState().writable, true);
ports.authority.assertWritable('test-scope');

// Home delegates to the Store view state without restating finance.
assert.equal(ports.home.getSelectedDate(), '2026-09-12');
assert.equal(ports.home.getSafeToSpend(), 42.5);
assert.equal(ports.home.listSelectedDayExpenses().length, 2);
assert.equal(ports.home.getDailyPaidTotal(), 8);
assert.equal(ports.home.getDailyExpectedTotal(), 17);
await ports.home.selectDate('2026-09-13');
assert.ok(calls.some(([name]) => name === 'loadDay'), 'home.selectDate must delegate to Store.loadDay');
await ports.home.refresh();
assert.ok(calls.some(([name]) => name === 'refreshStatistics'), 'home.refresh must delegate');

// Capture validates, then delegates to Store.addExpense.
{
  const runtime = makeRuntime();
  const local = createLegacyFeaturePorts(runtime, environment);
  assert.deepEqual(await local.capture.submitExpense({ name: '', cost: 5, category: 'food' }), {
    ok: false,
    reason: 'validation',
  });
  assert.deepEqual(await local.capture.submitExpense({ name: 'x', cost: -1, category: 'food' }), {
    ok: false,
    reason: 'validation',
  });
  const result = await local.capture.submitExpense({ name: 'milk', cost: 5, category: 'food' });
  assert.equal(result.ok, true);
  // Payment of an unknown id is a validation failure, not a write.
  assert.deepEqual(await local.capture.payExpense('missing', 5), { ok: false, reason: 'validation' });
  assert.deepEqual(await local.capture.markUnpaid('missing'), { ok: false, reason: 'validation' });
  assert.equal(await local.capture.autoFillDay('2026-09-12'), 2);
}

// History delegates corrections and deletes to the Store.
{
  const runtime = makeRuntime();
  const local = createLegacyFeaturePorts(runtime, environment);
  const rows = await local.history.listDayExpenses('2026-09-12');
  assert.equal(rows.length, 2);
  assert.deepEqual(await local.history.updateExpense({ id: '' }), { ok: false, reason: 'validation' });
  const updated = await local.history.updateExpense({
    id: 'e1',
    date: '2026-09-12',
    name: 'bread',
    expectedCost: 10,
    actualPaid: 8,
    isPaid: true,
    category: 'food',
    classification: 'essential',
  });
  assert.equal(updated.ok, true);
  assert.equal((await local.history.deleteExpense('e1')).ok, true);
  assert.equal((await local.history.deleteSelected(['e1', 'e2'])).ok, true);
  assert.equal((await local.history.markSelectedUnpaid(['e1'])).ok, true);
}

// Plan reads profiles and delegates template writes to the DB.
{
  const runtime = makeRuntime();
  const local = createLegacyFeaturePorts(runtime, environment);
  assert.deepEqual(local.plan.listProfiles(), [{ id: 'legacy', name: 'Legacy', offdays: [5, 6] }]);
  assert.equal(local.plan.getActiveProfileId(), 'legacy');
  await local.plan.saveTemplate({ id: 't1', name: 'bus' });
  await local.plan.deleteTemplate('t1');
}

// Insights is a read-only passthrough of Store statistics.
{
  const stats = ports.insights.getMonthStatistics();
  assert.equal(stats.monthKey, '2026-09');
  assert.equal(stats.budgetKnown, true);
  assert.equal(ports.insights.getCategoryBreakdown().length, 1);
  assert.equal(ports.insights.getWeeklySpending().length, 1);
}

// Goals delegate to the Store vault/settlement methods.
{
  const runtime = makeRuntime();
  const local = createLegacyFeaturePorts(runtime, environment);
  assert.equal(local.goals.getVaultBalance(), 100);
  assert.deepEqual(local.goals.listGoals(), []);
}

// Portability validates through the legacy gate before any write.
{
  const runtime = makeRuntime();
  const local = createLegacyFeaturePorts(runtime, environment);
  const snapshot = await local.portability.buildSnapshot();
  assert.ok(snapshot.includes('"version": "3.1"'));
  const rejected = await local.portability.restoreSnapshot({ version: '3.1' });
  assert.equal(rejected.ok, false);
}

// Navigation maps only the five populated legacy destinations.
{
  assert.deepEqual(ports.navigation.listDestinations(), [
    'dashboard',
    'statistics',
    'vault',
    'plans',
    'settings',
  ]);
  assert.deepEqual(ports.navigation.resolveIntent('dashboard'), { view: 'dashboard' });
  assert.equal(ports.navigation.resolveIntent('ask'), null);
  assert.equal(ports.navigation.resolveIntent(''), null);
}

// Binding a blocked authority state turns every guarded write into a
// visible failure instead of a silent legacy write.
{
  const runtime = makeRuntime();
  const local = createLegacyFeaturePorts(runtime, environment);
  bindAuthorityState(local, {
    kind: 'canonicalPreparing',
    writable: false,
    reason: 'test-block',
  });
  assert.throws(() => local.authority.assertWritable('test-scope'), /blocked/);
  assert.deepEqual(await local.capture.submitExpense({ name: 'x', cost: 1, category: 'food' }), {
    ok: false,
    reason: 'error',
  });
  assert.deepEqual(await local.history.deleteExpense('e1'), { ok: false, reason: 'error' });
}

// The legacy delegates must not open v2 storage, sync, or network paths.
{
  const raw = await readFile('src/application/p04-d/legacy-ports.js', 'utf8');
  const source = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
  for (const forbidden of [
    'v2/',
    'sqlite',
    'wa-sqlite',
    'OPFS',
    'ServiceWorker',
    'service worker',
    'fetch(',
    'WebSocket',
    'createGuestApplication',
  ]) {
    assert.ok(!source.includes(forbidden), `legacy-ports must not reference ${forbidden}`);
  }
}

