/**
 * Same-origin page API for P04-B browser lifetime tests.
 *
 * Exercises the production durable adapter from independent pages/workers
 * with synthetic data. No account or cloud client is constructed.
 */
/* eslint-env browser */

import { executeCommand, previewCommand, recordDeliveryAttempt, acknowledgeOutboxDelivery } from '../../src/application/commands';
import { makeBookId, makeOperationId } from '../../src/domain/contracts/identity';
import { makeAccountId, makeDeviceId, makeGuestKey, repositoryScopeIdFor } from '../../src/domain/sync/scope';
import {
  computePulledBatchDigest,
  makeReplicationStreamId,
  makeSyncCursor,
  type PulledBatch,
  type PulledOperation,
} from '../../src/domain/sync/cursors';
import { canonicalJson, stableDigest } from '../../src/domain/contracts/canonical';
import { DEFAULT_GUEST_KEY, createDeterministicContext } from '../domain/support/deterministic-context';
import { openDurableGuestRepository } from '../../src/data/v2/session';
import { DurableCheckpointStore } from '../../src/data/v2/checkpoint-store';
import { DurableGuestRepository } from '../../src/data/v2/repository';
import { GuardConflictError, StorageFailureError, StorageUnsupportedError, isDurableConflict } from '../../src/data/v2/errors';
import { databaseNamespaceFor } from '../../src/data/v2/namespace';
import { LOCAL_SCHEMA_VERSION } from '../../src/data/v2/schema';
import { SQLITE_ENGINE_VERSION } from '../../src/data/v2/protocol';

const BOOK_ID = 'book-p04b';
const WORKER_URL = '/harness/v2-worker.js';
const SQLITE_BASE = '/pkg';

interface Handle {
  repo: DurableGuestRepository;
  checkpoints: DurableCheckpointStore;
  context: ReturnType<typeof createDeterministicContext>['context'];
  deviceId: string;
}

let handle: Handle | null = null;

function brandedOp(raw: string) {
  const made = makeOperationId(raw);
  if (!made.ok) throw new Error(`invalid operation id: ${raw}`);
  return made.value;
}

function brandedBook(raw: string) {
  const made = makeBookId(raw);
  if (!made.ok) throw new Error(`invalid book id: ${raw}`);
  return made.value;
}

function originFor(deviceId: string, accountId?: string) {
  const device = makeDeviceId(deviceId);
  if (!device.ok) throw new Error(device.failure.detail);
  if (accountId !== undefined) {
    const account = makeAccountId(accountId);
    if (!account.ok) throw new Error(account.failure.detail);
    return {
      boundDevice: device.value,
      boundScope: repositoryScopeIdFor({ kind: 'account', accountId: account.value, deviceId: device.value }),
    };
  }
  const guest = makeGuestKey(DEFAULT_GUEST_KEY);
  if (!guest.ok) throw new Error(guest.failure.detail);
  return {
    boundDevice: device.value,
    boundScope: repositoryScopeIdFor({ kind: 'guest', guestKey: guest.value, deviceId: device.value }),
  };
}

async function previewAndExecute(operationId: string, rawCommand: unknown) {
  if (handle === null) throw new Error('repository is not open');
  const preview = previewCommand(handle.repo, rawCommand, handle.context);
  if (!preview.ok) return { ok: false as const, failure: preview.failure };
  try {
    const result = await executeCommand(
      handle.repo,
      rawCommand,
      {
        operationId: brandedOp(operationId),
        expectedRevision: preview.preview.expectedRevision,
        previewDigest: preview.preview.previewDigest,
      },
      handle.context,
    );
    if (!result.ok) return { ok: false as const, failure: result.failure };
    return { ok: true as const, receipt: result.receipt, retried: result.retried === true };
  } catch (error) {
    return asExplicitConflict(error);
  }
}

function asExplicitConflict(error: unknown): { ok: false; failure: { kind: string; detail: string } } {
  if (error instanceof GuardConflictError || isDurableConflict(error)) {
    return { ok: false, failure: { kind: 'revisionConflict', detail: error instanceof Error ? error.message : String(error) } };
  }
  if (error instanceof StorageFailureError && error.reason === 'busy') {
    return { ok: false, failure: { kind: 'busy', detail: error.message } };
  }
  throw error;
}

const CREATE_BOOK = {
  kind: 'createBook',
  bookId: BOOK_ID,
  displayName: 'p04b book',
  currency: 'SAR',
  timeZone: 'Asia/Riyadh',
  cycleAnchor: { kind: 'firstOfMonth' },
} as const;

const OPEN_CYCLE = {
  kind: 'openCycle',
  bookId: BOOK_ID,
  startDate: '2026-09-01',
  startingFunds: { currency: 'SAR', minorUnits: 100_000 },
} as const;

function inflow(amount: number, day: string, note: string) {
  return {
    kind: 'recordInflow',
    bookId: BOOK_ID,
    amount: { currency: 'SAR', minorUnits: amount },
    occurredAt: { kind: 'civilDate', localDate: day },
    note,
  };
}

export const pageApi = {
  schemaVersion: LOCAL_SCHEMA_VERSION,
  sqliteEngine: SQLITE_ENGINE_VERSION,

  async open(params: { deviceId: string; storageId: string; reset?: boolean; accountId?: string; workerUrl?: string }) {
    if (handle !== null) await handle.repo.close().catch(() => undefined);
    const origin = originFor(params.deviceId, params.accountId);
    const { context } = createDeterministicContext({
      deviceId: params.deviceId,
      ...(params.accountId !== undefined ? { accountId: params.accountId } : {}),
    });
    const repo = await openDurableGuestRepository({
      boundScope: origin.boundScope,
      boundDevice: origin.boundDevice,
      workerUrl: params.workerUrl ?? WORKER_URL,
      sqliteAssetBase: SQLITE_BASE,
      storageId: params.storageId,
      reset: params.reset === true,
    });
    handle = { repo, checkpoints: new DurableCheckpointStore({ adapter: repo }), context, deviceId: params.deviceId };
    return {
      boundScope: repo.boundScope,
      boundDevice: repo.boundDevice,
      namespace: repo.namespace,
      schemaVersion: LOCAL_SCHEMA_VERSION,
    };
  },

  async seed() {
    const created = await previewAndExecute('op-create', { ...CREATE_BOOK });
    if (!created.ok) throw new Error(`seed create failed: ${JSON.stringify(created.failure)}`);
    const cycle = await previewAndExecute('op-cycle', { ...OPEN_CYCLE });
    if (!cycle.ok) throw new Error(`seed cycle failed: ${JSON.stringify(cycle.failure)}`);
    return { revision: handle?.repo.getBookState(brandedBook(BOOK_ID))?.revision ?? -1 };
  },

  async executeInflow(params: { operationId: string; amount: number; day: string; note: string; expectedRevision?: number }) {
    const command = inflow(params.amount, params.day, params.note);
    if (params.expectedRevision === undefined) return previewAndExecute(params.operationId, command);
    if (handle === null) throw new Error('repository is not open');
    const digest = stableDigest(`${canonicalJson(command)}\n${String(params.expectedRevision)}`);
    try {
      const result = await executeCommand(
        handle.repo,
        command,
        { operationId: brandedOp(params.operationId), expectedRevision: params.expectedRevision, previewDigest: digest },
        handle.context,
      );
      if (!result.ok) return { ok: false as const, failure: result.failure };
      return { ok: true as const, receipt: result.receipt, retried: result.retried === true };
    } catch (error) {
      return asExplicitConflict(error);
    }
  },

  async snapshot() {
    if (handle === null) throw new Error('repository is not open');
    const state = handle.repo.getBookState(brandedBook(BOOK_ID));
    return {
      revision: state?.revision ?? 0,
      displayName: state?.book.displayName ?? null,
      notes: (state?.entries ?? []).map((entry) => entry.note),
      outbox: handle.repo.listOutbox().map((envelope) => envelope.operationId as string),
      enqueueSequence: JSON.parse(handle.repo.snapshotBytes()) as { enqueueSequence: number },
      snapshotBytes: handle.repo.snapshotBytes(),
      checkpointBytes: handle.checkpoints.snapshotBytes(),
      integrity: await handle.repo.integrity(),
    };
  },

  async coherentSnapshot() {
    if (handle === null) throw new Error('repository is not open');
    const state = handle.repo.getBookState(brandedBook(BOOK_ID));
    const parsed = JSON.parse(handle.repo.snapshotBytes()) as {
      books: unknown[];
      operations: Array<{ operationId: string }>;
      outbox: Array<{ operationId: string; enqueueSequence: number }>;
      delivery: Array<{ operationId: string }>;
      enqueueSequence: number;
    };
    const revision = state?.revision ?? 0;
    const outboxCount = parsed.outbox.length;
    const journalCount = parsed.operations.length;
    const deliveryCount = parsed.delivery.length;
    const enqueueSequence = parsed.enqueueSequence;
    const journalIds = parsed.operations.map((record) => record.operationId).sort();
    const outboxIds = parsed.outbox.map((envelope) => envelope.operationId);
    const deliveryIds = parsed.delivery.map((record) => record.operationId).sort();
    const sortedOutboxIds = [...outboxIds].sort();
    const durableCoherent =
      outboxCount === enqueueSequence &&
      journalCount >= outboxCount &&
      sortedOutboxIds.every((id) => journalIds.includes(id)) &&
      (deliveryCount === 0 || deliveryIds.every((id) => sortedOutboxIds.includes(id)));
    const localOnlyCoherent =
      revision === outboxCount &&
      outboxCount === journalCount &&
      journalCount === enqueueSequence &&
      journalIds.join('|') === sortedOutboxIds.join('|');
    return {
      revision,
      outboxCount,
      journalCount,
      deliveryCount,
      enqueueSequence,
      notes: (state?.entries ?? []).map((entry) => entry.note),
      outboxIds,
      snapshotBytes: handle.repo.snapshotBytes(),
      checkpointBytes: handle.checkpoints.snapshotBytes(),
      integrity: await handle.repo.integrity(),
      coherent: durableCoherent,
      localOnlyCoherent,
    };
  },

  async updateDelivery(params: { operationId: string; error: string }) {
    if (handle === null) throw new Error('repository is not open');
    const next = await handle.repo.updateDeliveryState(brandedOp(params.operationId), {
      ok: false,
      error: params.error,
      nextRetryAtMs: 1_000,
    });
    return { version: next.version, attempts: next.attempts, acknowledged: next.acknowledged };
  },

  async acknowledgeDelivery(operationId: string) {
    if (handle === null) throw new Error('repository is not open');
    const branded = brandedOp(operationId);
    return handle.repo.runTransaction((transaction) => {
      const current = transaction.getDeliveryState(branded);
      if (current === null) throw new Error(`unknown operation for delivery update: ${operationId}`);
      const ack = acknowledgeOutboxDelivery(current, branded);
      if (!ack.ok) {
        return { version: current.version, attempts: current.attempts, acknowledged: current.acknowledged, duplicate: true, reason: ack.reason };
      }
      transaction.putDeliveryState(ack.delivery);
      return { version: ack.delivery.version, attempts: ack.delivery.attempts, acknowledged: ack.delivery.acknowledged, duplicate: false, reason: null };
    });
  },

  async mismatchedExecute(params: { otherDeviceId: string; operationId: string }) {
    if (handle === null) throw new Error('repository is not open');
    const { context } = createDeterministicContext({ deviceId: params.otherDeviceId });
    const command = inflow(5, '2026-09-10', 'intruder');
    const preview = previewCommand(handle.repo, command, context);
    const revision = handle.repo.getBookState(brandedBook(BOOK_ID))?.revision ?? 0;
    const executed = await executeCommand(
      handle.repo,
      command,
      {
        operationId: brandedOp(params.operationId),
        expectedRevision: revision,
        previewDigest: stableDigest(`${canonicalJson(command)}\n${String(revision)}`),
      },
      context,
    );
    return {
      previewKind: preview.ok ? 'ok' : preview.failure.kind,
      executeKind: executed.ok ? 'ok' : executed.failure.kind,
      snapshotBytes: handle.repo.snapshotBytes(),
    };
  },

  async applyRemoteBatch(params: { stream: string; batchId: string; cursor: string; operationId: string; amount: number; note: string; baseRevision: number }) {
    if (handle === null) throw new Error('repository is not open');
    const stream = makeReplicationStreamId(params.stream);
    if (!stream.ok) throw new Error(stream.failure.detail);
    const cursor = makeSyncCursor(params.cursor);
    if (!cursor.ok) throw new Error(cursor.failure.detail);
    const command = inflow(params.amount, '2026-09-25', params.note);
    const payload = canonicalJson(command);
    const source = makeDeviceId('source-device-remote');
    if (!source.ok) throw new Error(source.failure.detail);
    const operation: PulledOperation = {
      operationId: brandedOp(params.operationId),
      sequence: 1,
      scopeId: handle.repo.boundScope,
      bookId: brandedBook(BOOK_ID),
      baseRevision: params.baseRevision,
      resultingRevision: params.baseRevision + 1,
      canonicalCommand: payload,
      canonicalDigest: stableDigest(payload),
      sourceDeviceId: source.value,
      sourceEnqueueSequence: 101,
      schemaVersion: 1,
    };
    const batch: PulledBatch = {
      schemaVersion: 1,
      streamId: stream.value,
      scopeId: handle.repo.boundScope,
      batchId: params.batchId,
      batchDigest: computePulledBatchDigest([operation]),
      baseCursor: null,
      operations: [operation],
      nextCursor: cursor.value,
    };
    return handle.checkpoints.applyBatch(batch, { adapter: handle.repo, context: handle.context });
  },

  async abortedPullWithConcurrentDelivery(params: {
    stream: string;
    batchId: string;
    cursor: string;
    operationId: string;
    amount: number;
    note: string;
    baseRevision: number;
    localOperationId: string;
  }) {
    if (handle === null) throw new Error('repository is not open');
    const stream = makeReplicationStreamId(params.stream);
    if (!stream.ok) throw new Error(stream.failure.detail);
    const cursor = makeSyncCursor(params.cursor);
    if (!cursor.ok) throw new Error(cursor.failure.detail);
    const command = inflow(params.amount, '2026-09-25', params.note);
    const payload = canonicalJson(command);
    const source = makeDeviceId('source-device-remote');
    if (!source.ok) throw new Error(source.failure.detail);
    const operation: PulledOperation = {
      operationId: brandedOp(params.operationId),
      sequence: 1,
      scopeId: handle.repo.boundScope,
      bookId: brandedBook(BOOK_ID),
      baseRevision: params.baseRevision,
      resultingRevision: params.baseRevision + 1,
      canonicalCommand: payload,
      canonicalDigest: stableDigest(payload),
      sourceDeviceId: source.value,
      sourceEnqueueSequence: 101,
      schemaVersion: 1,
    };
    const batch: PulledBatch = {
      schemaVersion: 1,
      streamId: stream.value,
      scopeId: handle.repo.boundScope,
      batchId: params.batchId,
      batchDigest: computePulledBatchDigest([operation]),
      baseCursor: null,
      operations: [operation],
      nextCursor: cursor.value,
    };

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const parked = handle.checkpoints.armApplyBarrier(gate);
    const pull = handle.checkpoints.applyBatch(batch, { adapter: handle.repo, context: handle.context });
    await parked;
    const delivery = await handle.repo.updateDeliveryState(brandedOp(params.localOperationId), {
      ok: false,
      error: 'timeout',
      nextRetryAtMs: 1_000,
    });
    await handle.repo.armInjectedCommitFailure();
    release();
    const pullResult = await pull.catch((error: unknown) => ({
      ok: false as const,
      reason: 'injectedFailure' as const,
      detail: error instanceof Error ? error.message : String(error),
    }));
    const snap = {
      snapshotBytes: handle.repo.snapshotBytes(),
      checkpointBytes: handle.checkpoints.snapshotBytes(),
      notes: handle.repo.getBookState(brandedBook(BOOK_ID))?.entries.map((entry) => entry.note) ?? [],
      deliveryAttempts: handle.repo.getDeliveryState(brandedOp(params.localOperationId))?.attempts ?? 0,
    };
    return { pullResult, deliveryAttempts: delivery.attempts, snap };
  },

  async mixedLateConflictSameHandle(params: { operationId: string }) {
    if (handle === null) throw new Error('repository is not open');
    const repo = handle.repo;
    const bookId = brandedBook(BOOK_ID);
    const operationId = brandedOp(params.operationId);
    const nameBefore = repo.getBookState(bookId)?.book.displayName ?? null;
    const revisionBefore = repo.getBookState(bookId)?.revision ?? 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let notifyParked!: () => void;
    const parkedAck = new Promise<void>((resolve) => {
      notifyParked = resolve;
    });
    const parked = repo
      .runTransaction(async (transaction) => {
        const state = transaction.getBookState(bookId);
        if (state === null) throw new Error('book missing');
        transaction.putBookState({
          ...state,
          revision: state.revision + 1,
          book: { ...state.book, displayName: 'partial-commit' },
        });
        const current = transaction.getDeliveryState(operationId);
        if (current === null) throw new Error('delivery missing');
        transaction.putDeliveryState(recordDeliveryAttempt(current, { ok: true }));
        notifyParked();
        await gate;
      })
      .then(() => ({ lost: false, error: null as string | null }))
      .catch((error: unknown) => ({ lost: true, error: error instanceof Error ? error.name : String(error) }));
    await parkedAck;
    const winner = await repo.updateDeliveryState(operationId, { ok: false, error: 'concurrent', nextRetryAtMs: 2 });
    release();
    const loser = await parked;
    const after = repo.getBookState(bookId);
    return {
      loser,
      winnerAttempts: winner.attempts,
      displayName: after?.book.displayName ?? null,
      revision: after?.revision ?? 0,
      nameBefore,
      revisionBefore,
    };
  },

  async parkedMixedWrite(params: { operationId: string; barrier: string }) {
    if (handle === null) throw new Error('repository is not open');
    const repo = handle.repo;
    const bookId = brandedBook(BOOK_ID);
    const operationId = brandedOp(params.operationId);
    const channel = new BroadcastChannel(params.barrier);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    channel.onmessage = (event) => {
      if (event.data === 'release') release();
    };
    channel.postMessage('parked');
    (globalThis as { __p04bParked?: boolean }).__p04bParked = true;
    try {
      await repo.runTransaction(async (transaction) => {
        const state = transaction.getBookState(bookId);
        if (state === null) throw new Error('book missing');
        transaction.putBookState({
          ...state,
          revision: state.revision + 1,
          book: { ...state.book, displayName: 'partial-commit' },
        });
        const current = transaction.getDeliveryState(operationId);
        if (current === null) throw new Error('delivery missing');
        transaction.putDeliveryState(recordDeliveryAttempt(current, { ok: true }));
        await gate;
      });
      return { lost: false, error: null as string | null };
    } catch (error) {
      return { lost: true, error: error instanceof Error ? error.name : String(error) };
    } finally {
      channel.close();
    }
  },

  async waitBarrier(name: string, selfId: string, peerId: string, timeoutMs = 8_000) {
    const channel = new BroadcastChannel(name);
    let peerSeen = false;
    channel.onmessage = (event) => {
      if (event.data === peerId) peerSeen = true;
    };
    const started = performance.now();
    while (!peerSeen) {
      channel.postMessage(selfId);
      if (performance.now() - started > timeoutMs) {
        channel.close();
        throw new Error(`barrier timeout waiting for ${peerId}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    channel.postMessage(selfId);
    await new Promise((resolve) => setTimeout(resolve, 40));
    channel.close();
    return { ready: true };
  },

  async armHangAfterCommit() {
    if (handle === null) throw new Error('repository is not open');
    await handle.repo.armHangAfterCommit();
    return { armed: true };
  },

  async armParkAfterBegin() {
    if (handle === null) throw new Error('repository is not open');
    await handle.repo.armParkAfterBegin();
    return { armed: true };
  },

  async armParkDuringHydrate() {
    if (handle === null) throw new Error('repository is not open');
    await handle.repo.armParkDuringHydrate();
    return { armed: true };
  },

  async resumeParked() {
    if (handle === null) throw new Error('repository is not open');
    await handle.repo.resumeParked();
    return { resumed: true };
  },

  armParkBeforeCommit() {
    if (handle === null) throw new Error('repository is not open');
    handle.repo.armParkBeforeCommit();
    return { armed: true };
  },

  waitPark() {
    if (handle === null) throw new Error('repository is not open');
    return handle.repo.waitPark();
  },

  waitParkBeforeCommit() {
    if (handle === null) throw new Error('repository is not open');
    return handle.repo.waitParkBeforeCommit();
  },

  terminateWorker() {
    if (handle === null) throw new Error('repository is not open');
    handle.repo.terminateWorker();
    return { terminated: true };
  },

  async reopen() {
    if (handle === null) throw new Error('repository is not open');
    const repo = await handle.repo.reopen();
    handle = {
      repo,
      checkpoints: new DurableCheckpointStore({ adapter: repo }),
      context: handle.context,
      deviceId: handle.deviceId,
    };
    return { boundScope: repo.boundScope, boundDevice: repo.boundDevice };
  },

  async reopenCoherent() {
    await pageApi.reopen();
    return pageApi.coherentSnapshot();
  },

  async recoverAfterKill(params: { deviceId: string; storageId: string; accountId?: string }) {
    const origin = originFor(params.deviceId, params.accountId);
    const { context } = createDeterministicContext({
      deviceId: params.deviceId,
      ...(params.accountId !== undefined ? { accountId: params.accountId } : {}),
    });
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
      try {
        const repo = await openDurableGuestRepository({
          boundScope: origin.boundScope,
          boundDevice: origin.boundDevice,
          workerUrl: WORKER_URL,
          sqliteAssetBase: SQLITE_BASE,
          storageId: params.storageId,
          reset: false,
        });
        handle = { repo, checkpoints: new DurableCheckpointStore({ adapter: repo }), context, deviceId: params.deviceId };
        return { boundScope: repo.boundScope, revision: repo.getBookState(brandedBook(BOOK_ID))?.revision ?? 0 };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  },

  async openUnsupported() {
    try {
      await openDurableGuestRepository({
        boundScope: originFor('test-device-0001').boundScope,
        boundDevice: originFor('test-device-0001').boundDevice,
        workerUrl: WORKER_URL,
        sqliteAssetBase: SQLITE_BASE,
        storageId: 'unsupported',
        simulateUnsupported: true,
      });
      return { failed: false, code: null as string | null };
    } catch (error) {
      const code = error instanceof StorageUnsupportedError ? error.code : error instanceof Error ? error.name : 'unknown';
      return { failed: true, code };
    }
  },

  async rejectUnknownSchema() {
    if (handle === null) throw new Error('repository is not open');
    await handle.repo.forceSchemaVersion('99');
    try {
      await handle.repo.reopenConnection();
      return { failed: false, code: null as string | null, foundVersion: null as string | null };
    } catch (error) {
      const foundVersion = error instanceof Error && 'foundVersion' in error ? String((error as { foundVersion: string }).foundVersion) : null;
      const code = error instanceof Error ? error.name : 'unknown';
      return { failed: true, code, foundVersion };
    }
  },

  async forceSchemaVersion(version: string) {
    if (handle === null) throw new Error('repository is not open');
    await handle.repo.forceSchemaVersion(version);
    return { version };
  },

  async reopenConnectionCoherent() {
    if (handle === null) throw new Error('repository is not open');
    const current = handle;
    const repo = await current.repo.reopenConnection();
    handle = {
      repo,
      checkpoints: new DurableCheckpointStore({ adapter: repo }),
      context: current.context,
      deviceId: current.deviceId,
    };
    return pageApi.coherentSnapshot();
  },

  async cleanupNamespace(params: { deviceId: string; storageId: string; accountId?: string }) {
    const origin = originFor(params.deviceId, params.accountId);
    const namespace = databaseNamespaceFor(origin.boundScope, origin.boundDevice, params.storageId);
    const root = await navigator.storage.getDirectory();
    const matchesNamespace = (name: string) =>
      name === namespace || name.startsWith(`${namespace}-`) || name.startsWith(`${namespace}.`);
    const removed: string[] = [];
    for await (const entry of root.values()) {
      if (!matchesNamespace(entry.name)) continue;
      await root.removeEntry(entry.name, { recursive: entry.kind === 'directory' });
      removed.push(entry.name);
    }
    const remaining: string[] = [];
    for await (const entry of root.values()) {
      if (matchesNamespace(entry.name)) remaining.push(entry.name);
    }
    return { namespace, removed, remaining };
  },

  async close() {
    if (handle !== null) await handle.repo.close();
    handle = null;
    return { closed: true };
  },

  classify(error: unknown) {
    if (error instanceof GuardConflictError || isDurableConflict(error)) return 'guard';
    if (error instanceof StorageFailureError) return error.reason;
    if (error instanceof StorageUnsupportedError) return error.code;
    return 'other';
  },
};

(globalThis as unknown as { __p04b: typeof pageApi }).__p04b = pageApi;
