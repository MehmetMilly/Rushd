/**
 * Reusable repository conformance suite (P03 Task D).
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
  type OperationRecord,
  type OutboxEnvelope,
} from '../../../src/application/commands';
import type { BookId, OperationId } from '../../../src/domain/contracts/identity';
import { makeBookId, makeOperationId } from '../../../src/domain/contracts/identity';
import type { FinanceReadModel, TransactionalRepository } from '../../../src/domain/contracts/repository';
import type { PulledBatch, ReplicationStreamId, SyncCursor } from '../../../src/domain/sync/cursors';
import { makeReplicationStreamId, makeSyncCursor } from '../../../src/domain/sync/cursors';
import { createDeterministicContext } from './deterministic-context';
import type { CommandContext } from '../../../src/application/commands/context';

export type ConformanceWriteMethod = 'putBookState' | 'putOperation' | 'putOutboxEntry';

/** Structural result of a checkpoint batch application. Adapters return a compatible shape. */
export type ConformanceApplyResult =
  | { readonly ok: true; readonly replayed: boolean }
  | { readonly ok: false; readonly reason: 'unsupportedSchema' | 'invalidBatch' | 'baseCursorMismatch' | 'injectedFailure' };

/** The test hooks a conformance adapter must expose. Clearly test-adapter-specific; not part of the production port. */
export interface ConformanceAdapter extends TransactionalRepository, FinanceReadModel {
  getOperation(operationId: OperationId): OperationRecord | null;
  listOutbox(): readonly OutboxEnvelope[];
  injectWriteFailure(method: ConformanceWriteMethod, occurrences?: number): void;
  /** A fresh handle over the same durable state (adapter reacquisition after a lost acknowledgement). */
  reopen(): ConformanceAdapter;
  /** Canonical bytes of everything committed, for byte-identical rollback proofs. */
  snapshotBytes(): string;
}

export interface ConformanceCheckpointStore {
  cursorFor(streamId: ReplicationStreamId): SyncCursor | null;
  applyBatch(batch: PulledBatch): ConformanceApplyResult;
  injectApplyFailure(occurrences?: number): void;
  appliedOperationIds(streamId: ReplicationStreamId): readonly string[];
  snapshotBytes(): string;
}

export interface ConformanceFixture {
  readonly name: string;
  createAdapter(): ConformanceAdapter;
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

interface Harness {
  readonly adapter: ConformanceAdapter;
  readonly checkpoints: ConformanceCheckpointStore;
  readonly context: CommandContext;
}

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

async function seededHarness(fixture: ConformanceFixture, stepMs?: number): Promise<Harness> {
  const adapter = fixture.createAdapter();
  const checkpoints = fixture.createCheckpointStore();
  const { context } = createDeterministicContext({ ...(stepMs !== undefined ? { stepMs } : {}) });
  const harness: Harness = { adapter, checkpoints, context };
  await previewAndExecute(harness, 'op-create', { ...CREATE_BOOK });
  await previewAndExecute(harness, 'op-cycle', { ...OPEN_CYCLE });
  return harness;
}

export function runRepositoryConformanceSuite(fixture: ConformanceFixture): void {
  const bookId = brandedBookId('book-conformance');

  describe(`repository conformance (${fixture.name})`, () => {
    it('returns defensive, non-aliasing reads', async () => {
      const harness = await seededHarness(fixture);
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
      const harness = await seededHarness(fixture);
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
        // Read-your-own-write inside the parked transaction.
        transaction.putBookState({ ...state, revision: state.revision + 1, entries: [...state.entries] });
        observedInside = transaction.getBookState(bookId)?.revision ?? null;
      });
      // While parked, the committed view is unchanged: uncommitted writes are invisible outside.
      expect(harness.adapter.getBookState(bookId)?.revision).toBe(revisionBefore);
      release();
      await parked;
      expect(observedInside).toBe(revisionBefore + 1);
      expect(harness.adapter.getBookState(bookId)?.revision).toBe(revisionBefore + 1);
    });

    it('advances exactly one revision and lets the first committer win', async () => {
      const harness = await seededHarness(fixture);
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
      const harness = await seededHarness(fixture);
      const command = inflowCommand(5_000, '2026-09-12', 'atomic');
      const receipt = await previewAndExecute(harness, 'op-atomic', command);
      const journal = harness.adapter.getOperation(brandedOperationId('op-atomic'));
      expect(journal).not.toBeNull();
      expect(journal?.canonicalCommand).toBe(canonicalJson(command));
      const outbox = harness.adapter.listOutbox();
      const intent = outbox.find((envelope) => (envelope.operationId as string) === 'op-atomic');
      expect(intent).toBeDefined();
      // One durable order binds all three records; the outbox references the
      // journal instead of duplicating the payload.
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
        const harness = await seededHarness(fixture);
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
        // Retry succeeds exactly once after the failure clears.
        const bytesBeforeRetry = harness.adapter.snapshotBytes();
        const recovered = await previewAndExecute(harness, `op-fail-${method}`, command);
        expect(recovered.operationId as string).toBe(`op-fail-${method}`);
        expect(harness.adapter.snapshotBytes()).not.toBe(bytesBeforeRetry);
        expect(harness.adapter.getOperation(failedId)).not.toBeNull();
      }

      // Checkpoint step: a failed batch apply leaves cursor and applied set unchanged.
      const harness = await seededHarness(fixture);
      const stream = brandedStream('stream-conformance');
      const batch: PulledBatch = {
        schemaVersion: 1,
        streamId: stream,
        baseCursor: null,
        operations: [{ operationId: 'remote-1', sequence: 1 }],
        nextCursor: brandedCursor('cursor-1'),
      };
      const checkpointBefore = harness.checkpoints.snapshotBytes();
      harness.checkpoints.injectApplyFailure();
      const failed = harness.checkpoints.applyBatch(batch);
      expect(failed.ok).toBe(false);
      expect(harness.checkpoints.snapshotBytes()).toBe(checkpointBefore);
      expect(harness.checkpoints.cursorFor(stream)).toBeNull();
      const recovered = harness.checkpoints.applyBatch(batch);
      expect(recovered).toEqual({ ok: true, replayed: false });
      expect(harness.checkpoints.cursorFor(stream)).toBe(brandedCursor('cursor-1'));
    });

    it('replays same-ID/same-payload receipts and rejects same-ID/different-payload', async () => {
      const harness = await seededHarness(fixture);
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
      const harness = await seededHarness(fixture);
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
      const harness = await seededHarness(fixture);
      const command = inflowCommand(12_345, '2026-09-17', 'uncertain');
      const operationId = brandedOperationId('op-uncertain');
      const committed = await previewAndExecute(harness, 'op-uncertain', command);
      const outboxAfterCommit = harness.adapter.listOutbox().length;

      // The caller never observes the acknowledgement. A later operation commits meanwhile.
      await previewAndExecute(harness, 'op-later', inflowCommand(500, '2026-09-18', 'later'));
      const bytesSettled = harness.adapter.snapshotBytes();

      // Retry through a reacquired handle with the original confirmation.
      const reacquired = harness.adapter.reopen();
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
      // No second state change and no second outbox intent: the settled bytes are identical.
      expect(reacquired.listOutbox()).toHaveLength(outboxAfterCommit + 1);
      expect(reacquired.getBookState(bookId)?.entries.filter((entry) => entry.note === 'uncertain')).toHaveLength(1);
      expect(reacquired.snapshotBytes()).toBe(bytesSettled);
    });

    it('applies duplicate and reordered outbox/pull delivery exactly once', async () => {
      const harness = await seededHarness(fixture);
      await previewAndExecute(harness, 'op-dup-1', inflowCommand(100, '2026-09-19', 'dup-1'));
      await previewAndExecute(harness, 'op-dup-2', inflowCommand(200, '2026-09-20', 'dup-2'));
      const intents = harness.adapter.listOutbox().filter((envelope) => (envelope.operationId as string).startsWith('op-dup-'));
      expect(intents).toHaveLength(2);
      // Independent oracle: a set keyed by operation ID, fed in reordered and duplicated order.
      const delivered = new Set<string>();
      const deliveryOrder = [intents[1], intents[0], intents[1], intents[0]];
      for (const intent of deliveryOrder) {
        delivered.add(intent.operationId as string);
      }
      expect([...delivered].sort()).toEqual(['op-dup-1', 'op-dup-2']);

      const stream = brandedStream('stream-duplicates');
      const first: PulledBatch = {
        schemaVersion: 1,
        streamId: stream,
        baseCursor: null,
        operations: [
          { operationId: 'remote-b', sequence: 2 },
          { operationId: 'remote-a', sequence: 1 },
          { operationId: 'remote-b', sequence: 2 },
        ],
        nextCursor: brandedCursor('cursor-dup-1'),
      };
      const appliedFirst = harness.checkpoints.applyBatch(first);
      expect(appliedFirst).toEqual({ ok: true, replayed: false });
      expect([...harness.checkpoints.appliedOperationIds(stream)].sort()).toEqual(['remote-a', 'remote-b']);
      // Literal replay is a no-op success, never a second effect.
      const replayed = harness.checkpoints.applyBatch(first);
      expect(replayed).toEqual({ ok: true, replayed: true });
      expect([...harness.checkpoints.appliedOperationIds(stream)].sort()).toEqual(['remote-a', 'remote-b']);
    });

    it('rejects cross-book and cross-identity lookups explicitly', async () => {
      const harness = await seededHarness(fixture);
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
      const otherInflow = await previewAndExecute(harness, 'op-inflow-second', {
        kind: 'recordInflow',
        bookId: 'book-second',
        amount: { currency: 'SAR', minorUnits: 500 },
        occurredAt: { kind: 'civilDate', localDate: '2026-09-10' },
        note: '',
      });
      void otherInflow;
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

      // Cross-identity: a fresh adapter (a different scope) knows nothing of this book.
      const stranger = fixture.createAdapter();
      const { context: strangerContext } = createDeterministicContext({ deviceId: 'test-device-9999' });
      const foreign = previewCommand(stranger, { ...CREATE_BOOK }, strangerContext);
      expect(foreign.ok).toBe(true);
      const unknown = previewCommand(stranger, inflowCommand(1, '2026-09-10', 'x'), strangerContext);
      expect(unknown.ok).toBe(false);
      if (!unknown.ok) expect(unknown.failure.kind).toBe('unknownBook');
      // Operation IDs are unique per scope: the same raw ID commits independently here.
      const ownPreview = previewCommand(stranger, { ...CREATE_BOOK }, strangerContext);
      expect(ownPreview.ok).toBe(true);
    });

    it('applies pulled batches and checkpoints atomically', async () => {
      const harness = await seededHarness(fixture);
      const stream = brandedStream('stream-atomic');
      const batch: PulledBatch = {
        schemaVersion: 1,
        streamId: stream,
        baseCursor: null,
        operations: [
          { operationId: 'remote-1', sequence: 1 },
          { operationId: 'remote-2', sequence: 2 },
        ],
        nextCursor: brandedCursor('cursor-atomic-1'),
      };
      const applied = harness.checkpoints.applyBatch(batch);
      expect(applied).toEqual({ ok: true, replayed: false });
      expect(harness.checkpoints.cursorFor(stream)).toBe(brandedCursor('cursor-atomic-1'));
      expect(harness.checkpoints.appliedOperationIds(stream)).toEqual(['remote-1', 'remote-2']);

      // A batch on a stale base is rejected with nothing changed.
      const stale: PulledBatch = {
        schemaVersion: 1,
        streamId: stream,
        baseCursor: null,
        operations: [{ operationId: 'remote-3', sequence: 3 }],
        nextCursor: brandedCursor('cursor-atomic-2'),
      };
      const bytesBefore = harness.checkpoints.snapshotBytes();
      const rejected = harness.checkpoints.applyBatch(stale);
      expect(rejected).toEqual({ ok: false, reason: 'baseCursorMismatch' });
      expect(harness.checkpoints.snapshotBytes()).toBe(bytesBefore);

      const next: PulledBatch = {
        schemaVersion: 1,
        streamId: stream,
        baseCursor: brandedCursor('cursor-atomic-1'),
        operations: [{ operationId: 'remote-3', sequence: 3 }],
        nextCursor: brandedCursor('cursor-atomic-2'),
      };
      expect(harness.checkpoints.applyBatch(next)).toEqual({ ok: true, replayed: false });
      expect(harness.checkpoints.cursorFor(stream)).toBe(brandedCursor('cursor-atomic-2'));
    });

    it('orders fixed-clock commits by durable sequence only', async () => {
      const harness = await seededHarness(fixture, 0);
      const first = await previewAndExecute(harness, 'op-fixed-1', inflowCommand(10, '2026-09-22', 'fixed-1'));
      const second = await previewAndExecute(harness, 'op-fixed-2', inflowCommand(20, '2026-09-23', 'fixed-2'));
      const third = await previewAndExecute(harness, 'op-fixed-3', inflowCommand(30, '2026-09-24', 'fixed-3'));
      // The frozen clock stamps every commit with the same millisecond, yet
      // the durable order is strict.
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
