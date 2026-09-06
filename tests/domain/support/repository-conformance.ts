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
  recordDeliveryAttempt,
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
import { makeAccountId as makeScopeAccountId, makeDeviceId as makeScopeDeviceId, makeGuestKey as makeScopeGuestKey, repositoryScopeIdFor, type RepositoryScopeId } from '../../../src/domain/sync/scope';
import { createDeterministicContext, DEFAULT_GUEST_KEY } from './deterministic-context';
import type { CommandContext } from '../../../src/application/commands/context';

export type ConformanceWriteMethod = 'putBookState' | 'putOperation' | 'putOutboxEntry' | 'putDeliveryState';

/** Structural result of a checkpoint batch application. Adapters return a compatible shape. */
export type ConformanceApplyResult =
  | { readonly ok: true; readonly replayed: boolean }
  | { readonly ok: false; readonly reason: 'unsupportedSchema' | 'invalidBatch' | 'baseCursorMismatch' | 'injectedFailure' }
  | { readonly ok: false; readonly reason: 'contentConflict'; readonly conflict: PulledContentConflict }
  | { readonly ok: false; readonly reason: 'scopeMismatch'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'applyFailed'; readonly detail: string; readonly failures: readonly string[] };

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
  readonly boundScope: RepositoryScopeId;
  cursorFor(streamId: ReplicationStreamId): SyncCursor | null;
  batchDigestFor(streamId: ReplicationStreamId): string | null;
  applyBatch(batch: PulledBatch, finance: { readonly adapter: ConformanceAdapter; readonly context: CommandContext }): Promise<ConformanceApplyResult>;
  injectApplyFailure(occurrences?: number): void;
  /**
   * Parks the next applyBatch after staging its first fresh remote write
   * and before later writes/commit. The returned promise resolves once
   * the apply is waiting on `gate`.
   */
  armApplyBarrier(gate: Promise<void>): Promise<void>;
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
  createCheckpointStore(scope: ConformanceScopeSpec | undefined, adapter: ConformanceAdapter): ConformanceCheckpointStore;
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
const REMOTE_SOURCE_DEVICE = 'source-device-remote';

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
  const checkpoints = fixture.createCheckpointStore(spec, adapter);
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

/** Fresh envelope for a command not yet committed locally: base chains explicitly, like a server log. */
function freshEnvelope(harness: Harness, operationId: string, command: Record<string, unknown>, sequence: number, baseRevision: number): PulledOperation {
  const payload = canonicalJson(command);
  return {
    operationId: brandedOperationId(operationId),
    sequence,
    scopeId: harness.adapter.boundScope,
    bookId: brandedBookId('book-conformance'),
    baseRevision,
    resultingRevision: baseRevision + 1,
    canonicalCommand: payload,
    canonicalDigest: stableDigest(payload),
    sourceDeviceId: brandedDeviceId(REMOTE_SOURCE_DEVICE),
    sourceEnqueueSequence: 100 + sequence,
    schemaVersion: 1,
  };
}
/** Content envelope for a locally committed operation, as a pull stream would carry it: full canonical payload included. */
function pulledEnvelope(harness: Harness, operationId: string, sequence: number): PulledOperation {
  const journal = harness.adapter.getOperation(brandedOperationId(operationId));
  if (journal === null) throw new Error(`conformance journal is missing ${operationId}`);
  return {
    operationId: journal.operationId,
    sequence,
    scopeId: journal.scopeId,
    bookId: journal.bookId,
    baseRevision: journal.receipt.revisionBefore,
    resultingRevision: journal.receipt.revisionAfter,
    canonicalCommand: journal.canonicalCommand,
    canonicalDigest: journal.receipt.canonicalDigest,
    sourceDeviceId: journal.sourceDeviceId,
    sourceEnqueueSequence: journal.enqueueSequence,
    schemaVersion: 1,
  };
}

function pulledBatch(harness: Harness, stream: ReplicationStreamId, batchId: string, base: SyncCursor | null, operations: readonly PulledOperation[], next: SyncCursor): PulledBatch {
  return {
    schemaVersion: 1,
    streamId: stream,
    scopeId: harness.adapter.boundScope,
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

    it('lets exactly one of two concurrent staged book writers commit', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      const revisionBefore = harness.adapter.getBookState(bookId)?.revision ?? 0;
      const nameBefore = harness.adapter.getBookState(bookId)?.book.displayName;

      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let parkedError: unknown = null;
      const parked = harness.adapter
        .runTransaction(async (transaction) => {
          const state = transaction.getBookState(bookId);
          if (state === null) throw new Error('book disappeared during test');
          transaction.putBookState({
            ...state,
            revision: state.revision + 1,
            book: { ...state.book, displayName: 'parked-writer' },
          });
          await gate;
        })
        .catch((error: unknown) => {
          parkedError = error;
        });

      await harness.adapter.runTransaction((transaction) => {
        const state = transaction.getBookState(bookId);
        if (state === null) throw new Error('book disappeared during test');
        transaction.putBookState({
          ...state,
          revision: state.revision + 1,
          book: { ...state.book, displayName: 'first-committer' },
        });
      });
      release();
      await parked;
      expect(parkedError).not.toBeNull();
      expect(harness.adapter.getBookState(bookId)?.revision).toBe(revisionBefore + 1);
      expect(harness.adapter.getBookState(bookId)?.book.displayName).toBe('first-committer');
      expect(harness.adapter.getBookState(bookId)?.book.displayName).not.toBe(nameBefore);

      await harness.adapter.runTransaction((transaction) => {
        const state = transaction.getBookState(bookId);
        if (state === null) throw new Error('book disappeared during test');
        transaction.putBookState({
          ...state,
          revision: state.revision + 1,
          book: { ...state.book, displayName: 'retry-writer' },
        });
      });
      expect(harness.adapter.getBookState(bookId)?.book.displayName).toBe('retry-writer');
      expect(harness.adapter.getBookState(bookId)?.revision).toBe(revisionBefore + 2);
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
      const finance = { adapter: harness.adapter, context: harness.context };
      await previewAndExecute(harness, 'op-checkpoint-seed', inflowCommand(100, '2026-09-19', 'checkpoint-seed'));
      const batch = pulledBatch(harness, stream, 'batch-1', null, [pulledEnvelope(harness, 'op-checkpoint-seed', 1)], brandedCursor('cursor-1'));
      const checkpointBefore = harness.checkpoints.snapshotBytes();
      harness.checkpoints.injectApplyFailure();
      const failed = await harness.checkpoints.applyBatch(batch, finance);
      expect(failed).toEqual({ ok: false, reason: 'injectedFailure' });
      expect(harness.checkpoints.snapshotBytes()).toBe(checkpointBefore);
      expect(harness.checkpoints.cursorFor(stream)).toBeNull();
      const recovered = await harness.checkpoints.applyBatch(batch, finance);
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
      await previewAndExecute(harness, 'op-dup-1', inflowCommand(100, '2026-09-19', 'dup-1'));
      await previewAndExecute(harness, 'op-dup-2', inflowCommand(200, '2026-09-20', 'dup-2'));
      const finance = { adapter: harness.adapter, context: harness.context };
      const entriesBefore = harness.adapter.getBookState(bookId)?.entries.length ?? 0;

      // Envelopes carry the canonical payloads of really committed operations.
      const envelopeA = pulledEnvelope(harness, 'op-dup-1', 1);
      const envelopeB = pulledEnvelope(harness, 'op-dup-2', 2);
      const journalA = harness.adapter.getOperation(brandedOperationId('op-dup-1'));
      expect(envelopeA.canonicalCommand).toBe(journalA?.canonicalCommand);
      expect(envelopeA.canonicalDigest).toBe(journalA?.receipt.canonicalDigest);

      // Redelivery, reordered and duplicated: one applied record per
      // operation, and the finance replay adds no second effect.
      const stream = brandedStream('stream-duplicates');
      const batch = pulledBatch(harness, stream, 'batch-dup-1', null, [envelopeB, envelopeA, envelopeB], brandedCursor('cursor-dup-1'));
      const appliedFirst = await harness.checkpoints.applyBatch(batch, finance);
      expect(appliedFirst).toEqual({ ok: true, replayed: false });

      const applied = harness.checkpoints.appliedOperations(stream);
      expect(applied).toHaveLength(2);
      expect([...harness.checkpoints.appliedOperationIds(stream)].sort()).toEqual(['op-dup-1', 'op-dup-2']);
      const storedA = applied.find((operation) => (operation.operationId as string) === 'op-dup-1');
      expect(storedA?.canonicalCommand).toBe(journalA?.canonicalCommand);
      expect(storedA?.canonicalDigest).toBe(journalA?.receipt.canonicalDigest);
      expect(storedA?.baseRevision).toBe(journalA?.receipt.revisionBefore);
      expect(storedA?.resultingRevision).toBe(journalA?.receipt.revisionAfter);
      expect(harness.adapter.getBookState(bookId)?.entries.length).toBe(entriesBefore);

      // Literal replay is a no-op success, never a second record or effect.
      const replayed = await harness.checkpoints.applyBatch(batch, finance);
      expect(replayed).toEqual({ ok: true, replayed: true });
      expect(harness.checkpoints.appliedOperations(stream)).toHaveLength(2);
      expect(harness.adapter.getBookState(bookId)?.entries.length).toBe(entriesBefore);
    });

    it('rejects changed pulled content without advancing the checkpoint', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      await previewAndExecute(harness, 'op-content-1', inflowCommand(300, '2026-09-24', 'content-1'));
      const finance = { adapter: harness.adapter, context: harness.context };
      const stream = brandedStream('stream-content');

      const original = pulledBatch(harness, stream, 'batch-content-1', null, [pulledEnvelope(harness, 'op-content-1', 1)], brandedCursor('cursor-content-1'));
      expect(await harness.checkpoints.applyBatch(original, finance)).toEqual({ ok: true, replayed: false });

      // Review case (a): the same operation ID and digest string with
      // changed envelope fields (book, revisions) is a conflict, not
      // keep-first — even though the digest matches.
      const envelope = pulledEnvelope(harness, 'op-content-1', 9);
      const relabeled: PulledOperation = { ...envelope, bookId: brandedBookId('book-second'), baseRevision: 9, resultingRevision: 10 };
      const relabeledBatch = pulledBatch(harness, stream, 'batch-content-2', brandedCursor('cursor-content-1'), [relabeled], brandedCursor('cursor-content-2'));
      const bytesBefore = harness.checkpoints.snapshotBytes();
      const financeBytesBefore = harness.adapter.snapshotBytes();
      const result = await harness.checkpoints.applyBatch(relabeledBatch, finance);
      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === 'contentConflict') {
        expect(result.conflict.operationId).toBe('op-content-1');
        expect(result.conflict.differingFields).toEqual(expect.arrayContaining(['bookId', 'baseRevision', 'resultingRevision']));
      } else {
        throw new Error(`expected contentConflict, got ${JSON.stringify(result)}`);
      }
      expect(harness.checkpoints.snapshotBytes()).toBe(bytesBefore);
      expect(harness.adapter.snapshotBytes()).toBe(financeBytesBefore);
      expect(harness.checkpoints.cursorFor(stream)).toBe(brandedCursor('cursor-content-1'));

      // Review case (b): the same operation ID with a changed canonical
      // payload (valid shape, recomputed digest) conflicts instead of
      // applying past it while the cursor advances.
      const changedCommand = inflowCommand(999, '2026-09-24', 'content-1');
      const changedPayload = canonicalJson(changedCommand);
      const changed: PulledOperation = {
        ...envelope,
        sequence: 9,
        canonicalCommand: changedPayload,
        canonicalDigest: stableDigest(changedPayload),
      };
      const changedBatch = pulledBatch(harness, stream, 'batch-content-3', brandedCursor('cursor-content-1'), [changed], brandedCursor('cursor-content-3'));
      const changedResult = await harness.checkpoints.applyBatch(changedBatch, finance);
      expect(changedResult.ok).toBe(false);
      if (!changedResult.ok) expect(changedResult.reason).toBe('contentConflict');
      if (!changedResult.ok && changedResult.reason === 'contentConflict') {
        expect(changedResult.conflict.differingFields).toEqual(expect.arrayContaining(['canonicalCommand', 'canonicalDigest']));
      }
      expect(harness.checkpoints.snapshotBytes()).toBe(bytesBefore);
      expect(harness.adapter.snapshotBytes()).toBe(financeBytesBefore);
      expect(harness.checkpoints.cursorFor(stream)).toBe(brandedCursor('cursor-content-1'));

      // Changed source provenance is an explicit conflict and must not move the cursor.
      const changedProvenance: PulledOperation = {
        ...envelope,
        sequence: 9,
        sourceDeviceId: brandedDeviceId('other-source-device'),
        sourceEnqueueSequence: envelope.sourceEnqueueSequence + 7,
      };
      const provenanceBatch = pulledBatch(harness, stream, 'batch-content-provenance', brandedCursor('cursor-content-1'), [changedProvenance], brandedCursor('cursor-content-provenance'));
      const provenanceResult = await harness.checkpoints.applyBatch(provenanceBatch, finance);
      expect(provenanceResult.ok).toBe(false);
      if (!provenanceResult.ok && provenanceResult.reason === 'contentConflict') {
        expect(provenanceResult.conflict.differingFields).toEqual(expect.arrayContaining(['sourceDeviceId', 'sourceEnqueueSequence']));
      } else {
        throw new Error(`expected contentConflict for changed provenance, got ${JSON.stringify(provenanceResult)}`);
      }
      expect(harness.checkpoints.snapshotBytes()).toBe(bytesBefore);
      expect(harness.adapter.snapshotBytes()).toBe(financeBytesBefore);
      expect(harness.checkpoints.cursorFor(stream)).toBe(brandedCursor('cursor-content-1'));

      // A tampered digest (payload/digest mismatch) is invalid, never applied.
      const tampered: PulledOperation = { ...envelope, canonicalDigest: 'tampered-digest-value' };
      const tamperedDirect: PulledBatch = {
        schemaVersion: 1,
        streamId: stream,
        scopeId: harness.adapter.boundScope,
        batchId: 'batch-content-4',
        batchDigest: computePulledBatchDigest([tampered]),
        baseCursor: brandedCursor('cursor-content-1'),
        operations: [tampered],
        nextCursor: brandedCursor('cursor-content-4'),
      };
      const tamperedResult = await harness.checkpoints.applyBatch(tamperedDirect, finance);
      expect(tamperedResult).toEqual({ ok: false, reason: 'invalidBatch' });
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
      const finance = { adapter: harness.adapter, context: harness.context };
      const stream = brandedStream('stream-atomic');
      const revisionBefore = harness.adapter.getBookState(bookId)?.revision ?? 0;

      // Catch-up replication: fresh operations with chained bases commit
      // real finance effects together with the checkpoint advance.
      const batch = pulledBatch(harness, stream, 'batch-atomic-1', null, [
        freshEnvelope(harness, 'op-pull-1', inflowCommand(400, '2026-09-25', 'pull-1'), 1, revisionBefore),
        freshEnvelope(harness, 'op-pull-2', inflowCommand(500, '2026-09-26', 'pull-2'), 2, revisionBefore + 1),
      ], brandedCursor('cursor-atomic-1'));
      const applied = await harness.checkpoints.applyBatch(batch, finance);
      expect(applied).toEqual({ ok: true, replayed: false });
      expect(harness.checkpoints.cursorFor(stream)).toBe(brandedCursor('cursor-atomic-1'));
      expect(harness.checkpoints.batchDigestFor(stream)).toBe(batch.batchDigest);
      expect(harness.checkpoints.appliedOperationIds(stream)).toEqual(['op-pull-1', 'op-pull-2']);
      const stored = harness.checkpoints.appliedOperations(stream);
      expect(stored.find((operation) => (operation.operationId as string) === 'op-pull-1')?.canonicalCommand).toBe(
        harness.adapter.getOperation(brandedOperationId('op-pull-1'))?.canonicalCommand,
      );
      expect(harness.adapter.getBookState(bookId)?.revision).toBe(revisionBefore + 2);
      expect(harness.adapter.getBookState(bookId)?.entries.filter((entry) => entry.note.startsWith('pull-'))).toHaveLength(2);
      const remoteJournal = harness.adapter.getOperation(brandedOperationId('op-pull-1'));
      expect(remoteJournal?.sourceDeviceId as string).toBe(REMOTE_SOURCE_DEVICE);
      expect(remoteJournal?.enqueueSequence).toBe(101);
      expect(remoteJournal?.sourceDeviceId as string).not.toBe(harness.adapter.boundDevice as string);
      expect(harness.adapter.listOutbox().filter((envelope) => (envelope.operationId as string).startsWith('op-pull-'))).toHaveLength(0);

      const replayedExact = await harness.checkpoints.applyBatch(batch, finance);
      expect(replayedExact).toEqual({ ok: true, replayed: true });
      expect(harness.adapter.getBookState(bookId)?.entries.filter((entry) => entry.note.startsWith('pull-'))).toHaveLength(2);
      expect(harness.adapter.listOutbox().filter((envelope) => (envelope.operationId as string).startsWith('op-pull-'))).toHaveLength(0);

      // A batch on a stale base is rejected with finance and checkpoint unchanged.
      const stale = pulledBatch(harness, stream, 'batch-atomic-2', null, [
        freshEnvelope(harness, 'op-pull-3', inflowCommand(600, '2026-09-27', 'pull-3'), 1, revisionBefore + 2),
      ], brandedCursor('cursor-atomic-2'));
      const bytesBefore = harness.checkpoints.snapshotBytes();
      const financeBytesBefore = harness.adapter.snapshotBytes();
      const rejected = await harness.checkpoints.applyBatch(stale, finance);
      expect(rejected).toEqual({ ok: false, reason: 'baseCursorMismatch' });
      expect(harness.checkpoints.snapshotBytes()).toBe(bytesBefore);
      expect(harness.adapter.snapshotBytes()).toBe(financeBytesBefore);

      // A mid-batch finance failure (stale pulled base revision) rolls back
      // the whole batch: the first effect is undone and the cursor stays.
      const failing = pulledBatch(harness, stream, 'batch-atomic-3', brandedCursor('cursor-atomic-1'), [
        freshEnvelope(harness, 'op-pull-4', inflowCommand(700, '2026-09-28', 'pull-4'), 1, revisionBefore + 2),
        freshEnvelope(harness, 'op-pull-5', inflowCommand(800, '2026-09-29', 'pull-5'), 2, 99),
      ], brandedCursor('cursor-atomic-3'));
      const failed = await harness.checkpoints.applyBatch(failing, finance);
      expect(failed.ok).toBe(false);
      if (!failed.ok) expect(failed.reason).toBe('applyFailed');
      expect(harness.checkpoints.snapshotBytes()).toBe(bytesBefore);
      expect(harness.adapter.snapshotBytes()).toBe(financeBytesBefore);
      expect(harness.adapter.getOperation(brandedOperationId('op-pull-4'))).toBeNull();

      // The already-applied operation redelivered in a new batch is skipped:
      // cursor advances, no duplicate effect.
      const next = pulledBatch(harness, stream, 'batch-atomic-4', brandedCursor('cursor-atomic-1'), [
        pulledEnvelope(harness, 'op-pull-1', 9),
        freshEnvelope(harness, 'op-pull-6', inflowCommand(900, '2026-09-30', 'pull-6'), 2, revisionBefore + 2),
      ], brandedCursor('cursor-atomic-2'));
      expect(await harness.checkpoints.applyBatch(next, finance)).toEqual({ ok: true, replayed: false });
      expect(harness.checkpoints.cursorFor(stream)).toBe(brandedCursor('cursor-atomic-2'));
      expect(harness.checkpoints.appliedOperations(stream)).toHaveLength(3);
      expect(harness.adapter.getBookState(bookId)?.entries.filter((entry) => entry.note === 'pull-1')).toHaveLength(1);
    });

    it('rejects cross-scope pulled batches without applying or advancing', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      const finance = { adapter: harness.adapter, context: harness.context };
      const stream = brandedStream('stream-cross-scope');
      const revision = harness.adapter.getBookState(bookId)?.revision ?? 0;
      expect(harness.checkpoints.boundScope as string).toBe(harness.adapter.boundScope as string);

      // A batch naming another scope is rejected before anything mutates.
      const foreignScope = scopeIdForSpec({ deviceId: 'test-device-foreign' });
      const foreignBatch: PulledBatch = {
        schemaVersion: 1,
        streamId: stream,
        scopeId: foreignScope as RepositoryScopeId,
        batchId: 'batch-foreign-1',
        batchDigest: 'placeholder',
        baseCursor: null,
        operations: [],
        nextCursor: brandedCursor('cursor-foreign-1'),
      };
      const foreignDigestBatch: PulledBatch = { ...foreignBatch, batchDigest: computePulledBatchDigest([]) };
      const bytesBefore = harness.checkpoints.snapshotBytes();
      const financeBytesBefore = harness.adapter.snapshotBytes();
      const foreign = await harness.checkpoints.applyBatch(foreignDigestBatch, finance);
      expect(foreign).toEqual({ ok: false, reason: 'scopeMismatch', detail: 'pulled batch names another scope than this checkpoint stream' });
      expect(harness.checkpoints.snapshotBytes()).toBe(bytesBefore);
      expect(harness.adapter.snapshotBytes()).toBe(financeBytesBefore);

      // An operation naming another scope inside an otherwise own-scope
      // batch is malformed: rejected, nothing applied, cursor unmoved.
      const ownBase = pulledBatch(harness, stream, 'batch-cross-op', null, [], brandedCursor('cursor-cross-1'));
      const foreignOp = freshEnvelope(harness, 'op-foreign', inflowCommand(50, '2026-09-10', 'foreign'), 1, revision);
      const smuggled: PulledOperation = { ...foreignOp, scopeId: foreignScope as RepositoryScopeId };
      const smuggledBatch: PulledBatch = {
        ...ownBase,
        operations: [smuggled],
        batchDigest: computePulledBatchDigest([smuggled]),
      };
      const smuggledResult = await harness.checkpoints.applyBatch(smuggledBatch, finance);
      expect(smuggledResult).toEqual({ ok: false, reason: 'invalidBatch' });
      expect(harness.checkpoints.snapshotBytes()).toBe(bytesBefore);
      expect(harness.adapter.snapshotBytes()).toBe(financeBytesBefore);
      expect(harness.checkpoints.cursorFor(stream)).toBeNull();
    });

    it('serializes concurrent delivery updates without losing successful writes', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      await previewAndExecute(harness, 'op-race', inflowCommand(1_200, '2026-09-28', 'race'));
      const operationId = brandedOperationId('op-race');

      // Sequential updates accumulate: two attempts persist as attempts=2.
      await harness.adapter.updateDeliveryState(operationId, { ok: false, error: 'timeout-a', nextRetryAtMs: 1_000 });
      const second = await harness.adapter.updateDeliveryState(operationId, { ok: false, error: 'timeout-b', nextRetryAtMs: 2_000 });
      expect(second.attempts).toBe(2);

      // A true race: one transaction parks mid-flight while another commits.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let parkedError: unknown = null;
      const parked = harness.adapter.runTransaction(async (transaction) => {
        const current = transaction.getDeliveryState(operationId);
        if (current === null) throw new Error('delivery disappeared during test');
        await gate;
        transaction.putDeliveryState(recordDeliveryAttempt(current, { ok: true }));
      }).catch((error: unknown) => {
        parkedError = error;
      });
      const winner = await harness.adapter.updateDeliveryState(operationId, { ok: false, error: 'timeout-c', nextRetryAtMs: 3_000 });
      expect(winner.attempts).toBe(3);
      release();
      await parked;
      // Exactly one writer loses, explicitly: no silent overwrite.
      expect(parkedError).not.toBeNull();
      expect(harness.adapter.getDeliveryState(operationId)?.attempts).toBe(3);
      // The loser retries and reaches attempts=4: no successful update lost.
      const retried = await harness.adapter.updateDeliveryState(operationId, { ok: true });
      expect(retried.attempts).toBe(4);
      expect(retried.lastError).toBeNull();
    });

    it('rejects a mixed late-write conflict without committing earlier book changes', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      await previewAndExecute(harness, 'op-mixed', inflowCommand(1_200, '2026-09-28', 'mixed'));
      const operationId = brandedOperationId('op-mixed');
      await harness.adapter.updateDeliveryState(operationId, { ok: false, error: 'seed', nextRetryAtMs: 1 });
      const nameBefore = harness.adapter.getBookState(bookId)?.book.displayName;
      const revisionBefore = harness.adapter.getBookState(bookId)?.revision ?? 0;
      const deliveryBefore = harness.adapter.getDeliveryState(operationId)?.attempts;

      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let parkedError: unknown = null;
      const parked = harness.adapter
        .runTransaction(async (transaction) => {
          const state = transaction.getBookState(bookId);
          if (state === null) throw new Error('book disappeared during test');
          transaction.putBookState({
            ...state,
            revision: state.revision + 1,
            book: { ...state.book, displayName: 'partial-commit' },
          });
          const current = transaction.getDeliveryState(operationId);
          if (current === null) throw new Error('delivery disappeared during test');
          transaction.putDeliveryState(recordDeliveryAttempt(current, { ok: true }));
          await gate;
        })
        .catch((error: unknown) => {
          parkedError = error;
        });

      const winner = await harness.adapter.updateDeliveryState(operationId, { ok: false, error: 'concurrent', nextRetryAtMs: 2 });
      expect(winner.attempts).toBe((deliveryBefore ?? 0) + 1);
      release();
      await parked;
      expect(parkedError).not.toBeNull();
      expect(harness.adapter.getBookState(bookId)?.book.displayName).toBe(nameBefore);
      expect(harness.adapter.getBookState(bookId)?.revision).toBe(revisionBefore);
      expect(harness.adapter.getDeliveryState(operationId)?.attempts).toBe(winner.attempts);
    });

    it('preserves concurrent delivery when a pulled batch rolls back', async () => {
      const harness = seededHarness(fixture);
      await seedBook(harness);
      await previewAndExecute(harness, 'op-local-delivery', inflowCommand(400, '2026-09-25', 'local'));
      const localId = brandedOperationId('op-local-delivery');
      const revision = harness.adapter.getBookState(bookId)?.revision ?? 0;
      const finance = { adapter: harness.adapter, context: harness.context };
      const stream = brandedStream('stream-pull-race');
      const failing = pulledBatch(
        harness,
        stream,
        'batch-pull-race',
        null,
        [
          freshEnvelope(harness, 'op-pull-race-1', inflowCommand(700, '2026-09-28', 'pull-race-1'), 1, revision),
          freshEnvelope(harness, 'op-pull-race-2', inflowCommand(800, '2026-09-29', 'pull-race-2'), 2, 99),
        ],
        brandedCursor('cursor-pull-race'),
      );

      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const parked = harness.checkpoints.armApplyBarrier(gate);
      const pull = harness.checkpoints.applyBatch(failing, finance);
      await parked;
      const recorded = await harness.adapter.updateDeliveryState(localId, { ok: false, error: 'timeout', nextRetryAtMs: 1_000 });
      expect(recorded.attempts).toBe(1);
      release();
      const result = await pull;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('applyFailed');
      expect(harness.adapter.getDeliveryState(localId)?.attempts).toBe(1);
      expect(harness.adapter.getOperation(brandedOperationId('op-pull-race-1'))).toBeNull();
      expect(harness.checkpoints.cursorFor(stream)).toBeNull();
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
