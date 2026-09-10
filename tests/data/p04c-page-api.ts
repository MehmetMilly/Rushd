/**
 * Same-origin page API for P04-C migration and portability browser tests.
 * Synthetic fixtures only. No account or cloud client is constructed.
 */
/* eslint-env browser */

import { createDeterministicContext, DEFAULT_GUEST_KEY } from '../domain/support/deterministic-context';
import { makeDeviceId, makeGuestKey, repositoryScopeIdFor } from '../../src/domain/sync/scope';
import { extractLegacyIndexedDb, snapshotFromP00Fixture, sourceFingerprintOf } from '../../src/data/migration/extract';
import { LEGACY_GUEST_BOOK_ID, DEFAULT_TIME_ZONE, planLegacyMigration } from '../../src/data/migration/mapping';
import { isValidTimeZoneName } from '../../src/domain/primitives/instant';
import { createIndexedDbControlStore, createMemoryControlStore, DEFAULT_ACTIVE_STORAGE_ID, type ControlStore } from '../../src/data/migration/control-store';
import { openActiveGuestRepository, runLegacyMigration, type MigrationFailAt } from '../../src/data/migration/staging';
import { makeBookId, makeOperationId } from '../../src/domain/contracts/identity';
import { executeCommand, previewCommand } from '../../src/application/commands';
import { asDurableTransaction } from '../../src/data/v2/repository';
import { makeReplicationStreamId, makeSyncCursor } from '../../src/domain/sync/cursors';
import { SYNC_CURSOR_SCHEMA_VERSION } from '../../src/domain/sync/cursors';
import { canonicalJson, stableDigest } from '../../src/domain/contracts/canonical';
import {
  exportActiveSnapshot,
  importPortableReplacement,
  previewPortableImport,
  REPLACE_ACTIVE_CONFIRMATION,
  RESET_SCOPE_CONFIRMATION,
  resetGuestScope,
} from '../../src/data/portability';
import { LOCAL_SCHEMA_VERSION } from '../../src/data/v2/schema';
import { SQLITE_ENGINE_VERSION } from '../../src/data/v2/protocol';
import { databaseNamespaceFor } from '../../src/data/v2/namespace';
import type { PortabilityRuntime } from '../../src/data/portability/snapshot';

const WORKER_URL = '/harness/v2-worker.js';
const SQLITE_BASE = '/pkg';
const DEVICE = 'test-device-0001';
const TEST_CAS_RACE_DB = 'Rushd_P04C_TestCasRace';

type CasRaceRef = { readonly raceId: string; readonly participantId: string };

function origin() {
  const device = makeDeviceId(DEVICE);
  const guest = makeGuestKey(DEFAULT_GUEST_KEY);
  if (!device.ok || !guest.ok) throw new Error('invalid test origin');
  const boundScope = repositoryScopeIdFor({ kind: 'guest', guestKey: guest.value, deviceId: device.value });
  const { context } = createDeterministicContext({ deviceId: DEVICE });
  return { boundScope, boundDevice: device.value, context };
}

async function seedLegacy(stores: { settings?: unknown[]; templates?: unknown[]; expenses?: unknown[] }) {
  await new Promise<void>((resolve, reject) => {
    const del = indexedDB.deleteDatabase('MicroSaveOS_DB');
    del.onsuccess = () => resolve();
    del.onerror = () => reject(del.error ?? new Error('failed to delete legacy db'));
    del.onblocked = () => resolve();
  });
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('MicroSaveOS_DB', 1);
    request.onupgradeneeded = () => {
      const next = request.result;
      if (!next.objectStoreNames.contains('settings')) next.createObjectStore('settings', { keyPath: 'key' });
      if (!next.objectStoreNames.contains('templates')) next.createObjectStore('templates', { keyPath: 'id' });
      if (!next.objectStoreNames.contains('expenses')) next.createObjectStore('expenses', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('failed to seed MicroSaveOS_DB'));
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['settings', 'templates', 'expenses'], 'readwrite');
    for (const row of stores.settings ?? []) tx.objectStore('settings').put(row);
    for (const row of stores.templates ?? []) tx.objectStore('templates').put(row);
    for (const row of stores.expenses ?? []) tx.objectStore('expenses').put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('seed transaction failed'));
  });
  db.close();
}

async function readLegacyCounts() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('MicroSaveOS_DB', 1);
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      reject(new Error('legacy database was upgraded'));
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('failed to reopen legacy db'));
  });
  const tx = db.transaction(['settings', 'templates', 'expenses'], 'readonly');
  const settings = await new Promise<unknown[]>((resolve, reject) => {
    const req = tx.objectStore('settings').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const expenses = await new Promise<unknown[]>((resolve, reject) => {
    const req = tx.objectStore('expenses').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return { version: db.version, settings: settings.length, expenses: expenses.length, name: db.name };
}

function runtime(control = createIndexedDbControlStore(), extra: { signal?: AbortSignal; failAt?: MigrationFailAt; simulateUnsupported?: boolean } = {}) {
  const ids = origin();
  return {
    ...ids,
    workerUrl: WORKER_URL,
    sqliteAssetBase: SQLITE_BASE,
    control,
    indexedDB,
    ...extra,
  };
}

function portabilityRuntime(control = createIndexedDbControlStore(), extra: Partial<PortabilityRuntime> = {}) {
  const ids = origin();
  return {
    ...ids,
    workerUrl: WORKER_URL,
    sqliteAssetBase: SQLITE_BASE,
    control,
    indexedDB,
    ...extra,
  };
}

function openTestRaceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TEST_CAS_RACE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('tokens')) db.createObjectStore('tokens', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('failed to open test CAS race database'));
  });
}

async function announceCasArrival(race: CasRaceRef): Promise<void> {
  const db = await openTestRaceDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['tokens'], 'readwrite');
      tx.objectStore('tokens').put({
        key: `${race.raceId}:${race.participantId}`,
        raceId: race.raceId,
        participantId: race.participantId,
        phase: 'pre-cas',
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('failed to announce CAS arrival'));
    });
  } finally {
    db.close();
  }
}

async function waitForCasRelease(raceId: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 120000) {
    const db = await openTestRaceDb();
    try {
      const released = await new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(['meta'], 'readonly');
        const request = tx.objectStore('meta').get(`release:${raceId}`);
        request.onsuccess = () => resolve((request.result as { released?: boolean } | undefined)?.released === true);
        request.onerror = () => reject(request.error ?? new Error('failed to read CAS release'));
      });
      if (released) return;
    } finally {
      db.close();
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 15);
    });
  }
  throw new Error(`CAS race ${raceId} was not released`);
}

async function listCasArrivals(raceId: string): Promise<Array<{ raceId: string; participantId: string; phase: string }>> {
  const db = await openTestRaceDb();
  try {
    const rows = await new Promise<Array<{ raceId: string; participantId: string; phase: string }>>((resolve, reject) => {
      const tx = db.transaction(['tokens'], 'readonly');
      const request = tx.objectStore('tokens').getAll();
      request.onsuccess = () => {
        const all = (request.result as Array<{ raceId: string; participantId: string; phase: string }>);
        resolve(all.filter((row) => row.raceId === raceId));
      };
      request.onerror = () => reject(request.error ?? new Error('failed to list CAS arrivals'));
    });
    return rows;
  } finally {
    db.close();
  }
}

async function releaseCasRace(raceId: string): Promise<void> {
  const db = await openTestRaceDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['meta'], 'readwrite');
      tx.objectStore('meta').put({ key: `release:${raceId}`, released: true });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('failed to release CAS race'));
    });
  } finally {
    db.close();
  }
}

function wrapControlAtCas(control: ControlStore, race: CasRaceRef | undefined): ControlStore {
  if (race === undefined) return control;
  return {
    getPointer: () => control.getPointer(),
    putPointer: (pointer) => control.putPointer(pointer),
    getRun: (id) => control.getRun(id),
    putRun: (run) => control.putRun(run),
    async compareAndSwapPointer(expectedGeneration, next) {
      await announceCasArrival(race);
      await waitForCasRelease(race.raceId);
      return control.compareAndSwapPointer(expectedGeneration, next);
    },
  };
}

export const pageApi = {
  schemaVersion: LOCAL_SCHEMA_VERSION,
  sqliteEngine: SQLITE_ENGINE_VERSION,
  bookId: LEGACY_GUEST_BOOK_ID,

  async seedAndExtract(fixture: unknown) {
    const parsed = snapshotFromP00Fixture(fixture);
    if (!parsed.ok) return { ok: false as const, detail: parsed.detail };
    await seedLegacy({
      settings: parsed.snapshot.settings.map((entry) => ({ key: entry.key, value: entry.value })),
      templates: parsed.snapshot.templates.map((entry) => entry.raw),
      expenses: parsed.snapshot.expenses.map((entry) => entry.raw),
    });
    const before = await readLegacyCounts();
    const extracted = await extractLegacyIndexedDb();
    const after = await readLegacyCounts();
    return {
      ok: extracted.ok,
      before,
      after,
      unchanged: before.settings === after.settings && before.expenses === after.expenses && before.version === 1 && after.name === 'MicroSaveOS_DB',
      fingerprint: extracted.ok ? sourceFingerprintOf(extracted.snapshot) : null,
    };
  },

  async migrate(params: {
    migrationId: string;
    fixture: unknown;
    failAt?: MigrationFailAt;
    memoryControl?: boolean;
    raceId?: string;
    participantId?: string;
  }) {
    const parsed = snapshotFromP00Fixture(params.fixture);
    if (!parsed.ok) return { ok: false as const, detail: parsed.detail, activationCommitted: false };
    await seedLegacy({
      settings: parsed.snapshot.settings.map((entry) => ({ key: entry.key, value: entry.value })),
      templates: parsed.snapshot.templates.map((entry) => entry.raw),
      expenses: parsed.snapshot.expenses.map((entry) => entry.raw),
    });
    const race = params.raceId !== undefined && params.participantId !== undefined
      ? { raceId: params.raceId, participantId: params.participantId }
      : undefined;
    const control = wrapControlAtCas(
      params.memoryControl === true ? createMemoryControlStore() : createIndexedDbControlStore(),
      race,
    );
    const result = await runLegacyMigration(params.migrationId, {
      ...runtime(control, { failAt: params.failAt }),
      snapshot: parsed.snapshot,
    });
    const source = await readLegacyCounts();
    return { ...result, sourceUnchanged: source.version === 1 && source.name === 'MicroSaveOS_DB' };
  },

  async migrateWithAbort(params: { migrationId: string; fixture: unknown }) {
    const parsed = snapshotFromP00Fixture(params.fixture);
    if (!parsed.ok) return { ok: false as const, detail: parsed.detail };
    const control = createMemoryControlStore();
    const abort = new AbortController();
    abort.abort();
    return runLegacyMigration(params.migrationId, {
      ...runtime(control, { signal: abort.signal }),
      snapshot: parsed.snapshot,
    });
  },

  async retry(params: { migrationId: string; fixture: unknown }) {
    const parsed = snapshotFromP00Fixture(params.fixture);
    if (!parsed.ok) return { ok: false as const, detail: parsed.detail };
    const control = createIndexedDbControlStore();
    return runLegacyMigration(params.migrationId, {
      ...runtime(control),
      snapshot: parsed.snapshot,
    });
  },

  async activeSnapshot() {
    const ids = origin();
    const repo = await openActiveGuestRepository({
      ...ids,
      workerUrl: WORKER_URL,
      sqliteAssetBase: SQLITE_BASE,
      control: createIndexedDbControlStore(),
    });
    try {
      const bookId = makeBookId(LEGACY_GUEST_BOOK_ID);
      const state = bookId.ok ? repo.getBookState(bookId.value) : null;
      return {
        revision: state?.revision ?? 0,
        currency: state?.book.currency ?? null,
        entries: state?.entries.length ?? 0,
        obligations: state?.obligations.length ?? 0,
        goals: state?.goals.length ?? 0,
        journal: JSON.parse(repo.snapshotBytes()) as { enqueueSequence: number; operations: unknown[]; outbox: unknown[] },
        snapshotBytes: repo.snapshotBytes(),
        namespace: repo.namespace,
        storageId: repo.storageId ?? DEFAULT_ACTIVE_STORAGE_ID,
      };
    } finally {
      await repo.close();
    }
  },

  async exportNow() {
    return exportActiveSnapshot(portabilityRuntime());
  },

  async importNow(params: {
    importId: string;
    document: unknown;
    confirmation: string;
    raceId?: string;
    participantId?: string;
  }) {
    const race = params.raceId !== undefined && params.participantId !== undefined
      ? { raceId: params.raceId, participantId: params.participantId }
      : undefined;
    return importPortableReplacement(
      params.importId,
      params.document,
      params.confirmation,
      portabilityRuntime(wrapControlAtCas(createIndexedDbControlStore(), race)),
    );
  },

  async previewImport(document: unknown) {
    return previewPortableImport(document);
  },

  async probeFailClosed(baseDocument: unknown) {
    const control = createIndexedDbControlStore();
    const before = await control.getPointer();
    const digest = (snapshotCanonical: string, checkpointCanonical: string) =>
      stableDigest(`${snapshotCanonical}\n${checkpointCanonical}`);
    const clone = () => JSON.parse(JSON.stringify(baseDocument)) as {
      snapshotCanonical: string;
      checkpointCanonical: string;
      integrity: string;
      scope: { scopeId: string; deviceId: string; storageId: string };
      sourceFingerprint: string | null;
      migrationId: string | null;
    };
    const run = async (document: unknown, importId: string) =>
      importPortableReplacement(importId, document, REPLACE_ACTIVE_CONFIRMATION, portabilityRuntime());

    const nested = clone();
    const nestedSnap = JSON.parse(nested.snapshotCanonical) as { books: Array<{ entries: unknown[] }>; delivery: unknown[] };
    nestedSnap.books[0]!.entries = [{}];
    nestedSnap.delivery = [];
    nested.snapshotCanonical = JSON.stringify(nestedSnap);
    nested.integrity = digest(nested.snapshotCanonical, nested.checkpointCanonical);

    const emptyCommand = clone();
    const emptySnap = JSON.parse(emptyCommand.snapshotCanonical) as {
      operations: Array<{ canonicalCommand: string; receipt: { canonicalDigest: string } }>;
      outbox: Array<{ canonicalDigest: string }>;
      delivery: unknown[];
    };
    const emptyCanonical = '{}';
    emptySnap.operations[0]!.canonicalCommand = emptyCanonical;
    emptySnap.operations[0]!.receipt.canonicalDigest = stableDigest(emptyCanonical);
    emptySnap.outbox[0]!.canonicalDigest = stableDigest(emptyCanonical);
    emptySnap.delivery = [];
    emptyCommand.snapshotCanonical = JSON.stringify(emptySnap);
    emptyCommand.integrity = digest(emptyCommand.snapshotCanonical, emptyCommand.checkpointCanonical);

    const forged = clone();
    forged.snapshotCanonical = JSON.stringify({ books: [], operations: [], outbox: [], delivery: [], enqueueSequence: 0 });
    forged.checkpointCanonical = JSON.stringify({ scopeId: 'bad scope', streams: [] });
    forged.scope = { scopeId: 'bad scope', deviceId: 'bad device', storageId: 'guest-active' };
    forged.integrity = digest(forged.snapshotCanonical, forged.checkpointCanonical);

    const gap = clone();
    const gapSnap = JSON.parse(gap.snapshotCanonical) as {
      operations: Array<Record<string, unknown>>;
      outbox: Array<Record<string, unknown>>;
      delivery: unknown[];
      enqueueSequence: number;
    };
    const firstBookId = gapSnap.operations[0]!['bookId'];
    const otherIndex = gapSnap.operations.findIndex((row) => row['bookId'] !== firstBookId);
    const gapSourceIndex = otherIndex >= 0 ? otherIndex : 0;
    const firstOp = JSON.parse(JSON.stringify(gapSnap.operations[gapSourceIndex]!)) as Record<string, unknown>;
    const firstOut = JSON.parse(JSON.stringify(gapSnap.outbox[gapSourceIndex] ?? gapSnap.outbox[0]!)) as Record<string, unknown>;
    firstOp['operationId'] = 'op-gap-3';
    firstOp['enqueueSequence'] = 3;
    const firstReceipt = firstOp['receipt'] as Record<string, unknown>;
    firstReceipt['operationId'] = 'op-gap-3';
    firstReceipt['enqueueSequence'] = 3;
    firstOut['operationId'] = 'op-gap-3';
    firstOut['outboxId'] = 'outbox:op-gap-3';
    firstOut['enqueueSequence'] = 3;
    firstOut['bookId'] = firstOp['bookId'];
    gapSnap.operations = [gapSnap.operations[0]!, firstOp];
    gapSnap.outbox = [gapSnap.outbox[0]!, firstOut];
    gapSnap.enqueueSequence = 3;
    gapSnap.delivery = [];
    gap.snapshotCanonical = JSON.stringify(gapSnap);
    gap.integrity = digest(gap.snapshotCanonical, gap.checkpointCanonical);

    const duplicate = clone();
    const dupSnap = JSON.parse(duplicate.snapshotCanonical) as {
      operations: Array<Record<string, unknown>>;
      outbox: Array<Record<string, unknown>>;
      delivery: unknown[];
      enqueueSequence: number;
    };
    const left = JSON.parse(JSON.stringify(dupSnap.operations[0])) as Record<string, unknown>;
    const right = JSON.parse(JSON.stringify(dupSnap.operations[0])) as Record<string, unknown>;
    const leftOut = JSON.parse(JSON.stringify(dupSnap.outbox[0])) as Record<string, unknown>;
    const rightOut = JSON.parse(JSON.stringify(dupSnap.outbox[0])) as Record<string, unknown>;
    right['operationId'] = 'op-dup-2';
    right['enqueueSequence'] = 2;
    (right['receipt'] as Record<string, unknown>)['operationId'] = 'op-dup-2';
    (right['receipt'] as Record<string, unknown>)['enqueueSequence'] = 2;
    leftOut['outboxId'] = 'outbox:shared';
    rightOut['operationId'] = 'op-dup-2';
    rightOut['outboxId'] = 'outbox:shared';
    rightOut['enqueueSequence'] = 2;
    dupSnap.operations = [left, right];
    dupSnap.outbox = [leftOut, rightOut];
    dupSnap.enqueueSequence = 2;
    dupSnap.delivery = [];
    duplicate.snapshotCanonical = JSON.stringify(dupSnap);
    duplicate.integrity = digest(duplicate.snapshotCanonical, duplicate.checkpointCanonical);

    const rawFingerprint = clone();
    rawFingerprint.sourceFingerprint = '{"secret":"fake-financial-source"}';
    rawFingerprint.migrationId = 'mig-forged';

    const nestedEmptyEntry = await run(nested, 'imp-nested-empty');
    const emptyCanonicalCommand = await run(emptyCommand, 'imp-empty-command');
    const forgedProvenance = await run(forged, 'imp-forged-scope');
    const sequenceGap = await run(gap, 'imp-seq-gap');
    const duplicateOutboxId = await run(duplicate, 'imp-dup-outbox');
    const rawSourceFingerprint = await run(rawFingerprint, 'imp-raw-fingerprint');
    const after = await control.getPointer();
    const source = await this.extractDiscoveryError();
    return {
      nestedEmptyEntry,
      emptyCanonicalCommand,
      forgedProvenance,
      sequenceGap,
      duplicateOutboxId,
      rawSourceFingerprint,
      discovery: source,
      activeStorageBefore: before.activeStorageId,
      activeStorageAfter: after.activeStorageId,
      activationCommittedBefore: before.activationCommitted,
      activationCommittedAfter: after.activationCommitted,
    };
  },

  async resetNow(params: {
    resetId: string;
    confirmation: string;
    scopeId?: string;
    failAt?: PortabilityRuntime['failAt'];
    signalAborted?: boolean;
    raceId?: string;
    participantId?: string;
  }) {
    const ids = origin();
    const abort = new AbortController();
    if (params.signalAborted === true) abort.abort();
    const race = params.raceId !== undefined && params.participantId !== undefined
      ? { raceId: params.raceId, participantId: params.participantId }
      : undefined;
    return resetGuestScope(
      params.resetId,
      params.confirmation,
      params.scopeId ?? (ids.boundScope as string),
      portabilityRuntime(wrapControlAtCas(createIndexedDbControlStore(), race), { failAt: params.failAt, signal: abort.signal }),
    );
  },

  async extractDiscoveryError() {
    const factory = {
      databases: async () => {
        throw new DOMException('permission denied', 'SecurityError');
      },
      open() {
        throw new Error('open must not run after discovery failure');
      },
    };
    try {
      return await extractLegacyIndexedDb(factory as unknown as IDBFactory);
    } catch (error) {
      return { ok: false as const, reason: 'unstructured-rejection', detail: error instanceof Error ? error.message : String(error) };
    }
  },

  async extractOpenError() {
    const factory = {
      databases: async () => [{ name: 'MicroSaveOS_DB', version: 1 }],
      open() {
        const request: { onerror: ((event: Event) => void) | null; error: DOMException } = {
          onerror: null,
          error: new DOMException('permission denied', 'UnknownError'),
        };
        queueMicrotask(() => request.onerror?.(new Event('error')));
        return request as unknown as IDBOpenDBRequest;
      },
    };
    return extractLegacyIndexedDb(factory as unknown as IDBFactory);
  },

  async setActivationHold(held: boolean) {
    void held;
    throw new Error('product activation hold was removed; use the test-owned CAS race wrapper');
  },

  async activationReady() {
    throw new Error('product activation ready counter was removed; use listCasRaceArrivals');
  },

  async listCasRaceArrivals(raceId: string) {
    return listCasArrivals(raceId);
  },

  async releaseCasRace(raceId: string) {
    await releaseCasRace(raceId);
    return { released: true, raceId };
  },

  async pointerState() {
    const control = createIndexedDbControlStore();
    return control.getPointer();
  },

  async cleanupInactiveOpfs() {
    const ids = origin();
    const pointer = await createIndexedDbControlStore().getPointer();
    const keep = new Set([
      databaseNamespaceFor(ids.boundScope, ids.boundDevice, pointer.activeStorageId || DEFAULT_ACTIVE_STORAGE_ID),
      databaseNamespaceFor(ids.boundScope, ids.boundDevice),
    ]);
    const root = await navigator.storage.getDirectory();
    const removed: string[] = [];
    for await (const entry of root.values()) {
      const keepable = [...keep].some((namespace) => entry.name === namespace || entry.name.startsWith(`${namespace}-`) || entry.name.startsWith(`${namespace}.`));
      if (!keepable && entry.name.startsWith('rushd-v2-')) {
        await root.removeEntry(entry.name, { recursive: entry.kind === 'directory' }).catch(() => undefined);
        removed.push(entry.name);
      }
    }
    return { removed: removed.length };
  },

  async migrateIndexed(params: { migrationId: string; fixture: unknown }) {
    const parsed = snapshotFromP00Fixture(params.fixture);
    if (!parsed.ok) return { ok: false as const, detail: parsed.detail, activationCommitted: false };
    await seedLegacy({
      settings: parsed.snapshot.settings.map((entry) => ({ key: entry.key, value: entry.value })),
      templates: parsed.snapshot.templates.map((entry) => entry.raw),
      expenses: parsed.snapshot.expenses.map((entry) => entry.raw),
    });
    const before = await readLegacyCounts();
    const result = await runLegacyMigration(params.migrationId, runtime(createIndexedDbControlStore()));
    const after = await readLegacyCounts();
    return {
      ...result,
      sourceUnchanged: before.settings === after.settings && before.expenses === after.expenses && after.version === 1 && after.name === 'MicroSaveOS_DB',
    };
  },

  async prepareExportWithHistory() {
    const ids = origin();
    const repo = await openActiveGuestRepository({
      ...ids,
      workerUrl: WORKER_URL,
      sqliteAssetBase: SQLITE_BASE,
      control: createIndexedDbControlStore(),
    });
    try {
      const operations = JSON.parse(repo.snapshotBytes()) as { operations: { operationId: string }[]; delivery: unknown[] };
      const firstId = operations.operations[0]?.operationId;
      if (firstId !== undefined) {
        const operationId = makeOperationId(firstId);
        if (operationId.ok) {
          await repo.updateDeliveryState(operationId.value, { ok: false, error: 'attempt-1', nextRetryAtMs: 2 });
          await repo.updateDeliveryState(operationId.value, { ok: false, error: 'attempt-2', nextRetryAtMs: 3 });
          await repo.updateDeliveryState(operationId.value, { ok: true });
        }
      }
      const secondBook = makeBookId('second-guest-book');
      if (secondBook.ok && isValidTimeZoneName(DEFAULT_TIME_ZONE)) {
        const command = {
          kind: 'createBook' as const,
          bookId: secondBook.value,
          displayName: 'Second book',
          currency: 'SAR' as const,
          timeZone: DEFAULT_TIME_ZONE,
          cycleAnchor: { kind: 'firstOfMonth' as const },
        };
        const preview = previewCommand(repo, command, ids.context);
        if (preview.ok) {
          const op = makeOperationId('op-second-book');
          if (op.ok) {
            await executeCommand(repo, command, {
              operationId: op.value,
              expectedRevision: preview.preview.expectedRevision,
              previewDigest: preview.preview.previewDigest,
            }, ids.context);
          }
        }
      }
      const streamId = makeReplicationStreamId('stream:p04c-test');
      const cursor = makeSyncCursor('cursor:p04c-1');
      if (streamId.ok && cursor.ok && firstId !== undefined) {
        const appliedId = makeOperationId(firstId);
        if (appliedId.ok) {
          const bookId = makeBookId(LEGACY_GUEST_BOOK_ID);
          if (bookId.ok) {
          const canonicalCommand = canonicalJson({
            bookId: bookId.value,
            currency: 'SAR',
            cycleAnchor: { kind: 'firstOfMonth' },
            displayName: 'Rushd guest book',
            kind: 'createBook',
            timeZone: DEFAULT_TIME_ZONE,
          });
          await repo.runTransaction((transaction) => {
            const staged = asDurableTransaction(transaction);
            staged.getStreamCheckpoint(streamId.value);
            staged.putStreamCheckpoint(streamId.value, {
              cursor: cursor.value,
              batchDigest: stableDigest('batch'),
              applied: new Map([
                [
                  firstId,
                  {
                    operationId: appliedId.value,
                    sequence: 1,
                    scopeId: ids.boundScope,
                    bookId: bookId.value,
                    baseRevision: 0,
                    resultingRevision: 1,
                    canonicalCommand,
                    canonicalDigest: stableDigest(canonicalCommand),
                    sourceDeviceId: ids.boundDevice,
                    sourceEnqueueSequence: 1,
                    schemaVersion: SYNC_CURSOR_SCHEMA_VERSION,
                  },
                ],
              ]),
            });
          });
          }
        }
      }
      const exported = await exportActiveSnapshot(portabilityRuntime(), repo);
      const parsed = JSON.parse(exported.snapshotCanonical) as { delivery: { version: number }[]; books: unknown[] };
      return {
        document: exported,
        deliveryVersions: parsed.delivery.map((row) => row.version),
        bookCount: parsed.books.length,
        snapshotBytes: repo.snapshotBytes(),
        checkpointBytes: repo.checkpointSnapshotBytes(),
      };
    } finally {
      await repo.close();
    }
  },

  async planOnly(fixture: unknown) {
    const parsed = snapshotFromP00Fixture(fixture);
    if (!parsed.ok) return { ok: false as const, detail: parsed.detail };
    const plan = planLegacyMigration(parsed.snapshot);
    return {
      ok: true as const,
      commandKinds: plan.commands.map((item) => item.command.kind),
      reviewReasons: plan.review.map((item) => item.reason),
      openingVaultMinorUnits: plan.openingVaultMinorUnits,
      budgetCarryInIds: plan.budgetCarryInIds,
      vaultFundingIds: plan.vaultFundingIds,
    };
  },

  async resetControl() {
    await new Promise<void>((resolve, reject) => {
      const del = indexedDB.deleteDatabase('Rushd_P04C_Control');
      del.onsuccess = () => resolve();
      del.onerror = () => reject(del.error ?? new Error('failed to delete control db'));
      del.onblocked = () => undefined;
    });
    return { reset: true };
  },

  async migrateUnsupported(params: { migrationId: string; fixture: unknown }) {
    const parsed = snapshotFromP00Fixture(params.fixture);
    if (!parsed.ok) return { ok: false as const, detail: parsed.detail };
    const control = createMemoryControlStore();
    return runLegacyMigration(params.migrationId, {
      ...runtime(control, { simulateUnsupported: true }),
      snapshot: parsed.snapshot,
    });
  },

  confirmations: {
    replace: REPLACE_ACTIVE_CONFIRMATION,
    reset: RESET_SCOPE_CONFIRMATION,
  },
};

(globalThis as unknown as { __p04c: typeof pageApi }).__p04c = pageApi;
