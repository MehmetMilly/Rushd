/* global self:readonly, caches:readonly, fetch:readonly, URL:readonly, Response:readonly */
/* Rushd P04-D5 candidate-only offline service worker.
 *
 * Candidate/test use only. Default production never registers this file
 * except through the reviewed canonical boot (`src/main.ts` passes no
 * worker inputs itself; `production-boot.js` owns registration).
 *
 * Behavior:
 * - Same-origin GET requests are served cache-first from the versioned
 *   `rushd-pwa-*` cache and populated on miss while online, so an
 *   installed candidate shell reloads offline with zero remote requests.
 * - D5: the stable offline-critical closure (shell document, SQLite
 *   worker, and the full wa-sqlite engine files) is precached at install
 *   time, so the FIRST offline reload after install hydrates canonical
 *   data even when the first online visit raced worker installation and
 *   never runtime-cached those subresources. Worker and engine assets are
 *   required install assets (a miss fails installation); fonts and the
 *   manifest stay best-effort. Hashed asset bundles
 *   are still runtime-cached on miss while online, and the page warms them
 *   after boot (see `warmPwaCache` in `src/pwa/registration.js`).
 * - D5 round-2: a cached full body satisfies a same-origin Range request
 *   with a valid 206 slice (engine fetches often use Range). Partials are
 *   never stored and finance data never enters the cache.
 * - D5: navigations fall back to the cached shell document when offline,
 *   and no fetch path ever rejects into `respondWith`: an offline miss
 *   answers with the cached shell (navigations) or a `503` (subresources),
 *   never a failed navigation. The app then mounts its truthful
 *   write-blocked state instead of a blank tab.
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

const PWA_CACHE_VERSION = 'rushd-pwa-v2';
const SHELL_CACHE_PREFIX = 'rushd-shell-';
const SKIP_WAITING_MESSAGE = 'rushd-pwa-skip-waiting';

// Stable offline-critical closure. Same-origin root-relative URLs only;
// hashed asset bundles are runtime-cached while online instead.
//
// REQUIRED assets (SQLite worker + engine closure + shell document) must
// install or the worker does not activate: claiming offline readiness
// without them is what stranded hydration. BEST_EFFORT assets (manifest,
// fonts, retirement trigger) improve the offline shell but must never
// fail installation.
const REQUIRED_URLS = [
  '/',
  '/index.html',
  '/sqlite-worker.js',
  '/pkg/dist/wa-sqlite.mjs',
  '/pkg/dist/wa-sqlite.wasm',
  '/pkg/src/sqlite-api.js',
  '/pkg/src/sqlite-constants.js',
  '/pkg/src/FacadeVFS.js',
  '/pkg/src/VFS.js',
  '/pkg/src/examples/OPFSCoopSyncVFS.js',
];
const BEST_EFFORT_URLS = [
  '/manifest.webmanifest',
  '/fonts/google-fonts.css',
  '/fonts/material-symbols-rounded.css',
  '/retire-rejected-shell.js',
];

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === SKIP_WAITING_MESSAGE) {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener('install', (event) => {
  // No forced takeover: activation waits for the explicit page-side message.
  // Required assets install atomically: a missing worker or engine file
  // fails installation (the previous worker keeps serving) instead of
  // activating an offline shell that cannot hydrate. Best-effort assets
  // are cached per URL so one evicted font cannot fail the closure;
  // runtime caching still covers the rest online.
  event.waitUntil((async () => {
    const cache = await caches.open(PWA_CACHE_VERSION);
    await cache.addAll(REQUIRED_URLS);
    await Promise.all(BEST_EFFORT_URLS.map(async (url) => {
      try {
        await cache.add(url);
      } catch {
        /* a single miss must not fail installation */
      }
    }));
  })());
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

function isNavigationRequest(request) {
  try {
    if (request.mode === 'navigate') return true;
    const accept = request.headers.get('accept') || '';
    if (accept.indexOf('text/html') !== -1 && request.method === 'GET') {
      const url = new URL(request.url);
      return url.origin === self.location.origin;
    }
  } catch {
    /* fall through to false */
  }
  return false;
}

function hasRangeHeader(request) {
  try {
    return request.headers.has('range');
  } catch {
    return false;
  }
}

/**
 * Serve a same-origin Range request from a full cached body. WASM and
 * engine fetches often use Range; matching the full cached response and
 * slicing a valid 206 keeps offline hydration working where a full-body
 * match alone would not. Returns null when the range is absent,
 * malformed, or unsatisfiable (callers fall through to network, then to
 * the offline fallbacks). Never stores partials; never finance data.
 */
async function satisfyRangeFromCache(cached, request) {
  let rangeHeader = null;
  try {
    rangeHeader = request.headers.get('range');
  } catch {
    return null;
  }
  if (typeof rangeHeader !== 'string' || !rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;
  let body = null;
  try {
    body = await cached.clone().arrayBuffer();
  } catch {
    return null;
  }
  if (!body) return null;
  const total = body.byteLength;
  if (total <= 0) return null;
  let start = match[1] === '' ? NaN : Number(match[1]);
  let end = match[2] === '' ? NaN : Number(match[2]);
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (Number.isNaN(start)) {
    if (!Number.isSafeInteger(end) || end <= 0) return null;
    start = Math.max(0, total - end);
    end = total - 1;
  } else {
    if (!Number.isSafeInteger(start) || start < 0 || start >= total) return null;
    end = Number.isNaN(end) ? total - 1 : Math.min(end, total - 1);
    if (!Number.isSafeInteger(end) || end < start) return null;
  }
  const headers = new Headers(cached.headers);
  headers.set('content-range', `bytes ${start}-${end}/${total}`);
  headers.set('content-length', String(end - start + 1));
  headers.set('accept-ranges', 'bytes');
  return new Response(body.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers,
  });
}

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
  const navigation = isNavigationRequest(request);
  const ranged = hasRangeHeader(request);
  event.respondWith((async () => {
    const cache = await caches.open(PWA_CACHE_VERSION);
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached && !ranged) return cached;
    if (cached && ranged) {
      try {
        const partial = await satisfyRangeFromCache(cached, request);
        if (partial) return partial;
      } catch {
        /* unsatisfiable from cache: fall through to network below */
      }
    }
    try {
      const response = await fetch(request);
      // Only cache successful basic responses; never finance or opaque
      // data. Range requests are served but never stored: storing a
      // partial response under the full URL would poison offline reads.
      let hasRange = false;
      try {
        hasRange = request.headers.has('range');
      } catch {
        hasRange = false;
      }
      if (response && response.ok && response.type === 'basic' && !hasRange) {
        try {
          await cache.put(request, response.clone());
        } catch {
          /* quota or private mode: serve the live response anyway */
        }
      }
      return response;
    } catch {
      // Offline with a cache miss: navigations fall back to the cached
      // shell document so the app mounts its truthful local state;
      // a cached body still satisfies a Range request offline;
      // subresources answer 503 instead of rejecting the load.
      if (navigation) {
        const shell = (await cache.match('/index.html', { ignoreSearch: true }))
          || (await cache.match('/', { ignoreSearch: true }));
        if (shell) return shell;
      } else if (cached) {
        if (ranged) {
          try {
            const partial = await satisfyRangeFromCache(cached, request);
            if (partial) return partial;
          } catch {
            /* fall through to the full body below */
          }
        }
        return cached;
      }
      return new Response('', { status: 503, statusText: 'offline' });
    }
  })());
});
