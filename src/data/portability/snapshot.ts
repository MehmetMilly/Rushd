/**
 * Coherent snapshot export and staged import/reset against the accepted
 * durable repository. Guest mode constructs no network or account client.
 */

import { stableDigest } from '../../domain/contracts/canonical';
import type { OperationId } from '../../domain/contracts/identity';
import { makeBookId, makeOperationId } from '../../domain/contracts/identity';
import { openDurableGuestRepository } from '../v2/session';
import { asDurableTransaction, type DurableGuestRepository } from '../v2/repository';
import { StorageUnsupportedError } from '../v2/errors';
import { decodeLifecycleId } from '../migration/lifecycle-id';
import {
  ACTIVATION_COMMIT_POINT,
  DEFAULT_ACTIVE_STORAGE_ID,
  createIndexedDbControlStore,
  type ActivationPointer,
  type ControlStore,
} from '../migration/control-store';
import { MIGRATION_REASON, PORTABILITY_REASON } from '../migration/reasons';
import type { CommandContext } from '../../application/commands/context';
import {
  PORTABLE_FORMAT,
  PORTABLE_FORMAT_VERSION,
  REPLACE_ACTIVE_CONFIRMATION,
  RESET_SCOPE_CONFIRMATION,
  portableDocumentDigest,
  type PortableDocument,
} from './format';
import { parsePortableDocument, type PortablePreview } from './validate';
import type { DecodedCheckpoints, DecodedPortableSnapshot } from './decode';

export { REPLACE_ACTIVE_CONFIRMATION, RESET_SCOPE_CONFIRMATION, ACTIVATION_COMMIT_POINT };

export interface PortabilityRuntime {
  readonly boundScope: CommandContext['origin']['scopeId'];
  readonly boundDevice: CommandContext['origin']['deviceId'];
  readonly context: CommandContext;
  readonly workerUrl?: string;
  readonly sqliteAssetBase?: string;
  readonly control?: ControlStore;
  readonly signal?: AbortSignal;
  readonly indexedDB?: IDBFactory;
  readonly failAt?: 'before-activation' | 'during-activation' | 'after-activation' | 'during-restore' | 'after-staging';
  readonly simulateUnsupported?: boolean;
}

function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export async function exportActiveSnapshot(runtime: PortabilityRuntime, repository?: DurableGuestRepository): Promise<PortableDocument> {
  const control = runtime.control ?? createIndexedDbControlStore(runtime.indexedDB);
  const pointer = await control.getPointer();
  const opened = repository ?? await openDurableGuestRepository({
    boundScope: runtime.boundScope,
    boundDevice: runtime.boundDevice,
    workerUrl: runtime.workerUrl,
    sqliteAssetBase: runtime.sqliteAssetBase,
    storageId: pointer.activeStorageId || DEFAULT_ACTIVE_STORAGE_ID,
    simulateUnsupported: runtime.simulateUnsupported === true,
  });
  try {
    const snapshotCanonical = opened.snapshotBytes();
    const checkpointCanonical = opened.checkpointSnapshotBytes();
    return {
      format: PORTABLE_FORMAT,
      formatVersion: PORTABLE_FORMAT_VERSION,
      localSchemaVersion: 1,
      currency: 'SAR',
      exportedAtMs: runtime.context.clock.nowMs(),
      scope: {
        scopeId: opened.boundScope as string,
        deviceId: opened.boundDevice as string,
        storageId: opened.storageId ?? pointer.activeStorageId,
      },
      snapshotCanonical,
      checkpointCanonical,
      sourceFingerprint: pointer.sourceFingerprint,
      migrationId: pointer.migrationId,
      integrity: stableDigest(`${snapshotCanonical}\n${checkpointCanonical}`),
    };
  } finally {
    if (repository === undefined) await opened.close();
  }
}

async function restoreSnapshot(
  repository: DurableGuestRepository,
  snapshot: DecodedPortableSnapshot,
  checkpoints: DecodedCheckpoints,
): Promise<void> {
  await repository.runTransaction((transaction) => {
    const staged = asDurableTransaction(transaction);
    for (const book of snapshot.books) {
      staged.getBookState(book.book.id);
      for (let revision = 1; revision < book.revision; revision += 1) {
        staged.putBookState({ ...book, revision });
      }
      staged.putBookState(book);
    }
    const targetSequence = snapshot.enqueueSequence;
    for (let index = 0; index < targetSequence; index += 1) staged.nextEnqueueSequence();
    const outboxById = new Map(snapshot.outbox.map((envelope) => [envelope.operationId as string, envelope]));
    const operations = [...snapshot.operations].sort((left, right) => left.enqueueSequence - right.enqueueSequence);
    for (const record of operations) {
      staged.putOperation(record);
      const envelope = outboxById.get(record.operationId as string);
      if (envelope !== undefined) staged.putOutboxEntry(envelope);
    }
    for (const stream of checkpoints.streams) {
      staged.getStreamCheckpoint(stream.streamId);
      staged.putStreamCheckpoint(stream.streamId, {
        cursor: stream.cursor,
        batchDigest: stream.batchDigest,
        applied: new Map(stream.applied),
      });
    }
  });
  for (const delivery of snapshot.delivery) {
    if (delivery.version <= 0) continue;
    for (let version = 1; version <= delivery.version; version += 1) {
      await repository.runTransaction((transaction) => {
        const staged = asDurableTransaction(transaction);
        staged.getDeliveryState(delivery.operationId);
        staged.putDeliveryState({ ...delivery, version });
      });
    }
  }
}

export async function previewPortableImport(raw: unknown): Promise<PortablePreview | { ok: false; reason: string; detail: string }> {
  const parsed = parsePortableDocument(raw);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, detail: parsed.detail };
  return parsed.preview;
}

export async function importPortableReplacement(
  importId: string,
  raw: unknown,
  confirmation: string,
  runtime: PortabilityRuntime,
): Promise<
  | { ok: true; activeStorageId: string; preview: PortablePreview; activationCommitted: true; replayed: boolean }
  | { ok: false; reason: string; detail: string; activationCommitted: boolean; cancelled: boolean; activeStorageId: string }
> {
  const identity = decodeLifecycleId(importId, 'importId');
  if (!identity.ok) {
    return {
      ok: false,
      reason: PORTABILITY_REASON.invalidId,
      detail: identity.detail,
      activationCommitted: false,
      cancelled: false,
      activeStorageId: DEFAULT_ACTIVE_STORAGE_ID,
    };
  }
  const control = runtime.control ?? createIndexedDbControlStore(runtime.indexedDB);
  const pointer = await control.getPointer();
  const expectedGeneration = pointer.generation;
  const parsed = parsePortableDocument(raw);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, detail: parsed.detail, activationCommitted: false, cancelled: false, activeStorageId: pointer.activeStorageId };
  }
  if (parsed.document.scope.scopeId !== (runtime.boundScope as string)) {
    return {
      ok: false,
      reason: PORTABILITY_REASON.resetScopeMismatch,
      detail: 'portable scope does not match the bound repository scope',
      activationCommitted: false,
      cancelled: false,
      activeStorageId: pointer.activeStorageId,
    };
  }
  if (parsed.document.scope.deviceId !== (runtime.boundDevice as string)) {
    return {
      ok: false,
      reason: PORTABILITY_REASON.foreignRecord,
      detail: 'portable device does not match the bound repository device',
      activationCommitted: false,
      cancelled: false,
      activeStorageId: pointer.activeStorageId,
    };
  }
  if (confirmation !== REPLACE_ACTIVE_CONFIRMATION) {
    return {
      ok: false,
      reason: confirmation.length === 0 ? PORTABILITY_REASON.confirmationRequired : PORTABILITY_REASON.confirmationMismatch,
      detail: 'destructive replacement requires REPLACE-ACTIVE-DATABASE',
      activationCommitted: false,
      cancelled: false,
      activeStorageId: pointer.activeStorageId,
    };
  }
  if (pointer.activationCommitted && pointer.importId === importId) {
    if (pointer.importDocumentDigest !== parsed.documentDigest) {
      return {
        ok: false,
        reason: PORTABILITY_REASON.replayConflict,
        detail: 'same import id was reused with a different document digest',
        activationCommitted: true,
        cancelled: false,
        activeStorageId: pointer.activeStorageId,
      };
    }
    return {
      ok: true,
      activeStorageId: pointer.activeStorageId,
      preview: parsed.preview,
      activationCommitted: true,
      replayed: true,
    };
  }
  if (aborted(runtime.signal)) {
    return {
      ok: false,
      reason: PORTABILITY_REASON.cancelledBeforeCommit,
      detail: 'cancelled before import staging',
      activationCommitted: false,
      cancelled: true,
      activeStorageId: pointer.activeStorageId,
    };
  }
  const stagingStorageId = `imp-${importId}`;
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
    if (runtime.failAt === 'during-restore') staging.injectWriteFailure('putBookState', 1);
    await restoreSnapshot(staging, parsed.snapshot, parsed.checkpoints);
    const cancelledBeforeActivation = aborted(runtime.signal);
    if (runtime.failAt === 'before-activation' || runtime.failAt === 'after-staging' || cancelledBeforeActivation) {
      await staging.close().catch(() => undefined);
      return {
        ok: false,
        reason: PORTABILITY_REASON.cancelledBeforeCommit,
        detail: 'cancelled or failed immediately before activation',
        activationCommitted: false,
        cancelled: cancelledBeforeActivation,
        activeStorageId: pointer.activeStorageId,
      };
    }
    if (runtime.failAt === 'during-activation') throw new Error('injected import activation failure');
    const next: Omit<ActivationPointer, 'generation'> = {
      activeStorageId: stagingStorageId,
      schemaVersion: 1,
      migrationId: parsed.document.migrationId,
      importId,
      sourceFingerprint: parsed.document.sourceFingerprint,
      importDocumentDigest: parsed.documentDigest,
      committedAtMs: runtime.context.clock.nowMs(),
      activationCommitted: true,
    };
    const swapped = await control.compareAndSwapPointer(expectedGeneration, next);
    if (!swapped.ok) {
      await staging.close().catch(() => undefined);
      return {
        ok: false,
        reason: PORTABILITY_REASON.activationConflict,
        detail: 'activation pointer was committed by a concurrent writer',
        activationCommitted: false,
        cancelled: false,
        activeStorageId: pointer.activeStorageId,
      };
    }
    await staging.close().catch(() => undefined);
    return { ok: true, activeStorageId: stagingStorageId, preview: parsed.preview, activationCommitted: true, replayed: false };
  } catch (error) {
    await staging?.close().catch(() => undefined);
    if (error instanceof StorageUnsupportedError) {
      return {
        ok: false,
        reason: MIGRATION_REASON.unsupportedStorage,
        detail: error.message,
        activationCommitted: false,
        cancelled: false,
        activeStorageId: pointer.activeStorageId,
      };
    }
    return {
      ok: false,
      reason: PORTABILITY_REASON.corruptPayload,
      detail: error instanceof Error ? error.message : 'import failed',
      activationCommitted: false,
      cancelled: false,
      activeStorageId: pointer.activeStorageId,
    };
  }
}

export async function resetGuestScope(
  resetId: string,
  confirmation: string,
  expectedScopeId: string,
  runtime: PortabilityRuntime,
): Promise<
  | { ok: true; activeStorageId: string; activationCommitted: true }
  | { ok: false; reason: string; detail: string; activationCommitted: boolean; cancelled: boolean; activeStorageId: string }
> {
  const identity = decodeLifecycleId(resetId, 'resetId');
  if (!identity.ok) {
    return {
      ok: false,
      reason: PORTABILITY_REASON.invalidId,
      detail: identity.detail,
      activationCommitted: false,
      cancelled: false,
      activeStorageId: DEFAULT_ACTIVE_STORAGE_ID,
    };
  }
  const control = runtime.control ?? createIndexedDbControlStore(runtime.indexedDB);
  const pointer = await control.getPointer();
  const expectedGeneration = pointer.generation;
  if ((runtime.boundScope as string) !== expectedScopeId) {
    return {
      ok: false,
      reason: PORTABILITY_REASON.resetScopeMismatch,
      detail: 'reset refused because the bound scope does not match the requested scope',
      activationCommitted: false,
      cancelled: false,
      activeStorageId: pointer.activeStorageId,
    };
  }
  if (confirmation !== RESET_SCOPE_CONFIRMATION) {
    return {
      ok: false,
      reason: confirmation.length === 0 ? PORTABILITY_REASON.confirmationRequired : PORTABILITY_REASON.confirmationMismatch,
      detail: 'reset requires RESET-GUEST-SCOPE',
      activationCommitted: false,
      cancelled: false,
      activeStorageId: pointer.activeStorageId,
    };
  }
  if (aborted(runtime.signal)) {
    return {
      ok: false,
      reason: PORTABILITY_REASON.cancelledBeforeCommit,
      detail: 'cancelled before reset staging',
      activationCommitted: false,
      cancelled: true,
      activeStorageId: pointer.activeStorageId,
    };
  }
  const stagingStorageId = `rst-${resetId}`;
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
    await staging.close();
    staging = null;
    if (runtime.failAt === 'after-staging' || runtime.failAt === 'before-activation' || aborted(runtime.signal)) {
      return {
        ok: false,
        reason: PORTABILITY_REASON.cancelledBeforeCommit,
        detail: 'cancelled after reset staging and before activation',
        activationCommitted: false,
        cancelled: aborted(runtime.signal),
        activeStorageId: pointer.activeStorageId,
      };
    }
    if (runtime.failAt === 'during-activation') throw new Error('injected reset activation failure');
    const next: Omit<ActivationPointer, 'generation'> = {
      activeStorageId: stagingStorageId,
      schemaVersion: 1,
      migrationId: null,
      importId: null,
      sourceFingerprint: null,
      importDocumentDigest: null,
      committedAtMs: runtime.context.clock.nowMs(),
      activationCommitted: true,
    };
    const swapped = await control.compareAndSwapPointer(expectedGeneration, next);
    if (!swapped.ok) {
      return {
        ok: false,
        reason: PORTABILITY_REASON.activationConflict,
        detail: 'activation pointer was committed by a concurrent writer',
        activationCommitted: false,
        cancelled: false,
        activeStorageId: pointer.activeStorageId,
      };
    }
    return { ok: true, activeStorageId: stagingStorageId, activationCommitted: true };
  } catch (error) {
    await staging?.close().catch(() => undefined);
    if (error instanceof StorageUnsupportedError) {
      return {
        ok: false,
        reason: MIGRATION_REASON.unsupportedStorage,
        detail: error.message,
        activationCommitted: false,
        cancelled: false,
        activeStorageId: pointer.activeStorageId,
      };
    }
    return {
      ok: false,
      reason: PORTABILITY_REASON.corruptPayload,
      detail: error instanceof Error ? error.message : 'reset failed',
      activationCommitted: false,
      cancelled: false,
      activeStorageId: pointer.activeStorageId,
    };
  }
}

export function bookIdFromRaw(raw: string) {
  const made = makeBookId(raw);
  if (!made.ok) throw new Error(made.failure.detail);
  return made.value;
}

export function operationIdFromRaw(raw: string): OperationId {
  const made = makeOperationId(raw);
  if (!made.ok) throw new Error(made.failure.detail);
  return made.value;
}

export { portableDocumentDigest };
