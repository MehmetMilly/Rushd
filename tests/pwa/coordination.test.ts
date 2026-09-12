/**
 * P04-D2 tab-coordination gate (Node, deterministic).
 *
 * Proves the cross-tab protocol behind candidate writes, import, reset,
 * migration, and update activation: critical sections gate updates,
 * commits invalidate other tabs, epochs hard-block old binaries, and stale
 * locks from crashed tabs expire.
 */
import { describe, expect, it } from 'vitest';
import {
  COORDINATION_EPOCH_KEY,
  COORDINATION_LOCKS_KEY,
  createTabCoordinator,
} from '../../src/application/p04-d/tab-coordination.js';

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

describe('tab coordination', () => {
  it('starts with no critical sections and allows update activation', () => {
    const store = memoryStore();
    const tab = createTabCoordinator({ environment: SYNC_ENV,  tabId: 'tab-a', store, now: () => 1_000 });
    expect(tab.activeCriticalSections()).toEqual([]);
    expect(tab.canActivateUpdate()).toBe(true);
    tab.close();
  });

  it('blocks update activation across another tab’s write section', () => {
    const store = memoryStore();
    const now = { at: 10_000 };
    const clock = () => now.at;
    const tabA = createTabCoordinator({ environment: SYNC_ENV,  tabId: 'tab-a', store, now: clock });
    const tabB = createTabCoordinator({ environment: SYNC_ENV,  tabId: 'tab-b', store, now: clock });
    const token = tabA.beginCritical('write');
    expect(tabA.canActivateUpdate()).toBe(false);
    expect(tabB.canActivateUpdate()).toBe(false);
    expect(tabB.activeCriticalSections().map((entry) => entry.kind)).toEqual(['write']);
    tabA.endCritical(token);
    expect(tabB.canActivateUpdate()).toBe(true);
    tabA.close();
    tabB.close();
  });

  it('rejects unknown critical sections', () => {
    const tab = createTabCoordinator({ environment: SYNC_ENV, tabId: 'tab-x', store: memoryStore() });
    expect(() => tab.beginCritical('launch' as never)).toThrow(/unknown critical section/);
    tab.close();
  });

  it('delivers commit invalidation to other tabs', () => {
    const store = memoryStore();
    const tabA = createTabCoordinator({ environment: SYNC_ENV, tabId: 'tab-a', store });
    const tabB = createTabCoordinator({ environment: SYNC_ENV, tabId: 'tab-b', store });
    const seen: unknown[] = [];
    const unsubscribe = tabB.onInvalidate((message) => {
      seen.push(message);
    });
    tabA.announceCommit({ storageId: 'guest-active' });
    expect(seen.length).toBe(1);
    expect((seen[0] as { storageId: string }).storageId).toBe('guest-active');
    unsubscribe();
    tabA.close();
    tabB.close();
  });

  it('hard-blocks a stale epoch and notifies live tabs', () => {
    const store = memoryStore();
    const tabA = createTabCoordinator({ environment: SYNC_ENV, tabId: 'tab-a', store });
    const tabB = createTabCoordinator({ environment: SYNC_ENV, tabId: 'tab-b', store });
    const openedEpoch = tabA.getEpoch();
    const announcements: unknown[] = [];
    tabA.onEpoch((message) => announcements.push(message));
    const next = tabB.bumpEpoch('incompatible-update');
    expect(next).toBe(openedEpoch + 1);
    expect(() => tabA.assertEpoch(openedEpoch)).toThrow(/reload before writing/);
    expect(announcements.length).toBe(1);
    // A tab that opened at the new epoch is unaffected.
    const tabC = createTabCoordinator({ environment: SYNC_ENV, tabId: 'tab-c', store });
    expect(() => tabC.assertEpoch(next)).not.toThrow();
    tabA.close();
    tabB.close();
    tabC.close();
  });

  it('prunes crashed-tab locks after the TTL', () => {
    const store = memoryStore();
    const now = { at: 50_000 };
    const tab = createTabCoordinator({ environment: SYNC_ENV,  tabId: 'tab-a', store, now: () => now.at });
    tab.beginCritical('migration');
    expect(tab.canActivateUpdate()).toBe(false);
    now.at += 31_000;
    expect(tab.canActivateUpdate()).toBe(true);
    expect(tab.activeCriticalSections()).toEqual([]);
    tab.close();
  });

  it('persists epoch and locks under the documented keys', () => {
    const store = memoryStore();
    const tab = createTabCoordinator({ environment: SYNC_ENV, tabId: 'tab-a', store });
    tab.bumpEpoch('test');
    expect(store.cells.get(COORDINATION_EPOCH_KEY)).toBe('1');
    const token = tab.beginCritical('reset');
    expect(JSON.parse(store.cells.get(COORDINATION_LOCKS_KEY)!)).toMatchObject({
      'tab-a': { kind: 'reset' },
    });
    tab.endCritical(token);
    tab.close();
  });
});
