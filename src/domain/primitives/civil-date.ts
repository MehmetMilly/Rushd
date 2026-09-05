/**
 * Strict Gregorian civil dates.
 *
 * A CivilDate is a calendar day in some profile timezone, never an instant.
 * Dates that do not exist (February 30, February 29 outside leap years, month
 * 13) are rejected instead of being normalized by the JavaScript Date object.
 * The domain reads no ambient clock: callers resolve instants to civil dates
 * through `instant.ts` with an explicit timezone.
 */

declare const civilDateBrand: unique symbol;

/**
 * A validated Gregorian civil date in `YYYY-MM-DD` form. Lexicographic order
 * is chronological order because every field is zero-padded to fixed width.
 */
export type CivilDate = string & { readonly [civilDateBrand]: true };

export type CivilDateFailure =
  | { readonly reason: 'invalidYear'; readonly year: number }
  | { readonly reason: 'invalidMonth'; readonly month: number }
  | { readonly reason: 'invalidDay'; readonly day: number; readonly daysInMonth: number }
  | { readonly reason: 'badFormat'; readonly detail: string };

export type CivilDateResult =
  | { readonly ok: true; readonly value: CivilDate }
  | { readonly ok: false; readonly failure: CivilDateFailure };

export interface CivilDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const MIN_YEAR = 1;
const MAX_YEAR = 9999;
const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isLeapGregorianYear(year: number): boolean {
  if (!Number.isSafeInteger(year)) return false;
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in a Gregorian month, or null when the year/month is not valid. */
export function daysInGregorianMonth(year: number, month: number): number | null {
  if (!Number.isSafeInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return null;
  if (!Number.isSafeInteger(month) || month < 1 || month > 12) return null;
  const lengths = [31, isLeapGregorianYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1];
}

export function makeCivilDate(year: number, month: number, day: number): CivilDateResult {
  if (!Number.isSafeInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    return { ok: false, failure: { reason: 'invalidYear', year } };
  }
  if (!Number.isSafeInteger(month) || month < 1 || month > 12) {
    return { ok: false, failure: { reason: 'invalidMonth', month } };
  }
  const monthLength = daysInGregorianMonth(year, month);
  if (monthLength === null) {
    return { ok: false, failure: { reason: 'invalidMonth', month } };
  }
  if (!Number.isSafeInteger(day) || day < 1 || day > monthLength) {
    return { ok: false, failure: { reason: 'invalidDay', day, daysInMonth: monthLength } };
  }
  return { ok: true, value: formatCivilDateParts(year, month, day) as CivilDate };
}

/** Parses the strict `YYYY-MM-DD` form only; no whitespace, shortcuts, or locale forms. */
export function parseCivilDate(input: string): CivilDateResult {
  if (typeof input !== 'string' || !CIVIL_DATE_PATTERN.test(input)) {
    return { ok: false, failure: { reason: 'badFormat', detail: 'expected strict YYYY-MM-DD' } };
  }
  const year = Number(input.slice(0, 4));
  const month = Number(input.slice(5, 7));
  const day = Number(input.slice(8, 10));
  return makeCivilDate(year, month, day);
}

export function civilDateParts(value: CivilDate): CivilDateParts {
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10)),
  };
}

/** Lexicographic comparison equals chronological comparison for zero-padded dates. */
export function compareCivilDates(a: CivilDate, b: CivilDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/**
 * Days-from-civil (proleptic Gregorian) day number. Pure integer arithmetic
 * with no host Date dependency, so day differences are exact everywhere.
 */
export function civilDateToDayNumber(value: CivilDate): number {
  const { year, month, day } = civilDateParts(value);
  // Shift so March is month 0, matching the classic days-from-civil formula.
  const shiftedMonth = month <= 2 ? month + 9 : month - 3;
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function formatCivilDateParts(year: number, month: number, day: number): string {
  const yearText = String(year).padStart(4, '0');
  const monthText = String(month).padStart(2, '0');
  const dayText = String(day).padStart(2, '0');
  return `${yearText}-${monthText}-${dayText}`;
}
