/**
 * Runtime validators for goal, tracked-allocation, and buffer commands.
 */

import { makeAllocationRecordId, makeBookId, makeCycleId, makeGoalId } from '../../domain/contracts/identity';
import type {
  AssignToGoalCommand,
  CreateGoalCommand,
  FundAllocationPoolCommand,
  ReleaseAllocationCommand,
  ReverseAllocationRecordCommand,
  UnassignFromGoalCommand,
} from '../../domain/contracts/commands';
import {
  validateId,
  validateMoneyInput,
  validateOccurredAt,
  validateShortText,
  requireKeys,
  type ValidationIssue,
} from './validation-helpers';
import type { CommandValidation } from './validation';

export function validateAllocationCommand(record: Record<string, unknown>): CommandValidation {
  switch (record['kind']) {
    case 'createGoal':
      return validateCreateGoal(record);
    case 'fundAllocationPool':
      return validateFundAllocationPool(record);
    case 'assignToGoal':
      return validateAssignToGoal(record);
    case 'unassignFromGoal':
      return validateUnassignFromGoal(record);
    case 'releaseAllocation':
      return validateReleaseAllocation(record);
    case 'reverseAllocationRecord':
      return validateReverseAllocationRecord(record);
    default:
      return { ok: false, issues: [{ path: 'kind', problem: 'unknown allocation command kind' }] };
  }
}

function validateCreateGoal(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'goalId', 'name', 'targetAmount'], issues);
  if (issues.length > 0) return { ok: false, issues };

  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const goalId = validateId(record['goalId'], 'goalId', makeGoalId, issues);
  const name = validateShortText(record['name'], 'name', issues, false);
  const targetAmount = validateMoneyInput(record['targetAmount'], 'targetAmount', 'positive', issues);
  if (issues.length > 0 || bookId === null || goalId === null || targetAmount === null) {
    return { ok: false, issues };
  }
  const command: CreateGoalCommand = { kind: 'createGoal', bookId, goalId, name, targetAmount };
  return { ok: true, command };
}

function validateFundAllocationPool(record: Record<string, unknown>): CommandValidation {
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
  const command: FundAllocationPoolCommand = { kind: 'fundAllocationPool', bookId, amount, occurredAt, note };
  return { ok: true, command };
}

function validateAssignToGoal(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'goalId', 'amount', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };

  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const goalId = validateId(record['goalId'], 'goalId', makeGoalId, issues);
  const amount = validateMoneyInput(record['amount'], 'amount', 'positive', issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || goalId === null || amount === null) {
    return { ok: false, issues };
  }
  const command: AssignToGoalCommand = { kind: 'assignToGoal', bookId, goalId, amount, note };
  return { ok: true, command };
}

function validateUnassignFromGoal(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'goalId', 'amount', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };

  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const goalId = validateId(record['goalId'], 'goalId', makeGoalId, issues);
  const amount = validateMoneyInput(record['amount'], 'amount', 'positive', issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || goalId === null || amount === null) {
    return { ok: false, issues };
  }
  const command: UnassignFromGoalCommand = { kind: 'unassignFromGoal', bookId, goalId, amount, note };
  return { ok: true, command };
}

function validateReleaseAllocation(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'goalId', 'amount', 'destinationCycleId', 'occurredAt', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };

  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  // Explicit null releases from tracked-unallocated; a goal id names the source.
  const goalId = record['goalId'] === null ? null : validateId(record['goalId'], 'goalId', makeGoalId, issues);
  const amount = validateMoneyInput(record['amount'], 'amount', 'positive', issues);
  const destinationCycleId = validateId(record['destinationCycleId'], 'destinationCycleId', makeCycleId, issues);
  const occurredAt = validateOccurredAt(record['occurredAt'], 'occurredAt', issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || amount === null || destinationCycleId === null || occurredAt === null) {
    return { ok: false, issues };
  }
  const command: ReleaseAllocationCommand = {
    kind: 'releaseAllocation',
    bookId,
    goalId,
    amount,
    destinationCycleId,
    occurredAt,
    note,
  };
  return { ok: true, command };
}

function validateReverseAllocationRecord(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'allocationRecordId', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };

  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const allocationRecordId = validateId(record['allocationRecordId'], 'allocationRecordId', makeAllocationRecordId, issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || allocationRecordId === null) {
    return { ok: false, issues };
  }
  const command: ReverseAllocationRecordCommand = { kind: 'reverseAllocationRecord', bookId, allocationRecordId, note };
  return { ok: true, command };
}
