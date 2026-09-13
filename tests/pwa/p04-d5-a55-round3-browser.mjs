// P04-D5 round-3 production browser regression (real dist entry, durable OPFS path).
// Run: npm run test:p04d5-round3  (build first: npm run build)
//
// A55 A9 convergence: two explicit same-origin tabs share one device id and
// one canonical namespace. After a commit in the fresh tab, the older tab's
// canonical count (ports.home read model) refreshes via commit invalidation,
// but on `7e81593` its legacy UI mirror (store.currentViewExpenses →
// rendered row cards) never re-mirrors until something else re-syncs it:
// count reports 3 while the cards still show 1. The correction re-mirrors
// the visible day on every same-namespace commit (read-only; writability
// untouched) and paints the boot mirror from the hydrated cache before the
// refresh round-trip, so count and cards converge live and after reload.
//
// Fails on `7e81593` at the live-convergence assertion (count 3 vs cards 1
// with no reload). Passes with the correction. All data is clearly fake;
// no account/cloud client exists.
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
      id: 'r3-bread', name: 'r3-bread', expectedCost: 12, actualPaid: 12, isPaid: true,
      date: todayKey, category: 'food', classification: 'essential', source: 'manual',
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  try { localStorage.clear(); } catch {}
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
    };
  }, { name, cost });
}

// Canonical count (read model) next to the rendered legacy UI (mirror + DOM)
// for one tab. On the base commit these diverge in the older tab.
function probeCall(page) {
  return page.evaluate(() => {
    const proxy = window.RushdDebug?.getAppProxy?.();
    const ports = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$p04dPorts ?? null;
    if (!proxy || !ports) return { ready: false };
    return {
      ready: true,
      deviceId: (() => { try { return localStorage.getItem('rushd_device_id'); } catch { return null; } })(),
      authority: ports.authority.getState().kind,
      count: ports.home.listSelectedDayExpenses().length,
      mirror: proxy.store.currentViewExpenses.length,
      cards: document.querySelectorAll('.expense-card').length,
      names: proxy.store.currentViewExpenses.map((row) => row.name),
    };
  });
}

async function main() {
  for (const required of ['dist/index.html', 'dist/sqlite-worker.js', 'dist/rushd-pwa-sw.js', 'dist/pkg/dist/wa-sqlite.mjs', 'dist/pkg/dist/wa-sqlite.wasm']) {
    check(await readFile(join(ROOT, required)).then(() => true).catch(() => false), `dist must contain ${required} (run npm run build)`);
  }
  if (failures.length > 0) {
    console.error(`p04-d5 round-3 browser failures:\n- ${failures.join('\n- ')}`);
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
    const routeRemote = (route) => {
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
    };
    // Two explicit same-origin tabs (pinned targets): the older tab loads
    // first, the fresh tab second. Both share device id and namespace.
    const older = await context.newPage();
    const consoleErrors = [];
    const failedRequests = [];
    const listen = (page) => {
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200));
      });
      page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 200)}`));
      page.on('requestfailed', (request) => {
        const failure = request.failure();
        failedRequests.push(`${request.url().slice(0, 160)} :: ${failure ? failure.errorText : 'none'}`);
      });
    };
    listen(older);
    // Seed-first boot (same proven pattern as the D5 gate): the seed visit
    // skips the bundle, writes raw v1 rows, then the real boot migrates.
    await older.route('**/assets/*.js', (route) => route.abort('blockedbyclient'));
    await older.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await older.evaluate(new Function(`return (async () => { ${SEED_JS} })()`));
    await older.unrouteAll({ behavior: 'wait' });
    await context.route('**/*', routeRemote);
    await older.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitBridge(older);

    const fresh = await context.newPage();
    listen(fresh);
    await fresh.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitBridge(fresh);
    // The seed-visit asset aborts above are expected harness noise, not app
    // failures.
    consoleErrors.length = 0;
    failedRequests.length = 0;

    const olderId = await older.evaluate(() => localStorage.getItem('rushd_device_id'));
    const freshId = await fresh.evaluate(() => localStorage.getItem('rushd_device_id'));
    check(typeof olderId === 'string' && olderId.length > 0, 'older tab holds a stable device id');
    check(freshId === olderId, 'fresh same-origin target shares the stable device id');

    // Commit two rows in the fresh tab (seed migrated 1 + 2 = 3 total).
    const first = await submitExpense(fresh, 'r3-second', 2.34);
    check(first.modalOpen === false && first.rows.includes('r3-second'), 'fresh-tab commit lands');
    const second = await submitExpense(fresh, 'r3-third', 1.11);
    check(second.modalOpen === false && second.rows.length === 3, `fresh tab renders all three rows (got ${second.rows.join(',')})`);

    // Live convergence with NO reload: the older tab's canonical count and
    // its rendered row cards must converge to the same three rows. On the
    // base commit the count refreshes to 3 while the mirror/cards stay at
    // 1 — the observed A9 divergence.
    let live = await probeCall(older);
    check(live.ready === true, 'older tab exposes the debug bridge and ports');
    const liveDeadline = Date.now() + 15000;
    while (Date.now() < liveDeadline) {
      live = await probeCall(older);
      if (live.ready && live.count === 3 && live.mirror === 3 && live.cards === 3) break;
      await older.waitForTimeout(250);
    }
    check(live.count === 3, `older tab canonical count converges live (got ${live.count})`);
    check(live.mirror === 3 && live.cards === 3,
      `older tab rendered cards track the canonical count with no reload (mirror ${live.mirror}, cards ${live.cards}, rows ${(live.names || []).join(',')})`);

    // Reload convergence on the pinned older target: count and cards agree
    // after a fresh reload and the tab stays writable in its namespace.
    await older.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitBridge(older);
    const after = await probeCall(older);
    check(after.ready === true, 'reloaded older tab remounts the bridge and ports');
    check(after.deviceId === olderId, 'reload preserves the stable device id');
    check(after.authority === 'canonicalReady', `reloaded tab stays writable (got ${after.authority})`);
    check(after.count === 3, `reloaded tab canonical count is 3 (got ${after.count})`);
    check(after.mirror === 3 && after.cards === 3,
      `reloaded tab renders the same three cards as its count (mirror ${after.mirror}, cards ${after.cards}, rows ${(after.names || []).join(',')})`);

    const remote = requests.filter((url) => {
      try {
        return new URL(url).origin !== serverOrigin;
      } catch {
        return true;
      }
    });
    check(remote.length === 0, `remote requests observed: ${remote.slice(0, 5).join(', ')}`);
    check(consoleErrors.length === 0, `console/page errors: ${consoleErrors.slice(0, 5).join(' | ')}`);
    check(failedRequests.length === 0, `failed local requests: ${failedRequests.slice(0, 5).join(' | ')}`);

    if (failures.length > 0) {
      console.error(`p04-d5 round-3 browser failures:\n- ${failures.join('\n- ')}`);
      process.exitCode = 1;
    } else {
      console.log('p04-d5 round-3 browser passed: two-tab live count/card convergence plus reload convergence, zero remote/errors');
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
