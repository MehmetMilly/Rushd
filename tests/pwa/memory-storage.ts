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
      let document = (raw ?? {}) as { scopeId?: unknown; deviceId?: unknown; format?: unknown };
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
      let document = (raw ?? {}) as { scopeId?: unknown; deviceId?: unknown; format?: unknown };
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
      repoFor(stagingStorageId, true);
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
