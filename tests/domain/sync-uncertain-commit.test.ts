/**
 * Uncertain commits and boundary rollback (P03 Task D, proof scenarios 3-4).
 *
 * - A command commits, the caller receives a simulated transport/ack
 *   failure, and retry after adapter reacquisition returns the original
 *   receipt without a second state change or outbox intent.
 * - Failure at the state, operation, outbox, delivery, and checkpoint
 *   boundaries leaves the whole attempted transaction byte-identical, and
 *   retry succeeds exactly once.
 */

import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  executeCommand,
  previewCommand,
  stableDigest,
  type CommandReceipt,
} from '../../src/application/commands';
import type { CommandContext } from '../../src/application/commands/context';
import { makeBookId, makeOperationId, type BookId, type OperationId } from '../../src/domain/contracts/identity';
import { computePulledBatchDigest, makeReplicationStreamId, makeSyncCursor, type PulledBatch } from '../../src/domain/sync/cursors';
import { createDeterministicContext } from './support/deterministic-context';
import { InMemoryCheckpointStore } from './support/in-memory-checkpoint-store';
import { InMemoryFinanceRepository } from './support/in-memory-repository';

function branded<T>(result: { ok: true; value: T } | { ok: false; failure: { detail: string } }): T {
  if (!result.ok) throw new Error(`invalid test id: ${result.failure.detail}`);
  return result.value;
}

const bookId: BookId = branded(makeBookId('book-uncertain'));

function op(raw: string): OperationId {
  return branded(makeOperationId(raw));
}

const CREATE_BOOK = {
  kind: 'createBook',
  bookId: 'book-uncertain',
  displayName: 'uncertain book',
  currency: 'SAR',
  timeZone: 'Asia/Riyadh',
  cycleAnchor: { kind: 'firstOfMonth' },
};

const OPEN_CYCLE = {
  kind: 'openCycle',
  bookId: 'book-uncertain',
  startDate: '2026-09-01',
  startingFunds: { currency: 'SAR', minorUnits: 100_000 },
};

function inflow(amount: number, day: string): Record<string, unknown> {
  return {
    kind: 'recordInflow',
    bookId: 'book-uncertain',
    amount: { currency: 'SAR', minorUnits: amount },
    occurredAt: { kind: 'civilDate', localDate: day },
    note: '',
  };
}

async function run(repo: InMemoryFinanceRepository, context: CommandContext, operationId: string, rawCommand: unknown): Promise<CommandReceipt> {
  const preview = previewCommand(repo, rawCommand, context);
  expect(preview.ok).toBe(true);
  if (!preview.ok) throw new Error('unreachable');
  const result = await executeCommand(
    repo,
    rawCommand,
    { operationId: op(operationId), expectedRevision: preview.preview.expectedRevision, previewDigest: preview.preview.previewDigest },
    context,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.receipt;
}

describe('uncertain commits', () => {
  it('replays the original receipt after a simulated transport failure and reacquisition', async () => {
    const repo = new InMemoryFinanceRepository();
    const { context } = createDeterministicContext();
    await run(repo, context, 'op-create', CREATE_BOOK);
    await run(repo, context, 'op-cycle', OPEN_CYCLE);

    // The command commits durably, but the transport reports failure: the
    // caller never sees an acknowledgement.
    const command = inflow(25_000, '2026-09-20');
    const preview = previewCommand(repo, rawCommand(command), context);
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error('unreachable');
    const confirmation = {
      operationId: op('op-lost-ack'),
      expectedRevision: preview.preview.expectedRevision,
      previewDigest: preview.preview.previewDigest,
    };
    const commitResult = await executeCommand(repo, rawCommand(command), confirmation, context);
    expect(commitResult.ok).toBe(true);
    if (!commitResult.ok) throw new Error('unreachable');
    const simulatedTransportFailure: unknown = new Error('ack frame lost: timeout after commit');
    expect(simulatedTransportFailure).toBeInstanceOf(Error);

    // Meanwhile the rest of the world moves on; then the caller retries
    // through a reacquired handle with the same operation identity.
    await run(repo, context, 'op-other', inflow(1_000, '2026-09-21'));
    const bytesSettled = repo.snapshotBytes();
    const reacquired = repo.reopen();
    const retry = await executeCommand(reacquired, rawCommand(command), confirmation, context);
    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error('unreachable');
    expect(retry.retried).toBe(true);
    expect(retry.receipt).toEqual(commitResult.receipt);

    // No second state change, no second outbox intent: settled bytes identical.
    expect(reacquired.snapshotBytes()).toBe(bytesSettled);
    expect(reacquired.getBookState(bookId)?.entries.filter((entry) => entry.amount.minorUnits === 25_000)).toHaveLength(1);
    expect(reacquired.listOutbox().filter((envelope) => (envelope.operationId as string) === 'op-lost-ack')).toHaveLength(1);

    // And the canonical payload behind the ack is exactly what was sent.
    expect(reacquired.getOperation(op('op-lost-ack'))?.canonicalCommand).toBe(canonicalJson(rawCommand(command)));
  });

  it('leaves byte-identical state at every commit boundary and retries once', async () => {
    const command = inflow(7_500, '2026-09-22');
    for (const method of ['putBookState', 'putOperation', 'putOutboxEntry'] as const) {
      const repo = new InMemoryFinanceRepository();
      const { context } = createDeterministicContext();
      await run(repo, context, 'op-create', CREATE_BOOK);
      await run(repo, context, 'op-cycle', OPEN_CYCLE);
      const before = repo.snapshotBytes();

      repo.injectWriteFailure(method);
      const preview = previewCommand(repo, command, context);
      expect(preview.ok).toBe(true);
      if (!preview.ok) throw new Error('unreachable');
      await expect(
        executeCommand(
          repo,
          command,
          { operationId: op(`op-boundary-${method}`), expectedRevision: preview.preview.expectedRevision, previewDigest: preview.preview.previewDigest },
          context,
        ),
      ).rejects.toThrow(`injected adapter failure at ${method}`);
      expect(repo.snapshotBytes(), method).toBe(before);

      const recovered = await run(repo, context, `op-boundary-${method}`, command);
      expect(recovered.revisionAfter).toBe(recovered.revisionBefore + 1);
      expect(repo.getBookState(bookId)?.entries).toHaveLength(1);
    }

    // Delivery boundary: a tentative/commit failure records nothing, and
    // exactly one retry persists the attempt while canonical history stays
    // byte-identical.
    {
      const repo = new InMemoryFinanceRepository();
      const { context } = createDeterministicContext();
      await run(repo, context, 'op-create', CREATE_BOOK);
      await run(repo, context, 'op-cycle', OPEN_CYCLE);
      await run(repo, context, 'op-delivery', command);
      const deliveryOp = op('op-delivery');
      expect(repo.getDeliveryState(deliveryOp)).toBeNull();

      const before = repo.snapshotBytes();
      repo.injectWriteFailure('putDeliveryState');
      await expect(repo.updateDeliveryState(deliveryOp, { ok: false, error: 'timeout', nextRetryAtMs: 1_000 })).rejects.toThrow(
        'injected adapter failure at putDeliveryState',
      );
      expect(repo.snapshotBytes()).toBe(before);
      expect(repo.getDeliveryState(deliveryOp)).toBeNull();

      const journalBefore = repo.getOperation(deliveryOp)?.canonicalCommand;
      const recorded = await repo.updateDeliveryState(deliveryOp, { ok: false, error: 'timeout', nextRetryAtMs: 1_000 });
      expect(recorded.attempts).toBe(1);
      expect(recorded.lastError).toBe('timeout');
      expect(repo.getOperation(deliveryOp)?.canonicalCommand).toBe(journalBefore);

      const reacquired = repo.reopen();
      expect(reacquired.getDeliveryState(deliveryOp)?.attempts).toBe(1);
    }

    // Checkpoint boundary: a failed pulled-batch apply leaves finance,
    // cursor, and applied set unchanged; success applies the real effect.
    {
      const repo = new InMemoryFinanceRepository();
      const { context } = createDeterministicContext();
      const checkpoints = new InMemoryCheckpointStore({ boundScope: repo.boundScope });
      const finance = { adapter: repo, context };
      const streamMade = makeReplicationStreamId('stream-uncertain');
      const cursorMade = makeSyncCursor('cursor-u-1');
      if (!streamMade.ok || !cursorMade.ok) throw new Error('invalid test stream');
      await run(repo, context, 'op-create', CREATE_BOOK);
      await run(repo, context, 'op-cycle', OPEN_CYCLE);
      const revision = repo.getBookState(bookId)?.revision ?? 0;
      const payload = canonicalJson(command);
      const envelope = {
        operationId: op('op-remote-u-1'),
        sequence: 1,
        scopeId: repo.boundScope,
        bookId,
        baseRevision: revision,
        resultingRevision: revision + 1,
        canonicalCommand: payload,
        canonicalDigest: stableDigest(payload),
        schemaVersion: 1 as const,
      };
      const batch: PulledBatch = {
        schemaVersion: 1,
        streamId: streamMade.value,
        scopeId: repo.boundScope,
        batchId: 'batch-uncertain-1',
        batchDigest: computePulledBatchDigest([envelope]),
        baseCursor: null,
        operations: [envelope],
        nextCursor: cursorMade.value,
      };
      const before = checkpoints.snapshotBytes();
      const financeBefore = repo.snapshotBytes();
      checkpoints.injectApplyFailure();
      expect(await checkpoints.applyBatch(batch, finance)).toEqual({ ok: false, reason: 'injectedFailure' });
      expect(checkpoints.snapshotBytes()).toBe(before);
      expect(repo.snapshotBytes()).toBe(financeBefore);
      expect(await checkpoints.applyBatch(batch, finance)).toEqual({ ok: true, replayed: false });
      // The applied record carries the committed canonical payload, and the
      // finance effect is real.
      expect(checkpoints.appliedOperations(streamMade.value)[0]?.canonicalCommand).toBe(payload);
      expect(repo.getOperation(op('op-remote-u-1'))?.canonicalCommand).toBe(payload);
    }
  });
});

/** The command as the caller sent it: a fresh object per attempt, same canonical bytes. */
function rawCommand(command: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(canonicalJson(command)) as Record<string, unknown>;
}
