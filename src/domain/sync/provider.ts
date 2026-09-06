/**
 * Provider substitution boundary (P03 Task D).
 *
 * The preferred sync candidate remains Supabase Auth/Postgres plus
 * PowerSync, subject to the founder's residency, provider, billing, and
 * region gates. No provider is approved by this task: provider-specific
 * table names, tokens, SDK types, retry codes, and cursors stay behind
 * future adapters, and this module defines only the minimal capabilities any
 * substitute must prove.
 *
 * Authorized amendment path: a future provider may replace the candidate
 * only after (a) the same contract/conformance evidence in this task passes
 * against its adapter, and (b) the founder gates (residency, provider,
 * billing, region) are decided. The finance domain and command schema must
 * not require a provider-specific rewrite.
 */

export interface SyncProviderCapabilities {
  /** The server stamps ownership from the authenticated session; client-supplied ownership is rejected. */
  readonly serverStampedOwnership: boolean;
  /** Writes are validated and committed transactionally (validated RPC/edge function, no generic client upsert). */
  readonly transactionalValidatedWrites: boolean;
  /** (account, operation) idempotency keys with exact-retry replay. */
  readonly idempotentOperations: boolean;
  /** Ordered replication with opaque checkpoints and atomic batch application. */
  readonly orderedReplicationCheckpoints: boolean;
  /** Recoverable conflict records; local intent is never silently dropped. */
  readonly recoverableConflicts: boolean;
  /** Cloud export/deletion plus account recovery and session/device management. */
  readonly exportDeletion: boolean;
  /** Backup/PITR policy with drilled restore before public launch. */
  readonly backupRestore: boolean;
  /** Documented data-residency evidence for the chosen region. */
  readonly residencyEvidence: boolean;
}

export const PROVIDER_SUBSTITUTION_CHECKLIST: readonly (keyof SyncProviderCapabilities)[] = Object.freeze([
  'serverStampedOwnership',
  'transactionalValidatedWrites',
  'idempotentOperations',
  'orderedReplicationCheckpoints',
  'recoverableConflicts',
  'exportDeletion',
  'backupRestore',
  'residencyEvidence',
]);

/** True only when every minimum capability is proven. One missing capability blocks substitution. */
export function meetsProviderMinimum(capabilities: SyncProviderCapabilities): boolean {
  return PROVIDER_SUBSTITUTION_CHECKLIST.every((capability) => capabilities[capability] === true);
}

/** Founder gates that must be decided before any production provisioning, regardless of provider. */
export const PROVIDER_AMENDMENT_GATES: readonly string[] = Object.freeze([
  'residencyDecisionWithQualifiedAdvice',
  'providerSelection',
  'billingControls',
  'regionSelection',
  'contractConformanceEvidenceAgainstNewAdapter',
]);
