// P04-D5 portable roundtrip format-routing regression.
// Run: node tests/application/p04-d5-portable-roundtrip.test.mjs
//
// Red-capable: exports a portable-book backup shape through production
// discriminant logic, feeds it through the real candidate UI/import path
// (installRootController#importData with real FileReader/confirmation/
// exactly-once wiring), and proves the current authority-only routing
// rejects its own export when misrouted (legacy validator says "expenses").
// After the format-routing fix, portable->portable succeeds same-origin,
// legacy->legacy succeeds (no mutation on failure), unknown/corrupt/
// version/scope remain rejected before mutation, cancel does nothing,
// confirm is exactly-once, and ar/en invalidBackup copy stays truthful.
import assert from 'node:assert/strict';
import { installRootController } from '../../src/app/root-controller.js';
import { TRANSLATIONS } from '../../src/app/i18n/translations.js';

const PORTABLE_FORMAT = 'rushd.portable.v1';

function portableDoc() {
  // Minimal portable-book shape using production discriminants only
  // (full P04-C validation lives in tests/data/p04c-portability.test.ts;
  // here we prove ROUTING, not re-implement validation).
  // Uses fake but well-formed scope/bytes; integrity/version/scopeглубок
  // checks remain in the real validators and are preserved by the fix.
  return {
    format: PORTABLE_FORMAT,
    formatVersion: 1,
    localSchemaVersion: 1,
    currency: 'SAR',
    exportedAtMs: 1,
    scope: { scopeId: 'scope:guest:9:test-guest/16:test-device-0001', deviceId: 'test-device-0001', storageId: 'guest-active' },
    snapshotCanonical: JSON.stringify({ books: [], operations: [], outbox: [], delivery: [], enqueueSequence: 0 }),
    checkpointCanonical: JSON.stringify({ scopeId: 'scope:guest:9:test-guest/16:test-device-0001', streams: [] }),
    sourceFingerprint: null,
    migrationId: null,
    integrity: 'fake-integrity-for-routing-only',
  };
}

function legacyBackup() {
  return {
    version: '3.1',
    exportedAt: new Date().toISOString(),
    settings: { baseAllowance: 1000, theme: 'dark', motionLevel: 'auto' },
    templates: [],
    expenses: [],
  };
}

function memoryLocalStorage() {
  const cells = new Map();
  return {
    getItem: (k) => (cells.has(k) ? cells.get(k) : null),
    setItem: (k, v) => cells.set(k, String(v)),
    removeItem: (k) => cells.delete(k),
    clear: () => cells.clear(),
    get length() { return cells.size; },
    key: (i) => [...cells.keys()][i] ?? null,
  };
}

// Real-discriminant mocks (not always-ok): they enforce format routing
// exactly like production validators do at the discriminant layer.
// Full schema/integrity/scope checks stay in the real TS validators.
function makePorts(authorityState, behavior = {}) {
  const calls = { restore: [], legacyRestore: [] };
  return {
    calls,
    authority: {
      getState: () => ({ ...authorityState }),
      assertWritable: (scope) => { if (!authorityState.writable) throw new Error(`blocked for '${scope}'`); },
      describe: () => authorityState.kind,
      getStatus: () => ({ busy: false, error: null }),
    },
    portability: {
      // Production discriminant: portable only. Legacy/unknown must NOT
      // succeed here; they belong to the legacy path (fix routes them).
      restoreSnapshot: async (snapshot, options) => {
        calls.restore.push({ snapshot, options });
        const doc = snapshot && typeof snapshot === 'object' ? snapshot : null;
        if (!doc || doc.format !== PORTABLE_FORMAT) return { ok: false, reason: 'routing-mismatch' };
        return behavior.restoreResult ?? { ok: true, reason: '' };
      },
      // P04-D5 correction: canonical staged-migration entry for validated
      // legacy backups. The discriminant mirrors the host contract: the
      // converted `{ settingsEntries, templates, expenses }` shape plus an
      // explicit destructive confirmation. Full conversion fidelity runs
      // through the real pipeline in tests/data/p04d5-canonical-roundtrip.
      restoreLegacyBackup: async (document, options) => {
        calls.legacyRestore.push({ document, options });
        const doc = document && typeof document === 'object' ? document : null;
        if (!doc || !Array.isArray(doc.settingsEntries) || !Array.isArray(doc.templates) || !Array.isArray(doc.expenses)) {
          return { ok: false, reason: 'validation' };
        }
        if (!options || typeof options.migrationId !== 'string' || options.confirmation !== 'REPLACE-ACTIVE-DATABASE') {
          return { ok: false, reason: 'validation' };
        }
        return behavior.restoreLegacyResult ?? { ok: true, reason: '' };
      },
      buildSnapshot: async () => JSON.stringify(portableDoc()),
      factoryReset: async () => undefined,
      clearLocalPreferences: () => {},
      getStatus: () => ({ busy: false, error: null }),
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
    goals: { getVaultBalance: () => 0, listGoals: () => [] },
    lifecycle: {
      hasUsableBook: () => true,
      getOnboardingState: () => null,
      persistOnboardingState: async (s, src) => ({ status: s, updatedAt: '', source: src ?? '' }),
    },
  };
}

function makeRuntime(overrides = {}) {
  const legacyRestores = [];
  return {
    legacyRestores,
    Core: {
      UUID: () => 'roundtrip-test-uuid',
      Date: { getTodayISO: () => '2026-09-14', generateWindow: () => [] },
    },
    LEGACY_TEMPLATE_PROFILE: { id: 'legacy' },
    DEFAULT_PROFILE_OFFDAYS: [5, 6],
    MONTH_KEY_PATTERN: /^\d{4}-(0[1-9]|1[0-2])$/,
    MONTH_START_PROMPT_DEFER_KEY: 'rushd_month_start_prompt_deferred',
    MONTH_END_PROMPT_DEFER_KEY: 'rushd_month_end_prompt_deferred',
    ONBOARDING_STATE_KEY: 'onboardingState',
    // Minimal real-discriminant legacy validator (mirrors production:
    // portable files have no expenses array -> "expenses", like the
    // physical symptom; legacy files with expenses array pass here).
    validateBackupPayload: (payload) => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'payload' };
      if (!Array.isArray(payload.expenses)) return { ok: false, reason: 'expenses' };
      return { ok: true };
    },
    normalizePersistedMoney: (v) => v,
    normalizeMotionLevel: (v) => v,
    normalizeMonthlyBaseAllowances: (v) => v,
    isPlainObjectRecord: (v) => !!v && typeof v === 'object' && !Array.isArray(v),
    Store: {
      currentDate: '2026-09-14',
      currentViewExpenses: [],
      statistics: {},
      settings: { theme: 'dark', motionLevel: 'auto', vault: {} },
      templates: [],
      init: async () => {},
    },
    DB: {
      restoreBackupRecords: async (args) => { legacyRestores.push(args); },
    },
    ...overrides,
  };
}

function makeEnvironment(alerts) {
  return {
    localStorage: memoryLocalStorage(),
    document: {
      documentElement: { dir: '', lang: '', dataset: {}, style: {} },
      querySelector: () => null,
      body: { appendChild() {}, removeChild() {} },
      createElement: () => ({ click() {}, style: {} }),
    },
    navigator: {},
    window: { matchMedia: () => ({ matches: false }) },
    setTimeout: () => 0,
    clearTimeout: () => {},
    alert: (m) => alerts.push(m),
    Blob: class { constructor(parts) { this.text = parts.join(''); } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    FileReader: class FakeFileReader {
      readAsText(file) { this.onload({ target: { result: file.text } }); }
    },
  };
}

function install({ runtime, environment, ports }) {
  const mixins = [];
  const app = { config: { globalProperties: {} }, mixin: (m) => mixins.push(m), component: () => {} };
  installRootController(app, runtime, environment, ports ? { featurePorts: ports } : {});
  const ctx = { $refs: {}, $nextTick: () => {}, store: runtime.Store, core: runtime.Core, lang: 'ar', t: TRANSLATIONS.ar };
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

const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)); };
const READY = { kind: 'ready-stub', writable: true };

async function driveImport(ctx, payload) {
  const alerts = ctx.__alerts;
  alerts.length = 0;
  await ctx.importData.call(ctx, { target: { files: [{ text: typeof payload === 'string' ? payload : JSON.stringify(payload) }], value: '' } });
  await flush();
  return { confirmOpen: ctx.confirmDialog.open, alerts: [...alerts] };
}

// 1. Portable export must be importable via the production candidate path
//    (same-origin, portable->portable). Currently the authority-only router
//    sends every candidate-mode file to the portable mock, so portable
//    succeeds here; the RED leg is #2 (legacy misrouted to portable).
{
  const alerts = [];
  const runtime = makeRuntime();
  const ports = makePorts(READY);
  const ctx = install({ runtime, environment: makeEnvironment(alerts), ports });
  ctx.__alerts = alerts;
  const res = await driveImport(ctx, portableDoc());
  assert.equal(res.confirmOpen, true, 'portable backup must open confirmation on the candidate path');
  assert.equal(ctx.confirmDialog.confirmText, TRANSLATIONS.ar.importBtn, 'confirmation must say استيراد');
  ctx.handleConfirmDialogConfirm.call(ctx);
  await flush();
  assert.equal(ports.calls.restore.length, 1, 'portable confirm must restore exactly once via portable path');
  assert.equal(runtime.legacyRestores.length, 0, 'portable must never touch the legacy restore path');
}

// 2. Legacy backup in candidate mode must NOT be sent to the portable
//    path — and must NOT touch the frozen v1 writers. Before the format
//    fix, authority-only routing called restoreSnapshot with a legacy
//    payload (portable discriminant rejects -> RED). The P04-D5 correction
//    routes it to the canonical staged-migration port instead: valid legacy
//    opens confirmation and restores once via restoreLegacyBackup with an
//    explicit destructive confirmation, with no mutation on invalid.
{
  const alerts = [];
  const runtime = makeRuntime();
  const ports = makePorts(READY);
  const ctx = install({ runtime, environment: makeEnvironment(alerts), ports });
  ctx.__alerts = alerts;
  const opened = await driveImport(ctx, legacyBackup());
  await flush();
  assert.equal(opened.confirmOpen, true, 'legacy backup must open confirmation on the legacy path');
  assert.equal(
    ports.calls.restore.length, 0,
    `legacy backup must not reach the portable restore path (got ${ports.calls.restore.length} portable calls)`,
  );
  ctx.handleConfirmDialogConfirm.call(ctx);
  await flush();
  assert.equal(
    ports.calls.restore.length, 0,
    `legacy confirm must not touch portable restore (got ${ports.calls.restore.length} portable calls)`,
  );
  assert.equal(ports.calls.legacyRestore.length, 1, 'legacy confirm must restore exactly once via the canonical migration port');
  assert.equal(
    ports.calls.legacyRestore[0].options.confirmation, 'REPLACE-ACTIVE-DATABASE',
    'legacy restore must carry the explicit destructive confirmation',
  );
  assert.equal(typeof ports.calls.legacyRestore[0].options.migrationId, 'string', 'legacy restore must carry a migration identity');
  assert.equal(
    runtime.legacyRestores.length, 0,
    `candidate legacy must never touch the frozen v1 writers (got ${runtime.legacyRestores.length} v1 restores)`,
  );
  assert.equal(alerts.length, 0, 'valid legacy must not alert');
}

// 3. Unknown/corrupt payloads must be rejected before mutation (no restore,
//    no legacy write), in both languages with truthful copy.
{
  for (const lang of ['ar', 'en']) {
    const alerts = [];
    const runtime = makeRuntime();
    const ports = makePorts(READY);
    const ctx = install({ runtime, environment: makeEnvironment(alerts), ports });
    ctx.__alerts = alerts;
    ctx.lang = lang;
    ctx.t = TRANSLATIONS[lang];
    await driveImport(ctx, { hello: 'world' });
    await flush();
    assert.equal(ports.calls.restore.length, 0, `[${lang}] unknown format must not reach portable restore`);
    assert.equal(runtime.legacyRestores.length, 0, `[${lang}] unknown format must not touch legacy restore`);
    assert.ok(alerts.includes(TRANSLATIONS[lang].invalidBackup), `[${lang}] unknown format must show truthful invalidBackup copy`);
  }
  assert.equal(TRANSLATIONS.ar.invalidBackup, 'صيغة النسخة الاحتياطية غير صالحة', 'Arabic invalidBackup copy must stay truthful');
  assert.equal(TRANSLATIONS.en.invalidBackup, 'Invalid backup file format', 'English invalidBackup copy must stay truthful');
}

// 4. Cancel performs no callback; confirm is exactly-once (both paths).
{
  const alerts = [];
  const runtime = makeRuntime();
  const ports = makePorts(READY);
  const ctx = install({ runtime, environment: makeEnvironment(alerts), ports });
  ctx.__alerts = alerts;
  await driveImport(ctx, portableDoc());
  ctx.handleConfirmDialogCancel.call(ctx);
  await flush();
  assert.equal(ports.calls.restore.length, 0, 'portable cancel must perform no restore');
  assert.equal(runtime.legacyRestores.length, 0, 'portable cancel must not touch legacy');
  await driveImport(ctx, portableDoc());
  ctx.handleConfirmDialogConfirm.call(ctx);
  await flush();
  assert.equal(ports.calls.restore.length, 1, 'one portable confirm must restore exactly once');
}

{
  const alerts = [];
  const runtime = makeRuntime();
  const ports = makePorts(READY);
  const ctx = install({ runtime, environment: makeEnvironment(alerts), ports });
  ctx.__alerts = alerts;
  await driveImport(ctx, legacyBackup());
  ctx.handleConfirmDialogCancel.call(ctx);
  await flush();
  assert.equal(ports.calls.restore.length, 0, 'legacy cancel must not reach portable restore');
  assert.equal(ports.calls.legacyRestore.length, 0, 'legacy cancel must not reach the migration port');
  assert.equal(runtime.legacyRestores.length, 0, 'legacy cancel must perform no legacy restore');
}

// 5. Legacy authority (non-candidate) keeps the unfrozen v1 atomic path:
//    no port call, exactly one DB restore on confirm.
{
  const alerts = [];
  const runtime = makeRuntime();
  const ports = makePorts({ kind: 'legacy', writable: true });
  const ctx = install({ runtime, environment: makeEnvironment(alerts), ports });
  ctx.__alerts = alerts;
  const opened = await driveImport(ctx, legacyBackup());
  await flush();
  assert.equal(opened.confirmOpen, true, 'legacy-authority backup must open confirmation');
  ctx.handleConfirmDialogConfirm.call(ctx);
  await flush();
  assert.equal(ports.calls.restore.length, 0, 'legacy authority must not reach portable restore');
  assert.equal(ports.calls.legacyRestore.length, 0, 'legacy authority must not reach the migration port');
  assert.equal(runtime.legacyRestores.length, 1, 'legacy authority confirm must restore exactly once via the v1 atomic path');
  assert.equal(alerts.length, 0, 'valid legacy-authority import must not alert');
}

console.log('P04-D5 portable roundtrip format-routing regression passed');
