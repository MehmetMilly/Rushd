// P04-D3 controller routing tests. Run: node tests/application/p04-d3-routing.test.mjs
/* global console:readonly, setImmediate:readonly */
//
// Proves every D3-owned controller action routes to exactly one feature
// port in candidate mode and cannot reach the v1 `Store`/`DB`, while
// legacy mode preserves its current delegates. Part 1 is mechanical
// (source structure, like the D1 coverage test); part 2 drives the real
// installed controller methods with fake ports and a recording v1 runtime.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installRootController } from '../../src/app/root-controller.js';
import { TRANSLATIONS } from '../../src/app/i18n/translations.js';

const CONTROLLER_PATH = 'src/app/root-controller.js';
const source = await readFile(CONTROLLER_PATH, 'utf8');

// --- Part 1: mechanical routing structure --------------------------------

const D3_OWNED = Object.freeze([
  'selectDate',
  'submitNewExpense',
  'submitNewExpenseViaPorts',
  'saveEditedExpense',
  'saveEditedExpenseViaPorts',
  'deleteEditedExpense',
  'deleteExpense',
  'deleteSelectedExpenses',
  'markSelectedUnpaid',
  'commitPayment',
  'markUnpaid',
  'markAsFree',
  'autoFillToday',
  'openTemplateModal',
  'openFlexibleDefinitionModal',
  'markUnpaidFromEdit',
  'initApp',
]);

const methodsStart = source.indexOf('methods: {');
assert.ok(methodsStart !== -1, 'controller must contain a methods block');
const methodsEnd = source.indexOf('mounted()', methodsStart);
assert.ok(methodsEnd !== -1, 'controller must contain mounted() after methods');
const methodsSource = source.slice(methodsStart, methodsEnd);

const HEADER_PATTERN = /^ {16}(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\((?:[^()]|\([^()]*\))*\)\s*\{\s*$/gm;
const headers = [];
for (const match of methodsSource.matchAll(HEADER_PATTERN)) {
  headers.push({ name: match[1], index: match.index });
}
const bodies = new Map();
for (let i = 0; i < headers.length; i += 1) {
  const start = headers[i].index;
  const end = i + 1 < headers.length ? headers[i + 1].index : methodsSource.length;
  bodies.set(headers[i].name, methodsSource.slice(start, end));
}

// Every D3-owned action must branch through the candidate seam before any
// legacy delegate can run.
for (const action of D3_OWNED) {
  assert.ok(bodies.has(action), `controller must still define ${action}`);
  assert.ok(
    bodies.get(action).includes('p04d'),
    `${action} must route through the P04-D candidate seam`,
  );
}

// Candidate branches must use the injected ports (never Store/DB first):
// each D3-owned writer references a port namespace in its seam branch.
for (const action of ['selectDate', 'submitNewExpenseViaPorts', 'saveEditedExpenseViaPorts', 'deleteExpense', 'deleteSelectedExpenses']) {
  const body = bodies.get(action);
  assert.ok(
    body.includes('ports.home') || body.includes('ports.capture') || body.includes('ports.history') || body.includes('Ports.home') || body.includes('Ports.capture') || body.includes('Ports.history'),
    `${action} must call its owning port`,
  );
}

// The template carries the truthful candidate affordances and nothing else
// candidate-specific (no visual rewrite, no navigation change).
{
  const template = await readFile('src/app/root-template.html', 'utf8');
  for (const binding of ['p04dCandidateActive', 'p04dAddSubmitBlocked']) {
    assert.ok(template.includes(binding), `template must bind ${binding} for truthful candidate states`);
  }
  assert.ok(!template.includes('p04dWritesBlocked'), 'unsupported controls must not rely on writes-blocked alone');
  assert.ok(!template.includes('canonicalCandidate'), 'template must not name build modes');
  // Correction: unsupported controls are disabled in *writable* candidate
  // mode too (candidate-active, not only writes-blocked).
  for (const snippet of [
    '@click="autoFillToday" :disabled="p04dCandidateActive"',
    '@click="commitPayment" :disabled="p04dCandidateActive"',
    '@click="openTemplateModal" :disabled="p04dCandidateActive"',
    '@click="openFlexibleDefinitionModal" :disabled="p04dCandidateActive"',
    'selectedPaidCount === 0 || p04dCandidateActive',
  ]) {
    assert.ok(template.includes(snippet), `template must visibly block unsupported controls: ${snippet}`);
  }
  assert.ok(!template.includes('@click="commitPayment" :disabled="p04dWritesBlocked"'), 'pay confirm must not rely on writes-blocked alone');
  // Correction: classification pickers stay out of candidate mode, and the
  // edit-modal unpaid toggle with them.
  for (const snippet of [
    "addModal.mode === 'expense' && !p04dCandidateActive",
    "editModal.type === 'expense' && !p04dCandidateActive",
    "editModal.form.isPaid && !p04dCandidateActive",
  ]) {
    assert.ok(template.includes(snippet), `template must hide candidate-unusable controls: ${snippet}`);
  }
}

// --- Part 2: runtime routing ----------------------------------------------

function memoryLocalStorage() {
  const cells = new Map();
  return {
    getItem: (key) => (cells.has(key) ? cells.get(key) : null),
    setItem: (key, value) => {
      cells.set(key, String(value));
    },
    removeItem: (key) => {
      cells.delete(key);
    },
    get length() {
      return cells.size;
    },
    key: (index) => [...cells.keys()][index] ?? null,
  };
}

function makeRecordingRuntime() {
  const calls = [];
  let uuidCounter = 0;
  const store = {
    currentDate: '2026-09-05',
    currentViewExpenses: [],
    safeToSpend: 100,
    statistics: { budgetKnown: true, safeToSpend: 100, paidSpent: 0 },
    settings: { theme: 'dark', motionLevel: 'auto', activeTemplateProfileId: 'legacy' },
    calls,
    loadDay: async (date) => {
      calls.push(['store.loadDay', date]);
      store.currentDate = date;
    },
    addExpense: async (expense) => {
      calls.push(['store.addExpense', expense]);
      return { id: 'v1-new' };
    },
    updateExpense: async (expense) => {
      calls.push(['store.updateExpense', expense]);
    },
    deleteExpense: async (id) => {
      calls.push(['store.deleteExpense', id]);
    },
    autoFillDay: async (date) => {
      calls.push(['store.autoFillDay', date]);
      return 1;
    },
  };
  const db = {
    calls,
    saveTemplate: async (template) => {
      calls.push(['db.saveTemplate', template]);
    },
    deleteTemplate: async (id) => {
      calls.push(['db.deleteTemplate', id]);
    },
    getAllExpenses: async () => {
      calls.push(['db.getAllExpenses']);
      return [];
    },
  };
  return {
    calls,
    Store: store,
    DB: db,
    Core: { UUID: () => `test-uuid-${(() => { uuidCounter += 1; return uuidCounter; })()}` },
    EXPENSE_SOURCE_VALUES: ['manual', 'flexible'],
    LEGACY_TEMPLATE_PROFILE: { id: 'legacy' },
    DEFAULT_PROFILE_OFFDAYS: [5, 6],
    getDefinitionProfileId: (record) => record?.profileId || 'legacy',
    normalizeDefinitionRecord: (template) => template,
    parseMoneyInput: (value) => {
      if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
      const text = String(value ?? '').trim();
      if (!text) return null;
      const parsed = Number(text);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    },
  };
}

function makePorts(authorityState, behavior = {}) {
  const calls = [];
  const canonicalRows = (behavior.rows ?? []).map((row) => ({ ...row }));
  return {
    calls,
    authority: {
      name: 'authority',
      getState: () => ({ ...authorityState }),
      assertWritable: (scope) => {
        if (!authorityState.writable) throw new Error(`blocked for '${scope}'`);
      },
      describe: () => authorityState.kind,
      getStatus: () => ({ busy: false, error: null }),
    },
    home: {
      name: 'home',
      getSelectedDate: () => behavior.selectedDate ?? '2026-09-05',
      getSafeToSpend: () => (behavior.safeToSpend === undefined ? null : behavior.safeToSpend),
      getDailyPaidTotal: () => 0,
      getDailyExpectedTotal: () => 0,
      listSelectedDayExpenses: () => {
        calls.push(['home.list']);
        return canonicalRows.map((row) => ({ ...row }));
      },
      selectDate: async (iso) => {
        calls.push(['home.selectDate', iso]);
      },
      refresh: async () => {
        calls.push(['home.refresh']);
      },
      getStatus: () => ({ busy: false, error: null }),
    },
    capture: {
      name: 'capture',
      submitExpense: async (input) => {
        calls.push(['capture.submitExpense', { ...input }]);
        return behavior.captureResult ?? { ok: true, id: 'canon-1' };
      },
      payExpense: async () => ({ ok: false, reason: 'blocked' }),
      markUnpaid: async () => ({ ok: false, reason: 'blocked' }),
      autoFillDay: async () => 0,
      getStatus: () => ({ busy: false, error: null }),
    },
    history: {
      name: 'history',
      listDayExpenses: async () => [],
      updateExpense: async (expense, options) => {
        calls.push(['history.updateExpense', { ...expense }, options]);
        return behavior.historyResult ?? { ok: true, id: 'canon-2' };
      },
      deleteExpense: async (id, options) => {
        calls.push(['history.deleteExpense', id, options]);
        return behavior.historyResult ?? { ok: true, id };
      },
      deleteSelected: async (ids) => {
        calls.push(['history.deleteSelected', [...ids]]);
        return behavior.historyResult ?? { ok: true };
      },
      markSelectedUnpaid: async () => ({ ok: false, reason: 'blocked' }),
      getStatus: () => ({ busy: false, error: null }),
    },
  };
}

function installWith({ runtime, environment, ports }) {
  const mixins = [];
  const appStub = {
    config: { globalProperties: {} },
    mixin(m) {
      mixins.push(m);
    },
    component() {},
  };
  installRootController(appStub, runtime, environment, ports ? { featurePorts: ports } : {});
  const ctx = {
    $refs: {},
    $nextTick: () => {},
    store: runtime.Store,
    core: runtime.Core,
    lang: 'ar',
    t: TRANSLATIONS.ar,
    toasts: [],
    showToast(message) {
      this.toasts.push(message);
    },
  };
  for (const mixin of mixins) {
    if (mixin.data) Object.assign(ctx, mixin.data.call({}));
    if (mixin.methods) Object.assign(ctx, mixin.methods);
  }
  ctx.lang = 'ar';
  ctx.t = TRANSLATIONS.ar;
  ctx.toasts = [];
  ctx.showToast = function showToast(message) {
    this.toasts.push(message);
  };
  return ctx;
}

function makeEnvironment() {
  return {
    localStorage: memoryLocalStorage(),
    document: {
      documentElement: { dataset: {}, style: {}, dir: '', lang: '' },
      querySelector: () => null,
    },
    navigator: {},
    window: { matchMedia: () => ({ matches: false }) },
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const READY = { kind: 'ready-stub', writable: true };
const BLOCKED = { kind: 'blocked-stub', writable: false };

// 1. Candidate Add commits once through the port; the modal closes only on
// durable success and v1 is never touched.
{
  const runtime = makeRecordingRuntime();
  const ports = makePorts(READY, {
    rows: [{ id: 'canon-1', name: 'milk', expectedCost: 9.5, actualPaid: 9.5, isPaid: true, category: 'food', classification: 'essential', date: '2026-09-05' }],
  });
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  ctx.addModal.open = true;
  ctx.addModal.mode = 'expense';
  ctx.addModal.form = { name: 'milk', cost: '9.5', category: 'food', classification: 'essential', source: 'manual', flexibleDefinitionId: '' };
  await ctx.submitNewExpense.call(ctx);
  assert.equal(ctx.addModal.open, false, 'add modal must close after durable success');
  assert.deepEqual(runtime.calls, [], 'candidate add must not reach Store/DB');
  const submitted = ports.calls.filter(([name]) => name === 'capture.submitExpense');
  assert.equal(submitted.length, 1, 'candidate add must commit exactly once');
  assert.equal(submitted[0][1].source, 'manual', 'candidate add is a manual actual outflow');
  assert.ok(typeof submitted[0][1].operationId === 'string', 'candidate add carries an operation identity');
  assert.equal(ctx.store.currentViewExpenses.length, 1, 'totals/rows refresh from canonical state after commit');
  assert.equal(ctx.store.currentViewExpenses[0].id, 'canon-1');
}

// 2. A failed commit leaves the modal open and retryable with no duplicate.
{
  const runtime = makeRecordingRuntime();
  let attempts = 0;
  const ports = makePorts(READY, { rows: [] });
  ports.capture.submitExpense = async () => {
    attempts += 1;
    return { ok: false, reason: 'error' };
  };
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  ctx.addModal.open = true;
  ctx.addModal.mode = 'expense';
  ctx.addModal.form = { name: 'milk', cost: '9.5', category: 'food', classification: 'essential', source: 'manual', flexibleDefinitionId: '' };
  await ctx.submitNewExpense.call(ctx);
  assert.equal(ctx.addModal.open, true, 'failed add must leave the modal open and retryable');
  assert.equal(ctx.toasts.length, 1, 'failed add must surface a truthful message');
  assert.equal(ctx.store.currentViewExpenses.length, 0, 'failed add must not mutate visible state');
  assert.deepEqual(runtime.calls, [], 'failed add must not fall through to v1');
  await ctx.submitNewExpense.call(ctx);
  assert.equal(attempts, 2, 'retry re-attempts through the port (no silent success, no hidden duplicate)');
}

// 3. Blocked authority keeps every writer shut without touching v1.
{
  const runtime = makeRecordingRuntime();
  const ports = makePorts(BLOCKED);
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  ctx.addModal.open = true;
  ctx.addModal.mode = 'expense';
  ctx.addModal.form = { name: 'milk', cost: '9.5', category: 'food', classification: 'essential', source: 'manual', flexibleDefinitionId: '' };
  await ctx.submitNewExpense.call(ctx);
  assert.equal(ctx.addModal.open, true, 'blocked add must not close the modal');
  assert.ok(ports.calls.every(([name]) => name !== 'capture.submitExpense'), 'blocked add must not call the port');
  assert.deepEqual(runtime.calls, [], 'blocked add must not reach Store/DB');
  await ctx.commitPayment.call(ctx);
  await ctx.markUnpaid.call(ctx);
  await ctx.autoFillToday.call(ctx);
  await ctx.markSelectedUnpaid.call(ctx);
  assert.deepEqual(runtime.calls, [], 'blocked pay/reopen/auto-fill/bulk-unpaid must not reach Store/DB');
  assert.ok(ctx.toasts.length >= 4, 'every blocked action must say so');
}

// 4. Template and flexible creation stay unavailable instead of writing v1.
{
  const runtime = makeRecordingRuntime();
  const ports = makePorts(READY);
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  ctx.addModal.open = true;
  ctx.addModal.mode = 'template';
  ctx.addModal.form = { name: 'bus', cost: '7', category: 'transport', recurrence: 'daily', applicability: 'everyday' };
  await ctx.submitNewExpense.call(ctx);
  ctx.addModal.mode = 'flexibleDefinition';
  await ctx.submitNewExpense.call(ctx);
  ctx.addModal.mode = 'expense';
  ctx.addModal.form = { name: 'x', cost: '1', category: 'food', source: 'flexible', flexibleDefinitionId: 'flex-1' };
  await ctx.submitNewExpense.call(ctx);
  assert.equal(ctx.addModal.open, true, 'template/flexible modes must stay open and unsaved');
  assert.deepEqual(runtime.calls, [], 'template/flexible creation must never write v1 in candidate mode');
  assert.ok(ports.calls.every(([name]) => name !== 'capture.submitExpense'), 'template/flexible creation must not commit canonical facts either');
  ctx.openTemplateModal.call(ctx);
  ctx.openFlexibleDefinitionModal.call(ctx);
  assert.deepEqual(runtime.calls, [], 'template/flexible entry points must not write v1');
}

// 5. Corrections and reversals route through history ports only.
{
  const runtime = makeRecordingRuntime();
  const ports = makePorts(READY, {
    rows: [{ id: 'canon-9', name: 'bread', expectedCost: 12, actualPaid: 12, isPaid: true, category: 'food', classification: 'essential', date: '2026-09-05' }],
  });
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  ctx.editModal.item = { id: 'canon-9', name: 'bread', expectedCost: 12, category: 'food', date: '2026-09-05', classification: 'essential', isPaid: true };
  ctx.editModal.type = 'expense';
  ctx.editModal.form = { name: 'bread', cost: '14', category: 'food', date: '2026-09-05', classification: 'essential', isPaid: true, actualPaid: 12 };
  ctx.editModal.open = true;
  await ctx.saveEditedExpense.call(ctx);
  const updated = ports.calls.filter(([name]) => name === 'history.updateExpense');
  assert.equal(updated.length, 1, 'edit must append exactly one correction');
  assert.equal(updated[0][1].id, 'canon-9');
  assert.equal(updated[0][1].expectedCost, 14);
  assert.equal(ctx.editModal.open, false, 'edit modal closes after the durable correction');
  assert.deepEqual(runtime.calls, [], 'correction must not reach Store/DB');
}

// 6. Swipe-delete confirms a reversal; batch failure is explicit.
{
  const runtime = makeRecordingRuntime();
  const ports = makePorts(READY, { rows: [] });
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  ctx.deleteExpense.call(ctx, 'canon-9');
  assert.equal(ctx.confirmDialog.open, true, 'candidate delete must confirm the reversal');
  const pending = ports.calls.filter(([name]) => name === 'history.deleteExpense');
  assert.equal(pending.length, 0, 'no reversal before confirmation');
  await ctx.handleConfirmDialogConfirm.call(ctx);
  await flush();
  const deleted = ports.calls.filter(([name]) => name === 'history.deleteExpense');
  assert.equal(deleted.length, 1, 'confirmed delete appends one reversal');
  assert.equal(deleted[0][1], 'canon-9');
  assert.deepEqual(runtime.calls, [], 'reversal must not reach Store/DB');

  const partialPorts = makePorts(READY, { rows: [] });
  const partialCtx = installWith({ runtime: makeRecordingRuntime(), environment: makeEnvironment(), ports: partialPorts });
  partialPorts.history.deleteSelected = async () => {
    partialCtx.toasts.push('port-saw-batch');
    return { ok: false, reason: 'partial' };
  };
  partialCtx.selectedExpenseIds = ['a', 'b'];
  partialCtx.deleteSelectedExpenses.call(partialCtx);
  assert.equal(partialCtx.confirmDialog.open, true, 'batch delete must confirm');
  await partialCtx.handleConfirmDialogConfirm.call(partialCtx);
  await flush();
  assert.ok(!partialCtx.toasts.some((message) => /2/.test(message) && /deleted/i.test(message)), 'batch failure must never report all-success');
}

// 7. Day selection serves canonical rows without v1 fallback.
{
  const runtime = makeRecordingRuntime();
  const ports = makePorts(READY, {
    selectedDate: '2026-09-06',
    rows: [{ id: 'canon-6', name: 'bus', expectedCost: 7, actualPaid: 7, isPaid: true, category: 'transport', classification: 'essential', date: '2026-09-06' }],
  });
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  await ctx.selectDate.call(ctx, '2026-09-06');
  assert.deepEqual(ports.calls.filter(([name]) => name === 'home.selectDate'), [['home.selectDate', '2026-09-06']]);
  assert.equal(ctx.store.currentDate, '2026-09-06');
  assert.equal(ctx.store.currentViewExpenses.length, 1, 'day rows come from canonical state');
  assert.equal(ctx.store.statistics.budgetKnown, false, 'unprojected safe-to-spend stays unknown, never fabricated');
  assert.deepEqual(runtime.calls, [], 'day selection must not read v1 finance state');
}

// 8. Legacy mode preserves its current delegates.
{
  const runtime = makeRecordingRuntime();
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports: null });
  ctx.addModal.open = true;
  ctx.addModal.mode = 'expense';
  ctx.addModal.form = { name: 'milk', cost: '9.5', category: 'food', classification: 'essential', source: 'manual', flexibleDefinitionId: '' };
  await ctx.submitNewExpense.call(ctx);
  assert.ok(runtime.calls.some(([name]) => name === 'store.addExpense'), 'legacy add still delegates to the Store');
  assert.equal(ctx.addModal.open, false, 'legacy add still closes the modal');
  await ctx.selectDate.call(ctx, '2026-09-07');
  assert.ok(runtime.calls.some(([name]) => name === 'store.loadDay'), 'legacy day selection still delegates to the Store');
  ctx.openPayModal.call(ctx, { id: 'e1', name: 'bread', expectedCost: 10, actualPaid: 0, isPaid: false });
  assert.equal(ctx.payModal.open, true, 'legacy pay modal still opens');
  assert.equal(ctx.toasts.length, 0, 'legacy pay entry stays silent');
}

// 9. Correction: one intent, one ID. Retries reuse the ID while the
// payload is unchanged; a new intent (or changed payload) mints fresh.
{
  const runtime = makeRecordingRuntime();
  const seenIds = [];
  const ports = makePorts(READY, { rows: [] });
  let failNext = 1;
  ports.capture.submitExpense = async (input) => {
    seenIds.push(input.operationId);
    if (failNext > 0) {
      failNext -= 1;
      return { ok: false, reason: 'error' };
    }
    return { ok: true, id: 'canon-1' };
  };
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  ctx.openAddModal.call(ctx);
  ctx.addModal.mode = 'expense';
  ctx.addModal.form = { name: 'milk', cost: '9.5', category: 'food', classification: '', source: 'manual', flexibleDefinitionId: '' };
  await ctx.submitNewExpense.call(ctx);
  assert.equal(ctx.addModal.open, true, 'false failure keeps the modal open');
  await ctx.submitNewExpense.call(ctx);
  assert.equal(ctx.addModal.open, false, 'retry succeeds and closes');
  assert.equal(seenIds.length, 2, 'exactly two attempts, no duplicate submit');
  assert.equal(seenIds[0], seenIds[1], 'retry reuses the intent operation ID');
  // A changed payload is a new intent with a fresh ID.
  ctx.openAddModal.call(ctx);
  ctx.addModal.mode = 'expense';
  ctx.addModal.form = { name: 'milk', cost: '10.5', category: 'food', classification: '', source: 'manual', flexibleDefinitionId: '' };
  await ctx.submitNewExpense.call(ctx);
  assert.notEqual(seenIds[2], seenIds[0], 'changed payload mints a fresh ID');
  assert.deepEqual(runtime.calls, [], 'identity retries never reach Store/DB');
}

// 10. Correction: edit/delete/batch retries keep stable IDs; cancel ends
// the intent; mirrored rows carry no fabricated classification.
{
  const runtime = makeRecordingRuntime();
  const ports = makePorts(READY, {
    rows: [{ id: 'canon-9', name: 'bread', expectedCost: 12, actualPaid: 12, isPaid: true, category: 'food', classification: '', date: '2026-09-05' }],
  });
  const ctx = installWith({ runtime, environment: makeEnvironment(), ports });
  // Direct pay-modal invocation is blocked without opening.
  ctx.openPayModal.call(ctx, { id: 'canon-9', name: 'bread', expectedCost: 12, actualPaid: 12, isPaid: true });
  assert.equal(ctx.payModal.open, false, 'candidate pay modal must not open');
  assert.equal(ctx.toasts.length, 1, 'direct pay invocation toasts');
  // Edit retry reuses the ID; mirrored rows invent no classification.
  const editIds = [];
  let editFails = 1;
  ports.history.updateExpense = async (expense, options) => {
    editIds.push(options?.operationId);
    if (editFails > 0) {
      editFails -= 1;
      return { ok: false, reason: 'error' };
    }
    return { ok: true, id: 'canon-10' };
  };
  ctx.openEditModal.call(ctx, { id: 'canon-9', name: 'bread', expectedCost: 12, category: 'food', date: '2026-09-05', classification: '', isPaid: true }, 'expense');
  ctx.editModal.form = { name: 'bread', cost: '14', category: 'food', date: '2026-09-05', classification: '', isPaid: true, actualPaid: 12 };
  await ctx.saveEditedExpense.call(ctx);
  await ctx.saveEditedExpense.call(ctx);
  assert.equal(editIds.length, 2, 'edit retried once');
  assert.equal(editIds[0], editIds[1], 'edit retry reuses the intent ID');
  assert.equal(ctx.editModal.open, false, 'edit closes after durable correction');
  await ctx.selectDate.call(ctx, '2026-09-05');
  assert.ok(ctx.store.currentViewExpenses.every((row) => row.classification === ''), 'mirrored rows carry no fabricated classification');
  // Single-delete retry reuses the ID; cancel ends the intent.
  const deleteIds = [];
  let deleteFails = 1;
  ports.history.deleteExpense = async (id, options) => {
    deleteIds.push(options?.operationId);
    if (deleteFails > 0) {
      deleteFails -= 1;
      return { ok: false, reason: 'error' };
    }
    return { ok: true, id };
  };
  ctx.deleteExpense.call(ctx, 'canon-9');
  await ctx.handleConfirmDialogConfirm.call(ctx);
  await flush();
  ctx.deleteExpense.call(ctx, 'canon-9');
  await ctx.handleConfirmDialogConfirm.call(ctx);
  await flush();
  assert.equal(deleteIds.length, 2, 'delete retried once');
  assert.equal(deleteIds[0], deleteIds[1], 'delete retry reuses the intent ID');
  ctx.deleteExpense.call(ctx, 'canon-9');
  ctx.handleConfirmDialogCancel.call(ctx);
  ctx.deleteExpense.call(ctx, 'canon-9');
  await ctx.handleConfirmDialogConfirm.call(ctx);
  await flush();
  assert.equal(deleteIds.length, 3, 'cancel ends the intent; next confirm mints fresh');
  assert.notEqual(deleteIds[2], deleteIds[0], 'post-cancel delete uses a new ID');
  // Batch retry reuses the exact per-item ID set.
  const batchIds = [];
  let batchFails = 1;
  ports.history.deleteSelected = async (ids, options) => {
    batchIds.push([...(options?.operationIds ?? [])]);
    if (batchFails > 0) {
      batchFails -= 1;
      return { ok: false, reason: 'partial' };
    }
    return { ok: true };
  };
  ctx.selectedExpenseIds = ['a', 'b'];
  ctx.deleteSelectedExpenses.call(ctx);
  await ctx.handleConfirmDialogConfirm.call(ctx);
  await flush();
  ctx.selectedExpenseIds = ['a', 'b'];
  ctx.deleteSelectedExpenses.call(ctx);
  await ctx.handleConfirmDialogConfirm.call(ctx);
  await flush();
  assert.equal(batchIds.length, 2, 'batch retried once');
  assert.deepEqual(batchIds[0], batchIds[1], 'batch retry reuses the exact per-item ID set');
  assert.deepEqual(runtime.calls, [], 'identity retries never reach Store/DB');
}

console.log('p04-d3 routing passed: candidate ports own every D3 action; legacy delegates preserved');
