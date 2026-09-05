import { describe, expect, it } from 'vitest';
import {
  computeAvailability,
  computeCompleteness,
  computePacing,
  describeCommandFailure,
  executeCommand,
  previewCommand,
  type BookState,
  type CommandContext,
} from '../../src/application/commands';
import { makeBookId, makeOperationId, type OperationId } from '../../src/domain/contracts/identity';
import { parseCivilDate, type CivilDate } from '../../src/domain/primitives/civil-date';
import { createDeterministicContext } from './support/deterministic-context';
import { InMemoryFinanceRepository } from './support/in-memory-repository';

const BOOK_ID = 'book-completeness';

function branded<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok) throw new Error('invalid test id');
  return result.value as T;
}

const theBookId = branded(makeBookId(BOOK_ID));
const opId = (raw: string): OperationId => branded(makeOperationId(raw));
const SAR = (minorUnits: number) => ({ currency: 'SAR' as const, minorUnits });
const PARAMS = { asOfInstantMs: Date.UTC(2026, 8, 5, 12, 0, 0), calculationVersion: 'p03-task-b-1' };

/** Parses through the public primitive so eligible dates are branded. */
function date(value: string): CivilDate {
  const parsed = parseCivilDate(value);
  if (!parsed.ok) throw new Error('invalid test date');
  return parsed.value;
}

let runCounter = 0;

function makeHarness() {
  const repo = new InMemoryFinanceRepository();
  const { context } = createDeterministicContext();
  const run = async (rawCommand: unknown): Promise<void> => {
    const preview = previewCommand(repo, rawCommand, context);
    expect(preview.ok, preview.ok ? undefined : describeCommandFailure(preview.failure)).toBe(true);
    if (!preview.ok) throw new Error('unreachable');
    const result = await executeCommand(repo, rawCommand, {
      operationId: opId(`op-${String(++runCounter).padStart(4, '0')}`),
      expectedRevision: preview.preview.expectedRevision,
      previewDigest: preview.preview.previewDigest,
    }, context);
    expect(result.ok, result.ok ? undefined : describeCommandFailure(result.failure)).toBe(true);
    if (!result.ok) throw new Error('unreachable');
  };
  const state = (): BookState | null => repo.getBookState(theBookId);
  return { repo, context, run, state };
}

describe('availability and completeness bases', () => {
  it('returns typed unavailable results without a book or an open cycle, never a fabricated zero', async () => {
    const harness = makeHarness();
    const availabilityNoBook = computeAvailability(harness.state(), PARAMS);
    expect(availabilityNoBook).toMatchObject({ status: 'unavailable', reason: 'noBook' });
    const pacingNoBook = computePacing(harness.state(), { eligibleDates: [date('2026-09-10')], ...PARAMS });
    expect(pacingNoBook).toMatchObject({ status: 'unavailable', reason: 'noBook' });

    await harness.run({
      kind: 'createBook',
      bookId: BOOK_ID,
      displayName: '',
      currency: 'SAR',
      timeZone: 'Asia/Riyadh',
      cycleAnchor: { kind: 'firstOfMonth' },
    });
    const availabilityNoCycle = computeAvailability(harness.state(), PARAMS);
    expect(availabilityNoCycle).toMatchObject({ status: 'unavailable', reason: 'noOpenCycle' });
    const pacingNoCycle = computePacing(harness.state(), { eligibleDates: [date('2026-09-10')], ...PARAMS });
    expect(pacingNoCycle).toMatchObject({ status: 'unavailable', reason: 'noOpenCycle' });

    const completenessNoBasis = computeCompleteness(harness.state(), PARAMS);
    expect(completenessNoBasis.pool).toEqual({ state: 'unavailable', reasons: [{ type: 'noPoolBasis' }] });
    expect(completenessNoBasis.classification).toEqual({ state: 'unavailable', reasons: [{ type: 'noPoolBasis' }] });
  });
});

describe('completeness independence of its dimensions', () => {
  it('keeps disputed-reservation reasons regardless of classification coverage', async () => {
    const harness = makeHarness();
    await harness.run({
      kind: 'createBook',
      bookId: BOOK_ID,
      displayName: '',
      currency: 'SAR',
      timeZone: 'Asia/Riyadh',
      cycleAnchor: { kind: 'firstOfMonth' },
    });
    await harness.run({
      kind: 'openCycle',
      bookId: BOOK_ID,
      startDate: '2026-09-01',
      startingFunds: SAR(100_000),
    });

    // A fully classified expense and an open disputed obligation: the pool
    // dimension stays Needs Attention even though classification is Current.
    await harness.run({
      kind: 'recordExpense',
      bookId: BOOK_ID,
      amount: SAR(1_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-02' },
      note: '',
      category: 'food',
      flexibleDefinitionId: null,
    });
    await harness.run({
      kind: 'createObligation',
      bookId: BOOK_ID,
      obligationId: 'obl-c',
      expectedAmount: SAR(2_000),
      note: '',
      category: 'utilities',
    });
    await harness.run({ kind: 'openObligationDispute', bookId: BOOK_ID, obligationId: 'obl-c', note: '' });

    const first = computeCompleteness(harness.state(), PARAMS);
    expect(first.pool.state).toBe('needsAttention');
    expect(first.pool.reasons).toEqual([{ type: 'openDisputedObligation', obligationId: 'obl-c', residualReleased: false }]);
    expect(first.classification.state).toBe('current');
    expect(first.classification.reasons).toEqual([]);

    // Classifying more movements does not remove the pool reason: reasons
    // only change when their underlying evidence changes.
    await harness.run({
      kind: 'recordExpense',
      bookId: BOOK_ID,
      amount: SAR(500),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-03' },
      note: '',
      category: 'transport',
      flexibleDefinitionId: null,
    });
    const second = computeCompleteness(harness.state(), PARAMS);
    expect(second.pool).toEqual(first.pool);
    expect(second.classification.state).toBe('current');

    // An unclassified expense flips only the classification dimension.
    await harness.run({
      kind: 'recordExpense',
      bookId: BOOK_ID,
      amount: SAR(300),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: '',
      category: null,
      flexibleDefinitionId: null,
    });
    const third = computeCompleteness(harness.state(), PARAMS);
    expect(third.pool).toEqual(first.pool);
    expect(third.classification).toEqual({
      state: 'needsAttention',
      reasons: [{ type: 'unclassifiedExpenseMovements', count: 1 }],
    });

    // Resolving the dispute removes exactly the pool reason.
    await harness.run({ kind: 'cancelObligation', bookId: BOOK_ID, obligationId: 'obl-c', note: '' });
    const fourth = computeCompleteness(harness.state(), PARAMS);
    expect(fourth.pool).toEqual({ state: 'current', reasons: [] });
    expect(fourth.classification).toEqual(third.classification);
  });

  it('distinguishes missing classification from a missing pool basis', async () => {
    const harness = makeHarness();
    await harness.run({
      kind: 'createBook',
      bookId: BOOK_ID,
      displayName: '',
      currency: 'SAR',
      timeZone: 'Asia/Riyadh',
      cycleAnchor: { kind: 'firstOfMonth' },
    });
    // No cycle: both dimensions are unavailable (no basis).
    const noBasis = computeCompleteness(harness.state(), PARAMS);
    expect(noBasis.pool.state).toBe('unavailable');
    expect(noBasis.classification.state).toBe('unavailable');

    await harness.run({
      kind: 'openCycle',
      bookId: BOOK_ID,
      startDate: '2026-09-01',
      startingFunds: SAR(50_000),
    });
    await harness.run({
      kind: 'recordExpense',
      bookId: BOOK_ID,
      amount: SAR(700),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-02' },
      note: '',
      category: null,
      flexibleDefinitionId: null,
    });
    // Basis exists now: classification (not pool) carries the gap.
    const withBasis = computeCompleteness(harness.state(), PARAMS);
    expect(withBasis.pool.state).toBe('current');
    expect(withBasis.classification.state).toBe('needsAttention');
    expect(withBasis.classification.reasons).toEqual([{ type: 'unclassifiedExpenseMovements', count: 1 }]);
  });
});

describe('pacing', () => {
  async function seededOpenBook(): Promise<ReturnType<typeof makeHarness>> {
    const harness = makeHarness();
    await harness.run({
      kind: 'createBook',
      bookId: BOOK_ID,
      displayName: '',
      currency: 'SAR',
      timeZone: 'Asia/Riyadh',
      cycleAnchor: { kind: 'firstOfMonth' },
    });
    await harness.run({
      kind: 'openCycle',
      bookId: BOOK_ID,
      startDate: '2026-09-01',
      startingFunds: SAR(100_000),
    });
    return harness;
  }

  it('divides the available amount with an exact reported remainder', async () => {
    const harness = await seededOpenBook();
    // 1000 SAR - 1 halala: 99999 halalas over 3 days = 33333/day, remainder 0.
    await harness.run({ kind: 'setBuffer', bookId: BOOK_ID, buffer: { currency: 'SAR', minorUnits: 1 }, note: '' });
    const even = computePacing(harness.state(), { eligibleDates: [date('2026-09-10'), date('2026-09-11'), date('2026-09-12')], ...PARAMS });
    expect(even).toMatchObject({
      status: 'computed',
      available: { currency: 'SAR', minorUnits: 99_999 },
      perDay: { currency: 'SAR', minorUnits: 33_333 },
      remainder: { currency: 'SAR', minorUnits: 0 },
      dayCount: 3,
    });

    // 100 halalas over 3 days truncates to 33 with remainder 1, reported
    // rather than folded into a day.
    await harness.run({ kind: 'setBuffer', bookId: BOOK_ID, buffer: { currency: 'SAR', minorUnits: 99_900 }, note: '' });
    const uneven = computePacing(harness.state(), { eligibleDates: [date('2026-09-10'), date('2026-09-11'), date('2026-09-12')], ...PARAMS });
    expect(uneven).toMatchObject({
      status: 'computed',
      available: { currency: 'SAR', minorUnits: 100 },
      perDay: { currency: 'SAR', minorUnits: 33 },
      remainder: { currency: 'SAR', minorUnits: 1 },
    });
  });

  it('paces a negative availability honestly as a negative scenario', async () => {
    const harness = await seededOpenBook();
    await harness.run({
      kind: 'recordExpense',
      bookId: BOOK_ID,
      amount: SAR(110_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-02' },
      note: '',
      category: null,
      flexibleDefinitionId: null,
    });
    const result = computePacing(harness.state(), { eligibleDates: [date('2026-09-10'), date('2026-09-11')], ...PARAMS });
    expect(result).toMatchObject({
      status: 'computed',
      available: { currency: 'SAR', minorUnits: -10_000 },
      perDay: { currency: 'SAR', minorUnits: -5_000 },
      remainder: { currency: 'SAR', minorUnits: 0 },
    });
  });

  it('returns typed unavailable results for empty, duplicate, or out-of-cycle eligible dates', async () => {
    const harness = await seededOpenBook();
    expect(computePacing(harness.state(), { eligibleDates: [], ...PARAMS })).toMatchObject({
      status: 'unavailable',
      reason: 'noEligibleDays',
    });
    expect(
      computePacing(harness.state(), { eligibleDates: [date('2026-09-10'), date('2026-09-10')], ...PARAMS }),
    ).toMatchObject({ status: 'unavailable', reason: 'duplicateEligibleDays' });
    expect(
      computePacing(harness.state(), { eligibleDates: [date('2026-09-30'), date('2026-10-01')], ...PARAMS }),
    ).toMatchObject({ status: 'unavailable', reason: 'eligibleDateOutsideOpenCycle' });
  });

  it('derives pacing from availability components, never from a stored source of truth', async () => {
    const harness = await seededOpenBook();
    await harness.run({
      kind: 'createObligation',
      bookId: BOOK_ID,
      obligationId: 'obl-p',
      expectedAmount: SAR(20_000),
      note: '',
      category: null,
    });
    const result = computePacing(harness.state(), { eligibleDates: [date('2026-09-10'), date('2026-09-11')], ...PARAMS });
    // Availability itself is 800; pacing is a pure scenario over it.
    const availability = computeAvailability(harness.state(), PARAMS);
    if (availability.status !== 'computed') throw new Error('unreachable');
    expect(availability.available).toEqual(SAR(80_000));
    expect(result).toMatchObject({ status: 'computed', perDay: { currency: 'SAR', minorUnits: 40_000 } });
    const storedState = harness.state();
    expect(storedState?.cycles.every((cycle) => !('pacing' in cycle))).toBe(true);
  });
});

describe('availability result contract', () => {
  it('carries currency, data-as-of, calculation version, and both completeness dimensions', async () => {
    const harness = makeHarness();
    await harness.run({
      kind: 'createBook',
      bookId: BOOK_ID,
      displayName: '',
      currency: 'SAR',
      timeZone: 'Asia/Riyadh',
      cycleAnchor: { kind: 'firstOfMonth' },
    });
    await harness.run({
      kind: 'openCycle',
      bookId: BOOK_ID,
      startDate: '2026-09-01',
      startingFunds: SAR(100_000),
    });
    const availability = computeAvailability(harness.state(), PARAMS);
    if (availability.status !== 'computed') throw new Error('unreachable');
    expect(availability.currency).toBe('SAR');
    expect(availability.asOfInstantMs).toBe(PARAMS.asOfInstantMs);
    expect(availability.calculationVersion).toBe('p03-task-b-1');
    expect(availability.available).toEqual(SAR(100_000));
    expect(availability.components).toEqual({
      startingFunds: SAR(100_000),
      netInflows: SAR(0),
      netReturns: SAR(0),
      netActualOutflows: SAR(0),
      residualReservations: SAR(0),
      netCycleAllocations: SAR(0),
      buffer: SAR(0),
    });
    expect(availability.completeness.pool.state).toBe('current');
    expect(availability.completeness.classification.state).toBe('current');
    expect(availability.completeness.asOfInstantMs).toBe(PARAMS.asOfInstantMs);
  });
});

export type { CommandContext };
