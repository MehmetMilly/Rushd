/* Rushd P04-D retirement worker.
 *
 * One-shot cleanup of the rejected shell controller and `rushd-shell-*`
 * Cache Storage entries. This is not a PWA: there is no fetch handler,
 * no precache, and no persistent registration.
 *
 * Safety: never reads or writes IndexedDB, OPFS, localStorage,
 * sessionStorage, cookies, exports, or unrelated caches.
 */

const SHELL_CACHE_PREFIX = 'rushd-shell-';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(retireRejectedShell());
});

async function retireRejectedShell() {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => typeof name === 'string' && name.startsWith(SHELL_CACHE_PREFIX))
      .map((name) => caches.delete(name)),
  );
  await self.clients.claim();
  await self.registration.unregister();
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  await Promise.all(windows.map((client) => reloadClientOnce(client)));
}

function reloadClientOnce(client) {
  if (typeof client.navigate === 'function') {
    return client.navigate(client.url).catch(() => {
      client.postMessage({ type: 'rushd-shell-retired' });
    });
  }
  client.postMessage({ type: 'rushd-shell-retired' });
  return undefined;
}
