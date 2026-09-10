/**
 * Shared fail-closed primitives for portable snapshot decoding.
 */

import { makeMoney, type Money } from '../../domain/primitives/money';
import { parseCivilDate, type CivilDate } from '../../domain/primitives/civil-date';
import { isRepresentableInstantMs, isValidTimeZoneName, isValidWallTime, type TimeZoneName } from '../../domain/primitives/instant';
import { makeMonthlyCycleAnchor, type MonthlyCycleAnchor } from '../../domain/primitives/monthly-cycle';
import { PORTABILITY_REASON, type PortabilityReasonCode } from '../migration/reasons';

export type DecodeFailure = {
  readonly ok: false;
  readonly reason: PortabilityReasonCode;
  readonly detail: string;
};

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function fail(reason: PortabilityReasonCode, detail: string): DecodeFailure {
  return { ok: false, reason, detail };
}

export function isFail(value: unknown): value is DecodeFailure {
  return typeof value === 'object' && value !== null && (value as DecodeFailure).ok === false && 'reason' in (value as object);
}

export function exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): DecodeFailure | null {
  const expected = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) return fail(PORTABILITY_REASON.malformedRecord, `${label} has unknown field ${key}`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      return fail(PORTABILITY_REASON.malformedRecord, `${label} is missing required field ${key}`);
    }
  }
  return null;
}

export function requireSafeInteger(value: unknown, label: string, min: number | null = null): number | DecodeFailure {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return fail(PORTABILITY_REASON.malformedRecord, `${label} is not a safe integer`);
  }
  if (min !== null && value < min) {
    return fail(PORTABILITY_REASON.malformedRecord, `${label} must be >= ${min}`);
  }
  return value;
}

export function requireRepresentableInstant(value: unknown, label: string): number | DecodeFailure {
  if (!isRepresentableInstantMs(value)) {
    return fail(PORTABILITY_REASON.malformedRecord, `${label} is outside the representable instant range`);
  }
  return value;
}

export function requireNullableRepresentableInstant(value: unknown, label: string): number | null | DecodeFailure {
  if (value === null) return null;
  return requireRepresentableInstant(value, label);
}

export function requireString(value: unknown, label: string): string | DecodeFailure {
  if (typeof value !== 'string' || value.length === 0) {
    return fail(PORTABILITY_REASON.malformedRecord, `${label} must be a non-empty string`);
  }
  return value;
}

export function requireText(value: unknown, label: string): string | DecodeFailure {
  if (typeof value !== 'string') {
    return fail(PORTABILITY_REASON.malformedRecord, `${label} must be a string`);
  }
  if (value.length > 280) {
    return fail(PORTABILITY_REASON.malformedRecord, `${label} exceeds 280 characters`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return fail(PORTABILITY_REASON.malformedRecord, `${label} must not contain control characters`);
  }
  return value;
}

export function requireNullableString(value: unknown, label: string): string | null | DecodeFailure {
  if (value === null) return null;
  return requireText(value, label);
}

export function decodeMoney(raw: unknown, label: string): Money | DecodeFailure {
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not money`);
  const keys = exactKeys(record, ['currency', 'minorUnits'], label);
  if (keys !== null) return keys;
  if (record['currency'] !== 'SAR') return fail(PORTABILITY_REASON.wrongCurrency, `${label} is not SAR`);
  const units = requireSafeInteger(record['minorUnits'], `${label}.minorUnits`);
  if (typeof units !== 'number') return units;
  const money = makeMoney('SAR', units);
  if (!money.ok) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not canonical money`);
  return money.value;
}

export function decodeNullableMoney(raw: unknown, label: string): Money | null | DecodeFailure {
  if (raw === null) return null;
  return decodeMoney(raw, label);
}

export function decodeCivilDate(value: unknown, label: string): CivilDate | DecodeFailure {
  const text = requireString(value, label);
  if (typeof text !== 'string') return text;
  const parsed = parseCivilDate(text);
  if (!parsed.ok) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not a civil date`);
  return parsed.value;
}

export function decodeNullableCivilDate(value: unknown, label: string): CivilDate | null | DecodeFailure {
  if (value === null) return null;
  return decodeCivilDate(value, label);
}

export function decodeTimeZone(value: unknown, label: string): TimeZoneName | DecodeFailure {
  const text = requireString(value, label);
  if (typeof text !== 'string') return text;
  if (!isValidTimeZoneName(text)) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not a valid IANA name`);
  return text;
}

export function decodeNullableTimeZone(value: unknown, label: string): TimeZoneName | null | DecodeFailure {
  if (value === null) return null;
  return decodeTimeZone(value, label);
}

export function decodeAnchor(raw: unknown, label: string): MonthlyCycleAnchor | DecodeFailure {
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  if (record['kind'] === 'firstOfMonth') {
    const keys = exactKeys(record, ['kind'], label);
    if (keys !== null) return keys;
    const anchor = makeMonthlyCycleAnchor({ kind: 'firstOfMonth' });
    if (!anchor.ok) return fail(PORTABILITY_REASON.malformedRecord, `${label} is invalid`);
    return anchor.value;
  }
  if (record['kind'] === 'payday') {
    const keys = exactKeys(record, ['kind', 'dayOfMonth'], label);
    if (keys !== null) return keys;
    const day = requireSafeInteger(record['dayOfMonth'], `${label}.dayOfMonth`, 1);
    if (typeof day !== 'number') return day;
    const anchor = makeMonthlyCycleAnchor({ kind: 'payday', dayOfMonth: day });
    if (!anchor.ok) return fail(PORTABILITY_REASON.malformedRecord, `${label} is invalid`);
    return anchor.value;
  }
  return fail(PORTABILITY_REASON.malformedRecord, `${label} is invalid`);
}

export function decodeWallTime(value: unknown, label: string): string | null | DecodeFailure {
  if (value === null) return null;
  const text = requireString(value, label);
  if (typeof text !== 'string') return text;
  if (!isValidWallTime(text)) {
    return fail(PORTABILITY_REASON.malformedRecord, `${label} is not a valid HH:MM:SS wall time`);
  }
  return text;
}

export function decodeArray<T>(
  raw: unknown,
  label: string,
  decodeItem: (item: unknown, index: number) => T | DecodeFailure,
): T[] | DecodeFailure {
  if (!Array.isArray(raw)) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an array`);
  const items: T[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const item = decodeItem(raw[index], index);
    if (isFail(item)) return item;
    items.push(item);
  }
  return items;
}

export function jsonSafe(value: unknown, path: string): DecodeFailure | null {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return null;
    case 'number':
      if (!Number.isSafeInteger(value)) return fail(PORTABILITY_REASON.malformedRecord, `${path} is not a safe integer`);
      return null;
    case 'object':
      break;
    default:
      return fail(PORTABILITY_REASON.malformedRecord, `${path} is not JSON-safe`);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const nested = jsonSafe(value[index], `${path}[${index}]`);
      if (nested !== null) return nested;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if ('currency' in record && 'minorUnits' in record && Object.keys(record).length === 2) {
    const money = decodeMoney(record, path);
    if (isFail(money)) return money;
    return null;
  }
  for (const key of Object.keys(record)) {
    const nested = jsonSafe(record[key], `${path}.${key}`);
    if (nested !== null) return nested;
  }
  return null;
}

export class IdentitySet {
  private readonly seen = new Set<string>();

  remember(kind: string, id: string, label: string): DecodeFailure | null {
    const key = `${kind}:${id}`;
    if (this.seen.has(key)) return fail(PORTABILITY_REASON.duplicateId, `duplicate ${label} ${id}`);
    this.seen.add(key);
    return null;
  }
}
