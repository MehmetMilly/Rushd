/**
 * Open, close, and recover a durable v2 guest repository over OPFS SQLite.
 *
 * Guest opening never constructs an account or cloud client. Unavailable or
 * unsafe OPFS fails visibly; there is no memory fallback.
 */
/* eslint-env browser */

import type { DeviceId, RepositoryScopeId } from '../../domain/sync/scope';
import { DurableGuestRepository } from './repository';
import { LOCAL_SCHEMA_SQL, LOCAL_SCHEMA_VERSION } from './schema';
import { databaseNamespaceFor } from './namespace';
import { StorageUnsupportedError } from './errors';
import { SqliteWorkerClient } from './worker-client';

export interface OpenDurableRepositoryOptions {
  readonly boundScope: RepositoryScopeId;
  readonly boundDevice: DeviceId;
  readonly workerUrl?: string;
  readonly sqliteAssetBase?: string;
  readonly storageId?: string;
  readonly reset?: boolean;
  readonly simulateUnsupported?: boolean;
}

const DEFAULT_SQLITE_ASSET_BASE = '/pkg';

function defaultWorkerUrl(): string {
  return new URL('./sqlite-worker.js', import.meta.url).href;
}

export async function openDurableGuestRepository(options: OpenDurableRepositoryOptions): Promise<DurableGuestRepository> {
  if (typeof Worker === 'undefined') {
    throw new StorageUnsupportedError({
      reason: 'worker-unavailable',
      message: 'dedicated Worker is required for the synchronous OPFS SQLite VFS',
    });
  }
  if (options.simulateUnsupported) {
    throw new StorageUnsupportedError({
      reason: 'opfs-unavailable',
      message: 'OPFS is unavailable or unsafe in this context',
    });
  }

  const workerUrl = options.workerUrl ?? defaultWorkerUrl();
  const sqliteAssetBase = options.sqliteAssetBase ?? DEFAULT_SQLITE_ASSET_BASE;
  const namespace = databaseNamespaceFor(options.boundScope, options.boundDevice, options.storageId);
  const client = new SqliteWorkerClient({ workerUrl, namespace });
  const repository = new DurableGuestRepository({
    client,
    boundScope: options.boundScope,
    boundDevice: options.boundDevice,
    sqliteAssetBase,
    schemaSql: LOCAL_SCHEMA_SQL,
    schemaVersion: LOCAL_SCHEMA_VERSION,
    storageId: options.storageId,
    workerUrl,
  });
  try {
    await repository.open(options.reset === true);
  } catch (error) {
    await repository.close().catch(() => undefined);
    throw error;
  }
  return repository;
}
