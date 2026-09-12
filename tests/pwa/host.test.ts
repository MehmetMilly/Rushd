/**
 * P04-D2 canonical-host gate (Node, deterministic).
 *
 * Proves the candidate host behind the latch using the memory storage
 * adapter: migration commit points, gateway-backed capture, reload from
 * committed state, truthful write-blocked recovery, old-binary blocking,
 * import/reset commit discipline, and latch routing of host-bound ports.
 * Durable OPFS proof lives in the Playwright browser harness.
 */
import { describe, expect, it } from 'vitest';
import { prepareCanonicalCandidateHost } from '../../src/application/p04-d/canonical-host.js';
import { resolveP04DAuthority } from '../../src/application/p04-d/authority-latch.js';
import { isMarkedCandidatePorts } from '../../src/application/p04-d/candidate-token.js';
import { createTabCoordinator } from '../../src/application/p04-d/tab-coordination.js';
import { snapshotFromStores } from '../../src/data/migration/extract';
import { createDeterministicContext } from '../domain/support/deterministic-context';
import { createMemoryStorage } from './memory-storage';

const SYNC_ENV = {} as unknown as typeof globalThis;

function memoryLocalStorage() {
  const cells = new Map<string, string>();
  return {
    getItem: (key: string) => (cells.has(key) ? cells.get(key)! : null),
    setItem: (key: string, value: string) => {
      cells.set(key, String(value));
    },
    removeItem: (key: string) => {
      cells.delete(key);
    },
    get length() {
      return cells.size;
    },
    key: (index: number) => [...cells.keys()][index] ?? null,
  };
}

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
  };
}

function fakeV1Snapshot() {
  return snapshotFromStores({
    settings: [
      { key: 'baseAllowance', value: 1500 },
      { key: 'theme', value: 'dark' },
    ],
    templates: [],
    expenses: [
      {
        id: 'v1-e1',
        name: 'bread',
        expectedCost: 12,
        actualPaid: 12,
        isPaid: true,
        date: '2026-09-05',
        category: 'food',
        classification: 'essential',
      },
    ],
    sourcePresent: true,
  });
}

async function migratedHost(options: { migrationId?: string; selectedDate?: string } = {}) {
  const { context } = createDeterministicContext();
  const coordinationStore = memoryStore();
  const coordination = createTabCoordinator({ tabId: 'host-tab', environment: SYNC_ENV, store: coordinationStore });
  const storage = createMemoryStorage({ context });
  const snapshot = fakeV1Snapshot();
  const frozenInput = JSON.stringify(snapshot);
  const host = await prepareCanonicalCandidateHost({
    environment: { localStorage: memoryLocalStorage() } as unknown as typeof globalThis,
    context,
    snapshot,
    migrationId: options.migrationId ?? 'mg-test-0001',
    coordination,
    storage: storage as never,
    selectedDate: options.selectedDate ?? '2026-09-05',
  });
  return { context, coordination, coordinationStore, storage, snapshot, frozenInput, host };
}

describe('canonical host', () => {
  it('migrates fake v1 data and binds canonical-ready ports', async () => {
    const { host, frozenInput, snapshot } = await migratedHost();
    expect(host.ok).toBe(true);
    expect(host.reason).toBe('');
    expect(host.authority.kind).toBe('canonicalReady');
    expect(host.authority.writable).toBe(true);
    expect(host.storageId).toBe('mig-mg-test-0001');
    expect(host.migration?.ok).toBe(true);
    expect(host.featurePorts.authority.getState().kind).toBe('canonicalReady');
    // The v1 migration input is never mutated: no dual-writer residue.
    expect(JSON.stringify(snapshot)).toBe(frozenInput);
    // Host-bound ports carry the latch token and stay frozen.
    expect(isMarkedCandidatePorts(host.featurePorts)).toBe(true);
    expect(Object.isFrozen(host.featurePorts)).toBe(true);
    expect((host.featurePorts.authority as { bind?: unknown }).bind).toBeUndefined();
    await host.close();
  });

  it('commits capture through the gateway and serves it after reload', async () => {
    const first = await migratedHost();
    expect(first.host.ok).toBe(true);
    const submitted = await first.host.featurePorts.capture.submitExpense({
      name: 'milk',
      cost: 9.5,
      category: 'food',
      date: '2026-09-05',
    });
    expect(submitted.ok).toBe(true);
    expect(submitted.id).toBeTruthy();
    const rows = first.host.featurePorts.home.listSelectedDayExpenses();
    expect(rows.some((row) => row.id === submitted.id)).toBe(true);
    expect(first.host.featurePorts.home.getDailyPaidTotal()).toBeGreaterThan(0);

    // Reload: a new host over the same committed control pointer, with no
    // snapshot, opens the migrated storage and serves the committed expense.
    const { context } = createDeterministicContext();
    const reloaded = await prepareCanonicalCandidateHost({
      environment: { localStorage: memoryLocalStorage() } as unknown as typeof globalThis,
      context,
      control: first.storage.control,
      coordination: createTabCoordinator({ tabId: 'reload-tab', environment: SYNC_ENV, store: memoryStore() }),
      storage: first.storage as never,
      selectedDate: '2026-09-05',
    });
    expect(reloaded.ok).toBe(true);
    expect(reloaded.storageId).toBe('mig-mg-test-0001');
    expect(reloaded.migration).toBeNull();
    const reloadedRows = reloaded.featurePorts.home.listSelectedDayExpenses();
    expect(reloadedRows.some((row) => row.id === submitted.id)).toBe(true);
    await first.host.close();
    await reloaded.close();
  });

  it('rejects invalid capture without committing', async () => {
    const { host } = await migratedHost();
    expect(host.ok).toBe(true);
    const before = host.featurePorts.home.getDailyPaidTotal();
    expect(await host.featurePorts.capture.submitExpense({ name: '', cost: 5, category: 'food' })).toMatchObject({
      ok: false,
      reason: 'validation',
    });
    expect(await host.featurePorts.capture.submitExpense({ name: 'x', cost: -2, category: 'food' })).toMatchObject({
      ok: false,
      reason: 'validation',
    });
    expect(host.featurePorts.home.getDailyPaidTotal()).toBe(before);
    await host.close();
  });

  it('fails closed to a truthful write-blocked state on storage failure', async () => {
    const { context } = createDeterministicContext();
    const broken = {
      control: createMemoryStorage({ context }).control,
      async openActive(): Promise<unknown> {
        throw new Error('simulated OPFS outage');
      },
      async migrate(): Promise<never> {
        throw new Error('unreachable');
      },
      async exportSnapshot(): Promise<never> {
        throw new Error('unreachable');
      },
      async importReplacement(): Promise<never> {
        throw new Error('unreachable');
      },
      async resetScope(): Promise<never> {
        throw new Error('unreachable');
      },
    };
    const host = await prepareCanonicalCandidateHost({
      environment: { localStorage: memoryLocalStorage() } as unknown as typeof globalThis,
      context,
      snapshot: fakeV1Snapshot(),
      migrationId: 'mg-failure-1',
      coordination: createTabCoordinator({ tabId: 'fail-tab', environment: SYNC_ENV, store: memoryStore() }),
      storage: broken as never,
    });
    expect(host.ok).toBe(false);
    expect(host.authority.kind).toBe('unavailable');
    expect(host.authority.writable).toBe(false);
    expect(host.reason).toMatch(/failed|unavailable|outage/i);
    // No success UI can precede commit: writers block, readers stay empty.
    expect(await host.featurePorts.capture.submitExpense({ name: 'x', cost: 1, category: 'food' })).toMatchObject({
      ok: false,
      reason: 'blocked',
    });
    expect(host.featurePorts.home.listSelectedDayExpenses()).toEqual([]);
    expect(host.featurePorts.authority.getState().kind).toBe('unavailable');
    await host.close();
  });

  it('hard-blocks an old tab after the epoch advances', async () => {
    const { host, coordination } = await migratedHost();
    expect(host.ok).toBe(true);
    const first = await host.featurePorts.capture.submitExpense({ name: 'before', cost: 1, category: 'food' });
    expect(first.ok).toBe(true);
    coordination.bumpEpoch('incompatible-update');
    const second = await host.featurePorts.capture.submitExpense({ name: 'after', cost: 1, category: 'food' });
    expect(second).toMatchObject({ ok: false, reason: 'blocked' });
    expect(host.featurePorts.authority.getState().kind).toBe('unavailable');
    await host.close();
  });

  it('invalidates a second tab after a commit', async () => {
    const { context } = createDeterministicContext();
    const storage = createMemoryStorage({ context });
    const sharedStore = memoryStore();
    const coordinationA = createTabCoordinator({ tabId: 'tab-a', environment: SYNC_ENV, store: sharedStore });
    const coordinationB = createTabCoordinator({ tabId: 'tab-b', environment: SYNC_ENV, store: sharedStore });
    const environment = { localStorage: memoryLocalStorage() } as unknown as typeof globalThis;
    const hostA = await prepareCanonicalCandidateHost({
      environment,
      context,
      snapshot: fakeV1Snapshot(),
      migrationId: 'mg-twotab-1',
      coordination: coordinationA,
      storage: storage as never,
      selectedDate: '2026-09-05',
    });
    expect(hostA.ok).toBe(true);
    const hostB = await prepareCanonicalCandidateHost({
      environment,
      context,
      control: storage.control,
      coordination: coordinationB,
      storage: storage as never,
      selectedDate: '2026-09-05',
    });
    expect(hostB.ok).toBe(true);
    expect(hostB.storageId).toBe(hostA.storageId);
    const seen: Array<{ storageId: string | null }> = [];
    const unsubscribe = coordinationB.onInvalidate((message) => {
      seen.push(message);
    });
    const submitted = await hostA.featurePorts.capture.submitExpense({
      name: 'shared-bread',
      cost: 4,
      category: 'food',
      date: '2026-09-05',
    });
    expect(submitted.ok).toBe(true);
    // The commit announcement reaches the other tab, which then serves the
    // committed expense instead of a stale snapshot.
    expect(seen.length).toBe(1);
    expect(seen[0].storageId).toBe(hostA.storageId);
    await hostB.refresh();
    expect(hostB.featurePorts.home.listSelectedDayExpenses().some((row) => row.id === submitted.id)).toBe(true);
    unsubscribe();
    await hostA.close();
    await hostB.close();
  });

  it('routes import through an explicit commit point with confirmation', async () => {
    const { host, storage } = await migratedHost();
    expect(host.ok).toBe(true);
    const exported = await host.featurePorts.portability.buildSnapshot();
    expect(typeof exported).toBe('string');
    const pointerBefore = await storage.control.getPointer();
    // Missing confirmation is refused before any commit point.
    const refused = await host.featurePorts.portability.restoreSnapshot(exported, {
      importId: 'imp-test-1',
      confirmation: '',
    } as never);
    expect(refused.ok).toBe(false);
    expect((await storage.control.getPointer()).generation).toBe(pointerBefore.generation);
    // Explicit confirmation commits exactly once.
    const section = host.coordination.beginCritical('write');
    expect(host.coordination.canActivateUpdate()).toBe(false);
    host.coordination.endCritical(section);
    const applied = await host.featurePorts.portability.restoreSnapshot(exported, {
      importId: 'imp-test-1',
      confirmation: 'REPLACE-ACTIVE-DATABASE',
    } as never);
    expect(applied.ok).toBe(true);
    const pointerAfter = await storage.control.getPointer();
    expect(pointerAfter.activeStorageId).toBe('imp-imp-test-1');
    expect(pointerAfter.generation).toBe(pointerBefore.generation + 1);
    await host.close();
  });

  it('routes reset through its confirmation and reopens before serving reads', async () => {
    const { host, storage } = await migratedHost();
    expect(host.ok).toBe(true);
    await expect(
      host.featurePorts.portability.factoryReset({ resetId: 'rst-1', confirmation: '' } as never),
    ).rejects.toThrow();
    expect((await storage.control.getPointer()).activeStorageId).toBe('mig-mg-test-0001');
    await host.featurePorts.portability.factoryReset({ resetId: 'rst-1', confirmation: 'RESET-GUEST-SCOPE' } as never);
    expect((await storage.control.getPointer()).activeStorageId).toBe('rst-rst-1');
    expect(host.featurePorts.home.listSelectedDayExpenses()).toEqual([]);
    await host.close();
  });

  it('fails closed on an invalid migration id before touching storage', async () => {
    const { context } = createDeterministicContext();
    const storage = createMemoryStorage({ context });
    const host = await prepareCanonicalCandidateHost({
      environment: { localStorage: memoryLocalStorage() } as unknown as typeof globalThis,
      context,
      snapshot: fakeV1Snapshot(),
      migrationId: 'has whitespace',
      coordination: createTabCoordinator({ tabId: 'id-tab', environment: SYNC_ENV, store: memoryStore() }),
      storage: storage as never,
    });
    expect(host.ok).toBe(false);
    expect(host.authority.kind).toBe('unavailable');
    await host.close();
  });

  it('routes host-bound ports through the latch with live authority', async () => {
    const { host, storage } = await migratedHost();
    expect(host.ok).toBe(true);
    const legacyPorts = { name: 'legacy-stub' };
    const resolution = resolveP04DAuthority(
      { mode: 'canonicalCandidate', candidatePorts: host.featurePorts as never },
      legacyPorts as never,
    );
    expect(resolution.mode).toBe('canonicalCandidate');
    expect(resolution.featurePorts).toBe(host.featurePorts);
    expect(resolution.authority.kind).toBe('canonicalReady');
    // Unmarked injections keep the D1 fail-close.
    const unmarked = resolveP04DAuthority(
      { mode: 'canonicalCandidate', candidatePorts: { name: 'forged' } as never },
      legacyPorts as never,
    );
    expect(unmarked.featurePorts).toBe(legacyPorts);
    expect(unmarked.authority.kind).toBe('canonicalPreparing');
    void storage;
    await host.close();
  });
});
