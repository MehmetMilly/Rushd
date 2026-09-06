/**
 * Provider-neutral tombstone records (P03 Task D).
 *
 * A tombstone names a deleted entity so delete-versus-edit collisions stay
 * decidable after either side replicates. Tombstones are written by future
 * P08 delete flows and retained until acknowledgement/retention policy makes
 * compaction safe; they are never compacted while any peer may still deliver
 * an edit that needs the collision detected. There is no destructive finance
 * command in P03: these records describe what P08 must write, and the policy
 * helpers below decide collisions purely.
 */

import type { BookId, OperationId } from '../contracts/identity';
import type { RepositoryScopeId } from './scope';

export const SYNC_TOMBSTONE_SCHEMA_VERSION = 1 as const;
export type SyncTombstoneSchemaVersion = typeof SYNC_TOMBSTONE_SCHEMA_VERSION;

/** Entity kinds a tombstone can name. Canonical money kinds are included so edits to them collide explicitly. */
export type SyncEntityKind =
  | 'entry'
  | 'obligation'
  | 'goal'
  | 'observation'
  | 'plan'
  | 'occurrence'
  | 'settlement'
  | 'allocationRecord'
  | 'cycle';

export interface TombstoneRecord {
  readonly schemaVersion: SyncTombstoneSchemaVersion;
  readonly scopeId: RepositoryScopeId;
  readonly bookId: BookId;
  readonly entityKind: SyncEntityKind;
  /** Raw entity ID inside the scope; scoped by (scopeId, bookId, entityKind). */
  readonly entityId: string;
  /** The operation that recorded the deletion. */
  readonly sourceOperationId: OperationId;
  /** Book revision the deletion was based on. */
  readonly baseRevision: number;
  /** Durable local enqueue sequence of the deletion. */
  readonly tombstoneSequence: number;
  readonly deletedAtInstantMs: number;
}

export type TombstoneValidation = { readonly ok: true; readonly tombstone: TombstoneRecord } | { readonly ok: false; readonly issues: readonly string[] };

const ENTITY_ID_PATTERN = /^[\x21-\x7e]{1,100}$/;
const ENTITY_KINDS: readonly SyncEntityKind[] = Object.freeze([
  'entry',
  'obligation',
  'goal',
  'observation',
  'plan',
  'occurrence',
  'settlement',
  'allocationRecord',
  'cycle',
]);

/** Pure structural validation for tombstones received at adapter boundaries. */
export function validateTombstone(value: unknown): TombstoneValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, issues: ['tombstone must be an object'] };
  }
  const record = value as Record<string, unknown>;
  const issues: string[] = [];
  if (record['schemaVersion'] !== SYNC_TOMBSTONE_SCHEMA_VERSION) {
    issues.push('schemaVersion must be 1: evolve the wire/local schema with an explicit version, never by guessing');
  }
  if (typeof record['scopeId'] !== 'string' || !COMPOSED_PATTERN.test(record['scopeId'])) issues.push('scopeId must be a valid repository scope id');
  if (typeof record['bookId'] !== 'string' || !ENTITY_PATTERN.test(record['bookId'])) issues.push('bookId must be a valid book id');
  if (typeof record['entityKind'] !== 'string' || !ENTITY_KINDS.includes(record['entityKind'] as SyncEntityKind)) {
    issues.push(`entityKind must be one of ${ENTITY_KINDS.join(', ')}`);
  }
  if (typeof record['entityId'] !== 'string' || !ENTITY_PATTERN.test(record['entityId'])) issues.push('entityId must be a valid entity id');
  if (typeof record['sourceOperationId'] !== 'string' || !ENTITY_PATTERN.test(record['sourceOperationId'])) {
    issues.push('sourceOperationId must be a valid operation id');
  }
  if (typeof record['baseRevision'] !== 'number' || !Number.isSafeInteger(record['baseRevision']) || record['baseRevision'] < 0) {
    issues.push('baseRevision must be a non-negative safe integer');
  }
  if (typeof record['tombstoneSequence'] !== 'number' || !Number.isSafeInteger(record['tombstoneSequence']) || record['tombstoneSequence'] < 1) {
    issues.push('tombstoneSequence must be a positive safe integer');
  }
  if (typeof record['deletedAtInstantMs'] !== 'number' || !Number.isSafeInteger(record['deletedAtInstantMs'])) {
    issues.push('deletedAtInstantMs must be a safe-integer instant');
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, tombstone: value as TombstoneRecord };
}

const ENTITY_PATTERN = ENTITY_ID_PATTERN;
const COMPOSED_PATTERN = /^[\x21-\x7e]{1,220}$/;

export interface TombstoneRetentionAssessment {
  /** The tombstone has been acknowledged by every peer that needed it. */
  readonly acknowledgedByPeers: boolean;
  /** Milliseconds since the tombstone became acknowledged. */
  readonly ageSinceAcknowledgedMs: number;
  /** Minimum retention before compaction is safe. */
  readonly minRetentionMs: number;
}

/**
 * Compaction is safe only after acknowledgement plus the retention window.
 * An unacknowledged tombstone is never compactable: dropping it could turn a
 * delayed edit into a silent resurrection instead of an explicit conflict.
 */
export function isTombstoneCompactable(tombstone: TombstoneRecord, assessment: TombstoneRetentionAssessment): boolean {
  void tombstone;
  if (!assessment.acknowledgedByPeers) return false;
  if (!Number.isSafeInteger(assessment.ageSinceAcknowledgedMs) || assessment.ageSinceAcknowledgedMs < 0) return false;
  if (!Number.isSafeInteger(assessment.minRetentionMs) || assessment.minRetentionMs < 0) return false;
  return assessment.ageSinceAcknowledgedMs >= assessment.minRetentionMs;
}
