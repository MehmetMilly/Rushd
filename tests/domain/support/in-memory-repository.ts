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
import type { BookState } from '../../../src/domain/contracts/ledger';
import type { BookId, EntryId, OperationId } from '../../../src/domain/contracts/identity';
import type {
  EntryLocation,
  FinanceReadModel,
  RepositoryTransaction,
  TransactionalRepository,
} from '../../../src/domain/contracts/repository';

export class ConcurrencyConflictError extends Error {}

export type WriteMethodName = 'putBookState' | 'putOperation' | 'putOutboxEntry';

interface CommittedStore {
  books: Map<string, BookState>;
  operations: Map<string, OperationRecord>;
  outbox: OutboxEnvelope[];
  entryIndex: Map<string, EntryLocation>;
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
  private readonly store: CommittedStore = { books: new Map(), operations: new Map(), outbox: [], entryIndex: new Map() };
  private injectedFailure: { method: WriteMethodName; remaining: number } | null = null;

  /** Simulates an adapter crash on the next N calls to the given write method. */
  injectWriteFailure(method: WriteMethodName, occurrences = 1): void {
    this.injectedFailure = { method, remaining: occurrences };
  }

  getBookState(bookId: BookId): BookState | null {
    const state = this.store.books.get(bookId);
    return state === undefined ? null : frozenCopy(state);
  }

  locateEntry(entryId: EntryId): EntryLocation | null {
    const location = this.store.entryIndex.get(entryId);
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
  }
}

class InMemoryTransaction implements RepositoryTransaction {
  private readonly bookWrites = new Map<string, BookState>();
  private readonly operationWrites = new Map<string, OperationRecord>();
  private readonly outboxWrites: OutboxEnvelope[] = [];
  private readonly bookRevisionAtRead = new Map<string, number>();
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

  commit(): void {
    this.assertActive();
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
