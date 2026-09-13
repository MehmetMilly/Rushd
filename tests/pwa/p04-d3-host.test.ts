/**
 * P04-D3 canonical-port gate (Node, deterministic).
 *
 * Proves the D3 Home/Add/Transactions behavior on the candidate host:
 * append-only corrections and reversals through `correctExpense`, batch
 * deletes with explicit partial failure, retry-stable operation identities,
 * blocked pay/reopen/auto-fill/bulk-unpaid actions, writer blocking while
 * preparing/unavailable, and import that preserves row identity. The
 * durable OPFS proof lives in the D3 Playwright harness.
 */
import { describe, expect, it } from 'vitest';
import { prepareCanonicalCandidateHost } from '../../src/application/p04-d/canonical-host.js';
import { createCandidateIdFactory, prepareCandidateShell } from '../../src/application/p04-d/candidate-shell.js';
import { createTabCoordinator } from '../../src/application/p04-d/tab-coordination.js';
import { mintOperationId } from '../../src/application/p04-d/command-gateway.js';
import { snapshotFromStores } from '../../src/data/migration/extract';
import { LEGACY_GUEST_BOOK_ID } from '../../src/data/migration/mapping';
import { makeBookId } from '../../src/domain/contracts/identity';
import { liveExpenseEntries } from '../../src/domain/activity/derive';
import { createDeterministicContext } from '../domain/support/deterministic-context';
import { createMemoryStorage } from './memory-storage';
import { readFile } from 'node:fs/promises';

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
  const coordination = createTabCoordinator({ tabId: 'd3-tab', environment: SYNC_ENV, store: memoryStore() });
  const storage = createMemoryStorage({ context });
  const host = await prepareCanonicalCandidateHost({
    environment: { localStorage: memoryLocalStorage() } as unknown as typeof globalThis,
    context,
    snapshot: fakeV1Snapshot(),
    migrationId: options.migrationId ?? 'mg-d3-0001',
    coordination,
    storage: storage as never,
    selectedDate: options.selectedDate ?? '2026-09-05',
  });
  return { context, coordination, storage, host };
}

function guestBookOf(storage: ReturnType<typeof createMemoryStorage>, storageId: string) {
  const repo = storage.inspect(storageId);
  expect(repo).not.toBeNull();
  const made = makeBookId(LEGACY_GUEST_BOOK_ID);
  expect(made.ok).toBe(true);
  if (!made.ok) throw new Error('bad guest book id');
  return repo!.getBookState(made.value);
}

describe('d3 corrections and reversals', () => {
  it('edits through a linked correction while audit history retains the original', async () => {
    const { host, storage } = await migratedHost({ migrationId: 'mg-d3-edit-1' });
    expect(host.ok).toBe(true);
    const submitted = await host.featurePorts.capture.submitExpense({ name: 'milk', cost: 9.5, category: 'food', date: '2026-09-05' });
    expect(submitted.ok).toBe(true);
    const before = await host.featurePorts.history.listDayExpenses('2026-09-05');
    const target = before.find((row) => row.id === submitted.id);
    expect(target).toBeDefined();

    const corrected = await host.featurePorts.history.updateExpense({
      id: submitted.id!,
      date: '2026-09-05',
      name: 'oat milk',
      expectedCost: 11,
      actualPaid: 11,
      isPaid: true,
      category: 'food',
      classification: 'essential',
    });
    expect(corrected.ok).toBe(true);

    // Live views update to the replacement; the original id is reversed away.
    const live = await host.featurePorts.history.listDayExpenses('2026-09-05');
    expect(live.some((row) => row.id === submitted.id)).toBe(false);
    const replacement = live.find((row) => row.id === corrected.id);
    expect(replacement?.name).toBe('oat milk');
    expect(replacement?.actualPaid).toBe(11);
    expect(replacement?.expectedCost).toBe(11);

    // Audit history retains every fact: original, reversal, replacement.
    const book = guestBookOf(storage, host.storageId);
    expect(book).not.toBeNull();
    const original = book!.entries.find((entry) => (entry as { entryId?: string }).entryId === submitted.id);
    expect(original).toBeDefined();
    const reversal = book!.entries.find(
      (entry) => entry.kind === 'expenseReversal' && (entry as { reversesEntryId?: string }).reversesEntryId === submitted.id,
    );
    expect(reversal).toBeDefined();
    expect(liveExpenseEntries(book!).length).toBe(live.length);
    await host.close();
  });

  it('deletes through a reversal while the live view hides the entry', async () => {
    const { host, storage } = await migratedHost({ migrationId: 'mg-d3-del-1' });
    expect(host.ok).toBe(true);
    const submitted = await host.featurePorts.capture.submitExpense({ name: 'milk', cost: 9.5, category: 'food', date: '2026-09-05' });
    expect(submitted.ok).toBe(true);
    const countBefore = (await host.featurePorts.history.listDayExpenses('2026-09-05')).length;

    const removed = await host.featurePorts.history.deleteExpense(submitted.id!);
    expect(removed.ok).toBe(true);
    const after = await host.featurePorts.history.listDayExpenses('2026-09-05');
    expect(after.length).toBe(countBefore - 1);
    expect(after.some((row) => row.id === submitted.id)).toBe(false);

    const book = guestBookOf(storage, host.storageId);
    expect(book!.entries.some((entry) => (entry as { entryId?: string }).entryId === submitted.id)).toBe(true);
    await host.close();
  });

  it('batch delete reverses individually and never reports false all-success', async () => {
    const { host } = await migratedHost({ migrationId: 'mg-d3-batch-1' });
    expect(host.ok).toBe(true);
    const first = await host.featurePorts.capture.submitExpense({ name: 'a', cost: 1, category: 'food', date: '2026-09-05' });
    const second = await host.featurePorts.capture.submitExpense({ name: 'b', cost: 2, category: 'food', date: '2026-09-05' });
    expect(first.ok && second.ok).toBe(true);

    const all = await host.featurePorts.history.deleteSelected([first.id!, second.id!]);
    expect(all).toMatchObject({ ok: true });

    const third = await host.featurePorts.capture.submitExpense({ name: 'c', cost: 3, category: 'food', date: '2026-09-05' });
    const partial = await host.featurePorts.history.deleteSelected([third.id!, 'no-such-entry']);
    expect(partial.ok).toBe(false);
    expect(partial.reason).toBe('partial');
    const live = await host.featurePorts.history.listDayExpenses('2026-09-05');
    expect(live.some((row) => row.id === third.id)).toBe(false);
    expect(host.featurePorts.history.getStatus().error).toMatch(/no-such-entry/);
    await host.close();
  });

  it('rejects unknown entries without committing', async () => {
    const { host, storage } = await migratedHost({ migrationId: 'mg-d3-unknown-1' });
    expect(host.ok).toBe(true);
    const bytesBefore = storage.inspect(host.storageId)!.snapshotBytes();
    expect(await host.featurePorts.history.updateExpense({
      id: 'no-such-entry', date: '2026-09-05', name: 'x', expectedCost: 1, actualPaid: 1, isPaid: true, category: 'food', classification: 'essential',
    })).toMatchObject({ ok: false, reason: 'validation' });
    expect(await host.featurePorts.history.deleteExpense('no-such-entry')).toMatchObject({ ok: false, reason: 'validation' });
    expect(storage.inspect(host.storageId)!.snapshotBytes()).toBe(bytesBefore);
    await host.close();
  });
});

describe('d3 operation identity', () => {
  it('replays a retried operation id without a second effect', async () => {
    const { host, storage, context } = await migratedHost({ migrationId: 'mg-d3-op-1' });
    expect(host.ok).toBe(true);
    const operationId = mintOperationId(context);
    const input = { name: 'milk', cost: 9.5, category: 'food', date: '2026-09-05', operationId: String(operationId) };
    const first = await host.featurePorts.capture.submitExpense(input);
    expect(first.ok).toBe(true);
    const mid = storage.inspect(host.storageId)!.snapshotBytes();
    const second = await host.featurePorts.capture.submitExpense(input);
    expect(second.ok).toBe(true);
    expect(storage.inspect(host.storageId)!.snapshotBytes()).toBe(mid);
    await host.close();
  });

  it('rejects a reused operation id with different content and writes nothing', async () => {
    const { host, storage, context } = await migratedHost({ migrationId: 'mg-d3-op-2' });
    expect(host.ok).toBe(true);
    const operationId = String(mintOperationId(context));
    const first = await host.featurePorts.capture.submitExpense({ name: 'milk', cost: 9.5, category: 'food', date: '2026-09-05', operationId });
    expect(first.ok).toBe(true);
    const mid = storage.inspect(host.storageId)!.snapshotBytes();
    const conflict = await host.featurePorts.capture.submitExpense({ name: 'different', cost: 1, category: 'food', date: '2026-09-05', operationId });
    expect(conflict.ok).toBe(false);
    expect(storage.inspect(host.storageId)!.snapshotBytes()).toBe(mid);
    await host.close();
  });

  it('mints reload-unique candidate identities', () => {
    const factory = createCandidateIdFactory();
    const seen = new Set([factory.newId('op'), factory.newId('op'), factory.newId('op')]);
    expect(seen.size).toBe(3);
    for (const id of seen) {
      expect(/^op-\S{4,}$/.test(id)).toBe(true);
    }
  });
});

describe('d3 blocked actions and authority', () => {
  it('blocks pay/reopen/auto-fill/bulk-unpaid without mutating state', async () => {
    const { host, storage } = await migratedHost({ migrationId: 'mg-d3-blocked-1' });
    expect(host.ok).toBe(true);
    const bytesBefore = storage.inspect(host.storageId)!.snapshotBytes();
    expect(await host.featurePorts.capture.payExpense('x', 1)).toMatchObject({ ok: false, reason: 'blocked' });
    expect(await host.featurePorts.capture.markUnpaid('x')).toMatchObject({ ok: false, reason: 'blocked' });
    expect(await host.featurePorts.capture.autoFillDay('2026-09-05')).toBe(0);
    expect(await host.featurePorts.history.markSelectedUnpaid(['x'])).toMatchObject({ ok: false, reason: 'blocked' });
    expect(storage.inspect(host.storageId)!.snapshotBytes()).toBe(bytesBefore);
    await host.close();
  });

  it('blocks every writer while preparing/unavailable and keeps reads committed', async () => {
    const { host, coordination } = await migratedHost({ migrationId: 'mg-d3-epoch-1' });
    expect(host.ok).toBe(true);
    coordination.bumpEpoch('incompatible-update');
    expect(await host.featurePorts.capture.submitExpense({ name: 'stale', cost: 1, category: 'food' })).toMatchObject({
      ok: false, reason: 'blocked',
    });
    expect(await host.featurePorts.history.deleteExpense('whatever')).toMatchObject({ ok: false, reason: 'blocked' });
    expect(host.featurePorts.authority.getState().kind).toBe('unavailable');
    // Reads still serve committed state; the shell stays mounted.
    expect(Array.isArray(host.featurePorts.home.listSelectedDayExpenses())).toBe(true);
    await host.close();
  });

  it('projects open-cycle availability instead of fabricating a zero', async () => {
    const { host } = await migratedHost({ migrationId: 'mg-d3-safe-1' });
    expect(host.ok).toBe(true);
    const amount = host.featurePorts.home.getSafeToSpend();
    expect(amount).not.toBeNull();
    expect(Number.isFinite(amount)).toBe(true);
    await host.close();
  });
});

describe('d3 import preserves row identity', () => {
  it('restores snapshot rows across the import commit point', async () => {
    const { host, storage } = await migratedHost({ migrationId: 'mg-d3-imp-1' });
    expect(host.ok).toBe(true);
    const submitted = await host.featurePorts.capture.submitExpense({ name: 'milk', cost: 9.5, category: 'food', date: '2026-09-05' });
    expect(submitted.ok).toBe(true);
    const rowsBefore = await host.featurePorts.history.listDayExpenses('2026-09-05');
    expect(rowsBefore.length).toBeGreaterThan(0);
    const exported = await host.featurePorts.portability.buildSnapshot();

    const applied = await host.featurePorts.portability.restoreSnapshot(exported, {
      importId: 'imp-d3-rows-1',
      confirmation: 'REPLACE-ACTIVE-DATABASE',
    } as never);
    expect(applied.ok).toBe(true);
    const rowsAfter = await host.featurePorts.history.listDayExpenses('2026-09-05');
    expect(rowsAfter).toEqual(rowsBefore);
    expect((await storage.control.getPointer()).activeStorageId).toBe('imp-imp-d3-rows-1');
    await host.close();
  });

  it('refuses a document without payload bytes', async () => {
    const { host } = await migratedHost({ migrationId: 'mg-d3-imp-2' });
    expect(host.ok).toBe(true);
    const pointerBefore = await host.coordination.beginCritical('write');
    host.coordination.endCritical(pointerBefore);
    const exported = JSON.parse(await host.featurePorts.portability.buildSnapshot());
    delete (exported as Record<string, unknown>).snapshotBytes;
    const refused = await host.featurePorts.portability.restoreSnapshot(JSON.stringify(exported), {
      importId: 'imp-d3-empty-1',
      confirmation: 'REPLACE-ACTIVE-DATABASE',
    } as never);
    expect(refused.ok).toBe(false);
    await host.close();
  });
});

describe('d3 correction: commit-then-false retry keeps exactly one actual', () => {
  it('replays a post-commit acknowledgement loss idempotently', async () => {
    const { context } = createDeterministicContext();
    const real = createTabCoordinator({ tabId: 'd3-lostack', environment: SYNC_ENV, store: memoryStore() });
    let announceThrows = 1;
    const coordination = {
      ...real,
      announceCommit: (info?: { storageId?: string; operationId?: string }) => {
        if (announceThrows > 0) {
          announceThrows -= 1;
          throw new Error('simulated lost acknowledgement after commit');
        }
        return real.announceCommit(info);
      },
    };
    const storage = createMemoryStorage({ context });
    const host = await prepareCanonicalCandidateHost({
      environment: { localStorage: memoryLocalStorage() } as unknown as typeof globalThis,
      context,
      snapshot: fakeV1Snapshot(),
      migrationId: 'mg-d3-lostack-1',
      coordination: coordination as never,
      storage: storage as never,
      selectedDate: '2026-09-05',
    });
    expect(host.ok).toBe(true);
    const operationId = 'op-correction-intent-0001';
    const input = { name: 'milk', cost: 9.5, category: 'food', date: '2026-09-05', operationId };
    // The write commits, then the acknowledgement is lost: a false failure.
    const first = await host.featurePorts.capture.submitExpense(input);
    expect(first).toMatchObject({ ok: false, reason: 'error' });
    // Retry with the same intent ID replays instead of duplicating.
    const second = await host.featurePorts.capture.submitExpense(input);
    expect(second.ok).toBe(true);
    const live = await host.featurePorts.history.listDayExpenses('2026-09-05');
    expect(live.filter((row) => row.name === 'milk').length).toBe(1);
    await host.close();
    real.close();
  });

  it('contains refresh failures instead of failing the committed write', async () => {
    const { host, storage } = await migratedHost({ migrationId: 'mg-d3-refreshfail-1' });
    expect(host.ok).toBe(true);
    const repo = storage.inspect(host.storageId);
    expect(repo).not.toBeNull();
    (repo as unknown as Record<string, unknown>).refresh = () => {
      throw new Error('simulated refresh outage');
    };
    const operationId = 'op-correction-intent-0002';
    const input = { name: 'bread-fail', cost: 2, category: 'food', date: '2026-09-05', operationId };
    const first = await host.featurePorts.capture.submitExpense(input);
    expect(first.ok).toBe(true);
    const second = await host.featurePorts.capture.submitExpense(input);
    expect(second.ok).toBe(true);
    const live = await host.featurePorts.history.listDayExpenses('2026-09-05');
    expect(live.filter((row) => row.name === 'bread-fail').length).toBe(1);
    await host.close();
  });
});

describe('d3 correction: correction IDs stay stable and never cross payloads', () => {
  it('replays an identical correction and conflicts on a different payload', async () => {
    const { host, storage } = await migratedHost({ migrationId: 'mg-d3-corrop-1' });
    expect(host.ok).toBe(true);
    const submitted = await host.featurePorts.capture.submitExpense({ name: 'milk', cost: 9.5, category: 'food', date: '2026-09-05' });
    expect(submitted.ok).toBe(true);
    const operationId = 'op-correction-intent-0003';
    const correction = {
      id: submitted.id!,
      date: '2026-09-05',
      name: 'oat milk',
      expectedCost: 11,
      actualPaid: 11,
      isPaid: true,
      category: 'food',
      classification: '',
    };
    const first = await host.featurePorts.history.updateExpense(correction, { operationId });
    expect(first.ok).toBe(true);
    // Identical retry replays idempotently.
    const replay = await host.featurePorts.history.updateExpense(correction, { operationId });
    expect(replay.ok).toBe(true);
    // Same ID with a different payload is refused and writes nothing.
    const bytesBefore = storage.inspect(host.storageId)!.snapshotBytes();
    const conflict = await host.featurePorts.history.updateExpense(
      { ...correction, name: 'different payload' },
      { operationId },
    );
    expect(conflict.ok).toBe(false);
    expect(storage.inspect(host.storageId)!.snapshotBytes()).toBe(bytesBefore);
    const live = await host.featurePorts.history.listDayExpenses('2026-09-05');
    expect(live.filter((row) => row.name === 'oat milk').length).toBe(1);
    expect(live.some((row) => row.name === 'different payload')).toBe(false);
    await host.close();
  });
});

describe('d3 correction: no fabricated classification or category', () => {
  it('leaves classification empty and preserves only real categories', async () => {
    const { host } = await migratedHost({ migrationId: 'mg-d3-nofake-1' });
    expect(host.ok).toBe(true);
    const submitted = await host.featurePorts.capture.submitExpense({
      name: 'luxury-watch',
      cost: 500,
      category: 'shopping',
      date: '2026-09-05',
    });
    expect(submitted.ok).toBe(true);
    const uncategorized = await host.featurePorts.capture.submitExpense({
      name: 'mystery',
      cost: 3,
      category: '',
      date: '2026-09-05',
    });
    expect(uncategorized.ok).toBe(true);
    const live = await host.featurePorts.history.listDayExpenses('2026-09-05');
    for (const row of live) {
      expect(row.classification).toBe('');
    }
    expect(live.find((row) => row.id === submitted.id)?.category).toBe('shopping');
    expect(live.find((row) => row.id === uncategorized.id)?.category).toBe('');
    await host.close();
  });

  it('projects a luxury migrated actual without an essential tag', async () => {
    const { context } = createDeterministicContext();
    const coordination = createTabCoordinator({ tabId: 'd3-lux', environment: SYNC_ENV, store: memoryStore() });
    const storage = createMemoryStorage({ context });
    const snapshot = snapshotFromStores({
      settings: [{ key: 'baseAllowance', value: 1500 }],
      templates: [],
      expenses: [
        {
          id: 'v1-lux',
          name: 'silk scarf',
          expectedCost: 300,
          actualPaid: 300,
          isPaid: true,
          date: '2026-09-05',
          category: 'shopping',
          classification: 'luxury',
        },
      ],
      sourcePresent: true,
    });
    const host = await prepareCanonicalCandidateHost({
      environment: { localStorage: memoryLocalStorage() } as unknown as typeof globalThis,
      context,
      snapshot,
      migrationId: 'mg-d3-lux-1',
      coordination,
      storage: storage as never,
      selectedDate: '2026-09-05',
    });
    expect(host.ok).toBe(true);
    const live = await host.featurePorts.history.listDayExpenses('2026-09-05');
    expect(live.length).toBe(1);
    expect(live[0].name).toBe('silk scarf');
    expect(live[0].classification).toBe('');
    expect(live[0].category).toBe('shopping');
    await host.close();
  });
});

describe('d3 candidate shell', () => {
  const stubVue = {
    createApp: () => ({
      mount: () => ({}),
      component: () => {},
      mixin: () => {},
      config: { globalProperties: {} },
    }),
    reactive: (value: unknown) => value,
    computed: (value: unknown) => value,
    watchEffect: () => {},
  };

  function stubEnvironment() {
    const cells = new Map<string, string>();
    return {
      localStorage: memoryLocalStorage(),
      document: { documentElement: { dataset: {} as Record<string, string>, style: {} }, querySelector: () => null },
      navigator: {},
      cells,
    } as unknown as typeof globalThis;
  }

  it('mounts the established application through build/test injection only', async () => {
    const { context } = createDeterministicContext();
    const storage = createMemoryStorage({ context });
    const template = await readFile('src/app/root-template.html', 'utf8');
    const shell = await prepareCandidateShell({
      Vue: stubVue as never,
      environment: stubEnvironment(),
      template,
      context,
      snapshot: fakeV1Snapshot(),
      migrationId: 'mg-d3-shell-1',
      storage: storage as never,
      selectedDate: '2026-09-05',
    });
    expect(shell.host.ok).toBe(true);
    expect(shell.authority.kind).toBe('canonicalReady');
    expect(shell.featurePorts).toBe(shell.host.featurePorts);
    expect(shell.featurePorts.home.listSelectedDayExpenses().length).toBeGreaterThan(0);
    // Ordinary production still passes no candidate inputs.
    const main = await readFile('src/main.ts', 'utf8');
    expect(main).not.toContain('canonicalCandidate');
    expect(main).not.toContain('candidatePorts');
    expect(main).not.toContain('serviceWorker');
    await shell.host.close();
  });

  it('rejects unknown injected port sets even in legacy mode', async () => {
    const { createLegacyApplication } = await import('../../src/application/bootstrap.js');
    expect(() =>
      createLegacyApplication({
        Vue: stubVue as never,
        environment: stubEnvironment(),
        template: '<div></div>',
        featurePorts: { authority: { name: 'authority' } } as never,
      }),
    ).toThrow(/refusing unknown featurePorts/);
  });
});
