// P04-D5 stale-service-worker update correction: real upgrade lifecycle gate.
// Run: npm run test:p04d5-upgrade  (builds the current dist first)
/* global URL:readonly, console:readonly, process:readonly */
//
// Reproduces the founder incident end to end and locks the correction:
//
//   1. An ACTUAL old client is installed from the real `be94f12` build
//      (export-first Factory Reset handler, `rushd-pwa-v2` cache-first
//      worker): the old tree is exported with `git archive`, built with the
//      repo's own toolchain, and served as "the deployment" while a
//      controlled client boots, migrates fake v1 seed data, and warms its
//      offline cache — exactly the state of the founder's iPhone PWA and
//      Edge profile.
//   2. The served deployment is then REPLACED with the current corrected
//      build (same origin, same URLs — the Vercel deploy shape).
//   3. A bounded reopen/reload sequence follows. Before the correction the
//      old worker is byte-identical and cache-first, so the client stays
//      pinned to the old shell: the gate observes the exact symptom through
//      the real UI path — confirmed Factory Reset triggers a download/export
//      under the stale client — and fails RED. After the correction the old
//      client discovers, installs, and safely activates the changed worker
//      (no activation across a critical section; the epoch protocol retires
//      the old binary), and the next reload loads the corrected shell with
//      zero finance-data loss.
//   4. GREEN proof on the updated client: confirmed Factory Reset triggers
//      ZERO downloads/exports while clearing the fake data, manual Export
//      Backup still downloads independently, and an offline reload still
//      mounts the shell from cache (true offline fallback retained).
//
// All data is clearly fake; no account/cloud client exists. Nothing here
// commits, deploys, or touches storage outside the throwaway browser
// profile and the temp build directory.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const NEW_DIST = join(ROOT, 'dist');
const RAW_DIR = join(ROOT, 'artifacts/agent-reports/p04d5-sw-upgrade-raw');
// The pre-correction deployment: the export-first Factory Reset build whose
// worker/cache shipped byte-identical across the 9a3267b correction.
const OLD_COMMIT = 'be94f12dc8ae32384c647dfb64aa0f3f5a773d98';
const OLD_CACHE = 'rushd-pwa-v2';
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

/**
 * Materialize the real `be94f12` deployment. The tree is exported with
 * `git archive` (committed state only — never the dirty worktree), built
 * with the repo's own node_modules (the dependency manifest is identical
 * at that commit), and cached under the OS temp dir so re-runs stay fast.
 * @returns {Promise<string>} path to the old deployment's dist directory
 */
async function ensureOldDist() {
  if (process.env.RUSHD_OLD_DIST) return process.env.RUSHD_OLD_DIST;
  const base = join(tmpdir(), 'rushd-p04d5-old-be94f12');
  const distDir = join(base, 'dist');
  if (existsSync(join(distDir, 'index.html')) && existsSync(join(distDir, 'rushd-pwa-sw.js'))) {
    return distDir;
  }
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  execSync(`git -C ${JSON.stringify(ROOT)} archive ${OLD_COMMIT} | tar -x -C ${JSON.stringify(base)}`, { stdio: 'pipe' });
  symlinkSync(join(ROOT, 'node_modules'), join(base, 'node_modules'), 'dir');
  execSync('npm run build', { cwd: base, stdio: 'pipe' });
  return distDir;
}

async function bundleNameOf(distDir) {
  const html = await readFile(join(distDir, 'index.html'), 'utf8');
  const match = html.match(/\/assets\/index-[^"']+\.js/);
  return match ? match[0] : null;
}

async function swCacheVersionOf(distDir) {
  const sw = await readFile(join(distDir, 'rushd-pwa-sw.js'), 'utf8');
  const match = sw.match(/PWA_CACHE_VERSION = '([^']+)'/);
  return match ? match[1] : null;
}

// The server swaps its document root atomically, mimicking a deploy that
// replaces the served bundle under the same origin and URLs.
function startServer() {
  let currentRoot = null;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      const body = await readFile(join(currentRoot, pathname.replace(/^\/+/, '')));
      // No HTTP caching: the deployment simulation must observe exactly
      // what each served byte state allows, never a browser HTTP-cache hit.
      res.writeHead(200, { 'Content-Type': MIME[extname(pathname)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return {
    server,
    serve(root) { currentRoot = root; },
  };
}

// Fake v1 seed written with raw IndexedDB (no app code): one allowance, a
// completed onboarding marker, and one paid expense dated device-local
// today. The first real boot migrates it into the canonical stack.
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
    transaction.objectStore('settings').put({
      key: 'onboardingState',
      value: { status: 'completed', updatedAt: '2026-08-10T09:00:00.000Z', source: 'p04-d5-sw-upgrade-gate' },
    });
    transaction.objectStore('expenses').put({
      id: 'swup-seeded', name: 'swup-seeded', expectedCost: 12, actualPaid: 12, isPaid: true,
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

function pageState(page) {
  return page.evaluate(async () => {
    const keys = await caches.keys();
    return {
      caches: keys,
      scripts: Array.from(document.scripts).map((script) => script.src),
      controlled: !!navigator.serviceWorker.controller,
      rows: (() => {
        try {
          return window.RushdDebug?.getAppProxy?.()?.store.currentViewExpenses.map((row) => row.name) ?? [];
        } catch {
          return [];
        }
      })(),
      deviceId: (() => {
        try { return localStorage.getItem('rushd_device_id'); } catch { return null; }
      })(),
    };
  });
}

async function gotoSettings(page) {
  await page.evaluate(async () => {
    const proxy = window.RushdDebug.getAppProxy();
    await proxy.navigateTo('settings');
    await proxy.$nextTick();
  });
}

// The real UI path for the destructive action: open Settings, tap Factory
// Reset, then confirm in the app dialog (Arabic is the default language).
async function confirmFactoryReset(page) {
  await gotoSettings(page);
  await page.getByText('إعادة ضبط المصنع', { exact: false }).first().click();
  await page.locator('.confirm-dialog-card:visible').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('.confirm-dialog-card:visible').getByText('حذف', { exact: true }).click();
}

async function main() {
  mkdirSync(RAW_DIR, { recursive: true });
  for (const required of ['index.html', 'sqlite-worker.js', 'rushd-pwa-sw.js', 'pkg/dist/wa-sqlite.mjs', 'pkg/dist/wa-sqlite.wasm']) {
    check(existsSync(join(NEW_DIST, required)), `current dist must contain ${required} (run npm run build)`);
  }
  if (failures.length > 0) {
    console.error(`p04-d5 sw-upgrade browser failures:\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }

  const oldDist = await ensureOldDist();
  const [oldBundle, newBundle, newCacheVersion, oldCacheVersion] = await Promise.all([
    bundleNameOf(oldDist),
    bundleNameOf(NEW_DIST),
    swCacheVersionOf(NEW_DIST),
    swCacheVersionOf(oldDist),
  ]);
  check(typeof oldBundle === 'string' && oldBundle.length > 0, 'old deployment exposes its app bundle name');
  check(typeof newBundle === 'string' && newBundle.length > 0, 'new deployment exposes its app bundle name');
  check(oldBundle !== newBundle, `old and new deployments must ship different app bundles (got ${oldBundle} vs ${newBundle})`);
  check(oldCacheVersion === OLD_CACHE, `be94f12 worker must carry the ${OLD_CACHE} generation (got ${oldCacheVersion})`);
  check(typeof newCacheVersion === 'string' && newCacheVersion.length > 0, 'current worker exposes a cache generation');
  if (failures.length > 0) {
    console.error(`p04-d5 sw-upgrade browser failures:\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`lifecycle setup: old=${oldBundle} (${oldCacheVersion}) -> new=${newBundle} (${newCacheVersion})`);

  const { server, serve } = startServer();
  serve(oldDist);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server address missing');
  const origin = `http://127.0.0.1:${address.port}`;
  const serverOrigin = new URL(origin).origin;

  const browser = await chromium.launch({ headless: true });
  let context = null;
  try {
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const requests = [];
    const blockRemote = (route) => {
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
    await context.route('**/*', blockRemote);
    const page = await context.newPage();
    const t0 = Date.now();
    const consoleErrors = [];
    const failedRequests = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(`@${Date.now() - t0}ms ${message.text().slice(0, 200)}`);
    });
    page.on('pageerror', (error) => consoleErrors.push(`@${Date.now() - t0}ms pageerror: ${String(error).slice(0, 200)}`));
    page.on('requestfailed', (request) => {
      const url = request.url();
      try {
        if (new URL(url).origin === serverOrigin) failedRequests.push(`@${Date.now() - t0}ms ${url}`);
      } catch { /* ignore */ }
    });

    // ---- Phase A: install the ACTUAL old client --------------------------
    // Seed fake v1 data behind an asset-blocked first paint, then boot for
    // real: the shell migrates the seed and the be94f12 worker installs.
    await page.route('**/assets/*.js', (route) => route.abort('blockedbyclient'));
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(new Function(`return (async () => { ${SEED_JS} })()`));
    await page.unroute('**/assets/*.js');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitBridge(page);
    // The seed-phase asset block intentionally aborted the very first bundle
    // fetch (harness-induced noise, like the d4 gate's induced rejection);
    // start the zero-failure/zero-error accounting from the real boot on.
    failedRequests.length = 0;
    for (let i = consoleErrors.length - 1; i >= 0; i -= 1) {
      if (consoleErrors[i].includes('ERR_BLOCKED_BY_CLIENT')) consoleErrors.splice(i, 1);
    }

    // The first boot installs the worker; a reload puts it in control.
    let phaseA = await pageState(page);
    for (let attempt = 0; attempt < 3 && !phaseA.controlled; attempt += 1) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitBridge(page);
      phaseA = await pageState(page);
    }
    check(phaseA.controlled === true, 'old client must be controlled by the be94f12 worker');
    check(phaseA.caches.includes(OLD_CACHE), `old client must hold the ${OLD_CACHE} cache (got ${phaseA.caches.join(',')})`);
    check(phaseA.scripts.some((src) => src.includes(oldBundle)), `old client must run the be94f12 bundle ${oldBundle}`);
    check(phaseA.rows.includes('swup-seeded'), `old client must render the seeded row (got ${phaseA.rows.join(',')})`);
    const deviceBefore = phaseA.deviceId;
    check(typeof deviceBefore === 'string' && deviceBefore.length > 0, 'old client holds a stable device id');

    // ---- Phase B: replace the served deployment --------------------------
    // Same origin, same URLs, new bytes — the deploy shape that shipped the
    // corrected reset handler. The old controlled client now meets the
    // bounded reopen/reload sequence every installed user gets.
    serve(NEW_DIST);
    console.log('deployment replaced: served root now points at the current build');

    // Reload once to boot the (possibly stale) client against the new
    // deployment: its registration runs the update check that discovers a
    // changed worker. Then give activation a bounded window; the page-side
    // driver activates the waiting worker only outside critical sections.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitBridge(page);
    console.log(`@${Date.now() - t0}ms post-swap reload booted; waiting for the worker update to activate`);
    const activationDeadline = Date.now() + 60000;
    let activated = false;
    while (Date.now() < activationDeadline) {
      const state = await pageState(page);
      if (newCacheVersion !== oldCacheVersion
        && state.caches.includes(newCacheVersion)
        && !state.caches.includes(oldCacheVersion)) {
        activated = true;
        break;
      }
      await page.waitForTimeout(500);
    }

    if (!activated) {
      // ---- RED branch: the stale client never updated --------------------
      // Prove the exact incident symptom through the real UI path: the
      // client is still pinned to the old shell, and a confirmed Factory
      // Reset still triggers the old export-first download.
      const stale = await pageState(page);
      check(stale.scripts.some((src) => src.includes(oldBundle)),
        `stale client must still run the be94f12 bundle (scripts: ${stale.scripts.join(', ')})`);
      check(stale.scripts.every((src) => !src.includes(newBundle)),
        'stale client must never load the corrected bundle');
      const symptomDownload = page.waitForEvent('download', { timeout: 30000 }).then(() => true, () => false);
      await confirmFactoryReset(page);
      const downloaded = await symptomDownload;
      if (downloaded) {
        check(false, 'STALE CLIENT INCIDENT REPRODUCED: the served deployment was replaced, but the controlled client stayed pinned to the old cached shell and a confirmed Factory Reset through the real UI still triggered a download/export (the be94f12 export-first handler).');
      } else {
        check(false, 'client never discovered the worker update (no new cache generation activated within the bounded sequence); the reset download symptom was not observed, so the incident could not be confirmed either way');
      }
    } else {
      // ---- GREEN branch: the client updated safely ------------------------
      console.log(`@${Date.now() - t0}ms worker update activated (${oldCacheVersion} -> ${newCacheVersion}); reloading into the corrected shell`);
      // Bounded reopen/reload: the activation retired the old binary (epoch
      // bumped), so this reload is where the corrected shell must load.
      let upgraded = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitBridge(page);
        upgraded = await pageState(page);
        if (upgraded.scripts.some((src) => src.includes(newBundle))) break;
      }
      check(upgraded.controlled === true, 'updated client stays controlled after the upgrade reload');
      check(upgraded.scripts.some((src) => src.includes(newBundle)),
        `updated client must load the corrected bundle ${newBundle} (scripts: ${upgraded.scripts.join(', ')})`);
      check(upgraded.caches.includes(newCacheVersion) && !upgraded.caches.includes(oldCacheVersion),
        `updated client holds only the new cache generation (got ${upgraded.caches.join(',')})`);
      // No finance-data loss across the upgrade: rows and device id survive.
      check(upgraded.rows.includes('swup-seeded'), `fake data survives the upgrade (rows: ${upgraded.rows.join(',')})`);
      check(upgraded.deviceId === deviceBefore, 'device id survives the upgrade');
      // True offline fallback retained on the corrected worker.
      await context.setOffline(true);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
      await waitBridge(page).catch(() => undefined);
      const offline = await pageState(page);
      check(offline.rows.includes('swup-seeded'), `offline reload on the corrected worker serves committed rows (got ${offline.rows.join(',')})`);
      check(offline.controlled === true, 'corrected worker still controls the page offline');
      await context.setOffline(false);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitBridge(page);

      // Manual Export Backup still downloads independently.
      await gotoSettings(page);
      const exportDownloadPromise = page.waitForEvent('download', { timeout: 30000 });
      await page.getByText('تصدير نسخة احتياطية', { exact: false }).first().click();
      const backupDownload = await exportDownloadPromise.then(() => true, () => false);
      check(backupDownload === true, 'manual Export Backup on the corrected client must still download');
      const stillThere = await pageState(page);
      check(stillThere.rows.includes('swup-seeded'), 'manual export must not clear fake data');

      // Confirmed Factory Reset on the corrected client: ZERO downloads/
      // exports, and the fake data is actually cleared. The corrected reset
      // reloads the app itself — wait for that reload instead of forcing
      // one, so the commit is never interrupted mid-flight.
      const resetDownloadWatch = page.waitForEvent('download', { timeout: 15000 }).then(() => true, () => false);
      await page.evaluate(() => { window.__swupPreReset = true; });
      await confirmFactoryReset(page);
      const resetReloaded = await page.waitForFunction(() => !window.__swupPreReset, null, { timeout: 30000 })
        .then(() => true, () => false);
      check(resetReloaded, 'confirmed Factory Reset must complete and reload the app');
      await waitBridge(page).catch(() => undefined);
      check(await resetDownloadWatch === false, 'confirmed Factory Reset on the corrected client must trigger zero downloads/exports');
      const afterReset = await pageState(page);
      check(!afterReset.rows.includes('swup-seeded'), `Factory Reset clears the fake data (rows after reset: ${afterReset.rows.join(',')})`);
    }

    // Final integrity (both branches): the lifecycle never leaves this
    // origin and never leaks remote requests.
    const remote = requests.filter((url) => {
      try {
        return new URL(url).origin !== serverOrigin;
      } catch {
        return true;
      }
    });
    check(remote.length === 0, `remote requests observed: ${remote.slice(0, 5).join(', ')}`);
    if (activated) {
      check(consoleErrors.length === 0, `console/page errors: ${consoleErrors.slice(0, 5).join(' | ')}`);
      check(failedRequests.length === 0, `failed local requests: ${failedRequests.slice(0, 5).join(' | ')}`);
    }

    if (failures.length > 0) {
      console.error(`p04-d5 sw-upgrade browser failures:\n- ${failures.join('\n- ')}`);
      process.exitCode = 1;
    } else {
      console.log('p04-d5 sw-upgrade browser passed: real be94f12 client discovers/activates the corrected worker, loads the corrected shell with zero finance-data loss, no-export Factory Reset clears fake data, manual Export Backup downloads, offline fallback intact, zero remote/errors');
    }
  } finally {
    if (context) await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    if (server.listening) server.close();
  }
}

main().catch((error) => {
  if (failures.length > 0) {
    console.error(`p04-d5 sw-upgrade browser failures before crash:\n- ${failures.join('\n- ')}`);
  }
  console.error(error);
  process.exitCode = 1;
});


