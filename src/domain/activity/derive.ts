/**
 * Pure derivations over actual activity facts.
 *
 * Paid history is immutable: a live expense is one without a linked reversal,
 * and a live return is one without a linked return reversal. Corrections form
 * an explicit lineage through `replacesEntryId` / `replacesReturnEntryId`,
 * so earlier refunds always count against the current replacement: a new
 * replacement ID never resets the refund allowance. These helpers are shared
 * by the command handlers and the availability calculation, so a correction,
 * a return, a return correction, and the resulting availability can never
 * disagree.
 */

import { subtractMoney, sumMoney, type Money, type MoneyResult } from '../primitives/money';
import type {
  BookState,
  ExpenseEntry,
  ExpenseReturnEntry,
  ExpenseReturnReversalEntry,
  LedgerEntry,
} from '../contracts/ledger';
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

export function findExpenseReturnEntry(state: BookState, entryId: EntryId): ExpenseReturnEntry | null {
  const entry = state.entries.find((candidate) => candidate.entryId === entryId) ?? null;
  return entry !== null && entry.kind === 'expenseReturn' ? entry : null;
}

export function findExpenseReturnReversalOf(state: BookState, returnEntryId: EntryId): ExpenseReturnReversalEntry | null {
  for (const entry of state.entries) {
    if (entry.kind === 'expenseReturnReversal' && entry.reversesEntryId === returnEntryId) {
      return entry;
    }
  }
  return null;
}

/** A return is live (effective) while no linked return-reversal fact exists. */
export function isExpenseReturnLive(state: BookState, returnEntryId: EntryId): boolean {
  return findExpenseReturnReversalOf(state, returnEntryId) === null;
}

/** Live (unreversed) return entries, in append order. */
export function liveExpenseReturns(state: BookState): readonly ExpenseReturnEntry[] {
  return state.entries.filter(
    (entry): entry is ExpenseReturnEntry => entry.kind === 'expenseReturn' && isExpenseReturnLive(state, entry.entryId),
  );
}

export function expenseReturnsFor(state: BookState, expenseEntryId: EntryId): readonly ExpenseReturnEntry[] {
  return state.entries.filter(
    (entry): entry is ExpenseReturnEntry => entry.kind === 'expenseReturn' && entry.linkedExpenseEntryId === expenseEntryId,
  );
}

/**
 * The full correction family of an expense: the entry itself, every ancestor
 * reached through `replacesEntryId`, and every descendant replacement, in
 * append order. Refunds linked to any family member count against every
 * other member, so a correction can never shed standing refunds by minting a
 * new ID.
 */
export function expenseCorrectionFamily(state: BookState, expenseEntryId: EntryId): readonly ExpenseEntry[] {
  const byId = new Map<EntryId, ExpenseEntry>();
  for (const entry of state.entries) {
    if (entry.kind === 'expense') byId.set(entry.entryId, entry);
  }
  const start = byId.get(expenseEntryId);
  if (start === undefined) return [];
  let root: ExpenseEntry = start;
  while (root.replacesEntryId !== null) {
    const parent = byId.get(root.replacesEntryId);
    if (parent === undefined) break;
    root = parent;
  }
  const family = new Map<EntryId, ExpenseEntry>([[root.entryId, root]]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of byId.values()) {
      if (entry.replacesEntryId !== null && family.has(entry.replacesEntryId) && !family.has(entry.entryId)) {
        family.set(entry.entryId, entry);
        grew = true;
      }
    }
  }
  return state.entries.filter((entry): entry is ExpenseEntry => entry.kind === 'expense' && family.has(entry.entryId));
}

/**
 * Effective (live) refunds across an expense's whole correction family:
 * earlier refunds count against the current replacement, and reversed
 * returns stop counting. Shared by return caps, correction guards, and
 * availability.
 */
export function effectiveFamilyRefunds(state: BookState, expenseEntryId: EntryId): MoneyResult {
  const familyIds = new Set(expenseCorrectionFamily(state, expenseEntryId).map((entry) => entry.entryId));
  const parts: Money[] = [];
  for (const entry of state.entries) {
    if (
      entry.kind === 'expenseReturn' &&
      entry.linkedExpenseEntryId !== null &&
      familyIds.has(entry.linkedExpenseEntryId) &&
      isExpenseReturnLive(state, entry.entryId)
    ) {
      parts.push(entry.amount);
    }
  }
  if (parts.length === 0) {
    const family = expenseCorrectionFamily(state, expenseEntryId);
    const currency = family.length > 0 ? family[0].amount.currency : state.book.currency;
    return { ok: true, value: { currency, minorUnits: 0 } };
  }
  const summed = sumMoney(parts as [Money, ...Money[]]);
  if (!summed.ok) return summed;
  return { ok: true, value: summed.value };
}

/**
 * What can still be returned against a live expense: its amount minus
 * effective (live) refunds across its whole correction family. Returns are
 * actual money, so the sum of effective returns can approach but never
 * exceed the live replacement's amount.
 */
export function returnableAmountForExpense(state: BookState, expense: ExpenseEntry): MoneyResult {
  const refunds = effectiveFamilyRefunds(state, expense.entryId);
  if (!refunds.ok) return refunds;
  return subtractMoney(expense.amount, refunds.value);
}

/**
 * Signed effective return amounts for availability: every live return counts
 * positively. Reversal entries exist only to mark their target dead — they
 * are never summed themselves, or the cancelled refund would subtract twice.
 */
export function effectiveReturnAmounts(state: BookState): readonly Money[] {
  const parts: Money[] = [];
  for (const entry of state.entries) {
    if (entry.kind === 'expenseReturn' && isExpenseReturnLive(state, entry.entryId)) {
      parts.push(entry.amount);
    }
  }
  return parts;
}
