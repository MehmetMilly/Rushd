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
  'docs/manual-qa.md'
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
