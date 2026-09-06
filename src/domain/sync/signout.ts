/**
 * Sign-out and local account-cache safety decisions (P03 Task D).
 *
 * This module models decisions, not UI or network calls. The rules it
 * freezes:
 *
 * - Sign-out distinguishes session termination (always allowed) from local
 *   account-cache deletion (gated). Ending a session never deletes cached
 *   data by itself.
 * - The safe default under offline, failed, or unknown sync state is
 *   retain-and-retry: the cache stays, and the caller gets an explicit retry
 *   path instead of a silent loss.
 * - Cache erasure is blocked while unacknowledged outbox items or unresolved
 *   conflicts exist — unless the caller presents the destructive override:
 *   both a verified export reference AND an explicit destructive
 *   confirmation (master plan 778-784, P08-A2). The override is the
 *   founder-approved emergency path; it never skips proof validation.
 * - The request type carries both proofs as structured values with a
 *   literal acknowledgement phrase, so an adapter or UI cannot bypass the
 *   gate with a boolean named `force`: `authorizeCacheErasure` validates
 *   unknown input at runtime and rejects anything that does not carry both
 *   proofs, as well as unknown counts or unknown sync states.
 */

export const SIGNOUT_SCHEMA_VERSION = 1 as const;
export type SignoutSchemaVersion = typeof SIGNOUT_SCHEMA_VERSION;

/** Sync health from the cache's point of view. Unknown means unknown: it blocks, never assumes. */
export type SignOutSyncState = 'acknowledged' | 'pendingOutbox' | 'unresolvedConflicts' | 'offlineUnknown' | 'failedUnknown';

export interface SignOutAssessment {
  readonly syncState: SignOutSyncState;
  readonly pendingOutboxCount: number;
  readonly unresolvedConflictCount: number;
}

export type SignOutCacheDecision =
  | { readonly kind: 'retainAndRetry'; readonly reason: string }
  | { readonly kind: 'eraseBlocked'; readonly reason: string }
  | { readonly kind: 'erased' };

/** Proof that a versioned export was created and verified before destructive action. */
export interface VerifiedExportRef {
  readonly exportId: string;
  readonly verifiedAtInstantMs: number;
  readonly recordCount: number;
  readonly schemaVersion: number;
}

/**
 * Explicit destructive confirmation. The literal phrase makes accidental or
 * programmatic bypass a type error: no boolean can satisfy this field.
 */
export interface DestructiveConfirmation {
  readonly acknowledgementPhrase: 'ERASE-LOCAL-ACCOUNT-CACHE';
  readonly confirmed: true;
}

export interface CacheErasureRequest {
  readonly verifiedExport: VerifiedExportRef;
  readonly destructiveConfirmation: DestructiveConfirmation;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export type CacheErasureAuthorization = { readonly ok: true; readonly decision: SignOutCacheDecision } | { readonly ok: false; readonly decision: SignOutCacheDecision; readonly issues: readonly string[] };

/**
 * Default sign-out cache policy: retain-and-retry unless the cache is proven
 * clean AND acknowledged. Blocked erasure names its reason so the caller can
 * surface a retry path instead of stalling invisibly.
 */
export function evaluateSignOutCache(assessment: SignOutAssessment): SignOutCacheDecision {
  if (!Number.isSafeInteger(assessment.pendingOutboxCount) || assessment.pendingOutboxCount < 0) {
    return { kind: 'retainAndRetry', reason: 'pending outbox count is unknown; retain the cache and retry' };
  }
  if (!Number.isSafeInteger(assessment.unresolvedConflictCount) || assessment.unresolvedConflictCount < 0) {
    return { kind: 'retainAndRetry', reason: 'conflict state is unknown; retain the cache and retry' };
  }
  if (assessment.pendingOutboxCount > 0) {
    return {
      kind: 'eraseBlocked',
      reason: `${assessment.pendingOutboxCount} unacknowledged outbox operation(s) would be lost; retain the cache and retry synchronization`,
    };
  }
  if (assessment.unresolvedConflictCount > 0) {
    return {
      kind: 'eraseBlocked',
      reason: `${assessment.unresolvedConflictCount} unresolved conflict(s) would be lost; retain the cache and resolve them first`,
    };
  }
  switch (assessment.syncState) {
    case 'acknowledged':
      return { kind: 'retainAndRetry', reason: 'default is retention; erasure needs the verified-export override even when clean' };
    case 'pendingOutbox':
    case 'unresolvedConflicts':
      return { kind: 'eraseBlocked', reason: `sync state ${assessment.syncState} reports outstanding intent; retain the cache and retry` };
    case 'offlineUnknown':
    case 'failedUnknown':
      return { kind: 'retainAndRetry', reason: `sync state ${assessment.syncState} is unknown; retain the cache and retry` };
  }
}

/**
 * The destructive override path (master plan 778-784, P08-A2). The request
 * is validated from unknown input: a `{ force: true }` object, a bare
 * boolean, or a request missing either proof is rejected with explicit
 * issues and the cache is retained. Unknown counts and unknown sync states
 * (offline/failed) also stay blocked: the override covers enumerated
 * pending outbox/conflict intent, never intent that cannot be enumerated.
 * With valid proof and known state, the override authorizes erasure even
 * while outbox intent or conflicts stand — the verified export is what
 * preserves that intent.
 */
export function authorizeCacheErasure(assessment: SignOutAssessment, request: unknown): CacheErasureAuthorization {
  const issues: string[] = [];
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    return {
      ok: false,
      decision: { kind: 'retainAndRetry', reason: 'no valid erasure request was presented; retain the cache and retry' },
      issues: ['erasure request must be an object carrying a verified export and a destructive confirmation'],
    };
  }
  const candidate = request as Record<string, unknown>;
  const exported = candidate['verifiedExport'] as Record<string, unknown> | undefined;
  const confirmation = candidate['destructiveConfirmation'] as Record<string, unknown> | undefined;

  if (typeof exported !== 'object' || exported === null) {
    issues.push('verifiedExport must be a verified export reference');
  } else {
    if (!isNonEmptyString(exported['exportId'])) issues.push('verifiedExport.exportId must be a non-empty string');
    if (typeof exported['verifiedAtInstantMs'] !== 'number' || !Number.isSafeInteger(exported['verifiedAtInstantMs'])) {
      issues.push('verifiedExport.verifiedAtInstantMs must be a safe-integer instant');
    }
    if (typeof exported['recordCount'] !== 'number' || !Number.isSafeInteger(exported['recordCount']) || (exported['recordCount'] as number) < 0) {
      issues.push('verifiedExport.recordCount must be a non-negative safe integer');
    }
    if (typeof exported['schemaVersion'] !== 'number' || !Number.isSafeInteger(exported['schemaVersion']) || (exported['schemaVersion'] as number) < 1) {
      issues.push('verifiedExport.schemaVersion must be a positive safe integer');
    }
  }
  if (typeof confirmation !== 'object' || confirmation === null) {
    issues.push('destructiveConfirmation must be an explicit destructive confirmation');
  } else {
    if (confirmation['acknowledgementPhrase'] !== 'ERASE-LOCAL-ACCOUNT-CACHE') {
      issues.push('destructiveConfirmation.acknowledgementPhrase must be exactly ERASE-LOCAL-ACCOUNT-CACHE');
    }
    if (confirmation['confirmed'] !== true) {
      issues.push('destructiveConfirmation.confirmed must be exactly true');
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,
      decision: { kind: 'retainAndRetry', reason: 'erasure proof is incomplete; retain the cache and retry' },
      issues,
    };
  }

  const countsKnown =
    Number.isSafeInteger(assessment.pendingOutboxCount) &&
    assessment.pendingOutboxCount >= 0 &&
    Number.isSafeInteger(assessment.unresolvedConflictCount) &&
    assessment.unresolvedConflictCount >= 0;
  if (!countsKnown) {
    return { ok: false, decision: { kind: 'retainAndRetry', reason: 'pending intent cannot be enumerated; retain the cache and retry' }, issues: ['cache has unknown sync intent'] };
  }
  if (assessment.syncState === 'offlineUnknown' || assessment.syncState === 'failedUnknown') {
    return {
      ok: false,
      decision: evaluateSignOutCache(assessment),
      issues: ['sync state is unknown; the override covers enumerated intent only'],
    };
  }
  return { ok: true, decision: { kind: 'erased' } };
}
