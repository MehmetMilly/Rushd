// P04-D2: cross-tab coordination for the canonical candidate host.
//
// One writer owns a checkout at a time, but two tabs can still be open on
// the same device. This module gives those tabs a shared protocol for the
// operations that must never interleave silently:
//
// - critical sections (`write`, `import`, `reset`, `migration`): a tab
//   announces when it enters and leaves one. A service-worker update must
//   not activate across another tab's active critical section
//   (`canActivateUpdate()`), and tests can assert the section was held.
// - commit invalidation (`announceCommit` / `onInvalidate`): after a durable
//   commit, every other tab refreshes from the repository instead of
//   trusting a stale snapshot.
// - epoch (`getEpoch` / `bumpEpoch` / `assertEpoch`): an incompatible
//   update or storage transition bumps the epoch. A tab that opened under
//   an older epoch is hard-blocked from further writes until it reloads.
//
// Transports are injected. `store` is a localStorage-like persistence cell
// (locks + epoch survive reloads); `bus` is a BroadcastChannel-like
// broadcast (same-origin tabs). Both default to the real browser primitive
// when present and to an explicit in-memory equivalent otherwise, so unit
// tests can drive two coordinators in one process. `now` is injectable for
// deterministic stale-lock expiry.
//
// This module never touches finance state, IndexedDB, or the network.

/** Critical-section kinds coordinated across tabs. */
export const CRITICAL_SECTIONS = Object.freeze(['write', 'import', 'reset', 'migration']);

export const COORDINATION_CHANNEL = 'rushd-p04d-coordination';
export const COORDINATION_EPOCH_KEY = 'rushd_p04d_epoch';
export const COORDINATION_LOCKS_KEY = 'rushd_p04d_locks';
/** A lock older than this is treated as a crashed tab and pruned. */
export const COORDINATION_LOCK_TTL_MS = 30_000;

function isCriticalSection(kind) {
  return CRITICAL_SECTIONS.includes(kind);
}

/**
 * @returns {{ getItem(k: string): string | null, setItem(k: string, v: string): void, removeItem(k: string): void }}
 */
function createMemoryStore() {
  const cells = new Map();
  return {
    getItem(key) {
      return cells.has(key) ? cells.get(key) : null;
    },
    setItem(key, value) {
      cells.set(key, String(value));
    },
    removeItem(key) {
      cells.delete(key);
    },
  };
}

/**
 * In-process broadcast hub shared by coordinators created without an
 * explicit bus in the same process (tests, workers without
 * BroadcastChannel). Browser tabs use the real BroadcastChannel instead.
 */
const processHub = new Set();

function createProcessBus() {
  /** @type {(message: unknown) => void} */
  let handler = () => {};
  const bus = {
    postMessage(message) {
      for (const other of [...processHub]) {
        if (other === bus) continue;
        try {
          other.deliver(message);
        } catch {
          /* a dead listener must not break coordination */
        }
      }
    },
    deliver(message) {
      handler(message);
    },
    set onmessage(next) {
      handler = typeof next === 'function' ? next : () => {};
    },
    get onmessage() {
      return handler;
    },
    close() {
      processHub.delete(bus);
    },
  };
  processHub.add(bus);
  return bus;
}

/**
 * @param {unknown} environment
 * @returns {boolean}
 */
function hasBroadcastChannel(environment) {
  return !!environment && typeof environment.BroadcastChannel === 'function';
}

/**
 * Create one tab's coordinator.
 * @param {{ tabId?: string, environment?: typeof globalThis, store?: { getItem(k: string): string | null, setItem(k: string, v: string): void, removeItem(k: string): void } | null, bus?: { postMessage(m: unknown): void, onmessage: ((m: unknown) => void) | null, close?: () => void } | null, now?: () => number }} [options]
 */
export function createTabCoordinator(options = {}) {
  const environment = options.environment ?? globalThis;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const tabId = typeof options.tabId === 'string' && options.tabId
    ? options.tabId
    : `tab-${Math.floor(now())}-${Math.floor(Math.random() * 1_000_000)}`;
  const store = options.store ?? environment?.localStorage ?? createMemoryStore();
  const invalidateHandlers = new Set();
  const epochHandlers = new Set();

  /** @type {{ postMessage(m: unknown): void, onmessage: ((m: unknown) => void) | null, close?: () => void }} */
  let bus;
  if (options.bus) {
    bus = options.bus;
  } else if (hasBroadcastChannel(environment)) {
    const channel = new environment.BroadcastChannel(COORDINATION_CHANNEL);
    bus = {
      postMessage(message) {
        channel.postMessage(message);
      },
      set onmessage(next) {
        channel.onmessage = next ? (event) => next(event?.data ?? event) : null;
      },
      get onmessage() {
        return null;
      },
      close() {
        try {
          channel.close();
        } catch {
          /* already closed */
        }
      },
    };
  } else {
    bus = createProcessBus();
  }

  /**
   * @returns {Record<string, { kind: string, tabId: string, atMs: number }>}
   */
  function readLocks() {
    try {
      const raw = store.getItem(COORDINATION_LOCKS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed;
    } catch {
      return {};
    }
  }

  /**
   * @param {Record<string, { kind: string, tabId: string, atMs: number }>} locks
   */
  function writeLocks(locks) {
    try {
      store.setItem(COORDINATION_LOCKS_KEY, JSON.stringify(locks));
    } catch {
      /* storage blocked: coordination degrades to broadcast-only */
    }
  }

  /**
   * @param {Record<string, { kind: string, tabId: string, atMs: number }>} locks
   * @returns {{ locks: Record<string, { kind: string, tabId: string, atMs: number }>, pruned: boolean }}
   */
  function pruneLocks(locks) {
    const at = now();
    let pruned = false;
    const next = {};
    for (const [key, entry] of Object.entries(locks)) {
      if (!entry || typeof entry !== 'object' || !isCriticalSection(entry.kind)) {
        pruned = true;
        continue;
      }
      const atMs = Number(entry.atMs);
      if (!Number.isFinite(atMs) || at - atMs > COORDINATION_LOCK_TTL_MS) {
        pruned = true;
        continue;
      }
      next[key] = entry;
    }
    return { locks: next, pruned };
  }

  bus.onmessage = (message) => {
    const data = message && typeof message === 'object' ? message : {};
    if (data.type === 'rushd-p04d-invalidate') {
      for (const handler of [...invalidateHandlers]) {
        try {
          handler(data);
        } catch {
          /* listener failure must not break coordination */
        }
      }
    } else if (data.type === 'rushd-p04d-epoch') {
      for (const handler of [...epochHandlers]) {
        try {
          handler(data);
        } catch {
          /* listener failure must not break coordination */
        }
      }
    }
  };

  const api = {
    tabId,
    /**
     * Current coordination epoch. Tabs that opened under an older epoch
     * are hard-blocked from further writes.
     * @returns {number}
     */
    getEpoch() {
      const raw = store.getItem(COORDINATION_EPOCH_KEY);
      const parsed = raw === null || raw === undefined ? 0 : Number(raw);
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
    },
    /**
     * Publish a new epoch (incompatible update/storage transition) and
     * notify every tab. Returns the new epoch.
     * @param {string} [reason]
     * @returns {number}
     */
    bumpEpoch(reason = '') {
      const next = api.getEpoch() + 1;
      try {
        store.setItem(COORDINATION_EPOCH_KEY, String(next));
      } catch {
        /* storage blocked: broadcast still notifies live tabs */
      }
      bus.postMessage({ type: 'rushd-p04d-epoch', epoch: next, reason, tabId });
      return next;
    },
    /**
     * Throw when this tab opened under a stale epoch: it must reload
     * before writing again.
     * @param {number} openedEpoch
     */
    assertEpoch(openedEpoch) {
      const current = this.getEpoch();
      if (current > openedEpoch) {
        throw new Error(
          `P04-D write blocked: tab opened at epoch ${openedEpoch} but coordination is at epoch ${current}; reload before writing.`,
        );
      }
    },
    /**
     * Enter a critical section. The returned token must be passed to
     * `endCritical`. Sections are advisory across tabs; the repository
     * guards still own commit conflicts.
     * @param {string} kind One of `CRITICAL_SECTIONS`.
     * @returns {{ kind: string, tabId: string, atMs: number }}
     */
    beginCritical(kind) {
      if (!isCriticalSection(kind)) {
        throw new TypeError(`unknown critical section: ${String(kind)}`);
      }
      const token = { kind, tabId, atMs: now() };
      const { locks, pruned } = pruneLocks(readLocks());
      locks[tabId] = token;
      writeLocks(locks);
      if (pruned) {
        bus.postMessage({ type: 'rushd-p04d-prune', tabId });
      }
      bus.postMessage({ type: 'rushd-p04d-acquire', kind, tabId, atMs: token.atMs });
      return token;
    },
    /**
     * Leave a critical section previously entered with `beginCritical`.
     * @param {{ kind: string, tabId: string } | null | undefined} token
     */
    endCritical(token) {
      const { locks } = pruneLocks(readLocks());
      if (token && locks[tabId] && locks[tabId].kind === token.kind) {
        delete locks[tabId];
        writeLocks(locks);
      }
      bus.postMessage({ type: 'rushd-p04d-release', kind: token?.kind ?? null, tabId });
    },
    /**
     * Currently held (non-stale) critical sections across tabs.
     * @returns {Array<{ kind: string, tabId: string, atMs: number }>}
     */
    activeCriticalSections() {
      const { locks, pruned } = pruneLocks(readLocks());
      if (pruned) writeLocks(locks);
      return Object.values(locks);
    },
    /**
     * A service-worker update may activate only when no tab holds a
     * write/import/reset/migration critical section.
     * @returns {boolean}
     */
    canActivateUpdate() {
      return this.activeCriticalSections().length === 0;
    },
    /**
     * Announce a durable commit so other tabs refresh instead of trusting
     * stale snapshots.
     * @param {{ storageId?: string, operationId?: string }} [info]
     */
    announceCommit(info = {}) {
      bus.postMessage({
        type: 'rushd-p04d-invalidate',
        tabId,
        storageId: info.storageId ?? null,
        operationId: info.operationId ?? null,
        atMs: now(),
      });
    },
    /**
     * @param {(message: { tabId: string, storageId: string | null, operationId: string | null, atMs: number }) => void} handler
     * @returns {() => void} Unsubscribe function.
     */
    onInvalidate(handler) {
      invalidateHandlers.add(handler);
      return () => {
        invalidateHandlers.delete(handler);
      };
    },
    /**
     * @param {(message: { epoch: number, reason: string, tabId: string }) => void} handler
     * @returns {() => void} Unsubscribe function.
     */
    onEpoch(handler) {
      epochHandlers.add(handler);
      return () => {
        epochHandlers.delete(handler);
      };
    },
    close() {
      try {
        bus.close?.();
      } catch {
        /* already closed */
      }
      invalidateHandlers.clear();
      epochHandlers.clear();
    },
  };

  return api;
}
