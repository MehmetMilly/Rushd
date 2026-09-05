/**
 * Canonical book, cycle, and ledger records for the P03 Task A foundation.
 *
 * Entities are immutable typed records: corrections append linked facts, they
 * never overwrite history. The records here are deliberately the minimum the
 * four Task A commands need; obligations, allocations, recovery, and cycle
 * close/reopen are later P03 tasks and will extend this file at their own
 * phase gates.
 *
 * Initialization semantics: a freshly created book is an empty state with
 * revision 1 — no cycles and no entries. Availability-style derivations do not
 * exist yet. Opening the first cycle is an explicit command that must state an
 * anchor-aligned start date and non-negative starting funds; nothing is
 * implied from an empty book.
 */

import type { CurrencyCode } from '../primitives/currency';
import type { Money } from '../primitives/money';
import type { CivilDate } from '../primitives/civil-date';
import type { TimeZoneName } from '../primitives/instant';
import type { MonthlyCycleAnchor } from '../primitives/monthly-cycle';
import type { BookId, CycleId, EntryId, OperationId } from './identity';

export interface FinanceBook {
  readonly id: BookId;
  readonly displayName: string;
  /** The book's single ISO currency; every amount in this book must match it. */
  readonly currency: CurrencyCode;
  readonly timeZone: TimeZoneName;
  readonly cycleAnchor: MonthlyCycleAnchor;
  readonly createdAtInstantMs: number;
  readonly createdAtLocalDate: CivilDate;
  readonly createdInTimeZone: TimeZoneName;
}

/**
 * Cycle close/carry/reopen and closed settlement versions arrive in a later
 * P03 task; only open full-cycle records exist in Task A.
 */
export interface OpenCycleRecord {
  readonly cycleId: CycleId;
  readonly bookId: BookId;
  readonly mode: 'fullCycle';
  readonly status: 'open';
  /** Inclusive first day; anchor-aligned by construction. */
  readonly startDate: CivilDate;
  /** Exclusive first day after the cycle. */
  readonly endDateExclusive: CivilDate;
  readonly anchor: MonthlyCycleAnchor;
  /** Non-negative full-cycle starting pool in the book currency. */
  readonly startingFunds: Money;
  readonly openedAtInstantMs: number;
}

export interface InflowEntry {
  readonly kind: 'inflow';
  readonly entryId: EntryId;
  readonly bookId: BookId;
  readonly cycleId: CycleId;
  readonly localDate: CivilDate;
  readonly timeZone: TimeZoneName;
  /** Strictly positive book-currency amount. */
  readonly amount: Money;
  readonly note: string;
  readonly capturedAtInstantMs: number;
  readonly capturedInTimeZone: TimeZoneName;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/**
 * A reversal is a new linked fact whose amount negates the original. The
 * original inflow entry is never mutated, so history stays immutable and the
 * effective effect is derived by scanning reversal facts.
 */
export interface InflowReversalEntry {
  readonly kind: 'inflowReversal';
  readonly entryId: EntryId;
  readonly bookId: BookId;
  readonly cycleId: CycleId;
  readonly localDate: CivilDate;
  readonly timeZone: TimeZoneName;
  /** Negated copy of the reversed inflow amount. */
  readonly amount: Money;
  readonly reversesEntryId: EntryId;
  readonly note: string;
  readonly capturedAtInstantMs: number;
  readonly capturedInTimeZone: TimeZoneName;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

export type LedgerEntry = InflowEntry | InflowReversalEntry;

export interface BookState {
  readonly book: FinanceBook;
  /**
   * Monotonic per-book revision. Every committed command produces exactly
   * revision + 1, so a preview taken at revision N is valid only while the
   * book is still at revision N. A new book starts at revision 1.
   */
  readonly revision: number;
  readonly cycles: readonly OpenCycleRecord[];
  readonly entries: readonly LedgerEntry[];
}

/** Pure derived queries over BookState; handlers and tests share them. */

export function findOpenCycle(state: BookState): OpenCycleRecord | null {
  return state.cycles.find((cycle) => cycle.status === 'open') ?? null;
}

export function findEntryById(state: BookState, entryId: EntryId): LedgerEntry | null {
  return state.entries.find((entry) => entry.entryId === entryId) ?? null;
}

export function findReversalOf(state: BookState, entryId: EntryId): InflowReversalEntry | null {
  return state.entries.find((entry): entry is InflowReversalEntry => entry.kind === 'inflowReversal' && entry.reversesEntryId === entryId) ?? null;
}
