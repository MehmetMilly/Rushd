/**
 * In-memory pull-checkpoint store for the P03 sync contract proofs.
 *
 * This is test-adapter-specific infrastructure (like `injectWriteFailure` on
 * the finance adapter): it proves the checkpoint contract — atomic
 * content-bound batch application, idempotent exact replay, explicit
 * base-mismatch and changed-content conflicts — that P04/P08 adapters must
 * implement against real persistence. It stores full pulled operation
 * content (scope/book/revision/digest/schema), never bare IDs, so applying
 * a batch persists canonical pulled records together with the checkpoint.
 * It is not a sync daemon and performs no networking.
 */

import {
  isBatchAlreadyApplied,
  isNextBatchFor,
  reconcilePulledOperations,
  validatePulledBatchShape,
  type CheckpointRecord,
  type PulledBatch,
  type PulledContentConflict,
  type PulledOperation,
  type ReplicationStreamId,
  type SyncCursor,
} from '../../../src/domain/sync/cursors';
import { canonicalJson } from '../../../src/domain/contracts/canonical';

export type CheckpointApplyResult =
  | { readonly ok: true; readonly replayed: boolean }
  | { readonly ok: false; readonly reason: 'unsupportedSchema' | 'invalidBatch' | 'baseCursorMismatch' | 'injectedFailure' }
  | { readonly ok: false; readonly reason: 'contentConflict'; readonly conflict: PulledContentConflict };

interface StreamState {
  cursor: SyncCursor | null;
  batchDigest: string | null;
  applied: Map<string, PulledOperation>;
}

export class InMemoryCheckpointStore {
  private readonly streams = new Map<string, StreamState>();
  private injectedFailures = 0;

  /** Test-adapter-specific hook: the next N batch applications fail before mutating anything. */
  injectApplyFailure(occurrences = 1): void {
    this.injectedFailures = occurrences;
  }

  cursorFor(streamId: ReplicationStreamId): SyncCursor | null {
    return this.streams.get(streamId as string)?.cursor ?? null;
  }

  batchDigestFor(streamId: ReplicationStreamId): string | null {
    return this.streams.get(streamId as string)?.batchDigest ?? null;
  }

  checkpointFor(streamId: ReplicationStreamId): CheckpointRecord {
    const state = this.streams.get(streamId as string);
    return {
      schemaVersion: 1,
      streamId,
      cursor: state?.cursor ?? null,
      batchDigest: state?.batchDigest ?? null,
    };
  }

  appliedOperations(streamId: ReplicationStreamId): readonly PulledOperation[] {
    const state = this.streams.get(streamId as string);
    if (state === undefined) return [];
    return [...state.applied.values()].map((operation) => JSON.parse(JSON.stringify(operation)) as PulledOperation);
  }

  appliedOperationIds(streamId: ReplicationStreamId): readonly string[] {
    return this.appliedOperations(streamId).map((operation) => operation.operationId as string);
  }

  /** Canonical snapshot for byte-identical rollback proofs. */
  snapshotBytes(): string {
    const streams = [...this.streams.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([streamId, state]) => ({
        streamId,
        cursor: state.cursor,
        batchDigest: state.batchDigest,
        applied: [...state.applied.values()],
      }));
    return canonicalJson({ streams });
  }

  /**
   * Applies one pulled batch atomically: shape validation, exact-replay
   * detection, base-cursor match, and content reconciliation are all
   * decided before anything mutates. Replaying the exact same batch
   * (same next cursor and same content digest) is a no-op success. The
   * same cursor with changed operations, or the same operation ID with
   * changed canonical content, is an explicit conflict that advances
   * nothing.
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
    const reconciled = reconcilePulledOperations(batch.operations);
    if (!reconciled.ok) {
      return { ok: false, reason: 'contentConflict', conflict: reconciled.conflict };
    }
    const state = this.streams.get(batch.streamId as string);
    for (const operation of reconciled.operations) {
      const known = state?.applied.get(operation.operationId as string);
      if (known !== undefined && known.canonicalDigest !== operation.canonicalDigest) {
        return {
          ok: false,
          reason: 'contentConflict',
          conflict: { operationId: operation.operationId as string, digests: [known.canonicalDigest, operation.canonicalDigest] },
        };
      }
    }
    if (this.injectedFailures > 0) {
      this.injectedFailures -= 1;
      return { ok: false, reason: 'injectedFailure' };
    }
    const next: StreamState = state ?? { cursor: null, batchDigest: null, applied: new Map() };
    for (const operation of reconciled.operations) {
      if (!next.applied.has(operation.operationId as string)) {
        next.applied.set(operation.operationId as string, JSON.parse(JSON.stringify(operation)) as PulledOperation);
      }
    }
    next.cursor = batch.nextCursor;
    next.batchDigest = batch.batchDigest;
    this.streams.set(batch.streamId as string, next);
    return { ok: true, replayed: false };
  }
}
