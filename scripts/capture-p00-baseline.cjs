const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const http = require('node:http');
const { existsSync } = require('node:fs');
const { mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises');
const { extname, join, resolve } = require('node:path');
const AxeBuilder = require('@axe-core/playwright').default;
const { chromium } = require('playwright');

if (process.env.RUSHD_BASELINE_WRITE !== '1') {
  console.error('Refusing to write immutable P00 evidence without RUSHD_BASELINE_WRITE=1.');
  process.exit(2);
}

const root = process.cwd();
const baselineRoot = resolve('docs/baseline/current');
const captureRoot = resolve('test-results/p00-native-capture-attempt-02/current');
const chromiumExecutablePath = resolve(
  'node_modules/playwright-core/.local-browsers/chromium-1234',
  process.arch === 'arm64' ? 'chrome-mac-arm64' : 'chrome-mac',
  'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
);
const cdpEndpoint = process.env.RUSHD_CDP_ENDPOINT?.trim() || null;
if (cdpEndpoint) {
  const parsedEndpoint = new URL(cdpEndpoint);
  assert.equal(parsedEndpoint.protocol, 'http:', 'RUSHD_CDP_ENDPOINT must use localhost HTTP');
  assert.equal(parsedEndpoint.hostname, '127.0.0.1', 'RUSHD_CDP_ENDPOINT must bind to 127.0.0.1');
}
const replace = process.env.RUSHD_BASELINE_REPLACE === '1';
if (existsSync(baselineRoot) && !replace) {
  console.error('P00 baseline already exists. Set RUSHD_BASELINE_REPLACE=1 only for an explicitly reviewed replacement.');
  process.exit(3);
}

const port = Number(process.env.RUSHD_BASELINE_PORT || 4174);
const baseUrl = `http://127.0.0.1:${port}`;
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png'
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', baseUrl);
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const body = await readFile(join(root, pathname.replace(/^\/+/, '')));
    response.writeHead(200, { 'Content-Type': contentTypes[extname(pathname)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

const listen = () => new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));
const closeServer = () => new Promise((resolveClose) => server.close(resolveClose));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function addP00ProxyResolver(page) {
  await page.addInitScript(() => {
    globalThis.__rushdResolveP00Proxy = (purpose) => {
      const debugBridge = globalThis.RushdDebug;
      if (debugBridge) {
        if (typeof debugBridge.getAppProxy !== 'function') {
          throw new Error(`P02 debug bridge has no getAppProxy() while ${purpose}.`);
        }
        const proxy = debugBridge.getAppProxy();
        if (!proxy) throw new Error(`P02 debug bridge returned no mounted proxy while ${purpose}.`);
        return proxy;
      }

      // Baseline capture normally runs against the pinned legacy app, which
      // predates the explicit bridge and exposed this Vue-private shape.
      const legacyProxy = document.querySelector('#app')?.__vue_app__?._instance?.proxy;
      if (!legacyProxy) throw new Error(`Legacy reference mounted proxy is unavailable while ${purpose}.`);
      return legacyProxy;
    };
  });
}

async function seedFixture(page, fixture, language, theme, onboarding = false, motion = 'full') {
  await page.goto(`${baseUrl}/__p00_seed__.html`, { waitUntil: 'load', timeout: 60_000 });
  const payload = JSON.parse(JSON.stringify(fixture));
  payload.local_storage.rushd_lang = language;
  payload.local_storage.rushd_theme = theme;
  payload.local_storage.rushd_motion = motion;
  const settings = payload.indexed_db.stores.settings;
  const themeRecord = settings.find((item) => item.key === 'theme');
  if (themeRecord) themeRecord.value = theme;
  const motionRecord = settings.find((item) => item.key === 'motionLevel');
  if (motionRecord) motionRecord.value = motion;
  if (onboarding) {
    payload.indexed_db.stores.settings = settings.filter((item) => item.key !== 'onboardingState');
    const assignmentRecord = payload.indexed_db.stores.settings.find((item) => item.key === 'monthlyTemplateAssignments');
    if (assignmentRecord) assignmentRecord.value = [];
  }

  await page.evaluate(async (seed) => {
    for (const [key, value] of Object.entries(seed.local_storage)) localStorage.setItem(key, value);
    const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    if (databases.some((item) => item.name === seed.indexed_db.name)) {
      await new Promise((resolveDelete, rejectDelete) => {
        const request = indexedDB.deleteDatabase(seed.indexed_db.name);
        request.onsuccess = () => resolveDelete();
        request.onerror = () => rejectDelete(request.error);
        request.onblocked = () => rejectDelete(new Error('P00 seed delete blocked'));
      });
    }
    const db = await new Promise((resolveOpen, rejectOpen) => {
      const request = indexedDB.open(seed.indexed_db.name, seed.indexed_db.version);
      request.onupgradeneeded = () => {
        const opened = request.result;
        opened.createObjectStore('settings', { keyPath: 'key' });
        opened.createObjectStore('templates', { keyPath: 'id' });
        const expenses = opened.createObjectStore('expenses', { keyPath: 'id' });
        expenses.createIndex('date', 'date', { unique: false });
        expenses.createIndex('isPaid', 'isPaid', { unique: false });
      };
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    for (const [storeName, records] of Object.entries(seed.indexed_db.stores)) {
      await new Promise((resolveTx, rejectTx) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        for (const record of records) store.put(record);
        transaction.oncomplete = () => resolveTx();
        transaction.onerror = () => rejectTx(transaction.error);
      });
    }
    db.close();
  }, payload);
  await page.goto(baseUrl, { waitUntil: 'load', timeout: 60_000 });
  await page.locator('.app-shell-nav-btn').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  const fixtureDate = payload.indexed_db.stores.expenses[0]?.date;
  if (fixtureDate) {
    await page.evaluate(async (date) => {
      const proxy = globalThis.__rushdResolveP00Proxy('loading the fixture date');
      if (typeof proxy.store?.loadDay !== 'function') {
        throw new Error('Mounted proxy has no Store.loadDay() for fixture loading.');
      }
      await proxy.store.loadDay(date);
    }, fixtureDate);
  }
}

function pngDimensions(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function captureState(page, directory, stateId, accessibility, expectedViewport) {
  const path = resolve(directory, `${stateId}.png`);
  await mkdir(resolve(path, '..'), { recursive: true });
  await page.screenshot({ path, fullPage: false, animations: 'disabled', scale: 'css' });
  const bytes = await readFile(path);
  const dimensions = pngDimensions(bytes);
  assert.deepEqual(dimensions, expectedViewport, `${stateId} was not captured at the native viewport`);
  const axe = await new AxeBuilder({ page }).analyze();
  accessibility.push({
    state_id: stateId,
    screenshot_path: path.replace(`${captureRoot}/`, 'docs/baseline/current/'),
    screenshot_sha256: sha256(bytes),
    viewport: expectedViewport,
    violations: axe.violations,
    violation_count: axe.violations.length,
    passes_count: axe.passes.length,
    incomplete_count: axe.incomplete.length
  });
}

async function navigate(page, index) {
  await page.locator('.app-shell-nav-btn').nth(index).click();
  await page.waitForTimeout(250);
}

async function captureScreens(page, directory, state, accessibility, viewport) {
  const screens = ['dashboard', 'statistics', 'vault', 'plans', 'settings'];
  for (let index = 0; index < screens.length; index += 1) {
    await navigate(page, index);
    await captureState(page, directory, `${state}-${screens[index]}`, accessibility, viewport);
  }
}

async function captureMotion(browser, fixture, language, theme, viewport, directory, profile = 'full', stem = 'motion-add-full') {
  const videoRoot = resolve('test-results/p00-playwright-video');
  await mkdir(videoRoot, { recursive: true });
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: language === 'ar' ? 'ar-SA' : 'en-US', timezoneId: 'Asia/Riyadh', recordVideo: { dir: videoRoot, size: viewport } });
  const page = await context.newPage();
  await seedFixture(page, fixture, language, theme, false, profile);
  await page.locator('.fab').click();
  await page.waitForTimeout(900);
  const video = page.video();
  await context.close();
  const source = await video.path();
  const webm = resolve(directory, `${stem}.webm`);
  const mp4 = resolve(directory, `${stem}.mp4`);
  await mkdir(directory, { recursive: true });
  await rename(source, webm);
  const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
  for (const path of [webm, mp4]) {
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', path], { encoding: 'utf8' });
    if (probe.status !== 0) throw new Error(`ffprobe failed: ${probe.stderr}`);
    const stream = JSON.parse(probe.stdout).streams[0];
    assert.deepEqual({ width: stream.width, height: stream.height }, viewport, `${path} was not recorded at the native viewport`);
  }
}

(async () => {
  await rm(resolve(captureRoot, '..'), { recursive: true, force: true });
  await mkdir(captureRoot, { recursive: true });
  await listen();
  if (!cdpEndpoint) assert.ok(existsSync(chromiumExecutablePath), `Pinned Chromium executable missing: ${chromiumExecutablePath}`);
  const browser = cdpEndpoint
    ? await chromium.connectOverCDP(cdpEndpoint)
    : await chromium.launch({ headless: true, executablePath: chromiumExecutablePath });
  const browserVersion = browser.version();
  assert.equal(require('playwright/package.json').version, '1.62.1');
  assert.equal(browserVersion, '151.0.7922.34');
  const empty = JSON.parse(await readFile('tests/fixtures/v1/empty.json', 'utf8'));
  const populated = JSON.parse(await readFile('tests/fixtures/v1/populated.json', 'utf8'));
  const matrix = [];
  const performanceSamples = [];
  const capturedAt = new Date();

  for (const language of ['ar', 'en']) {
    for (const theme of ['dark', 'light']) {
      for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 1366 }, { width: 1440, height: 900 }]) {
        const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: language === 'ar' ? 'ar-SA' : 'en-US', timezoneId: 'Asia/Riyadh' });
        const page = await context.newPage();
        await addP00ProxyResolver(page);
        const directory = resolve(captureRoot, language, theme, `${viewport.width}x${viewport.height}`);
        const accessibility = [];
        await mkdir(directory, { recursive: true });

        await seedFixture(page, empty, language, theme, true);
        await captureState(page, directory, 'onboarding', accessibility, viewport);
        await page.evaluate(() => {
          const proxy = globalThis.__rushdResolveP00Proxy('showing the onboarding loading state');
          if (!proxy.onboardingModal) throw new Error('Mounted proxy has no onboardingModal loading state.');
          proxy.onboardingModal.isLoading = true;
        });
        await captureState(page, directory, 'loading-onboarding', accessibility, viewport);
        await page.evaluate(() => {
          const proxy = globalThis.__rushdResolveP00Proxy('clearing the onboarding loading state');
          if (!proxy.onboardingModal) throw new Error('Mounted proxy has no onboardingModal loading state.');
          proxy.onboardingModal.isLoading = false;
        });
        await page.getByRole('button', { name: language === 'ar' ? 'تخطي الآن' : 'Skip for Now', exact: true }).click();
        await captureScreens(page, directory, 'empty', accessibility, viewport);
        await navigate(page, 0);
        await page.locator('.fab').click();
        await captureState(page, directory, 'add-modal', accessibility, viewport);
        await page.getByRole('button', { name: 'close', exact: true }).click();
        await page.evaluate((message) => {
          const vm = globalThis.__rushdResolveP00Proxy('showing the error toast');
          vm.toastMessage = message;
          vm.toastVisible = true;
          clearTimeout(vm._toastTimer);
        }, language === 'ar' ? 'فشل تجريبي — بيانات وهمية فقط' : 'Synthetic failure — fake data only');
        await captureState(page, directory, 'error-toast', accessibility, viewport);
        await page.evaluate(() => {
          globalThis.__rushdResolveP00Proxy('hiding the error toast').toastVisible = false;
        });
        await page.keyboard.press('Tab');
        await captureState(page, directory, 'keyboard-focus-dashboard', accessibility, viewport);

        await seedFixture(page, populated, language, theme);
        performanceSamples.push(await page.evaluate(({ language, theme, viewport }) => {
          const navigation = performance.getEntriesByType('navigation')[0];
          return {
            language,
            theme,
            viewport,
            dom_content_loaded_ms: navigation?.domContentLoadedEventEnd ?? null,
            load_event_ms: navigation?.loadEventEnd ?? null,
            dom_nodes: document.querySelectorAll('*').length
          };
        }, { language, theme, viewport: `${viewport.width}x${viewport.height}` }));
        await captureScreens(page, directory, 'populated', accessibility, viewport);
        await navigate(page, 0);
        await page.locator('.expense-card').first().click();
        await captureState(page, directory, 'edit-modal', accessibility, viewport);
        await page.getByRole('button', { name: 'close', exact: true }).click();
        await page.locator('.cinematic-stage header button').first().click();
        await captureState(page, directory, 'profile-modal', accessibility, viewport);
        await page.getByRole('button', { name: 'close', exact: true }).click();
        await navigate(page, 3);
        await page.locator('.plan-action-block').click();
        await captureState(page, directory, 'apply-plan-modal', accessibility, viewport);
        await page.getByRole('button', { name: 'close', exact: true }).click();
        await navigate(page, 4);
        await page.getByRole('button', { name: language === 'ar' ? /إعادة ضبط المصنع/ : /Factory Reset/ }).click();
        await captureState(page, directory, 'confirm-reset-modal', accessibility, viewport);
        await page.locator('.confirm-dialog-card button').last().click();

        await captureMotion(browser, populated, language, theme, viewport, directory);
        const accessibilityPath = resolve(directory, 'accessibility.json');
        const accessibilityDocument = {
          schema: 'rushd.p00-state-accessibility.v1',
          captured_at: capturedAt.toISOString(),
          runner: { engine: 'Playwright Chromium', playwright_version: '1.62.1', chromium_version: browserVersion },
          language,
          theme,
          viewport,
          device_scale_factor: 1,
          state_count: accessibility.length,
          states: accessibility
        };
        await writeFile(accessibilityPath, `${JSON.stringify(accessibilityDocument, null, 2)}\n`);
        matrix.push({ language, theme, viewport, state_count: accessibility.length, directory: directory.replace(`${captureRoot}/`, 'docs/baseline/current/'), accessibility_path: accessibilityPath.replace(`${captureRoot}/`, 'docs/baseline/current/') });
        await context.close();
      }
    }
  }

  for (const profile of ['auto', 'full', 'balanced', 'lite']) {
    await captureMotion(browser, populated, 'ar', 'dark', { width: 390, height: 844 }, resolve(captureRoot, 'motion-profiles', profile), profile, `motion-add-${profile}`);
  }

  const manifest = {
    schema: 'rushd.p00-playwright-capture.v1',
    captured_at: capturedAt.toISOString(),
    captured_local_at: new Date(capturedAt.getTime() + 3 * 60 * 60 * 1000).toISOString().replace('Z', '+03:00'),
    timezone: 'Asia/Riyadh',
    source_sha: 'b56c80bc2e2eb103ebe5bc258bfeeea60accf53c',
    playwright_version: require('playwright/package.json').version,
    chromium_version: browserVersion,
    chromium_executable_path: chromiumExecutablePath,
    runtime_connection: cdpEndpoint ? { mode: 'external-cdp', endpoint: cdpEndpoint } : { mode: 'local-launch' },
    capture_method: 'Playwright page.screenshot and recordVideo at context-native CSS viewport dimensions',
    device_scale_factor: 1,
    post_capture_processing: false,
    dimension_forcing: false,
    padded_borders_added: false,
    fixture_sha256: {
      empty: sha256(await readFile('tests/fixtures/v1/empty.json')),
      populated: sha256(await readFile('tests/fixtures/v1/populated.json'))
    },
    matrix
  };
  await writeFile(resolve(captureRoot, 'playwright-capture.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(resolve(captureRoot, 'playwright-performance.json'), `${JSON.stringify({
    schema: 'rushd.p00-playwright-performance.v1',
    captured_at: capturedAt.toISOString(),
    runner: { engine: 'Playwright Chromium', playwright_version: '1.62.1', chromium_version: browserVersion },
    method: 'Native Playwright navigation timing and DOM-node comparison for every locked matrix combination.',
    samples: performanceSamples
  }, null, 2)}\n`);
  await browser.close();
  await closeServer();
  await rm(baselineRoot, { recursive: true, force: true });
  await mkdir(resolve(baselineRoot, '..'), { recursive: true });
  await rename(captureRoot, baselineRoot);
  console.log(`Captured ${matrix.length} immutable P00 combinations with Chromium ${browserVersion}.`);
})().catch(async (error) => {
  await closeServer().catch(() => {});
  console.error(error);
  process.exit(1);
});
