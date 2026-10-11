import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? '/', 'http://local').pathname;
    if (pathname === '/__empty-legacy-seed__') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>Empty legacy seed</title>');
      return;
    }
    const file = join(DIST, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
    response.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end('not found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('server address missing');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

try {
  const externalRequests = [];
  const freshPage = async ({ emptyLegacyDatabase = false } = {}) => {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => localStorage.setItem('rushd_lang', 'en'));
    await context.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        externalRequests.push(route.request().url());
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    if (emptyLegacyDatabase) {
      await page.goto(`${origin}/__empty-legacy-seed__`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open('MicroSaveOS_DB', 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          database.createObjectStore('settings', { keyPath: 'key' });
          database.createObjectStore('templates', { keyPath: 'id' });
          database.createObjectStore('expenses', { keyPath: 'id' });
        };
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
      }));
    }
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => typeof window.RushdDebug?.getAppProxy === 'function', null, { timeout: 60000 });
    return { context, page };
  };

  const emptyLegacy = await freshPage({ emptyLegacyDatabase: true });
  await emptyLegacy.page.getByText('Are you 18 or older?', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  const emptyLegacyState = await emptyLegacy.page.evaluate(async () => {
    const ports = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$p04dPorts;
    const databaseNames = await indexedDB.databases();
    return {
      hasBook: ports?.lifecycle?.hasUsableBook?.() ?? null,
      needsSetup: ports?.lifecycle?.needsGuestSetup?.() ?? null,
      sourceStillPresent: databaseNames.some((database) => database.name === 'MicroSaveOS_DB'),
    };
  });
  assert.deepEqual(emptyLegacyState, { hasBook: false, needsSetup: true, sourceStillPresent: true }, 'an existing but empty legacy database must enter first-run setup without being deleted or auto-funded');
  await emptyLegacy.context.close();

  const underage = await freshPage();
  await underage.page.getByText('Are you 18 or older?', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await underage.page.locator('.modal-floating-card input[type="date"]').count(), 0, 'the age gate must not request a date of birth');
  await underage.page.getByRole('button', { name: 'No, I’m under 18', exact: true }).click();
  await underage.page.getByText('Rushd is for adults.', { exact: false }).waitFor({ state: 'visible' });
  await underage.page.locator('.modal-close-btn').click();
  await underage.page.getByText('Rushd is for adults.', { exact: false }).waitFor({ state: 'visible' });
  const underageState = await underage.page.evaluate(() => {
    const ports = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$p04dPorts;
    return {
      hasBook: ports?.lifecycle?.hasUsableBook?.() ?? null,
      needsSetup: ports?.lifecycle?.needsGuestSetup?.() ?? null,
      onboardingState: ports?.lifecycle?.getOnboardingState?.() ?? null,
      dobInputs: document.querySelectorAll('.modal-floating-card input[type="date"]').length,
    };
  });
  assert.deepEqual(underageState, { hasBook: false, needsSetup: true, onboardingState: null, dobInputs: 0 }, 'under-18 exit must not create a finance book, persist age attestation, or collect DOB');
  await underage.context.close();

  const adult = await freshPage();
  await adult.page.getByText('Are you 18 or older?', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  await adult.page.getByRole('button', { name: 'Yes, I’m 18 or older', exact: true }).click();
  await adult.page.getByText('Which day starts your week?', { exact: true }).waitFor({ state: 'visible' });
  const setupInputs = adult.page.locator('.modal-floating-card input[autocomplete="off"]');
  await setupInputs.nth(0).fill('Asia/Riyadh');
  await adult.page.locator('.modal-floating-card select').selectOption('1');
  await adult.page.locator('.modal-floating-card input[type="radio"][value="fullCycle"]').check();
  await setupInputs.nth(1).fill('250.00');
  await adult.page.getByRole('button', { name: 'Save amount and start tracking', exact: true }).click();
  await adult.page.waitForFunction(() => {
    const ports = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$p04dPorts;
    return ports?.lifecycle?.getSettings?.().cycleMode === 'fullCycle';
  }, null, { timeout: 30000 });

  const opened = await adult.page.evaluate(() => {
    const ports = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$p04dPorts;
    return {
      cycleMode: ports.lifecycle.getSettings().cycleMode,
      safeToSpend: ports.home.getSafeToSpend(),
      weekStart: ports.lifecycle.getGuestSetupProgress?.().weekStart ?? null,
    };
  });
  assert.equal(opened.cycleMode, 'fullCycle');
  assert.equal(opened.safeToSpend, 250);

  await adult.page.locator('button.fab').click();
  await adult.page.locator('.modal-floating-card input[placeholder="Taxi, Lunch..."]').fill('Lunch');
  await adult.page.locator('.modal-floating-card input[placeholder="0.00"]').fill('25.00');
  await adult.page.locator('.modal-floating-card .btn-premium-add').click();
  await adult.page.waitForFunction(() => window.RushdDebug.getAppProxy().store.currentViewExpenses.some((expense) => expense.name === 'Lunch'));
  const afterExpense = await adult.page.evaluate(() => {
    const ports = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$p04dPorts;
    return {
      rows: ports.home.listSelectedDayExpenses().map((expense) => expense.name),
      safeToSpend: ports.home.getSafeToSpend(),
    };
  });
  assert.deepEqual(afterExpense.rows, ['Lunch']);
  assert.equal(afterExpense.safeToSpend, 225);

  await adult.page.reload({ waitUntil: 'domcontentloaded' });
  await adult.page.waitForFunction(() => {
    const ports = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$p04dPorts;
    return ports?.lifecycle?.getSettings?.().cycleMode === 'fullCycle';
  }, null, { timeout: 30000 });
  assert.equal(await adult.page.getByText('Are you 18 or older?', { exact: true }).count(), 0, 'a committed setup must not reopen or fund again on reload');
  const afterReload = await adult.page.evaluate(() => {
    const ports = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$p04dPorts;
    return {
      rows: ports.home.listSelectedDayExpenses().map((expense) => expense.name),
      safeToSpend: ports.home.getSafeToSpend(),
    };
  });
  assert.deepEqual(afterReload.rows, ['Lunch']);
  assert.equal(afterReload.safeToSpend, 225);
  assert.deepEqual(externalRequests, [], 'fresh guest onboarding must stay local');
  await adult.context.close();

  const boundary = await freshPage();
  await boundary.page.getByText('Are you 18 or older?', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  await boundary.page.getByRole('button', { name: 'Yes, I’m 18 or older', exact: true }).click();
  const boundaryInputs = boundary.page.locator('.modal-floating-card input[autocomplete="off"]');
  await boundaryInputs.nth(0).fill('Asia/Riyadh');
  await boundary.page.locator('.modal-floating-card select').selectOption('0');
  await boundary.page.locator('.modal-floating-card input[type="radio"][value="remainingFromNow"]').check();
  await boundaryInputs.nth(1).fill('300.00');
  await boundary.page.getByRole('button', { name: 'Save amount and start tracking', exact: true }).click();
  await boundary.page.waitForFunction(() => {
    const ports = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$p04dPorts;
    return ports?.lifecycle?.getSettings?.().cycleMode === 'remainingFromBoundary';
  }, null, { timeout: 30000 });
  await boundary.page.getByText('This pool was observed at the tracking boundary.', { exact: false }).waitFor({ state: 'visible' });
  const boundaryState = await boundary.page.evaluate(() => {
    const ports = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$p04dPorts;
    return {
      cycleMode: ports.lifecycle.getSettings().cycleMode,
      safeToSpend: ports.home.getSafeToSpend(),
      cycles: ports.lifecycle.getSettings().openCycleId,
    };
  });
  assert.equal(boundaryState.cycleMode, 'remainingFromBoundary');
  assert.equal(boundaryState.safeToSpend, 300);
  assert.ok(boundaryState.cycles);
  await boundary.page.reload({ waitUntil: 'domcontentloaded' });
  await boundary.page.waitForFunction(() => {
    const ports = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$p04dPorts;
    return ports?.lifecycle?.getSettings?.().cycleMode === 'remainingFromBoundary';
  }, null, { timeout: 30000 });
  const afterBoundaryReload = await boundary.page.evaluate(() => {
    const ports = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$p04dPorts;
    return {
      cycleMode: ports.lifecycle.getSettings().cycleMode,
      safeToSpend: ports.home.getSafeToSpend(),
      onboardingState: ports.lifecycle.getOnboardingState()?.status ?? null,
    };
  });
  assert.deepEqual(afterBoundaryReload, {
    cycleMode: 'remainingFromBoundary',
    safeToSpend: 300,
    onboardingState: 'completed',
  });
  await boundary.context.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log('P06 fresh-user onboarding browser regression passed.');
