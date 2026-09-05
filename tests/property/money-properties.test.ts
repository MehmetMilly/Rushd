import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { currencyIsoExponent, type CurrencyCode } from '../../src/domain/primitives/currency';
import {
  addMoney,
  compareMoney,
  makeMoney,
  negateMoney,
  parseMoneyAmount,
  signOfMoney,
  subtractMoney,
  sumMoney,
  type Money,
} from '../../src/domain/primitives/money';
import { PROPERTY_RUNS, propertySeed } from './support/seed';

const SEED = propertySeed(20260905);
const CURRENCIES: readonly CurrencyCode[] = ['SAR', 'USD', 'JPY', 'KWD'];
const currencyArb = fc.constantFrom(...CURRENCIES);
const minorArb = fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 });

/** Independent oracle: build the exact major-decimal text for a minor-unit value with BigInt. */
function majorTextFor(minor: number, currency: CurrencyCode): string {
  const exponent = currencyIsoExponent(currency);
  const scale = 10n ** BigInt(exponent);
  const abs = BigInt(Math.abs(minor));
  const major = abs / scale;
  const fraction = exponent === 0 ? '' : (abs % scale).toString().padStart(exponent, '0');
  return `${minor < 0 ? '-' : ''}${major.toString()}${exponent > 0 ? `.${fraction}` : ''}`;
}

describe('money properties (bounded, seeded)', () => {
  it('parses exact major-decimal text for every supported currency', () => {
    const property = fc.property(minorArb, currencyArb, (minor, currency) => {
      const parsed = parseMoneyAmount(majorTextFor(minor, currency), currency);
      expect(parsed).toEqual({ ok: true, value: { currency, minorUnits: minor } });
    });
    return fc.assert(property, { seed: SEED, numRuns: PROPERTY_RUNS });
  });

  it('parses leading-zero padded text identically', () => {
    const property = fc.property(minorArb, currencyArb, (minor, currency) => {
      // Pad after any sign so the digits still start the number.
      const padded = majorTextFor(minor, currency).replace(/^(-?)/, '$100');
      const parsed = parseMoneyAmount(padded, currency);
      expect(parsed).toEqual({ ok: true, value: { currency, minorUnits: minor } });
    });
    return fc.assert(property, { seed: SEED + 1, numRuns: PROPERTY_RUNS });
  });

  it('parses Arabic-Indic digits and the Arabic decimal separator exactly like Western digits', () => {
    const property = fc.property(minorArb, currencyArb, (minor, currency) => {
      const western = majorTextFor(minor, currency);
      const arabic = western
        .replace(/\d/g, (digit) => String.fromCharCode(0x0660 + Number(digit)))
        .replace(/\./g, '\u066b');
      expect(parseMoneyAmount(arabic, currency)).toEqual(parseMoneyAmount(western, currency));
    });
    return fc.assert(property, { seed: SEED + 2, numRuns: PROPERTY_RUNS });
  });

  it('rejects any fraction longer than the ISO exponent without rounding', () => {
    const property = fc.property(
      fc.nat({ max: 9_999 }),
      fc.array(fc.constantFrom(...'0123456789'.split('')), { minLength: 1, maxLength: 4 }),
      currencyArb,
      (integerPart, extraFractionDigits, currency) => {
        const exponent = currencyIsoExponent(currency);
        const fraction = '1'.repeat(exponent) + extraFractionDigits.join('');
        const parsed = parseMoneyAmount(`${integerPart}.${fraction}`, currency);
        expect(parsed).toEqual({
          ok: false,
          failure: { reason: 'excessPrecision', fractionDigits: fraction.length, allowedDigits: exponent },
        });
      },
    );
    return fc.assert(property, { seed: SEED + 3, numRuns: PROPERTY_RUNS });
  });

  it('keeps add/subtract an exact inverse within the safe range', () => {
    const property = fc.property(minorArb, minorArb, currencyArb, (a, b, currency) => {
      const left = makeMoney(currency, a);
      const right = makeMoney(currency, b);
      expect(left.ok).toBe(true);
      expect(right.ok).toBe(true);
      if (!left.ok || !right.ok) return;
      const sum = addMoney(left.value, right.value);
      // |a|, |b| <= 1e12, so the sum is always a safe integer here.
      expect(sum.ok).toBe(true);
      if (!sum.ok) return;
      const back = subtractMoney(sum.value, right.value);
      expect(back).toEqual({ ok: true, value: left.value });
    });
    return fc.assert(property, { seed: SEED + 4, numRuns: PROPERTY_RUNS });
  });

  it('negation and comparison agree with the sign', () => {
    const property = fc.property(minorArb, currencyArb, (a, currency) => {
      const value = makeMoney(currency, a);
      expect(value.ok).toBe(true);
      if (!value.ok) return;
      const negated = negateMoney(value.value);
      expect(negated.ok).toBe(true);
      if (!negated.ok) return;
      const expectedOrder = a > 0 ? 1 : a < 0 ? -1 : 0;
      expect(compareMoney(value.value, negated.value)).toEqual({ ok: true, order: expectedOrder });
      expect(signOfMoney(negated.value)).toBe(a > 0 ? -1 : a < 0 ? 1 : 0);
    });
    return fc.assert(property, { seed: SEED + 5, numRuns: PROPERTY_RUNS });
  });

  it('sums a folded list exactly like repeated pairwise addition', () => {
    const property = fc.property(
      fc.array(minorArb, { minLength: 1, maxLength: 12 }),
      currencyArb,
      (amounts, currency) => {
        const monies: Money[] = [];
        for (const amount of amounts) {
          const made = makeMoney(currency, amount);
          expect(made.ok).toBe(true);
          if (made.ok) monies.push(made.value);
        }
        const folded = sumMoney(monies as [Money, ...Money[]]);
        let pairwise = monies[0];
        for (let index = 1; index < monies.length; index += 1) {
          const next = addMoney(pairwise, monies[index]);
          expect(next.ok).toBe(true);
          if (!next.ok) return;
          pairwise = next.value;
        }
        expect(folded).toEqual({ ok: true, value: pairwise });
      },
    );
    return fc.assert(property, { seed: SEED + 6, numRuns: PROPERTY_RUNS });
  });
});
