/**
 * Canonical book, cycle, and ledger records for the P03 finance engine.
 *
 * Entities are immutable typed records: corrections append linked facts, they
 * never overwrite history. Task A introduced books, open cycles, inflows, and
 * linked inflow reversals. Task B extends the ledger with actual expense
 * movement (expenses, linked expense reversals, and expense returns), and
 * adds expected obligations with append-only lifecycle events, goal records,
 * tracked-allocation records, and the explicit buffer setting.
 *
 * Initialization semantics: a freshly created book is an empty state with
 * revision 1 — no cycles, entries, obligations, goals, or allocation records.
 * Opening the first cycle is an explicit command that must state an
 * anchor-aligned start date and non-negative starting funds; nothing is
 * implied from an empty book.
 */

import type { CurrencyCode } from '../primitives/currency';
import type { Money } from '../primitives/money';
import type { CivilDate } from '../primitives/civil-date';
import type { TimeZoneName } from '../primitives/instant';
import type { MonthlyCycleAnchor } from '../primitives/monthly-cycle';
import type {
  AllocationRecordId,
  BookId,
  CycleId,
  EntryId,
  GoalId,
  ObligationId,
  OperationId,
} from './identity';

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

/**
 * Actual money that left the pool. Payments against an obligation are
 * expenses with `linkedObligationId`; a correction replacement carries
 * `replacesEntryId`. Category and flexible-definition links describe the
 * movement for classification/monitoring only and never affect availability.
 */
export interface ExpenseEntry {
  readonly kind: 'expense';
  readonly entryId: EntryId;
  readonly bookId: BookId;
  readonly cycleId: CycleId;
  readonly localDate: CivilDate;
  readonly timeZone: TimeZoneName;
  /** Strictly positive book-currency amount that left the pool. */
  readonly amount: Money;
  readonly note: string;
  readonly category: string | null;
  readonly flexibleDefinitionId: string | null;
  readonly linkedObligationId: ObligationId | null;
  /** Set when this expense is the replacement of a linked correction. */
  readonly replacesEntryId: EntryId | null;
  readonly capturedAtInstantMs: number;
  readonly capturedInTimeZone: TimeZoneName;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/**
 * A linked reversal of an expense: a new fact whose amount negates the
 * original. Corrections never mutate or delete the original expense.
 */
export interface ExpenseReversalEntry {
  readonly kind: 'expenseReversal';
  readonly entryId: EntryId;
  readonly bookId: BookId;
  readonly cycleId: CycleId;
  readonly localDate: CivilDate;
  readonly timeZone: TimeZoneName;
  /** Negated copy of the reversed expense amount. */
  readonly amount: Money;
  readonly reversesEntryId: EntryId;
  readonly note: string;
  readonly capturedAtInstantMs: number;
  readonly capturedInTimeZone: TimeZoneName;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/**
 * Actual money received back. An expected refund never creates this record;
 * only real receipts do. A return is linked either to a specific expense or
 * to an obligation (covering its payments, e.g. a chargeback).
 */
export interface ExpenseReturnEntry {
  readonly kind: 'expenseReturn';
  readonly entryId: EntryId;
  readonly bookId: BookId;
  readonly cycleId: CycleId;
  readonly localDate: CivilDate;
  readonly timeZone: TimeZoneName;
  /** Strictly positive book-currency amount received back. */
  readonly amount: Money;
  readonly linkedExpenseEntryId: EntryId | null;
  readonly linkedObligationId: ObligationId | null;
  readonly note: string;
  readonly capturedAtInstantMs: number;
  readonly capturedInTimeZone: TimeZoneName;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

export type LedgerEntry = InflowEntry | InflowReversalEntry | ExpenseEntry | ExpenseReversalEntry | ExpenseReturnEntry;

/**
 * An expected commitment, kept strictly separate from actual money movement.
 * Creating it reserves intent, not money movement; its cycleId is the due
 * cycle at creation and never moves. Status changes are appended as
 * `ObligationEvent` facts; this record itself is never mutated.
 */
export interface ObligationRecord {
  readonly kind: 'obligation';
  readonly obligationId: ObligationId;
  readonly bookId: BookId;
  readonly cycleId: CycleId;
  /** Strictly positive expected amount in the book currency. */
  readonly expectedAmount: Money;
  readonly note: string;
  readonly category: string | null;
  readonly createdAtInstantMs: number;
  readonly createdInTimeZone: TimeZoneName;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

export type ObligationChange =
  | { readonly type: 'finalSettlement' }
  | { readonly type: 'cancellation' }
  | { readonly type: 'reopening' }
  | { readonly type: 'disputeOpened' }
  | { readonly type: 'disputeResolved'; readonly via: 'return' | 'finalSettlement' | 'cancellation' | 'reopening' }
  | { readonly type: 'residualReleased' };

/**
 * An append-only lifecycle fact for an obligation: settlement, cancellation,
 * reopening, dispute overlay changes, or a previewed disputed-residual
 * release that records unresolved uncertainty. History is never overwritten.
 */
export interface ObligationEvent {
  readonly kind: 'obligationEvent';
  readonly eventId: EntryId;
  readonly bookId: BookId;
  readonly obligationId: ObligationId;
  readonly change: ObligationChange;
  readonly note: string;
  readonly capturedAtInstantMs: number;
  readonly capturedInTimeZone: TimeZoneName;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/** A goal records identity and target only; funding is attributed separately. */
export interface GoalRecord {
  readonly kind: 'goal';
  readonly goalId: GoalId;
  readonly bookId: BookId;
  readonly name: string;
  /** Strictly positive target in the book currency; progress is derived. */
  readonly targetAmount: Money;
  readonly createdAtInstantMs: number;
  readonly createdInTimeZone: TimeZoneName;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

export type AllocationChange =
  | { readonly type: 'funding'; readonly amount: Money }
  | { readonly type: 'assignment'; readonly goalId: GoalId; readonly amount: Money }
  | { readonly type: 'unassignment'; readonly goalId: GoalId; readonly amount: Money }
  | {
      readonly type: 'release';
      readonly goalId: GoalId | null;
      readonly amount: Money;
      readonly destinationCycleId: CycleId;
    }
  | { readonly type: 'reversal'; readonly reversesRecordId: AllocationRecordId };

/**
 * A tracked-allocation fact. Funding moves spendable money into the tracked
 * pool exactly once; assignment divides already-funded money among goals with
 * no second availability effect; release returns money to one explicitly
 * named destination cycle exactly once. Reversals append a linked inverse
 * record. `localDate` is the financial date for funding/release (null for
 * assignment/unassignment, which have no availability effect).
 */
export interface AllocationRecord {
  readonly kind: 'allocation';
  readonly recordId: AllocationRecordId;
  readonly bookId: BookId;
  readonly cycleId: CycleId;
  readonly localDate: CivilDate | null;
  readonly change: AllocationChange;
  readonly note: string;
  readonly capturedAtInstantMs: number;
  readonly capturedInTimeZone: TimeZoneName;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/**
 * The explicit buffer reservation held back from availability. Replaced (not
 * accumulated) by each previewed `setBuffer` command; the operation journal
 * preserves the history of changes.
 */
export interface BufferSetting {
  readonly amount: Money;
  readonly sourceOperationId: OperationId;
  readonly updatedAtInstantMs: number;
  readonly calculationVersion: string;
}

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
  readonly obligations: readonly ObligationRecord[];
  readonly obligationEvents: readonly ObligationEvent[];
  readonly goals: readonly GoalRecord[];
  readonly allocationRecords: readonly AllocationRecord[];
  readonly buffer: BufferSetting | null;
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

export function findObligationById(state: BookState, obligationId: ObligationId): ObligationRecord | null {
  return state.obligations.find((obligation) => obligation.obligationId === obligationId) ?? null;
}

export function findGoalById(state: BookState, goalId: GoalId): GoalRecord | null {
  return state.goals.find((goal) => goal.goalId === goalId) ?? null;
}

export function findAllocationRecordById(state: BookState, recordId: AllocationRecordId): AllocationRecord | null {
  return state.allocationRecords.find((record) => record.recordId === recordId) ?? null;
}
