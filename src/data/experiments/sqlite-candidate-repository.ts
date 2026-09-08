/**
 * P04-A-FIX-01 SQLite-candidate repository.
 *
 * The same P03 port shape as the retired file proof — hydrate a consistent
 * view, stage synchronously in an overlay, recheck every read-dependent
 * guard against fresh durable state, commit the full state/operation/outbox
 * delta inside ONE SQLite transaction — but executed against a real
 * SQLite-compatible candidate (wa-sqlite family build) instead of a JSON
 * file. The sqlite3 handle is injected (sync or async build; both expose an
 * async `exec`), so this module runs inside a browser Worker in Task A and
 * is reusable by Task B's persistent adapter design.
 *
 * Durable layout (one SQLite database per identity scope):
 * books(book_id, revision, payload JSON), journal(operation_id,
 * enqueue_sequence, payload JSON), outbox(operation_id, enqueue_sequence,
 * payload JSON holding the COMPLETE immutable OutboxEnvelope),
 * delivery(operation_id, version, payload JSON), meta(key, value) holding
 * the durable enqueue sequence. Canonical BookState JSON is the source of
 * truth; no second record copy exists.
 */

import {
  initialOutboxDelivery,
  recordDeliveryAttempt,
  type DeliveryAttemptOutcome,
  type OperationRecord,
  type OutboxDeliveryState,
  type OutboxEnvelope,
} from '../../domain/contracts/commands';
import { canonicalJson } from '../../domain/contracts/canonical';
import type { BookState } from '../../domain/contracts/ledger';
import type { DeviceId, RepositoryScopeId } from '../../domain/sync/scope';
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
  SettlementLocation,
} from '../../domain/contracts/repository';
import { GuardConflictError, cloneJson, frozenCopyOf } from './durable-overlay';

/** Minimal async surface used from the injected wa-sqlite handle. */
export interface CandidateSqlite {
  exec(db: number, sql: string, callback?: (row: unknown[], columns: string[]) => void | Promise<void>): Promise<number>;
  close(db: number): Promise<number>;
}

export const CANDIDATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS books(book_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS journal(operation_id TEXT PRIMARY KEY, enqueue_sequence INTEGER NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox(operation_id TEXT PRIMARY KEY, enqueue_sequence INTEGER NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS delivery(operation_id TEXT PRIMARY KEY, version INTEGER NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value INTEGER NOT NULL);
`.trim();

/** SQLite string literal escaping (single quotes doubled). */
export function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

interface HydratedStore {
  books: Map<string, BookState>;
  operations: Map<string, OperationRecord>;
  outbox: OutboxEnvelope[];
  delivery: Map<string, OutboxDeliveryState>;
  enqueueSequence: number;
}

export type CandidateWriteMethod = 'putBookState' | 'putOperation' | 'putOutboxEntry' | 'putDeliveryState';

export interface SqliteCandidateRepositoryOptions {
  readonly sqlite3: CandidateSqlite;
  readonly db: number;
  readonly boundScope: RepositoryScopeId;
  readonly boundDevice: DeviceId;
}

export class SqliteCandidateRepository implements FinanceReadModel {
  readonly boundScope: RepositoryScopeId;
  readonly boundDevice: DeviceId;
  private readonly sqlite3: CandidateSqlite;
  private readonly db: number;
  private injectedFailure: { method: CandidateWriteMethod; remaining: number } | null = null;
  /**
   * Last hydrated read cache for the synchronous port methods. Browser
   * storage is async-only, so sync preview reads serve this cache; every
   * commit rechecks against fresh SELECTs inside one SQLite transaction, and
   * a stale preview fails as `revisionConflict` (refreshed retry), exactly
   * per the P03 protocol. Call `open()`/`refresh()` before previewing.
   */
  private cache: HydratedStore | null = null;

  constructor(options: SqliteCandidateRepositoryOptions) {
    this.sqlite3 = options.sqlite3;
    this.db = options.db;
    this.boundScope = options.boundScope;
    this.boundDevice = options.boundDevice;
  }

  /** Create schema and hydrate the first read cache. */
  async open(): Promise<void> {
    await this.ensureSchema();
    await this.refresh();
  }

  /** Re-hydrate the sync-read cache from durable state. */
  async refresh(): Promise<void> {
    this.cache = await this.hydrate();
  }

  injectWriteFailure(method: CandidateWriteMethod, occurrences = 1): void {
    this.injectedFailure = { method, remaining: occurrences };
  }

  async ensureSchema(): Promise<void> {
    await this.sqlite3.exec(this.db, CANDIDATE_SCHEMA_SQL);
    await this.sqlite3.exec(this.db, `INSERT OR IGNORE INTO meta(key, value) VALUES ('enqueue_sequence', 0)`);
  }

  /** Canonical digest of everything committed (SELECT-based verification). */
  async snapshotDigest(): Promise<string> {
    const store = await this.hydrate();
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

  getBookState(bookId: BookId): BookState | null {
    const state = this.requireCache().books.get(bookId as string);
    return state === undefined ? null : frozenCopyOf(state);
  }

  private requireCache(): HydratedStore {
    if (this.cache === null) throw new Error('SqliteCandidateRepository is not open: call open() before previewing');
    return this.cache;
  }

  private locateCached<TLocation>(
    states: Iterable<BookState>,
    find: (state: BookState) => TLocation | null,
  ): TLocation | null {
    for (const state of states) {
      const found = find(state);
      if (found !== null) return found;
    }
    return null;
  }

  locateEntry(entryId: EntryId): EntryLocation | null {
    return this.locateCached(this.requireCache().books.values(), (state) => {
      const entry = state.entries.find((candidate) => candidate.entryId === entryId);
      return entry === undefined ? null : { bookId: entry.bookId, entryId: entry.entryId, kind: entry.kind };
    });
  }

  locateObligation(obligationId: ObligationId): ObligationLocation | null {
    return this.locateCached(this.requireCache().books.values(), (state) => {
      const obligation = state.obligations.find((candidate) => candidate.obligationId === obligationId);
      return obligation === undefined ? null : { bookId: obligation.bookId, obligationId: obligation.obligationId };
    });
  }

  locateGoal(goalId: GoalId): GoalLocation | null {
    return this.locateCached(this.requireCache().books.values(), (state) => {
      const goal = state.goals.find((candidate) => candidate.goalId === goalId);
      return goal === undefined ? null : { bookId: goal.bookId, goalId: goal.goalId };
    });
  }

  locateObservation(observationId: ObservationId): ObservationLocation | null {
    return this.locateCached(this.requireCache().books.values(), (state) => {
      const observation = state.observations.find((candidate) => candidate.observationId === observationId);
      return observation === undefined ? null : { bookId: observation.bookId, observationId: observation.observationId };
    });
  }

  locatePlan(planId: PlanId): PlanLocation | null {
    return this.locateCached(this.requireCache().books.values(), (state) => {
      const plan = state.plans.find((candidate) => candidate.planId === planId);
      return plan === undefined ? null : { bookId: plan.bookId, planId: plan.planId };
    });
  }

  locateOccurrence(occurrenceId: OccurrenceId): OccurrenceLocation | null {
    return this.locateCached(this.requireCache().books.values(), (state) => {
      const occurrence = state.planOccurrences.find((candidate) => candidate.occurrenceId === occurrenceId);
      return occurrence === undefined ? null : { bookId: occurrence.bookId, occurrenceId: occurrence.occurrenceId };
    });
  }

  locateSettlement(settlementId: SettlementId): SettlementLocation | null {
    return this.locateCached(this.requireCache().books.values(), (state) => {
      const settlement = state.settlements.find((candidate) => candidate.settlementId === settlementId);
      return settlement === undefined ? null : { bookId: settlement.bookId, settlementId: settlement.settlementId };
    });
  }

  /** Committed journal read (async verification helper; not part of the port). */
  async readOperation(operationId: OperationId): Promise<OperationRecord | null> {
    let payload: string | null = null;
    await this.sqlite3.exec(
      this.db,
      `SELECT payload FROM journal WHERE operation_id = ${sqlText(operationId as string)}`,
      (row) => {
        payload = row[0] as string;
      },
    );
    return payload === null ? null : frozenCopyOf(JSON.parse(payload) as OperationRecord);
  }

  /** Committed delivery read (async verification helper; not part of the port). */
  async readDeliveryState(operationId: OperationId): Promise<OutboxDeliveryState | null> {
    let payload: string | null = null;
    await this.sqlite3.exec(
      this.db,
      `SELECT payload FROM delivery WHERE operation_id = ${sqlText(operationId as string)}`,
      (row) => {
        payload = row[0] as string;
      },
    );
    return payload === null ? null : frozenCopyOf(JSON.parse(payload) as OutboxDeliveryState);
  }

  /** Committed outbox read (async verification helper; not part of the port). */
  async listOutboxEntries(): Promise<readonly OutboxEnvelope[]> {
    const rows: OutboxEnvelope[] = [];
    await this.sqlite3.exec(this.db, `SELECT payload FROM outbox ORDER BY enqueue_sequence`, (row) => {
      rows.push(JSON.parse(row[0] as string) as OutboxEnvelope);
    });
    return frozenCopyOf(rows);
  }

  async updateDeliveryState(operationId: OperationId, outcome: DeliveryAttemptOutcome): Promise<OutboxDeliveryState> {
    const intent = (await this.hydrate()).outbox.find(
      (envelope) => (envelope.operationId as string) === (operationId as string),
    );
    if (intent === undefined) throw new Error(`unknown operation for delivery update: ${operationId as string}`);
    const frozenIntent = frozenCopyOf(intent);
    return this.runTransaction((transaction) => {
      const staged = transaction as SqliteCandidateTransaction;
      const current = staged.getDeliveryState(operationId);
      const next = recordDeliveryAttempt(cloneJson(current ?? initialOutboxDelivery(frozenIntent)), outcome);
      staged.putDeliveryState(next);
      return frozenCopyOf(next);
    });
  }

  async runTransaction<T>(work: (transaction: RepositoryTransaction) => T | Promise<T>): Promise<T> {
    const base = await this.hydrate();
    const transaction = new SqliteCandidateTransaction(base, (method) => this.takeInjectedFailure(method));
    let result: T;
    try {
      result = await work(transaction);
    } catch (error) {
      transaction.abandon();
      throw error;
    }
    await this.commit(transaction);
    return result;
  }

  private async hydrate(): Promise<HydratedStore> {
    const store: HydratedStore = { books: new Map(), operations: new Map(), outbox: [], delivery: new Map(), enqueueSequence: 0 };
    await this.sqlite3.exec(this.db, `SELECT payload FROM books`, (row) => {
      const state = JSON.parse(row[0] as string) as BookState;
      store.books.set(state.book.id as string, state);
    });
    await this.sqlite3.exec(this.db, `SELECT payload FROM journal`, (row) => {
      const record = JSON.parse(row[0] as string) as OperationRecord;
      store.operations.set(record.operationId as string, record);
    });
    await this.sqlite3.exec(this.db, `SELECT payload FROM outbox`, (row) => {
      store.outbox.push(JSON.parse(row[0] as string) as OutboxEnvelope);
    });
    await this.sqlite3.exec(this.db, `SELECT payload FROM delivery`, (row) => {
      const state = JSON.parse(row[0] as string) as OutboxDeliveryState;
      store.delivery.set(state.operationId as string, state);
    });
    await this.sqlite3.exec(this.db, `SELECT value FROM meta WHERE key = 'enqueue_sequence'`, (row) => {
      store.enqueueSequence = row[0] as number;
    });
    return store;
  }

  /**
   * The whole commit — freshness re-read, guard rechecks, and the complete
   * delta — runs inside ONE SQLite transaction. Any failure rolls the
   * SQLite transaction back; the overlay is abandoned, never restored over
   * durable state, so a concurrent winner is never erased.
   */
  private async commit(transaction: SqliteCandidateTransaction): Promise<void> {
    const delta = transaction.stagedDelta();
    await this.sqlite3.exec(this.db, 'BEGIN IMMEDIATE');
    try {
      for (const [bookId, readRevision] of delta.bookRevisionsRead) {
        let freshRevision = 0;
        let found = false;
        await this.sqlite3.exec(this.db, `SELECT revision FROM books WHERE book_id = ${sqlText(bookId)}`, (row) => {
          freshRevision = row[0] as number;
          found = true;
        });
        if (!found) freshRevision = 0;
        if (freshRevision !== readRevision) {
          throw new GuardConflictError({ message: `book ${bookId} changed during the transaction` });
        }
      }
      for (const operationId of delta.operationIds) {
        let exists = false;
        await this.sqlite3.exec(this.db, `SELECT 1 FROM journal WHERE operation_id = ${sqlText(operationId)}`, () => {
          exists = true;
        });
        if (exists) throw new GuardConflictError({ message: `operation ${operationId} already exists` });
      }
      for (const operationId of delta.outboxOperationIds) {
        let exists = false;
        await this.sqlite3.exec(this.db, `SELECT 1 FROM outbox WHERE operation_id = ${sqlText(operationId)}`, () => {
          exists = true;
        });
        if (exists) throw new GuardConflictError({ message: `outbox for operation ${operationId} already exists` });
      }
      for (const [operationId, readVersion] of delta.deliveryVersionsRead) {
        let freshVersion: number | null = null;
        await this.sqlite3.exec(this.db, `SELECT version FROM delivery WHERE operation_id = ${sqlText(operationId)}`, (row) => {
          freshVersion = row[0] as number;
        });
        if (freshVersion !== readVersion) {
          throw new GuardConflictError({ message: `delivery for ${operationId} changed during the transaction` });
        }
      }
      if (delta.sequenceBase !== null) {
        let freshSequence = -1;
        await this.sqlite3.exec(this.db, `SELECT value FROM meta WHERE key = 'enqueue_sequence'`, (row) => {
          freshSequence = row[0] as number;
        });
        if (freshSequence !== delta.sequenceBase) {
          throw new GuardConflictError({ message: 'enqueue sequence changed during the transaction' });
        }
      }
      for (const [bookId, state] of delta.bookWrites) {
        await this.sqlite3.exec(
          this.db,
          `INSERT INTO books(book_id, revision, payload) VALUES (${sqlText(bookId)}, ${state.revision}, ${sqlText(JSON.stringify(state))}) ON CONFLICT(book_id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload`,
        );
      }
      for (const [operationId, record] of delta.operationWrites) {
        await this.sqlite3.exec(
          this.db,
          `INSERT INTO journal(operation_id, enqueue_sequence, payload) VALUES (${sqlText(operationId)}, ${record.enqueueSequence as number}, ${sqlText(JSON.stringify(record))})`,
        );
      }
      for (const envelope of delta.outboxWrites) {
        await this.sqlite3.exec(
          this.db,
          `INSERT INTO outbox(operation_id, enqueue_sequence, payload) VALUES (${sqlText(envelope.operationId as string)}, ${envelope.enqueueSequence as number}, ${sqlText(JSON.stringify(envelope))})`,
        );
      }
      for (const [operationId, state] of delta.deliveryWrites) {
        await this.sqlite3.exec(
          this.db,
          `INSERT INTO delivery(operation_id, version, payload) VALUES (${sqlText(operationId)}, ${state.version}, ${sqlText(JSON.stringify(state))}) ON CONFLICT(operation_id) DO UPDATE SET version = excluded.version, payload = excluded.payload`,
        );
      }
      if (delta.sequenceBase !== null) {
        await this.sqlite3.exec(
          this.db,
          `UPDATE meta SET value = ${delta.sequenceBase + delta.sequencesAllocated} WHERE key = 'enqueue_sequence'`,
        );
      }
      await this.sqlite3.exec(this.db, 'COMMIT');
    } catch (error) {
      try {
        await this.sqlite3.exec(this.db, 'ROLLBACK');
      } catch {
        /* the transaction is already gone; the original error stands */
      }
      transaction.abandon();
      throw error;
    }
    transaction.deactivate();
  }

  private takeInjectedFailure(method: CandidateWriteMethod): boolean {
    if (this.injectedFailure === null) return false;
    if (this.injectedFailure.method !== method) return false;
    this.injectedFailure.remaining -= 1;
    if (this.injectedFailure.remaining <= 0) this.injectedFailure = null;
    return true;
  }
}

export interface StagedDelta {
  readonly bookWrites: ReadonlyMap<string, BookState>;
  readonly operationWrites: ReadonlyMap<string, OperationRecord>;
  readonly outboxWrites: readonly OutboxEnvelope[];
  readonly deliveryWrites: ReadonlyMap<string, OutboxDeliveryState>;
  readonly bookRevisionsRead: ReadonlyMap<string, number>;
  readonly operationIds: readonly string[];
  readonly outboxOperationIds: readonly string[];
  readonly deliveryVersionsRead: ReadonlyMap<string, number | null>;
  readonly sequenceBase: number | null;
  readonly sequencesAllocated: number;
}

class SqliteCandidateTransaction implements RepositoryTransaction {
  private readonly bookWrites = new Map<string, BookState>();
  private readonly operationWrites = new Map<string, OperationRecord>();
  private readonly outboxWrites: OutboxEnvelope[] = [];
  private readonly deliveryWrites = new Map<string, OutboxDeliveryState>();
  private readonly deliveryVersionAtRead = new Map<string, number | null>();
  private readonly bookRevisionAtRead = new Map<string, number>();
  private sequenceBase: number | null = null;
  private sequencesAllocated = 0;
  private active = true;

  constructor(
    private readonly base: HydratedStore,
    private readonly takeInjectedFailure: (method: CandidateWriteMethod) => boolean,
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

  private locateInBooks<TLocation>(kind: 'entry' | 'obligation' | 'goal' | 'observation' | 'plan' | 'occurrence' | 'settlement', id: string): TLocation | null {
    this.assertActive();
    const states = [...this.bookWrites.values(), ...this.base.books.values()];
    for (const state of states) {
      if (kind === 'entry') {
        const entry = state.entries.find((candidate) => candidate.entryId === id);
        if (entry !== undefined) return { bookId: entry.bookId, entryId: entry.entryId, kind: entry.kind } as unknown as TLocation;
      } else if (kind === 'obligation') {
        const obligation = state.obligations.find((candidate) => candidate.obligationId === id);
        if (obligation !== undefined) return { bookId: obligation.bookId, obligationId: obligation.obligationId } as unknown as TLocation;
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

  locateEntry(entryId: EntryId): EntryLocation | null {
    return this.locateInBooks<EntryLocation>('entry', entryId as string);
  }

  locateObligation(obligationId: ObligationId): ObligationLocation | null {
    return this.locateInBooks<ObligationLocation>('obligation', obligationId as string);
  }

  locateGoal(goalId: GoalId): GoalLocation | null {
    return this.locateInBooks<GoalLocation>('goal', goalId as string);
  }

  locateObservation(observationId: ObservationId): ObservationLocation | null {
    return this.locateInBooks<ObservationLocation>('observation', observationId as string);
  }

  locatePlan(planId: PlanId): PlanLocation | null {
    return this.locateInBooks<PlanLocation>('plan', planId as string);
  }

  locateOccurrence(occurrenceId: OccurrenceId): OccurrenceLocation | null {
    return this.locateInBooks<OccurrenceLocation>('occurrence', occurrenceId as string);
  }

  locateSettlement(settlementId: SettlementId): SettlementLocation | null {
    return this.locateInBooks<SettlementLocation>('settlement', settlementId as string);
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
    if (readRevision === undefined) throw new GuardConflictError({ message: `book ${key} must be read before it is written` });
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
    // Delivery intent existence is checked at commit against fresh state;
    // staging reads the hydrated base here, exactly like the reference.
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

  stagedDelta(): StagedDelta {
    this.assertActive();
    return {
      bookWrites: this.bookWrites,
      operationWrites: this.operationWrites,
      outboxWrites: this.outboxWrites,
      deliveryWrites: this.deliveryWrites,
      bookRevisionsRead: this.bookRevisionAtRead,
      operationIds: [...this.operationWrites.keys()],
      outboxOperationIds: this.outboxWrites.map((envelope) => envelope.operationId as string),
      deliveryVersionsRead: this.deliveryVersionAtRead,
      sequenceBase: this.sequenceBase,
      sequencesAllocated: this.sequencesAllocated,
    };
  }

  abandon(): void {
    this.bookWrites.clear();
    this.operationWrites.clear();
    this.outboxWrites.length = 0;
    this.deliveryWrites.clear();
    this.deliveryVersionAtRead.clear();
    this.bookRevisionAtRead.clear();
    this.active = false;
  }

  deactivate(): void {
    this.active = false;
  }

  private assertActive(): void {
    if (!this.active) throw new Error('repository transaction is no longer active');
  }
}
