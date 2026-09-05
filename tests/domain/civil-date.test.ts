import { describe, expect, it } from 'vitest';
import {
  civilDateParts,
  civilDateToDayNumber,
  compareCivilDates,
  daysInGregorianMonth,
  isLeapGregorianYear,
  makeCivilDate,
  nextMonth,
  parseCivilDate,
  previousMonth,
  type CivilDate,
} from '../../src/domain/primitives/civil-date';

// Test-local branding of known-valid literals; the primitives under test
// validate every dynamic value themselves.
const d = (value: string) => value as CivilDate;

describe('civil date validation', () => {
  it('accepts real Gregorian dates including leap days', () => {
    expect(makeCivilDate(2026, 9, 5)).toEqual({ ok: true, value: '2026-09-05' });
    expect(makeCivilDate(2024, 2, 29)).toEqual({ ok: true, value: '2024-02-29' });
    expect(makeCivilDate(2000, 2, 29)).toEqual({ ok: true, value: '2000-02-29' });
    expect(makeCivilDate(1, 1, 1)).toEqual({ ok: true, value: '0001-01-01' });
  });

  it('rejects impossible dates instead of normalizing them', () => {
    expect(makeCivilDate(2023, 2, 29)).toEqual({ ok: false, failure: { reason: 'invalidDay', day: 29, daysInMonth: 28 } });
    expect(makeCivilDate(2026, 4, 31)).toEqual({ ok: false, failure: { reason: 'invalidDay', day: 31, daysInMonth: 30 } });
    expect(makeCivilDate(2026, 13, 1).ok).toBe(false);
    expect(makeCivilDate(2026, 0, 1).ok).toBe(false);
    expect(makeCivilDate(2026, 9, 0).ok).toBe(false);
    expect(makeCivilDate(2026, 9, 31).ok).toBe(false);
    expect(makeCivilDate(10000, 1, 1).ok).toBe(false);
    expect(makeCivilDate(0, 1, 1).ok).toBe(false);
    expect(makeCivilDate(2026.5, 9, 5).ok).toBe(false);
  });

  it('computes month lengths and leap years', () => {
    expect(isLeapGregorianYear(2024)).toBe(true);
    expect(isLeapGregorianYear(2000)).toBe(true);
    expect(isLeapGregorianYear(1900)).toBe(false);
    expect(isLeapGregorianYear(2023)).toBe(false);
    expect(daysInGregorianMonth(2024, 2)).toBe(29);
    expect(daysInGregorianMonth(2023, 2)).toBe(28);
    expect(daysInGregorianMonth(2026, 9)).toBe(30);
    expect(daysInGregorianMonth(2026, 13)).toBe(null);
  });

  it('parses only the strict YYYY-MM-DD form', () => {
    expect(parseCivilDate('2026-09-05')).toEqual({ ok: true, value: '2026-09-05' });
    expect(parseCivilDate('2026-9-5').ok).toBe(false);
    expect(parseCivilDate('2026-13-01').ok).toBe(false);
    expect(parseCivilDate('2026-09-05 ').ok).toBe(false);
    expect(parseCivilDate('20260905').ok).toBe(false);
    expect(parseCivilDate('٢٠٢٦-٠٩-٠٥').ok).toBe(false);
  });

  it('decomposes, compares, and shifts months', () => {
    const date = parseCivilDate('2026-09-05');
    expect(date.ok).toBe(true);
    if (date.ok) {
      expect(civilDateParts(date.value)).toEqual({ year: 2026, month: 9, day: 5 });
      expect(compareCivilDates(date.value, d('2026-09-05'))).toBe(0);
      expect(compareCivilDates(date.value, d('2026-09-06'))).toBe(-1);
      expect(compareCivilDates(date.value, d('2026-08-31'))).toBe(1);
    }
    expect(nextMonth(2026, 9)).toEqual({ year: 2026, month: 10 });
    expect(nextMonth(2026, 12)).toEqual({ year: 2027, month: 1 });
    expect(previousMonth(2026, 1)).toEqual({ year: 2025, month: 12 });
    expect(previousMonth(2026, 9)).toEqual({ year: 2026, month: 8 });
  });

  it('produces consistent day numbers for day arithmetic', () => {
    const a = civilDateToDayNumber(d('2026-09-01'));
    const b = civilDateToDayNumber(d('2026-09-30'));
    expect(b - a).toBe(29);
    // Leap day contributes exactly one day.
    expect(civilDateToDayNumber(d('2024-03-01')) - civilDateToDayNumber(d('2024-02-28'))).toBe(2);
    expect(civilDateToDayNumber(d('2023-03-01')) - civilDateToDayNumber(d('2023-02-28'))).toBe(1);
  });
});
