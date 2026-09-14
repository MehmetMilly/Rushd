// P04-D5 import confirmation regression. Run: node tests/application/p04-d5-import-confirmation.test.mjs
import assert from 'node:assert/strict';
import { installRootController } from '../../src/app/root-controller.js';
import { TRANSLATIONS } from '../../src/app/i18n/translations.js';

const storage = new Map();
const localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const restoreCalls = [];
const ports = {
  authority: {
    getState: () => ({ kind: 'ready-stub', writable: true }),
  },
  portability: {
    restoreSnapshot: async (snapshot, options) => {
      restoreCalls.push({ snapshot, options });
      return { ok: true };
    },
  },
  home: {
    listSelectedDayExpenses: () => [],
    getSelectedDate: () => '2026-09-14',
    getSafeToSpend: () => 100,
    refresh: async () => {},
  },
  plan: { listPlans: () => [] },
  insights: {
    refresh: async () => {},
    getMonthStatistics: () => ({ monthKey: '2026-09', paidSpent: 0, unpaidEssential: 0, safeToSpend: 100, projectedBalance: 100 }),
    getCategoryBreakdown: () => [],
    getWeeklySpending: () => [],
  },
  goals: {
    getVaultBalance: () => 0,
    listGoals: () => [],
  },
};

const runtime = {
  Core: {
    UUID: () => 'import-confirmation-test',
    Date: { getTodayISO: () => '2026-09-14', generateWindow: () => [] },
  },
  LEGACY_TEMPLATE_PROFILE: { id: 'legacy' },
  DEFAULT_PROFILE_OFFDAYS: [5, 6],
  Store: {
    currentDate: '2026-09-14',
    currentViewExpenses: [],
    statistics: {},
    settings: { theme: 'dark', motionLevel: 'auto', vault: {} },
    templates: [],
  },
  DB: {},
};

function makeEnvironment() {
  return {
    localStorage,
    document: { documentElement: { dataset: {}, style: {}, dir: '', lang: '' }, querySelector: () => null },
    navigator: {},
    window: { matchMedia: () => ({ matches: false }) },
    setTimeout: () => 0,
    clearTimeout: () => {},
    alert: () => {},
    FileReader: class FakeFileReader {
      readAsText(file) {
        this.onload({ target: { result: file.text } });
      }
    },
  };
}

function install() {
  const mixins = [];
  const app = {
    config: { globalProperties: {} },
    mixin: (mixin) => mixins.push(mixin),
    component: () => {},
  };
  installRootController(app, runtime, makeEnvironment(), { featurePorts: ports });
  const ctx = { $refs: {}, $nextTick: () => {} };
  for (const mixin of mixins) {
    if (mixin.data) Object.assign(ctx, mixin.data.call({}));
    if (mixin.methods) Object.assign(ctx, mixin.methods);
  }
  ctx.store = runtime.Store;
  ctx.core = runtime.Core;
  ctx.lang = 'ar';
  ctx.t = TRANSLATIONS.ar;
  return ctx;
}

async function openImportConfirmation(ctx) {
  await ctx.importDataViaPorts.call(ctx, {
    target: { files: [{ text: JSON.stringify({ version: '3.1', expenses: [] }) }] },
  });
  await new Promise((resolve) => setImmediate(resolve));
}

const ctx = install();
await openImportConfirmation(ctx);
assert.equal(ctx.confirmDialog.open, true, 'valid import must open confirmation');
assert.equal(ctx.confirmDialog.confirmText, TRANSLATIONS.ar.importBtn, 'Arabic import confirmation must say استيراد');
assert.equal(ctx.confirmDialog.confirmColor, 'brand', 'import confirmation must use non-destructive styling');
assert.equal(restoreCalls.length, 0, 'import must wait for confirmation');

ctx.handleConfirmDialogCancel.call(ctx);
assert.equal(ctx.confirmDialog.open, false, 'cancel must close import confirmation');
assert.equal(restoreCalls.length, 0, 'cancel must not import');

ctx.t = TRANSLATIONS.en;
await openImportConfirmation(ctx);
assert.equal(ctx.confirmDialog.confirmText, TRANSLATIONS.en.importBtn, 'English import confirmation must say Import');
ctx.handleConfirmDialogConfirm.call(ctx);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(restoreCalls.length, 1, 'confirm must import exactly once');

ctx.lang = 'ar';
ctx.t = TRANSLATIONS.ar;
await ctx.resetAppViaPorts.call(ctx);
assert.equal(ctx.confirmDialog.confirmText, null, 'reset must keep the shared destructive fallback label');
assert.equal(ctx.confirmDialog.confirmColor, 'danger', 'reset confirmation must remain destructive');
assert.equal(ctx.t.deleteTxt, 'حذف', 'Arabic reset fallback label must remain حذف');

console.log('P04-D5 import confirmation regression passed');
