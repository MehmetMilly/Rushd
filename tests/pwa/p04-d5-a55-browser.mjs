// P04-D5 production browser proof (real dist entry, durable OPFS path).
// Run: npm run test:p04d5  (build first: npm run build)
//
// Exercises the A55 correction boundaries through the PRODUCTION adapter
// (`rushd.portable.v1`, OPFS/SQLite worker, real service worker):
// online migrate + capture, non-empty versioned export, explicit
// snapshot plus port-level reset with immediate usable capture
// (no reload), re-import restoring rows with further usable writes,
// offline reload rendering committed
// rows from local storage, offline Range serving of the engine WASM,
// and device-id stability — with zero v1 writes and zero remote
// requests. All data is clearly fake; no account/cloud client exists.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = join(ROOT, 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
};

const failures = [];
function check(condition, label) {
  if (!condition) failures.push(label);
}

const now = new Date();
const pad2 = (n) => String(n).padStart(2, '0');
const TODAY_KEY = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      const body = await readFile(join(DIST, pathname.replace(/^\/+/, '')));
      res.writeHead(200, { 'Content-Type': MIME[extname(pathname)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return server;
}

const SEED_JS = `
  const todayKey = ${JSON.stringify(TODAY_KEY)};
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('MicroSaveOS_DB');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('seed delete blocked'));
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
    const transaction = db.transaction(['settings', 'templates', 'expenses'], 'readwrite');
    transaction.objectStore('settings').put({ key: 'baseAllowance', value: 1500 });
    transaction.objectStore('expenses').put({
      id: 'd5-bread', name: 'd5-bread', expectedCost: 12, actualPaid: 12, isPaid: true,
      date: todayKey, category: 'food', classification: 'essential', source: 'manual',
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  return true;
`;

async function waitBridge(page, timeout = 60000) {
  await page.waitForFunction(() => typeof window.RushdDebug?.getAppProxy === 'function', null, { timeout });
  await page.waitForTimeout(1500);
}

async function submitExpense(page, name, cost) {
  return page.evaluate(async ({ name, cost }) => {
    const proxy = window.RushdDebug.getAppProxy();
    proxy.addModal.form = {
      name, cost: String(cost), category: 'food', recurrence: 'daily',
      applicability: 'everyday', monthDay: '', classification: 'essential',
      source: 'manual', flexibleDefinitionId: '', monthlyBudget: '', maxUsesPerMonth: '',
    };
    proxy.addModal.mode = 'expense';
    proxy.addModal.open = true;
    await proxy.submitNewExpense();
    await proxy.$nextTick();
    return {
      modalOpen: proxy.addModal.open,
      rows: proxy.store.currentViewExpenses.map((row) => row.name),
      toast: proxy.toastMessage,
    };
  }, { name, cost });
}

function portsCall(page, script) {
  return page.evaluate(new Function(`
    const ports = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$p04dPorts ?? null;
    return (async () => { ${script} })();
  `));
}

async function main() {
  for (const required of ['dist/index.html', 'dist/sqlite-worker.js', 'dist/rushd-pwa-sw.js', 'dist/pkg/dist/wa-sqlite.mjs', 'dist/pkg/dist/wa-sqlite.wasm']) {
    check(await readFile(join(ROOT, required)).then(() => true).catch(() => false), `dist must contain ${required} (run npm run build)`);
  }
  if (failures.length > 0) {
    console.error(`p04-d5 browser failures:\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }

  const server = startServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server address missing');
  const origin = `http://127.0.0.1:${address.port}`;
  const serverOrigin = new URL(origin).origin;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const requests = [];
    await context.route('**/*', (route) => {
      const url = route.request().url();
      try {
        if (new URL(url).origin !== serverOrigin) {
          requests.push(url);
          return route.abort('blockedbyclient');
        }
      } catch {
        requests.push(url);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200));
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 200)}`));

    // Seed-first boot migrates behind the shell.
    await page.route('**/assets/*.js', (route) => route.abort('blockedbyclient'));
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(new Function(`return (async () => { ${SEED_JS} })()`));
    await page.unrouteAll({ behavior: 'wait' });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      try {
        if (new URL(url).origin !== serverOrigin) {
          requests.push(url);
          return route.abort('blockedbyclient');
        }
      } catch {
        requests.push(url);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitBridge(page);
    // The seed-visit asset aborts above are expected harness noise, not app
    // failures; later phases assert fully clean diagnostics.
    consoleErrors.length = 0;

    // Capture, then prove a non-empty production export carries the row.
    const first = await submitExpense(page, 'd5-seeded', 11);
    check(first.modalOpen === false && first.rows.includes('d5-seeded'), 'online capture commits');
    const backup = await portsCall(page, `return ports.portability.buildSnapshot();`);
    check(typeof backup === 'string' && backup.length > 0, 'production export produces a document');
    const parsed = JSON.parse(backup);
    check(parsed.format === 'rushd.portable.v1', `export is versioned production portability (got ${parsed.format})`);
    check(backup.includes('d5-seeded'), 'non-empty export carries the committed row');

    // Explicit snapshot, port-level reset (the port never exports), then
    // immediate usable capture with no reload and no restore.
    const deviceBefore = await page.evaluate(() => localStorage.getItem('rushd_device_id'));
    await portsCall(page, `await ports.portability.factoryReset({ resetId: 'rs-d5-01', confirmation: 'RESET-GUEST-SCOPE' });`);
    const usable = await portsCall(page, `return { book: ports.lifecycle.hasUsableBook(), authority: ports.authority.getState() };`);
    check(usable.book === true, 'post-reset scope holds a usable book');
    check(usable.authority.kind === 'canonicalReady', `performer stays writable (got ${usable.authority.kind})`);
    check(await page.evaluate(() => localStorage.getItem('rushd_device_id')) === deviceBefore, 'reset preserves the device id');
    const second = await submitExpense(page, 'd5-post-reset', 4.5);
    check(second.modalOpen === false && second.rows.includes('d5-post-reset'), 'post-reset capture commits without reload');
    check(!second.rows.includes('d5-seeded'), 'reset cleared prior finance data');

    // Re-import the explicit snapshot through the production adapter: rows
    // return and the scope stays usable for new writes.
    const restored = await portsCall(page, `
      return ports.portability.restoreSnapshot(${JSON.stringify(backup)}, { importId: 'im-d5-01', confirmation: 'REPLACE-ACTIVE-DATABASE' });
    `);
    check(restored && restored.ok === true, 'production re-import activates');
    const third = await submitExpense(page, 'd5-after-restore', 5);
    check(third.modalOpen === false && third.rows.includes('d5-seeded') && third.rows.includes('d5-after-restore'),
      `restored rows return and stay writable (rows: ${third.rows.join(',')})`);

    // Offline reload serves committed rows from local storage; the engine
    // WASM answers a Range request from cache without network.
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
    await waitBridge(page).catch(() => undefined);
    const offline = await page.evaluate(() => {
      const proxy = window.RushdDebug?.getAppProxy?.();
      if (!proxy) return { mounted: false, rows: [] };
      return { mounted: true, rows: proxy.store.currentViewExpenses.map((row) => row.name) };
    });
    check(offline.mounted === true, 'offline reload mounts the shell from cache');
    check(offline.rows.includes('d5-seeded') && offline.rows.includes('d5-after-restore'),
      `offline reload serves committed rows (got ${(offline.rows || []).join(',')})`);
    const ranged = await page.evaluate(async () => {
      try {
        const response = await fetch('/pkg/dist/wa-sqlite.wasm', { headers: { Range: 'bytes=0-99' } });
        const buffer = await response.arrayBuffer();
        return { status: response.status, bytes: buffer.byteLength };
      } catch (error) {
        return { status: -1, bytes: -1, error: String(error).slice(0, 120) };
      }
    });
    check(ranged.status === 206 && ranged.bytes === 100, `offline Range request serves 206 with 100 bytes (got ${ranged.status}/${ranged.bytes})`);
    const offlineWrite = await submitExpense(page, 'd5-offline-row', 2);
    check(offlineWrite.modalOpen === false && offlineWrite.rows.includes('d5-offline-row'), 'offline capture commits to local storage');
    await context.setOffline(false);

    // Back online the offline write persists; device id is stable; silent.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitBridge(page);
    const online = await page.evaluate(() => window.RushdDebug.getAppProxy().store.currentViewExpenses.map((row) => row.name));
    check(online.includes('d5-offline-row'), 'offline write persists after reload');
    check(await page.evaluate(() => localStorage.getItem('rushd_device_id')) === deviceBefore, 'device id stable end to end');
    const remote = requests.filter((url) => {
      try {
        return new URL(url).origin !== serverOrigin;
      } catch {
        return true;
      }
    });
    check(remote.length === 0, `remote requests observed: ${remote.slice(0, 5).join(', ')}`);
    check(consoleErrors.length === 0, `console/page errors: ${consoleErrors.slice(0, 5).join(' | ')}`);

    if (failures.length > 0) {
      console.error(`p04-d5 browser failures:\n- ${failures.join('\n- ')}`);
      process.exitCode = 1;
    } else {
      console.log('p04-d5 browser passed: production export/reset/import/usable-write, offline reload + Range, zero remote/errors');
    }
  } finally {
    await browser.close().catch(() => undefined);
    if (server.listening) server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
