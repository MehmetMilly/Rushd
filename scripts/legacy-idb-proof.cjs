const assert = require('node:assert/strict');
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, join, resolve } = require('node:path');
const { chromium } = require('playwright');

const root = resolve(process.env.RUSHD_LEGACY_IDB_ROOT || 'dist');
const port = Number(process.env.RUSHD_LEGACY_IDB_PORT || 4174);
const baseUrl = `http://127.0.0.1:${port}`;
const fakeExpenseName = 'P02 legacy v1 fixture';
const expectedSchema = {
  name: 'MicroSaveOS_DB',
  version: 1,
  stores: [
    { name: 'expenses', keyPath: 'id', indexes: [{ name: 'date', keyPath: 'date', unique: false }, { name: 'isPaid', keyPath: 'isPaid', unique: false }] },
    { name: 'settings', keyPath: 'key', indexes: [] },
    { name: 'templates', keyPath: 'id', indexes: [] }
  ]
};
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json'
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

async function deleteLegacyDatabase(page) {
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('MicroSaveOS_DB');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Legacy test database delete was blocked.'));
    });
  });
}

async function inspectProductionDatabase(page, expectedRecord) {
  // P04-D4 cutover: the production app no longer holds a live v1
  // connection (`DB.connect` is frozen; extraction uses its own handle),
  // so the proof reads v1 back through a raw reopen only. It asserts the
  // schema is untouched at version 1 AND the seeded record bytes are
  // identical (extraction-only: migration never writes v1).
  return page.evaluate(async (expected) => {
    const describe = (database) => ({
      name: database.name,
      version: database.version,
      stores: [...database.objectStoreNames].sort().map((name) => {
        const store = database.transaction(name, 'readonly').objectStore(name);
        return {
          name,
          keyPath: store.keyPath,
          indexes: [...store.indexNames].sort().map((indexName) => {
            const index = store.index(indexName);
            return { name: index.name, keyPath: index.keyPath, unique: index.unique };
          })
        };
      })
    });
    if (typeof window.RushdDebug?.getAppProxy !== 'function') {
      throw new Error('Production app did not mount the established shell.');
    }
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('MicroSaveOS_DB', 1);
      let upgraded = false;
      request.onupgradeneeded = () => { upgraded = true; };
      request.onsuccess = () => resolve({ db: request.result, upgraded });
      request.onerror = () => reject(request.error);
    });
    try {
      const expenses = await new Promise((resolve, reject) => {
        const transaction = database.db.transaction(['expenses'], 'readonly');
        const request = transaction.objectStore('expenses').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const seeded = expenses.find((row) => row && row.id === 'p02-legacy-v1-expense');
      return {
        schema: describe(database.db),
        upgraded: database.upgraded,
        seeded: seeded ?? null,
        matchesSeed: JSON.stringify(seeded ?? null) === JSON.stringify(expected),
      };
    } finally {
      database.db.close();
    }
  }, expectedRecord);
}

function assertCleanDiagnostics(externalRequests, messages) {
  assert.deepEqual([...externalRequests], []);
  assert.deepEqual(messages.filter((message) => ['error', 'warning', 'pageerror'].includes(message.type)), []);
}

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
      // P04-D4 cutover: the fixture expense is paid. Unpaid legacy rows
      // are truthfully quarantined (never migrated as spendable facts),
      // so only a paid actual renders after migration.
      transaction.objectStore('expenses').put({
        id: 'p02-legacy-v1-expense', name: expenseName, expectedCost: 77,
        actualPaid: 77, isPaid: true, category: 'food', classification: 'essential',
        source: 'manual', date, createdAt: '2026-08-10T09:00:00.000Z'
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    return {
      date,
      record: {
        id: 'p02-legacy-v1-expense', name: expenseName, expectedCost: 77,
        actualPaid: 77, isPaid: true, category: 'food', classification: 'essential',
        source: 'manual', date, createdAt: '2026-08-10T09:00:00.000Z'
      }
    };
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
  const seeded = await seedLegacyV1(page);
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.getByText(fakeExpenseName, { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  const proof = await inspectProductionDatabase(page, seeded.record);

  assert.equal(seeded.date, await page.evaluate(() => window.MicroSaveStore.currentDate));
  assert.deepEqual(proof.schema, expectedSchema);
  assert.equal(proof.upgraded, false);
  assert.equal(proof.matchesSeed, true);
  assertCleanDiagnostics(externalRequests, messages);

  await context.close();

  // P04-D4 cutover: a fresh boot must NOT create `MicroSaveOS_DB` — v1
  // opens only inside explicit read-only extraction, and there is nothing
  // to extract. The shell still mounts canonical on an empty book.
  const freshContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const freshPage = await freshContext.newPage();
  const freshExternalRequests = new Set();
  const freshMessages = [];
  freshPage.on('console', (message) => freshMessages.push({ type: message.type(), text: message.text() }));
  freshPage.on('pageerror', (error) => freshMessages.push({ type: 'pageerror', text: error.message }));
  await freshPage.route('**/*', async (route) => {
    const url = route.request().url();
    if (new URL(url).origin !== localOrigin) {
      freshExternalRequests.add(url);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await freshPage.goto(`${baseUrl}/p02-idb-seed.html`);
  await deleteLegacyDatabase(freshPage);
  await freshPage.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  const freshShell = await freshPage.evaluate(async () => ({
    mounted: typeof window.RushdDebug?.getAppProxy === 'function',
    databases: (await indexedDB.databases()).map((entry) => entry.name),
  }));
  assert.equal(freshShell.mounted, true);
  assert.ok(!freshShell.databases.includes('MicroSaveOS_DB'), 'fresh boot must not create the v1 database');
  assertCleanDiagnostics(freshExternalRequests, freshMessages);
  await freshContext.close();

  await browser.close();
  await close();
  console.log('Rushd legacy IndexedDB v1 reopen/read/render and fresh-no-create proof passed.');
})().catch(async (error) => {
  await close().catch(() => {});
  console.error(error);
  process.exit(1);
});
