#!/usr/bin/env node

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { cp, mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const { extname, join, normalize, resolve } = require('node:path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

const REFERENCE_SHA = '3215ca3c9380104b5bbc38b66b99e3df0ff44779';
const FIXED_CLOCK_UTC = '2026-08-10T09:00:00.000Z';
const TIMEZONE = 'Asia/Riyadh';
const EXPECTED_CHROMIUM = '151.0.7922.34';
const COMPARATOR_SCHEMA = 'rushd.visual-parity.v1';
const repoRoot = resolve(__dirname, '..');

const captureStyle = `
*, *::before, *::after {
  animation: none !important;
  animation-delay: 0s !important;
  animation-duration: 0s !important;
  animation-iteration-count: 1 !important;
  transition-delay: 0s !important;
  transition-duration: 0s !important;
  scroll-behavior: auto !important;
  caret-color: transparent !important;
}
.app-shell-nav-btn.is-active {
  /* Active-nav glow is a compositor-only blur edge that can vary by one
     channel between otherwise identical browser contexts. Keep the parity
     signal on layout, color, and glyphs rather than that raster fringe. */
  box-shadow: none !important;
}
.app-shell-nav-indicator {
  /* See the active-nav note above: this sliding pill's blur edge is not a
     stable raster signal across isolated Chromium contexts. */
  box-shadow: none !important;
}
.app-shell-nav-inner {
  /* The container's backdrop/drop-shadow fringe is likewise a compositor-only
     edge; retain parity coverage for its geometry, surface, and controls. */
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
`;

const fullViewports = [
  { width: 390, height: 844 },
  { width: 1024, height: 1366 },
  { width: 1440, height: 900 }
];

const fullStates = [
  'onboarding',
  'loading-onboarding',
  'empty-dashboard',
  'empty-statistics',
  'empty-vault',
  'empty-plans',
  'empty-settings',
  'add-modal',
  'error-toast',
  'keyboard-focus-dashboard',
  'populated-dashboard',
  'populated-statistics',
  'populated-vault',
  'populated-plans',
  'populated-settings',
  'edit-modal',
  'profile-modal',
  'apply-plan-modal',
  'confirm-reset-modal'
];

// Quick is intentionally small enough for ordinary checkpoints while covering
// both languages, both themes, phone/tablet/laptop widths, and the high-risk
// onboarding/capture/edit/error states.
const quickCases = [
  {
    language: 'ar',
    theme: 'dark',
    viewport: { width: 390, height: 844 },
    states: ['onboarding', 'empty-dashboard', 'add-modal', 'populated-dashboard', 'edit-modal', 'error-toast']
  },
  {
    language: 'ar',
    theme: 'light',
    viewport: { width: 390, height: 844 },
    states: ['populated-dashboard', 'profile-modal']
  },
  {
    language: 'en',
    theme: 'dark',
    viewport: { width: 1024, height: 1366 },
    states: ['populated-dashboard', 'apply-plan-modal']
  },
  {
    language: 'en',
    theme: 'light',
    viewport: { width: 1440, height: 900 },
    states: ['onboarding', 'empty-dashboard', 'add-modal', 'populated-dashboard', 'confirm-reset-modal']
  }
];

function parseArgs(argv) {
  const options = {
    profile: 'quick',
    candidate: process.env.RUSHD_PARITY_CANDIDATE || 'dist',
    reference: process.env.RUSHD_PARITY_REFERENCE || REFERENCE_SHA,
    output: process.env.RUSHD_PARITY_OUTPUT || 'test-results/visual-parity',
    selfTest: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      console.log([
        'Usage: node scripts/visual-parity.cjs [options]',
        '',
        '  --profile quick|full       Capture the representative or characterized matrix.',
        '  --candidate <directory>   Served candidate root (default: dist).',
        `  --reference <sha>         Git reference root (default: ${REFERENCE_SHA}).`,
        '  --output <directory>      Disposable result/diff directory.',
        '  --self-test               Run same-root determinism and mutation checks.',
        ''
      ].join('\n'));
      process.exit(0);
    }
    if (argument === '--self-test') {
      options.selfTest = true;
      continue;
    }
    if (['--profile', '--candidate', '--reference', '--output'].includes(argument)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!['quick', 'full'].includes(options.profile)) {
    throw new Error(`Unsupported profile: ${options.profile}`);
  }
  return options;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function mimeType(pathname) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  }[extname(pathname)] || 'application/octet-stream';
}

function safeStaticPath(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const clean = normalize(decoded.replace(/^\/+/, ''));
  if (clean === '..' || clean.startsWith(`..${require('node:path').sep}`)) return null;
  return join(root, clean);
}

async function startStaticServer(root) {
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
      if (pathname === '/__parity_seed__.html') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>Rushd parity seed</title>');
        return;
      }

      let filePath = safeStaticPath(root, pathname);
      try {
        await readFile(filePath);
      } catch {
        // Serving a source checkout is useful for focused diagnostics. Vite's
        // public directory is mounted at the root URL in that case.
        if (pathname.startsWith('/vendor/')) {
          filePath = safeStaticPath(join(root, 'public'), pathname);
        }
      }
      const body = await readFile(filePath);
      response.writeHead(200, { 'Content-Type': mimeType(pathname), 'Cache-Control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });

  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  assert.ok(address && typeof address === 'object' && address.port, 'parity server did not expose a port');
  return {
    server,
    root,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose))
  };
}

async function withReferenceWorktree(referenceSha, callback) {
  const worktreePath = await mkdtemp(join(os.tmpdir(), 'rushd-p02-reference-'));
  let added = false;
  try {
    execFileSync('git', ['worktree', 'add', '--detach', worktreePath, referenceSha], {
      cwd: repoRoot,
      stdio: 'pipe'
    });
    added = true;
    return await callback(resolve(worktreePath));
  } finally {
    if (added) {
      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoRoot,
        stdio: 'ignore'
      });
    }
    await rm(worktreePath, { recursive: true, force: true });
  }
}

function addStableClock(context) {
  return context.addInitScript(({ fixedClock }) => {
    const NativeDate = globalThis.Date;
    const fixedNow = NativeDate.parse(fixedClock);
    class StableDate extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : [fixedNow]));
      }

      static now() {
        return fixedNow;
      }
    }
    globalThis.Date = StableDate;
  }, { fixedClock: FIXED_CLOCK_UTC });
}

function addParityProxyResolver(context) {
  return context.addInitScript(() => {
    globalThis.__rushdResolveParityProxy = (purpose) => {
      const debugBridge = globalThis.RushdDebug;
      if (debugBridge) {
        if (typeof debugBridge.getAppProxy !== 'function') {
          throw new Error(`P02 debug bridge has no getAppProxy() while ${purpose}.`);
        }
        const proxy = debugBridge.getAppProxy();
        if (!proxy) throw new Error(`P02 debug bridge returned no mounted proxy while ${purpose}.`);
        return proxy;
      }

      // The pinned pre-P02 reference cannot expose the P02 bridge. Keep its
      // legacy Vue-private lookup contained to this characterization helper.
      const legacyProxy = document.querySelector('#app')?.__vue_app__?._instance?.proxy;
      if (!legacyProxy) throw new Error(`Legacy reference mounted proxy is unavailable while ${purpose}.`);
      return legacyProxy;
    };
  });
}

function collectDiagnostics(page, rootUrl) {
  const diagnostics = { console: [], pageErrors: [], failedRequests: [], externalRequests: [] };
  const localOrigin = new URL(rootUrl).origin;
  page.on('console', (message) => diagnostics.console.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('request', (request) => {
    try {
      if (new URL(request.url()).origin !== localOrigin) diagnostics.externalRequests.push(request.url());
    } catch {
      diagnostics.externalRequests.push(request.url());
    }
  });
  page.on('requestfailed', (request) => diagnostics.failedRequests.push({
    url: request.url(),
    failure: request.failure()?.errorText || 'unknown'
  }));
  return diagnostics;
}

async function gotoApp(page, rootUrl) {
  await page.goto(rootUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.locator('#app').waitFor({ state: 'attached', timeout: 60_000 });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await page.addStyleTag({ content: captureStyle });
  await page.waitForTimeout(250);
}

async function seedFixture(page, rootUrl, fixture, language, theme, onboarding = false, motion = 'full') {
  await page.goto(`${rootUrl}/__parity_seed__.html`, { waitUntil: 'load', timeout: 60_000 });
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
        request.onblocked = () => rejectDelete(new Error('parity seed delete blocked'));
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

  await gotoApp(page, rootUrl);
  const fixtureDate = payload.indexed_db.stores.expenses[0]?.date;
  if (fixtureDate) {
    await page.evaluate(async (date) => {
      const proxy = globalThis.__rushdResolveParityProxy('loading the fixture date');
      if (typeof proxy.store?.loadDay !== 'function') {
        throw new Error('Mounted proxy has no Store.loadDay() for fixture loading.');
      }
      await proxy.store.loadDay(date);
    }, fixtureDate);
  }
  await page.waitForTimeout(100);
}

async function captureState(page, states, stateId) {
  // State changes can reveal a font face that was not present during the
  // initial load (for example, a modal title). Wait again before rasterizing.
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    if (document.fonts?.load) {
      await Promise.all([
        'IBM Plex Sans Arabic',
        'Noto Kufi Arabic',
        'Inter',
        'JetBrains Mono',
        'Outfit',
        'Sora',
        'Material Symbols Rounded'
      ].map((family) => document.fonts.load(`16px "${family}"`)));
    }
  });
  // Backdrop blur/shadow layers settle on a subsequent compositor frame even
  // when CSS transitions are disabled. A short stable window prevents a
  // first-frame raster from becoming a false visual difference.
  await page.waitForTimeout(400);
  let bytes = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = await page.screenshot({ fullPage: false, animations: 'disabled', scale: 'css' });
    if (bytes && bytes.equals(next)) {
      bytes = next;
      break;
    }
    bytes = next;
    if (attempt < 3) await page.waitForTimeout(100);
  }
  states.set(stateId, bytes);
}

async function navigate(page, index) {
  await page.locator('.app-shell-nav-btn').nth(index).click();
  await page.waitForTimeout(100);
}

async function captureScreens(page, states, state) {
  const screens = ['dashboard', 'statistics', 'vault', 'plans', 'settings'];
  for (let index = 0; index < screens.length; index += 1) {
    await navigate(page, index);
    await captureState(page, states, `${state}-${screens[index]}`);
  }
}

async function captureCharacterizedStates(page, rootUrl, fixture, language, theme) {
  const states = new Map();
  await seedFixture(page, rootUrl, fixture.empty, language, theme, true);
  await captureState(page, states, 'onboarding');
  await page.evaluate(() => {
    const proxy = globalThis.__rushdResolveParityProxy('showing the onboarding loading state');
    if (!proxy.onboardingModal) throw new Error('Mounted proxy has no onboardingModal loading state.');
    proxy.onboardingModal.isLoading = true;
  });
  await captureState(page, states, 'loading-onboarding');
  await page.evaluate(() => {
    const proxy = globalThis.__rushdResolveParityProxy('clearing the onboarding loading state');
    if (!proxy.onboardingModal) throw new Error('Mounted proxy has no onboardingModal loading state.');
    proxy.onboardingModal.isLoading = false;
  });
  const skipLabel = language === 'ar' ? 'تخطي الآن' : 'Skip for Now';
  await page.getByRole('button', { name: skipLabel, exact: true }).click();
  await captureScreens(page, states, 'empty');

  await navigate(page, 0);
  await page.locator('.fab').click();
  await captureState(page, states, 'add-modal');
  await page.getByRole('button', { name: 'close', exact: true }).click();
  await page.evaluate((message) => {
    const proxy = globalThis.__rushdResolveParityProxy('showing the error toast');
    proxy.toastMessage = message;
    proxy.toastVisible = true;
    clearTimeout(proxy._toastTimer);
  }, language === 'ar' ? 'فشل تجريبي — بيانات وهمية فقط' : 'Synthetic failure — fake data only');
  await page.locator('.toast-notification').waitFor({ state: 'visible', timeout: 10_000 });
  await captureState(page, states, 'error-toast');
  await page.evaluate(() => {
    globalThis.__rushdResolveParityProxy('hiding the error toast').toastVisible = false;
  });
  await page.keyboard.press('Tab');
  await captureState(page, states, 'keyboard-focus-dashboard');

  await seedFixture(page, rootUrl, fixture.populated, language, theme);
  await captureScreens(page, states, 'populated');
  await navigate(page, 0);
  await page.locator('.expense-card').first().click();
  await captureState(page, states, 'edit-modal');
  await page.getByRole('button', { name: 'close', exact: true }).click();
  await page.locator('.cinematic-stage header button').first().click();
  await captureState(page, states, 'profile-modal');
  await page.getByRole('button', { name: 'close', exact: true }).click();
  await navigate(page, 3);
  await page.locator('.plan-action-block').click();
  await captureState(page, states, 'apply-plan-modal');
  await page.getByRole('button', { name: 'close', exact: true }).click();
  await navigate(page, 4);
  await page.getByRole('button', { name: language === 'ar' ? /إعادة ضبط المصنع/ : /Factory Reset/ }).click();
  await captureState(page, states, 'confirm-reset-modal');
  return states;
}

function pixelDiff(referenceBytes, candidateBytes) {
  const reference = PNG.sync.read(referenceBytes);
  const candidate = PNG.sync.read(candidateBytes);
  assert.equal(candidate.width, reference.width, 'candidate screenshot width differs');
  assert.equal(candidate.height, reference.height, 'candidate screenshot height differs');
  const diff = new PNG({ width: reference.width, height: reference.height });
  let differingPixelCount = 0;
  let maxChannelDelta = 0;
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    const redDelta = Math.abs(reference.data[offset] - candidate.data[offset]);
    const greenDelta = Math.abs(reference.data[offset + 1] - candidate.data[offset + 1]);
    const blueDelta = Math.abs(reference.data[offset + 2] - candidate.data[offset + 2]);
    const alphaDelta = Math.abs(reference.data[offset + 3] - candidate.data[offset + 3]);
    const delta = Math.max(redDelta, greenDelta, blueDelta, alphaDelta);
    maxChannelDelta = Math.max(maxChannelDelta, delta);
    if (delta === 0) continue;
    differingPixelCount += 1;
    diff.data[offset] = 255;
    diff.data[offset + 1] = Math.min(255, delta * 4);
    diff.data[offset + 2] = 0;
    diff.data[offset + 3] = 255;
  }
  return {
    width: reference.width,
    height: reference.height,
    differingPixelCount,
    maxChannelDelta,
    diffBytes: differingPixelCount ? PNG.sync.write(diff) : null
  };
}

function unexpectedDiagnostics(diagnostics) {
  const consoleErrors = diagnostics.console.filter((entry) => ['error', 'warning', 'pageerror'].includes(entry.type));
  return {
    consoleErrors,
    pageErrors: diagnostics.pageErrors,
    failedRequests: diagnostics.failedRequests,
    externalRequests: diagnostics.externalRequests
  };
}

async function captureRoot(rootUrl, rootPath, cases, browser) {
  const fixture = {
    empty: JSON.parse(await readFile(join(repoRoot, 'tests/fixtures/v1/empty.json'), 'utf8')),
    populated: JSON.parse(await readFile(join(repoRoot, 'tests/fixtures/v1/populated.json'), 'utf8'))
  };
  const captures = [];
  for (const testCase of cases) {
    const context = await browser.newContext({
      viewport: testCase.viewport,
      deviceScaleFactor: 1,
      locale: testCase.language === 'ar' ? 'ar-SA' : 'en-US',
      timezoneId: TIMEZONE
    });
    await addStableClock(context);
    await addParityProxyResolver(context);
    const page = await context.newPage();
    const diagnostics = collectDiagnostics(page, rootUrl);
    try {
      const states = await captureCharacterizedStates(page, rootUrl, fixture, testCase.language, testCase.theme);
      const selectedStates = new Map([...states].filter(([stateId]) => testCase.states.includes(stateId)));
      captures.push({ testCase, states: selectedStates, diagnostics: unexpectedDiagnostics(diagnostics), rootPath });
    } finally {
      await context.close();
    }
  }
  return captures;
}

async function compareCaptured(leftCaptures, rightCaptures, outputRoot, labels) {
  assert.equal(leftCaptures.length, rightCaptures.length, 'profile case count differs');
  const matrix = [];
  let totalDifferingPixelCount = 0;
  let totalStates = 0;
  let diffCount = 0;
  const diagnostics = [];
  for (let caseIndex = 0; caseIndex < leftCaptures.length; caseIndex += 1) {
    const left = leftCaptures[caseIndex];
    const right = rightCaptures[caseIndex];
    assert.deepEqual(left.testCase, right.testCase, 'profile case ordering differs');
    const stateResults = [];
    for (const [stateId, leftBytes] of left.states) {
      assert.ok(right.states.has(stateId), `candidate is missing ${stateId}`);
      const rightBytes = right.states.get(stateId);
      const diff = pixelDiff(leftBytes, rightBytes);
      const record = {
        state: stateId,
        width: diff.width,
        height: diff.height,
        reference_sha256: sha256(leftBytes),
        candidate_sha256: sha256(rightBytes),
        differing_pixel_count: diff.differingPixelCount,
        max_channel_delta: diff.maxChannelDelta
      };
      if (diff.diffBytes) {
        diffCount += 1;
        const directory = resolve(outputRoot, labels.profile, `${left.testCase.language}-${left.testCase.theme}-${left.testCase.viewport.width}x${left.testCase.viewport.height}`);
        await mkdir(directory, { recursive: true });
        const diffPath = join(directory, `${stateId}.diff.png`);
        await writeFile(diffPath, diff.diffBytes);
        record.diff_path = diffPath;
      }
      totalStates += 1;
      totalDifferingPixelCount += diff.differingPixelCount;
      stateResults.push(record);
    }
    diagnostics.push({
      case: left.testCase,
      reference: left.diagnostics,
      candidate: right.diagnostics
    });
    matrix.push({ ...left.testCase, states: stateResults });
  }
  const result = {
    schema: COMPARATOR_SCHEMA,
    profile: labels.profile,
    captured_at_utc: FIXED_CLOCK_UTC,
    timezone: TIMEZONE,
    device_scale_factor: 1,
    reference: labels.reference,
    candidate: labels.candidate,
    browser: labels.browser,
    total_states: totalStates,
    total_differing_pixel_count: totalDifferingPixelCount,
    differing_state_count: diffCount,
    diagnostics,
    matrix,
    // The historical reference intentionally retains its pre-P02 CDN requests
    // and Play CDN warning.  The candidate is the delivery under test, so its
    // diagnostics must be clean and local while the reference is retained only
    // as a visual/behavioral comparator.
    passed: totalDifferingPixelCount === 0 && diagnostics.every((entry) =>
      entry.candidate.consoleErrors.length === 0 && entry.candidate.pageErrors.length === 0 &&
      entry.candidate.failedRequests.length === 0 && entry.candidate.externalRequests.length === 0)
  };
  await mkdir(resolve(outputRoot, labels.profile), { recursive: true });
  await writeFile(resolve(outputRoot, labels.profile, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function compareRoots(leftRoot, rightRoot, cases, browser, outputRoot, labels) {
  const [leftServer, rightServer] = await Promise.all([startStaticServer(leftRoot), startStaticServer(rightRoot)]);
  try {
    // Capture roots sequentially. This avoids two independent font loads
    // racing each other and makes the comparison reproducible on a cold cache.
    const leftCaptures = await captureRoot(leftServer.url, leftRoot, cases, browser);
    const rightCaptures = await captureRoot(rightServer.url, rightRoot, cases, browser);
    return await compareCaptured(leftCaptures, rightCaptures, outputRoot, {
      ...labels,
      browser: { ...labels.browser, left_root: leftRoot, right_root: rightRoot }
    });
  } finally {
    await Promise.all([leftServer.close(), rightServer.close()]);
  }
}

async function runParity(options) {
  const candidateRoot = resolve(repoRoot, options.candidate);
  const cases = options.profile === 'full'
    ? fullViewports.flatMap((viewport) => ['ar', 'en'].flatMap((language) => ['dark', 'light'].map((theme) => ({ language, theme, viewport, states: fullStates }))))
    : quickCases;
  const outputRoot = resolve(repoRoot, options.output);
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  const browserVersion = browser.version();
  assert.equal(browserVersion, EXPECTED_CHROMIUM, `expected pinned Chromium ${EXPECTED_CHROMIUM}, got ${browserVersion}`);
  const browserInfo = { engine: 'Playwright Chromium', playwright: require('playwright/package.json').version, chromium: browserVersion };
  try {
    return await withReferenceWorktree(options.reference, async (referenceRoot) => compareRoots(
      referenceRoot,
      candidateRoot,
      cases,
      browser,
      outputRoot,
      {
        profile: options.profile,
        reference: options.reference,
        candidate: candidateRoot,
        browser: browserInfo
      }
    ));
  } finally {
    await browser.close();
  }
}

async function runSelfTest(options) {
  const candidateRoot = resolve(repoRoot, options.candidate);
  const cases = quickCases;
  const outputRoot = resolve(repoRoot, options.output);
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  const browserVersion = browser.version();
  assert.equal(browserVersion, EXPECTED_CHROMIUM, `expected pinned Chromium ${EXPECTED_CHROMIUM}, got ${browserVersion}`);
  const browserInfo = { engine: 'Playwright Chromium', playwright: require('playwright/package.json').version, chromium: browserVersion };
  let mutationRoot;
  try {
    const deterministic = await compareRoots(candidateRoot, candidateRoot, cases, browser, outputRoot, {
      profile: 'self-compare',
      reference: candidateRoot,
      candidate: candidateRoot,
      browser: browserInfo
    });
    if (!deterministic.passed) throw new Error(`same-root parity was not deterministic (${deterministic.total_differing_pixel_count} differing pixels)`);

    mutationRoot = await mkdtemp(join(os.tmpdir(), 'rushd-p02-mutation-'));
    await cp(candidateRoot, mutationRoot, { recursive: true });
    const indexPath = join(mutationRoot, 'index.html');
    const index = await readFile(indexPath, 'utf8');
    const mutated = index.replace('</head>', '<style data-parity-mutation>body { filter: saturate(0) !important; }</style>\n</head>');
    assert.notEqual(mutated, index, 'mutation marker could not be inserted');
    await writeFile(indexPath, mutated);
    const mutationResult = await compareRoots(candidateRoot, mutationRoot, cases, browser, outputRoot, {
      profile: 'self-mutation',
      reference: candidateRoot,
      candidate: mutationRoot,
      browser: browserInfo
    });
    if (mutationResult.total_differing_pixel_count <= 0) {
      throw new Error('deliberate visual mutation was not detected');
    }
    const summary = {
      schema: 'rushd.visual-parity-self-test.v1',
      captured_at_utc: FIXED_CLOCK_UTC,
      timezone: TIMEZONE,
      browser: browserInfo,
      deterministic: {
        profile: deterministic.profile,
        total_states: deterministic.total_states,
        total_differing_pixel_count: deterministic.total_differing_pixel_count,
        result_path: resolve(outputRoot, 'self-compare', 'result.json')
      },
      mutation: {
        profile: mutationResult.profile,
        total_states: mutationResult.total_states,
        total_differing_pixel_count: mutationResult.total_differing_pixel_count,
        result_path: resolve(outputRoot, 'self-mutation', 'result.json')
      },
      passed: deterministic.passed && mutationResult.total_differing_pixel_count > 0
    };
    await mkdir(resolve(outputRoot, 'self-test'), { recursive: true });
    await writeFile(resolve(outputRoot, 'self-test', 'result.json'), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`Rushd parity self-test passed: deterministic comparison is zero-diff; mutation detected ${mutationResult.total_differing_pixel_count} differing pixels.`);
    return { deterministic, mutation: mutationResult, summary };
  } finally {
    await browser.close();
    if (mutationRoot) await rm(mutationRoot, { recursive: true, force: true });
  }
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    await runSelfTest(options);
    return;
  }
  const result = await runParity(options);
  if (!result.passed) {
    console.error(`Rushd ${options.profile} visual parity failed: ${result.total_differing_pixel_count} differing pixels across ${result.differing_state_count} states.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Rushd ${options.profile} visual parity passed: ${result.total_states} states, zero unexplained pixels.`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
