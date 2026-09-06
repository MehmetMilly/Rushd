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
 *   revision is not exactly the read revision + 1.
 * - Any exception abandons the overlay: state, journal, and outbox are
 *   exactly as before.
 * - `injectWriteFailure` simulates a crash between tentative writes.
 *
 * This proves protocol behavior in one process. It is NOT evidence of
 * crash-safe browser durability; P04 must prove that on the persistent
 * adapter.
 */

import type {
  OperationRecord,
  OutboxEnvelope,
} from '../../../src/domain/contracts/commands';
import { canonicalJson } from '../../../src/domain/contracts/canonical';
import type { BookState } from '../../../src/domain/contracts/ledger';
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

export type WriteMethodName = 'putBookState' | 'putOperation' | 'putOutboxEntry';

interface CommittedStore {
  books: Map<string, BookState>;
  operations: Map<string, OperationRecord>;
  outbox: OutboxEnvelope[];
  /** Durable local enqueue counter. Monotonic, not gapless: an aborted transaction may leave a gap. */
  enqueueSequence: number;
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
    enqueueSequence: 0,
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

export class InMemoryFinanceRepository implements TransactionalRepository, FinanceReadModel {
  private readonly store: CommittedStore;
  private injectedFailure: { method: WriteMethodName; remaining: number } | null = null;

  constructor(sharedStore?: CommittedStore) {
    this.store = sharedStore ?? createCommittedStore();
  }

  /** Simulates an adapter crash on the next N calls to the given write method. */
  injectWriteFailure(method: WriteMethodName, occurrences = 1): void {
    this.injectedFailure = { method, remaining: occurrences };
  }

  /**
   * Test-adapter-specific handle reacquisition over the same durable state:
   * the uncertain-commit proof commits through one handle, drops the
   * acknowledgement, then retries through this fresh handle. P04's
   * persistent adapter reacquires a real database connection instead; the
   * behavioral contract (exact idempotent replay) is identical.
   */
  reopen(): InMemoryFinanceRepository {
    return new InMemoryFinanceRepository(this.store);
  }

  /**
   * Test-adapter-specific canonical snapshot of everything the adapter has
   * committed (books, journal, outbox, sequence counter). Rollback proofs
   * compare this string before and after a failed attempt: byte-identical
   * means the attempt left no trace.
   */
  snapshotBytes(): string {
    const books = [...this.store.books.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).map(([, state]) => state);
    const operations = [...this.store.operations.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, record]) => record);
    return canonicalJson({ books, operations, outbox: this.store.outbox, enqueueSequence: this.store.enqueueSequence });
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

  async runTransaction<T>(work: (transaction: RepositoryTransaction) => T | Promise<T>): Promise<T> {
    const transaction = new InMemoryTransaction(this.store, (method: WriteMethodName) => this.takeInjectedFailure(method));
    let result: T;
    try {
      result = await work(transaction);
    } catch (error) {
      transaction.abandon();
      throw error;
    }
    transaction.commit();
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

class InMemoryTransaction implements RepositoryTransaction {
  private readonly bookWrites = new Map<string, BookState>();
  private readonly operationWrites = new Map<string, OperationRecord>();
  private readonly outboxWrites: OutboxEnvelope[] = [];
  private readonly bookRevisionAtRead = new Map<string, number>();
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
    const committedRevision = this.store.books.get(next.book.id)?.revision ?? 0;
    if (committedRevision !== readRevision) {
      throw new ConcurrencyConflictError(
        `book ${next.book.id} changed during the transaction: read revision ${readRevision}, committed ${committedRevision}`,
      );
    }
    if (next.revision !== readRevision + 1) {
      throw new ConcurrencyConflictError(
        `book ${next.book.id} revision must advance by exactly one: read ${readRevision}, wrote ${next.revision}`,
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
    this.outboxWrites.push(cloneValue(envelope));
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

  commit(): void {
    this.assertActive();
    if (this.sequenceBase !== null) {
      if (this.store.enqueueSequence !== this.sequenceBase) {
        throw new ConcurrencyConflictError(
          `enqueue sequence changed during the transaction: read ${this.sequenceBase}, committed ${this.store.enqueueSequence}`,
        );
      }
      this.store.enqueueSequence = this.sequenceBase + this.sequencesAllocated;
    }
    for (const [bookId, state] of this.bookWrites) {
      this.store.books.set(bookId, state);
    }
    for (const [operationId, record] of this.operationWrites) {
      this.store.operations.set(operationId, record);
    }
    this.store.outbox.push(...this.outboxWrites);
    for (const state of this.bookWrites.values()) {
      for (const entry of state.entries) {
        this.store.entryIndex.set(entry.entryId, { bookId: entry.bookId, entryId: entry.entryId, kind: entry.kind });
      }
      for (const obligation of state.obligations) {
        this.store.obligationIndex.set(obligation.obligationId, { bookId: obligation.bookId, obligationId: obligation.obligationId });
      }
      for (const goal of state.goals) {
        this.store.goalIndex.set(goal.goalId, { bookId: goal.bookId, goalId: goal.goalId });
      }
      for (const observation of state.observations) {
        this.store.observationIndex.set(observation.observationId, { bookId: observation.bookId, observationId: observation.observationId });
      }
      for (const plan of state.plans) {
        this.store.planIndex.set(plan.planId, { bookId: plan.bookId, planId: plan.planId });
      }
      for (const occurrence of state.planOccurrences) {
        this.store.occurrenceIndex.set(occurrence.occurrenceId, { bookId: occurrence.bookId, occurrenceId: occurrence.occurrenceId });
      }
      for (const settlement of state.settlements) {
        this.store.settlementIndex.set(settlement.settlementId, { bookId: settlement.bookId, settlementId: settlement.settlementId });
      }
    }
    this.active = false;
  }

  abandon(): void {
    this.bookWrites.clear();
    this.operationWrites.clear();
    this.outboxWrites.length = 0;
    this.bookRevisionAtRead.clear();
    this.active = false;
  }

  private assertActive(): void {
    if (!this.active) {
      throw new Error('repository transaction is no longer active');
    }
  }
}
