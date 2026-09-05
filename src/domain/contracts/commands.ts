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
  EntryId,
  GoalId,
  ObligationId,
  OperationId,
} from './identity';
import type { AllocationChange } from './ledger';

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
  | 'setBuffer';

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
  | SetBufferCommand;

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
}

export interface OperationRecord {
  readonly operationId: OperationId;
  readonly bookId: BookId;
  /** Canonical form of the executed command; the idempotency comparison key. */
  readonly canonicalCommand: string;
  readonly receipt: CommandReceipt;
  readonly committedAtInstantMs: number;
}

/**
 * A pending replication/sync entry written in the same transaction as the
 * state change and receipt. Task A never drains it; P04 owns persistence and
 * sync behavior. Device-local only: it implies no cloud authorization.
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
    };

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
  }
}
