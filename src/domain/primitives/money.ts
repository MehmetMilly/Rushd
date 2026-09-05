/**
 * Checked money in integer minor units.
 *
 * Money is always an explicit ISO currency plus a safe-integer amount of minor
 * units (halalas for SAR). Values may be signed: reversals and adjustments are
 * negative, while command-specific rules decide which signs an ordinary
 * operation may carry. Arithmetic is exact, never rounds, never converts
 * between currencies, and rejects any unsafe intermediate or result.
 */

import { currencyIsoExponent, isSupportedCurrency, type CurrencyCode } from './currency';

export interface Money {
  readonly currency: CurrencyCode;
  readonly minorUnits: number;
}

export type MoneyFailure =
  | { readonly reason: 'unsupportedCurrency'; readonly provided: unknown }
  | { readonly reason: 'notSafeIntegerMinorUnits'; readonly provided: unknown }
  | { readonly reason: 'currencyMismatch'; readonly left: CurrencyCode; readonly right: CurrencyCode }
  | { readonly reason: 'unsafeResult'; readonly detail: string };

export type MoneyResult =
  | { readonly ok: true; readonly value: Money }
  | { readonly ok: false; readonly failure: MoneyFailure };

export type MoneyOrder = -1 | 0 | 1;

export type MoneyComparison =
  | { readonly ok: true; readonly order: MoneyOrder }
  | { readonly ok: false; readonly failure: MoneyFailure };

export function makeMoney(currency: CurrencyCode, minorUnits: number): MoneyResult {
  if (!isSupportedCurrency(currency)) {
    return { ok: false, failure: { reason: 'unsupportedCurrency', provided: currency } };
  }
  if (!Number.isSafeInteger(minorUnits)) {
    return { ok: false, failure: { reason: 'notSafeIntegerMinorUnits', provided: minorUnits } };
  }
  return { ok: true, value: Object.freeze({ currency, minorUnits: minorUnits === 0 ? 0 : minorUnits }) };
}

function sameCurrencyOrFailure(a: Money, b: Money): MoneyFailure | null {
  if (a.currency !== b.currency) {
    return { reason: 'currencyMismatch', left: a.currency, right: b.currency };
  }
  return null;
}

export function addMoney(a: Money, b: Money): MoneyResult {
  const mismatch = sameCurrencyOrFailure(a, b);
  if (mismatch) return { ok: false, failure: mismatch };
  const sum = a.minorUnits + b.minorUnits;
  if (!Number.isSafeInteger(sum)) {
    return { ok: false, failure: { reason: 'unsafeResult', detail: `sum ${a.minorUnits} + ${b.minorUnits} is not a safe integer` } };
  }
  return { ok: true, value: Object.freeze({ currency: a.currency, minorUnits: sum }) };
}

export function subtractMoney(a: Money, b: Money): MoneyResult {
  const mismatch = sameCurrencyOrFailure(a, b);
  if (mismatch) return { ok: false, failure: mismatch };
  const difference = a.minorUnits - b.minorUnits;
  if (!Number.isSafeInteger(difference)) {
    return { ok: false, failure: { reason: 'unsafeResult', detail: `difference ${a.minorUnits} - ${b.minorUnits} is not a safe integer` } };
  }
  return { ok: true, value: Object.freeze({ currency: a.currency, minorUnits: difference }) };
}

export function negateMoney(value: Money): MoneyResult {
  if (!Number.isSafeInteger(value.minorUnits)) {
    return { ok: false, failure: { reason: 'notSafeIntegerMinorUnits', provided: value.minorUnits } };
  }
  return { ok: true, value: Object.freeze({ currency: value.currency, minorUnits: value.minorUnits === 0 ? 0 : -value.minorUnits }) };
}

/**
 * Exact left-to-right sum. The first element anchors the currency; the list
 * must be non-empty so an empty sum cannot invent a currency.
 */
export function sumMoney(values: readonly [Money, ...Money[]]): MoneyResult {
  if (values.length === 0) {
    return { ok: false, failure: { reason: 'unsafeResult', detail: 'sumMoney requires at least one amount' } };
  }
  let current = values[0];
  for (let index = 1; index < values.length; index += 1) {
    const next = addMoney(current, values[index]);
    if (!next.ok) return next;
    current = next.value;
  }
  return { ok: true, value: current };
}

export function compareMoney(a: Money, b: Money): MoneyComparison {
  const mismatch = sameCurrencyOrFailure(a, b);
  if (mismatch) return { ok: false, failure: mismatch };
  const order: MoneyOrder = a.minorUnits < b.minorUnits ? -1 : a.minorUnits > b.minorUnits ? 1 : 0;
  return { ok: true, order };
}

export function signOfMoney(value: Money): MoneyOrder {
  return value.minorUnits < 0 ? -1 : value.minorUnits > 0 ? 1 : 0;
}

export function isPositiveMoney(value: Money): boolean {
  return value.minorUnits > 0;
}

export function isZeroMoney(value: Money): boolean {
  return value.minorUnits === 0;
}

const ARABIC_INDIC_ZERO = 0x0660;
const ARABIC_INDIC_NINE = 0x0669;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;
const EXTENDED_ARABIC_INDIC_NINE = 0x06f9;
const ARABIC_DECIMAL_SEPARATOR = 0x066b;
const ASCII_ZERO = '0'.charCodeAt(0);
const ASCII_NINE = '9'.charCodeAt(0);
const ASCII_PLUS = '+'.charCodeAt(0);
const ASCII_MINUS = '-'.charCodeAt(0);
const ASCII_DOT = '.'.charCodeAt(0);

export type MoneyParseFailure =
  | { readonly reason: 'notText' }
  | { readonly reason: 'empty' }
  | { readonly reason: 'invalidCharacter'; readonly position: number; readonly character: string }
  | { readonly reason: 'malformedDecimal'; readonly detail: string }
  | { readonly reason: 'excessPrecision'; readonly fractionDigits: number; readonly allowedDigits: number }
  | { readonly reason: 'unsupportedCurrency'; readonly provided: unknown }
  | { readonly reason: 'unsafeAmount'; readonly detail: string };

export type MoneyParseResult =
  | { readonly ok: true; readonly value: Money }
  | { readonly ok: false; readonly failure: MoneyParseFailure };

/**
 * Parse a written decimal amount exactly, accepting Western digits,
 * Arabic-Indic digits (U+0660..U+0669), and Extended Arabic-Indic digits
 * (U+06F0..U+06F9), with '.' or U+066B as the decimal separator.
 *
 * The result is exact: fraction digits beyond the currency's ISO exponent are
 * rejected instead of rounded, grouping separators are rejected, and any value
 * outside the safe-integer minor-unit range is rejected.
 */
export function parseMoneyAmount(input: string, currency: CurrencyCode): MoneyParseResult {
  if (!isSupportedCurrency(currency)) {
    return { ok: false, failure: { reason: 'unsupportedCurrency', provided: currency } };
  }
  if (typeof input !== 'string') {
    return { ok: false, failure: { reason: 'notText' } };
  }
  if (input.length === 0) {
    return { ok: false, failure: { reason: 'empty' } };
  }

  let normalized = '';
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code >= ASCII_ZERO && code <= ASCII_NINE) {
      normalized += input[index];
    } else if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_NINE) {
      normalized += String.fromCharCode(ASCII_ZERO + (code - ARABIC_INDIC_ZERO));
    } else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_NINE) {
      normalized += String.fromCharCode(ASCII_ZERO + (code - EXTENDED_ARABIC_INDIC_ZERO));
    } else if (code === ARABIC_DECIMAL_SEPARATOR) {
      normalized += '.';
    } else if (code === ASCII_MINUS || code === ASCII_PLUS || code === ASCII_DOT) {
      normalized += input[index];
    } else {
      // Includes the Arabic thousands separator, ASCII grouping separators,
      // letters, whitespace, and any other character: never reinterpret it.
      return {
        ok: false,
        failure: { reason: 'invalidCharacter', position: index, character: input[index] },
      };
    }
  }

  let negative = false;
  let body = normalized;
  if (body.startsWith('+') || body.startsWith('-')) {
    negative = body.startsWith('-');
    body = body.slice(1);
  }
  if (body.length === 0) {
    return { ok: false, failure: { reason: 'malformedDecimal', detail: 'sign without digits' } };
  }

  const separatorCount = [...body].filter((character) => character === '.').length;
  if (separatorCount > 1) {
    return { ok: false, failure: { reason: 'malformedDecimal', detail: 'more than one decimal separator' } };
  }

  const [integerPart, fractionPart] = separatorCount === 1 ? body.split('.') : [body, null];
  if (integerPart.length === 0 || !/^\d+$/.test(integerPart)) {
    return { ok: false, failure: { reason: 'malformedDecimal', detail: 'integer digits are missing or invalid' } };
  }
  let fractionDigits = '';
  if (fractionPart !== null) {
    if (fractionPart.length === 0 || !/^\d+$/.test(fractionPart)) {
      return { ok: false, failure: { reason: 'malformedDecimal', detail: 'fraction digits are missing or invalid' } };
    }
    fractionDigits = fractionPart;
  }

  const exponent = currencyIsoExponent(currency);
  if (fractionDigits.length > exponent) {
    return {
      ok: false,
      failure: { reason: 'excessPrecision', fractionDigits: fractionDigits.length, allowedDigits: exponent },
    };
  }

  const scaled = integerPart + fractionDigits.padEnd(exponent, '0');
  const withoutLeadingZeros = scaled.replace(/^0+(?=\d)/, '');
  if (withoutLeadingZeros.length > 16) {
    return {
      ok: false,
      failure: { reason: 'unsafeAmount', detail: 'amount exceeds the safe integer minor-unit range' },
    };
  }
  const magnitude = Number(withoutLeadingZeros);
  if (!Number.isSafeInteger(magnitude)) {
    return {
      ok: false,
      failure: { reason: 'unsafeAmount', detail: 'amount exceeds the safe integer minor-unit range' },
    };
  }
  const minorUnits = magnitude === 0 ? 0 : negative ? -magnitude : magnitude;
  return { ok: true, value: Object.freeze({ currency, minorUnits }) };
}
