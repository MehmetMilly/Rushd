/**
 * Actual-movement appenders for obligation payments and returns.
 *
 * A payment is an expense linked to the obligation (actual money out); a
 * return is an expense-return linked to the obligation (actual money back).
 * Both carry an explicit confirmed occurrence, belong to the open cycle, and
 * are appended as immutable facts.
 */

import type { OperationId } from '../../domain/contracts/identity';
import type { BookState, ExpenseEntry, ExpenseReturnEntry } from '../../domain/contracts/ledger';
import type { ObligationId } from '../../domain/contracts/identity';
import type { OccurredAt } from '../../domain/contracts/commands';
import type { Money } from '../../domain/primitives/money';
import type { CommandContext } from './context';
import type { ApplyResult } from './handlers';
import {
  currencyMismatchFailure,
  newEntryId,
  occurredInstantOf,
  requireDateInOpenCycle,
  requireOpenCycle,
  resolveOccurredAt,
} from './handler-support';

export function appendExpenseEntry(
  bookId: ExpenseEntry['bookId'],
  occurredAt: OccurredAt,
  amount: Money,
  note: string,
  category: string | null,
  linkedObligationId: ObligationId,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const cycle = openCycle.value;

  if (amount.currency !== state.book.currency) {
    return currencyMismatchFailure(bookId, state.book.currency, amount.currency);
  }
  const localDate = resolveOccurredAt(occurredAt, state.book.timeZone, bookId);
  if (!localDate.ok) return localDate;
  const inCycle = requireDateInOpenCycle(localDate.value, cycle, bookId);
  if (!inCycle.ok) return inCycle;

  const entryId = newEntryId(context, 'obligation-payment');
  const entry: ExpenseEntry = {
    kind: 'expense',
    entryId,
    bookId,
    cycleId: cycle.cycleId,
    localDate: localDate.value,
    timeZone: state.book.timeZone,
    amount,
    note,
    category,
    flexibleDefinitionId: null,
    linkedObligationId,
    replacesEntryId: null,
    occurredAtInstantMs: occurredInstantOf(occurredAt),
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
        kind: 'expenseRecorded',
        entryId,
        cycleId: cycle.cycleId,
        localDate: localDate.value,
        amount,
        linkedObligationId,
        replacesEntryId: null,
      },
    ],
  };
}

export function appendObligationReturnEntry(
  bookId: ExpenseReturnEntry['bookId'],
  occurredAt: OccurredAt,
  amount: Money,
  note: string,
  linkedObligationId: ObligationId,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const cycle = openCycle.value;

  if (amount.currency !== state.book.currency) {
    return currencyMismatchFailure(bookId, state.book.currency, amount.currency);
  }
  const localDate = resolveOccurredAt(occurredAt, state.book.timeZone, bookId);
  if (!localDate.ok) return localDate;
  const inCycle = requireDateInOpenCycle(localDate.value, cycle, bookId);
  if (!inCycle.ok) return inCycle;

  const entryId = newEntryId(context, 'obligation-return');
  const entry: ExpenseReturnEntry = {
    kind: 'expenseReturn',
    entryId,
    bookId,
    cycleId: cycle.cycleId,
    localDate: localDate.value,
    timeZone: state.book.timeZone,
    amount,
    linkedExpenseEntryId: null,
    linkedObligationId,
    replacesReturnEntryId: null,
    note,
    occurredAtInstantMs: occurredInstantOf(occurredAt),
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
        kind: 'expenseReturnRecorded',
        entryId,
        cycleId: cycle.cycleId,
        localDate: localDate.value,
        amount,
        linkedExpenseEntryId: null,
        linkedObligationId,
        replacesReturnEntryId: null,
      },
    ],
  };
}
