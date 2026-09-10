/**
 * Durable v2 guest repository: hydrate, synchronous overlay, guarded commit.
 *
 * Implements `ScopedRepository` plus the P03 conformance test hooks. Reads
 * after open/commit are served from a frozen snapshot; every commit rechecks
 * guards inside one SQLite transaction on the dedicated worker.
 */
/* eslint-env browser */

import { canonicalJson } from '../../domain/contracts/canonical';
import {
  HANDLER_CLOCK_PROVENANCE_VERSION,
  SYNC_RECORD_SCHEMA_VERSION,
  initialOutboxDelivery,
  recordDeliveryAttempt,
  type DeliveryAttemptOutcome,
  type OperationRecord,
  type OutboxDeliveryState,
  type OutboxEnvelope,
} from '../../domain/contracts/commands';
import { isRepresentableInstantMs } from '../../domain/primitives/instant';
import type { BookState } from '../../domain/contracts/ledger';
import type { DeviceId, RepositoryScopeId } from '../../domain/sync/scope';
import type { PulledOperation, ReplicationStreamId, SyncCursor } from '../../domain/sync/cursors';
import type {
  BookId,
  EntryId,
  GoalId,
  ObligationId,
  ObservationId,
  OccurrenceId,
  OperationId,
  PlanId,
  SettlementId,
} from '../../domain/contracts/identity';
import type {
  EntryLocation,
  FinanceReadModel,
  GoalLocation,
  ObligationLocation,
  ObservationLocation,
  OccurrenceLocation,
  PlanLocation,
  RepositoryTransaction,
  ScopedRepository,
  SettlementLocation,
} from '../../domain/contracts/repository';
import { GuardConflictError, StorageFailureError } from './errors';
import { frozenCopyOf } from './json-copy';
import { invalidateChannelNameFor } from './namespace';
import {
  DurableTransaction,
  emptyHydratedStore,
  type CheckpointStreamState,
  type DurableWriteMethod,
  type HydratedStore,
  type StagedDelta,
} from './overlay';
import type { CommitDeltaPayload, HydratedPayload } from './protocol';
import { SqliteWorkerClient } from './worker-client';

export interface DurableGuestRepositoryOptions {
  readonly client: SqliteWorkerClient;
  readonly boundScope: RepositoryScopeId;
  readonly boundDevice: DeviceId;
  readonly sqliteAssetBase: string;
  readonly schemaSql: string;
  readonly schemaVersion: number;
  readonly storageId?: string;
  readonly workerUrl: string;
}

export class DurableGuestRepository implements ScopedRepository, FinanceReadModel {
  readonly boundScope: RepositoryScopeId;
  readonly boundDevice: DeviceId;
  readonly storageId: string | undefined;
  readonly workerUrl: string;
  readonly sqliteAssetBase: string;
  readonly schemaSql: string;
  readonly schemaVersion: number;
  private client: SqliteWorkerClient;
  private cache: HydratedStore | null = null;
  private injectedFailure: { method: DurableWriteMethod; remaining: number } | null = null;
  private invalidateChannel: BroadcastChannel | null = null;
  private closed = false;
  private parkBeforeCommit = false;
  private beforeCommitParked = false;
  private beforeCommitParkWaiter: ((value: true) => void) | null = null;

  constructor(options: DurableGuestRepositoryOptions) {
    this.client = options.client;
    this.boundScope = options.boundScope;
    this.boundDevice = options.boundDevice;
    this.storageId = options.storageId;
    this.workerUrl = options.workerUrl;
    this.sqliteAssetBase = options.sqliteAssetBase;
    this.schemaSql = options.schemaSql;
    this.schemaVersion = options.schemaVersion;
    this.listenForInvalidation();
  }

  get namespace(): string {
    return this.client.namespace;
  }

  async open(reset = false): Promise<void> {
    this.assertOpenHandle();
    await this.client.open({
      namespace: this.client.namespace,
      sqliteAssetBase: this.sqliteAssetBase,
      schemaSql: this.schemaSql,
      schemaVersion: this.schemaVersion,
      boundScope: this.boundScope as string,
      boundDevice: this.boundDevice as string,
      reset,
    });
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.assertOpenHandle();
    this.cache = storeFromPayload(await this.client.hydrate());
  }

  async close(): Promise<void> {
    this.invalidateChannel?.close();
    this.invalidateChannel = null;
    await this.client.close();
    this.cache = null;
    this.closed = true;
  }

  terminateWorker(): void {
    this.client.terminate();
    this.cache = null;
  }

  async reopen(): Promise<DurableGuestRepository> {
    const next = new DurableGuestRepository({
      client: this.client,
      boundScope: this.boundScope,
      boundDevice: this.boundDevice,
      sqliteAssetBase: this.sqliteAssetBase,
      schemaSql: this.schemaSql,
      schemaVersion: this.schemaVersion,
      storageId: this.storageId,
      workerUrl: this.workerUrl,
    });
    await next.refresh();
    return next;
  }

  /** Fresh worker/connection over the same namespace (schema/open path). */
  async reopenConnection(): Promise<DurableGuestRepository> {
    const namespace = this.client.namespace;
    this.client.terminate();
    this.cache = null;
    this.closed = true;
    const client = new SqliteWorkerClient({ workerUrl: this.workerUrl, namespace });
    const next = new DurableGuestRepository({
      client,
      boundScope: this.boundScope,
      boundDevice: this.boundDevice,
      sqliteAssetBase: this.sqliteAssetBase,
      schemaSql: this.schemaSql,
      schemaVersion: this.schemaVersion,
      storageId: this.storageId,
      workerUrl: this.workerUrl,
    });
    try {
      await next.open(false);
    } catch (error) {
      await next.close().catch(() => undefined);
      throw error;
    }
    return next;
  }

  injectWriteFailure(method: DurableWriteMethod, occurrences = 1): void {
    this.injectedFailure = { method, remaining: occurrences };
  }

  async armParkAfterBegin(): Promise<void> {
    await this.client.armParkAfterBegin();
  }

  async armParkDuringHydrate(): Promise<void> {
    await this.client.armParkDuringHydrate();
  }

  async resumeParked(): Promise<void> {
    await this.client.resumeParked();
  }

  armParkBeforeCommit(): void {
    this.parkBeforeCommit = true;
    this.beforeCommitParked = false;
  }

  async armHangAfterCommit(): Promise<void> {
    await this.client.armHangAfterCommit();
  }

  async armInjectedCommitFailure(): Promise<void> {
    await this.client.armInjectedCommitFailure();
  }

  async forceSchemaVersion(version: string): Promise<void> {
    await this.client.forceSchemaVersion(version);
  }

  waitPark(timeoutMs?: number): Promise<true> {
    return this.client.waitPark(timeoutMs);
  }

  waitParkBeforeCommit(timeoutMs = 20_000): Promise<true> {
    if (this.beforeCommitParked) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.beforeCommitParkWaiter = null;
        reject(new StorageFailureError({ reason: 'worker', message: `before-commit park timeout after ${timeoutMs}ms` }));
      }, timeoutMs);
      this.beforeCommitParkWaiter = () => {
        clearTimeout(timer);
        resolve(true);
      };
    });
  }

  async integrity(): Promise<string> {
    return this.client.integrity();
  }

  getBookState(bookId: BookId): BookState | null {
    const state = this.requireCache().books.get(bookId as string);
    return state === undefined ? null : frozenCopyOf(state);
  }

  locateEntry(entryId: EntryId): EntryLocation | null {
    return this.locateCached('entry', entryId as string);
  }

  locateObligation(obligationId: ObligationId): ObligationLocation | null {
    return this.locateCached('obligation', obligationId as string);
  }

  locateGoal(goalId: GoalId): GoalLocation | null {
    return this.locateCached('goal', goalId as string);
  }

  locateObservation(observationId: ObservationId): ObservationLocation | null {
    return this.locateCached('observation', observationId as string);
  }

  locatePlan(planId: PlanId): PlanLocation | null {
    return this.locateCached('plan', planId as string);
  }

  locateOccurrence(occurrenceId: OccurrenceId): OccurrenceLocation | null {
    return this.locateCached('occurrence', occurrenceId as string);
  }

  locateSettlement(settlementId: SettlementId): SettlementLocation | null {
    return this.locateCached('settlement', settlementId as string);
  }

  getOperation(operationId: OperationId): OperationRecord | null {
    const record = this.requireCache().operations.get(operationId as string);
    return record === undefined ? null : frozenCopyOf(record);
  }

  listOutbox(): readonly OutboxEnvelope[] {
    return frozenCopyOf(this.requireCache().outbox);
  }

  getDeliveryState(operationId: OperationId): OutboxDeliveryState | null {
    const state = this.requireCache().delivery.get(operationId as string);
    return state === undefined ? null : frozenCopyOf(state);
  }

  committedCheckpoint(streamId: ReplicationStreamId): CheckpointStreamState | null {
    const state = this.requireCache().checkpoints.get(streamId as string);
    if (state === undefined) return null;
    return {
      cursor: state.cursor,
      batchDigest: state.batchDigest,
      applied: new Map(state.applied),
    };
  }

  snapshotBytes(): string {
    const store = this.requireCache();
    const books = [...store.books.values()].sort((left, right) =>
      (left.book.id as string) < (right.book.id as string) ? -1 : 1,
    );
    const operations = [...store.operations.values()].sort((left, right) =>
      (left.operationId as string) < (right.operationId as string) ? -1 : 1,
    );
    const delivery = [...store.delivery.values()].sort((left, right) =>
      (left.operationId as string) < (right.operationId as string) ? -1 : 1,
    );
    return canonicalJson({
      books,
      operations,
      outbox: store.outbox,
      delivery,
      enqueueSequence: store.enqueueSequence,
    });
  }

  checkpointSnapshotBytes(): string {
    const store = this.requireCache();
    const streams = [...store.checkpoints.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([streamId, state]) => ({
        streamId,
        cursor: state.cursor,
        batchDigest: state.batchDigest,
        applied: [...state.applied.values()],
      }));
    return canonicalJson({ scopeId: this.boundScope as string, streams });
  }

  async updateDeliveryState(operationId: OperationId, outcome: DeliveryAttemptOutcome): Promise<OutboxDeliveryState> {
    const intent = this.requireCache().outbox.find((envelope) => (envelope.operationId as string) === (operationId as string));
    if (intent === undefined) throw new Error(`unknown operation for delivery update: ${operationId as string}`);
    const frozenIntent = frozenCopyOf(intent);
    return this.runTransaction((transaction) => {
      const staged = asDurableTransaction(transaction);
      const current = staged.getDeliveryState(operationId);
      const next = recordDeliveryAttempt(current ?? initialOutboxDelivery(frozenIntent), outcome);
      staged.putDeliveryState(next);
      return frozenCopyOf(next);
    });
  }

  async runTransaction<T>(work: (transaction: RepositoryTransaction) => T | Promise<T>): Promise<T> {
    this.assertOpenHandle();
    const base = storeFromPayload(await this.client.hydrate());
    const transaction = new DurableTransaction(base, (method) => this.takeInjectedFailure(method));
    let result: T;
    try {
      result = await work(transaction);
    } catch (error) {
      transaction.abandon();
      throw error;
    }
    if (this.parkBeforeCommit) {
      this.parkBeforeCommit = false;
      this.beforeCommitParked = true;
      this.beforeCommitParkWaiter?.(true);
      this.beforeCommitParkWaiter = null;
      await new Promise(() => {
        /* terminated by the caller before durable commit begins */
      });
    }
    try {
      await this.commit(transaction);
    } catch (error) {
      transaction.abandon();
      if (isPoisonedConnection(error)) {
        await this.recoverConnection();
      }
      throw error;
    }
    return result;
  }

  private async commit(transaction: DurableTransaction): Promise<void> {
    const delta = transaction.stagedDelta();
    await this.client.commit(deltaToPayload(delta));
    transaction.deactivate();
    await this.refresh();
    this.broadcastInvalidation();
  }

  private async recoverConnection(): Promise<void> {
    const namespace = this.client.namespace;
    this.client.terminate();
    this.client = new SqliteWorkerClient({ workerUrl: this.workerUrl, namespace });
    try {
      await this.open(false);
    } catch {
      this.cache = null;
    }
  }

  private takeInjectedFailure(method: DurableWriteMethod): boolean {
    if (this.injectedFailure === null) return false;
    if (this.injectedFailure.method !== method) return false;
    this.injectedFailure.remaining -= 1;
    if (this.injectedFailure.remaining <= 0) this.injectedFailure = null;
    return true;
  }

  private requireCache(): HydratedStore {
    if (this.cache === null) throw new StorageFailureError({ reason: 'closed', message: 'durable repository is not open' });
    return this.cache;
  }

  private assertOpenHandle(): void {
    if (this.closed) throw new StorageFailureError({ reason: 'closed', message: 'durable repository is closed' });
  }

  private locateCached<TLocation>(
    kind: 'entry' | 'obligation' | 'goal' | 'observation' | 'plan' | 'occurrence' | 'settlement',
    id: string,
  ): TLocation | null {
    for (const state of this.requireCache().books.values()) {
      if (kind === 'entry') {
        const entry = state.entries.find((candidate) => candidate.entryId === id);
        if (entry !== undefined) return { bookId: entry.bookId, entryId: entry.entryId, kind: entry.kind } as unknown as TLocation;
      } else if (kind === 'obligation') {
        const obligation = state.obligations.find((candidate) => candidate.obligationId === id);
        if (obligation !== undefined) {
          return { bookId: obligation.bookId, obligationId: obligation.obligationId } as unknown as TLocation;
        }
      } else if (kind === 'goal') {
        const goal = state.goals.find((candidate) => candidate.goalId === id);
        if (goal !== undefined) return { bookId: goal.bookId, goalId: goal.goalId } as unknown as TLocation;
      } else if (kind === 'observation') {
        const observation = state.observations.find((candidate) => candidate.observationId === id);
        if (observation !== undefined) {
          return { bookId: observation.bookId, observationId: observation.observationId } as unknown as TLocation;
        }
      } else if (kind === 'plan') {
        const plan = state.plans.find((candidate) => candidate.planId === id);
        if (plan !== undefined) return { bookId: plan.bookId, planId: plan.planId } as unknown as TLocation;
      } else if (kind === 'occurrence') {
        const occurrence = state.planOccurrences.find((candidate) => candidate.occurrenceId === id);
        if (occurrence !== undefined) {
          return { bookId: occurrence.bookId, occurrenceId: occurrence.occurrenceId } as unknown as TLocation;
        }
      } else {
        const settlement = state.settlements.find((candidate) => candidate.settlementId === id);
        if (settlement !== undefined) {
          return { bookId: settlement.bookId, settlementId: settlement.settlementId } as unknown as TLocation;
        }
      }
    }
    return null;
  }

  private listenForInvalidation(): void {
    if (typeof BroadcastChannel === 'undefined') return;
    this.invalidateChannel = new BroadcastChannel(invalidateChannelNameFor(this.client.namespace));
    this.invalidateChannel.onmessage = () => {
      /* next runTransaction hydrates fresh; preview may be stale and lose at execute */
    };
  }

  private broadcastInvalidation(): void {
    this.invalidateChannel?.postMessage({ type: 'committed' });
  }
}

export function asDurableTransaction(transaction: RepositoryTransaction): DurableTransaction {
  if (!(transaction instanceof DurableTransaction)) {
    throw new Error('checkpoint apply requires the durable v2 repository transaction');
  }
  return transaction;
}

function storeFromPayload(payload: HydratedPayload): HydratedStore {
  assertCurrentSyncRecords(payload.operations, payload.outbox, payload.delivery);
  const store = emptyHydratedStore();
  for (const book of payload.books) {
    const state = book as BookState;
    store.books.set(state.book.id as string, state);
  }
  for (const record of payload.operations) {
    const operation = record as OperationRecord;
    store.operations.set(operation.operationId as string, operation);
  }
  for (const envelope of payload.outbox) {
    store.outbox.push(envelope as OutboxEnvelope);
  }
  for (const record of payload.delivery) {
    const state = record as OutboxDeliveryState;
    store.delivery.set(state.operationId as string, state);
  }
  store.enqueueSequence = payload.enqueueSequence;
  for (const checkpoint of payload.checkpoints) {
    const applied = new Map<string, PulledOperation>();
    for (const item of checkpoint.applied) {
      const operation = item as PulledOperation;
      applied.set(operation.operationId as string, operation);
    }
    store.checkpoints.set(checkpoint.streamId, {
      cursor: checkpoint.cursor as SyncCursor | null,
      batchDigest: checkpoint.batchDigest,
      applied,
    });
  }
  return store;
}

function deltaToPayload(delta: StagedDelta): CommitDeltaPayload {
  assertCurrentSyncRecords(
    [...delta.operationWrites.values()],
    delta.outboxWrites,
    [...delta.deliveryWrites.values()],
  );
  return {
    bookRevisionsRead: [...delta.bookRevisionsRead.entries()],
    operationIds: delta.operationIds,
    outboxOperationIds: delta.outboxOperationIds,
    deliveryVersionsRead: [...delta.deliveryVersionsRead.entries()],
    checkpointCursorsRead: [...delta.checkpointCursorsRead.entries()],
    bookWrites: [...delta.bookWrites.entries()].map(([bookId, state]) => [bookId, state.revision, JSON.stringify(state)]),
    operationWrites: [...delta.operationWrites.entries()].map(([operationId, record]) => [
      operationId,
      record.enqueueSequence as number,
      JSON.stringify(record),
    ]),
    outboxWrites: delta.outboxWrites.map((envelope) => [
      envelope.operationId as string,
      envelope.enqueueSequence as number,
      JSON.stringify(envelope),
    ]),
    deliveryWrites: [...delta.deliveryWrites.entries()].map(([operationId, state]) => [
      operationId,
      state.version,
      JSON.stringify(state),
    ]),
    checkpointWrites: [...delta.checkpointWrites.entries()].map(([streamId, state]) => ({
      streamId,
      cursor: (state.cursor as string | null) ?? null,
      batchDigest: state.batchDigest,
      appliedJson: JSON.stringify([...state.applied.values()]),
    })),
    sequenceBase: delta.sequenceBase,
    sequencesAllocated: delta.sequencesAllocated,
  };
}

function assertCurrentSyncRecords(
  operations: readonly unknown[],
  outbox: readonly unknown[],
  delivery: readonly unknown[],
): void {
  const reject = (message: string): never => {
    throw new StorageFailureError({ reason: 'schema', message });
  };
  const asRecord = (value: unknown, label: string): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return reject(`${label} is not an object`);
    }
    return value as Record<string, unknown>;
  };
  for (const raw of operations) {
    const operation = asRecord(raw, 'journal record');
    const operationId = typeof operation['operationId'] === 'string' ? operation['operationId'] : '<unknown>';
    if (operation['schemaVersion'] !== SYNC_RECORD_SCHEMA_VERSION) {
      reject(`journal record ${operationId} uses a legacy sync schema without handler-clock provenance`);
    }
    const receipt = asRecord(operation['receipt'], `journal record ${operationId} receipt`);
    if (receipt['schemaVersion'] !== SYNC_RECORD_SCHEMA_VERSION) {
      reject(`journal record ${operationId} receipt uses a legacy sync schema without handler-clock provenance`);
    }
    if (
      operation['handlerClockVersion'] !== HANDLER_CLOCK_PROVENANCE_VERSION ||
      receipt['handlerClockVersion'] !== HANDLER_CLOCK_PROVENANCE_VERSION
    ) {
      reject(`journal record ${operationId} lacks current versioned handler-clock provenance`);
    }
    const operationTrace = operation['handlerClockInstants'];
    const receiptTrace = receipt['handlerClockInstants'];
    if (!Array.isArray(operationTrace) || !Array.isArray(receiptTrace)) {
      reject(`journal record ${operationId} is missing its versioned handler clock trace`);
    }
    const operationInstants = operationTrace as unknown[];
    const receiptInstants = receiptTrace as unknown[];
    if (operationInstants.length !== receiptInstants.length) {
      reject(`journal record ${operationId} handler clock trace does not match its receipt`);
    }
    for (let index = 0; index < operationInstants.length; index += 1) {
      if (!isRepresentableInstantMs(operationInstants[index])) {
        reject(`journal record ${operationId} handler clock trace contains an unrepresentable instant`);
      }
      if (operationInstants[index] !== receiptInstants[index]) {
        reject(`journal record ${operationId} handler clock trace does not match its receipt`);
      }
    }
  }
  for (const raw of outbox) {
    const envelope = asRecord(raw, 'outbox record');
    if (envelope['schemaVersion'] !== SYNC_RECORD_SCHEMA_VERSION) {
      reject('outbox record uses a legacy sync schema without handler-clock provenance');
    }
  }
  for (const raw of delivery) {
    const state = asRecord(raw, 'delivery record');
    if (state['schemaVersion'] !== SYNC_RECORD_SCHEMA_VERSION) {
      reject('delivery record uses a legacy sync schema without handler-clock provenance');
    }
  }
}

function isPoisonedConnection(error: unknown): boolean {
  if (error instanceof GuardConflictError) return false;
  if (error instanceof StorageFailureError && (error.reason === 'busy' || error.reason === 'scopeMismatch')) return false;
  return true;
}
