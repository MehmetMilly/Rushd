/* global self:readonly, caches:readonly, fetch:readonly, URL:readonly */
/* Rushd P04-D2 candidate-only offline service worker.
 *
 * Candidate/test use only. Default production never registers this file:
 * `index.html` loads only `/retire-rejected-shell.js`, and `src/main.ts`
 * mounts the legacy application without PWA registration.
 *
 * Behavior:
 * - Same-origin GET requests are served cache-first from the versioned
 *   `rushd-pwa-*` cache and populated on miss while online, so an
 *   installed candidate shell reloads offline with zero remote requests.
 * - Cross-origin or non-GET requests are passed through without caching.
 *   This worker never adds a remote request of its own.
 * - Finance data is never cached: IndexedDB, OPFS, and storage APIs are
 *   untouched here; only HTTP responses for same-origin app assets enter
 *   the cache.
 * - Activation keeps the rollback retirement: previously rejected
 *   `rushd-shell-*` caches and older `rushd-pwa-v*` caches are deleted.
 * - A new version never force-activates: `skipWaiting` runs only after an
 *   explicit `rushd-pwa-skip-waiting` message, which the page sends only
 *   while no tab holds a write/import/reset/migration critical section.
 *
 * No installation, store, or platform readiness is claimed beyond what the
 * PWA gate (`npm run test:pwa`) proves.
 */

const PWA_CACHE_VERSION = 'rushd-pwa-v1';
const SHELL_CACHE_PREFIX = 'rushd-shell-';
const SKIP_WAITING_MESSAGE = 'rushd-pwa-skip-waiting';

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === SKIP_WAITING_MESSAGE) {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener('install', (event) => {
  // No forced takeover: activation waits for the explicit page-side message.
  event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => {
      if (typeof name !== 'string') return undefined;
      if (name.startsWith(SHELL_CACHE_PREFIX)) return caches.delete(name);
      if (name.startsWith('rushd-pwa-') && name !== PWA_CACHE_VERSION) return caches.delete(name);
      return undefined;
    }));
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(windows.map((client) => {
      try {
        client.postMessage({ type: 'rushd-pwa-updated', version: PWA_CACHE_VERSION });
      } catch {
        /* a dead client must not fail activation */
      }
      return undefined;
    }));
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!request || request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  // Candidate offline scope is same-origin app assets only. Anything else
  // passes through without entering the cache.
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(PWA_CACHE_VERSION);
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    const response = await fetch(request);
    // Only cache successful basic responses; never finance or opaque data.
    if (response && response.ok && response.type === 'basic') {
      try {
        await cache.put(request, response.clone());
      } catch {
        /* quota or private mode: serve the live response anyway */
      }
    }
    return response;
  })());
});
