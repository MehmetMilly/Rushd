// P04-D3 browser gate. Run: node tests/pwa/p04-d3-browser.mjs
/* global URL:readonly, console:readonly, process:readonly */
//
// Candidate-mode proof through the REAL established template: the shell
// mounts in explicit candidate mode over a synthetic migrated canonical
// book, Home/Transactions rows render from committed state, manual Add
// commits exactly once (modal closes only on durable success), edits
// append corrections, deletes append reversals, failures stay truthful,
// cross-tab invalidation works, and an epoch transition hard-blocks old
// tabs. All data is clearly fake; no account/cloud client is constructed.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const RAW_DIR = 'artifacts/agent-reports/p04d3-raw';
const WORKER_BUNDLE = `${RAW_DIR}/v2-worker.bundle.mjs`;
const PAGE_API_BUNDLE = `${RAW_DIR}/page-api-d3.bundle.mjs`;
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
      if (url.pathname === '/' || url.pathname === '/page-d3') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><html><head><meta name="theme-color" content="#09090b"></head><body><div id="app"></div></body></html>');
        return;
      }
      if (url.pathname === '/harness/v2-worker.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=3600' });
        res.end(await readFile(join(ROOT, WORKER_BUNDLE)));
        return;
      }
      if (url.pathname === '/harness/page-api-d3.bundle.mjs') {
        res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=3600' });
        res.end(await readFile(join(ROOT, PAGE_API_BUNDLE)));
        return;
      }
      if (url.pathname === '/app/root-template.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(await readFile(join(ROOT, 'src/app/root-template.html'), 'utf8'));
        return;
      }
      if (url.pathname === '/rushd-pwa-sw.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end(await readFile(join(ROOT, 'public/rushd-pwa-sw.js')));
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
    // Alias vue to the full compiler build, mirroring vite.config.mjs:
    // the established template is compiled at mount time.
    ['tests/pwa/page-api-d3.ts', '--bundle', '--format=esm', '--platform=browser', '--alias:vue=./node_modules/vue/dist/vue.esm-bundler.js', `--outfile=${PAGE_API_BUNDLE}`],
    { cwd: ROOT, stdio: 'pipe' },
  );
}

async function openShellPage(context, origin, deviceId, { snapshot = true, migrationId = undefined, tabId = undefined } = {}) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${origin}/page-d3`);
  await page.addScriptTag({ type: 'module', url: `${origin}/harness/page-api-d3.bundle.mjs` });
  await page.waitForFunction(() => globalThis.__p04d3 !== undefined);
  const summary = await page.evaluate(
    ({ did, snap, mid, tid }) => globalThis.__p04d3.openShell({ deviceId: did, withSnapshot: snap, migrationId: mid, tabId: tid }),
    { did: deviceId, snap: snapshot, mid: migrationId, tid: tabId },
  );
  return { page, summary, errors };
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
    const device = 'test-device-d3-0001';

    // 1. The established shell mounts in candidate mode on migrated data.
    const { page: tabA, summary: opened, errors } = await openShellPage(context, origin, device, { tabId: 'd3-tab-a' });
    check(errors.length === 0, `shell mount errors: ${errors.slice(0, 3).join(' | ')}`);
    check(opened.ok === true, `candidate shell open failed: ${opened.reason}`);
    check(opened.authority?.kind === 'canonicalReady', `authority is ${opened.authority?.kind}, want canonicalReady`);
    check(opened.storageId === `mig-mg-${device}-d3-0001`, `storage ${opened.storageId} is not the migration commit`);
    check(opened.dayCount >= 1, `migrated day has ${opened.dayCount} rows, want >= 1`);
    check(opened.domCards >= 1, `mounted template shows ${opened.domCards} cards, want >= 1`);
    check(opened.domCards === opened.dayCount, `DOM cards (${opened.domCards}) must equal canonical rows (${opened.dayCount})`);
    check(Number.isFinite(opened.safeToSpend), 'candidate hero must project finite open-cycle availability');
    check(opened.heroUnknown === false, 'hero must render the canonical availability amount when it is known');
    check(opened.inputIntact === true, 'v1 migration input must stay byte-identical (no dual writer)');

    // 1b. No fabricated classification renders; unsupported Add controls
    // remain visibly present for layout continuity but disabled.
    const domState = await tabA.evaluate(() => globalThis.__p04d3.unsupportedDomState());
    check(domState.luxuryTags === 0, `luxury source rows must render no luxury tag (found ${domState.luxuryTags})`);
    const addCheck = await tabA.evaluate(() => globalThis.__p04d3.openAddForCheck());
    check(addCheck.modalOpen === true, 'add modal must still open for manual capture');
    check(addCheck.classificationToggles >= 1, 'candidate add modal must preserve classification chrome');
    check(addCheck.disabledClassificationToggles === addCheck.classificationToggles, 'candidate classification controls must all be disabled');
    check(addCheck.flexibleToggles === 0, 'candidate add modal must hide the flexible toggle');

    // 2. Selecting a day refreshes canonical Home rows.
    const picked = await tabA.evaluate(() => globalThis.__p04d3.selectDate('2026-09-05'));
    check(picked.selectedDate === '2026-09-05', `selected date is ${picked.selectedDate}`);

    // 2b. An empty canonical day shows no cards and a disabled auto-fill.
    const emptyDay = await tabA.evaluate(() => globalThis.__p04d3.selectDate('2026-09-06'));
    check(emptyDay.domCards === 0, 'a day with no live canonical rows must show no cards');
    const emptyState = await tabA.evaluate(() => globalThis.__p04d3.unsupportedDomState());
    check(emptyState.disabledButtons >= 1, 'auto-fill must be visibly disabled in candidate mode');
    await tabA.evaluate(() => globalThis.__p04d3.selectDate('2026-09-05'));

    // 3. Manual Add commits exactly once and appears only after success.
    const added = await tabA.evaluate(() => globalThis.__p04d3.addExpense({ name: 'd3-milk', cost: '9.5' }));
    check(added.modalOpen === false, 'add modal must close only after durable success');
    const milkRows = await tabA.evaluate(() => globalThis.__p04d3.listDay('2026-09-05'));
    check(milkRows.some((row) => row.name === 'd3-milk'), 'committed expense must list on its day');
    check(added.domCards === opened.domCards + 1, `DOM must gain exactly one card (${opened.domCards} -> ${added.domCards})`);

    // 3b. A rapid double-submit still commits exactly one actual.
    const doubled = await tabA.evaluate(() => globalThis.__p04d3.doubleSubmit({ name: 'd3-double', cost: '5' }));
    check(doubled.modalOpen === false, 'double-submit must end closed after the single commit');
    const doubleRows = await tabA.evaluate(() => globalThis.__p04d3.listDay('2026-09-05'));
    check(doubleRows.filter((row) => row.name === 'd3-double').length === 1, 'double-submit must create exactly one live row');

    // 4. Reload reopens committed state in the real template.
    const reopened = await tabA.evaluate(() => globalThis.__p04d3.reopen());
    check(reopened.ok === true, `reload open failed: ${reopened.reason}`);
    check(reopened.storageId === opened.storageId, 'reload must reopen the committed storage');
    const afterReload = await tabA.evaluate(() => globalThis.__p04d3.listDay('2026-09-05'));
    check(afterReload.some((row) => row.name === 'd3-milk'), 'committed expense must survive reload');
    check(reopened.domCards >= opened.domCards + 2, 'reloaded template must render the committed rows');

    // 5. A second tab reads committed state; a new commit invalidates it.
    const second = await openShellPage(context, origin, device, { snapshot: false, tabId: 'd3-tab-b' });
    const tabB = second.page;
    check(second.summary.ok === true, `second tab open failed: ${second.summary.reason}`);
    check(second.summary.storageId === opened.storageId, 'second tab must attach to the same active storage');
    const waitInvalid = tabB.evaluate(() => globalThis.__p04d3.waitForInvalidate(15000));
    const shared = await tabA.evaluate(() => globalThis.__p04d3.addExpense({ name: 'd3-shared', cost: '4' }));
    check(shared.modalOpen === false, 'second capture must succeed');
    const invalidated = await waitInvalid;
    check(invalidated.received === true, 'second tab must receive the commit invalidation');
    await tabB.evaluate(() => globalThis.__p04d3.refresh());
    const dayB = await tabB.evaluate(() => globalThis.__p04d3.listDay('2026-09-05'));
    check(dayB.some((row) => row.name === 'd3-shared'), 'second tab must serve the new commit after refresh');

    // 6. Edit appends a linked correction; the live view updates.
    const milkId = (await tabA.evaluate(() => globalThis.__p04d3.listDay('2026-09-05'))).find((row) => row.name === 'd3-milk')?.id;
    check(!!milkId, 'milk row must have an id');
    const edited = await tabA.evaluate((id) => globalThis.__p04d3.saveEdit({ id, name: 'd3-oat-milk', cost: '11' }), milkId);
    check(edited.modalOpen === false, 'edit modal must close after the durable correction');
    const liveAfterEdit = await tabA.evaluate(() => globalThis.__p04d3.listDay('2026-09-05'));
    check(!liveAfterEdit.some((row) => row.id === milkId), 'corrected-away id must leave the live view');
    check(liveAfterEdit.some((row) => row.name === 'd3-oat-milk'), 'replacement must appear in the live view');

    // 7. Delete appends a reversal; the card disappears without v1 writes.
    const sharedId = (await tabA.evaluate(() => globalThis.__p04d3.listDay('2026-09-05'))).find((row) => row.name === 'd3-shared')?.id;
    check(!!sharedId, 'shared row must have an id');
    const removed = await tabA.evaluate((id) => globalThis.__p04d3.deleteById(id), sharedId);
    check(removed.dialogWasOpen === true, 'delete must confirm the reversal first');
    const liveAfterDelete = await tabA.evaluate(() => globalThis.__p04d3.listDay('2026-09-05'));
    check(!liveAfterDelete.some((row) => row.id === sharedId), 'reversed entry must hide from the live view');

    // 8. Validation failure leaves the modal open with no new record.
    const countBefore = (await tabA.evaluate(() => globalThis.__p04d3.listDay('2026-09-05'))).length;
    const failed = await tabA.evaluate(() => globalThis.__p04d3.addExpense({ name: 'd3-bad', cost: 'abc' }));
    check(failed.modalOpen === true, 'invalid add must leave the modal open and retryable');
    const countAfter = (await tabA.evaluate(() => globalThis.__p04d3.listDay('2026-09-05'))).length;
    check(countAfter === countBefore, 'invalid add must create no record');

    // 9. Pay stays blocked with the modal truthful and state untouched.
    // Direct openPayModal invocation never opens the modal in candidate.
    const openAttempt = await tabA.evaluate(() => globalThis.__p04d3.openPayAttempt());
    check(openAttempt.modalOpen === false, 'direct pay-modal invocation must not open the modal in candidate mode');
    const paidBefore = await tabA.evaluate(() => globalThis.__p04d3.listDay('2026-09-05'));
    const payAttempt = await tabA.evaluate(() => globalThis.__p04d3.tryPayBlocked());
    check(payAttempt.modalOpen === true, 'blocked pay must keep the modal open');
    const paidAfter = await tabA.evaluate(() => globalThis.__p04d3.listDay('2026-09-05'));
    check(JSON.stringify(paidAfter) === JSON.stringify(paidBefore), 'blocked pay must mutate nothing');

    // 10. An epoch transition hard-blocks the old tab.
    await tabB.evaluate(() => globalThis.__p04d3.bumpEpoch('incompatible-update'));
    const stale = await tabA.evaluate(() => globalThis.__p04d3.addExpense({ name: 'd3-stale', cost: '1' }));
    check(stale.modalOpen === true, 'old tab must not show success after the epoch');
    const staleDay = await tabA.evaluate(() => globalThis.__p04d3.listDay('2026-09-05'));
    check(!staleDay.some((row) => row.name === 'd3-stale'), 'old tab write must not commit');
    const staleAuthority = await tabA.evaluate(() => globalThis.__p04d3.summary());
    check(staleAuthority.authority?.kind === 'unavailable', 'old tab authority must read unavailable');
    await tabB.close();
    await tabA.close();

    // 11. Zero remote runtime requests across the whole run.
    const remote = requests.filter((url) => {
      try {
        return new URL(url).origin !== serverOrigin;
      } catch {
        return true;
      }
    });
    check(remote.length === 0, `remote requests observed: ${remote.slice(0, 5).join(', ')}`);

    if (failures.length > 0) {
      console.error(`p04-d3 browser failures:\n- ${failures.join('\n- ')}`);
      process.exitCode = 1;
    } else {
      console.log('p04-d3 browser passed: established shell in candidate mode, add-once, correction, reversal, cross-tab, failures, epoch, zero remote requests');
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
