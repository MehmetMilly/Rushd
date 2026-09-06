/**
 * Guest merge decisions (P03 Task D).
 *
 * This module models decisions, not UI or network calls. The rules it
 * freezes:
 *
 * - Guest data never contacts the cloud automatically: there is no code path
 *   that uploads guest operations without an explicit merge plan, and
 *   `planGuestMerge` requires an explicit `MergeChoice`.
 * - `mergeThisDeviceData` builds a resumable, idempotent plan that preserves
 *   stable IDs. Retrying a partially acknowledged batch replays
 *   acknowledgements without replacing remote data; an ID collision (same
 *   operation ID, different canonical payload) becomes a recoverable
 *   conflict, never a silent overwrite.
 * - `keepLocal` leaves the guest repository isolated and emits no cloud
 *   intent: zero pending uploads.
 * - The source guest repository stays intact until the merge is fully
 *   acknowledged, and safe cleanup is a separately confirmed step owned by
 *   the sign-out/cache policy, never by the merge plan itself.
 */

import type { BookId, OperationId } from '../contracts/identity';
import type { AccountId, RepositoryScopeId } from './scope';
import { SYNC_CONFLICT_SCHEMA_VERSION, type SyncConflict } from './conflicts';

export const GUEST_MERGE_SCHEMA_VERSION = 1 as const;
export type GuestMergeSchemaVersion = typeof GUEST_MERGE_SCHEMA_VERSION;

export type MergeChoice = 'mergeThisDeviceData' | 'keepLocal';

export type GuestMergeStatus = 'planned' | 'partial' | 'complete' | 'keepLocal';

export interface GuestOperationSummary {
  readonly operationId: OperationId;
  readonly bookId: BookId;
  /** Canonical command payload from the guest operation journal. */
  readonly canonicalCommand: string;
}

export interface GuestMergePlan {
  readonly schemaVersion: GuestMergeSchemaVersion;
  readonly planId: string;
  readonly choice: MergeChoice;
  readonly sourceScopeId: RepositoryScopeId;
  readonly targetAccountId: AccountId | null;
  readonly status: GuestMergeStatus;
  /** Every guest operation the plan covers, in journal order. Stable IDs are preserved verbatim. */
  readonly operationIds: readonly OperationId[];
  /** Idempotent acknowledgement set: replaying an ack never changes the plan beyond the first record. */
  readonly acknowledgedOperationIds: readonly OperationId[];
  /** ID collisions recorded as recoverable conflicts instead of remote replacement. */
  readonly conflicts: readonly SyncConflict[];
}

export interface PlanGuestMergeInput {
  readonly planId: string;
  readonly choice: MergeChoice;
  readonly sourceScopeId: RepositoryScopeId;
  /** Required for mergeThisDeviceData; must be null for keepLocal. */
  readonly targetAccountId: AccountId | null;
  readonly guestOperations: readonly GuestOperationSummary[];
  /**
   * Remote canonical payloads by operation-ID string, from the account's
   * server-stamped journal. Absent IDs are new uploads; present IDs with
   * identical payloads are already-acknowledged replays; present IDs with
   * different payloads are collisions.
   */
  readonly remoteCanonicalByOperationId: Readonly<Record<string, string>>;
  readonly recordedAtInstantMs: number;
}

export type PlanGuestMergeResult = { readonly ok: true; readonly plan: GuestMergePlan } | { readonly ok: false; readonly issues: readonly string[] };

/**
 * Builds the merge plan for an explicit choice. `keepLocal` always yields a
 * plan with zero uploads and zero conflicts. Merge never rewrites a guest
 * operation ID and never stages a remote overwrite: collisions append
 * `duplicateIdChangedPayload` conflicts.
 */
export function planGuestMerge(input: PlanGuestMergeInput): PlanGuestMergeResult {
  if (typeof input.planId !== 'string' || input.planId.length === 0) {
    return { ok: false, issues: ['planId must be a non-empty string'] };
  }
  if (input.choice === 'keepLocal') {
    if (input.targetAccountId !== null) {
      return { ok: false, issues: ['keepLocal must not name a target account'] };
    }
    return {
      ok: true,
      plan: {
        schemaVersion: GUEST_MERGE_SCHEMA_VERSION,
        planId: input.planId,
        choice: input.choice,
        sourceScopeId: input.sourceScopeId,
        targetAccountId: null,
        status: 'keepLocal',
        operationIds: input.guestOperations.map((operation) => operation.operationId),
        acknowledgedOperationIds: [],
        conflicts: [],
      },
    };
  }
  if (input.targetAccountId === null) {
    return { ok: false, issues: ['mergeThisDeviceData requires a target account'] };
  }
  const acknowledged: OperationId[] = [];
  const conflicts: SyncConflict[] = [];
  for (const operation of input.guestOperations) {
    const remote = input.remoteCanonicalByOperationId[operation.operationId as string];
    if (remote === undefined) continue;
    if (remote === operation.canonicalCommand) {
      acknowledged.push(operation.operationId);
    } else {
      conflicts.push({
        schemaVersion: SYNC_CONFLICT_SCHEMA_VERSION,
        conflictId: `merge-conflict:${operation.operationId as string}`,
        kind: 'duplicateIdChangedPayload',
        scopeId: input.sourceScopeId,
        bookId: operation.bookId,
        entityKind: 'entry',
        entityId: operation.operationId as string,
        localOperationId: operation.operationId,
        remoteReference: `account:${input.targetAccountId as string}:operation:${operation.operationId as string}`,
        detail: `guest operation ${operation.operationId as string} collides with a different remote payload; remote data is preserved`,
        recordedAtInstantMs: input.recordedAtInstantMs,
        status: 'unresolved',
      });
    }
  }
  const collided = new Set(conflicts.map((conflict) => conflict.entityId));
  const pending = input.guestOperations.filter(
    (operation) => !acknowledged.includes(operation.operationId) && !collided.has(operation.operationId as string),
  );
  void pending;
  return {
    ok: true,
    plan: {
      schemaVersion: GUEST_MERGE_SCHEMA_VERSION,
      planId: input.planId,
      choice: input.choice,
      sourceScopeId: input.sourceScopeId,
      targetAccountId: input.targetAccountId,
      status: acknowledged.length === input.guestOperations.length && conflicts.length === 0 ? 'complete' : acknowledged.length > 0 || conflicts.length > 0 ? 'partial' : 'planned',
      operationIds: input.guestOperations.map((operation) => operation.operationId),
      acknowledgedOperationIds: acknowledged,
      conflicts,
    },
  };
}

/** Operations still awaiting upload acknowledgement, in journal order. Empty for keepLocal and complete plans. */
export function pendingMergeUploads(plan: GuestMergePlan): readonly OperationId[] {
  if (plan.choice === 'keepLocal') return [];
  const acknowledged = new Set<string>(plan.acknowledgedOperationIds.map(String));
  const collided = new Set(plan.conflicts.map((conflict) => conflict.entityId));
  return plan.operationIds.filter((operationId) => !acknowledged.has(operationId as string) && !collided.has(operationId as string));
}

/**
 * Records uploaded acknowledgements (and any newly discovered collisions).
 * Resumable and idempotent: duplicate acks, unknown acks, and empty batches
 * leave the plan's acknowledged set and status exactly as before, and
 * already-recorded collisions are never duplicated.
 */
export function advanceMergePlan(
  plan: GuestMergePlan,
  input: { readonly acknowledgedOperationIds: readonly OperationId[]; readonly conflicts?: readonly SyncConflict[] },
): GuestMergePlan {
  if (plan.choice === 'keepLocal') return plan;
  const known = new Set(plan.operationIds.map(String));
  const acknowledged = new Set<string>(plan.acknowledgedOperationIds.map(String));
  for (const operationId of input.acknowledgedOperationIds) {
    if (!known.has(operationId as string)) continue;
    acknowledged.add(operationId as string);
  }
  const knownConflicts = new Set(plan.conflicts.map((conflict) => conflict.conflictId));
  const conflicts = [...plan.conflicts];
  for (const conflict of input.conflicts ?? []) {
    if (knownConflicts.has(conflict.conflictId)) continue;
    knownConflicts.add(conflict.conflictId);
    conflicts.push(conflict);
  }
  const acknowledgedIds = plan.operationIds.filter((operationId) => acknowledged.has(operationId as string));
  const pending = pendingMergeUploads({ ...plan, acknowledgedOperationIds: acknowledgedIds, conflicts });
  const status: GuestMergeStatus = pending.length === 0 && conflicts.length === 0 ? 'complete' : acknowledgedIds.length > 0 || conflicts.length > 0 ? 'partial' : 'planned';
  return { ...plan, acknowledgedOperationIds: acknowledgedIds, conflicts, status };
}

/** True only when every covered operation is acknowledged and no collision is outstanding. */
export function isMergeComplete(plan: GuestMergePlan): boolean {
  return plan.choice === 'mergeThisDeviceData' && plan.status === 'complete';
}
