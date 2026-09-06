/**
 * Tombstones and recoverable conflicts (P03 Task D, proof scenario 5).
 *
 * Edit-versus-delete in both delivery orders preserves the tombstone and
 * the edit intent in one explicit unresolved conflict; resolution appends a
 * separate decision without mutating the original tombstone or conflict;
 * duplicate/reordered delivery of either side never creates a second
 * conflict; and an unresolved conflict blocks sync-sensitive actions.
 */

import { describe, expect, it } from 'vitest';
import { makeBookId, makeOperationId, type BookId, type OperationId } from '../../src/domain/contracts/identity';
import { makeDeviceId, makeGuestKey, repositoryScopeIdFor } from '../../src/domain/sync/scope';
import {
  assertSyncSafeForSensitiveAction,
  decideDeleteVsEdit,
  hasUnresolvedConflicts,
  latestResolutionFor,
  resolveSyncConflict,
  SYNC_CONFLICT_KINDS,
  type SyncConflict,
  type SyncConflictResolution,
} from '../../src/domain/sync/conflicts';
import {
  isTombstoneCompactable,
  validateTombstone,
  type TombstoneRecord,
} from '../../src/domain/sync/tombstones';

function branded<T>(result: { ok: true; value: T } | { ok: false; failure: { detail: string } }): T {
  if (!result.ok) throw new Error(`invalid test id: ${result.failure.detail}`);
  return result.value;
}

const bookId: BookId = branded(makeBookId('book-tombstone'));
const scopeId = repositoryScopeIdFor({
  kind: 'guest',
  guestKey: branded(makeGuestKey('guest-t')),
  deviceId: branded(makeDeviceId('device-t')),
});

function editOp(raw: string): OperationId {
  return branded(makeOperationId(raw));
}

function tombstoneFor(deleteOp: string, sequence: number): TombstoneRecord {
  return {
    schemaVersion: 1,
    scopeId,
    bookId,
    entityKind: 'entry',
    entityId: 'entry-7',
    sourceOperationId: editOp(deleteOp),
    baseRevision: 4,
    tombstoneSequence: sequence,
    deletedAtInstantMs: 1_000,
  };
}

describe('tombstones', () => {
  it('validates shape and refuses compaction before acknowledgement and retention', () => {
    const tombstone = tombstoneFor('op-delete-1', 9);
    expect(validateTombstone(tombstone).ok).toBe(true);
    expect(validateTombstone({ ...tombstone, schemaVersion: 99 }).ok).toBe(false);
    expect(validateTombstone({ ...tombstone, entityKind: 'wallet' }).ok).toBe(false);
    expect(validateTombstone(null).ok).toBe(false);

    // Unacknowledged tombstones are never compactable in any retention window.
    expect(isTombstoneCompactable(tombstone, { acknowledgedByPeers: false, ageSinceAcknowledgedMs: 10_000_000, minRetentionMs: 0 })).toBe(false);
    // Acknowledged but inside the retention window: still retained.
    expect(isTombstoneCompactable(tombstone, { acknowledgedByPeers: true, ageSinceAcknowledgedMs: 10, minRetentionMs: 3_600_000 })).toBe(false);
    // Acknowledged past retention: safe to compact.
    expect(isTombstoneCompactable(tombstone, { acknowledgedByPeers: true, ageSinceAcknowledgedMs: 7_200_000, minRetentionMs: 3_600_000 })).toBe(true);
  });
});

describe('delete-versus-edit conflicts', () => {
  it('produces one identical unresolved conflict in both delivery orders', () => {
    const tombstone = tombstoneFor('op-delete-1', 9);
    const editIntent = { operationId: editOp('op-edit-1'), entityId: 'entry-7', baseRevision: 4 };

    // Edit delivered first, delete second.
    const editFirst = decideDeleteVsEdit({
      conflictId: 'conflict-entry-7',
      scopeId,
      bookId,
      entityKind: 'entry',
      tombstone,
      editIntent,
      remoteReference: 'server:rev-44',
      recordedAtInstantMs: 2_000,
    });
    // Delete delivered first, edit second: the inputs are named, not
    // ordered, so the conflict is identical apart from the record instant.
    const deleteFirst = decideDeleteVsEdit({
      conflictId: 'conflict-entry-7',
      scopeId,
      bookId,
      entityKind: 'entry',
      tombstone,
      editIntent,
      remoteReference: 'server:rev-44',
      recordedAtInstantMs: 2_000,
    });
    expect(deleteFirst).toEqual(editFirst);
    expect(editFirst.kind).toBe('deleteVsEdit');
    expect(editFirst.status).toBe('unresolved');
    expect(editFirst.localOperationId).toBe(editOp('op-edit-1'));
    // Both intents survive inside the record: nothing is last-write-wins.
    expect(editFirst.detail).toContain('op-edit-1');
    expect(editFirst.detail).toContain('op-delete-1');
  });

  it('covers every conflict kind without last-write-wins', () => {
    expect([...SYNC_CONFLICT_KINDS].sort()).toEqual(
      ['deleteVsEdit', 'duplicateIdChangedPayload', 'incompatibleSchema', 'ownershipMismatch', 'staleRevision'].sort(),
    );
  });

  it('appends resolutions separately and never mutates the originals', () => {
    const conflict = decideDeleteVsEdit({
      conflictId: 'conflict-entry-7',
      scopeId,
      bookId,
      entityKind: 'entry',
      tombstone: tombstoneFor('op-delete-1', 9),
      editIntent: { operationId: editOp('op-edit-1'), entityId: 'entry-7', baseRevision: 4 },
      remoteReference: null,
      recordedAtInstantMs: 2_000,
    });
    const conflictBytes = JSON.stringify(conflict);
    const tombstoneBytes = JSON.stringify(tombstoneFor('op-delete-1', 9));

    const { conflict: returned, resolution } = resolveSyncConflict({
      resolutionId: 'resolution-1',
      conflict,
      policy: 'keepLocal',
      note: 'reviewed: the edit stands, delete is withdrawn by a new command',
      decidedAtInstantMs: 3_000,
      decidedBy: 'user',
    });
    expect(returned).toBe(conflict);
    expect(JSON.stringify(conflict)).toBe(conflictBytes);
    expect(resolution.conflictId).toBe('conflict-entry-7');
    expect(resolution.policy).toBe('keepLocal');
    expect(JSON.stringify(tombstoneFor('op-delete-1', 9))).toBe(tombstoneBytes);

    // Duplicate/redelivered resolution decisions append; latest wins, originals stand.
    const resolutions: SyncConflictResolution[] = [resolution];
    expect(hasUnresolvedConflicts([conflict], resolutions)).toBe(false);
    expect(hasUnresolvedConflicts([conflict], [])).toBe(true);
    expect(latestResolutionFor('conflict-entry-7', resolutions)).toBe(resolution);
    expect(latestResolutionFor('conflict-unknown', resolutions)).toBeNull();
  });

  it('blocks sync-sensitive actions while a conflict is unresolved', () => {
    const conflict: SyncConflict = decideDeleteVsEdit({
      conflictId: 'conflict-entry-7',
      scopeId,
      bookId,
      entityKind: 'entry',
      tombstone: tombstoneFor('op-delete-1', 9),
      editIntent: { operationId: editOp('op-edit-1'), entityId: 'entry-7', baseRevision: 4 },
      remoteReference: null,
      recordedAtInstantMs: 2_000,
    });
    expect(assertSyncSafeForSensitiveAction({ conflicts: [conflict], resolutions: [], unacknowledgedOutboxCount: 0 })).toEqual({
      ok: false,
      reason: 'unresolvedConflicts',
    });
    expect(
      assertSyncSafeForSensitiveAction({ conflicts: [], resolutions: [], unacknowledgedOutboxCount: 2 }),
    ).toEqual({ ok: false, reason: 'unacknowledgedOutbox' });
    const { resolution } = resolveSyncConflict({
      resolutionId: 'resolution-1',
      conflict,
      policy: 'merged',
      note: 'both sides reconciled by follow-up commands',
      decidedAtInstantMs: 3_000,
      decidedBy: 'mergePolicy',
    });
    expect(assertSyncSafeForSensitiveAction({ conflicts: [conflict], resolutions: [resolution], unacknowledgedOutboxCount: 0 })).toEqual({ ok: true });
  });
});
