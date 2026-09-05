/**
 * Runtime validation of raw commands (hub).
 *
 * Everything crossing the application boundary — UI, import, sync, or an AI
 * proposal — is `unknown` until it passes through this module. Validation is
 * strict: the object must be a plain record with exactly the allowed fields,
 * every field must have its declared type, and money inputs must be exact
 * checked values. Validation issues are reported as typed failures, never as
 * exceptions, so malformed input can never mutate state.
 *
 * Task A's four command validators stay here; Task B's per-domain validators
 * live in `validation-activity`, `validation-obligations`, and
 * `validation-allocations` and are dispatched from `validateFinanceCommand`.
 */

import { isSupportedCurrency } from '../../domain/primitives/currency';
import {
  makeBookId,
  makeEntryId,
  makeOperationId,
  type OperationId,
} from '../../domain/contracts/identity';
import type {
  CreateBookCommand,
  FinanceCommand,
  OpenCycleCommand,
  RecordInflowCommand,
  ReverseInflowCommand,
  SetBufferCommand,
} from '../../domain/contracts/commands';
import {
  validateMoneyInput,
  validateOccurredAt,
  validateTimeZoneField,
  validateCycleAnchorField,
  validateId,
  validateShortText,
  validateCivilDateField,
  requireKeys,
  type ValidationIssue,
} from './validation-helpers';
import { validateActivityCommand } from './validation-activity';
import { validateObligationCommand } from './validation-obligations';
import { validateAllocationCommand } from './validation-allocations';

export type { ValidationIssue } from './validation-helpers';

export type CommandValidation =
  | { readonly ok: true; readonly command: FinanceCommand }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function validateFinanceCommand(raw: unknown): CommandValidation {
  const record = asRecord(raw);
  if (record === null) {
    return { ok: false, issues: [{ path: '', problem: 'command must be a JSON object' }] };
  }
  switch (record['kind']) {
    case 'createBook':
      return validateCreateBook(record);
    case 'openCycle':
      return validateOpenCycle(record);
    case 'recordInflow':
      return validateRecordInflow(record);
    case 'reverseInflow':
      return validateReverseInflow(record);
    case 'recordExpense':
    case 'correctExpense':
    case 'recordExpenseReturn':
    case 'correctExpenseReturn':
      return validateActivityCommand(record);
    case 'createObligation':
    case 'recordObligationPayment':
    case 'recordObligationReturn':
    case 'settleObligationFinally':
    case 'cancelObligation':
    case 'reopenObligation':
    case 'openObligationDispute':
    case 'resolveObligationDispute':
    case 'releaseDisputedResidual':
      return validateObligationCommand(record);
    case 'createGoal':
    case 'fundAllocationPool':
    case 'assignToGoal':
    case 'unassignFromGoal':
    case 'releaseAllocation':
    case 'reverseAllocationRecord':
      return validateAllocationCommand(record);
    case 'setBuffer':
      return validateSetBuffer(record);
    default:
      return { ok: false, issues: [{ path: 'kind', problem: 'unknown command kind' }] };
  }
}

function validateCreateBook(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'displayName', 'currency', 'timeZone', 'cycleAnchor'], issues);
  if (issues.length > 0) return { ok: false, issues };

  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const displayName = validateShortText(record['displayName'], 'displayName', issues, true);
  if (!isSupportedCurrency(record['currency'])) {
    issues.push({ path: 'currency', problem: 'must be a supported ISO currency code' });
    return { ok: false, issues };
  }
  const timeZone = validateTimeZoneField(record['timeZone'], 'timeZone', issues);
  const cycleAnchor = validateCycleAnchorField(record['cycleAnchor'], 'cycleAnchor', issues);
  if (issues.length > 0 || bookId === null || timeZone === null || cycleAnchor === null) {
    return { ok: false, issues };
  }
  const command: CreateBookCommand = {
    kind: 'createBook',
    bookId,
    displayName,
    currency: record['currency'] as CreateBookCommand['currency'],
    timeZone,
    cycleAnchor,
  };
  return { ok: true, command };
}

function validateOpenCycle(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'startingFunds', 'startDate'], issues);
  if (issues.length > 0) return { ok: false, issues };

  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const startingFunds = validateMoneyInput(record['startingFunds'], 'startingFunds', 'nonNegative', issues);
  const startDate = validateCivilDateField(record['startDate'], 'startDate', issues);
  if (issues.length > 0 || bookId === null || startingFunds === null || startDate === null) {
    return { ok: false, issues };
  }
  const command: OpenCycleCommand = { kind: 'openCycle', bookId, startingFunds, startDate };
  return { ok: true, command };
}

function validateRecordInflow(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'amount', 'occurredAt', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };

  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const amount = validateMoneyInput(record['amount'], 'amount', 'positive', issues);
  const occurredAt = validateOccurredAt(record['occurredAt'], 'occurredAt', issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || amount === null || occurredAt === null) {
    return { ok: false, issues };
  }
  const command: RecordInflowCommand = { kind: 'recordInflow', bookId, amount, occurredAt, note };
  return { ok: true, command };
}

function validateReverseInflow(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'inflowEntryId', 'occurredAt', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };

  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const inflowEntryId = validateId(record['inflowEntryId'], 'inflowEntryId', makeEntryId, issues);
  const occurredAt = validateOccurredAt(record['occurredAt'], 'occurredAt', issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || inflowEntryId === null || occurredAt === null) {
    return { ok: false, issues };
  }
  const command: ReverseInflowCommand = { kind: 'reverseInflow', bookId, inflowEntryId, occurredAt, note };
  return { ok: true, command };
}

function validateSetBuffer(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'buffer', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };

  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const buffer = validateMoneyInput(record['buffer'], 'buffer', 'nonNegative', issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || buffer === null) {
    return { ok: false, issues };
  }
  const command: SetBufferCommand = { kind: 'setBuffer', bookId, buffer, note };
  return { ok: true, command };
}

/** Used by execute to validate the caller-supplied operation ID. */
export function validateOperationId(value: unknown): OperationId | null {
  return validateId(value, 'operationId', makeOperationId, []);
}
