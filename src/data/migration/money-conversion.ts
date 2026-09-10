/**
 * Exact untagged-legacy SAR major-unit conversion to integer halalas.
 *
 * Untagged values are SAR major units. Conversion uses the canonical decimal
 * text of the source value and P03 `parseMoneyAmount`. Excess precision,
 * invalid sign/range, non-finite values, corrupt types, and ambiguous
 * currency labels are quarantined. Nothing is rounded and locale/numeral
 * shaping is never treated as FX.
 */

import { parseMoneyAmount, type Money } from '../../domain/primitives/money';
import { MIGRATION_REASON, type MigrationReasonCode } from './reasons';

export const LEGACY_MIGRATION_CURRENCY = 'SAR' as const;

export interface SourceRef {
  readonly database: 'MicroSaveOS_DB';
  readonly databaseVersion: 1;
  readonly store: 'settings' | 'templates' | 'expenses';
  readonly recordKey: string;
  readonly field: string;
}

export interface ConversionOk {
  readonly ok: true;
  readonly money: Money;
  readonly source: SourceRef;
  readonly originalValue: unknown;
  readonly canonicalDecimal: string;
}

export interface ConversionQuarantine {
  readonly ok: false;
  readonly reason: MigrationReasonCode;
  readonly source: SourceRef;
  readonly originalValue: unknown;
  readonly detail: string;
}

export type ConversionResult = ConversionOk | ConversionQuarantine;

const AMBIGUOUS_CURRENCY = /[A-Za-z$€£¥₹]|ريال|دولار|دينار|ين|USD|SAR|KWD|JPY/u;

function quarantine(
  source: SourceRef,
  originalValue: unknown,
  reason: MigrationReasonCode,
  detail: string,
): ConversionQuarantine {
  return { ok: false, reason, source, originalValue, detail };
}

/**
 * Canonical decimal text of a finite number without rounding. Scientific
 * notation and non-decimal strings are quarantined by the caller.
 */
export function canonicalNumberDecimal(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  if (Object.is(value, -0)) return '0';
  const text = String(value);
  if (/[eE]/.test(text)) return null;
  return text;
}

export function convertUntaggedSarMajor(value: unknown, source: SourceRef): ConversionResult {
  if (value === null || value === undefined) {
    return quarantine(source, value, MIGRATION_REASON.missingValue, 'source value is missing');
  }
  if (typeof value === 'boolean' || typeof value === 'object' || typeof value === 'bigint' || typeof value === 'symbol') {
    return quarantine(source, value, MIGRATION_REASON.corruptType, 'source value is not a decimal amount');
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return quarantine(source, value, MIGRATION_REASON.nonFinite, 'source value is not a finite number');
    }
    const decimal = canonicalNumberDecimal(value);
    if (decimal === null) {
      return quarantine(source, value, MIGRATION_REASON.malformedDecimal, 'scientific notation is not a canonical decimal');
    }
    return parseDecimal(decimal, source, value);
  }
  if (typeof value === 'string') {
    if (value.length === 0) {
      return quarantine(source, value, MIGRATION_REASON.missingValue, 'source text is empty');
    }
    if (AMBIGUOUS_CURRENCY.test(value)) {
      return quarantine(source, value, MIGRATION_REASON.ambiguousCurrency, 'source text includes a currency label or symbol');
    }
    return parseDecimal(value, source, value);
  }
  return quarantine(source, value, MIGRATION_REASON.corruptType, 'source value is not a decimal amount');
}

function parseDecimal(text: string, source: SourceRef, originalValue: unknown): ConversionResult {
  const parsed = parseMoneyAmount(text, LEGACY_MIGRATION_CURRENCY);
  if (!parsed.ok) {
    const failure = parsed.failure;
    if (failure.reason === 'excessPrecision') {
      return quarantine(
        source,
        originalValue,
        MIGRATION_REASON.excessPrecision,
        `fraction digits ${failure.fractionDigits} exceed ${failure.allowedDigits}`,
      );
    }
    if (failure.reason === 'unsupportedCurrency') {
      return quarantine(source, originalValue, MIGRATION_REASON.unsupportedCurrency, 'currency is not SAR');
    }
    if (failure.reason === 'unsafeAmount') {
      return quarantine(source, originalValue, MIGRATION_REASON.unsafeAmount, failure.detail);
    }
    if (failure.reason === 'malformedDecimal' || failure.reason === 'invalidCharacter' || failure.reason === 'empty' || failure.reason === 'notText') {
      return quarantine(source, originalValue, MIGRATION_REASON.malformedDecimal, failure.reason);
    }
    return quarantine(source, originalValue, MIGRATION_REASON.malformedDecimal, 'decimal parse rejected');
  }
  return {
    ok: true,
    money: parsed.value,
    source,
    originalValue,
    canonicalDecimal: text,
  };
}

export function requireNonNegative(result: ConversionResult): ConversionResult {
  if (!result.ok) return result;
  if (result.money.minorUnits < 0) {
    return quarantine(result.source, result.originalValue, MIGRATION_REASON.invalidSign, 'amount must be >= 0');
  }
  return result;
}

export function requireStrictlyPositive(result: ConversionResult): ConversionResult {
  const nonNegative = requireNonNegative(result);
  if (!nonNegative.ok) return nonNegative;
  if (nonNegative.money.minorUnits <= 0) {
    return quarantine(nonNegative.source, nonNegative.originalValue, MIGRATION_REASON.invalidRange, 'amount must be > 0');
  }
  return nonNegative;
}
