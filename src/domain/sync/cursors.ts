/**
 * Opaque replication cursors and checkpoints (P03 Task D).
 *
 * A pull cursor is an opaque replication position scoped to one
 * identity/provider stream. Code outside the storage adapter must never
 * parse time, business meaning, or ordering out of it: `createdAtInstantMs`,
 * financial occurrence time, local date, string ID order, and provider
 * timestamps are not replication sequence numbers. The only legal operations
 * are construction, validation, and equality comparison. There is
 * deliberately no less-than/greater-than comparison: any code that orders
 * cursors lexically or by embedded timestamp is outside the contract, and
 * the conformance suite proves durable order comes from enqueue
 * sequence/revision/cursor equality alone.
 *
 * Applying a pulled batch and advancing its checkpoint is atomic: a failed
 * apply leaves the stored cursor and the applied set unchanged, and replaying
 * the exact same batch (same identity and same content digest) is a no-op
 * success, never a second effect. The same cursor carrying changed
 * operations, or the same operation ID carrying changed canonical content,
 * is an explicit conflict: the cursor never advances past unverified
 * content.
 */

import { canonicalJson, stableDigest } from '../contracts/canonical';
import { makeBookId, makeOperationId } from '../contracts/identity';
import { makeRepositoryScopeId } from './scope';
import type { BookId, OperationId } from '../contracts/identity';
import type { RepositoryScopeId } from './scope';

declare const syncCursorBrand: unique symbol;
declare const replicationStreamIdBrand: unique symbol;

export type SyncCursor = string & { readonly [syncCursorBrand]: true };
export type ReplicationStreamId = string & { readonly [replicationStreamIdBrand]: true };

export type CursorResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: { readonly reason: 'invalidCursor'; readonly provided: unknown; readonly detail: string } };

const CURSOR_PATTERN = /^[\x21-\x7e]{1,220}$/;

function makeCursorValue<T extends string>(value: unknown, pattern: RegExp, what: string): CursorResult<T> {
  if (typeof value !== 'string') {
    return { ok: false, failure: { reason: 'invalidCursor', provided: value, detail: `${what} must be a string` } };
  }
  if (!pattern.test(value)) {
    return {
      ok: false,
      failure: { reason: 'invalidCursor', provided: value, detail: `${what} must be printable ASCII without whitespace` },
    };
  }
  return { ok: true, value: value as T };
}

/** Accepts any opaque provider string that fits the envelope; meaning stays behind the adapter. */
export function makeSyncCursor(value: unknown): CursorResult<SyncCursor> {
  return makeCursorValue<SyncCursor>(value, CURSOR_PATTERN, 'sync cursor');
}

export function makeReplicationStreamId(value: unknown): CursorResult<ReplicationStreamId> {
  return makeCursorValue<ReplicationStreamId>(value, CURSOR_PATTERN, 'replication stream id');
}

/** The only legal comparison between cursors: equality. */
export function equalSyncCursors(left: SyncCursor, right: SyncCursor): boolean {
  return left === right;
}

/** Schema version of the cursor/checkpoint envelope. P04/P08 must reject unknown versions explicitly. */
export const SYNC_CURSOR_SCHEMA_VERSION = 1 as const;
export type SyncCursorSchemaVersion = typeof SYNC_CURSOR_SCHEMA_VERSION;

/** Durable checkpoint for one replication stream: the cursor of the last fully applied batch. */
export interface CheckpointRecord {
  readonly schemaVersion: SyncCursorSchemaVersion;
  readonly streamId: ReplicationStreamId;
  /** Null means nothing has ever been applied on this stream. */
  readonly cursor: SyncCursor | null;
  /** Content digest of the last applied batch; null when nothing was applied. A replay is exact only for the same digest. */
  readonly batchDigest: string | null;
}

/**
 * One content-bound replicated operation inside a pulled batch. Unlike a
 * bare ID reference, the envelope carries enough scope/book/revision/digest
 * data to detect changed content: the same operation ID with a different
 * canonical digest is an explicit conflict, never a silent keep-first.
 */
export interface PulledOperation {
  readonly operationId: OperationId;
  /** Provider-side position; ordering across batches is by cursor advancement, never by this number. */
  readonly sequence: number;
  readonly scopeId: RepositoryScopeId;
  readonly bookId: BookId;
  readonly baseRevision: number;
  /** Exactly one revision advancement per operation: resultingRevision must equal baseRevision + 1. */
  readonly resultingRevision: number;
  /** Stable digest of the canonical command payload, bound at the source. */
  readonly canonicalDigest: string;
  readonly schemaVersion: SyncCursorSchemaVersion;
}

/**
 * A batch pulled from one stream. `batchId` names the batch; `batchDigest`
 * binds its exact content (recomputed by the receiver — a digest that does
 * not match the operations is tampering or corruption, not a replay).
 * `baseCursor` must equal the stored checkpoint cursor (or be null when
 * nothing was applied) for the batch to apply; `nextCursor` becomes the
 * stored cursor only when every operation in the batch is durably applied.
 */
export interface PulledBatch {
  readonly schemaVersion: SyncCursorSchemaVersion;
  readonly streamId: ReplicationStreamId;
  readonly batchId: string;
  readonly batchDigest: string;
  readonly baseCursor: SyncCursor | null;
  readonly operations: readonly PulledOperation[];
  readonly nextCursor: SyncCursor;
}

/** Canonical content digest of a pulled batch's operations, in batch order. */
export function computePulledBatchDigest(operations: readonly PulledOperation[]): string {
  return stableDigest(
    canonicalJson(
      operations.map((operation) => ({
        baseRevision: operation.baseRevision,
        bookId: operation.bookId as string,
        canonicalDigest: operation.canonicalDigest,
        operationId: operation.operationId as string,
        resultingRevision: operation.resultingRevision,
        schemaVersion: operation.schemaVersion,
        scopeId: operation.scopeId as string,
        sequence: operation.sequence,
      })),
    ),
  );
}

export type PulledBatchShapeFailure =
  | { readonly kind: 'unsupportedSchema'; readonly schemaVersion: unknown }
  | { readonly kind: 'invalidBatch'; readonly detail: string };

export type PulledBatchShapeResult = { readonly ok: true } | { readonly ok: false; readonly failure: PulledBatchShapeFailure };

/** Pure shape check: schema support, batch identity/digest binding, and per-operation structural sanity. */
export function validatePulledBatchShape(batch: PulledBatch): PulledBatchShapeResult {
  if (batch.schemaVersion !== SYNC_CURSOR_SCHEMA_VERSION) {
    return { ok: false, failure: { kind: 'unsupportedSchema', schemaVersion: batch.schemaVersion } };
  }
  if (typeof batch.batchId !== 'string' || batch.batchId.length === 0 || !CURSOR_PATTERN.test(batch.batchId)) {
    return { ok: false, failure: { kind: 'invalidBatch', detail: 'every pulled batch needs a batch identity' } };
  }
  if (batch.baseCursor !== null && batch.baseCursor === batch.nextCursor && batch.operations.length > 0) {
    return { ok: false, failure: { kind: 'invalidBatch', detail: 'a non-empty advance must move the cursor' } };
  }
  for (const operation of batch.operations) {
    const operationId = makeOperationId(operation.operationId);
    if (!operationId.ok) {
      return { ok: false, failure: { kind: 'invalidBatch', detail: `invalid pulled operation id: ${operationId.failure.detail}` } };
    }
    if (!Number.isSafeInteger(operation.sequence) || operation.sequence < 0) {
      return { ok: false, failure: { kind: 'invalidBatch', detail: 'every replicated operation needs a non-negative safe-integer sequence' } };
    }
    if (!makeRepositoryScopeId(operation.scopeId).ok) {
      return { ok: false, failure: { kind: 'invalidBatch', detail: 'every replicated operation needs a valid scope id' } };
    }
    if (!makeBookId(operation.bookId).ok) {
      return { ok: false, failure: { kind: 'invalidBatch', detail: 'every replicated operation needs a valid book id' } };
    }
    if (!Number.isSafeInteger(operation.baseRevision) || operation.baseRevision < 0) {
      return { ok: false, failure: { kind: 'invalidBatch', detail: 'every replicated operation needs a non-negative safe-integer base revision' } };
    }
    if (operation.resultingRevision !== operation.baseRevision + 1) {
      return { ok: false, failure: { kind: 'invalidBatch', detail: 'every replicated operation must advance exactly one revision' } };
    }
    if (typeof operation.canonicalDigest !== 'string' || !CURSOR_PATTERN.test(operation.canonicalDigest)) {
      return { ok: false, failure: { kind: 'invalidBatch', detail: 'every replicated operation needs a canonical digest' } };
    }
    if (operation.schemaVersion !== SYNC_CURSOR_SCHEMA_VERSION) {
      return { ok: false, failure: { kind: 'unsupportedSchema', schemaVersion: operation.schemaVersion } };
    }
  }
  if (batch.batchDigest !== computePulledBatchDigest(batch.operations)) {
    return { ok: false, failure: { kind: 'invalidBatch', detail: 'batch digest does not match batch content' } };
  }
  return { ok: true };
}

export interface PulledContentConflict {
  readonly operationId: string;
  readonly digests: readonly string[];
}

export type PulledReconcileResult =
  | { readonly ok: true; readonly operations: readonly PulledOperation[] }
  | { readonly ok: false; readonly conflict: PulledContentConflict };

/**
 * Content-bound reconciliation: same operation ID with the same canonical
 * digest deduplicates (first occurrence wins, batch order preserved), while
 * the same operation ID with a different digest is an explicit conflict.
 * Reordered or duplicated delivery of identical content therefore yields
 * one application per operation; changed duplicates never silently win.
 */
export function reconcilePulledOperations(operations: readonly PulledOperation[]): PulledReconcileResult {
  const digestsById = new Map<string, string>();
  const result: PulledOperation[] = [];
  for (const operation of operations) {
    const id = operation.operationId as string;
    const known = digestsById.get(id);
    if (known === undefined) {
      digestsById.set(id, operation.canonicalDigest);
      result.push(operation);
      continue;
    }
    if (known !== operation.canonicalDigest) {
      return { ok: false, conflict: { operationId: id, digests: [known, operation.canonicalDigest] } };
    }
  }
  return { ok: true, operations: result };
}

/** True when the stored checkpoint already covers exactly this batch content (safe to acknowledge without re-applying). */
export function isBatchAlreadyApplied(stored: CheckpointRecord, batch: PulledBatch): boolean {
  if (stored.streamId !== batch.streamId) return false;
  if (stored.cursor === null || stored.batchDigest === null) return false;
  return equalSyncCursors(stored.cursor, batch.nextCursor) && stored.batchDigest === batch.batchDigest;
}

/** True when this batch is the immediate next batch for the stored checkpoint. */
export function isNextBatchFor(stored: CheckpointRecord, batch: PulledBatch): boolean {
  if (stored.streamId !== batch.streamId) return false;
  if (stored.cursor === null) return batch.baseCursor === null;
  if (batch.baseCursor === null) return false;
  return equalSyncCursors(stored.cursor, batch.baseCursor);
}
