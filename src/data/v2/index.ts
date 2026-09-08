/**
 * Production durable v2 guest repository (P04-B).
 *
 * Provisional backend: `@journeyapps/wa-sqlite@2.0.4` / SQLite `3.53.0`
 * with `OPFSCoopSyncVFS` in a dedicated Worker. Final VFS selection remains
 * deferred until physical-device evidence. This module never claims sync,
 * accounts, PWA, or P04 PASS.
 */

export { LOCAL_SCHEMA_SQL, LOCAL_SCHEMA_VERSION } from './schema';
export { databaseNamespaceFor } from './namespace';
export {
  GuardConflictError,
  SchemaRejectedError,
  StorageFailureError,
  StorageUnsupportedError,
  isDurableConflict,
} from './errors';
export { DurableGuestRepository, asDurableTransaction } from './repository';
export { DurableCheckpointStore, type DurableApplyResult } from './checkpoint-store';
export { openDurableGuestRepository, type OpenDurableRepositoryOptions } from './session';
export { SQLITE_ENGINE_VERSION } from './protocol';
