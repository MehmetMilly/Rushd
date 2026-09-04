import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const requiredFiles = [
  'index.html',
  'README.md',
  'AGENTS.md',
  'LICENSE',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'docs/architecture.md',
  'docs/data-model.md',
  'docs/roadmap.md',
  'docs/privacy-notes.md',
  'docs/codex-use-cases.md',
  'docs/application-summary.md',
  'docs/manual-qa.md',
  'public/vendor/vue.global.js',
  'public/vendor/vue.global.js.sha256',
  'public/fonts/google-fonts.css',
  'public/fonts/material-symbols-rounded.css',
  'public/fonts/PROVENANCE.json',
  'public/fonts/licenses/ibmplexsansarabic-OFL.txt',
  'public/fonts/licenses/notokufiarabic-OFL.txt',
  'public/fonts/licenses/inter-OFL.txt',
  'public/fonts/licenses/jetbrainsmono-OFL.txt',
  'public/fonts/licenses/outfit-OFL.txt',
  'public/fonts/licenses/sora-OFL.txt',
  'public/fonts/licenses/material-symbols-apache-2.0.txt',
  'src/styles/tailwind.css',
  'tailwind.config.cjs',
  'postcss.config.cjs',
  'vite.config.mjs',
  'tsconfig.json',
  'eslint.config.js'
];

const missing = requiredFiles.filter((file) => !existsSync(file));
if (missing.length) {
  throw new Error(`Missing required files: ${missing.join(', ')}`);
}

const html = readFileSync('index.html', 'utf8');
const requiredHtmlMarkers = [
  '<html lang="ar" dir="rtl">',
  'Vue.createApp',
  'indexedDB.open',
  'exportData',
  'importData',
  'factoryReset',
  'Rushd'
];

const missingMarkers = requiredHtmlMarkers.filter((marker) => !html.includes(marker));
if (missingMarkers.length) {
  throw new Error(`index.html is missing expected markers: ${missingMarkers.join(', ')}`);
}

const externalHtmlAssets = [...html.matchAll(/\b(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)/gi)].map((match) => match[1]);
if (externalHtmlAssets.length) {
  throw new Error(`index.html still references external runtime asset(s): ${externalHtmlAssets.join(', ')}`);
}

if (/cdn\.tailwindcss\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com\/vue/i.test(html)) {
  throw new Error('index.html still contains a removed runtime CDN reference.');
}

const localVue = readFileSync('public/vendor/vue.global.js');
if (!localVue.includes('vue v3.5.42')) {
  throw new Error('public/vendor/vue.global.js is not the pinned Vue 3.5.42 global build.');
}
const localVueHash = createHash('sha256').update(localVue).digest('hex');
const recordedVueHash = readFileSync('public/vendor/vue.global.js.sha256', 'utf8').trim().split(/\s+/)[0];
if (localVueHash !== recordedVueHash) {
  throw new Error(`Pinned Vue hash mismatch: expected ${recordedVueHash}, got ${localVueHash}.`);
}

const localFontStylesheets = [
  'public/fonts/google-fonts.css',
  'public/fonts/material-symbols-rounded.css'
];
for (const stylesheet of localFontStylesheets) {
  const source = readFileSync(stylesheet, 'utf8');
  if (/https?:\/\//i.test(source)) {
    throw new Error(`${stylesheet} contains a remote font URL.`);
  }
}

const fontProvenance = JSON.parse(readFileSync('public/fonts/PROVENANCE.json', 'utf8'));
const declaredLicenses = [
  ...fontProvenance.families.map((family) => ({ owner: family.family, ...family.license })),
  { owner: fontProvenance.icon_font.family, ...fontProvenance.icon_font.license }
];
const licenseRoot = resolve('public/fonts');
for (const license of declaredLicenses) {
  if (!license.path || !license.sha256) {
    throw new Error(`Font provenance is missing a local license path or SHA-256 for ${license.owner}.`);
  }
  const licensePath = resolve(licenseRoot, license.path);
  const relativeLicensePath = relative(licenseRoot, licensePath);
  if (!relativeLicensePath || relativeLicensePath.startsWith('..')) {
    throw new Error(`Font provenance license path escapes public/fonts: ${license.path}.`);
  }
  if (!existsSync(licensePath)) {
    throw new Error(`Font provenance license file is missing for ${license.owner}: ${license.path}.`);
  }
  const actualLicenseHash = createHash('sha256').update(readFileSync(licensePath)).digest('hex');
  if (actualLicenseHash !== license.sha256) {
    throw new Error(`Font license SHA-256 mismatch for ${license.owner} (${license.path}): expected ${license.sha256}, got ${actualLicenseHash}.`);
  }
}

const sourceFiles = ['index.html'];
function collectSourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(filePath);
    } else if (/\.(?:html|js|mjs|ts|vue)$/.test(entry.name)) {
      sourceFiles.push(filePath);
    }
  }
}
if (existsSync('src')) collectSourceFiles('src');

// Tailwind's build-time scanner only sees literal class tokens.  Keep this
// guard intentionally narrow: the feasibility spike found only custom
// `cat-*`, `variant-*`, and `source-*` constructions, which are not utilities.
const utilityPrefixes = [
  'bg', 'text', 'border', 'from', 'via', 'to', 'flex', 'grid', 'col', 'row',
  'p', 'px', 'py', 'pt', 'pb', 'ps', 'pe', 'm', 'mx', 'my', 'mt', 'mb', 'ms', 'me',
  'w', 'h', 'min-w', 'min-h', 'max-w', 'max-h', 'gap', 'space', 'rounded', 'font',
  'leading', 'tracking', 'shadow', 'opacity', 'z', 'inset', 'top', 'right', 'bottom',
  'left', 'justify', 'items', 'content', 'self', 'order', 'overflow', 'whitespace',
  'truncate', 'animate', 'transition', 'duration', 'ease', 'scale', 'rotate',
  'translate', 'origin', 'cursor', 'select', 'appearance', 'outline', 'ring', 'divide',
  'decoration', 'underline', 'uppercase', 'lowercase', 'italic', 'not-italic', 'align',
  'object', 'visible', 'invisible', 'sr'
];
const utilityPrefixPattern = utilityPrefixes.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const dynamicUtilityPattern = new RegExp(`(?:["'\`])(?:[a-z0-9_-]+:)*(?:${utilityPrefixPattern})-[^"'\`$]*(?:\\$\\{|\\s*\\+)`, 'gi');
const dynamicUtilities = [];
for (const sourceFile of sourceFiles) {
  const source = readFileSync(sourceFile, 'utf8');
  for (const match of source.matchAll(dynamicUtilityPattern)) {
    const line = source.slice(0, match.index).split('\n').length;
    dynamicUtilities.push(`${sourceFile}:${line}:${match[0]}`);
  }
}
if (dynamicUtilities.length) {
  throw new Error(`Tailwind utility classes must be literal for source scanning: ${dynamicUtilities.join(', ')}`);
}

if (html.includes('\\r\\n')) {
  throw new Error('index.html contains literal escaped line break text.');
}

const forbiddenClaims = [
  'bank-grade',
  'certified financial advisor',
  'production-ready',
  'guaranteed financial advice'
];

const readme = readFileSync('README.md', 'utf8').toLowerCase();
const badClaims = forbiddenClaims.filter((claim) => readme.includes(claim));
if (badClaims.length) {
  throw new Error(`README contains overclaiming language: ${badClaims.join(', ')}`);
}

console.log('Rushd smoke check passed.');
