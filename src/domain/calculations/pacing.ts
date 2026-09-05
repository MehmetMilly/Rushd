/**
 * Pacing: a derived scenario, never a stored source of truth.
 *
 * The caller supplies the explicit eligible remaining civil dates (the UI
 * derives them from the profile clock; the domain reads no ambient time).
 * The available amount is divided with exact integer arithmetic:
 *
 *   perDay   = trunc(available / dayCount)   (toward zero)
 *   remainder = available - perDay * dayCount
 *
 * The remainder is reported, not silently assigned to any day — e.g. 1000
 * halalas over 3 days is 333/day with 1 halala remainder. Duplicate days and
 * an empty list are typed unavailable results rather than skewed divisions,
 * and a negative available amount paces as an honest negative scenario.
 */

import type { CivilDate } from '../primitives/civil-date';
import { isDateWithinMonthlyWindow } from '../primitives/monthly-cycle';
import type { BookState } from '../contracts/ledger';
import { findOpenCycle } from '../contracts/ledger';
import { computeAvailability, type AvailabilityUnavailableReason } from './availability';

export type PacingUnavailableReason =
  | AvailabilityUnavailableReason
  | 'noEligibleDays'
  | 'duplicateEligibleDays'
  | 'eligibleDateOutsideOpenCycle';

export interface PacingComputed {
  readonly status: 'computed';
  readonly bookId: string;
  readonly cycleId: string;
  readonly currency: string;
  readonly asOfInstantMs: number;
  readonly calculationVersion: string;
  /** The signed availability the scenario paces. */
  readonly available: { readonly currency: string; readonly minorUnits: number };
  /** Trunc-toward-zero integer division of available by dayCount. */
  readonly perDay: { readonly currency: string; readonly minorUnits: number };
  /** available - perDay * dayCount: reported, never silently assigned. */
  readonly remainder: { readonly currency: string; readonly minorUnits: number };
  /** The distinct, cycle-internal eligible dates actually used. */
  readonly eligibleDates: readonly CivilDate[];
  readonly dayCount: number;
}

export interface PacingUnavailable {
  readonly status: 'unavailable';
  readonly reason: PacingUnavailableReason;
  readonly asOfInstantMs: number;
  readonly calculationVersion: string;
}

export type PacingResult = PacingComputed | PacingUnavailable;

export function computePacing(
  state: BookState | null,
  params: {
    readonly eligibleDates: readonly CivilDate[];
    readonly asOfInstantMs: number;
    readonly calculationVersion: string;
  },
): PacingResult {
  const unavailable = (reason: PacingUnavailableReason): PacingUnavailable => ({
    status: 'unavailable',
    reason,
    asOfInstantMs: params.asOfInstantMs,
    calculationVersion: params.calculationVersion,
  });

  const openCycle = state === null ? null : findOpenCycle(state);
  if (state === null || openCycle === null) {
    return unavailable(state === null ? 'noBook' : 'noOpenCycle');
  }
  if (params.eligibleDates.length === 0) {
    return unavailable('noEligibleDays');
  }
  const distinct = new Set<string>(params.eligibleDates);
  if (distinct.size !== params.eligibleDates.length) {
    return unavailable('duplicateEligibleDays');
  }
  for (const date of params.eligibleDates) {
    if (!isDateWithinMonthlyWindow(date, { startDate: openCycle.startDate, endDateExclusive: openCycle.endDateExclusive })) {
      return unavailable('eligibleDateOutsideOpenCycle');
    }
  }

  const availability = computeAvailability(state, params);
  if (availability.status !== 'computed') {
    // computeAvailability already confirmed an open cycle above; this branch
    // is unreachable today and keeps the union honest for future reasons.
    return unavailable('noOpenCycle');
  }

  const dayCount = params.eligibleDates.length;
  const availableMinor = availability.available.minorUnits;
  // Integer division truncated toward zero keeps minor units exact; the
  // remainder (same sign as available, smaller magnitude than dayCount) is
  // reported for the caller instead of being folded into a day.
  const perDayMinor = Math.trunc(availableMinor / dayCount);
  const remainderMinor = availableMinor - perDayMinor * dayCount;
  const currency = availability.currency;

  return {
    status: 'computed',
    bookId: availability.bookId,
    cycleId: availability.cycleId,
    currency,
    asOfInstantMs: params.asOfInstantMs,
    calculationVersion: params.calculationVersion,
    available: { currency, minorUnits: availableMinor },
    perDay: { currency, minorUnits: perDayMinor },
    remainder: { currency, minorUnits: remainderMinor },
    eligibleDates: [...params.eligibleDates],
    dayCount,
  };
}
