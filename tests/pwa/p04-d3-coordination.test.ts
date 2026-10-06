/**
 * P04-D3 coordination gate (Node, deterministic).
 *
 * Closes the D2 review findings at the coordination/PWA layer: the epoch
 * is monotonic within a live tab (stored rollbacks are refused and
 * repaired), long critical sections refresh their lease so update
 * activation cannot cross a live operation past the old TTL, and
 * service-worker activation is glued to the epoch bump without
 * caller-optional steps.
 */
import { describe, expect, it } from 'vitest';
import {
  COORDINATION_EPOCH_KEY,
  COORDINATION_HEARTBEAT_MS,
  COORDINATION_LOCK_TTL_MS,
  createTabCoordinator,
} from '../../src/application/p04-d/tab-coordination.js';
import {
  activateCandidateUpdate,
  registerCandidatePwa,
} from '../../src/pwa/registration.js';

const SYNC_ENV = {} as unknown as typeof globalThis;

function memoryStore() {
  const cells = new Map<string, string>();
  return {
    getItem: (key: string) => (cells.has(key) ? cells.get(key)! : null),
    setItem: (key: string, value: string) => {
      cells.set(key, String(value));
    },
    removeItem: (key: string) => {
      cells.delete(key);
    },
    cells,
  };
}

describe('monotonic epoch', () => {
  it('refuses a stored rollback and repairs the shared cell', () => {
    const store = memoryStore();
    const tab = createTabCoordinator({ environment: SYNC_ENV, tabId: 'tab-a', store });
    expect(tab.getEpoch()).toBe(0);
    expect(tab.bumpEpoch('update')).toBe(1);
    // An older value written back into the shared cell cannot re-enable
    // this tab: the guarded read stays monotonic and repairs the cell.
    store.setItem(COORDINATION_EPOCH_KEY, '0');
    expect(tab.getEpoch()).toBe(1);
    expect(store.cells.get(COORDINATION_EPOCH_KEY)).toBe('1');
    expect(() => tab.assertEpoch(0)).toThrow(/reload before writing/);
    // A concurrent bump still moves forward from the guarded value.
    expect(tab.bumpEpoch('second')).toBe(2);
    tab.close();
  });

  it('shares epoch advances with tabs that never bumped', () => {
    const store = memoryStore();
    const tabA = createTabCoordinator({ environment: SYNC_ENV, tabId: 'tab-a', store });
    const tabB = createTabCoordinator({ environment: SYNC_ENV, tabId: 'tab-b', store });
    tabA.bumpEpoch('update');
    expect(tabB.getEpoch()).toBe(1);
    expect(() => tabB.assertEpoch(0)).toThrow(/reload before writing/);
    tabA.close();
    tabB.close();
  });
});

describe('critical-section lease', () => {
  it('keeps gating update activation across a refreshed long operation', () => {
    expect(COORDINATION_HEARTBEAT_MS).toBeLessThan(COORDINATION_LOCK_TTL_MS);
    const store = memoryStore();
    const now = { at: 100_000 };
    const tab = createTabCoordinator({ environment: SYNC_ENV, tabId: 'tab-a', store, now: () => now.at });
    let token = tab.beginCritical('migration');
    // Refresh across several TTL windows: a write live far longer than
    // the old TTL still blocks update activation while it refreshes.
    for (let cycle = 0; cycle < 4; cycle += 1) {
      now.at += COORDINATION_LOCK_TTL_MS - 5_000;
      token = tab.refreshCritical(token);
      expect(tab.canActivateUpdate()).toBe(false);
    }
    expect(tab.activeCriticalSections().map((entry) => entry.kind)).toEqual(['migration']);
    tab.endCritical(token);
    expect(tab.canActivateUpdate()).toBe(true);
    tab.close();
  });

  it('still prunes a section that is never refreshed', () => {
    const store = memoryStore();
    const now = { at: 200_000 };
    const tab = createTabCoordinator({ environment: SYNC_ENV, tabId: 'tab-a', store, now: () => now.at });
    tab.beginCritical('write');
    now.at += COORDINATION_LOCK_TTL_MS + 1;
    expect(tab.canActivateUpdate()).toBe(true);
    tab.close();
  });

  it('refuses to refresh a released or foreign section', () => {
    const store = memoryStore();
    const tab = createTabCoordinator({ environment: SYNC_ENV, tabId: 'tab-a', store });
    const token = tab.beginCritical('write');
    tab.endCritical(token);
    expect(() => tab.refreshCritical(token)).toThrow(/no live/);
    expect(() => tab.refreshCritical({ kind: 'write', tabId: 'tab-b' })).toThrow(/foreign or malformed/);
    expect(() => tab.refreshCritical(null)).toThrow();
    tab.close();
  });
});

describe('service-worker activation epoch glue', () => {
  function coordinator() {
    return createTabCoordinator({ environment: SYNC_ENV, tabId: 'pwa-tab', store: memoryStore() });
  }

  it('bumps the epoch after a successful activation', async () => {
    const coordination = coordinator();
    const posted: unknown[] = [];
    const registration = { waiting: { postMessage: (message: unknown) => void posted.push(message) } };
    const result = await activateCandidateUpdate(registration, coordination as never, 'test-update');
    expect(result.activated).toBe(true);
    expect(result.epoch).toBe(1);
    expect(posted).toEqual([{ type: 'rushd-pwa-skip-waiting' }]);
    expect(coordination.getEpoch()).toBe(1);
    coordination.close();
  });

  it('bumps exactly once through the live updatefound registration path', async () => {
    const coordination = coordinator();
    const posted: unknown[] = [];
    let updateFound: (() => void) | null = null;
    let stateChanged: (() => void) | null = null;
    const worker = {
      state: 'installing',
      addEventListener(type: string, callback: () => void) {
        if (type === 'statechange') stateChanged = callback;
      },
      removeEventListener() {},
      postMessage: (message: unknown) => void posted.push(message),
    };
    const registration = {
      installing: worker,
      // Realistic timing: a worker becomes `waiting` only once installed
      // over a live controller, never while still installing.
      get waiting() {
        return worker.state === 'installed' ? worker : null;
      },
      addEventListener(type: string, callback: () => void) {
        if (type === 'updatefound') updateFound = callback;
      },
    };
    const environment = {
      navigator: {
        serviceWorker: {
          // A live controller means a genuine update over a previous
          // binary (D4: a first install must not bump).
          controller: {},
          register: async () => registration,
        },
      },
    };

    const result = await registerCandidatePwa({
      environment: environment as never,
      coordination: coordination as never,
    });
    expect(result.ok).toBe(true);
    expect(updateFound).not.toBeNull();
    updateFound!();
    worker.state = 'installed';
    expect(stateChanged).not.toBeNull();
    stateChanged!();
    await Promise.resolve();
    await Promise.resolve();

    expect(posted).toEqual([{ type: 'rushd-pwa-skip-waiting' }]);
    expect(coordination.getEpoch()).toBe(1);
    coordination.close();
  });

  it('recovers a worker that reached waiting before registration returned', async () => {
    // D5 update correction: a worker installed while every tab was closed
    // (or whose updatefound fired before listeners attached) shows up as
    // `registration.waiting` at register time with no updatefound event.
    // Registration must route it through the same gated activation path.
    const coordination = coordinator();
    const posted: unknown[] = [];
    const waiting = { postMessage: (message: unknown) => void posted.push(message) };
    const registration = {
      installing: null,
      waiting,
      addEventListener() {},
    };
    const environment = {
      navigator: {
        serviceWorker: {
          controller: {},
          register: async () => registration,
        },
      },
    };
    const result = await registerCandidatePwa({
      environment: environment as never,
      coordination: coordination as never,
    });
    expect(result.ok).toBe(true);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(posted).toEqual([{ type: 'rushd-pwa-skip-waiting' }]);
    expect(coordination.getEpoch()).toBe(1);
    coordination.close();
  });

  it('waiting-worker recovery stays gated on a live critical section', async () => {
    const coordination = coordinator();
    const token = coordination.beginCritical('write');
    const posted: unknown[] = [];
    const registration = {
      installing: null,
      waiting: { postMessage: (message: unknown) => void posted.push(message) },
      addEventListener() {},
    };
    const environment = {
      navigator: {
        serviceWorker: {
          controller: {},
          register: async () => registration,
        },
      },
    };
    const result = await registerCandidatePwa({
      environment: environment as never,
      coordination: coordination as never,
    });
    expect(result.ok).toBe(true);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(posted).toEqual([]);
    expect(coordination.getEpoch()).toBe(0);
    coordination.endCritical(token);
    coordination.close();
  });

  it('waiting-worker recovery never bumps the epoch on a first install', async () => {
    const coordination = coordinator();
    const posted: unknown[] = [];
    const registration = {
      installing: null,
      waiting: { postMessage: (message: unknown) => void posted.push(message) },
      addEventListener() {},
    };
    const environment = {
      navigator: {
        serviceWorker: {
          // No controller: no previous binary exists to retire.
          controller: null,
          register: async () => registration,
        },
      },
    };
    const result = await registerCandidatePwa({
      environment: environment as never,
      coordination: coordination as never,
    });
    expect(result.ok).toBe(true);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(posted).toEqual([{ type: 'rushd-pwa-skip-waiting' }]);
    expect(coordination.getEpoch()).toBe(0);
    coordination.close();
  });

  it('withholds activation and the epoch across a live critical section', async () => {
    const coordination = coordinator();
    const token = coordination.beginCritical('write');
    const posted: unknown[] = [];
    const registration = { waiting: { postMessage: (message: unknown) => void posted.push(message) } };
    const result = await activateCandidateUpdate(registration, coordination as never, 'test-update');
    expect(result.activated).toBe(false);
    expect(result.epoch).toBeNull();
    expect(posted).toEqual([]);
    expect(coordination.getEpoch()).toBe(0);
    coordination.endCritical(token);
    coordination.close();
  });

  it('never bumps without a waiting worker', async () => {
    const coordination = coordinator();
    const result = await activateCandidateUpdate({}, coordination as never, 'test-update');
    expect(result.activated).toBe(false);
    expect(result.epoch).toBeNull();
    expect(coordination.getEpoch()).toBe(0);
    coordination.close();
  });

  it('bumps the epoch exactly once per activation transition', async () => {
    const coordination = coordinator();
    const posted: unknown[] = [];
    const waiting = { postMessage: (message: unknown) => void posted.push(message) };
    const first = await activateCandidateUpdate({ waiting }, coordination as never, 'update-1');
    expect(first).toMatchObject({ activated: true, epoch: 1 });
    // A second activation transition increments exactly once more — never
    // two bumps for one transition, never zero for a real one.
    const second = await activateCandidateUpdate({ waiting }, coordination as never, 'update-2');
    expect(second).toMatchObject({ activated: true, epoch: 2 });
    expect(coordination.getEpoch()).toBe(2);
    coordination.close();
  });
});
