import { describe, expect, it } from 'vitest';
import {
  isValidTimeZoneName,
  MAX_REPRESENTABLE_INSTANT_MS,
  MIN_REPRESENTABLE_INSTANT_MS,
  resolveCivilDate,
  resolveCivilDateTime,
  type TimeZoneName,
} from '../../src/domain/primitives/instant';
import { canonicalJson, executeCommand, previewCommand, stableDigest } from '../../src/application/commands';
import { makeBookId, makeOperationId, type BookId, type OperationId } from '../../src/domain/contracts/identity';
import { createDeterministicContext } from './support/deterministic-context';
import { InMemoryFinanceRepository } from './support/in-memory-repository';

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

  it('rejects year-zero and BCE instants instead of aliasing them onto CE dates', () => {
    // 0000-01-01T00:00:00Z is astronomical year 0 (1 BCE). `Intl` renders it
    // as a positive year-of-era with era BC; the resolver must inspect the
    // era and reject it instead of returning 0001-01-01.
    const YEAR_ZERO_MS = -62_167_219_200_000;
    expect(Date.parse('0000-01-01T00:00:00Z')).toBe(YEAR_ZERO_MS);
    expect(resolveCivilDate(YEAR_ZERO_MS, tz('UTC'))).toEqual({
      ok: false,
      failure: { reason: 'invalidInstant', instantMs: YEAR_ZERO_MS },
    });
    // Astronomical year -1 (2 BCE), 365 days before year zero: `Intl` renders
    // it as year 2 with era BC and must likewise be rejected.
    const YEAR_MINUS_ONE_MS = YEAR_ZERO_MS - 365 * 86_400_000;
    expect(resolveCivilDate(YEAR_MINUS_ONE_MS, tz('UTC')).ok).toBe(false);
    // Late in 2 BCE the era is still BC, so the whole pre-common-era range is
    // closed, not just the boundary instants.
    expect(resolveCivilDate(YEAR_MINUS_ONE_MS + 86_400_000 * 180, tz('UTC')).ok).toBe(false);
  });

  it('accepts common-era year one after validating the era', () => {
    // 0001-01-01T00:00:00Z resolves with era AD and must remain accepted.
    const YEAR_ONE_MS = -62_135_596_800_000;
    expect(Date.parse('0001-01-01T00:00:00Z')).toBe(YEAR_ONE_MS);
    expect(resolveCivilDate(YEAR_ONE_MS, tz('UTC'))).toEqual({ ok: true, value: '0001-01-01' });
    expect(resolveCivilDateTime(YEAR_ONE_MS, tz('UTC'))).toEqual({
      ok: true,
      value: { localDate: '0001-01-01', hour: 0, minute: 0, second: 0 },
    });
  });
});

describe('application occurrence validation against unsupported instants', () => {
  it('gives a typed no-write failure for an era-unsupported occurredAt instant', async () => {
    const repo = new InMemoryFinanceRepository();
    const { context } = createDeterministicContext();
    const bookId: BookId = makeOrThrowId(makeBookId('book-era'));
    const op = (raw: string): OperationId => makeOrThrowId(makeOperationId(raw));
    const run = async (rawCommand: unknown, operationId: string) => {
      const preview = previewCommand(repo, rawCommand, context);
      expect(preview.ok, preview.ok ? undefined : preview.failure.kind).toBe(true);
      if (!preview.ok) throw new Error('unreachable');
      const result = await executeCommand(
        repo,
        rawCommand,
        {
          operationId: op(operationId),
          expectedRevision: preview.preview.expectedRevision,
          previewDigest: preview.preview.previewDigest,
        },
        context,
      );
      expect(result.ok, result.ok ? undefined : result.failure.kind).toBe(true);
      if (!result.ok) throw new Error('unreachable');
    };
    await run(
      {
        kind: 'createBook',
        bookId: 'book-era',
        displayName: 'era',
        currency: 'SAR',
        timeZone: 'UTC',
        cycleAnchor: { kind: 'firstOfMonth' },
      },
      'op-era-book',
    );
    await run(
      {
        kind: 'openCycle',
        bookId: 'book-era',
        startDate: '0001-01-01',
        startingFunds: { currency: 'SAR', minorUnits: 100_000 },
      },
      'op-era-cycle',
    );

    const YEAR_ZERO_MS = -62_167_219_200_000;
    const before = JSON.stringify(repo.getBookState(bookId));
    const invalidOccurrence = {
      kind: 'recordInflow',
      bookId: 'book-era',
      amount: { currency: 'SAR', minorUnits: 5_000 },
      occurredAt: { kind: 'instant', instantMs: YEAR_ZERO_MS },
      note: '',
    };
    const preview = previewCommand(repo, invalidOccurrence, context);
    expect(preview.ok).toBe(false);
    if (!preview.ok) {
      expect(preview.failure.kind).toBe('invalidOccurredAt');
      if (preview.failure.kind === 'invalidOccurredAt') {
        expect(preview.failure.detail).toContain('invalidInstant');
      }
    }
    const result = await executeCommand(
      repo,
      invalidOccurrence,
      {
        operationId: op('op-era-inflow'),
        expectedRevision: 2,
        previewDigest: stableDigest(`${canonicalJson(invalidOccurrence)}\n2`),
      },
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('invalidOccurredAt');
    expect(JSON.stringify(repo.getBookState(bookId))).toBe(before);
    expect(repo.listOutbox()).toHaveLength(2);
    expect(repo.getOperation(op('op-era-inflow'))).toBeNull();
  });
});

function makeOrThrowId<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok) throw new Error('invalid test id');
  return result.value as T;
}
