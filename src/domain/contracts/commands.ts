/**
 * Typed commands, previews, receipts, failures, and outbox envelopes.
 *
 * Commands are runtime-validated discriminated unions: nothing from the UI,
 * import, sync, or an AI proposal may reach a handler without passing
 * `validateFinanceCommand`, so unknown fields and malformed data cannot slip
 * through a TypeScript cast.
 *
 * Reversal policy is declared per command kind in `COMMAND_REVERSAL_POLICY`:
 * reversals append linked facts, they never delete original history.
 *
 * Confirmation is an application policy for preview binding and retry
 * identity. It is not a credential: book IDs, actor metadata, and operation
 * IDs imply no implemented cloud authorization. P08 must enforce ownership on
 * the server independently.
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
import type { AllocationChange } from './ledger';
import type { DeviceId, RepositoryScopeId } from '../sync/scope';

/** The change types an allocation record can carry. */
export type AllocationChangeType = AllocationChange['type'];

export type CommandKind =
  | 'createBook'
  | 'openCycle'
  | 'recordInflow'
  | 'reverseInflow'
  | 'recordExpense'
  | 'correctExpense'
  | 'recordExpenseReturn'
  | 'correctExpenseReturn'
  | 'createObligation'
  | 'recordObligationPayment'
  | 'recordObligationReturn'
  | 'settleObligationFinally'
  | 'cancelObligation'
  | 'reopenObligation'
  | 'openObligationDispute'
  | 'resolveObligationDispute'
  | 'releaseDisputedResidual'
  | 'createGoal'
  | 'fundAllocationPool'
  | 'assignToGoal'
  | 'unassignFromGoal'
  | 'releaseAllocation'
  | 'reverseAllocationRecord'
  | 'setBuffer'
  | 'openBoundaryCycle'
  | 'recordRealityCheck'
  | 'recoverObservedActivity'
  | 'createRecurringPlan'
  | 'reviseRecurringPlan'
  | 'materializePlanOccurrences'
  | 'detachPlanOccurrence'
  | 'reservePlanOccurrence'
  | 'updateBookSettings'
  | 'rebaseOpenCycle'
  | 'closeCycle'
  | 'disposeCycleRemainder'
  | 'reopenCycle'
  | 'recordClosedCycleCorrection'
  | 'resolvePropagationConflict';

export interface CreateBookCommand {
  readonly kind: 'createBook';
  readonly bookId: BookId;
  readonly displayName: string;
  readonly currency: CurrencyCode;
  readonly timeZone: TimeZoneName;
  readonly cycleAnchor: MonthlyCycleAnchor;
}

export interface OpenCycleCommand {
  readonly kind: 'openCycle';
  readonly bookId: BookId;
  /** Non-negative starting pool; an empty book implies nothing. */
  readonly startingFunds: Money;
  /** Must equal the anchor-derived cycle start of its own month. */
  readonly startDate: CivilDate;
}

/**
 * The financial date a fact is attributed to: either the caller names the
 * civil date, or names an instant that is resolved in the book timezone at
 * apply time. The bound value is part of the canonical payload, so the
 * confirmed financial date cannot drift between preview and execution.
 */
export type OccurredAt =
  | { readonly kind: 'civilDate'; readonly localDate: CivilDate }
  | { readonly kind: 'instant'; readonly instantMs: number };

export interface RecordInflowCommand {
  readonly kind: 'recordInflow';
  readonly bookId: BookId;
  /** Strictly positive book-currency amount. */
  readonly amount: Money;
  readonly occurredAt: OccurredAt;
  readonly note: string;
}

export interface ReverseInflowCommand {
  readonly kind: 'reverseInflow';
  readonly bookId: BookId;
  readonly inflowEntryId: EntryId;
  /**
   * The reversal's effective occurrence: the financial date the reversal is
   * attributed to, subject to open-cycle validation. Capture timestamps still
   * reflect execution time, but this confirmed date does not move with the
   * clock between preview and execution.
   */
  readonly occurredAt: OccurredAt;
  readonly note: string;
}

export interface RecordExpenseCommand {
  readonly kind: 'recordExpense';
  readonly bookId: BookId;
  /** Strictly positive book-currency amount that left the pool. */
  readonly amount: Money;
  readonly occurredAt: OccurredAt;
  readonly note: string;
  /** Descriptive only; never affects availability. */
  readonly category: string | null;
  /** Descriptive flexible-plan link; never affects availability. */
  readonly flexibleDefinitionId: string | null;
}

/**
 * A linked correction of a paid expense: appends a reversal fact and, when a
 * replacement is supplied, its replacement expense atomically in one command.
 * Unspecified replacement fields carry over from the original; an explicit
 * `null` category/flexibleDefinitionId clears the link.
 */
export interface CorrectExpenseCommand {
  readonly kind: 'correctExpense';
  readonly bookId: BookId;
  readonly expenseEntryId: EntryId;
  /** The correction's own financial date (both facts are validated on it). */
  readonly occurredAt: OccurredAt;
  readonly note: string;
  readonly replacement: {
    readonly amount?: Money;
    readonly localDate?: CivilDate;
    readonly note?: string;
    readonly category?: string | null;
    readonly flexibleDefinitionId?: string | null;
  } | null;
}

export interface RecordExpenseReturnCommand {
  readonly kind: 'recordExpenseReturn';
  readonly bookId: BookId;
  readonly expenseEntryId: EntryId;
  /** Strictly positive book-currency amount actually received back. */
  readonly amount: Money;
  readonly occurredAt: OccurredAt;
  readonly note: string;
}

/**
 * A linked correction of a return: appends a reversal fact and, when a
 * replacement is supplied, its replacement return atomically in one command.
 * The original return is never mutated. The replacement inherits the
 * original's link (expense or obligation); the refund allowance is computed
 * across the whole correction family, so a new ID never resets it.
 */
export interface CorrectExpenseReturnCommand {
  readonly kind: 'correctExpenseReturn';
  readonly bookId: BookId;
  readonly returnEntryId: EntryId;
  /** The correction's own financial date (both facts are validated on it). */
  readonly occurredAt: OccurredAt;
  readonly note: string;
  readonly replacement: {
    readonly amount: Money;
    readonly localDate?: CivilDate;
    readonly note?: string;
  } | null;
}

export interface CreateObligationCommand {
  readonly kind: 'createObligation';
  readonly bookId: BookId;
  /** Caller-supplied stable identity, so retries and sync dedupe cleanly. */
  readonly obligationId: ObligationId;
  /** Strictly positive expected amount; reserves intent, not money movement. */
  readonly expectedAmount: Money;
  readonly note: string;
  readonly category: string | null;
}

export interface RecordObligationPaymentCommand {
  readonly kind: 'recordObligationPayment';
  readonly bookId: BookId;
  readonly obligationId: ObligationId;
  /** Strictly positive book-currency amount actually paid. */
  readonly amount: Money;
  readonly occurredAt: OccurredAt;
  readonly note: string;
  readonly category: string | null;
}

export interface RecordObligationReturnCommand {
  readonly kind: 'recordObligationReturn';
  readonly bookId: BookId;
  readonly obligationId: ObligationId;
  /** Strictly positive book-currency amount actually received back. */
  readonly amount: Money;
  readonly occurredAt: OccurredAt;
  readonly note: string;
}

export interface SettleObligationFinallyCommand {
  readonly kind: 'settleObligationFinally';
  readonly bookId: BookId;
  readonly obligationId: ObligationId;
  readonly note: string;
}

export interface CancelObligationCommand {
  readonly kind: 'cancelObligation';
  readonly bookId: BookId;
  readonly obligationId: ObligationId;
  readonly note: string;
}

export interface ReopenObligationCommand {
  readonly kind: 'reopenObligation';
  readonly bookId: BookId;
  readonly obligationId: ObligationId;
  readonly note: string;
}

export interface OpenObligationDisputeCommand {
  readonly kind: 'openObligationDispute';
  readonly bookId: BookId;
  readonly obligationId: ObligationId;
  readonly note: string;
}

export type DisputeResolutionReason = 'returnReceived' | 'adjustedExternally' | 'notOwed' | 'other';

/**
 * Explicit, confirmed resolution of an open dispute. Plain refunds and
 * reopenings never resolve the overlay; this command (or an explicit final
 * settlement/cancellation whose preview describes the effect) does. When the
 * reason is `returnReceived`, the linked return must exist and belong to
 * this obligation; otherwise no link may be supplied.
 */
export interface ResolveObligationDisputeCommand {
  readonly kind: 'resolveObligationDispute';
  readonly bookId: BookId;
  readonly obligationId: ObligationId;
  readonly resolution: DisputeResolutionReason;
  readonly linkedReturnEntryId: EntryId | null;
  readonly note: string;
}

/**
 * Previewed release of an open disputed obligation's unpaid residual. It
 * records unresolved uncertainty: the money never came back, so completeness
 * degrades until a real return, payment, or settlement resolves it.
 */
export interface ReleaseDisputedResidualCommand {
  readonly kind: 'releaseDisputedResidual';
  readonly bookId: BookId;
  readonly obligationId: ObligationId;
  readonly note: string;
}

export interface CreateGoalCommand {
  readonly kind: 'createGoal';
  readonly bookId: BookId;
  readonly goalId: GoalId;
  readonly name: string;
  /** Strictly positive target in the book currency. */
  readonly targetAmount: Money;
}

export interface FundAllocationPoolCommand {
  readonly kind: 'fundAllocationPool';
  readonly bookId: BookId;
  /** Strictly positive amount moved from spendable into the tracked pool. */
  readonly amount: Money;
  readonly occurredAt: OccurredAt;
  readonly note: string;
}

export interface AssignToGoalCommand {
  readonly kind: 'assignToGoal';
  readonly bookId: BookId;
  readonly goalId: GoalId;
  /** Strictly positive amount of already-funded tracked money. */
  readonly amount: Money;
  readonly note: string;
}

export interface UnassignFromGoalCommand {
  readonly kind: 'unassignFromGoal';
  readonly bookId: BookId;
  readonly goalId: GoalId;
  /** Strictly positive amount returned to tracked-unallocated. */
  readonly amount: Money;
  readonly note: string;
}

export interface ReleaseAllocationCommand {
  readonly kind: 'releaseAllocation';
  readonly bookId: BookId;
  /** Null releases from tracked-unallocated; a goal releases from that goal. */
  readonly goalId: GoalId | null;
  /** Strictly positive amount returned to spending exactly once. */
  readonly amount: Money;
  /** The named cycle the money returns to as spendable funds. */
  readonly destinationCycleId: CycleId;
  readonly occurredAt: OccurredAt;
  readonly note: string;
}

export interface ReverseAllocationRecordCommand {
  readonly kind: 'reverseAllocationRecord';
  readonly bookId: BookId;
  readonly allocationRecordId: AllocationRecordId;
  readonly note: string;
}

export interface SetBufferCommand {
  readonly kind: 'setBuffer';
  readonly bookId: BookId;
  /** Non-negative book-currency buffer; zero clears it. */
  readonly buffer: Money;
  readonly note: string;
}

/**
 * An observation boundary: either an explicit instant (resolved in the
 * boundary timezone at apply time) or a civil date plus `HH:MM:SS` wall time
 * in the boundary timezone.
 */
export type ObservationBoundary =
  | { readonly kind: 'instant'; readonly instantMs: number }
  | { readonly kind: 'civilDateTime'; readonly localDate: CivilDate; readonly localTime: string };

/**
 * Opens a `remaining-from-boundary` cycle starting mid-cycle at a named
 * observed pool. Pre-boundary activity improves history without subtracting
 * again from the starting pool; post-boundary movement changes it normally.
 */
export interface OpenBoundaryCycleCommand {
  readonly kind: 'openBoundaryCycle';
  readonly bookId: BookId;
  /** Non-negative physically-left pool at the boundary, in book currency. */
  readonly observedPool: Money;
  readonly boundary: ObservationBoundary;
  readonly note: string;
}

/**
 * An explicit Reality Check against the open cycle: the caller names the
 * full amount physically left in the tracked pool (including goal-earmarked
 * and obligation-reserved money) and Rushd derives the signed reconciliation
 * adjustment against the ledger-derived pool at the boundary. A mismatched
 * currency or ambiguous ordering evidence is a typed clarification, never a
 * reinterpretation.
 */
export interface RecordRealityCheckCommand {
  readonly kind: 'recordRealityCheck';
  readonly bookId: BookId;
  /** Non-negative physically-left pool in the book currency. */
  readonly observedPool: Money;
  readonly boundary: ObservationBoundary;
  /** Optional caller-named currency label; ambiguous labels clarify. */
  readonly currencyLabel: string | null;
  /** Null means the resulting adjustment stays unclassified. */
  readonly classificationNote: string | null;
  readonly note: string;
}

/**
 * Recovers one forgotten activity dated at or before a named boundary. The
 * command atomically appends the actual fact (in the observation's cycle)
 * and links it to that boundary's adjustment, consuming the unexplained
 * difference exactly once. Same-date civil-date recoveries without instant
 * evidence clarify instead of guessing.
 */
export interface RecoverObservedActivityCommand {
  readonly kind: 'recoverObservedActivity';
  readonly bookId: BookId;
  readonly observationId: ObservationId;
  readonly movementKind: 'expense' | 'inflow' | 'return';
  /** Strictly positive book-currency amount. */
  readonly amount: Money;
  readonly occurredAt: OccurredAt;
  readonly note: string;
  /** Descriptive only; never affects availability. */
  readonly category: string | null;
  /** Required when `movementKind` is `return` (the refunded expense). */
  readonly linkedExpenseEntryId: EntryId | null;
}

/** Defines a monthly recurring plan starting at `effectiveDate`. */
export interface CreateRecurringPlanCommand {
  readonly kind: 'createRecurringPlan';
  readonly bookId: BookId;
  /** Caller-supplied stable identity, so retries and sync dedupe cleanly. */
  readonly planId: PlanId;
  readonly name: string;
  /** Strictly positive expected amount per occurrence. */
  readonly amount: Money;
  /** Monthly schedule day 1-31; short months clamp explicitly. */
  readonly scheduleDay: number;
  readonly effectiveDate: CivilDate;
  /** Descriptive flexible-definition link; arithmetic-neutral. */
  readonly flexibleDefinitionId: string | null;
}

/** Appends an immutable revision; future unpaid managed occurrences follow. */
export interface ReviseRecurringPlanCommand {
  readonly kind: 'reviseRecurringPlan';
  readonly bookId: BookId;
  readonly planId: PlanId;
  readonly effectiveDate: CivilDate;
  /** Strictly positive expected amount per occurrence. */
  readonly amount: Money;
  /** Monthly schedule day 1-31; short months clamp explicitly. */
  readonly scheduleDay: number;
  readonly note: string;
}

/** Idempotently materializes stable occurrences through `throughDate`. */
export interface MaterializePlanOccurrencesCommand {
  readonly kind: 'materializePlanOccurrences';
  readonly bookId: BookId;
  readonly planId: PlanId;
  readonly throughDate: CivilDate;
}

/** Detaches a managed occurrence before manual editing; irreversible. */
export interface DetachPlanOccurrenceCommand {
  readonly kind: 'detachPlanOccurrence';
  readonly bookId: BookId;
  readonly occurrenceId: OccurrenceId;
  readonly note: string;
}

/**
 * Reserves a managed occurrence by creating its obligation. Paying that
 * obligation later creates actual movement in the payment's occurrence
 * cycle while the expectation retains its original due-cycle identity.
 */
export interface ReservePlanOccurrenceCommand {
  readonly kind: 'reservePlanOccurrence';
  readonly bookId: BookId;
  readonly occurrenceId: OccurrenceId;
  /** Caller-supplied stable obligation identity. */
  readonly obligationId: ObligationId;
  readonly note: string;
}

/**
 * A versioned timezone/payday/week-start decision. By default it governs the
 * next unopened cycle only: existing actuals keep their captured dates and
 * closed cycles never move. At least one of `timeZone`/`cycleAnchor`/
 * `weekStart` must change. Week-start is display policy (0 = Sunday through
 * 6 = Saturday) and never changes financial occurrence.
 */
export interface UpdateBookSettingsCommand {
  readonly kind: 'updateBookSettings';
  readonly bookId: BookId;
  readonly timeZone: TimeZoneName | null;
  readonly cycleAnchor: MonthlyCycleAnchor | null;
  readonly weekStart: number | null;
  /** The cycle start the new settings take effect from (anchor-aligned). */
  readonly effectiveDate: CivilDate;
  readonly note: string;
}

/**
 * A separate previewed command that moves the open cycle onto new settings.
 * It supersedes the prior version (closing its boundary state), creates a
 * new version/boundary, and reports every carry/allocation delta. Captured
 * facts are never re-dated.
 */
export interface RebaseOpenCycleCommand {
  readonly kind: 'rebaseOpenCycle';
  readonly bookId: BookId;
  readonly timeZone: TimeZoneName;
  readonly cycleAnchor: MonthlyCycleAnchor;
  readonly note: string;
}

/** Closes the open cycle version with one immutable settlement snapshot. */
export interface CloseCycleCommand {
  readonly kind: 'closeCycle';
  readonly bookId: BookId;
  /** Null means the currently open version's logical cycle. */
  readonly cycleId: CycleId | null;
  readonly note: string;
}

export type RemainderDispositionInput =
  | { readonly kind: 'carryIn'; readonly amount: Money; readonly destinationCycleId: CycleId }
  | { readonly kind: 'fundTracked'; readonly amount: Money }
  | { readonly kind: 'split'; readonly carryAmount: Money; readonly fundAmount: Money; readonly destinationCycleId: CycleId }
  | { readonly kind: 'leaveIndependent' };

/**
 * An explicit confirmed disposition of a named settlement's free remainder:
 * carry-in to a named cycle, tracked-allocation funding, an explicit split,
 * or leaving the next cycle independent. The source is consumed only once.
 */
export interface DisposeCycleRemainderCommand {
  readonly kind: 'disposeCycleRemainder';
  readonly bookId: BookId;
  readonly settlementId: SettlementId;
  readonly disposition: RemainderDispositionInput;
  readonly note: string;
}

/** Reopens a closed cycle: reverses its settlement, opens a new version. */
export interface ReopenCycleCommand {
  readonly kind: 'reopenCycle';
  readonly bookId: BookId;
  readonly cycleId: CycleId;
  readonly note: string;
}

/**
 * Appends backdated activity against a closed cycle without rewriting its
 * snapshot. With `correctsEntryId` null this records a new backdated fact;
 * otherwise it atomically appends a linked reversal of a live closed-cycle
 * fact plus, unless voiding, its replacement (a corrected fact). The
 * correction propagates as an exact linked delta while no downstream
 * carry/allocation has consumed the settlement; otherwise the valid
 * correction is still accepted and an explicit unresolved conflict is
 * recorded alongside it.
 */
export interface RecordClosedCycleCorrectionCommand {
  readonly kind: 'recordClosedCycleCorrection';
  readonly bookId: BookId;
  readonly targetCycleId: CycleId;
  readonly movementKind: 'expense' | 'inflow' | 'return';
  /**
   * Strictly positive book-currency amount. For a new fact this is the
   * fact's amount; for a linked correction it confirms the replacement
   * amount (or the voided target amount when `replacement` is null).
   */
  readonly amount: Money;
  readonly occurredAt: OccurredAt;
  readonly note: string;
  /** Descriptive only; never affects availability. */
  readonly category: string | null;
  /** Required when `movementKind` is `return` for a new fact (the refunded expense). */
  readonly linkedExpenseEntryId: EntryId | null;
  /** The live closed-cycle fact being corrected or voided; null for a new fact. */
  readonly correctsEntryId: EntryId | null;
  /** Null means void (reversal only); otherwise the linked replacement. */
  readonly replacement: {
    readonly amount: Money;
    readonly note?: string;
  } | null;
}

/** Records an explicit decision on an unresolved propagation conflict. */
export interface ResolvePropagationConflictCommand {
  readonly kind: 'resolvePropagationConflict';
  readonly bookId: BookId;
  readonly conflictId: EntryId;
  readonly resolution: 'acknowledgedDownstreamStands';
  readonly note: string;
}

export type FinanceCommand =
  | CreateBookCommand
  | OpenCycleCommand
  | RecordInflowCommand
  | ReverseInflowCommand
  | RecordExpenseCommand
  | CorrectExpenseCommand
  | RecordExpenseReturnCommand
  | CorrectExpenseReturnCommand
  | CreateObligationCommand
  | RecordObligationPaymentCommand
  | RecordObligationReturnCommand
  | SettleObligationFinallyCommand
  | CancelObligationCommand
  | ReopenObligationCommand
  | OpenObligationDisputeCommand
  | ResolveObligationDisputeCommand
  | ReleaseDisputedResidualCommand
  | CreateGoalCommand
  | FundAllocationPoolCommand
  | AssignToGoalCommand
  | UnassignFromGoalCommand
  | ReleaseAllocationCommand
  | ReverseAllocationRecordCommand
  | SetBufferCommand
  | OpenBoundaryCycleCommand
  | RecordRealityCheckCommand
  | RecoverObservedActivityCommand
  | CreateRecurringPlanCommand
  | ReviseRecurringPlanCommand
  | MaterializePlanOccurrencesCommand
  | DetachPlanOccurrenceCommand
  | ReservePlanOccurrenceCommand
  | UpdateBookSettingsCommand
  | RebaseOpenCycleCommand
  | CloseCycleCommand
  | DisposeCycleRemainderCommand
  | ReopenCycleCommand
  | RecordClosedCycleCorrectionCommand
  | ResolvePropagationConflictCommand;

/**
 * Declared reversal policy per command kind:
 * - createBook/openCycle: lifecycle corrections arrive with cycle close in a
 *   later P03 task.
 * - recordInflow/recordExpense/recordObligationPayment: reversible by
 *   appending a linked reversal fact (inflow reversal; expense correction).
 * - reverseInflow/correctExpense: themselves linked corrections; they are
 *   never reversed, a new fact corrects them.
 * - recordExpenseReturn/recordObligationReturn: reversible by appending a
 *   linked return reversal, with an optional atomic replacement
 *   (correctExpenseReturn), which is itself never reversed.
 * - obligations lifecycle, goals, buffer: managed by explicit previewed
 *   lifecycle commands rather than linked reversals; dispute resolution is
 *   explicit (resolveObligationDispute) or via confirmed final
 *   settlement/cancellation.
 * - allocation records: reversible by appending a linked inverse record.
 */
export type ReversalPolicy =
  | 'lifecycleCorrectionLaterTask'
  | 'appendsLinkedReversal'
  | 'isALinkedReversal'
  | 'managedByLifecycleCommands';

export const COMMAND_REVERSAL_POLICY: Readonly<Record<CommandKind, ReversalPolicy>> = Object.freeze({
  createBook: 'lifecycleCorrectionLaterTask',
  openCycle: 'lifecycleCorrectionLaterTask',
  openBoundaryCycle: 'lifecycleCorrectionLaterTask',
  recordRealityCheck: 'managedByLifecycleCommands',
  recoverObservedActivity: 'appendsLinkedReversal',
  createRecurringPlan: 'managedByLifecycleCommands',
  reviseRecurringPlan: 'managedByLifecycleCommands',
  materializePlanOccurrences: 'managedByLifecycleCommands',
  detachPlanOccurrence: 'managedByLifecycleCommands',
  reservePlanOccurrence: 'managedByLifecycleCommands',
  updateBookSettings: 'managedByLifecycleCommands',
  rebaseOpenCycle: 'managedByLifecycleCommands',
  closeCycle: 'managedByLifecycleCommands',
  disposeCycleRemainder: 'managedByLifecycleCommands',
  reopenCycle: 'managedByLifecycleCommands',
  recordClosedCycleCorrection: 'appendsLinkedReversal',
  resolvePropagationConflict: 'managedByLifecycleCommands',
  recordInflow: 'appendsLinkedReversal',
  reverseInflow: 'isALinkedReversal',
  recordExpense: 'appendsLinkedReversal',
  correctExpense: 'isALinkedReversal',
  recordExpenseReturn: 'appendsLinkedReversal',
  correctExpenseReturn: 'isALinkedReversal',
  createObligation: 'managedByLifecycleCommands',
  recordObligationPayment: 'appendsLinkedReversal',
  recordObligationReturn: 'appendsLinkedReversal',
  settleObligationFinally: 'managedByLifecycleCommands',
  cancelObligation: 'managedByLifecycleCommands',
  reopenObligation: 'managedByLifecycleCommands',
  openObligationDispute: 'managedByLifecycleCommands',
  resolveObligationDispute: 'managedByLifecycleCommands',
  releaseDisputedResidual: 'managedByLifecycleCommands',
  createGoal: 'managedByLifecycleCommands',
  fundAllocationPool: 'appendsLinkedReversal',
  assignToGoal: 'appendsLinkedReversal',
  unassignFromGoal: 'appendsLinkedReversal',
  releaseAllocation: 'appendsLinkedReversal',
  reverseAllocationRecord: 'isALinkedReversal',
  setBuffer: 'managedByLifecycleCommands',
});

/**
 * What the caller must present at execution time. `expectedRevision` and
 * `previewDigest` come from a preview; the digest binds the exact canonical
 * payload and revision the preview covered. Retries reuse the same triple.
 *
 * The preview digest is an application confirmation mechanism: a short
 * stable (non-cryptographic, FNV-style) digest that binds a confirmation to
 * its preview. It is not authentication, not authorization, and not a
 * cryptographic integrity proof.
 */
export interface CommandConfirmation {
  readonly operationId: OperationId;
  readonly expectedRevision: number;
  readonly previewDigest: string;
}

export type ObligationDisputeResolution = 'finalSettlement' | 'cancellation' | 'explicitResolution';

export type CommandEffect =
  | {
      readonly kind: 'bookCreated';
      readonly bookId: BookId;
      readonly currency: CurrencyCode;
      readonly timeZone: TimeZoneName;
      readonly cycleAnchor: MonthlyCycleAnchor;
    }
  | {
      readonly kind: 'cycleOpened';
      readonly cycleId: CycleId;
      readonly startDate: CivilDate;
      readonly endDateExclusive: CivilDate;
      readonly startingFunds: Money;
    }
  | {
      readonly kind: 'inflowRecorded';
      readonly entryId: EntryId;
      readonly cycleId: CycleId;
      readonly localDate: CivilDate;
      readonly amount: Money;
    }
  | {
      readonly kind: 'inflowReversalRecorded';
      readonly entryId: EntryId;
      readonly reversesEntryId: EntryId;
      readonly cycleId: CycleId;
      readonly localDate: CivilDate;
      readonly amount: Money;
    }
  | {
      readonly kind: 'expenseRecorded';
      readonly entryId: EntryId;
      readonly cycleId: CycleId;
      readonly localDate: CivilDate;
      readonly amount: Money;
      readonly linkedObligationId: ObligationId | null;
      readonly replacesEntryId: EntryId | null;
    }
  | {
      readonly kind: 'expenseReversalRecorded';
      readonly entryId: EntryId;
      readonly reversesEntryId: EntryId;
      readonly cycleId: CycleId;
      readonly localDate: CivilDate;
      readonly amount: Money;
    }
  | {
      readonly kind: 'expenseReturnRecorded';
      readonly entryId: EntryId;
      readonly cycleId: CycleId;
      readonly localDate: CivilDate;
      readonly amount: Money;
      readonly linkedExpenseEntryId: EntryId | null;
      readonly linkedObligationId: ObligationId | null;
      readonly replacesReturnEntryId: EntryId | null;
    }
  | {
      readonly kind: 'expenseReturnReversalRecorded';
      readonly entryId: EntryId;
      readonly reversesEntryId: EntryId;
      readonly cycleId: CycleId;
      readonly localDate: CivilDate;
      readonly amount: Money;
      readonly linkedExpenseEntryId: EntryId | null;
      readonly linkedObligationId: ObligationId | null;
    }
  | {
      readonly kind: 'obligationCreated';
      readonly obligationId: ObligationId;
      readonly cycleId: CycleId;
      readonly expectedAmount: Money;
    }
  | {
      readonly kind: 'obligationFinallySettled';
      readonly obligationId: ObligationId;
      readonly releasedResidual: Money;
    }
  | {
      readonly kind: 'obligationCancelled';
      readonly obligationId: ObligationId;
      readonly releasedResidual: Money;
    }
  | {
      readonly kind: 'obligationReopened';
      readonly obligationId: ObligationId;
      readonly reinstatedResidual: Money;
    }
  | {
      readonly kind: 'obligationDisputeOpened';
      readonly obligationId: ObligationId;
    }
  | {
      readonly kind: 'obligationDisputeResolved';
      readonly obligationId: ObligationId;
      readonly via: ObligationDisputeResolution;
    }
  | {
      readonly kind: 'obligationResidualReleased';
      readonly obligationId: ObligationId;
      readonly releasedResidual: Money;
    }
  | {
      readonly kind: 'goalCreated';
      readonly goalId: GoalId;
      readonly targetAmount: Money;
    }
  | {
      readonly kind: 'allocationFunded';
      readonly recordId: AllocationRecordId;
      readonly cycleId: CycleId;
      readonly localDate: CivilDate;
      readonly amount: Money;
    }
  | {
      readonly kind: 'allocationAssigned';
      readonly recordId: AllocationRecordId;
      readonly goalId: GoalId;
      readonly amount: Money;
    }
  | {
      readonly kind: 'allocationUnassigned';
      readonly recordId: AllocationRecordId;
      readonly goalId: GoalId;
      readonly amount: Money;
    }
  | {
      readonly kind: 'allocationReleased';
      readonly recordId: AllocationRecordId;
      readonly cycleId: CycleId;
      readonly localDate: CivilDate;
      readonly destinationCycleId: CycleId;
      readonly goalId: GoalId | null;
      readonly amount: Money;
    }
  | {
      readonly kind: 'allocationRecordReversed';
      readonly recordId: AllocationRecordId;
      readonly reversesRecordId: AllocationRecordId;
      readonly reversedChange: Exclude<AllocationChangeType, 'reversal'>;
      readonly amount: Money;
    }
  | {
      readonly kind: 'bufferSet';
      readonly amount: Money;
      readonly previousAmount: Money | null;
    }
  | {
      readonly kind: 'boundaryCycleOpened';
      readonly cycleId: CycleId;
      readonly versionId: CycleVersionId;
      readonly startDate: CivilDate;
      readonly endDateExclusive: CivilDate;
      readonly observedPool: Money;
    }
  | {
      readonly kind: 'realityCheckRecorded';
      readonly observationId: ObservationId;
      readonly cycleId: CycleId;
      readonly observedPool: Money;
      readonly ledgerPool: Money;
      readonly adjustmentAmount: Money;
    }
  | {
      readonly kind: 'observedActivityRecovered';
      readonly entryId: EntryId;
      readonly observationId: ObservationId;
      readonly cycleId: CycleId;
      readonly localDate: CivilDate;
      readonly amount: Money;
      readonly movementKind: 'expense' | 'inflow' | 'return';
    }
  | {
      readonly kind: 'recurringPlanCreated';
      readonly planId: PlanId;
      readonly amount: Money;
      readonly scheduleDay: number;
      readonly effectiveDate: CivilDate;
    }
  | {
      readonly kind: 'recurringPlanRevised';
      readonly planId: PlanId;
      readonly revisionId: EntryId;
      readonly effectiveDate: CivilDate;
      readonly amount: Money;
      readonly scheduleDay: number;
      readonly updatedOccurrences: number;
    }
  | {
      readonly kind: 'planOccurrencesMaterialized';
      readonly planId: PlanId;
      readonly occurrenceIds: readonly OccurrenceId[];
    }
  | {
      readonly kind: 'planOccurrenceDetached';
      readonly occurrenceId: OccurrenceId;
    }
  | {
      readonly kind: 'planOccurrenceReserved';
      readonly occurrenceId: OccurrenceId;
      readonly obligationId: ObligationId;
      readonly expectedAmount: Money;
    }
  | {
      readonly kind: 'bookSettingsUpdated';
      readonly effectiveDate: CivilDate;
    }
  | {
      readonly kind: 'openCycleRebased';
      readonly cycleId: CycleId;
      readonly oldVersionId: CycleVersionId;
      readonly newVersionId: CycleVersionId;
      readonly oldStartDate: CivilDate;
      readonly newStartDate: CivilDate;
      readonly oldEndDateExclusive: CivilDate;
      readonly newEndDateExclusive: CivilDate;
      readonly allocationDelta: Money;
      readonly carryDelta: Money;
      readonly unmovedOutsideWindow: number;
    }
  | {
      readonly kind: 'cycleClosed';
      readonly cycleId: CycleId;
      readonly versionId: CycleVersionId;
      readonly settlementId: SettlementId;
      readonly availability: Money;
    }
  | {
      readonly kind: 'cycleRemainderDisposed';
      readonly settlementId: SettlementId;
      readonly carryId: EntryId;
      readonly dispositionKind: RemainderDispositionInput['kind'];
    }
  | {
      readonly kind: 'cycleReopened';
      readonly cycleId: CycleId;
      readonly reopenedSettlementId: SettlementId;
      readonly newVersionId: CycleVersionId;
    }
  | {
      readonly kind: 'closedCycleCorrectionRecorded';
      readonly entryId: EntryId;
      readonly targetCycleId: CycleId;
      readonly settlementId: SettlementId;
      readonly propagation: 'applied' | 'conflicted';
      readonly deltaAmount: Money;
      /** The corrected closed-cycle fact, if this was a linked correction. */
      readonly correctsEntryId: EntryId | null;
      /** The linked replacement entry, if the correction replaces. */
      readonly replacementEntryId: EntryId | null;
    }
  | {
      readonly kind: 'propagationConflictResolved';
      readonly conflictId: EntryId;
    };

export interface CommandReceipt {
  readonly operationId: OperationId;
  readonly commandKind: CommandKind;
  readonly bookId: BookId;
  readonly revisionBefore: number;
  readonly revisionAfter: number;
  readonly committedAtInstantMs: number;
  readonly canonicalDigest: string;
  readonly calculationVersion: string;
  readonly effects: readonly CommandEffect[];
  /**
   * Ordered values returned by the injected clock while the command handler
   * ran. Required when `handlerClockVersion` is current; absent from legacy
   * records, which P04 rejects because their handler timestamps cannot be
   * reconstructed independently from the resulting state.
   */
  readonly handlerClockInstants?: readonly number[];
  /** Version of the independent handler-clock provenance subrecord. */
  readonly handlerClockVersion?: HandlerClockProvenanceVersion;
  /**
   * Sync-contract binding (P03 Task D). The receipt names the schema version
   * it was written under, the identity-scoped repository it committed in,
   * the source device, and the durable local enqueue sequence assigned
   * inside the committing transaction. Ordering across operations comes from
   * `enqueueSequence` (and per-book revisions), never from
   * `committedAtInstantMs`, which is capture evidence only.
   */
  readonly schemaVersion: SyncRecordSchemaVersion;
  readonly scopeId: RepositoryScopeId;
  readonly sourceDeviceId: DeviceId;
  readonly enqueueSequence: number;
}

/**
 * Schema version of every sync-facing record (receipt, operation journal,
 * outbox intent, delivery state). P04/P08 must reject unknown versions
 * explicitly; no reader may guess a record version.
 */
export const SYNC_RECORD_SCHEMA_VERSION = 1 as const;
export type SyncRecordSchemaVersion = typeof SYNC_RECORD_SCHEMA_VERSION;

/** First version with an independently persisted ordered handler-clock trace. */
export const HANDLER_CLOCK_PROVENANCE_VERSION = 1 as const;
export type HandlerClockProvenanceVersion = typeof HANDLER_CLOCK_PROVENANCE_VERSION;

export interface OperationRecord {
  readonly operationId: OperationId;
  readonly bookId: BookId;
  /** Canonical form of the executed command; the idempotency comparison key. */
  readonly canonicalCommand: string;
  readonly receipt: CommandReceipt;
  readonly committedAtInstantMs: number;
  /** Exact duplicate of the receipt trace; required for fail-closed verification. */
  readonly handlerClockInstants?: readonly number[];
  /** Must equal the receipt's current handler-clock provenance version. */
  readonly handlerClockVersion?: HandlerClockProvenanceVersion;
  /**
   * The operation journal is the single normalized source of truth for the
   * canonical command payload: the outbox intent references it by
   * operation ID and never duplicates the payload. Both records are written
   * in the same repository transaction; one must never exist without the
   * other. Base and resulting revisions live on the receipt
   * (`revisionBefore`/`revisionAfter`); scope, device, and durable order are
   * stamped here so P04/P08 can bind, retry, and replicate without guessing.
   */
  readonly schemaVersion: SyncRecordSchemaVersion;
  readonly scopeId: RepositoryScopeId;
  readonly sourceDeviceId: DeviceId;
  /** Same durable sequence as the receipt and the outbox intent for this operation. */
  readonly enqueueSequence: number;
}

/**
 * A pending replication/sync entry written in the same transaction as the
 * state change and receipt. Task A never drains it; P04 owns persistence and
 * sync behavior. Device-local only: it implies no cloud authorization.
 *
 * The envelope is immutable intent: it references the operation journal by
 * `operationId` and carries no mutable transport state. Attempts, last
 * error, lease, acknowledgement, and retry time live in the separate
 * `OutboxDeliveryState`, owned by the adapter/transport, so delivery
 * activity can never rewrite financial history.
 */
export interface OutboxEnvelope {
  readonly outboxId: string;
  readonly operationId: OperationId;
  readonly bookId: BookId;
  readonly commandKind: CommandKind;
  readonly revisionAfter: number;
  readonly canonicalDigest: string;
  readonly createdAtInstantMs: number;
  readonly status: 'pending';
  readonly schemaVersion: SyncRecordSchemaVersion;
  readonly scopeId: RepositoryScopeId;
  readonly sourceDeviceId: DeviceId;
  /** Same durable sequence as the operation journal entry for this operation. */
  readonly enqueueSequence: number;
}

/**
 * Mutable delivery metadata for one outbox intent, owned by the
 * adapter/transport. Mutating this record must never change the canonical
 * command, receipt, book revision, or effect: it is keyed by operation ID
 * and acknowledges exactly the intended operation.
 *
 * `version` is the optimistic-concurrency guard: every mutation produces
 * exactly version + 1, and the adapter commits a delivery write only when
 * the committed version still equals the version read in the same
 * transaction (first-committer-wins). Concurrent delivery workers therefore
 * serialize or receive an explicit conflict — no successful update is ever
 * silently lost.
 */
export interface OutboxDeliveryState {
  readonly schemaVersion: SyncRecordSchemaVersion;
  readonly outboxId: string;
  readonly operationId: OperationId;
  readonly version: number;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly leaseHolder: string | null;
  readonly leaseExpiresAtMs: number | null;
  readonly acknowledged: boolean;
  readonly nextRetryAtMs: number | null;
}

/** Initial delivery state for a freshly committed outbox intent. */
export function initialOutboxDelivery(envelope: OutboxEnvelope): OutboxDeliveryState {
  return {
    schemaVersion: SYNC_RECORD_SCHEMA_VERSION,
    outboxId: envelope.outboxId,
    operationId: envelope.operationId,
    version: 0,
    attempts: 0,
    lastError: null,
    leaseHolder: null,
    leaseExpiresAtMs: null,
    acknowledged: false,
    nextRetryAtMs: null,
  };
}

export type DeliveryAttemptOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string; readonly nextRetryAtMs: number | null };

/** Records one transport attempt and advances the version by exactly one. Pure: the canonical records are untouched by construction. */
export function recordDeliveryAttempt(state: OutboxDeliveryState, outcome: DeliveryAttemptOutcome): OutboxDeliveryState {
  if (!outcome.ok) {
    return { ...state, version: state.version + 1, attempts: state.attempts + 1, lastError: outcome.error, nextRetryAtMs: outcome.nextRetryAtMs };
  }
  return { ...state, version: state.version + 1, attempts: state.attempts + 1, lastError: null };
}

export type OutboxAcknowledgement = { readonly ok: true; readonly delivery: OutboxDeliveryState } | { readonly ok: false; readonly reason: 'operationMismatch' | 'alreadyAcknowledged' };

/**
 * Acknowledges exactly the intended operation. A mismatched operation ID or
 * a duplicate acknowledgement is an explicit rejection, never a silent
 * second effect.
 */
export function acknowledgeOutboxDelivery(state: OutboxDeliveryState, operationId: OperationId): OutboxAcknowledgement {
  if ((state.operationId as string) !== (operationId as string)) {
    return { ok: false, reason: 'operationMismatch' };
  }
  if (state.acknowledged) {
    return { ok: false, reason: 'alreadyAcknowledged' };
  }
  return { ok: true, delivery: { ...state, version: state.version + 1, acknowledged: true, nextRetryAtMs: null } };
}

export type CommandFailure =
  | { readonly kind: 'invalidCommand'; readonly issues: readonly string[] }
  | { readonly kind: 'invalidConfirmation'; readonly issues: readonly string[] }
  | { readonly kind: 'previewMismatch'; readonly detail: string }
  | { readonly kind: 'unknownBook'; readonly bookId: BookId }
  | { readonly kind: 'bookAlreadyExists'; readonly bookId: BookId }
  | {
      readonly kind: 'revisionConflict';
      readonly bookId: BookId;
      readonly expectedRevision: number;
      readonly actualRevision: number;
    }
  | { readonly kind: 'operationIdConflict'; readonly operationId: OperationId }
  | {
      readonly kind: 'scopeMismatch';
      readonly expectedScope: RepositoryScopeId;
      readonly actualScope: RepositoryScopeId;
      readonly detail: string;
    }
  | { readonly kind: 'noOpenCycle'; readonly bookId: BookId }
  | { readonly kind: 'cycleAlreadyOpen'; readonly bookId: BookId; readonly openCycleId: CycleId }
  | {
      readonly kind: 'invalidCycleStart';
      readonly bookId: BookId;
      readonly requestedStartDate: CivilDate;
      readonly expectedStartDate: CivilDate;
    }
  | {
      readonly kind: 'currencyMismatch';
      readonly bookId: BookId;
      readonly bookCurrency: CurrencyCode;
      readonly providedCurrency: CurrencyCode;
    }
  | { readonly kind: 'invalidOccurredAt'; readonly bookId: BookId; readonly detail: string }
  | { readonly kind: 'dateOutsideOpenCycle'; readonly bookId: BookId; readonly localDate: CivilDate; readonly openCycleId: CycleId }
  | { readonly kind: 'unknownEntry'; readonly bookId: BookId; readonly entryId: EntryId }
  | { readonly kind: 'crossBookReference'; readonly bookId: BookId; readonly entryId: EntryId; readonly entryBookId: BookId }
  | {
      readonly kind: 'duplicateReversal';
      readonly bookId: BookId;
      readonly entryId: EntryId;
      readonly existingReversalEntryId: EntryId;
    }
  | { readonly kind: 'notAnInflow'; readonly bookId: BookId; readonly entryId: EntryId }
  | { readonly kind: 'notAnExpense'; readonly bookId: BookId; readonly entryId: EntryId }
  | { readonly kind: 'notAReturn'; readonly bookId: BookId; readonly entryId: EntryId }
  | {
      readonly kind: 'returnExceedsReturnable';
      readonly bookId: BookId;
      readonly targetKind: 'expense' | 'obligation';
      readonly targetId: string;
      readonly requested: Money;
      readonly returnable: Money;
    }
  | { readonly kind: 'unknownObligation'; readonly bookId: BookId; readonly obligationId: ObligationId }
  | {
      readonly kind: 'crossBookObligation';
      readonly bookId: BookId;
      readonly obligationId: ObligationId;
      readonly obligationBookId: BookId;
    }
  | { readonly kind: 'unknownGoal'; readonly bookId: BookId; readonly goalId: GoalId }
  | {
      readonly kind: 'crossBookGoal';
      readonly bookId: BookId;
      readonly goalId: GoalId;
      readonly goalBookId: BookId;
    }
  | { readonly kind: 'goalAlreadyExists'; readonly bookId: BookId; readonly goalId: GoalId }
  | {
      readonly kind: 'obligationNotOpen';
      readonly bookId: BookId;
      readonly obligationId: ObligationId;
      readonly status: 'finallySettled' | 'cancelled';
    }
  | {
      readonly kind: 'obligationNotClosed';
      readonly bookId: BookId;
      readonly obligationId: ObligationId;
      readonly status: 'open';
    }
  | { readonly kind: 'disputeAlreadyOpen'; readonly bookId: BookId; readonly obligationId: ObligationId }
  | { readonly kind: 'disputeNotOpen'; readonly bookId: BookId; readonly obligationId: ObligationId }
  | {
      readonly kind: 'residualNotReleasable';
      readonly bookId: BookId;
      readonly obligationId: ObligationId;
      readonly detail: string;
    }
  | { readonly kind: 'unknownAllocationRecord'; readonly bookId: BookId; readonly recordId: AllocationRecordId }
  | {
      readonly kind: 'invalidAllocationReversal';
      readonly bookId: BookId;
      readonly recordId: AllocationRecordId;
      readonly detail: string;
    }
  | {
      readonly kind: 'insufficientTrackedFunds';
      readonly bookId: BookId;
      readonly pool: { readonly kind: 'unallocated' } | { readonly kind: 'goal'; readonly goalId: GoalId };
      readonly requested: Money;
      readonly available: Money;
    }
  | {
      readonly kind: 'invalidReleaseDestination';
      readonly bookId: BookId;
      readonly requestedCycleId: CycleId;
      readonly openCycleId: CycleId;
    }
  | {
      readonly kind: 'clarificationNeeded';
      readonly bookId: BookId;
      readonly reason: 'foreignCurrency' | 'ambiguousCurrency' | 'ambiguousBoundaryOrder';
      readonly detail: string;
    }
  | { readonly kind: 'unknownCycle'; readonly bookId: BookId; readonly cycleId: CycleId }
  | { readonly kind: 'cycleAlreadyClosed'; readonly bookId: BookId; readonly cycleId: CycleId }
  | { readonly kind: 'cycleNotClosed'; readonly bookId: BookId; readonly cycleId: CycleId }
  | { readonly kind: 'invalidBoundary'; readonly bookId: BookId; readonly detail: string }
  | { readonly kind: 'unknownObservation'; readonly bookId: BookId; readonly observationId: ObservationId }
  | {
      readonly kind: 'crossBookObservation';
      readonly bookId: BookId;
      readonly observationId: ObservationId;
      readonly observationBookId: BookId;
    }
  | {
      readonly kind: 'duplicateObservation';
      readonly bookId: BookId;
      readonly cycleId: CycleId;
      readonly observationId: ObservationId;
    }
  | { readonly kind: 'invalidRecoveryBoundary'; readonly bookId: BookId; readonly observationId: ObservationId; readonly detail: string }
  | { readonly kind: 'unknownPlan'; readonly bookId: BookId; readonly planId: PlanId }
  | {
      readonly kind: 'crossBookPlan';
      readonly bookId: BookId;
      readonly planId: PlanId;
      readonly planBookId: BookId;
    }
  | { readonly kind: 'planAlreadyExists'; readonly bookId: BookId; readonly planId: PlanId }
  | { readonly kind: 'unknownOccurrence'; readonly bookId: BookId; readonly occurrenceId: OccurrenceId }
  | {
      readonly kind: 'crossBookOccurrence';
      readonly bookId: BookId;
      readonly occurrenceId: OccurrenceId;
      readonly occurrenceBookId: BookId;
    }
  | {
      readonly kind: 'occurrenceNotManaged';
      readonly bookId: BookId;
      readonly occurrenceId: OccurrenceId;
      readonly state: string;
    }
  | { readonly kind: 'occurrenceAlreadyPaid'; readonly bookId: BookId; readonly occurrenceId: OccurrenceId }
  | { readonly kind: 'invalidEffectiveDate'; readonly bookId: BookId; readonly detail: string }
  | { readonly kind: 'rebaseNotNeeded'; readonly bookId: BookId; readonly cycleId: CycleId }
  | { readonly kind: 'invalidRebase'; readonly bookId: BookId; readonly cycleId: CycleId; readonly detail: string }
  | { readonly kind: 'unknownSettlement'; readonly bookId: BookId; readonly settlementId: SettlementId }
  | {
      readonly kind: 'crossBookSettlement';
      readonly bookId: BookId;
      readonly settlementId: SettlementId;
      readonly settlementBookId: BookId;
    }
  | { readonly kind: 'settlementReversed'; readonly bookId: BookId; readonly settlementId: SettlementId }
  | { readonly kind: 'carryAlreadyConsumed'; readonly bookId: BookId; readonly settlementId: SettlementId; readonly existingCarryId: EntryId }
  | { readonly kind: 'invalidDisposition'; readonly bookId: BookId; readonly settlementId: SettlementId; readonly detail: string }
  | { readonly kind: 'unknownConflict'; readonly bookId: BookId; readonly conflictId: EntryId }
  | { readonly kind: 'conflictAlreadyResolved'; readonly bookId: BookId; readonly conflictId: EntryId };

export type CommandPreviewResult =
  | { readonly ok: true; readonly preview: CommandPreview }
  | { readonly ok: false; readonly failure: CommandFailure };

export interface CommandPreview {
  readonly commandKind: CommandKind;
  readonly bookId: BookId;
  /** The book revision this preview covers; 0 means the book does not exist yet. */
  readonly expectedRevision: number;
  readonly canonicalCommand: string;
  readonly previewDigest: string;
  /**
   * Provisional effects. IDs and timestamps assigned from context during
   * preview are estimates; the receipt returned by execution is the
   * authoritative record.
   */
  readonly effects: readonly CommandEffect[];
}

export type CommandExecutionResult =
  | { readonly ok: true; readonly receipt: CommandReceipt; /** True when this was an idempotent retry. */ readonly retried: boolean }
  | { readonly ok: false; readonly failure: CommandFailure };

export function describeCommandFailure(failure: CommandFailure): string {
  switch (failure.kind) {
    case 'invalidCommand':
      return `invalid command: ${failure.issues.join('; ')}`;
    case 'invalidConfirmation':
      return `invalid confirmation: ${failure.issues.join('; ')}`;
    case 'previewMismatch':
      return `preview mismatch: ${failure.detail}`;
    case 'unknownBook':
      return `unknown book ${failure.bookId}`;
    case 'bookAlreadyExists':
      return `book ${failure.bookId} already exists`;
    case 'revisionConflict':
      return `revision conflict for ${failure.bookId}: expected ${failure.expectedRevision}, actual ${failure.actualRevision}`;
    case 'operationIdConflict':
      return `operation ${failure.operationId} was already used with different content`;
    case 'scopeMismatch':
      return `scope mismatch: repository is bound to ${failure.expectedScope}, caller presented ${failure.actualScope}: ${failure.detail}`;
    case 'noOpenCycle':
      return `book ${failure.bookId} has no open cycle`;
    case 'cycleAlreadyOpen':
      return `book ${failure.bookId} already has open cycle ${failure.openCycleId}`;
    case 'invalidCycleStart':
      return `cycle start ${failure.requestedStartDate} is not anchor-aligned; expected ${failure.expectedStartDate}`;
    case 'currencyMismatch':
      return `amount currency ${failure.providedCurrency} does not match book currency ${failure.bookCurrency}`;
    case 'invalidOccurredAt':
      return `invalid occurredAt: ${failure.detail}`;
    case 'dateOutsideOpenCycle':
      return `date ${failure.localDate} is outside open cycle ${failure.openCycleId}`;
    case 'unknownEntry':
      return `entry ${failure.entryId} is unknown in book ${failure.bookId}`;
    case 'crossBookReference':
      return `entry ${failure.entryId} belongs to book ${failure.entryBookId}, not book ${failure.bookId}`;
    case 'duplicateReversal':
      return `entry ${failure.entryId} is already reversed by ${failure.existingReversalEntryId}`;
    case 'notAnInflow':
      return `entry ${failure.entryId} is not an inflow and cannot be reversed`;
    case 'notAnExpense':
      return `entry ${failure.entryId} is not an expense and cannot be corrected this way`;
    case 'notAReturn':
      return `entry ${failure.entryId} is not a return and cannot be corrected as one`;
    case 'returnExceedsReturnable':
      return `${failure.targetKind} ${failure.targetId} can only return ${failure.returnable.minorUnits} ${failure.returnable.currency}, not ${failure.requested.minorUnits}`;
    case 'unknownObligation':
      return `obligation ${failure.obligationId} is unknown in book ${failure.bookId}`;
    case 'crossBookObligation':
      return `obligation ${failure.obligationId} belongs to book ${failure.obligationBookId}, not book ${failure.bookId}`;
    case 'unknownGoal':
      return `goal ${failure.goalId} is unknown in book ${failure.bookId}`;
    case 'crossBookGoal':
      return `goal ${failure.goalId} belongs to book ${failure.goalBookId}, not book ${failure.bookId}`;
    case 'goalAlreadyExists':
      return `goal ${failure.goalId} already exists in book ${failure.bookId}`;
    case 'obligationNotOpen':
      return `obligation ${failure.obligationId} is ${failure.status}, not open`;
    case 'obligationNotClosed':
      return `obligation ${failure.obligationId} is still open and cannot be reopened`;
    case 'disputeAlreadyOpen':
      return `obligation ${failure.obligationId} already has an open dispute`;
    case 'disputeNotOpen':
      return `obligation ${failure.obligationId} has no open dispute`;
    case 'residualNotReleasable':
      return `disputed residual of ${failure.obligationId} cannot be released: ${failure.detail}`;
    case 'unknownAllocationRecord':
      return `allocation record ${failure.recordId} is unknown in book ${failure.bookId}`;
    case 'invalidAllocationReversal':
      return `allocation record ${failure.recordId} cannot be reversed: ${failure.detail}`;
    case 'insufficientTrackedFunds':
      return `tracked pool ${failure.pool.kind === 'goal' ? failure.pool.goalId : 'unallocated'} has ${failure.available.minorUnits}, not ${failure.requested.minorUnits}`;
    case 'invalidReleaseDestination':
      return `release destination ${failure.requestedCycleId} is not the open cycle ${failure.openCycleId}`;
    case 'clarificationNeeded':
      return `clarification needed (${failure.reason}): ${failure.detail}`;
    case 'unknownCycle':
      return `cycle ${failure.cycleId} is unknown in book ${failure.bookId}`;
    case 'cycleAlreadyClosed':
      return `cycle ${failure.cycleId} in book ${failure.bookId} is already closed`;
    case 'cycleNotClosed':
      return `cycle ${failure.cycleId} in book ${failure.bookId} is not closed`;
    case 'invalidBoundary':
      return `invalid boundary: ${failure.detail}`;
    case 'unknownObservation':
      return `observation ${failure.observationId} is unknown in book ${failure.bookId}`;
    case 'crossBookObservation':
      return `observation ${failure.observationId} belongs to book ${failure.observationBookId}, not book ${failure.bookId}`;
    case 'duplicateObservation':
      return `observation ${failure.observationId} already records this boundary and amount in cycle ${failure.cycleId}`;
    case 'invalidRecoveryBoundary':
      return `recovery against observation ${failure.observationId} is invalid: ${failure.detail}`;
    case 'unknownPlan':
      return `plan ${failure.planId} is unknown in book ${failure.bookId}`;
    case 'crossBookPlan':
      return `plan ${failure.planId} belongs to book ${failure.planBookId}, not book ${failure.bookId}`;
    case 'planAlreadyExists':
      return `plan ${failure.planId} already exists in book ${failure.bookId}`;
    case 'unknownOccurrence':
      return `occurrence ${failure.occurrenceId} is unknown in book ${failure.bookId}`;
    case 'crossBookOccurrence':
      return `occurrence ${failure.occurrenceId} belongs to book ${failure.occurrenceBookId}, not book ${failure.bookId}`;
    case 'occurrenceNotManaged':
      return `occurrence ${failure.occurrenceId} is ${failure.state}, not managed`;
    case 'occurrenceAlreadyPaid':
      return `occurrence ${failure.occurrenceId} is already paid and keeps its historical revision`;
    case 'invalidEffectiveDate':
      return `invalid effective date: ${failure.detail}`;
    case 'rebaseNotNeeded':
      return `cycle ${failure.cycleId} already uses the requested settings; no rebase written`;
    case 'invalidRebase':
      return `invalid rebase of cycle ${failure.cycleId}: ${failure.detail}`;
    case 'unknownSettlement':
      return `settlement ${failure.settlementId} is unknown in book ${failure.bookId}`;
    case 'crossBookSettlement':
      return `settlement ${failure.settlementId} belongs to book ${failure.settlementBookId}, not book ${failure.bookId}`;
    case 'settlementReversed':
      return `settlement ${failure.settlementId} was reversed by a reopen and is no longer effective`;
    case 'carryAlreadyConsumed':
      return `settlement ${failure.settlementId} was already consumed by ${failure.existingCarryId}`;
    case 'invalidDisposition':
      return `invalid disposition for settlement ${failure.settlementId}: ${failure.detail}`;
    case 'unknownConflict':
      return `propagation conflict ${failure.conflictId} is unknown in book ${failure.bookId}`;
    case 'conflictAlreadyResolved':
      return `propagation conflict ${failure.conflictId} is already resolved`;
  }
}
