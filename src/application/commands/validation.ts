/**
 * Runtime validation of raw commands.
 *
 * Everything crossing the application boundary — UI, import, sync, or an AI
 * proposal — is `unknown` until it passes through this module. Validation is
 * strict: the object must be a plain record with exactly the allowed fields,
 * every field must have its declared type, and money inputs must be exact
 * checked values. Validation issues are reported as typed failures, never as
 * exceptions, so malformed input can never mutate state.
 */

import { isSupportedCurrency } from '../../domain/primitives/currency';
import { makeMoney, parseMoneyAmount, type Money } from '../../domain/primitives/money';
import { parseCivilDate, type CivilDate } from '../../domain/primitives/civil-date';
import { makeMonthlyCycleAnchor, type MonthlyCycleAnchor } from '../../domain/primitives/monthly-cycle';
import { isValidTimeZoneName, MAX_REPRESENTABLE_INSTANT_MS, MIN_REPRESENTABLE_INSTANT_MS, type TimeZoneName } from '../../domain/primitives/instant';
import {
  makeBookId,
  makeEntryId,
  makeOperationId,
  type OperationId,
} from '../../domain/contracts/identity';
import type {
  CreateBookCommand,
  FinanceCommand,
  OccurredAt,
  OpenCycleCommand,
  RecordInflowCommand,
  ReverseInflowCommand,
} from '../../domain/contracts/commands';

export interface ValidationIssue {
  readonly path: string;
  readonly problem: string;
}

export type CommandValidation =
  | { readonly ok: true; readonly command: FinanceCommand }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

type RawRecord = Record<string, unknown>;

const MAX_TEXT_LENGTH = 280;

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
    default:
      return { ok: false, issues: [{ path: 'kind', problem: 'unknown command kind' }] };
  }
}

function asRecord(value: unknown): RawRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as RawRecord;
}

function requireKeys(record: RawRecord, allowed: readonly string[], issues: ValidationIssue[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      issues.push({ path: key, problem: 'unknown field' });
    }
  }
  for (const key of allowed) {
    if (record[key] === undefined) {
      issues.push({ path: key, problem: 'missing required field' });
    }
  }
}

function validateId<T extends string>(
  value: unknown,
  path: string,
  make: (raw: unknown) => { ok: true; value: T } | { ok: false; failure: { readonly detail: string } },
  issues: ValidationIssue[],
): T | null {
  const result = make(value);
  if (!result.ok) {
    issues.push({ path, problem: result.failure.detail });
    return null;
  }
  return result.value;
}

function validateShortText(value: unknown, path: string, issues: ValidationIssue[], optional: boolean): string {
  if (value === undefined && optional) return '';
  if (typeof value !== 'string') {
    issues.push({ path, problem: 'must be a string' });
    return '';
  }
  if (value.length > MAX_TEXT_LENGTH) {
    issues.push({ path, problem: `must be at most ${MAX_TEXT_LENGTH} characters` });
    return '';
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    issues.push({ path, problem: 'must not contain control characters' });
    return '';
  }
  return value;
}

function validateCivilDateField(value: unknown, path: string, issues: ValidationIssue[]): CivilDate | null {
  const result = parseCivilDate(typeof value === 'string' ? value : '');
  if (!result.ok) {
    issues.push({ path, problem: `invalid civil date (${result.failure.reason})` });
    return null;
  }
  return result.value;
}

function validateTimeZoneField(value: unknown, path: string, issues: ValidationIssue[]): TimeZoneName | null {
  if (!isValidTimeZoneName(value)) {
    issues.push({ path, problem: 'must be a valid IANA timezone name' });
    return null;
  }
  return value;
}

function validateCycleAnchorField(value: unknown, path: string, issues: ValidationIssue[]): MonthlyCycleAnchor | null {
  const record = asRecord(value);
  if (record === null) {
    issues.push({ path, problem: 'must be an object' });
    return null;
  }
  const anchor = makeMonthlyCycleAnchor(record as MonthlyCycleAnchor);
  if (!anchor.ok) {
    issues.push({ path, problem: `invalid cycle anchor (${anchor.failure.reason})` });
    return null;
  }
  return anchor.value;
}

type AmountSign = 'any' | 'positive' | 'nonNegative';

/**
 * Money input accepts either the exact checked integer form
 * `{ currency, minorUnits }` or the exact text form `{ currency, text }`
 * parsed by the bilingual parser. Mixing the two, unknown fields, and excess
 * precision are all rejected.
 */
function validateMoneyInput(value: unknown, path: string, sign: AmountSign, issues: ValidationIssue[]): Money | null {
  const record = asRecord(value);
  if (record === null) {
    issues.push({ path, problem: 'must be an object' });
    return null;
  }
  if (!isSupportedCurrency(record['currency'])) {
    issues.push({ path: `${path}.currency`, problem: 'must be a supported ISO currency code' });
    return null;
  }
  const currency = record['currency'];
  const hasMinorUnits = record['minorUnits'] !== undefined;
  const hasText = record['text'] !== undefined;
  if (hasMinorUnits === hasText) {
    issues.push({ path, problem: 'must provide exactly one of minorUnits or text' });
    return null;
  }
  for (const key of Object.keys(record)) {
    if (key !== 'currency' && key !== 'minorUnits' && key !== 'text') {
      issues.push({ path: `${path}.${key}`, problem: 'unknown field' });
      return null;
    }
  }

  let money: Money | null = null;
  if (hasMinorUnits) {
    const minorUnits = record['minorUnits'];
    const result = makeMoney(currency, typeof minorUnits === 'number' ? minorUnits : Number.NaN);
    if (!result.ok) {
      issues.push({ path: `${path}.minorUnits`, problem: 'must be a safe-integer minor-unit amount' });
      return null;
    }
    money = result.value;
  } else {
    const text = record['text'];
    if (typeof text !== 'string') {
      issues.push({ path: `${path}.text`, problem: 'must be a string' });
      return null;
    }
    const result = parseMoneyAmount(text, currency);
    if (!result.ok) {
      issues.push({ path: `${path}.text`, problem: `unparseable amount (${result.failure.reason})` });
      return null;
    }
    money = result.value;
  }

  if (sign === 'positive' && money.minorUnits <= 0) {
    issues.push({ path, problem: 'must be a positive amount' });
    return null;
  }
  if (sign === 'nonNegative' && money.minorUnits < 0) {
    issues.push({ path, problem: 'must not be negative' });
    return null;
  }
  return money;
}

function validateOccurredAt(value: unknown, path: string, issues: ValidationIssue[]): OccurredAt | null {
  const record = asRecord(value);
  if (record === null) {
    issues.push({ path, problem: 'must be an object' });
    return null;
  }
  const issuesBeforeKeys = issues.length;
  if (record['kind'] === 'civilDate') {
    requireKeys(record, ['kind', 'localDate'], issues);
    if (issues.length > issuesBeforeKeys) return null;
    const localDate = validateCivilDateField(record['localDate'], `${path}.localDate`, issues);
    if (localDate === null) return null;
    return { kind: 'civilDate', localDate };
  }
  if (record['kind'] === 'instant') {
    requireKeys(record, ['kind', 'instantMs'], issues);
    if (issues.length > issuesBeforeKeys) return null;
    const instantMs = record['instantMs'];
    if (typeof instantMs !== 'number' || !Number.isSafeInteger(instantMs)) {
      issues.push({ path: `${path}.instantMs`, problem: 'must be a safe-integer epoch millisecond value' });
      return null;
    }
    if (instantMs < MIN_REPRESENTABLE_INSTANT_MS || instantMs > MAX_REPRESENTABLE_INSTANT_MS) {
      issues.push({
        path: `${path}.instantMs`,
        problem: `must be an epoch millisecond value the platform can represent (${MIN_REPRESENTABLE_INSTANT_MS} to ${MAX_REPRESENTABLE_INSTANT_MS})`,
      });
      return null;
    }
    return { kind: 'instant', instantMs };
  }
  issues.push({ path: `${path}.kind`, problem: "must be 'civilDate' or 'instant'" });
  return null;
}

function validateCreateBook(record: RawRecord): CommandValidation {
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
    currency: record['currency'],
    timeZone,
    cycleAnchor,
  };
  return { ok: true, command };
}

function validateOpenCycle(record: RawRecord): CommandValidation {
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

function validateRecordInflow(record: RawRecord): CommandValidation {
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

function validateReverseInflow(record: RawRecord): CommandValidation {
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

/** Used by execute to validate the caller-supplied operation ID. */
export function validateOperationId(value: unknown): OperationId | null {
  return validateId(value, 'operationId', makeOperationId, []);
}
