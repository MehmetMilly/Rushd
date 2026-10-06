// P04-D2/D4: candidate-only PWA registration and update coordination.
//
// Since the D4 cutover this module IS called by ordinary production, but
// only through `production-boot.js` on the canonical path (`src/main.ts`
// passes no worker inputs itself). Test/build callers register explicitly,
// and only the registered caller drives updates through the same cross-tab
// critical-section protocol as writes, import, reset, and migration:
//
// - registration happens once with `updateViaCache: 'none'`;
// - a waiting update activates (via `rushd-pwa-skip-waiting`) only while
//   `coordination.canActivateUpdate()` is true, so an update can never take
//   over across another tab's write/import/reset/migration section;
// - after activation the coordination epoch is bumped, which hard-blocks
//   old binaries from further writes until they reload.
//
// D3 correction: exactly one bump site. `activateCandidateUpdate` requests
// activation and then bumps the epoch; nothing else bumps on the update
// path, so one activation transition increments the epoch exactly once. A
// withheld activation (live critical section, no waiting worker, or
// messaging failure) never bumps. The candidate update driver calls this
// one function — there is no parallel `controllerchange` watcher that
// could double-bump the same transition.
//
// This module performs no fetching and constructs no account/cloud client.
// It has no imports so the PWA gate can exercise it in plain Node.

export const CANDIDATE_SW_URL = '/rushd-pwa-sw.js';
export const CANDIDATE_SW_SCOPE = '/';
// D5: PWA cache warmed by the page after boot. This literal must equal the
// service worker's `PWA_CACHE_VERSION` (asserted by `static-checks.mjs`);
// the worker stays a dependency-free static file, so the name is mirrored
// here instead of imported.
export const CANDIDATE_PWA_CACHE = 'rushd-pwa-v4';
/** Maximum warmed URLs per boot: bounds quota use on constrained devices. */
export const PWA_WARM_URL_LIMIT = 60;

/**
 * @param {unknown} environment
 * @returns {boolean}
 */
function hasServiceWorker(environment) {
  return !!environment
    && typeof environment.navigator === 'object'
    && environment.navigator !== null
    && 'serviceWorker' in environment.navigator;
}

/**
 * Register the candidate service worker. Candidate/test callers only.
 * Registration only wires update discovery; the epoch advances exactly
 * once through `activateCandidateUpdate` when the waiting worker is asked
 * to activate.
 * @param {{ environment?: typeof globalThis, swUrl?: string, scope?: string, coordination?: { canActivateUpdate(): boolean, bumpEpoch?(reason?: string): number } | null }} [options]
 * @returns {Promise<{ ok: boolean, reason: string, registration?: unknown }>}
 */
export async function registerCandidatePwa(options = {}) {
  const environment = options.environment ?? globalThis;
  if (!hasServiceWorker(environment)) {
    return { ok: false, reason: 'service-worker-unavailable' };
  }
  const swUrl = typeof options.swUrl === 'string' && options.swUrl ? options.swUrl : CANDIDATE_SW_URL;
  const scope = typeof options.scope === 'string' && options.scope ? options.scope : CANDIDATE_SW_SCOPE;
  // D4: a first install controls no previous binary, so its activation must
  // not bump the epoch (that would hard-block the tab that just booted).
  // Only a genuine update over a live controller retires an old writer.
  let hadController = false;
  try {
    hadController = !!environment.navigator.serviceWorker.controller;
  } catch {
    hadController = false;
  }
  try {
    const registration = await environment.navigator.serviceWorker.register(swUrl, {
      scope,
      updateViaCache: 'none',
    });
    wireUpdateFound(registration, options.coordination ?? null, hadController);
    // D5 update correction: explicitly check for an update once per boot.
    // `register()` runs the browser's update job, but a caller that keeps
    // the page open (installed PWA relaunched from cache, long-lived tab)
    // must not depend on the browser's 24h background cadence. Discovery
    // only — activation still flows through the gated waiting-worker path.
    try {
      if (!registration.waiting && !registration.installing && typeof registration.update === 'function') {
        void registration.update().catch(() => undefined);
      }
    } catch {
      /* a discovery nudge must never break registration */
    }
    return { ok: true, reason: '', registration };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * @param {{ updatefound?: unknown, waiting?: { postMessage(m: unknown): void } | null, addEventListener?: Function }} registration
 * @param {{ canActivateUpdate(): boolean } | null} coordination
 * @param {boolean} [hadController]
 */
function wireUpdateFound(registration, coordination, hadController = true) {
  if (!registration || typeof registration.addEventListener !== 'function') return;
  // D5 update correction: one activation request per waiting worker. The
  // updatefound/statechange path covers workers that install while this
  // page is open; the immediate check below recovers a worker that already
  // reached `waiting` before this registration returned (installed while
  // every tab was closed, or updatefound fired before listeners attached —
  // the stale-client escape hatch). Both paths share one guard so a single
  // transition can never double-bump the epoch, and both stay gated on the
  // critical-section protocol: a withheld activation is retried by the next
  // boot's registration, which sees the same still-waiting worker.
  let activationWorker = null;
  const requestActivation = (worker) => {
    if (!worker || activationWorker === worker) return;
    activationWorker = worker;
    void activateCandidateUpdate(registration, coordination, 'candidate-update-activated', { hadController });
  };
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker || typeof worker.addEventListener !== 'function') return;
    const onStateChange = () => {
      if (worker.state !== 'installed') return;
      if (typeof worker.removeEventListener === 'function') {
        worker.removeEventListener('statechange', onStateChange);
      }
      requestActivation(worker);
    };
    worker.addEventListener('statechange', onStateChange);
  });
  try {
    if (registration.waiting) requestActivation(registration.waiting);
  } catch {
    /* a waiting-worker probe must never break registration */
  }
}

/**
 * Ask a waiting worker to activate, but never across another tab's active
 * critical section. Returns true when activation was requested.
 * @param {{ waiting?: { postMessage(m: unknown): void } | null }} registration
 * @param {{ canActivateUpdate(): boolean, activeCriticalSections?(): unknown[] } | null} coordination
 * @returns {Promise<{ activated: boolean, reason: string }>}
 */
export async function maybeActivateWaiting(registration, coordination) {
  const waiting = registration?.waiting;
  if (!waiting || typeof waiting.postMessage !== 'function') {
    return { activated: false, reason: 'no-waiting-worker' };
  }
  if (coordination && !coordination.canActivateUpdate()) {
    return { activated: false, reason: 'critical-section-active' };
  }
  try {
    waiting.postMessage({ type: 'rushd-pwa-skip-waiting' });
    return { activated: true, reason: '' };
  } catch (error) {
    return { activated: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * D3 epoch glue: request activation of a waiting worker and, on success,
 * bump the coordination epoch so tabs that opened under the old binary
 * lose write authority until they reload. A withheld activation
 * (critical section active, no waiting worker, or messaging failure)
 * never bumps the epoch. D4: a first install (`hadController: false`) has
 * no old binary to retire, so it activates without bumping.
 * @param {{ waiting?: { postMessage(m: unknown): void } | null }} registration
 * @param {{ canActivateUpdate(): boolean, activeCriticalSections?(): Array<{ kind: string, tabId: string }>, bumpEpoch?(reason?: string): number } | null} coordination
 * @param {string} [reason]
 * @param {{ hadController?: boolean }} [options]
 * @returns {Promise<{ activated: boolean, epoch: number | null, reason: string }>}
 */
export async function activateCandidateUpdate(registration, coordination, reason = 'candidate-update-activated', options = {}) {
  const requested = await maybeActivateWaiting(registration, coordination);
  if (!requested.activated) {
    return { activated: false, epoch: null, reason: requested.reason };
  }
  if (options && options.hadController === false) {
    return { activated: true, epoch: null, reason: 'first-install' };
  }
  if (coordination && typeof coordination.bumpEpoch === 'function') {
    try {
      const epoch = coordination.bumpEpoch(reason);
      return { activated: true, epoch, reason: '' };
    } catch (error) {
      return { activated: true, epoch: null, reason: error instanceof Error ? error.message : String(error) };
    }
  }
  return { activated: true, epoch: null, reason: 'epoch-unavailable' };
}

/**
 * Describe whether an update may activate right now.
 * @param {{ canActivateUpdate(): boolean, activeCriticalSections?(): Array<{ kind: string, tabId: string }> } | null} coordination
 * @returns {{ ready: boolean, activeSections: Array<{ kind: string, tabId: string }> }}
 */
export function describeUpdateReadiness(coordination) {
  if (!coordination) return { ready: true, activeSections: [] };
  const activeSections = typeof coordination.activeCriticalSections === 'function'
    ? coordination.activeCriticalSections()
    : [];
  return { ready: coordination.canActivateUpdate(), activeSections };
}

/**
 * D5: select the same-origin asset URLs worth warming into the PWA cache
 * after a successful online boot, so the next reload works offline even
 * for hashed bundles the worker's install precache cannot name. Pure and
 * synchronous for unit testing: entries may be performance-resource-like
 * records (`{ name }` as exposed by `getEntriesByType('resource')`, or
 * `{ url }`), or plain URL strings. Only same-origin `http(s)` URLs
 * are kept (finance data never travels the network, so nothing sensitive
 * can match); order is preserved, duplicates dropped, count capped.
 * @param {Array<{ url?: unknown, name?: unknown } | string> | null | undefined} entries
 * @param {string} origin The page origin that owns the offline scope.
 * @returns {string[]}
 */
export function selectWarmUrls(entries, origin) {
  const kept = [];
  const seen = new Set();
  if (!Array.isArray(entries) || typeof origin !== 'string' || !origin) return kept;
  for (const entry of entries) {
    if (kept.length >= PWA_WARM_URL_LIMIT) break;
    // PerformanceResourceTiming exposes `name`; accept `url` too.
    const raw = typeof entry === 'string' ? entry : (entry?.url ?? entry?.name);
    if (typeof raw !== 'string' || !raw) continue;
    let parsed;
    try {
      parsed = new URL(raw, origin);
    } catch {
      continue;
    }
    if (parsed.origin !== origin) continue;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    const url = parsed.href;
    if (seen.has(url)) continue;
    seen.add(url);
    kept.push(url);
  }
  return kept;
}

/**
 * D5: best-effort page-side warming of the PWA cache. Runs once after an
 * online boot + registration so hashed app bundles (which install
 * precaching cannot enumerate) are available offline. Same-origin only,
 * per-URL failures are skipped, and every failure mode resolves to a
 * `{ warmed }` summary instead of throwing — warming must never affect
 * boot, finance state, or update coordination.
 * @param {{ environment?: typeof globalThis, cacheName?: string, urls?: string[] }} [options]
 * @returns {Promise<{ warmed: number, requested: number, reason: string }>}
 */
export async function warmPwaCache(options = {}) {
  const environment = options.environment ?? globalThis;
  const cacheName = typeof options.cacheName === 'string' && options.cacheName
    ? options.cacheName
    : CANDIDATE_PWA_CACHE;
  const urls = Array.isArray(options.urls) ? options.urls.filter((url) => typeof url === 'string') : [];
  if (urls.length === 0) return { warmed: 0, requested: 0, reason: 'no-urls' };
  try {
    const cachesRef = environment?.caches;
    if (!cachesRef || typeof cachesRef.open !== 'function') {
      return { warmed: 0, requested: urls.length, reason: 'cache-unavailable' };
    }
    const cache = await cachesRef.open(cacheName);
    let warmed = 0;
    for (const url of urls.slice(0, PWA_WARM_URL_LIMIT)) {
      try {
        await cache.add(url);
        warmed += 1;
      } catch {
        /* one evicted asset must not fail the rest */
      }
    }
    return { warmed, requested: urls.length, reason: '' };
  } catch {
    return { warmed: 0, requested: urls.length, reason: 'warm-failed' };
  }
}
