const assert = require('node:assert/strict');
const http = require('node:http');
const { mkdir, readFile } = require('node:fs/promises');
const { extname, join, resolve } = require('node:path');
const { chromium } = require('playwright');

// The smoke test is intentionally pointed at the Vite output by npm scripts. A
// caller may still provide a different static root for focused diagnostics.
const root = resolve(process.env.RUSHD_SMOKE_ROOT || process.cwd());
const port = Number(process.env.RUSHD_SMOKE_PORT || 4173);
const baseUrl = `http://127.0.0.1:${port}`;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', baseUrl);
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = join(root, pathname.replace(/^\/+/, ''));
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream'
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

async function listen() {
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
}

async function close() {
  await new Promise((resolve) => server.close(resolve));
}

(async () => {
  await listen();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const messages = [];
  const requests = [];
  const externalRequests = new Set();
  const badResponses = [];
  const localOrigin = new URL(baseUrl).origin;

  page.on('console', (message) => messages.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', (error) => messages.push({ type: 'pageerror', text: error.message }));
  page.on('request', (request) => {
    const url = request.url();
    requests.push(url);
    try {
      if (new URL(url).origin !== localOrigin) externalRequests.add(url);
    } catch {
      externalRequests.add(url);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });

  // Block external origins as soon as they are attempted. This makes an
  // accidental runtime dependency fail deterministically and leaves the exact
  // offending URL in the assertion below.
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    let isLocal = false;
    try {
      isLocal = new URL(url).origin === localOrigin;
    } catch {
      // Non-HTTP URLs are not valid runtime assets for this app.
    }
    if (!isLocal) {
      externalRequests.add(url);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  const expenseName = 'قهوة اختبار';

  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1_500);
  assert.equal(await page.title(), 'رُشد | Rushd');

  // P02's explicit bridge replaces reliance on Vue's production-private
  // instance shape. Parity uses it for the characterized loading state; this
  // focused build check proves the bridge reaches the mounted proxy and that
  // its existing toast state still renders through the real template.
  const bridgeProbe = await page.evaluate(() => {
    if (typeof window.RushdDebug?.getAppProxy !== 'function') {
      throw new Error('RushdDebug.getAppProxy() is unavailable in the production build.');
    }
    const proxy = window.RushdDebug.getAppProxy();
    if (!proxy?.onboardingModal) throw new Error('RushdDebug returned no mounted application proxy.');
    proxy.toastMessage = 'P02 debug bridge toast probe';
    proxy.toastVisible = true;
    clearTimeout(proxy._toastTimer);
    return { hasOnboardingLoadingState: typeof proxy.onboardingModal.isLoading === 'boolean' };
  });
  assert.deepEqual(bridgeProbe, { hasOnboardingLoadingState: true });
  await page.getByText('P02 debug bridge toast probe', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.evaluate(() => { window.RushdDebug.getAppProxy().toastVisible = false; });

  if (process.env.RUSHD_SMOKE_INJECT_EXTERNAL === '1') {
    // A deterministic negative probe for the local-only gate. The route above
    // aborts this request; the final assertion reports its exact URL.
    await page.evaluate(async () => {
      try {
        await fetch('https://example.com/rushd-smoke-external-probe');
      } catch {
        // The rejection is expected; the request remains recorded by the gate.
      }
    });
  }

  const skipOnboarding = page.getByText('تخطي الآن', { exact: true });
  if (await skipOnboarding.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await skipOnboarding.click();
    await page.waitForTimeout(800);
  }

  const addButton = page.locator('.fab:visible');
  assert.equal(await addButton.count(), 1, 'expected one visible add-expense button');
  await addButton.click();

  const modal = page.locator('.modal-floating-card:visible');
  await modal.waitFor({ state: 'visible', timeoutMs: 10_000 });
  await modal.locator('input[placeholder="تكسي، غداء..."]:visible').fill(expenseName);
  await modal.locator('input[inputmode="decimal"]:visible').first().fill('٤٢');
  await modal.getByText('إضافة إلى اليوم', { exact: false }).click();
  await page.waitForTimeout(1_000);

  assert.ok((await page.locator('body').innerText()).includes(expenseName), 'expense should appear after adding it');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1_500);
  assert.ok((await page.locator('body').innerText()).includes(expenseName), 'expense should persist after refresh');

  assert.deepEqual([...externalRequests], [], `built app attempted external runtime request(s): ${[...externalRequests].join(', ')}`);
  assert.deepEqual(badResponses, [], `built app returned failed local asset request(s): ${badResponses.join(', ')}`);
  const relevantMessages = messages.filter((message) => {
    return ['error', 'warning', 'pageerror'].includes(message.type);
  });
  assert.deepEqual(relevantMessages, []);

  await mkdir('test-results/browser-smoke', { recursive: true });
  await page.screenshot({ path: 'test-results/browser-smoke/dashboard-with-expense.png', fullPage: false });

  await browser.close();
  await close();

  console.log('Rushd browser smoke test passed.');
})().catch(async (error) => {
  await close().catch(() => {});
  console.error(error);
  process.exit(1);
});
