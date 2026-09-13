/**
 * P04-D5 A55 correction gate (Node, deterministic).
 *
 * Focused regressions for the three physical-Android defects diagnosed at
 * `82d3262` in `artifacts/agent-reports/P04-D5-A55-DIAGNOSIS.md`. Each test
 * below fails on the base commit and passes with the correction:
 *
 * - A12/post-reset recovery: a confirmed factory reset leaves a usable
 *   canonical book (capture works immediately, no reload), and a fresh
 *   boot onto a committed-but-bookless namespace recovers the same way.
 *   Onboarding/setup claims are gated on `hasUsableBook()`.
 * - A9/two-tab visibility: an import/reset pointer flip retires every
 *   other tab's writer (epoch bump + storage-namespace guard), so stale
 *   writers cannot fork an orphaned namespace; a reloaded tab rejoins the
 *   current namespace. Ordinary commits stay visible across tabs.
 * - A12/backup-restore: a non-empty versioned export survives
 *   reset + re-import and remains usable.
 * - A8/offline support (Node half): the page-side PWA warming selector
 *   keeps same-origin assets only, capped and de-duplicated; the worker
 *   half (precache + navigation fallback) is asserted by
 *   `tests/pwa/static-checks.mjs`. The durable offline browser proof stays
 *   with the Playwright gate.
 *
 * All data is synthetic; no account/cloud client is constructed. The
 * durable OPFS path is proven separately by the browser harness; this
 * suite uses the in-memory adapter behind the real host, control store,
 * and coordination protocol.
 */
import { describe, expect, it } from 'vitest';
import { prepareCanonicalCandidateHost } from '../../src/application/p04-d/canonical-host.js';
import { createTabCoordinator } from '../../src/application/p04-d/tab-coordination.js';
import { snapshotFromStores } from '../../src/data/migration/extract';
import { createMemoryControlStore } from '../../src/data/migration/control-store';
import {
  REPLACE_ACTIVE_CONFIRMATION,
  RESET_SCOPE_CONFIRMATION,
} from '../../src/data/portability/format';
// D5 round-2: dynamic import keeps fail-on-base reproducible. A full
// product revert removes these exports; the A8 cases then fail as plain
// assertions instead of breaking module load (see the first assertion in
// each A8 case).
const registration = await import('../../src/pwa/registration.js').catch(() => ({} as Record<string, never>));
const { selectWarmUrls, warmPwaCache } = registration as {
  selectWarmUrls?: (entries: Array<{ url?: unknown; name?: unknown } | string> | null | undefined, origin: string) => string[];
  warmPwaCache?: (options?: { environment?: typeof globalThis; cacheName?: string; urls?: string[] }) => Promise<{ warmed: number; requested: number; reason: string }>;
};
import { createDeterministicContext } from '../domain/support/deterministic-context';
import { createMemoryStorage } from './memory-storage';

const SYNC_ENV = {} as unknown as typeof globalThis;
const SELECTED_DATE = '2026-09-13';

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
    settings: [{ key: 'baseAllowance', value: 1500 }],
    templates: [],
    expenses: [
      {
        id: 'v1-bread', name: 'bread', expectedCost: 12, actualPaid: 12, isPaid: true,
        date: '2026-09-05', category: 'food', classification: 'essential',
      },
    ],
    sourcePresent: true,
  });
}

/** One tab's stack. Tabs share control + coordination stores like same-origin tabs share storage. */
async function openTab(options: {
  tag: string;
  control: ReturnType<typeof createMemoryControlStore>;
  coordStore: ReturnType<typeof memoryStore>;
  storage: ReturnType<typeof createMemoryStorage>;
  snapshot?: ReturnType<typeof fakeV1Snapshot> | undefined;
  migrationId?: string;
  tabId?: string;
  bus?: { postMessage(message: unknown): void; onmessage: ((message: never) => void) | null; close?: () => void };
}) {
  const { context: deterministic } = createDeterministicContext({ deviceId: 'dev-a55-correction' });
  let counter = 0;
  const context = {
    ...deterministic,
    ids: {
      // Reload-unique per tab: two tabs must never mint the same operation
      // identity, mirroring production's per-load UUID factory.
      newId: (prefix: string) => `${prefix}-${options.tag}-${(counter += 1)}`,
    },
  };
  const coordination = createTabCoordinator({
    tabId: options.tabId ?? `a55-${options.tag}`,
    environment: SYNC_ENV,
    store: options.coordStore,
    ...(options.bus ? { bus: options.bus } : {}),
  });
  const host = await prepareCanonicalCandidateHost({
    environment: { localStorage: memoryLocalStorage() } as unknown as typeof globalThis,
    context,
    snapshot: options.snapshot,
    migrationId: options.migrationId ?? `mg-a55-${options.tag}`,
    coordination,
    storage: options.storage as never,
    selectedDate: SELECTED_DATE,
  });
  return { host, coordination, context };
}

let operationCounter = 0;
function uniqueOperationId(tag: string): string {
  operationCounter += 1;
  return `op-${tag}-${operationCounter}`;
}

async function submitDayExpense(host: Awaited<ReturnType<typeof prepareCanonicalCandidateHost>>, tag: string, name: string, cost: number) {
  return host.featurePorts.capture.submitExpense({
    name,
    cost,
    category: 'food',
    date: SELECTED_DATE,
    operationId: uniqueOperationId(tag),
  });
}

describe('P04-D5 A55 correction', () => {
  it('A12: factory reset leaves an immediately usable book (no reload, no restore needed)', async () => {
    const control = createMemoryControlStore();
    const coordStore = memoryStore();
    const { context } = createDeterministicContext({ deviceId: 'dev-a55-correction' });
    const storage = createMemoryStorage({ context, control });
    const tab = await openTab({ tag: 'reset', control, coordStore, storage, snapshot: fakeV1Snapshot() });
    expect(tab.host.ok).toBe(true);
    expect(tab.host.featurePorts.lifecycle.hasUsableBook()).toBe(true);

    const before = await submitDayExpense(tab.host, 'reset', 'a55-qa-snack', 12.34);
    expect(before.ok).toBe(true);

    await tab.host.featurePorts.portability.factoryReset({
      resetId: 'rs-a55-01',
      confirmation: RESET_SCOPE_CONFIRMATION,
    });
    expect(String(tab.host.storageId).startsWith('rst-')).toBe(true);
    // The resetter keeps a supported scope: a usable book exists and the
    // first post-reset write commits without a reload or a restore.
    expect(tab.host.featurePorts.lifecycle.hasUsableBook()).toBe(true);
    expect(tab.host.featurePorts.authority.getState().kind).toBe('canonicalReady');
    const after = await submitDayExpense(tab.host, 'reset', 'a55-post-reset', 4.56);
    expect(after.ok).toBe(true);
    const rows = tab.host.featurePorts.home.listSelectedDayExpenses();
    expect(rows.map((row) => row.name)).toContain('a55-post-reset');
    expect(rows.map((row) => row.name)).not.toContain('a55-qa-snack');
    await tab.host.close();
  });

  it('A12: boot onto a committed-but-bookless namespace recovers a usable book', async () => {
    const { context } = createDeterministicContext({ deviceId: 'dev-a55-correction' });
    const control = createMemoryControlStore();
    // Simulate a pre-correction reset namespace: committed pointer, empty
    // database, no guest book.
    const pointer = await control.getPointer();
    const storage = createMemoryStorage({ context, control });
    await control.compareAndSwapPointer(pointer.generation, {
      activeStorageId: 'rst-legacy-bookless',
      schemaVersion: 1,
      migrationId: null,
      importId: null,
      sourceFingerprint: null,
      importDocumentDigest: null,
      committedAtMs: 1,
      activationCommitted: true,
    });
    await storage.openActive('rst-legacy-bookless', { reset: true });
    const tab = await openTab({ tag: 'bookless', control, coordStore: memoryStore(), storage });
    expect(tab.host.ok).toBe(true);
    expect(tab.host.featurePorts.lifecycle.hasUsableBook()).toBe(true);
    const result = await submitDayExpense(tab.host, 'bookless', 'a55-recovered', 7);
    expect(result.ok).toBe(true);
    await tab.host.close();
  });

  it('A9: an import/reset flip retires the other tab until it reloads; reload rejoins', async () => {
    const control = createMemoryControlStore();
    const coordStore = memoryStore();
    const { context } = createDeterministicContext({ deviceId: 'dev-a55-correction' });
    const storage = createMemoryStorage({ context, control });
    const tabA = await openTab({ tag: 'flipA', control, coordStore, storage, snapshot: fakeV1Snapshot() });
    const tabB = await openTab({ tag: 'flipB', control, coordStore, storage });
    expect(tabB.host.ok).toBe(true);

    // Ordinary commit convergence across tabs (no flip involved).
    const shared = await submitDayExpense(tabA.host, 'flipA', 'a55-two-tab', 4.56);
    expect(shared.ok).toBe(true);
    await tabB.host.refresh();
    expect(tabB.host.featurePorts.home.listSelectedDayExpenses().map((row) => row.name))
      .toContain('a55-two-tab');

    // The flip: tab A resets. A stays writable (it holds the new repo and
    // rebased onto its own activation bump); tab B hard-blocks.
    await tabA.host.featurePorts.portability.factoryReset({
      resetId: 'rs-a55-flip',
      confirmation: RESET_SCOPE_CONFIRMATION,
    });
    expect(tabA.host.featurePorts.authority.getState().kind).toBe('canonicalReady');
    const performerWrite = await submitDayExpense(tabA.host, 'flipA', 'a55-after-flip', 1);
    expect(performerWrite.ok).toBe(true);

    expect(tabB.host.featurePorts.authority.getState().kind).toBe('unavailable');
    const staleWrite = await submitDayExpense(tabB.host, 'flipB', 'a55-stale-fork', 99);
    expect(staleWrite.ok).toBe(false);

    // Reload rejoins the current namespace with a usable book.
    await tabB.host.close();
    const tabB2 = await openTab({ tag: 'flipB', control, coordStore, storage, tabId: 'a55-flipB' });
    expect(tabB2.host.storageId).toBe(tabA.host.storageId);
    expect(tabB2.host.featurePorts.authority.getState().kind).toBe('canonicalReady');
    expect(tabB2.host.featurePorts.lifecycle.hasUsableBook()).toBe(true);
    const rejoined = await submitDayExpense(tabB2.host, 'flipB', 'a55-rejoined', 2);
    expect(rejoined.ok).toBe(true);
    await tabB2.host.refresh();
    expect(tabB2.host.featurePorts.home.listSelectedDayExpenses().map((row) => row.name))
      .toContain('a55-after-flip');
    await tabA.host.close();
    await tabB2.host.close();
  });

  it('A9: a tab that misses the flip broadcast is still blocked by the namespace guard', async () => {
    const control = createMemoryControlStore();
    const coordStore = memoryStore();
    const { context } = createDeterministicContext({ deviceId: 'dev-a55-correction' });
    const storage = createMemoryStorage({ context, control });
    const tab = await openTab({ tag: 'guard', control, coordStore, storage, snapshot: fakeV1Snapshot() });
    expect(tab.host.ok).toBe(true);
    const heldStorageId = tab.host.storageId;

    // A commit announcement naming a namespace this host does not hold is
    // exactly what an import/reset flip looks like to a tab that missed
    // the epoch broadcast. The host must go visibly unavailable instead
    // of refreshing (and writing) an orphaned namespace.
    const foreign = createTabCoordinator({ tabId: 'a55-foreign', environment: SYNC_ENV, store: coordStore });
    foreign.announceCommit({ storageId: 'imp-foreign-flip' });
    expect(tab.host.storageId).toBe(heldStorageId);
    expect(tab.host.featurePorts.authority.getState().kind).toBe('unavailable');
    const staleWrite = await submitDayExpense(tab.host, 'guard', 'a55-guard-fork', 50);
    expect(staleWrite.ok).toBe(false);

    // A same-namespace commit announcement still refreshes instead of
    // blocking: ordinary cross-tab writes keep converging.
    await tab.host.close();
    const tab2 = await openTab({ tag: 'guard', control, coordStore, storage, tabId: 'a55-guard' });
    expect(tab2.host.featurePorts.authority.getState().kind).toBe('canonicalReady');
    foreign.announceCommit({ storageId: tab2.host.storageId });
    const converged = await submitDayExpense(tab2.host, 'guard', 'a55-guard-converged', 3);
    expect(converged.ok).toBe(true);
    foreign.close();
    await tab.host.close().catch(() => undefined);
    await tab2.host.close();
  });

  it('A12: a non-empty versioned export restores after reset and remains usable', async () => {
    const control = createMemoryControlStore();
    const coordStore = memoryStore();
    const { context } = createDeterministicContext({ deviceId: 'dev-a55-correction' });
    const storage = createMemoryStorage({ context, control });
    const tab = await openTab({ tag: 'backup', control, coordStore, storage, snapshot: fakeV1Snapshot() });

    expect((await submitDayExpense(tab.host, 'backup', 'a55-exported-one', 10)).ok).toBe(true);
    expect((await submitDayExpense(tab.host, 'backup', 'a55-exported-two', 20)).ok).toBe(true);
    const backup = await tab.host.featurePorts.portability.buildSnapshot();
    expect(typeof backup).toBe('string');
    expect(backup).toContain('a55-exported-one');
    expect(backup).toContain('a55-exported-two');

    await tab.host.featurePorts.portability.factoryReset({
      resetId: 'rs-a55-backup',
      confirmation: RESET_SCOPE_CONFIRMATION,
    });
    expect(tab.host.featurePorts.home.listSelectedDayExpenses().length).toBe(0);

    const restored = await tab.host.featurePorts.portability.restoreSnapshot(backup, {
      importId: 'im-a55-backup',
      confirmation: REPLACE_ACTIVE_CONFIRMATION,
    });
    expect(restored.ok).toBe(true);
    const names = tab.host.featurePorts.home.listSelectedDayExpenses().map((row) => row.name);
    expect(names).toContain('a55-exported-one');
    expect(names).toContain('a55-exported-two');
    // The restored scope remains usable for new writes.
    expect((await submitDayExpense(tab.host, 'backup', 'a55-after-restore', 5)).ok).toBe(true);
    await tab.host.close();
  });

  it('A12: post-reset writes are captured by the safety export and survive re-import', async () => {
    const control = createMemoryControlStore();
    const coordStore = memoryStore();
    const { context } = createDeterministicContext({ deviceId: 'dev-a55-correction' });
    const storage = createMemoryStorage({ context, control });
    const tab = await openTab({ tag: 'safety', control, coordStore, storage, snapshot: fakeV1Snapshot() });

    // The export-first reset safety net is only meaningful when the scope
    // stays writable after reset: the post-reset write below must commit
    // (it stays in the modal on the base commit), enter the safety
    // export, and come back through re-import.
    await tab.host.featurePorts.portability.factoryReset({
      resetId: 'rs-a55-safety',
      confirmation: RESET_SCOPE_CONFIRMATION,
    });
    expect((await submitDayExpense(tab.host, 'safety', 'a55-safety-row', 8)).ok).toBe(true);
    const safety = await tab.host.featurePorts.portability.buildSnapshot();
    expect(safety).toContain('a55-safety-row');

    await tab.host.featurePorts.portability.factoryReset({
      resetId: 'rs-a55-safety-2',
      confirmation: RESET_SCOPE_CONFIRMATION,
    });
    expect(tab.host.featurePorts.home.listSelectedDayExpenses().length).toBe(0);
    const restored = await tab.host.featurePorts.portability.restoreSnapshot(safety, {
      importId: 'im-a55-safety',
      confirmation: REPLACE_ACTIVE_CONFIRMATION,
    });
    expect(restored.ok).toBe(true);
    expect(tab.host.featurePorts.home.listSelectedDayExpenses().map((row) => row.name))
      .toContain('a55-safety-row');
    await tab.host.close();
  });

  it('A8: page-side warming keeps same-origin assets only, capped and de-duplicated', () => {
    expect(typeof selectWarmUrls).toBe('function');
    const origin = 'http://127.0.0.1:4173';
    expect(selectWarmUrls!(null, origin)).toEqual([]);
    expect(selectWarmUrls!(
      [
        `${origin}/assets/index-abc123.js`,
        { url: `${origin}/pkg/dist/wa-sqlite.wasm` },
        // PerformanceResourceTiming exposes `name`, not `url`.
        { name: `${origin}/assets/index-abc123.css` },
        `${origin}/assets/index-abc123.js`,
        'https://cdn.example.com/remote.js',
        'data:text/plain,hi',
        '',
        { url: null },
      ],
      origin,
    )).toEqual([
      `${origin}/assets/index-abc123.js`,
      `${origin}/pkg/dist/wa-sqlite.wasm`,
      `${origin}/assets/index-abc123.css`,
    ]);
    const many = Array.from({ length: 200 }, (_, index) => `${origin}/assets/chunk-${index}.js`);
    expect(selectWarmUrls!(many, origin).length).toBeLessThanOrEqual(60);
  });

  it('A8: cache warming is best-effort and never throws', async () => {
    const added: string[] = [];
    const environment = {
      caches: {
        open: async () => ({
          add: async (url: string) => {
            if (url.includes('evicted')) throw new Error('quota');
            added.push(url);
          },
        }),
      },
    } as unknown as typeof globalThis;
    const origin = 'http://127.0.0.1:4173';
    expect(typeof warmPwaCache).toBe('function');
    const warmed = await warmPwaCache!({
      environment,
      urls: [`${origin}/a.js`, `${origin}/evicted.js`, `${origin}/b.js`],
    });
    expect(warmed).toEqual({ warmed: 2, requested: 3, reason: '' });
    expect(added).toEqual([`${origin}/a.js`, `${origin}/b.js`]);
    expect(await warmPwaCache!({ environment: {} as typeof globalThis, urls: [`${origin}/a.js`] }))
      .toEqual({ warmed: 0, requested: 1, reason: 'cache-unavailable' });
    expect(await warmPwaCache!({ environment })).toEqual({ warmed: 0, requested: 0, reason: 'no-urls' });
  });

  it('A9 round-2: flip, epoch bump, namespace announce, then provision — in that order', async () => {
    const control = createMemoryControlStore();
    const coordStore = memoryStore();
    const { context } = createDeterministicContext({ deviceId: 'dev-a55-correction' });
    const storage = createMemoryStorage({ context, control });
    const tabA = await openTab({ tag: 'orderA', control, coordStore, storage, snapshot: fakeV1Snapshot() });

    // Instrument the adoption sequence: pointer flip, epoch bump,
    // namespace announcements, and the first post-flip repository write.
    const events: string[] = [];
    const announced: string[] = [];
    const performer = tabA.coordination as unknown as Record<string, (...args: never[]) => unknown>;
    const baseBump = tabA.coordination.bumpEpoch.bind(tabA.coordination);
    performer['bumpEpoch'] = ((reason?: string) => {
      events.push('bump');
      return baseBump(reason);
    }) as never;
    const baseAnnounce = tabA.coordination.announceCommit.bind(tabA.coordination);
    performer['announceCommit'] = ((info?: { storageId?: string }) => {
      if (typeof info?.storageId === 'string') announced.push(info.storageId);
      return baseAnnounce(info);
    }) as never;
    const rawControl = control as unknown as Record<string, (...args: never[]) => Promise<{ ok: boolean }>>;
    const baseCas = control.compareAndSwapPointer.bind(control);
    rawControl['compareAndSwapPointer'] = (async (...args: never[]) => {
      const result = await baseCas(...(args as [number, Omit<Parameters<typeof baseCas>[1], 'generation'>]));
      if (result.ok) events.push('flip');
      return result;
    }) as never;
    const rawStorage = storage as unknown as Record<string, (...args: never[]) => Promise<{ openActive?: never } & Record<string, unknown>>>;
    const baseOpen = storage.openActive.bind(storage);
    rawStorage['openActive'] = (async (...args: never[]) => {
      const repository = (await baseOpen(...(args as [string, { reset?: boolean }]))) as unknown as Record<string, (...a: never[]) => Promise<unknown>>;
      const baseRun = (repository['runTransaction'] as (...a: never[]) => Promise<unknown>).bind(repository);
      repository['runTransaction'] = (async (...args: never[]) => {
        if (events.includes('flip')) events.push('provision-tx');
        return baseRun(...args);
      }) as never;
      return repository;
    }) as never;

    await tabA.host.featurePorts.portability.factoryReset({
      resetId: 'rs-a55-order',
      confirmation: RESET_SCOPE_CONFIRMATION,
    });
    const flipAt = events.indexOf('flip');
    const bumpAt = events.indexOf('bump');
    const provisionAt = events.indexOf('provision-tx');
    expect(flipAt).toBeGreaterThanOrEqual(0);
    expect(bumpAt).toBeGreaterThanOrEqual(0);
    expect(provisionAt).toBeGreaterThanOrEqual(0);
    // No orphan-write window: the epoch retires stale tabs before any
    // reopen/provision command runs on the new namespace.
    expect(flipAt).toBeLessThan(bumpAt);
    expect(bumpAt).toBeLessThan(provisionAt);
    // The new namespace is announced before provisioning serves it.
    expect(announced).toContain(tabA.host.storageId);
    await tabA.host.close();
  });

  it('A9 round-2: adoption holds one outer lease; provision nests no write section', async () => {
    const control = createMemoryControlStore();
    const coordStore = memoryStore();
    const { context } = createDeterministicContext({ deviceId: 'dev-a55-correction' });
    const storage = createMemoryStorage({ context, control });
    const tabA = await openTab({ tag: 'leaseA', control, coordStore, storage, snapshot: fakeV1Snapshot() });

    let begins = 0;
    let ends = 0;
    const performer = tabA.coordination as unknown as Record<string, (...args: never[]) => unknown>;
    const baseBegin = tabA.coordination.beginCritical.bind(tabA.coordination);
    performer['beginCritical'] = ((kind: string) => {
      begins += 1;
      return baseBegin(kind as 'write');
    }) as never;
    const baseEnd = tabA.coordination.endCritical.bind(tabA.coordination);
    performer['endCritical'] = ((token: { kind: string; tabId: string }) => {
      ends += 1;
      return baseEnd(token);
    }) as never;

    await tabA.host.featurePorts.portability.factoryReset({
      resetId: 'rs-a55-lease',
      confirmation: RESET_SCOPE_CONFIRMATION,
    });
    // Exactly the outer reset section: a nested write section would begin
    // and end a second lease, dropping the outer one mid-adoption and
    // reopening update activation while adoption still runs.
    expect(begins).toBe(1);
    expect(ends).toBe(1);
    expect(tabA.coordination.canActivateUpdate()).toBe(true);
    await tabA.host.close();
  });

  it('A9 round-2: a deaf tab is still blocked by the persisted epoch it never received', async () => {
    const control = createMemoryControlStore();
    const sharedCoordStore = memoryStore();
    const { context } = createDeterministicContext({ deviceId: 'dev-a55-correction' });
    const storage = createMemoryStorage({ context, control });
    const tabA = await openTab({ tag: 'deafA', control, coordStore: sharedCoordStore, storage, snapshot: fakeV1Snapshot() });
    // Deaf bus: sends nothing receivable, receives nothing. The tab still
    // shares the persisted coordination store like a frozen phone tab
    // shares localStorage.
    const deafBus = {
      postMessage() {},
      set onmessage(_handler: ((message: never) => void) | null) {},
      get onmessage() {
        return null;
      },
      close() {},
    };
    const tabB = await openTab({ tag: 'deafB', control, coordStore: sharedCoordStore, storage, bus: deafBus });

    await tabA.host.featurePorts.portability.factoryReset({
      resetId: 'rs-a55-deaf',
      confirmation: RESET_SCOPE_CONFIRMATION,
    });
    // B received no broadcast, yet every write attempt re-reads the
    // persisted epoch and must refuse the orphaned namespace.
    expect(tabB.coordination.getEpoch()).toBe(1);
    expect(tabB.host.featurePorts.authority.getState().kind).toBe('canonicalReady');
    const staleWrite = await submitDayExpense(tabB.host, 'deafB', 'a55-deaf-fork', 50);
    expect(staleWrite.ok).toBe(false);
    expect(tabB.host.featurePorts.authority.getState().kind).toBe('unavailable');
    await tabA.host.close();
    await tabB.host.close();
  });

  it('A9 round-2: epoch and broadcast both missed still refuses via namespace currency', async () => {    const control = createMemoryControlStore();
    const { context } = createDeterministicContext({ deviceId: 'dev-a55-correction' });
    const storage = createMemoryStorage({ context, control });
    const tabA = await openTab({ tag: 'curA', control, coordStore: memoryStore(), storage, snapshot: fakeV1Snapshot() });
    // Private coordination store plus a deaf bus: this tab observes
    // neither the persisted epoch nor any broadcast.
    const deafBus = {
      postMessage() {},
      set onmessage(_handler: ((message: never) => void) | null) {},
      get onmessage() {
        return null;
      },
      close() {},
    };
    const tabB = await openTab({ tag: 'curB', control, coordStore: memoryStore(), storage, bus: deafBus });

    await tabA.host.featurePorts.portability.factoryReset({
      resetId: 'rs-a55-cur',
      confirmation: RESET_SCOPE_CONFIRMATION,
    });
    expect(tabB.coordination.getEpoch()).toBe(0);
    expect(tabB.host.featurePorts.authority.getState().kind).toBe('canonicalReady');
    // The per-write namespace check is the last line: the pointer moved
    // on, so the held repository is orphaned and the write must refuse.
    const staleWrite = await submitDayExpense(tabB.host, 'curB', 'a55-cur-fork', 50);
    expect(staleWrite.ok).toBe(false);
    expect(tabB.host.featurePorts.authority.getState().kind).toBe('unavailable');
    // No fork happened: the orphaned namespace holds no stray row.
    await tabB.host.refresh();
    expect(tabB.host.featurePorts.home.listSelectedDayExpenses().map((row) => row.name))
      .not.toContain('a55-cur-fork');
    await tabA.host.close();
    await tabB.host.close();
  });

  it('A9 round-2: failed adoption fails the performer closed instead of forking', async () => {
    const control = createMemoryControlStore();
    const coordStore = memoryStore();
    const { context } = createDeterministicContext({ deviceId: 'dev-a55-correction' });
    const storage = createMemoryStorage({ context, control });
    const tabA = await openTab({ tag: 'failA', control, coordStore, storage, snapshot: fakeV1Snapshot() });

    // Break the reopen of the flipped namespace: the epoch already moved
    // and other tabs already retired, so the performer must go
    // unavailable rather than keep writing its orphaned repository.
    const rawStorage = storage as unknown as Record<string, (...args: never[]) => Promise<unknown>>;
    const baseOpen = storage.openActive.bind(storage);
    let breakNext = false;
    rawStorage['openActive'] = (async (...args: never[]) => {
      if (breakNext) {
        breakNext = false;
        throw new Error('injected reopen failure');
      }
      return baseOpen(...(args as [string, { reset?: boolean }]));
    }) as never;
    breakNext = true;
    await expect(tabA.host.featurePorts.portability.factoryReset({
      resetId: 'rs-a55-fail',
      confirmation: RESET_SCOPE_CONFIRMATION,
    })).rejects.toThrow();
    expect(tabA.host.featurePorts.authority.getState().kind).toBe('unavailable');
    const stray = await submitDayExpense(tabA.host, 'failA', 'a55-fail-fork', 50);
    expect(stray.ok).toBe(false);
    await tabA.host.close();
  });

  it('A9 round-3: same-namespace commits notify onCommitted without changing writability', async () => {
    const control = createMemoryControlStore();
    const coordStore = memoryStore();
    const { context } = createDeterministicContext({ deviceId: 'dev-a55-correction' });
    const storage = createMemoryStorage({ context, control });
    const tabA = await openTab({ tag: 'liveA', control, coordStore, storage, snapshot: fakeV1Snapshot() });
    const tabB = await openTab({ tag: 'liveB', control, coordStore, storage });
    expect(typeof tabA.host.onCommitted).toBe('function');

    const notified: Array<{ storageId: string }> = [];
    const off = tabA.host.onCommitted((info) => {
      notified.push({ storageId: String(info.storageId) });
    });
    const committed = await submitDayExpense(tabB.host, 'liveB', 'a55-live-row', 6);
    expect(committed.ok).toBe(true);
    // The broadcast refresh + notify path is async: poll briefly.
    const deadline = Date.now() + 2000;
    while (notified.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(notified.length).toBeGreaterThan(0);
    expect(notified[notified.length - 1]!.storageId).toBe(tabA.host.storageId);
    // Read-only throughout: the observing tab stays writable, and a re-read
    // serves the committed row (exactly what the UI re-mirror paints).
    expect(tabA.host.featurePorts.authority.getState().kind).toBe('canonicalReady');
    await tabA.host.refresh();
    expect(tabA.host.featurePorts.home.listSelectedDayExpenses().map((row) => row.name))
      .toContain('a55-live-row');
    off();
    await tabA.host.close();
    await tabB.host.close();
  });

  it('A9 round-3: foreign-namespace flips never notify onCommitted', async () => {
    const control = createMemoryControlStore();
    const coordStore = memoryStore();
    const { context } = createDeterministicContext({ deviceId: 'dev-a55-correction' });
    const storage = createMemoryStorage({ context, control });
    const tab = await openTab({ tag: 'liveF', control, coordStore, storage, snapshot: fakeV1Snapshot() });
    let notified = 0;
    tab.host.onCommitted(() => {
      notified += 1;
    });
    const foreign = createTabCoordinator({ tabId: 'a55-live-foreign', environment: SYNC_ENV, store: coordStore });
    foreign.announceCommit({ storageId: 'imp-live-foreign' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    // Retired, not re-mirrored: no notify, visibly unavailable.
    expect(notified).toBe(0);
    expect(tab.host.featurePorts.authority.getState().kind).toBe('unavailable');
    foreign.close();
    await tab.host.close();
  });
});
