import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { verifyFontLicenseProvenance } from './font-license-guard.mjs';
import { listProductionSourceFiles, readProductionSource } from './production-source.mjs';

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
  'eslint.config.cjs',
  'src/main.ts',
  'src/app/root-template.html',
  'src/app/root-controller.js',
  'src/app/i18n/translations.js',
  'src/data/legacy-v1/runtime.js',
  'src/application/bootstrap.js',
  'src/application/debug-test-bridge.js',
  'src/shared/core.js',
  'public/sw.js',
  'public/retire-rejected-shell.js'
];

const missing = requiredFiles.filter((file) => !existsSync(file));
if (missing.length) {
  throw new Error(`Missing required files: ${missing.join(', ')}`);
}

const html = readFileSync('index.html', 'utf8');
const requiredHtmlMarkers = [
  '<html lang="ar" dir="rtl">',
  '<div id="app" v-cloak></div>',
  '<script type="module" src="/src/main.ts"></script>'
];

const missingMarkers = requiredHtmlMarkers.filter((marker) => !html.includes(marker));
if (missingMarkers.length) {
  throw new Error(`index.html is missing expected markers: ${missingMarkers.join(', ')}`);
}
if (!html.includes('<script src="/retire-rejected-shell.js"></script>')) {
  throw new Error('index.html is missing the P04-D retirement trigger.');
}

const mainTs = readFileSync('src/main.ts', 'utf8');
if (!mainTs.includes('bootProductionApplication')) {
  throw new Error('src/main.ts must boot through the reviewed P04-D4 production cutover.');
}
const productionBoot = readFileSync('src/application/p04-d/production-boot.js', 'utf8');
if (!productionBoot.includes('createLegacyApplication')) {
  throw new Error('P04-D4 production boot must keep createLegacyApplication as the composition root.');
}
if (mainTs.includes('createGuestApplication')) {
  throw new Error('src/main.ts must not mount createGuestApplication in this rollback release.');
}

const retirementWorker = readFileSync('public/sw.js', 'utf8');
if (/addEventListener\(\s*['"]fetch['"]/.test(retirementWorker)) {
  throw new Error('public/sw.js must not install a fetch handler.');
}
if (!retirementWorker.includes("name.startsWith(SHELL_CACHE_PREFIX)") || !retirementWorker.includes('registration.unregister')) {
  throw new Error('public/sw.js must delete only rushd-shell caches and unregister itself.');
}

const productionSource = readProductionSource();
const requiredProductionMarkers = ['Vue.createApp', 'indexedDB.open', 'exportData', 'importData', 'factoryReset', 'Rushd'];
const missingProductionMarkers = requiredProductionMarkers.filter((marker) => !productionSource.includes(marker));
if (missingProductionMarkers.length) {
  throw new Error(`P02 module source is missing expected markers: ${missingProductionMarkers.join(', ')}`);
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
verifyFontLicenseProvenance(fontProvenance);

const sourceFiles = listProductionSourceFiles();

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
