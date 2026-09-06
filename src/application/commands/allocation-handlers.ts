/**
 * Handlers for goals, tracked allocations, and the explicit buffer.
 *
 * Funding moves spendable money into the tracked pool exactly once;
 * assignment divides already-funded money among goals with no second
 * availability effect; unassignment returns money to tracked-unallocated;
 * release names its destination cycle and returns money to spending exactly
 * once. Source attribution is preserved on every record, and attempts to
 * assign or release more tracked funds than exist are rejected. The buffer
 * setting replaces the previous value atomically under the same
 * preview/confirm/revision protocol as every other mutation.
 */

import type {
  GoalId,
  OperationId,
} from '../../domain/contracts/identity';
import type { BookState, AllocationRecord, BufferSetting, GoalRecord } from '../../domain/contracts/ledger';
import type {
  AssignToGoalCommand,
  CommandEffect,
  CommandFailure,
  CreateGoalCommand,
  FundAllocationPoolCommand,
  ReleaseAllocationCommand,
  ReverseAllocationRecordCommand,
  SetBufferCommand,
  UnassignFromGoalCommand,
} from '../../domain/contracts/commands';
import type { Money } from '../../domain/primitives/money';
import type { CommandContext } from './context';
import type { ApplyResult, HandlerRefs } from './handlers';
import {
  currencyMismatchFailure,
  newAllocationRecordId,
  occurredInstantOf,
  requireDateInOpenCycle,
  requireOpenCycle,
  resolveOccurredAt,
} from './handler-support';
import { deriveTrackedPool, type TrackedPoolView } from '../../domain/allocations/derive';

function allocationRecord(
  change: AllocationRecord['change'],
  localDate: AllocationRecord['localDate'],
  cycleId: BookState['cycles'][number]['cycleId'],
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  note: string,
  occurredAtInstantMs: AllocationRecord['occurredAtInstantMs'] = null,
): AllocationRecord {
  return {
    kind: 'allocation',
    recordId: newAllocationRecordId(context),
    bookId: state.book.id,
    cycleId,
    localDate,
    change,
    note,
    occurredAtInstantMs,
    capturedAtInstantMs: context.clock.nowMs(),
    capturedInTimeZone: state.book.timeZone,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };
}

function commitWithRecords(state: BookState, records: readonly AllocationRecord[], effects: readonly CommandEffect[]): ApplyResult {
  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    allocationRecords: [...state.allocationRecords, ...records],
  };
  return { ok: true, nextState, effects };
}

function requireGoal(state: BookState, bookId: GoalRecord['bookId'], goalId: GoalId, refs: HandlerRefs) {
  const goal = state.goals.find((candidate) => candidate.goalId === goalId);
  if (goal !== undefined) return { ok: true as const, value: goal };
  const located = refs.locateGoal(goalId);
  if (located !== null && located.bookId !== bookId) {
    return {
      ok: false as const,
      failure: { kind: 'crossBookGoal' as const, bookId, goalId, goalBookId: located.bookId },
    };
  }
  return { ok: false as const, failure: { kind: 'unknownGoal' as const, bookId, goalId } };
}

function requireTrackedFunds(
  pool: TrackedPoolView,
  bookId: BookState['book']['id'],
  source: { readonly kind: 'unallocated' } | { readonly kind: 'goal'; readonly goalId: GoalId },
  requested: Money,
): { ok: true } | { ok: false; failure: Extract<CommandFailure, { kind: 'insufficientTrackedFunds' }> } {
  const available =
    source.kind === 'unallocated'
      ? pool.unallocated
      : (pool.goals.find((entry) => entry.goal.goalId === source.goalId)?.assigned ?? { currency: requested.currency, minorUnits: 0 });
  if (available.minorUnits < requested.minorUnits) {
    return {
      ok: false,
      failure: {
        kind: 'insufficientTrackedFunds',
        bookId,
        pool: source,
        requested,
        available,
      },
    };
  }
  return { ok: true };
}

export function applyCreateGoal(
  command: CreateGoalCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;

  const located = refs.locateGoal(command.goalId);
  if (located !== null && located.bookId !== command.bookId) {
    return {
      ok: false,
      failure: { kind: 'crossBookGoal', bookId: command.bookId, goalId: command.goalId, goalBookId: located.bookId },
    };
  }
  if (state.goals.some((candidate) => candidate.goalId === command.goalId)) {
    return { ok: false, failure: { kind: 'goalAlreadyExists', bookId: command.bookId, goalId: command.goalId } };
  }

  const goal: GoalRecord = {
    kind: 'goal',
    goalId: command.goalId,
    bookId: command.bookId,
    name: command.name,
    targetAmount: command.targetAmount,
    createdAtInstantMs: context.clock.nowMs(),
    createdInTimeZone: state.book.timeZone,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };
  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    goals: [...state.goals, goal],
  };
  return {
    ok: true,
    nextState,
    effects: [{ kind: 'goalCreated', goalId: goal.goalId, targetAmount: goal.targetAmount }],
  };
}

export function applyFundAllocationPool(
  command: FundAllocationPoolCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;

  if (command.amount.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, command.amount.currency);
  }
  const localDate = resolveOccurredAt(command.occurredAt, state.book.timeZone, command.bookId);
  if (!localDate.ok) return localDate;
  const inCycle = requireDateInOpenCycle(localDate.value, openCycle.value, command.bookId);
  if (!inCycle.ok) return inCycle;

  // Funding is the one availability deduction for this money; assignment of
  // the same funded amount later has no second effect.
  const record = allocationRecord(
    { type: 'funding', amount: command.amount },
    localDate.value,
    openCycle.value.cycleId,
    state,
    context,
    operationId,
    command.note,
    occurredInstantOf(command.occurredAt),
  );
  return commitWithRecords(state, [record], [
    {
      kind: 'allocationFunded',
      recordId: record.recordId,
      cycleId: record.cycleId,
      localDate: record.localDate as NonNullable<typeof record.localDate>,
      amount: command.amount,
    },
  ]);
}

export function applyAssignToGoal(
  command: AssignToGoalCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const goalCheck = requireGoal(state, command.bookId, command.goalId, refs);
  if (!goalCheck.ok) return goalCheck;

  if (command.amount.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, command.amount.currency);
  }
  const pool = deriveTrackedPool(state);
  const funds = requireTrackedFunds(pool, command.bookId, { kind: 'unallocated' }, command.amount);
  if (!funds.ok) return funds;

  const record = allocationRecord(
    { type: 'assignment', goalId: command.goalId, amount: command.amount },
    null,
    openCycle.value.cycleId,
    state,
    context,
    operationId,
    command.note,
  );
  return commitWithRecords(state, [record], [
    { kind: 'allocationAssigned', recordId: record.recordId, goalId: command.goalId, amount: command.amount },
  ]);
}

export function applyUnassignFromGoal(
  command: UnassignFromGoalCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const goalCheck = requireGoal(state, command.bookId, command.goalId, refs);
  if (!goalCheck.ok) return goalCheck;

  if (command.amount.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, command.amount.currency);
  }
  const pool = deriveTrackedPool(state);
  const funds = requireTrackedFunds(pool, command.bookId, { kind: 'goal', goalId: command.goalId }, command.amount);
  if (!funds.ok) return funds;

  // Unassignment returns money to tracked-unallocated, never to spending.
  const record = allocationRecord(
    { type: 'unassignment', goalId: command.goalId, amount: command.amount },
    null,
    openCycle.value.cycleId,
    state,
    context,
    operationId,
    command.note,
  );
  return commitWithRecords(state, [record], [
    { kind: 'allocationUnassigned', recordId: record.recordId, goalId: command.goalId, amount: command.amount },
  ]);
}

export function applyReleaseAllocation(
  command: ReleaseAllocationCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;

  if (command.destinationCycleId !== openCycle.value.cycleId) {
    return {
      ok: false,
      failure: {
        kind: 'invalidReleaseDestination',
        bookId: command.bookId,
        requestedCycleId: command.destinationCycleId,
        openCycleId: openCycle.value.cycleId,
      },
    };
  }
  if (command.goalId !== null) {
    const goalCheck = requireGoal(state, command.bookId, command.goalId, refs);
    if (!goalCheck.ok) return goalCheck;
  }

  if (command.amount.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, command.amount.currency);
  }
  const pool = deriveTrackedPool(state);
  const funds = requireTrackedFunds(
    pool,
    command.bookId,
    command.goalId === null ? { kind: 'unallocated' } : { kind: 'goal', goalId: command.goalId },
    command.amount,
  );
  if (!funds.ok) return funds;

  const localDate = resolveOccurredAt(command.occurredAt, state.book.timeZone, command.bookId);
  if (!localDate.ok) return localDate;
  const inCycle = requireDateInOpenCycle(localDate.value, openCycle.value, command.bookId);
  if (!inCycle.ok) return inCycle;

  const record = allocationRecord(
    { type: 'release', goalId: command.goalId, amount: command.amount, destinationCycleId: command.destinationCycleId },
    localDate.value,
    openCycle.value.cycleId,
    state,
    context,
    operationId,
    command.note,
    occurredInstantOf(command.occurredAt),
  );
  return commitWithRecords(state, [record], [
    {
      kind: 'allocationReleased',
      recordId: record.recordId,
      cycleId: record.cycleId,
      localDate: record.localDate as NonNullable<typeof record.localDate>,
      destinationCycleId: command.destinationCycleId,
      goalId: command.goalId,
      amount: command.amount,
    },
  ]);
}

export function applyReverseAllocationRecord(
  command: ReverseAllocationRecordCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;

  const target = state.allocationRecords.find((candidate) => candidate.recordId === command.allocationRecordId);
  if (target === undefined) {
    return { ok: false, failure: { kind: 'unknownAllocationRecord', bookId: command.bookId, recordId: command.allocationRecordId } };
  }
  if (target.change.type === 'reversal') {
    return {
      ok: false,
      failure: {
        kind: 'invalidAllocationReversal',
        bookId: command.bookId,
        recordId: command.allocationRecordId,
        detail: 'a reversal record cannot be reversed; append a correcting record instead',
      },
    };
  }

  // The inverse must not break pool conservation: the money the reversal
  // pulls back must still be sitting where the original record left it.
  const pool = deriveTrackedPool(state);
  const amount = target.change.amount;
  const guard: { ok: true } | { ok: false; failure: Extract<CommandFailure, { kind: 'insufficientTrackedFunds' | 'invalidAllocationReversal' }> } = ((): { ok: true } | { ok: false; failure: Extract<CommandFailure, { kind: 'insufficientTrackedFunds' | 'invalidAllocationReversal' }> } => {
    switch (target.change.type) {
      case 'funding':
        return requireTrackedFunds(pool, command.bookId, { kind: 'unallocated' }, amount);
      case 'assignment':
        return requireTrackedFunds(pool, command.bookId, { kind: 'goal', goalId: target.change.goalId }, amount);
      case 'unassignment':
        return requireTrackedFunds(pool, command.bookId, { kind: 'unallocated' }, amount);
      case 'release':
        // Reversing a release re-earmarks money currently in spending; the
        // tracked source simply regains its balance, so no pool guard is
        // needed. Conservation is preserved and availability may honestly
        // show the shortfall if the money was already spent.
        return { ok: true };
    }
  })();
  if (!guard.ok) return guard;

  const record = allocationRecord(
    { type: 'reversal', reversesRecordId: target.recordId },
    null,
    openCycle.value.cycleId,
    state,
    context,
    operationId,
    command.note,
  );
  return commitWithRecords(state, [record], [
    {
      kind: 'allocationRecordReversed',
      recordId: record.recordId,
      reversesRecordId: target.recordId,
      reversedChange: target.change.type,
      amount,
    },
  ]);
}

export function applySetBuffer(
  command: SetBufferCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;

  if (command.buffer.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, command.buffer.currency);
  }

  const buffer: BufferSetting = {
    amount: command.buffer,
    sourceOperationId: operationId,
    updatedAtInstantMs: context.clock.nowMs(),
    calculationVersion: context.calculationVersion,
  };
  const previousAmount = state.buffer?.amount ?? null;
  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    buffer,
  };
  return {
    ok: true,
    nextState,
    effects: [{ kind: 'bufferSet', amount: buffer.amount, previousAmount }],
  };
}
