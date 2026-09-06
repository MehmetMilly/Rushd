/**
 * Versioned operation/receipt/outbox records and delivery separation
 * (P03 Task D, sections 2-3; proof scenarios 2 and 8).
 *
 * - Every sync-facing record carries an explicit schema version.
 * - The operation journal is the single source of truth for the canonical
 *   payload; the outbox intent references it by operation ID and never
 *   duplicates the payload.
 * - Mutable delivery metadata lives apart from immutable intent: transport
 *   activity cannot rewrite financial history, and acknowledgement names
 *   exactly the intended operation.
 * - Ordering comes only from durable sequence/revision/cursor data: cursors
 *   are compared by equality alone, and a decreasing capture clock cannot
 *   reorder commits.
 */

import { describe, expect, it } from 'vitest';
import {
  acknowledgeOutboxDelivery,
  canonicalJson,
  executeCommand,
  initialOutboxDelivery,
  previewCommand,
  recordDeliveryAttempt,
  stableDigest,
  SYNC_RECORD_SCHEMA_VERSION,
  type CommandReceipt,
} from '../../src/application/commands';
import type { CommandContext } from '../../src/application/commands/context';
import { makeBookId, makeOperationId, type BookId, type OperationId } from '../../src/domain/contracts/identity';
import { makeAccountId, makeDeviceId, repositoryScopeIdFor } from '../../src/domain/sync/scope';
import { equalSyncCursors, makeSyncCursor } from '../../src/domain/sync/cursors';
import { createDeterministicContext } from './support/deterministic-context';
import { InMemoryFinanceRepository } from './support/in-memory-repository';
import { makeScopedHarness } from './support/scoped-harness';

function branded<T>(result: { ok: true; value: T } | { ok: false; failure: { detail: string } }): T {
  if (!result.ok) throw new Error(`invalid test id: ${result.failure.detail}`);
  return result.value;
}

const bookId: BookId = branded(makeBookId('book-records'));

function op(raw: string): OperationId {
  return branded(makeOperationId(raw));
}

function inflow(amount: number, day: string, note: string): Record<string, unknown> {
  return {
    kind: 'recordInflow',
    bookId: 'book-records',
    amount: { currency: 'SAR', minorUnits: amount },
    occurredAt: { kind: 'civilDate', localDate: day },
    note,
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

const CREATE_BOOK = {
  kind: 'createBook',
  bookId: 'book-records',
  displayName: 'records book',
  currency: 'SAR',
  timeZone: 'Asia/Riyadh',
  cycleAnchor: { kind: 'firstOfMonth' },
};

const OPEN_CYCLE = {
  kind: 'openCycle',
  bookId: 'book-records',
  startDate: '2026-09-01',
  startingFunds: { currency: 'SAR', minorUnits: 100_000 },
};

describe('sync-facing record schema', () => {
  it('versions every record and binds scope, device, and durable order', async () => {
    const { repo, context } = makeScopedHarness({ deviceId: 'device-rec', accountId: 'account-rec' });
    await run(repo, context, 'op-create', CREATE_BOOK);
    const receipt = await run(repo, context, 'op-cycle', OPEN_CYCLE);

    expect(SYNC_RECORD_SCHEMA_VERSION).toBe(1);
    expect(receipt.schemaVersion).toBe(1);
    expect(receipt.scopeId).toBe(
      repositoryScopeIdFor({
        kind: 'account',
        accountId: branded(makeAccountId('account-rec')),
        deviceId: branded(makeDeviceId('device-rec')),
      }),
    );
    expect(receipt.sourceDeviceId as string).toBe('device-rec');
    expect(receipt.enqueueSequence).toBeGreaterThan(0);

    const journal = repo.getOperation(op('op-cycle'));
    expect(journal?.schemaVersion).toBe(1);
    expect(journal?.scopeId).toBe(receipt.scopeId);
    expect(journal?.sourceDeviceId).toBe(receipt.sourceDeviceId);
    expect(journal?.enqueueSequence).toBe(receipt.enqueueSequence);

    const intent = repo.listOutbox().find((envelope) => (envelope.operationId as string) === 'op-cycle');
    expect(intent?.schemaVersion).toBe(1);
    expect(intent?.scopeId).toBe(receipt.scopeId);
    expect(intent?.sourceDeviceId).toBe(receipt.sourceDeviceId);
    expect(intent?.enqueueSequence).toBe(receipt.enqueueSequence);
  });

  it('keeps the canonical payload only in the journal; the outbox references it', async () => {
    const repo = new InMemoryFinanceRepository();
    const { context } = createDeterministicContext();
    await run(repo, context, 'op-create', CREATE_BOOK);
    await run(repo, context, 'op-cycle', OPEN_CYCLE);
    const command = inflow(4_000, '2026-09-10', 'reference');
    await run(repo, context, 'op-ref', command);

    const journal = repo.getOperation(op('op-ref'));
    expect(journal?.canonicalCommand).toBe(canonicalJson(command));

    const intent = repo.listOutbox().find((envelope) => (envelope.operationId as string) === 'op-ref');
    expect(intent).toBeDefined();
    // The envelope carries the digest and the journal key, never the payload.
    expect(intent?.canonicalDigest).toBe(journal?.receipt.canonicalDigest);
    expect(intent?.operationId).toBe(journal?.operationId);
    expect('canonicalCommand' in (intent as unknown as Record<string, unknown>)).toBe(false);

    // Resolving the reference always yields the single source of truth.
    const resolved = repo.getOperation(intent?.operationId ?? op('op-ref'));
    expect(resolved?.canonicalCommand).toBe(canonicalJson(command));
  });

  it('keeps delivery mutations away from canonical history', async () => {
    const repo = new InMemoryFinanceRepository();
    const { context } = createDeterministicContext();
    await run(repo, context, 'op-create', CREATE_BOOK);
    await run(repo, context, 'op-cycle', OPEN_CYCLE);
    await run(repo, context, 'op-send', inflow(6_000, '2026-09-11', 'send'));

    const bytesBefore = repo.snapshotBytes();
    const intent = repo.listOutbox().find((envelope) => (envelope.operationId as string) === 'op-send');
    expect(intent).toBeDefined();
    if (intent === undefined) throw new Error('unreachable');

    let delivery = initialOutboxDelivery(intent);
    expect(delivery.attempts).toBe(0);
    expect(delivery.acknowledged).toBe(false);
    delivery = recordDeliveryAttempt(delivery, { ok: false, error: 'timeout', nextRetryAtMs: 1_000 });
    delivery = recordDeliveryAttempt(delivery, { ok: false, error: 'timeout', nextRetryAtMs: 2_000 });
    expect(delivery.attempts).toBe(2);
    expect(delivery.lastError).toBe('timeout');
    delivery = recordDeliveryAttempt(delivery, { ok: true });
    expect(delivery.attempts).toBe(3);

    // Transport activity touched nothing canonical.
    expect(repo.snapshotBytes()).toBe(bytesBefore);

    // Acknowledgement names exactly the intended operation.
    const wrong = acknowledgeOutboxDelivery(delivery, op('op-other'));
    expect(wrong).toEqual({ ok: false, reason: 'operationMismatch' });
    const acked = acknowledgeOutboxDelivery(delivery, op('op-send'));
    expect(acked.ok).toBe(true);
    if (!acked.ok) throw new Error('unreachable');
    expect(acked.delivery.acknowledged).toBe(true);
    const duplicate = acknowledgeOutboxDelivery(acked.delivery, op('op-send'));
    expect(duplicate).toEqual({ ok: false, reason: 'alreadyAcknowledged' });
    expect(repo.snapshotBytes()).toBe(bytesBefore);
  });

  it('orders three fixed-timestamp commands by durable sequence with one effect each', async () => {
    const repo = new InMemoryFinanceRepository();
    const { context } = createDeterministicContext({ stepMs: 0 });
    await run(repo, context, 'op-create', CREATE_BOOK);
    await run(repo, context, 'op-cycle', OPEN_CYCLE);

    const first = await run(repo, context, 'op-seq-1', inflow(10, '2026-09-12', 'seq-1'));
    const second = await run(repo, context, 'op-seq-2', inflow(20, '2026-09-13', 'seq-2'));
    const third = await run(repo, context, 'op-seq-3', inflow(30, '2026-09-14', 'seq-3'));

    expect(first.committedAtInstantMs).toBe(second.committedAtInstantMs);
    expect(second.enqueueSequence).toBe(first.enqueueSequence + 1);
    expect(third.enqueueSequence).toBe(second.enqueueSequence + 1);

    // Replay and reordering still yield one effect each.
    const replay = await executeCommand(
      repo,
      inflow(10, '2026-09-12', 'seq-1'),
      { operationId: op('op-seq-1'), expectedRevision: first.revisionBefore, previewDigest: previewDigestFor(inflow(10, '2026-09-12', 'seq-1'), first.revisionBefore) },
      context,
    );
    expect(replay.ok && replay.retried).toBe(true);
    expect(repo.getBookState(bookId)?.entries.filter((entry) => entry.note.startsWith('seq-'))).toHaveLength(3);
  });

  it('treats cursors as opaque: equality only, never timestamp or lexical order', async () => {
    const repo = new InMemoryFinanceRepository();
    // A clock that runs backwards: capture evidence regresses while durable order advances.
    let now = 9_000;
    const { context: deterministic } = createDeterministicContext();
    const backwards = { ...deterministic, clock: { nowMs: () => (now -= 1_000) } };
    const context = backwards as CommandContext;
    await run(repo, context, 'op-create', CREATE_BOOK);
    await run(repo, context, 'op-cycle', OPEN_CYCLE);
    const first = await run(repo, context, 'op-back-1', inflow(10, '2026-09-12', 'back-1'));
    const second = await run(repo, context, 'op-back-2', inflow(20, '2026-09-13', 'back-2'));
    expect(second.committedAtInstantMs).toBeLessThan(first.committedAtInstantMs);
    expect(second.enqueueSequence).toBeGreaterThan(first.enqueueSequence);

    // A provider cursor that sorts lexically *before* an earlier cursor still
    // compares by equality only: lexical order decides nothing.
    const earlier = brandedCursor('cursor-zzz-9');
    const later = brandedCursor('cursor-aaa-10');
    expect((later as string) < (earlier as string)).toBe(true);
    expect(equalSyncCursors(earlier, later)).toBe(false);
    expect(equalSyncCursors(earlier, brandedCursor('cursor-zzz-9'))).toBe(true);
  });
});

function brandedCursor(raw: string): import('../../src/domain/sync/cursors').SyncCursor {
  const made = makeSyncCursor(raw);
  if (!made.ok) throw new Error('invalid test cursor');
  return made.value;
}

function previewDigestFor(command: unknown, revision: number): string {
  return stableDigest(`${canonicalJson(command)}\n${String(revision)}`);
}
