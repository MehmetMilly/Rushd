/**
 * Reality Check observations, reconciliation adjustments, and recovery
 * (proofs 1, 2, 3, 10).
 *
 * All expectations are hand-calculated from the master plan's full-pool
 * observation basis: the user names the whole physically-left pool,
 * goal-earmarked and obligation-reserved money included, and Rushd derives
 * the signed adjustment against the ledger-derived pool — never against
 * availability.
 */

import { describe, expect, it } from 'vitest';
import {
  adjustmentResidual,
  boundaryFromObservation,
  computeAvailability,
  deriveLedgerPoolAt,
  describeCommandFailure,
  findAdjustmentByObservation,
  findObservationById,
  findOpenCycle,
  type CommandReceipt,
} from '../../src/application/commands';
import {
  completenessOf,
  makeTaskCHarness,
  revisionOf,
  SAR,
  seedStandardBook,
} from './support/task-c-harness';

const SEPT_5_NOON = { kind: 'civilDateTime' as const, localDate: '2026-09-05', localTime: '12:00:00' };

function effectOf(receipt: CommandReceipt, kind: string): Record<string, unknown> {
  const effect = receipt.effects.find((candidate) => candidate.kind === kind);
  if (effect === undefined) throw new Error(`missing ${kind} effect`);
  return effect as unknown as Record<string, unknown>;
}

describe('reality-check reference scenario (hand-calculated)', () => {
  // Proof 1: 1,000 start, fund/assign 200 to a goal, reserve a 100 bill,
  // observe 1,000 -> adjustment 0, availability 700.
  it('compares the full pool, repeats idempotently, and releases without inventing inflow', async () => {
    const harness = makeTaskCHarness('book-proof-1');
    await seedStandardBook(harness);
    expect(harness.availableMinor()).toBe(100_000);

    await harness.run({ kind: 'createGoal', bookId: harness.bookId, goalId: 'goal-emergency', name: 'Emergency', targetAmount: SAR(500_000) });
    await harness.run({
      kind: 'fundAllocationPool', bookId: harness.bookId, amount: SAR(20_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-02' }, note: '',
    });
    await harness.run({ kind: 'assignToGoal', bookId: harness.bookId, goalId: 'goal-emergency', amount: SAR(20_000), note: '' });
    await harness.run({
      kind: 'createObligation', bookId: harness.bookId, obligationId: 'obl-bill',
      expectedAmount: SAR(10_000), note: '', category: null,
    });
    expect(harness.availableMinor()).toBe(70_000);

    const check = await harness.run({
      kind: 'recordRealityCheck',
      bookId: harness.bookId,
      observedPool: SAR(100_000),
      boundary: SEPT_5_NOON,
      currencyLabel: null,
      classificationNote: 'cash counted',
      note: '',
    });
    const recorded = effectOf(check, 'realityCheckRecorded');
    expect(recorded['adjustmentAmount']).toEqual(SAR(0));
    expect(recorded['ledgerPool']).toEqual(SAR(100_000));
    expect(harness.availableMinor()).toBe(70_000);

    const completeness = completenessOf(harness);
    expect(completeness.pool.state).toBe('current');
    expect(completeness.classification.state).toBe('current');
    // Repeating the observation changes nothing: a typed duplicate with no write.
    const revisionBefore = revisionOf(harness);
    const repeat = harness.previewRaw({
      kind: 'recordRealityCheck',
      bookId: harness.bookId,
      observedPool: SAR(100_000),
      boundary: SEPT_5_NOON,
      currencyLabel: null,
      classificationNote: 'cash counted',
      note: '',
    });
    expect(repeat.ok).toBe(false);
    if (!repeat.ok) expect(repeat.failure.kind).toBe('duplicateObservation');
    expect(revisionOf(harness)).toBe(revisionBefore);

    // Releasing 100 keeps the observed pool at 1,000 and raises availability
    // to 800 with no external inflow.
    await harness.run({
      kind: 'releaseAllocation', bookId: harness.bookId, goalId: 'goal-emergency', amount: SAR(10_000),
      destinationCycleId: `cyc:${harness.bookId}:2026-09-01`,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' }, note: '',
    });
    expect(harness.availableMinor()).toBe(80_000);
    const state = harness.state();
    const observation = findObservationById(state, recorded['observationId'] as never);
    if (observation === null) throw new Error('observation missing');
    expect(deriveLedgerPoolAt(state, findOpenCycle(state)!, boundaryFromObservation(observation))).toEqual(
      SAR(100_000),
    );
    const availability = computeAvailability(state, { asOfInstantMs: 0, calculationVersion: 'p03-task-c-1' });
    if (availability.status !== 'computed') throw new Error('unreachable');
    expect(availability.components.netInflows).toEqual(SAR(0));
  });

  it('holds the pool Current while an unclassified adjustment keeps classification Needs Attention', async () => {    const harness = makeTaskCHarness('book-proof-1-split');
    await seedStandardBook(harness);
    await harness.run({
      kind: 'recordRealityCheck',
      bookId: harness.bookId,
      observedPool: SAR(100_000),
      boundary: SEPT_5_NOON,
      currencyLabel: null,
      classificationNote: null,
      note: '',
    });
    const completeness = completenessOf(harness);
    expect(completeness.pool.state).toBe('current');
    expect(completeness.classification.state).toBe('needsAttention');
    expect(completeness.classification.reasons.some((reason) => reason.type === 'unclassifiedAdjustment')).toBe(true);
  });
});

describe('successive observations with recovered, corrected, and reversed activity', () => {  // Proof 2: a 100 shortfall, a 60 pre-boundary recovery corrected to 40
  // then reversed. The linked adjustment moves -100 -> -40 -> -60 -> -100
  // while the observed pool stays fixed; a later boundary is independent.
  it('preserves both observed pools exactly and consumes each adjustment once', async () => {
    const harness = makeTaskCHarness('book-proof-2');
    await seedStandardBook(harness);

    const first = await harness.run({
      kind: 'recordRealityCheck',
      bookId: harness.bookId,
      observedPool: SAR(90_000),
      boundary: SEPT_5_NOON,
      currencyLabel: null,
      classificationNote: 'till count',
      note: '',
    });
    const firstRecorded = effectOf(first, 'realityCheckRecorded');
    expect(firstRecorded['adjustmentAmount']).toEqual(SAR(-10_000));
    const observationId = firstRecorded['observationId'] as never;
    expect(harness.availableMinor()).toBe(90_000);

    const residualOf = (): number => {
      const adjustment = findAdjustmentByObservation(harness.state(), observationId);
      if (adjustment === null) throw new Error('adjustment missing');
      return adjustmentResidual(harness.state(), adjustment).minorUnits;
    };
    const poolInvariant = (): void => {
      const state = harness.state();
      const observation = findObservationById(state, observationId);
      const adjustment = findAdjustmentByObservation(state, observationId);
      if (observation === null || adjustment === null) throw new Error('unreachable');
      const cycle = findOpenCycle(state);
      if (cycle === null) throw new Error('unreachable');
      // The ledger at a boundary excludes that boundary's own adjustment;
      // adding its derived residual must restore the observed pool exactly.
      const ledger = deriveLedgerPoolAt(state, cycle, boundaryFromObservation(observation), {
        observationId: observationId as string,
      });
      expect(ledger.minorUnits + residualOf()).toBe(90_000);
    };

    const recovered = await harness.run({
      kind: 'recoverObservedActivity',
      bookId: harness.bookId,
      observationId,
      movementKind: 'expense',
      amount: SAR(6_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: 'forgotten groceries',
      category: 'food',
      linkedExpenseEntryId: null,
    });
    expect(residualOf()).toBe(-4_000);
    expect(harness.availableMinor()).toBe(90_000);
    poolInvariant();
    const recoveredEntryId = effectOf(recovered, 'observedActivityRecovered')['entryId'] as string;

    await harness.run({
      kind: 'correctExpense',
      bookId: harness.bookId,
      expenseEntryId: recoveredEntryId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: 'receipt says 40',
      replacement: { amount: SAR(4_000) },
    });
    expect(residualOf()).toBe(-6_000);
    expect(harness.availableMinor()).toBe(90_000);
    poolInvariant();

    // Voiding targets the live replacement, never the already-reversed root.
    const replacementId = (() => {
      const entries = harness.state().entries.filter((entry) => entry.kind === 'expense');
      const head = entries[entries.length - 1];
      if (head === undefined || head.kind !== 'expense') throw new Error('replacement missing');
      return head.entryId;
    })();
    await harness.run({
      kind: 'correctExpense',
      bookId: harness.bookId,
      expenseEntryId: replacementId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-07' },
      note: 'voided duplicate',
      replacement: null,
    });
    expect(residualOf()).toBe(-10_000);
    expect(harness.availableMinor()).toBe(90_000);
    poolInvariant();

    // A second later boundary is independent: it starts from the ledger
    // including the first residual, and leaves the first adjustment alone.
    const second = await harness.run({
      kind: 'recordRealityCheck',
      bookId: harness.bookId,
      observedPool: SAR(90_000),
      boundary: { kind: 'civilDateTime', localDate: '2026-09-10', localTime: '18:00:00' },
      currencyLabel: null,
      classificationNote: 'till count',
      note: '',
    });
    expect(effectOf(second, 'realityCheckRecorded')['adjustmentAmount']).toEqual(SAR(0));
    expect(residualOf()).toBe(-10_000);
    poolInvariant();
  });

  it('attaches recovery to the earliest covering boundary so earlier pools stay exact', async () => {
    const harness = makeTaskCHarness('book-proof-2-earliest');
    await seedStandardBook(harness);
    const first = await harness.run({
      kind: 'recordRealityCheck', bookId: harness.bookId, observedPool: SAR(90_000),
      boundary: SEPT_5_NOON, currencyLabel: null, classificationNote: 'counted', note: '',
    });
    const firstId = effectOf(first, 'realityCheckRecorded')['observationId'] as string;
    const second = await harness.run({
      kind: 'recordRealityCheck', bookId: harness.bookId, observedPool: SAR(90_000),
      boundary: { kind: 'civilDateTime', localDate: '2026-09-10', localTime: '12:00:00' },
      currencyLabel: null, classificationNote: 'counted', note: '',
    });
    const secondId = effectOf(second, 'realityCheckRecorded')['observationId'] as string;
    // The second boundary starts from the ledger including the first
    // residual (100000 - 10000), so observing the unchanged 90000 pool
    // creates a zero adjustment.
    expect(effectOf(second, 'realityCheckRecorded')['adjustmentAmount']).toEqual(SAR(0));

    // A Sept 3 activity is covered by the Sept 5 boundary: naming the Sept
    // 10 observation is a typed rejection with no write.
    const revisionBefore = revisionOf(harness);
    const mislinked = harness.previewRaw({
      kind: 'recoverObservedActivity', bookId: harness.bookId, observationId: secondId,
      movementKind: 'expense', amount: SAR(6_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-03' },
      note: '', category: null, linkedExpenseEntryId: null,
    });
    expect(mislinked.ok).toBe(false);
    if (!mislinked.ok) expect(mislinked.failure.kind).toBe('invalidRecoveryBoundary');
    expect(revisionOf(harness)).toBe(revisionBefore);

    // Linking it to the earliest covering boundary consumes that adjustment
    // once and leaves both observed pools exact.
    await harness.run({
      kind: 'recoverObservedActivity', bookId: harness.bookId, observationId: firstId,
      movementKind: 'expense', amount: SAR(6_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-03' },
      note: '', category: null, linkedExpenseEntryId: null,
    });
    const state = harness.state();
    const firstAdjustment = findAdjustmentByObservation(state, firstId as never);
    const secondAdjustment = findAdjustmentByObservation(state, secondId as never);
    if (firstAdjustment === null || secondAdjustment === null) throw new Error('unreachable');
    expect(adjustmentResidual(state, firstAdjustment).minorUnits).toBe(-4_000);
    // The later boundary is untouched by the earlier recovery: its residual
    // stays zero while the changed earlier residual plus the actual keep its
    // pool exact.
    expect(adjustmentResidual(state, secondAdjustment).minorUnits).toBe(0);
    const cycle = findOpenCycle(state);
    if (cycle === null) throw new Error('unreachable');
    for (const [id, expected] of [[firstId, 90_000], [secondId, 90_000]] as const) {
      const observation = findObservationById(state, id as never);
      if (observation === null) throw new Error('unreachable');
      const ledger = deriveLedgerPoolAt(state, cycle, boundaryFromObservation(observation), { observationId: id });
      const adjustment = findAdjustmentByObservation(state, id as never);
      if (adjustment === null) throw new Error('unreachable');
      expect(ledger.minorUnits + adjustmentResidual(state, adjustment).minorUnits).toBe(expected);
    }
  });
});

describe('boundary ordering evidence', () => {
  // Proof 3: same-date recovery without ordering evidence clarifies with no
  // write; explicit instants on each side behave differently across a
  // Riyadh/UTC crossing and one DST-capable zone.
  it('requires instant evidence on the boundary date and resolves zones deterministically', async () => {
    const harness = makeTaskCHarness('book-proof-3');
    await seedStandardBook(harness);
    const check = await harness.run({
      kind: 'recordRealityCheck',
      bookId: harness.bookId,
      observedPool: SAR(100_000),
      boundary: SEPT_5_NOON,
      currencyLabel: null,
      classificationNote: null,
      note: '',
    });
    const observationId = effectOf(check, 'realityCheckRecorded')['observationId'];

    const base = {
      kind: 'recoverObservedActivity',
      bookId: harness.bookId,
      observationId,
      movementKind: 'expense',
      amount: SAR(1_000),
      note: '',
      category: null,
      linkedExpenseEntryId: null,
    } as const;

    const revisionBefore = revisionOf(harness);
    const ambiguous = harness.previewRaw({ ...base, occurredAt: { kind: 'civilDate', localDate: '2026-09-05' } });
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) {
      expect(ambiguous.failure.kind).toBe('clarificationNeeded');
      if (ambiguous.failure.kind === 'clarificationNeeded') {
        expect(ambiguous.failure.reason).toBe('ambiguousBoundaryOrder');
      }
    }
    expect(revisionOf(harness)).toBe(revisionBefore);

    // 08:59Z is 11:59 in Riyadh: before the noon boundary.
    await harness.run({ ...base, occurredAt: { kind: 'instant', instantMs: Date.UTC(2026, 8, 5, 8, 59, 0) } });
    // 09:01Z is 12:01 in Riyadh: after it.
    const after = harness.previewRaw({ ...base, occurredAt: { kind: 'instant', instantMs: Date.UTC(2026, 8, 5, 9, 1, 0) } });
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.failure.kind).toBe('invalidRecoveryBoundary');
    // 21:00Z on Sept 4 is midnight Sept 5 in Riyadh: before, across UTC midnight.
    await harness.run({ ...base, occurredAt: { kind: 'instant', instantMs: Date.UTC(2026, 8, 4, 21, 0, 0) } });

    // DST-capable zone: the same wall clock resolves under EST in January
    // and EDT in July.
    const winter = makeTaskCHarness('book-proof-3-winter');
    await seedStandardBook(winter, { timeZone: 'America/New_York', startDate: '2026-01-01' });
    const winterCheck = await winter.run({
      kind: 'recordRealityCheck',
      bookId: winter.bookId,
      observedPool: SAR(100_000),
      boundary: { kind: 'civilDateTime', localDate: '2026-01-05', localTime: '12:00:00' },
      currencyLabel: null,
      classificationNote: null,
      note: '',
    });
    const winterId = effectOf(winterCheck, 'realityCheckRecorded')['observationId'];
    // 16:59Z is 11:59 EST (UTC-5): before noon.
    await winter.run({
      kind: 'recoverObservedActivity', bookId: winter.bookId, observationId: winterId,
      movementKind: 'expense', amount: SAR(500),
      occurredAt: { kind: 'instant', instantMs: Date.UTC(2026, 0, 5, 16, 59, 0) },
      note: '', category: null, linkedExpenseEntryId: null,
    });

    const summer = makeTaskCHarness('book-proof-3-summer');
    await seedStandardBook(summer, { timeZone: 'America/New_York', startDate: '2026-07-01' });
    const summerCheck = await summer.run({
      kind: 'recordRealityCheck',
      bookId: summer.bookId,
      observedPool: SAR(100_000),
      boundary: { kind: 'civilDateTime', localDate: '2026-07-05', localTime: '12:00:00' },
      currencyLabel: null,
      classificationNote: null,
      note: '',
    });
    const summerId = effectOf(summerCheck, 'realityCheckRecorded')['observationId'];
    // 15:59Z is 11:59 EDT (UTC-4): before noon; the same instant shape as
    // winter would be ambiguous without the DST rule.
    await summer.run({
      kind: 'recoverObservedActivity', bookId: summer.bookId, observationId: summerId,
      movementKind: 'expense', amount: SAR(500),
      occurredAt: { kind: 'instant', instantMs: Date.UTC(2026, 6, 5, 15, 59, 0) },
      note: '', category: null, linkedExpenseEntryId: null,
    });
    const summerAfter = summer.previewRaw({
      kind: 'recoverObservedActivity', bookId: summer.bookId, observationId: summerId,
      movementKind: 'expense', amount: SAR(500),
      occurredAt: { kind: 'instant', instantMs: Date.UTC(2026, 6, 5, 16, 1, 0) },
      note: '', category: null, linkedExpenseEntryId: null,
    });
    expect(summerAfter.ok).toBe(false);
    if (!summerAfter.ok) expect(summerAfter.failure.kind).toBe('invalidRecoveryBoundary');
  });
});

describe('remaining-from-boundary cycles', () => {
  // Proof 10: pre-boundary recovered outflow/inflow/return is history that
  // leaves the starting pool fixed; post-boundary movement counts normally;
  // future-effective activity inserted first is excluded from an earlier
  // observation.
  it('freezes history at the boundary while the live pool moves', async () => {
    const harness = makeTaskCHarness('book-proof-10');
    await harness.run({
      kind: 'createBook', bookId: harness.bookId, displayName: 'boundary', currency: 'SAR',
      timeZone: 'Asia/Riyadh', cycleAnchor: { kind: 'firstOfMonth' },
    });
    await harness.run({
      kind: 'openBoundaryCycle',
      bookId: harness.bookId,
      observedPool: SAR(100_000),
      boundary: SEPT_5_NOON,
      note: 'mid-cycle start',
    });
    expect(harness.availableMinor()).toBe(100_000);

    const check = await harness.run({
      kind: 'recordRealityCheck',
      bookId: harness.bookId,
      observedPool: SAR(100_000),
      boundary: { kind: 'civilDateTime', localDate: '2026-09-06', localTime: '12:00:00' },
      currencyLabel: null,
      classificationNote: 'counted',
      note: '',
    });
    expect(effectOf(check, 'realityCheckRecorded')['adjustmentAmount']).toEqual(SAR(0));
    const observationId = effectOf(check, 'realityCheckRecorded')['observationId'];

    const recover = (movementKind: string, amount: number, date: string, link: string | null = null) =>
      harness.run({
        kind: 'recoverObservedActivity', bookId: harness.bookId, observationId,
        movementKind, amount: SAR(amount),
        occurredAt: { kind: 'civilDate', localDate: date },
        note: '', category: null, linkedExpenseEntryId: link,
      });

    await recover('expense', 6_000, '2026-09-04');
    expect(harness.availableMinor()).toBe(100_000);
    await recover('inflow', 2_000, '2026-09-03');
    expect(harness.availableMinor()).toBe(100_000);

    const outflow = await recover('expense', 3_000, '2026-09-04');
    const outflowId = effectOf(outflow, 'observedActivityRecovered')['entryId'] as string;
    await recover('return', 1_000, '2026-09-04', outflowId);
    expect(harness.availableMinor()).toBe(100_000);

    await harness.run({
      kind: 'recordExpense', bookId: harness.bookId, amount: SAR(10_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-07' },
      note: '', category: 'food', flexibleDefinitionId: null,
    });
    expect(harness.availableMinor()).toBe(90_000);

    // Inserted now but effective Sept 20: excluded from a Sept 10 check.
    await harness.run({
      kind: 'recordExpense', bookId: harness.bookId, amount: SAR(5_000),
      occurredAt: { kind: 'instant', instantMs: Date.UTC(2026, 8, 20, 9, 0, 0) },
      note: '', category: 'food', flexibleDefinitionId: null,
    });
    const later = await harness.run({
      kind: 'recordRealityCheck',
      bookId: harness.bookId,
      observedPool: SAR(90_000),
      boundary: { kind: 'civilDateTime', localDate: '2026-09-10', localTime: '12:00:00' },
      currencyLabel: null,
      classificationNote: 'counted',
      note: '',
    });
    expect(effectOf(later, 'realityCheckRecorded')['adjustmentAmount']).toEqual(SAR(0));
    expect(harness.availableMinor()).toBe(85_000);
  });
});

describe('recovery command safety', () => {
  it('replays the same operation and rejects the same ID with different content', async () => {
    const harness = makeTaskCHarness('book-proof-2-retry');
    await seedStandardBook(harness);
    const command = {
      kind: 'recordRealityCheck',
      bookId: harness.bookId,
      observedPool: SAR(100_000),
      boundary: SEPT_5_NOON,
      currencyLabel: null,
      classificationNote: null,
      note: '',
    };
    // A true retry reuses the original confirmation without a new preview.
    const preview = harness.previewRaw(command);
    if (!preview.ok) throw new Error(describeCommandFailure(preview.failure));
    const confirmation = {
      operationId: 'op-fixed-1' as never,
      expectedRevision: preview.preview.expectedRevision,
      previewDigest: preview.preview.previewDigest,
    };
    const { executeCommand } = await import('../../src/application/commands');
    const first = await executeCommand(harness.repo, command, confirmation, harness.context);
    if (!first.ok) throw new Error(describeCommandFailure(first.failure));
    expect(first.retried).toBe(false);
    const revisionAfter = revisionOf(harness);
    const retry = await executeCommand(harness.repo, command, confirmation, harness.context);
    if (!retry.ok) throw new Error(describeCommandFailure(retry.failure));
    expect(retry.retried).toBe(true);
    expect(retry.receipt).toEqual(first.receipt);
    expect(revisionOf(harness)).toBe(revisionAfter);

    // The same operation ID with different content is an explicit conflict:
    // a fresh preview of a different boundary reuses the old operation ID.
    const changed = {
      ...command,
      boundary: { kind: 'civilDateTime' as const, localDate: '2026-09-10', localTime: '12:00:00' },
    };
    const changedPreview = harness.previewRaw(changed);
    if (!changedPreview.ok) throw new Error(describeCommandFailure(changedPreview.failure));
    const conflict = await executeCommand(
      harness.repo,
      changed,
      {
        operationId: 'op-fixed-1' as never,
        expectedRevision: changedPreview.preview.expectedRevision,
        previewDigest: changedPreview.preview.previewDigest,
      },
      harness.context,
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.failure.kind).toBe('operationIdConflict');
    expect(revisionOf(harness)).toBe(revisionAfter);
  });
});
