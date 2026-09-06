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
 *   Every read-dependent write — book revisions, operation uniqueness,
 *   outbox uniqueness, delivery versions, enqueue counters, and checkpoints
 *   — is rechecked at commit before any committed store is mutated. The
 *   full delta then applies atomically (clone-and-swap). Staging-time
 *   checks alone are not sufficient.
 * - Rollback: any exception inside `runTransaction` or at commit leaves
 *   committed state, the operation journal, the outbox, delivery metadata,
 *   and checkpoints exactly as before. Adapters must not restore a
 *   whole-store snapshot that can erase concurrent successful work.
 *
 * The in-memory adapter under `tests/domain/support/` is the reference
 * implementation for P04's persistent adapter conformance suite. It proves
 * protocol behavior in one process; it is not evidence of crash-safe browser
 * durability.
 */

import type { BookState, LedgerEntry } from './ledger';
import type { OperationRecord, OutboxDeliveryState, OutboxEnvelope } from './commands';
import type { DeviceId, RepositoryScopeId } from '../sync/scope';
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
} from './identity';

export interface EntryLocation {
  readonly bookId: BookId;
  readonly entryId: EntryId;
  readonly kind: LedgerEntry['kind'];
}

export interface ObligationLocation {
  readonly bookId: BookId;
  readonly obligationId: ObligationId;
}

export interface GoalLocation {
  readonly bookId: BookId;
  readonly goalId: GoalId;
}

export interface ObservationLocation {
  readonly bookId: BookId;
  readonly observationId: ObservationId;
}

export interface PlanLocation {
  readonly bookId: BookId;
  readonly planId: PlanId;
}

export interface OccurrenceLocation {
  readonly bookId: BookId;
  readonly occurrenceId: OccurrenceId;
}

export interface SettlementLocation {
  readonly bookId: BookId;
  readonly settlementId: SettlementId;
}

/**
 * A consistent, defensively copied read view for previews and derived
 * queries. Returned objects must not alias repository internals.
 */
export interface FinanceReadModel {
  getBookState(bookId: BookId): BookState | null;
  locateEntry(entryId: EntryId): EntryLocation | null;
  locateObligation(obligationId: ObligationId): ObligationLocation | null;
  locateGoal(goalId: GoalId): GoalLocation | null;
  locateObservation(observationId: ObservationId): ObservationLocation | null;
  locatePlan(planId: PlanId): PlanLocation | null;
  locateOccurrence(occurrenceId: OccurrenceId): OccurrenceLocation | null;
  locateSettlement(settlementId: SettlementId): SettlementLocation | null;
}

export interface RepositoryTransaction extends FinanceReadModel {
  getOperation(operationId: OperationId): OperationRecord | null;
  putBookState(next: BookState): void;
  putOperation(record: OperationRecord): void;
  putOutboxEntry(envelope: OutboxEnvelope): void;
  /**
   * Reads persisted delivery metadata inside the transaction, recording
   * its version for the commit guard. Returns null when no delivery
   * record exists yet for the operation.
   */
  getDeliveryState(operationId: OperationId): OutboxDeliveryState | null;
  /**
   * Stages a delivery-metadata write. The write commits only when the
   * committed version still equals the version read in this transaction
   * (absent reads require continued absence) and the staged record
   * advances exactly one version — first-committer-wins, so concurrent
   * delivery workers serialize or fail explicitly instead of losing
   * updates. Like every write, a delivery write without a prior read in
   * the same transaction fails.
   */
  putDeliveryState(next: OutboxDeliveryState): void;
  /**
   * Allocates the next monotonic durable enqueue sequence for this
   * identity-scoped repository. The executor calls it once per committed
   * command, inside the committing transaction, and stamps the same value
   * on the receipt, the operation journal entry, and the outbox intent.
   *
   * Durable order across operations comes from this sequence (plus per-book
   * revisions), never from wall clocks, capture timestamps, or string ID
   * order. Allocation is tentative until commit: an aborted transaction
   * leaves the counter — and the whole attempted transaction — exactly as
   * before. The commit finalizes the allocation atomically and fails when
   * another transaction moved the counter meanwhile (first-committer-wins
   * extends to the sequence counter). Two operations committed under a
   * fixed clock still receive a strict durable order.
   */
  nextEnqueueSequence(): number;
}

/**
 * Idempotency scope: the operation journal is keyed by operation ID inside
 * one identity-scoped repository (one local principal's namespace),
 * independent of book. The same operation ID with the same canonical
 * payload replays the original receipt; with different content it is an
 * explicit conflict. The same raw operation ID in a different scope is an
 * unrelated intent: scopes never share a journal, and the server keys
 * cross-device idempotency on (accountId, operationId), stamped from the
 * authenticated session rather than any client payload.
 *
 * The outbox intent references the journal by operation ID instead of
 * duplicating the canonical payload; both records are written in the same
 * transaction and one must never exist without the other.
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

/**
 * A repository handle bound to exactly one local principal's namespace.
 * The binding is immutable for the handle's lifetime: `reopen()` preserves
 * it, and a handle never serves another scope.
 *
 * `previewCommand`/`executeCommand` verify the caller's context origin
 * against this binding before any read, replay, or mutation. A mismatched
 * origin fails with an explicit `scopeMismatch` failure: it can neither
 * mutate the bound scope's books nor replay another scope's receipts.
 * Adapters that accept a mismatched caller-controlled scope do not satisfy
 * this port, and the conformance suite proves it with two bound scopes.
 */
export interface ScopedRepository extends TransactionalRepository {
  readonly boundScope: RepositoryScopeId;
  readonly boundDevice: DeviceId;
}
