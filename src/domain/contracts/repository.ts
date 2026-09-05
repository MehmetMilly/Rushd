/**
 * The narrow repository transaction port and read model.
 *
 * The application checks the operation identity, validates state and
 * revisions, and commits state, receipt, and outbox inside one transaction
 * that the adapter supplies. Adapters must provide:
 *
 * - Isolation: uncommitted writes are visible only inside their transaction.
 * - First-committer-wins: a write whose underlying committed state changed
 *   since the transaction first read it must fail, so two concurrent commands
 *   against one base revision cannot both commit conflicting results.
 * - Rollback: any exception inside `runTransaction` leaves committed state,
 *   the operation journal, and the outbox exactly as before.
 *
 * The in-memory adapter under `tests/domain/support/` is the reference
 * implementation for P04's persistent adapter conformance suite. It proves
 * protocol behavior in one process; it is not evidence of crash-safe browser
 * durability.
 */

import type { BookState, LedgerEntry } from './ledger';
import type { OperationRecord, OutboxEnvelope } from './commands';
import type { BookId, EntryId, OperationId } from './identity';

export interface EntryLocation {
  readonly bookId: BookId;
  readonly entryId: EntryId;
  readonly kind: LedgerEntry['kind'];
}

/**
 * A consistent, defensively copied read view for previews and derived
 * queries. Returned objects must not alias repository internals.
 */
export interface FinanceReadModel {
  getBookState(bookId: BookId): BookState | null;
  locateEntry(entryId: EntryId): EntryLocation | null;
}

export interface RepositoryTransaction extends FinanceReadModel {
  getOperation(operationId: OperationId): OperationRecord | null;
  putBookState(next: BookState): void;
  putOperation(record: OperationRecord): void;
  putOutboxEntry(envelope: OutboxEnvelope): void;
}

/**
 * Idempotency scope: the operation journal is keyed by operation ID across
 * the whole repository, independent of book. The same operation ID with the
 * same canonical payload replays the original receipt; with different content
 * it is an explicit conflict.
 *
 * Transaction methods read synchronously so handler code stays pure; the work
 * body may await (P04 adapters will await real storage I/O), and
 * `runTransaction` commits only after the body completes. The Task A reference
 * adapter is in-memory; Task D's ADR and P04's persistent adapter refine the
 * storage reality but keep these semantics.
 */
export interface TransactionalRepository {
  runTransaction<T>(work: (transaction: RepositoryTransaction) => T | Promise<T>): Promise<T>;
}
