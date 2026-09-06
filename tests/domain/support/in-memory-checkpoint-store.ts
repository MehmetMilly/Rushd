/**
 * In-memory pull-checkpoint store for the P03 sync contract proofs.
 *
 * This is test-adapter-specific infrastructure (like `injectWriteFailure` on
 * the finance adapter): it proves the checkpoint contract — atomic
 * batch-plus-cursor application, idempotent replay, explicit base mismatch —
 * that P04/P08 adapters must implement against real persistence. It is not a
 * sync daemon and performs no networking.
 */

import {
  dedupePulledOperations,
  isBatchAlreadyApplied,
  isNextBatchFor,
  validatePulledBatchShape,
  type CheckpointRecord,
  type PulledBatch,
  type ReplicatedOperationRef,
  type ReplicationStreamId,
  type SyncCursor,
} from '../../../src/domain/sync/cursors';
import { canonicalJson } from '../../../src/domain/contracts/canonical';

export type CheckpointApplyResult =
  | { readonly ok: true; readonly replayed: boolean }
  | { readonly ok: false; readonly reason: 'unsupportedSchema' | 'invalidBatch' | 'baseCursorMismatch' | 'injectedFailure' };

export class InMemoryCheckpointStore {
  private readonly cursors = new Map<string, CheckpointRecord>();
  private readonly applied = new Map<string, ReplicatedOperationRef[]>();
  private injectedFailures = 0;

  /** Test-adapter-specific hook: the next N batch applications throw before mutating anything. */
  injectApplyFailure(occurrences = 1): void {
    this.injectedFailures = occurrences;
  }

  cursorFor(streamId: ReplicationStreamId): SyncCursor | null {
    return this.cursors.get(streamId as string)?.cursor ?? null;
  }

  checkpointFor(streamId: ReplicationStreamId): CheckpointRecord {
    return {
      schemaVersion: 1,
      streamId,
      cursor: this.cursorFor(streamId),
    };
  }

  appliedOperations(streamId: ReplicationStreamId): readonly ReplicatedOperationRef[] {
    return [...(this.applied.get(streamId as string) ?? [])];
  }

  appliedOperationIds(streamId: ReplicationStreamId): readonly string[] {
    return this.appliedOperations(streamId).map((operation) => operation.operationId);
  }

  /** Canonical snapshot for byte-identical rollback proofs. */
  snapshotBytes(): string {
    const streams = [...this.cursors.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([streamId, checkpoint]) => ({ streamId, cursor: checkpoint.cursor }));
    const applied = [...this.applied.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([streamId, operations]) => ({ streamId, operations }));
    return canonicalJson({ streams, applied });
  }

  /**
   * Applies one pulled batch atomically: shape validation, base-cursor
   * match, and failure injection are all decided before anything mutates.
   * Replaying an already-applied batch is a no-op success.
   */
  applyBatch(batch: PulledBatch): CheckpointApplyResult {
    const shape = validatePulledBatchShape(batch);
    if (!shape.ok) {
      return { ok: false, reason: shape.failure.kind === 'unsupportedSchema' ? 'unsupportedSchema' : 'invalidBatch' };
    }
    const stored = this.checkpointFor(batch.streamId);
    if (isBatchAlreadyApplied(stored, batch)) {
      return { ok: true, replayed: true };
    }
    if (!isNextBatchFor(stored, batch)) {
      return { ok: false, reason: 'baseCursorMismatch' };
    }
    if (this.injectedFailures > 0) {
      this.injectedFailures -= 1;
      return { ok: false, reason: 'injectedFailure' };
    }
    const known = new Set(this.appliedOperationIds(batch.streamId));
    const fresh = dedupePulledOperations(batch.operations).filter((operation) => !known.has(operation.operationId));
    const current = this.applied.get(batch.streamId as string) ?? [];
    current.push(...fresh.map((operation) => ({ ...operation })));
    this.applied.set(batch.streamId as string, current);
    this.cursors.set(batch.streamId as string, { schemaVersion: 1, streamId: batch.streamId, cursor: batch.nextCursor });
    return { ok: true, replayed: false };
  }
}
