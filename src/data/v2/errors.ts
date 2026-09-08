/**
 * Typed durable-storage failures for the P04-B guest repository.
 *
 * None of these may be recovered by silently switching to memory or a
 * remote/account path. Callers must surface them.
 */

export interface GuardConflictErrorOptions {
  readonly message: string;
}

/** Fresh durable state moved under a staged transaction (first-committer-wins). */
export class GuardConflictError extends Error {
  readonly code = 'guardConflict' as const;

  constructor(options: GuardConflictErrorOptions) {
    super(options.message);
    this.name = 'GuardConflictError';
  }
}

export type StorageUnsupportedReason = 'opfs-unavailable' | 'worker-unavailable' | 'private-or-quota';

export class StorageUnsupportedError extends Error {
  readonly code = 'storageUnsupported' as const;
  readonly reason: StorageUnsupportedReason;

  constructor(options: { readonly reason: StorageUnsupportedReason; readonly message: string }) {
    super(options.message);
    this.name = 'StorageUnsupportedError';
    this.reason = options.reason;
  }
}

export type StorageFailureReason =
  | 'io'
  | 'worker'
  | 'schema'
  | 'scopeMismatch'
  | 'busy'
  | 'closed'
  | 'injected';

export class StorageFailureError extends Error {
  readonly code = 'storageFailure' as const;
  readonly reason: StorageFailureReason;

  constructor(options: { readonly reason: StorageFailureReason; readonly message: string }) {
    super(options.message);
    this.name = 'StorageFailureError';
    this.reason = options.reason;
  }
}

export class SchemaRejectedError extends Error {
  readonly code = 'schemaRejected' as const;
  readonly foundVersion: string;

  constructor(options: { readonly foundVersion: string; readonly message: string }) {
    super(options.message);
    this.name = 'SchemaRejectedError';
    this.foundVersion = options.foundVersion;
  }
}

export function isDurableConflict(error: unknown): boolean {
  return error instanceof GuardConflictError || (error instanceof StorageFailureError && error.reason === 'busy');
}
