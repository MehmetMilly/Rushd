/**
 * Pure derivations over actual activity facts.
 *
 * Paid history is immutable: a live expense is one without a linked reversal,
 * and its returnable amount is what has not already come back. These helpers
 * are shared by the command handlers and the availability calculation, so a
 * correction, a return, and the resulting availability can never disagree.
 */

import { subtractMoney, type MoneyResult } from '../primitives/money';
import type { BookState, ExpenseEntry, ExpenseReturnEntry, LedgerEntry } from '../contracts/ledger';
import type { EntryId } from '../contracts/identity';

export function findExpenseEntry(state: BookState, entryId: EntryId): ExpenseEntry | null {
  const entry = state.entries.find((candidate) => candidate.entryId === entryId) ?? null;
  return entry !== null && entry.kind === 'expense' ? entry : null;
}

export function findExpenseReversalOf(state: BookState, expenseEntryId: EntryId): ExpenseReversalOf | null {
  for (const entry of state.entries) {
    if (entry.kind === 'expenseReversal' && entry.reversesEntryId === expenseEntryId) {
      return entry;
    }
  }
  return null;
}

type ExpenseReversalOf = Extract<LedgerEntry, { kind: 'expenseReversal' }>;

/** An expense is live while no linked reversal (correction) fact exists. */
export function isExpenseLive(state: BookState, expenseEntryId: EntryId): boolean {
  return findExpenseReversalOf(state, expenseEntryId) === null;
}

/** Live (unreversed) expense entries, in append order. */
export function liveExpenseEntries(state: BookState): readonly ExpenseEntry[] {
  return state.entries.filter((entry): entry is ExpenseEntry => entry.kind === 'expense' && isExpenseLive(state, entry.entryId));
}

export function expenseReturnsFor(state: BookState, expenseEntryId: EntryId): readonly ExpenseReturnEntry[] {
  return state.entries.filter(
    (entry): entry is ExpenseReturnEntry => entry.kind === 'expenseReturn' && entry.linkedExpenseEntryId === expenseEntryId,
  );
}

/**
 * What can still be returned against a live expense: its amount minus
 * unreversed returns already linked to it. Returns are actual money, so the
 * sum of returns can approach but never exceed the expense amount.
 */
export function returnableAmountForExpense(state: BookState, expense: ExpenseEntry): MoneyResult {
  let remaining = expense.amount;
  for (const entry of expenseReturnsFor(state, expense.entryId)) {
    const next = subtractMoney(remaining, entry.amount);
    if (!next.ok) return next;
    remaining = next.value;
  }
  return { ok: true, value: remaining };
}
