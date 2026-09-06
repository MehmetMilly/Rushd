/**
 * Recoverable sync conflict records and pure policy helpers (P03 Task D).
 *
 * Conflict history is immutable: a conflict row is never mutated and never
 * resolved in place. Resolution is a separate appended decision that
 * preserves the local operation, the remote/current state reference, and the
 * chosen policy result. An unresolved conflict stays discoverable and blocks
 * any action whose safety depends on successful synchronization or deletion.
 *
 * Canonical money never uses last-write-wins: delete-versus-edit,
 * stale-revision, ownership-mismatch, duplicate-ID-with-changed-payload, and
 * incompatible-schema collisions all become explicit conflicts that keep
 * both sides' intent. Either delivery order of an edit and a delete produces
 * the same unresolved conflict.
 */

import type { BookId, OperationId } from '../contracts/identity';
import type { RepositoryScopeId } from './scope';
import type { SyncEntityKind, TombstoneRecord } from './tombstones';

export const SYNC_CONFLICT_SCHEMA_VERSION = 1 as const;
export type SyncConflictSchemaVersion = typeof SYNC_CONFLICT_SCHEMA_VERSION;

export type SyncConflictKind =
  | 'deleteVsEdit'
  | 'staleRevision'
  | 'ownershipMismatch'
  | 'duplicateIdChangedPayload'
  | 'incompatibleSchema';

export const SYNC_CONFLICT_KINDS: readonly SyncConflictKind[] = Object.freeze([
  'deleteVsEdit',
  'staleRevision',
  'ownershipMismatch',
  'duplicateIdChangedPayload',
  'incompatibleSchema',
]);

export interface SyncConflict {
  readonly schemaVersion: SyncConflictSchemaVersion;
  /** Stable caller-supplied identity, so retries and redelivery dedupe cleanly. */
  readonly conflictId: string;
  readonly kind: SyncConflictKind;
  readonly scopeId: RepositoryScopeId;
  readonly bookId: BookId;
  readonly entityKind: SyncEntityKind;
  readonly entityId: string;
  /** The local operation whose intent must be preserved; null when the local side is only a tombstone. */
  readonly localOperationId: OperationId | null;
  /** Opaque remote/current-state reference supplied by the adapter; never parsed for meaning. */
  readonly remoteReference: string | null;
  readonly detail: string;
  readonly recordedAtInstantMs: number;
  /** Conflicts are created unresolved and stay that way; resolution appends separately. */
  readonly status: 'unresolved';
}

export type SyncResolutionPolicy = 'keepLocal' | 'keepRemote' | 'merged' | 'acknowledgedDownstreamStands';

export interface SyncConflictResolution {
  readonly schemaVersion: SyncConflictSchemaVersion;
  readonly resolutionId: string;
  readonly conflictId: string;
  readonly policy: SyncResolutionPolicy;
  readonly note: string;
  readonly decidedAtInstantMs: number;
  readonly decidedBy: 'user' | 'mergePolicy';
}

export interface DeleteVsEditIntent {
  readonly operationId: OperationId;
  readonly entityId: string;
  readonly baseRevision: number;
}

export interface DeleteVsEditInput {
  readonly conflictId: string;
  readonly scopeId: RepositoryScopeId;
  readonly bookId: BookId;
  readonly entityKind: SyncEntityKind;
  readonly tombstone: TombstoneRecord;
  readonly editIntent: DeleteVsEditIntent;
  readonly remoteReference: string | null;
  readonly recordedAtInstantMs: number;
}

/**
 * Builds the explicit delete-versus-edit conflict, preserving both the
 * tombstone and the edit intent. The function takes both sides as named
 * fields rather than an ordered pair, so either delivery order produces the
 * identical conflict: there is no "winner" and no last-write-wins.
 */
export function decideDeleteVsEdit(input: DeleteVsEditInput): SyncConflict {
  return {
    schemaVersion: SYNC_CONFLICT_SCHEMA_VERSION,
    conflictId: input.conflictId,
    kind: 'deleteVsEdit',
    scopeId: input.scopeId,
    bookId: input.bookId,
    entityKind: input.entityKind,
    entityId: input.editIntent.entityId,
    localOperationId: input.editIntent.operationId,
    remoteReference: input.remoteReference,
    detail:
      `edit ${input.editIntent.operationId} (base revision ${input.editIntent.baseRevision}) ` +
      `collides with tombstone from ${input.tombstone.sourceOperationId} ` +
      `(base revision ${input.tombstone.baseRevision}, sequence ${input.tombstone.tombstoneSequence}); ` +
      `both intents are preserved for explicit resolution`,
    recordedAtInstantMs: input.recordedAtInstantMs,
    status: 'unresolved',
  };
}

export interface ConflictResolutionInput {
  readonly resolutionId: string;
  readonly conflict: SyncConflict;
  readonly policy: SyncResolutionPolicy;
  readonly note: string;
  readonly decidedAtInstantMs: number;
  readonly decidedBy: 'user' | 'mergePolicy';
}

/**
 * Appends a resolution decision for a conflict. The conflict itself is
 * returned untouched (callers keep the original row byte-identical); the
 * resolution carries everything needed to audit the decision. No monetary
 * action is implied: resolutions are visibility decisions, and any money
 * movement needs its own finance command.
 */
export function resolveSyncConflict(input: ConflictResolutionInput): { readonly conflict: SyncConflict; readonly resolution: SyncConflictResolution } {
  const resolution: SyncConflictResolution = {
    schemaVersion: SYNC_CONFLICT_SCHEMA_VERSION,
    resolutionId: input.resolutionId,
    conflictId: input.conflict.conflictId,
    policy: input.policy,
    note: input.note,
    decidedAtInstantMs: input.decidedAtInstantMs,
    decidedBy: input.decidedBy,
  };
  return { conflict: input.conflict, resolution };
}

/** Latest resolution for one conflict, or null while it is still unresolved. Later appends supersede earlier ones. */
export function latestResolutionFor(conflictId: string, resolutions: readonly SyncConflictResolution[]): SyncConflictResolution | null {
  let latest: SyncConflictResolution | null = null;
  for (const resolution of resolutions) {
    if (resolution.conflictId !== conflictId) continue;
    latest = resolution;
  }
  return latest;
}

/** True while at least one conflict has no appended resolution. */
export function hasUnresolvedConflicts(conflicts: readonly SyncConflict[], resolutions: readonly SyncConflictResolution[]): boolean {
  for (const conflict of conflicts) {
    if (latestResolutionFor(conflict.conflictId, resolutions) === null) return true;
  }
  return false;
}

export type SyncSafetyGate = { readonly ok: true } | { readonly ok: false; readonly reason: 'unresolvedConflicts' | 'unacknowledgedOutbox' };

/**
 * Pure gate for actions whose safety depends on successful synchronization
 * or deletion (cache erasure, tombstone compaction, merge cleanup). Any
 * unresolved conflict or any unacknowledged outbox intent blocks the action
 * with an explicit reason; nothing stalls invisibly.
 */
export function assertSyncSafeForSensitiveAction(input: { readonly conflicts: readonly SyncConflict[]; readonly resolutions: readonly SyncConflictResolution[]; readonly unacknowledgedOutboxCount: number }): SyncSafetyGate {
  if (hasUnresolvedConflicts(input.conflicts, input.resolutions)) {
    return { ok: false, reason: 'unresolvedConflicts' };
  }
  if (!Number.isSafeInteger(input.unacknowledgedOutboxCount) || input.unacknowledgedOutboxCount < 0) {
    return { ok: false, reason: 'unacknowledgedOutbox' };
  }
  if (input.unacknowledgedOutboxCount > 0) {
    return { ok: false, reason: 'unacknowledgedOutbox' };
  }
  return { ok: true };
}
