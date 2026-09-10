/**
 * Shared bounded printable identity for migration, import, and reset.
 *
 * Distinct inputs are never normalized onto one replay key. Invalid values
 * fail closed before any control-store lookup, namespace construction, or
 * staging open.
 */

export const LIFECYCLE_ID_PATTERN = /^[\x21-\x7e]{1,100}$/;

export type LifecycleIdFailure = {
  readonly ok: false;
  readonly reason: 'invalid-id';
  readonly detail: string;
};

export type LifecycleIdResult = { readonly ok: true; readonly value: string } | LifecycleIdFailure;

export function decodeLifecycleId(value: unknown, label: string): LifecycleIdResult {
  if (typeof value !== 'string') {
    return { ok: false, reason: 'invalid-id', detail: `${label} must be a string` };
  }
  if (value.length === 0) {
    return { ok: false, reason: 'invalid-id', detail: `${label} must not be empty` };
  }
  if (value.length > 100) {
    return { ok: false, reason: 'invalid-id', detail: `${label} exceeds 100 bytes` };
  }
  if (!LIFECYCLE_ID_PATTERN.test(value)) {
    return {
      ok: false,
      reason: 'invalid-id',
      detail: `${label} must be 1-100 printable ASCII characters without whitespace`,
    };
  }
  return { ok: true, value };
}
