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
 * an already-applied batch is a no-op success, never a second effect.
 */

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
}

/** One opaque reference to a replicated operation inside a pulled batch. */
export interface ReplicatedOperationRef {
  readonly operationId: string;
  /** Provider-side position; ordering across batches is by cursor advancement, never by this number. */
  readonly sequence: number;
}

/**
 * A batch pulled from one stream. `baseCursor` must equal the stored
 * checkpoint cursor (or be null when nothing was applied) for the batch to
 * apply; `nextCursor` becomes the stored cursor only when every operation in
 * the batch is durably applied.
 */
export interface PulledBatch {
  readonly schemaVersion: SyncCursorSchemaVersion;
  readonly streamId: ReplicationStreamId;
  readonly baseCursor: SyncCursor | null;
  readonly operations: readonly ReplicatedOperationRef[];
  readonly nextCursor: SyncCursor;
}

export type PulledBatchShapeFailure =
  | { readonly kind: 'unsupportedSchema'; readonly schemaVersion: unknown }
  | { readonly kind: 'invalidBatch'; readonly detail: string };

export type PulledBatchShapeResult = { readonly ok: true } | { readonly ok: false; readonly failure: PulledBatchShapeFailure };

/** Pure shape check: schema support and structural sanity, no semantic lookup. */
export function validatePulledBatchShape(batch: PulledBatch): PulledBatchShapeResult {
  if (batch.schemaVersion !== SYNC_CURSOR_SCHEMA_VERSION) {
    return { ok: false, failure: { kind: 'unsupportedSchema', schemaVersion: batch.schemaVersion } };
  }
  if (batch.baseCursor !== null && batch.baseCursor === batch.nextCursor) {
    return { ok: false, failure: { kind: 'invalidBatch', detail: 'a non-empty advance must move the cursor' } };
  }
  for (const operation of batch.operations) {
    if (typeof operation.operationId !== 'string' || operation.operationId.length === 0) {
      return { ok: false, failure: { kind: 'invalidBatch', detail: 'every replicated operation needs an operation id' } };
    }
    if (!Number.isSafeInteger(operation.sequence) || operation.sequence < 0) {
      return { ok: false, failure: { kind: 'invalidBatch', detail: 'every replicated operation needs a non-negative safe-integer sequence' } };
    }
  }
  return { ok: true };
}

/**
 * Deduplicates replicated operations by operation ID, first occurrence wins,
 * batch order preserved. Reordered or duplicated delivery of the same batch
 * therefore yields one application per operation.
 */
export function dedupePulledOperations(operations: readonly ReplicatedOperationRef[]): readonly ReplicatedOperationRef[] {
  const seen = new Set<string>();
  const result: ReplicatedOperationRef[] = [];
  for (const operation of operations) {
    if (seen.has(operation.operationId)) continue;
    seen.add(operation.operationId);
    result.push(operation);
  }
  return result;
}

/** True when the stored checkpoint already covers this batch (safe to acknowledge without re-applying). */
export function isBatchAlreadyApplied(stored: CheckpointRecord, batch: PulledBatch): boolean {
  if (stored.streamId !== batch.streamId) return false;
  return stored.cursor !== null && equalSyncCursors(stored.cursor, batch.nextCursor);
}

/** True when this batch is the immediate next batch for the stored checkpoint. */
export function isNextBatchFor(stored: CheckpointRecord, batch: PulledBatch): boolean {
  if (stored.streamId !== batch.streamId) return false;
  if (stored.cursor === null) return batch.baseCursor === null;
  if (batch.baseCursor === null) return false;
  return equalSyncCursors(stored.cursor, batch.baseCursor);
}
