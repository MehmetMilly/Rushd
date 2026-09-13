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
import { selectWarmUrls, warmPwaCache } from '../../src/pwa/registration.js';
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
    const origin = 'http://127.0.0.1:4173';
    expect(selectWarmUrls(null, origin)).toEqual([]);
    expect(selectWarmUrls(
      [
        `${origin}/assets/index-abc123.js`,
        { url: `${origin}/pkg/dist/wa-sqlite.wasm` },
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
    ]);
    const many = Array.from({ length: 200 }, (_, index) => `${origin}/assets/chunk-${index}.js`);
    expect(selectWarmUrls(many, origin).length).toBeLessThanOrEqual(60);
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
    const warmed = await warmPwaCache({
      environment,
      urls: [`${origin}/a.js`, `${origin}/evicted.js`, `${origin}/b.js`],
    });
    expect(warmed).toEqual({ warmed: 2, requested: 3, reason: '' });
    expect(added).toEqual([`${origin}/a.js`, `${origin}/b.js`]);
    expect(await warmPwaCache({ environment: {} as typeof globalThis, urls: [`${origin}/a.js`] }))
      .toEqual({ warmed: 0, requested: 1, reason: 'cache-unavailable' });
    expect(await warmPwaCache({ environment })).toEqual({ warmed: 0, requested: 0, reason: 'no-urls' });
  });
});
