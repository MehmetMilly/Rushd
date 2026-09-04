const assert = require('node:assert/strict');
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, join, resolve } = require('node:path');
const { chromium } = require('playwright');

const root = resolve(process.env.RUSHD_LEGACY_IDB_ROOT || 'dist');
const port = Number(process.env.RUSHD_LEGACY_IDB_PORT || 4174);
const baseUrl = `http://127.0.0.1:${port}`;
const fakeExpenseName = 'P02 legacy v1 fixture';
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2'
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', baseUrl);
    if (url.pathname === '/p02-idb-seed.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>P02 legacy DB seed</title>');
      return;
    }
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = join(root, pathname.replace(/^\/+/, ''));
    response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream' });
    response.end(await readFile(filePath));
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

const listen = () => new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
const close = () => new Promise((resolve) => server.close(resolve));

async function seedLegacyV1(page) {
  return page.evaluate(async ({ expenseName }) => {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('MicroSaveOS_DB');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Legacy test database delete was blocked.'));
    });
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('MicroSaveOS_DB', 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore('settings', { keyPath: 'key' });
        database.createObjectStore('templates', { keyPath: 'id' });
        const expenses = database.createObjectStore('expenses', { keyPath: 'id' });
        expenses.createIndex('date', 'date', { unique: false });
        expenses.createIndex('isPaid', 'isPaid', { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['settings', 'expenses'], 'readwrite');
      transaction.objectStore('settings').put({ key: 'baseAllowance', value: 1000 });
      transaction.objectStore('settings').put({
        key: 'onboardingState',
        value: { status: 'completed', updatedAt: '2026-08-10T09:00:00.000Z', source: 'p02-legacy-proof' }
      });
      transaction.objectStore('expenses').put({
        id: 'p02-legacy-v1-expense', name: expenseName, expectedCost: 77,
        actualPaid: 0, isPaid: false, category: 'food', classification: 'essential',
        source: 'manual', date, createdAt: '2026-08-10T09:00:00.000Z'
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    return date;
  }, { expenseName: fakeExpenseName });
}

(async () => {
  await listen();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const externalRequests = new Set();
  const messages = [];
  const localOrigin = new URL(baseUrl).origin;
  page.on('console', (message) => messages.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', (error) => messages.push({ type: 'pageerror', text: error.message }));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (new URL(url).origin !== localOrigin) {
      externalRequests.add(url);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  await page.goto(`${baseUrl}/p02-idb-seed.html`);
  const expectedDate = await seedLegacyV1(page);
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.getByText(fakeExpenseName, { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  const proof = await page.evaluate(async () => {
    const appDatabase = window.MicroSaveDB.db;
    const reopen = await new Promise((resolve, reject) => {
      const request = indexedDB.open('MicroSaveOS_DB', 1);
      let upgraded = false;
      request.onupgradeneeded = () => { upgraded = true; };
      request.onsuccess = () => {
        const database = request.result;
        resolve({ name: database.name, version: database.version, stores: [...database.objectStoreNames], upgraded });
        database.close();
      };
      request.onerror = () => reject(request.error);
    });
    return { appName: appDatabase.name, appVersion: appDatabase.version, reopen };
  });

  assert.equal(expectedDate, await page.evaluate(() => window.MicroSaveStore.currentDate));
  assert.deepEqual(proof, {
    appName: 'MicroSaveOS_DB', appVersion: 1,
    reopen: { name: 'MicroSaveOS_DB', version: 1, stores: ['expenses', 'settings', 'templates'], upgraded: false }
  });
  assert.deepEqual([...externalRequests], []);
  assert.deepEqual(messages.filter((message) => ['error', 'warning', 'pageerror'].includes(message.type)), []);

  await browser.close();
  await close();
  console.log('Rushd legacy IndexedDB v1 reopen/read/render proof passed.');
})().catch(async (error) => {
  await close().catch(() => {});
  console.error(error);
  process.exit(1);
});
