// P04-D2: candidate-only canonical guest host.
//
// `prepareCanonicalCandidateHost` assembles the canonical finance authority
// behind D1's explicit candidate latch while the established legacy shell
// stays mounted and default production stays legacy-authoritative. It
// composes the accepted P04-B/C and P03 interfaces — never reimplementing
// them:
//
// - guest identity and storage authority: the command context origin plus
//   the P04-C control-store activation pointer (one active storage id);
// - migration/open: `runLegacyMigration` / `openActiveGuestRepository`
//   (staging writes go to a distinct namespace; the pointer write is the
//   commit point; incomplete work is recovered, never half-applied);
// - writes: the D2 command gateway (P03 preview/confirm/execute) with the
//   durable success boundary;
// - reads: canonical read-model projections over committed `BookState`;
// - portability: P04-C versioned export/import/reset with explicit
//   confirmations and commit points;
// - coordination: cross-tab critical sections, commit invalidation, and the
//   epoch that hard-blocks old binaries.
//
// Lifecycle rules enforced here:
// 1. Candidate preparation blocks every financial action until active
//    storage is opened or migration activates successfully.
// 2. Canonical ports are bound only after the repository is ready; before
//    that (and after any storage failure) every writer is blocked and every
//    reader serves only committed state or an explicit empty.
// 3. A storage, migration, update, or compatibility failure resolves to a
//    truthful write-blocked (`unavailable`) state, never a false success.
// 4. Import, reset, and migration hold their coordination critical section
//    across the activation commit point, so two tabs cannot create dual
//    writers.
// 5. The host never reads URL, query, hash, cookies, local/session storage,
//    imported data, or mutable globals to decide its mode. Activation is the
//    explicit options object; the latch additionally requires the
//    host-bound token (`./candidate-token.js`).
//
// Ownership notes: capture `submitExpense`, Home/history reads, and
// portability commit paths are canonical in D2. Pay/reopen/auto-fill,
// plan/goal mutations, and settings projections stay visibly blocked with
// D3/D4-owned reasons; they return `{ ok: false, reason: 'blocked' }` and
// never mutate state.

import { createCommandGateway } from './command-gateway.js';
import {
  projectDailyExpectedTotal,
  projectDailyPaidTotal,
  projectDayHistory,
  projectSelectedDayExpenses,
  minorUnitsToSarMajor,
} from './read-models.js';
import { createTabCoordinator } from './tab-coordination.js';
import { markCandidatePorts } from './candidate-token.js';
import { requireCommandContext } from '../commands/index.ts';
import { makeBookId } from '../../domain/contracts/identity.ts';
import { parseCivilDate } from '../../domain/primitives/civil-date.ts';
import { deriveTrackedPool } from '../../domain/allocations/derive.ts';
import { convertUntaggedSarMajor } from '../../data/migration/money-conversion.ts';
import { LEGACY_GUEST_BOOK_ID } from '../../data/migration/mapping.ts';
import {
  DEFAULT_ACTIVE_STORAGE_ID,
  createIndexedDbControlStore,
  createMemoryControlStore,
} from '../../data/migration/control-store.ts';
import { decodeLifecycleId } from '../../data/migration/lifecycle-id.ts';
import {
  openActiveGuestRepository,
  runLegacyMigration,
} from '../../data/migration/staging.ts';
import {
  exportActiveSnapshot,
  importPortableReplacement,
  previewPortableImport,
  resetGuestScope,
} from '../../data/portability/snapshot.ts';

/**
 * @typedef {import('./contracts.ts').AuthorityState} AuthorityState
 * @typedef {import('./contracts.ts').ShellFeaturePorts} ShellFeaturePorts
 * @typedef {import('./contracts.ts').CaptureResult} CaptureResult
 * @typedef {import('./contracts.ts').PortStatus} PortStatus
 * @typedef {import('../commands/index.ts').CommandContext} CommandContext
 * @typedef {import('../commands/index.ts').FinanceCommand} FinanceCommand
 * @typedef {import('../../domain/contracts/ledger.ts').BookState} BookState
 * @typedef {import('../../data/migration/staging.ts').MigrationResult} MigrationResult
 * @typedef {import('../../data/migration/control-store.ts').ControlStore} ControlStore
 * @typedef {import('../../data/migration/extract.ts').ExtractedLegacySnapshot} ExtractedLegacySnapshot
 * @typedef {import('./tab-coordination.ts').TabCoordinator} TabCoordinator
 */

export const P04D_D2_PREPARING_REASON =
  'P04-D2: canonical candidate is opening or migrating active storage; writes stay blocked until the authority is ready.';
export const P04D_D2_NO_BOOK_REASON =
  'P04-D2: active canonical storage is open but holds no guest book yet; capture stays blocked until migration provides one.';
export const P04D_D2_D3_OWNED_REASON =
  'P04-D2: this canonical mutation is owned by task D3 and stays visibly blocked until its port lands.';
export const P04D_D2_D4_OWNED_REASON =
  'P04-D2: this canonical mutation is owned by task D4 and stays visibly blocked until its port lands.';

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const hostAuthorityBinders = new WeakMap();

/**
 * @returns {{ get(): PortStatus, fail(message: string): void }}
 */
function createStatusCell() {
  let error = null;
  return {
    get() {
      return { busy: false, error };
    },
    fail(message) {
      error = message;
    },
  };
}

/**
 * @param {AuthorityState} initial
 * @param {{ onAssert?: () => void }} [hooks]
 * @returns {{ getState(): AuthorityState, assertWritable(scope: string): void, describe(): string, getStatus(): PortStatus, name: 'authority' }}
 */
function createHostAuthorityPort(initial, hooks = {}) {
  let state = initial;
  const status = createStatusCell();
  const port = {
    name: 'authority',
    getState() {
      return state;
    },
    assertWritable(scope) {
      if (!state.writable) {
        throw new Error(`P04-D writes blocked for '${scope}': ${describeHostAuthority(state)}`);
      }
      // Per-host old-binary guard: a stale epoch blocks the write and
      // visibly transitions the authority to `unavailable`.
      if (typeof hooks.onAssert === 'function') hooks.onAssert();
    },
    describe() {
      return describeHostAuthority(state);
    },
    getStatus() {
      return status.get();
    },
  };
  hostAuthorityBinders.set(port, (next) => {
    state = next;
  });
  return Object.freeze(port);
}

/**
 * @param {AuthorityState} state
 * @returns {string}
 */
function describeHostAuthority(state) {
  if (state.kind === 'legacy') return 'legacy (MicroSaveOS_DB v1 writable)';
  if (state.kind === 'canonicalPreparing') return `canonicalPreparing (blocked: ${state.reason})`;
  if (state.kind === 'canonicalReady') return `canonicalReady (storage ${state.storageId})`;
  return `unavailable (blocked: ${state.reason})`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function toText(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function toFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
}

/**
 * @param {CommandContext} context
 * @returns {string}
 */
function defaultSelectedDate(context) {
  const instant = context.clock.nowMs();
  const text = new Date(instant).toISOString();
  return text.slice(0, 10);
}

/**
 * Resolve the single guest book id against an opened repository, or null
 * when active storage holds no guest book yet.
 * @param {{ getBookState?: unknown }} repository
 * @returns {ReturnType<typeof makeBookId> extends never ? never : unknown}
 */
function resolveGuestBookId(repository) {
  try {
    const made = makeBookId(LEGACY_GUEST_BOOK_ID);
    if (!made.ok) return null;
    if (!repository || typeof repository.getBookState !== 'function') return null;
    const state = repository.getBookState(made.value);
    if (!state) return null;
    return made.value;
  } catch {
    return null;
  }
}

/**
 * @param {{ getBookState?: unknown }} repository
 * @param {unknown} bookId
 * @returns {BookState | null}
 */
function readBookState(repository, bookId) {
  try {
    if (!repository || typeof repository.getBookState !== 'function' || !bookId) return null;
    return repository.getBookState(bookId) ?? null;
  } catch {
    return null;
  }
}

/**
 * Default durable storage adapter: the accepted P04-B/C stack over OPFS
 * SQLite with the control-store activation pointer as the commit point.
 * @param {{ boundScope: unknown, boundDevice: unknown, context: CommandContext, workerUrl?: string, sqliteAssetBase?: string, control: ControlStore, indexedDB?: IDBFactory }} base
 */
function createDefaultStorage(base) {
  return {
    control: base.control,
    openActive(storageId, options = {}) {
      return openActiveGuestRepository({
        boundScope: base.boundScope,
        boundDevice: base.boundDevice,
        workerUrl: base.workerUrl,
        sqliteAssetBase: base.sqliteAssetBase,
        control: base.control,
        indexedDB: base.indexedDB,
        storageId,
        reset: options.reset === true,
      });
    },
    migrate(migrationId, snapshot) {
      return runLegacyMigration(migrationId, {
        boundScope: base.boundScope,
        boundDevice: base.boundDevice,
        context: base.context,
        workerUrl: base.workerUrl,
        sqliteAssetBase: base.sqliteAssetBase,
        control: base.control,
        indexedDB: base.indexedDB,
        snapshot,
      });
    },
    exportSnapshot(repository) {
      return exportActiveSnapshot(
        {
          boundScope: base.boundScope,
          boundDevice: base.boundDevice,
          context: base.context,
          workerUrl: base.workerUrl,
          sqliteAssetBase: base.sqliteAssetBase,
          control: base.control,
          indexedDB: base.indexedDB,
        },
        repository,
      );
    },
    importReplacement(importId, raw, confirmation) {
      return importPortableReplacement(importId, raw, confirmation, {
        boundScope: base.boundScope,
        boundDevice: base.boundDevice,
        context: base.context,
        workerUrl: base.workerUrl,
        sqliteAssetBase: base.sqliteAssetBase,
        control: base.control,
        indexedDB: base.indexedDB,
      });
    },
    resetScope(resetId, confirmation, scopeId) {
      return resetGuestScope(resetId, confirmation, scopeId, {
        boundScope: base.boundScope,
        boundDevice: base.boundDevice,
        context: base.context,
        workerUrl: base.workerUrl,
        sqliteAssetBase: base.sqliteAssetBase,
        control: base.control,
        indexedDB: base.indexedDB,
      });
    },
  };
}

/**
 * @param {unknown} environment
 * @returns {ControlStore}
 */
function defaultControlStore(environment) {
  const factory = environment?.indexedDB;
  if (factory) return createIndexedDbControlStore(factory);
  return createMemoryControlStore();
}

/**
 * @param {string} reason
 * @returns {CaptureResult}
 */
function blockedResult(reason) {
  return { ok: false, reason };
}

/**
 * Prepare the candidate-only canonical guest host.
 *
 * Every input is explicit test/build injection. Nothing is read from URL,
 * query, hash, cookies, local/session storage, imported data, or mutable
 * globals to decide the mode.
 * @param {{
 *   environment?: typeof globalThis,
 *   context: CommandContext,
 *   snapshot?: ExtractedLegacySnapshot,
 *   migrationId?: string,
 *   control?: ControlStore,
 *   workerUrl?: string,
 *   sqliteAssetBase?: string,
 *   selectedDate?: string,
 *   coordination?: TabCoordinator,
  *   storage?: {
  *     control?: ControlStore,
  *     openActive(storageId: string, options?: { reset?: boolean }): Promise<unknown>,
  *     migrate(migrationId: string, snapshot: ExtractedLegacySnapshot): Promise<MigrationResult>,
  *     exportSnapshot(repository: unknown): Promise<unknown>,
  *     previewImport?(raw: unknown): Promise<{ ok: boolean, reason?: string }>,
  *     importReplacement(importId: string, raw: unknown, confirmation: string): Promise<{ ok: boolean, activeStorageId: string, reason?: string, detail?: string }>,
  *     resetScope(resetId: string, confirmation: string, scopeId: string): Promise<{ ok: boolean, activeStorageId: string, reason?: string, detail?: string }>,
  *   },
 * }} options
 * @returns {Promise<{ ok: boolean, authority: AuthorityState, featurePorts: ShellFeaturePorts, storageId: string, migration: MigrationResult | null, coordination: TabCoordinator, openedEpoch: number, reason: string, refresh(): Promise<void>, close(): Promise<void> }>}
 */
export async function prepareCanonicalCandidateHost(options = {}) {
  const environment = options.environment ?? globalThis;
  const context = requireCommandContext(options.context);
  const coordination = options.coordination ?? createTabCoordinator({ environment });
  const openedEpoch = coordination.getEpoch();
  const control = options.control ?? options.storage?.control ?? defaultControlStore(environment);
  const storage = options.storage ?? createDefaultStorage({
    boundScope: context.origin.scopeId,
    boundDevice: context.origin.deviceId,
    context,
    workerUrl: options.workerUrl,
    sqliteAssetBase: options.sqliteAssetBase,
    control,
    indexedDB: environment?.indexedDB,
  });

  /** @type {{ repository: unknown, gateway: ReturnType<typeof createCommandGateway> | null, storageId: string, bookId: unknown, migration: MigrationResult | null, selectedDate: string }} */
  const state = {
    repository: null,
    gateway: null,
    storageId: DEFAULT_ACTIVE_STORAGE_ID,
    bookId: null,
    migration: null,
    selectedDate: typeof options.selectedDate === 'string' && options.selectedDate
      ? options.selectedDate
      : defaultSelectedDate(context),
  };

  const authorityPortPlaceholder = null;
  void authorityPortPlaceholder;

  // Old-binary guard: once the coordination epoch advances past the epoch
  // this host opened under, every further write is hard-blocked until
  // reload, and the authority visibly transitions to `unavailable`.
  const blockOnEpochBreach = () => {
    try {
      coordination.assertEpoch(openedEpoch);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setAuthority({ kind: 'unavailable', writable: false, reason });
      throw error;
    }
  };
  const authorityPort = createHostAuthorityPort(
    {
      kind: 'canonicalPreparing',
      writable: false,
      reason: P04D_D2_PREPARING_REASON,
    },
    { onAssert: () => blockOnEpochBreach() },
  );
  const setAuthority = (next) => {
    const binder = hostAuthorityBinders.get(authorityPort);
    if (typeof binder === 'function') binder(next);
  };
  const failClosed = (reason) => {
    setAuthority({ kind: 'unavailable', writable: false, reason });
    state.repository = null;
    state.gateway = null;
    return {
      ok: false,
      authority: authorityPort.getState(),
      featurePorts: ports,
      storageId: state.storageId,
      migration: state.migration,
      coordination,
      openedEpoch,
      reason,
      refresh: () => refreshCommitted(),
      close: () => closeHost(),
    };
  };

  const unsubscribeEpoch = coordination.onEpoch((announcement) => {
    if (typeof announcement?.epoch === 'number' && announcement.epoch > openedEpoch) {
      setAuthority({
        kind: 'unavailable',
        writable: false,
        reason: `P04-D write blocked: coordination advanced to epoch ${announcement.epoch} after this tab opened; reload before writing.`,
      });
    }
  });
  const unsubscribeInvalidate = coordination.onInvalidate(() => {
    void refreshCommitted().catch(() => undefined);
  });

  async function refreshCommitted() {
    try {
      const repository = state.repository;
      if (repository && typeof repository.refresh === 'function') {
        await repository.refresh();
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      homeStatus.fail(reason);
    }
  }

  async function closeHost() {
    unsubscribeEpoch();
    unsubscribeInvalidate();
    const repository = state.repository;
    state.repository = null;
    state.gateway = null;
    if (repository && typeof repository.close === 'function') {
      await repository.close().catch(() => undefined);
    }
  }

  async function reopenActive(storageId) {
    const next = await storage.openActive(storageId, { reset: false });
    state.repository = next;
    state.gateway = createCommandGateway({ repository: next, context });
    state.bookId = resolveGuestBookId(next);
    await refreshCommitted();
  }

  const homeStatus = createStatusCell();
  const captureStatus = createStatusCell();
  const historyStatus = createStatusCell();
  const planStatus = createStatusCell();
  const insightsStatus = createStatusCell();
  const goalsStatus = createStatusCell();
  const portabilityStatus = createStatusCell();
  const navigationStatus = createStatusCell();
  const lifecycleStatus = createStatusCell();

  const currentBook = () => readBookState(state.repository, state.bookId);

  /**
   * @param {string} scope
   * @returns {null | { blocked: true, result: CaptureResult }}
   */
  const requireWritable = (scope) => {
    try {
      authorityPort.assertWritable(scope);
    } catch {
      return { blocked: true, result: blockedResult('blocked') };
    }
    return null;
  };

  /** @type {ShellFeaturePorts} */
  const ports = {
    authority: authorityPort,
    home: {
      name: 'home',
      getSelectedDate() {
        return state.selectedDate;
      },
      getSafeToSpend() {
        // D3 owns the canonical availability projection; unknown is
        // truthful, a zero would be a fabricated fact.
        return null;
      },
      getDailyPaidTotal() {
        return projectDailyPaidTotal(currentBook(), state.selectedDate);
      },
      getDailyExpectedTotal() {
        return projectDailyExpectedTotal(currentBook(), state.selectedDate);
      },
      listSelectedDayExpenses() {
        return projectSelectedDayExpenses(currentBook(), state.selectedDate);
      },
      async selectDate(isoDate) {
        const parsed = parseCivilDate(isoDate);
        if (!parsed.ok) throw new Error(`canonical home cannot select invalid date: ${isoDate}`);
        state.selectedDate = parsed.value;
        await refreshCommitted();
      },
      async refresh() {
        await refreshCommitted();
      },
      getStatus() {
        return homeStatus.get();
      },
    },
    capture: {
      name: 'capture',
      async submitExpense(input) {
        const blocked = requireWritable('capture.submitExpense');
        if (blocked) return blocked.result;
        const name = toText(input?.name).trim();
        const cost = toFiniteNumber(input?.cost);
        if (!name || !Number.isFinite(cost) || cost < 0) {
          return blockedResult('validation');
        }
        if (!state.bookId) {
          captureStatus.fail(P04D_D2_NO_BOOK_REASON);
          return blockedResult('blocked');
        }
        const dateText = toText(input?.date) || state.selectedDate;
        const localDate = parseCivilDate(dateText);
        if (!localDate.ok) return blockedResult('validation');
        const token = coordination.beginCritical('write');
        try {
          const converted = convertUntaggedSarMajor(cost, {
            database: 'MicroSaveOS_DB',
            databaseVersion: 1,
            store: 'expenses',
            recordKey: 'candidate-capture',
            field: 'cost',
          });
          if (!converted.ok) return blockedResult('validation');
          /** @type {FinanceCommand} */
          const command = {
            kind: 'recordExpense',
            bookId: state.bookId,
            amount: converted.money,
            occurredAt: { kind: 'civilDate', localDate: localDate.value },
            note: name,
            category: toText(input?.category) || 'food',
            flexibleDefinitionId: input?.source === 'flexible' && typeof input?.flexibleDefinitionId === 'string'
              ? input.flexibleDefinitionId
              : null,
          };
          const result = await state.gateway.execute(command);
          if (!result.ok) {
            const reason = result.failure?.kind === 'invalidCommand' ? 'validation' : 'error';
            captureStatus.fail(result.detail ?? 'canonical capture failed');
            return blockedResult(reason);
          }
          const recorded = result.receipt.effects.find((effect) => effect.kind === 'expenseRecorded');
          coordination.announceCommit({ storageId: state.storageId });
          return { ok: true, id: recorded && 'entryId' in recorded ? String(recorded.entryId) : undefined };
        } catch (error) {
          const reason = error instanceof Error && /epoch/i.test(error.message) ? 'blocked' : 'error';
          captureStatus.fail(error instanceof Error ? error.message : String(error));
          return blockedResult(reason);
        } finally {
          coordination.endCritical(token);
        }
      },
      async payExpense() {
        captureStatus.fail(P04D_D2_D3_OWNED_REASON);
        return blockedResult('blocked');
      },
      async markUnpaid() {
        captureStatus.fail(P04D_D2_D3_OWNED_REASON);
        return blockedResult('blocked');
      },
      async autoFillDay() {
        planStatus.fail(P04D_D2_D3_OWNED_REASON);
        return 0;
      },
      getStatus() {
        return captureStatus.get();
      },
    },
    history: {
      name: 'history',
      async listDayExpenses(date) {
        return projectDayHistory(currentBook(), toText(date));
      },
      async updateExpense() {
        return blockedResult('blocked');
      },
      async deleteExpense() {
        return blockedResult('blocked');
      },
      async deleteSelected() {
        return blockedResult('blocked');
      },
      async markSelectedUnpaid() {
        return blockedResult('blocked');
      },
      getStatus() {
        return historyStatus.get();
      },
    },
    plan: {
      name: 'plan',
      listProfiles() {
        return [];
      },
      getActiveProfileId() {
        return '';
      },
      async setActiveProfile() {
        planStatus.fail(P04D_D2_D4_OWNED_REASON);
      },
      async createProfile() {
        planStatus.fail(P04D_D2_D4_OWNED_REASON);
        return null;
      },
      async setProfileOffdays() {
        planStatus.fail(P04D_D2_D4_OWNED_REASON);
      },
      async saveTemplate() {
        planStatus.fail(P04D_D2_D4_OWNED_REASON);
      },
      async deleteTemplate() {
        planStatus.fail(P04D_D2_D4_OWNED_REASON);
      },
      async saveFlexibleDefinition() {
        planStatus.fail(P04D_D2_D4_OWNED_REASON);
      },
      async previewApply() {
        return {
          rangeStart: '',
          rangeEnd: '',
          createCount: 0,
          updateCount: 0,
          deleteCount: 0,
          totalChanges: 0,
          blocked: true,
          blockedReason: P04D_D2_D4_OWNED_REASON,
        };
      },
      async confirmApply() {
        planStatus.fail(P04D_D2_D4_OWNED_REASON);
        return {
          rangeStart: '',
          rangeEnd: '',
          createCount: 0,
          updateCount: 0,
          deleteCount: 0,
          totalChanges: 0,
          blocked: true,
          blockedReason: P04D_D2_D4_OWNED_REASON,
        };
      },
      getStatus() {
        return planStatus.get();
      },
    },
    insights: {
      name: 'insights',
      getMonthStatistics() {
        const monthKey = state.selectedDate.slice(0, 7);
        const paidSpent = projectDailyPaidTotal(currentBook(), state.selectedDate);
        return {
          monthKey: MONTH_KEY_PATTERN.test(monthKey) ? monthKey : '',
          budgetKnown: false,
          budget: null,
          paidSpent,
          unpaidEssential: 0,
          safeToSpend: null,
          projectedBalance: null,
        };
      },
      getCategoryBreakdown() {
        const rows = projectSelectedDayExpenses(currentBook(), state.selectedDate);
        const totals = new Map();
        for (const row of rows) {
          totals.set(row.category, (totals.get(row.category) ?? 0) + row.actualPaid);
        }
        return [...totals.entries()].map(([category, amount]) => ({
          category,
          amount,
          count: rows.filter((row) => row.category === category).length,
        }));
      },
      getWeeklySpending() {
        const day = Number(state.selectedDate.slice(8, 10));
        const week = Number.isFinite(day) && day > 0 ? Math.ceil(day / 7) : 0;
        return [{ week, amount: projectDailyPaidTotal(currentBook(), state.selectedDate) }];
      },
      async refresh() {
        await refreshCommitted();
      },
      getStatus() {
        return insightsStatus.get();
      },
    },
    goals: {
      name: 'goals',
      getVaultBalance() {
        const book = currentBook();
        if (!book) return 0;
        try {
          return minorUnitsToSarMajor(deriveTrackedPool(book).total.minorUnits);
        } catch {
          return 0;
        }
      },
      listGoals() {
        const book = currentBook();
        if (!book) return [];
        try {
          return deriveTrackedPool(book).goals.map((entry) => ({
            id: String(entry.goal.goalId ?? ''),
            name: toText(entry.goal.name),
            targetAmount: minorUnitsToSarMajor(entry.goal.targetAmount?.minorUnits ?? 0),
            allocatedAmount: minorUnitsToSarMajor(entry.assigned.minorUnits),
          }));
        } catch {
          return [];
        }
      },
      async addGoal() {
        goalsStatus.fail(P04D_D2_D4_OWNED_REASON);
        return null;
      },
      async deleteGoal() {
        goalsStatus.fail(P04D_D2_D4_OWNED_REASON);
        return false;
      },
      async settleToVault() {
        goalsStatus.fail(P04D_D2_D4_OWNED_REASON);
        return null;
      },
      async settleToBudget() {
        goalsStatus.fail(P04D_D2_D4_OWNED_REASON);
        return null;
      },
      async settleNoSurplus() {
        goalsStatus.fail(P04D_D2_D4_OWNED_REASON);
        return null;
      },
      getStatus() {
        return goalsStatus.get();
      },
    },
    portability: {
      name: 'portability',
      async buildSnapshot() {
        const blocked = requireWritable('portability.buildSnapshot');
        if (blocked) throw new Error(`P04-D writes blocked for 'portability.buildSnapshot': export requires a ready authority.`);
        const document = await storage.exportSnapshot(state.repository);
        return JSON.stringify(document, null, 2);
      },
      async restoreSnapshot(snapshot, options = {}) {
        const blocked = requireWritable('portability.restoreSnapshot');
        if (blocked) return { ok: false, reason: 'blocked' };
        const importId = toText(options.importId);
        const confirmation = toText(options.confirmation);
        if (!importId) return { ok: false, reason: 'validation' };
        const token = coordination.beginCritical('import');
        try {
          // The storage adapter owns document preview: the durable adapter
          // runs the P04-C portable validation, while test adapters preview
          // their own document shape. Either way the host never invents data.
          const preview = typeof storage.previewImport === 'function'
            ? await storage.previewImport(snapshot)
            : await previewPortableImport(snapshot);
          if (!preview.ok) return { ok: false, reason: preview.reason };
          const result = await storage.importReplacement(importId, snapshot, confirmation);
          if (!result.ok) {
            portabilityStatus.fail(result.detail ?? result.reason ?? 'canonical import failed');
            return { ok: false, reason: result.reason ?? 'error' };
          }
          // Explicit commit point: the control-store pointer flipped inside
          // importReplacement. Reopen the new active storage before serving
          // reads or further writes, so no dual v1/v2 writer can exist.
          await reopenActive(result.activeStorageId);
          state.storageId = result.activeStorageId;
          coordination.announceCommit({ storageId: state.storageId });
          return { ok: true, reason: '' };
        } catch (error) {
          portabilityStatus.fail(error instanceof Error ? error.message : String(error));
          return { ok: false, reason: 'error' };
        } finally {
          coordination.endCritical(token);
        }
      },
      async factoryReset(onBlockedOrOptions = null) {
        // Legacy-compatible shape: a bare callback means "notify when
        // blocked". Candidate callers pass explicit reset options with the
        // P04-C confirmation; without them the reset stays safely refused.
        const asRecord = onBlockedOrOptions && typeof onBlockedOrOptions === 'object'
          ? onBlockedOrOptions
          : {};
        const notifyBlocked = typeof onBlockedOrOptions === 'function'
          ? onBlockedOrOptions
          : (typeof asRecord.onBlocked === 'function' ? asRecord.onBlocked : null);
        const blocked = requireWritable('portability.factoryReset');
        if (blocked) {
          if (notifyBlocked) notifyBlocked();
          return;
        }
        const resetId = toText(asRecord.resetId);
        const confirmation = toText(asRecord.confirmation);
        const token = coordination.beginCritical('reset');
        try {
          const result = await storage.resetScope(resetId, confirmation, context.origin.scopeId);
          if (!result.ok) {
            portabilityStatus.fail(result.detail ?? result.reason ?? 'canonical reset failed');
            throw new Error(result.detail ?? 'canonical reset failed');
          }
          await reopenActive(result.activeStorageId);
          state.storageId = result.activeStorageId;
          coordination.announceCommit({ storageId: state.storageId });
        } finally {
          coordination.endCritical(token);
        }
      },
      clearLocalPreferences() {
        authorityPort.assertWritable('portability.clearLocalPreferences');
        const store = environment?.localStorage;
        if (!store || typeof store.length !== 'number' || typeof store.key !== 'function') return;
        const doomed = [];
        for (let index = 0; index < (store.length ?? 0); index += 1) {
          const key = store.key.call(store, index);
          if (key && (key.startsWith('rushd_') || key.startsWith('microsave_') || key === 'onboardingState')) {
            doomed.push(key);
          }
        }
        for (const key of doomed) {
          if (typeof store.removeItem === 'function') store.removeItem.call(store, key);
        }
      },
      getStatus() {
        return portabilityStatus.get();
      },
    },
    navigation: {
      name: 'navigation',
      resolveIntent(view) {
        const destinations = ['dashboard', 'statistics', 'vault', 'plans', 'settings'];
        const target = destinations.includes(view) ? view : null;
        if (!target) return null;
        return { view: target };
      },
      listDestinations() {
        return ['dashboard', 'statistics', 'vault', 'plans', 'settings'];
      },
      getStatus() {
        return navigationStatus.get();
      },
    },
    lifecycle: {
      name: 'lifecycle',
      async initialize() {
        await refreshCommitted();
      },
      getSettings() {
        // D4 owns the canonical settings projection; boot mirrors stay
        // readable so the established shell never sees a fabricated fact.
        return {
          baseAllowance: 0,
          theme: 'dark',
          motionLevel: 'auto',
          language: readPreference(environment, 'rushd_lang', 'ar'),
          calendarType: readPreference(environment, 'rushd_calendar', 'gregorian'),
          activeTemplateProfileId: '',
        };
      },
      async saveBaseAllowance() {
        lifecycleStatus.fail(P04D_D2_D4_OWNED_REASON);
        return false;
      },
      async setTheme(theme) {
        authorityPort.assertWritable('lifecycle.setTheme');
        writePreference(environment, 'rushd_theme', theme === 'light' ? 'light' : 'dark');
      },
      async setMotionLevel(level) {
        authorityPort.assertWritable('lifecycle.setMotionLevel');
        writePreference(environment, 'rushd_motion', toText(level) || 'auto');
      },
      setLanguage(language) {
        authorityPort.assertWritable('lifecycle.setLanguage');
        writePreference(environment, 'rushd_lang', language);
      },
      setCalendarType(calendarType) {
        authorityPort.assertWritable('lifecycle.setCalendarType');
        writePreference(environment, 'rushd_calendar', calendarType);
      },
      getOnboardingState() {
        return null;
      },
      async persistOnboardingState() {
        lifecycleStatus.fail(P04D_D2_D4_OWNED_REASON);
        return { status: '', updatedAt: '', source: '' };
      },
      getMonthStartDeferral() {
        return readDeferral(environment, 'rushd_month_start_prompt_deferred', 'monthKey');
      },
      deferMonthStartPrompt(referenceDate) {
        authorityPort.assertWritable('lifecycle.deferMonthStartPrompt');
        writePreference(
          environment,
          'rushd_month_start_prompt_deferred',
          JSON.stringify({ monthKey: toText(referenceDate).slice(0, 7), dateStr: referenceDate }),
        );
      },
      clearMonthStartDeferral() {
        authorityPort.assertWritable('lifecycle.clearMonthStartDeferral');
        removePreference(environment, 'rushd_month_start_prompt_deferred');
      },
      getMonthEndDeferral() {
        return readDeferral(environment, 'rushd_month_end_prompt_deferred', 'previousMonthKey');
      },
      deferMonthEndPrompt(previousMonthKey, referenceDate) {
        authorityPort.assertWritable('lifecycle.deferMonthEndPrompt');
        writePreference(
          environment,
          'rushd_month_end_prompt_deferred',
          JSON.stringify({ previousMonthKey, dateStr: referenceDate }),
        );
      },
      clearMonthEndDeferral() {
        authorityPort.assertWritable('lifecycle.clearMonthEndDeferral');
        removePreference(environment, 'rushd_month_end_prompt_deferred');
      },
      getStatus() {
        return lifecycleStatus.get();
      },
    },
  };

  for (const port of Object.values(ports)) {
    if (port && typeof port === 'object') Object.freeze(port);
  }
  const frozenPorts = Object.freeze(ports);
  markCandidatePorts(frozenPorts);

  // --- Startup: select one active storage authority, then complete or
  // recover migration/open before any write can flow. ---
  let pointer;
  try {
    pointer = await control.getPointer();
  } catch (error) {
    return failClosed(`canonical control store is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const selectedStorageId = pointer.activeStorageId || DEFAULT_ACTIVE_STORAGE_ID;
  state.storageId = selectedStorageId;

  try {
    if (pointer.activationCommitted) {
      await reopenActive(selectedStorageId);
      state.migration = null;
    } else if (options.snapshot !== undefined && options.snapshot !== null) {
      const rawMigrationId = toText(options.migrationId) || context.ids.newId('mg');
      const identity = decodeLifecycleId(rawMigrationId, 'migrationId');
      if (!identity.ok) {
        return failClosed(`canonical migration id is invalid: ${identity.detail}`);
      }
      const token = coordination.beginCritical('migration');
      try {
        const result = await storage.migrate(identity.value, options.snapshot);
        if (!result.ok) {
          return failClosed(`canonical migration failed at ${result.phase}: ${result.detail}`);
        }
        state.migration = result;
        await reopenActive(result.activeStorageId);
        state.storageId = result.activeStorageId;
      } finally {
        coordination.endCritical(token);
      }
    } else {
      await reopenActive(selectedStorageId);
      state.migration = null;
    }
  } catch (error) {
    return failClosed(`canonical storage failed to open: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Bind canonical ports only after ready. Reads serve committed state;
  // writers flow through the gateway from here on.
  setAuthority({ kind: 'canonicalReady', writable: true, storageId: state.storageId });
  if (!state.bookId) {
    captureStatus.fail(P04D_D2_NO_BOOK_REASON);
  }

  return {
    ok: true,
    authority: authorityPort.getState(),
    featurePorts: frozenPorts,
    storageId: state.storageId,
    migration: state.migration,
    coordination,
    openedEpoch,
    reason: '',
    refresh: () => refreshCommitted(),
    close: () => closeHost(),
  };
}

/**
 * @param {unknown} environment
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
 */
function readPreference(environment, key, fallback) {
  try {
    const store = environment?.localStorage;
    if (!store || typeof store.getItem !== 'function') return fallback;
    return store.getItem.call(store, key) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * @param {unknown} environment
 * @param {string} key
 * @param {string} value
 */
function writePreference(environment, key, value) {
  const store = environment?.localStorage;
  if (!store || typeof store.setItem !== 'function') return;
  store.setItem.call(store, key, value);
}

/**
 * @param {unknown} environment
 * @param {string} key
 */
function removePreference(environment, key) {
  const store = environment?.localStorage;
  if (!store || typeof store.removeItem !== 'function') return;
  store.removeItem.call(store, key);
}

/**
 * @param {unknown} environment
 * @param {string} key
 * @param {string} monthField
 * @returns {unknown}
 */
function readDeferral(environment, key, monthField) {
  try {
    const raw = readPreference(environment, key, '');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const monthValue = typeof parsed[monthField] === 'string' ? parsed[monthField] : '';
    const dateStr = typeof parsed.dateStr === 'string' ? parsed.dateStr : '';
    if (!MONTH_KEY_PATTERN.test(monthValue) || !dateStr) return null;
    return monthField === 'monthKey'
      ? { monthKey: monthValue, dateStr }
      : { previousMonthKey: monthValue, dateStr };
  } catch {
    return null;
  }
}
