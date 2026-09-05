/**
 * Gregorian monthly cycles anchored to the first of the month or a chosen
 * payday.
 *
 * A cycle window is an explicit inclusive start and exclusive end. A payday
 * anchor on day 29/30/31 clamps to the month's last valid day, so short
 * months never produce impossible dates. Calendar display may be localized
 * later without changing these financial period semantics.
 */

import {
  compareCivilDates,
  civilDateToDayNumber,
  civilDateParts,
  daysInGregorianMonth,
  makeCivilDate,
  nextMonth,
  previousMonth,
  type CivilDate,
  type CivilDateResult,
} from './civil-date';

export type MonthlyCycleAnchor =
  | { readonly kind: 'firstOfMonth' }
  | { readonly kind: 'payday'; readonly dayOfMonth: number };

export type MonthlyCycleAnchorResult =
  | { readonly ok: true; readonly value: MonthlyCycleAnchor }
  | { readonly ok: false; readonly failure: MonthlyCycleAnchorFailure };

export type MonthlyCycleAnchorFailure =
  | { readonly reason: 'invalidPaydayDay'; readonly dayOfMonth: unknown }
  | { readonly reason: 'unknownAnchorKind'; readonly kind: unknown };

export interface MonthlyCycleWindow {
  /** First day of the cycle, inclusive. */
  readonly startDate: CivilDate;
  /** First day after the cycle, exclusive. */
  readonly endDateExclusive: CivilDate;
}

const MIN_ANCHOR_DAY = 1;
const MAX_ANCHOR_DAY = 31;

export function makeMonthlyCycleAnchor(anchor: MonthlyCycleAnchor): MonthlyCycleAnchorResult {
  if (anchor.kind === 'firstOfMonth') {
    return { ok: true, value: Object.freeze({ kind: 'firstOfMonth' }) };
  }
  if (
    anchor.kind === 'payday' &&
    Number.isSafeInteger(anchor.dayOfMonth) &&
    anchor.dayOfMonth >= MIN_ANCHOR_DAY &&
    anchor.dayOfMonth <= MAX_ANCHOR_DAY
  ) {
    return { ok: true, value: Object.freeze({ kind: 'payday', dayOfMonth: anchor.dayOfMonth }) };
  }
  if (anchor.kind === 'payday') {
    return { ok: false, failure: { reason: 'invalidPaydayDay', dayOfMonth: (anchor as { dayOfMonth?: unknown }).dayOfMonth } };
  }
  return { ok: false, failure: { reason: 'unknownAnchorKind', kind: (anchor as { kind?: unknown }).kind } };
}

/** The anchor as a day-of-month number; first-of-month anchors to day 1. */
export function anchorDayOfMonth(anchor: MonthlyCycleAnchor): number {
  return anchor.kind === 'payday' ? anchor.dayOfMonth : 1;
}

/**
 * The day the cycle starting in the given month begins: the anchor clamped to
 * the month's last valid day (payday 31 becomes February 28/29).
 */
export function cycleStartForMonth(anchor: MonthlyCycleAnchor, year: number, month: number): CivilDateResult {
  const monthLength = daysInGregorianMonth(year, month);
  if (monthLength === null) {
    return { ok: false, failure: { reason: 'invalidMonth', month } };
  }
  const requestedDay = anchorDayOfMonth(anchor);
  const day = Math.min(requestedDay, monthLength);
  return makeCivilDate(year, month, day);
}

/**
 * The unique cycle window whose inclusive start is the latest anchor start at
 * or before `date`, and whose exclusive end is the next anchor start.
 */
export function monthlyCycleContaining(anchor: MonthlyCycleAnchor, date: CivilDate): MonthlyCycleWindow {
  const { year, month } = civilDateParts(date);

  const startThisMonth = requireStart(cycleStartForMonth(anchor, year, month));
  let start = startThisMonth;
  if (compareCivilDates(startThisMonth, date) > 0) {
    const previous = previousMonth(year, month);
    start = requireStart(cycleStartForMonth(anchor, previous.year, previous.month));
  }

  const endMonth = nextMonth(civilDateParts(start).year, civilDateParts(start).month);
  const end = requireStart(cycleStartForMonth(anchor, endMonth.year, endMonth.month));
  return Object.freeze({ startDate: start, endDateExclusive: end });
}

/** The cycle window that starts exactly at `window.endDateExclusive`. */
export function monthlyCycleFollowing(anchor: MonthlyCycleAnchor, window: MonthlyCycleWindow): MonthlyCycleWindow {
  return monthlyCycleContaining(anchor, window.endDateExclusive);
}

/** Inclusive start, exclusive end. */
export function isDateWithinMonthlyWindow(date: CivilDate, window: MonthlyCycleWindow): boolean {
  return compareCivilDates(window.startDate, date) <= 0 && compareCivilDates(date, window.endDateExclusive) < 0;
}

/** Exact window length in days; always between 28 and 31 for monthly anchors. */
export function monthlyWindowLengthInDays(window: MonthlyCycleWindow): number {
  return civilDateToDayNumber(window.endDateExclusive) - civilDateToDayNumber(window.startDate);
}

function requireStart(result: CivilDateResult): CivilDate {
  if (!result.ok) {
    // Months passed in here always come from validated CivilDate parts, so a
    // failure is an internal invariant break rather than caller input.
    throw new Error(`monthly cycle invariant broken: ${result.failure.reason}`);
  }
  return result.value;
}
