/* Rushd page-side retirement trigger.
 *
 * Discovers an already-controlling rejected P04-D worker or leftover
 * `rushd-shell-*` caches and registers `/sw.js` once so that worker can
 * retire them. On a clean browser with no relevant registration or cache,
 * this file is inert and never creates a persistent service-worker loop.
 */
(() => {
  const SHELL_CACHE_PREFIX = 'rushd-shell-';
  const SESSION_KEY = 'rushd-shell-retirement';
  const HELLO_TIMEOUT_MS = 1200;

  function sessionGet() {
    try {
      return sessionStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  }

  function sessionSet(value) {
    try {
      sessionStorage.setItem(SESSION_KEY, value);
    } catch {
      /* storage blocked: detection still gates registration */
    }
  }

  function probeRejectedWorker(worker) {
    if (!worker) return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      const channel = new MessageChannel();
      const timer = setTimeout(() => finish(false), HELLO_TIMEOUT_MS);
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          channel.port1.close();
        } catch {
          /* already closed */
        }
        resolve(value);
      };
      channel.port1.onmessage = (event) => {
        const data = event.data;
        finish(Boolean(data && data.type === 'rushd-shell-version'));
      };
      try {
        worker.postMessage({ type: 'rushd-hello' }, [channel.port2]);
      } catch {
        finish(false);
      }
    });
  }

  async function registrationLooksRejected(registration) {
    if (!registration) return false;
    const workers = [registration.active, registration.waiting, registration.installing];
    for (const worker of workers) {
      if (await probeRejectedWorker(worker)) return true;
    }
    return false;
  }

  async function shouldRetireRejectedShell() {
    if (!('serviceWorker' in navigator) || !('caches' in window)) return false;
    const cacheNames = await caches.keys();
    if (cacheNames.some((name) => typeof name === 'string' && name.startsWith(SHELL_CACHE_PREFIX))) {
      return true;
    }
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      if (await registrationLooksRejected(registration)) return true;
    }
    return probeRejectedWorker(navigator.serviceWorker.controller);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.type !== 'rushd-shell-retired') return;
      if (sessionGet() === 'reloaded') return;
      sessionSet('reloaded');
      location.reload();
    });
  }

  shouldRetireRejectedShell()
    .then((needed) => {
      if (!needed) return undefined;
      const state = sessionGet();
      if (state === 'triggered' || state === 'reloaded') return undefined;
      sessionSet('triggered');
      return navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    })
    .catch(() => {
      /* discovery failure must not take down the legacy app */
    });
})();
