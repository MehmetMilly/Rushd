/**
 * Resolving an instant to the profile's civil date through an explicit IANA
 * timezone.
 *
 * The platform Intl timezone database is used; this module never implements
 * its own timezone rules or offsets. The profile timezone is validated once
 * and carried as a TimeZoneName so every fact can capture which timezone it
 * was resolved in.
 */

import { makeCivilDate, type CivilDate } from './civil-date';

declare const timeZoneBrand: unique symbol;

/** A string the host platform accepts as an IANA timezone identifier. */
export type TimeZoneName = string & { readonly [timeZoneBrand]: true };

export function isValidTimeZoneName(value: unknown): value is TimeZoneName {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export type InstantResolutionFailure =
  | { readonly reason: 'invalidTimeZone'; readonly timeZone: string }
  | { readonly reason: 'invalidInstant'; readonly instantMs: number };

export type CivilDateTimeResolution =
  | {
      readonly ok: true;
      readonly value: { readonly localDate: CivilDate; readonly hour: number; readonly minute: number; readonly second: number };
    }
  | { readonly ok: false; readonly failure: InstantResolutionFailure };

export type CivilDateResolution =
  | { readonly ok: true; readonly value: CivilDate }
  | { readonly ok: false; readonly failure: InstantResolutionFailure };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Resolves a UTC epoch millisecond instant to wall-clock civil date and time
 * in the given timezone. The instant itself is event-ordering data only; the
 * returned localDate is the civil date facts are captured against.
 */
export function resolveCivilDateTime(instantMs: number, timeZone: TimeZoneName): CivilDateTimeResolution {
  if (!isValidTimeZoneName(timeZone)) {
    return { ok: false, failure: { reason: 'invalidTimeZone', timeZone: String(timeZone) } };
  }
  if (!Number.isSafeInteger(instantMs)) {
    return { ok: false, failure: { reason: 'invalidInstant', instantMs } };
  }

  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? Number.NaN : Number(part.value);
  };
  const year = read('year');
  const month = read('month');
  const day = read('day');
  const hour = read('hour');
  const minute = read('minute');
  const second = read('second');

  const civilDate = makeCivilDate(year, month, day);
  if (!civilDate.ok) {
    return { ok: false, failure: { reason: 'invalidInstant', instantMs } };
  }
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second)) {
    return { ok: false, failure: { reason: 'invalidInstant', instantMs } };
  }
  return { ok: true, value: { localDate: civilDate.value, hour, minute, second } };
}

export function resolveCivilDate(instantMs: number, timeZone: TimeZoneName): CivilDateResolution {
  const resolution = resolveCivilDateTime(instantMs, timeZone);
  if (!resolution.ok) return resolution;
  return { ok: true, value: resolution.value.localDate };
}
