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
import type { ObligationId, OperationId } from '../../domain/contracts/identity';
import type { BookState, ExpenseEntry } from '../../domain/contracts/ledger';
import { findEntryById } from '../../domain/contracts/ledger';
import type {
  CommandEffect,
  CommandFailure,
  CorrectExpenseCommand,
  CorrectExpenseReturnCommand,
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
  occurredInstantOf,
  activeVersionTimeZone,
  requireDateInOpenCycle,
  requireOpenCycle,
  resolveOccurredAt,
} from './handler-support';
import {
  effectiveFamilyRefunds,
  expenseCorrectionFamily,
  findExpenseReturnReversalOf,
  findExpenseReversalOf,
  isExpenseLive,
  returnableAmountForExpense,
} from '../../domain/activity/derive';
import { effectiveObligationReturns, grossLivePaymentsFor } from '../../domain/obligations/derive';

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

/**
 * Guards correcting a linked payment (or its return): the resulting live
 * payments must still cover the standing effective obligation refunds, so
 * the obligation net can never go negative through a correction.
 */
function checkObligationCorrectionNet(
  state: BookState,
  bookId: ExpenseEntry['bookId'],
  obligationId: ObligationId,
  correctedPaymentAmount: Money,
  replacementAmount: Money | null,
): { ok: true } | { ok: false; failure: CommandFailure } {
  const gross = grossLivePaymentsFor(state, obligationId);
  const refunds = effectiveObligationReturns(state, obligationId);
  if (gross === null || refunds === null) {
    return { ok: false, failure: { kind: 'invalidCommand', issues: [`obligation ${obligationId} payments could not be derived`] } };
  }
  const newGrossMinor = gross.minorUnits - correctedPaymentAmount.minorUnits + (replacementAmount?.minorUnits ?? 0);
  if (newGrossMinor < refunds.minorUnits) {
    return {
      ok: false,
      failure: {
        kind: 'returnExceedsReturnable',
        bookId,
        targetKind: 'obligation',
        targetId: obligationId,
        requested: refunds,
        returnable: { currency: gross.currency, minorUnits: newGrossMinor },
      },
    };
  }
  return { ok: true };
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

  const localDate = resolveOccurredAt(occurredAt, activeVersionTimeZone(state), bookId);
  if (!localDate.ok) return localDate;
  const inCycle = requireDateInOpenCycle(localDate.value, cycle, bookId);
  if (!inCycle.ok) return inCycle;

  const entryTimeZone = activeVersionTimeZone(state);
  const entryId = newEntryId(context, 'expense');
  const entry: ExpenseEntry = {
    kind: 'expense',
    entryId,
    bookId,
    cycleId: cycle.cycleId,
    localDate: localDate.value,
    timeZone: entryTimeZone,
    amount: fields.amount,
    note: fields.note,
    category: fields.category,
    flexibleDefinitionId: fields.flexibleDefinitionId,
    linkedObligationId: fields.linkedObligationId,
    replacesEntryId: fields.replacesEntryId,
    occurredAtInstantMs: occurredInstantOf(occurredAt),
    capturedAtInstantMs: context.clock.nowMs(),
    capturedInTimeZone: entryTimeZone,
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

  // Standing effective refunds across the correction family must fit inside
  // the replacement: shrinking below them (or voiding while any remain)
  // would strand refunds above the paid amount and invent money. Reversed
  // returns stop counting, so correcting a mistaken return first reopens the
  // allowance honestly.
  const familyRefunds = effectiveFamilyRefunds(state, target.entryId);
  if (!familyRefunds.ok) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`family refunds could not be derived (${familyRefunds.failure.reason})`] },
    };
  }
  const replacementAmount = command.replacement?.amount ?? target.amount;
  if (replacementAmount.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, replacementAmount.currency);
  }
  if (command.replacement === null) {
    if (familyRefunds.value.minorUnits > 0) {
      return {
        ok: false,
        failure: {
          kind: 'returnExceedsReturnable',
          bookId: command.bookId,
          targetKind: 'expense',
          targetId: target.entryId,
          requested: familyRefunds.value,
          returnable: { currency: state.book.currency, minorUnits: 0 },
        },
      };
    }
  } else if (replacementAmount.minorUnits < familyRefunds.value.minorUnits) {
    return {
      ok: false,
      failure: {
        kind: 'returnExceedsReturnable',
        bookId: command.bookId,
        targetKind: 'expense',
        targetId: target.entryId,
        requested: familyRefunds.value,
        returnable: replacementAmount,
      },
    };
  }

  // A corrected linked payment must leave the obligation's net non-negative:
  // standing obligation refunds cannot exceed the resulting live payments.
  if (target.linkedObligationId !== null) {
    const blocked = checkObligationCorrectionNet(state, command.bookId, target.linkedObligationId, target.amount, command.replacement === null ? null : replacementAmount);
    if (!blocked.ok) return blocked;
  }

  // Correction records retain the original fact's timezone by design: the
  // correction belongs to the corrected history, so its occurrence resolves
  // and stamps in the target's timezone rather than the active version's.
  const correctionDate = resolveOccurredAt(command.occurredAt, target.timeZone, command.bookId);
  if (!correctionDate.ok) return correctionDate;
  const correctionInCycle = requireDateInOpenCycle(correctionDate.value, cycle, command.bookId);
  if (!correctionInCycle.ok) return correctionInCycle;

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
    timeZone: target.timeZone,
    amount: negated.value,
    reversesEntryId: target.entryId,
    note: command.note,
    occurredAtInstantMs: occurredInstantOf(command.occurredAt),
    capturedAtInstantMs,
    capturedInTimeZone: target.timeZone,
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
    // The replacement's financial date is either the explicit local date
    // (no instant evidence) or the correction's own occurrence.
    const replacementInstant =
      command.replacement.localDate === undefined ? occurredInstantOf(command.occurredAt) : null;
    const replacement: ExpenseEntry = {
      kind: 'expense',
      entryId: newEntryId(context, 'expense'),
      bookId: command.bookId,
      cycleId: cycle.cycleId,
      localDate: replacementDate.value,
      timeZone: target.timeZone,
      amount: replacementAmount,
      note: command.replacement.note ?? target.note,
      category: command.replacement.category !== undefined ? command.replacement.category : target.category,
      flexibleDefinitionId:
        command.replacement.flexibleDefinitionId !== undefined ? command.replacement.flexibleDefinitionId : target.flexibleDefinitionId,
      linkedObligationId: target.linkedObligationId,
      replacesEntryId: target.entryId,
      occurredAtInstantMs: replacementInstant,
      capturedAtInstantMs,
      capturedInTimeZone: target.timeZone,
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

  const localDate = resolveOccurredAt(command.occurredAt, activeVersionTimeZone(state), command.bookId);
  if (!localDate.ok) return localDate;
  const inCycle = requireDateInOpenCycle(localDate.value, cycle, command.bookId);
  if (!inCycle.ok) return inCycle;

  const entryTimeZone = activeVersionTimeZone(state);
  const entryId = newEntryId(context, 'expense-return');
  const entry = {
    kind: 'expenseReturn' as const,
    entryId,
    bookId: command.bookId,
    cycleId: cycle.cycleId,
    localDate: localDate.value,
    timeZone: entryTimeZone,
    amount: command.amount,
    linkedExpenseEntryId: target.entryId,
    linkedObligationId: null,
    replacesReturnEntryId: null,
    note: command.note,
    occurredAtInstantMs: occurredInstantOf(command.occurredAt),
    capturedAtInstantMs: context.clock.nowMs(),
    capturedInTimeZone: entryTimeZone,
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
    replacesReturnEntryId: null,
  };
  return { ok: true, nextState, effects: [effect] };
}

export function applyCorrectExpenseReturn(
  command: CorrectExpenseReturnCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const cycle = openCycle.value;

  const rawTarget = findEntryById(state, command.returnEntryId);
  if (rawTarget === null) {
    const located: EntryLocation | null = refs.locateEntry(command.returnEntryId);
    if (located !== null && located.bookId !== command.bookId) {
      return {
        ok: false,
        failure: {
          kind: 'crossBookReference',
          bookId: command.bookId,
          entryId: command.returnEntryId,
          entryBookId: located.bookId,
        },
      };
    }
    return { ok: false, failure: { kind: 'unknownEntry', bookId: command.bookId, entryId: command.returnEntryId } };
  }
  if (rawTarget.kind !== 'expenseReturn') {
    return { ok: false, failure: { kind: 'notAReturn', bookId: command.bookId, entryId: command.returnEntryId } };
  }
  const target = rawTarget;
  const existingReversal = findExpenseReturnReversalOf(state, target.entryId);
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

  const replacementAmount = command.replacement?.amount ?? null;
  if (replacementAmount !== null && replacementAmount.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, replacementAmount.currency);
  }

  // The corrected family total must still fit the live paid amount: earlier
  // refunds count against the replacement across old and new IDs, and the
  // replacement of an obligation return must leave the obligation net
  // non-negative.
  if (target.linkedExpenseEntryId !== null) {
    const blocked = checkFamilyReturnCorrection(
      state,
      command.bookId,
      target.linkedExpenseEntryId,
      target.amount,
      replacementAmount,
    );
    if (!blocked.ok) return blocked;
  } else if (target.linkedObligationId !== null) {
    const refunds = effectiveObligationReturns(state, target.linkedObligationId);
    if (refunds === null) {
      return {
        ok: false,
        failure: { kind: 'invalidCommand', issues: [`obligation ${target.linkedObligationId} returns could not be derived`] },
      };
    }
    const gross = grossLivePaymentsFor(state, target.linkedObligationId);
    if (gross === null) {
      return {
        ok: false,
        failure: { kind: 'invalidCommand', issues: [`obligation ${target.linkedObligationId} payments could not be derived`] },
      };
    }
    const newTotalMinor = refunds.minorUnits - target.amount.minorUnits + (replacementAmount?.minorUnits ?? 0);
    if (newTotalMinor > gross.minorUnits) {
      return {
        ok: false,
        failure: {
          kind: 'returnExceedsReturnable',
          bookId: command.bookId,
          targetKind: 'obligation',
          targetId: target.linkedObligationId,
          requested: { currency: refunds.currency, minorUnits: newTotalMinor },
          returnable: gross,
        },
      };
    }
  } else {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`return ${target.entryId} links to neither an expense nor an obligation`] },
    };
  }

  // Correction records retain the original fact's timezone by design (see
  // applyCorrectExpense).
  const correctionDate = resolveOccurredAt(command.occurredAt, target.timeZone, command.bookId);
  if (!correctionDate.ok) return correctionDate;
  const correctionInCycle = requireDateInOpenCycle(correctionDate.value, cycle, command.bookId);
  if (!correctionInCycle.ok) return correctionInCycle;

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
    kind: 'expenseReturnReversal' as const,
    entryId: newEntryId(context, 'expense-return-reversal'),
    bookId: command.bookId,
    cycleId: cycle.cycleId,
    localDate: correctionDate.value,
    timeZone: target.timeZone,
    amount: negated.value,
    reversesEntryId: target.entryId,
    linkedExpenseEntryId: target.linkedExpenseEntryId,
    linkedObligationId: target.linkedObligationId,
    note: command.note,
    occurredAtInstantMs: occurredInstantOf(command.occurredAt),
    capturedAtInstantMs,
    capturedInTimeZone: target.timeZone,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };

  const effects: CommandEffect[] = [
    {
      kind: 'expenseReturnReversalRecorded',
      entryId: reversalEntry.entryId,
      reversesEntryId: target.entryId,
      cycleId: cycle.cycleId,
      localDate: correctionDate.value,
      amount: negated.value,
      linkedExpenseEntryId: target.linkedExpenseEntryId,
      linkedObligationId: target.linkedObligationId,
    },
  ];

  let entries: BookState['entries'] = [...state.entries, reversalEntry];
  if (command.replacement !== null && replacementAmount !== null) {
    const replacementInstant =
      command.replacement.localDate === undefined ? occurredInstantOf(command.occurredAt) : null;
    const replacement = {
      kind: 'expenseReturn' as const,
      entryId: newEntryId(context, 'expense-return'),
      bookId: command.bookId,
      cycleId: cycle.cycleId,
      localDate: replacementDate.value,
      timeZone: target.timeZone,
      amount: replacementAmount,
      linkedExpenseEntryId: target.linkedExpenseEntryId,
      linkedObligationId: target.linkedObligationId,
      replacesReturnEntryId: target.entryId,
      note: command.replacement.note ?? target.note,
      occurredAtInstantMs: replacementInstant,
      capturedAtInstantMs,
      capturedInTimeZone: target.timeZone,
      calculationVersion: context.calculationVersion,
      sourceOperationId: operationId,
    };
    entries = [...entries, replacement];
    effects.push({
      kind: 'expenseReturnRecorded',
      entryId: replacement.entryId,
      cycleId: cycle.cycleId,
      localDate: replacement.localDate,
      amount: replacement.amount,
      linkedExpenseEntryId: replacement.linkedExpenseEntryId,
      linkedObligationId: replacement.linkedObligationId,
      replacesReturnEntryId: replacement.replacesReturnEntryId,
    });
  }

  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    entries,
  };
  return { ok: true, nextState, effects };
}

/**
 * Guards correcting a standalone return: the family total after removing the
 * corrected return and adding its replacement must still fit the live head
 * expense of the correction family. A void (null replacement) only removes
 * refunds and is always safe for the cap.
 */
function checkFamilyReturnCorrection(
  state: BookState,
  bookId: ExpenseEntry['bookId'],
  linkedExpenseEntryId: ExpenseEntry['entryId'],
  correctedReturnAmount: Money,
  replacementAmount: Money | null,
): { ok: true } | { ok: false; failure: CommandFailure } {
  const familyRefunds = effectiveFamilyRefunds(state, linkedExpenseEntryId);
  if (!familyRefunds.ok) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`family refunds could not be derived (${familyRefunds.failure.reason})`] },
    };
  }
  const newTotalMinor = familyRefunds.value.minorUnits - correctedReturnAmount.minorUnits + (replacementAmount?.minorUnits ?? 0);
  const head = liveFamilyHead(state, linkedExpenseEntryId);
  if (head === null) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`correction family of ${linkedExpenseEntryId} has no live expense`] },
    };
  }
  if (newTotalMinor > head.amount.minorUnits) {
    return {
      ok: false,
      failure: {
        kind: 'returnExceedsReturnable',
        bookId,
        targetKind: 'expense',
        targetId: head.entryId,
        requested: { currency: familyRefunds.value.currency, minorUnits: newTotalMinor },
        returnable: head.amount,
      },
    };
  }
  return { ok: true };
}

/** The live leaf of an expense correction family (the current replacement). */
function liveFamilyHead(state: BookState, expenseEntryId: ExpenseEntry['entryId']): ExpenseEntry | null {
  const family = expenseCorrectionFamily(state, expenseEntryId);
  let head: ExpenseEntry | null = null;
  for (const entry of family) {
    if (isExpenseLive(state, entry.entryId)) {
      head = entry;
    }
  }
  return head;
}
