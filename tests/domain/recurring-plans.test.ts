/**
 * Recurring plans and stable occurrences (proof 4).
 *
 * A monthly plan revision updates future unpaid managed occurrences while
 * one paid and one detached occurrence stay byte-for-byte attributable to
 * their historical revisions. Month-end day 31 clamps in February, retries
 * never duplicate, and flexible links stay arithmetic-neutral.
 */

import { describe, expect, it } from 'vitest';
import { occurrenceExpectedAmount, type CommandReceipt } from '../../src/application/commands';
import { completenessOf, makeTaskCHarness, SAR, seedStandardBook } from './support/task-c-harness';

function effectOf(receipt: CommandReceipt, kind: string): Record<string, unknown> {
  const effect = receipt.effects.find((candidate) => candidate.kind === kind);
  if (effect === undefined) throw new Error(`missing ${kind} effect`);
  return effect as unknown as Record<string, unknown>;
}

describe('recurring plans across a short month', () => {
  it('revises future managed occurrences while paid and detached stay historical', async () => {
    const harness = makeTaskCHarness('book-proof-4');
    await seedStandardBook(harness);

    await harness.run({
      kind: 'createRecurringPlan',
      bookId: harness.bookId,
      planId: 'plan-rent',
      name: 'Rent',
      amount: SAR(50_000),
      scheduleDay: 5,
      effectiveDate: '2026-09-01',
      flexibleDefinitionId: null,
    });
    const materialized = await harness.run({
      kind: 'materializePlanOccurrences', bookId: harness.bookId, planId: 'plan-rent', throughDate: '2026-11-30',
    });
    const ids = effectOf(materialized, 'planOccurrencesMaterialized')['occurrenceIds'] as string[];
    expect(ids).toEqual(['occ:plan-rent:2026-09-05', 'occ:plan-rent:2026-10-05', 'occ:plan-rent:2026-11-05']);
    const [septId, octId, novId] = ids as [string, string, string];

    // Materializing again creates nothing: stable identities, no duplicates.
    const retry = await harness.run({
      kind: 'materializePlanOccurrences', bookId: harness.bookId, planId: 'plan-rent', throughDate: '2026-11-30',
    });
    expect(effectOf(retry, 'planOccurrencesMaterialized')['occurrenceIds']).toEqual([]);
    expect(harness.state().planOccurrences).toHaveLength(3);

    // September becomes paid: reserve, then pay in September.
    await harness.run({
      kind: 'reservePlanOccurrence', bookId: harness.bookId, occurrenceId: septId, obligationId: 'obl-sept-rent', note: '',
    });
    const reserved = harness.state().planOccurrences.find((occurrence) => occurrence.occurrenceId === septId);
    expect(reserved?.linkedObligationId).toBe('obl-sept-rent');
    // The expectation keeps its due-cycle identity even though it is reserved now.
    const obligation = harness.state().obligations.find((candidate) => candidate.obligationId === 'obl-sept-rent');
    expect(obligation?.cycleId).toBe(`cyc:${harness.bookId}:2026-09-01`);
    await harness.run({
      kind: 'recordObligationPayment', bookId: harness.bookId, obligationId: 'obl-sept-rent', amount: SAR(50_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' }, note: '', category: null,
    });

    // October is detached before manual editing.
    await harness.run({ kind: 'detachPlanOccurrence', bookId: harness.bookId, occurrenceId: octId, note: 'paid cash' });

    const beforeRevision = (id: string): string => {
      const occurrence = harness.state().planOccurrences.find((candidate) => candidate.occurrenceId === id);
      if (occurrence === undefined) throw new Error('occurrence missing');
      return occurrence.revisionId;
    };
    const septRevision = beforeRevision(septId);
    const octRevision = beforeRevision(octId);

    // A revision effective October raises the amount for future unpaid
    // managed occurrences only.
    const revised = await harness.run({
      kind: 'reviseRecurringPlan', bookId: harness.bookId, planId: 'plan-rent',
      effectiveDate: '2026-10-01', amount: SAR(60_000), scheduleDay: 5, note: 'rent raised',
    });
    expect(effectOf(revised, 'recurringPlanRevised')['updatedOccurrences']).toBe(1);

    const after = (id: string) => harness.state().planOccurrences.find((candidate) => candidate.occurrenceId === id)!;
    expect(after(septId).revisionId).toBe(septRevision);
    expect(after(octId).revisionId).toBe(octRevision);
    expect(after(octId).state).toBe('detached');
    expect(occurrenceExpectedAmount(harness.state(), after(septId))).toEqual(SAR(50_000));
    expect(occurrenceExpectedAmount(harness.state(), after(octId))).toEqual(SAR(50_000));
    expect(occurrenceExpectedAmount(harness.state(), after(novId))).toEqual(SAR(60_000));

    // A detached occurrence ignores later revisions forever.
    await harness.run({
      kind: 'reviseRecurringPlan', bookId: harness.bookId, planId: 'plan-rent',
      effectiveDate: '2026-11-01', amount: SAR(70_000), scheduleDay: 5, note: 'raised again',
    });
    expect(harness.state().planOccurrences.find((candidate) => candidate.occurrenceId === octId)?.revisionId).toBe(octRevision);
  });

  it('clamps day 31 in February and keeps materialization idempotent', async () => {
    const harness = makeTaskCHarness('book-proof-4-short');
    await seedStandardBook(harness, { startDate: '2026-01-01', startingFundsMinor: 100_000 });
    await harness.run({
      kind: 'createRecurringPlan',
      bookId: harness.bookId,
      planId: 'plan-month-end',
      name: 'Month end',
      amount: SAR(10_000),
      scheduleDay: 31,
      effectiveDate: '2026-01-01',
      flexibleDefinitionId: null,
    });
    const materialized = await harness.run({
      kind: 'materializePlanOccurrences', bookId: harness.bookId, planId: 'plan-month-end', throughDate: '2026-02-28',
    });
    // 2026 is not a leap year: February clamps to the 28th.
    expect(effectOf(materialized, 'planOccurrencesMaterialized')['occurrenceIds']).toEqual([
      'occ:plan-month-end:2026-01-31',
      'occ:plan-month-end:2026-02-28',
    ]);
  });

  it('keeps flexible-definition links arithmetic-neutral', async () => {
    const harness = makeTaskCHarness('book-proof-4-flex');
    await seedStandardBook(harness);
    const before = harness.availableMinor();
    await harness.run({
      kind: 'createRecurringPlan',
      bookId: harness.bookId,
      planId: 'plan-flex',
      name: 'Flexible dining',
      amount: SAR(15_000),
      scheduleDay: 10,
      effectiveDate: '2026-09-01',
      flexibleDefinitionId: 'flex-dining',
    });
    await harness.run({
      kind: 'materializePlanOccurrences', bookId: harness.bookId, planId: 'plan-flex', throughDate: '2026-09-30',
    });
    // Planned-not-reserved occurrences never subtract from availability.
    expect(harness.availableMinor()).toBe(before);
    expect(completenessOf(harness).pool.state).toBe('current');
  });

  it('rejects duplicate plan IDs and unknown plans without writes', async () => {
    const harness = makeTaskCHarness('book-proof-4-safety');
    await seedStandardBook(harness);
    await harness.run({
      kind: 'createRecurringPlan', bookId: harness.bookId, planId: 'plan-dup', name: 'X',
      amount: SAR(1_000), scheduleDay: 3, effectiveDate: '2026-09-01', flexibleDefinitionId: null,
    });
    const revisionBefore = harness.state().revision;
    const duplicate = harness.previewRaw({
      kind: 'createRecurringPlan', bookId: harness.bookId, planId: 'plan-dup', name: 'X',
      amount: SAR(1_000), scheduleDay: 3, effectiveDate: '2026-09-01', flexibleDefinitionId: null,
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.failure.kind).toBe('planAlreadyExists');
    const unknown = harness.previewRaw({
      kind: 'materializePlanOccurrences', bookId: harness.bookId, planId: 'plan-missing', throughDate: '2026-09-30',
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.failure.kind).toBe('unknownPlan');
    expect(harness.state().revision).toBe(revisionBefore);
  });

  it('pays a reserved occurrence across cycles while the expectation keeps its due-cycle identity', async () => {
    const harness = makeTaskCHarness('book-proof-4-cross');
    await seedStandardBook(harness);
    await harness.run({
      kind: 'createRecurringPlan', bookId: harness.bookId, planId: 'plan-sub', name: 'Subscription',
      amount: SAR(10_000), scheduleDay: 5, effectiveDate: '2026-09-01', flexibleDefinitionId: null,
    });
    await harness.run({
      kind: 'materializePlanOccurrences', bookId: harness.bookId, planId: 'plan-sub', throughDate: '2026-09-30',
    });
    await harness.run({
      kind: 'reservePlanOccurrence', bookId: harness.bookId,
      occurrenceId: 'occ:plan-sub:2026-09-05', obligationId: 'obl-sub-sept', note: '',
    });
    // September closes with the subscription still reserved.
    await harness.run({ kind: 'closeCycle', bookId: harness.bookId, cycleId: null, note: '' });
    await harness.run({
      kind: 'openCycle', bookId: harness.bookId, startDate: '2026-10-01', startingFunds: SAR(50_000),
    });
    // Paid in October: the movement belongs to October, the expectation to September.
    await harness.run({
      kind: 'recordObligationPayment', bookId: harness.bookId, obligationId: 'obl-sub-sept', amount: SAR(10_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-10-05' }, note: '', category: null,
    });
    const state = harness.state();
    const obligation = state.obligations.find((candidate) => candidate.obligationId === 'obl-sub-sept');
    expect(obligation?.cycleId).toBe(`cyc:${harness.bookId}:2026-09-01`);
    const payment = state.entries.find((entry) => entry.kind === 'expense');
    expect(payment?.cycleId).toBe(`cyc:${harness.bookId}:2026-10-01`);
    // 50 start - 10 paid - 0 residual = 40, counted once.
    expect(harness.availableMinor()).toBe(40_000);
  });
});
