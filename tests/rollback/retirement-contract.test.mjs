import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const sw = await readFile(join(root, 'public/sw.js'), 'utf8');
const trigger = await readFile(join(root, 'public/retire-rejected-shell.js'), 'utf8');
const html = await readFile(join(root, 'index.html'), 'utf8');
const main = await readFile(join(root, 'src/main.ts'), 'utf8');

assert.match(html, /<script src="\/retire-rejected-shell\.js"><\/script>/);
assert.match(html, /<script type="module" src="\/src\/main\.ts"><\/script>/);
assert.match(main, /createLegacyApplication/);
assert.doesNotMatch(main, /createGuestApplication/);
assert.doesNotMatch(main, /p04d-guest-shell/);

const swCode = sw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
assert.match(sw, /skipWaiting/);
assert.match(sw, /registration\.unregister/);
assert.match(sw, /clients\.claim/);
assert.match(sw, /SHELL_CACHE_PREFIX = 'rushd-shell-'/);
assert.match(sw, /name\.startsWith\(SHELL_CACHE_PREFIX\)/);
assert.match(sw, /client\.navigate/);
assert.doesNotMatch(swCode, /addEventListener\(\s*['"]fetch['"]/);
assert.doesNotMatch(swCode, /indexedDB/);
assert.doesNotMatch(swCode, /localStorage/);
assert.doesNotMatch(swCode, /sessionStorage/);
assert.doesNotMatch(swCode, /cookie/i);
assert.doesNotMatch(swCode, /getDirectory/);
assert.doesNotMatch(swCode, /caches\.open/);
assert.doesNotMatch(swCode, /createGuestApplication/);

assert.match(trigger, /rushd-hello/);
assert.match(trigger, /rushd-shell-version/);
assert.match(trigger, /SHELL_CACHE_PREFIX = 'rushd-shell-'/);
assert.match(trigger, /updateViaCache: 'none'/);
assert.match(trigger, /shouldRetireRejectedShell/);
assert.match(trigger, /serviceWorker\.register\('\/sw\.js'/);
assert.ok(
  trigger.indexOf('shouldRetireRejectedShell') < trigger.indexOf("serviceWorker.register('/sw.js'"),
  'page trigger must register /sw.js only after retirement detection',
);

const vercel = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
assert.deepEqual(Object.keys(vercel), ['headers'], 'vercel.json must contain only headers for this retirement release.');
assert.equal(vercel.rewrites, undefined, 'vercel.json must not rewrite /sw.js or any other path.');
assert.equal(vercel.redirects, undefined, 'vercel.json must not add redirects.');
assert.equal(vercel.routes, undefined, 'vercel.json must not add low-level routes.');
assert.equal(vercel.cleanUrls, undefined);
assert.equal(vercel.trailingSlash, undefined);
assert.doesNotMatch(JSON.stringify(vercel), /"destination"/);
assert.equal(vercel.headers.length, 4);

function headersFor(source) {
  const rule = vercel.headers.find((entry) => entry.source === source);
  assert.ok(rule, `missing Vercel header rule for ${source}`);
  assert.deepEqual(Object.keys(rule).sort(), ['headers', 'source']);
  return Object.fromEntries(rule.headers.map((header) => [header.key, header.value]));
}

assert.deepEqual(headersFor('/sw.js'), {
  'Content-Type': 'text/javascript; charset=utf-8',
  'Cache-Control': 'no-store',
  'Service-Worker-Allowed': '/',
});
assert.deepEqual(headersFor('/retire-rejected-shell.js'), {
  'Content-Type': 'text/javascript; charset=utf-8',
  'Cache-Control': 'no-store',
});
assert.deepEqual(headersFor('/'), { 'Cache-Control': 'no-store' });
assert.deepEqual(headersFor('/index.html'), { 'Cache-Control': 'no-store' });

console.log('Rushd P04-D retirement source contract passed.');
