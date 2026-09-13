// P04-D4 browser gate (real production entry). Run: node tests/pwa/p04-d4-browser.mjs
/* global URL:readonly, console:readonly, process:readonly */
//
// Production-cutover proof through the REAL Vite `dist` entry: the page
// boots `dist/index.html` (cinema shell, fonts, retirement script, local
// manifest) into `bootProductionApplication` over fake v1 data seeded into
// the REAL IndexedDB source and the REAL durable canonical stack
// (`dist/sqlite-worker.js` + `dist/pkg` engine closure). It exercises
// migrate-once, controller-driven add/plan/goals/settle, controller-driven
// export-first reset with download, reload, re-import of the safety
// backup, offline reload, retirement coexistence, storage-failure
// write-blocking, and epoch hard-blocking — with zero v1 writes end to
// end (byte-identical v1 input) and zero remote requests. All data is
// clearly fake; no account/cloud client is constructed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = join(ROOT, 'dist');
const RAW_DIR = join(ROOT, 'artifacts/agent-reports/p04d4-raw');
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
  return condition;
}

const now = new Date();
const pad2 = (n) => String(n).padStart(2, '0');
const TODAY_KEY = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
const TODAY_DAY = now.getDate();
const MONTH_KEY = TODAY_KEY.slice(0, 7);

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

// Fake v1 seed written with raw IndexedDB (no app code): one allowance,
// one monthly template, two paid expenses dated device-local today.
const SEED_JS = `
  const todayKey = ${JSON.stringify(TODAY_KEY)};
  const todayDay = ${TODAY_DAY};
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
    transaction.objectStore('settings').put({
      key: 'onboardingState',
      value: { status: 'completed', updatedAt: '2026-08-10T09:00:00.000Z', source: 'p04-d4-gate' },
    });
    transaction.objectStore('templates').put({
      id: 'd4-rent', name: 'Rent', expectedCost: 2000, days: [todayDay],
      source: 'template', recurrence: 'monthly', applicability: 'everyday', profileId: '',
    });
    transaction.objectStore('expenses').put({
      id: 'd4-bread', name: 'd4-bread', expectedCost: 12, actualPaid: 12, isPaid: true,
      date: todayKey, category: 'food', classification: 'essential', source: 'manual',
    });
    transaction.objectStore('expenses').put({
      id: 'd4-scarf', name: 'd4-scarf', expectedCost: 300, actualPaid: 300, isPaid: true,
      date: todayKey, category: 'shopping', classification: 'luxury',
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  return true;
`;

const FINGERPRINT_JS = `
  const runtime = { stores: {}, allowance: null };
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('MicroSaveOS_DB', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  for (const store of ['settings', 'templates', 'expenses']) {
    runtime.stores[store] = await new Promise((resolve, reject) => {
      const transaction = db.transaction([store], 'readonly');
      const request = transaction.objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  db.close();
  for (const row of runtime.stores.settings) {
    if (row.key === 'baseAllowance') runtime.allowance = row.value;
  }
  runtime.stores.expenses.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  runtime.stores.templates.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify(runtime);
`;

async function waitBridge(page, timeout = 60000) {
  await page.waitForFunction(() => typeof window.RushdDebug?.getAppProxy === 'function', null, { timeout });
  await page.waitForTimeout(1500);
}

function proxySummaryScript() {
  // Built with `new Function` so page.evaluate receives a real function
  // (a bare string would run as a program, where `return` is illegal).
  return new Function(`
    const proxy = window.RushdDebug.getAppProxy();
    const ports = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$p04dPorts ?? null;
    return {
      currentDate: proxy.store.currentDate,
      dayRows: proxy.store.currentViewExpenses.length,
      domCards: document.querySelectorAll('.expense-card').length,
      safeToSpend: ports ? ports.home.getSafeToSpend() : null,
      heroUnknown: !!document.querySelector('.home-hero-unknown-btn'),
      luxuryTags: document.querySelectorAll('.luxury-tag').length,
      templates: (proxy.store.templates || []).map((t) => t.id),
      goals: (proxy.store.settings.vault.goals || []).map((g) => g.id),
      allowance: proxy.store.settings.baseAllowance,
      authority: ports ? ports.authority.getState() : null,
      toast: proxy.toastMessage,
    };
  `);
}

async function main() {
  mkdirSync(RAW_DIR, { recursive: true });
  for (const required of ['dist/index.html', 'dist/sqlite-worker.js', 'dist/pkg/dist/wa-sqlite.mjs', 'dist/pkg/dist/wa-sqlite.wasm']) {
    check((await readFile(join(ROOT, required)).then(() => true).catch(() => false)), `dist must contain ${required} (run npm run build)`);
  }
  if (failures.length > 0) {
    console.error(`p04-d4 browser failures:\n- ${failures.join('\n- ')}`);
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
    // ---- Phase 0: storage failure still mounts the shell write-blocked.
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.route('**/sqlite-worker.js', (route) => route.abort('failed'));
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitBridge(page).catch(() => undefined);
      const state = await page.evaluate(() => {
        const proxy = window.RushdDebug?.getAppProxy?.();
        if (!proxy) return { mounted: false };
        return { mounted: true, cards: document.querySelectorAll('.expense-card').length };
      });
      check(state.mounted === true, 'storage failure must still mount the established shell');
      const blocked = await page.evaluate(async () => {
        const proxy = window.RushdDebug.getAppProxy();
        proxy.addModal.form = {
          name: 'd4-never', cost: '5', category: 'food', recurrence: 'daily',
          applicability: 'everyday', monthDay: '', classification: 'essential',
          source: 'manual', flexibleDefinitionId: '', monthlyBudget: '', maxUsesPerMonth: '',
        };
        proxy.addModal.mode = 'expense';
        proxy.addModal.open = true;
        await proxy.submitNewExpense();
        await proxy.$nextTick();
        return { modalOpen: proxy.addModal.open, toast: proxy.toastMessage };
      });
      check(blocked.modalOpen === true, 'failed storage must leave the add modal open (no false success)');
      check(typeof blocked.toast === 'string' && blocked.toast.length > 0, 'failed storage must surface a visible refusal');
      await context.close();
    }

    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const requests = [];
    const failedRequests = [];
    const consoleErrors = [];
    const dialogs = [];
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
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) consoleErrors.push(`${message.type()}: ${message.text().slice(0, 200)}`);
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 200)}`));
    page.on('requestfailed', (request) => failedRequests.push(`${request.url().slice(0, 100)}: ${request.failure()?.errorText}`));
    page.on('dialog', async (dialog) => {
      dialogs.push(`${dialog.type()}: ${dialog.message().slice(0, 120)}`);
      await dialog.dismiss();
    });

    // ---- Phase 1: seed-first boot migrates once behind the shell.
    await page.route('**/assets/*.js', (route) => route.abort('blockedbyclient'));
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(new Function(`return (async () => { ${SEED_JS} })()`));
    const v1Before = await page.evaluate(new Function(`return (async () => { ${FINGERPRINT_JS} })()`));
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
    // The phase-1 asset aborts above are expected harness noise, not app
    // failures; later phases assert fully clean diagnostics.
    failedRequests.length = 0;
    consoleErrors.length = 0;
    let summary = await page.evaluate(proxySummaryScript());
    check(summary.currentDate === TODAY_KEY, `selected day must be device-local today (${summary.currentDate} vs ${TODAY_KEY})`);
    check(summary.dayRows >= 2, `migrated day must list seeded rows (got ${summary.dayRows})`);
    check(summary.domCards === summary.dayRows, `DOM cards (${summary.domCards}) must equal canonical rows (${summary.dayRows})`);
    check(Number.isFinite(summary.safeToSpend), 'hero must receive finite open-cycle availability');
    check(summary.heroUnknown === false, 'hero must render the canonical availability amount when it is known');
    check(summary.luxuryTags === 0, `luxury source rows must render no luxury tag (found ${summary.luxuryTags})`);
    check(summary.authority?.kind === 'canonicalReady', `authority must be canonicalReady (got ${summary.authority?.kind})`);
    check(summary.templates.includes('d4-rent'), 'migrated template must list as a recurring plan');
    const v1AfterBoot = await page.evaluate(new Function(`return (async () => { ${FINGERPRINT_JS} })()`));
    check(v1AfterBoot === v1Before, 'v1 migration input must stay byte-identical after boot');

    // ---- Phase 2: UI add commits exactly once; rapid retry commits once.
    await page.locator('.fab:visible').click();
    await page.locator('.modal-floating-card:visible').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('.modal-floating-card:visible').locator('input[placeholder="تكسي، غداء..."]:visible').fill('d4-milk');
    await page.locator('.modal-floating-card:visible').locator('input[inputmode="decimal"]:visible').first().fill('9.5');
    await page.locator('.modal-floating-card:visible').locator('.ms-btn.btn-premium-add').click();
    await page.waitForTimeout(2000);
    summary = await page.evaluate(proxySummaryScript());
    check(summary.domCards >= 3, `DOM must gain the committed card (got ${summary.domCards})`);
    const doubled = await page.evaluate(async () => {
      const proxy = window.RushdDebug.getAppProxy();
      const before = proxy.store.currentViewExpenses.length;
      proxy.addModal.form = {
        name: 'd4-double', cost: '5', category: 'food', recurrence: 'daily',
        applicability: 'everyday', monthDay: '', classification: 'essential',
        source: 'manual', flexibleDefinitionId: '', monthlyBudget: '', maxUsesPerMonth: '',
      };
      proxy.addModal.mode = 'expense';
      proxy.addModal.open = true;
      await Promise.all([proxy.submitNewExpense(), proxy.submitNewExpense()]);
      await proxy.$nextTick();
      return { before, after: proxy.store.currentViewExpenses.length, modalOpen: proxy.addModal.open };
    });
    check(doubled.after === doubled.before + 1, `rapid double-submit must commit exactly once (${doubled.before} -> ${doubled.after})`);

    // ---- Phase 3: plan apply + goals + blocked controls through ports.
    const applied = await page.evaluate(async (today) => {
      const proxy = window.RushdDebug.getAppProxy();
      proxy.applyTemplatesModal.effectiveDate = today;
      await proxy.confirmTemplateApplication();
      await proxy.$nextTick();
      return { modalOpen: proxy.applyTemplatesModal.open, toast: proxy.toastMessage };
    }, TODAY_KEY);
    check(applied.modalOpen === false, `plan apply must close only after the durable commit (toast: ${applied.toast})`);
    const goalCountBefore = summary.goals.length;
    const withGoal = await page.evaluate(async () => {
      const proxy = window.RushdDebug.getAppProxy();
      proxy.vaultGoalForm = { name: 'd4-bike', targetAmount: '400', allocatedAmount: '' };
      await proxy.addVaultGoal();
      await proxy.$nextTick();
      return (proxy.store.settings.vault.goals || []).length;
    });
    check(withGoal === goalCountBefore + 1, 'goal creation must commit exactly one goal');
    const deleteBlocked = await page.evaluate(async () => {
      const proxy = window.RushdDebug.getAppProxy();
      const goals = proxy.store.settings.vault.goals || [];
      proxy.confirmDeleteVaultGoal({ ...goals[0] });
      await proxy.$nextTick();
      return { count: (proxy.store.settings.vault.goals || []).length, toast: proxy.toastMessage };
    });
    check(deleteBlocked.count === withGoal, 'goal deletion must stay blocked with state unchanged');
    const allowanceBlocked = await page.evaluate(async () => {
      const proxy = window.RushdDebug.getAppProxy();
      const before = proxy.store.settings.baseAllowance;
      proxy.store.settings.baseAllowance = 9999;
      await proxy.saveSettings();
      await proxy.$nextTick();
      return { before, after: proxy.store.settings.baseAllowance };
    });
    check(allowanceBlocked.after === allowanceBlocked.before, 'allowance rewrite must stay blocked with the figure unchanged');
    await page.evaluate(async () => {
      const proxy = window.RushdDebug.getAppProxy();
      await proxy.setTheme('light');
      await proxy.$nextTick();
    });
    check(await page.evaluate(() => document.documentElement.dataset.theme) === 'light', 'theme preference change must apply through the port');

    // ---- Phase 4: second tab shares the namespace; commits propagate.
    const tabB = await context.newPage();
    await tabB.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitBridge(tabB);
    const summaryB = await tabB.evaluate(proxySummaryScript());
    check(summaryB.dayRows >= 2, 'second tab must attach to the same active namespace');
    await page.evaluate(async () => {
      const proxy = window.RushdDebug.getAppProxy();
      proxy.addModal.form = {
        name: 'd4-shared', cost: '4', category: 'food', recurrence: 'daily',
        applicability: 'everyday', monthDay: '', classification: 'essential',
        source: 'manual', flexibleDefinitionId: '', monthlyBudget: '', maxUsesPerMonth: '',
      };
      proxy.addModal.mode = 'expense';
      proxy.addModal.open = true;
      await proxy.submitNewExpense();
      await proxy.$nextTick();
    });
    await tabB.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitBridge(tabB);
    const dayB = await tabB.evaluate(() => {
      const proxy = window.RushdDebug.getAppProxy();
      return proxy.store.currentViewExpenses.map((row) => row.name);
    });
    check(dayB.includes('d4-shared'), 'second tab must serve the new commit after reload');

    // ---- Phase 5: real reload reopens the same namespace.
    const deviceBefore = await page.evaluate(() => localStorage.getItem('rushd_device_id'));
    check(typeof deviceBefore === 'string' && deviceBefore.length > 0, 'device id must persist for namespace stability');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitBridge(page);
    summary = await page.evaluate(proxySummaryScript());
    check(summary.dayRows >= 3, 'reloaded template must render committed rows');
    check(await page.evaluate(() => localStorage.getItem('rushd_device_id')) === deviceBefore, 'reload must keep the same device id');

    // ---- Phase 6: month-end settlement closes idempotently through ports.
    const settled = await page.evaluate(async (monthKey) => {
      const proxy = window.RushdDebug.getAppProxy();
      proxy.monthEndModal.summary = { previousMonthKey: monthKey, surplus: 100 };
      proxy.monthEndModal.open = true;
      await proxy.moveMonthEndSurplusToVault();
      await proxy.$nextTick();
      return { modalOpen: proxy.monthEndModal.open, toast: proxy.toastMessage };
    }, MONTH_KEY);
    check(settled.modalOpen === false, `settle must close only after the durable commit (toast: ${settled.toast})`);
    const settledAgain = await page.evaluate(async (monthKey) => {
      const proxy = window.RushdDebug.getAppProxy();
      proxy.monthEndModal.summary = { previousMonthKey: monthKey, surplus: 100 };
      proxy.monthEndModal.open = true;
      await proxy.moveMonthEndSurplusToVault();
      await proxy.$nextTick();
      return { modalOpen: proxy.monthEndModal.open };
    }, MONTH_KEY);
    check(settledAgain.modalOpen === false, 'settling an already-settled month must replay safely');

    // ---- Phase 7: epoch broadcast hard-blocks the old tab.
    await tabB.evaluate(() => {
      const current = Number(localStorage.getItem('rushd_p04d_epoch') ?? 0);
      const bus = new BroadcastChannel('rushd-p04d-coordination');
      bus.postMessage({ type: 'rushd-p04d-epoch', epoch: current + 100, reason: 'd4-gate-update', tabId: 'd4-gate-b' });
      bus.close();
    });
    await page.waitForTimeout(1000);
    const stale = await page.evaluate(async () => {
      const proxy = window.RushdDebug.getAppProxy();
      proxy.addModal.form = {
        name: 'd4-stale', cost: '1', category: 'food', recurrence: 'daily',
        applicability: 'everyday', monthDay: '', classification: 'essential',
        source: 'manual', flexibleDefinitionId: '', monthlyBudget: '', maxUsesPerMonth: '',
      };
      proxy.addModal.mode = 'expense';
      proxy.addModal.open = true;
      await proxy.submitNewExpense();
      await proxy.$nextTick();
      const ports = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$p04dPorts ?? null;
      return { modalOpen: proxy.addModal.open, authority: ports ? ports.authority.getState() : null };
    });
    check(stale.modalOpen === true, 'old tab must not show success after the epoch');
    check(stale.authority?.kind === 'unavailable', `old tab authority must read unavailable (got ${stale.authority?.kind})`);
    const v1Write = await page.evaluate(async () => {
      try {
        await window.RushdDebug.getAppProxy().store.addExpense({ name: 'sneaky', expectedCost: 1 });
        return { threw: false };
      } catch {
        return { threw: true };
      }
    });
    check(v1Write.threw === true, 'direct v1 writes must throw after the cutover');
    await tabB.close();

    // ---- Phase 8: reload rejoins writability after the epoch, then the
    // controller performs export-first reset, reload, safety re-import.
    // (Reset requires a writable tab, so the reload comes first.)
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitBridge(page);
    await page.evaluate(async () => {
      const proxy = window.RushdDebug.getAppProxy();
      await proxy.navigateTo('settings');
      await proxy.$nextTick();
    });
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.getByText('إعادة ضبط المصنع', { exact: false }).first().click();
    await page.locator('.confirm-dialog-card:visible').waitFor({ state: 'visible', timeout: 10000 });
    const [download] = await Promise.all([
      downloadPromise,
      page.locator('.confirm-dialog-card:visible').getByText('حذف', { exact: true }).click(),
    ]);
    const safetyPath = join(RAW_DIR, 'safety-backup.json');
    await download.saveAs(safetyPath);
    await waitBridge(page);
    summary = await page.evaluate(proxySummaryScript());
    check(summary.dayRows === 0 && summary.domCards === 0, `reset must empty the canonical scope (got ${summary.dayRows} rows)`);
    check(await page.evaluate(() => localStorage.getItem('rushd_device_id')) === deviceBefore, 'reset must preserve the device id or the backup cannot restore');
    const v1AfterReset = await page.evaluate(new Function(`return (async () => { ${FINGERPRINT_JS} })()`));
    check(v1AfterReset === v1Before, 'v1 must stay byte-identical across reset');
    await page.evaluate(async () => {
      const proxy = window.RushdDebug.getAppProxy();
      await proxy.navigateTo('settings');
      await proxy.$nextTick();
    });
    await page.locator('input[type="file"]').first().setInputFiles(safetyPath);
    await page.locator('.confirm-dialog-card:visible').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('.confirm-dialog-card:visible').getByText('حذف', { exact: true }).click();
    await page.getByText('تم الاستيراد بنجاح!', { exact: false }).waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
    summary = await page.evaluate(proxySummaryScript());
    check(summary.dayRows >= 2, `safety re-import must restore rows (got ${summary.dayRows})`);

    // ---- Phase 9: invalid import fails closed with no state change.
    const garbagePath = join(RAW_DIR, 'garbage-backup.json');
    writeFileSync(garbagePath, '{"nope":true}');
    const rowsBefore = summary.dayRows;
    await page.locator('input[type="file"]').first().setInputFiles(garbagePath);
    await page.locator('.confirm-dialog-card:visible').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('.confirm-dialog-card:visible').getByText('حذف', { exact: true }).click();
    await page.waitForTimeout(2000);
    check(dialogs.some((entry) => entry.includes('alert')), 'corrupt import must raise the invalid-backup alert');
    summary = await page.evaluate(proxySummaryScript());
    check(summary.dayRows === rowsBefore, 'corrupt import must change no state');

    // ---- Phase 10: offline reload serves shell + data with zero remote.
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
    await waitBridge(page).catch(() => undefined);
    const offline = await page.evaluate(() => {
      const proxy = window.RushdDebug?.getAppProxy?.();
      if (!proxy) return { mounted: false };
      return { mounted: true, rows: proxy.store.currentViewExpenses.length };
    });
    check(offline.mounted === true, 'offline reload must mount the established shell from cache');
    check(offline.rows >= 2, `offline reload must serve committed rows from local storage (got ${offline.rows})`);
    await context.setOffline(false);

    // ---- Phase 11: retirement coexistence + final integrity.
    const workers = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((reg) => reg.scope));
    check(workers.some((scope) => String(scope).endsWith('/')), 'production PWA worker must be registered');
    const cachesLeft = await page.evaluate(async () => caches.keys());
    check(cachesLeft.every((name) => !name.startsWith('rushd-shell-')), `rejected-shell caches must stay retired (got ${cachesLeft.join(',')})`);
    const v1Final = await page.evaluate(new Function(`return (async () => { ${FINGERPRINT_JS} })()`));
    check(v1Final === v1Before, 'v1 must stay byte-identical across the whole run');
    const remote = requests.filter((url) => {
      try {
        return new URL(url).origin !== serverOrigin;
      } catch {
        return true;
      }
    });
    check(remote.length === 0, `remote requests observed: ${remote.slice(0, 5).join(', ')}`);
    const fatalDiagnostics = consoleErrors;
    check(fatalDiagnostics.length === 0, `console/page errors: ${fatalDiagnostics.slice(0, 5).join(' | ')}`);
    check(failedRequests.length === 0, `failed local requests: ${failedRequests.slice(0, 5).join(' | ')}`);

    if (failures.length > 0) {
      console.error(`p04-d4 browser failures:\n- ${failures.join('\n- ')}`);
      process.exitCode = 1;
    } else {
      console.log('p04-d4 browser passed: real dist entry, migrate-once, controller add/plan/goals/settle, controller reset/reload/safety-reimport, offline reload, retirement coexistence, epoch block, zero v1 writes, zero remote requests');
    }
  } finally {
    await browser.close().catch(() => undefined);
    if (server.listening) server.close();
  }
}

main().catch((error) => {
  if (failures.length > 0) {
    console.error(`p04-d4 browser failures before crash:\n- ${failures.join('\n- ')}`);
  }
  console.error(error);
  process.exitCode = 1;
});
