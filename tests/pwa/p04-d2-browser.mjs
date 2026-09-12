// P04-D2 browser lifecycle gate. Run: node tests/pwa/p04-d2-browser.mjs
/* global URL:readonly, console:readonly, process:readonly, navigator:readonly */
//
// Durable proof over the real OPFS-backed candidate stack in Chromium:
// isolated candidate open/migrate/write/reload, offline reload with zero
// remote requests, two-tab invalidation, update coordination across a
// critical section, old-binary blocking, and truthful failure recovery.
// All data is synthetic; no account or cloud client is constructed.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const RAW_DIR = 'artifacts/agent-reports/p04d2-raw';
const WORKER_BUNDLE = `${RAW_DIR}/v2-worker.bundle.mjs`;
const PAGE_API_BUNDLE = `${RAW_DIR}/page-api.bundle.mjs`;
const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.webmanifest': 'application/manifest+json' };

const failures = [];
function check(condition, label) {
  if (!condition) failures.push(label);
  return condition;
}

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/' || url.pathname === '/page') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><html><head><link rel="manifest" href="/manifest.webmanifest"></head><body>p04-d2</body></html>');
        return;
      }
      if (url.pathname === '/harness/v2-worker.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=3600' });
        res.end(await readFile(join(ROOT, WORKER_BUNDLE)));
        return;
      }
      if (url.pathname === '/harness/page-api.bundle.mjs') {
        res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=3600' });
        res.end(await readFile(join(ROOT, PAGE_API_BUNDLE)));
        return;
      }
      if (url.pathname === '/rushd-pwa-sw.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end(await readFile(join(ROOT, 'public/rushd-pwa-sw.js')));
        return;
      }
      if (url.pathname === '/manifest.webmanifest') {
        res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
        res.end(await readFile(join(ROOT, 'public/manifest.webmanifest')));
        return;
      }
      if (url.pathname.startsWith('/pkg/')) {
        const file = join(ROOT, 'node_modules/@journeyapps/wa-sqlite', url.pathname.slice(5));
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
        res.end(await readFile(file));
        return;
      }
      res.writeHead(404);
      res.end('not found');
    } catch (error) {
      res.writeHead(404);
      res.end(String(error));
    }
  });
  return server;
}

function buildBundles() {
  const esbuild = join(ROOT, 'node_modules/.bin/esbuild');
  execFileSync(
    esbuild,
    ['src/data/v2/sqlite-worker.ts', '--bundle', '--format=esm', '--platform=browser', `--outfile=${WORKER_BUNDLE}`],
    { cwd: ROOT, stdio: 'pipe' },
  );
  execFileSync(
    esbuild,
    ['tests/pwa/page-api.ts', '--bundle', '--format=esm', '--platform=browser', `--outfile=${PAGE_API_BUNDLE}`],
    { cwd: ROOT, stdio: 'pipe' },
  );
}

async function openApiPage(context, origin, deviceId, { snapshot = true, migrationId = undefined, tabId = undefined } = {}) {
  const page = await context.newPage();
  await page.goto(`${origin}/page`);
  await page.addScriptTag({ type: 'module', url: `${origin}/harness/page-api.bundle.mjs` });
  await page.waitForFunction(() => globalThis.__p04d2 !== undefined);
  const summary = await page.evaluate(
    ({ did, snap, mid, tid }) => globalThis.__p04d2.openCandidate({ deviceId: did, withSnapshot: snap, migrationId: mid, tabId: tid }),
    { did: deviceId, snap: snapshot, mid: migrationId, tid: tabId },
  );
  return { page, summary };
}

async function main() {
  mkdirSync(join(ROOT, RAW_DIR), { recursive: true });
  buildBundles();

  const server = startServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server address missing');
  const origin = `http://127.0.0.1:${address.port}`;
  const serverOrigin = new URL(origin).origin;

  const requests = [];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route('**/*', (route) => {
    const url = route.request().url();
    requests.push(url);
    try {
      if (new URL(url).origin !== serverOrigin) return route.abort();
    } catch {
      return route.abort();
    }
    return route.continue();
  });

  try {
    // 1. Isolated candidate opens canonical v2 and migrates fake v1 data.
    const device = 'test-device-0001';
    const { page: tabA, summary: opened } = await openApiPage(context, origin, device, { tabId: 'browser-tab-a' });
    check(opened.ok === true, `candidate open failed: ${opened.reason}`);
    check(opened.authority?.kind === 'canonicalReady', `authority is ${opened.authority?.kind}, want canonicalReady`);
    check(opened.storageId === `mig-mg-${device}-0001`, `storage ${opened.storageId} is not the migration commit`);
    check(opened.dayCount >= 1, `migrated day has ${opened.dayCount} rows, want >= 1`);
    check(opened.inputIntact === true, 'v1 migration input must stay byte-identical (no dual writer)');

    // 2. Capture commits through the deterministic gateway.
    const submitted = await tabA.evaluate(() => globalThis.__p04d2.submitExpense({ name: 'milk', cost: 9.5, category: 'food', date: '2026-09-05' }));
    check(submitted.ok === true, `capture failed: ${JSON.stringify(submitted)}`);
    check(typeof submitted.id === 'string' && submitted.id.length > 0, 'committed expense must carry an id');
    const day = await tabA.evaluate(() => globalThis.__p04d2.listDay('2026-09-05'));
    check(day.some((row) => row.id === submitted.id), 'committed expense must list on its day');

    // 3. Reload from v2: full page reload reopens the committed pointer.
    await tabA.reload();
    await tabA.addScriptTag({ type: 'module', url: `${origin}/harness/page-api.bundle.mjs` });
    await tabA.waitForFunction(() => globalThis.__p04d2 !== undefined);
    const reopened = await tabA.evaluate(
      ({ did }) => globalThis.__p04d2.openCandidate({ deviceId: did, withSnapshot: false, tabId: 'browser-tab-a' }),
      { did: device },
    );
    check(reopened.ok === true, `reload open failed: ${reopened.reason}`);
    check(reopened.storageId === opened.storageId, 'reload must reopen the committed storage, not a fresh one');
    const dayAfterReload = await tabA.evaluate(() => globalThis.__p04d2.listDay('2026-09-05'));
    check(dayAfterReload.some((row) => row.id === submitted.id), 'committed expense must survive reload from v2');

    // 4. Two tabs: second tab reads committed state; commit invalidates it.
    const { page: tabB, summary: openedB } = await openApiPage(context, origin, device, { snapshot: false, tabId: 'browser-tab-b' });
    check(openedB.ok === true, `second tab open failed: ${openedB.reason}`);
    check(openedB.storageId === opened.storageId, 'second tab must attach to the same active storage');
    const waitInvalid = tabB.evaluate(() => globalThis.__p04d2.waitForInvalidate(15000));
    const second = await tabA.evaluate(() => globalThis.__p04d2.submitExpense({ name: 'shared', cost: 4, category: 'food', date: '2026-09-05' }));
    check(second.ok === true, `second capture failed: ${JSON.stringify(second)}`);
    const invalidated = await waitInvalid;
    check(invalidated.received === true, 'second tab must receive the commit invalidation');
    await tabB.evaluate(() => globalThis.__p04d2.refresh());
    const dayB = await tabB.evaluate(() => globalThis.__p04d2.listDay('2026-09-05'));
    check(dayB.some((row) => row.id === second.id), 'second tab must serve the new commit after refresh');

    // 5. Update activation cannot cross another tab's critical section.
    const held = await tabA.evaluate(() => globalThis.__p04d2.beginCritical('write'));
    check(held.canActivateUpdate === false, 'update must wait while a write section is held');
    const blockedView = await tabB.evaluate(() => globalThis.__p04d2.canActivateUpdate());
    check(blockedView.canActivateUpdate === false, 'the other tab must observe the held section');
    const released = await tabA.evaluate(() => globalThis.__p04d2.endCritical());
    check(released.canActivateUpdate === true, 'update may proceed once the section is released');

    // 6. An incompatible old tab is hard-blocked after the epoch transition.
    await tabB.evaluate(() => globalThis.__p04d2.bumpEpoch('incompatible-update'));
    const staleWrite = await tabA.evaluate(() => globalThis.__p04d2.submitExpense({ name: 'stale', cost: 1, category: 'food', date: '2026-09-05' }));
    check(staleWrite.ok === false && staleWrite.reason === 'blocked', `old tab must be blocked, got ${JSON.stringify(staleWrite)}`);
    const staleAuthority = await tabA.evaluate(() => globalThis.__p04d2.summary());
    check(staleAuthority.authority?.kind === 'unavailable', 'old tab authority must read unavailable after the epoch');

    // 7. Storage failure still mounts the shell path with a truthful
    // write-blocked recovery state. A clean room (fresh profile: no
    // committed pointer) plus an invalid migration id must fail closed.
    const context2 = await browser.newContext();
    const tabC = await context2.newPage();
    await tabC.goto(`${origin}/page`);
    await tabC.addScriptTag({ type: 'module', url: `${origin}/harness/page-api.bundle.mjs` });
    await tabC.waitForFunction(() => globalThis.__p04d2 !== undefined);
    const failed = await tabC.evaluate(({ did }) => globalThis.__p04d2.openCandidate({ deviceId: did, migrationId: 'has whitespace', tabId: 'browser-tab-c' }), { did: device });
    check(failed.ok === false, 'invalid migration id must fail closed');
    check(failed.authority?.kind === 'unavailable', 'failed host must report unavailable authority');
    const failedWrite = await tabC.evaluate(() => globalThis.__p04d2.submitExpense({ name: 'x', cost: 1, category: 'food' }));
    check(failedWrite.ok === false, 'failed host must block writes without success UI');
    const failedHome = await tabC.evaluate(() => globalThis.__p04d2.listDay('2026-09-05'));
    check(Array.isArray(failedHome) && failedHome.length === 0, 'failed host must serve no invented rows');
    await context2.close();

    // 8. Offline PWA reload: register the candidate worker, let it cache
    // the shell, then kill the server and reload purely from cache.
    await tabB.evaluate(() => globalThis.__p04d2.close());
    await tabA.close();
    const offline = await context.newPage();
    await offline.goto(`${origin}/page`);
    await offline.evaluate(() => navigator.serviceWorker.register('/rushd-pwa-sw.js', { scope: '/' }));
    await offline.waitForFunction(async () => (await navigator.serviceWorker.getRegistrations()).length > 0);
    await offline.reload();
    await offline.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 }).catch(() => undefined);
    await offline.addScriptTag({ type: 'module', url: `${origin}/harness/page-api.bundle.mjs` });
    await offline.waitForFunction(() => globalThis.__p04d2 !== undefined);
    const onlineUnderSw = await offline.evaluate(({ did }) => globalThis.__p04d2.openCandidate({ deviceId: did, withSnapshot: false, tabId: 'browser-offline' }), { did: device });
    check(onlineUnderSw.ok === true, `candidate open under SW failed: ${onlineUnderSw.reason}`);
    await new Promise((resolve) => server.close(resolve));
    await offline.reload();
    // The shell, bundles, and worker assets must come from the SW cache;
    // the bundle re-executes and committed OPFS state reopens offline.
    await offline.addScriptTag({ type: 'module', url: `${origin}/harness/page-api.bundle.mjs` });
    await offline.waitForFunction(() => globalThis.__p04d2 !== undefined, null, { timeout: 30000 });
    const offlineOpened = await offline.evaluate(({ did }) => globalThis.__p04d2.openCandidate({ deviceId: did, withSnapshot: false, tabId: 'browser-offline' }), { did: device });
    check(offlineOpened.ok === true, `offline reload open failed: ${offlineOpened.reason}`);
    const offlineDay = await offline.evaluate(() => globalThis.__p04d2.listDay('2026-09-05'));
    check(offlineDay.length >= 2, `offline reload serves ${offlineDay.length} committed rows, want >= 2`);

    // 9. Zero remote runtime requests across the whole run.
    const remote = requests.filter((url) => {
      try {
        return new URL(url).origin !== serverOrigin;
      } catch {
        return true;
      }
    });
    check(remote.length === 0, `remote requests observed: ${remote.slice(0, 5).join(', ')}`);

    if (failures.length > 0) {
      console.error(`p04-d2 browser failures:\n- ${failures.join('\n- ')}`);
      process.exitCode = 1;
    } else {
      console.log('p04-d2 browser lifecycle passed: migrate/write/reload, two-tab, update coordination, old-tab blocking, failure recovery, offline reload, zero remote requests');
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
