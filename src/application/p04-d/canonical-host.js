// P04-D2/D4: candidate-only canonical guest host.
//
// `prepareCanonicalCandidateHost` assembles the canonical finance authority
// behind D1's explicit candidate latch while the established legacy shell
// stays mounted. Since the D4 cutover, ordinary production mounts this
// host through `production-boot.js`. It
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
/* global setInterval:readonly, clearInterval:readonly */

import { createCommandGateway, mintOperationId } from './command-gateway.js';
import {
  isMonthKeyText,
  projectAvailabilityAmount,
  projectBookSettings,
  projectCommitmentsTotal,
  projectDailyExpectedTotal,
  projectDailyPaidTotal,
  projectDayHistory,
  projectLatestSettlement,
  projectMonthCategoryBreakdown,
  projectMonthPaidTotal,
  projectMonthWeeklySpending,
  projectOpenCycleId,
  projectOpenCycleMonthKey,
  projectPlanSummaries,
  projectSelectedDayExpenses,
  projectTrackedPoolTotal,
  minorUnitsToSarMajor,
} from './read-models.js';
import { COORDINATION_HEARTBEAT_MS, createTabCoordinator } from './tab-coordination.js';
import { markCandidatePorts } from './candidate-token.js';
import { requireCommandContext } from '../commands/index.ts';
import { composeCycleId, makeBookId, makeGoalId, makeOperationId, makePlanId } from '../../domain/contracts/identity.ts';
import { effectiveVersionStatus } from '../../domain/contracts/ledger.ts';
import { canonicalJson, stableDigest } from '../../domain/contracts/canonical.ts';
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
  REPLACE_ACTIVE_CONFIRMATION,
  resetGuestScope,
} from '../../data/portability/snapshot.ts';
import { snapshotFromStores } from '../../data/migration/extract.ts';

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
export const P04D_D3_PAY_BLOCKED_REASON =
  'P04-D3: pay/reopen/auto-fill has no exact canonical equivalent for a paid actual (correction or reversal only); the action stays visibly blocked and never falls through to v1.';
export const P04D_D3_BULK_UNPAID_BLOCKED_REASON =
  'P04-D3: bulk mark-unpaid has no exact canonical equivalent and stays visibly blocked; correct or reverse individual expenses instead.';
export const P04D_D4_PROFILE_BLOCKED_REASON =
  'P04-D4: template profiles and offdays are a v1-only grouping with no canonical counterpart; plans carry their own schedule and revisions instead.';
export const P04D_D4_TEMPLATE_DELETE_BLOCKED_REASON =
  'P04-D4: recurring plans are append-only and have no delete command; detach or revise an occurrence instead of deleting the rule.';
export const P04D_D4_GOAL_DELETE_BLOCKED_REASON =
  'P04-D4: goals are append-only and have no delete command; unassign and release the allocation instead of deleting the goal.';
export const P04D_D4_ALLOWANCE_BLOCKED_REASON =
  'P04-D4: the monthly allowance migrated into the opening cycle starting funds and no command rewrites it; the figure below is read-only.';
export const P04D_D5_NO_BOOK_PROVISION_REASON =
  'P04-D5: active canonical storage holds no guest book yet; provisioning a fresh empty book before serving writes.';
export const P04D_D5_STORAGE_MOVED_REASON =
  'P04-D5: the active canonical storage moved in another tab; reload to rejoin before writing.';

// Local-preference keys shared with the legacy shell. These hold UI chrome
// only (theme/motion/language/calendar mirrors, onboarding flow status,
// navigation intent, prompt deferrals) and never finance truth.
export const P04D_ONBOARDING_STATE_KEY = 'onboardingState';
export const P04D_NAV_INTENT_KEY = 'rushd_nav_intent';

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
 * Resolve the operation identity for one user intent. A caller-supplied
 * retry ID is validated and reused so a retry after a lost acknowledgement
 * replays idempotently; otherwise a fresh ID is minted. A new intent (or
 * a reload) must never reuse a persisted ID.
 * @param {unknown} raw
 * @param {CommandContext} context
 * @returns {{ ok: true, value: import('../commands/index.ts').OperationId } | { ok: false }}
 */
function resolveCallerOperationId(raw, context) {
  try {
    if (raw === undefined || raw === null || raw === '') {
      return { ok: true, value: mintOperationId(context) };
    }
    const made = makeOperationId(raw);
    if (!made.ok) return { ok: false };
    return { ok: true, value: made.value };
  } catch {
    return { ok: false };
  }
}

/**
 * Map a gateway failure to the machine-readable port reason. Command
 * rejections (including unknown entries) are caller validation failures;
 * conflicts, storage crashes, and lost acknowledgements stay retryable
 * errors. Both keep the UI truthful: no success is ever reported.
 * @param {{ kind: string } | null | undefined} failure
 * @returns {string}
 */
function gatewayFailureReason(failure) {
  if (!failure) return 'error';
  if (
    failure.kind === 'invalidCommand'
    || failure.kind === 'invalidConfirmation'
    || failure.kind === 'previewMismatch'
    || failure.kind === 'unknownEntry'
  ) {
    return 'validation';
  }
  return 'error';
}

/**
 * Find an already-committed intent BEFORE preview/execute. The gateway
 * previews against live state first, so a retry of an already-applied
 * state-dependent command (a correction whose target is now reversed)
 * would fail its preview even though the journal holds the committed
 * receipt. This applies exactly the journal rule `execute` uses (same
 * canonical command → replay; different content → conflict), so a retry
 * after a lost acknowledgement replays instead of duplicating, and an ID
 * is never honored for two payloads. Adapters without journal reads
 * return `missing` and fall through to the gateway, which still guards.
 * @param {unknown} repository
 * @param {import('../commands/index.ts').OperationId} operationId
 * @param {FinanceCommand} command
 * @returns {{ status: 'missing' } | { status: 'replayed', receipt: import('../commands/index.ts').CommandReceipt } | { status: 'conflict' }}
 */
function findCommittedIntent(repository, operationId, command) {
  try {
    if (!repository || typeof repository.getOperation !== 'function') return { status: 'missing' };
    const existing = repository.getOperation(operationId);
    if (!existing) return { status: 'missing' };
    let canonical = null;
    try {
      canonical = canonicalJson(command);
    } catch {
      return { status: 'missing' };
    }
    if (existing.canonicalCommand === canonical) {
      return { status: 'replayed', receipt: existing.receipt };
    }
    return { status: 'conflict' };
  } catch {
    return { status: 'missing' };
  }
}

/**
 * Pull the replacement/live entry id out of a correction receipt.
 * @param {import('../commands/index.ts').CommandReceipt | null | undefined} receipt
 * @param {string} fallbackEntryId
 * @returns {string}
 */
function correctionResultId(receipt, fallbackEntryId) {
  const recorded = receipt?.effects?.find((effect) => effect.kind === 'expenseRecorded');
  return recorded && 'entryId' in recorded ? String(recorded.entryId) : String(fallbackEntryId);
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
 * @returns {Promise<{ ok: boolean, authority: AuthorityState, featurePorts: ShellFeaturePorts, storageId: string, migration: MigrationResult | null, coordination: TabCoordinator, openedEpoch: number, reason: string, refresh(): Promise<void>, close(): Promise<void>, onCommitted(handler: (info: { storageId: string }) => void): () => void }>}
 */
export async function prepareCanonicalCandidateHost(options = {}) {
  const environment = options.environment ?? globalThis;
  const context = requireCommandContext(options.context);
  const coordination = options.coordination ?? createTabCoordinator({ environment });
  // D5 correction: the performing tab rebases this value after its own
  // import/reset activation bump, so its fresh repository stays writable
  // while every other tab hard-blocks until reload. Never reassigned
  // except by that same-tab activation path.
  let openedEpoch = coordination.getEpoch();
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
      // Live binding: import/reset flip the activation pointer after this
      // object is returned, and observers must see the current namespace.
      get storageId() {
        return state.storageId;
      },
      migration: state.migration,
      coordination,
      // Live binding: the same-tab import/reset path rebases the epoch it
      // opened under after its own activation bump.
      get openedEpoch() {
        return openedEpoch;
      },
      reason,
      refresh: () => refreshCommitted(),
      close: () => closeHost(),
      // A failed host holds no namespace to converge: subscriptions are
      // accepted and immediately removable but never fire.
      onCommitted: () => () => undefined,
    };
  };

  // D5 round-3: same-namespace commit subscribers. The mounted legacy UI
  // re-mirrors the visible day from the refreshed read model here, so its
  // cards track the canonical count without another reload. The set lives
  // on the host (not the ports): filtering stays with the namespace owner,
  // and the port surface asserted by the latch is untouched.
  const committedHandlers = new Set();
  const notifyCommitted = () => {
    const info = { storageId: state.storageId };
    for (const handler of [...committedHandlers]) {
      try {
        handler(info);
      } catch {
        /* a subscriber failure must not break coordination or hydration */
      }
    }
  };
  const onCommitted = (handler) => {
    if (typeof handler !== 'function') return () => undefined;
    committedHandlers.add(handler);
    return () => {
      committedHandlers.delete(handler);
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
  // D5 correction: an invalidate that names a storage namespace this host
  // does not hold means another tab flipped the activation pointer
  // (import/reset) and this tab missed the epoch broadcast. Refreshing the
  // orphaned repository would serve a fork, so the host goes visibly
  // unavailable instead: no write can reach the stale namespace, and a
  // reload rejoins the current one. Same-namespace commits still refresh.
  // D5 round-3: after that refresh settles, same-namespace subscribers are
  // notified so the mounted legacy UI re-mirrors the visible day from the
  // same read model the count uses (cards track count without a reload).
  // Foreign flips never notify: re-mirroring an orphan would resurrect the
  // fork in the UI that the unavailable transition just retired. Read-only
  // throughout: writability and epoch guards are untouched.
  const unsubscribeInvalidate = coordination.onInvalidate((announcement) => {
    try {
      const announced = announcement?.storageId;
      if (typeof announced === 'string' && announced && announced !== state.storageId) {
        setAuthority({ kind: 'unavailable', writable: false, reason: P04D_D5_STORAGE_MOVED_REASON });
        return;
      }
    } catch {
      /* fall through to the refresh below */
    }
    void refreshCommitted().then(notifyCommitted, notifyCommitted).catch(() => undefined);
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
    committedHandlers.clear();
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

  /**
   * D5 round-2 correction: verify this host still holds the active
   * namespace before any canonical write. The epoch re-read on every
   * `assertWritable` already blocks tabs that observed a flip; this
   * covers tabs that missed the broadcast entirely (frozen background
   * tabs): a pointer that moved on without this host means its
   * repository is orphaned, so the host goes visibly unavailable instead
   * of forking it. A control-store read failure also fails closed —
   * never a blind write. Reads are local (IndexedDB/memory) and offline.
   * @param {string} scope Caller label for status reporting.
   * @param {{ fail(message: string): void } | null} statusCell
   * @returns {Promise<boolean>} True when the held namespace is current.
   */
  async function requireCurrentNamespace(scope, statusCell) {
    let active = '';
    try {
      const pointer = await control.getPointer();
      active = pointer?.activeStorageId ?? '';
    } catch (error) {
      const reason = `P04-D writes blocked for '${scope}': the activation pointer is unreadable (${error instanceof Error ? error.message : String(error)}).`;
      setAuthority({ kind: 'unavailable', writable: false, reason });
      try {
        statusCell?.fail?.(reason);
      } catch {
        /* status reporting is best-effort */
      }
      return false;
    }
    if (typeof active === 'string' && active && active !== state.storageId) {
      setAuthority({ kind: 'unavailable', writable: false, reason: P04D_D5_STORAGE_MOVED_REASON });
      try {
        statusCell?.fail?.(P04D_D5_STORAGE_MOVED_REASON);
      } catch {
        /* status reporting is best-effort */
      }
      return false;
    }
    return true;
  }

  /**
   * D5 correction: guarantee a usable canonical book before serving writes.
   * Reset (and an empty-but-valid import) activates a namespace with no
   * guest book, which used to leave capture truthfully-but-hopelessly
   * blocked while onboarding still claimed completion. Provisioning runs
   * the same facts a fresh install would hold — one `createBook` plus one
   * zero-funds `openCycle` for the selected month — through the P03 gateway
   * so it is atomic per command, idempotent across
   * retries (deterministic operation identities replay from the journal),
   * and offline-capable (no network, no invented allowance). A book that
   * already exists (or already has an open cycle) is left untouched.
   *
   * D5 round-2: callers inside an outer import/reset critical section pass
   * `lease: false` so provisioning reuses that lease instead of nesting a
   * `write` section over it (one lock per tab: nesting would drop the
   * outer lease and reopen update activation mid-adoption). Standalone
   * callers (boot) hold their own `write` lease.
   * @param {string} scope Caller label for status reporting.
   * @param {{ lease?: boolean }} [options]
   * @returns {Promise<boolean>} True when a usable book is present.
   */
  async function provisionFreshBookIfMissing(scope, options = {}) {
    if (state.bookId) {
      const open = projectOpenCycleId(currentBook());
      if (open) return true;
    }
    if (!state.gateway || !state.repository) {
      lifecycleStatus.fail(P04D_D2_NO_BOOK_REASON);
      return false;
    }
    try {
      authorityPort.assertWritable(`${scope}.provision`);
    } catch (error) {
      lifecycleStatus.fail(error instanceof Error ? error.message : String(error));
      return false;
    }
    if (!(await requireCurrentNamespace(`${scope}.provision`, lifecycleStatus))) {
      return false;
    }
    const made = makeBookId(LEGACY_GUEST_BOOK_ID);
    if (!made.ok) {
      lifecycleStatus.fail('canonical recovery refused: invalid guest book identity.');
      return false;
    }
    const monthText = typeof state.selectedDate === 'string' ? state.selectedDate.slice(0, 7) : '';
    const monthStart = parseCivilDate(/^\d{4}-(0[1-9]|1[0-2])$/.test(monthText) ? `${monthText}-01` : state.selectedDate);
    if (!monthStart.ok) {
      lifecycleStatus.fail('canonical recovery refused: invalid selected month.');
      return false;
    }
    let fingerprint = '';
    try {
      fingerprint = String(stableDigest(`p04-d5-fresh-book:${state.storageId}`)).slice(0, 16);
    } catch {
      fingerprint = '';
    }
    if (!fingerprint) {
      lifecycleStatus.fail('canonical recovery refused: recovery identity is unavailable.');
      return false;
    }
    const bookOperation = makeOperationId(`pf-book-${fingerprint}`);
    const cycleOperation = makeOperationId(`pf-cycle-${fingerprint}`);
    if (!bookOperation.ok || !cycleOperation.ok) {
      lifecycleStatus.fail('canonical recovery refused: invalid recovery identity.');
      return false;
    }
    /** @type {FinanceCommand} */
    const createBook = {
      kind: 'createBook',
      bookId: made.value,
      displayName: 'Rushd guest book',
      currency: 'SAR',
      timeZone: 'Asia/Riyadh',
      cycleAnchor: { kind: 'firstOfMonth' },
    };
    /** @type {FinanceCommand} */
    const openCycle = {
      kind: 'openCycle',
      bookId: made.value,
      startingFunds: { currency: 'SAR', minorUnits: 0 },
      startDate: monthStart.value,
    };
    const provisionTask = async () => {
      try {
        if (!state.bookId) {
          const committed = findCommittedIntent(state.repository, bookOperation.value, createBook);
          if (committed.status === 'conflict') {
            lifecycleStatus.fail(`recovery operation ${String(bookOperation.value)} is already committed with different content.`);
            return false;
          }
          if (committed.status !== 'replayed') {
            const result = await state.gateway.execute(createBook, { operationId: bookOperation.value });
            if (!result.ok) {
              lifecycleStatus.fail(result.detail ?? 'canonical recovery could not create the guest book');
              return false;
            }
          }
          state.bookId = resolveGuestBookId(state.repository);
          await refreshCommitted();
        }
        if (!state.bookId) {
          lifecycleStatus.fail('canonical recovery could not read the guest book after creating it.');
          return false;
        }
        if (!projectOpenCycleId(currentBook())) {
          const committed = findCommittedIntent(state.repository, cycleOperation.value, openCycle);
          if (committed.status === 'conflict') {
            lifecycleStatus.fail(`recovery operation ${String(cycleOperation.value)} is already committed with different content.`);
            return false;
          }
          if (committed.status !== 'replayed') {
            const result = await state.gateway.execute(openCycle, { operationId: cycleOperation.value });
            if (!result.ok) {
              lifecycleStatus.fail(result.detail ?? 'canonical recovery could not open the current cycle');
              return false;
            }
          }
          await refreshCommitted();
        }
        return !!state.bookId;
      } catch (error) {
        lifecycleStatus.fail(error instanceof Error ? error.message : String(error));
        return false;
      }
    };
    if (options.lease === false) return provisionTask();
    return withHeldCritical('write', provisionTask);
  }

  /**
   * D5 round-2 correction: adopt an import/reset activation flip with no
   * orphan-write window. The pointer already flipped inside the storage
   * adapter; the epoch bump is persisted and broadcast and this tab
   * rebases BEFORE any reopen/provision command runs, so a second tab can
   * no longer pass `assertEpoch` during adoption — even one that misses
   * the broadcast, because every write attempt re-reads the persisted
   * epoch (and the namespace check refuses orphaned repositories
   * outright). The new namespace is announced promptly, then this tab
   * reopens it and guarantees a usable book under the outer import/reset
   * lease (no nested section: one lock per tab). A closing announcement
   * confirms the adopted namespace.
   * @param {'import' | 'reset'} kind
   * @param {string} newStorageId
   */
  async function adoptActivationFlip(kind, newStorageId) {
    try {
      openedEpoch = coordination.bumpEpoch(`p04-d:${kind}-activated`);
    } catch {
      /* the namespace checks still block stale writers below */
    }
    coordination.announceCommit({ storageId: newStorageId });
    try {
      await reopenActive(newStorageId);
      state.storageId = newStorageId;
      await provisionFreshBookIfMissing(kind, { lease: false });
    } catch (error) {
      // The flip already retired other tabs; this tab must not keep
      // writing to the orphaned repository it still holds. Fail closed:
      // a reload rejoins the current namespace.
      const reason = `P04-D ${kind} adoption failed after activation: ${error instanceof Error ? error.message : String(error)}; reload to rejoin.`;
      setAuthority({ kind: 'unavailable', writable: false, reason });
      state.repository = null;
      state.gateway = null;
      state.bookId = null;
      coordination.announceCommit({ storageId: newStorageId });
      throw error;
    }
    coordination.announceCommit({ storageId: state.storageId });
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

  /**
   * P04-D4 shared writer: run one caller-built canonical command through
   * the P03 gateway under a lease-refreshed write section, with
   * retry-stable operation identity. A retry after a lost acknowledgement
   * replays the journaled receipt instead of duplicating the effect; a
   * reused identity with different content is refused with no write.
   * Visible state mutates only after the durable commit, which is then
   * announced so other tabs invalidate.
   * @param {{ scope: string, statusCell: { fail(message: string): void }, command: FinanceCommand, operationIdRaw?: unknown }} write
   * @returns {Promise<{ ok: true, receipt: import('../commands/index.ts').CommandReceipt, replayed?: boolean } | { ok: false, reason: string, detail?: string }>}
   */
  async function runCanonicalWrite(write) {
    const operation = resolveCallerOperationId(write.operationIdRaw, context);
    if (!operation.ok) {
      write.statusCell.fail(`canonical ${write.scope} refused: invalid operation identity.`);
      return { ok: false, reason: 'validation' };
    }
    if (!state.bookId) {
      write.statusCell.fail(P04D_D2_NO_BOOK_REASON);
      return { ok: false, reason: 'blocked' };
    }
    // D5 round-2: every writer re-verifies epoch and namespace currency
    // here (not only at the port entry), so a flip that lands between
    // entry and commit cannot fork an orphaned namespace.
    try {
      authorityPort.assertWritable(write.scope);
    } catch (error) {
      write.statusCell.fail(error instanceof Error ? error.message : String(error));
      return { ok: false, reason: 'blocked' };
    }
    if (!(await requireCurrentNamespace(write.scope, write.statusCell))) {
      return { ok: false, reason: 'blocked' };
    }
    const committed = findCommittedIntent(state.repository, operation.value, write.command);
    if (committed.status === 'replayed') {
      await refreshCommitted();
      coordination.announceCommit({ storageId: state.storageId, operationId: String(operation.value) });
      return { ok: true, receipt: committed.receipt, replayed: true };
    }
    if (committed.status === 'conflict') {
      write.statusCell.fail(`operation ${String(operation.value)} is already committed with different content; a new intent needs a fresh identity.`);
      return { ok: false, reason: 'error' };
    }
    return withHeldCritical('write', async () => {
      try {
        const result = await state.gateway.execute(write.command, { operationId: operation.value });
        if (!result.ok) {
          const reason = gatewayFailureReason(result.failure);
          write.statusCell.fail(result.detail ?? `canonical ${write.scope} failed`);
          return { ok: false, reason, detail: result.detail };
        }
        await refreshCommitted();
        coordination.announceCommit({ storageId: state.storageId, operationId: String(operation.value) });
        return { ok: true, receipt: result.receipt };
      } catch (error) {
        const reason = error instanceof Error && /epoch/i.test(error.message) ? 'blocked' : 'error';
        write.statusCell.fail(error instanceof Error ? error.message : String(error));
        return { ok: false, reason };
      }
    });
  }

  /**
   * Last day of the month containing `isoDate` (`YYYY-MM-DD`), or null when
   * the input is not a civil date. Materialization applies through the end
   * of the effective month, mirroring the legacy apply-from-month range.
   * @param {string} isoDate
   * @returns {string | null}
   */
  function monthEndOf(isoDate) {
    const parsed = parseCivilDate(isoDate);
    if (!parsed.ok) return null;
    const year = Number(parsed.value.slice(0, 4));
    const month = Number(parsed.value.slice(5, 7));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const tail = String(lastDay).padStart(2, '0');
    return `${parsed.value.slice(0, 7)}-${tail}`;
  }

  /**
   * Hold a coordination critical section across an async task while
   * refreshing its lease, so a long migration/import/reset keeps gating
   * update activation even past the crash-prune TTL. The repository's own
   * commit guards still own conflict safety.
   * @param {'write' | 'import' | 'reset' | 'migration'} kind
   * @param {() => Promise<unknown>} task
   * @returns {Promise<unknown>}
   */
  async function withHeldCritical(kind, task) {
    const entered = coordination.beginCritical(kind);
    let current = entered;
    const heartbeat = setInterval(() => {
      try {
        current = coordination.refreshCritical(current);
      } catch {
        /* lock lost or pruned; the task's commit guards still apply */
      }
    }, COORDINATION_HEARTBEAT_MS);
    if (heartbeat && typeof heartbeat.unref === 'function') heartbeat.unref();
    try {
      return await task();
    } finally {
      clearInterval(heartbeat);
      coordination.endCritical(current);
    }
  }

  /**
   * Execute one append-only expense correction (`correctExpense`) through
   * the P03 gateway under a write critical section. `replacement: null`
   * appends a reversal only (delete); otherwise a linked reversal plus
   * replacement (edit). The original record always stays in canonical
   * history. Visible state mutates only after the durable commit, and the
   * commit is announced so other tabs invalidate.
   * @param {{ scope: string, entryId: string, replacement: unknown, occurredAtLocalDate: string, note: string, operationIdRaw?: unknown }} correction
   * @returns {Promise<CaptureResult>}
   */
  async function runExpenseCorrection(correction) {
    const operation = resolveCallerOperationId(correction.operationIdRaw, context);
    if (!operation.ok) {
      historyStatus.fail('canonical correction refused: invalid operation identity.');
      return blockedResult('validation');
    }
    // D5 round-2: same entry/commit re-verification as runCanonicalWrite.
    try {
      authorityPort.assertWritable(correction.scope);
    } catch (error) {
      historyStatus.fail(error instanceof Error ? error.message : String(error));
      return blockedResult('blocked');
    }
    if (!(await requireCurrentNamespace(correction.scope, historyStatus))) {
      return blockedResult('blocked');
    }
    /** @type {FinanceCommand} */
    const command = {
      kind: 'correctExpense',
      bookId: state.bookId,
      expenseEntryId: correction.entryId,
      occurredAt: { kind: 'civilDate', localDate: correction.occurredAtLocalDate },
      note: correction.note,
      replacement: correction.replacement,
    };
    // Already applied by an earlier attempt (lost acknowledgement)? Replay
    // from the journal instead of previewing against reversed state.
    const committed = findCommittedIntent(state.repository, operation.value, command);
    if (committed.status === 'replayed') {
      await refreshCommitted();
      coordination.announceCommit({ storageId: state.storageId, operationId: String(operation.value) });
      return { ok: true, id: correctionResultId(committed.receipt, correction.entryId) };
    }
    if (committed.status === 'conflict') {
      historyStatus.fail(`operation ${String(operation.value)} is already committed with different content; a new intent needs a fresh identity.`);
      return blockedResult('error');
    }
    // D3 correction: corrections hold the write section under the same
    // refreshed lease as capture/import/reset/migration (see above).
    return withHeldCritical('write', async () => {
      try {
        const result = await state.gateway.execute(command, { operationId: operation.value });
        if (!result.ok) {
          const reason = gatewayFailureReason(result.failure);
          historyStatus.fail(result.detail ?? 'canonical correction failed');
          return blockedResult(reason);
        }
        await refreshCommitted();
        coordination.announceCommit({ storageId: state.storageId, operationId: String(operation.value) });
        return { ok: true, id: correctionResultId(result.receipt, correction.entryId) };
      } catch (error) {
        const reason = error instanceof Error && /epoch/i.test(error.message) ? 'blocked' : 'error';
        historyStatus.fail(error instanceof Error ? error.message : String(error));
        return blockedResult(reason);
      }
    });
  }

  /**
   * Build the `correctExpense` replacement for a legacy-shaped history
   * edit, or report the validation issue. Mapping (documented, no
   * invented fields): the committed actual amount is the card amount, so
   * the edited cost replaces it; the edited civil date replaces the
   * financial date; name/category carry as descriptive links; omitted
   * category/flexible links carry over from the original per command
   * semantics. Classification has no canonical counterpart and is not
   * stored: the read model leaves the field empty instead of guessing.
   * @param {unknown} expense
   * @returns {{ ok: true, entryId: string, replacement: Record<string, unknown>, occurredAtLocalDate: string, note: string } | { ok: false, issue: string }}
   */
  function buildCorrectionReplacement(expense) {
    const record = expense && typeof expense === 'object' ? expense : {};
    const entryId = toText(record.id);
    if (!entryId) return { ok: false, issue: 'missing expense id' };
    const name = toText(record.name).trim();
    if (!name) return { ok: false, issue: 'missing expense name' };
    const rawAmount = Number.isFinite(record.expectedCost) ? record.expectedCost : toFiniteNumber(record.actualPaid);
    if (!Number.isFinite(rawAmount) || rawAmount < 0) return { ok: false, issue: 'invalid expense amount' };
    const converted = convertUntaggedSarMajor(rawAmount, {
      database: 'MicroSaveOS_DB',
      databaseVersion: 1,
      store: 'expenses',
      recordKey: 'candidate-correction',
      field: 'expectedCost',
    });
    if (!converted.ok) return { ok: false, issue: 'invalid expense amount' };
    const dateText = toText(record.date) || state.selectedDate;
    const localDate = parseCivilDate(dateText);
    if (!localDate.ok) return { ok: false, issue: 'invalid expense date' };
    const category = toText(record.category);
    const flexibleDefinitionId = typeof record.flexibleDefinitionId === 'string' ? record.flexibleDefinitionId : '';
    return {
      ok: true,
      entryId,
      replacement: {
        amount: converted.money,
        localDate: localDate.value,
        note: name,
        ...(category ? { category } : {}),
        ...(flexibleDefinitionId ? { flexibleDefinitionId } : {}),
      },
      occurredAtLocalDate: localDate.value,
      note: name,
    };
  }

  /**
   * Build a `createRecurringPlan` payload from a legacy-shaped template or
   * flexible definition, or report the validation issue. Mapping
   * (documented, no invented fields): id carries as the plan identity, name
   * verbatim, expected cost as the per-occurrence amount, the first valid
   * monthly day as the schedule, and a flexible source as a descriptive
   * link. Monthly budgets, max-uses caps, profiles, offdays, and assignment
   * rules have no canonical counterpart and are never inferred: a template
   * without an explicit amount and schedule day is refused instead of
   * guessed.
   * @param {unknown} template
   * @param {unknown} effectiveDateRaw
   * @returns {{ ok: true, planId: unknown, name: string, amount: { currency: string, minorUnits: number }, scheduleDay: number, effectiveDate: string, flexibleDefinitionId: string | null } | { ok: false, issue: string }}
   */
  function buildRecurringPlanCommand(template, effectiveDateRaw) {
    const record = template && typeof template === 'object' ? template : {};
    const rawId = typeof record.id === 'string' ? record.id : '';
    if (!rawId) return { ok: false, issue: 'missing template id' };
    const planId = makePlanId(rawId);
    if (!planId.ok) return { ok: false, issue: 'invalid template id' };
    const name = toText(record.name).trim() || rawId;
    const rawAmount = Number.isFinite(record.expectedCost)
      ? record.expectedCost
      : (Number.isFinite(record.defaultAmount) ? record.defaultAmount : NaN);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return { ok: false, issue: 'template needs an explicit positive amount' };
    }
    const converted = convertUntaggedSarMajor(rawAmount, {
      database: 'MicroSaveOS_DB',
      databaseVersion: 1,
      store: 'templates',
      recordKey: 'candidate-plan',
      field: 'expectedCost',
    });
    if (!converted.ok) return { ok: false, issue: 'invalid template amount' };
    const days = Array.isArray(record.days) ? record.days : [];
    const scheduleDay = days.find((day) => Number.isInteger(day) && day >= 1 && day <= 31);
    if (scheduleDay === undefined) return { ok: false, issue: 'template needs an explicit monthly day' };
    const dateText = toText(effectiveDateRaw) || state.selectedDate;
    const localDate = parseCivilDate(dateText);
    if (!localDate.ok) return { ok: false, issue: 'invalid effective date' };
    const flexibleDefinitionId = record.source === 'flexible' && rawId
      ? rawId
      : (typeof record.flexibleDefinitionId === 'string' ? record.flexibleDefinitionId : null);
    return {
      ok: true,
      planId: planId.value,
      name,
      amount: converted.money,
      scheduleDay,
      effectiveDate: localDate.value,
      flexibleDefinitionId,
    };
  }

  /**
   * @param {string} rangeStart
   * @param {string} reason
   * @returns {{ rangeStart: string, rangeEnd: string, createCount: number, updateCount: number, deleteCount: number, totalChanges: number, blocked: boolean, blockedReason: string }}
   */
  function emptyApplyPreview(rangeStart, reason) {    return {
      rangeStart,
      rangeEnd: '',
      createCount: 0,
      updateCount: 0,
      deleteCount: 0,
      totalChanges: 0,
      blocked: true,
      blockedReason: reason,
    };
  }

  /**
   * Month-end settlement through the append-only cycle commands: close the
   * open cycle, then dispose its remainder. `vault` funds the tracked pool,
   * `budget` carries into the next cycle, `noSurplus` leaves the remainder
   * independent. The whole close+dispose runs inside one lease-refreshed
   * write section; audit history (settlements, carry actions) is preserved.
   * Retry-safe: an already-closed-and-disposed month returns its settlement
   * instead of moving money twice, and a close-then-false retry disposes
   * the existing settlement instead of failing.
   * @param {string} scope
   * @param {'vault' | 'budget' | 'noSurplus'} decision
   * @param {unknown} summary
   * @param {unknown} referenceDate
   * @returns {Promise<unknown>}
   */
  async function runMonthEndSettlement(scope, decision, summary, referenceDate) {
    const blocked = requireWritable(scope);
    if (blocked) {
      goalsStatus.fail(`P04-D writes blocked for '${scope}': the authority is not writable.`);
      return null;
    }
    if (!state.bookId) {
      goalsStatus.fail(P04D_D2_NO_BOOK_REASON);
      return null;
    }
    // D5 round-2: refuse orphaned-namespace settlement like any writer.
    if (!(await requireCurrentNamespace(scope, goalsStatus))) {
      return null;
    }
    const record = summary && typeof summary === 'object' ? summary : {};
    const previousMonthKey = typeof record.previousMonthKey === 'string' ? record.previousMonthKey : '';
    if (!isMonthKeyText(previousMonthKey)) {
      goalsStatus.fail(`canonical settlement refused: invalid previous month.`);
      return null;
    }
    const expectedCycle = composeCycleId(state.bookId, `${previousMonthKey}-01`);
    if (!expectedCycle.ok) {
      goalsStatus.fail('canonical settlement refused: invalid cycle identity.');
      return null;
    }
    return withHeldCritical('write', async () => {
      const settled = await settleWithCommands(scope, decision, previousMonthKey, expectedCycle.value);
      await refreshCommitted();
      if (settled.ok) {
        coordination.announceCommit({ storageId: state.storageId });
        return settled.settlement;
      }
      goalsStatus.fail(settled.detail);
      return null;
    }).catch((error) => {
      goalsStatus.fail(error instanceof Error ? error.message : String(error));
      return null;
    });
  }

  /**
   * First day of the month after `monthKey` (`YYYY-MM`), or null when the
   * input is not a month key.
   * @param {string} monthKey
   * @returns {string | null}
   */
  function nextStartFor(monthKey) {
    if (!isMonthKeyText(monthKey)) return null;
    const year = Number(monthKey.slice(0, 4));
    let nextYear = year;
    let nextMonth = Number(monthKey.slice(5, 7)) + 1;
    if (nextMonth === 13) {
      nextYear += 1;
      nextMonth = 1;
    }
    return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;
  }

  /**
   * Ensure an open cycle exists for a funding/carry disposition, opening
   * the cycle starting `startDate` with zero starting funds when none is
   * open. An already-open cycle is reused untouched.
   * @param {string} scope
   * @param {string | null} startDate
   * @returns {Promise<{ ok: true } | { ok: false, detail: string }>}
   */
  async function ensureOpenCycleForDisposition(scope, startDate) {
    if (projectOpenCycleId(currentBook())) return { ok: true };
    if (!startDate) {
      return { ok: false, detail: `canonical ${scope} refused: no open cycle and no next cycle to open` };
    }
    const book = currentBook();
    const currency = book?.book?.currency ?? 'SAR';
    /** @type {FinanceCommand} */
    const open = {
      kind: 'openCycle',
      bookId: state.bookId,
      startingFunds: { currency, minorUnits: 0 },
      startDate,
    };
    let result;
    try {
      result = await state.gateway.execute(open, { operationId: mintOperationId(context) });
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    if (result.ok) {
      await refreshCommitted();
      return { ok: true };
    }
    // Another tab may have opened the cycle first: re-read before failing.
    await refreshCommitted();
    if (projectOpenCycleId(currentBook())) return { ok: true };
    return { ok: false, detail: result.detail ?? `canonical ${scope} could not open the next cycle` };
  }

  /**
   * @param {string} scope
   * @param {'vault' | 'budget' | 'noSurplus'} decision
   * @param {string} previousMonthKey
   * @param {unknown} expectedCycleId
   * @returns {Promise<{ ok: true, settlement: unknown } | { ok: false, detail: string }>}
   */
  async function settleWithCommands(scope, decision, previousMonthKey, expectedCycleId) {
    const book = currentBook();
    const existing = book && Array.isArray(book.settlements)
      ? book.settlements.filter((settlement) => String(settlement.cycleId) === String(expectedCycleId) && settlement.reversed !== true)
      : [];
    const latest = existing.length > 0 ? existing[existing.length - 1] : null;
    const consumed = latest && book
      ? book.carryActions.some((action) => String(action.settlementId) === String(latest.settlementId))
      : false;
    if (latest && consumed) {
      // Idempotent success: this month already closed and disposed.
      return { ok: true, settlement: latest };
    }
    let settlement = latest;
    if (!settlement) {
      /** @type {FinanceCommand} */
      const close = {
        kind: 'closeCycle',
        bookId: state.bookId,
        cycleId: expectedCycleId,
        note: `month-end ${previousMonthKey} to ${decision}`,
      };
      let closed;
      try {
        closed = await state.gateway.execute(close, { operationId: mintOperationId(context) });
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
      if (!closed.ok) {
        // Close-then-false retry: the close may have committed while its
        // acknowledgement was lost. Re-read before failing: an existing
        // settlement for the named cycle continues below instead of
        // failing the retry.
        await refreshCommitted();
        const reread = currentBook();
        const found = reread && Array.isArray(reread.settlements)
          ? reread.settlements.filter((entry) => String(entry.cycleId) === String(expectedCycleId) && entry.reversed !== true)
          : [];
        if (found.length === 0) {
          return { ok: false, detail: closed.detail ?? `canonical ${scope} close failed` };
        }
        settlement = found[found.length - 1];
        const alreadyConsumed = reread.carryActions.some(
          (action) => String(action.settlementId) === String(settlement.settlementId),
        );
        if (alreadyConsumed) return { ok: true, settlement };
      } else {
        const effect = closed.receipt.effects.find((entry) => entry.kind === 'cycleClosed');
        if (!effect || !('settlementId' in effect)) {
          return { ok: false, detail: `canonical ${scope} close produced no settlement` };
        }
        const afterClose = currentBook();
        settlement = afterClose && Array.isArray(afterClose.settlements)
          ? (afterClose.settlements.find((entry) => String(entry.settlementId) === String(effect.settlementId)) ?? null)
          : null;
        if (!settlement) {
          return { ok: false, detail: `canonical ${scope} settlement is not readable after close` };
        }
      }
    }
    const availability = settlement.availability ?? null;
    const minorUnits = availability && typeof availability.minorUnits === 'number' ? availability.minorUnits : NaN;
    if (decision !== 'noSurplus' && (!Number.isSafeInteger(minorUnits) || minorUnits <= 0)) {
      return { ok: false, detail: `canonical ${scope} refused: no positive remainder to move` };
    }
    /** @type {{ kind: string, amount?: unknown, destinationCycleId?: unknown }} */
    let disposition = { kind: 'leaveIndependent' };
    if (decision !== 'noSurplus') {
      // Funding and carry-in land on an existing open cycle. When the
      // closed month was the last open one, open the next cycle first with
      // explicitly zero starting funds: no new allowance is invented (the
      // allowance is read-only migrated history), and the remainder
      // movement itself populates the new cycle.
      await refreshCommitted();
      const ensured = await ensureOpenCycleForDisposition(scope, nextStartFor(previousMonthKey));
      if (!ensured.ok) return ensured;
      const amount = { currency: availability.currency, minorUnits };
      if (decision === 'vault') {
        disposition = { kind: 'fundTracked', amount };
      } else {
        const openId = projectOpenCycleId(currentBook());
        if (!openId) {
          return { ok: false, detail: `canonical ${scope} refused: no open cycle to carry into` };
        }
        disposition = { kind: 'carryIn', amount, destinationCycleId: openId };
      }
    }
    /** @type {FinanceCommand} */
    const dispose = {
      kind: 'disposeCycleRemainder',
      bookId: state.bookId,
      settlementId: settlement.settlementId,
      disposition,
      note: `month-end ${previousMonthKey} to ${decision}`,
    };
    let disposed;
    try {
      disposed = await state.gateway.execute(dispose, { operationId: mintOperationId(context) });
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    if (!disposed.ok) {
      return { ok: false, detail: disposed.detail ?? `canonical ${scope} dispose failed` };
    }
    // A settle that leaves no open cycle would brick future recording
    // (capture needs a covering open cycle). Vault/budget already ensured
    // one above; a no-surplus close opens the next month with zero
    // starting funds so the book stays writable without inventing an
    // allowance.
    await refreshCommitted();
    if (!projectOpenCycleId(currentBook())) {
      const nextStart = nextStartFor(previousMonthKey);
      const ensured = await ensureOpenCycleForDisposition(scope, nextStart);
      if (!ensured.ok) {
        goalsStatus.fail(`settled but no open cycle: ${ensured.detail}.`);
      }
    }
    return { ok: true, settlement };
  }

  /**
   * Advance a provably zero-fact book to `monthStart` (`YYYY-MM-01`):
   * close the stale open cycle, dispose its (empty) remainder as
   * independent, and open the target month with zero starting funds.
   * Callers must verify zero-fact first; this helper moves no user facts
   * by construction (there are none) and never invents an allowance.
   * @param {string} monthStart
   * @returns {Promise<{ ok: true } | { ok: false, detail: string }>}
   */
  async function advanceEmptyBookToMonth(monthStart) {
    const run = async (command) => {
      try {
        return await state.gateway.execute(command, { operationId: mintOperationId(context) });
      } catch (error) {
        return { ok: false, failure: null, detail: error instanceof Error ? error.message : String(error) };
      }
    };
    const parsed = parseCivilDate(monthStart);
    if (!parsed.ok) return { ok: false, detail: 'invalid target month' };
    const book = currentBook();
    const open = book && Array.isArray(book.cycles)
      ? book.cycles.filter((cycle) => {
        try {
          return effectiveVersionStatus(book, cycle) === 'open';
        } catch {
          return false;
        }
      })
      : [];
    // Close every stale open version so the single-open-cycle invariant
    // holds before opening the target month.
    for (const version of open) {
      /** @type {FinanceCommand} */
      const close = {
        kind: 'closeCycle',
        bookId: state.bookId,
        cycleId: version.cycleId,
        note: 'p04-d4: advance zero-fact book to the current month',
      };
      const closed = await run(close);
      if (!closed.ok) {
        return { ok: false, detail: closed.detail ?? 'closeCycle refused' };
      }
      const effect = closed.receipt?.effects?.find?.((entry) => entry.kind === 'cycleClosed');
      const settlementId = effect && 'settlementId' in effect ? effect.settlementId : null;
      if (!settlementId) return { ok: false, detail: 'close produced no settlement' };
      /** @type {FinanceCommand} */
      const dispose = {
        kind: 'disposeCycleRemainder',
        bookId: state.bookId,
        settlementId,
        disposition: { kind: 'leaveIndependent' },
        note: 'p04-d4: advance zero-fact book to the current month',
      };
      const disposed = await run(dispose);
      if (!disposed.ok) {
        return { ok: false, detail: disposed.detail ?? 'disposeCycleRemainder refused' };
      }
    }
    const currency = currentBook()?.book?.currency ?? 'SAR';
    /** @type {FinanceCommand} */
    const openNext = {
      kind: 'openCycle',
      bookId: state.bookId,
      startingFunds: { currency, minorUnits: 0 },
      startDate: parsed.value,
    };
    const opened = await run(openNext);
    if (!opened.ok) {
      return { ok: false, detail: opened.detail ?? 'openCycle refused' };
    }
    await refreshCommitted();
    coordination.announceCommit({ storageId: state.storageId });
    return { ok: true };
  }

  /** @type {ShellFeaturePorts} */
  const ports = {
    authority: authorityPort,
    home: {
      name: 'home',
      getSelectedDate() {
        return state.selectedDate;
      },
      getSafeToSpend() {
        // D4: open-cycle availability from the domain derive. Unknown
        // stays null (no book / no open cycle); a computed zero is real.
        return projectAvailabilityAmount(currentBook(), {
          asOfInstantMs: context.clock.nowMs(),
          calculationVersion: context.calculationVersion,
        });
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
        // D5 round-2: refuse orphaned-namespace capture like any writer.
        if (!(await requireCurrentNamespace('capture.submitExpense', captureStatus))) {
          return blockedResult('blocked');
        }
        const dateText = toText(input?.date) || state.selectedDate;
        const localDate = parseCivilDate(dateText);
        if (!localDate.ok) return blockedResult('validation');
        // D3 correction: an empty category stays empty (null), never a
        // made-up default. The command treats null as "no category yet".
        // Retry-stable identity: a retry after a lost acknowledgement
        // reuses the caller's operation ID and replays idempotently; a new
        // intent mints a fresh ID that cannot collide with journal history.
        const operation = resolveCallerOperationId(input?.operationId, context);
        if (!operation.ok) {
          captureStatus.fail('canonical capture refused: invalid operation identity.');
          return blockedResult('validation');
        }
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
          category: toText(input?.category) || null,
          flexibleDefinitionId: input?.source === 'flexible' && typeof input?.flexibleDefinitionId === 'string'
            ? input.flexibleDefinitionId
            : null,
        };
        // Already applied by an earlier attempt (lost acknowledgement)?
        // Replay from the journal instead of committing a second actual.
        const committed = findCommittedIntent(state.repository, operation.value, command);
        if (committed.status === 'replayed') {
          const recorded = committed.receipt?.effects?.find((effect) => effect.kind === 'expenseRecorded');
          coordination.announceCommit({ storageId: state.storageId, operationId: String(operation.value) });
          return { ok: true, id: recorded && 'entryId' in recorded ? String(recorded.entryId) : undefined };
        }
        if (committed.status === 'conflict') {
          captureStatus.fail(`operation ${String(operation.value)} is already committed with different content; a new intent needs a fresh identity.`);
          return blockedResult('error');
        }
        // D3 correction: capture holds the write section under the same
        // refreshed lease as import/reset/migration, so an update cannot
        // activate across a live write merely because the TTL elapsed.
        return withHeldCritical('write', async () => {
          try {
            const result = await state.gateway.execute(command, { operationId: operation.value });
            if (!result.ok) {
              const reason = gatewayFailureReason(result.failure);
              captureStatus.fail(result.detail ?? 'canonical capture failed');
              return blockedResult(reason);
            }
            const recorded = result.receipt.effects.find((effect) => effect.kind === 'expenseRecorded');
            coordination.announceCommit({ storageId: state.storageId, operationId: String(operation.value) });
            return { ok: true, id: recorded && 'entryId' in recorded ? String(recorded.entryId) : undefined };
          } catch (error) {
            const reason = error instanceof Error && /epoch/i.test(error.message) ? 'blocked' : 'error';
            captureStatus.fail(error instanceof Error ? error.message : String(error));
            return blockedResult(reason);
          }
        });
      },
      async payExpense() {
        // D3: a paid actual has no unpaid counterpart in the canonical
        // model, so pay/reopen cannot map exactly. Correct or reverse the
        // expense through history instead; never mutate in place or v1.
        captureStatus.fail(P04D_D3_PAY_BLOCKED_REASON);
        return blockedResult('blocked');
      },
      async markUnpaid() {
        captureStatus.fail(P04D_D3_PAY_BLOCKED_REASON);
        return blockedResult('blocked');
      },
      async autoFillDay() {
        planStatus.fail(P04D_D3_PAY_BLOCKED_REASON);
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
      async updateExpense(expense, options = {}) {
        const blocked = requireWritable('history.updateExpense');
        if (blocked) return blocked.result;
        if (!state.bookId) {
          historyStatus.fail(P04D_D2_NO_BOOK_REASON);
          return blockedResult('blocked');
        }
        const built = buildCorrectionReplacement(expense);
        if (!built.ok) {
          historyStatus.fail(`canonical correction refused: ${built.issue}.`);
          return blockedResult('validation');
        }
        return runExpenseCorrection({
          scope: 'history.updateExpense',
          entryId: built.entryId,
          replacement: built.replacement,
          occurredAtLocalDate: built.occurredAtLocalDate,
          note: built.note,
          operationIdRaw: options?.operationId,
        });
      },
      async deleteExpense(id, options = {}) {
        const blocked = requireWritable('history.deleteExpense');
        if (blocked) return blocked.result;
        if (!state.bookId) {
          historyStatus.fail(P04D_D2_NO_BOOK_REASON);
          return blockedResult('blocked');
        }
        const entryId = toText(id);
        if (!entryId) return blockedResult('validation');
        const occurredAt = parseCivilDate(state.selectedDate);
        if (!occurredAt.ok) {
          historyStatus.fail('canonical reversal refused: invalid selected date.');
          return blockedResult('validation');
        }
        // Delete is an append-only reversal (`replacement: null`); the
        // original record stays in canonical history/audit state while the
        // live Transactions view hides the reversed entry.
        return runExpenseCorrection({
          scope: 'history.deleteExpense',
          entryId,
          replacement: null,
          occurredAtLocalDate: occurredAt.value,
          note: `reversal of ${entryId}`,
          operationIdRaw: options?.operationId,
        });
      },
      async deleteSelected(ids, options = {}) {
        const blocked = requireWritable('history.deleteSelected');
        if (blocked) return blocked.result;
        if (!state.bookId) {
          historyStatus.fail(P04D_D2_NO_BOOK_REASON);
          return blockedResult('blocked');
        }
        if (!Array.isArray(ids)) return blockedResult('validation');
        const list = ids.filter((id) => typeof id === 'string' && id);
        if (list.length !== ids.length) return blockedResult('validation');
        if (list.length === 0) return { ok: true };
        const occurredAt = parseCivilDate(state.selectedDate);
        if (!occurredAt.ok) {
          historyStatus.fail('canonical batch reversal refused: invalid selected date.');
          return blockedResult('validation');
        }
        const perIntentIds = Array.isArray(options?.operationIds) ? options.operationIds : [];
        const failures = [];
        let succeeded = 0;
        for (let index = 0; index < list.length; index += 1) {
          const result = await runExpenseCorrection({
            scope: 'history.deleteSelected',
            entryId: list[index],
            replacement: null,
            occurredAtLocalDate: occurredAt.value,
            note: `reversal of ${list[index]}`,
            operationIdRaw: perIntentIds[index],
          });
          if (result.ok) {
            succeeded += 1;
          } else {
            failures.push(`${list[index]}: ${result.reason}`);
          }
        }
        if (failures.length > 0) {
          // Explicit partial failure: never report all-success when any
          // reversal failed. Succeeded reversals stay committed (append-only
          // facts cannot be un-appended); the caller retries only failures
          // with fresh operation identities.
          historyStatus.fail(
            `canonical batch delete partially failed (${succeeded}/${list.length} reversed): ${failures.join('; ')}`,
          );
          return blockedResult('partial');
        }
        return { ok: true };
      },
      async markSelectedUnpaid() {
        historyStatus.fail(P04D_D3_BULK_UNPAID_BLOCKED_REASON);
        return blockedResult('blocked');
      },
      getStatus() {
        return historyStatus.get();
      },
    },
    plan: {
      name: 'plan',
      listProfiles() {
        // D4: template profiles are a v1-only grouping with no canonical
        // counterpart. The empty list is truthful, never a guessed mapping.
        return [];
      },
      listPlans() {
        return projectPlanSummaries(currentBook());
      },
      getActiveProfileId() {
        return '';
      },
      async setActiveProfile() {
        planStatus.fail(P04D_D4_PROFILE_BLOCKED_REASON);
        throw new Error(P04D_D4_PROFILE_BLOCKED_REASON);
      },
      async createProfile() {
        planStatus.fail(P04D_D4_PROFILE_BLOCKED_REASON);
        throw new Error(P04D_D4_PROFILE_BLOCKED_REASON);
      },
      async setProfileOffdays() {
        planStatus.fail(P04D_D4_PROFILE_BLOCKED_REASON);
        throw new Error(P04D_D4_PROFILE_BLOCKED_REASON);
      },
      async saveTemplate(template, options = {}) {
        const blocked = requireWritable('plan.saveTemplate');
        if (blocked) {
          planStatus.fail(`P04-D writes blocked for 'plan.saveTemplate': the authority is not writable.`);
          throw new Error(`P04-D writes blocked for 'plan.saveTemplate': the authority is not writable.`);
        }
        const built = buildRecurringPlanCommand(template, options?.effectiveDate);
        if (!built.ok) {
          planStatus.fail(`canonical plan refused: ${built.issue}.`);
          throw new Error(`canonical plan refused: ${built.issue}.`);
        }
        const book = currentBook();
        const exists = !!book && Array.isArray(book.plans)
          && book.plans.some((plan) => String(plan.planId) === String(built.planId));
        /** @type {FinanceCommand} */
        const command = exists
          ? {
            kind: 'reviseRecurringPlan',
            bookId: state.bookId,
            planId: built.planId,
            effectiveDate: built.effectiveDate,
            amount: built.amount,
            scheduleDay: built.scheduleDay,
            note: built.name,
          }
          : {
            kind: 'createRecurringPlan',
            bookId: state.bookId,
            planId: built.planId,
            name: built.name,
            amount: built.amount,
            scheduleDay: built.scheduleDay,
            effectiveDate: built.effectiveDate,
            flexibleDefinitionId: built.flexibleDefinitionId,
          };
        const result = await runCanonicalWrite({
          scope: 'plan.saveTemplate',
          statusCell: planStatus,
          command,
          operationIdRaw: options?.operationId,
        });
        if (!result.ok) {
          throw new Error(result.detail ?? `canonical plan save failed (${result.reason}).`);
        }
      },
      async deleteTemplate() {
        // D4: recurring plans are append-only; no delete command exists.
        // Detach or revise an occurrence instead of deleting the rule.
        planStatus.fail(P04D_D4_TEMPLATE_DELETE_BLOCKED_REASON);
        throw new Error(P04D_D4_TEMPLATE_DELETE_BLOCKED_REASON);
      },
      async saveFlexibleDefinition(definition, options = {}) {
        const blocked = requireWritable('plan.saveFlexibleDefinition');
        if (blocked) {
          planStatus.fail(`P04-D writes blocked for 'plan.saveFlexibleDefinition': the authority is not writable.`);
          throw new Error(`P04-D writes blocked for 'plan.saveFlexibleDefinition': the authority is not writable.`);
        }
        const built = buildRecurringPlanCommand(definition, options?.effectiveDate);
        if (!built.ok) {
          planStatus.fail(`canonical flexible plan refused: ${built.issue}.`);
          throw new Error(`canonical flexible plan refused: ${built.issue}.`);
        }
        const record = definition && typeof definition === 'object' ? definition : {};
        const flexibleLink = typeof record.id === 'string' && record.id
          ? record.id
          : (typeof record.flexibleDefinitionId === 'string' ? record.flexibleDefinitionId : null);
        const book = currentBook();
        // D4 correction: revise when the rule already exists. Always
        // creating would duplicate the plan on every re-save (a hidden
        // unsafe update path); revise keeps the existing flexible link.
        const exists = !!book && Array.isArray(book.plans)
          && book.plans.some((plan) => String(plan.planId) === String(built.planId));
        /** @type {FinanceCommand} */
        const command = exists
          ? {
            kind: 'reviseRecurringPlan',
            bookId: state.bookId,
            planId: built.planId,
            effectiveDate: built.effectiveDate,
            amount: built.amount,
            scheduleDay: built.scheduleDay,
            note: built.name,
          }
          : {
            kind: 'createRecurringPlan',
            bookId: state.bookId,
            planId: built.planId,
            name: built.name,
            amount: built.amount,
            scheduleDay: built.scheduleDay,
            effectiveDate: built.effectiveDate,
            flexibleDefinitionId: flexibleLink,
          };
        const result = await runCanonicalWrite({
          scope: 'plan.saveFlexibleDefinition',
          statusCell: planStatus,
          command,
          operationIdRaw: options?.operationId,
        });
        if (!result.ok) {
          throw new Error(result.detail ?? `canonical flexible plan save failed (${result.reason}).`);
        }
      },
      async previewApply(effectiveDate, profileId) {
        void profileId;
        // D4: profiles do not exist canonically; the effective month is
        // materialized for every recurring plan instead.
        const throughDate = monthEndOf(toText(effectiveDate));
        if (!throughDate || !state.bookId) {
          return emptyApplyPreview(toText(effectiveDate), P04D_D2_D4_OWNED_REASON);
        }
        const book = currentBook();
        if (!book || !Array.isArray(book.plans)) {
          return emptyApplyPreview(toText(effectiveDate), P04D_D2_D4_OWNED_REASON);
        }
        let createCount = 0;
        for (const plan of book.plans) {
          /** @type {FinanceCommand} */
          const command = {
            kind: 'materializePlanOccurrences',
            bookId: state.bookId,
            planId: plan.planId,
            throughDate,
          };
          let previewed;
          try {
            previewed = state.gateway.preview(command);
          } catch (error) {
            return emptyApplyPreview(
              toText(effectiveDate),
              error instanceof Error ? error.message : String(error),
            );
          }
          if (!previewed.ok) {
            return emptyApplyPreview(toText(effectiveDate), state.gateway.describeFailure(previewed.failure));
          }
          for (const effect of previewed.preview.effects) {
            if (effect.kind === 'planOccurrencesMaterialized' && Array.isArray(effect.occurrenceIds)) {
              createCount += effect.occurrenceIds.length;
            }
          }
        }
        return {
          rangeStart: toText(effectiveDate),
          rangeEnd: throughDate,
          createCount,
          updateCount: 0,
          deleteCount: 0,
          totalChanges: createCount,
          blocked: false,
        };
      },
      async confirmApply(effectiveDate, profileId, options = {}) {
        void profileId;
        const blocked = requireWritable('plan.confirmApply');
        if (blocked) {
          return { ...emptyApplyPreview(toText(effectiveDate), 'P04-D writes are blocked: the authority is not writable.'), blocked: true };
        }
        const throughDate = monthEndOf(toText(effectiveDate));
        if (!throughDate || !state.bookId) {
          return { ...emptyApplyPreview(toText(effectiveDate), 'canonical apply refused: invalid effective date.'), blocked: true };
        }
        const book = currentBook();
        if (!book || !Array.isArray(book.plans)) {
          return { ...emptyApplyPreview(toText(effectiveDate), 'canonical apply refused: no plans exist.'), blocked: true };
        }
        // D5 round-2: refuse orphaned-namespace apply like any writer.
        if (!(await requireCurrentNamespace('plan.confirmApply', planStatus))) {
          return { ...emptyApplyPreview(toText(effectiveDate), P04D_D5_STORAGE_MOVED_REASON), blocked: true };
        }
        // D4 correction: all-or-blocked from the UI perspective. Phase 1
        // previews every plan without writing; any preview failure
        // returns blocked before a single commit. Phase 2 executes
        // per-plan with the caller's stable identities (a retry replays
        // already-committed plans instead of duplicating them). The
        // commit announcement — and therefore any UI success — happens
        // only when every plan applied. Atomic/idempotent
        // materialization (deterministic occurrence IDs) means a retry
        // after a partial failure converges instead of recreating
        // managed occurrences; paid/detached occurrences are never
        // recreated by the command.
        return withHeldCritical('write', async () => {
          const prepared = [];
          for (const plan of book.plans) {
            /** @type {FinanceCommand} */
            const command = {
              kind: 'materializePlanOccurrences',
              bookId: state.bookId,
              planId: plan.planId,
              throughDate,
            };
            const operation = resolveCallerOperationId(options?.operationIds?.[String(plan.planId)], context);
            if (!operation.ok) {
              const detail = `canonical apply refused before any commit: invalid operation identity for ${String(plan.planId)}.`;
              planStatus.fail(detail);
              return {
                rangeStart: toText(effectiveDate),
                rangeEnd: throughDate,
                createCount: 0,
                updateCount: 0,
                deleteCount: 0,
                totalChanges: 0,
                blocked: true,
                blockedReason: detail,
              };
            }
            let previewed;
            try {
              previewed = state.gateway.preview(command);
            } catch (error) {
              const detail = `canonical apply refused before any commit for ${String(plan.planId)}: ${error instanceof Error ? error.message : String(error)}.`;
              planStatus.fail(detail);
              return {
                rangeStart: toText(effectiveDate),
                rangeEnd: throughDate,
                createCount: 0,
                updateCount: 0,
                deleteCount: 0,
                totalChanges: 0,
                blocked: true,
                blockedReason: detail,
              };
            }
            if (!previewed.ok) {
              const detail = `canonical apply refused before any commit for ${String(plan.planId)}: ${state.gateway.describeFailure(previewed.failure)}.`;
              planStatus.fail(detail);
              return {
                rangeStart: toText(effectiveDate),
                rangeEnd: throughDate,
                createCount: 0,
                updateCount: 0,
                deleteCount: 0,
                totalChanges: 0,
                blocked: true,
                blockedReason: detail,
              };
            }
            prepared.push({ plan, command, operationId: operation.value });
          }
          let createCount = 0;
          const failures = [];
          for (const { plan, command, operationId } of prepared) {
            const committed = findCommittedIntent(state.repository, operationId, command);
            if (committed.status === 'replayed') {
              const replayed = committed.receipt?.effects?.find((effect) => effect.kind === 'planOccurrencesMaterialized');
              if (replayed && 'occurrenceIds' in replayed && Array.isArray(replayed.occurrenceIds)) {
                createCount += replayed.occurrenceIds.length;
              }
              continue;
            }
            if (committed.status === 'conflict') {
              failures.push(`${String(plan.planId)}: operation identity already committed with different content`);
              continue;
            }
            let result;
            try {
              result = await state.gateway.execute(command, { operationId });
            } catch (error) {
              failures.push(`${String(plan.planId)}: ${error instanceof Error ? error.message : String(error)}`);
              continue;
            }
            if (!result.ok) {
              failures.push(`${String(plan.planId)}: ${result.detail ?? 'materialize failed'}`);
              continue;
            }
            const effect = result.receipt.effects.find((entry) => entry.kind === 'planOccurrencesMaterialized');
            if (effect && 'occurrenceIds' in effect && Array.isArray(effect.occurrenceIds)) {
              createCount += effect.occurrenceIds.length;
            }
          }
          await refreshCommitted();
          if (failures.length > 0) {
            // No commit announcement here: other tabs must not treat a
            // partial apply as success, and the UI keeps the modal open
            // with the intent (and its per-plan identities) retained for
            // an idempotent retry.
            const detail = `canonical apply partially failed: ${failures.join('; ')}. No success was announced; retry with the same per-plan identities to converge.`;
            planStatus.fail(detail);
            return {
              rangeStart: toText(effectiveDate),
              rangeEnd: throughDate,
              createCount,
              updateCount: 0,
              deleteCount: 0,
              totalChanges: createCount,
              blocked: true,
              blockedReason: detail,
            };
          }
          coordination.announceCommit({ storageId: state.storageId });
          return {
            rangeStart: toText(effectiveDate),
            rangeEnd: throughDate,
            createCount,
            updateCount: 0,
            deleteCount: 0,
            totalChanges: createCount,
            blocked: false,
          };
        }).catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          planStatus.fail(detail);
          return { ...emptyApplyPreview(toText(effectiveDate), detail), blocked: true };
        });
      },
      getStatus() {
        return planStatus.get();
      },
    },
    insights: {
      name: 'insights',
      getMonthStatistics(monthKey) {
        // D4: month totals derive from committed canonical facts. The
        // monthly budget has no canonical fact (starting funds are not a
        // budget), so it stays unknown — never zero. Open-cycle
        // safe-to-spend is canonical availability; other months stay
        // unknown rather than borrowing today's pool. Commitments and the
        // tracked pool travel as explicit extras.
        const requested = toText(monthKey);
        const resolved = isMonthKeyText(requested) ? requested : state.selectedDate.slice(0, 7);
        const key = isMonthKeyText(resolved) ? resolved : '';
        const book = currentBook();
        const availability = projectAvailabilityAmount(book, {
          asOfInstantMs: context.clock.nowMs(),
          calculationVersion: context.calculationVersion,
        });
        const openMonth = projectOpenCycleMonthKey(book);
        const safeToSpend = key && openMonth && key === openMonth ? availability : null;
        return {
          monthKey: key,
          budgetKnown: false,
          budget: null,
          paidSpent: key ? projectMonthPaidTotal(book, key) : 0,
          unpaidEssential: 0,
          safeToSpend,
          projectedBalance: safeToSpend,
          commitments: projectCommitmentsTotal(book),
          trackedPoolAvailable: projectTrackedPoolTotal(book),
        };
      },
      getCategoryBreakdown() {
        const monthKey = state.selectedDate.slice(0, 7);
        if (!isMonthKeyText(monthKey)) return [];
        return projectMonthCategoryBreakdown(currentBook(), monthKey);
      },
      getWeeklySpending() {
        const monthKey = state.selectedDate.slice(0, 7);
        if (!isMonthKeyText(monthKey)) return [];
        return projectMonthWeeklySpending(currentBook(), monthKey);
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
      async addGoal(goal, options = {}) {
        const blocked = requireWritable('goals.addGoal');
        if (blocked) {
          goalsStatus.fail(`P04-D writes blocked for 'goals.addGoal': the authority is not writable.`);
          return null;
        }
        const name = toText(goal?.name).trim();
        if (!name) {
          goalsStatus.fail('canonical goal refused: missing goal name.');
          return null;
        }
        const rawTarget = Number(goal?.targetAmount);
        if (!Number.isFinite(rawTarget) || rawTarget <= 0) {
          goalsStatus.fail('canonical goal refused: the target needs an explicit positive amount.');
          return null;
        }
        const converted = convertUntaggedSarMajor(rawTarget, {
          database: 'MicroSaveOS_DB',
          databaseVersion: 1,
          store: 'settings',
          recordKey: 'candidate-goal',
          field: 'targetAmount',
        });
        if (!converted.ok) {
          goalsStatus.fail('canonical goal refused: invalid target amount.');
          return null;
        }
        const rawGoalId = typeof options?.goalId === 'string' && options.goalId
          ? options.goalId
          : (typeof options?.operationId === 'string' && options.operationId
            // Retry-stable identity: the goal id derives from the intent's
            // operation id, so a retry after a lost acknowledgement replays
            // the same command instead of conflicting on a fresh goal id.
            ? `goal-${options.operationId}`.slice(0, 100)
            : context.ids.newId('goal'));
        const goalId = makeGoalId(rawGoalId);
        if (!goalId.ok) {
          goalsStatus.fail('canonical goal refused: invalid goal identity.');
          return null;
        }
        /** @type {FinanceCommand} */
        const command = {
          kind: 'createGoal',
          bookId: state.bookId,
          goalId: goalId.value,
          name,
          targetAmount: converted.money,
        };
        const result = await runCanonicalWrite({
          scope: 'goals.addGoal',
          statusCell: goalsStatus,
          command,
          operationIdRaw: options?.operationId,
        });
        if (!result.ok) return null;
        // A user-provided opening allocation is the user's own fact, not an
        // inferred migration: assign it explicitly after the goal exists. A
        // failed assignment keeps the created goal and records the status;
        // append-only facts cannot be un-appended.
        const rawAllocated = Number(goal?.allocatedAmount ?? 0);
        if (Number.isFinite(rawAllocated) && rawAllocated > 0) {
          const assigned = convertUntaggedSarMajor(rawAllocated, {
            database: 'MicroSaveOS_DB',
            databaseVersion: 1,
            store: 'settings',
            recordKey: 'candidate-goal',
            field: 'allocatedAmount',
          });
          if (assigned.ok) {
            /** @type {FinanceCommand} */
            const assign = {
              kind: 'assignToGoal',
              bookId: state.bookId,
              goalId: goalId.value,
              amount: assigned.money,
              note: name,
            };
            // Retry-stable like the creation above: the assignment identity
            // derives from the intent's operation id, so a retry after a
            // lost acknowledgement replays instead of assigning twice.
            const assignOperationId = typeof options?.operationId === 'string' && options.operationId
              ? `${options.operationId}:assign`.slice(0, 100)
              : undefined;
            const assignedResult = await runCanonicalWrite({
              scope: 'goals.addGoal.assign',
              statusCell: goalsStatus,
              command: assign,
              operationIdRaw: assignOperationId,
            });
            if (!assignedResult.ok) {
              goalsStatus.fail(`goal created without its opening allocation: ${assignedResult.reason}.`);
            }
          }
        }
        return { id: String(goalId.value) };
      },
      async deleteGoal() {
        // D4: goals are append-only; no delete command exists. Unassign and
        // release the allocation instead of deleting the goal.
        goalsStatus.fail(P04D_D4_GOAL_DELETE_BLOCKED_REASON);
        return false;
      },
      async settleToVault(summary, referenceDate) {
        return runMonthEndSettlement('goals.settleToVault', 'vault', summary, referenceDate);
      },
      async settleToBudget(summary, referenceDate) {
        return runMonthEndSettlement('goals.settleToBudget', 'budget', summary, referenceDate);
      },
      async settleNoSurplus(summary, referenceDate) {
        return runMonthEndSettlement('goals.settleNoSurplus', 'noSurplus', summary, referenceDate);
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
        // D3: the import section is lease-refreshed, so a large restore
        // keeps gating update activation across the whole commit point.
        return withHeldCritical('import', async () => {
          // The storage adapter owns document preview: the durable adapter
          // runs the P04-C portable validation, while test adapters preview
          // their own document shape. Either way the host never invents data.
          // Note the shapes differ: P04-C previews carry no `ok` marker on
          // success (only `{ ok: false, ... }` on failure), so success is
          // anything that is not an explicit failure.
          const preview = typeof storage.previewImport === 'function'
            ? await storage.previewImport(snapshot)
            : await previewPortableImport(snapshot);
          if (preview && typeof preview === 'object' && 'ok' in preview && preview.ok === false) {
            return { ok: false, reason: preview.reason ?? 'error' };
          }
          const result = await storage.importReplacement(importId, snapshot, confirmation);
          if (!result.ok) {
            portabilityStatus.fail(result.detail ?? result.reason ?? 'canonical import failed');
            return { ok: false, reason: result.reason ?? 'error' };
          }
          // Explicit commit point: the control-store pointer flipped inside
          // importReplacement. Adopt the flip (reopen, guarantee a usable
          // book, retire other tabs) before serving reads or further
          // writes, so no dual v1/v2 writer can exist.
          await adoptActivationFlip('import', result.activeStorageId);
          return { ok: true, reason: '' };
        }).catch((error) => {
          portabilityStatus.fail(error instanceof Error ? error.message : String(error));
          return { ok: false, reason: 'error' };
        });
      },
      // P04-D5 correction: a validated legacy `{ expenses: [...] }` backup
      // restores through the canonical staged-migration commit point instead
      // of the frozen v1 writers. The controller keeps owning legacy
      // `validateBackupPayload` validation plus v1 settings normalization;
      // this port converts the normalized entries via `snapshotFromStores`
      // (the same extraction shape boot migration consumes) and commits via
      // `storage.migrate` plus the activation-pointer flip, so failure
      // leaves the active database untouched and success resyncs from the
      // new active storage exactly like a portable import.
      async restoreLegacyBackup(document, options = {}) {
        const blocked = requireWritable('portability.restoreLegacyBackup');
        if (blocked) return { ok: false, reason: 'blocked' };
        const migrationId = toText(options.migrationId);
        const confirmation = toText(options.confirmation);
        if (!migrationId) return { ok: false, reason: 'validation' };
        if (confirmation !== REPLACE_ACTIVE_CONFIRMATION) return { ok: false, reason: 'confirmation' };
        return withHeldCritical('import', async () => {
          const record = document && typeof document === 'object' && !Array.isArray(document) ? document : null;
          const settingsEntries = record && Array.isArray(record.settingsEntries) ? record.settingsEntries : null;
          const templates = record && Array.isArray(record.templates) ? record.templates : null;
          const expenses = record && Array.isArray(record.expenses) ? record.expenses : null;
          if (!settingsEntries || !templates || !expenses) return { ok: false, reason: 'validation' };
          let snapshot;
          try {
            snapshot = snapshotFromStores({ settings: settingsEntries, templates, expenses });
          } catch {
            return { ok: false, reason: 'validation' };
          }
          const result = await storage.migrate(migrationId, snapshot);
          if (!result.ok) {
            portabilityStatus.fail(result.detail ?? result.reason ?? 'canonical legacy restore failed');
            return { ok: false, reason: result.reason ?? 'error' };
          }
          // Explicit commit point, mirroring restoreSnapshot: the
          // control-store pointer flipped inside migrate. Adopt the flip
          // before serving reads so no dual v1/v2 writer can exist.
          await adoptActivationFlip('import', result.activeStorageId);
          return { ok: true, reason: '' };
        }).catch((error) => {
          portabilityStatus.fail(error instanceof Error ? error.message : String(error));
          return { ok: false, reason: 'error' };
        });
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
          // Legacy-compatible shape: a bare callback means "notify when
          // blocked". Without one, refuse loudly instead of a silent
          // no-op: a blocked reset must never look like success.
          if (notifyBlocked) {
            notifyBlocked();
            return;
          }
          portabilityStatus.fail(`P04-D writes blocked for 'portability.factoryReset': the authority is not writable.`);
          throw new Error(`P04-D writes blocked for 'portability.factoryReset': the authority is not writable.`);
        }
        const resetId = toText(asRecord.resetId);
        const confirmation = toText(asRecord.confirmation);
        // D3: lease-refreshed like import (see restoreSnapshot). The
        // adoption below reopens the emptied namespace, provisions a fresh
        // usable book, and retires other tabs, so the resetter keeps a
        // supported scope instead of a bookless one.
        await withHeldCritical('reset', async () => {
          const result = await storage.resetScope(resetId, confirmation, context.origin.scopeId);
          if (!result.ok) {
            portabilityStatus.fail(result.detail ?? result.reason ?? 'canonical reset failed');
            throw new Error(result.detail ?? 'canonical reset failed');
          }
          await adoptActivationFlip('reset', result.activeStorageId);
        });
      },
      clearLocalPreferences() {
        authorityPort.assertWritable('portability.clearLocalPreferences');
        const store = environment?.localStorage;
        if (!store || typeof store.length !== 'number' || typeof store.key !== 'function') return;
        // D4 correction: the persisted device id (`rushd_device_id`,
        // owned by production-boot as pure storage namespacing) is NOT a
        // UI preference and must survive clearing. Wiping it would orphan
        // the guest scope: export backups are device-bound,
        // and re-import rejects a mismatched device id.
        const doomed = [];
        for (let index = 0; index < (store.length ?? 0); index += 1) {
          const key = store.key.call(store, index);
          if (key && key !== 'rushd_device_id' && (key.startsWith('rushd_') || key.startsWith('microsave_') || key === 'onboardingState')) {
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
      resolveIntent(view, date) {
        const destinations = ['dashboard', 'statistics', 'vault', 'plans', 'settings'];
        const target = destinations.includes(view) ? view : null;
        if (!target) return null;
        const intent = { view: target };
        if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) intent.date = date;
        return intent;
      },
      listDestinations() {
        return ['dashboard', 'statistics', 'vault', 'plans', 'settings'];
      },
      persistIntent(intent) {
        // UI route/date chrome only; persists even while finance writes
        // are blocked so offline destination recovery keeps working.
        try {
          const record = intent && typeof intent === 'object' ? intent : {};
          const destinations = ['dashboard', 'statistics', 'vault', 'plans', 'settings'];
          if (!destinations.includes(record.view)) return;
          const payload = { view: record.view };
          if (typeof record.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
            payload.date = record.date;
          }
          writePreference(environment, P04D_NAV_INTENT_KEY, JSON.stringify(payload));
        } catch {
          /* intent persistence is best-effort chrome */
        }
      },
      restoreIntent() {
        try {
          const raw = readPreference(environment, P04D_NAV_INTENT_KEY, '');
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object') return null;
          const destinations = ['dashboard', 'statistics', 'vault', 'plans', 'settings'];
          if (!destinations.includes(parsed.view)) return null;
          const intent = { view: parsed.view };
          if (typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
            intent.date = parsed.date;
          }
          return intent;
        } catch {
          return null;
        }
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
        // D4: book settings project from committed canonical state. The
        // base allowance shows the migrated opening-cycle starting funds
        // (read-only truth); there is no command that rewrites it, and the
        // buffer below is an explicit reserve, never a budget.
        const book = currentBook();
        const projected = projectBookSettings(book, state.selectedDate);
        let allowance = 0;
        try {
          const openCycleId = projectOpenCycleId(book);
          if (openCycleId && book && Array.isArray(book.cycles)) {
            const versions = book.cycles.filter((cycle) => String(cycle.cycleId) === String(openCycleId));
            const version = versions.length > 0 ? versions[versions.length - 1] : null;
            if (version && version.startingFunds && typeof version.startingFunds.minorUnits === 'number') {
              allowance = minorUnitsToSarMajor(version.startingFunds.minorUnits);
            }
          }
        } catch {
          /* allowance stays at its empty-state default */
        }
        return {
          baseAllowance: allowance,
          theme: readPreference(environment, 'rushd_theme', 'dark') === 'light' ? 'light' : 'dark',
          motionLevel: readPreference(environment, 'rushd_motion', 'auto') || 'auto',
          language: readPreference(environment, 'rushd_lang', 'ar') || 'ar',
          calendarType: readPreference(environment, 'rushd_calendar', 'gregorian') || 'gregorian',
          activeTemplateProfileId: '',
          timeZone: projected?.timeZone ?? 'Asia/Riyadh',
          cycleAnchorKind: projected?.cycleAnchorKind ?? 'firstOfMonth',
          bufferAmount: projected?.bufferAmount ?? null,
          currency: projected?.currency ?? 'SAR',
          openCycleId: projectOpenCycleId(book),
        };
      },
      async saveBaseAllowance() {
        // D4: the allowance migrated into opening-cycle starting funds and
        // no canonical command rewrites it. The read-only figure above is
        // the truth; this write stays visibly blocked, never a v1 write.
        lifecycleStatus.fail(P04D_D4_ALLOWANCE_BLOCKED_REASON);
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
      hasUsableBook() {
        // D5: onboarding/settings must not claim completion while no
        // usable book exists. This reads the resolved book handle only —
        // no I/O, never finance truth beyond existence.
        return !!state.bookId;
      },
      getOnboardingState() {
        // D4: onboarding is a local setup flow with no canonical finance
        // fact; its status stays a validated local preference.
        try {
          const raw = readPreference(environment, P04D_ONBOARDING_STATE_KEY, '');
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object') return null;
          const status = typeof parsed.status === 'string' ? parsed.status : '';
          if (status !== 'skipped' && status !== 'completed') return null;
          return {
            status,
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
            source: typeof parsed.source === 'string' ? parsed.source : '',
          };
        } catch {
          return null;
        }
      },
      async persistOnboardingState(status, source = '') {
        authorityPort.assertWritable('lifecycle.persistOnboardingState');
        const next = {
          status: typeof status === 'string' ? status : '',
          updatedAt: new Date().toISOString(),
          source: typeof source === 'string' ? source : '',
        };
        writePreference(environment, P04D_ONBOARDING_STATE_KEY, JSON.stringify(next));
        return next;
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
      // D3: the migration section is lease-refreshed, so a large
      // migration keeps gating update activation across its commit point.
      const migrated = /** @type {MigrationResult} */ (await withHeldCritical('migration', () => storage.migrate(identity.value, options.snapshot)));
      if (!migrated.ok) {
        return failClosed(`canonical migration failed at ${migrated.phase}: ${migrated.detail}`);
      }
      state.migration = migrated;
      await reopenActive(migrated.activeStorageId);
      state.storageId = migrated.activeStorageId;
    } else {
      await reopenActive(selectedStorageId);
      state.migration = null;
    }
  } catch (error) {
    return failClosed(`canonical storage failed to open: ${error instanceof Error ? error.message : String(error)}`);
  }

  // D5 correction: a committed pointer with no guest book (an
  // interrupted pre-D5 reset, or an empty-but-valid import) must still
  // boot into a supported scope. The authority turns ready first so the
  // provisioning write below passes the same writability gate as any
  // other writer; provisioning then runs before reads serve, so the
  // first write in a fresh tab succeeds. Boot never fails on this step.
  setAuthority({ kind: 'canonicalReady', writable: true, storageId: state.storageId });
  try {
    if (state.gateway && !state.bookId) {
      await provisionFreshBookIfMissing('boot');
    }
  } catch (error) {
    lifecycleStatus.fail(error instanceof Error ? error.message : String(error));
  }

  // Bind canonical ports only after ready. Reads serve committed state;
  // writers flow through the gateway from here on.
  //
  // D4 boot rule: recording requires an open cycle covering the selected
  // date, and the domain holds a single open cycle. When the open cycle
  // is stale (fresh install whose migration only opened the fallback
  // month, or a new month since), boot advances it ONLY when that is
  // provably a no-op: the book holds no entries, obligations, or
  // allocations, so close + leaveIndependent + open-current (zero
  // starting funds, no allowance invented) moves nothing. A book WITH
  // facts keeps its open cycle and its explicit month-end choice: the
  // stale months stay truthfully per-date refused until the user settles
  // through the goals port. Boot never fails on this step.
  try {
    if (state.gateway && state.bookId) {
      await withHeldCritical('write', async () => {
        // findOpenCycle tie-breaks to the earliest open version, so scan
        // every version: today is covered when any open version's window
        // contains it.
        const coversToday = (candidate) => {
          const book = currentBook();
          if (!book || !Array.isArray(book.cycles)) return false;
          return book.cycles.some((cycle) => {
            if (effectiveVersionStatus(book, cycle) !== 'open') return false;
            return typeof cycle.startDate === 'string'
              && typeof cycle.endDateExclusive === 'string'
              && cycle.startDate <= candidate
              && candidate < cycle.endDateExclusive;
          });
        };
        if (coversToday(state.selectedDate)) return;
        const book = currentBook();
        const zeroFact = !!book
          && book.entries.length === 0
          && book.obligations.length === 0
          && book.allocationRecords.length === 0;
        if (!zeroFact) {
          lifecycleStatus.fail(
            'current cycle is not open: the open month is stale and holds facts, so month-end stays an explicit user decision.',
          );
          return;
        }
        const advanced = await advanceEmptyBookToMonth(state.selectedDate.slice(0, 7) + '-01');
        if (!advanced.ok) {
          lifecycleStatus.fail(`current cycle is not open: ${advanced.detail}.`);
        }
      });
    }
  } catch (error) {
    lifecycleStatus.fail(error instanceof Error ? error.message : String(error));
  }
  if (!state.bookId) {
    captureStatus.fail(P04D_D2_NO_BOOK_REASON);
  }

  return {
    ok: true,
    authority: authorityPort.getState(),
    featurePorts: frozenPorts,
    // Live binding: import/reset flip the activation pointer after this
    // object is returned, and observers must see the current namespace.
    get storageId() {
      return state.storageId;
    },
    migration: state.migration,
    coordination,
    // Live binding: the same-tab import/reset path rebases the epoch it
    // opened under after its own activation bump.
    get openedEpoch() {
      return openedEpoch;
    },
    reason: '',
    refresh: () => refreshCommitted(),
    close: () => closeHost(),
    onCommitted,
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
