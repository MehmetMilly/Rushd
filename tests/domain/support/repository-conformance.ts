/**
 * Reusable repository conformance suite (P03 Task D, corrected).
 *
 * This module exports the behavioral contract every Rushd repository adapter
 * must satisfy, as a factory-driven runner. P04 runs this same suite against
 * the persistent adapter without copying the test cases: a future adapter
 * only supplies the factory.
 *
 * The oracle is independent of any adapter implementation: it asserts
 * through the public production API (`previewCommand`/`executeCommand`),
 * canonical byte snapshots, and small hand-computed expectations. It never
 * imports the concrete `InMemoryFinanceRepository` and never copies an
 * adapter's reducer or transaction internals into expected results.
 *
 * Every handle is scope-bound: the factory takes a scope spec, contexts
 * carry the matching origin, and mismatched origins fail with an explicit
 * `scopeMismatch` before any read, replay, or mutation. Pulled batches are
 * content-bound: replay is exact only for the same batch identity and
 * content digest, changed content is an explicit conflict, and application
 * persists canonical pulled records together with the checkpoint.
 *
 * P03 proves the in-process reference adapter. This suite is not evidence of
 * browser crash durability: P04 must rerun it after real persistence,
 * reload, multi-tab, quota, and physical-device scenarios exist.
 */

import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  executeCommand,
  previewCommand,
  stableDigest,
  type CommandReceipt,
  type DeliveryAttemptOutcome,
  type OperationRecord,
  type OutboxDeliveryState,
  type OutboxEnvelope,
} from '../../../src/application/commands';
import type { BookId, OperationId } from '../../../src/domain/contracts/identity';
import { makeBookId, makeOperationId } from '../../../src/domain/contracts/identity';
import type { FinanceReadModel, ScopedRepository } from '../../../src/domain/contracts/repository';
import {
  computePulledBatchDigest,
  makeReplicationStreamId,
  makeSyncCursor,
  type PulledBatch,
  type PulledContentConflict,
  type PulledOperation,
  type ReplicationStreamId,
  type SyncCursor,
} from '../../../src/domain/sync/cursors';
import { makeAccountId as makeScopeAccountId, makeDeviceId as makeScopeDeviceId, makeGuestKey as makeScopeGuestKey, repositoryScopeIdFor } from '../../../src/domain/sync/scope';
import { createDeterministicContext, DEFAULT_GUEST_KEY } from './deterministic-context';
import type { CommandContext } from '../../../src/application/commands/context';

export type ConformanceWriteMethod = 'putBookState' | 'putOperation' | 'putOutboxEntry' | 'putDeliveryState';

/** Structural result of a checkpoint batch application. Adapters return a compatible shape. */
export type ConformanceApplyResult =
  | { readonly ok: true; readonly replayed: boolean }
  | { readonly ok: false; readonly reason: 'unsupportedSchema' | 'invalidBatch' | 'baseCursorMismatch' | 'injectedFailure' }
  | { readonly ok: false; readonly reason: 'contentConflict'; readonly conflict: PulledContentConflict };

/** The test hooks a conformance adapter must expose. Clearly test-adapter-specific; not part of the production port. */
export interface ConformanceAdapter extends ScopedRepository, FinanceReadModel {
  getOperation(operationId: OperationId): OperationRecord | null;
  listOutbox(): readonly OutboxEnvelope[];
  getDeliveryState(operationId: OperationId): OutboxDeliveryState | null;
  updateDeliveryState(operationId: OperationId, outcome: DeliveryAttemptOutcome): Promise<OutboxDeliveryState>;
  injectWriteFailure(method: ConformanceWriteMethod, occurrences?: number): void;
  /** A fresh handle over the same durable state (adapter reacquisition after a lost acknowledgement). */
  reopen(): ConformanceAdapter;
  /** Canonical bytes of everything committed, for byte-identical rollback proofs. */
  snapshotBytes(): string;
}

export interface ConformanceCheckpointStore {
  cursorFor(streamId: ReplicationStreamId): SyncCursor | null;
  batchDigestFor(streamId: ReplicationStreamId): string | null;
  applyBatch(batch: PulledBatch): ConformanceApplyResult;
  injectApplyFailure(occurrences?: number): void;
  appliedOperations(streamId: ReplicationStreamId): readonly PulledOperation[];
  appliedOperationIds(streamId: ReplicationStreamId): readonly string[];
  snapshotBytes(): string;
}

/** Scope a conformance adapter handle (and its matching contexts) is bound to. */
export interface ConformanceScopeSpec {
  readonly deviceId: string;
  readonly accountId?: string;
  readonly scopeId?: string;
}

export interface ConformanceFixture {
  readonly name: string;
  createAdapter(scope?: ConformanceScopeSpec): ConformanceAdapter;
  createCheckpointStore(): ConformanceCheckpointStore;
}

function brandedBookId(raw: string): BookId {
  const made = makeBookId(raw);
  if (!made.ok) throw new Error(`invalid conformance book id: ${raw}`);
  return made.value;
}

function brandedOperationId(raw: string): OperationId {
  const made = makeOperationId(raw);
  if (!made.ok) throw new Error(`invalid conformance operation id: ${raw}`);
  return made.value;
}

function brandedCursor(raw: string): SyncCursor {
  const made = makeSyncCursor(raw);
  if (!made.ok) throw new Error(`invalid conformance cursor: ${raw}`);
  return made.value;
}

function brandedStream(raw: string): ReplicationStreamId {
  const made = makeReplicationStreamId(raw);
  if (!made.ok) throw new Error(`invalid conformance stream: ${raw}`);
  return made.value;
}

function brandedDeviceId(raw: string): import('../../../src/domain/sync/scope').DeviceId {
  const made = makeScopeDeviceId(raw);
  if (!made.ok) throw new Error(`invalid conformance device id: ${raw}`);
  return made.value;
}

function scopeIdForSpec(spec: ConformanceScopeSpec): string {
  if (spec.scopeId !== undefined) return spec.scopeId;
  const device = brandedDeviceId(spec.deviceId);
  if (spec.accountId !== undefined) {
    const account = makeScopeAccountId(spec.accountId);
    if (!account.ok) throw new Error(`invalid conformance account id: ${spec.accountId}`);
    return repositoryScopeIdFor({ kind: 'account', accountId: account.value, deviceId: device }) as string;
  }
  const guest = makeScopeGuestKey(DEFAULT_GUEST_KEY);
  if (!guest.ok) throw new Error('invalid conformance guest default');
  return repositoryScopeIdFor({ kind: 'guest', guestKey: guest.value, deviceId: device }) as string;
}

function contextForSpec(spec: ConformanceScopeSpec): CommandContext {
  const { context } = createDeterministicContext({ deviceId: spec.deviceId, ...(spec.accountId !== undefined ? { accountId: spec.accountId } : {}), ...(spec.scopeId !== undefined ? { scopeId: spec.scopeId } : {}) });
  return context;
}

interface Harness {
  readonly adapter: ConformanceAdapter;
  readonly checkpoints: ConformanceCheckpointStore;
  readonly context: CommandContext;
  readonly spec: ConformanceScopeSpec;
}

const DEFAULT_SPEC: ConformanceScopeSpec = { deviceId: 'test-device-0001' };

const CREATE_BOOK = {
  kind: 'createBook',
  bookId: 'book-conformance',
  displayName: 'conformance book',
  currency: 'SAR',
  timeZone: 'Asia/Riyadh',
  cycleAnchor: { kind: 'firstOfMonth' },
} as const;

const OPEN_CYCLE = {
  kind: 'openCycle',
  bookId: 'book-conformance',
  startDate: '2026-09-01',
  startingFunds: { currency: 'SAR', minorUnits: 100_000 },
} as const;

function inflowCommand(amount: number, day: string, note: string): Record<string, unknown> {
  return {
    kind: 'recordInflow',
    bookId: 'book-conformance',
    amount: { currency: 'SAR', minorUnits: amount },
    occurredAt: { kind: 'civilDate', localDate: day },
    note,
  };
}

async function previewAndExecute(harness: Harness, operationId: string, rawCommand: unknown): Promise<CommandReceipt> {
  const preview = previewCommand(harness.adapter, rawCommand, harness.context);
  expect(preview.ok, preview.ok ? undefined : `preview failed: ${JSON.stringify(preview)}`).toBe(true);
  if (!preview.ok) throw new Error('unreachable');
  const result = await executeCommand(
    harness.adapter,
    rawCommand,
    { operationId: brandedOperationId(operationId), expectedRevision: preview.preview.expectedRevision, previewDigest: preview.preview.previewDigest },
    harness.context,
  );
  expect(result.ok, result.ok ? undefined : `execute failed: ${JSON.stringify(result)}`).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.receipt;
}

function seededHarness(fixture: ConformanceFixture, spec: ConformanceScopeSpec = DEFAULT_SPEC, stepMs?: number): Harness {
  const adapter = fixture.createAdapter(spec);
  const checkpoints = fixture.createCheckpointStore();
  const { context } = createDeterministicContext({
    deviceId: spec.deviceId,
    ...(spec.accountId !== undefined ? { accountId: spec.accountId } : {}),
    ...(spec.scopeId !== undefined ? { scopeId: spec.scopeId } : {}),
    ...(stepMs !== undefined ? { stepMs } : {}),
  });
  // The factory binding and the context origin must name the same scope;
  // otherwise the harness itself is misconfigured, not the adapter.
  expect(adapter.boundScope as string).toBe(scopeIdForSpec(spec));
  expect(context.origin.scopeId as string).toBe(scopeIdForSpec(spec));
  return { adapter, checkpoints, context, spec };
}

async function seedBook(harness: Harness): Promise<void> {
  await previewAndExecute(harness, 'op-create', { ...CREATE_BOOK });
  await previewAndExecute(harness, 'op-cycle', { ...OPEN_CYCLE });
}

/** Content envelope for a locally committed operation, as a pull stream would carry it. */
function pulledEnvelope(receipt: CommandReceipt, sequence: number): PulledOperation {
  return {
    operationId: receipt.operationId,
    sequence,
    scopeId: receipt.scopeId,
    bookId: receipt.bookId,
    baseRevision: receipt.revisionBefore,
    resultingRevision: receipt.revisionAfter,
    canonicalDigest: receipt.canonicalDigest,
    schemaVersion: 1,
  };
}

function pulledBatch(stream: ReplicationStreamId, batchId: string, base: SyncCursor | null, operations: readonly PulledOperation[], next: SyncCursor): PulledBatch {
  return {
    schemaVersion: 1,
    streamId: stream,
    batchId,
    batchDigest: computePulledBatchDigest(operations),
    baseCursor: base,
    operations,
    nextCursor: next,
  };
}

export function runRepositoryConformanceSuite(fixture: ConformanceFixture): void {
  const bookId = brandedBookId('book-conformance');

  describe(`repository conformance (${fixture.name})`, () => {
    it('returns defensive, non-aliasing reads', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      const first = harness.adapter.getBookState(bookId);
      const second = harness.adapter.getBookState(bookId);
      expect(first).not.toBeNull();
      expect(first).not.toBe(second);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(Object.isFrozen(first)).toBe(true);
      expect(() => {
        (first as { revision: number }).revision = 999_999;
      }).toThrow(TypeError);
      expect(() => {
        (first?.entries as unknown as unknown[]).push({ kind: 'inflow' });
      }).toThrow(TypeError);
      const reread = harness.adapter.getBookState(bookId);
      expect(JSON.stringify(reread)).toBe(JSON.stringify(first));
    });

    it('isolates transactions and supports read-your-own-write', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      const revisionBefore = harness.adapter.getBookState(bookId)?.revision ?? 0;

      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let observedInside: number | null = null;
      const parked = harness.adapter.runTransaction(async (transaction) => {
        const state = transaction.getBookState(bookId);
        if (state === null) throw new Error('book disappeared during test');
        await gate;
        transaction.putBookState({ ...state, revision: state.revision + 1, entries: [...state.entries] });
        observedInside = transaction.getBookState(bookId)?.revision ?? null;
      });
      expect(harness.adapter.getBookState(bookId)?.revision).toBe(revisionBefore);
      release();
      await parked;
      expect(observedInside).toBe(revisionBefore + 1);
      expect(harness.adapter.getBookState(bookId)?.revision).toBe(revisionBefore + 1);
    });

    it('advances exactly one revision and lets the first committer win', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      const revisionBefore = harness.adapter.getBookState(bookId)?.revision ?? 0;
      const commandA = inflowCommand(1_000, '2026-09-10', 'A');
      const commandB = inflowCommand(2_000, '2026-09-11', 'B');
      const previewA = previewCommand(harness.adapter, commandA, harness.context);
      const previewB = previewCommand(harness.adapter, commandB, harness.context);
      expect(previewA.ok && previewB.ok).toBe(true);
      if (!previewA.ok || !previewB.ok) throw new Error('unreachable');
      const first = await executeCommand(
        harness.adapter,
        commandA,
        { operationId: brandedOperationId('op-first'), expectedRevision: previewA.preview.expectedRevision, previewDigest: previewA.preview.previewDigest },
        harness.context,
      );
      expect(first.ok).toBe(true);
      const second = await executeCommand(
        harness.adapter,
        commandB,
        { operationId: brandedOperationId('op-second'), expectedRevision: previewB.preview.expectedRevision, previewDigest: previewB.preview.previewDigest },
        harness.context,
      );
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.failure.kind).toBe('revisionConflict');
      expect(harness.adapter.getBookState(bookId)?.revision).toBe(revisionBefore + 1);
    });

    it('commits state, operation, outbox intent, and durable sequence atomically', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      const command = inflowCommand(5_000, '2026-09-12', 'atomic');
      const receipt = await previewAndExecute(harness, 'op-atomic', command);
      const journal = harness.adapter.getOperation(brandedOperationId('op-atomic'));
      expect(journal).not.toBeNull();
      expect(journal?.canonicalCommand).toBe(canonicalJson(command));
      const outbox = harness.adapter.listOutbox();
      const intent = outbox.find((envelope) => (envelope.operationId as string) === 'op-atomic');
      expect(intent).toBeDefined();
      expect(receipt.enqueueSequence).toBeGreaterThan(0);
      expect(journal?.enqueueSequence).toBe(receipt.enqueueSequence);
      expect(intent?.enqueueSequence).toBe(receipt.enqueueSequence);
      expect(intent?.revisionAfter).toBe(receipt.revisionAfter);
      expect(intent?.scopeId).toBe(receipt.scopeId);
      expect(intent?.sourceDeviceId).toBe(receipt.sourceDeviceId);
      expect(receipt.schemaVersion).toBe(1);
      expect(journal?.schemaVersion).toBe(1);
      expect(intent?.schemaVersion).toBe(1);
      expect(receipt.revisionAfter).toBe(receipt.revisionBefore + 1);
    });

    it('rolls back every tentative write and checkpoint step byte-identically', async () => {
      const command = inflowCommand(7_000, '2026-09-13', 'rollback');
      for (const method of ['putBookState', 'putOperation', 'putOutboxEntry'] as const) {
        const harness = seededHarness(fixture);
        await seedBook(harness);
        const before = harness.adapter.snapshotBytes();
        const failedId = brandedOperationId(`op-fail-${method}`);
        harness.adapter.injectWriteFailure(method);
        const preview = previewCommand(harness.adapter, command, harness.context);
        expect(preview.ok).toBe(true);
        if (!preview.ok) throw new Error('unreachable');
        await expect(
          executeCommand(
            harness.adapter,
            command,
            { operationId: failedId, expectedRevision: preview.preview.expectedRevision, previewDigest: preview.preview.previewDigest },
            harness.context,
          ),
        ).rejects.toThrow(`injected adapter failure at ${method}`);
        expect(harness.adapter.snapshotBytes()).toBe(before);
        expect(harness.adapter.getOperation(failedId)).toBeNull();
        const bytesBeforeRetry = harness.adapter.snapshotBytes();
        const recovered = await previewAndExecute(harness, `op-fail-${method}`, command);
        expect(recovered.operationId as string).toBe(`op-fail-${method}`);
        expect(harness.adapter.snapshotBytes()).not.toBe(bytesBeforeRetry);
        expect(harness.adapter.getOperation(failedId)).not.toBeNull();
      }

      const harness = seededHarness(fixture);
      await seedBook(harness);
      const stream = brandedStream('stream-conformance');
      const seedReceipt = await previewAndExecute(harness, 'op-checkpoint-seed', inflowCommand(100, '2026-09-19', 'checkpoint-seed'));
      const batch = pulledBatch(stream, 'batch-1', null, [pulledEnvelope(seedReceipt, 1)], brandedCursor('cursor-1'));
      const checkpointBefore = harness.checkpoints.snapshotBytes();
      harness.checkpoints.injectApplyFailure();
      const failed = harness.checkpoints.applyBatch(batch);
      expect(failed).toEqual({ ok: false, reason: 'injectedFailure' });
      expect(harness.checkpoints.snapshotBytes()).toBe(checkpointBefore);
      expect(harness.checkpoints.cursorFor(stream)).toBeNull();
      const recovered = harness.checkpoints.applyBatch(batch);
      expect(recovered).toEqual({ ok: true, replayed: false });
      expect(harness.checkpoints.cursorFor(stream)).toBe(brandedCursor('cursor-1'));
    });

    it('replays same-ID/same-payload receipts and rejects same-ID/different-payload', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      const command = inflowCommand(9_000, '2026-09-14', 'replay');
      const operationId = brandedOperationId('op-replay');
      const first = await previewAndExecute(harness, 'op-replay', command);
      const outboxBefore = harness.adapter.listOutbox().length;
      const retry = await executeCommand(
        harness.adapter,
        command,
        { operationId, expectedRevision: first.revisionBefore, previewDigest: stableDigest(`${canonicalJson(command)}\n${String(first.revisionBefore)}`) },
        harness.context,
      );
      expect(retry.ok).toBe(true);
      if (retry.ok) {
        expect(retry.retried).toBe(true);
        expect(retry.receipt).toEqual(first);
      }
      expect(harness.adapter.listOutbox()).toHaveLength(outboxBefore);

      const altered = inflowCommand(99_999, '2026-09-14', 'replay');
      const bytesBefore = harness.adapter.snapshotBytes();
      const alteredPreview = previewCommand(harness.adapter, altered, harness.context);
      expect(alteredPreview.ok).toBe(true);
      if (!alteredPreview.ok) throw new Error('unreachable');
      const conflict = await executeCommand(
        harness.adapter,
        altered,
        { operationId, expectedRevision: alteredPreview.preview.expectedRevision, previewDigest: alteredPreview.preview.previewDigest },
        harness.context,
      );
      expect(conflict.ok).toBe(false);
      if (!conflict.ok) expect(conflict.failure).toEqual({ kind: 'operationIdConflict', operationId });
      expect(harness.adapter.snapshotBytes()).toBe(bytesBefore);
    });

    it('rejects stale previews and accepts a refreshed retry', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      const revisionBefore = harness.adapter.getBookState(bookId)?.revision ?? 0;
      const command = inflowCommand(3_000, '2026-09-15', 'stale');
      const stalePreview = previewCommand(harness.adapter, command, harness.context);
      expect(stalePreview.ok).toBe(true);
      if (!stalePreview.ok) throw new Error('unreachable');
      await previewAndExecute(harness, 'op-advancer', inflowCommand(1, '2026-09-16', 'advancer'));
      const stale = await executeCommand(
        harness.adapter,
        command,
        { operationId: brandedOperationId('op-stale'), expectedRevision: stalePreview.preview.expectedRevision, previewDigest: stalePreview.preview.previewDigest },
        harness.context,
      );
      expect(stale.ok).toBe(false);
      if (!stale.ok) {
        expect(stale.failure).toEqual({
          kind: 'revisionConflict',
          bookId: 'book-conformance',
          expectedRevision: revisionBefore,
          actualRevision: revisionBefore + 1,
        });
      }
      const refreshed = await previewAndExecute(harness, 'op-stale', command);
      expect(refreshed.revisionAfter).toBe(revisionBefore + 2);
    });

    it('returns the original receipt after a lost acknowledgement and adapter reacquisition', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      const command = inflowCommand(12_345, '2026-09-17', 'uncertain');
      const operationId = brandedOperationId('op-uncertain');
      const committed = await previewAndExecute(harness, 'op-uncertain', command);
      const outboxAfterCommit = harness.adapter.listOutbox().length;

      await previewAndExecute(harness, 'op-later', inflowCommand(500, '2026-09-18', 'later'));
      const bytesSettled = harness.adapter.snapshotBytes();

      const reacquired = harness.adapter.reopen();
      expect(reacquired.boundScope as string).toBe(harness.adapter.boundScope as string);
      const retry = await executeCommand(
        reacquired,
        command,
        { operationId, expectedRevision: committed.revisionBefore, previewDigest: stableDigest(`${canonicalJson(command)}\n${String(committed.revisionBefore)}`) },
        harness.context,
      );
      expect(retry.ok).toBe(true);
      if (retry.ok) {
        expect(retry.retried).toBe(true);
        expect(retry.receipt).toEqual(committed);
      }
      expect(reacquired.listOutbox()).toHaveLength(outboxAfterCommit + 1);
      expect(reacquired.getBookState(bookId)?.entries.filter((entry) => entry.note === 'uncertain')).toHaveLength(1);
      expect(reacquired.snapshotBytes()).toBe(bytesSettled);
    });

    it('persists delivery attempts atomically, rolls back failures, and retries exactly once', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      const command = inflowCommand(11_000, '2026-09-23', 'delivery');
      await previewAndExecute(harness, 'op-delivery', command);
      const operationId = brandedOperationId('op-delivery');

      expect(harness.adapter.getDeliveryState(operationId)).toBeNull();
      const before = harness.adapter.snapshotBytes();

      // A tentative/commit failure at the delivery boundary leaves the
      // entire persisted snapshot byte-identical: no delivery record appears.
      harness.adapter.injectWriteFailure('putDeliveryState');
      await expect(harness.adapter.updateDeliveryState(operationId, { ok: false, error: 'timeout', nextRetryAtMs: 1_000 })).rejects.toThrow(
        'injected adapter failure at putDeliveryState',
      );
      expect(harness.adapter.snapshotBytes()).toBe(before);
      expect(harness.adapter.getDeliveryState(operationId)).toBeNull();

      // Exactly one successful retry records the attempt; canonical history is untouched.
      const journalBefore = harness.adapter.getOperation(operationId)?.canonicalCommand;
      const recorded = await harness.adapter.updateDeliveryState(operationId, { ok: false, error: 'timeout', nextRetryAtMs: 1_000 });
      expect(recorded.attempts).toBe(1);
      expect(recorded.lastError).toBe('timeout');
      expect(recorded.acknowledged).toBe(false);
      expect(harness.adapter.getOperation(operationId)?.canonicalCommand).toBe(journalBefore);

      // Reacquisition preserves the persisted delivery state with exactly one attempt.
      const reacquired = harness.adapter.reopen();
      expect(reacquired.getDeliveryState(operationId)?.attempts).toBe(1);

      // Delivery metadata never exists without its intent.
      await expect(harness.adapter.updateDeliveryState(brandedOperationId('op-unknown'), { ok: true })).rejects.toThrow('unknown operation for delivery update');
    });

    it('applies duplicate and reordered pulled delivery exactly once with content intact', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      const first = await previewAndExecute(harness, 'op-dup-1', inflowCommand(100, '2026-09-19', 'dup-1'));
      const second = await previewAndExecute(harness, 'op-dup-2', inflowCommand(200, '2026-09-20', 'dup-2'));

      // Envelopes carry the canonical digests of really committed operations.
      const envelopeA = pulledEnvelope(first, 1);
      const envelopeB = pulledEnvelope(second, 2);
      const journalA = harness.adapter.getOperation(brandedOperationId('op-dup-1'));
      expect(envelopeA.canonicalDigest).toBe(journalA?.receipt.canonicalDigest);

      const stream = brandedStream('stream-duplicates');
      const batch = pulledBatch(stream, 'batch-dup-1', null, [envelopeB, envelopeA, envelopeB], brandedCursor('cursor-dup-1'));
      const appliedFirst = harness.checkpoints.applyBatch(batch);
      expect(appliedFirst).toEqual({ ok: true, replayed: false });

      // One canonical applied record per operation, content intact.
      const applied = harness.checkpoints.appliedOperations(stream);
      expect(applied).toHaveLength(2);
      expect([...harness.checkpoints.appliedOperationIds(stream)].sort()).toEqual(['op-dup-1', 'op-dup-2']);
      const storedA = applied.find((operation) => (operation.operationId as string) === 'op-dup-1');
      expect(storedA?.canonicalDigest).toBe(journalA?.receipt.canonicalDigest);
      expect(storedA?.baseRevision).toBe(journalA?.receipt.revisionBefore);
      expect(storedA?.resultingRevision).toBe(journalA?.receipt.revisionAfter);

      // Literal replay is a no-op success, never a second record.
      const replayed = harness.checkpoints.applyBatch(batch);
      expect(replayed).toEqual({ ok: true, replayed: true });
      expect(harness.checkpoints.appliedOperations(stream)).toHaveLength(2);
    });

    it('rejects changed pulled content without advancing the checkpoint', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      const receipt = await previewAndExecute(harness, 'op-content-1', inflowCommand(300, '2026-09-24', 'content-1'));
      const stream = brandedStream('stream-content');

      // Same cursor carrying a different operation is not a replay: explicit
      // conflict, cursor stays, nothing applied.
      const original = pulledBatch(stream, 'batch-content-1', null, [pulledEnvelope(receipt, 1)], brandedCursor('cursor-content-1'));
      expect(harness.checkpoints.applyBatch(original)).toEqual({ ok: true, replayed: false });

      // A changed duplicate inside one batch is a content conflict.
      const conflicting = pulledBatch(stream, 'batch-content-2', brandedCursor('cursor-content-1'), [
        { ...pulledEnvelope(receipt, 9), canonicalDigest: 'aaaaaaaaaaaaaaaa' },
      ], brandedCursor('cursor-content-2'));
      const bytesBefore = harness.checkpoints.snapshotBytes();
      const result = harness.checkpoints.applyBatch(conflicting);
      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === 'contentConflict') {
        expect(result.conflict.operationId).toBe('op-content-1');
      } else {
        throw new Error(`expected contentConflict, got ${JSON.stringify(result)}`);
      }
      expect(harness.checkpoints.snapshotBytes()).toBe(bytesBefore);
      expect(harness.checkpoints.cursorFor(stream)).toBe(brandedCursor('cursor-content-1'));

      // Same operation ID with changed content in a fresh batch also conflicts.
      const altered = { ...pulledEnvelope(receipt, 9), canonicalDigest: 'bbbbbbbbbbbbbbbb' };
      const alteredBatch = pulledBatch(stream, 'batch-content-3', brandedCursor('cursor-content-1'), [altered], brandedCursor('cursor-content-3'));
      const alteredResult = harness.checkpoints.applyBatch(alteredBatch);
      expect(alteredResult.ok).toBe(false);
      if (!alteredResult.ok) expect(alteredResult.reason).toBe('contentConflict');
      expect(harness.checkpoints.cursorFor(stream)).toBe(brandedCursor('cursor-content-1'));
    });

    it('rejects cross-book references and isolates bound scopes', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      await previewAndExecute(harness, 'op-create-second', {
        kind: 'createBook',
        bookId: 'book-second',
        displayName: 'second',
        currency: 'SAR',
        timeZone: 'Asia/Riyadh',
        cycleAnchor: { kind: 'firstOfMonth' },
      });
      await previewAndExecute(harness, 'op-cycle-second', {
        kind: 'openCycle',
        bookId: 'book-second',
        startDate: '2026-09-01',
        startingFunds: { currency: 'SAR', minorUnits: 0 },
      });
      await previewAndExecute(harness, 'op-inflow-second', {
        kind: 'recordInflow',
        bookId: 'book-second',
        amount: { currency: 'SAR', minorUnits: 500 },
        occurredAt: { kind: 'civilDate', localDate: '2026-09-10' },
        note: '',
      });
      const otherEntryId = harness.adapter.getBookState(brandedBookId('book-second'))?.entries[0]?.entryId;
      expect(otherEntryId).toBeTruthy();

      const revisionBefore = harness.adapter.getBookState(bookId)?.revision;
      const outboxBefore = harness.adapter.listOutbox().length;
      const command = {
        kind: 'reverseInflow',
        bookId: 'book-conformance',
        inflowEntryId: otherEntryId,
        occurredAt: { kind: 'civilDate', localDate: '2026-09-10' },
        note: '',
      };
      const preview = previewCommand(harness.adapter, command, harness.context);
      expect(preview.ok).toBe(false);
      if (!preview.ok) {
        expect(preview.failure.kind).toBe('crossBookReference');
        if (preview.failure.kind === 'crossBookReference') {
          expect(preview.failure.entryBookId).toBe('book-second');
        }
      }
      expect(harness.adapter.getBookState(bookId)?.revision).toBe(revisionBefore);
      expect(harness.adapter.listOutbox()).toHaveLength(outboxBefore);

      // A second bound scope seeds the same raw book independently: same
      // IDs, unrelated records, per-scope operation uniqueness.
      const specB: ConformanceScopeSpec = { deviceId: 'test-device-0002' };
      const harnessB = seededHarness(fixture, specB);
      await seedBook(harnessB);
      expect(harnessB.adapter.boundScope as string).not.toBe(harness.adapter.boundScope as string);
      const commandB = inflowCommand(77, '2026-09-21', 'scope-b');
      const receiptB = await previewAndExecute(harnessB, 'op-shared-scope', commandB);
      expect(receiptB.scopeId as string).toBe(harnessB.adapter.boundScope as string);
      // The same raw operation ID is unknown in scope A: per-scope journals.
      expect(harness.adapter.getOperation(brandedOperationId('op-shared-scope'))).toBeNull();
    });

    it('rejects mismatched-context attempts on bound scopes before any read, replay, or mutation', async () => {
      const specA: ConformanceScopeSpec = { deviceId: 'test-device-000a' };
      const specB: ConformanceScopeSpec = { deviceId: 'test-device-000b' };
      const harnessA = seededHarness(fixture, specA);
      await seedBook(harnessA);
      const harnessB = seededHarness(fixture, specB);
      await seedBook(harnessB);
      const contextB = contextForSpec(specB);

      const command = inflowCommand(5, '2026-09-10', 'intruder');

      const preview = previewCommand(harnessA.adapter, command, contextB);
      expect(preview.ok).toBe(false);
      if (!preview.ok) expect(preview.failure.kind).toBe('scopeMismatch');

      const revisionA = harnessA.adapter.getBookState(bookId)?.revision ?? 0;
      const digest = stableDigest(`${canonicalJson(command)}\n${String(revisionA)}`);
      const executed = await executeCommand(
        harnessA.adapter,
        command,
        { operationId: brandedOperationId('op-intruder'), expectedRevision: revisionA, previewDigest: digest },
        contextB,
      );
      expect(executed.ok).toBe(false);
      if (!executed.ok) expect(executed.failure.kind).toBe('scopeMismatch');

      // Even a byte-identical replay of scope A's committed operation fails
      // closed under scope B's origin instead of returning A's receipt.
      const committed = await previewAndExecute(harnessA, 'op-owned-a', inflowCommand(600, '2026-09-22', 'owned-a'));
      const bytesOwned = harnessA.adapter.snapshotBytes();
      const replay = await executeCommand(
        harnessA.adapter,
        inflowCommand(600, '2026-09-22', 'owned-a'),
        {
          operationId: brandedOperationId('op-owned-a'),
          expectedRevision: committed.revisionBefore,
          previewDigest: stableDigest(`${canonicalJson(inflowCommand(600, '2026-09-22', 'owned-a'))}\n${String(committed.revisionBefore)}`),
        },
        contextB,
      );
      expect(replay.ok).toBe(false);
      if (!replay.ok) expect(replay.failure.kind).toBe('scopeMismatch');
      expect(harnessA.adapter.snapshotBytes()).toBe(bytesOwned);

      // The only writes are scope A's own: intruder attempts left no trace.
      expect(harnessA.adapter.getBookState(bookId)?.entries.filter((entry) => entry.note === 'intruder')).toHaveLength(0);
      expect(harnessA.adapter.getOperation(brandedOperationId('op-intruder'))).toBeNull();
    });

    it('applies pulled batches and checkpoints atomically with content', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      const first = await previewAndExecute(harness, 'op-pull-1', inflowCommand(400, '2026-09-25', 'pull-1'));
      const second = await previewAndExecute(harness, 'op-pull-2', inflowCommand(500, '2026-09-26', 'pull-2'));
      const stream = brandedStream('stream-atomic');
      const batch = pulledBatch(stream, 'batch-atomic-1', null, [pulledEnvelope(first, 1), pulledEnvelope(second, 2)], brandedCursor('cursor-atomic-1'));
      const applied = harness.checkpoints.applyBatch(batch);
      expect(applied).toEqual({ ok: true, replayed: false });
      expect(harness.checkpoints.cursorFor(stream)).toBe(brandedCursor('cursor-atomic-1'));
      expect(harness.checkpoints.batchDigestFor(stream)).toBe(batch.batchDigest);
      expect(harness.checkpoints.appliedOperationIds(stream)).toEqual(['op-pull-1', 'op-pull-2']);
      const stored = harness.checkpoints.appliedOperations(stream);
      expect(stored.find((operation) => (operation.operationId as string) === 'op-pull-1')?.canonicalDigest).toBe(first.canonicalDigest);

      const stale = pulledBatch(stream, 'batch-atomic-2', null, [pulledEnvelope(first, 1)], brandedCursor('cursor-atomic-2'));
      const bytesBefore = harness.checkpoints.snapshotBytes();
      const rejected = harness.checkpoints.applyBatch(stale);
      expect(rejected).toEqual({ ok: false, reason: 'baseCursorMismatch' });
      expect(harness.checkpoints.snapshotBytes()).toBe(bytesBefore);

      const next = pulledBatch(stream, 'batch-atomic-3', brandedCursor('cursor-atomic-1'), [pulledEnvelope(second, 2)], brandedCursor('cursor-atomic-2'));
      expect(harness.checkpoints.applyBatch(next)).toEqual({ ok: true, replayed: false });
      expect(harness.checkpoints.cursorFor(stream)).toBe(brandedCursor('cursor-atomic-2'));
      // The already-applied operation was not duplicated.
      expect(harness.checkpoints.appliedOperations(stream)).toHaveLength(2);
    });

    it('orders fixed-clock commits by durable sequence only', async () => {
      const harness = seededHarness(fixture, DEFAULT_SPEC, 0);
      await seedBook(harness);
      const first = await previewAndExecute(harness, 'op-fixed-1', inflowCommand(10, '2026-09-22', 'fixed-1'));
      const second = await previewAndExecute(harness, 'op-fixed-2', inflowCommand(20, '2026-09-23', 'fixed-2'));
      const third = await previewAndExecute(harness, 'op-fixed-3', inflowCommand(30, '2026-09-24', 'fixed-3'));
      expect(first.committedAtInstantMs).toBe(second.committedAtInstantMs);
      expect(second.committedAtInstantMs).toBe(third.committedAtInstantMs);
      expect(second.enqueueSequence).toBeGreaterThan(first.enqueueSequence);
      expect(third.enqueueSequence).toBeGreaterThan(second.enqueueSequence);
      const intents = harness.adapter.listOutbox().filter((envelope) => (envelope.operationId as string).startsWith('op-fixed-'));
      expect(intents.map((intent) => intent.operationId as string)).toEqual(['op-fixed-1', 'op-fixed-2', 'op-fixed-3']);
      expect(intents.map((intent) => intent.enqueueSequence)).toEqual([first.enqueueSequence, second.enqueueSequence, third.enqueueSequence]);
    });
  });
}
