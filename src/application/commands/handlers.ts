/**
 * Concrete state-transition handlers and the dispatch hub.
 *
 * Handlers are pure: they receive a frozen BookState (or nothing, for
 * createBook), the validated command, and the context, and they return either
 * a typed failure or the next state plus effects. They never write and never
 * read ambient globals. Execution and preview share this exact code path, so
 * a preview cannot promise effects that execution would compute differently.
 *
 * Task A's four handlers stay here; Task B's everyday behavior lives in the
 * per-domain handler modules (`activity-handlers`, `obligation-handlers`,
 * `allocation-handlers`) that this hub dispatches to, so no single file grows
 * into an unreviewable finance monolith.
 */

import { negateMoney } from '../../domain/primitives/money';
import { type CivilDate } from '../../domain/primitives/civil-date';
import { resolveCivilDate } from '../../domain/primitives/instant';
import { cycleStartForMonth, isDateWithinMonthlyWindow, monthlyCycleContaining } from '../../domain/primitives/monthly-cycle';
import { makeEntryId, composeCycleId, type EntryId, type GoalId, type ObligationId, type OperationId } from '../../domain/contracts/identity';
import { findEntryById, findOpenCycle, findReversalOf, type BookState, type OpenCycleRecord } from '../../domain/contracts/ledger';
import type {
  CommandEffect,
  CommandFailure,
  CreateBookCommand,
  FinanceCommand,
  OpenCycleCommand,
  RecordInflowCommand,
  ReverseInflowCommand,
} from '../../domain/contracts/commands';
import type { EntryLocation, GoalLocation, ObligationLocation } from '../../domain/contracts/repository';
import type { CommandContext } from './context';
import {
  currencyMismatchFailure,
  monthParts,
  requireOpenCycle,
  resolveOccurredAt,
} from './handler-support';
import { applyCorrectExpense, applyCorrectExpenseReturn, applyRecordExpense, applyRecordExpenseReturn } from './activity-handlers';
import {
  applyCancelObligation,
  applyCreateObligation,
  applyOpenObligationDispute,
  applyRecordObligationPayment,
  applyRecordObligationReturn,
  applyReleaseDisputedResidual,
  applyReopenObligation,
  applyResolveObligationDispute,
  applySettleObligationFinally,
} from './obligation-handlers';
import {
  applyAssignToGoal,
  applyCreateGoal,
  applyFundAllocationPool,
  applyReleaseAllocation,
  applyReverseAllocationRecord,
  applySetBuffer,
  applyUnassignFromGoal,
} from './allocation-handlers';

/**
 * Cross-book reference lookups supplied by the transaction/read model, so a
 * handler can reject references that belong to another book.
 */
export interface HandlerRefs {
  readonly locateEntry: (entryId: EntryId) => EntryLocation | null;
  readonly locateObligation: (obligationId: ObligationId) => ObligationLocation | null;
  readonly locateGoal: (goalId: GoalId) => GoalLocation | null;
}

export type ApplyResult =
  | { readonly ok: true; readonly nextState: BookState; readonly effects: readonly CommandEffect[] }
  | { readonly ok: false; readonly failure: CommandFailure };

/**
 * Applies a validated command to a state. `operationId` is the real
 * operation's identity during execution; preview supplies a placeholder that
 * never escapes into returned effects.
 */
export function dispatchApply(
  command: FinanceCommand,
  state: BookState | null,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  if (command.kind !== 'createBook' && state === null) {
    return { ok: false, failure: { kind: 'unknownBook', bookId: command.bookId } };
  }
  switch (command.kind) {
    case 'createBook':
      if (state !== null) {
        return { ok: false, failure: { kind: 'bookAlreadyExists', bookId: command.bookId } };
      }
      return applyCreateBook(command, context);
    case 'openCycle':
      return applyOpenCycle(command, state as BookState, context);
    case 'recordInflow':
      return applyRecordInflow(command, state as BookState, context, operationId);
    case 'reverseInflow':
      return applyReverseInflow(command, state as BookState, context, operationId, refs);
    case 'recordExpense':
      return applyRecordExpense(command, state as BookState, context, operationId);
    case 'correctExpense':
      return applyCorrectExpense(command, state as BookState, context, operationId, refs);
    case 'recordExpenseReturn':
      return applyRecordExpenseReturn(command, state as BookState, context, operationId, refs);
    case 'correctExpenseReturn':
      return applyCorrectExpenseReturn(command, state as BookState, context, operationId, refs);
    case 'createObligation':
      return applyCreateObligation(command, state as BookState, context, operationId, refs);
    case 'recordObligationPayment':
      return applyRecordObligationPayment(command, state as BookState, context, operationId, refs);
    case 'recordObligationReturn':
      return applyRecordObligationReturn(command, state as BookState, context, operationId, refs);
    case 'settleObligationFinally':
      return applySettleObligationFinally(command, state as BookState, context, operationId);
    case 'cancelObligation':
      return applyCancelObligation(command, state as BookState, context, operationId);
    case 'reopenObligation':
      return applyReopenObligation(command, state as BookState, context, operationId);
    case 'openObligationDispute':
      return applyOpenObligationDispute(command, state as BookState, context, operationId);
    case 'resolveObligationDispute':
      return applyResolveObligationDispute(command, state as BookState, context, operationId, refs);
    case 'releaseDisputedResidual':
      return applyReleaseDisputedResidual(command, state as BookState, context, operationId);
    case 'createGoal':
      return applyCreateGoal(command, state as BookState, context, operationId, refs);
    case 'fundAllocationPool':
      return applyFundAllocationPool(command, state as BookState, context, operationId);
    case 'assignToGoal':
      return applyAssignToGoal(command, state as BookState, context, operationId, refs);
    case 'unassignFromGoal':
      return applyUnassignFromGoal(command, state as BookState, context, operationId, refs);
    case 'releaseAllocation':
      return applyReleaseAllocation(command, state as BookState, context, operationId, refs);
    case 'reverseAllocationRecord':
      return applyReverseAllocationRecord(command, state as BookState, context, operationId);
    case 'setBuffer':
      return applySetBuffer(command, state as BookState, context, operationId);
  }
}

function applyCreateBook(command: CreateBookCommand, context: CommandContext): ApplyResult {
  const createdAtInstantMs = context.clock.nowMs();
  const createdAt = resolveCivilDate(createdAtInstantMs, command.timeZone);
  if (!createdAt.ok) {
    throw new TypeError('context clock produced an instant that cannot be resolved in the book timezone');
  }
  const state: BookState = {
    book: {
      id: command.bookId,
      displayName: command.displayName,
      currency: command.currency,
      timeZone: command.timeZone,
      cycleAnchor: command.cycleAnchor,
      createdAtInstantMs,
      createdAtLocalDate: createdAt.value,
      createdInTimeZone: command.timeZone,
    },
    revision: 1,
    cycles: [],
    entries: [],
    obligations: [],
    obligationEvents: [],
    goals: [],
    allocationRecords: [],
    buffer: null,
  };
  return {
    ok: true,
    nextState: state,
    effects: [
      {
        kind: 'bookCreated',
        bookId: command.bookId,
        currency: command.currency,
        timeZone: command.timeZone,
        cycleAnchor: command.cycleAnchor,
      },
    ],
  };
}

function applyOpenCycle(command: OpenCycleCommand, state: BookState, context: CommandContext): ApplyResult {
  const openCycle = findOpenCycle(state);
  if (openCycle !== null) {
    return { ok: false, failure: { kind: 'cycleAlreadyOpen', bookId: command.bookId, openCycleId: openCycle.cycleId } };
  }

  const parts = monthParts(command.startDate);
  const expectedStart = cycleStartForMonth(state.book.cycleAnchor, parts.year, parts.month);
  if (!expectedStart.ok || expectedStart.value !== command.startDate) {
    return {
      ok: false,
      failure: {
        kind: 'invalidCycleStart',
        bookId: command.bookId,
        requestedStartDate: command.startDate,
        expectedStartDate: expectedStart.ok ? expectedStart.value : command.startDate,
      },
    };
  }

  if (command.startingFunds.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, command.startingFunds.currency);
  }

  const cycleIdResult = composeCycleId(command.bookId, command.startDate);
  if (!cycleIdResult.ok) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`cycle id could not be composed (${cycleIdResult.failure.detail})`] },
    };
  }

  const containing = monthlyCycleContaining(state.book.cycleAnchor, command.startDate);
  const cycle = {
    cycleId: cycleIdResult.value,
    bookId: command.bookId,
    mode: 'fullCycle' as const,
    status: 'open' as const,
    startDate: command.startDate,
    endDateExclusive: containing.endDateExclusive,
    anchor: state.book.cycleAnchor,
    startingFunds: command.startingFunds,
    openedAtInstantMs: context.clock.nowMs(),
  };
  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    cycles: [...state.cycles, cycle],
  };
  return {
    ok: true,
    nextState,
    effects: [
      {
        kind: 'cycleOpened',
        cycleId: cycle.cycleId,
        startDate: cycle.startDate,
        endDateExclusive: cycle.endDateExclusive,
        startingFunds: cycle.startingFunds,
      },
    ],
  };
}

function applyRecordInflow(
  command: RecordInflowCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const cycle = openCycle.value;

  if (command.amount.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, command.amount.currency);
  }

  const localDate = resolveOccurredAt(command.occurredAt, state.book.timeZone, command.bookId);
  if (!localDate.ok) return localDate;
  if (!isDateWithinOpenCycle(localDate.value, cycle)) {
    return {
      ok: false,
      failure: { kind: 'dateOutsideOpenCycle', bookId: command.bookId, localDate: localDate.value, openCycleId: cycle.cycleId },
    };
  }

  const entryId = newLedgerEntryId(context, 'inflow');
  const entry = {
    kind: 'inflow' as const,
    entryId,
    bookId: command.bookId,
    cycleId: cycle.cycleId,
    localDate: localDate.value,
    timeZone: state.book.timeZone,
    amount: command.amount,
    note: command.note,
    capturedAtInstantMs: context.clock.nowMs(),
    capturedInTimeZone: state.book.timeZone,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };
  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    entries: [...state.entries, entry],
  };
  return {
    ok: true,
    nextState,
    effects: [
      { kind: 'inflowRecorded', entryId, cycleId: cycle.cycleId, localDate: localDate.value, amount: command.amount },
    ],
  };
}

function applyReverseInflow(
  command: ReverseInflowCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const cycle = openCycle.value;

  const target = findEntryById(state, command.inflowEntryId);
  if (target === null) {
    const located = refs.locateEntry(command.inflowEntryId);
    if (located !== null && located.bookId !== command.bookId) {
      return {
        ok: false,
        failure: {
          kind: 'crossBookReference',
          bookId: command.bookId,
          entryId: command.inflowEntryId,
          entryBookId: located.bookId,
        },
      };
    }
    return { ok: false, failure: { kind: 'unknownEntry', bookId: command.bookId, entryId: command.inflowEntryId } };
  }
  if (target.kind !== 'inflow') {
    return { ok: false, failure: { kind: 'notAnInflow', bookId: command.bookId, entryId: command.inflowEntryId } };
  }
  const existingReversal = findReversalOf(state, target.entryId);
  if (existingReversal !== null) {
    return {
      ok: false,
      failure: {
        kind: 'duplicateReversal',
        bookId: command.bookId,
        entryId: target.entryId,
        existingReversalEntryId: existingReversal.entryId,
      },
    };
  }

  const negated = negateMoney(target.amount);
  if (!negated.ok) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`reversal amount could not be derived (${negated.failure.reason})`] },
    };
  }

  // The financial date is the confirmed `occurredAt` from the command, never
  // the clock at execution: the preview and the execution of the same
  // confirmation must attribute the reversal to the same day. Capture
  // timestamps below still reflect execution time.
  const reversalDate = resolveOccurredAt(command.occurredAt, state.book.timeZone, command.bookId);
  if (!reversalDate.ok) return reversalDate;
  if (!isDateWithinOpenCycle(reversalDate.value, cycle)) {
    return {
      ok: false,
      failure: {
        kind: 'dateOutsideOpenCycle',
        bookId: command.bookId,
        localDate: reversalDate.value,
        openCycleId: cycle.cycleId,
      },
    };
  }

  const entryId = newLedgerEntryId(context, 'reversal');
  const entry = {
    kind: 'inflowReversal' as const,
    entryId,
    bookId: command.bookId,
    cycleId: cycle.cycleId,
    localDate: reversalDate.value,
    timeZone: state.book.timeZone,
    amount: negated.value,
    reversesEntryId: target.entryId,
    note: command.note,
    capturedAtInstantMs: context.clock.nowMs(),
    capturedInTimeZone: state.book.timeZone,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };
  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    entries: [...state.entries, entry],
  };
  return {
    ok: true,
    nextState,
    effects: [
      {
        kind: 'inflowReversalRecorded',
        entryId,
        reversesEntryId: target.entryId,
        cycleId: cycle.cycleId,
        localDate: reversalDate.value,
        amount: negated.value,
      },
    ],
  };
}

function isDateWithinOpenCycle(date: CivilDate, cycle: OpenCycleRecord): boolean {
  return isDateWithinMonthlyWindow(date, { startDate: cycle.startDate, endDateExclusive: cycle.endDateExclusive });
}

function newLedgerEntryId(context: CommandContext, prefix: string): EntryId {
  const made = makeEntryId(context.ids.newId(prefix));
  if (!made.ok) {
    throw new TypeError(`id factory produced an invalid entry id: ${made.failure.detail}`);
  }
  return made.value;
}
