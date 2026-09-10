/**
 * P04-C legacy migration: read-only v1 extraction, exact SAR conversion,
 * staged activation, and recovery. Guest mode never constructs a network
 * or account client.
 */

export { MIGRATION_REASON, PORTABILITY_REASON, type MigrationReasonCode, type PortabilityReasonCode } from './reasons';
export {
  LEGACY_MIGRATION_CURRENCY,
  convertUntaggedSarMajor,
  requireNonNegative,
  requireStrictlyPositive,
  canonicalNumberDecimal,
  type ConversionResult,
  type SourceRef,
} from './money-conversion';
export {
  LEGACY_SOURCE_DATABASE,
  LEGACY_SOURCE_VERSION,
  extractLegacyIndexedDb,
  snapshotFromP00Fixture,
  snapshotFromStores,
  sourceFingerprintOf,
  isCanonicalSourceFingerprint,
  SOURCE_FINGERPRINT_PATTERN,
  jsonSafeSource,
  settingValue,
  type ExtractedLegacySnapshot,
} from './extract';
export {
  LEGACY_GUEST_BOOK_ID,
  planLegacyMigration,
  type MigrationPlan,
  type ReviewItem,
  type PlannedCommand,
} from './mapping';
export {
  CONTROL_DATABASE,
  DEFAULT_ACTIVE_STORAGE_ID,
  EMPTY_POINTER,
  ACTIVATION_COMMIT_POINT,
  createIndexedDbControlStore,
  createMemoryControlStore,
  type ActivationPointer,
  type ActivationCasResult,
  type ControlStore,
  type LifecycleRun,
} from './control-store';
export { decodeLifecycleId, LIFECYCLE_ID_PATTERN, type LifecycleIdResult } from './lifecycle-id';
export {
  runLegacyMigration,
  commitPlannedCommands,
  openActiveGuestRepository,
  type MigrationResult,
  type MigrationRuntime,
  type MigrationFailAt,
} from './staging';
