import { describe, expect, it } from 'vitest';
import { executeCommand, previewCommand, stableDigest, canonicalJson } from '../../src/application/commands';
import { requireCommandContext, type CommandContext } from '../../src/application/commands/context';
import { makeBookId, makeOperationId, type OperationId } from '../../src/domain/contracts/identity';
import { createDeterministicContext } from './support/deterministic-context';
import { InMemoryFinanceRepository } from './support/in-memory-repository';

const BOOK_ID = 'book-retry';

function branded<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok) throw new Error('invalid test id');
  return result.value as T;
}

const bookId = branded(makeBookId(BOOK_ID));

function op(raw: string): OperationId {
  return branded(makeOperationId(raw));
}

const createBook = {
  kind: 'createBook',
  bookId: BOOK_ID,
  displayName: 'retry book',
  currency: 'USD',
  timeZone: 'America/New_York',
  cycleAnchor: { kind: 'payday', dayOfMonth: 25 },
};

const openCycle = {
  kind: 'openCycle',
  bookId: BOOK_ID,
  startDate: '2026-09-25',
  startingFunds: { currency: 'USD', minorUnits: 50_000 },
};

const inflow = {
  kind: 'recordInflow',
  bookId: BOOK_ID,
  amount: { currency: 'USD', minorUnits: 12_345 },
  occurredAt: { kind: 'civilDate', localDate: '2026-09-26' },
  note: '',
};

interface Harness {
  repo: InMemoryFinanceRepository;
  context: CommandContext;
}

function makeHarness(): Harness {
  const repo = new InMemoryFinanceRepository();
  const { context } = createDeterministicContext();
  return { repo, context: requireCommandContext(context) };
}

async function previewAndExecute(harness: Harness, operationId: OperationId, rawCommand: unknown) {
  const preview = previewCommand(harness.repo, rawCommand, harness.context);
  expect(preview.ok).toBe(true);
  if (!preview.ok) throw new Error('unreachable');
  return executeCommand(
    harness.repo,
    rawCommand,
    { operationId, expectedRevision: preview.preview.expectedRevision, previewDigest: preview.preview.previewDigest },
    harness.context,
  );
}

describe('idempotent retry behavior', () => {
  it('replays the original receipt for the same operation and payload', async () => {
    const harness = makeHarness();
    await previewAndExecute(harness, op('op-create'), createBook);
    await previewAndExecute(harness, op('op-cycle'), openCycle);

    const operationId = op('op-inflow-1');
    const first = await previewAndExecute(harness, operationId, inflow);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');

    // The caller retries blindly with the same command and confirmation.
    const retry = await executeCommand(
      harness.repo,
      inflow,
      { operationId, expectedRevision: first.receipt.revisionBefore, previewDigest: stableDigest(`${canonicalJson(inflow)}\n${String(first.receipt.revisionBefore)}`) },
      harness.context,
    );
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.retried).toBe(true);
      expect(retry.receipt).toEqual(first.receipt);
    }

    const state = harness.repo.getBookState(bookId);
    expect(state?.revision).toBe(first.receipt.revisionAfter);
    expect(state?.entries).toHaveLength(1);
    expect(harness.repo.listOutbox()).toHaveLength(3);
  });

  it('returns the original receipt after a simulated lost acknowledgement, even with a stale revision', async () => {
    const harness = makeHarness();
    await previewAndExecute(harness, op('op-create'), createBook);
    await previewAndExecute(harness, op('op-cycle'), openCycle);

    // The client commits op-inflow-1 but never observes the acknowledgement.
    const lostOp = op('op-inflow-lost');
    const lost = await previewAndExecute(harness, lostOp, inflow);
    expect(lost.ok).toBe(true);
    if (!lost.ok) throw new Error('unreachable');
    const lostConfirmation = {
      operationId: lostOp,
      expectedRevision: lost.receipt.revisionBefore, // revision the caller still holds
      previewDigest: stableDigest(`${canonicalJson(inflow)}\n${String(lost.receipt.revisionBefore)}`),
    };

    // A different operation commits afterwards, advancing the book revision.
    const laterInflow = { ...inflow, amount: { currency: 'USD', minorUnits: 500 } };
    const later = await previewAndExecute(harness, op('op-inflow-2'), laterInflow);
    expect(later.ok).toBe(true);

    // Retrying the lost operation replays its original receipt instead of
    // re-applying against the stale revision.
    const retry = await executeCommand(harness.repo, inflow, lostConfirmation, harness.context);
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.retried).toBe(true);
      expect(retry.receipt).toEqual(lost.receipt);
    }
    const state = harness.repo.getBookState(bookId);
    expect(state?.revision).toBe(later.ok ? later.receipt.revisionAfter : 0);
    expect(state?.entries).toHaveLength(2);
    expect(state?.entries.filter((entry) => entry.amount.minorUnits === 12345)).toHaveLength(1);
  });

  it('rejects the same operation ID with changed content and writes nothing', async () => {
    const harness = makeHarness();
    await previewAndExecute(harness, op('op-create'), createBook);
    await previewAndExecute(harness, op('op-cycle'), openCycle);

    const operationId = op('op-inflow-1');
    const first = await previewAndExecute(harness, operationId, inflow);
    expect(first.ok).toBe(true);
    const revisionAfterFirst = harness.repo.getBookState(bookId)?.revision;

    // Same operation ID, different amount: an explicit conflict, no effect.
    const altered = { ...inflow, amount: { currency: 'USD', minorUnits: 99_999 } };
    const preview = previewCommand(harness.repo, altered, harness.context);
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error('unreachable');
    const conflict = await executeCommand(
      harness.repo,
      altered,
      { operationId, expectedRevision: preview.preview.expectedRevision, previewDigest: preview.preview.previewDigest },
      harness.context,
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.failure).toEqual({ kind: 'operationIdConflict', operationId });

    expect(harness.repo.getBookState(bookId)?.revision).toBe(revisionAfterFirst);
    expect(harness.repo.getBookState(bookId)?.entries).toHaveLength(1);
    expect(harness.repo.listOutbox()).toHaveLength(3);

    // The original operation still replays after the conflict attempt.
    const originalRetry = await executeCommand(
      harness.repo,
      inflow,
      { operationId, expectedRevision: first.ok ? first.receipt.revisionBefore : 0, previewDigest: stableDigest(`${canonicalJson(inflow)}\n${String(first.ok ? first.receipt.revisionBefore : 0)}`) },
      harness.context,
    );
    expect(originalRetry.ok).toBe(true);
    if (originalRetry.ok) expect(originalRetry.retried).toBe(true);
  });

  it('rejects stale previews with a revision conflict and no writes', async () => {
    const harness = makeHarness();
    await previewAndExecute(harness, op('op-create'), createBook);
    await previewAndExecute(harness, op('op-cycle'), openCycle);

    // Preview taken while the book is at revision 2.
    const stalePreview = previewCommand(harness.repo, inflow, harness.context);
    expect(stalePreview.ok).toBe(true);
    if (!stalePreview.ok) throw new Error('unreachable');
    expect(stalePreview.preview.expectedRevision).toBe(2);

    // Another command commits first.
    await previewAndExecute(harness, op('op-inflow-0'), { ...inflow, amount: { currency: 'USD', minorUnits: 1 } });

    // Executing the stale preview fails without writing.
    const stale = await executeCommand(
      harness.repo,
      inflow,
      {
        operationId: op('op-inflow-stale'),
        expectedRevision: stalePreview.preview.expectedRevision,
        previewDigest: stalePreview.preview.previewDigest,
      },
      harness.context,
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.failure).toEqual({
        kind: 'revisionConflict',
        bookId: BOOK_ID,
        expectedRevision: 2,
        actualRevision: 3,
      });
    }
    expect(harness.repo.getBookState(bookId)?.revision).toBe(3);
    expect(harness.repo.getBookState(bookId)?.entries).toHaveLength(1);

    // A refreshed preview succeeds.
    const refreshed = await previewAndExecute(harness, op('op-inflow-stale'), inflow);
    expect(refreshed.ok).toBe(true);
    expect(harness.repo.getBookState(bookId)?.entries).toHaveLength(2);
  });

  it('rejects confirmations that do not bind the submitted payload', async () => {
    const harness = makeHarness();
    await previewAndExecute(harness, op('op-create'), createBook);
    await previewAndExecute(harness, op('op-cycle'), openCycle);

    const otherCommand = { ...inflow, amount: { currency: 'USD', minorUnits: 7 } };
    const otherPreview = previewCommand(harness.repo, otherCommand, harness.context);
    expect(otherPreview.ok).toBe(true);
    if (!otherPreview.ok) throw new Error('unreachable');

    const mismatch = await executeCommand(
      harness.repo,
      inflow, // different payload, confirmation from the other preview
      {
        operationId: op('op-inflow-x'),
        expectedRevision: otherPreview.preview.expectedRevision,
        previewDigest: otherPreview.preview.previewDigest,
      },
      harness.context,
    );
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.failure.kind).toBe('previewMismatch');
    expect(harness.repo.getBookState(bookId)?.entries).toHaveLength(0);

    const malformed = await executeCommand(
      harness.repo,
      inflow,
      { operationId: op('op-inflow-y'), expectedRevision: 2, previewDigest: 'not-a-digest' },
      harness.context,
    );
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.failure.kind).toBe('invalidConfirmation');
    expect(harness.repo.getBookState(bookId)?.entries).toHaveLength(0);
  });
});
