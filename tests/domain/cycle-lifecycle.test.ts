/**
 * Close, disposition, carry, reopen, and multi-cycle conservation
 * (proofs 6 and 8).
 *
 * A two-cycle sequence with an outstanding obligation, explicit carry,
 * later payment, and close/reopen/reclose conserves money and retains every
 * snapshot and version. Opening a second ordinary cycle never double-counts
 * first-cycle entries, returns, adjustments, reservations, or allocations.
 */

import { describe, expect, it } from 'vitest';
import {
  computeAvailability,
  type CommandReceipt,
} from '../../src/application/commands';
import { completenessOf, makeTaskCHarness, revisionOf, SAR, seedStandardBook } from './support/task-c-harness';

function effectOf(receipt: CommandReceipt, kind: string): Record<string, unknown> {
  const effect = receipt.effects.find((candidate) => candidate.kind === kind);
  if (effect === undefined) throw new Error(`missing ${kind} effect`);
  return effect as unknown as Record<string, unknown>;
}

describe('close, carry, payment, reopen, and reclose', () => {
  // Proof 6: close with an unpaid obligation and explicit carry, open the
  // next cycle, pay there, then close/reopen/reclose without duplicating the
  // reservation, payment, settlement, or carry.
  it('conserves money across the full two-cycle sequence', async () => {
    const harness = makeTaskCHarness('book-proof-6');
    await seedStandardBook(harness);
    await harness.run({
      kind: 'createObligation', bookId: harness.bookId, obligationId: 'obl-cross',
      expectedAmount: SAR(10_000), note: '', category: null,
    });
    expect(harness.availableMinor()).toBe(90_000);

    const closed = await harness.run({ kind: 'closeCycle', bookId: harness.bookId, cycleId: null, note: 'close sept' });
    const closedEffect = effectOf(closed, 'cycleClosed');
    expect(closedEffect['availability']).toEqual(SAR(90_000));
    const settlementId = closedEffect['settlementId'] as string;
    const snapshot = harness.state().settlements.find((candidate) => candidate.settlementId === settlementId);
    expect(snapshot?.reservedCommitments).toEqual(SAR(10_000));
    expect(snapshot?.settlementSeq).toBe(1);

    // Explicit carry of 50 to October, which must already be open: the
    // destination has to resolve to an existing open cycle.
    await harness.run({
      kind: 'openCycle', bookId: harness.bookId, startDate: '2026-10-01', startingFunds: SAR(0),
    });
    await harness.run({
      kind: 'disposeCycleRemainder', bookId: harness.bookId, settlementId,
      disposition: { kind: 'carryIn', amount: SAR(50_000), destinationCycleId: `cyc:${harness.bookId}:2026-10-01` },
      note: 'carry half forward',
    });
    // The source is consumed: a second disposition is rejected.
    const consumed = harness.previewRaw({
      kind: 'disposeCycleRemainder', bookId: harness.bookId, settlementId,
      disposition: { kind: 'leaveIndependent' }, note: '',
    });
    expect(consumed.ok).toBe(false);
    if (!consumed.ok) expect(consumed.failure.kind).toBe('carryAlreadyConsumed');

    // 0 start + 50 carry, with the 10 cross-cycle reservation encumbered once.
    expect(harness.availableMinor()).toBe(40_000);

    await harness.run({
      kind: 'recordObligationPayment', bookId: harness.bookId, obligationId: 'obl-cross', amount: SAR(10_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-10-05' }, note: '', category: null,
    });
    // The payment replaces its reservation: 0 + 50 - 10 - 0 = 40.
    expect(harness.availableMinor()).toBe(40_000);
    const payment = harness.state().entries.find((entry) => entry.kind === 'expense');
    expect(payment?.cycleId).toBe(`cyc:${harness.bookId}:2026-10-01`);

    const closedOct = await harness.run({ kind: 'closeCycle', bookId: harness.bookId, cycleId: null, note: 'close oct' });
    const octSettlementId = effectOf(closedOct, 'cycleClosed')['settlementId'] as string;
    await harness.run({ kind: 'reopenCycle', bookId: harness.bookId, cycleId: `cyc:${harness.bookId}:2026-10-01`, note: 'fix' });
    expect(harness.availableMinor()).toBe(40_000);
    const reopened = await harness.run({ kind: 'closeCycle', bookId: harness.bookId, cycleId: null, note: 'reclose oct' });
    const resealedId = effectOf(reopened, 'cycleClosed')['settlementId'] as string;
    expect(resealedId).not.toBe(octSettlementId);

    // No duplication anywhere: one reservation source, one payment, one
    // effective settlement per cycle, one carry.
    const state = harness.state();
    expect(state.obligations).toHaveLength(1);
    expect(state.entries.filter((entry) => entry.kind === 'expense')).toHaveLength(1);
    expect(state.settlements.filter((candidate) => candidate.cycleId === `cyc:${harness.bookId}:2026-10-01`)).toHaveLength(2);
    expect(state.carryActions).toHaveLength(1);
    expect(state.cycles.filter((cycle) => cycle.cycleId === `cyc:${harness.bookId}:2026-10-01`)).toHaveLength(2);
    // The original September snapshot is byte-for-byte intact.
    expect(state.settlements.find((candidate) => candidate.settlementId === settlementId)?.availability).toEqual(SAR(90_000));
  });

  it('rejects a carry to a nonexistent cycle with no write and an unconsumed source', async () => {
    const harness = makeTaskCHarness('book-proof-6-dest');
    await seedStandardBook(harness);
    const closed = await harness.run({ kind: 'closeCycle', bookId: harness.bookId, cycleId: null, note: '' });
    const settlementId = effectOf(closed, 'cycleClosed')['settlementId'] as string;
    const stateBefore = JSON.stringify(harness.state());
    // Syntactically prefixed but nonexistent: no partial write, no consumption.
    const missing = harness.previewRaw({
      kind: 'disposeCycleRemainder', bookId: harness.bookId, settlementId,
      disposition: { kind: 'carryIn', amount: SAR(10_000), destinationCycleId: `cyc:${harness.bookId}:2099-01-01` },
      note: '',
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.failure.kind).toBe('invalidDisposition');
    expect(JSON.stringify(harness.state())).toBe(stateBefore);
    expect(harness.state().carryActions).toHaveLength(0);
    // A closed destination is equally invalid: the carry needs an open one.
    await harness.run({
      kind: 'openCycle', bookId: harness.bookId, startDate: '2026-10-01', startingFunds: SAR(0),
    });
    await harness.run({ kind: 'closeCycle', bookId: harness.bookId, cycleId: null, note: '' });
    const stateBeforeClose = JSON.stringify(harness.state());
    const toClosed = harness.previewRaw({
      kind: 'disposeCycleRemainder', bookId: harness.bookId, settlementId,
      disposition: { kind: 'carryIn', amount: SAR(10_000), destinationCycleId: `cyc:${harness.bookId}:2026-10-01` },
      note: '',
    });
    expect(toClosed.ok).toBe(false);
    if (!toClosed.ok) expect(toClosed.failure.kind).toBe('invalidDisposition');
    expect(JSON.stringify(harness.state())).toBe(stateBeforeClose);
    expect(harness.state().carryActions).toHaveLength(0);
  });
});

describe('second ordinary cycle scope', () => {
  // Proof 8: first-cycle expenses, returns, adjustments, and allocations do
  // not subtract again; valid outstanding commitments encumber once; old
  // unclassified history does not contaminate the new Current pool.
  it('excludes old-cycle cash effects while keeping cross-cycle commitments', async () => {
    const harness = makeTaskCHarness('book-proof-8');
    await seedStandardBook(harness);

    await harness.run({
      kind: 'recordExpense', bookId: harness.bookId, amount: SAR(20_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: '', category: null, flexibleDefinitionId: null,
    });
    const expenseId = (harness.state().entries.find((entry) => entry.kind === 'expense')?.entryId ?? '') as string;
    await harness.run({
      kind: 'recordExpenseReturn', bookId: harness.bookId, expenseEntryId: expenseId, amount: SAR(5_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' }, note: '',
    });
    await harness.run({
      kind: 'recordRealityCheck', bookId: harness.bookId, observedPool: SAR(82_000),
      boundary: { kind: 'civilDateTime', localDate: '2026-09-06', localTime: '12:00:00' },
      currencyLabel: null, classificationNote: 'counted', note: '',
    });
    await harness.run({ kind: 'createGoal', bookId: harness.bookId, goalId: 'goal-a', name: 'A', targetAmount: SAR(100_000) });
    await harness.run({
      kind: 'fundAllocationPool', bookId: harness.bookId, amount: SAR(10_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-07' }, note: '',
    });
    await harness.run({
      kind: 'createObligation', bookId: harness.bookId, obligationId: 'obl-carry',
      expectedAmount: SAR(5_000), note: '', category: null,
    });
    // 100 - 20 + 5 - 3 (adjustment) - 10 (funding) - 5 (reservation) = 67.
    expect(harness.availableMinor()).toBe(67_000);

    await harness.run({ kind: 'closeCycle', bookId: harness.bookId, cycleId: null, note: 'close sept' });
    await harness.run({
      kind: 'openCycle', bookId: harness.bookId, startDate: '2026-10-01', startingFunds: SAR(50_000),
    });

    const availability = computeAvailability(harness.state(), { asOfInstantMs: 0, calculationVersion: 'p03-task-c-1' });
    if (availability.status !== 'computed') throw new Error('unreachable');
    expect(availability.components.startingFunds).toEqual(SAR(50_000));
    expect(availability.components.netInflows).toEqual(SAR(0));
    expect(availability.components.netActualOutflows).toEqual(SAR(0));
    expect(availability.components.netReturns).toEqual(SAR(0));
    expect(availability.components.netAdjustments).toEqual(SAR(0));
    expect(availability.components.netCycleAllocations).toEqual(SAR(0));
    // Only the outstanding cross-cycle commitment encumbers, once.
    expect(availability.components.residualReservations).toEqual(SAR(5_000));
    expect(availability.available).toEqual(SAR(45_000));

    const completeness = completenessOf(harness);
    expect(completeness.pool.state).toBe('current');
    expect(completeness.classification.state).toBe('current');
    expect(revisionOf(harness)).toBeGreaterThan(0);
  });
});
