import { describe, expect, it } from 'vitest';
import { canonicalJson, executeCommand, previewCommand, stableDigest } from '../../src/application/commands';
import { requireCommandContext, type CommandContext, type DomainClock } from '../../src/application/commands/context';
import { describeCommandFailure } from '../../src/domain/contracts/commands';
import { makeBookId, makeOperationId, type OperationId } from '../../src/domain/contracts/identity';
import { createDeterministicContext } from './support/deterministic-context';
import { InMemoryFinanceRepository } from './support/in-memory-repository';

const BOOK_ID = 'book-reversal';
const CYCLE_ID = `cyc:${BOOK_ID}:2026-09-25`;
// 2026-09-30 23:59:59.999 in Asia/Riyadh (UTC+3): one tick before Riyadh midnight.
const RIYADH_MIDNIGHT_CROSS_MS = Date.UTC(2026, 8, 30, 20, 59, 59, 999);
// 2026-10-01 21:00:00Z = 2026-10-02 00:00:00 in Asia/Riyadh.
const NEXT_RIYADH_MIDNIGHT_MS = Date.UTC(2026, 9, 1, 21, 0, 0);

function branded<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok) throw new Error('invalid test id');
  return result.value as T;
}

const bookId = branded(makeBookId(BOOK_ID));

function op(raw: string): OperationId {
  return branded(makeOperationId(raw));
}

/**
 * Harness with a clock the test can jump across Riyadh midnight without
 * touching book state, plus the shared sequential ID factory so entry IDs
 * stay deterministic across the jump.
 */
function makeHarness(): {
  repo: InMemoryFinanceRepository;
  context: CommandContext;
  jumpTo: (ms: number) => void;
} {
  const repo = new InMemoryFinanceRepository();
  const { context: deterministic } = createDeterministicContext();
  let now = RIYADH_MIDNIGHT_CROSS_MS;
  const clock: DomainClock = {
    nowMs: () => {
      const value = now;
      now += 1_000;
      return value;
    },
  };
  const context = requireCommandContext({ clock, ids: deterministic.ids, calculationVersion: deterministic.calculationVersion });
  return { repo, context, jumpTo: (ms: number) => { now = ms; } };
}

const createBook = {
  kind: 'createBook',
  bookId: BOOK_ID,
  displayName: 'reversal binding',
  currency: 'SAR',
  timeZone: 'Asia/Riyadh',
  cycleAnchor: { kind: 'payday', dayOfMonth: 25 },
};

const openCycle = {
  kind: 'openCycle',
  bookId: BOOK_ID,
  startDate: '2026-09-25',
  startingFunds: { currency: 'SAR', minorUnits: 100_000 },
};

const inflow = {
  kind: 'recordInflow',
  bookId: BOOK_ID,
  amount: { currency: 'SAR', minorUnits: 20_050 },
  occurredAt: { kind: 'civilDate', localDate: '2026-09-28' },
  note: '',
};

async function run(harness: ReturnType<typeof makeHarness>, operationId: string, rawCommand: unknown) {
  const preview = previewCommand(harness.repo, rawCommand, harness.context);
  expect(preview.ok, preview.ok ? undefined : describeCommandFailure(preview.failure)).toBe(true);
  if (!preview.ok) throw new Error('unreachable');
  const result = await executeCommand(
    harness.repo,
    rawCommand,
    { operationId: op(operationId), expectedRevision: preview.preview.expectedRevision, previewDigest: preview.preview.previewDigest },
    harness.context,
  );
  expect(result.ok, result.ok ? undefined : describeCommandFailure(result.failure)).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return { preview, result };
}

/** Creates the book, opens the 2026-09-25 payday cycle, records one inflow. */
async function seededHarness(): Promise<ReturnType<typeof makeHarness>> {
  const harness = makeHarness();
  await run(harness, 'op-create', createBook);
  await run(harness, 'op-cycle', openCycle);
  await run(harness, 'op-inflow', inflow);
  return harness;
}

describe('reversal effective-date binding', () => {
  it('executes the confirmed reversal date even when the clock crosses Riyadh midnight', async () => {
    const harness = await seededHarness();
    expect(harness.repo.getBookState(bookId)?.revision).toBe(3);

    // Preview at 2026-09-30T20:59:59.999Z: the bound instant resolves to
    // 2026-09-30 in Asia/Riyadh.
    const reversal = {
      kind: 'reverseInflow',
      bookId: BOOK_ID,
      inflowEntryId: 'inflow-0001',
      occurredAt: { kind: 'instant', instantMs: RIYADH_MIDNIGHT_CROSS_MS },
      note: 'خطأ إدخال',
    };
    const preview = previewCommand(harness.repo, reversal, harness.context);
    expect(preview.ok, preview.ok ? undefined : describeCommandFailure(preview.failure)).toBe(true);
    if (!preview.ok) throw new Error('unreachable');
    expect(preview.preview.expectedRevision).toBe(3);
    expect(preview.preview.effects).toEqual([
      {
        kind: 'inflowReversalRecorded',
        entryId: 'preview-reversal-001',
        reversesEntryId: 'inflow-0001',
        cycleId: CYCLE_ID,
        localDate: '2026-09-30',
        amount: { currency: 'SAR', minorUnits: -20_050 },
      },
    ]);
    const confirmation = {
      operationId: op('op-reverse-bound'),
      expectedRevision: preview.preview.expectedRevision,
      previewDigest: preview.preview.previewDigest,
    };

    // The same uncommitted confirmation cannot execute an altered occurrence:
    // the digest binds the exact canonical payload the preview covered.
    const altered = { ...reversal, occurredAt: { kind: 'civilDate', localDate: '2026-10-01' } };
    const alteredPreview = previewCommand(harness.repo, altered, harness.context);
    expect(alteredPreview.ok, alteredPreview.ok ? undefined : describeCommandFailure(alteredPreview.failure)).toBe(true);
    const alteredResult = await executeCommand(harness.repo, altered, confirmation, harness.context);
    expect(alteredResult.ok).toBe(false);
    if (!alteredResult.ok) expect(alteredResult.failure.kind).toBe('previewMismatch');
    expect(harness.repo.getBookState(bookId)?.revision).toBe(3);
    expect(harness.repo.getBookState(bookId)?.entries).toHaveLength(1);

    // The injected clock moves across Riyadh midnight; the book revision does
    // not change.
    harness.jumpTo(NEXT_RIYADH_MIDNIGHT_MS);
    expect(harness.repo.getBookState(bookId)?.revision).toBe(3);

    const result = await executeCommand(harness.repo, reversal, confirmation, harness.context);
    expect(result.ok, result.ok ? undefined : describeCommandFailure(result.failure)).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.retried).toBe(false);
    // The confirmed financial date is preserved despite the clock change.
    expect(result.receipt.effects).toEqual([
      {
        kind: 'inflowReversalRecorded',
        entryId: 'reversal-0001',
        reversesEntryId: 'inflow-0001',
        cycleId: CYCLE_ID,
        localDate: '2026-09-30',
        amount: { currency: 'SAR', minorUnits: -20_050 },
      },
    ]);

    const state = harness.repo.getBookState(bookId);
    expect(state?.entries).toHaveLength(2);
    const reversalEntry = state?.entries[1];
    expect(reversalEntry).toMatchObject({
      kind: 'inflowReversal',
      localDate: '2026-09-30',
      reversesEntryId: 'inflow-0001',
    });
    // Capture timestamps reflect execution time; the financial date does not.
    expect(reversalEntry?.capturedAtInstantMs).toBeGreaterThanOrEqual(NEXT_RIYADH_MIDNIGHT_MS);
    expect(result.receipt.committedAtInstantMs).toBeGreaterThanOrEqual(NEXT_RIYADH_MIDNIGHT_MS);
    const originalReceipt = result.receipt;

    // Retrying the committed command with the same stale confirmation replays
    // the original receipt and appends no second reversal.
    const retry = await executeCommand(harness.repo, reversal, confirmation, harness.context);
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.retried).toBe(true);
      expect(retry.receipt).toEqual(originalReceipt);
    }
    expect(harness.repo.getBookState(bookId)?.entries).toHaveLength(2);
    expect(harness.repo.listOutbox()).toHaveLength(4);
  });

  it('rejects a reversal bound outside the open cycle without writing', async () => {
    const harness = await seededHarness();
    const entriesBefore = JSON.stringify(harness.repo.getBookState(bookId)?.entries);
    const outboxBefore = harness.repo.listOutbox().length;

    // 2026-10-25 is the exclusive end of the 2026-09-25 payday cycle.
    const outside = {
      kind: 'reverseInflow',
      bookId: BOOK_ID,
      inflowEntryId: 'inflow-0001',
      occurredAt: { kind: 'civilDate', localDate: '2026-10-25' },
      note: '',
    };
    const preview = previewCommand(harness.repo, outside, harness.context);
    expect(preview.ok).toBe(false);
    if (!preview.ok) {
      expect(preview.failure).toEqual({
        kind: 'dateOutsideOpenCycle',
        bookId: BOOK_ID,
        localDate: '2026-10-25',
        openCycleId: CYCLE_ID,
      });
    }

    // Execution-level rejection with a correctly bound confirmation for the
    // validated canonical payload.
    const revisionNow = harness.repo.getBookState(bookId)?.revision ?? 0;
    const result = await executeCommand(
      harness.repo,
      outside,
      { operationId: op('op-reverse-late'), expectedRevision: revisionNow, previewDigest: stableDigest(`${canonicalJson(outside)}\n${String(revisionNow)}`) },
      harness.context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('dateOutsideOpenCycle');

    expect(harness.repo.getBookState(bookId)?.revision).toBe(revisionNow);
    expect(JSON.stringify(harness.repo.getBookState(bookId)?.entries)).toBe(entriesBefore);
    expect(harness.repo.listOutbox()).toHaveLength(outboxBefore);
    expect(harness.repo.getOperation(op('op-reverse-late'))).toBeNull();
  });

  it('requires an explicit occurrence instead of defaulting to the ambient clock', async () => {
    const harness = await seededHarness();
    const revisionBefore = harness.repo.getBookState(bookId)?.revision;
    const entriesBefore = JSON.stringify(harness.repo.getBookState(bookId)?.entries);

    const missingOccurrence = {
      kind: 'reverseInflow',
      bookId: BOOK_ID,
      inflowEntryId: 'inflow-0001',
      note: '',
    };

    const preview = previewCommand(harness.repo, missingOccurrence, harness.context);
    expect(preview.ok).toBe(false);
    if (!preview.ok) {
      expect(preview.failure.kind).toBe('invalidCommand');
      if (preview.failure.kind === 'invalidCommand') {
        expect(preview.failure.issues).toContain('occurredAt: missing required field');
      }
    }

    // Validation precedes the digest check, so a placeholder confirmation
    // still surfaces the typed validation failure.
    const result = await executeCommand(
      harness.repo,
      missingOccurrence,
      { operationId: op('op-reverse-missing'), expectedRevision: 3, previewDigest: '0000000000000000' },
      harness.context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('invalidCommand');
      if (result.failure.kind === 'invalidCommand') {
        expect(result.failure.issues.some((issue) => issue.startsWith('occurredAt:'))).toBe(true);
      }
    }

    expect(harness.repo.getBookState(bookId)?.revision).toBe(revisionBefore);
    expect(JSON.stringify(harness.repo.getBookState(bookId)?.entries)).toBe(entriesBefore);
    expect(harness.repo.getOperation(op('op-reverse-missing'))).toBeNull();
  });
});
