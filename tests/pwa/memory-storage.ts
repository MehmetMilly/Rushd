/**
 * In-memory storage adapter for P04-D2 host unit tests.
 *
 * Implements the `CanonicalStorageAdapter` surface over the P03
 * `InMemoryFinanceRepository` plus the real P04-C memory control store, so
 * host authority selection, migration commit points, port binding, tab
 * coordination, and failure closure are exercised without a browser. The
 * durable OPFS path is proven separately by the Playwright browser harness
 * (`tests/pwa/p04-d2-browser.mjs`); this adapter never claims durability.
 *
 * Migration uses the real `planLegacyMigration` + `commitPlannedCommands`
 * composition, so planned-command fidelity (not just the host shell) is
 * under test. Import/reset implement the P04-C commit-point discipline
 * (explicit confirmation, compare-and-swap pointer flip, reopen before
 * serving reads) against isolated namespaces.
 */

import { createMemoryControlStore, type ControlStore } from '../../src/data/migration/control-store';
import { ACTIVATION_COMMIT_POINT, commitPlannedCommands } from '../../src/data/migration/staging';
import { planLegacyMigration } from '../../src/data/migration/mapping';
import { sourceFingerprintOf, type ExtractedLegacySnapshot } from '../../src/data/migration/extract';
import type { CommandContext } from '../../src/application/commands/context';
import { InMemoryFinanceRepository } from '../domain/support/in-memory-repository';

export interface MemoryStorageOptions {
  readonly context: CommandContext;
  readonly control?: ControlStore;
}

/**
 * Hydrate a staging namespace with the committed payload carried by an
 * exported memory document. Returns true only when every book, journal
 * entry, outbox intent, delivery record, and the enqueue counter was
 * restored and the lookup indexes rebuilt, so row identity (not just the
 * activation pointer) survives the import commit point. Test-adapter-only:
 * it reaches the repository's internal committed store, which has no
 * public restore path by design.
 */
function restoreSnapshotBytes(staging: InMemoryFinanceRepository, snapshotBytes: unknown): boolean {
  if (typeof snapshotBytes !== 'string' || snapshotBytes.length === 0) return false;
  let parsed: {
    books?: unknown;
    operations?: unknown;
    outbox?: unknown;
    delivery?: unknown;
    enqueueSequence?: unknown;
  };
  try {
    parsed = JSON.parse(snapshotBytes);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.books)) return false;
  const store = (staging as unknown as {
    store?: {
      books: Map<string, unknown>;
      operations: Map<string, unknown>;
      outbox: unknown[];
      delivery: Map<string, unknown>;
      enqueueSequence: number;
      entryIndex: Map<string, unknown>;
      obligationIndex: Map<string, unknown>;
      goalIndex: Map<string, unknown>;
      observationIndex: Map<string, unknown>;
      planIndex: Map<string, unknown>;
      occurrenceIndex: Map<string, unknown>;
      settlementIndex: Map<string, unknown>;
    };
  }).store;
  if (!store || !(store.books instanceof Map) || !(store.operations instanceof Map)) return false;
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const books = new Map<string, unknown>();
  for (const state of parsed.books as Array<Record<string, unknown>>) {
    const book = state?.['book'] as Record<string, unknown> | undefined;
    const id = typeof book?.['id'] === 'string' ? (book['id'] as string) : null;
    if (id === null) return false;
    books.set(id, clone(state));
  }
  const operations = new Map<string, unknown>();
  if (parsed.operations !== undefined) {
    if (!Array.isArray(parsed.operations)) return false;
    for (const record of parsed.operations as Array<Record<string, unknown>>) {
      const id = typeof record?.['operationId'] === 'string' ? (record['operationId'] as string) : null;
      if (id === null) return false;
      operations.set(id, clone(record));
    }
  }
  if (parsed.outbox !== undefined && !Array.isArray(parsed.outbox)) return false;
  const delivery = new Map<string, unknown>();
  if (parsed.delivery !== undefined) {
    if (!Array.isArray(parsed.delivery)) return false;
    for (const state of parsed.delivery as Array<Record<string, unknown>>) {
      const id = typeof state?.['operationId'] === 'string' ? (state['operationId'] as string) : null;
      if (id === null) return false;
      delivery.set(id, clone(state));
    }
  }
  if (parsed.enqueueSequence !== undefined && (typeof parsed.enqueueSequence !== 'number' || !Number.isSafeInteger(parsed.enqueueSequence) || parsed.enqueueSequence < 0)) {
    return false;
  }
  store.books = books;
  store.operations = operations;
  store.outbox = clone(parsed.outbox ?? []);
  store.delivery = delivery;
  store.enqueueSequence = (parsed.enqueueSequence as number) ?? 0;
  const entryIndex = new Map<string, unknown>();
  const obligationIndex = new Map<string, unknown>();
  const goalIndex = new Map<string, unknown>();
  const observationIndex = new Map<string, unknown>();
  const planIndex = new Map<string, unknown>();
  const occurrenceIndex = new Map<string, unknown>();
  const settlementIndex = new Map<string, unknown>();
  for (const state of books.values() as IterableIterator<Record<string, unknown>>) {
    const bookId = (state['book'] as Record<string, unknown>)['id'] as string;
    for (const entry of (state['entries'] as Array<Record<string, unknown>>) ?? []) {
      entryIndex.set(entry['entryId'] as string, { bookId, entryId: entry['entryId'], kind: entry['kind'] });
    }
    for (const obligation of (state['obligations'] as Array<Record<string, unknown>>) ?? []) {
      obligationIndex.set(obligation['obligationId'] as string, { bookId, obligationId: obligation['obligationId'] });
    }
    for (const goal of (state['goals'] as Array<Record<string, unknown>>) ?? []) {
      goalIndex.set(goal['goalId'] as string, { bookId, goalId: goal['goalId'] });
    }
    for (const observation of (state['observations'] as Array<Record<string, unknown>>) ?? []) {
      observationIndex.set(observation['observationId'] as string, { bookId, observationId: observation['observationId'] });
    }
    for (const plan of (state['plans'] as Array<Record<string, unknown>>) ?? []) {
      planIndex.set(plan['planId'] as string, { bookId, planId: plan['planId'] });
    }
    for (const occurrence of (state['planOccurrences'] as Array<Record<string, unknown>>) ?? []) {
      occurrenceIndex.set(occurrence['occurrenceId'] as string, { bookId, occurrenceId: occurrence['occurrenceId'] });
    }
    for (const settlement of (state['settlements'] as Array<Record<string, unknown>>) ?? []) {
      settlementIndex.set(settlement['settlementId'] as string, { bookId, settlementId: settlement['settlementId'] });
    }
  }
  store.entryIndex = entryIndex;
  store.obligationIndex = obligationIndex;
  store.goalIndex = goalIndex;
  store.observationIndex = observationIndex;
  store.planIndex = planIndex;
  store.occurrenceIndex = occurrenceIndex;
  store.settlementIndex = settlementIndex;
  return true;
}

export function createMemoryStorage(options: MemoryStorageOptions) {
  const control = options.control ?? createMemoryControlStore();
  const namespaces = new Map<string, InMemoryFinanceRepository>();

  function repoFor(storageId: string, reset: boolean): InMemoryFinanceRepository {
    const existing = namespaces.get(storageId);
    if (existing && !reset) return existing;
    const next = new InMemoryFinanceRepository({
      boundScope: options.context.origin.scopeId,
      boundDevice: options.context.origin.deviceId,
    });
    namespaces.set(storageId, next);
    return next;
  }

  return {
    control,
    /** Inspect a namespace without disturbing the host (dual-writer assertions). */
    inspect(storageId: string): InMemoryFinanceRepository | null {
      return namespaces.get(storageId) ?? null;
    },
    async openActive(storageId: string, openOptions: { reset?: boolean } = {}) {
      return repoFor(storageId, openOptions.reset === true);
    },
    async migrate(migrationId: string, snapshot: ExtractedLegacySnapshot) {
      const pointer = await control.getPointer();
      const plan = planLegacyMigration(snapshot);
      const stagingStorageId = `mig-${migrationId}`;
      const staging = repoFor(stagingStorageId, true);
      const committed = await commitPlannedCommands(
        staging as never,
        plan,
        options.context,
        undefined,
      );
      if (!committed.ok) {
        return {
          ok: false as const,
          migrationId,
          phase: 'failed' as const,
          reason: 'staging-write-failure',
          detail: committed.detail,
          activationCommitted: false,
          cancelled: false,
          activeStorageId: pointer.activeStorageId,
        };
      }
      const book = staging.getBookState(plan.bookId as never);
      if (book === null) {
        return {
          ok: false as const,
          migrationId,
          phase: 'failed' as const,
          reason: 'corrupt-staging',
          detail: 'staged book is missing',
          activationCommitted: false,
          cancelled: false,
          activeStorageId: pointer.activeStorageId,
        };
      }
      const swapped = await control.compareAndSwapPointer(pointer.generation, {
        activeStorageId: stagingStorageId,
        schemaVersion: 1,
        migrationId,
        importId: null,
        sourceFingerprint: sourceFingerprintOf(snapshot),
        importDocumentDigest: null,
        committedAtMs: options.context.clock.nowMs(),
        activationCommitted: true,
      });
      if (!swapped.ok) {
        return {
          ok: false as const,
          migrationId,
          phase: 'failed' as const,
          reason: 'activation-conflict',
          detail: 'activation pointer was committed by a concurrent writer',
          activationCommitted: false,
          cancelled: false,
          activeStorageId: pointer.activeStorageId,
        };
      }
      return {
        ok: true as const,
        migrationId,
        activeStorageId: stagingStorageId,
        priorActiveStorageId: pointer.activeStorageId,
        activationCommitted: true as const,
        replayed: false as const,
        cancelled: false as const,
        plan,
        sourceFingerprint: sourceFingerprintOf(snapshot),
        commitPoint: ACTIVATION_COMMIT_POINT,
        receipts: committed.receipts,
      };
    },
    async exportSnapshot(repository: unknown) {
      const repo = repository as InMemoryFinanceRepository;
      return {
        format: 'rushd.memory.v1',
        scopeId: options.context.origin.scopeId as string,
        deviceId: options.context.origin.deviceId as string,
        snapshotBytes: repo.snapshotBytes(),
      };
    },
    async previewImport(raw: unknown) {
      let document = (raw ?? {}) as { scopeId?: unknown; deviceId?: unknown; format?: unknown; snapshotBytes?: unknown };
      if (typeof raw === 'string') {
        try {
          document = JSON.parse(raw) as typeof document;
        } catch {
          return { ok: false as const, reason: 'unparseable-document' };
        }
      }
      if (document.format !== 'rushd.memory.v1') {
        return { ok: false as const, reason: 'unsupported-format' };
      }
      if (document.scopeId !== (options.context.origin.scopeId as string)) {
        return { ok: false as const, reason: 'scope-mismatch' };
      }
      if (document.deviceId !== (options.context.origin.deviceId as string)) {
        return { ok: false as const, reason: 'foreign-record' };
      }
      // D3 fix: a document without payload bytes cannot restore row
      // identity, so it is refused here instead of importing as empty.
      if (typeof document.snapshotBytes !== 'string' || document.snapshotBytes.length === 0) {
        return { ok: false as const, reason: 'corrupt-document' };
      }
      return { ok: true as const };
    },
    async importReplacement(importId: string, raw: unknown, confirmation: string) {
      const pointer = await control.getPointer();
      const fail = (reason: string, detail: string) => ({
        ok: false as const,
        reason,
        detail,
        activationCommitted: false as const,
        cancelled: false as const,
        activeStorageId: pointer.activeStorageId,
      });
      let document = (raw ?? {}) as { scopeId?: unknown; deviceId?: unknown; format?: unknown; snapshotBytes?: unknown };
      if (typeof raw === 'string') {
        try {
          document = JSON.parse(raw) as typeof document;
        } catch {
          return fail('unparseable-document', 'portable document is not valid JSON');
        }
      }
      if (document.scopeId !== (options.context.origin.scopeId as string)) {
        return fail('scope-mismatch', 'portable scope does not match the bound repository scope');
      }
      if (document.deviceId !== (options.context.origin.deviceId as string)) {
        return fail('foreign-record', 'portable device does not match the bound repository device');
      }
      if (confirmation !== 'REPLACE-ACTIVE-DATABASE') {
        return fail('confirmation-required', 'destructive replacement requires REPLACE-ACTIVE-DATABASE');
      }
      if (pointer.activationCommitted && pointer.importId === importId) {
        return {
          ok: true as const,
          activeStorageId: pointer.activeStorageId,
          activationCommitted: true as const,
          replayed: true as const,
        };
      }
      const stagingStorageId = `imp-${importId}`;
      // D3 fix: copy the exported payload bytes into the staging namespace
      // before the pointer flip, so row identity (not just the pointer)
      // survives the import commit point. A document without restorable
      // bytes fails closed instead of activating an empty database.
      const staging = repoFor(stagingStorageId, true);
      if (!restoreSnapshotBytes(staging, document.snapshotBytes)) {
        return fail('corrupt-document', 'portable document carries no restorable snapshot payload');
      }
      const swapped = await control.compareAndSwapPointer(pointer.generation, {
        activeStorageId: stagingStorageId,
        schemaVersion: 1,
        migrationId: null,
        importId,
        sourceFingerprint: null,
        importDocumentDigest: 'memory-doc',
        committedAtMs: options.context.clock.nowMs(),
        activationCommitted: true,
      });
      if (!swapped.ok) {
        return fail('activation-conflict', 'activation pointer was committed by a concurrent writer');
      }
      return {
        ok: true as const,
        activeStorageId: stagingStorageId,
        activationCommitted: true as const,
        replayed: false as const,
      };
    },
    async resetScope(resetId: string, confirmation: string, scopeId: string) {
      const pointer = await control.getPointer();
      const fail = (reason: string, detail: string) => ({
        ok: false as const,
        reason,
        detail,
        activationCommitted: false as const,
        cancelled: false as const,
        activeStorageId: pointer.activeStorageId,
      });
      if (scopeId !== (options.context.origin.scopeId as string)) {
        return fail('scope-mismatch', 'reset refused because the bound scope does not match');
      }
      if (confirmation !== 'RESET-GUEST-SCOPE') {
        return fail('confirmation-required', 'reset requires RESET-GUEST-SCOPE');
      }
      if (!resetId) return fail('invalid-id', 'resetId must not be empty');
      const stagingStorageId = `rst-${resetId}`;
      repoFor(stagingStorageId, true);
      const swapped = await control.compareAndSwapPointer(pointer.generation, {
        activeStorageId: stagingStorageId,
        schemaVersion: 1,
        migrationId: null,
        importId: null,
        sourceFingerprint: null,
        importDocumentDigest: null,
        committedAtMs: options.context.clock.nowMs(),
        activationCommitted: true,
      });
      if (!swapped.ok) {
        return fail('activation-conflict', 'activation pointer was committed by a concurrent writer');
      }
      return {
        ok: true as const,
        activeStorageId: stagingStorageId,
        activationCommitted: true as const,
      };
    },
  };
}

export type MemoryStorage = ReturnType<typeof createMemoryStorage>;
