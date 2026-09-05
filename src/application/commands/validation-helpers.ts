/**
 * Shared runtime-validation helpers.
 *
 * Everything crossing the application boundary is `unknown` until it passes
 * through these strict checks: exact allowed fields, declared types, and
 * exact checked money. Issues are reported as typed values, never thrown, so
 * malformed input can never mutate state.
 */

import { isSupportedCurrency } from '../../domain/primitives/currency';
import { makeMoney, parseMoneyAmount, type Money } from '../../domain/primitives/money';
import { parseCivilDate, type CivilDate } from '../../domain/primitives/civil-date';
import { makeMonthlyCycleAnchor, type MonthlyCycleAnchor } from '../../domain/primitives/monthly-cycle';
import { isValidTimeZoneName, MAX_REPRESENTABLE_INSTANT_MS, MIN_REPRESENTABLE_INSTANT_MS, type TimeZoneName } from '../../domain/primitives/instant';
import type { OccurredAt } from '../../domain/contracts/commands';

export interface ValidationIssue {
  readonly path: string;
  readonly problem: string;
}

export type RawRecord = Record<string, unknown>;

export function asRecord(value: unknown): RawRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as RawRecord;
}

export function rejectUnknownKeys(record: RawRecord, allowed: readonly string[], issues: ValidationIssue[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      issues.push({ path: key, problem: 'unknown field' });
    }
  }
}

/** Every allowed key must be present (possibly null for optional fields). */
export function requireKeys(record: RawRecord, allowed: readonly string[], issues: ValidationIssue[]): void {
  rejectUnknownKeys(record, allowed, issues);
  for (const key of allowed) {
    if (record[key] === undefined) {
      issues.push({ path: key, problem: 'missing required field' });
    }
  }
}

export function validateId<T extends string>(
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

const MAX_TEXT_LENGTH = 280;

export function validateShortText(value: unknown, path: string, issues: ValidationIssue[], optional: boolean): string {
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

/**
 * A descriptive link field: absent (undefined) means "not supplied", an
 * explicit null clears the link, and otherwise it must be a short text
 * identifier. Returns a sentinel distinguishing absent from cleared.
 */
export const DESCRIPTIVE_ABSENT = Symbol('descriptive-absent');

export function validateDescriptiveLink(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string | null | typeof DESCRIPTIVE_ABSENT {
  if (value === undefined) return DESCRIPTIVE_ABSENT;
  if (value === null) return null;
  if (typeof value !== 'string') {
    issues.push({ path, problem: 'must be a string or null' });
    return null;
  }
  if (value.length > MAX_TEXT_LENGTH) {
    issues.push({ path, problem: `must be at most ${MAX_TEXT_LENGTH} characters` });
    return null;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    issues.push({ path, problem: 'must not contain control characters' });
    return null;
  }
  return value;
}

export function validateCivilDateField(value: unknown, path: string, issues: ValidationIssue[]): CivilDate | null {
  const result = parseCivilDate(typeof value === 'string' ? value : '');
  if (!result.ok) {
    issues.push({ path, problem: `invalid civil date (${result.failure.reason})` });
    return null;
  }
  return result.value;
}

export function validateTimeZoneField(value: unknown, path: string, issues: ValidationIssue[]): TimeZoneName | null {
  if (!isValidTimeZoneName(value)) {
    issues.push({ path, problem: 'must be a valid IANA timezone name' });
    return null;
  }
  return value;
}

export function validateCycleAnchorField(value: unknown, path: string, issues: ValidationIssue[]): MonthlyCycleAnchor | null {
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

export type AmountSign = 'any' | 'positive' | 'nonNegative';

/**
 * Money input accepts either the exact checked integer form
 * `{ currency, minorUnits }` or the exact text form `{ currency, text }`
 * parsed by the bilingual parser. Mixing the two, unknown fields, and excess
 * precision are all rejected.
 */
export function validateMoneyInput(value: unknown, path: string, sign: AmountSign, issues: ValidationIssue[]): Money | null {
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

export function validateOccurredAt(value: unknown, path: string, issues: ValidationIssue[]): OccurredAt | null {
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
