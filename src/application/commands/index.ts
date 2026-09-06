/**
 * Public command API for Rushd's canonical finance engine (P03 Tasks A+B+C).
 *
 * Task A implemented `previewCommand` / `executeCommand` over books, cycles,
 * inflows, and linked inflow reversals, with checked integer money, strict
 * civil dates, injected clock/ID context, revision-checked idempotent
 * execution, receipts, and outbox envelopes.
 *
 * Task B adds everyday financial behavior over the same protocol:
 * - actual activity: `recordExpense`, `correctExpense` (linked reversal +
 *   optional replacement, atomic), `recordExpenseReturn`,
 *   `correctExpenseReturn` (linked return reversal + optional replacement,
 *   atomic, for standalone and obligation returns);
 * - obligations: `createObligation` (expected item, never money movement),
 *   `recordObligationPayment`, `recordObligationReturn`, explicit
 *   `settleObligationFinally` / `cancelObligation` / `reopenObligation`,
 *   dispute overlay (`openObligationDispute`, explicit
 *   `resolveObligationDispute`) and previewed `releaseDisputedResidual`
 *   (records unresolved uncertainty);
 * - goals and tracked allocations: `createGoal`, `fundAllocationPool`,
 *   `assignToGoal` (no second availability effect), `unassignFromGoal`,
 *   `releaseAllocation` (named destination cycle), and linked
 *   `reverseAllocationRecord`;
 * - `setBuffer` for the explicit buffer reservation;
 * - pure queries: `computeAvailability` (signed amount, exact breakdown,
 *   completeness dimensions), `computePacing` (explicit eligible dates,
 *   exact integer division with reported remainder), and
 *   `computeCompleteness` (deterministic reducer with typed reasons).
 *   Effective funding/release attribution is shared between the tracked pool
 *   and availability, so reversals move both together; refund allowance is
 *   computed across correction families, so a new replacement ID never
 *   resets it.
 *
 * Task C adds the cycle-aware core over the same protocol:
 * - boundary cycles (`openBoundaryCycle`, remaining-from-boundary) alongside
 *   full-cycle versions with rebase/close/reopen lifecycle;
 * - Reality Check (`recordRealityCheck`) with boundary-specific signed
 *   adjustments over the full tracked pool, and linked recovery
 *   (`recoverObservedActivity`) that consumes the unexplained difference
 *   exactly once and recomputes forward through corrections;
 * - recurring plans (`createRecurringPlan`, `reviseRecurringPlan`,
 *   `materializePlanOccurrences`, `detachPlanOccurrence`,
 *   `reservePlanOccurrence`) with immutable effective-dated revisions and
 *   stable occurrences that protect paid/detached facts;
 * - versioned settings (`updateBookSettings`, defaulting to the next
 *   unopened cycle) with explicit previewed open-cycle rebase;
 * - immutable settlements (`closeCycle`), explicit remainder disposition
 *   (`disposeCycleRemainder`: carry-in, tracked funding, split, or
 *   independent), `reopenCycle`, backdated closed-cycle corrections with
 *   exact linked propagation or explicit unresolved conflicts, and explicit
 *   conflict resolution;
 * - cycle-scoped availability (carry-in plus signed reconciliation
 *   residuals; old-cycle facts never double-count) and active-basis
 *   completeness (old unclassified history excluded; propagation and
 *   recovery gaps stay visible).
 *
 * Not implemented yet (later phases): persistent storage, obligation due
 * dates beyond plan occurrences, and sync.
 * Nothing here claims PWA, sync, account, security, or release readiness.
 *
 * Usage:
 * ```ts
 * // 1. Preview, confirm, execute (every command, unchanged from Task A).
 * const preview = previewCommand(repository, command, context);
 * if (!preview.ok) throw new Error(describeCommandFailure(preview.failure));
 * const result = await executeCommand(repository, command, {
 *   operationId: makeOperationIdValue(),
 *   expectedRevision: preview.preview.expectedRevision,
 *   previewDigest: preview.preview.previewDigest,
 * }, context);
 * // result.ok === true -> result.receipt.effects are the committed effects.
 *
 * // 2. Derive the money answers from the committed state.
 * const state = repository.getBookState(bookId);
 * const availability = computeAvailability(state, {
 *   asOfInstantMs: context.clock.nowMs(),
 *   calculationVersion: 'p03-task-b-1',
 * });
 * // availability.status === 'computed' -> signed breakdown + completeness;
 * // 'unavailable' with a reason (noBook/noOpenCycle) -> never a fake zero.
 *
 * // 3. Pacing over explicit eligible remaining dates (caller-supplied).
 * const pacing = computePacing(state, { eligibleDates, ...sameParams });
 * ```
 */

export { previewCommand } from './preview';
export { executeCommand } from './execute';
export { applyRemoteOperation } from '../sync/apply-remote';
export { validateFinanceCommand, type CommandValidation, type ValidationIssue } from './validation';
export { requireCommandContext, type CommandContext, type DomainClock, type DomainIdFactory } from './context';
export type { CommandOrigin } from '../../domain/sync/scope';
export type { ApplyResult, HandlerRefs } from './handlers';
export {
  computeAvailability,
  deriveActiveCycleLedger,
  type ActiveCycleLedger,
  type AvailabilityComputed,
  type AvailabilityComponents,
  type AvailabilityResult,
  type AvailabilityUnavailable,
  type AvailabilityUnavailableReason,
} from '../../domain/calculations/availability';
export {
  computePacing,
  type PacingComputed,
  type PacingResult,
  type PacingUnavailable,
  type PacingUnavailableReason,
} from '../../domain/calculations/pacing';
export {
  computeCompleteness,
  type CompletenessDimension,
  type CompletenessReason,
  type CompletenessResult,
  type CompletenessState,
} from '../../domain/calculations/completeness';
export {
  deriveObligationView,
  deriveObligationViews,
  effectiveObligationReturns,
  grossLivePaymentsFor,
  netPaymentsFor,
  type ObligationStatus,
  type ObligationView,
} from '../../domain/obligations/derive';
export { cycleAllocationNet, deriveTrackedPool, goalAssignedBalance, type GoalBalance, type TrackedPoolView } from '../../domain/allocations/derive';
export {
  effectiveFamilyRefunds,
  effectiveReturnAmounts,
  expenseCorrectionFamily,
  findExpenseEntry,
  findExpenseReturnEntry,
  isExpenseLive,
  isExpenseReturnLive,
  liveExpenseEntries,
  liveExpenseReturns,
  returnableAmountForExpense,
} from '../../domain/activity/derive';
export {
  COMMAND_REVERSAL_POLICY,
  describeCommandFailure,
  SYNC_RECORD_SCHEMA_VERSION,
  acknowledgeOutboxDelivery,
  initialOutboxDelivery,
  recordDeliveryAttempt,
  type AllocationChangeType,
  type AssignToGoalCommand,
  type CancelObligationCommand,
  type CloseCycleCommand,
  type CommandConfirmation,
  type CommandEffect,
  type CommandExecutionResult,
  type CommandFailure,
  type CommandKind,
  type CommandPreview,
  type CommandPreviewResult,
  type CommandReceipt,
  type CorrectExpenseCommand,
  type CorrectExpenseReturnCommand,
  type CreateBookCommand,
  type CreateGoalCommand,
  type CreateObligationCommand,
  type CreateRecurringPlanCommand,
  type DeliveryAttemptOutcome,
  type DetachPlanOccurrenceCommand,
  type DisposeCycleRemainderCommand,
  type DisputeResolutionReason,
  type FinanceCommand,
  type FundAllocationPoolCommand,
  type MaterializePlanOccurrencesCommand,
  type ObligationDisputeResolution,
  type ObservationBoundary,
  type OccurredAt,
  type OpenBoundaryCycleCommand,
  type OpenCycleCommand,
  type OpenObligationDisputeCommand,
  type OperationRecord,
  type OutboxAcknowledgement,
  type OutboxDeliveryState,
  type OutboxEnvelope,
  type RebaseOpenCycleCommand,
  type RecordClosedCycleCorrectionCommand,
  type RecordExpenseCommand,
  type RecordExpenseReturnCommand,
  type RecordInflowCommand,
  type RecordObligationPaymentCommand,
  type RecordObligationReturnCommand,
  type RecordRealityCheckCommand,
  type RecoverObservedActivityCommand,
  type ReleaseAllocationCommand,
  type ReleaseDisputedResidualCommand,
  type RemainderDispositionInput,
  type ReopenCycleCommand,
  type ReopenObligationCommand,
  type ReservePlanOccurrenceCommand,
  type ResolveObligationDisputeCommand,
  type ResolvePropagationConflictCommand,
  type ReverseAllocationRecordCommand,
  type ReverseInflowCommand,
  type ReversalPolicy,
  type ReviseRecurringPlanCommand,
  type SetBufferCommand,
  type SettleObligationFinallyCommand,
  type SyncRecordSchemaVersion,
  type UnassignFromGoalCommand,
  type UpdateBookSettingsCommand,
} from '../../domain/contracts/commands';
export {
  findAdjustmentByObservation,
  findAllocationRecordById,
  findCycleVersion,
  findEffectiveCycleVersion,
  findEffectiveSettlement,
  findEntryById,
  findGoalById,
  findObligationById,
  findObservationById,
  findOccurrenceById,
  findOpenCycle,
  findPlanById,
  findReversalOf,
  findSettlementById,
  effectiveVersionStatus,
  type AllocationChange,
  type AllocationRecord,
  type BookSettingsRevision,
  type BookState,
  type BufferSetting,
  type CarryAction,
  type ConflictResolution,
  type CycleRecord,
  type CycleSettlement,
  type CycleVersionStatus,
  type ExpenseEntry,
  type ExpenseReturnEntry,
  type ExpenseReturnReversalEntry,
  type ExpenseReversalEntry,
  type FinanceBook,
  type GoalRecord,
  type InflowEntry,
  type InflowReversalEntry,
  type LedgerEntry,
  type ObligationChange,
  type ObligationEvent,
  type ObligationRecord,
  type OpenCycleRecord,
  type PlanOccurrence,
  type PlanRevision,
  type PropagationConflict,
  type PropagationDelta,
  type ReconciliationAdjustment,
  type RecoveryLink,
  type RecurringPlan,
  type RemainderDisposition,
  type RealityCheckObservation,
} from '../../domain/contracts/ledger';
export {
  type EntryLocation,
  type FinanceReadModel,
  type GoalLocation,
  type ObligationLocation,
  type ObservationLocation,
  type OccurrenceLocation,
  type PlanLocation,
  type RepositoryTransaction,
  type SettlementLocation,
  type TransactionalRepository,
} from '../../domain/contracts/repository';
export { canonicalJson, stableDigest } from '../../domain/contracts/canonical';
export {
  composeCycleId,
  makeBookId,
  makeCycleId,
  makeCycleVersionId,
  makeEntryId,
  makeGoalId,
  makeObligationId,
  makeObservationId,
  makeOccurrenceId,
  makeOperationId,
  makeOutboxId,
  makePlanId,
  makeSettlementId,
  makeAllocationRecordId,
  type AllocationRecordId,
  type BookId,
  type CycleId,
  type CycleVersionId,
  type EntryId,
  type GoalId,
  type ObligationId,
  type ObservationId,
  type OccurrenceId,
  type OperationId,
  type OutboxId,
  type PlanId,
  type SettlementId,
} from '../../domain/contracts/identity';
export {
  addMoney,
  compareMoney,
  isPositiveMoney,
  isZeroMoney,
  makeMoney,
  negateMoney,
  parseMoneyAmount,
  signOfMoney,
  subtractMoney,
  sumMoney,
  type Money,
} from '../../domain/primitives/money';
export { currencyIsoExponent, currencyMetadata, isSupportedCurrency, type CurrencyCode } from '../../domain/primitives/currency';
export {
  civilDateParts,
  civilDateToDayNumber,
  compareCivilDates,
  daysInGregorianMonth,
  isLeapGregorianYear,
  makeCivilDate,
  parseCivilDate,
  type CivilDate,
} from '../../domain/primitives/civil-date';
export {
  cycleStartForMonth,
  isDateWithinMonthlyWindow,
  makeMonthlyCycleAnchor,
  monthlyCycleContaining,
  monthlyCycleFollowing,
  monthlyWindowLengthInDays,
  type MonthlyCycleAnchor,
  type MonthlyCycleWindow,
} from '../../domain/primitives/monthly-cycle';
export { isValidTimeZoneName, MAX_REPRESENTABLE_INSTANT_MS, MIN_REPRESENTABLE_INSTANT_MS, resolveCivilDate, resolveCivilDateTime, type TimeZoneName } from '../../domain/primitives/instant';
export {
  adjustmentContribution,
  adjustmentResidual,
  boundaryFromObservation,
  classifyCurrencyLabel,
  compareOccurrenceToBoundary,
  compareResolvedBoundaries,
  deriveLedgerPoolAt,
  deriveReconciliationAmount,
  earliestCoveringObservation,
  isOccurrenceCoveredBy,
  linkedEffectAmount,
  linkedRootOccurrence,
  liveExpenseHeadAmount,
  liveInflowAmount,
  liveReturnHeadAmount,
  type BoundaryOrder,
  type FamilyOccurrence,
  type ResolvedBoundary,
} from '../../domain/recovery/derive';
export {
  applicableRevision,
  clampedDueDate,
  isOccurrencePaid,
  latestRevision,
  occurrenceExpectedAmount,
  occurrenceIdFor,
  planMaterialization,
  revisionsOf,
  type MaterializedOccurrence,
} from '../../domain/plans/derive';
export {
  carryActionFor,
  countEntriesOutsideWindow,
  countFactsOutsideWindow,
  downstreamConsumedKinds,
  downstreamState,
  effectiveAnchorForDate,
  effectiveCarryToCycle,
  effectiveSettingsAt,
  effectiveSettlementRemainder,
  effectiveTimeZoneForDate,
  findConflictResolution,
  fitsWithinRemainder,
  nextSettlementSeq,
  nextVersionSeq,
  overlapsOtherCycle,
  settlementConsumed,
  subtractOrThrow,
  sumDispositionTotal,
  unresolvedConflicts,
  type DownstreamState,
  type EffectiveSettings,
} from '../../domain/cycles/derive';
