/**
 * ISO currency metadata for Rushd's canonical money primitives.
 *
 * The currency definition owns its exponent; nothing in the domain may assume
 * every currency has two decimals. Only explicitly supported launch currencies
 * are accepted. An unsupported code is a validation failure: it is never
 * relabeled, guessed, or converted with foreign exchange.
 */

export type IsoExponent = 0 | 2 | 3;

export const SUPPORTED_CURRENCIES = Object.freeze({
  SAR: { isoExponent: 2, englishName: 'Saudi riyal', arabicName: 'ريال سعودي' },
  USD: { isoExponent: 2, englishName: 'US dollar', arabicName: 'دولار أمريكي' },
  JPY: { isoExponent: 0, englishName: 'Japanese yen', arabicName: 'ين ياباني' },
  KWD: { isoExponent: 3, englishName: 'Kuwaiti dinar', arabicName: 'دينار كويتي' },
} as const satisfies Record<string, { isoExponent: IsoExponent; englishName: string; arabicName: string }>);

export type CurrencyCode = keyof typeof SUPPORTED_CURRENCIES;

export interface CurrencyMetadata {
  readonly code: CurrencyCode;
  readonly isoExponent: IsoExponent;
  readonly minorUnitsPerMajorUnit: number;
  readonly englishName: string;
  readonly arabicName: string;
}

export function isSupportedCurrency(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SUPPORTED_CURRENCIES, value);
}

export function currencyMetadata(code: CurrencyCode): CurrencyMetadata {
  const entry = SUPPORTED_CURRENCIES[code];
  return Object.freeze({
    code,
    isoExponent: entry.isoExponent,
    minorUnitsPerMajorUnit: 10 ** entry.isoExponent,
    englishName: entry.englishName,
    arabicName: entry.arabicName,
  });
}

export function currencyIsoExponent(code: CurrencyCode): IsoExponent {
  return SUPPORTED_CURRENCIES[code].isoExponent;
}
