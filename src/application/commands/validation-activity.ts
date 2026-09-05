/**
 * Runtime validators for actual activity commands.
 */

import { makeBookId, makeEntryId } from '../../domain/contracts/identity';
import type { CorrectExpenseCommand, RecordExpenseCommand, RecordExpenseReturnCommand } from '../../domain/contracts/commands';
import {
  DESCRIPTIVE_ABSENT,
  validateDescriptiveLink,
  validateId,
  validateMoneyInput,
  validateOccurredAt,
  validateShortText,
  validateCivilDateField,
  asRecord,
  requireKeys,
  rejectUnknownKeys,
  type ValidationIssue,
} from './validation-helpers';
import type { CommandValidation } from './validation';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export function validateActivityCommand(record: Record<string, unknown>): CommandValidation {
  switch (record['kind']) {
    case 'recordExpense':
      return validateRecordExpense(record);
    case 'correctExpense':
      return validateCorrectExpense(record);
    case 'recordExpenseReturn':
      return validateRecordExpenseReturn(record);
    default:
      return { ok: false, issues: [{ path: 'kind', problem: 'unknown activity command kind' }] };
  }
}

function validateRecordExpense(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'amount', 'occurredAt', 'note', 'category', 'flexibleDefinitionId'], issues);
  if (issues.length > 0) return { ok: false, issues };

  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const amount = validateMoneyInput(record['amount'], 'amount', 'positive', issues);
  const occurredAt = validateOccurredAt(record['occurredAt'], 'occurredAt', issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  // Explicit null means "no category yet"; the field is still required in the
  // payload so callers state their intent instead of losing data silently.
  const category = validateDescriptiveLink(record['category'], 'category', issues);
  const flexibleDefinitionId = validateDescriptiveLink(record['flexibleDefinitionId'], 'flexibleDefinitionId', issues);
  if (issues.length > 0 || bookId === null || amount === null || occurredAt === null) {
    return { ok: false, issues };
  }
  const command: RecordExpenseCommand = {
    kind: 'recordExpense',
    bookId,
    amount,
    occurredAt,
    note,
    category: category === DESCRIPTIVE_ABSENT ? null : category,
    flexibleDefinitionId: flexibleDefinitionId === DESCRIPTIVE_ABSENT ? null : flexibleDefinitionId,
  };
  return { ok: true, command };
}

function validateCorrectExpense(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'expenseEntryId', 'occurredAt', 'note', 'replacement'], issues);
  if (issues.length > 0) return { ok: false, issues };

  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const expenseEntryId = validateId(record['expenseEntryId'], 'expenseEntryId', makeEntryId, issues);
  const occurredAt = validateOccurredAt(record['occurredAt'], 'occurredAt', issues);
  const note = validateShortText(record['note'], 'note', issues, true);

  let replacement: CorrectExpenseCommand['replacement'] = null;
  if (record['replacement'] !== null) {
    const replacementRecord = asRecord(record['replacement']);
    if (replacementRecord === null) {
      issues.push({ path: 'replacement', problem: 'must be an object or null' });
      return { ok: false, issues };
    }
    rejectUnknownKeys(replacementRecord, ['amount', 'localDate', 'note', 'category', 'flexibleDefinitionId'], issues);
    const replacementFields: Mutable<NonNullable<CorrectExpenseCommand['replacement']>> = {};
    if (replacementRecord['amount'] !== undefined) {
      const parsed = validateMoneyInput(replacementRecord['amount'], 'replacement.amount', 'positive', issues);
      if (parsed === null) return { ok: false, issues };
      replacementFields.amount = parsed;
    }
    if (replacementRecord['localDate'] !== undefined) {
      const localDate = validateCivilDateField(replacementRecord['localDate'], 'replacement.localDate', issues);
      if (localDate === null) return { ok: false, issues };
      replacementFields.localDate = localDate;
    }
    if (replacementRecord['note'] !== undefined) {
      replacementFields.note = validateShortText(replacementRecord['note'], 'replacement.note', issues, false);
    }
    if (replacementRecord['category'] !== undefined) {
      const category = validateDescriptiveLink(replacementRecord['category'], 'replacement.category', issues);
      if (category === DESCRIPTIVE_ABSENT) return { ok: false, issues };
      replacementFields.category = category;
    }
    if (replacementRecord['flexibleDefinitionId'] !== undefined) {
      const flexible = validateDescriptiveLink(replacementRecord['flexibleDefinitionId'], 'replacement.flexibleDefinitionId', issues);
      if (flexible === DESCRIPTIVE_ABSENT) return { ok: false, issues };
      replacementFields.flexibleDefinitionId = flexible;
    }
    replacement = replacementFields;
  }

  if (issues.length > 0 || bookId === null || expenseEntryId === null || occurredAt === null) {
    return { ok: false, issues };
  }
  const command: CorrectExpenseCommand = { kind: 'correctExpense', bookId, expenseEntryId, occurredAt, note, replacement };
  return { ok: true, command };
}

function validateRecordExpenseReturn(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'expenseEntryId', 'amount', 'occurredAt', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };

  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const expenseEntryId = validateId(record['expenseEntryId'], 'expenseEntryId', makeEntryId, issues);
  const amount = validateMoneyInput(record['amount'], 'amount', 'positive', issues);
  const occurredAt = validateOccurredAt(record['occurredAt'], 'occurredAt', issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || expenseEntryId === null || amount === null || occurredAt === null) {
    return { ok: false, issues };
  }
  const command: RecordExpenseReturnCommand = {
    kind: 'recordExpenseReturn',
    bookId,
    expenseEntryId,
    amount,
    occurredAt,
    note,
  };
  return { ok: true, command };
}
