import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  describeCommandFailure,
  executeCommand,
  previewCommand,
  stableDigest,
  type CommandConfirmation,
  type CommandReceipt,
} from '../../src/application/commands';
import { makeBookId, makeOperationId, type BookId, type OperationId } from '../../src/domain/contracts/identity';
import { createDeterministicContext } from './support/deterministic-context';
import { InMemoryFinanceRepository } from './support/in-memory-repository';

const BOOK_A = 'book-alpha';
const BOOK_B = 'book-beta';

function branded<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok) throw new Error('invalid test id');
  return result.value as T;
}

const bookA: BookId = branded(makeBookId(BOOK_A));
const bookB: BookId = branded(makeBookId(BOOK_B));
const opId = (raw: string): OperationId => branded(makeOperationId(raw));
const SAR = (minorUnits: number) => ({ currency: 'SAR' as const, minorUnits });

function makeHarness() {
  const repo = new InMemoryFinanceRepository();
  const { context } = createDeterministicContext();
  return { repo, context };
}

/** Previews and executes with a fresh operation ID, asserting success. */
let runSequence = 0;
async function run(
  harness: ReturnType<typeof makeHarness>,
  rawCommand: unknown,
  operationId?: string,
): Promise<{ receipt: CommandReceipt; confirmation: CommandConfirmation }> {
  const preview = previewCommand(harness.repo, rawCommand, harness.context);
  expect(preview.ok, preview.ok ? undefined : describeCommandFailure(preview.failure)).toBe(true);
  if (!preview.ok) throw new Error('unreachable');
  const confirmation: CommandConfirmation = {
    operationId: opId(operationId ?? `op-auto-${String(++runSequence).padStart(4, '0')}`),
    expectedRevision: preview.preview.expectedRevision,
    previewDigest: preview.preview.previewDigest,
  };
  const result = await executeCommand(harness.repo, rawCommand, confirmation, harness.context);
  expect(result.ok, result.ok ? undefined : describeCommandFailure(result.failure)).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return { receipt: result.receipt, confirmation };
}

/** Seeds two books, each with an open 1,000 SAR cycle. */
async function seedTwoBooks(harness: ReturnType<typeof makeHarness>): Promise<void> {
  for (const id of [BOOK_A, BOOK_B]) {
    await run(harness, {
      kind: 'createBook',
      bookId: id,
      displayName: id,
      currency: 'SAR',
      timeZone: 'Asia/Riyadh',
      cycleAnchor: { kind: 'firstOfMonth' },
    });
    await run(harness, {
      kind: 'openCycle',
      bookId: id,
      startDate: '2026-09-01',
      startingFunds: { currency: 'SAR', minorUnits: 100_000 },
    });
  }
}

describe('allocation exact-once behavior', () => {
  it('rejects a double assignment and a double release with no partial effect', async () => {
    const harness = makeHarness();
    await seedTwoBooks(harness);
    await run(harness, { kind: 'createGoal', bookId: BOOK_A, goalId: 'goal-x', name: 'X', targetAmount: SAR(100_000) });
    await run(harness, { kind: 'fundAllocationPool', bookId: BOOK_A, amount: SAR(20_000), occurredAt: { kind: 'civilDate', localDate: '2026-09-02' }, note: '' });

    // First assignment of 200 succeeds; the second exceeds the unallocated
    // pool and is rejected without writing.
    await run(harness, { kind: 'assignToGoal', bookId: BOOK_A, goalId: 'goal-x', amount: SAR(20_000), note: '' });
    const preview = previewCommand(harness.repo, { kind: 'assignToGoal', bookId: BOOK_A, goalId: 'goal-x', amount: SAR(20_000), note: '' }, harness.context);
    expect(preview.ok).toBe(false);
    if (!preview.ok) {
      expect(preview.failure).toEqual({
        kind: 'insufficientTrackedFunds',
        bookId: BOOK_A,
        pool: { kind: 'unallocated' },
        requested: SAR(20_000),
        available: SAR(0),
      });
    }

    // First release of 200 succeeds; a second release is rejected.
    await run(harness, {
      kind: 'releaseAllocation',
      bookId: BOOK_A,
      goalId: 'goal-x',
      amount: SAR(20_000),
      destinationCycleId: `cyc:${BOOK_A}:2026-09-01`,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-03' },
      note: '',
    });
    const revisionAfterRelease = harness.repo.getBookState(bookA)?.revision;
    const secondRelease = previewCommand(harness.repo, {
      kind: 'releaseAllocation',
      bookId: BOOK_A,
      goalId: 'goal-x',
      amount: SAR(20_000),
      destinationCycleId: `cyc:${BOOK_A}:2026-09-01`,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: '',
    }, harness.context);
    expect(secondRelease.ok).toBe(false);
    if (!secondRelease.ok) {
      expect(secondRelease.failure.kind).toBe('insufficientTrackedFunds');
      if (secondRelease.failure.kind === 'insufficientTrackedFunds') {
        expect(secondRelease.failure.pool).toEqual({ kind: 'goal', goalId: 'goal-x' });
      }
    }
    // Neither rejected command wrote anything.
    expect(harness.repo.getBookState(bookA)?.revision).toBe(revisionAfterRelease);
  });

  it('rejects a release naming a destination cycle other than the open cycle', async () => {
    const harness = makeHarness();
    await seedTwoBooks(harness);
    await run(harness, { kind: 'createGoal', bookId: BOOK_A, goalId: 'goal-y', name: 'Y', targetAmount: SAR(1_000) });
    await run(harness, { kind: 'fundAllocationPool', bookId: BOOK_A, amount: SAR(5_000), occurredAt: { kind: 'civilDate', localDate: '2026-09-02' }, note: '' });
    const preview = previewCommand(harness.repo, {
      kind: 'releaseAllocation',
      bookId: BOOK_A,
      goalId: 'goal-y',
      amount: SAR(1_000),
      destinationCycleId: `cyc:${BOOK_A}:2026-10-01`,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-03' },
      note: '',
    }, harness.context);
    expect(preview.ok).toBe(false);
    if (!preview.ok) {
      expect(preview.failure).toEqual({
        kind: 'invalidReleaseDestination',
        bookId: BOOK_A,
        requestedCycleId: `cyc:${BOOK_A}:2026-10-01`,
        openCycleId: `cyc:${BOOK_A}:2026-09-01`,
      });
    }
  });

  it('rejects allocation reversals that would break conservation, and accepts honest ones', async () => {
    const harness = makeHarness();
    await seedTwoBooks(harness);
    await run(harness, { kind: 'createGoal', bookId: BOOK_A, goalId: 'goal-z', name: 'Z', targetAmount: SAR(1_000) });
    const funding = await run(harness, { kind: 'fundAllocationPool', bookId: BOOK_A, amount: SAR(10_000), occurredAt: { kind: 'civilDate', localDate: '2026-09-02' }, note: '' });
    const fundingRecordId = funding.receipt.effects.find((effect) => effect.kind === 'allocationFunded');
    if (fundingRecordId?.kind !== 'allocationFunded') throw new Error('unreachable');
    await run(harness, { kind: 'assignToGoal', bookId: BOOK_A, goalId: 'goal-z', amount: SAR(10_000), note: '' });

    // The funded money is assigned now, so reversing the funding would pull
    // from the goal — rejected to protect attribution.
    const blocked = previewCommand(harness.repo, {
      kind: 'reverseAllocationRecord',
      bookId: BOOK_A,
      allocationRecordId: fundingRecordId.recordId,
      note: '',
    }, harness.context);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.failure.kind).toBe('insufficientTrackedFunds');

    // Reversing the assignment is honest: the money is back in unallocated.
    const assignment = await run(harness, { kind: 'unassignFromGoal', bookId: BOOK_A, goalId: 'goal-z', amount: SAR(10_000), note: '' });
    const unassignRecordId = assignment.receipt.effects.find((effect) => effect.kind === 'allocationUnassigned');
    if (unassignRecordId?.kind !== 'allocationUnassigned') throw new Error('unreachable');
    const reversal = await run(harness, { kind: 'reverseAllocationRecord', bookId: BOOK_A, allocationRecordId: unassignRecordId.recordId, note: '' });
    expect(reversal.receipt.effects[0]?.kind).toBe('allocationRecordReversed');

    // A reversal of a reversal is a typed rejection.
    const reversalRecordId = reversal.receipt.effects[0];
    if (reversalRecordId?.kind !== 'allocationRecordReversed') throw new Error('unreachable');
    const secondReversal = previewCommand(harness.repo, {
      kind: 'reverseAllocationRecord',
      bookId: BOOK_A,
      allocationRecordId: reversalRecordId.recordId,
      note: '',
    }, harness.context);
    expect(secondReversal.ok).toBe(false);
    if (!secondReversal.ok) expect(secondReversal.failure.kind).toBe('invalidAllocationReversal');
  });
});

describe('operation identity and confirmation binding for new commands', () => {
  it('replays the original receipt for a retried allocation and rejects changed content under the same operation ID', async () => {
    const harness = makeHarness();
    await seedTwoBooks(harness);
    const createGoalCommand = { kind: 'createGoal', bookId: BOOK_A, goalId: 'goal-retry', name: 'Retry', targetAmount: SAR(1_000) };
    const first = await run(harness, createGoalCommand, 'op-goal-once');

    // A retry reuses the same confirmation triple: the operation journal
    // replays the original receipt with no second effect, even though a
    // fresh preview of the same command would now fail (the goal exists).
    const retry = await executeCommand(harness.repo, createGoalCommand, first.confirmation, harness.context);
    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error('unreachable');
    expect(retry.retried).toBe(true);
    expect(retry.receipt).toEqual(first.receipt);
    expect(harness.repo.getBookState(bookA)?.goals).toHaveLength(1);
    expect(harness.repo.getBookState(bookA)?.revision).toBe(3);

    // The same operation ID with different content is an explicit conflict.
    const changed = { kind: 'createGoal', bookId: BOOK_A, goalId: 'goal-retry', name: 'Retry renamed', targetAmount: SAR(1_000) };
    const revision = harness.repo.getBookState(bookA)?.revision ?? 0;
    const result = await executeCommand(harness.repo, changed, {
      operationId: opId('op-goal-once'),
      expectedRevision: revision,
      previewDigest: stableDigest(`${canonicalJson(changed)}\n${String(revision)}`),
    }, harness.context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('operationIdConflict');
    expect(harness.repo.getBookState(bookA)?.goals).toHaveLength(1);
  });

  it('rejects a stale confirmation with a revision conflict and no write', async () => {
    const harness = makeHarness();
    await seedTwoBooks(harness);
    await run(harness, { kind: 'createGoal', bookId: BOOK_A, goalId: 'goal-stale', name: 'Stale', targetAmount: SAR(1_000) });
    const stalePreview = previewCommand(harness.repo, { kind: 'setBuffer', bookId: BOOK_A, buffer: SAR(1_000), note: '' }, harness.context);
    expect(stalePreview.ok).toBe(true);
    if (!stalePreview.ok) throw new Error('unreachable');
    // Advance the book so the held preview is stale.
    await run(harness, { kind: 'setBuffer', bookId: BOOK_A, buffer: SAR(2_000), note: '' });
    const staleConfirmation: CommandConfirmation = {
      operationId: opId('op-stale'),
      expectedRevision: stalePreview.preview.expectedRevision,
      previewDigest: stalePreview.preview.previewDigest,
    };
    const result = await executeCommand(harness.repo, { kind: 'setBuffer', bookId: BOOK_A, buffer: SAR(1_000), note: '' }, staleConfirmation, harness.context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('revisionConflict');
      if (result.failure.kind === 'revisionConflict') {
        expect(result.failure.expectedRevision).toBe(stalePreview.preview.expectedRevision);
        expect(result.failure.actualRevision).toBe(stalePreview.preview.expectedRevision + 1);
      }
    }
    expect(harness.repo.getBookState(bookA)?.buffer?.amount).toEqual(SAR(2_000));
  });
});

describe('cross-book references', () => {
  it('rejects obligations and goals that belong to another book, without writing', async () => {
    const harness = makeHarness();
    await seedTwoBooks(harness);
    await run(harness, { kind: 'createObligation', bookId: BOOK_A, obligationId: 'obl-alpha', expectedAmount: SAR(1_000), note: '', category: null });

    const foreignObligationPayment = previewCommand(harness.repo, {
      kind: 'recordObligationPayment',
      bookId: BOOK_B,
      obligationId: 'obl-alpha',
      amount: SAR(100),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: '',
      category: null,
    }, harness.context);
    expect(foreignObligationPayment.ok).toBe(false);
    if (!foreignObligationPayment.ok) {
      expect(foreignObligationPayment.failure).toEqual({
        kind: 'crossBookObligation',
        bookId: BOOK_B,
        obligationId: 'obl-alpha',
        obligationBookId: BOOK_A,
      });
    }

    await run(harness, { kind: 'createGoal', bookId: BOOK_A, goalId: 'goal-alpha', name: 'Alpha', targetAmount: SAR(1_000) });
    const foreignAssignment = previewCommand(harness.repo, {
      kind: 'assignToGoal',
      bookId: BOOK_B,
      goalId: 'goal-alpha',
      amount: SAR(100),
      note: '',
    }, harness.context);
    expect(foreignAssignment.ok).toBe(false);
    if (!foreignAssignment.ok) {
      expect(foreignAssignment.failure).toEqual({
        kind: 'crossBookGoal',
        bookId: BOOK_B,
        goalId: 'goal-alpha',
        goalBookId: BOOK_A,
      });
    }
    expect(harness.repo.getBookState(bookB)?.entries).toHaveLength(0);
    expect(harness.repo.getBookState(bookB)?.revision).toBe(2);
  });

  it('rejects corrections of entries that belong to another book', async () => {
    const harness = makeHarness();
    await seedTwoBooks(harness);
    const expense = await run(harness, {
      kind: 'recordExpense',
      bookId: BOOK_A,
      amount: SAR(1_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: '',
      category: null,
      flexibleDefinitionId: null,
    });
    const effect = expense.receipt.effects[0];
    if (effect?.kind !== 'expenseRecorded') throw new Error('unreachable');
    const preview = previewCommand(harness.repo, {
      kind: 'correctExpense',
      bookId: BOOK_B,
      expenseEntryId: effect.entryId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: '',
      replacement: null,
    }, harness.context);
    expect(preview.ok).toBe(false);
    if (!preview.ok) {
      expect(preview.failure).toEqual({
        kind: 'crossBookReference',
        bookId: BOOK_B,
        entryId: effect.entryId,
        entryBookId: BOOK_A,
      });
    }
  });
});

describe('injected failure across multi-record commands', () => {
  it('leaves state, journal, and outbox untouched when the adapter fails mid-commit', async () => {
    const harness = makeHarness();
    await seedTwoBooks(harness);
    const expense = await run(harness, {
      kind: 'recordExpense',
      bookId: BOOK_A,
      amount: SAR(5_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: '',
      category: 'food',
      flexibleDefinitionId: null,
    });
    const effect = expense.receipt.effects[0];
    if (effect?.kind !== 'expenseRecorded') throw new Error('unreachable');

    const before = JSON.stringify(harness.repo.getBookState(bookA));
    const outboxBefore = harness.repo.listOutbox().length;
    const failedCommand = {
      kind: 'correctExpense',
      bookId: BOOK_A,
      expenseEntryId: effect.entryId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: 'atomic correction',
      replacement: { amount: SAR(4_000) },
    };
    const preview = previewCommand(harness.repo, failedCommand, harness.context);
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error('unreachable');
    harness.repo.injectWriteFailure('putBookState');
    const failedConfirmation = {
      operationId: opId('op-atomic-fail'),
      expectedRevision: preview.preview.expectedRevision,
      previewDigest: preview.preview.previewDigest,
    };
    // The adapter failure surfaces as a thrown infrastructure error and
    // rolls the whole transaction back.
    await expect(executeCommand(harness.repo, failedCommand, failedConfirmation, harness.context)).rejects.toThrow('injected adapter failure');
    expect(JSON.stringify(harness.repo.getBookState(bookA))).toBe(before);
    expect(harness.repo.listOutbox()).toHaveLength(outboxBefore);
    expect(harness.repo.getOperation(opId('op-atomic-fail'))).toBeNull();

    // The same command succeeds cleanly on retry.
    const retried = await executeCommand(harness.repo, failedCommand, failedConfirmation, harness.context);
    expect(retried.ok, retried.ok ? undefined : describeCommandFailure(retried.failure)).toBe(true);
    if (!retried.ok) throw new Error('unreachable');
    expect(retried.receipt.effects).toHaveLength(2); // reversal + replacement together
    const state = harness.repo.getBookState(bookA);
    expect(state?.entries).toHaveLength(3); // original + reversal + replacement
  });
});
