/**
 * Canonical book, cycle, and ledger records for the P03 finance engine.
 *
 * Entities are immutable typed records: corrections append linked facts, they
 * never overwrite history. Task A introduced books, open cycles, inflows, and
 * linked inflow reversals. Task B extends the ledger with actual expense
 * movement (expenses, linked expense reversals, and expense returns), and
 * adds expected obligations with append-only lifecycle events, goal records,
 * tracked-allocation records, and the explicit buffer setting. Task C adds
 * cycle versions (rebase/close/reopen), Reality Check observations with
 * boundary-specific signed adjustments and recovery links, effective-dated
 * recurring plans with stable occurrences, versioned settings revisions, and
 * immutable settlements with explicit carry/disposition and propagation
 * records.
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
  CycleVersionId,
  EntryId,
  GoalId,
  ObligationId,
  ObservationId,
  OccurrenceId,
  OperationId,
  PlanId,
  SettlementId,
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
 * One version of one logical cycle.
 *
 * The logical cycle identity stays deterministic (`composeCycleId` over the
 * book and the anchor window start). Rebase, settlement, and reopen mint new
 * `versionId` values in a separate `cycver:` namespace so version identities
 * can never collide with logical cycle identities.
 *
 * Versions are append-only and never mutated: a rebase or reopen appends a
 * new version record with `supersedesVersionId` pointing at its predecessor,
 * and a close appends a settlement snapshot referencing the closed version.
 * A version's effective status is derived, never stored: settled versions
 * are closed, versions named by another version's `supersedesVersionId` are
 * superseded, and the unsettled latest version of a logical cycle is open.
 * At most one version per book is effectively open. A
 * `remainingFromBoundary` version starts mid-cycle at a named observed pool;
 * activity dated at or before its boundary improves history without
 * subtracting again from the starting pool unless the boundary is
 * explicitly rebased. The settlement carries the close time; versions carry
 * no mutable lifecycle flags.
 *
 * `OpenCycleRecord` is kept as an alias so Task A/B readers keep working;
 * every version shares the shape and only effectively-open versions act.
 */
export interface CycleRecord {
  readonly versionId: CycleVersionId;
  /** Logical cycle identity, deterministic per book and window start. */
  readonly cycleId: CycleId;
  readonly bookId: BookId;
  /** Monotonic per logical cycle, starting at 1. */
  readonly versionSeq: number;
  readonly mode: 'fullCycle' | 'remainingFromBoundary';
  /** Inclusive first day of this version's window. */
  readonly startDate: CivilDate;
  /** Exclusive first day after this version's window. */
  readonly endDateExclusive: CivilDate;
  readonly anchor: MonthlyCycleAnchor;
  /** Governing timezone of this version (effective settings at its start). */
  readonly timeZone: TimeZoneName;
  /** Full-cycle starting pool, or the named observed pool for a boundary. */
  readonly startingFunds: Money;
  readonly openedAtInstantMs: number;
  /** Set for `remainingFromBoundary` versions only. */
  readonly boundaryObservedPool: Money | null;
  readonly boundaryLocalDate: CivilDate | null;
  /** `HH:MM:SS` wall time in `boundaryTimeZone` for civil boundaries. */
  readonly boundaryLocalTime: string | null;
  readonly boundaryInstantMs: number | null;
  readonly boundaryTimeZone: TimeZoneName | null;
  readonly supersedesVersionId: CycleVersionId | null;
}

export type OpenCycleRecord = CycleRecord;

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
  /**
   * The financial occurrence instant when the command named one
   * (`occurredAt` kind `instant`); null when it named a civil date.
   * Ordering against observed boundaries uses this instant (or the local
   * date), never append order or `capturedAtInstantMs`.
   */
  readonly occurredAtInstantMs: number | null;
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
  /**
   * The financial occurrence instant when the command named one
   * (`occurredAt` kind `instant`); null when it named a civil date.
   * Ordering against observed boundaries uses this instant (or the local
   * date), never append order or `capturedAtInstantMs`.
   */
  readonly occurredAtInstantMs: number | null;
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
  /**
   * The financial occurrence instant when the command named one
   * (`occurredAt` kind `instant`); null when it named a civil date.
   * Ordering against observed boundaries uses this instant (or the local
   * date), never append order or `capturedAtInstantMs`.
   */
  readonly occurredAtInstantMs: number | null;
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
  /**
   * The financial occurrence instant when the command named one
   * (`occurredAt` kind `instant`); null when it named a civil date.
   * Ordering against observed boundaries uses this instant (or the local
   * date), never append order or `capturedAtInstantMs`.
   */
  readonly occurredAtInstantMs: number | null;
  readonly capturedAtInstantMs: number;
  readonly capturedInTimeZone: TimeZoneName;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/**
 * Actual money received back. An expected refund never creates this record;
 * only real receipts do. A return is linked either to a specific expense or
 * to an obligation (covering its payments, e.g. a chargeback). A corrected
 * return carries `replacesReturnEntryId`; the original return stays immutable
 * and its linked reversal cancels it.
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
  /** Set when this return is the replacement of a linked return correction. */
  readonly replacesReturnEntryId: EntryId | null;
  readonly note: string;
  /**
   * The financial occurrence instant when the command named one
   * (`occurredAt` kind `instant`); null when it named a civil date.
   * Ordering against observed boundaries uses this instant (or the local
   * date), never append order or `capturedAtInstantMs`.
   */
  readonly occurredAtInstantMs: number | null;
  readonly capturedAtInstantMs: number;
  readonly capturedInTimeZone: TimeZoneName;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/**
 * A linked reversal of a return: a new fact whose amount negates the
 * original return (the money did not actually come back). Corrections never
 * mutate or delete the original return; an optional replacement return is
 * appended atomically in the same command.
 */
export interface ExpenseReturnReversalEntry {
  readonly kind: 'expenseReturnReversal';
  readonly entryId: EntryId;
  readonly bookId: BookId;
  readonly cycleId: CycleId;
  readonly localDate: CivilDate;
  readonly timeZone: TimeZoneName;
  /** Negated copy of the reversed return amount. */
  readonly amount: Money;
  readonly reversesEntryId: EntryId;
  readonly linkedExpenseEntryId: EntryId | null;
  readonly linkedObligationId: ObligationId | null;
  readonly note: string;
  /**
   * The financial occurrence instant when the command named one
   * (`occurredAt` kind `instant`); null when it named a civil date.
   * Ordering against observed boundaries uses this instant (or the local
   * date), never append order or `capturedAtInstantMs`.
   */
  readonly occurredAtInstantMs: number | null;
  readonly capturedAtInstantMs: number;
  readonly capturedInTimeZone: TimeZoneName;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

export type LedgerEntry = InflowEntry | InflowReversalEntry | ExpenseEntry | ExpenseReversalEntry | ExpenseReturnEntry | ExpenseReturnReversalEntry;

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
  | { readonly type: 'disputeResolved'; readonly via: 'finalSettlement' | 'cancellation' | 'explicitResolution' }
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
  /**
   * The financial occurrence instant when the command named one; null for
   * assignment/unassignment (which carry no financial date) and for
   * civil-date funding/release facts.
   */
  readonly occurredAtInstantMs: number | null;
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
  readonly cycles: readonly CycleRecord[];
  readonly entries: readonly LedgerEntry[];
  readonly obligations: readonly ObligationRecord[];
  readonly obligationEvents: readonly ObligationEvent[];
  readonly goals: readonly GoalRecord[];
  readonly allocationRecords: readonly AllocationRecord[];
  readonly buffer: BufferSetting | null;
  /** Reality Check observation boundaries, one per accepted check. */
  readonly observations: readonly RealityCheckObservation[];
  /** Boundary-specific signed adjustments; residuals derive via links. */
  readonly adjustments: readonly ReconciliationAdjustment[];
  /** Links from recovered actuals to the boundary they explain. */
  readonly recoveryLinks: readonly RecoveryLink[];
  /** Recurring plan definitions (monthly rules at launch). */
  readonly plans: readonly RecurringPlan[];
  /** Immutable effective-dated plan revisions. */
  readonly planRevisions: readonly PlanRevision[];
  /** Stable managed occurrences with revision attribution. */
  readonly planOccurrences: readonly PlanOccurrence[];
  /** Versioned timezone/payday decisions with explicit effective dates. */
  readonly settingsRevisions: readonly BookSettingsRevision[];
  /** Immutable settlement snapshots, one per closed version. */
  readonly settlements: readonly CycleSettlement[];
  /** Explicit carry/allocation dispositions from named settlements. */
  readonly carryActions: readonly CarryAction[];
  /** Exact linked deltas propagated from backdated corrections. */
  readonly propagationDeltas: readonly PropagationDelta[];
  /** Unresolved downstream conflicts awaiting explicit resolution. */
  readonly propagationConflicts: readonly PropagationConflict[];
  /** Explicit append-only decisions on propagation conflicts. */
  readonly conflictResolutions: readonly ConflictResolution[];
}

/**
 * One accepted Reality Check: the full amount physically left in the tracked
 * pool at the boundary, including money earmarked for goals and reserved for
 * unpaid obligations. The boundary is either an explicit instant or a civil
 * date plus wall time in the boundary timezone. Observations are never
 * ordinary cash transactions and never compare against availability.
 */
export interface RealityCheckObservation {
  readonly observationId: ObservationId;
  readonly bookId: BookId;
  readonly cycleId: CycleId;
  readonly versionId: CycleVersionId;
  /** Full physically-left pool in the book currency (no FX in version 1). */
  readonly observedPool: Money;
  readonly boundaryLocalDate: CivilDate;
  /** `HH:MM:SS` wall time in `boundaryTimeZone` for civil boundaries. */
  readonly boundaryLocalTime: string | null;
  readonly boundaryInstantMs: number | null;
  readonly boundaryTimeZone: TimeZoneName;
  /** Caller-supplied currency label when one was named; null when omitted. */
  readonly currencyLabel: string | null;
  readonly note: string;
  readonly capturedAtInstantMs: number;
  readonly capturedInTimeZone: TimeZoneName;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/**
 * The signed difference owned by one observation: observed pool minus the
 * ledger-derived pool at its boundary. Recovering pre-boundary activity
 * consumes this difference exactly once per linked actual; the consumable
 * remainder is derived (see `adjustmentResidual`), never stored, so later
 * corrections and reversals of recovered activity recompute it forward.
 */
export interface ReconciliationAdjustment {
  readonly adjustmentId: EntryId;
  readonly bookId: BookId;
  readonly cycleId: CycleId;
  readonly observationId: ObservationId;
  /** Signed book-currency difference: observed minus ledger-derived. */
  readonly amount: Money;
  /** Null means unclassified and keeps classification Needs Attention. */
  readonly classificationNote: string | null;
  readonly capturedAtInstantMs: number;
  readonly capturedInTimeZone: TimeZoneName;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/**
 * A recovered actual fact explained against one boundary. The linked entry
 * carries the real money movement; this record only attributes it, so the
 * boundary's residual can be derived without mutating the adjustment.
 */
export interface RecoveryLink {
  readonly linkId: EntryId;
  readonly bookId: BookId;
  readonly observationId: ObservationId;
  readonly adjustmentId: EntryId;
  readonly entryId: EntryId;
  readonly movementKind: 'expense' | 'inflow' | 'return';
  readonly capturedAtInstantMs: number;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/**
 * A monthly recurring plan definition. The definition holds identity and the
 * anchor snapshot; the money and schedule live in immutable revisions.
 */
export interface RecurringPlan {
  readonly planId: PlanId;
  readonly bookId: BookId;
  readonly name: string;
  /** Anchor snapshot used to attribute occurrences to due cycles. */
  readonly anchor: MonthlyCycleAnchor;
  /** Descriptive flexible-definition link; arithmetic-neutral. */
  readonly flexibleDefinitionId: string | null;
  readonly createdAtInstantMs: number;
  readonly createdInTimeZone: TimeZoneName;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/**
 * One immutable revision of a plan. Revisions take effect for occurrences
 * due on or after `effectiveDate`; paid and detached occurrences keep their
 * historical revision byte-for-byte.
 */
export interface PlanRevision {
  readonly revisionId: EntryId;
  readonly bookId: BookId;
  readonly planId: PlanId;
  readonly effectiveDate: CivilDate;
  /** Expected amount per occurrence in the book currency. */
  readonly amount: Money;
  /** Monthly schedule day (1-31); short months clamp explicitly. */
  readonly scheduleDay: number;
  readonly note: string;
  readonly capturedAtInstantMs: number;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/**
 * One stable occurrence of a plan. Identity is deterministic
 * (`occ:<planId>:<dueDate>` at materialization) and survives retries.
 * `revisionId` attributes the revision that last governed this occurrence;
 * paid and detached occurrences never change revision again.
 */
export interface PlanOccurrence {
  readonly occurrenceId: OccurrenceId;
  readonly bookId: BookId;
  readonly planId: PlanId;
  readonly revisionId: EntryId;
  readonly dueDate: CivilDate;
  readonly dueCycleId: CycleId;
  readonly state: 'managed' | 'detached';
  readonly linkedObligationId: ObligationId | null;
  readonly linkedExpenseEntryId: EntryId | null;
  readonly capturedAtInstantMs: number;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/**
 * A versioned timezone/payday/week-start decision. Creation facts on
 * `FinanceBook` never change; this record carries the explicit effective
 * date from which the new settings govern unopened cycles. Changing the
 * open cycle itself requires a separate previewed rebase command.
 * Week-start is display policy only (0 = Sunday through 6 = Saturday) and
 * never changes financial occurrence; null means unchanged.
 */
export interface BookSettingsRevision {
  readonly settingsRevisionId: EntryId;
  readonly bookId: BookId;
  /** The cycle start this revision takes effect from (anchor-aligned). */
  readonly effectiveDate: CivilDate;
  readonly timeZone: TimeZoneName;
  readonly cycleAnchor: MonthlyCycleAnchor;
  readonly weekStart: number | null;
  readonly note: string;
  readonly capturedAtInstantMs: number;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/**
 * One immutable settlement snapshot of a closed cycle version. Closing
 * snapshots funds, cash movement, signed reconciliation residuals,
 * still-reserved commitments, allocations, buffer, the signed
 * availability/shortfall, completeness, calculation version, and data-as-of
 * time. Snapshots are never mutated; later corrections propagate through
 * linked deltas or explicit conflicts.
 */
export interface CycleSettlement {
  readonly settlementId: SettlementId;
  readonly bookId: BookId;
  readonly cycleId: CycleId;
  readonly versionId: CycleVersionId;
  /** Monotonic per logical cycle: close 1, reclose 2, ... */
  readonly settlementSeq: number;
  /** True while this snapshot is the effective one for its version. */
  readonly reversed: boolean;
  readonly startingFunds: Money;
  readonly netInflows: Money;
  readonly netOutflows: Money;
  readonly netReturns: Money;
  readonly netAdjustments: Money;
  readonly carryIn: Money;
  readonly reservedCommitments: Money;
  readonly netAllocations: Money;
  readonly buffer: Money;
  readonly availability: Money;
  readonly poolCompleteness: string;
  readonly classificationCompleteness: string;
  readonly dataAsOfInstantMs: number;
  readonly calculationVersion: string;
  readonly closedAtInstantMs: number;
  readonly sourceOperationId: OperationId;
}

export type RemainderDisposition =
  | { readonly kind: 'carryIn'; readonly amount: Money; readonly destinationCycleId: CycleId }
  | { readonly kind: 'fundTracked'; readonly amount: Money }
  | { readonly kind: 'split'; readonly carryAmount: Money; readonly fundAmount: Money; readonly destinationCycleId: CycleId }
  | { readonly kind: 'leaveIndependent' };

/**
 * One explicit disposition of a named settlement's free remainder. A carry
 * source is consumed only once; a shortfall stays visible and moves only
 * through an explicit disposition. Dispositions never move money
 * automatically.
 */
export interface CarryAction {
  readonly carryId: EntryId;
  readonly bookId: BookId;
  readonly settlementId: SettlementId;
  readonly sourceCycleId: CycleId;
  readonly disposition: RemainderDisposition;
  readonly note: string;
  readonly capturedAtInstantMs: number;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/**
 * An exact linked delta from a backdated correction into a closed source
 * cycle. Deltas always join the settlement's effective remainder view. When
 * a carry to a downstream cycle already stood untouched, the delta carries
 * that action's identity and additionally adjusts the downstream carry
 * basis by exactly its signed amount (derivation, never a rewrite of the
 * carry row). Deltas created before any disposition only ever shaped the
 * remainder the disposition was sized from. The historical snapshot never
 * changes; the delta is the visible forward propagation.
 */
export interface PropagationDelta {
  readonly deltaId: EntryId;
  readonly bookId: BookId;
  readonly settlementId: SettlementId;
  readonly sourceCycleId: CycleId;
  readonly correctionEntryId: EntryId;
  /** The carry disposition standing when this delta was appended, if any. */
  readonly carryActionId: EntryId | null;
  /** Signed effect on the settlement remainder in the book currency. */
  readonly deltaAmount: Money;
  readonly note: string;
  readonly capturedAtInstantMs: number;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/**
 * A backdated correction that arrived after its downstream carry or tracked
 * allocation had already changed. The correction itself is always accepted
 * (history is never hidden); this record keeps the unpropagated intent
 * visible and degrades completeness until an explicit resolution, which is
 * itself an appended `ConflictResolution` record. The conflict row is never
 * mutated: effective resolution derives from the resolution family.
 */
export interface PropagationConflict {
  readonly conflictId: EntryId;
  readonly bookId: BookId;
  readonly settlementId: SettlementId;
  readonly sourceCycleId: CycleId;
  readonly correctionEntryId: EntryId;
  /** Signed amount that could not be propagated exactly. */
  readonly unpropagatedAmount: Money;
  readonly downstreamKind: 'carry' | 'trackedAllocation' | 'both';
  readonly note: string;
  readonly capturedAtInstantMs: number;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/**
 * An explicit decision on a propagation conflict. An acknowledgement carries
 * no monetary action: the downstream stands exactly as recorded and the
 * accepted correction stays recorded. The resolution is a visibility
 * decision — completeness recovers because a human reviewed the divergence
 * — never a money movement and never a rewrite of the conflict.
 */
export interface ConflictResolution {
  readonly resolutionId: EntryId;
  readonly bookId: BookId;
  readonly conflictId: EntryId;
  readonly settlementId: SettlementId;
  readonly resolution: 'acknowledgedDownstreamStands';
  readonly note: string;
  readonly capturedAtInstantMs: number;
  readonly calculationVersion: string;
  readonly sourceOperationId: OperationId;
}

/** Pure derived queries over BookState; handlers and tests share them. */

export type CycleVersionStatus = 'open' | 'closed' | 'superseded';

/**
 * The effective lifecycle status of a version, derived from append-only
 * records: a version referenced by a settlement is closed; a version named
 * by another version's `supersedesVersionId` (or shadowed by a higher
 * sequence) is superseded; otherwise the latest version is open. No version
 * row is ever mutated to record a transition.
 */
export function effectiveVersionStatus(state: BookState, version: CycleRecord): CycleVersionStatus {
  if (state.settlements.some((settlement) => settlement.versionId === version.versionId)) return 'closed';
  if (state.cycles.some((candidate) => candidate.supersedesVersionId === version.versionId)) return 'superseded';
  const latest = findEffectiveCycleVersion(state, version.cycleId);
  if (latest !== null && latest.versionId !== version.versionId) return 'superseded';
  return 'open';
}

export function findOpenCycle(state: BookState): CycleRecord | null {
  let best: CycleRecord | null = null;
  for (const cycle of state.cycles) {
    if (effectiveVersionStatus(state, cycle) !== 'open') continue;
    if (best === null || cycle.versionSeq > best.versionSeq) best = cycle;
  }
  return best;
}

/** The effective (highest-seq) version of one logical cycle, if any. */
export function findEffectiveCycleVersion(state: BookState, cycleId: CycleId): CycleRecord | null {
  let best: CycleRecord | null = null;
  for (const cycle of state.cycles) {
    if (cycle.cycleId !== cycleId) continue;
    if (best === null || cycle.versionSeq > best.versionSeq) best = cycle;
  }
  return best;
}

export function findCycleVersion(state: BookState, versionId: CycleVersionId): CycleRecord | null {
  return state.cycles.find((cycle) => cycle.versionId === versionId) ?? null;
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

export function findObservationById(state: BookState, observationId: ObservationId): RealityCheckObservation | null {
  return state.observations.find((observation) => observation.observationId === observationId) ?? null;
}

export function findAdjustmentByObservation(state: BookState, observationId: ObservationId): ReconciliationAdjustment | null {
  return state.adjustments.find((adjustment) => adjustment.observationId === observationId) ?? null;
}

export function findPlanById(state: BookState, planId: PlanId): RecurringPlan | null {
  return state.plans.find((plan) => plan.planId === planId) ?? null;
}

export function findOccurrenceById(state: BookState, occurrenceId: OccurrenceId): PlanOccurrence | null {
  return state.planOccurrences.find((occurrence) => occurrence.occurrenceId === occurrenceId) ?? null;
}

export function findSettlementById(state: BookState, settlementId: SettlementId): CycleSettlement | null {
  return state.settlements.find((settlement) => settlement.settlementId === settlementId) ?? null;
}

/** The effective (unreversed, highest-seq) settlement of a logical cycle. */
export function findEffectiveSettlement(state: BookState, cycleId: CycleId): CycleSettlement | null {
  let best: CycleSettlement | null = null;
  for (const settlement of state.settlements) {
    if (settlement.cycleId !== cycleId || settlement.reversed) continue;
    if (best === null || settlement.settlementSeq > best.settlementSeq) best = settlement;
  }
  return best;
}
