/**
 * Public command API for Rushd's canonical finance engine (P03 Task A).
 *
 * Implemented in this task:
 * - `previewCommand` / `executeCommand` over four commands: createBook,
 *   openCycle, recordInflow, reverseInflow;
 * - checked integer money with a bilingual exact parser, strict civil dates,
 *   anchor-clamped monthly cycles, and instant-to-civil-date resolution in an
 *   explicit profile timezone (instants outside the platform-representable
 *   range are typed rejections, never thrown errors);
 * - revision-checked, idempotent, retry-safe execution with typed failures,
 *   receipts, and outbox envelopes, proven against a transactional in-memory
 *   adapter under `tests/domain/support/`. Inflows and reversals bind their
 *   financial date via `occurredAt` in the canonical payload, so the
 *   confirmed date cannot drift with the clock between preview and execution.
 *
 * Not implemented yet (later P03 tasks): obligations and settlements,
 * allocations, availability/pacing/completeness, Reality Check and recovery,
 * recurring plans, cycle close/carry/reopen, persistent storage, sync, and
 * browser wiring. Nothing here claims PWA, sync, account, security, or
 * release readiness.
 *
 * Usage:
 * ```ts
 * const preview = previewCommand(repository, command, context);
 * if (!preview.ok) throw new Error(describeCommandFailure(preview.failure));
 * const result = executeCommand(repository, command, {
 *   operationId: makeOperationIdValue(),
 *   expectedRevision: preview.preview.expectedRevision,
 *   previewDigest: preview.preview.previewDigest,
 * }, context);
 * // result.ok === true -> result.receipt.effects are the committed effects.
 * ```
 */

export { previewCommand } from './preview';
export { executeCommand } from './execute';
export { validateFinanceCommand, type CommandValidation, type ValidationIssue } from './validation';
export { requireCommandContext, type CommandContext, type DomainClock, type DomainIdFactory } from './context';
export type { ApplyResult } from './handlers';
export {
  COMMAND_REVERSAL_POLICY,
  describeCommandFailure,
  type CommandConfirmation,
  type CommandEffect,
  type CommandExecutionResult,
  type CommandFailure,
  type CommandKind,
  type CommandPreview,
  type CommandPreviewResult,
  type CommandReceipt,
  type CreateBookCommand,
  type FinanceCommand,
  type OpenCycleCommand,
  type OccurredAt,
  type OperationRecord,
  type OutboxEnvelope,
  type RecordInflowCommand,
  type ReversalPolicy,
  type ReverseInflowCommand,
} from '../../domain/contracts/commands';
export {
  findEntryById,
  findOpenCycle,
  findReversalOf,
  type BookState,
  type FinanceBook,
  type InflowEntry,
  type InflowReversalEntry,
  type LedgerEntry,
  type OpenCycleRecord,
} from '../../domain/contracts/ledger';
export {
  type EntryLocation,
  type FinanceReadModel,
  type RepositoryTransaction,
  type TransactionalRepository,
} from '../../domain/contracts/repository';
export { canonicalJson, stableDigest } from '../../domain/contracts/canonical';
export {
  composeCycleId,
  makeBookId,
  makeCycleId,
  makeEntryId,
  makeOperationId,
  makeOutboxId,
  type BookId,
  type CycleId,
  type EntryId,
  type OperationId,
  type OutboxId,
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
