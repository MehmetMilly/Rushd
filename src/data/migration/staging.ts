/**
 * Crash-safe staged migration onto the accepted durable guest repository.
 *
 * Staging writes go to a distinct storageId. The active guest database is
 * unchanged until the control-store activation pointer is written. That
 * pointer write is the commit point; cancellation afterwards cannot undo it.
 * Incomplete staging is retried by resetting the staging namespace and
 * replaying the same operation identities.
 */

import { describeCommandFailure, executeCommand, previewCommand } from '../../application/commands';
import type { CommandContext } from '../../application/commands/context';
import type { CommandReceipt } from '../../domain/contracts/commands';
import { makeBookId, makeOperationId, makeSettlementId } from '../../domain/contracts/identity';
import { openDurableGuestRepository } from '../v2/session';
import { StorageFailureError, StorageUnsupportedError } from '../v2/errors';
import type { DurableGuestRepository } from '../v2/repository';
import { extractLegacyIndexedDb, sourceFingerprintOf, type ExtractedLegacySnapshot } from './extract';
import { planLegacyMigration, type MigrationPlan, type PlannedCommand } from './mapping';
import { decodeLifecycleId } from './lifecycle-id';
import {
  ACTIVATION_COMMIT_POINT,
  DEFAULT_ACTIVE_STORAGE_ID,
  EMPTY_POINTER,
  createIndexedDbControlStore,
  type ActivationPointer,
  type ControlStore,
  type LifecyclePhase,
  type LifecycleRun,
} from './control-store';
import { MIGRATION_REASON, type MigrationReasonCode } from './reasons';

export { ACTIVATION_COMMIT_POINT };

export type MigrationFailAt =
  | 'before-staging'
  | 'during-extraction'
  | 'during-conversion'
  | 'during-staging-write'
  | 'immediately-before-activation'
  | 'during-activation'
  | 'immediately-after-activation'
  | 'during-cleanup';

export interface MigrationRuntime {
  readonly boundScope: CommandContext['origin']['scopeId'];
  readonly boundDevice: CommandContext['origin']['deviceId'];
  readonly context: CommandContext;
  readonly workerUrl?: string;
  readonly sqliteAssetBase?: string;
  readonly control?: ControlStore;
  readonly signal?: AbortSignal;
  readonly failAt?: MigrationFailAt;
  readonly simulateUnsupported?: boolean;
  readonly snapshot?: ExtractedLegacySnapshot;
  readonly indexedDB?: IDBFactory;
}

export interface MigrationSuccess {
  readonly ok: true;
  readonly migrationId: string;
  readonly activeStorageId: string;
  readonly priorActiveStorageId: string;
  readonly activationCommitted: boolean;
  readonly replayed: boolean;
  readonly cancelled: false;
  readonly plan: MigrationPlan;
  readonly sourceFingerprint: string;
  readonly commitPoint: typeof ACTIVATION_COMMIT_POINT;
  readonly receipts: readonly CommandReceipt[];
}

export interface MigrationFailure {
  readonly ok: false;
  readonly migrationId: string;
  readonly phase: LifecyclePhase;
  readonly reason: MigrationReasonCode;
  readonly detail: string;
  readonly activationCommitted: boolean;
  readonly cancelled: boolean;
  readonly activeStorageId: string;
}

export type MigrationResult = MigrationSuccess | MigrationFailure;

function failure(
  migrationId: string,
  phase: LifecyclePhase,
  reason: MigrationReasonCode,
  detail: string,
  activationCommitted: boolean,
  activeStorageId: string,
  cancelled = false,
): MigrationFailure {
  return { ok: false, migrationId, phase, reason, detail, activationCommitted, cancelled, activeStorageId };
}

function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function replaceSettlementId(command: PlannedCommand, settlementId: string): Promise<PlannedCommand> {
  if (command.command.kind !== 'disposeCycleRemainder') return command;
  const made = makeSettlementId(settlementId);
  if (!made.ok) return command;
  return {
    ...command,
    command: { ...command.command, settlementId: made.value },
  };
}

export async function commitPlannedCommands(
  repository: DurableGuestRepository,
  plan: MigrationPlan,
  context: CommandContext,
  signal: AbortSignal | undefined,
  onWrite?: () => void,
): Promise<{ readonly ok: true; readonly receipts: CommandReceipt[] } | { readonly ok: false; readonly detail: string }> {
  const receipts: CommandReceipt[] = [];
  let lastSettlementId: string | null = null;
  for (const planned of plan.commands) {
    if (aborted(signal)) return { ok: false, detail: 'cancelled before staging commit' };
    onWrite?.();
    let next = planned;
    if (planned.command.kind === 'disposeCycleRemainder' && lastSettlementId !== null) {
      next = await replaceSettlementId(planned, lastSettlementId);
    }
    const op = makeOperationId(next.operationId);
    if (!op.ok) return { ok: false, detail: `invalid operation id ${next.operationId}` };
    const preview = previewCommand(repository, next.command, context);
    if (!preview.ok) return { ok: false, detail: describeCommandFailure(preview.failure) };
    try {
      const executed = await executeCommand(
        repository,
        next.command,
        {
          operationId: op.value,
          expectedRevision: preview.preview.expectedRevision,
          previewDigest: preview.preview.previewDigest,
        },
        context,
      );
      if (!executed.ok) return { ok: false, detail: describeCommandFailure(executed.failure) };
      receipts.push(executed.receipt);
      const closed = executed.receipt.effects.find((effect) => effect.kind === 'cycleClosed');
      if (closed !== undefined && 'settlementId' in closed) {
        lastSettlementId = String(closed.settlementId);
      }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'staging write failed' };
    }
  }
  return { ok: true, receipts };
}

export async function runLegacyMigration(migrationId: string, runtime: MigrationRuntime): Promise<MigrationResult> {
  const identity = decodeLifecycleId(migrationId, 'migrationId');
  if (!identity.ok) {
    return failure(
      typeof migrationId === 'string' ? migrationId : '',
      'failed',
      MIGRATION_REASON.invalidId,
      identity.detail,
      false,
      DEFAULT_ACTIVE_STORAGE_ID,
    );
  }
  const control = runtime.control ?? createIndexedDbControlStore(runtime.indexedDB);
  const pointer = await control.getPointer();
  const expectedGeneration = pointer.generation;
  const existing = await control.getRun(identity.value);

  if (aborted(runtime.signal)) {
    return failure(migrationId, 'cancelled', MIGRATION_REASON.cancelledBeforeCommit, 'cancelled before staging', false, pointer.activeStorageId, true);
  }

  const extractedEarly = runtime.snapshot !== undefined
    ? { ok: true as const, snapshot: runtime.snapshot }
    : await extractLegacyIndexedDb(runtime.indexedDB ?? indexedDB);
  if (!extractedEarly.ok) {
    return failure(migrationId, 'failed', extractedEarly.reason, extractedEarly.detail, false, pointer.activeStorageId);
  }
  const inputDigest = sourceFingerprintOf(extractedEarly.snapshot);

  if (pointer.activationCommitted && pointer.migrationId === migrationId) {
    if (pointer.sourceFingerprint !== inputDigest) {
      return failure(migrationId, 'failed', MIGRATION_REASON.replayConflict, 'same migration id was reused with a different source digest', true, pointer.activeStorageId);
    }
    return {
      ok: true,
      migrationId,
      activeStorageId: pointer.activeStorageId,
      priorActiveStorageId: existing?.priorActiveStorageId ?? pointer.activeStorageId,
      activationCommitted: true,
      replayed: true,
      cancelled: false,
      plan: planLegacyMigration(extractedEarly.snapshot),
      sourceFingerprint: inputDigest,
      commitPoint: ACTIVATION_COMMIT_POINT,
      receipts: [],
    };
  }

  if (pointer.activationCommitted && pointer.migrationId !== null && pointer.migrationId !== migrationId && pointer.sourceFingerprint !== null) {
    return failure(migrationId, 'failed', MIGRATION_REASON.conflictingTarget, 'active database already belongs to a different migration identity', true, pointer.activeStorageId);
  }

  const stagingStorageId = `mig-${migrationId}`;
  let run: LifecycleRun = existing ?? {
    id: migrationId,
    kind: 'migration',
    phase: 'idle',
    stagingStorageId,
    priorActiveStorageId: pointer.activeStorageId || DEFAULT_ACTIVE_STORAGE_ID,
    sourceFingerprint: null,
    importDocumentDigest: null,
    activationCommitted: false,
    cancelRequested: false,
    lastReason: null,
    lastDetail: null,
    reviewCount: 0,
  };

  const persist = async (next: LifecycleRun) => {
    run = next;
    await control.putRun(next);
  };

  let stagingRepo: DurableGuestRepository | null = null;
  try {
    if (runtime.failAt === 'during-extraction') throw new Error('injected extraction failure');
    await persist({ ...run, phase: 'extracting' });
    const extracted = extractedEarly;
    const fingerprint = inputDigest;
    if (run.sourceFingerprint !== null && run.sourceFingerprint !== fingerprint) {
      await persist({ ...run, phase: 'failed', lastReason: MIGRATION_REASON.conflictingSource, lastDetail: 'source fingerprint changed since the interrupted run' });
      return failure(migrationId, 'failed', MIGRATION_REASON.conflictingSource, 'source fingerprint changed since the interrupted run', false, pointer.activeStorageId);
    }
    if (pointer.sourceFingerprint !== null && pointer.activationCommitted && pointer.sourceFingerprint !== fingerprint && pointer.migrationId !== migrationId) {
      return failure(migrationId, 'failed', MIGRATION_REASON.conflictingSource, 'active source identity does not match this migration', true, pointer.activeStorageId);
    }

    if (runtime.failAt === 'during-conversion') throw new Error('injected conversion failure');
    await persist({ ...run, phase: 'converting', sourceFingerprint: fingerprint });
    const plan = planLegacyMigration(extracted.snapshot);
    await persist({ ...run, reviewCount: plan.review.length, sourceFingerprint: fingerprint });

    if (aborted(runtime.signal)) {
      await persist({ ...run, phase: 'cancelled', cancelRequested: true, lastReason: MIGRATION_REASON.cancelledBeforeCommit });
      return failure(migrationId, 'cancelled', MIGRATION_REASON.cancelledBeforeCommit, 'cancelled before staging', false, pointer.activeStorageId, true);
    }
    if (runtime.failAt === 'before-staging') throw new Error('injected failure before staging');

    await persist({ ...run, phase: 'staging' });
    let staging: DurableGuestRepository | null = null;
    try {
      staging = await openDurableGuestRepository({
        boundScope: runtime.boundScope,
        boundDevice: runtime.boundDevice,
        workerUrl: runtime.workerUrl,
        sqliteAssetBase: runtime.sqliteAssetBase,
        storageId: stagingStorageId,
        reset: true,
        simulateUnsupported: runtime.simulateUnsupported === true,
      });
      stagingRepo = staging;
    } catch (error) {
      if (error instanceof StorageUnsupportedError) {
        const reason = error.reason === 'private-or-quota' ? MIGRATION_REASON.quotaOrPrivate : MIGRATION_REASON.unsupportedStorage;
        await persist({ ...run, phase: 'failed', lastReason: reason, lastDetail: error.message });
        return failure(migrationId, 'failed', reason, error.message, false, pointer.activeStorageId);
      }
      throw error;
    }

    if (runtime.failAt === 'during-staging-write') {
      staging.injectWriteFailure('putBookState', 1);
    }

    const committed = await commitPlannedCommands(staging, plan, runtime.context, runtime.signal);
    if (!committed.ok) {
      const cancelled = aborted(runtime.signal);
      const reason = cancelled ? MIGRATION_REASON.cancelledBeforeCommit : MIGRATION_REASON.stagingWriteFailure;
      await persist({ ...run, phase: cancelled ? 'cancelled' : 'failed', cancelRequested: cancelled, lastReason: reason, lastDetail: committed.detail });
      await staging.close().catch(() => undefined);
      return failure(migrationId, cancelled ? 'cancelled' : 'failed', reason, committed.detail, false, pointer.activeStorageId, cancelled);
    }

    await persist({ ...run, phase: 'validating' });
    const bookId = makeBookId(plan.bookId);
    if (!bookId.ok) {
      await persist({ ...run, phase: 'failed', lastReason: MIGRATION_REASON.invalidId, lastDetail: bookId.failure.detail });
      await staging.close().catch(() => undefined);
      return failure(migrationId, 'failed', MIGRATION_REASON.invalidId, bookId.failure.detail, false, pointer.activeStorageId);
    }
    const book = staging.getBookState(bookId.value);
    if (book === null) {
      await persist({ ...run, phase: 'failed', lastReason: MIGRATION_REASON.corruptStaging, lastDetail: 'staged book is missing' });
      await staging.close().catch(() => undefined);
      return failure(migrationId, 'failed', MIGRATION_REASON.corruptStaging, 'staged book is missing', false, pointer.activeStorageId);
    }
    if (book.book.currency !== 'SAR') {
      await persist({ ...run, phase: 'failed', lastReason: MIGRATION_REASON.unsupportedCurrency, lastDetail: 'staged book is not SAR' });
      await staging.close().catch(() => undefined);
      return failure(migrationId, 'failed', MIGRATION_REASON.unsupportedCurrency, 'staged book is not SAR', false, pointer.activeStorageId);
    }

    if (runtime.failAt === 'immediately-before-activation') {
      await staging.close().catch(() => undefined);
      throw new Error('injected failure immediately before activation');
    }
    if (aborted(runtime.signal)) {
      await persist({ ...run, phase: 'cancelled', cancelRequested: true, lastReason: MIGRATION_REASON.cancelledBeforeCommit });
      await staging.close().catch(() => undefined);
      return failure(migrationId, 'cancelled', MIGRATION_REASON.cancelledBeforeCommit, 'cancelled immediately before activation', false, pointer.activeStorageId, true);
    }

    await persist({ ...run, phase: 'activating' });
    if (runtime.failAt === 'during-activation') {
      await staging.close().catch(() => undefined);
      throw new Error('injected activation failure');
    }
    const nextPointer: Omit<ActivationPointer, 'generation'> = {
      activeStorageId: stagingStorageId,
      schemaVersion: 1,
      migrationId,
      importId: null,
      sourceFingerprint: fingerprint,
      importDocumentDigest: null,
      committedAtMs: runtime.context.clock.nowMs(),
      activationCommitted: true,
    };
    const swapped = await control.compareAndSwapPointer(expectedGeneration, nextPointer);
    if (!swapped.ok) {
      await persist({ ...run, phase: 'failed', lastReason: MIGRATION_REASON.activationConflict, lastDetail: 'activation pointer was committed by a concurrent writer' });
      await staging.close().catch(() => undefined);
      return failure(migrationId, 'failed', MIGRATION_REASON.activationConflict, 'activation pointer was committed by a concurrent writer', false, pointer.activeStorageId);
    }
    await persist({ ...run, phase: 'activated', activationCommitted: true });
    await staging.close().catch(() => undefined);

    if (runtime.failAt === 'immediately-after-activation') throw new Error('injected failure immediately after activation');

    if (runtime.failAt === 'during-cleanup') throw new Error('injected cleanup failure');
    if (run.priorActiveStorageId !== stagingStorageId) {
      try {
        const prior = await openDurableGuestRepository({
          boundScope: runtime.boundScope,
          boundDevice: runtime.boundDevice,
          workerUrl: runtime.workerUrl,
          sqliteAssetBase: runtime.sqliteAssetBase,
          storageId: run.priorActiveStorageId,
          reset: true,
        });
        await prior.close();
      } catch {
        /* leftover prior namespace is not visible once the pointer has flipped */
      }
    }

    return {
      ok: true,
      migrationId,
      activeStorageId: stagingStorageId,
      priorActiveStorageId: run.priorActiveStorageId,
      activationCommitted: true,
      replayed: false,
      cancelled: false,
      plan,
      sourceFingerprint: fingerprint,
      commitPoint: ACTIVATION_COMMIT_POINT,
      receipts: committed.receipts,
    };
  } catch (error) {
    await stagingRepo?.close().catch(() => undefined);
    const detail = error instanceof Error ? error.message : 'migration failed';
    const reason = detail.includes('extraction')
      ? MIGRATION_REASON.extractionFailure
      : detail.includes('conversion')
        ? MIGRATION_REASON.conversionFailure
        : detail.includes('activation')
          ? MIGRATION_REASON.activationFailure
          : detail.includes('cleanup')
            ? MIGRATION_REASON.cleanupFailure
            : detail.includes('before staging')
              ? MIGRATION_REASON.stagingWriteFailure
              : error instanceof StorageFailureError
                ? MIGRATION_REASON.stagingWriteFailure
                : MIGRATION_REASON.stagingWriteFailure;
    const committed = run.activationCommitted || (await control.getPointer()).activationCommitted;
    if (detail.includes('cleanup') || detail.includes('immediately after activation')) {
      const active = (await control.getPointer()).activeStorageId;
      return {
        ok: true,
        migrationId,
        activeStorageId: active,
        priorActiveStorageId: run.priorActiveStorageId,
        activationCommitted: true,
        replayed: false,
        cancelled: false,
        plan: planLegacyMigration(runtime.snapshot ?? {
          database: 'MicroSaveOS_DB',
          databaseVersion: 1,
          settings: [],
          templates: [],
          expenses: [],
          sourcePresent: false,
        }),
        sourceFingerprint: run.sourceFingerprint ?? '',
        commitPoint: ACTIVATION_COMMIT_POINT,
        receipts: [],
      };
    }
    await persist({ ...run, phase: committed ? 'activated' : 'failed', lastReason: reason, lastDetail: detail }).catch(() => undefined);
    return failure(migrationId, committed ? 'activated' : 'failed', reason, detail, committed, (await control.getPointer()).activeStorageId);
  }
}

export function openActiveGuestRepository(runtime: Omit<MigrationRuntime, 'snapshot' | 'failAt'> & { readonly reset?: boolean; readonly storageId?: string }) {
  return (async () => {
    const control = runtime.control ?? createIndexedDbControlStore(runtime.indexedDB);
    const pointer = await control.getPointer();
    const storageId = runtime.storageId ?? pointer.activeStorageId ?? DEFAULT_ACTIVE_STORAGE_ID;
    return openDurableGuestRepository({
      boundScope: runtime.boundScope,
      boundDevice: runtime.boundDevice,
      workerUrl: runtime.workerUrl,
      sqliteAssetBase: runtime.sqliteAssetBase,
      storageId,
      reset: runtime.reset === true,
      simulateUnsupported: runtime.simulateUnsupported === true,
    });
  })();
}

export { EMPTY_POINTER, DEFAULT_ACTIVE_STORAGE_ID };
