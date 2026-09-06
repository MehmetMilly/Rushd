/**
 * Transactional in-memory reference adapter for the repository port.
 *
 * This is the adapter P03 Task A uses to prove the command protocol in one
 * process. It is deliberately strict so it models what a real adapter owes
 * the application:
 *
 * - Uncommitted mutations stay in a per-transaction overlay and are merged
 *   only when the transaction body returns normally.
 * - Reads return deep-frozen copies, so neither handlers nor tests can write
 *   through a snapshot into repository internals.
 * - A `putBookState` fails when the committed book changed since this
 *   transaction first read it (first-committer-wins), and when the written
 *   revision is not exactly the read revision + 1. Every other
 *   read-dependent write (operation uniqueness, outbox uniqueness,
 *   delivery versions, enqueue counter, checkpoints) is rechecked at
 *   commit before any committed store is mutated; the full delta then
 *   applies by clone-and-swap.
 * - Any exception abandons the overlay: state, journal, outbox, delivery,
 *   and checkpoints are exactly as before. Commit failures never leave a
 *   partial delta behind and never restore a whole-adapter snapshot over
 *   concurrent successful work.
 * - `injectWriteFailure` simulates a crash between tentative writes.
 *
 * This proves protocol behavior in one process. It is NOT evidence of
 * crash-safe browser durability; P04 must prove that on the persistent
 * adapter.
 */

import type {
  DeliveryAttemptOutcome,
  OperationRecord,
  OutboxDeliveryState,
  OutboxEnvelope,
} from '../../../src/domain/contracts/commands';
import { initialOutboxDelivery, recordDeliveryAttempt } from '../../../src/domain/contracts/commands';
import { canonicalJson } from '../../../src/domain/contracts/canonical';
import type { BookState } from '../../../src/domain/contracts/ledger';
import { makeDeviceId, makeGuestKey, repositoryScopeIdFor, type DeviceId, type RepositoryScopeId } from '../../../src/domain/sync/scope';
import {
  type PulledOperation,
  type ReplicationStreamId,
  type SyncCursor,
} from '../../../src/domain/sync/cursors';
import { DEFAULT_DEVICE_ID, DEFAULT_GUEST_KEY } from './deterministic-context';
import type { BookId, EntryId, GoalId, ObligationId, ObservationId, OccurrenceId, OperationId, PlanId, SettlementId } from '../../../src/domain/contracts/identity';
import type {
  EntryLocation,
  FinanceReadModel,
  GoalLocation,
  ObligationLocation,
  ObservationLocation,
  OccurrenceLocation,
  PlanLocation,
  RepositoryTransaction,
  SettlementLocation,
  TransactionalRepository,
} from '../../../src/domain/contracts/repository';

export class ConcurrencyConflictError extends Error {}

export type WriteMethodName = 'putBookState' | 'putOperation' | 'putOutboxEntry' | 'putDeliveryState';

export interface CheckpointStreamState {
  cursor: SyncCursor | null;
  batchDigest: string | null;
  applied: Map<string, PulledOperation>;
}

interface CommittedStore {
  books: Map<string, BookState>;
  operations: Map<string, OperationRecord>;
  outbox: OutboxEnvelope[];
  /** Mutable delivery metadata per operation, owned by the adapter. Canonical records never live here. */
  delivery: Map<string, OutboxDeliveryState>;
  /** Durable local enqueue counter, finalized atomically at commit; aborted transactions leave it untouched. */
  enqueueSequence: number;
  /** Pull checkpoints committed atomically with finance effects in the same store. */
  checkpoints: Map<string, CheckpointStreamState>;
  entryIndex: Map<string, EntryLocation>;
  obligationIndex: Map<string, ObligationLocation>;
  goalIndex: Map<string, GoalLocation>;
  observationIndex: Map<string, ObservationLocation>;
  planIndex: Map<string, PlanLocation>;
  occurrenceIndex: Map<string, OccurrenceLocation>;
  settlementIndex: Map<string, SettlementLocation>;
}

function createCommittedStore(): CommittedStore {
  return {
    books: new Map(),
    operations: new Map(),
    outbox: [],
    delivery: new Map(),
    enqueueSequence: 0,
    checkpoints: new Map(),
    entryIndex: new Map(),
    obligationIndex: new Map(),
    goalIndex: new Map(),
    observationIndex: new Map(),
    planIndex: new Map(),
    occurrenceIndex: new Map(),
    settlementIndex: new Map(),
  };
}

function cloneValue<T>(value: T): T {
  // Domain records are JSON-safe by construction, so a JSON roundtrip is an
  // exact deep copy here.
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** A defensively cloned, deeply frozen copy: safe to hand to any caller. */
function frozenCopy<T>(value: T): T {
  return deepFreeze(cloneValue(value));
}

function cloneCheckpoints(source: Map<string, CheckpointStreamState>): Map<string, CheckpointStreamState> {
  const next = new Map<string, CheckpointStreamState>();
  for (const [streamId, state] of source) {
    next.set(streamId, {
      cursor: state.cursor,
      batchDigest: state.batchDigest,
      applied: new Map(state.applied),
    });
  }
  return next;
}

function buildIndexes(books: Map<string, BookState>): Pick<
  CommittedStore,
  | 'entryIndex'
  | 'obligationIndex'
  | 'goalIndex'
  | 'observationIndex'
  | 'planIndex'
  | 'occurrenceIndex'
  | 'settlementIndex'
> {
  const entryIndex = new Map<string, EntryLocation>();
  const obligationIndex = new Map<string, ObligationLocation>();
  const goalIndex = new Map<string, GoalLocation>();
  const observationIndex = new Map<string, ObservationLocation>();
  const planIndex = new Map<string, PlanLocation>();
  const occurrenceIndex = new Map<string, OccurrenceLocation>();
  const settlementIndex = new Map<string, SettlementLocation>();
  for (const state of books.values()) {
    for (const entry of state.entries) {
      entryIndex.set(entry.entryId, { bookId: entry.bookId, entryId: entry.entryId, kind: entry.kind });
    }
    for (const obligation of state.obligations) {
      obligationIndex.set(obligation.obligationId, { bookId: obligation.bookId, obligationId: obligation.obligationId });
    }
    for (const goal of state.goals) {
      goalIndex.set(goal.goalId, { bookId: goal.bookId, goalId: goal.goalId });
    }
    for (const observation of state.observations) {
      observationIndex.set(observation.observationId, { bookId: observation.bookId, observationId: observation.observationId });
    }
    for (const plan of state.plans) {
      planIndex.set(plan.planId, { bookId: plan.bookId, planId: plan.planId });
    }
    for (const occurrence of state.planOccurrences) {
      occurrenceIndex.set(occurrence.occurrenceId, { bookId: occurrence.bookId, occurrenceId: occurrence.occurrenceId });
    }
    for (const settlement of state.settlements) {
      settlementIndex.set(settlement.settlementId, { bookId: settlement.bookId, settlementId: settlement.settlementId });
    }
  }
  return { entryIndex, obligationIndex, goalIndex, observationIndex, planIndex, occurrenceIndex, settlementIndex };
}

/** Construction options for the reference adapter. The scope/device binding is immutable per handle. */
export interface InMemoryRepositoryOptions {
  readonly boundScope?: RepositoryScopeId;
  readonly boundDevice?: DeviceId;
  readonly sharedStore?: CommittedStore;
}

function defaultTestDevice(): DeviceId {
  const made = makeDeviceId(DEFAULT_DEVICE_ID);
  if (!made.ok) throw new Error(`invalid test device default: ${made.failure.detail}`);
  return made.value;
}

function defaultTestScope(deviceId: DeviceId): RepositoryScopeId {
  const guest = makeGuestKey(DEFAULT_GUEST_KEY);
  if (!guest.ok) throw new Error(`invalid test guest default: ${guest.failure.detail}`);
  return repositoryScopeIdFor({ kind: 'guest', guestKey: guest.value, deviceId });
}

export class InMemoryFinanceRepository implements TransactionalRepository, FinanceReadModel {
  /**
   * Immutable scope binding for this handle. The command layer verifies the
   * caller origin against it before any read, replay, or mutation.
   */
  readonly boundScope: RepositoryScopeId;
  readonly boundDevice: DeviceId;
  private readonly store: CommittedStore;
  private injectedFailure: { method: WriteMethodName; remaining: number } | null = null;

  constructor(options: InMemoryRepositoryOptions = {}) {
    this.store = options.sharedStore ?? createCommittedStore();
    this.boundDevice = options.boundDevice ?? defaultTestDevice();
    this.boundScope = options.boundScope ?? defaultTestScope(this.boundDevice);
  }

  /** Simulates an adapter crash on the next N calls to the given write method. */
  injectWriteFailure(method: WriteMethodName, occurrences = 1): void {
    this.injectedFailure = { method, remaining: occurrences };
  }

  /**
   * Test-adapter-specific handle reacquisition over the same durable state:
   * the uncertain-commit proof commits through one handle, drops the
   * acknowledgement, then retries through this fresh handle. The scope
   * binding is preserved: a reopened handle never serves another scope.
   * P04's persistent adapter reacquires a real database connection instead;
   * the behavioral contract (exact idempotent replay) is identical.
   */
  reopen(): InMemoryFinanceRepository {
    return new InMemoryFinanceRepository({ boundScope: this.boundScope, boundDevice: this.boundDevice, sharedStore: this.store });
  }

  /**
   * Test-adapter-specific canonical snapshot of everything the adapter has
   * committed (books, journal, outbox, delivery metadata, sequence
   * counter). Rollback proofs compare this string before and after a failed
   * attempt: byte-identical means the attempt left no trace.
   */
  snapshotBytes(): string {
    const books = [...this.store.books.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).map(([, state]) => state);
    const operations = [...this.store.operations.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, record]) => record);
    const delivery = [...this.store.delivery.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, state]) => state);
    return canonicalJson({ books, operations, outbox: this.store.outbox, delivery, enqueueSequence: this.store.enqueueSequence });
  }

  getBookState(bookId: BookId): BookState | null {
    const state = this.store.books.get(bookId);
    return state === undefined ? null : frozenCopy(state);
  }

  locateEntry(entryId: EntryId): EntryLocation | null {
    const location = this.store.entryIndex.get(entryId);
    return location === undefined ? null : { ...location };
  }

  locateObligation(obligationId: ObligationId): ObligationLocation | null {
    const location = this.store.obligationIndex.get(obligationId);
    return location === undefined ? null : { ...location };
  }

  locateGoal(goalId: GoalId): GoalLocation | null {
    const location = this.store.goalIndex.get(goalId);
    return location === undefined ? null : { ...location };
  }

  locateObservation(observationId: ObservationId): ObservationLocation | null {
    const location = this.store.observationIndex.get(observationId);
    return location === undefined ? null : { ...location };
  }

  locatePlan(planId: PlanId): PlanLocation | null {
    const location = this.store.planIndex.get(planId);
    return location === undefined ? null : { ...location };
  }

  locateOccurrence(occurrenceId: OccurrenceId): OccurrenceLocation | null {
    const location = this.store.occurrenceIndex.get(occurrenceId);
    return location === undefined ? null : { ...location };
  }

  locateSettlement(settlementId: SettlementId): SettlementLocation | null {
    const location = this.store.settlementIndex.get(settlementId);
    return location === undefined ? null : { ...location };
  }

  /** Test accessor to the committed operation journal. */
  getOperation(operationId: OperationId): OperationRecord | null {
    const record = this.store.operations.get(operationId);
    return record === undefined ? null : frozenCopy(record);
  }

  /** Test accessor to the committed outbox in append order. */
  listOutbox(): readonly OutboxEnvelope[] {
    return frozenCopy(this.store.outbox);
  }

  /**
   * Committed checkpoint stream, if any. The checkpoint store reads this
   * outside a transaction; writes go through the same commit delta as finance.
   */
  committedCheckpoint(streamId: ReplicationStreamId): CheckpointStreamState | null {
    const state = this.store.checkpoints.get(streamId as string);
    if (state === undefined) return null;
    return {
      cursor: state.cursor,
      batchDigest: state.batchDigest,
      applied: new Map(state.applied),
    };
  }

  checkpointSnapshotBytes(): string {
    const streams = [...this.store.checkpoints.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([streamId, state]) => ({
        streamId,
        cursor: state.cursor,
        batchDigest: state.batchDigest,
        applied: [...state.applied.values()],
      }));
    return canonicalJson({ scopeId: this.boundScope as string, streams });
  }

  /** Test-adapter-specific accessor to persisted delivery metadata. */
  getDeliveryState(operationId: OperationId): OutboxDeliveryState | null {
    const state = this.store.delivery.get(operationId);
    return state === undefined ? null : frozenCopy(state);
  }

  /**
   * Test-adapter-specific delivery persistence boundary: records one
   * transport attempt for a committed operation inside its own atomic
   * transaction, reading through the transaction so concurrent workers
   * serialize or fail explicitly. The conformance suite injects
   * `putDeliveryState` failures here to prove byte-identical rollback and
   * exactly-one retry. Unknown operations throw: delivery metadata never
   * exists without its intent.
   */
  async updateDeliveryState(operationId: OperationId, outcome: DeliveryAttemptOutcome): Promise<OutboxDeliveryState> {
    return this.runTransaction((transaction) => {
      const tx = transaction as InMemoryTransaction;
      const current = tx.getDeliveryState(operationId);
      let base: OutboxDeliveryState;
      if (current !== null) {
        base = current;
      } else {
        const intent = this.store.outbox.find((envelope) => (envelope.operationId as string) === (operationId as string));
        if (intent === undefined) {
          throw new Error(`unknown operation for delivery update: ${operationId as string}`);
        }
        base = initialOutboxDelivery(intent);
      }
      const next = recordDeliveryAttempt(cloneValue(base), outcome);
      tx.putDeliveryState(next);
      return frozenCopy(next);
    });
  }

  async runTransaction<T>(work: (transaction: RepositoryTransaction) => T | Promise<T>): Promise<T> {
    const transaction = new InMemoryTransaction(this.store, (method: WriteMethodName) => this.takeInjectedFailure(method));
    let result: T;
    try {
      result = await work(transaction);
    } catch (error) {
      transaction.abandon();
      throw error;
    }
    try {
      transaction.commit();
    } catch (error) {
      transaction.abandon();
      throw error;
    }
    return result;
  }

  private takeInjectedFailure(method: WriteMethodName): boolean {
    if (this.injectedFailure === null) return false;
    if (this.injectedFailure.method !== method) return false;
    this.injectedFailure.remaining -= 1;
    if (this.injectedFailure.remaining <= 0) this.injectedFailure = null;
    return true;
  }

  private indexEntries(state: BookState): void {
    for (const entry of state.entries) {
      this.store.entryIndex.set(entry.entryId, { bookId: entry.bookId, entryId: entry.entryId, kind: entry.kind });
    }
    for (const obligation of state.obligations) {
      this.store.obligationIndex.set(obligation.obligationId, { bookId: obligation.bookId, obligationId: obligation.obligationId });
    }
    for (const goal of state.goals) {
      this.store.goalIndex.set(goal.goalId, { bookId: goal.bookId, goalId: goal.goalId });
    }
  }
}

export class InMemoryTransaction implements RepositoryTransaction {
  private readonly bookWrites = new Map<string, BookState>();
  private readonly operationWrites = new Map<string, OperationRecord>();
  private readonly outboxWrites: OutboxEnvelope[] = [];
  private readonly deliveryWrites = new Map<string, OutboxDeliveryState>();
  private readonly deliveryVersionAtRead = new Map<string, number | null>();
  private readonly bookRevisionAtRead = new Map<string, number>();
  private readonly checkpointWrites = new Map<string, CheckpointStreamState>();
  private readonly checkpointCursorAtRead = new Map<string, SyncCursor | null>();
  private sequenceBase: number | null = null;
  private sequencesAllocated = 0;
  private active = true;

  constructor(
    private readonly store: CommittedStore,
    private readonly takeInjectedFailure: (method: WriteMethodName) => boolean,
  ) {}

  getBookState(bookId: BookId): BookState | null {
    this.assertActive();
    const local = this.bookWrites.get(bookId);
    if (local !== undefined) return frozenCopy(local);
    const committed = this.store.books.get(bookId);
    if (committed === undefined) {
      this.bookRevisionAtRead.set(bookId, 0);
      return null;
    }
    this.bookRevisionAtRead.set(bookId, committed.revision);
    return frozenCopy(committed);
  }

  locateEntry(entryId: EntryId): EntryLocation | null {
    this.assertActive();
    for (const state of this.bookWrites.values()) {
      const entry = state.entries.find((candidate) => candidate.entryId === entryId);
      if (entry !== undefined) {
        return { bookId: entry.bookId, entryId: entry.entryId, kind: entry.kind };
      }
    }
    const location = this.store.entryIndex.get(entryId);
    return location === undefined ? null : { ...location };
  }

  locateObligation(obligationId: ObligationId): ObligationLocation | null {
    this.assertActive();
    for (const state of this.bookWrites.values()) {
      const obligation = state.obligations.find((candidate) => candidate.obligationId === obligationId);
      if (obligation !== undefined) {
        return { bookId: obligation.bookId, obligationId: obligation.obligationId };
      }
    }
    const location = this.store.obligationIndex.get(obligationId);
    return location === undefined ? null : { ...location };
  }

  locateGoal(goalId: GoalId): GoalLocation | null {
    this.assertActive();
    for (const state of this.bookWrites.values()) {
      const goal = state.goals.find((candidate) => candidate.goalId === goalId);
      if (goal !== undefined) {
        return { bookId: goal.bookId, goalId: goal.goalId };
      }
    }
    const location = this.store.goalIndex.get(goalId);
    return location === undefined ? null : { ...location };
  }

  locateObservation(observationId: ObservationId): ObservationLocation | null {
    this.assertActive();
    for (const state of this.bookWrites.values()) {
      const observation = state.observations.find((candidate) => candidate.observationId === observationId);
      if (observation !== undefined) {
        return { bookId: observation.bookId, observationId: observation.observationId };
      }
    }
    const location = this.store.observationIndex.get(observationId);
    return location === undefined ? null : { ...location };
  }

  locatePlan(planId: PlanId): PlanLocation | null {
    this.assertActive();
    for (const state of this.bookWrites.values()) {
      const plan = state.plans.find((candidate) => candidate.planId === planId);
      if (plan !== undefined) {
        return { bookId: plan.bookId, planId: plan.planId };
      }
    }
    const location = this.store.planIndex.get(planId);
    return location === undefined ? null : { ...location };
  }

  locateOccurrence(occurrenceId: OccurrenceId): OccurrenceLocation | null {
    this.assertActive();
    for (const state of this.bookWrites.values()) {
      const occurrence = state.planOccurrences.find((candidate) => candidate.occurrenceId === occurrenceId);
      if (occurrence !== undefined) {
        return { bookId: occurrence.bookId, occurrenceId: occurrence.occurrenceId };
      }
    }
    const location = this.store.occurrenceIndex.get(occurrenceId);
    return location === undefined ? null : { ...location };
  }

  locateSettlement(settlementId: SettlementId): SettlementLocation | null {
    this.assertActive();
    for (const state of this.bookWrites.values()) {
      const settlement = state.settlements.find((candidate) => candidate.settlementId === settlementId);
      if (settlement !== undefined) {
        return { bookId: settlement.bookId, settlementId: settlement.settlementId };
      }
    }
    const location = this.store.settlementIndex.get(settlementId);
    return location === undefined ? null : { ...location };
  }

  getOperation(operationId: OperationId): OperationRecord | null {
    this.assertActive();
    const local = this.operationWrites.get(operationId);
    if (local !== undefined) return frozenCopy(local);
    const committed = this.store.operations.get(operationId);
    return committed === undefined ? null : frozenCopy(committed);
  }

  putBookState(next: BookState): void {
    this.assertActive();
    if (this.takeInjectedFailure('putBookState')) {
      throw new Error(`injected adapter failure at putBookState (book ${next.book.id}, revision ${next.revision})`);
    }
    const readRevision = this.bookRevisionAtRead.get(next.book.id);
    if (readRevision === undefined) {
      throw new ConcurrencyConflictError(`book ${next.book.id} must be read before it is written in a transaction`);
    }
    const visibleRevision = this.bookWrites.get(next.book.id)?.revision ?? this.store.books.get(next.book.id)?.revision ?? 0;
    if (visibleRevision !== readRevision && this.bookWrites.get(next.book.id) === undefined) {
      throw new ConcurrencyConflictError(
        `book ${next.book.id} changed during the transaction: read revision ${readRevision}, committed ${visibleRevision}`,
      );
    }
    if (next.revision !== visibleRevision + 1) {
      throw new ConcurrencyConflictError(
        `book ${next.book.id} revision must advance by exactly one: read ${visibleRevision}, wrote ${next.revision}`,
      );
    }
    this.bookWrites.set(next.book.id, cloneValue(next));
  }

  putOperation(record: OperationRecord): void {
    this.assertActive();
    if (this.takeInjectedFailure('putOperation')) {
      throw new Error(`injected adapter failure at putOperation (operation ${record.operationId})`);
    }
    if (this.operationWrites.has(record.operationId) || this.store.operations.has(record.operationId)) {
      throw new ConcurrencyConflictError(`operation ${record.operationId} already exists`);
    }
    this.operationWrites.set(record.operationId, cloneValue(record));
  }

  putOutboxEntry(envelope: OutboxEnvelope): void {
    this.assertActive();
    if (this.takeInjectedFailure('putOutboxEntry')) {
      throw new Error(`injected adapter failure at putOutboxEntry (envelope ${envelope.outboxId})`);
    }
    const operationId = envelope.operationId as string;
    if (this.outboxWrites.some((existing) => existing.outboxId === envelope.outboxId) || this.store.outbox.some((existing) => existing.outboxId === envelope.outboxId)) {
      throw new ConcurrencyConflictError(`outbox ${envelope.outboxId} already exists`);
    }
    if (
      this.outboxWrites.some((existing) => (existing.operationId as string) === operationId) ||
      this.store.outbox.some((existing) => (existing.operationId as string) === operationId)
    ) {
      throw new ConcurrencyConflictError(`outbox for operation ${operationId} already exists`);
    }
    this.outboxWrites.push(cloneValue(envelope));
  }

  /**
   * Test-adapter-specific tentative delivery write with first-committer-wins
   * semantics. The record must have been read in this transaction, and must
   * advance exactly one version past the read version (an absent read counts
   * as version 0 via the implicit initial state, so the first staged write
   * is version 1). The commit rechecks the guard against committed state.
   */
  putDeliveryState(next: OutboxDeliveryState): void {
    this.assertActive();
    if (this.takeInjectedFailure('putDeliveryState')) {
      throw new Error(`injected adapter failure at putDeliveryState (operation ${next.operationId as string})`);
    }
    const key = next.operationId as string;
    if (!this.deliveryVersionAtRead.has(key)) {
      throw new ConcurrencyConflictError(`delivery for ${key} must be read before it is written in a transaction`);
    }
    const readVersion = this.deliveryVersionAtRead.get(key) ?? 0;
    if (next.version !== readVersion + 1) {
      throw new ConcurrencyConflictError(
        `delivery for ${key} must advance exactly one version: read ${String(readVersion)}, wrote ${next.version}`,
      );
    }
    this.deliveryWrites.set(key, cloneValue(next));
  }

  getDeliveryState(operationId: OperationId): OutboxDeliveryState | null {
    this.assertActive();
    const key = operationId as string;
    const staged = this.deliveryWrites.get(key);
    if (staged !== undefined) return frozenCopy(staged);
    const committed = this.store.delivery.get(key);
    if (!this.deliveryVersionAtRead.has(key)) {
      this.deliveryVersionAtRead.set(key, committed?.version ?? null);
    }
    return committed === undefined ? null : frozenCopy(committed);
  }

  nextEnqueueSequence(): number {
    this.assertActive();
    // Allocated tentatively against the committed counter and finalized at
    // commit time, so an aborted transaction leaves no gap behind: rollback
    // is byte-identical. Two operations that share a capture millisecond
    // still receive a strict durable order. The commit rejects when another
    // transaction moved the counter meanwhile (first-committer-wins extends
    // to the sequence counter), so P04 adapters must finalize the sequence
    // atomically with the commit.
    if (this.sequenceBase === null) {
      this.sequenceBase = this.store.enqueueSequence;
    }
    this.sequencesAllocated += 1;
    return this.sequenceBase + this.sequencesAllocated;
  }

  getStreamCheckpoint(streamId: ReplicationStreamId): CheckpointStreamState {
    this.assertActive();
    const key = streamId as string;
    const staged = this.checkpointWrites.get(key);
    if (staged !== undefined) {
      return { cursor: staged.cursor, batchDigest: staged.batchDigest, applied: new Map(staged.applied) };
    }
    const committed = this.store.checkpoints.get(key);
    if (!this.checkpointCursorAtRead.has(key)) {
      this.checkpointCursorAtRead.set(key, committed?.cursor ?? null);
    }
    if (committed === undefined) {
      return { cursor: null, batchDigest: null, applied: new Map() };
    }
    return { cursor: committed.cursor, batchDigest: committed.batchDigest, applied: new Map(committed.applied) };
  }

  putStreamCheckpoint(streamId: ReplicationStreamId, next: CheckpointStreamState): void {
    this.assertActive();
    const key = streamId as string;
    if (!this.checkpointCursorAtRead.has(key)) {
      throw new ConcurrencyConflictError(`checkpoint for ${key} must be read before it is written in a transaction`);
    }
    this.checkpointWrites.set(key, {
      cursor: next.cursor,
      batchDigest: next.batchDigest,
      applied: new Map(next.applied),
    });
  }

  commit(): void {
    this.assertActive();
    this.preflightCommitGuards();
    this.swapCommittedDelta();
    this.active = false;
  }

  private preflightCommitGuards(): void {
    if (this.sequenceBase !== null && this.store.enqueueSequence !== this.sequenceBase) {
      throw new ConcurrencyConflictError(
        `enqueue sequence changed during the transaction: read ${this.sequenceBase}, committed ${this.store.enqueueSequence}`,
      );
    }
    for (const bookId of this.bookWrites.keys()) {
      const readRevision = this.bookRevisionAtRead.get(bookId);
      if (readRevision === undefined) {
        throw new ConcurrencyConflictError(`book ${bookId} must be read before it is written in a transaction`);
      }
      const committedRevision = this.store.books.get(bookId)?.revision ?? 0;
      if (committedRevision !== readRevision) {
        throw new ConcurrencyConflictError(
          `book ${bookId} changed during the transaction: read revision ${readRevision}, committed ${committedRevision}`,
        );
      }
    }
    for (const operationId of this.operationWrites.keys()) {
      if (this.store.operations.has(operationId)) {
        throw new ConcurrencyConflictError(`operation ${operationId} already exists`);
      }
    }
    for (const envelope of this.outboxWrites) {
      if (this.store.outbox.some((existing) => existing.outboxId === envelope.outboxId)) {
        throw new ConcurrencyConflictError(`outbox ${envelope.outboxId} already exists`);
      }
      if (this.store.outbox.some((existing) => (existing.operationId as string) === (envelope.operationId as string))) {
        throw new ConcurrencyConflictError(`outbox for operation ${envelope.operationId as string} already exists`);
      }
    }
    for (const [operationId] of this.deliveryWrites) {
      const readVersion = this.deliveryVersionAtRead.get(operationId);
      const committedVersion = this.store.delivery.get(operationId)?.version ?? null;
      if (committedVersion !== readVersion) {
        throw new ConcurrencyConflictError(
          `delivery for ${operationId} changed during the transaction: read ${String(readVersion)}, committed ${String(committedVersion)}`,
        );
      }
    }
    for (const streamId of this.checkpointWrites.keys()) {
      const readCursor = this.checkpointCursorAtRead.get(streamId) ?? null;
      const committedCursor = this.store.checkpoints.get(streamId)?.cursor ?? null;
      if (committedCursor !== readCursor) {
        throw new ConcurrencyConflictError(`checkpoint for ${streamId} changed during the transaction`);
      }
    }
  }

  private swapCommittedDelta(): void {
    const nextBooks = new Map(this.store.books);
    for (const [bookId, state] of this.bookWrites) nextBooks.set(bookId, state);
    const nextOperations = new Map(this.store.operations);
    for (const [operationId, record] of this.operationWrites) nextOperations.set(operationId, record);
    const nextOutbox = [...this.store.outbox, ...this.outboxWrites];
    const nextDelivery = new Map(this.store.delivery);
    for (const [operationId, delivery] of this.deliveryWrites) nextDelivery.set(operationId, delivery);
    const nextCheckpoints = cloneCheckpoints(this.store.checkpoints);
    for (const [streamId, state] of this.checkpointWrites) {
      nextCheckpoints.set(streamId, {
        cursor: state.cursor,
        batchDigest: state.batchDigest,
        applied: new Map(state.applied),
      });
    }
    const nextEnqueue = this.sequenceBase !== null ? this.sequenceBase + this.sequencesAllocated : this.store.enqueueSequence;
    const indexes = buildIndexes(nextBooks);

    this.store.books = nextBooks;
    this.store.operations = nextOperations;
    this.store.outbox = nextOutbox;
    this.store.delivery = nextDelivery;
    this.store.checkpoints = nextCheckpoints;
    this.store.enqueueSequence = nextEnqueue;
    this.store.entryIndex = indexes.entryIndex;
    this.store.obligationIndex = indexes.obligationIndex;
    this.store.goalIndex = indexes.goalIndex;
    this.store.observationIndex = indexes.observationIndex;
    this.store.planIndex = indexes.planIndex;
    this.store.occurrenceIndex = indexes.occurrenceIndex;
    this.store.settlementIndex = indexes.settlementIndex;
  }

  abandon(): void {
    this.bookWrites.clear();
    this.operationWrites.clear();
    this.outboxWrites.length = 0;
    this.deliveryWrites.clear();
    this.deliveryVersionAtRead.clear();
    this.bookRevisionAtRead.clear();
    this.checkpointWrites.clear();
    this.checkpointCursorAtRead.clear();
    this.active = false;
  }

  private assertActive(): void {
    if (!this.active) {
      throw new Error('repository transaction is no longer active');
    }
  }
}

export function asInMemoryTransaction(transaction: RepositoryTransaction): InMemoryTransaction {
  if (!(transaction instanceof InMemoryTransaction)) {
    throw new Error('checkpoint apply requires the in-memory reference adapter transaction');
  }
  return transaction;
}
