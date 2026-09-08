/**
 * Synchronous overlay used inside `runTransaction`.
 *
 * Browser I/O is asynchronous, so the callback stages against this overlay
 * and the worker rechecks every guard against fresh durable state inside
 * one SQLite transaction. Failure abandons the overlay; recovery never
 * restores a whole-store snapshot over a concurrent winner.
 */

import type { OperationRecord, OutboxDeliveryState, OutboxEnvelope } from '../../domain/contracts/commands';
import type { BookState } from '../../domain/contracts/ledger';
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
  GoalLocation,
  ObligationLocation,
  ObservationLocation,
  OccurrenceLocation,
  PlanLocation,
  RepositoryTransaction,
  SettlementLocation,
} from '../../domain/contracts/repository';
import { GuardConflictError } from './errors';
import { cloneJson, frozenCopyOf } from './json-copy';

export type DurableWriteMethod = 'putBookState' | 'putOperation' | 'putOutboxEntry' | 'putDeliveryState';

export interface CheckpointStreamState {
  cursor: SyncCursor | null;
  batchDigest: string | null;
  applied: Map<string, PulledOperation>;
}

export interface HydratedStore {
  books: Map<string, BookState>;
  operations: Map<string, OperationRecord>;
  outbox: OutboxEnvelope[];
  delivery: Map<string, OutboxDeliveryState>;
  enqueueSequence: number;
  checkpoints: Map<string, CheckpointStreamState>;
}

export interface StagedDelta {
  readonly bookWrites: ReadonlyMap<string, BookState>;
  readonly operationWrites: ReadonlyMap<string, OperationRecord>;
  readonly outboxWrites: readonly OutboxEnvelope[];
  readonly deliveryWrites: ReadonlyMap<string, OutboxDeliveryState>;
  readonly checkpointWrites: ReadonlyMap<string, CheckpointStreamState>;
  readonly bookRevisionsRead: ReadonlyMap<string, number>;
  readonly operationIds: readonly string[];
  readonly outboxOperationIds: readonly string[];
  readonly deliveryVersionsRead: ReadonlyMap<string, number | null>;
  readonly checkpointCursorsRead: ReadonlyMap<string, string | null>;
  readonly sequenceBase: number | null;
  readonly sequencesAllocated: number;
}

export function emptyHydratedStore(): HydratedStore {
  return {
    books: new Map(),
    operations: new Map(),
    outbox: [],
    delivery: new Map(),
    enqueueSequence: 0,
    checkpoints: new Map(),
  };
}

export function cloneCheckpointState(state: CheckpointStreamState): CheckpointStreamState {
  return {
    cursor: state.cursor,
    batchDigest: state.batchDigest,
    applied: new Map(state.applied),
  };
}

export class DurableTransaction implements RepositoryTransaction {
  private readonly bookWrites = new Map<string, BookState>();
  private readonly operationWrites = new Map<string, OperationRecord>();
  private readonly outboxWrites: OutboxEnvelope[] = [];
  private readonly deliveryWrites = new Map<string, OutboxDeliveryState>();
  private readonly checkpointWrites = new Map<string, CheckpointStreamState>();
  private readonly deliveryVersionAtRead = new Map<string, number | null>();
  private readonly bookRevisionAtRead = new Map<string, number>();
  private readonly checkpointCursorAtRead = new Map<string, string | null>();
  private sequenceBase: number | null = null;
  private sequencesAllocated = 0;
  private active = true;

  constructor(
    private readonly base: HydratedStore,
    private readonly takeInjectedFailure: (method: DurableWriteMethod) => boolean,
  ) {}

  getBookState(bookId: BookId): BookState | null {
    this.assertActive();
    const local = this.bookWrites.get(bookId as string);
    if (local !== undefined) return frozenCopyOf(local);
    const committed = this.base.books.get(bookId as string);
    if (committed === undefined) {
      this.bookRevisionAtRead.set(bookId as string, 0);
      return null;
    }
    this.bookRevisionAtRead.set(bookId as string, committed.revision);
    return frozenCopyOf(committed);
  }

  locateEntry(entryId: EntryId): EntryLocation | null {
    return this.locateInWritesThenBase('entry', entryId as string);
  }

  locateObligation(obligationId: ObligationId): ObligationLocation | null {
    return this.locateInWritesThenBase('obligation', obligationId as string);
  }

  locateGoal(goalId: GoalId): GoalLocation | null {
    return this.locateInWritesThenBase('goal', goalId as string);
  }

  locateObservation(observationId: ObservationId): ObservationLocation | null {
    return this.locateInWritesThenBase('observation', observationId as string);
  }

  locatePlan(planId: PlanId): PlanLocation | null {
    return this.locateInWritesThenBase('plan', planId as string);
  }

  locateOccurrence(occurrenceId: OccurrenceId): OccurrenceLocation | null {
    return this.locateInWritesThenBase('occurrence', occurrenceId as string);
  }

  locateSettlement(settlementId: SettlementId): SettlementLocation | null {
    return this.locateInWritesThenBase('settlement', settlementId as string);
  }

  getOperation(operationId: OperationId): OperationRecord | null {
    this.assertActive();
    const local = this.operationWrites.get(operationId as string);
    if (local !== undefined) return frozenCopyOf(local);
    const committed = this.base.operations.get(operationId as string);
    return committed === undefined ? null : frozenCopyOf(committed);
  }

  putBookState(next: BookState): void {
    this.assertActive();
    if (this.takeInjectedFailure('putBookState')) throw new Error('injected adapter failure at putBookState');
    const key = next.book.id as string;
    const readRevision = this.bookRevisionAtRead.get(key);
    if (readRevision === undefined) {
      throw new GuardConflictError({ message: `book ${key} must be read before it is written` });
    }
    const visibleRevision = this.bookWrites.get(key)?.revision ?? this.base.books.get(key)?.revision ?? 0;
    if (next.revision !== visibleRevision + 1) {
      throw new GuardConflictError({ message: `book ${key} revision must advance by exactly one` });
    }
    this.bookWrites.set(key, cloneJson(next));
  }

  putOperation(record: OperationRecord): void {
    this.assertActive();
    if (this.takeInjectedFailure('putOperation')) throw new Error('injected adapter failure at putOperation');
    const key = record.operationId as string;
    if (this.operationWrites.has(key) || this.base.operations.has(key)) {
      throw new GuardConflictError({ message: `operation ${key} already exists` });
    }
    this.operationWrites.set(key, cloneJson(record));
  }

  putOutboxEntry(envelope: OutboxEnvelope): void {
    this.assertActive();
    if (this.takeInjectedFailure('putOutboxEntry')) throw new Error('injected adapter failure at putOutboxEntry');
    const operationId = envelope.operationId as string;
    if (
      this.outboxWrites.some((existing) => (existing.operationId as string) === operationId) ||
      this.base.outbox.some((existing) => (existing.operationId as string) === operationId)
    ) {
      throw new GuardConflictError({ message: `outbox for operation ${operationId} already exists` });
    }
    this.outboxWrites.push(cloneJson(envelope));
  }

  getDeliveryState(operationId: OperationId): OutboxDeliveryState | null {
    this.assertActive();
    const key = operationId as string;
    const staged = this.deliveryWrites.get(key);
    if (staged !== undefined) return frozenCopyOf(staged);
    const committed = this.base.delivery.get(key);
    if (!this.deliveryVersionAtRead.has(key)) this.deliveryVersionAtRead.set(key, committed?.version ?? null);
    return committed === undefined ? null : frozenCopyOf(committed);
  }

  putDeliveryState(next: OutboxDeliveryState): void {
    this.assertActive();
    if (this.takeInjectedFailure('putDeliveryState')) throw new Error('injected adapter failure at putDeliveryState');
    const key = next.operationId as string;
    if (!this.deliveryVersionAtRead.has(key)) {
      throw new GuardConflictError({ message: `delivery for ${key} must be read before it is written` });
    }
    const readVersion = this.deliveryVersionAtRead.get(key) ?? 0;
    if (next.version !== readVersion + 1) {
      throw new GuardConflictError({ message: `delivery for ${key} must advance exactly one version` });
    }
    this.deliveryWrites.set(key, cloneJson(next));
  }

  nextEnqueueSequence(): number {
    this.assertActive();
    if (this.sequenceBase === null) this.sequenceBase = this.base.enqueueSequence;
    this.sequencesAllocated += 1;
    return this.sequenceBase + this.sequencesAllocated;
  }

  getStreamCheckpoint(streamId: ReplicationStreamId): CheckpointStreamState {
    this.assertActive();
    const key = streamId as string;
    const staged = this.checkpointWrites.get(key);
    if (staged !== undefined) return cloneCheckpointState(staged);
    const committed = this.base.checkpoints.get(key);
    if (!this.checkpointCursorAtRead.has(key)) {
      this.checkpointCursorAtRead.set(key, (committed?.cursor as string | null | undefined) ?? null);
    }
    if (committed === undefined) {
      return { cursor: null, batchDigest: null, applied: new Map() };
    }
    return cloneCheckpointState(committed);
  }

  putStreamCheckpoint(streamId: ReplicationStreamId, next: CheckpointStreamState): void {
    this.assertActive();
    const key = streamId as string;
    if (!this.checkpointCursorAtRead.has(key)) {
      throw new GuardConflictError({ message: `checkpoint for ${key} must be read before it is written` });
    }
    this.checkpointWrites.set(key, cloneCheckpointState(next));
  }

  stagedDelta(): StagedDelta {
    this.assertActive();
    return {
      bookWrites: this.bookWrites,
      operationWrites: this.operationWrites,
      outboxWrites: this.outboxWrites,
      deliveryWrites: this.deliveryWrites,
      checkpointWrites: this.checkpointWrites,
      bookRevisionsRead: this.bookRevisionAtRead,
      operationIds: [...this.operationWrites.keys()],
      outboxOperationIds: this.outboxWrites.map((envelope) => envelope.operationId as string),
      deliveryVersionsRead: this.deliveryVersionAtRead,
      checkpointCursorsRead: this.checkpointCursorAtRead,
      sequenceBase: this.sequenceBase,
      sequencesAllocated: this.sequencesAllocated,
    };
  }

  abandon(): void {
    this.bookWrites.clear();
    this.operationWrites.clear();
    this.outboxWrites.length = 0;
    this.deliveryWrites.clear();
    this.checkpointWrites.clear();
    this.deliveryVersionAtRead.clear();
    this.bookRevisionAtRead.clear();
    this.checkpointCursorAtRead.clear();
    this.active = false;
  }

  deactivate(): void {
    this.active = false;
  }

  private locateInWritesThenBase<TLocation>(
    kind: 'entry' | 'obligation' | 'goal' | 'observation' | 'plan' | 'occurrence' | 'settlement',
    id: string,
  ): TLocation | null {
    this.assertActive();
    for (const state of this.bookWrites.values()) {
      const found = locateInBook<TLocation>(kind, id, state);
      if (found !== null) return found;
    }
    for (const state of this.base.books.values()) {
      if (this.bookWrites.has(state.book.id as string)) continue;
      const found = locateInBook<TLocation>(kind, id, state);
      if (found !== null) return found;
    }
    return null;
  }

  private assertActive(): void {
    if (!this.active) throw new Error('repository transaction is no longer active');
  }
}

function locateInBook<TLocation>(
  kind: 'entry' | 'obligation' | 'goal' | 'observation' | 'plan' | 'occurrence' | 'settlement',
  id: string,
  state: BookState,
): TLocation | null {
  if (kind === 'entry') {
    const entry = state.entries.find((candidate) => candidate.entryId === id);
    return entry === undefined ? null : ({ bookId: entry.bookId, entryId: entry.entryId, kind: entry.kind } as unknown as TLocation);
  }
  if (kind === 'obligation') {
    const obligation = state.obligations.find((candidate) => candidate.obligationId === id);
    return obligation === undefined
      ? null
      : ({ bookId: obligation.bookId, obligationId: obligation.obligationId } as unknown as TLocation);
  }
  if (kind === 'goal') {
    const goal = state.goals.find((candidate) => candidate.goalId === id);
    return goal === undefined ? null : ({ bookId: goal.bookId, goalId: goal.goalId } as unknown as TLocation);
  }
  if (kind === 'observation') {
    const observation = state.observations.find((candidate) => candidate.observationId === id);
    return observation === undefined
      ? null
      : ({ bookId: observation.bookId, observationId: observation.observationId } as unknown as TLocation);
  }
  if (kind === 'plan') {
    const plan = state.plans.find((candidate) => candidate.planId === id);
    return plan === undefined ? null : ({ bookId: plan.bookId, planId: plan.planId } as unknown as TLocation);
  }
  if (kind === 'occurrence') {
    const occurrence = state.planOccurrences.find((candidate) => candidate.occurrenceId === id);
    return occurrence === undefined
      ? null
      : ({ bookId: occurrence.bookId, occurrenceId: occurrence.occurrenceId } as unknown as TLocation);
  }
  const settlement = state.settlements.find((candidate) => candidate.settlementId === id);
  return settlement === undefined
    ? null
    : ({ bookId: settlement.bookId, settlementId: settlement.settlementId } as unknown as TLocation);
}
