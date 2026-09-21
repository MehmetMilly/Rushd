// P04-D5 iOS reset/export correction regression.
// Run: node tests/application/p04-d5-ios-reset-export.test.mjs
//
// Physical symptom on an installed iPhone Home Screen PWA: tapping Factory
// Reset downloaded the automatic JSON safety backup as a navigation to a
// JSON preview, so the pending reset continuation never ran ("reset only
// exports"). Committed expenses rendering checked/paid is expected P04-D
// behavior and is not covered here.
//
// The correction routes every safety/ordinary backup through the explicit
// async `saveBackupFile` path: on iOS devices with Web Share file support
// the backup resolves via `navigator.share` (stays in-app, settles
// explicitly); everywhere else the legacy anchor download is unchanged.
// Nothing destructive runs unless the save resolves `{ ok: true }`.
//
// This file drives the real installed controller methods with fake ports
// and a recording runtime and proves:
//   1. a successful safety export lets the reset commit exactly once;
//   2. a cancelled/failed safety export leaves data unchanged and never
//      calls reset (with a truthful cancelled-vs-failed dialog);
//   3. the ordinary Export Backup path still behaves (download/share
//      success, silent share dismiss, alerted failure, never a reset);
//   4. no duplicate reset or export is triggered in any path.
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

function makePorts(counters, { snapshotThrows = false } = {}) {
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

// --- saveBackupFile outcome semantics (shared by reset + ordinary export) ---

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

// --- Candidate (canonical) reset gating ---

{
  // Success: iOS share accepted -> exactly one snapshot, one share, one reset.
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept' });
  const ports = makePorts(counters);
  const { ctx } = install({ candidate: true, counters, env, ports });
  await confirmFactoryReset(ctx);
  assert.equal(counters.snapshots, 1, 'candidate reset must build exactly one safety snapshot');
  assert.equal(counters.shares, 1, 'candidate reset must save exactly once via share');
  assert.equal(counters.downloads, 0, 'candidate iOS reset must not navigate via download');
  assert.equal(counters.resets, 1, 'successful safety export must let the canonical reset commit exactly once');
  assert.equal(env.reloads, 1, 'committed reset must reload once');
}

{
  // Cancelled: dismissed share -> no reset, data unchanged, cancelled dialog.
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'abort' });
  const ports = makePorts(counters);
  const { ctx } = install({ candidate: true, counters, env, ports });
  await confirmFactoryReset(ctx);
  assert.equal(counters.snapshots, 1, 'cancelled reset still attempts exactly one safety export');
  assert.equal(counters.resets, 0, 'dismissed safety export must never call reset');
  assert.equal(counters.downloads, 0, 'dismissed safety export must not navigate away');
  assert.equal(env.reloads, 0, 'cancelled reset must not reload');
  assert.equal(ctx.confirmDialog.title, TRANSLATIONS.en.resetCancelledTitle, 'cancelled reset must show the cancelled dialog');
  assert.equal(ctx.confirmDialog.message, TRANSLATIONS.en.resetCancelled, 'cancelled dialog must state data is unchanged');
}

{
  // Failed: share error -> no reset, failed dialog (not the cancelled copy).
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'fail' });
  const ports = makePorts(counters);
  const { ctx } = install({ candidate: true, counters, env, ports });
  await confirmFactoryReset(ctx);
  assert.equal(counters.resets, 0, 'failed safety export must never call reset');
  assert.equal(env.reloads, 0, 'failed reset must not reload');
  assert.equal(ctx.confirmDialog.title, TRANSLATIONS.en.resetFailedTitle, 'failed reset must show the failure dialog');
}

{
  // Snapshot build failure -> no save attempt, no reset.
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept' });
  const ports = makePorts(counters, { snapshotThrows: true });
  const { ctx } = install({ candidate: true, counters, env, ports });
  await confirmFactoryReset(ctx);
  assert.equal(counters.snapshots, 1, 'snapshot build must be attempted exactly once');
  assert.equal(counters.shares, 0, 'unbuildable snapshot must never reach the save path');
  assert.equal(counters.resets, 0, 'unbuildable snapshot must never call reset');
  assert.equal(ctx.confirmDialog.title, TRANSLATIONS.en.resetFailedTitle, 'snapshot failure must show the failure dialog');
}

{
  // Desktop parity: download success still commits exactly once, no share.
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters);
  const ports = makePorts(counters);
  const { ctx } = install({ candidate: true, counters, env, ports });
  await confirmFactoryReset(ctx);
  assert.equal(counters.downloads, 1, 'desktop reset must download the safety backup exactly once');
  assert.equal(counters.shares, 0, 'desktop reset must not touch Web Share');
  assert.equal(counters.resets, 1, 'desktop reset must commit exactly once after the download');
}

{
  // Download failure (e.g. blocked blob URL) also blocks the reset.
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { downloadThrows: true });
  const ports = makePorts(counters);
  const { ctx } = install({ candidate: true, counters, env, ports });
  await confirmFactoryReset(ctx);
  assert.equal(counters.resets, 0, 'failed download must never call reset');
  assert.equal(env.reloads, 0, 'failed download must not reload');
  assert.equal(ctx.confirmDialog.title, TRANSLATIONS.en.resetFailedTitle, 'failed download must show the failure dialog');
}

// --- Legacy reset gating (same export-first invariant) ---

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept' });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  await confirmFactoryReset(ctx);
  assert.equal(counters.shares, 1, 'legacy iOS reset must save exactly once via share');
  assert.equal(counters.resets, 1, 'legacy reset must commit exactly once after an accepted share');
  assert.equal(counters.downloads, 0, 'legacy iOS reset must not navigate via download');
}

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'abort' });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  await confirmFactoryReset(ctx);
  assert.equal(counters.resets, 0, 'legacy dismissed share must never call reset');
  assert.equal(env.reloads, 0, 'legacy cancelled reset must not reload');
  assert.equal(ctx.confirmDialog.title, TRANSLATIONS.en.resetCancelledTitle, 'legacy cancelled reset must show the cancelled dialog');
}

{
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters);
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  await confirmFactoryReset(ctx);
  assert.equal(counters.downloads, 1, 'legacy desktop reset must download exactly once');
  assert.equal(counters.resets, 1, 'legacy desktop reset must commit exactly once');
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

// --- P04-D5 follow-up: fail-closed iOS when file sharing is unavailable ---
//
// On a detected iPhone/iPad, an absent share path (`navigator.share` /
// `canShare` / `File` missing), `canShare` false, or `canShare` throwing
// must NEVER fall back to the anchor download (the installed-PWA
// navigation-away bug). It resolves `{ ok: false, reason: 'failed' }` so
// reset never commits and ordinary export reports failure. Non-iOS
// desktop/Android keeps the anchor download path.

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
  // Candidate reset blocked when iPhone file sharing is unavailable.
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: null });
  const ports = makePorts(counters);
  const { ctx } = install({ candidate: true, counters, env, ports });
  await confirmFactoryReset(ctx);
  assert.equal(counters.snapshots, 1, 'blocked reset still attempts exactly one safety export');
  assert.equal(counters.downloads, 0, 'blocked iOS reset must never navigate via download');
  assert.equal(counters.resets, 0, 'unavailable iOS share must never call reset');
  assert.equal(env.reloads, 0, 'blocked reset must not reload');
  assert.equal(ctx.confirmDialog.title, TRANSLATIONS.en.resetFailedTitle, 'blocked reset must show the failure dialog (not cancelled copy)');
}

{
  // Candidate reset blocked when iPhone canShare is false.
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept', canShareFiles: false });
  const ports = makePorts(counters);
  const { ctx } = install({ candidate: true, counters, env, ports });
  await confirmFactoryReset(ctx);
  assert.equal(counters.downloads, 0, 'canShare-false iOS reset must never navigate via download');
  assert.equal(counters.resets, 0, 'canShare-false safety export must never call reset');
  assert.equal(env.reloads, 0, 'canShare-false reset must not reload');
  assert.equal(ctx.confirmDialog.title, TRANSLATIONS.en.resetFailedTitle, 'canShare-false reset must show the failure dialog');
}

{
  // Legacy reset blocked when iPhone canShare throws.
  const counters = { snapshots: 0, shares: 0, downloads: 0, resets: 0 };
  const { env } = makeEnvironment(counters, { ua: IPHONE_UA, maxTouchPoints: 3, share: 'accept', canShareThrows: true });
  const { ctx } = install({ candidate: false, counters, env, ports: null });
  await confirmFactoryReset(ctx);
  assert.equal(counters.downloads, 0, 'throwing-canShare legacy reset must never navigate via download');
  assert.equal(counters.resets, 0, 'throwing-canShare legacy reset must never call reset');
  assert.equal(env.reloads, 0, 'throwing-canShare legacy reset must not reload');
  assert.equal(ctx.confirmDialog.title, TRANSLATIONS.en.resetFailedTitle, 'throwing-canShare legacy reset must show the failure dialog');
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

{
  for (const locale of ['ar', 'en']) {
    const t = TRANSLATIONS[locale];
    assert.ok(t.resetCancelledTitle && t.resetCancelled, `${locale} must carry the cancelled-reset copy`);
    assert.ok(t.factoryResetMsg.includes(locale === 'ar' ? 'مشاركة' : 'share'), `${locale} reset copy must disclose the iPhone/iPad save/share choice`);
  }
}

console.log('P04-D5 iOS reset/export correction regression passed');
