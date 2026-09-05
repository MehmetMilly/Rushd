import { describe, expect, it } from 'vitest';
import {
  computeAvailability,
  computeCompleteness,
  describeCommandFailure,
  executeCommand,
  previewCommand,
  type BookState,
  type CommandContext,
  type FinanceCommand,
} from '../../src/application/commands';
import { makeBookId, makeObligationId, makeOperationId, type BookId, type ObligationId, type OperationId } from '../../src/domain/contracts/identity';
import { deriveObligationView } from '../../src/domain/obligations/derive';
import { deriveTrackedPool } from '../../src/domain/allocations/derive';
import { createDeterministicContext } from './support/deterministic-context';
import { InMemoryFinanceRepository } from './support/in-memory-repository';

const BOOK_ID = 'book-everyday';
const CYCLE_ID = `cyc:${BOOK_ID}:2026-09-01`;
const DESTINATION_CYCLE_ID = CYCLE_ID;

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
 * Expectations in these tests are hand-calculated from the master plan's
 * financial rules, never read back from the implementation under test.
 */
function makeHarness() {
  const repo = new InMemoryFinanceRepository();
  const { context } = createDeterministicContext();
  let sequence = 0;
  const run = async (rawCommand: unknown): Promise<{ receipt: import('../../src/domain/contracts/commands').CommandReceipt }> => {
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
  const state = (): BookState => {
    const found = repo.getBookState(theBookId);
    if (found === null) throw new Error('book missing');
    return found;
  };
  return { repo, context, run, state };
}

async function seedStandardBook(harness: ReturnType<typeof makeHarness>): Promise<void> {
  await harness.run({
    kind: 'createBook',
    bookId: BOOK_ID,
    displayName: 'everyday',
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

function availableMinor(state: BookState, context: CommandContext): number {
  const availability = computeAvailability(state, { asOfInstantMs: context.clock.nowMs(), calculationVersion: 'p03-task-b-1' });
  if (availability.status !== 'computed') throw new Error(`availability unavailable: ${availability.reason}`);
  return availability.available.minorUnits;
}

describe('reality-check reference scenario (hand-calculated)', () => {
  // 1,000 SAR start, fund/assign 200 to a goal, reserve a 100 bill -> 700.
  it('deducts funding and reservations exactly once; assignment and release behave', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    expect(availableMinor(harness.state(), harness.context)).toBe(100_000);

    await harness.run({
      kind: 'createGoal',
      bookId: BOOK_ID,
      goalId: 'goal-emergency',
      name: 'Emergency fund',
      targetAmount: SAR(5_000_00),
    });
    await harness.run({
      kind: 'fundAllocationPool',
      bookId: BOOK_ID,
      amount: SAR(20_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-02' },
      note: '',
    });
    await harness.run({
      kind: 'assignToGoal',
      bookId: BOOK_ID,
      goalId: 'goal-emergency',
      amount: SAR(20_000),
      note: '',
    });
    expect(availableMinor(harness.state(), harness.context)).toBe(80_000);

    await harness.run({
      kind: 'createObligation',
      bookId: BOOK_ID,
      obligationId: 'obl-electricity',
      expectedAmount: SAR(10_000),
      note: 'electricity bill',
      category: 'utilities',
    });
    expect(availableMinor(harness.state(), harness.context)).toBe(70_000);

    // The tracked pool still includes the earmarked goal funds: unallocated 0
    // + assigned 200 = 200 total, while availability is 700.
    const pool = deriveTrackedPool(harness.state());
    expect(pool.total).toEqual(SAR(20_000));
    expect(pool.unallocated).toEqual(SAR(0));
    expect(pool.goals[0]?.assigned).toEqual(SAR(20_000));

    // Assigning already-funded money to a second goal has no availability cost.
    await harness.run({
      kind: 'createGoal',
      bookId: BOOK_ID,
      goalId: 'goal-laptop',
      name: 'Laptop',
      targetAmount: SAR(30_000_00),
    });
    await harness.run({
      kind: 'unassignFromGoal',
      bookId: BOOK_ID,
      goalId: 'goal-emergency',
      amount: SAR(8_000),
      note: '',
    });
    await harness.run({
      kind: 'assignToGoal',
      bookId: BOOK_ID,
      goalId: 'goal-laptop',
      amount: SAR(8_000),
      note: '',
    });
    expect(availableMinor(harness.state(), harness.context)).toBe(70_000);

    // Releasing 100 from the goal returns it to spending in the named cycle:
    // 700 -> 800, with no invented external inflow. (goal-emergency holds
    // 120 after the unassignment, so releasing 100 is covered.)
    await harness.run({
      kind: 'releaseAllocation',
      bookId: BOOK_ID,
      goalId: 'goal-emergency',
      amount: SAR(10_000),
      destinationCycleId: DESTINATION_CYCLE_ID,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-03' },
      note: 'plan changed',
    });
    expect(availableMinor(harness.state(), harness.context)).toBe(80_000);
    expect(deriveTrackedPool(harness.state()).total).toEqual(SAR(10_000));

    // The release is not an income entry: the inflow component stays zero.
    const availability = computeAvailability(harness.state(), { asOfInstantMs: harness.context.clock.nowMs(), calculationVersion: 'p03-task-b-1' });
    if (availability.status !== 'computed') throw new Error('unreachable');
    expect(availability.components.netInflows).toEqual(SAR(0));
    expect(availability.components.netCycleAllocations).toEqual(SAR(10_000));
    expect(availability.components.residualReservations).toEqual(SAR(10_000));
  });
});

describe('partial payment and settlement (hand-calculated)', () => {
  // 1,000 start, 80 obligation: 920 -> pay 30 -> 920 -> pay 35 -> 920 ->
  // final settlement -> 935 -> real return 10 -> 945.
  it('keeps the residual reserved across partial payments and releases it on settlement', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    await harness.run({
      kind: 'createObligation',
      bookId: BOOK_ID,
      obligationId: 'obl-internet',
      expectedAmount: SAR(8_000),
      note: '',
      category: null,
    });
    expect(availableMinor(harness.state(), harness.context)).toBe(92_000);

    await harness.run({
      kind: 'recordObligationPayment',
      bookId: BOOK_ID,
      obligationId: 'obl-internet',
      amount: SAR(3_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: '',
      category: 'utilities',
    });
    expect(availableMinor(harness.state(), harness.context)).toBe(92_000);

    await harness.run({
      kind: 'recordObligationPayment',
      bookId: BOOK_ID,
      obligationId: 'obl-internet',
      amount: SAR(3_500),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: '',
      category: 'utilities',
    });
    expect(availableMinor(harness.state(), harness.context)).toBe(92_000);

    const viewBefore = deriveObligationView(harness.state(), obligationId('obl-internet'));
    expect(viewBefore?.status).toBe('open');
    expect(viewBefore?.residualReservation).toEqual(SAR(1_500));
    expect(viewBefore?.netPayments).toEqual(SAR(6_500));

    await harness.run({
      kind: 'settleObligationFinally',
      bookId: BOOK_ID,
      obligationId: 'obl-internet',
      note: 'confirmed final amount 65',
    });
    expect(availableMinor(harness.state(), harness.context)).toBe(93_500);
    expect(deriveObligationView(harness.state(), obligationId('obl-internet'))?.status).toBe('finallySettled');

    // A real return of 10 after final settlement adds money without reopening.
    await harness.run({
      kind: 'recordObligationReturn',
      bookId: BOOK_ID,
      obligationId: 'obl-internet',
      amount: SAR(1_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-07' },
      note: 'provider credit',
    });
    expect(availableMinor(harness.state(), harness.context)).toBe(94_500);
    expect(deriveObligationView(harness.state(), obligationId('obl-internet'))?.status).toBe('finallySettled');
  });

  it('allows overpayment but never reserves a negative residual', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    await harness.run({
      kind: 'createObligation',
      bookId: BOOK_ID,
      obligationId: 'obl-over',
      expectedAmount: SAR(5_000),
      note: '',
      category: null,
    });
    // Overpay: 50 expected, 60 paid. Residual floors at 0 and availability
    // honestly reflects the extra outflow: 1000 - 60 = 940.
    await harness.run({
      kind: 'recordObligationPayment',
      bookId: BOOK_ID,
      obligationId: 'obl-over',
      amount: SAR(6_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: '',
      category: null,
    });
    expect(availableMinor(harness.state(), harness.context)).toBe(94_000);
    const view = deriveObligationView(harness.state(), obligationId('obl-over'));
    expect(view?.netPayments).toEqual(SAR(6_000));
    expect(view?.residualReservation).toEqual(SAR(0));
  });

  it('keeps disputed posted payments as outflows and requires an explicit release for the unpaid residual', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    await harness.run({
      kind: 'createObligation',
      bookId: BOOK_ID,
      obligationId: 'obl-disputed',
      expectedAmount: SAR(10_000),
      note: '',
      category: null,
    });
    await harness.run({
      kind: 'recordObligationPayment',
      bookId: BOOK_ID,
      obligationId: 'obl-disputed',
      amount: SAR(4_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: '',
      category: null,
    });
    // 1000 - 40 paid - 60 reserved = 900.
    expect(availableMinor(harness.state(), harness.context)).toBe(90_000);

    await harness.run({
      kind: 'openObligationDispute',
      bookId: BOOK_ID,
      obligationId: 'obl-disputed',
      note: 'merchant overcharged',
    });
    // The dispute alone changes nothing about the money: posted payments stay
    // outflows and the unpaid residual stays reserved.
    expect(availableMinor(harness.state(), harness.context)).toBe(90_000);

    // Previewed release of the unpaid 60 residual: 900 -> 960, with the
    // unresolved uncertainty recorded.
    await harness.run({
      kind: 'releaseDisputedResidual',
      bookId: BOOK_ID,
      obligationId: 'obl-disputed',
      note: 'user confirmed pause',
    });
    expect(availableMinor(harness.state(), harness.context)).toBe(96_000);

    const completeness = computeCompleteness(harness.state(), { asOfInstantMs: harness.context.clock.nowMs(), calculationVersion: 'p03-task-b-1' });
    expect(completeness.pool.state).toBe('needsAttention');
    expect(completeness.pool.reasons).toContainEqual({
      type: 'openDisputedObligation',
      obligationId: 'obl-disputed',
      residualReleased: true,
    });

    // A real return of 40 does NOT resolve the dispute on its own — even a
    // full refund does not prove the disagreement is over. It adds the money
    // back without reopening anything, while the standing release decision
    // still leaves the unpaid 100 un-reserved.
    await harness.run({
      kind: 'recordObligationReturn',
      bookId: BOOK_ID,
      obligationId: 'obl-disputed',
      amount: SAR(4_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-08' },
      note: 'chargeback received',
    });
    expect(availableMinor(harness.state(), harness.context)).toBe(100_000);
    const completenessAfter = computeCompleteness(harness.state(), { asOfInstantMs: harness.context.clock.nowMs(), calculationVersion: 'p03-task-b-1' });
    expect(completenessAfter.pool.state).toBe('needsAttention');
    expect(completenessAfter.pool.reasons).toEqual([
      { type: 'openDisputedObligation', obligationId: 'obl-disputed', residualReleased: true },
    ]);

    // Explicit confirmed resolution removes only the dispute reason: the
    // recorded release uncertainty persists until the obligation itself is
    // closed.
    await harness.run({
      kind: 'resolveObligationDispute',
      bookId: BOOK_ID,
      obligationId: 'obl-disputed',
      resolution: 'returnReceived',
      linkedReturnEntryId: ((): string => {
        const returns = harness.state().entries.filter((entry) => entry.kind === 'expenseReturn');
        const last = returns[returns.length - 1];
        if (last === undefined) throw new Error('expected a return entry');
        return last.entryId;
      })(),
      note: 'chargeback settles the dispute',
    });
    const completenessResolved = computeCompleteness(harness.state(), { asOfInstantMs: harness.context.clock.nowMs(), calculationVersion: 'p03-task-b-1' });
    expect(completenessResolved.pool.state).toBe('needsAttention');
    expect(completenessResolved.pool.reasons).toEqual([
      { type: 'releasedResidualUncertainty', obligationId: 'obl-disputed', releasedUnpaid: { currency: 'SAR', minorUnits: 10_000 } },
    ]);

    // Cancelling the obligation (the charge never stands) removes the
    // uncertainty: the reason disappears because its evidence changed.
    await harness.run({
      kind: 'cancelObligation',
      bookId: BOOK_ID,
      obligationId: 'obl-disputed',
      note: 'charge fully reversed',
    });
    const completenessCancelled = computeCompleteness(harness.state(), { asOfInstantMs: harness.context.clock.nowMs(), calculationVersion: 'p03-task-b-1' });
    expect(completenessCancelled.pool.state).toBe('current');
    expect(completenessCancelled.pool.reasons).toHaveLength(0);
  });

  it('supports explicit reopening after cancellation', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    await harness.run({
      kind: 'createObligation',
      bookId: BOOK_ID,
      obligationId: 'obl-reopen',
      expectedAmount: SAR(10_000),
      note: '',
      category: null,
    });
    await harness.run({
      kind: 'recordObligationPayment',
      bookId: BOOK_ID,
      obligationId: 'obl-reopen',
      amount: SAR(2_500),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: '',
      category: null,
    });
    await harness.run({
      kind: 'cancelObligation',
      bookId: BOOK_ID,
      obligationId: 'obl-reopen',
      note: 'thought it was cancelled',
    });
    // Cancellation releases the residual: 1000 - 25 = 975.
    expect(availableMinor(harness.state(), harness.context)).toBe(97_500);

    await harness.run({
      kind: 'reopenObligation',
      bookId: BOOK_ID,
      obligationId: 'obl-reopen',
      note: 'merchant confirmed it stands',
    });
    // Reopening reinstates max(0, 100 - 25) = 75: 975 -> 900.
    expect(availableMinor(harness.state(), harness.context)).toBe(90_000);
    expect(deriveObligationView(harness.state(), obligationId('obl-reopen'))?.status).toBe('open');
    expect(deriveObligationView(harness.state(), obligationId('obl-reopen'))?.residualReservation).toEqual(SAR(7_500));
  });
});

describe('actual activity: expenses, returns, corrections', () => {
  it('records a standalone expense, a partial return, and preserves original facts through a linked correction', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);

    const expense = await harness.run({
      kind: 'recordExpense',
      bookId: BOOK_ID,
      amount: SAR(12_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: 'groceries',
      category: 'food',
      flexibleDefinitionId: null,
    });
    expect(availableMinor(harness.state(), harness.context)).toBe(88_000);
    const originalEntryId = expense.receipt.effects.find((effect) => effect.kind === 'expenseRecorded');
    if (originalEntryId?.kind !== 'expenseRecorded') throw new Error('unreachable');

    // Partial return of 20: actual money received, availability back to 900.
    await harness.run({
      kind: 'recordExpenseReturn',
      bookId: BOOK_ID,
      expenseEntryId: originalEntryId.entryId,
      amount: SAR(2_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: 'refunded item',
    });
    expect(availableMinor(harness.state(), harness.context)).toBe(90_000);

    // Exceeding the linked returnable amount (120 - 20 = 100 remaining) is a
    // typed rejection with no write.
    const before = JSON.stringify(harness.state());
    const preview = previewCommand(harness.repo, {
      kind: 'recordExpenseReturn',
      bookId: BOOK_ID,
      expenseEntryId: originalEntryId.entryId,
      amount: SAR(11_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: '',
    }, harness.context);
    expect(preview.ok).toBe(false);
    if (!preview.ok) {
      expect(preview.failure).toEqual({
        kind: 'returnExceedsReturnable',
        bookId: BOOK_ID,
        targetKind: 'expense',
        targetId: originalEntryId.entryId,
        requested: SAR(11_000),
        returnable: SAR(10_000),
      });
    }
    expect(JSON.stringify(harness.state())).toBe(before);

    // A linked correction (amount 120 -> 90) appends a reversal and a
    // replacement without touching the original records.
    const entryCountBefore = harness.state().entries.length;
    await harness.run({
      kind: 'correctExpense',
      bookId: BOOK_ID,
      expenseEntryId: originalEntryId.entryId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: 'actual total was 90',
      replacement: { amount: SAR(9_000) },
    });
    const state = harness.state();
    expect(state.entries.length).toBe(entryCountBefore + 2);

    // Original facts preserved verbatim.
    const original = state.entries.find((entry) => entry.entryId === originalEntryId.entryId);
    expect(original).toMatchObject({ kind: 'expense', amount: SAR(12_000), localDate: '2026-09-04', category: 'food' });
    const reversal = state.entries[entryCountBefore];
    expect(reversal).toMatchObject({ kind: 'expenseReversal', reversesEntryId: originalEntryId.entryId, amount: SAR(-12_000) });
    const replacement = state.entries[entryCountBefore + 1];
    expect(replacement).toMatchObject({ kind: 'expense', amount: SAR(9_000), replacesEntryId: originalEntryId.entryId, category: 'food' });

    // Components update exactly: outflow 90 (live), returns 20 kept.
    // 1000 - 90 + 20 = 930.
    expect(availableMinor(state, harness.context)).toBe(93_000);
    const availability = computeAvailability(state, { asOfInstantMs: harness.context.clock.nowMs(), calculationVersion: 'p03-task-b-1' });
    if (availability.status !== 'computed') throw new Error('unreachable');
    expect(availability.components.netActualOutflows).toEqual(SAR(9_000));
    expect(availability.components.netReturns).toEqual(SAR(2_000));

    // The corrected (reversed) expense cannot be corrected again or returned
    // against; returns must target the live replacement.
    const secondCorrection = previewCommand(harness.repo, {
      kind: 'correctExpense',
      bookId: BOOK_ID,
      expenseEntryId: originalEntryId.entryId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-07' },
      note: '',
      replacement: null,
    }, harness.context);
    expect(secondCorrection.ok).toBe(false);
    if (!secondCorrection.ok) expect(secondCorrection.failure.kind).toBe('duplicateReversal');
  });

  it('corrects a paid fact without a replacement and can clear the category link', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    const expense = await harness.run({
      kind: 'recordExpense',
      bookId: BOOK_ID,
      amount: SAR(5_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: 'wrong entry',
      category: 'fuel',
      flexibleDefinitionId: 'flex-001',
    });
    const effect = expense.receipt.effects[0];
    if (effect?.kind !== 'expenseRecorded') throw new Error('unreachable');

    await harness.run({
      kind: 'correctExpense',
      bookId: BOOK_ID,
      expenseEntryId: effect.entryId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: 'duplicate entry removed',
      replacement: null,
    });
    // Removing the paid fact restores availability fully.
    expect(availableMinor(harness.state(), harness.context)).toBe(100_000);
    expect(harness.state().entries).toHaveLength(2);
  });

  it('records an expected refund with no money effect until it actually arrives', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    const before = JSON.stringify(harness.state());
    // An "expected refund" is nothing but a note in this engine: no command
    // exists that adds money for it, and recording nothing changes nothing.
    expect(availableMinor(harness.state(), harness.context)).toBe(100_000);
    expect(JSON.stringify(harness.state())).toBe(before);
  });

  it('shows overspending as a negative availability instead of clamping', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    await harness.run({
      kind: 'recordExpense',
      bookId: BOOK_ID,
      amount: SAR(120_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: 'manual overspend',
      category: null,
      flexibleDefinitionId: null,
    });
    expect(availableMinor(harness.state(), harness.context)).toBe(-20_000);
    const availability = computeAvailability(harness.state(), { asOfInstantMs: harness.context.clock.nowMs(), calculationVersion: 'p03-task-b-1' });
    if (availability.status !== 'computed') throw new Error('unreachable');
    expect(availability.available.minorUnits).toBe(-20_000);
  });

  it('treats category and flexible-link changes as descriptive only', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    const expense = await harness.run({
      kind: 'recordExpense',
      bookId: BOOK_ID,
      amount: SAR(3_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: '',
      category: null,
      flexibleDefinitionId: null,
    });
    const effect = expense.receipt.effects[0];
    if (effect?.kind !== 'expenseRecorded') throw new Error('unreachable');
    await harness.run({
      kind: 'correctExpense',
      bookId: BOOK_ID,
      expenseEntryId: effect.entryId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: 'classify',
      replacement: { category: 'food', flexibleDefinitionId: 'flex-7' },
    });
    // 1000 - 30 = 970: relinking changed no amounts.
    expect(availableMinor(harness.state(), harness.context)).toBe(97_000);
    const availability = computeAvailability(harness.state(), { asOfInstantMs: harness.context.clock.nowMs(), calculationVersion: 'p03-task-b-1' });
    if (availability.status !== 'computed') throw new Error('unreachable');
    expect(availability.components.netActualOutflows).toEqual(SAR(3_000));
    expect(availability.completeness.classification.state).toBe('current');
  });
});

describe('buffer', () => {
  it('deducts the explicit buffer and replaces it on each confirmed set', async () => {
    const harness = makeHarness();
    await seedStandardBook(harness);
    await harness.run({ kind: 'setBuffer', bookId: BOOK_ID, buffer: SAR(5_000), note: 'rainy day hold' });
    expect(availableMinor(harness.state(), harness.context)).toBe(95_000);
    await harness.run({ kind: 'setBuffer', bookId: BOOK_ID, buffer: SAR(0), note: 'cleared' });
    expect(availableMinor(harness.state(), harness.context)).toBe(100_000);
    expect(harness.state().buffer?.amount).toEqual(SAR(0));
  });
});

export type { FinanceCommand };
