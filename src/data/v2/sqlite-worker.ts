/**
 * Dedicated Worker for the synchronous OPFS SQLite VFS.
 *
 * Owns one OPFSCoopSyncVFS + one database connection. Main-thread overlays
 * hydrate and commit through this RPC. No account, cloud, or network client
 * is constructed here.
 */
/* eslint-env worker */
/// <reference lib="webworker" />

import type {
  CheckpointWritePayload,
  CommitDeltaPayload,
  HydratedPayload,
  OpenParams,
  WorkerRequest,
} from './protocol';

type SqliteApi = {
  exec: (db: number, sql: string, callback?: (row: unknown[], columns: string[]) => void | Promise<void>) => Promise<number>;
  close: (db: number) => Promise<number>;
  open_v2: (name: string) => Promise<number>;
  vfs_register: (vfs: unknown, makeDefault?: boolean) => unknown;
};

const SQLITE_ENGINE_VERSION = '3.53.0';
const LOCAL_SCHEMA_VERSION = 1;

let sqlite3: SqliteApi | null = null;
let sqliteModule: unknown = null;
let vfs: { close?: () => Promise<void> | void } | null = null;
let db: number | null = null;
let parkAfterBegin = false;
let parkDuringHydrate = false;
let hangAfterCommit = false;
let injectedCommitFailure = false;
let simulateUnsupported = false;
let resumeParked: (() => void) | null = null;

function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNullableText(value: string | null): string {
  return value === null ? 'NULL' : sqlText(value);
}

function postParked(): void {
  (self as DedicatedWorkerGlobalScope).postMessage({ parked: true });
}

function waitUntilResumed(): Promise<void> {
  return new Promise((resolve) => {
    resumeParked = resolve;
  });
}

function resumeIfParked(): boolean {
  if (resumeParked === null) return false;
  const resume = resumeParked;
  resumeParked = null;
  resume();
  return true;
}

async function selectValue(sql: string): Promise<unknown> {
  if (sqlite3 === null || db === null) throw new Error('database is not open');
  let value: unknown = null;
  await sqlite3.exec(db, sql, (row) => {
    value = row[0];
  });
  return value;
}

async function loadEngine(sqliteAssetBase: string): Promise<void> {
  if (sqlite3 !== null) return;
  // P04-D4: engine files resolve at runtime from the production `/pkg`
  // closure (or an explicit test asset base). `/* @vite-ignore */` keeps
  // these imports native: Vite must not rewrite them through its preload
  // helper, which touches `window`/`document` and cannot run in a
  // DedicatedWorker.
  const factoryMod = (await import(/* @vite-ignore */ `${sqliteAssetBase}/dist/wa-sqlite.mjs`)) as { default: () => Promise<unknown> };
  const apiMod = (await import(/* @vite-ignore */ `${sqliteAssetBase}/src/sqlite-api.js`)) as { Factory: (module: unknown) => SqliteApi };
  sqliteModule = await factoryMod.default();
  sqlite3 = apiMod.Factory(sqliteModule);
}

async function resetNamespaceFiles(name: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const prefixes = [name, `${name}.db`];
  const removed: string[] = [];
  for await (const entry of root.values()) {
    const matches = prefixes.some((prefix) => entry.name === prefix || entry.name.startsWith(`${prefix}-`) || entry.name.startsWith(`${prefix}.`));
    if (matches) {
      await root.removeEntry(entry.name, { recursive: entry.kind === 'directory' });
      removed.push(entry.name);
    }
  }
}

async function closeDb(): Promise<void> {
  if (sqlite3 !== null && db !== null) {
    try {
      await sqlite3.close(db);
    } catch {
      /* already closed or poisoned */
    }
  }
  db = null;
}

async function openDatabase(params: OpenParams): Promise<{ sqliteVersion: string; schemaVersion: number; namespace: string }> {
  if (simulateUnsupported) {
    const error = Object.assign(new Error('OPFS is unavailable in this context'), { reason: 'unsupported' as const });
    throw error;
  }
  if (typeof navigator === 'undefined' || navigator.storage === undefined || typeof navigator.storage.getDirectory !== 'function') {
    const error = Object.assign(new Error('OPFS FileSystemSyncAccessHandle is unavailable'), { reason: 'unsupported' as const });
    throw error;
  }

  await loadEngine(params.sqliteAssetBase);
  if (sqlite3 === null || sqliteModule === null) throw new Error('sqlite engine failed to load');

  if (db !== null) await closeDb();

  if (params.reset) {
    await resetNamespaceFiles(params.namespace);
  }

  const vfsMod = (await import(/* @vite-ignore */ `${params.sqliteAssetBase}/src/examples/OPFSCoopSyncVFS.js`)) as {
    OPFSCoopSyncVFS: { create: (name: string, module: unknown) => Promise<{ close?: () => Promise<void> | void }> };
  };
  vfs = await vfsMod.OPFSCoopSyncVFS.create(params.namespace, sqliteModule);
  sqlite3.vfs_register(vfs, true);

  const dbFile = `${params.namespace}.db`;
  db = await sqlite3.open_v2(dbFile);

  await sqlite3.exec(db, params.schemaSql);
  await sqlite3.exec(db, `INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '${String(params.schemaVersion)}')`);
  await sqlite3.exec(db, `INSERT OR IGNORE INTO meta(key, value) VALUES ('enqueue_sequence', '0')`);
  await sqlite3.exec(db, `INSERT OR IGNORE INTO meta(key, value) VALUES ('bound_scope', ${sqlText(params.boundScope)})`);
  await sqlite3.exec(db, `INSERT OR IGNORE INTO meta(key, value) VALUES ('bound_device', ${sqlText(params.boundDevice)})`);

  const foundVersion = String((await selectValue(`SELECT value FROM meta WHERE key = 'schema_version'`)) ?? '');
  if (foundVersion !== String(params.schemaVersion) || Number(foundVersion) !== LOCAL_SCHEMA_VERSION) {
    const error = Object.assign(new Error(`unknown local schema version: ${foundVersion}`), {
      reason: 'schema' as const,
      foundVersion,
    });
    throw error;
  }

  const foundScope = String((await selectValue(`SELECT value FROM meta WHERE key = 'bound_scope'`)) ?? '');
  const foundDevice = String((await selectValue(`SELECT value FROM meta WHERE key = 'bound_device'`)) ?? '');
  if (foundScope !== params.boundScope || foundDevice !== params.boundDevice) {
    const error = Object.assign(new Error('database binding does not match this handle'), { reason: 'scopeMismatch' as const });
    throw error;
  }

  const sqliteVersion = String((await selectValue('SELECT sqlite_version()')) ?? '');
  if (sqliteVersion !== SQLITE_ENGINE_VERSION) {
    throw new Error(`unexpected sqlite engine ${sqliteVersion}`);
  }

  return { sqliteVersion, schemaVersion: params.schemaVersion, namespace: params.namespace };
}

async function hydrate(): Promise<HydratedPayload> {
  if (sqlite3 === null || db === null) throw new Error('database is not open');
  const books: unknown[] = [];
  const operations: unknown[] = [];
  const outbox: unknown[] = [];
  const delivery: unknown[] = [];
  const checkpoints: Array<{
    streamId: string;
    cursor: string | null;
    batchDigest: string | null;
    applied: unknown[];
  }> = [];
  let enqueueSequence = 0;

  await sqlite3.exec(db, 'BEGIN');
  try {
    await sqlite3.exec(db, 'SELECT payload FROM books', (row) => {
      books.push(JSON.parse(row[0] as string));
    });
    if (parkDuringHydrate) {
      parkDuringHydrate = false;
      postParked();
      await waitUntilResumed();
    }
    await sqlite3.exec(db, 'SELECT payload FROM journal', (row) => {
      operations.push(JSON.parse(row[0] as string));
    });
    await sqlite3.exec(db, 'SELECT payload FROM outbox ORDER BY enqueue_sequence', (row) => {
      outbox.push(JSON.parse(row[0] as string));
    });
    await sqlite3.exec(db, 'SELECT payload FROM delivery', (row) => {
      delivery.push(JSON.parse(row[0] as string));
    });
    await sqlite3.exec(db, `SELECT value FROM meta WHERE key = 'enqueue_sequence'`, (row) => {
      enqueueSequence = Number(row[0]);
    });
    await sqlite3.exec(db, 'SELECT stream_id, cursor, batch_digest, applied_json FROM checkpoints', (row) => {
      checkpoints.push({
        streamId: row[0] as string,
        cursor: (row[1] as string | null) ?? null,
        batchDigest: (row[2] as string | null) ?? null,
        applied: JSON.parse(row[3] as string) as unknown[],
      });
    });
    await sqlite3.exec(db, 'COMMIT');
  } catch (error) {
    try {
      await sqlite3.exec(db, 'ROLLBACK');
    } catch {
      /* read snapshot already gone */
    }
    throw error;
  }

  return { books, operations, outbox, delivery, enqueueSequence, checkpoints };
}

async function commitDelta(delta: CommitDeltaPayload): Promise<{ committed: true }> {
  if (sqlite3 === null || db === null) throw new Error('database is not open');
  if (injectedCommitFailure) {
    injectedCommitFailure = false;
    const error = Object.assign(new Error('injected adapter failure at commit'), { reason: 'injected' as const });
    throw error;
  }

  await sqlite3.exec(db, 'BEGIN IMMEDIATE');
  try {
    if (parkAfterBegin) {
      parkAfterBegin = false;
      postParked();
      await new Promise(() => {
        /* terminated by the caller */
      });
    }

    for (const [bookId, readRevision] of delta.bookRevisionsRead) {
      const fresh = await selectValue(`SELECT revision FROM books WHERE book_id = ${sqlText(bookId)}`);
      const freshRevision = fresh === null ? 0 : Number(fresh);
      if (freshRevision !== readRevision) {
        const error = Object.assign(new Error(`book ${bookId} changed during the transaction`), { reason: 'guard' as const });
        throw error;
      }
    }
    for (const operationId of delta.operationIds) {
      const exists = await selectValue(`SELECT 1 FROM journal WHERE operation_id = ${sqlText(operationId)}`);
      if (exists !== null) {
        const error = Object.assign(new Error(`operation ${operationId} already exists`), { reason: 'guard' as const });
        throw error;
      }
    }
    for (const operationId of delta.outboxOperationIds) {
      const exists = await selectValue(`SELECT 1 FROM outbox WHERE operation_id = ${sqlText(operationId)}`);
      if (exists !== null) {
        const error = Object.assign(new Error(`outbox for operation ${operationId} already exists`), { reason: 'guard' as const });
        throw error;
      }
    }
    for (const [operationId, readVersion] of delta.deliveryVersionsRead) {
      const fresh = await selectValue(`SELECT version FROM delivery WHERE operation_id = ${sqlText(operationId)}`);
      const freshVersion = fresh === null ? null : Number(fresh);
      if (freshVersion !== readVersion) {
        const error = Object.assign(new Error(`delivery for ${operationId} changed during the transaction`), { reason: 'guard' as const });
        throw error;
      }
    }
    for (const [streamId, readCursor] of delta.checkpointCursorsRead) {
      const fresh = await selectValue(`SELECT cursor FROM checkpoints WHERE stream_id = ${sqlText(streamId)}`);
      const freshCursor = (fresh as string | null) ?? null;
      if (freshCursor !== readCursor) {
        const error = Object.assign(new Error(`checkpoint for ${streamId} changed during the transaction`), { reason: 'guard' as const });
        throw error;
      }
    }
    if (delta.sequenceBase !== null) {
      const fresh = Number((await selectValue(`SELECT value FROM meta WHERE key = 'enqueue_sequence'`)) ?? -1);
      if (fresh !== delta.sequenceBase) {
        const error = Object.assign(new Error('enqueue sequence changed during the transaction'), { reason: 'guard' as const });
        throw error;
      }
    }

    for (const [bookId, revision, payload] of delta.bookWrites) {
      await sqlite3.exec(
        db,
        `INSERT INTO books(book_id, revision, payload) VALUES (${sqlText(bookId)}, ${revision}, ${sqlText(payload)}) ON CONFLICT(book_id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload`,
      );
    }
    for (const [operationId, sequence, payload] of delta.operationWrites) {
      await sqlite3.exec(
        db,
        `INSERT INTO journal(operation_id, enqueue_sequence, payload) VALUES (${sqlText(operationId)}, ${sequence}, ${sqlText(payload)})`,
      );
    }
    for (const [operationId, sequence, payload] of delta.outboxWrites) {
      await sqlite3.exec(
        db,
        `INSERT INTO outbox(operation_id, enqueue_sequence, payload) VALUES (${sqlText(operationId)}, ${sequence}, ${sqlText(payload)})`,
      );
    }
    for (const [operationId, version, payload] of delta.deliveryWrites) {
      await sqlite3.exec(
        db,
        `INSERT INTO delivery(operation_id, version, payload) VALUES (${sqlText(operationId)}, ${version}, ${sqlText(payload)}) ON CONFLICT(operation_id) DO UPDATE SET version = excluded.version, payload = excluded.payload`,
      );
    }
    for (const checkpoint of delta.checkpointWrites as readonly CheckpointWritePayload[]) {
      await sqlite3.exec(
        db,
        `INSERT INTO checkpoints(stream_id, cursor, batch_digest, applied_json) VALUES (${sqlText(checkpoint.streamId)}, ${sqlNullableText(checkpoint.cursor)}, ${sqlNullableText(checkpoint.batchDigest)}, ${sqlText(checkpoint.appliedJson)}) ON CONFLICT(stream_id) DO UPDATE SET cursor = excluded.cursor, batch_digest = excluded.batch_digest, applied_json = excluded.applied_json`,
      );
    }
    if (delta.sequenceBase !== null) {
      await sqlite3.exec(
        db,
        `UPDATE meta SET value = ${sqlText(String(delta.sequenceBase + delta.sequencesAllocated))} WHERE key = 'enqueue_sequence'`,
      );
    }

    await sqlite3.exec(db, 'COMMIT');
  } catch (error) {
    try {
      await sqlite3.exec(db, 'ROLLBACK');
    } catch {
      /* transaction already gone */
    }
    throw error;
  }

  if (hangAfterCommit) {
    hangAfterCommit = false;
    await new Promise(() => {
      /* lost acknowledgement: durable commit already succeeded */
    });
  }
  return { committed: true };
}

async function integrity(): Promise<{ integrity: string }> {
  const value = String((await selectValue('PRAGMA integrity_check')) ?? '');
  return { integrity: value };
}

function classifyError(error: unknown): { error: string; reason?: 'guard' | 'busy' | 'schema' | 'unsupported' | 'io' | 'scopeMismatch' | 'injected'; foundVersion?: string } {
  const err = error as { message?: string; reason?: string; foundVersion?: string; name?: string; code?: number };
  const message = String(err?.message ?? error).slice(0, 2000);
  if (err?.reason === 'guard' || /changed during the transaction|already exists/i.test(message)) {
    return { error: message, reason: 'guard' };
  }
  if (err?.reason === 'busy' || err?.code === 5 || err?.code === 6 || /busy|locked/i.test(message)) {
    return { error: message, reason: 'busy' };
  }
  if (err?.reason === 'schema') {
    return { error: message, reason: 'schema', foundVersion: err.foundVersion };
  }
  if (err?.reason === 'unsupported' || err?.name === 'SecurityError' || /OPFS|getDirectory|SyncAccessHandle|NotSupported/i.test(message)) {
    return { error: message, reason: 'unsupported' };
  }
  if (err?.reason === 'scopeMismatch') {
    return { error: message, reason: 'scopeMismatch' };
  }
  if (err?.reason === 'injected') {
    return { error: message, reason: 'injected' };
  }
  return { error: message, reason: 'io' };
}

const worker = self as DedicatedWorkerGlobalScope;
let opChain: Promise<void> = Promise.resolve();

worker.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, op, params } = event.data;
  if (op === 'resumeParked') {
    resumeIfParked();
    worker.postMessage({ id, ok: true, result: { resumed: true } });
    return;
  }
  opChain = opChain.then(async () => {
    try {
      let result: unknown;
      if (op === 'open') result = await openDatabase(params as OpenParams);
      else if (op === 'hydrate') result = await hydrate();
      else if (op === 'commit') result = await commitDelta(params as CommitDeltaPayload);
      else if (op === 'close') {
        await closeDb();
        result = { closed: true };
      } else if (op === 'integrity') result = await integrity();
      else if (op === 'armParkAfterBegin') {
        parkAfterBegin = true;
        result = { armed: true };
      } else if (op === 'armParkDuringHydrate') {
        parkDuringHydrate = true;
        result = { armed: true };
      } else if (op === 'armHangAfterCommit') {
        hangAfterCommit = true;
        result = { armed: true };
      } else if (op === 'armInjectedCommitFailure') {
        injectedCommitFailure = true;
        result = { armed: true };
      } else if (op === 'simulateUnsupported') {
        simulateUnsupported = true;
        result = { armed: true };
      } else if (op === 'forceSchemaVersion') {
        const version = String((params as { version: string }).version);
        if (sqlite3 === null || db === null) throw new Error('database is not open');
        await sqlite3.exec(db, `UPDATE meta SET value = ${sqlText(version)} WHERE key = 'schema_version'`);
        result = { version };
      } else {
        throw new Error(`unknown op: ${op}`);
      }
      worker.postMessage({ id, ok: true, result });
    } catch (error) {
      const classified = classifyError(error);
      worker.postMessage({ id, ok: false, ...classified });
    }
  });
};
