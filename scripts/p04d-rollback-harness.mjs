/**
 * Same-origin P04-D rollback harness.
 *
 * 1. Serves the rejected 0bd25f1 P04-D build, installs its worker/cache, and
 *    seeds synthetic localStorage / v1 IndexedDB / v2 OPFS sentinels.
 * 2. Switches that origin to this rollback build and proves the legacy UI
 *    returns, the rejected controller/cache retire, and user data is intact.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROLLBACK_DIST = join(ROOT, 'dist');
const REJECTED_COMMIT = '0bd25f1646622391dbf654570a27c3b4dbc831a2';
const REJECTED_DIST = process.env.RUSHD_P04D_REJECTED_DIST
  ? resolve(process.env.RUSHD_P04D_REJECTED_DIST)
  : join(ROOT, 'artifacts/p04d-rejected-0bd25f1/dist');
const FORENSIC_DIST = '/Users/mehmet/Desktop/Rushd/dist';
const FORENSIC_NODE_MODULES = '/Users/mehmet/Desktop/Rushd/node_modules';
const PORT = Number(process.env.RUSHD_ROLLBACK_PORT || 4176);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
};

const SENTINELS = Object.freeze({
  localStorageKey: 'rushd_rollback_sentinel',
  localStorageValue: 'p04d-rollback-ls-7f3c2e91',
  theme: 'light',
  sessionKey: 'rushd_rollback_session_sentinel',
  sessionValue: 'p04d-rollback-ss-keep',
  cookie: 'rushd_rollback_cookie=keep; Path=/',
  cookieName: 'rushd_rollback_cookie',
  v1ExpenseId: 'p04d-rollback-v1-expense',
  v1ExpenseName: 'P04D rollback v1 sentinel',
  v1SettingKey: 'rollbackSentinel',
  v1SettingValue: 'p04d-rollback-v1-keep',
  controlKey: 'rollback-sentinel',
  controlValue: 'p04d-rollback-control-keep',
  unrelatedDb: 'UnrelatedApp_DB',
  unrelatedValue: 'p04d-rollback-unrelated-idb',
  opfsFile: 'rushd-rollback-v2-sentinel.txt',
  opfsValue: 'p04d-rollback-opfs-keep',
  unrelatedCache: 'unrelated-keep-v1',
  extraShellCache: 'rushd-shell-extra-stale',
  expenseName: 'قهوة استرجاع',
});

function fail(label) {
  throw new Error(label);
}

function createSwitchableServer() {
  let root = ROLLBACK_DIST;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', ORIGIN);
      let pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      let filePath = join(root, pathname.replace(/^\/+/, ''));
      if (!existsSync(filePath) && !extname(pathname)) {
        filePath = join(root, 'index.html');
        pathname = '/index.html';
      }
      const body = await readFile(filePath);
      const headers = {
        'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      };
      if (pathname === '/sw.js' || pathname === '/retire-rejected-shell.js') {
        headers['Cache-Control'] = 'no-store';
        headers['Service-Worker-Allowed'] = '/';
      }
      response.writeHead(200, headers);
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  return {
    server,
    setRoot(next) {
      root = next;
    },
    listen: () => new Promise((resolveListen) => server.listen(PORT, '127.0.0.1', resolveListen)),
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

function prepareRejectedDist() {
  if (existsSync(join(REJECTED_DIST, 'sw.js'))) {
    assertRejectedDist(REJECTED_DIST);
    return REJECTED_DIST;
  }
  if (existsSync(join(FORENSIC_DIST, 'sw.js'))) {
    const sw = readFileSync(join(FORENSIC_DIST, 'sw.js'), 'utf8');
    if (sw.includes('rushd-shell-') && sw.includes("addEventListener('fetch'") && sw.includes('0bd25f1')) {
      mkdirSync(dirname(REJECTED_DIST), { recursive: true });
      execFileSync('cp', ['-R', FORENSIC_DIST, REJECTED_DIST]);
      assertRejectedDist(REJECTED_DIST);
      return REJECTED_DIST;
    }
  }

  const extract = join(ROOT, 'artifacts/p04d-rejected-0bd25f1/src');
  rmSync(extract, { recursive: true, force: true });
  mkdirSync(extract, { recursive: true });
  const tarDir = mkdtempSync(join(tmpdir(), 'rushd-p04d-archive-'));
  writeFileSync(join(tarDir, 'archive.tar'), execFileSync('git', ['archive', REJECTED_COMMIT], { cwd: ROOT }));
  execFileSync('tar', ['-xf', join(tarDir, 'archive.tar'), '-C', extract]);
  rmSync(tarDir, { recursive: true, force: true });
  if (existsSync(FORENSIC_NODE_MODULES)) {
    execFileSync('ln', ['-s', FORENSIC_NODE_MODULES, join(extract, 'node_modules')]);
  } else {
    execFileSync('npm', ['ci'], { cwd: extract, stdio: 'inherit' });
  }
  execFileSync('npm', ['run', 'build'], { cwd: extract, stdio: 'inherit' });
  mkdirSync(dirname(REJECTED_DIST), { recursive: true });
  execFileSync('cp', ['-R', join(extract, 'dist'), REJECTED_DIST]);
  assertRejectedDist(REJECTED_DIST);
  return REJECTED_DIST;
}

function assertRejectedDist(distDir) {
  const sw = readFileSync(join(distDir, 'sw.js'), 'utf8');
  assert.match(sw, /rushd-shell-/);
  assert.match(sw, /addEventListener\('fetch'/);
  assert.match(sw, /0bd25f1/);
}

async function collectStorage(page) {
  return page.evaluate(async (sentinels) => {
    const localStorageDump = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) localStorageDump[key] = localStorage.getItem(key);
    }
    let sessionDump = {};
    try {
      sessionDump = { [sentinels.sessionKey]: sessionStorage.getItem(sentinels.sessionKey) };
    } catch {
      sessionDump = { blocked: true };
    }

    const readDb = async (name, store, keyPath) => {
      const databases = await indexedDB.databases();
      if (!databases.some((entry) => entry.name === name)) return { missing: true, rows: [] };
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!db.objectStoreNames.contains(store)) {
        db.close();
        return { missingStore: true, rows: [] };
      }
      const rows = await new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const request = tx.objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return { name, version: db.version, keyPath, rows };
    };

    const listOpfs = async (directory, prefix = '') => {
      const files = [];
      if (!navigator.storage?.getDirectory) return files;
      const root = directory || await navigator.storage.getDirectory();
      for await (const [name, handle] of root.entries()) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === 'directory') {
          files.push(...await listOpfs(handle, path));
        } else {
          const file = await handle.getFile();
          const buffer = await file.arrayBuffer();
          let hash = 0;
          const bytes = new Uint8Array(buffer);
          for (let index = 0; index < bytes.length; index += 1) hash = (hash * 33 + bytes[index]) >>> 0;
          files.push({ path, size: file.size, hash: hash.toString(16), text: file.size <= 256 ? await file.text() : null });
        }
      }
      return files.sort((left, right) => left.path.localeCompare(right.path));
    };

    const cachesDump = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      cachesDump.push({ name, urls: keys.map((request) => request.url).sort() });
    }

    const registrations = await navigator.serviceWorker.getRegistrations();
    return {
      href: location.href,
      title: document.title,
      hasP04dShell: Boolean(document.querySelector('.p04d-shell')),
      hasLegacyFab: Boolean(document.querySelector('.fab')),
      hasRushdP04D: typeof globalThis.RushdP04D !== 'undefined',
      hasRushdDebug: typeof globalThis.RushdDebug?.getAppProxy === 'function',
      controller: navigator.serviceWorker.controller?.scriptURL || null,
      registrationScripts: registrations.map((registration) => (
        registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || null
      )),
      cookie: document.cookie,
      localStorageDump,
      sessionDump,
      v1: await readDb('MicroSaveOS_DB', 'expenses', 'id'),
      v1Settings: await readDb('MicroSaveOS_DB', 'settings', 'key'),
      control: await readDb('Rushd_P04C_Control', 'meta', 'key'),
      unrelated: await readDb(sentinels.unrelatedDb, 'items', 'id'),
      opfs: await listOpfs(),
      caches: cachesDump.sort((left, right) => left.name.localeCompare(right.name)),
      bodyText: document.body?.innerText || '',
    };
  }, SENTINELS);
}

async function seedSentinels(page) {
  return page.evaluate(async (sentinels) => {
    localStorage.setItem(sentinels.localStorageKey, sentinels.localStorageValue);
    localStorage.setItem('rushd_theme', sentinels.theme);
    try {
      sessionStorage.setItem(sentinels.sessionKey, sentinels.sessionValue);
    } catch {
      /* ignore */
    }
    document.cookie = sentinels.cookie;

    await new Promise((resolve, reject) => {
      const request = indexedDB.open('MicroSaveOS_DB', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('expenses')) {
          const expenses = db.createObjectStore('expenses', { keyPath: 'id' });
          expenses.createIndex('date', 'date', { unique: false });
          expenses.createIndex('isPaid', 'isPaid', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['settings', 'expenses'], 'readwrite');
        tx.objectStore('settings').put({ key: sentinels.v1SettingKey, value: sentinels.v1SettingValue });
        tx.objectStore('settings').put({
          key: 'onboardingState',
          value: { status: 'completed', updatedAt: '2026-09-11T00:00:00.000Z', source: 'p04d-rollback-harness' },
        });
        tx.objectStore('expenses').put({
          id: sentinels.v1ExpenseId,
          name: sentinels.v1ExpenseName,
          expectedCost: 13,
          actualPaid: 0,
          isPaid: false,
          category: 'food',
          classification: 'essential',
          source: 'manual',
          date: '2026-09-11',
          createdAt: '2026-09-11T00:00:00.000Z',
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });

    await new Promise((resolve, reject) => {
      const request = indexedDB.open('Rushd_P04C_Control', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['meta'], 'readwrite');
        tx.objectStore('meta').put({ key: sentinels.controlKey, value: sentinels.controlValue });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });

    await new Promise((resolve, reject) => {
      const request = indexedDB.open(sentinels.unrelatedDb, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('items', { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['items'], 'readwrite');
        tx.objectStore('items').put({ id: 'keep', value: sentinels.unrelatedValue });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });

    if (navigator.storage?.getDirectory) {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(sentinels.opfsFile, { create: true });
      const writable = await handle.createWritable();
      await writable.write(sentinels.opfsValue);
      await writable.close();
    }

    const unrelated = await caches.open(sentinels.unrelatedCache);
    await unrelated.put(new Request('/unrelated-keep.txt'), new Response('keep-unrelated-cache', { headers: { 'Content-Type': 'text/plain' } }));
    const extraShell = await caches.open(sentinels.extraShellCache);
    await extraShell.put(new Request('/stale-shell.txt'), new Response('stale', { headers: { 'Content-Type': 'text/plain' } }));
    return true;
  }, SENTINELS);
}

function findRow(rows, key, value) {
  return (rows || []).find((row) => row[key] === value);
}

function assertSentinelsIntact(before, after) {
  assert.equal(after.localStorageDump[SENTINELS.localStorageKey], SENTINELS.localStorageValue, 'localStorage sentinel was rewritten or deleted');
  assert.equal(after.localStorageDump.rushd_theme, SENTINELS.theme, 'theme localStorage sentinel was rewritten or deleted');
  assert.equal(after.sessionDump[SENTINELS.sessionKey], SENTINELS.sessionValue, 'sessionStorage sentinel was rewritten or deleted');
  assert.match(after.cookie, new RegExp(`${SENTINELS.cookieName}=keep`));
  assert.deepEqual(
    findRow(after.v1.rows, 'id', SENTINELS.v1ExpenseId),
    findRow(before.v1.rows, 'id', SENTINELS.v1ExpenseId),
    'v1 IndexedDB expense sentinel changed',
  );
  assert.deepEqual(
    findRow(after.v1Settings.rows, 'key', SENTINELS.v1SettingKey),
    findRow(before.v1Settings.rows, 'key', SENTINELS.v1SettingKey),
    'v1 settings sentinel changed',
  );
  assert.deepEqual(
    findRow(after.control.rows, 'key', SENTINELS.controlKey),
    findRow(before.control.rows, 'key', SENTINELS.controlKey),
    'P04-C control store sentinel changed',
  );
  assert.deepEqual(after.unrelated, before.unrelated, 'unrelated IndexedDB changed');
  const opfsFile = (snapshot) => snapshot.opfs.find((file) => file.path === SENTINELS.opfsFile);
  assert.deepEqual(opfsFile(after), opfsFile(before), 'OPFS sentinel changed');
  for (const file of before.opfs) {
    const next = after.opfs.find((entry) => entry.path === file.path);
    assert.ok(next, `v2/OPFS file missing: ${file.path}`);
    assert.equal(next.hash, file.hash, `v2/OPFS file rewritten: ${file.path}`);
    assert.equal(next.size, file.size, `v2/OPFS file resized: ${file.path}`);
  }
}

function cacheNames(snapshot) {
  return snapshot.caches.map((entry) => entry.name);
}

async function waitForGuest(page) {
  await page.waitForFunction(() => {
    const api = globalThis.RushdP04D;
    return Boolean(api && document.querySelector('.p04d-shell'));
  }, null, { timeout: 60_000 });
}

async function waitForLegacy(page) {
  await page.waitForFunction(() => {
    return typeof globalThis.RushdDebug?.getAppProxy === 'function'
      && Boolean(document.querySelector('.fab'))
      && !document.querySelector('.p04d-shell')
      && typeof globalThis.RushdP04D === 'undefined';
  }, null, { timeout: 60_000 });
}

async function waitForRetirement(page, navigations) {
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    if (navigations.count > 8) fail(`retirement loop: ${navigations.count} navigations`);
    const snapshot = await collectStorage(page).catch(() => null);
    if (snapshot) {
      const shells = cacheNames(snapshot).filter((name) => name.startsWith('rushd-shell-'));
      const controllerGone = snapshot.controller === null;
      const legacy = snapshot.hasRushdDebug && snapshot.hasLegacyFab && !snapshot.hasP04dShell;
      if (shells.length === 0 && controllerGone && legacy) return snapshot;
    }
    await page.waitForTimeout(250);
  }
  fail('retirement did not finish: P04-D controller or rushd-shell cache still present');
}

async function addLegacyExpense(page, name) {
  const skipOnboarding = page.getByText('تخطي الآن', { exact: true });
  if (await skipOnboarding.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await skipOnboarding.click();
    await page.waitForTimeout(400);
  }
  const decideLater = page.getByText('لاحقاً', { exact: true });
  if (await decideLater.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await decideLater.click();
    await page.waitForTimeout(400);
  }
  const addButton = page.locator('.fab:visible');
  await addButton.waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(await addButton.count(), 1, 'expected one visible add-expense button');
  await addButton.click();
  const modal = page.locator('.modal-floating-card:visible');
  await modal.waitFor({ state: 'visible', timeout: 10_000 });
  await modal.locator('input[placeholder="تكسي، غداء..."]:visible').fill(name);
  await modal.locator('input[inputmode="decimal"]:visible').first().fill('٤٢');
  await modal.getByText('إضافة إلى اليوم', { exact: false }).click();
  await page.waitForTimeout(800);
  assert.ok((await page.locator('body').innerText()).includes(name), 'expense should appear after adding it');
}

async function assertLegacyDestinations(page) {
  const clicks = [
    { label: 'الإحصاءات', marker: /الإحصاءات|صافي|الإنفاق|هذا الشهر/ },
    { label: 'الخزنة', marker: /الخزنة|هدف|توفير/ },
    { label: 'الخطط', marker: /الخطط|قالب|خطة/ },
    { label: 'الإعدادات', marker: /الإعدادات|تصدير|استيراد|نمط الواجهة/ },
    { label: 'الرئيسية', marker: /الميزانية المتاحة|رُشد/ },
  ];
  for (const step of clicks) {
    const button = page.locator('.app-shell-nav-btn', { hasText: step.label }).first();
    await button.click();
    await page.waitForTimeout(400);
    const text = await page.locator('body').innerText();
    assert.ok(step.marker.test(text), `legacy destination ${step.label} was empty or looked like a P04-D placeholder`);
    assert.equal(await page.locator('.p04d-shell').count(), 0, `P04-D placeholder shell visible on ${step.label}`);
  }
}

async function runControlledRollback(browser, http, rejectedDist) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const remote = new Set();
  const navigations = { count: 0 };
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.count += 1;
  });
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    let local = false;
    try {
      local = new URL(url).origin === ORIGIN;
    } catch {
      local = false;
    }
    if (!local) {
      remote.add(url);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  http.setRoot(rejectedDist);
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForGuest(page);
  await page.waitForFunction(async () => {
    const names = await caches.keys();
    return names.some((name) => name.startsWith('rushd-shell-')) && navigator.serviceWorker.controller !== null;
  }, null, { timeout: 30_000 });

  await seedSentinels(page);
  const before = await collectStorage(page);
  assert.ok(before.hasP04dShell, 'rejected P04-D shell did not mount');
  assert.ok(cacheNames(before).some((name) => name.startsWith('rushd-shell-')), 'rejected shell cache missing');
  assert.ok(cacheNames(before).includes(SENTINELS.unrelatedCache), 'unrelated cache missing after seed');
  assert.ok(cacheNames(before).includes(SENTINELS.extraShellCache), 'extra rushd-shell cache missing after seed');
  assert.equal(before.localStorageDump[SENTINELS.localStorageKey], SENTINELS.localStorageValue);
  assert.ok(before.v1.rows.some((row) => row.id === SENTINELS.v1ExpenseId));
  assert.ok(before.opfs.some((file) => file.path === SENTINELS.opfsFile && file.text === SENTINELS.opfsValue), 'v2/OPFS sentinel was not written');
  const durableFiles = before.opfs.filter((file) => file.path !== SENTINELS.opfsFile);
  const sessionStatus = await page.evaluate(() => globalThis.RushdP04D?.runtime?.state?.sessionStatus ?? null);
  if (sessionStatus === 'ready') {
    assert.ok(durableFiles.length > 0, 'P04-D ready session created no durable OPFS files');
  }

  const preNavigations = navigations.count;
  http.setRoot(ROLLBACK_DIST);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  const after = await waitForRetirement(page, navigations);
  assert.ok(navigations.count - preNavigations <= 6, `retirement reloaded too many times: ${navigations.count - preNavigations}`);
  assert.equal(after.hasP04dShell, false, 'visible application is still createGuestApplication');
  assert.equal(after.hasRushdP04D, false, 'RushdP04D guest API leaked into the rollback app');
  assert.ok(after.hasRushdDebug && after.hasLegacyFab, 'established legacy UI did not mount');
  assert.equal(after.controller, null, 'old P04-D controller is still present');
  assert.deepEqual(cacheNames(after).filter((name) => name.startsWith('rushd-shell-')), [], 'rushd-shell-* cache remained');
  assert.ok(cacheNames(after).includes(SENTINELS.unrelatedCache), 'unrelated cache was deleted');
  assertSentinelsIntact(before, after);
  assert.deepEqual([...remote], [], `remote/account request occurred: ${[...remote].join(', ')}`);

  await addLegacyExpense(page, SENTINELS.expenseName);
  assert.ok((await page.locator('body').innerText()).includes(SENTINELS.v1ExpenseName), 'seeded v1 expense disappeared from the legacy UI');
  await assertLegacyDestinations(page);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForLegacy(page);
  assert.ok((await page.locator('body').innerText()).includes(SENTINELS.expenseName), 'added expense did not persist after reload');
  const persisted = await collectStorage(page);
  assert.equal(persisted.controller, null, 'controller returned after reload');
  assert.deepEqual(cacheNames(persisted).filter((name) => name.startsWith('rushd-shell-')), []);
  assert.ok(cacheNames(persisted).includes(SENTINELS.unrelatedCache));
  assertSentinelsIntact(before, persisted);
  assert.ok(persisted.v1.rows.some((row) => row.name === SENTINELS.expenseName), 'new expense did not persist in v1 IndexedDB');

  await context.close();
  return { remote: [...remote], navigations: navigations.count };
}

async function runCleanInert(browser, http) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  http.setRoot(ROLLBACK_DIST);
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForLegacy(page);
  await page.waitForTimeout(1500);
  const snapshot = await collectStorage(page);
  assert.equal(snapshot.controller, null, 'clean browser acquired a service-worker controller');
  assert.deepEqual(snapshot.registrationScripts.filter(Boolean), [], 'clean browser created a service-worker registration');
  assert.deepEqual(cacheNames(snapshot), [], 'clean browser created caches');
  assert.ok(snapshot.hasLegacyFab && snapshot.hasRushdDebug);
  await context.close();
}

async function main() {
  if (!existsSync(join(ROLLBACK_DIST, 'index.html'))) {
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  }
  const rejectedDist = prepareRejectedDist();
  const rollbackSw = await readFile(join(ROLLBACK_DIST, 'sw.js'), 'utf8');
  assert.doesNotMatch(rollbackSw, /addEventListener\(\s*['"]fetch['"]/);
  assert.match(rollbackSw, /registration\.unregister/);

  const http = createSwitchableServer();
  await http.listen();
  const browser = await chromium.launch({ headless: true });
  try {
    await runControlledRollback(browser, http, rejectedDist);
    await runCleanInert(browser, http);
  } finally {
    await browser.close();
    await http.close();
  }
  console.log('Rushd P04-D rollback harness passed.');
}

const repeat = Math.max(1, Number(process.env.RUSHD_ROLLBACK_REPEAT || 1));
for (let index = 0; index < repeat; index += 1) {
  await main();
}
