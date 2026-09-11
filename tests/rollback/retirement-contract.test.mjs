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

console.log('Rushd P04-D retirement source contract passed.');
