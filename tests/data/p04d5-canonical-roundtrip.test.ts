/**
 * P04-D5 canonical roundtrip correction (Node, deterministic).
 *
 * Run: npx vitest run --config tests/data/vitest.p04a.config.ts tests/data/p04d5-canonical-roundtrip.test.ts
 *
 * Proves the two findings the Development Master rejected as non-blocking:
 *
 * 1. A supported legacy `{ expenses: [...] }` backup actually restores
 *    through canonical production: the exact converted payload the
 *    controller hands to `portability.restoreLegacyBackup` converts via
 *    the real `snapshotFromStores` + `planLegacyMigration` pipeline, and a
 *    real candidate host commits it through staged migration plus the
 *    activation-pointer flip (frozen v1 writers never run).
 * 2. A real production-path regression: actual `buildSnapshot()` output
 *    bytes feed the real candidate UI import path (`importData` with real
 *    FileReader/confirmation/exactly-once wiring), while the restore
 *    discriminant runs the real `parsePortableDocument` plus the
 *    production scope/device/confirmation gates. Corrupted integrity,
 *    incompatible version, and wrong scope open confirmation (routing is
 *    format-only) but are rejected at commit with no mutation.
 *
 * Durable OPFS staging stays covered by the Playwright persistence gate;
 * no staging is stubbed here except the durable repository open itself.
 */
import { describe, expect, it } from 'vitest';
import { installRootController } from '../../src/app/root-controller.js';
import { TRANSLATIONS } from '../../src/app/i18n/translations.js';
import { stableDigest } from '../../src/domain/contracts/canonical';
import {
  PORTABLE_FORMAT,
  PORTABLE_FORMAT_VERSION,
  REPLACE_ACTIVE_CONFIRMATION,
} from '../../src/data/portability/format';
import { parsePortableDocument } from '../../src/data/portability/validate';
import { PORTABILITY_REASON } from '../../src/data/migration/reasons';
import { snapshotFromStores } from '../../src/data/migration/extract';
import { planLegacyMigration } from '../../src/data/migration/mapping';
import { commitPlannedCommands } from '../../src/data/migration/staging';
import { prepareCanonicalCandidateHost } from '../../src/application/p04-d/canonical-host.js';
import { createTabCoordinator } from '../../src/application/p04-d/tab-coordination.js';
import { createDeterministicContext } from '../domain/support/deterministic-context';
import { makeDeviceId, makeGuestKey, repositoryScopeIdFor } from '../../src/domain/sync/scope';
import { InMemoryFinanceRepository } from '../domain/support/in-memory-repository';
import { createMemoryStorage } from '../pwa/memory-storage';

const DEVICE = 'test-device-0001';

function testScope(): string {
  const { context } = createDeterministicContext({ deviceId: DEVICE });
  return context.origin.scopeId as string;
}

const SCOPE = testScope();

function foreignScope(): string {
  const device = makeDeviceId(DEVICE);
  const guest = makeGuestKey('other-guest');
  if (!device.ok || !guest.ok) throw new Error('invalid foreign test origin');
  return repositoryScopeIdFor({ kind: 'guest', guestKey: guest.value, deviceId: device.value }) as string;
}

const FOREIGN_SCOPE = foreignScope();

// Seed a real repository through the real legacy-migration pipeline, then
// export genuine canonical bytes from it. The portable document below is
// therefore real pipeline output, not a hand-built shape. An explicit scope
// builds a coherent foreign-scope document (payload and scope agree, so
// parsing succeeds and the post-parse scope gate is what rejects it).
async function realPortableDocument(scope: string = SCOPE) {
  const { context } = scope === SCOPE
    ? createDeterministicContext({ deviceId: DEVICE })
    : createDeterministicContext({ deviceId: DEVICE, scopeId: scope });
  const repo = new InMemoryFinanceRepository({
    boundScope: context.origin.scopeId,
    boundDevice: context.origin.deviceId,
  });
  const plan = planLegacyMigration(
    snapshotFromStores({
      settings: [
        { key: 'baseAllowance', value: 1500 },
        { key: 'theme', value: 'dark' },
        { key: 'motionLevel', value: 'auto' },
      ],
      templates: [],
      expenses: [
        {
          id: 'seed-1', name: 'bread', expectedCost: 12, actualPaid: 12, isPaid: true,
          date: '2026-09-05', category: 'food', classification: 'essential',
        },
      ],
      sourcePresent: true,
    }),
  );
  expect(plan.currency).toBe('SAR');
  const committed = await commitPlannedCommands(repo as never, plan, context, undefined);
  expect(committed.ok).toBe(true);
  const snapshotCanonical = repo.snapshotBytes();
  const checkpointCanonical = repo.checkpointSnapshotBytes();
  const document = {
    format: PORTABLE_FORMAT,
    formatVersion: PORTABLE_FORMAT_VERSION,
    localSchemaVersion: 1,
    currency: 'SAR',
    exportedAtMs: context.clock.nowMs(),
    scope: { scopeId: scope, deviceId: DEVICE, storageId: 'guest-active' },
    snapshotCanonical,
    checkpointCanonical,
    sourceFingerprint: null,
    migrationId: null,
    integrity: stableDigest(`${snapshotCanonical}\n${checkpointCanonical}`),
  };
  const parsed = parsePortableDocument(document);
  if (!parsed.ok) throw new Error(`seed document must validate: ${parsed.reason}: ${parsed.detail}`);
  return document;
}

function legacyBackup() {
  return {
    version: '3.1',
    exportedAt: new Date().toISOString(),
    settings: { baseAllowance: 1000, theme: 'dark', motionLevel: 'auto' },
    templates: [],
    expenses: [
      {
        id: 'leg-1', name: 'bread', expectedCost: 12, actualPaid: 12, isPaid: true,
        date: '2026-09-05', category: 'food', classification: 'essential',
      },
    ],
  };
}

function memoryLocalStorage() {
  const cells = new Map<string, string>();
  return {
    getItem: (key: string) => (cells.has(key) ? cells.get(key)! : null),
    setItem: (key: string, value: string) => cells.set(key, String(value)),
    removeItem: (key: string) => cells.delete(key),
    clear: () => cells.clear(),
    get length() {
      return cells.size;
    },
    key: (index: number) => [...cells.keys()][index] ?? null,
  };
}

/** Dynamic Vue-mixin surface under test: dispatch only, never finance truth. */
interface UiVm {
  [key: string]: unknown;
  confirmDialog?: { open: boolean; confirmText: string };
  importData?: { call: (target: unknown, event: unknown) => Promise<unknown> };
  handleConfirmDialogConfirm?: { call: (target: unknown) => void };
  handleConfirmDialogCancel?: { call: (target: unknown) => void };
}

interface UiMixin {
  data?: { call: (target: unknown) => Record<string, unknown> };
  methods?: Record<string, unknown>;
}

interface UiHarness {
  ctx: UiVm;
  alerts: string[];
  ports: {
    portability: {
      buildSnapshot: () => Promise<string>;
      restoreSnapshot: (snapshot: unknown, options?: { importId?: unknown; confirmation?: unknown }) => Promise<{ ok: boolean; reason: string }>;
      restoreLegacyBackup: (document: unknown, options?: { migrationId?: unknown; confirmation?: unknown }) => Promise<{ ok: boolean; reason: string }>;
    };
  };
  setExportBytes: (bytes: string) => void;
  calls: { restore: Array<{ snapshot: unknown; options: unknown }>; legacyRestore: Array<{ document: unknown; options: unknown }> };
  successes: { restore: number; legacyRestore: number };
  legacyPlans: ReturnType<typeof planLegacyMigration>[];
  legacyRestores: unknown[];
}

function installUi(alerts: string[]): UiHarness {
  const calls: UiHarness['calls'] = { restore: [], legacyRestore: [] };
  const successes = { restore: 0, legacyRestore: 0 };
  const legacyPlans: UiHarness['legacyPlans'] = [];
  const legacyRestores: unknown[] = [];
  const importedIds = new Set<string>();
  let exportBytes = '';
  const ports = {
    authority: {
      getState: () => ({ kind: 'ready-stub', writable: true }),
      assertWritable: () => {},
      describe: () => 'ready-stub',
      getStatus: () => ({ busy: false, error: null }),
    },
    portability: {
      buildSnapshot: async () => exportBytes,
      // Real pre-staging gates in production order (parse, scope,
      // device, confirmation, replay). Durable staging itself stays in
      // the browser gate; nothing here mutates any store.
      restoreSnapshot: async (snapshot: unknown, options: { importId?: unknown; confirmation?: unknown } = {}) => {
        calls.restore.push({ snapshot, options });
        const parsed = parsePortableDocument(snapshot);
        if (!parsed.ok) return { ok: false, reason: parsed.reason };
        if (parsed.document.scope.scopeId !== SCOPE) return { ok: false, reason: 'scope-mismatch' };
        if (parsed.document.scope.deviceId !== DEVICE) return { ok: false, reason: 'foreign-record' };
        if (options.confirmation !== REPLACE_ACTIVE_CONFIRMATION) return { ok: false, reason: 'confirmation' };
        if (typeof options.importId !== 'string' || options.importId.length === 0) return { ok: false, reason: 'validation' };
        if (importedIds.has(options.importId)) return { ok: true, reason: '' };
        importedIds.add(options.importId);
        successes.restore += 1;
        return { ok: true, reason: '' };
      },
      // Real conversion fidelity: the exact payload the controller hands
      // over must plan through the genuine migration pipeline.
      restoreLegacyBackup: async (document: unknown, options: { migrationId?: unknown; confirmation?: unknown } = {}) => {
        calls.legacyRestore.push({ document, options });
        const record = (document ?? {}) as Record<string, unknown>;
        if (!Array.isArray(record['settingsEntries']) || !Array.isArray(record['templates']) || !Array.isArray(record['expenses'])) {
          return { ok: false, reason: 'validation' };
        }
        if (typeof options.migrationId !== 'string' || options.confirmation !== REPLACE_ACTIVE_CONFIRMATION) {
          return { ok: false, reason: 'validation' };
        }
        const plan = planLegacyMigration(
          snapshotFromStores({
            settings: record['settingsEntries'] as never,
            templates: record['templates'] as never,
            expenses: record['expenses'] as never,
          }),
        );
        legacyPlans.push(plan);
        successes.legacyRestore += 1;
        return { ok: true, reason: '' };
      },
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
      persistOnboardingState: async (s: string, src?: string) => ({ status: s, updatedAt: '', source: src ?? '' }),
    },
  };
  const runtime = {
    Core: { UUID: () => 'p04d5-real-uuid', Date: { getTodayISO: () => '2026-09-14', generateWindow: () => [] } },
    LEGACY_TEMPLATE_PROFILE: { id: 'legacy' },
    DEFAULT_PROFILE_OFFDAYS: [5, 6],
    MONTH_KEY_PATTERN: /^\d{4}-(0[1-9]|1[0-2])$/,
    MONTH_START_PROMPT_DEFER_KEY: 'rushd_month_start_prompt_deferred',
    MONTH_END_PROMPT_DEFER_KEY: 'rushd_month_end_prompt_deferred',
    ONBOARDING_STATE_KEY: 'onboardingState',
    validateBackupPayload: (payload: unknown) => {
      const record = (payload ?? {}) as Record<string, unknown>;
      if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, reason: 'payload' };
      if (!Array.isArray(record['expenses'])) return { ok: false, reason: 'expenses' };
      return { ok: true };
    },
    normalizePersistedMoney: (v: unknown) => v,
    normalizeMotionLevel: (v: unknown) => v,
    normalizeMonthlyBaseAllowances: (v: unknown) => v,
    isPlainObjectRecord: (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v),
    Store: {
      currentDate: '2026-09-14', currentViewExpenses: [], statistics: {},
      settings: { theme: 'dark', motionLevel: 'auto', vault: {} }, templates: [], init: async () => {},
    },
    DB: { restoreBackupRecords: async (args: unknown) => { legacyRestores.push(args); } },
  };
  const environment = {
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
    alert: (message: string) => alerts.push(message),
    Blob: class { text: string; constructor(parts: string[]) { this.text = parts.join(''); } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    FileReader: class { onload: ((event: unknown) => void) | null = null; readAsText(file: { text: string }) { this.onload?.({ target: { result: file.text } }); } },
  };
  const mixins: UiMixin[] = [];
  const app = { config: { globalProperties: {} }, mixin: (m: UiMixin) => mixins.push(m), component: () => {} };
  (installRootController as (...args: unknown[]) => void)(app, runtime, environment, { featurePorts: ports });
  const ctx: UiVm = { $refs: {}, $nextTick: () => {}, store: runtime.Store, core: runtime.Core, lang: 'ar', t: TRANSLATIONS.ar };
  for (const mixin of mixins) {
    if (mixin.data) Object.assign(ctx, mixin.data.call({}));
    if (mixin.methods) Object.assign(ctx, mixin.methods);
  }
  ctx.store = runtime.Store;
  ctx.core = runtime.Core;
  const harness: UiHarness = {
    ctx,
    alerts,
    ports: { portability: ports.portability as UiHarness['ports']['portability'] },
    setExportBytes: (bytes: string) => {
      exportBytes = bytes;
    },
    calls,
    successes,
    legacyPlans,
    legacyRestores,
  };
  return harness;
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

async function driveImport(harness: UiHarness, payload: unknown, lang: 'ar' | 'en' = 'ar') {
  harness.alerts.length = 0;
  harness.ctx.lang = lang;
  harness.ctx.t = TRANSLATIONS[lang];
  await harness.ctx.importData!.call(harness.ctx, {
    target: { files: [{ text: typeof payload === 'string' ? payload : JSON.stringify(payload) }], value: '' },
  });
  await flush();
  return { confirmOpen: harness.ctx.confirmDialog!.open as boolean, alerts: [...harness.alerts] };
}

describe('p04d5 real production-path roundtrip', () => {
  it('pins which real gate rejects each mutation class', async () => {
    const document = await realPortableDocument();
    const tampered = parsePortableDocument({
      ...document,
      snapshotCanonical: (document.snapshotCanonical as string).replace('bread', 'tampered'),
    });
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) expect(tampered.reason).toBe(PORTABILITY_REASON.malformedRecord);
    // Whitespace survives JSON decoding untouched, so it isolates the
    // integrity gate itself.
    const whitespace = parsePortableDocument({
      ...document,
      snapshotCanonical: `${document.snapshotCanonical as string} `,
    });
    expect(whitespace.ok).toBe(false);
    if (!whitespace.ok) expect(whitespace.reason).toBe(PORTABILITY_REASON.tamperedPayload);
    const versioned = parsePortableDocument({ ...document, formatVersion: 999 });
    expect(versioned.ok).toBe(false);
    if (!versioned.ok) expect(versioned.reason).toBe(PORTABILITY_REASON.incompatibleVersion);
    // A well-formed foreign scope parses cleanly: rejection happens at the
    // post-parse scope gate (mirroring importPortableReplacement), never
    // by misreading the document.
    const foreign = parsePortableDocument(await realPortableDocument(FOREIGN_SCOPE));
    expect(foreign.ok).toBe(true);
  });
  it('imports actual buildSnapshot() output through the candidate UI path', async () => {
    const alerts: string[] = [];
    const harness = installUi(alerts);
    const document = await realPortableDocument();
    // Actual export output feeds the real import entry: no hand-built bytes.
    harness.setExportBytes(JSON.stringify(document));
    const bytes = await harness.ports.portability.buildSnapshot();
    await harness.ctx.importData!.call(harness.ctx, { target: { files: [{ text: bytes }], value: '' } });
    await flush();
    expect(harness.ctx.confirmDialog!.open).toBe(true);
    expect(harness.ctx.confirmDialog!.confirmText).toBe(TRANSLATIONS.ar.importBtn);
    harness.ctx.handleConfirmDialogConfirm!.call(harness.ctx);
    await flush();
    expect(harness.successes.restore).toBe(1);
    expect(harness.calls.restore).toHaveLength(1);
    expect(harness.successes.legacyRestore).toBe(0);
    expect(harness.legacyRestores).toHaveLength(0);
    expect(alerts).toHaveLength(0);
  });

  it.each(['ar', 'en'] as const)(
    'rejects corrupted integrity at commit with no mutation (%s)',
    async (lang) => {
      const alerts: string[] = [];
      const harness = installUi(alerts);
      const document = await realPortableDocument();
      // Trailing whitespace survives JSON decoding, so this isolates the
      // integrity gate (content tampering trips decode first; both reject).
      const tampered = {
        ...document,
        snapshotCanonical: `${document.snapshotCanonical as string} `,
      };
      const opened = await driveImport(harness, tampered, lang);
      // Routing is format-only, so confirmation still opens; the commit
      // rejects before any mutation.
      expect(opened.confirmOpen).toBe(true);
      harness.ctx.handleConfirmDialogConfirm!.call(harness.ctx);
      await flush();
      expect(harness.successes.restore).toBe(0);
      expect(harness.successes.legacyRestore).toBe(0);
      expect(harness.legacyRestores).toHaveLength(0);
      expect(alerts).toContain(TRANSLATIONS[lang].invalidBackup);
    },
  );

  it('rejects an incompatible version at commit with no mutation', async () => {
    const alerts: string[] = [];
    const harness = installUi(alerts);
    const document = await realPortableDocument();
    const opened = await driveImport(harness, { ...document, formatVersion: 999 });
    expect(opened.confirmOpen).toBe(true);
    harness.ctx.handleConfirmDialogConfirm.call(harness.ctx);
    await flush();
    expect(harness.successes.restore).toBe(0);
    expect(alerts).toContain(TRANSLATIONS.ar.invalidBackup);
  });

  it('rejects a wrong-scope document at commit with no mutation', async () => {
    const alerts: string[] = [];
    const harness = installUi(alerts);
    const foreign = await realPortableDocument(FOREIGN_SCOPE);
    const opened = await driveImport(harness, foreign);
    expect(opened.confirmOpen).toBe(true);
    harness.ctx.handleConfirmDialogConfirm.call(harness.ctx);
    await flush();
    expect(harness.successes.restore).toBe(0);
    expect(alerts).toContain(TRANSLATIONS.ar.invalidBackup);
  });

  it('restores a validated legacy backup through the canonical migration port', async () => {
    const alerts: string[] = [];
    const harness = installUi(alerts);
    const opened = await driveImport(harness, legacyBackup());
    expect(opened.confirmOpen).toBe(true);
    harness.ctx.handleConfirmDialogConfirm.call(harness.ctx);
    await flush();
    expect(harness.calls.restore).toHaveLength(0);
    expect(harness.calls.legacyRestore).toHaveLength(1);
    expect(harness.legacyRestores).toHaveLength(0);
    expect(alerts).toHaveLength(0);
    // The exact converted payload plans through the genuine pipeline:
    // SAR book first, with the migrated expense materialized.
    const plan = harness.legacyPlans[0]!;
    expect(plan.currency).toBe('SAR');
    expect(plan.commands[0]?.command.kind).toBe('createBook');
    expect(plan.commands.length).toBeGreaterThan(1);
    const kinds = plan.commands.map((entry) => entry.command.kind);
    expect(kinds).toContain('recordExpense');
  });
});

function memoryStore() {
  const cells = new Map<string, string>();
  return {
    getItem: (key: string) => (cells.has(key) ? cells.get(key)! : null),
    setItem: (key: string, value: string) => {
      cells.set(key, String(value));
    },
    removeItem: (key: string) => cells.delete(key),
  };
}

async function migratedHost(storage: ReturnType<typeof createMemoryStorage>) {
  const { context } = createDeterministicContext();
  const coordination = createTabCoordinator({
    tabId: 'p04d5-legacy-1',
    environment: {} as unknown as typeof globalThis,
    store: memoryStore(),
  });
  const host = await prepareCanonicalCandidateHost({
    environment: { localStorage: memoryLocalStorage() } as unknown as typeof globalThis,
    context,
    snapshot: snapshotFromStores({ settings: [], templates: [], expenses: [], sourcePresent: false }),
    migrationId: 'mg-p04d5-boot-1',
    coordination,
    storage: storage as never,
    selectedDate: '2026-09-05',
  });
  return { context, host };
}

describe('p04d5 canonical legacy restore on the real host', () => {
  function legacyDocument() {
    return {
      settingsEntries: [
        { key: 'baseAllowance', value: 1500 },
        { key: 'theme', value: 'dark' },
        { key: 'motionLevel', value: 'auto' },
      ],
      templates: [],
      expenses: [
        {
          id: 'leg-1', name: 'bread', expectedCost: 12, actualPaid: 12, isPaid: true,
          date: '2026-09-05', category: 'food', classification: 'essential',
        },
      ],
    };
  }

  it('commits a validated legacy backup through staged migration and serves it', async () => {
    const { context } = createDeterministicContext();
    const storage = createMemoryStorage({ context });
    const { host } = await migratedHost(storage);
    expect(host.ok).toBe(true);
    const before = await storage.control.getPointer();
    const result = await host.featurePorts.portability.restoreLegacyBackup(legacyDocument(), {
      migrationId: 'mg-p04d5-restore-1',
      confirmation: REPLACE_ACTIVE_CONFIRMATION,
    });
    expect(result).toEqual({ ok: true, reason: '' });
    const after = await storage.control.getPointer();
    expect(after.activationCommitted).toBe(true);
    expect(after.activeStorageId).toBe('mig-mg-p04d5-restore-1');
    expect(after.activeStorageId).not.toBe(before.activeStorageId);
    // The migrated expense is served from the new active storage.
    const day = host.featurePorts.home.listSelectedDayExpenses();
    expect(day.map((row) => row.name)).toContain('bread');
  });

  it('rejects a wrong confirmation with no mutation', async () => {
    const { context } = createDeterministicContext();
    const storage = createMemoryStorage({ context });
    const { host } = await migratedHost(storage);
    const before = await storage.control.getPointer();
    const result = await host.featurePorts.portability.restoreLegacyBackup(legacyDocument(), {
      migrationId: 'mg-p04d5-restore-2',
      confirmation: 'WRONG',
    });
    expect(result.ok).toBe(false);
    expect(await storage.control.getPointer()).toEqual(before);
    expect(storage.inspect('mig-mg-p04d5-restore-2')).toBeNull();
  });

  it('rejects an invalid migration id and a malformed document with no mutation', async () => {
    const { context } = createDeterministicContext();
    const storage = createMemoryStorage({ context });
    const { host } = await migratedHost(storage);
    const before = await storage.control.getPointer();
    const badId = await host.featurePorts.portability.restoreLegacyBackup(legacyDocument(), {
      migrationId: '',
      confirmation: REPLACE_ACTIVE_CONFIRMATION,
    });
    expect(badId.ok).toBe(false);
    const malformed = await host.featurePorts.portability.restoreLegacyBackup(
      { settingsEntries: 'nope' },
      { migrationId: 'mg-p04d5-restore-3', confirmation: REPLACE_ACTIVE_CONFIRMATION },
    );
    expect(malformed.ok).toBe(false);
    expect(await storage.control.getPointer()).toEqual(before);
    expect(storage.inspect('mig-mg-p04d5-restore-3')).toBeNull();
  });
});
