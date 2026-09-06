/**
 * Runtime validators for Task C commands: boundary cycles, Reality Check and
 * recovery, recurring plans, settings/rebase, and cycle lifecycle.
 *
 * Strict like every other command family: exact allowed fields, declared
 * types, exact checked money. Issues are typed values, never thrown, so
 * malformed input can never mutate state.
 */

import {
  makeBookId,
  makeCycleId,
  makeEntryId,
  makeObligationId,
  makeObservationId,
  makeOccurrenceId,
  makePlanId,
  makeSettlementId,
  type BookId,
  type CycleId,
  type EntryId,
} from '../../domain/contracts/identity';
import type { Money } from '../../domain/primitives/money';
import type { OccurredAt } from '../../domain/contracts/commands';
import type {
  CloseCycleCommand,
  CreateRecurringPlanCommand,
  DetachPlanOccurrenceCommand,
  DisposeCycleRemainderCommand,
  MaterializePlanOccurrencesCommand,
  ObservationBoundary,
  OpenBoundaryCycleCommand,
  RebaseOpenCycleCommand,
  RecordClosedCycleCorrectionCommand,
  RecordRealityCheckCommand,
  RecoverObservedActivityCommand,
  RemainderDispositionInput,
  ReopenCycleCommand,
  ReservePlanOccurrenceCommand,
  ResolvePropagationConflictCommand,
  ReviseRecurringPlanCommand,
  UpdateBookSettingsCommand,
} from '../../domain/contracts/commands';
import type { MonthlyCycleAnchor } from '../../domain/primitives/monthly-cycle';
import type { TimeZoneName } from '../../domain/primitives/instant';
import {
  asRecord,
  rejectUnknownKeys,
  requireKeys,
  validateCycleAnchorField,
  validateDescriptiveLink,
  validateId,
  validateMoneyInput,
  validateOccurredAt,
  validateShortText,
  validateCivilDateField,
  validateTimeZoneField,
  type ValidationIssue,
} from './validation-helpers';
import type { CommandValidation } from './validation';

export function validateTaskCCommand(record: Record<string, unknown>): CommandValidation {
  switch (record['kind']) {
    case 'openBoundaryCycle':
      return validateOpenBoundaryCycle(record);
    case 'recordRealityCheck':
      return validateRecordRealityCheck(record);
    case 'recoverObservedActivity':
      return validateRecoverObservedActivity(record);
    case 'createRecurringPlan':
      return validateCreateRecurringPlan(record);
    case 'reviseRecurringPlan':
      return validateReviseRecurringPlan(record);
    case 'materializePlanOccurrences':
      return validateMaterializePlanOccurrences(record);
    case 'detachPlanOccurrence':
      return validateDetachPlanOccurrence(record);
    case 'reservePlanOccurrence':
      return validateReservePlanOccurrence(record);
    case 'updateBookSettings':
      return validateUpdateBookSettings(record);
    case 'rebaseOpenCycle':
      return validateRebaseOpenCycle(record);
    case 'closeCycle':
      return validateCloseCycle(record);
    case 'disposeCycleRemainder':
      return validateDisposeCycleRemainder(record);
    case 'reopenCycle':
      return validateReopenCycle(record);
    case 'recordClosedCycleCorrection':
      return validateRecordClosedCycleCorrection(record);
    case 'resolvePropagationConflict':
      return validateResolvePropagationConflict(record);
    default:
      return { ok: false, issues: [{ path: 'kind', problem: 'unknown Task C command kind' }] };
  }
}

const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

function validateBoundaryField(value: unknown, path: string, issues: ValidationIssue[]): ObservationBoundary | null {
  const record = asRecord(value);
  if (record === null) {
    issues.push({ path, problem: 'must be an object' });
    return null;
  }
  if (record['kind'] === 'instant') {
    requireKeys(record, ['kind', 'instantMs'], issues);
    if (issues.length > 0) return null;
    const instantMs = record['instantMs'];
    if (typeof instantMs !== 'number' || !Number.isSafeInteger(instantMs)) {
      issues.push({ path: `${path}.instantMs`, problem: 'must be a safe-integer epoch millisecond value' });
      return null;
    }
    return { kind: 'instant', instantMs };
  }
  if (record['kind'] === 'civilDateTime') {
    requireKeys(record, ['kind', 'localDate', 'localTime'], issues);
    if (issues.length > 0) return null;
    const localDate = validateCivilDateField(record['localDate'], `${path}.localDate`, issues);
    const rawTime = record['localTime'];
    if (typeof rawTime !== 'string' || !LOCAL_TIME_PATTERN.test(rawTime)) {
      issues.push({ path: `${path}.localTime`, problem: 'must be HH:MM:SS wall time' });
      return null;
    }
    if (localDate === null || issues.length > 0) return null;
    return { kind: 'civilDateTime', localDate, localTime: rawTime };
  }
  issues.push({ path: `${path}.kind`, problem: "must be 'instant' or 'civilDateTime'" });
  return null;
}

function validateMovementKind(value: unknown, path: string, issues: ValidationIssue[]): 'expense' | 'inflow' | 'return' | null {
  if (value === 'expense' || value === 'inflow' || value === 'return') return value;
  issues.push({ path, problem: "must be 'expense', 'inflow', or 'return'" });
  return null;
}

function validateScheduleDay(value: unknown, path: string, issues: ValidationIssue[]): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 31) {
    issues.push({ path, problem: 'must be an integer schedule day 1-31' });
    return null;
  }
  return value;
}

function validateNullableCycleAnchor(value: unknown, path: string, issues: ValidationIssue[]): MonthlyCycleAnchor | null | 'invalid' {
  if (value === null) return null;
  const record = asRecord(value);
  if (record === null) {
    issues.push({ path, problem: 'must be an object or null' });
    return 'invalid';
  }
  const anchor = validateCycleAnchorField(value, path, issues);
  return anchor === null ? 'invalid' : anchor;
}

function validateNullableTimeZone(value: unknown, path: string, issues: ValidationIssue[]): TimeZoneName | null | 'invalid' {
  if (value === null) return null;
  const zone = validateTimeZoneField(value, path, issues);
  return zone === null ? 'invalid' : zone;
}

function validateOpenBoundaryCycle(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'observedPool', 'boundary', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };
  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const observedPool = validateMoneyInput(record['observedPool'], 'observedPool', 'nonNegative', issues);
  const boundary = validateBoundaryField(record['boundary'], 'boundary', issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || observedPool === null || boundary === null) {
    return { ok: false, issues };
  }
  const command: OpenBoundaryCycleCommand = { kind: 'openBoundaryCycle', bookId, observedPool, boundary, note };
  return { ok: true, command };
}

function validateRecordRealityCheck(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'observedPool', 'boundary', 'currencyLabel', 'classificationNote', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };
  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const observedPool = validateMoneyInput(record['observedPool'], 'observedPool', 'nonNegative', issues);
  const boundary = validateBoundaryField(record['boundary'], 'boundary', issues);
  const rawLabel = record['currencyLabel'];
  if (rawLabel !== null && typeof rawLabel !== 'string') {
    issues.push({ path: 'currencyLabel', problem: 'must be a string or null' });
  }
  const rawClassification = record['classificationNote'];
  if (rawClassification !== null && typeof rawClassification !== 'string') {
    issues.push({ path: 'classificationNote', problem: 'must be a string or null' });
  }
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || observedPool === null || boundary === null) {
    return { ok: false, issues };
  }
  const command: RecordRealityCheckCommand = {
    kind: 'recordRealityCheck',
    bookId,
    observedPool,
    boundary,
    currencyLabel: rawLabel as string | null,
    classificationNote: rawClassification as string | null,
    note,
  };
  return { ok: true, command };
}

interface RecoveryFields {
  readonly bookId: BookId;
  readonly movementKind: 'expense' | 'inflow' | 'return';
  readonly amount: Money;
  readonly occurredAt: OccurredAt;
  readonly note: string;
  readonly category: string | null;
  readonly linkedExpenseEntryId: EntryId | null;
}

function validateRecoveryFields(record: Record<string, unknown>, issues: ValidationIssue[]): RecoveryFields | null {
  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const movementKind = validateMovementKind(record['movementKind'], 'movementKind', issues);
  const amount = validateMoneyInput(record['amount'], 'amount', 'positive', issues);
  const occurredAt = validateOccurredAt(record['occurredAt'], 'occurredAt', issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  const category = validateDescriptiveLink(record['category'], 'category', issues);
  const rawLink = record['linkedExpenseEntryId'];
  let linked: EntryId | null = null;
  if (rawLink !== null && rawLink !== undefined) {
    linked = validateId(rawLink, 'linkedExpenseEntryId', makeEntryId, issues);
  }
  if (issues.length > 0 || bookId === null || movementKind === null || amount === null || occurredAt === null) {
    return null;
  }
  return {
    bookId,
    movementKind,
    amount,
    occurredAt,
    note,
    category: typeof category === 'string' ? category : null,
    linkedExpenseEntryId: linked,
  };
}

/** Return-link rule for fresh recovery facts (not linked corrections). */
function checkFreshReturnLink(fields: RecoveryFields, issues: ValidationIssue[]): boolean {
  if (fields.movementKind === 'return' && fields.linkedExpenseEntryId === null) {
    issues.push({ path: 'linkedExpenseEntryId', problem: 'a recovered return must name the refunded expense' });
    return false;
  }
  if (fields.movementKind !== 'return' && fields.linkedExpenseEntryId !== null) {
    issues.push({ path: 'linkedExpenseEntryId', problem: 'only a recovered return links an expense' });
    return false;
  }
  return true;
}

function validateRecoverObservedActivity(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'observationId', 'movementKind', 'amount', 'occurredAt', 'note', 'category', 'linkedExpenseEntryId'], issues);
  if (issues.length > 0) return { ok: false, issues };
  const observationId = validateId(record['observationId'], 'observationId', makeObservationId, issues);
  const fields = validateRecoveryFields(record, issues);
  if (fields !== null && !checkFreshReturnLink(fields, issues)) {
    return { ok: false, issues };
  }
  if (issues.length > 0 || observationId === null || fields === null) {
    return { ok: false, issues };
  }
  const command: RecoverObservedActivityCommand = {
    kind: 'recoverObservedActivity',
    bookId: fields.bookId,
    observationId,
    movementKind: fields.movementKind,
    amount: fields.amount,
    occurredAt: fields.occurredAt,
    note: fields.note,
    category: fields.category,
    linkedExpenseEntryId: fields.linkedExpenseEntryId,
  };
  return { ok: true, command };
}

function validateRecordClosedCycleCorrection(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'targetCycleId', 'movementKind', 'amount', 'occurredAt', 'note', 'category', 'linkedExpenseEntryId', 'correctsEntryId', 'replacement'], issues);
  if (issues.length > 0) return { ok: false, issues };
  const targetCycleId = validateId(record['targetCycleId'], 'targetCycleId', makeCycleId, issues);
  const fields = validateRecoveryFields(record, issues);
  let correctsEntryId: EntryId | null = null;
  if (record['correctsEntryId'] !== null && record['correctsEntryId'] !== undefined) {
    correctsEntryId = validateId(record['correctsEntryId'], 'correctsEntryId', makeEntryId, issues);
  }
  let replacement: RecordClosedCycleCorrectionCommand['replacement'] = null;
  if (record['replacement'] !== null && record['replacement'] !== undefined) {
    const replacementRecord = asRecord(record['replacement']);
    if (replacementRecord === null) {
      issues.push({ path: 'replacement', problem: 'must be an object or null' });
      return { ok: false, issues };
    }
    rejectUnknownKeys(replacementRecord, ['amount', 'note'], issues);
    const amount = validateMoneyInput(replacementRecord['amount'], 'replacement.amount', 'positive', issues);
    let note: string | undefined;
    if (replacementRecord['note'] !== undefined) {
      note = validateShortText(replacementRecord['note'], 'replacement.note', issues, false);
    }
    if (amount === null || issues.length > 0) return { ok: false, issues };
    replacement = note === undefined ? { amount } : { amount, note };
  }
  if (issues.length > 0 || targetCycleId === null || fields === null) {
    return { ok: false, issues };
  }
  if (replacement !== null && correctsEntryId === null) {
    issues.push({ path: 'replacement', problem: 'a replacement requires correctsEntryId' });
    return { ok: false, issues };
  }
  // A linked correction inherits the target's links; only a new return fact
  // names its refunded expense.
  if (correctsEntryId !== null) {
    if (fields.linkedExpenseEntryId !== null) {
      issues.push({ path: 'linkedExpenseEntryId', problem: 'a linked correction inherits the target links and must not name one' });
      return { ok: false, issues };
    }
  } else if (!checkFreshReturnLink(fields, issues)) {
    return { ok: false, issues };
  }
  const command: RecordClosedCycleCorrectionCommand = {
    kind: 'recordClosedCycleCorrection',
    bookId: fields.bookId,
    targetCycleId,
    movementKind: fields.movementKind,
    amount: fields.amount,
    occurredAt: fields.occurredAt,
    note: fields.note,
    category: fields.category,
    linkedExpenseEntryId: fields.linkedExpenseEntryId,
    correctsEntryId,
    replacement,
  };
  return { ok: true, command };
}

function validateCreateRecurringPlan(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'planId', 'name', 'amount', 'scheduleDay', 'effectiveDate', 'flexibleDefinitionId'], issues);
  if (issues.length > 0) return { ok: false, issues };
  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const planId = validateId(record['planId'], 'planId', makePlanId, issues);
  const name = validateShortText(record['name'], 'name', issues, false);
  const amount = validateMoneyInput(record['amount'], 'amount', 'positive', issues);
  const scheduleDay = validateScheduleDay(record['scheduleDay'], 'scheduleDay', issues);
  const effectiveDate = validateCivilDateField(record['effectiveDate'], 'effectiveDate', issues);
  const flexible = validateDescriptiveLink(record['flexibleDefinitionId'], 'flexibleDefinitionId', issues);
  if (issues.length > 0 || bookId === null || planId === null || amount === null || scheduleDay === null || effectiveDate === null) {
    return { ok: false, issues };
  }
  if (name === '') {
    issues.push({ path: 'name', problem: 'must be a non-empty name' });
    return { ok: false, issues };
  }
  const command: CreateRecurringPlanCommand = {
    kind: 'createRecurringPlan',
    bookId,
    planId,
    name,
    amount,
    scheduleDay,
    effectiveDate,
    flexibleDefinitionId: typeof flexible === 'string' ? flexible : null,
  };
  return { ok: true, command };
}

function validateReviseRecurringPlan(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'planId', 'effectiveDate', 'amount', 'scheduleDay', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };
  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const planId = validateId(record['planId'], 'planId', makePlanId, issues);
  const effectiveDate = validateCivilDateField(record['effectiveDate'], 'effectiveDate', issues);
  const amount = validateMoneyInput(record['amount'], 'amount', 'positive', issues);
  const scheduleDay = validateScheduleDay(record['scheduleDay'], 'scheduleDay', issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || planId === null || effectiveDate === null || amount === null || scheduleDay === null) {
    return { ok: false, issues };
  }
  const command: ReviseRecurringPlanCommand = { kind: 'reviseRecurringPlan', bookId, planId, effectiveDate, amount, scheduleDay, note };
  return { ok: true, command };
}

function validateMaterializePlanOccurrences(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'planId', 'throughDate'], issues);
  if (issues.length > 0) return { ok: false, issues };
  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const planId = validateId(record['planId'], 'planId', makePlanId, issues);
  const throughDate = validateCivilDateField(record['throughDate'], 'throughDate', issues);
  if (issues.length > 0 || bookId === null || planId === null || throughDate === null) {
    return { ok: false, issues };
  }
  const command: MaterializePlanOccurrencesCommand = { kind: 'materializePlanOccurrences', bookId, planId, throughDate };
  return { ok: true, command };
}

function validateDetachPlanOccurrence(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'occurrenceId', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };
  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const occurrenceId = validateId(record['occurrenceId'], 'occurrenceId', makeOccurrenceId, issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || occurrenceId === null) {
    return { ok: false, issues };
  }
  const command: DetachPlanOccurrenceCommand = { kind: 'detachPlanOccurrence', bookId, occurrenceId, note };
  return { ok: true, command };
}

function validateReservePlanOccurrence(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'occurrenceId', 'obligationId', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };
  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const occurrenceId = validateId(record['occurrenceId'], 'occurrenceId', makeOccurrenceId, issues);
  const obligationId = validateId(record['obligationId'], 'obligationId', makeObligationId, issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || occurrenceId === null || obligationId === null) {
    return { ok: false, issues };
  }
  const command: ReservePlanOccurrenceCommand = { kind: 'reservePlanOccurrence', bookId, occurrenceId, obligationId, note };
  return { ok: true, command };
}

function validateUpdateBookSettings(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'timeZone', 'cycleAnchor', 'weekStart', 'effectiveDate', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };
  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const timeZone = validateNullableTimeZone(record['timeZone'], 'timeZone', issues);
  const cycleAnchor = validateNullableCycleAnchor(record['cycleAnchor'], 'cycleAnchor', issues);
  const rawWeekStart = record['weekStart'];
  let weekStart: number | null = null;
  if (rawWeekStart !== null) {
    if (typeof rawWeekStart !== 'number' || !Number.isSafeInteger(rawWeekStart) || rawWeekStart < 0 || rawWeekStart > 6) {
      issues.push({ path: 'weekStart', problem: 'must be an integer 0-6 (Sunday-Saturday) or null' });
    } else {
      weekStart = rawWeekStart;
    }
  }
  const effectiveDate = validateCivilDateField(record['effectiveDate'], 'effectiveDate', issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || timeZone === 'invalid' || cycleAnchor === 'invalid' || effectiveDate === null) {
    return { ok: false, issues };
  }
  if (timeZone === null && cycleAnchor === null && weekStart === null) {
    issues.push({ path: 'weekStart', problem: 'at least one of timeZone, cycleAnchor, or weekStart must change' });
    return { ok: false, issues };
  }
  const command: UpdateBookSettingsCommand = {
    kind: 'updateBookSettings',
    bookId,
    timeZone,
    cycleAnchor,
    weekStart,
    effectiveDate,
    note,
  };
  return { ok: true, command };
}

function validateRebaseOpenCycle(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'timeZone', 'cycleAnchor', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };
  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const timeZone = validateTimeZoneField(record['timeZone'], 'timeZone', issues);
  const cycleAnchor = validateCycleAnchorField(record['cycleAnchor'], 'cycleAnchor', issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || timeZone === null || cycleAnchor === null) {
    return { ok: false, issues };
  }
  const command: RebaseOpenCycleCommand = { kind: 'rebaseOpenCycle', bookId, timeZone, cycleAnchor, note };
  return { ok: true, command };
}

function validateCloseCycle(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'cycleId', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };
  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  let parsedCycle: CycleId | null = null;
  if (record['cycleId'] !== null) {
    parsedCycle = validateId(record['cycleId'], 'cycleId', makeCycleId, issues);
  }
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null) {
    return { ok: false, issues };
  }
  const command: CloseCycleCommand = { kind: 'closeCycle', bookId, cycleId: parsedCycle, note };
  return { ok: true, command };
}

function validateDispositionField(value: unknown, path: string, issues: ValidationIssue[]): RemainderDispositionInput | null {
  const record = asRecord(value);
  if (record === null) {
    issues.push({ path, problem: 'must be an object' });
    return null;
  }
  const kind = record['kind'];
  if (kind === 'leaveIndependent') {
    rejectUnknownKeys(record, ['kind'], issues);
    if (issues.length > 0) return null;
    return { kind: 'leaveIndependent' };
  }
  if (kind === 'carryIn') {
    requireKeys(record, ['kind', 'amount', 'destinationCycleId'], issues);
    if (issues.length > 0) return null;
    const amount = validateMoneyInput(record['amount'], `${path}.amount`, 'nonNegative', issues);
    const destinationCycleId = validateId(record['destinationCycleId'], `${path}.destinationCycleId`, makeCycleId, issues);
    if (amount === null || destinationCycleId === null || issues.length > 0) return null;
    return { kind: 'carryIn', amount, destinationCycleId };
  }
  if (kind === 'fundTracked') {
    requireKeys(record, ['kind', 'amount'], issues);
    if (issues.length > 0) return null;
    const amount = validateMoneyInput(record['amount'], `${path}.amount`, 'nonNegative', issues);
    if (amount === null || issues.length > 0) return null;
    return { kind: 'fundTracked', amount };
  }
  if (kind === 'split') {
    requireKeys(record, ['kind', 'carryAmount', 'fundAmount', 'destinationCycleId'], issues);
    if (issues.length > 0) return null;
    const carryAmount = validateMoneyInput(record['carryAmount'], `${path}.carryAmount`, 'nonNegative', issues);
    const fundAmount = validateMoneyInput(record['fundAmount'], `${path}.fundAmount`, 'nonNegative', issues);
    const destinationCycleId = validateId(record['destinationCycleId'], `${path}.destinationCycleId`, makeCycleId, issues);
    if (carryAmount === null || fundAmount === null || destinationCycleId === null || issues.length > 0) return null;
    return { kind: 'split', carryAmount, fundAmount, destinationCycleId };
  }
  issues.push({ path: `${path}.kind`, problem: "must be 'carryIn', 'fundTracked', 'split', or 'leaveIndependent'" });
  return null;
}

function validateDisposeCycleRemainder(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'settlementId', 'disposition', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };
  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const settlementId = validateId(record['settlementId'], 'settlementId', makeSettlementId, issues);
  const disposition = validateDispositionField(record['disposition'], 'disposition', issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || settlementId === null || disposition === null) {
    return { ok: false, issues };
  }
  const command: DisposeCycleRemainderCommand = { kind: 'disposeCycleRemainder', bookId, settlementId, disposition, note };
  return { ok: true, command };
}

function validateReopenCycle(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'cycleId', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };
  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const cycleId = validateId(record['cycleId'], 'cycleId', makeCycleId, issues);
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || cycleId === null) {
    return { ok: false, issues };
  }
  const command: ReopenCycleCommand = { kind: 'reopenCycle', bookId, cycleId, note };
  return { ok: true, command };
}

function validateResolvePropagationConflict(record: Record<string, unknown>): CommandValidation {
  const issues: ValidationIssue[] = [];
  requireKeys(record, ['kind', 'bookId', 'conflictId', 'resolution', 'note'], issues);
  if (issues.length > 0) return { ok: false, issues };
  const bookId = validateId(record['bookId'], 'bookId', makeBookId, issues);
  const conflictId = validateId(record['conflictId'], 'conflictId', makeEntryId, issues);
  if (record['resolution'] !== 'acknowledgedDownstreamStands') {
    issues.push({ path: 'resolution', problem: "must be 'acknowledgedDownstreamStands'" });
  }
  const note = validateShortText(record['note'], 'note', issues, true);
  if (issues.length > 0 || bookId === null || conflictId === null) {
    return { ok: false, issues };
  }
  const command: ResolvePropagationConflictCommand = {
    kind: 'resolvePropagationConflict',
    bookId,
    conflictId,
    resolution: 'acknowledgedDownstreamStands',
    note,
  };
  return { ok: true, command };
}
