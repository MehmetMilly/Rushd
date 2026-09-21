// P04-D5 reset/export regression: Factory Reset never exports.
// Run: node tests/application/p04-d5-ios-reset-export.test.mjs
//
// P04-D5 no-export correction (supersedes the old export-first reset).
// Factory Reset must NEVER trigger Export Backup, Web Share, an anchor
// download, file saving, or snapshot generation; Export Backup remains a
// separate explicit user action. After confirmation the reset commits
// exactly once and reloads; cancelling the confirmation does nothing.
//
// The ordinary Export Backup path is unchanged and still resolves through
// the explicit async `saveBackupFile` path: on iOS devices with Web Share
// file support the backup resolves via `navigator.share` (stays in-app,
// settles explicitly); everywhere else the legacy anchor download is
// unchanged; detected iOS without file sharing fails closed (never the
// anchor fallback). Committed expenses rendering checked/paid is expected
// P04-D behavior and is not covered here.
//
// This file drives the real installed controller methods with fake ports
// and a recording runtime and proves:
//   1. a confirmed reset (candidate or legacy, iOS or desktop) performs
//      zero export side effects, exactly one reset, exactly one reload;
//   2. cancelling the reset confirmation does nothing (no reset, no
//      export, no reload, dialog closed);
//   3. a throwing reset surfaces the generic reset-failure dialog;
//   4. the ordinary Export Backup path still behaves (download/share
//      success, silent share dismiss, alerted failure, never a reset);
//   5. no duplicate reset or export is triggered in any path.
import assert from 'node:assert/strict';
import { installRootController } from '../../src/app/root-controller.js';
import { TRANSLATIONS } from '../../src/app/i18n/translations.js';

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

function abortError() {
  const err = new Error('share dismissed');
  err.name = 'AbortError';
  return err;
}

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

// Per-scenario recording environment. `share` controls navigator.share:
// 'accept' resolves, 'abort' throws AbortError, 'fail' throws a generic
// error, null omits Web Share entirely (desktop/Android legacy path).
// `canShareThrows` makes canShare throw (iOS-unavailable probe); `omitFile`
// removes the File constructor (iOS-unavailable probe).
function makeEnvironment(counters, { ua = DESKTOP_UA, maxTouchPoints = 0, share = null, canShareFiles = true, canShareThrows = false, omitFile = false, downloadThrows = false } = {}) {
  const alerts = [];
  let reloads = 0;
  const navigator = { userAgent: ua, maxTouchPoints };
  if (share !== null) {
    navigator.canShare = () => {
      if (canShareThrows) throw new Error('canShare probe failed');
      return canShareFiles;
    };
    navigator.share = async () => {
      counters.shares += 1;
      if (share === 'accept') return undefined;
      if (share === 'abort') throw abortError();
      throw new Error('share failed');
    };
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
    click() {
      if (downloadThrows) throw new Error('download failed');
      counters.downloads += 1;
    },
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
      File: omitFile ? undefined : FakeFile,
      get alerts() { return alerts; },
      get reloads() { return reloads; },
    },
  };
}

function makeRuntime(counters) {
  return {
    Core: {
      UUID: () => 'test-uuid-reset-export',
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
      getAllExpenses: async () => [],
      factoryReset: async () => { counters.resets += 1; },
    },
  };
}

function makePorts(counters, { snapshotThrows = false, resetThrows = false } = {}) {
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
        if (snapshotThrows) throw new Error('snapshot failed');
        return '{"portable":true}';
      },
      factoryReset: async () => {
        counters.resets += 1;
        if (resetThrows) throw new Error('reset failed');
      },
      clearLocalPreferences: () => {},
    },
    navigation: {
      resolveIntent: () => null,
      persistIntent: () => {},
    },
    lifecycle: { getSettings: () => ({ baseAllowance: 1000, theme: 'dark', motionLevel: 'auto' }) },
  };
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
  return { ctx, runtime };
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

// Legacy reset never reaches the controller backup helpers; wrap them so
// any snapshot/save call from the legacy reset path is observed.
function spyLegacyBackupHelpers(ctx, counters) {
  counters.helperSnapshots = 0;
  counters.helperSaves = 0;
  const originalSnapshot = ctx.buildBackupSnapshot;
  ctx.buildBackupSnapshot = async function (...args) {
    counters.helperSnapshots += 1;
    return originalSnapshot.apply(this, args);
  };
  const originalSave = ctx.saveBackupFile;
  ctx.saveBackupFile = async function (...args) {
    counters.helperSaves += 1;
    return originalSave.apply(this, args);
  };
}

// --- saveBackupFile outcome semantics (ordinary Export Backup only) ---

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters);
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  const saved = await ctx.saveBackupFile.call(ctx, '{"ok":true}');
  assert.deepEqual(saved, { ok: true, via: 'download' }, 'desktop save must resolve download success');
  assert.equal(counters.downloads, 1, 'desktop save must trigger exactly one download');
  assert.equal(counters.shares, 0, 'desktop save must never touch Web Share');
}

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept' });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  const saved = await ctx.saveBackupFile.call(ctx, '{"ok":true}');
  assert.deepEqual(saved, { ok: true, via: 'share' }, 'accepted iOS share must resolve share success');
  assert.equal(counters.shares, 1, 'accepted iOS share must call share exactly once');
  assert.equal(counters.downloads, 0, 'accepted iOS share must not also download (no navigation away)');
}

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPAD_DESKTOP_UA, maxTouchPoints: 5, share: 'accept' });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  const saved = await ctx.saveBackupFile.call(ctx, '{"ok":true}');
  assert.deepEqual(saved, { ok: true, via: 'share' }, 'desktop-UA iPad with touch must still share (no navigation away)');
  assert.equal(counters.shares, 1, 'iPad share must call share exactly once');
  assert.equal(counters.downloads, 0, 'iPad share must not also download');
}

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'abort' });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  const saved = await ctx.saveBackupFile.call(ctx, '{"ok":true}');
  assert.deepEqual(saved, { ok: false, reason: 'cancelled' }, 'dismissed share must resolve cancelled, never success');
  assert.equal(counters.downloads, 0, 'dismissed share must not fall back to a navigating download');
}

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'fail' });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  const saved = await ctx.saveBackupFile.call(ctx, '{"ok":true}');
  assert.deepEqual(saved, { ok: false, reason: 'failed' }, 'failed share must resolve failed, never success');
  assert.equal(counters.downloads, 0, 'failed share must not claim a download either');
}

// --- Candidate (canonical) reset: never exports ---

{
  // Success on iOS with share available: zero export side effects,
  // exactly one canonical reset, exactly one reload.
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept' });
  const ports = makePorts(counters);
  const { ctx } = install({ candidate: true, counters, env, ports });
  await confirmFactoryReset(ctx);
  assert.equal(counters.snapshots, 0, 'candidate reset must not build any snapshot');
  assert.equal(counters.shares, 0, 'candidate reset must never touch Web Share');
  assert.equal(counters.downloads, 0, 'candidate iOS reset must not navigate via download');
  assert.equal(counters.resets, 1, 'confirmed reset must let the canonical reset commit exactly once');
  assert.equal(env.reloads, 1, 'committed reset must reload once');
}

{
  // Cancelling the confirmation does nothing: no reset, no export, no reload.
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept' });
  const ports = makePorts(counters);
  const { ctx } = install({ candidate: true, counters, env, ports });
  await ctx.resetApp.call(ctx);
  assert.equal(ctx.confirmDialog.open, true, 'reset must open a confirmation dialog');
  ctx.handleConfirmDialogCancel.call(ctx);
  await flush();
  assert.equal(counters.snapshots, 0, 'cancelled reset must not build any snapshot');
  assert.equal(counters.shares, 0, 'cancelled reset must not share');
  assert.equal(counters.downloads, 0, 'cancelled reset must not download');
  assert.equal(counters.resets, 0, 'cancelled confirmation must never call reset');
  assert.equal(env.reloads, 0, 'cancelled reset must not reload');
  assert.equal(ctx.confirmDialog.open, false, 'cancelled reset must close the dialog');
}

{
  // Reset failure surfaces the generic reset-failure dialog (never a
  // backup dialog), with no export side effects and no reload.
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept' });
  const ports = makePorts(counters, { resetThrows: true });
  const { ctx } = install({ candidate: true, counters, env, ports });
  await confirmFactoryReset(ctx);
  assert.equal(counters.snapshots, 0, 'failed reset must not build any snapshot');
  assert.equal(counters.shares, 0, 'failed reset must not share');
  assert.equal(counters.downloads, 0, 'failed reset must not download');
  assert.equal(counters.resets, 1, 'failed reset must attempt the canonical reset exactly once');
  assert.equal(env.reloads, 0, 'failed reset must not reload');
  assert.equal(ctx.confirmDialog.title, TRANSLATIONS.en.resetFailedTitle, 'failed reset must show the failure dialog');
}

{
  // Desktop parity: same no-export invariant, no share involved either.
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters);
  const ports = makePorts(counters);
  const { ctx } = install({ candidate: true, counters, env, ports });
  await confirmFactoryReset(ctx);
  assert.equal(counters.snapshots, 0, 'desktop candidate reset must not build any snapshot');
  assert.equal(counters.downloads, 0, 'desktop candidate reset must not download anything');
  assert.equal(counters.shares, 0, 'desktop reset must not touch Web Share');
  assert.equal(counters.resets, 1, 'desktop reset must commit exactly once');
  assert.equal(env.reloads, 1, 'committed reset must reload once');
}

// --- Legacy reset (same no-export invariant) ---

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept' });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  spyLegacyBackupHelpers(ctx, counters);
  await confirmFactoryReset(ctx);
  assert.equal(counters.helperSnapshots, 0, 'legacy iOS reset must not build any backup snapshot');
  assert.equal(counters.helperSaves, 0, 'legacy iOS reset must not call saveBackupFile');
  assert.equal(counters.shares, 0, 'legacy iOS reset must never touch Web Share');
  assert.equal(counters.downloads, 0, 'legacy iOS reset must not navigate via download');
  assert.equal(counters.resets, 1, 'legacy reset must commit exactly once');
  assert.equal(env.reloads, 1, 'committed legacy reset must reload once');
}

{
  // Cancelling the confirmation does nothing: no reset, no export, no reload.
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept' });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  spyLegacyBackupHelpers(ctx, counters);
  await ctx.resetApp.call(ctx);
  assert.equal(ctx.confirmDialog.open, true, 'reset must open a confirmation dialog');
  ctx.handleConfirmDialogCancel.call(ctx);
  await flush();
  assert.equal(counters.helperSnapshots, 0, 'cancelled legacy reset must not snapshot');
  assert.equal(counters.helperSaves, 0, 'cancelled legacy reset must not save');
  assert.equal(counters.resets, 0, 'cancelled legacy confirmation must never call reset');
  assert.equal(env.reloads, 0, 'legacy cancelled reset must not reload');
  assert.equal(ctx.confirmDialog.open, false, 'cancelled reset must close the dialog');
}

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters);
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  spyLegacyBackupHelpers(ctx, counters);
  await confirmFactoryReset(ctx);
  assert.equal(counters.helperSnapshots, 0, 'legacy desktop reset must not build any backup snapshot');
  assert.equal(counters.helperSaves, 0, 'legacy desktop reset must not call saveBackupFile');
  assert.equal(counters.downloads, 0, 'legacy desktop reset must not download anything');
  assert.equal(counters.resets, 1, 'legacy desktop reset must commit exactly once');
  assert.equal(env.reloads, 1, 'committed legacy reset must reload once');
}

// --- Ordinary Export Backup path ---

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters);
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  await ctx.exportData.call(ctx);
  await flush();
  assert.equal(counters.downloads, 1, 'ordinary desktop export must download exactly once');
  assert.equal(env.alerts.length, 0, 'successful export must not alert');
  assert.equal(counters.resets, 0, 'ordinary export must never reset');
}

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept' });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  await ctx.exportData.call(ctx);
  await flush();
  assert.equal(counters.shares, 1, 'ordinary iOS export must share exactly once');
  assert.equal(counters.downloads, 0, 'ordinary iOS export must stay in-app (no download navigation)');
  assert.equal(env.alerts.length, 0, 'successful iOS export must not alert');
  assert.equal(counters.resets, 0, 'ordinary export must never reset');
}

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'abort' });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  await ctx.exportData.call(ctx);
  await flush();
  assert.equal(counters.shares, 1, 'dismissed export still opens the sheet exactly once');
  assert.equal(counters.downloads, 0, 'dismissed export must not navigate away');
  assert.equal(env.alerts.length, 0, 'dismissed export must stay silent (no false success, no false failure)');
  assert.equal(counters.resets, 0, 'ordinary export must never reset');
}

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'fail' });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  await ctx.exportData.call(ctx);
  await flush();
  assert.equal(env.alerts.length, 1, 'failed export must alert exactly once');
  assert.equal(env.alerts[0], TRANSLATIONS.en.exportFailed, 'failed export must use the established failure copy');
  assert.equal(counters.resets, 0, 'ordinary export must never reset');
}

// --- P04-D5 follow-up: fail-closed iOS for ordinary export ---
//
// On a detected iPhone/iPad, an absent share path (`navigator.share` /
// `canShare` / `File` missing), `canShare` false, or `canShare` throwing
// must NEVER fall back to the anchor download (the installed-PWA
// navigation-away bug). Ordinary export resolves
// `{ ok: false, reason: 'failed' }` and reports failure. Factory Reset
// never reaches this path at all (see the no-export reset blocks above).
// Non-iOS desktop/Android keeps the anchor download path.

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: null });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  const saved = await ctx.saveBackupFile.call(ctx, '{"ok":true}');
  assert.deepEqual(saved, { ok: false, reason: 'failed' }, 'iPhone without Web Share must fail, never download');
  assert.equal(counters.shares, 0, 'iPhone without Web Share must not call share');
  assert.equal(counters.downloads, 0, 'iPhone without Web Share must never use the anchor fallback');
}

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPAD_DESKTOP_UA, maxTouchPoints: 5, share: null });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  const saved = await ctx.saveBackupFile.call(ctx, '{"ok":true}');
  assert.deepEqual(saved, { ok: false, reason: 'failed' }, 'desktop-UA iPad without Web Share must fail, never download');
  assert.equal(counters.downloads, 0, 'desktop-UA iPad without Web Share must never use the anchor fallback');
}

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept', canShareFiles: false });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  const saved = await ctx.saveBackupFile.call(ctx, '{"ok":true}');
  assert.deepEqual(saved, { ok: false, reason: 'failed' }, 'iPhone with canShare false must fail, never download');
  assert.equal(counters.shares, 0, 'canShare false must not call share');
  assert.equal(counters.downloads, 0, 'canShare false must never use the anchor fallback');
}

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPAD_DESKTOP_UA, maxTouchPoints: 5, share: 'accept', canShareFiles: false });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  const saved = await ctx.saveBackupFile.call(ctx, '{"ok":true}');
  assert.deepEqual(saved, { ok: false, reason: 'failed' }, 'desktop-UA iPad with canShare false must fail, never download');
  assert.equal(counters.downloads, 0, 'desktop-UA iPad with canShare false must never use the anchor fallback');
}

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept', canShareThrows: true });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  const saved = await ctx.saveBackupFile.call(ctx, '{"ok":true}');
  assert.deepEqual(saved, { ok: false, reason: 'failed' }, 'iPhone with throwing canShare must fail, never download');
  assert.equal(counters.shares, 0, 'throwing canShare must not call share');
  assert.equal(counters.downloads, 0, 'throwing canShare must never use the anchor fallback');
}

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept', omitFile: true });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  const saved = await ctx.saveBackupFile.call(ctx, '{"ok":true}');
  assert.deepEqual(saved, { ok: false, reason: 'failed' }, 'iPhone without File must fail, never download');
  assert.equal(counters.downloads, 0, 'iPhone without File must never use the anchor fallback');
}

{
  // No-export reset ignores share availability: iPhone without Web Share
  // still resets exactly once with zero export side effects.
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: null });
  const ports = makePorts(counters);
  const { ctx } = install({ candidate: true, counters, env, ports });
  await confirmFactoryReset(ctx);
  assert.equal(counters.snapshots, 0, 'share-less reset must not build any snapshot');
  assert.equal(counters.downloads, 0, 'share-less iOS reset must never navigate via download');
  assert.equal(counters.resets, 1, 'share-less iOS reset must still commit exactly once');
  assert.equal(env.reloads, 1, 'committed reset must reload once');
}

{
  // Candidate reset proceeds when iPhone canShare is false (share is
  // simply never used by reset).
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept', canShareFiles: false });
  const ports = makePorts(counters);
  const { ctx } = install({ candidate: true, counters, env, ports });
  await confirmFactoryReset(ctx);
  assert.equal(counters.downloads, 0, 'canShare-false iOS reset must never navigate via download');
  assert.equal(counters.resets, 1, 'canShare-false reset must still commit exactly once');
  assert.equal(env.reloads, 1, 'committed reset must reload once');
}

{
  // Legacy reset proceeds when iPhone canShare throws (share is simply
  // never used by reset).
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept', canShareThrows: true });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  spyLegacyBackupHelpers(ctx, counters);
  await confirmFactoryReset(ctx);
  assert.equal(counters.helperSnapshots, 0, 'throwing-canShare legacy reset must not snapshot');
  assert.equal(counters.helperSaves, 0, 'throwing-canShare legacy reset must not save');
  assert.equal(counters.downloads, 0, 'throwing-canShare legacy reset must never navigate via download');
  assert.equal(counters.resets, 1, 'throwing-canShare legacy reset must still commit exactly once');
  assert.equal(env.reloads, 1, 'committed reset must reload once');
}

{
  // Ordinary export on iPhone without share reports failure (never silent, never reset).
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: null });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  await ctx.exportData.call(ctx);
  await flush();
  assert.equal(counters.downloads, 0, 'unavailable-share iOS export must never navigate via download');
  assert.equal(env.alerts.length, 1, 'unavailable-share iOS export must alert exactly once');
  assert.equal(env.alerts[0], TRANSLATIONS.en.exportFailed, 'unavailable-share iOS export must use the established failure copy');
  assert.equal(counters.resets, 0, 'ordinary export must never reset');
}

{
  // Ordinary export on iPhone with canShare false reports failure.
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept', canShareFiles: false });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  await ctx.exportData.call(ctx);
  await flush();
  assert.equal(counters.downloads, 0, 'canShare-false iOS export must never navigate via download');
  assert.equal(env.alerts.length, 1, 'canShare-false iOS export must alert exactly once');
  assert.equal(env.alerts[0], TRANSLATIONS.en.exportFailed, 'canShare-false iOS export must use the established failure copy');
  assert.equal(counters.resets, 0, 'ordinary export must never reset');
}

{
  // Non-iOS Android keeps the anchor download path (no share, one download).
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: ANDROID_UA, maxTouchPoints: 0, share: null });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  const saved = await ctx.saveBackupFile.call(ctx, '{"ok":true}');
  assert.deepEqual(saved, { ok: true, via: 'download' }, 'Android save must resolve download success');
  assert.equal(counters.downloads, 1, 'Android save must trigger exactly one download');
  assert.equal(counters.shares, 0, 'Android save must never touch Web Share');
}

{
  // Non-iOS desktop with Web Share present still keeps the anchor path.
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: DESKTOP_UA, maxTouchPoints: 0, share: 'accept' });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  const saved = await ctx.saveBackupFile.call(ctx, '{"ok":true}');
  assert.deepEqual(saved, { ok: true, via: 'download' }, 'desktop with share present must still download');
  assert.equal(counters.downloads, 1, 'desktop with share present must trigger exactly one download');
  assert.equal(counters.shares, 0, 'desktop must never call share even when present');
}

// --- Copy truthfulness in both launch languages ---
// Reset warns of permanent deletion, names the manual Export Backup action
// the user must take first, and never promises an automatic backup.

{
  for (const locale of ['ar', 'en']) {
    const t = TRANSLATIONS[locale];
    assert.match(t.factoryResetMsg, locale === 'ar' ? /نهائي/ : /permanently deletes/i, `${locale} reset copy must warn of permanent deletion`);
    assert.match(t.factoryResetMsg, locale === 'ar' ? /ألغ/ : /cancel/i, `${locale} reset copy must tell the user to cancel for a backup`);
    assert.match(t.factoryResetMsg, locale === 'ar' ? /تصدير نسخة احتياطية/ : /Export Backup/, `${locale} reset copy must name the manual Export Backup action`);
    assert.match(t.factoryResetMsg, locale === 'ar' ? /غير مشمولة/ : /not included/, `${locale} reset copy must state what is not preserved`);
  }
  assert.doesNotMatch(TRANSLATIONS.en.factoryResetMsg, /safety backup/i, 'en reset copy must not promise an automatic safety backup');
  assert.doesNotMatch(TRANSLATIONS.ar.factoryResetMsg, /سيتم حفظ نسخة احتياطية/, 'ar reset copy must not promise an automatic safety backup');
}

console.log('P04-D5 iOS reset/export correction regression passed');
