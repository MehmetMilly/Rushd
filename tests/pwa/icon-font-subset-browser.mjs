import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';

/* global URL:readonly, console:readonly, document:readonly, localStorage:readonly, navigator:readonly, setTimeout:readonly, clearTimeout:readonly, caches:readonly, location:readonly */

const root = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '../..'));
const distRoot = join(root, 'dist');
const iconManifest = JSON.parse(readFileSync(join(root, 'src/components/material-symbol-icons.json'), 'utf8'));
const css = readFileSync(join(root, 'public/fonts/material-symbols-rounded.css'), 'utf8');
const subsetUrl = css.match(/url\((\/fonts\/[^)]+\.woff2)\)/)?.[1];
assert.ok(subsetUrl, 'The font stylesheet must name its WOFF2 asset.');
const subsetFile = join(distRoot, subsetUrl.slice(1));
const subsetBytes = statSync(subsetFile).size;
const sourceBytes = statSync(join(root, 'font-sources/material-symbols-rounded-v370.woff2')).size;
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

const markup = iconManifest.icons.map((name) => `<span class="material-symbols-rounded" data-icon="${name}">${name}</span>`).join('');
const fontGrid = (direction) => `<!doctype html><html lang="en" dir="${direction}"><head><meta charset="utf-8"><style>
@font-face{font-family:"MS Full";font-style:normal;font-weight:100 700;src:url('/font-source.woff2') format('woff2')}
@font-face{font-family:"MS Subset";font-style:normal;font-weight:100 700;src:url('${subsetUrl}') format('woff2')}
html,body{margin:0;background:#09090b;color:#fff}main{display:flex;gap:32px;padding:16px;direction:${direction}}section{width:264px;display:grid;grid-template-columns:repeat(6,36px);grid-auto-rows:36px;direction:${direction}}.material-symbols-rounded{font-family:"MS Full";font-weight:400;font-style:normal;font-size:24px;line-height:36px;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;direction:ltr;-webkit-font-feature-settings:'liga';font-feature-settings:'liga';-webkit-font-smoothing:antialiased;text-align:center}#subset .material-symbols-rounded{font-family:"MS Subset"}
</style></head><body><main><section id="full" aria-label="Full font reference">${markup}</section><section id="subset" aria-label="Subset candidate">${markup}</section></main></body></html>`;

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, 'http://localhost');
    const pathname = requestUrl.pathname;
    if (pathname === '/font-grid') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(fontGrid(requestUrl.searchParams.get('dir') === 'ltr' ? 'ltr' : 'rtl'));
      return;
    }
    if (pathname === '/font-source.woff2') {
      const body = await readFile(join(root, 'font-sources/material-symbols-rounded-v370.woff2'));
      response.writeHead(200, { 'Content-Type': 'font/woff2', 'Content-Length': body.byteLength });
      response.end(body);
      return;
    }
    const relativePath = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const target = resolve(distRoot, relativePath.slice(1));
    if (target !== distRoot && !target.startsWith(`${distRoot}${sep}`)) {
      response.writeHead(400);
      response.end();
      return;
    }
    const body = await readFile(target);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(target)] || 'application/octet-stream',
      'Content-Length': body.byteLength,
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch (error) {
    console.error(`Font subset test server failed: ${request.url} (${error.message})`);
    response.writeHead(404);
    response.end();
  }
});

await new Promise((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });

function pixelDifference(first, second) {
  const reference = PNG.sync.read(first);
  const candidate = PNG.sync.read(second);
  assert.equal(candidate.width, reference.width, 'Full font and subset grids must have equal widths.');
  assert.equal(candidate.height, reference.height, 'Full font and subset grids must have equal heights.');
  let differentPixels = 0;
  for (let index = 0; index < reference.data.length; index += 1) {
    if (reference.data[index] !== candidate.data[index]) differentPixels += 1;
  }
  return differentPixels;
}

try {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const gridPage = await context.newPage();
  const fontResponseBodies = [];
  gridPage.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname === '/font-source.woff2' || pathname === subsetUrl) {
      fontResponseBodies.push(response.body().then((body) => ({ pathname, bytes: body.byteLength })));
    }
  });
  for (const direction of ['rtl', 'ltr']) {
    await gridPage.goto(`${origin}/font-grid?dir=${direction}`, { waitUntil: 'load' });
    const fontLoads = await gridPage.evaluate(async (names) => Promise.all([
      document.fonts.load('24px "MS Full"', names.join(' ')),
      document.fonts.load('24px "MS Subset"', names.join(' ')),
    ].map(async (promise) => {
      try {
        return { ok: true, faces: (await promise).map((face) => face.status) };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    })), iconManifest.icons);
    assert.ok(fontLoads.every((result) => result.ok), `Font loading failed: ${JSON.stringify(fontLoads)}`);
    for (const name of iconManifest.icons) {
      assert.equal(await gridPage.evaluate(({ family, icon }) => document.fonts.check(`24px "${family}"`, icon), { family: 'MS Full', icon: name }), true, `Full font did not load ${name} in ${direction}.`);
      assert.equal(await gridPage.evaluate(({ family, icon }) => document.fonts.check(`24px "${family}"`, icon), { family: 'MS Subset', icon: name }), true, `Subset did not load ${name} in ${direction}.`);
    }
    let lightWeightReference;
    let heavyWeightReference;
    for (const weight of [100, 400, 700]) {
      await gridPage.evaluate((weightValue) => {
        for (const id of ['full', 'subset']) {
          for (const icon of document.querySelectorAll(`#${id} .material-symbols-rounded`)) {
            icon.style.fontWeight = String(weightValue);
            icon.style.fontVariationSettings = '"FILL" 0';
          }
        }
      }, weight);
      await gridPage.evaluate(() => document.fonts.ready);
      const original = await gridPage.locator('#full').screenshot();
      const subset = await gridPage.locator('#subset').screenshot();
      assert.equal(pixelDifference(original, subset), 0, `Subset pixels must match v370 at weight ${weight} and ${direction}.`);
      if (weight === 100) lightWeightReference = original;
      if (weight === 700) heavyWeightReference = original;
    }
    assert.notEqual(pixelDifference(lightWeightReference, heavyWeightReference), 0, `Variable weight must change outlines in ${direction}.`);
  }
  const coldFontResponses = await Promise.all(fontResponseBodies);
  assert.equal(coldFontResponses.find((entry) => entry.pathname === '/font-source.woff2')?.bytes, sourceBytes);
  assert.equal(coldFontResponses.find((entry) => entry.pathname === subsetUrl)?.bytes, subsetBytes);
  await context.close();

  const appContext = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  const errors = [];
  for (const language of ['ar', 'en']) {
    const page = await appContext.newPage();
    page.on('pageerror', (error) => errors.push(`${language}: ${error.message}`));
    await page.addInitScript((value) => localStorage.setItem('rushd_lang', value), language);
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.iconsReady === 'true', null, { timeout: 30000 });
    await page.waitForFunction(() => document.documentElement.dataset.bootVisualReady === 'true', null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => document.documentElement.lang), language);
    assert.equal(await page.evaluate(() => document.documentElement.dir), language === 'ar' ? 'rtl' : 'ltr');
    assert.equal(await page.locator('#app').isVisible(), true, `${language} app must appear after the subset font loads.`);
    assert.equal(await page.locator('.fab .material-symbols-rounded').innerText(), 'add');
    assert.equal(await page.locator('.fab .material-symbols-rounded').isVisible(), true);
    assert.equal(await page.locator('.icon-font-fallback-label').first().isVisible(), false);
    await page.locator('.home-settings-btn').click();
    const backIcon = page.locator('.settings-back-btn .material-symbols-rounded');
    await backIcon.waitFor({ state: 'visible' });
    assert.equal(await backIcon.innerText(), language === 'ar' ? 'arrow_forward' : 'arrow_back');
    await page.locator('.settings-back-btn').click();
    await page.locator('.fab').click();
    await page.locator('.modal-floating-card').waitFor({ state: 'visible' });
    const renderedNames = await page.locator('.modal-floating-card .cat-icon .material-symbols-rounded').allInnerTexts();
    assert.deepEqual(new Set(renderedNames), new Set(['directions_car', 'restaurant', 'bolt', 'devices', 'shopping_bag', 'category']));
    await page.close();
  }
  assert.deepEqual(errors, []);
  await appContext.close();

  const offlineContext = await browser.newContext({ reducedMotion: 'reduce' });
  const offlinePage = await offlineContext.newPage();
  await offlinePage.goto(origin, { waitUntil: 'domcontentloaded' });
  await offlinePage.waitForFunction(() => document.documentElement.dataset.iconsReady === 'true', null, { timeout: 30000 });
  await offlinePage.evaluate(async () => {
    await navigator.serviceWorker.register('/rushd-pwa-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolveController, reject) => {
        const timer = setTimeout(() => reject(new Error('service worker did not control the font cache test page')), 15000);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          clearTimeout(timer);
          resolveController();
        }, { once: true });
      });
    }
  });
  await offlinePage.reload({ waitUntil: 'domcontentloaded' });
  await offlinePage.waitForFunction(() => document.documentElement.dataset.iconsReady === 'true', null, { timeout: 30000 });
  const cacheState = await offlinePage.evaluate(async (path) => {
    const cache = await caches.open('rushd-pwa-v4');
    return {
      controlled: Boolean(navigator.serviceWorker.controller),
      fontCached: Boolean(await cache.match(new URL(path, location.origin))),
      serviceWorkerUrl: navigator.serviceWorker.controller?.scriptURL || null,
    };
  }, subsetUrl);
  assert.equal(cacheState.controlled, true, 'The test reload must be controlled by the actual candidate service worker.');
  assert.equal(cacheState.fontCached, true, 'An online font request must be cached for later offline use.');
  assert.match(cacheState.serviceWorkerUrl, /rushd-pwa-sw\.js$/);
  await offlineContext.setOffline(true);
  await offlinePage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await offlinePage.waitForFunction(() => document.documentElement.dataset.iconsReady === 'true', null, { timeout: 30000 });
  await offlinePage.waitForFunction(() => document.documentElement.dataset.bootVisualReady === 'true', null, { timeout: 15000 });
  assert.equal(await offlinePage.locator('#app').isVisible(), true, 'Offline reload must render the app with the cached subset.');
  assert.equal(await offlinePage.locator('.fab .material-symbols-rounded').isVisible(), true);
  await offlineContext.close();

  assert.ok(subsetBytes <= 150_000, `Subset file is ${subsetBytes.toLocaleString()} bytes, above the 150,000-byte budget.`);
  console.log(`Icon subset browser checks passed (${iconManifest.icons.length} names, ${sourceBytes.toLocaleString()} -> ${subsetBytes.toLocaleString()} cold font bytes, RTL/LTR parity and offline reload).`);
} finally {
  await browser.close();
  await new Promise((resolveServer) => server.close(resolveServer));
}
