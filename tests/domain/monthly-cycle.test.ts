import { describe, expect, it } from 'vitest';
import { makeCivilDate, type CivilDate } from '../../src/domain/primitives/civil-date';
import {
  anchorDayOfMonth,
  cycleStartForMonth,
  isDateWithinMonthlyWindow,
  makeMonthlyCycleAnchor,
  monthlyCycleContaining,
  monthlyCycleFollowing,
  monthlyWindowLengthInDays,
  type MonthlyCycleAnchor,
} from '../../src/domain/primitives/monthly-cycle';

// Test-local branding of known-valid literals; the primitives under test
// validate every dynamic value themselves.
const d = (value: string) => value as CivilDate;

const FIRST_OF_MONTH: MonthlyCycleAnchor = { kind: 'firstOfMonth' };
const PAYDAY_27: MonthlyCycleAnchor = { kind: 'payday', dayOfMonth: 27 };
const PAYDAY_31: MonthlyCycleAnchor = { kind: 'payday', dayOfMonth: 31 };

function expectOk<T>(result: { ok: boolean; value?: T; failure?: unknown }): T {
  expect(result.ok).toBe(true);
  return result.value as T;
}

describe('monthly cycle anchors', () => {
  it('validates anchors strictly', () => {
    expect(makeMonthlyCycleAnchor(FIRST_OF_MONTH).ok).toBe(true);
    expect(makeMonthlyCycleAnchor(PAYDAY_27).ok).toBe(true);
    expect(makeMonthlyCycleAnchor({ kind: 'payday', dayOfMonth: 0 }).ok).toBe(false);
    expect(makeMonthlyCycleAnchor({ kind: 'payday', dayOfMonth: 32 }).ok).toBe(false);
    expect(makeMonthlyCycleAnchor({ kind: 'payday', dayOfMonth: 1.5 }).ok).toBe(false);
    expect(makeMonthlyCycleAnchor({ kind: 'weekly' } as never).ok).toBe(false);
    expect(anchorDayOfMonth(FIRST_OF_MONTH)).toBe(1);
    expect(anchorDayOfMonth(PAYDAY_27)).toBe(27);
  });
});

describe('first-of-month cycles', () => {
  it('spans the civil month with inclusive start and exclusive end', () => {
    const september = monthlyCycleContaining(FIRST_OF_MONTH, expectOk(makeCivilDate(2026, 9, 5)));
    expect(september.startDate).toBe('2026-09-01');
    expect(september.endDateExclusive).toBe('2026-10-01');
    expect(isDateWithinMonthlyWindow(d('2026-09-01'), september)).toBe(true);
    expect(isDateWithinMonthlyWindow(d('2026-09-30'), september)).toBe(true);
    expect(isDateWithinMonthlyWindow(d('2026-10-01'), september)).toBe(false);
    expect(isDateWithinMonthlyWindow(d('2026-08-31'), september)).toBe(false);
  });

  it('crosses year boundaries', () => {
    const december = monthlyCycleContaining(FIRST_OF_MONTH, expectOk(makeCivilDate(2026, 12, 15)));
    expect(december.startDate).toBe('2026-12-01');
    expect(december.endDateExclusive).toBe('2027-01-01');
  });
});

describe('payday-anchored cycles', () => {
  it('runs from one payday to the next', () => {
    const window = monthlyCycleContaining(PAYDAY_27, expectOk(makeCivilDate(2026, 9, 5)));
    expect(window.startDate).toBe('2026-08-27');
    expect(window.endDateExclusive).toBe('2026-09-27');
    expect(isDateWithinMonthlyWindow(d('2026-08-27'), window)).toBe(true);
    expect(isDateWithinMonthlyWindow(d('2026-09-26'), window)).toBe(true);
    expect(isDateWithinMonthlyWindow(d('2026-09-27'), window)).toBe(false);
  });

  it('clamps the anchor to the last valid day of short months', () => {
    expect(expectOk(cycleStartForMonth(PAYDAY_31, 2026, 2))).toBe('2026-02-28');
    expect(expectOk(cycleStartForMonth(PAYDAY_31, 2024, 2))).toBe('2024-02-29');
    expect(expectOk(cycleStartForMonth(PAYDAY_31, 2026, 9))).toBe('2026-09-30');

    const containingFebruary = monthlyCycleContaining(PAYDAY_31, expectOk(makeCivilDate(2026, 3, 15)));
    expect(containingFebruary.startDate).toBe('2026-02-28');
    expect(containingFebruary.endDateExclusive).toBe('2026-03-31');
  });
});

describe('cycle window invariants', () => {
  it('maps the start date onto its own window', () => {
    const window = monthlyCycleContaining(FIRST_OF_MONTH, expectOk(makeCivilDate(2026, 9, 5)));
    const startWindow = monthlyCycleContaining(FIRST_OF_MONTH, window.startDate);
    expect(startWindow.startDate).toBe(window.startDate);
    expect(startWindow.endDateExclusive).toBe(window.endDateExclusive);
  });

  it('chains windows contiguously with no gaps or overlaps', () => {
    const window = monthlyCycleContaining(PAYDAY_27, expectOk(makeCivilDate(2026, 9, 5)));
    const following = monthlyCycleFollowing(PAYDAY_27, window);
    expect(following.startDate).toBe(window.endDateExclusive);
    const afterFollowing = monthlyCycleFollowing(PAYDAY_27, following);
    expect(afterFollowing.startDate).toBe(following.endDateExclusive);
  });

  it('keeps monthly windows between 28 and 31 days', () => {
    for (const anchor of [FIRST_OF_MONTH, PAYDAY_27, PAYDAY_31]) {
      const window = monthlyCycleContaining(anchor, expectOk(makeCivilDate(2026, 9, 15)));
      expect(monthlyWindowLengthInDays(window)).toBeGreaterThanOrEqual(28);
      expect(monthlyWindowLengthInDays(window)).toBeLessThanOrEqual(31);
    }
  });
});
