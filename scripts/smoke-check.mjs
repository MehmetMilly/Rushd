import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

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

if (html.includes('unpkg.com/vue')) {
  throw new Error('index.html still references the unpinned Vue CDN.');
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
