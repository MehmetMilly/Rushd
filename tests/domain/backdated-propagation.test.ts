/**
 * Backdated corrections against closed cycles (proof 7).
 *
 * A correction into a closed source cycle never rewrites its snapshot: it
 * propagates as an exact linked delta while no downstream carry/allocation
 * has consumed the settlement, and as an explicit unresolved conflict
 * otherwise. The correction itself is always accepted and never hidden;
 * completeness degrades until an explicit resolution. Linked corrections
 * and voids of closed-cycle facts carry the live commands' refund and
 * obligation-net guards.
 */

import { describe, expect, it } from 'vitest';
import {
  effectiveSettlementRemainder,
  findEffectiveSettlement,
  type CommandReceipt,
} from '../../src/application/commands';
import { completenessOf, makeTaskCHarness, revisionOf, SAR, seedStandardBook } from './support/task-c-harness';

function effectOf(receipt: CommandReceipt, kind: string): Record<string, unknown> {
  const effect = receipt.effects.find((candidate) => candidate.kind === kind);
  if (effect === undefined) throw new Error(`missing ${kind} effect`);
  return effect as unknown as Record<string, unknown>;
}

function closedCorrection(
  harness: { bookId: string },
  targetCycleId: string,
  movementKind: string,
  amount: number,
  date: string,
  extra: Record<string, unknown> = {},
) {
  return {
    kind: 'recordClosedCycleCorrection',
    bookId: harness.bookId,
    targetCycleId,
    movementKind,
    amount: SAR(amount),
    occurredAt: { kind: 'civilDate', localDate: date },
    note: 'backdated truth',
    category: 'food',
    linkedExpenseEntryId: null,
    correctsEntryId: null,
    replacement: null,
    ...extra,
  };
}

describe('exact linked propagation while the downstream is untouched', () => {
  it('applies the delta forward, freezes the snapshot, and feeds later carry decisions', async () => {
    const harness = makeTaskCHarness('book-proof-7-safe');
    await seedStandardBook(harness);
    await harness.run({
      kind: 'recordExpense', bookId: harness.bookId, amount: SAR(10_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: '', category: 'food', flexibleDefinitionId: null,
    });
    const closed = await harness.run({ kind: 'closeCycle', bookId: harness.bookId, cycleId: null, note: '' });
    const settlementId = effectOf(closed, 'cycleClosed')['settlementId'] as string;
    const targetCycleId = `cyc:${harness.bookId}:2026-09-01`;

    const corrected = await harness.run(closedCorrection(harness, targetCycleId, 'expense', 5_000, '2026-09-10'));
    const effect = effectOf(corrected, 'closedCycleCorrectionRecorded');
    expect(effect['propagation']).toBe('applied');
    expect(effect['deltaAmount']).toEqual(SAR(-5_000));
    expect(effect['settlementId']).toBe(settlementId);

    const state = harness.state();
    const snapshot = state.settlements.find((candidate) => candidate.settlementId === settlementId);
    expect(snapshot?.availability).toEqual(SAR(90_000));
    const effective = findEffectiveSettlement(state, targetCycleId as never);
    if (effective === null) throw new Error('settlement missing');
    expect(effectiveSettlementRemainder(state, effective)).toEqual(SAR(85_000));

    // The later carry decision sees the propagated remainder exactly.
    await harness.run({
      kind: 'disposeCycleRemainder', bookId: harness.bookId, settlementId,
      disposition: { kind: 'carryIn', amount: SAR(85_000), destinationCycleId: `cyc:${harness.bookId}:2026-10-01` },
      note: '',
    });
    const over = harness.previewRaw({
      kind: 'disposeCycleRemainder', bookId: harness.bookId, settlementId,
      disposition: { kind: 'carryIn', amount: SAR(85_001), destinationCycleId: `cyc:${harness.bookId}:2026-10-01` },
      note: '',
    });
    expect(over.ok).toBe(false);
  });
});

describe('unresolved conflicts after the downstream changed', () => {
  it('accepts the correction, stores the conflict, degrades completeness, and resolves explicitly', async () => {
    const harness = makeTaskCHarness('book-proof-7-conflict');
    await seedStandardBook(harness);
    await harness.run({
      kind: 'recordExpense', bookId: harness.bookId, amount: SAR(20_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: '', category: 'food', flexibleDefinitionId: null,
    });
    const closed = await harness.run({ kind: 'closeCycle', bookId: harness.bookId, cycleId: null, note: '' });
    const settlementId = effectOf(closed, 'cycleClosed')['settlementId'] as string;
    const targetCycleId = `cyc:${harness.bookId}:2026-09-01`;
    await harness.run({
      kind: 'disposeCycleRemainder', bookId: harness.bookId, settlementId,
      disposition: { kind: 'carryIn', amount: SAR(80_000), destinationCycleId: `cyc:${harness.bookId}:2026-10-01` },
      note: 'consumed downstream',
    });

    const corrected = await harness.run(closedCorrection(harness, targetCycleId, 'expense', 5_000, '2026-09-10'));
    const effect = effectOf(corrected, 'closedCycleCorrectionRecorded');
    expect(effect['propagation']).toBe('conflicted');
    expect(effect['deltaAmount']).toEqual(SAR(-5_000));

    // The correction is accepted and visible, never hidden or partial.
    const state = harness.state();
    expect(state.entries.some((entry) => entry.entryId === (effect['entryId'] as string))).toBe(true);
    expect(state.propagationConflicts).toHaveLength(1);
    expect(state.propagationConflicts[0]).toMatchObject({
      settlementId,
      sourceCycleId: targetCycleId,
      unpropagatedAmount: SAR(-5_000),
      downstreamKind: 'carry',
      resolved: false,
    });
    // The historical snapshot is untouched.
    expect(state.settlements.find((candidate) => candidate.settlementId === settlementId)?.availability).toEqual(SAR(80_000));

    const completeness = completenessOf(harness);
    // No cycle is open, so the basis is history — but the conflict stays an
    // explicit reason rather than hiding until the next cycle opens.
    expect(completeness.pool.state).toBe('recordsOnly');
    const hasConflictReason = (reasons: readonly { type: string }[]): boolean =>
      reasons.some((reason) => reason.type === 'unresolvedPropagationConflict');
    expect(hasConflictReason(completeness.pool.reasons)).toBe(true);

    await harness.run({
      kind: 'openCycle', bookId: harness.bookId, startDate: '2026-10-01', startingFunds: SAR(0),
    });
    const reopened = completenessOf(harness);
    expect(reopened.pool.state).toBe('needsAttention');
    expect(hasConflictReason(reopened.pool.reasons)).toBe(true);

    // Explicit resolution restores Current; the correction stays recorded.
    await harness.run({
      kind: 'resolvePropagationConflict', bookId: harness.bookId,
      conflictId: state.propagationConflicts[0].conflictId,
      resolution: 'acknowledgedDownstreamStands', note: 'carry stands, books annotated',
    });
    expect(completenessOf(harness).pool.state).toBe('current');
    expect(harness.state().entries.some((entry) => entry.entryId === (effect['entryId'] as string))).toBe(true);
    const resolvedTwice = harness.previewRaw({
      kind: 'resolvePropagationConflict', bookId: harness.bookId,
      conflictId: state.propagationConflicts[0].conflictId,
      resolution: 'acknowledgedDownstreamStands', note: '',
    });
    expect(resolvedTwice.ok).toBe(false);
    if (!resolvedTwice.ok) expect(resolvedTwice.failure.kind).toBe('conflictAlreadyResolved');
  });

  it('reports tracked-allocation and combined downstream kinds', async () => {
    const tracked = makeTaskCHarness('book-proof-7-tracked');
    await seedStandardBook(tracked);
    const trackedClosed = await tracked.run({ kind: 'closeCycle', bookId: tracked.bookId, cycleId: null, note: '' });
    const trackedSettlement = effectOf(trackedClosed, 'cycleClosed')['settlementId'] as string;
    await tracked.run({
      kind: 'openCycle', bookId: tracked.bookId, startDate: '2026-10-01', startingFunds: SAR(0),
    });
    await tracked.run({
      kind: 'disposeCycleRemainder', bookId: tracked.bookId, settlementId: trackedSettlement,
      disposition: { kind: 'fundTracked', amount: SAR(10_000) }, note: '',
    });
    const corrected = await tracked.run(
      closedCorrection(tracked, `cyc:${tracked.bookId}:2026-09-01`, 'inflow', 2_000, '2026-09-10'),
    );
    expect(effectOf(corrected, 'closedCycleCorrectionRecorded')['propagation']).toBe('conflicted');
    expect(tracked.state().propagationConflicts[0].downstreamKind).toBe('trackedAllocation');

    const split = makeTaskCHarness('book-proof-7-split');
    await seedStandardBook(split);
    await split.run({ kind: 'closeCycle', bookId: split.bookId, cycleId: null, note: '' });
    const splitSettlement = split.state().settlements[0].settlementId;
    await split.run({
      kind: 'openCycle', bookId: split.bookId, startDate: '2026-10-01', startingFunds: SAR(0),
    });
    await split.run({
      kind: 'disposeCycleRemainder', bookId: split.bookId, settlementId: splitSettlement,
      disposition: {
        kind: 'split', carryAmount: SAR(50_000), fundAmount: SAR(10_000),
        destinationCycleId: `cyc:${split.bookId}:2026-10-01`,
      },
      note: '',
    });
    const splitCorrected = await split.run(
      closedCorrection(split, `cyc:${split.bookId}:2026-09-01`, 'expense', 1_000, '2026-09-10'),
    );
    expect(effectOf(splitCorrected, 'closedCycleCorrectionRecorded')['propagation']).toBe('conflicted');
    expect(split.state().propagationConflicts[0].downstreamKind).toBe('both');
  });
});

describe('linked corrections and voids of closed-cycle facts', () => {
  it('corrects and voids with exact deltas while preserving originals and guards', async () => {
    const harness = makeTaskCHarness('book-proof-7-linked');
    await seedStandardBook(harness);
    await harness.run({
      kind: 'recordExpense', bookId: harness.bookId, amount: SAR(30_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: 'original', category: 'food', flexibleDefinitionId: null,
    });
    const firstId = harness.state().entries.find((entry) => entry.kind === 'expense')?.entryId as string;
    await harness.run({
      kind: 'recordExpenseReturn', bookId: harness.bookId, expenseEntryId: firstId, amount: SAR(5_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' }, note: '',
    });
    await harness.run({
      kind: 'recordExpense', bookId: harness.bookId, amount: SAR(10_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: 'second', category: 'food', flexibleDefinitionId: null,
    });
    const secondId = harness.state().entries.filter((entry) => entry.kind === 'expense')[1]?.entryId as string;
    // 100 - 30 + 5 - 10 = 65.
    await harness.run({ kind: 'closeCycle', bookId: harness.bookId, cycleId: null, note: '' });
    const targetCycleId = `cyc:${harness.bookId}:2026-09-01`;
    const settlement = findEffectiveSettlement(harness.state(), targetCycleId as never);
    if (settlement === null) throw new Error('settlement missing');

    // Shrinking below standing refunds is rejected with no write.
    const revisionBefore = revisionOf(harness);
    const stranded = harness.previewRaw(
      closedCorrection(harness, targetCycleId, 'expense', 3_000, '2026-09-10', {
        correctsEntryId: firstId,
        replacement: { amount: SAR(3_000) },
      }),
    );
    expect(stranded.ok).toBe(false);
    if (!stranded.ok) expect(stranded.failure.kind).toBe('returnExceedsReturnable');
    expect(revisionOf(harness)).toBe(revisionBefore);

    // Correct 30 -> 25: the remainder rises by exactly 5.
    const corrected = await harness.run(
      closedCorrection(harness, targetCycleId, 'expense', 25_000, '2026-09-10', {
        correctsEntryId: firstId,
        replacement: { amount: SAR(25_000) },
      }),
    );
    const correctedEffect = effectOf(corrected, 'closedCycleCorrectionRecorded');
    expect(correctedEffect['propagation']).toBe('applied');
    expect(correctedEffect['deltaAmount']).toEqual(SAR(5_000));
    expect(correctedEffect['correctsEntryId']).toBe(firstId);
    expect(correctedEffect['replacementEntryId']).not.toBeNull();

    // Void the second expense: the remainder rises by exactly 10.
    const voided = await harness.run(
      closedCorrection(harness, targetCycleId, 'expense', 10_000, '2026-09-11', {
        correctsEntryId: secondId,
        replacement: null,
      }),
    );
    expect(effectOf(voided, 'closedCycleCorrectionRecorded')['deltaAmount']).toEqual(SAR(10_000));

    // Originals are byte-for-byte; the remainder recomputed forward.
    const state = harness.state();
    expect(state.entries.find((entry) => entry.entryId === firstId)).toMatchObject({ amount: SAR(30_000), localDate: '2026-09-04' });
    const effective = findEffectiveSettlement(state, targetCycleId as never);
    if (effective === null) throw new Error('settlement missing');
    expect(effectiveSettlementRemainder(state, effective)).toEqual(SAR(80_000));
    expect(state.propagationDeltas).toHaveLength(2);
  });
});
