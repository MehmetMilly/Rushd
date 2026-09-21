// P04-D5 Factory Reset — no-export correction regression.
// Run: node tests/application/p04-d5-factory-reset-no-export.test.mjs
//
// Founder requirement (authoritative, supersedes export-first reset):
// Factory Reset must NEVER trigger Export Backup, Web Share, an anchor
// download, a JSON preview, file saving, or snapshot generation. Export
// Backup remains a separate explicit user action. After the user confirms
// Factory Reset, the app performs exactly one reset and reloads normally.
// Cancelling the confirmation does nothing.
//
// This file drives the real installed controller methods with fake ports
// and a recording runtime and proves:
//   1. candidate reset after confirmation: zero snapshot/export/share/
//      download/file-save calls, exactly one canonical `factoryReset`,
//      exactly one reload (desktop AND iPhone environments);
//   2. legacy reset after confirmation: zero snapshot/export/share/
//      download/file-save calls, exactly one legacy `DB.factoryReset`,
//      exactly one reload (desktop AND iPhone environments);
//   3. confirmation cancellation: zero reset and zero export side effects,
//      dialog closed, data untouched;
//   4. manual Export Backup still works independently on iOS (share) and
//      non-iOS (download) and never resets;
//   5. bilingual confirmation copy warns of permanent deletion, directs the
//      user to cancel + Export Backup first, and never promises auto-export.
import assert from 'node:assert/strict';
import { installRootController } from '../../src/app/root-controller.js';
import { TRANSLATIONS } from '../../src/app/i18n/translations.js';

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function memoryLocalStorage() {
  const cells = new Map();
  return {
    getItem: (key) => (cells.has(key) ? cells.get(key) : null),
    setItem: (key, value) => { cells.set(key, String(value)); },
    removeItem: (key) => { cells.delete(key); },
    clear: () => cells.clear(),
    get length() { return cells.size; },
    key: (index) => [...cells.keys()][index] ?? null,
  };
}

function makeEnvironment(counters, { ua = DESKTOP_UA, maxTouchPoints = 0, share = null } = {}) {
  const alerts = [];
  let reloads = 0;
  const navigator = { userAgent: ua, maxTouchPoints };
  if (share !== null) {
    navigator.canShare = () => true;
    navigator.share = async () => { counters.shares += 1; };
  }
  class FakeFile {
    constructor(parts, name, options = {}) {
      this.parts = parts;
      this.name = name;
      this.type = options.type || '';
    }
  }
  class FakeBlob {
    constructor(parts, options = {}) {
      this.parts = parts;
      this.type = options.type || '';
    }
  }
  const createAnchor = () => ({
    href: '',
    download: '',
    click() { counters.downloads += 1; },
    setAttribute() {},
  });
  return {
    env: {
      localStorage: memoryLocalStorage(),
      document: {
        documentElement: { dataset: {}, style: {}, dir: '', lang: '' },
        querySelector: () => null,
        createElement: () => createAnchor(),
        body: { appendChild() {}, removeChild() {} },
      },
      navigator,
      window: { matchMedia: () => ({ matches: false }) },
      setTimeout: (...args) => setTimeout(...args),
      clearTimeout: (...args) => clearTimeout(...args),
      alert: (message) => { alerts.push(message); },
      location: { reload: () => { reloads += 1; }, href: 'http://localhost/' },
      Blob: FakeBlob,
      URL: { createObjectURL: () => 'blob:rushd-test', revokeObjectURL() {} },
      FileReader: class { readAsText() {} },
      File: FakeFile,
      get alerts() { return alerts; },
      get reloads() { return reloads; },
    },
  };
}

function makeRuntime(counters) {
  return {
    Core: {
      UUID: () => 'test-uuid-no-export-reset',
      Date: { getTodayISO: () => '2026-09-14', generateWindow: () => [] },
    },
    LEGACY_TEMPLATE_PROFILE: { id: 'legacy' },
    DEFAULT_PROFILE_OFFDAYS: [5, 6],
    ONBOARDING_STATE_KEY: 'onboardingState',
    Store: {
      currentDate: '2026-09-14',
      currentViewExpenses: [],
      statistics: { budgetKnown: false, monthKey: '2026-09', paidSpent: 0, unpaidEssential: 0, safeToSpend: null, projectedBalance: null, categoryBreakdown: [], weeklySpending: [] },
      settings: { theme: 'dark', motionLevel: 'auto', baseAllowance: 1000, activeTemplateProfileId: 'legacy', templateProfiles: [{ id: 'legacy', name: 'Legacy', offdays: [5, 6] }], vault: { balance: 0, goals: [] } },
      templates: [],
    },
    DB: {
      getAllExpenses: async () => [{ id: 'keep-me' }],
      factoryReset: async () => { counters.resets += 1; },
    },
  };
}

function makePorts(counters) {
  return {
    authority: { getState: () => ({ kind: 'ready-stub', writable: true }) },
    home: {
      listSelectedDayExpenses: () => [],
      getSelectedDate: () => '2026-09-14',
      getSafeToSpend: () => null,
      refresh: async () => {},
    },
    plan: { listPlans: () => [] },
    insights: {
      refresh: async () => {},
      getMonthStatistics: () => ({ monthKey: '2026-09', paidSpent: 0, unpaidEssential: 0, safeToSpend: null, projectedBalance: null }),
      getCategoryBreakdown: () => [],
      getWeeklySpending: () => [],
    },
    goals: { getVaultBalance: () => 0, listGoals: () => [] },
    portability: {
      buildSnapshot: async () => {
        counters.snapshots += 1;
        return '{"portable":true}';
      },
      factoryReset: async () => { counters.resets += 1; },
      clearLocalPreferences: () => {},
    },
    navigation: {
      resolveIntent: () => null,
      persistIntent: () => {},
    },
    lifecycle: { getSettings: () => ({ baseAllowance: 1000, theme: 'dark', motionLevel: 'auto' }) },
  };
}

function freshCounters() {
  return { snapshots: 0, methodSnapshots: 0, saves: 0, fileSaves: 0, downloads: 0, shares: 0, resets: 0, exports: 0 };
}

function install({ candidate, counters, env, ports }) {
  const runtime = makeRuntime(counters);
  const mixins = [];
  const app = {
    config: { globalProperties: {} },
    mixin: (m) => mixins.push(m),
    component: () => {},
  };
  installRootController(app, runtime, env, candidate ? { featurePorts: ports } : {});
  const ctx = { $refs: {}, $nextTick: () => {} };
  for (const mixin of mixins) {
    if (mixin.data) Object.assign(ctx, mixin.data.call({}));
    if (mixin.methods) Object.assign(ctx, mixin.methods);
  }
  ctx.store = runtime.Store;
  ctx.core = runtime.Core;
  ctx.lang = 'en';
  ctx.t = TRANSLATIONS.en;
  // Spy every file-save surface so any export/download/share triggered by
  // reset is observed, whichever helper it routes through.
  for (const [method, key] of [['buildBackupSnapshot', 'methodSnapshots'], ['saveBackupFile', 'saves'], ['downloadBackupFile', 'fileSaves'], ['exportData', 'exports']]) {
    const original = ctx[method];
    ctx[method] = async function (...args) {
      counters[key] += 1;
      return original.apply(this, args);
    };
  }
  return { ctx, runtime };
}

function assertZeroExportSideEffects(counters, label) {
  assert.equal(counters.snapshots, 0, `${label}: reset must not build any portability snapshot`);
  assert.equal(counters.methodSnapshots, 0, `${label}: reset must not build any legacy backup snapshot`);
  assert.equal(counters.saves, 0, `${label}: reset must not call saveBackupFile`);
  assert.equal(counters.fileSaves, 0, `${label}: reset must not call downloadBackupFile`);
  assert.equal(counters.exports, 0, `${label}: reset must not call exportData`);
  assert.equal(counters.shares, 0, `${label}: reset must not touch Web Share`);
  assert.equal(counters.downloads, 0, `${label}: reset must not trigger an anchor download`);
}

// Drives Factory Reset through the user-visible confirm dialog, exactly as
// the UI does: open the dialog, then run its confirm callback.
async function confirmFactoryReset(ctx) {
  await ctx.resetApp.call(ctx);
  assert.equal(ctx.confirmDialog.open, true, 'reset must open a confirmation dialog');
  const onConfirm = ctx.confirmDialog.onConfirm;
  assert.equal(typeof onConfirm, 'function', 'reset confirmation must carry a confirm callback');
  await onConfirm();
  await flush();
}

async function cancelFactoryReset(ctx) {
  await ctx.resetApp.call(ctx);
  assert.equal(ctx.confirmDialog.open, true, 'reset must open a confirmation dialog');
  ctx.handleConfirmDialogCancel.call(ctx);
  await flush();
}

// --- 1. Candidate reset after confirmation: no export, one reset, one reload ---

for (const [label, envOptions] of [
  ['candidate/desktop', {}],
  ['candidate/iphone-share', { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept' }],
]) {
  const counters = freshCounters();
  const { env } = makeEnvironment(counters, envOptions);
  const ports = makePorts(counters);
  const { ctx } = install({ candidate: true, counters, env, ports });
  await confirmFactoryReset(ctx);
  assertZeroExportSideEffects(counters, label);
  assert.equal(counters.resets, 1, `${label}: confirmed reset must call canonical factoryReset exactly once`);
  assert.equal(env.reloads, 1, `${label}: committed reset must reload exactly once`);
}

// --- 2. Legacy reset after confirmation: no export, one reset, one reload ---

for (const [label, envOptions] of [
  ['legacy/desktop', {}],
  ['legacy/iphone-share', { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept' }],
]) {
  const counters = freshCounters();
  const { env } = makeEnvironment(counters, envOptions);
  const { ctx, runtime } = install({ candidate: false, counters, env, ports: null });
  await confirmFactoryReset(ctx);
  assertZeroExportSideEffects(counters, label);
  assert.equal(counters.resets, 1, `${label}: confirmed reset must call legacy DB.factoryReset exactly once`);
  assert.equal(env.reloads, 1, `${label}: committed reset must reload exactly once`);
  assert.equal((await runtime.DB.getAllExpenses()).length, 1, `${label}: stub data probe must stay reachable`);
}

// --- 3. Confirmation cancellation: zero reset and zero export side effects ---

for (const [label, candidate] of [['cancel/candidate', true], ['cancel/legacy', false]]) {
  const counters = freshCounters();
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept' });
  const ports = makePorts(counters);
  const { ctx, runtime } = install({ candidate, counters, env, ports });
  await cancelFactoryReset(ctx);
  assertZeroExportSideEffects(counters, label);
  assert.equal(counters.resets, 0, `${label}: cancelled confirmation must never reset`);
  assert.equal(env.reloads, 0, `${label}: cancelled confirmation must never reload`);
  assert.equal(ctx.confirmDialog.open, false, `${label}: cancelled confirmation must close the dialog`);
  assert.equal((await runtime.DB.getAllExpenses()).length, 1, `${label}: cancelled confirmation must leave data untouched`);
}

// --- 4. Manual Export Backup still works independently (and never resets) ---

{
  const counters = freshCounters();
  const { env } = makeEnvironment(counters);
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  await ctx.exportData.call(ctx);
  await flush();
  assert.equal(counters.downloads, 1, 'ordinary desktop export must download exactly once');
  assert.equal(counters.shares, 0, 'ordinary desktop export must never touch Web Share');
  assert.equal(counters.resets, 0, 'ordinary export must never reset');
  assert.equal(env.reloads, 0, 'ordinary export must never reload');
}

{
  const counters = freshCounters();
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept' });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  await ctx.exportData.call(ctx);
  await flush();
  assert.equal(counters.shares, 1, 'ordinary iOS export must share exactly once');
  assert.equal(counters.downloads, 0, 'ordinary iOS export must stay in-app (no download navigation)');
  assert.equal(counters.resets, 0, 'ordinary export must never reset');
  assert.equal(env.reloads, 0, 'ordinary export must never reload');
}

// --- 5. Bilingual confirmation copy is accurate and natural ---

{
  const en = TRANSLATIONS.en;
  assert.match(en.factoryResetMsg, /permanently deletes/i, 'en reset copy must warn of permanent deletion');
  assert.match(en.factoryResetMsg, /cancel/i, 'en reset copy must tell the user to cancel for a backup');
  assert.match(en.factoryResetMsg, /Export Backup/, 'en reset copy must name the manual Export Backup action');
  assert.match(en.factoryResetMsg, /not included/, 'en reset copy must state what is not preserved');
  assert.doesNotMatch(en.factoryResetMsg, /safety backup/i, 'en reset copy must not promise an automatic safety backup');
  assert.doesNotMatch(en.factoryResetMsg, /saved before anything is deleted/i, 'en reset copy must not describe export-before-delete');

  const ar = TRANSLATIONS.ar;
  assert.match(ar.factoryResetMsg, /نهائي/, 'ar reset copy must warn of permanent deletion');
  assert.match(ar.factoryResetMsg, /ألغ/, 'ar reset copy must tell the user to cancel for a backup');
  assert.match(ar.factoryResetMsg, /تصدير نسخة احتياطية/, 'ar reset copy must name the manual Export Backup action');
  assert.match(ar.factoryResetMsg, /غير مشمولة/, 'ar reset copy must state what is not preserved');
  assert.doesNotMatch(ar.factoryResetMsg, /سيتم حفظ نسخة احتياطية/, 'ar reset copy must not promise an automatic safety backup');
  assert.doesNotMatch(ar.factoryResetMsg, /كاملة/, 'ar reset copy must not claim a complete backup');
  assert.doesNotMatch(TRANSLATIONS.en.factoryResetMsg, /full backup|complete backup/i, 'en reset copy must not claim a complete backup');
}

console.log('P04-D5 factory-reset no-export correction regression passed');
