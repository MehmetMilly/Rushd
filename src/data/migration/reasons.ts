/**
 * Locale-neutral review, quarantine, and recovery reason codes for P04-C.
 *
 * Codes are presentation keys, not English copy. Equal-quality Arabic and
 * English labels belong to a later integration. Numeric/currency identity is
 * never derived from locale or numeral shaping.
 */

export const MIGRATION_REASON = Object.freeze({
  emptySource: 'empty-source',
  missingValue: 'missing-value',
  corruptType: 'corrupt-type',
  nonFinite: 'non-finite',
  excessPrecision: 'excess-precision',
  invalidSign: 'invalid-sign',
  invalidRange: 'invalid-range',
  malformedDecimal: 'malformed-decimal',
  malformedRecord: 'malformed-record',
  malformedDate: 'malformed-date',
  ambiguousCurrency: 'ambiguous-currency',
  unsupportedCurrency: 'unsupported-currency',
  unsafeAmount: 'unsafe-amount',
  invalidId: 'invalid-id',
  missingId: 'missing-id',
  duplicateId: 'duplicate-id',
  conflictingId: 'conflicting-id',
  duplicateSettlement: 'duplicate-settlement',
  missingSettlement: 'missing-settlement',
  overlappingOpeningSettlement: 'overlapping-opening-settlement',
  contradictorySettlement: 'contradictory-settlement',
  unverifiedSettlement: 'unverified-settlement',
  provisionalEssentialReservation: 'provisional-essential-reservation',
  plannedNotReserved: 'planned-not-reserved',
  goalAllocationNotInferred: 'goal-allocation-not-inferred',
  alreadyActive: 'already-active',
  replayedMigration: 'replayed-migration',
  conflictingSource: 'conflicting-source',
  conflictingTarget: 'conflicting-target',
  cancelledBeforeCommit: 'cancelled-before-commit',
  activationCommitted: 'activation-committed',
  unsupportedStorage: 'unsupported-storage',
  quotaOrPrivate: 'quota-or-private',
  stagingWriteFailure: 'staging-write-failure',
  activationFailure: 'activation-failure',
  cleanupFailure: 'cleanup-failure',
  extractionFailure: 'extraction-failure',
  conversionFailure: 'conversion-failure',
  corruptStaging: 'corrupt-staging',
  unknownSchema: 'unknown-schema',
  activationConflict: 'activation-conflict',
  replayConflict: 'replay-conflict',
  operationIdCollision: 'operation-id-collision',
} as const);

export type MigrationReasonCode = (typeof MIGRATION_REASON)[keyof typeof MIGRATION_REASON];

export const PORTABILITY_REASON = Object.freeze({
  unknownFormat: 'unknown-format',
  incompatibleVersion: 'incompatible-version',
  wrongCurrency: 'wrong-currency',
  invalidReference: 'invalid-reference',
  duplicateId: 'duplicate-id',
  journalOutboxAsymmetry: 'journal-outbox-asymmetry',
  revisionConflict: 'revision-idempotency-conflict',
  corruptPayload: 'corrupt-payload',
  truncatedPayload: 'truncated-payload',
  tamperedPayload: 'tampered-payload',
  oversizedPayload: 'oversized-payload',
  confirmationRequired: 'destructive-confirmation-required',
  confirmationMismatch: 'destructive-confirmation-mismatch',
  resetScopeMismatch: 'reset-scope-mismatch',
  cancelledBeforeCommit: 'cancelled-before-commit',
  activationConflict: 'activation-conflict',
  replayConflict: 'replay-conflict',
  foreignRecord: 'foreign-record',
  malformedRecord: 'malformed-record',
  orphanRecord: 'orphan-record',
  invalidId: 'invalid-id',
} as const);

export type PortabilityReasonCode = (typeof PORTABILITY_REASON)[keyof typeof PORTABILITY_REASON];
