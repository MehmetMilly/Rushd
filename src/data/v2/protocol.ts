/**
 * RPC protocol between the main-thread durable repository and the dedicated
 * OPFS/SQLite worker. Payloads are JSON; domain types are reconstructed on
 * the main thread.
 */

export type WorkerOp =
  | 'open'
  | 'hydrate'
  | 'commit'
  | 'close'
  | 'integrity'
  | 'armParkAfterBegin'
  | 'armParkDuringHydrate'
  | 'armHangAfterCommit'
  | 'armInjectedCommitFailure'
  | 'resumeParked'
  | 'simulateUnsupported'
  | 'forceSchemaVersion';

export interface WorkerRequest {
  readonly id: number;
  readonly op: WorkerOp;
  readonly params?: unknown;
}

export interface WorkerSuccess {
  readonly id: number;
  readonly ok: true;
  readonly result: unknown;
}

export interface WorkerFailure {
  readonly id: number;
  readonly ok: false;
  readonly error: string;
  readonly reason?: 'guard' | 'busy' | 'schema' | 'unsupported' | 'io' | 'scopeMismatch' | 'injected';
  readonly foundVersion?: string;
}

export type WorkerResponse = WorkerSuccess | WorkerFailure;

export interface OpenParams {
  readonly namespace: string;
  readonly sqliteAssetBase: string;
  readonly schemaSql: string;
  readonly schemaVersion: number;
  readonly boundScope: string;
  readonly boundDevice: string;
  readonly reset?: boolean;
}

export interface OpenResult {
  readonly sqliteVersion: string;
  readonly schemaVersion: number;
  readonly namespace: string;
}

export interface HydratedPayload {
  readonly books: readonly unknown[];
  readonly operations: readonly unknown[];
  readonly outbox: readonly unknown[];
  readonly delivery: readonly unknown[];
  readonly enqueueSequence: number;
  readonly checkpoints: readonly CheckpointPayload[];
}

export interface CheckpointPayload {
  readonly streamId: string;
  readonly cursor: string | null;
  readonly batchDigest: string | null;
  readonly applied: readonly unknown[];
}

export interface CommitDeltaPayload {
  readonly bookRevisionsRead: readonly (readonly [string, number])[];
  readonly operationIds: readonly string[];
  readonly outboxOperationIds: readonly string[];
  readonly deliveryVersionsRead: readonly (readonly [string, number | null])[];
  readonly checkpointCursorsRead: readonly (readonly [string, string | null])[];
  readonly bookWrites: readonly (readonly [string, number, string])[];
  readonly operationWrites: readonly (readonly [string, number, string])[];
  readonly outboxWrites: readonly (readonly [string, number, string])[];
  readonly deliveryWrites: readonly (readonly [string, number, string])[];
  readonly checkpointWrites: readonly CheckpointWritePayload[];
  readonly sequenceBase: number | null;
  readonly sequencesAllocated: number;
}

export interface CheckpointWritePayload {
  readonly streamId: string;
  readonly cursor: string | null;
  readonly batchDigest: string | null;
  readonly appliedJson: string;
}

export interface IntegrityResult {
  readonly integrity: string;
}

export const WRITE_LOCK_TIMEOUT_MS = 8_000;
export const WORKER_RPC_TIMEOUT_MS = 20_000;
export const SQLITE_ENGINE_VERSION = '3.53.0';
