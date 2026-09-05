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
declare const entryIdBrand: unique symbol;
declare const operationIdBrand: unique symbol;
declare const outboxIdBrand: unique symbol;
declare const obligationIdBrand: unique symbol;
declare const goalIdBrand: unique symbol;
declare const allocationRecordIdBrand: unique symbol;

export type BookId = string & { readonly [bookIdBrand]: true };
export type CycleId = string & { readonly [cycleIdBrand]: true };
export type EntryId = string & { readonly [entryIdBrand]: true };
export type OperationId = string & { readonly [operationIdBrand]: true };
export type OutboxId = string & { readonly [outboxIdBrand]: true };
export type ObligationId = string & { readonly [obligationIdBrand]: true };
export type GoalId = string & { readonly [goalIdBrand]: true };
export type AllocationRecordId = string & { readonly [allocationRecordIdBrand]: true };

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
