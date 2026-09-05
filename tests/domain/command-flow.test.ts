import { describe, expect, it } from 'vitest';
import { canonicalJson, executeCommand, previewCommand, stableDigest } from '../../src/application/commands';
import { requireCommandContext, type CommandContext } from '../../src/application/commands/context';
import { describeCommandFailure } from '../../src/domain/contracts/commands';
import { makeBookId, makeOperationId, type OperationId } from '../../src/domain/contracts/identity';
import { sumMoney, type Money } from '../../src/domain/primitives/money';
import { createDeterministicContext } from './support/deterministic-context';
import { InMemoryFinanceRepository } from './support/in-memory-repository';

const BOOK_ID = 'book-rushd-1';
const CYCLE_ID = `cyc:${BOOK_ID}:2026-09-01`;

function branded<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok) throw new Error('invalid test id');
  return result.value as T;
}

const bookId = branded(makeBookId(BOOK_ID));

function op(raw: string): OperationId {
  return branded(makeOperationId(raw));
}

interface Harness {
  repo: InMemoryFinanceRepository;
  context: CommandContext;
}

function makeHarness(): Harness {
  const repo = new InMemoryFinanceRepository();
  const { context } = createDeterministicContext();
  return { repo, context: requireCommandContext(context) };
}

/** Previews then executes; asserts the preview succeeded before executing. */
async function run(harness: Harness, operationId: string, rawCommand: unknown) {
  const preview = previewCommand(harness.repo, rawCommand, harness.context);
  expect(preview.ok, preview.ok ? undefined : describeCommandFailure(preview.failure)).toBe(true);
  if (!preview.ok) throw new Error('unreachable');
  const result = await executeCommand(
    harness.repo,
    rawCommand,
    { operationId: op(operationId), expectedRevision: preview.preview.expectedRevision, previewDigest: preview.preview.previewDigest },
    harness.context,
  );
  return { preview, result };
}

const createBook = {
  kind: 'createBook',
  bookId: BOOK_ID,
  displayName: 'صندوقي الشخصي',
  currency: 'SAR',
  timeZone: 'Asia/Riyadh',
  cycleAnchor: { kind: 'firstOfMonth' },
};

const openCycle = {
  kind: 'openCycle',
  bookId: BOOK_ID,
  startDate: '2026-09-01',
  startingFunds: { currency: 'SAR', text: '١٠٠٠٫٠٠' },
};

describe('create book → open cycle → record inflow → reverse inflow', () => {
  it('commits the full flow with exact minor-unit effects and immutable history', async () => {
    const harness = makeHarness();

    // 1. Create the book.
    const created = await run(harness, 'op-create', createBook);
    expect(created.result.ok).toBe(true);
    if (created.result.ok) {
      expect(created.preview.preview.expectedRevision).toBe(0);
      expect(created.result.retried).toBe(false);
      expect(created.result.receipt.commandKind).toBe('createBook');
      expect(created.result.receipt.revisionBefore).toBe(0);
      expect(created.result.receipt.revisionAfter).toBe(1);
      expect(created.result.receipt.effects).toEqual([
        { kind: 'bookCreated', bookId: BOOK_ID, currency: 'SAR', timeZone: 'Asia/Riyadh', cycleAnchor: { kind: 'firstOfMonth' } },
      ]);
    }
    const state1 = harness.repo.getBookState(bookId);
    expect(state1).not.toBeNull();
    expect(state1?.revision).toBe(1);
    expect(state1?.book.currency).toBe('SAR');
    expect(state1?.book.createdAtLocalDate).toBe('2026-09-05');
    expect(state1?.cycles).toEqual([]);
    expect(state1?.entries).toEqual([]);

    // 2. Opening at a non-anchor-aligned date is rejected before anything is written.
    const misaligned = { ...openCycle, startDate: '2026-09-05' };
    const misalignedPreview = previewCommand(harness.repo, misaligned, harness.context);
    expect(misalignedPreview.ok).toBe(false);
    if (!misalignedPreview.ok) {
      expect(misalignedPreview.failure).toEqual({
        kind: 'invalidCycleStart',
        bookId: BOOK_ID,
        requestedStartDate: '2026-09-05',
        expectedStartDate: '2026-09-01',
      });
    }
    expect(harness.repo.getBookState(bookId)?.revision).toBe(1);

    // 2b. Opening with a different currency is a typed, no-write failure.
    const foreign = { ...openCycle, startingFunds: { currency: 'KWD', text: '10.000' } };
    const foreignPreview = previewCommand(harness.repo, foreign, harness.context);
    expect(foreignPreview.ok).toBe(false);
    if (!foreignPreview.ok) expect(foreignPreview.failure.kind).toBe('currencyMismatch');
    expect(harness.repo.getBookState(bookId)?.revision).toBe(1);

    // 2c. Opening with a negative starting pool is invalid command input.
    const negative = { ...openCycle, startingFunds: { currency: 'SAR', minorUnits: -1 } };
    const negativePreview = previewCommand(harness.repo, negative, harness.context);
    expect(negativePreview.ok).toBe(false);
    if (!negativePreview.ok) expect(negativePreview.failure.kind).toBe('invalidCommand');

    // 3. Open the September cycle with 1000.00 SAR from Arabic-Indic digits.
    const opened = await run(harness, 'op-cycle', openCycle);
    expect(opened.result.ok).toBe(true);
    if (opened.result.ok) {
      expect(opened.result.receipt.revisionAfter).toBe(2);
      expect(opened.result.receipt.effects).toEqual([
        {
          kind: 'cycleOpened',
          cycleId: CYCLE_ID,
          startDate: '2026-09-01',
          endDateExclusive: '2026-10-01',
          startingFunds: { currency: 'SAR', minorUnits: 100000 },
        },
      ]);
    }

    // 4. Record an inflow of 200.50 SAR on 2026-09-10.
    const inflow1 = {
      kind: 'recordInflow',
      bookId: BOOK_ID,
      amount: { currency: 'SAR', text: '200.50' },
      occurredAt: { kind: 'civilDate', localDate: '2026-09-10' },
      note: 'مكافأة',
    };
    const recorded1 = await run(harness, 'op-inflow-1', inflow1);
    expect(recorded1.result.ok).toBe(true);
    if (recorded1.result.ok) {
      expect(recorded1.result.receipt.revisionAfter).toBe(3);
      expect(recorded1.result.receipt.effects).toEqual([
        { kind: 'inflowRecorded', entryId: 'inflow-0001', cycleId: CYCLE_ID, localDate: '2026-09-10', amount: { currency: 'SAR', minorUnits: 20050 } },
      ]);
    }

    // 5. Record an inflow of 150.00 SAR from an instant resolved in the profile timezone.
    const inflow2 = {
      kind: 'recordInflow',
      bookId: BOOK_ID,
      amount: { currency: 'SAR', minorUnits: 15000 },
      occurredAt: { kind: 'instant', instantMs: Date.UTC(2026, 8, 15, 9, 0, 0) },
      note: '',
    };
    const recorded2 = await run(harness, 'op-inflow-2', inflow2);
    expect(recorded2.result.ok).toBe(true);
    if (recorded2.result.ok) {
      expect(recorded2.result.receipt.revisionAfter).toBe(4);
      expect(recorded2.result.receipt.effects).toEqual([
        { kind: 'inflowRecorded', entryId: 'inflow-0002', cycleId: CYCLE_ID, localDate: '2026-09-15', amount: { currency: 'SAR', minorUnits: 15000 } },
      ]);
    }

    // 6. Reverse the first inflow; the original fact stays untouched.
    const beforeReversal = JSON.stringify(harness.repo.getBookState(bookId)?.entries[0]);
    const reversal = { kind: 'reverseInflow', bookId: BOOK_ID, inflowEntryId: 'inflow-0001', note: 'خطأ إدخال' };
    const reversed = await run(harness, 'op-reverse-1', reversal);
    expect(reversed.result.ok).toBe(true);
    if (reversed.result.ok) {
      expect(reversed.result.receipt.revisionAfter).toBe(5);
      expect(reversed.result.receipt.effects).toEqual([
        {
          kind: 'inflowReversalRecorded',
          entryId: 'reversal-0001',
          reversesEntryId: 'inflow-0001',
          cycleId: CYCLE_ID,
          localDate: '2026-09-05',
          amount: { currency: 'SAR', minorUnits: -20050 },
        },
      ]);
    }
    const stateAfterReversal = harness.repo.getBookState(bookId);
    expect(JSON.stringify(stateAfterReversal?.entries[0])).toBe(beforeReversal);
    // Two inflow facts plus one appended reversal fact; nothing was deleted.
    expect(stateAfterReversal?.entries).toHaveLength(3);
    expect(stateAfterReversal?.entries[2]).toMatchObject({ kind: 'inflowReversal', reversesEntryId: 'inflow-0001' });

    // 7. Derived balance: 1000.00 + 200.50 + 150.00 - 200.50 = 1150.00 SAR exactly.
    if (stateAfterReversal !== null) {
      const amounts: [Money, ...Money[]] = [
        stateAfterReversal.cycles[0].startingFunds,
        ...stateAfterReversal.entries.map((entry) => entry.amount),
      ];
      expect(sumMoney(amounts)).toEqual({ ok: true, value: { currency: 'SAR', minorUnits: 115000 } });
    }

    // 8. Journal and outbox captured every committed operation in order.
    for (const [operation, revisionAfter] of [
      ['op-create', 1],
      ['op-cycle', 2],
      ['op-inflow-1', 3],
      ['op-inflow-2', 4],
      ['op-reverse-1', 5],
    ] as const) {
      const record = harness.repo.getOperation(op(operation));
      expect(record, operation).not.toBeNull();
      expect(record?.receipt.revisionAfter).toBe(revisionAfter);
      expect(record?.bookId).toBe(BOOK_ID);
    }
    const outbox = harness.repo.listOutbox();
    expect(outbox).toHaveLength(5);
    expect(outbox.map((envelope) => envelope.revisionAfter)).toEqual([1, 2, 3, 4, 5]);
    expect(outbox.every((envelope) => envelope.status === 'pending')).toBe(true);
    expect(outbox[4].commandKind).toBe('reverseInflow');
  });
});

describe('preview and execution rejections', () => {
  it('rejects inflows outside the open cycle without writing', async () => {
    const harness = makeHarness();
    await run(harness, 'op-create', createBook);
    await run(harness, 'op-cycle', openCycle);

    for (const localDate of ['2026-08-31', '2026-10-01']) {
      const outside = {
        kind: 'recordInflow',
        bookId: BOOK_ID,
        amount: { currency: 'SAR', minorUnits: 100 },
        occurredAt: { kind: 'civilDate', localDate },
        note: '',
      };
      const preview = previewCommand(harness.repo, outside, harness.context);
      expect(preview.ok, localDate).toBe(false);
      if (!preview.ok) {
        expect(preview.failure).toEqual({
          kind: 'dateOutsideOpenCycle',
          bookId: BOOK_ID,
          localDate,
          openCycleId: CYCLE_ID,
        });
      }
    }
    expect(harness.repo.getBookState(bookId)?.revision).toBe(2);
    expect(harness.repo.getBookState(bookId)?.entries).toHaveLength(0);
  });

  it('rejects non-positive inflows, unknown fields, and duplicate openings', async () => {
    const harness = makeHarness();
    await run(harness, 'op-create', createBook);
    await run(harness, 'op-cycle', openCycle);

    const zero = {
      kind: 'recordInflow',
      bookId: BOOK_ID,
      amount: { currency: 'SAR', minorUnits: 0 },
      occurredAt: { kind: 'civilDate', localDate: '2026-09-10' },
      note: '',
    };
    const zeroPreview = previewCommand(harness.repo, zero, harness.context);
    expect(zeroPreview.ok).toBe(false);
    if (!zeroPreview.ok) expect(zeroPreview.failure.kind).toBe('invalidCommand');

    const negative = { ...zero, amount: { currency: 'SAR', minorUnits: -5 } };
    const negativePreview = previewCommand(harness.repo, negative, harness.context);
    expect(negativePreview.ok).toBe(false);

    const unknownField = {
      ...zero,
      category: 'salary',
    };
    const unknownPreview = previewCommand(harness.repo, unknownField, harness.context);
    expect(unknownPreview.ok).toBe(false);
    if (!unknownPreview.ok) expect(unknownPreview.failure.kind).toBe('invalidCommand');

    const secondPreview = previewCommand(harness.repo, openCycle, harness.context);
    expect(secondPreview.ok).toBe(false);
    if (!secondPreview.ok) {
      expect(secondPreview.failure).toEqual({ kind: 'cycleAlreadyOpen', bookId: BOOK_ID, openCycleId: CYCLE_ID });
    }
    // Execution-level: the same rejection with no write, using a correctly
    // bound confirmation for the validated canonical payload (minorUnits form).
    const validatedOpenCycle = {
      kind: 'openCycle',
      bookId: BOOK_ID,
      startDate: '2026-09-01',
      startingFunds: { currency: 'SAR', minorUnits: 100000 },
    };
    const revisionNow = harness.repo.getBookState(bookId)?.revision ?? 0;
    const secondExecute = await executeCommand(
      harness.repo,
      validatedOpenCycle,
      { operationId: op('op-cycle-2'), expectedRevision: revisionNow, previewDigest: stableDigest(`${canonicalJson(validatedOpenCycle)}\n${String(revisionNow)}`) },
      harness.context,
    );
    expect(secondExecute.ok).toBe(false);
    if (!secondExecute.ok) {
      expect(secondExecute.failure).toEqual({ kind: 'cycleAlreadyOpen', bookId: BOOK_ID, openCycleId: CYCLE_ID });
    }

    const unknownKind = previewCommand(harness.repo, { kind: 'allocateGoal' }, harness.context);
    expect(unknownKind.ok).toBe(false);
    if (!unknownKind.ok) expect(unknownKind.failure.kind).toBe('invalidCommand');

    expect(harness.repo.getBookState(bookId)?.revision).toBe(2);
  });

  it('fails inflows and reversals on a book without an open cycle', async () => {
    const harness = makeHarness();
    await run(harness, 'op-create', createBook);

    const inflow = {
      kind: 'recordInflow',
      bookId: BOOK_ID,
      amount: { currency: 'SAR', minorUnits: 100 },
      occurredAt: { kind: 'civilDate', localDate: '2026-09-10' },
      note: '',
    };
    const preview = previewCommand(harness.repo, inflow, harness.context);
    expect(preview.ok).toBe(false);
    if (!preview.ok) expect(preview.failure).toEqual({ kind: 'noOpenCycle', bookId: BOOK_ID });

    const reversal = { kind: 'reverseInflow', bookId: BOOK_ID, inflowEntryId: 'inflow-0001', note: '' };
    const reversalPreview = previewCommand(harness.repo, reversal, harness.context);
    expect(reversalPreview.ok).toBe(false);
    if (!reversalPreview.ok) expect(reversalPreview.failure.kind).toBe('noOpenCycle');
  });
});
