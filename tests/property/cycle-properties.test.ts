import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareCivilDates, daysInGregorianMonth, makeCivilDate, type CivilDate } from '../../src/domain/primitives/civil-date';
import {
  cycleStartForMonth,
  isDateWithinMonthlyWindow,
  monthlyCycleContaining,
  monthlyCycleFollowing,
  monthlyWindowLengthInDays,
} from '../../src/domain/primitives/monthly-cycle';
import { PROPERTY_RUNS, propertySeed } from './support/seed';

const SEED = propertySeed(20260907);

const anchorArb: fc.Arbitrary<{ kind: 'payday'; dayOfMonth: number }> = fc.integer({ min: 1, max: 31 }).map((day) => ({ kind: 'payday', dayOfMonth: day }));
const yearArb = fc.integer({ min: 1996, max: 2100 });
const monthArb = fc.integer({ min: 1, max: 12 });
const dayArb = fc.integer({ min: 1, max: 31 });

/** Independent oracle for month length using the host's UTC calendar. */
function daysInMonthOracle(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validDate(year: number, month: number, day: number): CivilDate {
  const made = makeCivilDate(year, month, Math.min(day, daysInMonthOracle(year, month)));
  expect(made.ok).toBe(true);
  return (made as { value: CivilDate }).value;
}

describe('monthly cycle properties (bounded, seeded)', () => {
  it('clamps the anchor to the last valid day of every month', () => {
    const property = fc.property(anchorArb, yearArb, monthArb, (anchor, year, month) => {
      const start = cycleStartForMonth(anchor, year, month);
      expect(start.ok).toBe(true);
      if (!start.ok) return;
      const expectedDay = Math.min(anchor.dayOfMonth, daysInMonthOracle(year, month));
      expect(start.value.slice(8, 10)).toBe(String(expectedDay).padStart(2, '0'));
      expect(start.value.slice(0, 7)).toBe(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`);
    });
    return fc.assert(property, { seed: SEED, numRuns: PROPERTY_RUNS });
  });

  it('places every date in exactly one window with inclusive start and exclusive end', () => {
    const property = fc.property(anchorArb, yearArb, monthArb, dayArb, (anchor, year, month, day) => {
      const date = validDate(year, month, day);
      const window = monthlyCycleContaining(anchor, date);
      expect(compareCivilDates(window.startDate, date)).toBeLessThanOrEqual(0);
      expect(compareCivilDates(date, window.endDateExclusive)).toBe(-1);
      // The window start maps onto its own window.
      const startWindow = monthlyCycleContaining(anchor, window.startDate);
      expect(startWindow.startDate).toBe(window.startDate);
      expect(startWindow.endDateExclusive).toBe(window.endDateExclusive);
      // The end date belongs to the next window, never this one.
      expect(isDateWithinMonthlyWindow(date, window)).toBe(true);
      expect(isDateWithinMonthlyWindow(window.endDateExclusive, window)).toBe(false);
    });
    return fc.assert(property, { seed: SEED + 1, numRuns: PROPERTY_RUNS });
  });

  it('chains windows contiguously with lengths between 28 and 31 days', () => {
    const property = fc.property(anchorArb, yearArb, monthArb, dayArb, (anchor, year, month, day) => {
      const window = monthlyCycleContaining(anchor, validDate(year, month, day));
      const length = monthlyWindowLengthInDays(window);
      expect(length).toBeGreaterThanOrEqual(28);
      expect(length).toBeLessThanOrEqual(31);
      const following = monthlyCycleFollowing(anchor, window);
      expect(following.startDate).toBe(window.endDateExclusive);
      expect(monthlyWindowLengthInDays(following)).toBe(monthlyWindowLengthInDays(monthlyCycleContaining(anchor, window.endDateExclusive)));
    });
    return fc.assert(property, { seed: SEED + 2, numRuns: PROPERTY_RUNS });
  });

  it('never produces a window whose start is not an anchor day or a clamped month end', () => {
    const property = fc.property(anchorArb, yearArb, monthArb, dayArb, (anchor, year, month, day) => {
      const window = monthlyCycleContaining(anchor, validDate(year, month, day));
      const startDay = Number(window.startDate.slice(8, 10));
      const startMonth = Number(window.startDate.slice(5, 7));
      const startYear = Number(window.startDate.slice(0, 4));
      expect(startDay).toBe(Math.min(anchor.dayOfMonth, daysInMonthOracle(startYear, startMonth)));
    });
    return fc.assert(property, { seed: SEED + 3, numRuns: PROPERTY_RUNS });
  });

  it('keeps first-of-month anchors aligned to civil months', () => {
    const property = fc.property(yearArb, monthArb, dayArb, (year, month, day) => {
      const window = monthlyCycleContaining({ kind: 'firstOfMonth' }, validDate(year, month, day));
      expect(window.startDate.slice(8, 10)).toBe('01');
      const endMonth = Number(window.endDateExclusive.slice(5, 7));
      const startMonth = Number(window.startDate.slice(5, 7));
      const nextMonthExpected = startMonth === 12 ? 1 : startMonth + 1;
      expect(endMonth).toBe(nextMonthExpected);
      expect(window.endDateExclusive.slice(8, 10)).toBe('01');
    });
    return fc.assert(property, { seed: SEED + 4, numRuns: PROPERTY_RUNS });
  });
});

describe('civil date sanity inside properties', () => {
  it('agrees with the host calendar on month lengths', () => {
    const property = fc.property(yearArb, monthArb, (year, month) => {
      expect(daysInGregorianMonth(year, month)).toBe(daysInMonthOracle(year, month));
    });
    return fc.assert(property, { seed: SEED + 5, numRuns: PROPERTY_RUNS });
  });
});
