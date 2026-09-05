import { describe, expect, it } from 'vitest';
import { currencyIsoExponent, currencyMetadata, isSupportedCurrency } from '../../src/domain/primitives/currency';
import {
  addMoney,
  compareMoney,
  isPositiveMoney,
  isZeroMoney,
  makeMoney,
  negateMoney,
  parseMoneyAmount,
  signOfMoney,
  subtractMoney,
  sumMoney,
  type Money,
} from '../../src/domain/primitives/money';

describe('currency metadata', () => {
  it('owns the ISO exponent per currency', () => {
    expect(currencyIsoExponent('SAR')).toBe(2);
    expect(currencyIsoExponent('USD')).toBe(2);
    expect(currencyIsoExponent('JPY')).toBe(0);
    expect(currencyIsoExponent('KWD')).toBe(3);
    expect(currencyMetadata('KWD').minorUnitsPerMajorUnit).toBe(1000);
  });

  it('rejects unsupported currency codes', () => {
    expect(isSupportedCurrency('EUR')).toBe(false);
    expect(isSupportedCurrency('sar')).toBe(false);
    expect(isSupportedCurrency(42)).toBe(false);
    expect(makeMoney('EUR' as never, 100).ok).toBe(false);
  });
});

describe('checked money', () => {
  it('builds only from safe-integer minor units of a supported currency', () => {
    const sar = makeMoney('SAR', 1250);
    expect(sar.ok).toBe(true);
    if (sar.ok) expect(sar.value).toEqual({ currency: 'SAR', minorUnits: 1250 });

    expect(makeMoney('SAR', 1.5).ok).toBe(false);
    expect(makeMoney('SAR', Number.MAX_SAFE_INTEGER + 1).ok).toBe(false);
    expect(makeMoney('SAR', Number.NaN).ok).toBe(false);
  });

  it('represents signed values', () => {
    const negative = makeMoney('SAR', -250);
    expect(negative.ok).toBe(true);
    if (negative.ok) {
      expect(signOfMoney(negative.value)).toBe(-1);
      expect(isPositiveMoney(negative.value)).toBe(false);
    }
    const zero = makeMoney('SAR', 0);
    if (zero.ok) {
      expect(isZeroMoney(zero.value)).toBe(true);
      expect(signOfMoney(zero.value)).toBe(0);
    }
  });

  it('freezes money objects so they cannot be mutated', () => {
    const sar = makeMoney('SAR', 100);
    expect(sar.ok).toBe(true);
    if (sar.ok) expect(Object.isFrozen(sar.value)).toBe(true);
  });
});

describe('money arithmetic', () => {
  it('adds and subtracts exactly within one currency', () => {
    const a = makeMoney('SAR', 1250);
    const b = makeMoney('SAR', 250);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      const sum = addMoney(a.value, b.value);
      expect(sum.ok).toBe(true);
      if (sum.ok) expect(sum.value.minorUnits).toBe(1500);
      const difference = subtractMoney(a.value, b.value);
      expect(difference.ok).toBe(true);
      if (difference.ok) expect(difference.value.minorUnits).toBe(1000);
    }
  });

  it('rejects cross-currency arithmetic', () => {
    const sar = makeMoney('SAR', 100);
    const usd = makeMoney('USD', 100);
    expect(sar.ok && usd.ok).toBe(true);
    if (sar.ok && usd.ok) {
      expect(addMoney(sar.value, usd.value)).toEqual({
        ok: false,
        failure: { reason: 'currencyMismatch', left: 'SAR', right: 'USD' },
      });
      expect(subtractMoney(sar.value, usd.value).ok).toBe(false);
      expect(compareMoney(sar.value, usd.value).ok).toBe(false);
    }
  });

  it('rejects unsafe results instead of rounding', () => {
    const nearMax = makeMoney('SAR', Number.MAX_SAFE_INTEGER);
    const one = makeMoney('SAR', 1);
    expect(nearMax.ok && one.ok).toBe(true);
    if (nearMax.ok && one.ok) {
      const overflow = addMoney(nearMax.value, one.value);
      expect(overflow.ok).toBe(false);
      if (!overflow.ok) expect(overflow.failure.reason).toBe('unsafeResult');
    }
  });

  it('negates and sums exactly', () => {
    const positive = makeMoney('KWD', 1500);
    expect(positive.ok).toBe(true);
    if (positive.ok) {
      const negated = negateMoney(positive.value);
      expect(negated.ok).toBe(true);
      if (negated.ok) expect(negated.value.minorUnits).toBe(-1500);
    }
    const list = [makeMoney('JPY', 100), makeMoney('JPY', 200), makeMoney('JPY', -50)];
    if (list.every((item) => item.ok)) {
      const total = sumMoney(list.map((item) => (item as { ok: true; value: Money }).value) as [Money, ...Money[]]);
      expect(total.ok).toBe(true);
      if (total.ok) expect(total.value.minorUnits).toBe(250);
    }
    expect(sumMoney([] as unknown as [Money, ...Money[]]).ok).toBe(false);
  });

  it('compares same-currency amounts', () => {
    const small = makeMoney('USD', 99);
    const large = makeMoney('USD', 100);
    expect(small.ok && large.ok).toBe(true);
    if (small.ok && large.ok) {
      expect(compareMoney(small.value, large.value)).toEqual({ ok: true, order: -1 });
      expect(compareMoney(large.value, small.value)).toEqual({ ok: true, order: 1 });
      expect(compareMoney(small.value, small.value)).toEqual({ ok: true, order: 0 });
    }
  });
});

describe('exact bilingual money parsing', () => {
  it('parses two-decimal SAR from Western digits', () => {
    expect(parseMoneyAmount('12.50', 'SAR')).toEqual({ ok: true, value: { currency: 'SAR', minorUnits: 1250 } });
    expect(parseMoneyAmount('0.01', 'SAR')).toEqual({ ok: true, value: { currency: 'SAR', minorUnits: 1 } });
    expect(parseMoneyAmount('007.5', 'SAR')).toEqual({ ok: true, value: { currency: 'SAR', minorUnits: 750 } });
    expect(parseMoneyAmount('+7', 'SAR')).toEqual({ ok: true, value: { currency: 'SAR', minorUnits: 700 } });
    expect(parseMoneyAmount('-0.25', 'SAR')).toEqual({ ok: true, value: { currency: 'SAR', minorUnits: -25 } });
    expect(parseMoneyAmount('-0', 'SAR')).toEqual({ ok: true, value: { currency: 'SAR', minorUnits: 0 } });
  });

  it('parses Arabic-Indic and Extended Arabic-Indic digits exactly', () => {
    expect(parseMoneyAmount('١٢٫٥٠', 'SAR')).toEqual({ ok: true, value: { currency: 'SAR', minorUnits: 1250 } });
    expect(parseMoneyAmount('۱۲.۵', 'SAR')).toEqual({ ok: true, value: { currency: 'SAR', minorUnits: 1250 } });
    expect(parseMoneyAmount('٠', 'JPY')).toEqual({ ok: true, value: { currency: 'JPY', minorUnits: 0 } });
    expect(parseMoneyAmount('٠٫٢٥', 'SAR')).toEqual({ ok: true, value: { currency: 'SAR', minorUnits: 25 } });
  });

  it('handles zero- and three-decimal currencies', () => {
    expect(parseMoneyAmount('500', 'JPY')).toEqual({ ok: true, value: { currency: 'JPY', minorUnits: 500 } });
    expect(parseMoneyAmount('10.255', 'KWD')).toEqual({ ok: true, value: { currency: 'KWD', minorUnits: 10255 } });
  });

  it('rejects excess precision instead of rounding', () => {
    expect(parseMoneyAmount('12.505', 'SAR')).toEqual({
      ok: false,
      failure: { reason: 'excessPrecision', fractionDigits: 3, allowedDigits: 2 },
    });
    expect(parseMoneyAmount('500.5', 'JPY')).toEqual({
      ok: false,
      failure: { reason: 'excessPrecision', fractionDigits: 1, allowedDigits: 0 },
    });
    expect(parseMoneyAmount('10.2555', 'KWD')).toEqual({
      ok: false,
      failure: { reason: 'excessPrecision', fractionDigits: 4, allowedDigits: 3 },
    });
  });

  it('rejects malformed input', () => {
    expect(parseMoneyAmount('', 'SAR').ok).toBe(false);
    expect(parseMoneyAmount('.', 'SAR').ok).toBe(false);
    expect(parseMoneyAmount('5.', 'SAR').ok).toBe(false);
    expect(parseMoneyAmount('.5', 'SAR').ok).toBe(false);
    expect(parseMoneyAmount('-', 'SAR').ok).toBe(false);
    expect(parseMoneyAmount('1,234', 'SAR')).toEqual({
      ok: false,
      failure: { reason: 'invalidCharacter', position: 1, character: ',' },
    });
    expect(parseMoneyAmount('١٬٢٣٤', 'SAR').ok).toBe(false);
    expect(parseMoneyAmount('12 50', 'SAR').ok).toBe(false);
    expect(parseMoneyAmount('١٢٣', 'EUR' as never).ok).toBe(false);
  });

  it('rejects amounts beyond the safe integer range without rounding', () => {
    expect(parseMoneyAmount('9007199254740993', 'SAR').ok).toBe(false);
    // The exact maximum: 90071992547409.91 SAR = MAX_SAFE_INTEGER halalas.
    expect(parseMoneyAmount('90071992547409.91', 'SAR')).toEqual({
      ok: true,
      value: { currency: 'SAR', minorUnits: Number.MAX_SAFE_INTEGER },
    });
    // One halala more overflows.
    expect(parseMoneyAmount('90071992547409.92', 'SAR').ok).toBe(false);
    const hugeArabic = '٩'.repeat(30);
    expect(parseMoneyAmount(hugeArabic, 'SAR').ok).toBe(false);
  });
});
