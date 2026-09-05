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
import type { BookId, CycleId, EntryId, OperationId } from './identity';

export type CommandKind = 'createBook' | 'openCycle' | 'recordInflow' | 'reverseInflow';

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

/** Either the user names the civil date, or an instant is resolved in the book timezone. */
export type InflowOccurredAt =
  | { readonly kind: 'civilDate'; readonly localDate: CivilDate }
  | { readonly kind: 'instant'; readonly instantMs: number };

export interface RecordInflowCommand {
  readonly kind: 'recordInflow';
  readonly bookId: BookId;
  /** Strictly positive book-currency amount. */
  readonly amount: Money;
  readonly occurredAt: InflowOccurredAt;
  readonly note: string;
}

export interface ReverseInflowCommand {
  readonly kind: 'reverseInflow';
  readonly bookId: BookId;
  readonly inflowEntryId: EntryId;
  readonly note: string;
}

export type FinanceCommand = CreateBookCommand | OpenCycleCommand | RecordInflowCommand | ReverseInflowCommand;

/**
 * Declared reversal policy per command kind:
 * - createBook/openCycle: no reversal exists yet in Task A (later P03 tasks
 *   add previewed lifecycle corrections).
 * - recordInflow: reversible by appending a linked reversal fact.
 * - reverseInflow: itself a linked reversal; it is never reversed, a new
 *   inflow corrects it.
 */
export type ReversalPolicy = 'lifecycleCorrectionLaterTask' | 'appendsLinkedReversal' | 'isALinkedReversal';

export const COMMAND_REVERSAL_POLICY: Readonly<Record<CommandKind, ReversalPolicy>> = Object.freeze({
  createBook: 'lifecycleCorrectionLaterTask',
  openCycle: 'lifecycleCorrectionLaterTask',
  recordInflow: 'appendsLinkedReversal',
  reverseInflow: 'isALinkedReversal',
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
  | { readonly kind: 'notAnInflow'; readonly bookId: BookId; readonly entryId: EntryId };

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
  }
}
