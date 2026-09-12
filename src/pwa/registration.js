// P04-D2: candidate-only PWA registration and update coordination.
//
// This module is never called by default production (`src/main.ts` mounts
// the legacy application without registering any worker). Only an explicit
// test/build caller registers the candidate service worker, and only that
// caller drives updates through the same cross-tab critical-section
// protocol as writes, import, reset, and migration:
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
  try {
    const registration = await environment.navigator.serviceWorker.register(swUrl, {
      scope,
      updateViaCache: 'none',
    });
    wireUpdateFound(registration, options.coordination ?? null);
    return { ok: true, reason: '', registration };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * @param {{ updatefound?: unknown, waiting?: { postMessage(m: unknown): void } | null, addEventListener?: Function }} registration
 * @param {{ canActivateUpdate(): boolean } | null} coordination
 */
function wireUpdateFound(registration, coordination) {
  if (!registration || typeof registration.addEventListener !== 'function') return;
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker || typeof worker.addEventListener !== 'function') return;
    const onStateChange = () => {
      if (worker.state !== 'installed') return;
      if (typeof worker.removeEventListener === 'function') {
        worker.removeEventListener('statechange', onStateChange);
      }
      void activateCandidateUpdate(registration, coordination);
    };
    worker.addEventListener('statechange', onStateChange);
  });
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
 * never bumps the epoch.
 * @param {{ waiting?: { postMessage(m: unknown): void } | null }} registration
 * @param {{ canActivateUpdate(): boolean, activeCriticalSections?(): Array<{ kind: string, tabId: string }>, bumpEpoch?(reason?: string): number } | null} coordination
 * @param {string} [reason]
 * @returns {Promise<{ activated: boolean, epoch: number | null, reason: string }>}
 */
export async function activateCandidateUpdate(registration, coordination, reason = 'candidate-update-activated') {
  const requested = await maybeActivateWaiting(registration, coordination);
  if (!requested.activated) {
    return { activated: false, epoch: null, reason: requested.reason };
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
