export type RushdLanguage = 'ar' | 'en';
export type TranslationDictionary = Readonly<Record<string, string>>;
export type TranslationCatalog = Readonly<Record<RushdLanguage, TranslationDictionary>>;

export function assertTranslationCatalog(value: unknown): asserts value is TranslationCatalog {
  if (!value || typeof value !== 'object') throw new Error('Rushd translations must be an object.');
  const catalog = value as Record<string, unknown>;
  for (const language of ['ar', 'en'] as const) {
    const dictionary = catalog[language];
    if (!dictionary || typeof dictionary !== 'object') throw new Error(`Rushd ${language} translations are missing.`);
    if (Object.values(dictionary).some((entry) => typeof entry !== 'string')) {
      throw new Error(`Rushd ${language} translations contain a non-string value.`);
    }
  }
  const arabicKeys = Object.keys(catalog.ar as object).sort();
  const englishKeys = Object.keys(catalog.en as object).sort();
  if (arabicKeys.join('\u0000') !== englishKeys.join('\u0000')) {
    throw new Error('Rushd Arabic and English translation keys are not in parity.');
  }
}
