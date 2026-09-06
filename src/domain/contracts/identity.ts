/**
 * Stable identity types.
 *
 * IDs are caller-supplied stable strings (UUID-shaped in the product UI, but
 * the domain only requires a printable, bounded, whitespace-free string).
 * Stable IDs are what make retries, merges, and sync deduplication possible.
 * An ID identifies; it never grants authorization.
 */

declare const bookIdBrand: unique symbol;
declare const cycleIdBrand: unique symbol;
declare const cycleVersionIdBrand: unique symbol;
declare const entryIdBrand: unique symbol;
declare const operationIdBrand: unique symbol;
declare const outboxIdBrand: unique symbol;
declare const obligationIdBrand: unique symbol;
declare const goalIdBrand: unique symbol;
declare const allocationRecordIdBrand: unique symbol;
declare const observationIdBrand: unique symbol;
declare const planIdBrand: unique symbol;
declare const occurrenceIdBrand: unique symbol;
declare const settlementIdBrand: unique symbol;

export type BookId = string & { readonly [bookIdBrand]: true };
export type CycleId = string & { readonly [cycleIdBrand]: true };
/**
 * A version of one logical cycle. Rebase, settlement, and reopen mint new
 * version identities in a `cycver:` namespace so they can never collide with
 * `composeCycleId`'s `cyc:` identities.
 */
export type CycleVersionId = string & { readonly [cycleVersionIdBrand]: true };
export type EntryId = string & { readonly [entryIdBrand]: true };
export type OperationId = string & { readonly [operationIdBrand]: true };
export type OutboxId = string & { readonly [outboxIdBrand]: true };
export type ObligationId = string & { readonly [obligationIdBrand]: true };
export type GoalId = string & { readonly [goalIdBrand]: true };
export type AllocationRecordId = string & { readonly [allocationRecordIdBrand]: true };
/** A Reality Check observation boundary owned by one cycle. */
export type ObservationId = string & { readonly [observationIdBrand]: true };
/** A recurring plan definition (revisions are separate records). */
export type PlanId = string & { readonly [planIdBrand]: true };
/** A stable managed occurrence of a recurring plan. */
export type OccurrenceId = string & { readonly [occurrenceIdBrand]: true };
/** An immutable cycle-settlement snapshot version. */
export type SettlementId = string & { readonly [settlementIdBrand]: true };

export type EntityIdFailure = { readonly reason: 'invalidId'; readonly provided: unknown; readonly detail: string };

export type EntityIdResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: EntityIdFailure };

/** Printable ASCII without whitespace, 1..100 characters, no leading/trailing space. */
const ENTITY_ID_PATTERN = /^[\x21-\x7e]{1,100}$/;

function makeBrandedId<T extends string>(value: unknown): EntityIdResult<T> {
  if (typeof value !== 'string') {
    return { ok: false, failure: { reason: 'invalidId', provided: value, detail: 'id must be a string' } };
  }
  if (!ENTITY_ID_PATTERN.test(value)) {
    return {
      ok: false,
      failure: { reason: 'invalidId', provided: value, detail: 'id must be 1-100 printable ASCII characters without whitespace' },
    };
  }
  return { ok: true, value: value as T };
}

export function makeBookId(value: unknown): EntityIdResult<BookId> {
  return makeBrandedId<BookId>(value);
}

export function makeCycleId(value: unknown): EntityIdResult<CycleId> {
  return makeBrandedId<CycleId>(value);
}

export function makeEntryId(value: unknown): EntityIdResult<EntryId> {
  return makeBrandedId<EntryId>(value);
}

export function makeOperationId(value: unknown): EntityIdResult<OperationId> {
  return makeBrandedId<OperationId>(value);
}

export function makeOutboxId(value: unknown): EntityIdResult<OutboxId> {
  return makeBrandedId<OutboxId>(value);
}

export function makeObligationId(value: unknown): EntityIdResult<ObligationId> {
  return makeBrandedId<ObligationId>(value);
}

export function makeGoalId(value: unknown): EntityIdResult<GoalId> {
  return makeBrandedId<GoalId>(value);
}

export function makeObservationId(value: unknown): EntityIdResult<ObservationId> {
  return makeBrandedId<ObservationId>(value);
}

export function makePlanId(value: unknown): EntityIdResult<PlanId> {
  return makeBrandedId<PlanId>(value);
}

export function makeOccurrenceId(value: unknown): EntityIdResult<OccurrenceId> {
  return makeBrandedId<OccurrenceId>(value);
}

export function makeSettlementId(value: unknown): EntityIdResult<SettlementId> {
  return makeBrandedId<SettlementId>(value);
}

export function makeCycleVersionId(value: unknown): EntityIdResult<CycleVersionId> {
  return makeBrandedId<CycleVersionId>(value);
}

export function makeAllocationRecordId(value: unknown): EntityIdResult<AllocationRecordId> {
  return makeBrandedId<AllocationRecordId>(value);
}

/**
 * Cycle identity is derived, not generated: `cyc:<bookId>:<startDate>`. The
 * same cycle window always maps to the same identity, which keeps occurrences
 * stable across retries and later recovery work.
 */
export function composeCycleId(bookId: BookId, startDate: string): EntityIdResult<CycleId> {
  return makeCycleId(`cyc:${bookId}:${startDate}`);
}
