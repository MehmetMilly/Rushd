/**
 * Concrete state-transition handlers for the four Task A commands.
 *
 * Handlers are pure: they receive a frozen BookState (or nothing, for
 * createBook), the validated command, and the context, and they return either
 * a typed failure or the next state plus effects. They never write and never
 * read ambient globals. Execution and preview share this exact code path, so
 * a preview cannot promise effects that execution would compute differently.
 */

import { negateMoney } from '../../domain/primitives/money';
import { type CurrencyCode } from '../../domain/primitives/currency';
import type { CivilDate } from '../../domain/primitives/civil-date';
import { resolveCivilDate, type TimeZoneName } from '../../domain/primitives/instant';
import {
  cycleStartForMonth,
  isDateWithinMonthlyWindow,
  monthlyCycleContaining,
} from '../../domain/primitives/monthly-cycle';
import { makeEntryId, composeCycleId, type BookId, type EntryId, type OperationId } from '../../domain/contracts/identity';
import { findEntryById, findOpenCycle, findReversalOf, type BookState } from '../../domain/contracts/ledger';
import type {
  CommandEffect,
  CommandFailure,
  CreateBookCommand,
  FinanceCommand,
  OccurredAt,
  OpenCycleCommand,
  RecordInflowCommand,
  ReverseInflowCommand,
} from '../../domain/contracts/commands';
import type { EntryLocation } from '../../domain/contracts/repository';
import type { CommandContext } from './context';

export type ApplyResult =
  | { readonly ok: true; readonly nextState: BookState; readonly effects: readonly CommandEffect[] }
  | { readonly ok: false; readonly failure: CommandFailure };

/**
 * Applies a validated command to a state. `operationId` is the real
 * operation's identity during execution; preview supplies a placeholder that
 * never escapes into returned effects. `locateEntry` lets a reversal detect
 * references that belong to another book.
 */
export function dispatchApply(
  command: FinanceCommand,
  state: BookState | null,
  context: CommandContext,
  operationId: OperationId,
  locateEntry: (entryId: EntryId) => EntryLocation | null,
): ApplyResult {
  switch (command.kind) {
    case 'createBook':
      if (state !== null) {
        return { ok: false, failure: { kind: 'bookAlreadyExists', bookId: command.bookId } };
      }
      return applyCreateBook(command, context);
    case 'openCycle':
      if (state === null) {
        return { ok: false, failure: { kind: 'unknownBook', bookId: command.bookId } };
      }
      return applyOpenCycle(command, state, context);
    case 'recordInflow':
      if (state === null) {
        return { ok: false, failure: { kind: 'unknownBook', bookId: command.bookId } };
      }
      return applyRecordInflow(command, state, context, operationId);
    case 'reverseInflow':
      if (state === null) {
        return { ok: false, failure: { kind: 'unknownBook', bookId: command.bookId } };
      }
      return applyReverseInflow(command, state, context, operationId, locateEntry);
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
  if (!isDateWithinMonthlyWindow(localDate.value, { startDate: cycle.startDate, endDateExclusive: cycle.endDateExclusive })) {
    return {
      ok: false,
      failure: { kind: 'dateOutsideOpenCycle', bookId: command.bookId, localDate: localDate.value, openCycleId: cycle.cycleId },
    };
  }

  const entryId = newEntryId(context, 'inflow');
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
  locateEntry: (entryId: EntryId) => EntryLocation | null,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const cycle = openCycle.value;

  const target = findEntryById(state, command.inflowEntryId);
  if (target === null) {
    const located = locateEntry(command.inflowEntryId);
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
  if (!isDateWithinMonthlyWindow(reversalDate.value, { startDate: cycle.startDate, endDateExclusive: cycle.endDateExclusive })) {
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

  const entryId = newEntryId(context, 'reversal');
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

function requireOpenCycle(state: BookState): { ok: true; value: OpenCycleRecord } | { ok: false; failure: CommandFailure } {
  const openCycle = findOpenCycle(state);
  if (openCycle === null) {
    return { ok: false, failure: { kind: 'noOpenCycle', bookId: state.book.id } };
  }
  return { ok: true, value: openCycle };
}

function resolveOccurredAt(
  occurredAt: OccurredAt,
  timeZone: TimeZoneName,
  bookId: BookId,
): { ok: true; value: CivilDate } | { ok: false; failure: CommandFailure } {
  if (occurredAt.kind === 'civilDate') {
    return { ok: true, value: occurredAt.localDate };
  }
  const resolved = resolveCivilDate(occurredAt.instantMs, timeZone);
  if (!resolved.ok) {
    return {
      ok: false,
      failure: {
        kind: 'invalidOccurredAt',
        bookId,
        detail: `instant ${occurredAt.instantMs} could not be resolved in ${timeZone} (${resolved.failure.reason})`,
      },
    };
  }
  return { ok: true, value: resolved.value };
}

function currencyMismatchFailure(bookId: BookId, bookCurrency: CurrencyCode, providedCurrency: CurrencyCode): { ok: false; failure: CommandFailure } {
  return {
    ok: false,
    failure: { kind: 'currencyMismatch', bookId, bookCurrency, providedCurrency },
  };
}

function newEntryId(context: CommandContext, prefix: string): EntryId {
  const made = makeEntryId(context.ids.newId(prefix));
  if (!made.ok) {
    throw new TypeError(`id factory produced an invalid entry id: ${made.failure.detail}`);
  }
  return made.value;
}

function monthParts(date: CivilDate): { year: number; month: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

type OpenCycleRecord = NonNullable<ReturnType<typeof findOpenCycle>>;
