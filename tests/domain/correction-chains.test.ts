import { describe, expect, it } from 'vitest';
import {
  computeAvailability,
  computeCompleteness,
  describeCommandFailure,
  executeCommand,
  previewCommand,
  type BookState,
  type CommandConfirmation,
  type CommandReceipt,
} from '../../src/application/commands';
import { makeBookId, makeObligationId, makeOperationId, type BookId, type ObligationId, type OperationId } from '../../src/domain/contracts/identity';
import { deriveObligationView } from '../../src/domain/obligations/derive';
import { deriveTrackedPool } from '../../src/domain/allocations/derive';
import { createDeterministicContext } from './support/deterministic-context';
import { InMemoryFinanceRepository } from './support/in-memory-repository';

const BOOK_ID = 'book-corrections';

function asBookId(): BookId {
  const made = makeBookId(BOOK_ID);
  if (!made.ok) throw new Error('invalid test book id');
  return made.value;
}

const theBookId = asBookId();

function obligationId(raw: string): ObligationId {
  const made = makeObligationId(raw);
  if (!made.ok) throw new Error('invalid test obligation id');
  return made.value;
}

function opId(raw: string): OperationId {
  const made = makeOperationId(raw);
  if (!made.ok) throw new Error('invalid test operation id');
  return made.value;
}

const SAR = (minorUnits: number) => ({ currency: 'SAR' as const, minorUnits });

/**
 * Harness over the production application API with a deterministic clock.
 * Every expectation below is hand-calculated from the master plan's
 * financial rules, never read back from the implementation under test.
 */
function makeHarness() {
  const repo = new InMemoryFinanceRepository();
  const { context } = createDeterministicContext();
  let sequence = 0;
  const previewFail = (rawCommand: unknown) => {
    const preview = previewCommand(repo, rawCommand, context);
    expect(preview.ok).toBe(false);
    if (preview.ok) throw new Error('unreachable');
    return preview.failure;
  };
  const run = async (rawCommand: unknown): Promise<{ receipt: CommandReceipt }> => {
    const preview = previewCommand(repo, rawCommand, context);
    expect(preview.ok, preview.ok ? undefined : describeCommandFailure(preview.failure)).toBe(true);
    if (!preview.ok) throw new Error('unreachable');
    const result = await executeCommand(repo, rawCommand, {
      operationId: opId(`op-${String(++sequence).padStart(4, '0')}`),
      expectedRevision: preview.preview.expectedRevision,
      previewDigest: preview.preview.previewDigest,
    }, context);
    expect(result.ok, result.ok ? undefined : describeCommandFailure(result.failure)).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    return { receipt: result.receipt };
  };
  const confirm = async (rawCommand: unknown, confirmation: CommandConfirmation) => executeCommand(repo, rawCommand, confirmation, context);
  const state = (): BookState => {
    const found = repo.getBookState(theBookId);
    if (found === null) throw new Error('book missing');
    return found;
  };
  return { repo, context, run, confirm, previewFail, state };
}

async function seedStandardBook(harness: ReturnType<typeof makeHarness>): Promise<void> {
  await harness.run({
    kind: 'createBook',
    bookId: BOOK_ID,
    displayName: 'corrections',
    currency: 'SAR',
    timeZone: 'Asia/Riyadh',
    cycleAnchor: { kind: 'firstOfMonth' },
  });
  await harness.run({
    kind: 'openCycle',
    bookId: BOOK_ID,
    startDate: '2026-09-01',
    startingFunds: { currency: 'SAR', minorUnits: 100_000 },
  });
}

function availableMinor(state: BookState, harness: ReturnType<typeof makeHarness>): number {
  const availability = computeAvailability(state, { asOfInstantMs: harness.context.clock.nowMs(), calculationVersion: 'p03-fix-01' });
  if (availability.status !== 'computed') throw new Error(`availability unavailable: ${availability.reason}`);
  return availability.available.minorUnits;
}

function effectRecordId(receipt: CommandReceipt, kind: string): string {
  const effect = receipt.effects.find((candidate) => candidate.kind === kind);
  if (effect === undefined) throw new Error(`missing ${kind} effect`);
  const record = effect as unknown as Record<string, string>;
  for (const key of ['recordId', 'entryId']) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  throw new Error(`effect ${kind} carries no id`);
}

describe('F1: allocation reversals move availability with the pool', () => {
  it('reverse-release re-earmarks money; reverse-funding restores it', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    await harness.run({ kind: 'createGoal', bookId: BOOK_ID, goalId: 'goal-f1', name: 'F1', targetAmount: SAR(100_000) });
    await harness.run({
      kind: 'fundAllocationPool',
      bookId: BOOK_ID,
      amount: SAR(20_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-02' },
      note: '',
    });
    await harness.run({ kind: 'assignToGoal', bookId: BOOK_ID, goalId: 'goal-f1', amount: SAR(20_000), note: '' });
    // From 1,000: fund 200/assign/release 100 gives 900 available.
    const release = await harness.run({
      kind: 'releaseAllocation',
      bookId: BOOK_ID,
      goalId: 'goal-f1',
      amount: SAR(10_000),
      destinationCycleId: `cyc:${BOOK_ID}:2026-09-01`,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-03' },
      note: '',
    });
    expect(availableMinor(harness.state(), harness)).toBe(90_000);

    // Reverse the release: the money is earmarked again, 900 -> 800, and the
    // tracked pool agrees (total back to 200).
    await harness.run({
      kind: 'reverseAllocationRecord',
      bookId: BOOK_ID,
      allocationRecordId: effectRecordId(release.receipt, 'allocationReleased'),
      note: '',
    });
    expect(availableMinor(harness.state(), harness)).toBe(80_000);
    expect(deriveTrackedPool(harness.state()).total).toEqual(SAR(20_000));
  });

  it('reversing funding restores spendable money and empties the pool', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    const funding = await harness.run({
      kind: 'fundAllocationPool',
      bookId: BOOK_ID,
      amount: SAR(20_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-02' },
      note: '',
    });
    expect(availableMinor(harness.state(), harness)).toBe(80_000);
    await harness.run({
      kind: 'reverseAllocationRecord',
      bookId: BOOK_ID,
      allocationRecordId: effectRecordId(funding.receipt, 'allocationFunded'),
      note: '',
    });
    expect(availableMinor(harness.state(), harness)).toBe(100_000);
    const pool = deriveTrackedPool(harness.state());
    expect(pool.total).toEqual(SAR(0));
    expect(pool.unallocated).toEqual(SAR(0));
  });

  it('reversing an unassignment returns the money to its goal', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    await harness.run({ kind: 'createGoal', bookId: BOOK_ID, goalId: 'goal-f1u', name: 'F1U', targetAmount: SAR(100_000) });
    await harness.run({
      kind: 'fundAllocationPool',
      bookId: BOOK_ID,
      amount: SAR(20_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-02' },
      note: '',
    });
    await harness.run({ kind: 'assignToGoal', bookId: BOOK_ID, goalId: 'goal-f1u', amount: SAR(20_000), note: '' });
    const unassignment = await harness.run({ kind: 'unassignFromGoal', bookId: BOOK_ID, goalId: 'goal-f1u', amount: SAR(20_000), note: '' });
    expect(deriveTrackedPool(harness.state()).goals[0]?.assigned).toEqual(SAR(0));
    await harness.run({
      kind: 'reverseAllocationRecord',
      bookId: BOOK_ID,
      allocationRecordId: effectRecordId(unassignment.receipt, 'allocationUnassigned'),
      note: '',
    });
    // The inverse of goal->unallocated is unallocated->goal: assigned 200,
    // unallocated 0, availability still 800 (assignment never deducts).
    const pool = deriveTrackedPool(harness.state());
    expect(pool.goals[0]?.assigned).toEqual(SAR(20_000));
    expect(pool.unallocated).toEqual(SAR(0));
    expect(availableMinor(harness.state(), harness)).toBe(80_000);
  });
});

describe('F2: corrected linked payments count at the replacement', () => {
  it('pay 30 corrected to 10 leaves 920 available and 70 reserved; return 40 is rejected', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    await harness.run({
      kind: 'createObligation',
      bookId: BOOK_ID,
      obligationId: 'obl-f2',
      expectedAmount: SAR(8_000),
      note: '',
      category: null,
    });
    const payment = await harness.run({
      kind: 'recordObligationPayment',
      bookId: BOOK_ID,
      obligationId: 'obl-f2',
      amount: SAR(3_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: '',
      category: null,
    });
    await harness.run({
      kind: 'correctExpense',
      bookId: BOOK_ID,
      expenseEntryId: effectRecordId(payment.receipt, 'expenseRecorded'),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: 'overstated',
      replacement: { amount: SAR(1_000) },
    });
    // A corrected 30 replaced by 10 is 10 paid, not 40:
    // 1000 + 0 - 10 live - 70 residual = 920.
    expect(availableMinor(harness.state(), harness)).toBe(92_000);
    const view = deriveObligationView(harness.state(), obligationId('obl-f2'));
    expect(view?.netPayments).toEqual(SAR(1_000));
    expect(view?.residualReservation).toEqual(SAR(7_000));

    // Returning 40 exceeds the honest net of 10: typed rejection, no write.
    const revisionBefore = harness.state().revision;
    const failure = harness.previewFail({
      kind: 'recordObligationReturn',
      bookId: BOOK_ID,
      obligationId: 'obl-f2',
      amount: SAR(4_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-07' },
      note: '',
    });
    expect(failure).toEqual({
      kind: 'returnExceedsReturnable',
      bookId: BOOK_ID,
      targetKind: 'obligation',
      targetId: 'obl-f2',
      requested: SAR(4_000),
      returnable: SAR(1_000),
    });
    expect(harness.state().revision).toBe(revisionBefore);
  });

  it('covers payment correction when obligation returns already exist', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    await harness.run({
      kind: 'createObligation',
      bookId: BOOK_ID,
      obligationId: 'obl-f2b',
      expectedAmount: SAR(8_000),
      note: '',
      category: null,
    });
    const payment = await harness.run({
      kind: 'recordObligationPayment',
      bookId: BOOK_ID,
      obligationId: 'obl-f2b',
      amount: SAR(3_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: '',
      category: null,
    });
    await harness.run({
      kind: 'recordObligationReturn',
      bookId: BOOK_ID,
      obligationId: 'obl-f2b',
      amount: SAR(1_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: '',
    });
    // 1000 + 10 - 30 - 60 = 920.
    expect(availableMinor(harness.state(), harness)).toBe(92_000);

    // Correct 30 -> 20 with 10 standing: net 10, residual 70, still 920.
    const correction = await harness.run({
      kind: 'correctExpense',
      bookId: BOOK_ID,
      expenseEntryId: effectRecordId(payment.receipt, 'expenseRecorded'),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-07' },
      note: '',
      replacement: { amount: SAR(2_000) },
    });
    expect(availableMinor(harness.state(), harness)).toBe(92_000);
    expect(deriveObligationView(harness.state(), obligationId('obl-f2b'))?.netPayments).toEqual(SAR(1_000));

    // Correcting the replacement 20 -> 5 would strand the standing 10
    // refund above the resulting net (-5): rejected, no write.
    const replacementId = effectRecordId(correction.receipt, 'expenseRecorded');
    const revisionBefore = harness.state().revision;
    const failure = harness.previewFail({
      kind: 'correctExpense',
      bookId: BOOK_ID,
      expenseEntryId: replacementId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-08' },
      note: '',
      replacement: { amount: SAR(500) },
    });
    expect(failure).toEqual({
      kind: 'returnExceedsReturnable',
      bookId: BOOK_ID,
      targetKind: 'obligation',
      targetId: 'obl-f2b',
      requested: SAR(1_000),
      returnable: SAR(500),
    });
    expect(harness.state().revision).toBe(revisionBefore);
  });
});

describe('F3: refund caps survive correction chains', () => {
  it('expense 100 return 80: shrink to 50 and void are rejected; 90 keeps a 10 allowance across IDs', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    const expense = await harness.run({
      kind: 'recordExpense',
      bookId: BOOK_ID,
      amount: SAR(10_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: '',
      category: null,
      flexibleDefinitionId: null,
    });
    const originalId = effectRecordId(expense.receipt, 'expenseRecorded');
    await harness.run({
      kind: 'recordExpenseReturn',
      bookId: BOOK_ID,
      expenseEntryId: originalId,
      amount: SAR(8_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: '',
    });
    // 1000 - 100 + 80 = 980.
    expect(availableMinor(harness.state(), harness)).toBe(98_000);

    // Shrinking to 50 would strand 80 of refunds above a 50 payment, and
    // voiding would strand all 80: both rejected without writes.
    const revisionBefore = harness.state().revision;
    const entriesBefore = harness.state().entries.length;
    expect(harness.previewFail({
      kind: 'correctExpense',
      bookId: BOOK_ID,
      expenseEntryId: originalId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: '',
      replacement: { amount: SAR(5_000) },
    })).toEqual({
      kind: 'returnExceedsReturnable',
      bookId: BOOK_ID,
      targetKind: 'expense',
      targetId: originalId,
      requested: SAR(8_000),
      returnable: SAR(5_000),
    });
    expect(harness.previewFail({
      kind: 'correctExpense',
      bookId: BOOK_ID,
      expenseEntryId: originalId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: 'void',
      replacement: null,
    })).toEqual({
      kind: 'returnExceedsReturnable',
      bookId: BOOK_ID,
      targetKind: 'expense',
      targetId: originalId,
      requested: SAR(8_000),
      returnable: SAR(0),
    });
    expect(harness.state().revision).toBe(revisionBefore);
    expect(harness.state().entries).toHaveLength(entriesBefore);

    // Replacement 90 is valid (90 >= 80): only 10 additional refund is
    // available across the old and new IDs.
    const correction = await harness.run({
      kind: 'correctExpense',
      bookId: BOOK_ID,
      expenseEntryId: originalId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: '',
      replacement: { amount: SAR(9_000) },
    });
    // 1000 - 90 + 80 = 990.
    expect(availableMinor(harness.state(), harness)).toBe(99_000);
    const replacementId = effectRecordId(correction.receipt, 'expenseRecorded');
    await harness.run({
      kind: 'recordExpenseReturn',
      bookId: BOOK_ID,
      expenseEntryId: replacementId,
      amount: SAR(1_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-07' },
      note: '',
    });
    // 1000 - 90 + 90 = 1000.
    expect(availableMinor(harness.state(), harness)).toBe(100_000);
    expect(harness.previewFail({
      kind: 'recordExpenseReturn',
      bookId: BOOK_ID,
      expenseEntryId: replacementId,
      amount: SAR(1),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-08' },
      note: '',
    })).toEqual({
      kind: 'returnExceedsReturnable',
      bookId: BOOK_ID,
      targetKind: 'expense',
      targetId: replacementId,
      requested: SAR(1),
      returnable: SAR(0),
    });
  });

  it('a second correction keeps the lineage cap', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    const expense = await harness.run({
      kind: 'recordExpense',
      bookId: BOOK_ID,
      amount: SAR(10_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: '',
      category: null,
      flexibleDefinitionId: null,
    });
    const firstId = effectRecordId(expense.receipt, 'expenseRecorded');
    await harness.run({
      kind: 'recordExpenseReturn',
      bookId: BOOK_ID,
      expenseEntryId: firstId,
      amount: SAR(8_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: '',
    });
    const first = await harness.run({
      kind: 'correctExpense',
      bookId: BOOK_ID,
      expenseEntryId: firstId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: '',
      replacement: { amount: SAR(9_000) },
    });
    const secondId = effectRecordId(first.receipt, 'expenseRecorded');
    // Family refunds are 80; correcting 90 -> 95 keeps them covered, and the
    // allowance travels: 95 - 90 (80 old + 10 new below) = 5.
    await harness.run({
      kind: 'recordExpenseReturn',
      bookId: BOOK_ID,
      expenseEntryId: secondId,
      amount: SAR(1_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-07' },
      note: '',
    });
    const second = await harness.run({
      kind: 'correctExpense',
      bookId: BOOK_ID,
      expenseEntryId: secondId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-08' },
      note: '',
      replacement: { amount: SAR(9_500) },
    });
    // Outflows 95, effective refunds 90: 1000 - 95 + 90 = 995.
    expect(availableMinor(harness.state(), harness)).toBe(99_500);
    const thirdId = effectRecordId(second.receipt, 'expenseRecorded');
    await harness.run({
      kind: 'recordExpenseReturn',
      bookId: BOOK_ID,
      expenseEntryId: thirdId,
      amount: SAR(500),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-09' },
      note: '',
    });
    expect(availableMinor(harness.state(), harness)).toBe(100_000);
    const failure = harness.previewFail({
      kind: 'recordExpenseReturn',
      bookId: BOOK_ID,
      expenseEntryId: thirdId,
      amount: SAR(1),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-10' },
      note: '',
    });
    expect(failure.kind).toBe('returnExceedsReturnable');
  });
});

describe('F5: correction of returns', () => {
  it('mistaken return 50 corrected to 10 gives 910 and preserves history', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    const expense = await harness.run({
      kind: 'recordExpense',
      bookId: BOOK_ID,
      amount: SAR(10_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: '',
      category: null,
      flexibleDefinitionId: null,
    });
    const expenseId = effectRecordId(expense.receipt, 'expenseRecorded');
    const mistaken = await harness.run({
      kind: 'recordExpenseReturn',
      bookId: BOOK_ID,
      expenseEntryId: expenseId,
      amount: SAR(5_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: 'should have been 10',
    });
    const returnId = effectRecordId(mistaken.receipt, 'expenseReturnRecorded');
    // 1000 - 100 + 50 = 950 with the mistake standing.
    expect(availableMinor(harness.state(), harness)).toBe(95_000);

    const correction = await harness.run({
      kind: 'correctExpenseReturn',
      bookId: BOOK_ID,
      returnEntryId: returnId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: 'cashier error',
      replacement: { amount: SAR(1_000) },
    });
    // 1000 - 100 + 10 = 910.
    expect(availableMinor(harness.state(), harness)).toBe(91_000);
    expect(correction.receipt.effects).toHaveLength(2);
    expect(correction.receipt.effects[0]).toMatchObject({ kind: 'expenseReturnReversalRecorded', reversesEntryId: returnId, amount: SAR(-5_000) });
    expect(correction.receipt.effects[1]).toMatchObject({ kind: 'expenseReturnRecorded', amount: SAR(1_000), linkedExpenseEntryId: expenseId });

    // History preserved verbatim: expense, return, return reversal, replacement.
    const kinds = harness.state().entries.map((entry) => entry.kind);
    expect(kinds).toEqual(['expense', 'expenseReturn', 'expenseReturnReversal', 'expenseReturn']);
    const original = harness.state().entries.find((entry) => entry.entryId === returnId);
    expect(original).toMatchObject({ kind: 'expenseReturn', amount: SAR(5_000) });

    // The corrected return cannot be corrected again; the allowance is now
    // 100 - 10 = 90 across the family.
    const duplicate = harness.previewFail({
      kind: 'correctExpenseReturn',
      bookId: BOOK_ID,
      returnEntryId: returnId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-07' },
      note: '',
      replacement: { amount: SAR(500) },
    });
    expect(duplicate.kind).toBe('duplicateReversal');
    const replacementId = effectRecordId(correction.receipt, 'expenseReturnRecorded');
    await harness.run({
      kind: 'recordExpenseReturn',
      bookId: BOOK_ID,
      expenseEntryId: expenseId,
      amount: SAR(9_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-08' },
      note: '',
    });
    // Family refunds are 10 + 90 = 100 = the expense: topped up exactly.
    expect(availableMinor(harness.state(), harness)).toBe(100_000);
    void replacementId;
  });

  it('covers obligation returns, replay, and injected mid-commit failure', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    await harness.run({
      kind: 'createObligation',
      bookId: BOOK_ID,
      obligationId: 'obl-f5',
      expectedAmount: SAR(8_000),
      note: '',
      category: null,
    });
    await harness.run({
      kind: 'recordObligationPayment',
      bookId: BOOK_ID,
      obligationId: 'obl-f5',
      amount: SAR(3_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: '',
      category: null,
    });
    const mistaken = await harness.run({
      kind: 'recordObligationReturn',
      bookId: BOOK_ID,
      obligationId: 'obl-f5',
      amount: SAR(2_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: 'should have been 12',
    });
    const returnId = effectRecordId(mistaken.receipt, 'expenseReturnRecorded');
    // 1000 + 20 - 30 - 70 = 920.
    expect(availableMinor(harness.state(), harness)).toBe(92_000);

    // Correct 20 -> 12: net 18, residual 62, still 920.
    const command = {
      kind: 'correctExpenseReturn',
      bookId: BOOK_ID,
      returnEntryId: returnId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-07' },
      note: '',
      replacement: { amount: SAR(1_200) },
    };
    const preview = previewCommand(harness.repo, command, harness.context);
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error('unreachable');
    const confirmation = {
      operationId: opId('op-f5-once'),
      expectedRevision: preview.preview.expectedRevision,
      previewDigest: preview.preview.previewDigest,
    };
    // Injected failure between the reversal/replacement writes: the single
    // atomic commit carries both facts, so everything rolls back together.
    harness.repo.injectWriteFailure('putBookState');
    const stateBefore = JSON.stringify(harness.state());
    await expect(harness.confirm(command, confirmation)).rejects.toThrow('injected adapter failure');
    expect(JSON.stringify(harness.state())).toBe(stateBefore);

    const first = await harness.confirm(command, confirmation);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');
    expect(first.receipt.effects).toHaveLength(2);
    expect(availableMinor(harness.state(), harness)).toBe(92_000);
    expect(deriveObligationView(harness.state(), obligationId('obl-f5'))?.netPayments).toEqual(SAR(1_800));

    // Retry replays the original receipt with no second effect.
    const retry = await harness.confirm(command, confirmation);
    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error('unreachable');
    expect(retry.retried).toBe(true);
    expect(retry.receipt).toEqual(first.receipt);

    // Voiding the replacement outright restores the full payment picture:
    // net 30, residual 50, still 920 while open.
    const replacementId = effectRecordId(first.receipt, 'expenseReturnRecorded');
    await harness.run({
      kind: 'correctExpenseReturn',
      bookId: BOOK_ID,
      returnEntryId: replacementId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-08' },
      note: 'refund never arrived',
      replacement: null,
    });
    expect(availableMinor(harness.state(), harness)).toBe(92_000);
    expect(deriveObligationView(harness.state(), obligationId('obl-f5'))?.netPayments).toEqual(SAR(3_000));
  });

  it('rejects return corrections that break the caps and mistargeted kinds', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    const expense = await harness.run({
      kind: 'recordExpense',
      bookId: BOOK_ID,
      amount: SAR(10_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: '',
      category: null,
      flexibleDefinitionId: null,
    });
    const expenseId = effectRecordId(expense.receipt, 'expenseRecorded');
    const recorded = await harness.run({
      kind: 'recordExpenseReturn',
      bookId: BOOK_ID,
      expenseEntryId: expenseId,
      amount: SAR(5_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: '',
    });
    const returnId = effectRecordId(recorded.receipt, 'expenseReturnRecorded');

    // Replacing 50 with 60 would push family refunds to 60+... exceeds 100? No:
    // 50 removed, 60 added against a 100 expense is fine. Use a tighter case:
    // replacing 50 with 50 is a no-op-shaped correction the validator allows
    // only with an amount; pushing past the allowance is rejected.
    const revisionBefore = harness.state().revision;
    expect(harness.previewFail({
      kind: 'correctExpenseReturn',
      bookId: BOOK_ID,
      returnEntryId: returnId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: '',
      replacement: { amount: SAR(10_001) },
    })).toEqual({
      kind: 'returnExceedsReturnable',
      bookId: BOOK_ID,
      targetKind: 'expense',
      targetId: expenseId,
      requested: SAR(10_001),
      returnable: SAR(10_000),
    });
    // Correcting an expense as if it were a return is mistargeted.
    expect(harness.previewFail({
      kind: 'correctExpenseReturn',
      bookId: BOOK_ID,
      returnEntryId: expenseId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: '',
      replacement: { amount: SAR(100) },
    })).toEqual({ kind: 'notAReturn', bookId: BOOK_ID, entryId: expenseId });
    // A replacement must state its amount.
    const failure = harness.previewFail({
      kind: 'correctExpenseReturn',
      bookId: BOOK_ID,
      returnEntryId: returnId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: '',
      replacement: {},
    });
    expect(failure.kind).toBe('invalidCommand');
    expect(harness.state().revision).toBe(revisionBefore);
  });
});

describe('F4: disputes resolve only when explicitly resolved', () => {
  it('partial and full refunds preserve an open dispute; explicit resolution removes only that reason', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    await harness.run({
      kind: 'createObligation',
      bookId: BOOK_ID,
      obligationId: 'obl-f4',
      expectedAmount: SAR(8_000),
      note: '',
      category: null,
    });
    await harness.run({
      kind: 'recordObligationPayment',
      bookId: BOOK_ID,
      obligationId: 'obl-f4',
      amount: SAR(3_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: '',
      category: null,
    });
    await harness.run({ kind: 'openObligationDispute', bookId: BOOK_ID, obligationId: 'obl-f4', note: 'overcharged' });
    const completenessOf = () => computeCompleteness(harness.state(), { asOfInstantMs: harness.context.clock.nowMs(), calculationVersion: 'p03-fix-01' });

    // Partial refund: dispute stays open.
    await harness.run({
      kind: 'recordObligationReturn',
      bookId: BOOK_ID,
      obligationId: 'obl-f4',
      amount: SAR(100),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: 'token refund',
    });
    expect(completenessOf().pool).toEqual({
      state: 'needsAttention',
      reasons: [{ type: 'openDisputedObligation', obligationId: 'obl-f4', residualReleased: false }],
    });

    // Full refund of the net: still open — a refund is money, not a ruling.
    await harness.run({
      kind: 'recordObligationReturn',
      bookId: BOOK_ID,
      obligationId: 'obl-f4',
      amount: SAR(2_900),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-07' },
      note: 'remaining refund',
    });
    expect(deriveObligationView(harness.state(), obligationId('obl-f4'))?.netPayments).toEqual(SAR(0));
    expect(completenessOf().pool).toEqual({
      state: 'needsAttention',
      reasons: [{ type: 'openDisputedObligation', obligationId: 'obl-f4', residualReleased: false }],
    });

    // Resolving without an open dispute, with a bad reason, or with a
    // mismatched link is rejected.
    expect(harness.previewFail({
      kind: 'resolveObligationDispute',
      bookId: BOOK_ID,
      obligationId: 'obl-missing',
      resolution: 'other',
      linkedReturnEntryId: null,
      note: '',
    }).kind).toBe('unknownObligation');
    expect(harness.previewFail({
      kind: 'resolveObligationDispute',
      bookId: BOOK_ID,
      obligationId: 'obl-f4',
      resolution: 'bogus',
      linkedReturnEntryId: null,
      note: '',
    }).kind).toBe('invalidCommand');

    // Explicit resolution removes only the dispute reason.
    await harness.run({
      kind: 'resolveObligationDispute',
      bookId: BOOK_ID,
      obligationId: 'obl-f4',
      resolution: 'other',
      linkedReturnEntryId: null,
      note: 'merchant admitted the error',
    });
    expect(completenessOf().pool).toEqual({ state: 'current', reasons: [] });
    expect(deriveObligationView(harness.state(), obligationId('obl-f4'))?.disputeOpen).toBe(false);
  });

  it('returnReceived requires its linked return; reopening alone never resolves', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    await harness.run({
      kind: 'createObligation',
      bookId: BOOK_ID,
      obligationId: 'obl-f4b',
      expectedAmount: SAR(8_000),
      note: '',
      category: null,
    });
    await harness.run({
      kind: 'recordObligationPayment',
      bookId: BOOK_ID,
      obligationId: 'obl-f4b',
      amount: SAR(3_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: '',
      category: null,
    });
    await harness.run({ kind: 'openObligationDispute', bookId: BOOK_ID, obligationId: 'obl-f4b', note: '' });
    const refund = await harness.run({
      kind: 'recordObligationReturn',
      bookId: BOOK_ID,
      obligationId: 'obl-f4b',
      amount: SAR(3_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: 'full refund',
    });
    const returnId = effectRecordId(refund.receipt, 'expenseReturnRecorded');

    // returnReceived without its link, and a link claimed by another reason,
    // are both rejected without writes.
    const revisionBefore = harness.state().revision;
    expect(harness.previewFail({
      kind: 'resolveObligationDispute',
      bookId: BOOK_ID,
      obligationId: 'obl-f4b',
      resolution: 'returnReceived',
      linkedReturnEntryId: null,
      note: '',
    }).kind).toBe('invalidCommand');
    expect(harness.previewFail({
      kind: 'resolveObligationDispute',
      bookId: BOOK_ID,
      obligationId: 'obl-f4b',
      resolution: 'other',
      linkedReturnEntryId: returnId,
      note: '',
    }).kind).toBe('invalidCommand');
    expect(harness.state().revision).toBe(revisionBefore);

    // The linked resolution succeeds and names its return.
    const resolution = await harness.run({
      kind: 'resolveObligationDispute',
      bookId: BOOK_ID,
      obligationId: 'obl-f4b',
      resolution: 'returnReceived',
      linkedReturnEntryId: returnId,
      note: '',
    });
    expect(resolution.receipt.effects).toEqual([
      { kind: 'obligationDisputeResolved', obligationId: 'obl-f4b', via: 'explicitResolution' },
    ]);

    // Cancellation resolves through its own previewed effect; reopening
    // emits no resolution of its own.
    await harness.run({ kind: 'openObligationDispute', bookId: BOOK_ID, obligationId: 'obl-f4b', note: 'again' });
    const cancelPreview = previewCommand(harness.repo, {
      kind: 'cancelObligation',
      bookId: BOOK_ID,
      obligationId: 'obl-f4b',
      note: '',
    }, harness.context);
    expect(cancelPreview.ok).toBe(true);
    if (!cancelPreview.ok) throw new Error('unreachable');
    expect(cancelPreview.preview.effects.map((effect) => effect.kind)).toEqual([
      'obligationCancelled',
      'obligationDisputeResolved',
    ]);
    await harness.run({ kind: 'cancelObligation', bookId: BOOK_ID, obligationId: 'obl-f4b', note: '' });
    const reopened = await harness.run({ kind: 'reopenObligation', bookId: BOOK_ID, obligationId: 'obl-f4b', note: '' });
    expect(reopened.receipt.effects.map((effect) => effect.kind)).toEqual(['obligationReopened']);
  });

  it('returnReceived rejects a replaced original without writes and accepts the live replacement', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    await harness.run({ kind: 'createObligation', bookId: BOOK_ID, obligationId: 'obl-f4c', expectedAmount: SAR(8_000), note: '', category: null });
    await harness.run({
      kind: 'recordObligationPayment',
      bookId: BOOK_ID,
      obligationId: 'obl-f4c',
      amount: SAR(3_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: '',
      category: null,
    });
    await harness.run({ kind: 'openObligationDispute', bookId: BOOK_ID, obligationId: 'obl-f4c', note: '' });
    const refund = await harness.run({
      kind: 'recordObligationReturn',
      bookId: BOOK_ID,
      obligationId: 'obl-f4c',
      amount: SAR(3_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: '',
    });
    const originalId = effectRecordId(refund.receipt, 'expenseReturnRecorded');
    const correction = await harness.run({
      kind: 'correctExpenseReturn',
      bookId: BOOK_ID,
      returnEntryId: originalId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-07' },
      note: '',
      replacement: { amount: SAR(2_000) },
    });
    const replacementId = effectRecordId(correction.receipt, 'expenseReturnRecorded');
    const revisionBefore = harness.state().revision;
    const entriesBefore = harness.state().entries.length;
    expect(harness.previewFail({
      kind: 'resolveObligationDispute',
      bookId: BOOK_ID,
      obligationId: 'obl-f4c',
      resolution: 'returnReceived',
      linkedReturnEntryId: originalId,
      note: '',
    }).kind).toBe('invalidCommand');
    expect(harness.state().revision).toBe(revisionBefore);
    expect(harness.state().entries).toHaveLength(entriesBefore);
    await harness.run({
      kind: 'resolveObligationDispute',
      bookId: BOOK_ID,
      obligationId: 'obl-f4c',
      resolution: 'returnReceived',
      linkedReturnEntryId: replacementId,
      note: '',
    });
    expect(deriveObligationView(harness.state(), obligationId('obl-f4c'))?.disputeOpen).toBe(false);
  });

  it('a voided return cannot evidence returnReceived while other reasons still resolve', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    await harness.run({ kind: 'createObligation', bookId: BOOK_ID, obligationId: 'obl-f4d', expectedAmount: SAR(8_000), note: '', category: null });
    await harness.run({
      kind: 'recordObligationPayment',
      bookId: BOOK_ID,
      obligationId: 'obl-f4d',
      amount: SAR(3_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: '',
      category: null,
    });
    await harness.run({ kind: 'openObligationDispute', bookId: BOOK_ID, obligationId: 'obl-f4d', note: '' });
    const refund = await harness.run({
      kind: 'recordObligationReturn',
      bookId: BOOK_ID,
      obligationId: 'obl-f4d',
      amount: SAR(3_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: '',
    });
    const originalId = effectRecordId(refund.receipt, 'expenseReturnRecorded');
    await harness.run({
      kind: 'correctExpenseReturn',
      bookId: BOOK_ID,
      returnEntryId: originalId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-07' },
      note: 'never arrived',
      replacement: null,
    });
    const revisionBefore = harness.state().revision;
    const entriesBefore = harness.state().entries.length;
    expect(harness.previewFail({
      kind: 'resolveObligationDispute',
      bookId: BOOK_ID,
      obligationId: 'obl-f4d',
      resolution: 'returnReceived',
      linkedReturnEntryId: originalId,
      note: '',
    }).kind).toBe('invalidCommand');
    expect(harness.state().revision).toBe(revisionBefore);
    expect(harness.state().entries).toHaveLength(entriesBefore);
    await harness.run({
      kind: 'resolveObligationDispute',
      bookId: BOOK_ID,
      obligationId: 'obl-f4d',
      resolution: 'notOwed',
      linkedReturnEntryId: null,
      note: '',
    });
    expect(deriveObligationView(harness.state(), obligationId('obl-f4d'))?.disputeOpen).toBe(false);
  });
});
