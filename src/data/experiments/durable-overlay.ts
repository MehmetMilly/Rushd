/**
 * P04 Task A durable-overlay pattern.
 *
 * P03's repository port exposes synchronous reads and staged writes inside
 * an asynchronous transaction callback:
 *
 *   runTransaction<T>(work: (tx: RepositoryTransaction) => T | Promise<T>): Promise<T>
 *
 * Browser persistence is asynchronous, so a persistent adapter cannot do
 * storage I/O inside the synchronous `tx` methods. The proven shape is:
 *
 * 1. Hydrate: at transaction start, asynchronously load one consistent
 *    snapshot (SQL: SELECT everything needed / open a read view).
 * 2. Stage: the callback body runs against a synchronous in-memory overlay;
 *    reads see staged writes (read-your-own-write), nothing durable mutates.
 * 3. Commit: after the body completes, recheck every read-dependent guard
 *    against FRESH durable state inside one durable transaction
 *    (SQL: BEGIN IMMEDIATE, guard SELECTs, INSERT/UPDATE delta, COMMIT),
 *    then apply the complete delta atomically.
 * 4. Rollback: any body exception, guard failure, or commit failure abandons
 *    the overlay. Recovery never restores a whole-store snapshot over the
 *    durable state, so a concurrent writer's committed delta survives.
 *
 * The SQLite-candidate proof adapter (`sqlite-candidate-repository.ts`)
 * implements this pattern against a real candidate database (fresh
 * SELECTs at commit inside one SQL transaction, atomic tmp-free commit,
 * rollback on any failure). Task B replaces the candidate VFS wiring with
 * the production adapter without changing the port semantics.
 */

export interface GuardConflictErrorOptions {
  readonly message: string;
}

/** Thrown when fresh durable state moved under a staged transaction. */
export class GuardConflictError extends Error {
  constructor(options: GuardConflictErrorOptions) {
    super(options.message);
    this.name = 'GuardConflictError';
  }
}

/**
 * Deep-clone a JSON-safe value. Domain records are JSON-safe by
 * construction, so a JSON roundtrip is an exact copy here.
 */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function deepFreezeValue<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreezeValue((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** Defensively cloned, deeply frozen copy for handing to callers. */
export function frozenCopyOf<T>(value: T): T {
  return deepFreezeValue(cloneJson(value));
}
