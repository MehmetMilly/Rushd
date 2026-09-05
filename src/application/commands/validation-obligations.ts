/**
 * Runtime validators for obligation commands.
 */

import { makeBookId, makeObligationId } from '../../domain/contracts/identity';
import type {
  CreateObligationCommand,
  RecordObligationPaymentCommand,
  RecordObligationReturnCommand,
  SettleObligationFinallyCommand,
} from '../../domain/contracts/commands';
import {
  DESCRIPTIVE_ABSENT,
  validateDescriptiveLink,
  validateId,
  validateMoneyInput,
  validateOccurredAt,
  validateShortText,
  requireKeys,
  type ValidationIssue,
} from './validation-helpers';
import type { CommandValidation } from './validation';

export function validateObligationCommand(record: Record<string, unknown>): CommandValidation {
  switch (record['kind']) {
    case 'createObligation':
      return validateCreateObligation(record);
    case 'recordObligationPayment':
      return validateRecordObligationPayment(record);
    case 'recordObligationReturn':
      return validateRecordObligationReturn(record);
    case 'settleObligationFinally':
      return validateObligationReference(record, 'settleObligationFinally');
    case 'cancelObligation':
      return validateObligationReference(record, 'cancelObligation');
    case 'reopenObligation':
      return validateObligationReference(record, 'reopenObligation');
    case 'openObligationDispute':
      return validateObligationReference(record, 'openObligationDispute');
    case 'releaseDisputedResidual':
      return validateObligationReference(record, 'releaseDisputedResidual');
    default:
      return { ok: false, issues: [{ path: 'kind', problem: 'unknown obligation command kind' }] };
  }
}

function validateCreateObligation(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'obligationId', 'expectedAmount', 'note', 'category'], issues);
  if (issues.length > 0) return { ok: false, issues };

  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const obligationId = validateId(record['obligationId'], 'obligationId', makeObligationId, issues);
  const expectedAmount = validateMoneyInput(record['expectedAmount'], 'expectedAmount', 'positive', issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  const category = validateDescriptiveLink(record['category'], 'category', issues);
  if (issues.length > 0 || bookId === null || obligationId === null || expectedAmount === null) {
    return { ok: false, issues };
  }
  const command: CreateObligationCommand = {
    kind: 'createObligation',
    bookId,
    obligationId,
    expectedAmount,
    note,
    category: category === DESCRIPTIVE_ABSENT ? null : category,
  };
  return { ok: true, command };
}

function validateRecordObligationPayment(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'obligationId', 'amount', 'occurredAt', 'note', 'category'], issues);
  if (issues.length > 0) return { ok: false, issues };

  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const obligationId = validateId(record['obligationId'], 'obligationId', makeObligationId, issues);
  const amount = validateMoneyInput(record['amount'], 'amount', 'positive', issues);
  const occurredAt = validateOccurredAt(record['occurredAt'], 'occurredAt', issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  const category = validateDescriptiveLink(record['category'], 'category', issues);
  if (issues.length > 0 || bookId === null || obligationId === null || amount === null || occurredAt === null) {
    return { ok: false, issues };
  }
  const command: RecordObligationPaymentCommand = {
    kind: 'recordObligationPayment',
    bookId,
    obligationId,
    amount,
    occurredAt,
    note,
    category: category === DESCRIPTIVE_ABSENT ? null : category,
  };
  return { ok: true, command };
}

function validateRecordObligationReturn(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'obligationId', 'amount', 'occurredAt', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };

  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const obligationId = validateId(record['obligationId'], 'obligationId', makeObligationId, issues);
  const amount = validateMoneyInput(record['amount'], 'amount', 'positive', issues);
  const occurredAt = validateOccurredAt(record['occurredAt'], 'occurredAt', issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || obligationId === null || amount === null || occurredAt === null) {
    return { ok: false, issues };
  }
  const command: RecordObligationReturnCommand = {
    kind: 'recordObligationReturn',
    bookId,
    obligationId,
    amount,
    occurredAt,
    note,
  };
  return { ok: true, command };
}

/** Shared shape for lifecycle commands that only reference an obligation. */
function validateObligationReference(
  record: Record<string, unknown>,
  kind: 'settleObligationFinally' | 'cancelObligation' | 'reopenObligation' | 'openObligationDispute' | 'releaseDisputedResidual',
): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'obligationId', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };

  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const obligationId = validateId(record['obligationId'], 'obligationId', makeObligationId, issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || obligationId === null) {
    return { ok: false, issues };
  }
  const command = { kind, bookId, obligationId, note } as SettleObligationFinallyCommand;
  return { ok: true, command };
}
