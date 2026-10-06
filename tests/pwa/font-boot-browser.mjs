import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

/* global URL:readonly, getComputedStyle:readonly, setTimeout:readonly, document:readonly, localStorage:readonly, console:readonly */

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const filePath = join('dist', pathname === '/' ? 'index.html' : pathname.slice(1));
    const body = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const fallbackFailures = [];

async function recordCheck(scenario, description, check) {
  try {
    await check();
  } catch (error) {
    fallbackFailures.push(`${scenario}: ${description}: ${error.message}`);
  }
}

async function checkUnavailableFontControls(page, scenario, labels) {
  const addButton = page.locator('.fab');
  const settingsButton = page.locator('.cinematic-stage header button').nth(1);

  for (const [name, button, label] of [
    ['Add', addButton, labels.add],
    ['Settings', settingsButton, labels.settings],
  ]) {
    await recordCheck(scenario, `${name} control is visible`, async () => {
      await button.waitFor({ state: 'visible', timeout: 5000 });
      assert.equal(await button.isVisible(), true);
    });
    await recordCheck(scenario, `${name} control has an accessible name`, async () => {
      assert.equal(await button.getAttribute('aria-label'), label);
    });
    await recordCheck(scenario, `${name} control shows its fallback label`, async () => {
      const fallbackLabel = button.locator('.icon-font-fallback-label');
      assert.equal(await fallbackLabel.count(), 1);
      assert.equal(await fallbackLabel.isVisible(), true);
      assert.equal((await fallbackLabel.innerText()).trim(), label);
    });
  }

  await recordCheck(scenario, 'Settings opens from the header', async () => {
    await settingsButton.click();
    const heading = page.locator('.app-shell-header .modal-title-premium');
    await heading.waitFor({ state: 'visible' });
    assert.equal((await heading.innerText()).trim(), labels.settings);
  });

  const backButton = page.locator('.app-shell-header .settings-back-btn');
  await recordCheck(scenario, 'Back control has an accessible name and visible fallback', async () => {
    assert.equal(await backButton.getAttribute('aria-label'), labels.home);
    const fallbackLabel = backButton.locator('.icon-font-fallback-label');
    assert.equal(await fallbackLabel.count(), 1);
    assert.equal(await fallbackLabel.isVisible(), true);
    assert.equal((await fallbackLabel.innerText()).trim(), labels.home);
  });
  await recordCheck(scenario, 'Back returns to Home', async () => {
    await backButton.click();
    await page.locator('.cinematic-stage').waitFor({ state: 'visible' });
  });

  await recordCheck(scenario, 'Add opens the expense form', async () => {
    await addButton.click();
    const title = page.locator('.modal-floating-card .modal-header h3');
    await title.waitFor({ state: 'visible' });
    assert.equal((await title.innerText()).trim(), labels.add);
  });

  await recordCheck(scenario, 'Add form close control has a visible icon fallback and works', async () => {
    const closeButton = page.locator('.modal-floating-card .modal-close-btn');
    await closeButton.waitFor({ state: 'visible' });
    assert.equal(await closeButton.getAttribute('aria-label'), labels.cancel);
    assert.equal(await closeButton.evaluate((button) => getComputedStyle(button, '::after').content), '"×"');
    const namedCloseButton = page.getByRole('button', { name: labels.cancel, exact: true });
    assert.equal(await namedCloseButton.count(), 1);
    await namedCloseButton.click();
    await page.locator('.modal-floating-card .modal-header h3').waitFor({ state: 'hidden' });
  });

  await recordCheck(scenario, 'raw icon ligatures stay hidden', async () => {
    const visibleIconText = await page.locator('.material-symbols-rounded').evaluateAll((icons) => icons
      .filter((icon) => {
        const style = getComputedStyle(icon);
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && style.color !== 'rgba(0, 0, 0, 0)'
          && Number.parseFloat(style.fontSize) > 0;
      })
      .map((icon) => icon.textContent.trim())
      .filter(Boolean));
    assert.deepEqual(visibleIconText, []);
  });
}

try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const pageErrors = [];
  let delayedFontRequests = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/fonts/sykg-*.woff2', async (route) => {
    delayedFontRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 6000));
    await route.continue();
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app .material-symbols-rounded', { state: 'attached', timeout: 60000 });
  await page.waitForTimeout(500);
  assert.equal(delayedFontRequests, 1, 'the icon font request must actually be delayed');
  assert.equal(await page.locator('#rushd-boot-screen').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(9, 9, 11)');
  assert.equal(await page.locator('#rushd-boot-screen').isVisible(), true, 'boot screen must cover the delayed font');
  assert.equal(await page.locator('#app').isVisible(), false, 'app must not expose raw ligature words');
  await page.waitForFunction(() => document.documentElement.dataset.iconsReady === 'true', null, { timeout: 30000 });
  await page.waitForFunction(() => document.documentElement.dataset.bootVisualReady === 'true', null, { timeout: 30000 });
  assert.equal(await page.locator('#app').isVisible(), true, 'app must become visible after the icon font loads');
  assert.equal(await page.locator('#rushd-boot-screen').isVisible(), false, 'boot screen must leave after readiness');
  assert.equal(await page.locator('.icon-font-fallback-label').first().isVisible(), false, 'normal icon readiness must keep fallback copy hidden');
  assert.equal(await page.locator('.fab .material-symbols-rounded').isVisible(), true, 'normal icon readiness must preserve the Add icon');
  assert.deepEqual(pageErrors, []);
  await context.close();

  const failedContext = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  const failedPage = await failedContext.newPage();
  await failedPage.addInitScript(() => {
    localStorage.setItem('rushd_theme', 'light');
    localStorage.setItem('rushd_lang', 'en');
  });
  await failedPage.route('**/fonts/sykg-*.woff2', (route) => route.abort());
  await failedPage.goto(origin, { waitUntil: 'domcontentloaded' });
  await failedPage.waitForFunction(() => document.documentElement.dataset.bootVisualReady === 'true', null, { timeout: 15000 });
  assert.equal(await failedPage.locator('#app').isVisible(), true, 'font failure must not block the app indefinitely');
  assert.equal(await failedPage.locator('.material-symbols-rounded').first().isVisible(), false, 'failed icons must not expose ligature words');
  assert.equal(await failedPage.locator('#rushd-boot-screen').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(244, 247, 251)');
  assert.equal(await failedPage.locator('.rushd-boot-indicator').evaluate((element) => getComputedStyle(element).animationName), 'none');
  assert.equal(await failedPage.evaluate(() => document.documentElement.dir), 'ltr');
  await checkUnavailableFontControls(failedPage, 'failed font', {
    add: 'New Expense',
    settings: 'Settings',
    home: 'Home',
    cancel: 'Cancel',
  });
  await failedContext.close();

  const timeoutContext = await browser.newContext({ serviceWorkers: 'block' });
  const timeoutPage = await timeoutContext.newPage();
  let timeoutFontRequests = 0;
  await timeoutPage.route('**/fonts/sykg-*.woff2', async () => {
    timeoutFontRequests += 1;
    await new Promise(() => undefined);
  });
  await timeoutPage.goto(origin, { waitUntil: 'domcontentloaded' });
  await timeoutPage.waitForSelector('#app .material-symbols-rounded', { state: 'attached', timeout: 60000 });
  await timeoutPage.waitForFunction(() => document.documentElement.dataset.bootVisualReady === 'true', null, { timeout: 15000 });
  assert.equal(timeoutFontRequests, 1, 'the timeout scenario must keep the icon-font response pending');
  assert.equal(await timeoutPage.evaluate(() => document.documentElement.dataset.iconsReady || null), null);
  assert.equal(await timeoutPage.locator('#app').isVisible(), true, 'font timeout must not block the app indefinitely');
  assert.equal(await timeoutPage.locator('#rushd-boot-screen').isVisible(), false, 'the bounded timeout must dismiss the boot screen');
  assert.equal(await timeoutPage.evaluate(() => document.documentElement.dir), 'rtl');
  await checkUnavailableFontControls(timeoutPage, 'font timeout', {
    add: 'مصروف جديد',
    settings: 'الإعدادات',
    home: 'الرئيسية',
    cancel: 'إلغاء',
  });
  await timeoutContext.close();

  assert.deepEqual(fallbackFailures, [], `unavailable-font controls regressed:\n${fallbackFailures.join('\n')}`);
  console.log('P04-D5 font boot browser gate passed.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
