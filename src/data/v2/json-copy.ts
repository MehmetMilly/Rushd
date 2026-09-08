/**
 * JSON-safe clone helpers for durable records.
 *
 * Domain records are JSON-safe by construction, so a round-trip is an
 * exact copy. Returned read models are deeply frozen so callers cannot
 * alias repository internals.
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

export function frozenCopyOf<T>(value: T): T {
  return deepFreezeValue(cloneJson(value));
}
