import { describe, expect, it } from 'vitest';
import {
  isValidTimeZoneName,
  MAX_REPRESENTABLE_INSTANT_MS,
  MIN_REPRESENTABLE_INSTANT_MS,
  resolveCivilDate,
  resolveCivilDateTime,
  type TimeZoneName,
} from '../../src/domain/primitives/instant';

// Test-local branding of known-valid literals.
const tz = (value: string) => value as TimeZoneName;

describe('timezone validation', () => {
  it('accepts IANA names and UTC and rejects everything else', () => {
    expect(isValidTimeZoneName('Asia/Riyadh')).toBe(true);
    expect(isValidTimeZoneName('America/New_York')).toBe(true);
    expect(isValidTimeZoneName('UTC')).toBe(true);
    expect(isValidTimeZoneName('Not/AZone')).toBe(false);
    expect(isValidTimeZoneName('')).toBe(false);
    expect(isValidTimeZoneName(42)).toBe(false);
  });
});

describe('instant to civil date resolution', () => {
  it('resolves Riyadh midnight crossings in its fixed UTC+3 offset', () => {
    // 23:59:59 local on Jan 1.
    expect(resolveCivilDate(Date.UTC(2026, 0, 1, 20, 59, 59), tz('Asia/Riyadh'))).toEqual({ ok: true, value: '2026-01-01' });
    // 00:00:00 local on Jan 2 one second later.
    expect(resolveCivilDate(Date.UTC(2026, 0, 1, 21, 0, 0), tz('Asia/Riyadh'))).toEqual({ ok: true, value: '2026-01-02' });
  });

  it('resolves a DST timezone across the spring-forward and fall-back boundaries', () => {
    // One second before the US spring-forward instant: 01:59:59 EST.
    expect(resolveCivilDate(Date.UTC(2026, 2, 8, 6, 59, 59), tz('America/New_York'))).toEqual({ ok: true, value: '2026-03-08' });
    // The skipped hour never appears locally: 07:00Z is 03:00 EDT.
    expect(resolveCivilDate(Date.UTC(2026, 2, 8, 7, 0, 0), tz('America/New_York'))).toEqual({ ok: true, value: '2026-03-08' });
    // Same instant family, previous civil day across the date line of local midnight.
    expect(resolveCivilDate(Date.UTC(2026, 2, 8, 3, 30, 0), tz('America/New_York'))).toEqual({ ok: true, value: '2026-03-07' });
    // Fall-back repeats the 1 o'clock hour on the same civil date.
    expect(resolveCivilDate(Date.UTC(2026, 10, 1, 5, 30, 0), tz('America/New_York'))).toEqual({ ok: true, value: '2026-11-01' });
    expect(resolveCivilDate(Date.UTC(2026, 10, 1, 6, 30, 0), tz('America/New_York'))).toEqual({ ok: true, value: '2026-11-01' });
  });

  it('returns the full local wall-clock time for boundary semantics', () => {
    const resolved = resolveCivilDateTime(Date.UTC(2026, 8, 5, 21, 30, 15), tz('Asia/Riyadh'));
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.localDate).toBe('2026-09-06');
      expect(resolved.value.hour).toBe(0);
      expect(resolved.value.minute).toBe(30);
      expect(resolved.value.second).toBe(15);
    }
  });

  it('rejects invalid timezones and instants instead of guessing', () => {
    expect(resolveCivilDate(Date.UTC(2026, 0, 1), tz('Not/AZone'))).toEqual({
      ok: false,
      failure: { reason: 'invalidTimeZone', timeZone: tz('Not/AZone') },
    });
    expect(resolveCivilDate(1.5, tz('Asia/Riyadh'))).toEqual({
      ok: false,
      failure: { reason: 'invalidInstant', instantMs: 1.5 },
    });
    expect(resolveCivilDate(Number.NaN, tz('Asia/Riyadh')).ok).toBe(false);
    // One millisecond past 9999-12-31T23:59:59.999Z.
    expect(resolveCivilDate(253402300800000, tz('Asia/Riyadh')).ok).toBe(false);
  });

  it('rejects unrepresentable instants with typed failures instead of throwing', () => {
    // Safe integers beyond the platform Date range must fail as data, not
    // blow up formatting with a RangeError.
    expect(resolveCivilDate(Number.MAX_SAFE_INTEGER, tz('Asia/Riyadh'))).toEqual({
      ok: false,
      failure: { reason: 'invalidInstant', instantMs: Number.MAX_SAFE_INTEGER },
    });
    expect(resolveCivilDate(-Number.MAX_SAFE_INTEGER, tz('Asia/Riyadh'))).toEqual({
      ok: false,
      failure: { reason: 'invalidInstant', instantMs: -Number.MAX_SAFE_INTEGER },
    });
    // Exactly representable extremes: formatting succeeds, but the resolved
    // civil dates (year 275760, and a BC date) fall outside the supported
    // Gregorian range and are rejected without normalization or era guessing.
    expect(resolveCivilDate(MAX_REPRESENTABLE_INSTANT_MS, tz('Asia/Riyadh'))).toEqual({
      ok: false,
      failure: { reason: 'invalidInstant', instantMs: MAX_REPRESENTABLE_INSTANT_MS },
    });
    expect(resolveCivilDate(MIN_REPRESENTABLE_INSTANT_MS, tz('Asia/Riyadh')).ok).toBe(false);
    // An ordinary timestamp still resolves normally.
    expect(resolveCivilDate(Date.UTC(2026, 8, 5, 12, 0, 0), tz('Asia/Riyadh'))).toEqual({ ok: true, value: '2026-09-05' });
  });
});
