/**
 * Guest merge and sign-out/cache safety (P03 Task D, proof scenarios 6-7).
 *
 * Pure decision tests: no UI, no network calls.
 *
 * - `keepLocal` emits no cloud intent; merge starts only from an explicit
 *   `mergeThisDeviceData` choice.
 * - A merge plan is resumable and idempotent: retrying a partially
 *   acknowledged batch replays acknowledgements without replacing remote
 *   data, and an ID collision becomes a conflict.
 * - Sign-out with pending outbox or unresolved conflicts retains the cache
 *   by default and rejects erasure; a verified export plus explicit
 *   destructive confirmation is the only override path, and a boolean
 *   `force` cannot satisfy it.
 */

import { describe, expect, it } from 'vitest';
import { makeBookId, makeOperationId, type BookId } from '../../src/domain/contracts/identity';
import { makeAccountId, makeDeviceId, makeGuestKey, repositoryScopeIdFor } from '../../src/domain/sync/scope';
import {
  advanceMergePlan,
  isMergeComplete,
  pendingMergeUploads,
  planGuestMerge,
  type GuestOperationSummary,
} from '../../src/domain/sync/merge';
import { authorizeCacheErasure, evaluateSignOutCache } from '../../src/domain/sync/signout';

function branded<T>(result: { ok: true; value: T } | { ok: false; failure: { detail: string } }): T {
  if (!result.ok) throw new Error(`invalid test id: ${result.failure.detail}`);
  return result.value;
}

const bookId: BookId = branded(makeBookId('book-merge'));
const scopeId = repositoryScopeIdFor({
  kind: 'guest',
  guestKey: branded(makeGuestKey('guest-m')),
  deviceId: branded(makeDeviceId('device-m')),
});
const accountId = branded(makeAccountId('account-m'));

function guestOp(raw: string, canonicalCommand: string): GuestOperationSummary {
  return { operationId: branded(makeOperationId(raw)), bookId, canonicalCommand };
}

const OP_A = '{"kind":"recordInflow","n":1}';
const OP_B = '{"kind":"recordInflow","n":2}';
const OP_C = '{"kind":"recordInflow","n":3}';

describe('guest merge decisions', () => {
  it('keeps local data isolated: keepLocal emits no cloud intent', () => {
    const planned = planGuestMerge({
      planId: 'plan-keep',
      choice: 'keepLocal',
      sourceScopeId: scopeId,
      targetAccountId: null,
      guestOperations: [guestOp('op-a', OP_A), guestOp('op-b', OP_B)],
      remoteCanonicalByOperationId: {},
      recordedAtInstantMs: 1_000,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error('unreachable');
    expect(planned.plan.status).toBe('keepLocal');
    expect(pendingMergeUploads(planned.plan)).toEqual([]);
    expect(planned.plan.conflicts).toEqual([]);

    // keepLocal must not name a target account; merge requires one.
    const badKeep = planGuestMerge({
      planId: 'plan-keep-bad',
      choice: 'keepLocal',
      sourceScopeId: scopeId,
      targetAccountId: accountId,
      guestOperations: [],
      remoteCanonicalByOperationId: {},
      recordedAtInstantMs: 1_000,
    });
    expect(badKeep.ok).toBe(false);
    const badMerge = planGuestMerge({
      planId: 'plan-merge-bad',
      choice: 'mergeThisDeviceData',
      sourceScopeId: scopeId,
      targetAccountId: null,
      guestOperations: [],
      remoteCanonicalByOperationId: {},
      recordedAtInstantMs: 1_000,
    });
    expect(badMerge.ok).toBe(false);
  });

  it('resumes a partially acknowledged batch without replacing remote data', () => {
    const planned = planGuestMerge({
      planId: 'plan-merge-1',
      choice: 'mergeThisDeviceData',
      sourceScopeId: scopeId,
      targetAccountId: accountId,
      guestOperations: [guestOp('op-a', OP_A), guestOp('op-b', OP_B), guestOp('op-c', OP_C)],
      remoteCanonicalByOperationId: {},
      recordedAtInstantMs: 1_000,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error('unreachable');
    expect(planned.plan.status).toBe('planned');
    expect(pendingMergeUploads(planned.plan).map(String)).toEqual(['op-a', 'op-b', 'op-c']);

    // First attempt uploads A; the acknowledgement is recorded.
    const partial = advanceMergePlan(planned.plan, { acknowledgedOperationIds: [branded(makeOperationId('op-a'))] });
    expect(partial.status).toBe('partial');
    expect(pendingMergeUploads(partial).map(String)).toEqual(['op-b', 'op-c']);
    expect(isMergeComplete(partial)).toBe(false);

    // Retry replays the same ack (duplicate) plus B: idempotent, no remote replacement.
    const retried = advanceMergePlan(partial, {
      acknowledgedOperationIds: [branded(makeOperationId('op-a')), branded(makeOperationId('op-b'))],
    });
    expect(pendingMergeUploads(retried).map(String)).toEqual(['op-c']);

    // Unknown acks are ignored; empty batches change nothing.
    const ignored = advanceMergePlan(retried, { acknowledgedOperationIds: [branded(makeOperationId('op-unknown'))] });
    expect(ignored).toEqual(retried);
    expect(advanceMergePlan(ignored, { acknowledgedOperationIds: [] })).toEqual(ignored);

    const complete = advanceMergePlan(ignored, { acknowledgedOperationIds: [branded(makeOperationId('op-c'))] });
    expect(complete.status).toBe('complete');
    expect(pendingMergeUploads(complete)).toEqual([]);
    expect(isMergeComplete(complete)).toBe(true);
  });

  it('turns an ID collision into a conflict instead of replacing remote data', () => {
    const planned = planGuestMerge({
      planId: 'plan-merge-2',
      choice: 'mergeThisDeviceData',
      sourceScopeId: scopeId,
      targetAccountId: accountId,
      guestOperations: [guestOp('op-a', OP_A), guestOp('op-b', OP_B)],
      remoteCanonicalByOperationId: { 'op-b': '{"kind":"recordInflow","n":999}' },
      recordedAtInstantMs: 1_000,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error('unreachable');
    expect(planned.plan.conflicts).toHaveLength(1);
    expect(planned.plan.conflicts[0]?.kind).toBe('duplicateIdChangedPayload');
    expect(planned.plan.conflicts[0]?.status).toBe('unresolved');
    // The colliding operation is not staged for upload: remote data stands.
    expect(pendingMergeUploads(planned.plan).map(String)).toEqual(['op-a']);

    // Same ID with the same payload is an idempotent replay, not a conflict.
    const replay = planGuestMerge({
      planId: 'plan-merge-3',
      choice: 'mergeThisDeviceData',
      sourceScopeId: scopeId,
      targetAccountId: accountId,
      guestOperations: [guestOp('op-b', OP_B)],
      remoteCanonicalByOperationId: { 'op-b': OP_B },
      recordedAtInstantMs: 1_000,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error('unreachable');
    expect(replay.plan.status).toBe('complete');
    expect(replay.plan.conflicts).toEqual([]);
  });
});

describe('sign-out and cache-erasure safety', () => {
  it('retains the cache by default under pending, conflicting, offline, failed, or unknown sync state', () => {
    expect(evaluateSignOutCache({ syncState: 'pendingOutbox', pendingOutboxCount: 3, unresolvedConflictCount: 0 }).kind).toBe('eraseBlocked');
    expect(evaluateSignOutCache({ syncState: 'unresolvedConflicts', pendingOutboxCount: 0, unresolvedConflictCount: 1 }).kind).toBe('eraseBlocked');
    expect(evaluateSignOutCache({ syncState: 'offlineUnknown', pendingOutboxCount: 0, unresolvedConflictCount: 0 }).kind).toBe('retainAndRetry');
    expect(evaluateSignOutCache({ syncState: 'failedUnknown', pendingOutboxCount: 0, unresolvedConflictCount: 0 }).kind).toBe('retainAndRetry');
    expect(evaluateSignOutCache({ syncState: 'acknowledged', pendingOutboxCount: 0, unresolvedConflictCount: 0 }).kind).toBe('retainAndRetry');
    // Unknown counts block: they never assume clean.
    expect(evaluateSignOutCache({ syncState: 'acknowledged', pendingOutboxCount: -1, unresolvedConflictCount: 0 }).kind).toBe('retainAndRetry');
  });

  it('allows the verified-export override for enumerated pending outbox/conflict intent', () => {
    const proof = {
      verifiedExport: { exportId: 'export-1', verifiedAtInstantMs: 5_000, recordCount: 42, schemaVersion: 1 },
      destructiveConfirmation: { acknowledgementPhrase: 'ERASE-LOCAL-ACCOUNT-CACHE', confirmed: true },
    } as const;
    // Master plan 778-784: the override is the allowed path while
    // unacknowledged outbox or unresolved conflicts exist.
    const overrideOutbox = authorizeCacheErasure({ syncState: 'pendingOutbox', pendingOutboxCount: 1, unresolvedConflictCount: 0 }, proof);
    expect(overrideOutbox.ok).toBe(true);
    expect(overrideOutbox.decision).toEqual({ kind: 'erased' });
    const overrideConflict = authorizeCacheErasure({ syncState: 'unresolvedConflicts', pendingOutboxCount: 0, unresolvedConflictCount: 2 }, proof);
    expect(overrideConflict.ok).toBe(true);
    expect(overrideConflict.decision).toEqual({ kind: 'erased' });

    // Unknown sync states stay blocked even with full proof: the override
    // covers enumerated intent only.
    const blockedUnknown = authorizeCacheErasure({ syncState: 'offlineUnknown', pendingOutboxCount: 0, unresolvedConflictCount: 0 }, proof);
    expect(blockedUnknown.ok).toBe(false);
    expect(blockedUnknown.decision.kind).not.toBe('erased');
    const blockedFailed = authorizeCacheErasure({ syncState: 'failedUnknown', pendingOutboxCount: 1, unresolvedConflictCount: 0 }, proof);
    expect(blockedFailed.ok).toBe(false);
    expect(blockedFailed.decision.kind).not.toBe('erased');
    // Unknown counts stay blocked even with full proof.
    const blockedCounts = authorizeCacheErasure({ syncState: 'pendingOutbox', pendingOutboxCount: -1, unresolvedConflictCount: 0 }, proof);
    expect(blockedCounts.ok).toBe(false);
    expect(blockedCounts.decision.kind).not.toBe('erased');
  });

  it('erases only with both a verified export and the exact destructive confirmation', () => {
    const clean = { syncState: 'acknowledged', pendingOutboxCount: 0, unresolvedConflictCount: 0 } as const;
    const proof = {
      verifiedExport: { exportId: 'export-1', verifiedAtInstantMs: 5_000, recordCount: 42, schemaVersion: 1 },
      destructiveConfirmation: { acknowledgementPhrase: 'ERASE-LOCAL-ACCOUNT-CACHE', confirmed: true },
    } as const;
    const allowed = authorizeCacheErasure(clean, proof);
    expect(allowed.ok).toBe(true);
    expect(allowed.decision).toEqual({ kind: 'erased' });

    // Every incomplete proof is rejected and the cache is retained.
    const incomplete: readonly unknown[] = [
      null,
      true,
      { force: true },
      { verifiedExport: proof.verifiedExport },
      { destructiveConfirmation: proof.destructiveConfirmation },
      { ...proof, destructiveConfirmation: { acknowledgementPhrase: 'ERASE-LOCAL-ACCOUNT-CACHE', confirmed: false } },
      { ...proof, destructiveConfirmation: { acknowledgementPhrase: 'yes', confirmed: true } },
      { ...proof, verifiedExport: { ...proof.verifiedExport, recordCount: -1 } },
      { ...proof, verifiedExport: { ...proof.verifiedExport, exportId: '' } },
    ];
    for (const request of incomplete) {
      const denied = authorizeCacheErasure(clean, request);
      expect(denied.ok, JSON.stringify(request)).toBe(false);
      expect(denied.decision.kind, JSON.stringify(request)).not.toBe('erased');
    }
  });
});
