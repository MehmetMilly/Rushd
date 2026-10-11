import { describe, expect, it } from 'vitest';
import { findOpenCycle } from '../../src/application/commands';
import { makeTaskCHarness, SAR } from './support/task-c-harness';

describe('new-user pool funding', () => {
  it('uses opening funds for a cycle that begins today', async () => {
    const harness = makeTaskCHarness('book-new-user-full');
    await harness.run({
      kind: 'createBook',
      bookId: harness.bookId,
      displayName: 'new user',
      currency: 'SAR',
      timeZone: 'Asia/Riyadh',
      cycleAnchor: { kind: 'payday', dayOfMonth: 5 },
    });
    await harness.run({
      kind: 'openCycle',
      bookId: harness.bookId,
      startDate: '2026-09-05',
      startingFunds: SAR(25_000),
    });
    await harness.run({
      kind: 'recordExpense',
      bookId: harness.bookId,
      amount: SAR(2_500),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: 'Lunch',
      category: 'food',
      flexibleDefinitionId: null,
    });

    expect(findOpenCycle(harness.state())?.startingFunds).toEqual(SAR(25_000));
    expect(harness.availableMinor()).toBe(22_500);
  });

  it('uses the observed remaining pool mid-cycle and ignores earlier spending', async () => {
    const harness = makeTaskCHarness('book-new-user-boundary');
    await harness.run({
      kind: 'createBook',
      bookId: harness.bookId,
      displayName: 'new user',
      currency: 'SAR',
      timeZone: 'Asia/Riyadh',
      cycleAnchor: { kind: 'firstOfMonth' },
    });
    await harness.run({
      kind: 'openBoundaryCycle',
      bookId: harness.bookId,
      observedPool: SAR(25_000),
      boundary: { kind: 'civilDateTime', localDate: '2026-09-05', localTime: '12:00:00' },
      note: 'Pool observed during setup',
    });
    await harness.run({
      kind: 'recordExpense',
      bookId: harness.bookId,
      amount: SAR(5_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: 'Earlier lunch',
      category: 'food',
      flexibleDefinitionId: null,
    });
    await harness.run({
      kind: 'recordExpense',
      bookId: harness.bookId,
      amount: SAR(2_500),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: 'Later lunch',
      category: 'food',
      flexibleDefinitionId: null,
    });

    const cycle = findOpenCycle(harness.state());
    expect(cycle?.mode).toBe('remainingFromBoundary');
    expect(cycle?.startingFunds).toEqual(SAR(25_000));
    expect(harness.availableMinor()).toBe(22_500);
  });
});
