import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TRANSLATIONS } from '../src/app/i18n/translations.js';

const arabicKeys = Object.keys(TRANSLATIONS.ar).sort();
const englishKeys = Object.keys(TRANSLATIONS.en).sort();
assert.deepEqual(englishKeys, arabicKeys, 'Arabic and English translation keys must stay in parity.');
assert.equal(TRANSLATIONS.en.flexibleConsumption, 'Flexible spending');
assert.equal(TRANSLATIONS.en.flexibleItemRequired, 'Choose a flexible item first.');

const source = await readFile('src/app/i18n/translations.js', 'utf8');
for (const locale of ['ar', 'en']) {
    const start = source.indexOf(`            ${locale}: {`);
    const nextLocale = locale === 'ar' ? source.indexOf('            en: {', start) : source.lastIndexOf('\n        };');
    assert.ok(start >= 0 && nextLocale > start, `Could not isolate ${locale} dictionary source.`);
    const keys = [...source.slice(start, nextLocale).matchAll(/^ {16}([A-Za-z_$][\w$]*):/gm)].map((match) => match[1]);
    const duplicateKeys = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
    assert.deepEqual(duplicateKeys, [], `${locale} dictionary has duplicate source keys: ${duplicateKeys.join(', ')}`);
}

console.log('Rushd i18n parity and duplicate-key gates passed.');
