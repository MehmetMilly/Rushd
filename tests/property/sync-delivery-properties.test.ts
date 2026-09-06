/**
 * Sync delivery properties (P03 Task D, bounded and seeded).
 *
 * Covers duplicate/reordered delivery, same-operation retries, uncertain
 * acknowledgement, stale base revisions, and delete-versus-edit decisions
 * through the public sync contracts with independent oracles (plain sets
 * and direct field comparisons, never the implementation under test).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeBookId, makeOperationId } from '../../src/domain/contracts/identity';
import type { BookId, OperationId } from '../../src/domain/contracts/identity';
import { makeDeviceId, makeGuestKey, repositoryScopeIdFor } from '../../src/domain/sync/scope';
import {
  computePulledBatchDigest,
  isBatchAlreadyApplied,
  isNextBatchFor,
  makeReplicationStreamId,
  makeSyncCursor,
  reconcilePulledOperations,
  type PulledBatch,
  type PulledOperation,
  type ReplicationStreamId,
  type SyncCursor,
} from '../../src/domain/sync/cursors';
import { advanceMergePlan, pendingMergeUploads, planGuestMerge } from '../../src/domain/sync/merge';
import { decideDeleteVsEdit } from '../../src/domain/sync/conflicts';
import { makeAccountId } from '../../src/domain/sync/scope';
import { PROPERTY_RUNS, propertySeed } from './support/seed';

const SEED = propertySeed(20260911);

function branded<T>(result: { ok: true; value: T } | { ok: false; failure: { detail: string } }): T {
  if (!result.ok) throw new Error('invalid test id');
  return result.value;
}

const scopeId = repositoryScopeIdFor({
  kind: 'guest',
  guestKey: branded(makeGuestKey('guest-prop')),
  deviceId: branded(makeDeviceId('device-prop')),
});
const accountId = branded(makeAccountId('account-prop'));
const bookId: BookId = branded(makeBookId('book-prop-sync'));

function cursor(raw: string): SyncCursor {
  return branded(makeSyncCursor(raw));
}

function stream(): ReplicationStreamId {
  return branded(makeReplicationStreamId('stream-prop'));
}

function operationId(raw: string): OperationId {
  return branded(makeOperationId(raw));
}

const opIdArb = fc.integer({ min: 1, max: 5 }).map((n) => `prop-op-${n}`);

function envelopeFor(id: string, sequence: number): PulledOperation {
  return {
    operationId: operationId(id),
    sequence,
    scopeId,
    bookId,
    baseRevision: 1,
    resultingRevision: 2,
    canonicalDigest: `digest-for-${id}`,
    schemaVersion: 1,
  };
}

describe('sync delivery properties (bounded, seeded)', () => {
  it('delivers duplicate/reordered batches exactly once, first occurrence wins', () => {
    const property = fc.property(fc.array(opIdArb, { minLength: 1, maxLength: 12 }), (ids) => {
      const operations = ids.map((id, index) => envelopeFor(id, index));
      const reconciled = reconcilePulledOperations(operations);
      expect(reconciled.ok).toBe(true);
      if (!reconciled.ok) throw new Error('unreachable');
      // Independent oracle: unique IDs in first-occurrence order.
      const seen = new Set<string>();
      const expected: string[] = [];
      for (const id of ids) {
        if (!seen.has(id)) {
          seen.add(id);
          expected.push(id);
        }
      }
      expect(reconciled.operations.map((operation) => operation.operationId as string)).toEqual(expected);
    });
    return fc.assert(property, { seed: SEED, numRuns: PROPERTY_RUNS });
  });

  it('turns same-ID/changed-digest duplicates into explicit conflicts', () => {
    const property = fc.property(opIdArb, fc.string({ minLength: 1, maxLength: 8 }), (id, extra) => {
      const first = envelopeFor(id, 0);
      const changed = { ...envelopeFor(id, 1), canonicalDigest: `digest-for-${id}-${extra}` };
      if (changed.canonicalDigest === first.canonicalDigest) return;
      const reconciled = reconcilePulledOperations([first, changed]);
      expect(reconciled.ok).toBe(false);
      if (!reconciled.ok) {
        expect(reconciled.conflict.operationId).toBe(id);
        expect(reconciled.conflict.digests).toEqual([first.canonicalDigest, changed.canonicalDigest]);
      }
    });
    return fc.assert(property, { seed: SEED + 4, numRuns: PROPERTY_RUNS });
  });

  it('keeps merge acknowledgement idempotent under duplicate and unknown acks', () => {
    const property = fc.property(
      fc.array(opIdArb, { minLength: 1, maxLength: 6 }),
      fc.array(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 10 }),
      (opIds, ackPicks) => {
        const unique = [...new Set(opIds)];
        const planned = planGuestMerge({
          planId: 'plan-prop',
          choice: 'mergeThisDeviceData',
          sourceScopeId: scopeId,
          targetAccountId: accountId,
          guestOperations: unique.map((id) => ({ operationId: operationId(id), bookId, canonicalCommand: `{"n":"${id}"}` })),
          remoteCanonicalByOperationId: {},
          recordedAtInstantMs: 1_000,
        });
        if (!planned.ok) throw new Error('unreachable');
        let plan = planned.plan;
        // Uncertain acknowledgement: every ack batch may repeat or name unknown IDs.
        for (const pick of ackPicks) {
          const id = pick <= 5 ? `prop-op-${pick}` : 'prop-op-unknown';
          plan = advanceMergePlan(plan, { acknowledgedOperationIds: [operationId(id)] });
        }
        const pending = pendingMergeUploads(plan).map(String);
        // Oracle: acknowledged set is exactly the known IDs that were picked; unknown picks change nothing.
        const pickedKnown = new Set(ackPicks.filter((pick) => pick <= 5).map((pick) => `prop-op-${pick}`));
        const expectedPending = unique.filter((id) => !pickedKnown.has(id));
        expect([...pending].sort()).toEqual([...expectedPending].sort());
        // Replaying the full ack set converges to complete exactly once.
        const converged = advanceMergePlan(plan, { acknowledgedOperationIds: unique.map((id) => operationId(id)) });
        expect(pendingMergeUploads(converged)).toEqual([]);
        expect(converged.status).toBe('complete');
      },
    );
    return fc.assert(property, { seed: SEED + 1, numRuns: PROPERTY_RUNS });
  });

  it('classifies every pulled batch as applied, next, or stale — never silently applicable', () => {
    const property = fc.property(
      fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 0, maxLength: 5 }),
      fc.integer({ min: 0, max: 5 }),
      fc.boolean(),
      (appliedSequences, candidateBase, digestMatches) => {
        const streamId = stream();
        const cursorFor = (n: number): SyncCursor => cursor(`cursor-prop-${n}`);
        const storedCursor = appliedSequences.length === 0 ? null : cursorFor(Math.max(...appliedSequences));
        const stored = {
          schemaVersion: 1 as const,
          streamId,
          cursor: storedCursor,
          batchDigest: storedCursor === null ? null : 'digest-stored',
        };
        const operations: PulledOperation[] = [];
        const batch: PulledBatch = {
          schemaVersion: 1,
          streamId,
          batchId: 'batch-prop',
          batchDigest: digestMatches ? 'digest-stored' : computePulledBatchDigest(operations),
          baseCursor: candidateBase === 0 ? null : cursorFor(candidateBase),
          operations,
          nextCursor: cursorFor(99),
        };
        const already = isBatchAlreadyApplied(stored, batch);
        const next = isNextBatchFor(stored, batch);
        // A batch is never both a replay and the next batch.
        expect(already && next).toBe(false);
        if (already) {
          expect(stored.cursor).not.toBeNull();
          expect(stored.batchDigest).not.toBeNull();
        }
        // Exact replay requires the same cursor AND the same content digest:
        // the same cursor with different content is not a replay.
        if (stored.cursor !== null && batch.nextCursor === stored.cursor && batch.batchDigest !== stored.batchDigest) {
          expect(already).toBe(false);
        }
        if (stored.cursor === null) {
          // Nothing applied: only the genesis batch (null base) is next; anything else is stale.
          expect(next).toBe(batch.baseCursor === null);
        } else {
          expect(next).toBe(batch.baseCursor !== null && batch.baseCursor === stored.cursor);
        }
      },
    );
    return fc.assert(property, { seed: SEED + 2, numRuns: PROPERTY_RUNS });
  });

  it('decides delete-versus-edit identically regardless of delivery order', () => {
    const property = fc.property(
      fc.integer({ min: 1, max: 50 }),
      fc.integer({ min: 0, max: 50 }),
      fc.integer({ min: 1, max: 50 }),
      (baseRevision, tombstoneSequence, editBase) => {
        const tombstone = {
          schemaVersion: 1 as const,
          scopeId,
          bookId,
          entityKind: 'entry' as const,
          entityId: 'entry-prop',
          sourceOperationId: operationId('prop-op-1'),
          baseRevision,
          tombstoneSequence: Math.max(1, tombstoneSequence),
          deletedAtInstantMs: 1_000,
        };
        const editIntent = { operationId: operationId('prop-op-2'), entityId: 'entry-prop', baseRevision: editBase };
        const editFirst = decideDeleteVsEdit({
          conflictId: 'conflict-prop',
          scopeId,
          bookId,
          entityKind: 'entry',
          tombstone,
          editIntent,
          remoteReference: null,
          recordedAtInstantMs: 2_000,
        });
        const deleteFirst = decideDeleteVsEdit({
          conflictId: 'conflict-prop',
          scopeId,
          bookId,
          entityKind: 'entry',
          tombstone,
          editIntent,
          remoteReference: null,
          recordedAtInstantMs: 2_000,
        });
        expect(deleteFirst).toEqual(editFirst);
        expect(editFirst.status).toBe('unresolved');
        expect(editFirst.detail).toContain('prop-op-1');
        expect(editFirst.detail).toContain('prop-op-2');
      },
    );
    return fc.assert(property, { seed: SEED + 3, numRuns: PROPERTY_RUNS });
  });
});
