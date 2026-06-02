const assert = require('node:assert/strict');
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, join } = require('node:path');
const { chromium } = require('playwright');

const root = process.cwd();
const port = Number(process.env.RUSHD_SMOKE_PORT || 4173);
const baseUrl = `http://127.0.0.1:${port}`;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
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

  page.on('console', (message) => messages.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', (error) => messages.push({ type: 'pageerror', text: error.message }));

  const expenseName = 'قهوة اختبار';

  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1_500);
  assert.equal(await page.title(), 'رُشد | Rushd');

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
  await modal.locator('input[type="text"]:visible').fill(expenseName);
  await modal.locator('input[type="number"]:visible').first().fill('42');
  await modal.getByText('إضافة إلى اليوم', { exact: false }).click();
  await page.waitForTimeout(1_000);

  assert.ok((await page.locator('body').innerText()).includes(expenseName), 'expense should appear after adding it');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1_500);
  assert.ok((await page.locator('body').innerText()).includes(expenseName), 'expense should persist after refresh');

  const relevantMessages = messages.filter((message) => {
    if (message.type === 'warning' && message.text.includes('cdn.tailwindcss.com')) return false;
    return ['error', 'warning', 'pageerror'].includes(message.type);
  });
  assert.deepEqual(relevantMessages, []);

  await page.screenshot({ path: 'docs/assets/screenshots/dashboard-with-expense.png', fullPage: false });

  await browser.close();
  await close();

  console.log('Rushd browser smoke test passed.');
})().catch(async (error) => {
  await close().catch(() => {});
  console.error(error);
  process.exit(1);
});
