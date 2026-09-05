/**
 * Handlers for actual activity: expenses, linked corrections, and returns.
 *
 * Editing a paid fact appends a linked reversal and — when a replacement is
 * supplied — its replacement atomically in one command; the original expense
 * is never mutated. Returns are actual money received (an expected refund
 * adds nothing) and can never exceed the linked returnable amount. Category
 * and flexible-definition links affect classification/monitoring only.
 */

import { negateMoney, type Money } from '../../domain/primitives/money';
import type { OperationId } from '../../domain/contracts/identity';
import type { BookState, ExpenseEntry } from '../../domain/contracts/ledger';
import { findEntryById } from '../../domain/contracts/ledger';
import type {
  CommandEffect,
  CorrectExpenseCommand,
  OccurredAt,
  RecordExpenseCommand,
  RecordExpenseReturnCommand,
} from '../../domain/contracts/commands';
import type { EntryLocation } from '../../domain/contracts/repository';
import type { CommandContext } from './context';
import type { ApplyResult, HandlerRefs } from './handlers';
import {
  currencyMismatchFailure,
  newEntryId,
  requireDateInOpenCycle,
  requireOpenCycle,
  resolveOccurredAt,
} from './handler-support';
import { findExpenseReversalOf, returnableAmountForExpense } from '../../domain/activity/derive';

export function applyRecordExpense(
  command: RecordExpenseCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
): ApplyResult {
  return appendExpense(
    {
      amount: command.amount,
      note: command.note,
      category: command.category,
      flexibleDefinitionId: command.flexibleDefinitionId,
      linkedObligationId: null,
      replacesEntryId: null,
    },
    command.bookId,
    command.occurredAt,
    state,
    context,
    operationId,
  );
}

interface ExpenseFields {
  readonly amount: Money;
  readonly note: string;
  readonly category: string | null;
  readonly flexibleDefinitionId: string | null;
  readonly linkedObligationId: ExpenseEntry['linkedObligationId'];
  readonly replacesEntryId: ExpenseEntry['replacesEntryId'];
}

/** Shared append path for a plain expense and a correction replacement. */
function appendExpense(
  fields: ExpenseFields,
  bookId: ExpenseEntry['bookId'],
  occurredAt: OccurredAt,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const cycle = openCycle.value;

  if (fields.amount.currency !== state.book.currency) {
    return currencyMismatchFailure(bookId, state.book.currency, fields.amount.currency);
  }

  const localDate = resolveOccurredAt(occurredAt, state.book.timeZone, bookId);
  if (!localDate.ok) return localDate;
  const inCycle = requireDateInOpenCycle(localDate.value, cycle, bookId);
  if (!inCycle.ok) return inCycle;

  const entryId = newEntryId(context, 'expense');
  const entry: ExpenseEntry = {
    kind: 'expense',
    entryId,
    bookId,
    cycleId: cycle.cycleId,
    localDate: localDate.value,
    timeZone: state.book.timeZone,
    amount: fields.amount,
    note: fields.note,
    category: fields.category,
    flexibleDefinitionId: fields.flexibleDefinitionId,
    linkedObligationId: fields.linkedObligationId,
    replacesEntryId: fields.replacesEntryId,
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
  const effect: CommandEffect = {
    kind: 'expenseRecorded',
    entryId,
    cycleId: cycle.cycleId,
    localDate: localDate.value,
    amount: fields.amount,
    linkedObligationId: fields.linkedObligationId,
    replacesEntryId: fields.replacesEntryId,
  };
  return { ok: true, nextState, effects: [effect] };
}

export function applyCorrectExpense(
  command: CorrectExpenseCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const cycle = openCycle.value;

  const target = findEntryById(state, command.expenseEntryId);
  if (target === null) {
    const located: EntryLocation | null = refs.locateEntry(command.expenseEntryId);
    if (located !== null && located.bookId !== command.bookId) {
      return {
        ok: false,
        failure: {
          kind: 'crossBookReference',
          bookId: command.bookId,
          entryId: command.expenseEntryId,
          entryBookId: located.bookId,
        },
      };
    }
    return { ok: false, failure: { kind: 'unknownEntry', bookId: command.bookId, entryId: command.expenseEntryId } };
  }
  if (target.kind !== 'expense') {
    return { ok: false, failure: { kind: 'notAnExpense', bookId: command.bookId, entryId: command.expenseEntryId } };
  }
  const existingReversal = findExpenseReversalOf(state, target.entryId);
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

  const correctionDate = resolveOccurredAt(command.occurredAt, state.book.timeZone, command.bookId);
  if (!correctionDate.ok) return correctionDate;
  const correctionInCycle = requireDateInOpenCycle(correctionDate.value, cycle, command.bookId);
  if (!correctionInCycle.ok) return correctionInCycle;

  const replacementAmount = command.replacement?.amount ?? target.amount;
  if (replacementAmount.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, replacementAmount.currency);
  }
  const replacementDate =
    command.replacement?.localDate !== undefined
      ? { ok: true as const, value: command.replacement.localDate }
      : correctionDate;
  const replacementInCycle = requireDateInOpenCycle(replacementDate.value, cycle, command.bookId);
  if (!replacementInCycle.ok) return replacementInCycle;

  const negated = negateMoney(target.amount);
  if (!negated.ok) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`correction amount could not be derived (${negated.failure.reason})`] },
    };
  }

  const capturedAtInstantMs = context.clock.nowMs();
  const reversalEntry = {
    kind: 'expenseReversal' as const,
    entryId: newEntryId(context, 'expense-reversal'),
    bookId: command.bookId,
    cycleId: cycle.cycleId,
    localDate: correctionDate.value,
    timeZone: state.book.timeZone,
    amount: negated.value,
    reversesEntryId: target.entryId,
    note: command.note,
    capturedAtInstantMs,
    capturedInTimeZone: state.book.timeZone,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };

  const effects: CommandEffect[] = [
    {
      kind: 'expenseReversalRecorded',
      entryId: reversalEntry.entryId,
      reversesEntryId: target.entryId,
      cycleId: cycle.cycleId,
      localDate: correctionDate.value,
      amount: negated.value,
    },
  ];

  let entries: BookState['entries'] = [...state.entries, reversalEntry];
  if (command.replacement !== null) {
    const replacement: ExpenseEntry = {
      kind: 'expense',
      entryId: newEntryId(context, 'expense'),
      bookId: command.bookId,
      cycleId: cycle.cycleId,
      localDate: replacementDate.value,
      timeZone: state.book.timeZone,
      amount: replacementAmount,
      note: command.replacement.note ?? target.note,
      category: command.replacement.category !== undefined ? command.replacement.category : target.category,
      flexibleDefinitionId:
        command.replacement.flexibleDefinitionId !== undefined ? command.replacement.flexibleDefinitionId : target.flexibleDefinitionId,
      linkedObligationId: target.linkedObligationId,
      replacesEntryId: target.entryId,
      capturedAtInstantMs,
      capturedInTimeZone: state.book.timeZone,
      calculationVersion: context.calculationVersion,
      sourceOperationId: operationId,
    };
    entries = [...entries, replacement];
    effects.push({
      kind: 'expenseRecorded',
      entryId: replacement.entryId,
      cycleId: cycle.cycleId,
      localDate: replacement.localDate,
      amount: replacement.amount,
      linkedObligationId: replacement.linkedObligationId,
      replacesEntryId: replacement.replacesEntryId,
    });
  }

  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    entries,
  };
  return { ok: true, nextState, effects };
}

export function applyRecordExpenseReturn(
  command: RecordExpenseReturnCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const cycle = openCycle.value;

  const target = findEntryById(state, command.expenseEntryId);
  if (target === null) {
    const located: EntryLocation | null = refs.locateEntry(command.expenseEntryId);
    if (located !== null && located.bookId !== command.bookId) {
      return {
        ok: false,
        failure: {
          kind: 'crossBookReference',
          bookId: command.bookId,
          entryId: command.expenseEntryId,
          entryBookId: located.bookId,
        },
      };
    }
    return { ok: false, failure: { kind: 'unknownEntry', bookId: command.bookId, entryId: command.expenseEntryId } };
  }
  if (target.kind !== 'expense') {
    return { ok: false, failure: { kind: 'notAnExpense', bookId: command.bookId, entryId: command.expenseEntryId } };
  }
  // The original fact is reversed; returns must target its live replacement.
  const existingReversal = findExpenseReversalOf(state, target.entryId);
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

  if (command.amount.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, command.amount.currency);
  }
  const returnable = returnableAmountForExpense(state, target);
  if (!returnable.ok) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`returnable amount could not be derived (${returnable.failure.reason})`] },
    };
  }
  if (command.amount.minorUnits > returnable.value.minorUnits) {
    return {
      ok: false,
      failure: {
        kind: 'returnExceedsReturnable',
        bookId: command.bookId,
        targetKind: 'expense',
        targetId: target.entryId,
        requested: command.amount,
        returnable: returnable.value,
      },
    };
  }

  const localDate = resolveOccurredAt(command.occurredAt, state.book.timeZone, command.bookId);
  if (!localDate.ok) return localDate;
  const inCycle = requireDateInOpenCycle(localDate.value, cycle, command.bookId);
  if (!inCycle.ok) return inCycle;

  const entryId = newEntryId(context, 'expense-return');
  const entry = {
    kind: 'expenseReturn' as const,
    entryId,
    bookId: command.bookId,
    cycleId: cycle.cycleId,
    localDate: localDate.value,
    timeZone: state.book.timeZone,
    amount: command.amount,
    linkedExpenseEntryId: target.entryId,
    linkedObligationId: null,
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
  const effect: CommandEffect = {
    kind: 'expenseReturnRecorded',
    entryId,
    cycleId: cycle.cycleId,
    localDate: localDate.value,
    amount: command.amount,
    linkedExpenseEntryId: target.entryId,
    linkedObligationId: null,
  };
  return { ok: true, nextState, effects: [effect] };
}
