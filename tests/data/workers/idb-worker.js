/**
 * P04-A-FIX-01 IDB-candidate worker (async build + IDBBatchAtomicVFS).
 *
 * Executes real SQL against the eligible IndexedDB-backed SQLite VFS inside
 * a dedicated Worker. RPC: { id, op, params } -> { id, ok, result }.
 * All scenario data is synthetic and deterministic (seeded in-worker).
 */
/* global self: false, indexedDB: false, performance: false, navigator: false, setTimeout: false, BroadcastChannel: false */
import SQLiteESMFactory from '/pkg/dist/wa-sqlite-async.mjs';
import * as SQLite from '/pkg/src/sqlite-api.js';
import * as VFS from '/pkg/src/VFS.js';
import { IDBBatchAtomicVFS } from '/pkg/src/examples/IDBBatchAtomicVFS.js';

let module = null;
let sqlite3 = null;
let vfs = null;
let vfsName = null;
const openDbs = new Map();
const tabConns = new Map();

function seededRows(count, tag, bookId) {
  const rows = [];
  let seed = tag === 'small' ? 4321 : 876543;
  for (let i = 0; i < count; i += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    rows.push({ id: `${tag}-${i}`, bookId, amount: 100 + (seed % 9000), note: `synthetic-${tag}-${i}` });
  }
  return rows;
}

function esc(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function selectValue(db, sql) {
  let value = null;
  await sqlite3.exec(db, sql, (row) => {
    value = row[0];
  });
  return value;
}

async function ensureSchema(db) {
  await sqlite3.exec(
    db,
    `CREATE TABLE IF NOT EXISTS ledger(entry_id TEXT PRIMARY KEY, book_id TEXT NOT NULL, amount_minor INTEGER NOT NULL, note TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS guard(book_id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
     CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value INTEGER NOT NULL);`,
  );
}

async function openDb(name) {
  if (module === null) {
    module = await SQLiteESMFactory();
    sqlite3 = SQLite.Factory(module);
  }
  if (vfsName !== name) {
    vfs = await IDBBatchAtomicVFS.create(name, module);
    sqlite3.vfs_register(vfs, true);
    vfsName = name;
  }
  const db = await sqlite3.open_v2(`${name}.db`);
  openDbs.set(name, db);
  await ensureSchema(db);
  const version = await selectValue(db, 'SELECT sqlite_version() AS v');
  return { db, version };
}

function getDb(name) {
  const db = openDbs.get(name);
  if (db === undefined) throw new Error(`database not open: ${name}`);
  return db;
}

async function closeDb(name) {
  const db = openDbs.get(name);
  if (db !== undefined) {
    await sqlite3.close(db);
    openDbs.delete(name);
  }
}

function idbDelete(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

function errorNameOf(error) {
  if (!error) return 'unknown';
  if (error.name && error.name !== 'Error') return String(error.name);
  const text = String(error);
  const match = text.match(/^([A-Za-z]+Error)/);
  return match ? match[1] : String(error.name || 'unknown');
}

function classifyWriteFailure(error) {
  const code = error && error.code !== undefined ? error.code : 'no-code';
  const message = String(error && error.message ? error.message : error).slice(0, 160);
  if (code === 5 || code === 6 || /busy/i.test(message) || /locked/i.test(message)) {
    return `busy-like:${code}:${message}`;
  }
  return `guard-conflict:${code}:${message}`;
}

async function waitPeerBarrier(channelName, selfId, peerId, timeoutMs) {
  const channel = new BroadcastChannel(channelName);
  let peerSeen = false;
  channel.onmessage = (event) => {
    if (event.data === peerId) peerSeen = true;
  };
  const started = performance.now();
  while (!peerSeen) {
    channel.postMessage(selfId);
    if (performance.now() - started > timeoutMs) {
      channel.close();
      throw new Error(`two-tab barrier timeout waiting for ${peerId} on ${channelName}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  channel.postMessage(selfId);
  await new Promise((resolve) => setTimeout(resolve, 40));
  channel.postMessage(selfId);
  channel.close();
}

const OPS = {
  async open({ name }) {
    const t0 = performance.now();
    const { version } = await openDb(name);
    return { version, openMs: performance.now() - t0 };
  },
  async openMeasured({ name }) {
    const t0 = performance.now();
    try {
      const { version } = await openDb(name);
      return { opened: true, errorName: null, errorMessage: null, version, openMs: performance.now() - t0 };
    } catch (error) {
      return {
        opened: false,
        errorName: errorNameOf(error),
        errorMessage: String(error && error.message ? error.message : error).slice(0, 400),
        version: null,
        openMs: performance.now() - t0,
      };
    }
  },
  async reset({ name }) {
    const t0 = performance.now();
    await closeDb(name);
    openDbs.clear();
    await idbDelete(name);
    const { version } = await openDb(name);
    return { version, resetMs: performance.now() - t0 };
  },
  async truncate({ name }) {
    const db = getDb(name);
    const t0 = performance.now();
    await sqlite3.exec(db, 'DELETE FROM ledger; DELETE FROM guard; DELETE FROM meta;');
    return { truncateMs: performance.now() - t0 };
  },
  async bulk({ name, tag, count, bookId }) {
    const db = getDb(name);
    const rows = seededRows(count, tag, bookId);
    const values = rows.map((r) => `(${esc(r.id)},${esc(r.bookId)},${r.amount},${esc(r.note)})`).join(',');
    const t0 = performance.now();
    await sqlite3.exec(db, `BEGIN IMMEDIATE; INSERT INTO ledger(entry_id, book_id, amount_minor, note) VALUES ${values}; COMMIT;`);
    return { count, bulkMs: performance.now() - t0 };
  },
  async commits({ name, n, tag, bookId }) {
    const db = getDb(name);
    const rows = seededRows(n, `${tag}-single`, bookId);
    const t0 = performance.now();
    for (const r of rows) {
      await sqlite3.exec(
        db,
        `BEGIN IMMEDIATE; INSERT INTO ledger(entry_id, book_id, amount_minor, note) VALUES (${esc(r.id)},${esc(r.bookId)},${r.amount},${esc(r.note)}); COMMIT;`,
      );
    }
    const ms = performance.now() - t0;
    return { count: n, commitsMs: ms, perCommitMs: ms / n };
  },
  async read({ name }) {
    const db = getDb(name);
    const t0 = performance.now();
    const count = await selectValue(db, 'SELECT COUNT(*) FROM ledger');
    const sum = await selectValue(db, 'SELECT COALESCE(SUM(amount_minor), 0) FROM ledger');
    return { count, sum, readMs: performance.now() - t0 };
  },
  async reload({ name }) {
    const t0 = performance.now();
    await closeDb(name);
    const { version } = await openDb(name);
    const count = await selectValue(getDb(name), 'SELECT COUNT(*) FROM ledger');
    return { version, count, reloadMs: performance.now() - t0 };
  },
  async integrity({ name }) {
    const db = getDb(name);
    let status = '';
    await sqlite3.exec(db, 'PRAGMA integrity_check', (row) => {
      status = row[0];
    });
    return { integrity: status };
  },
  async quota() {
    if (!navigator.storage || !navigator.storage.estimate) return { supported: false };
    return { supported: true, estimate: await navigator.storage.estimate() };
  },
  async blocking({ name }) {
    // A holds an uncommitted write tx while B begins on a second
    // connection. The VFS serializes writers by blocking (lockTimeout
    // defaults to Infinity): B must still be pending after 3 s. The
    // harness terminates this worker next, so nothing here is committed
    // or rolled back — recovery is verified by verifyClean.
    const dbA = await sqlite3.open_v2(`${name}.db`);
    const dbB = await sqlite3.open_v2(`${name}.db`);
    await sqlite3.exec(dbA, 'BEGIN IMMEDIATE');
    await sqlite3.exec(dbA, `INSERT INTO ledger(entry_id, book_id, amount_minor, note) VALUES ('block-row', 'block', 1, 'synthetic-block')`);
    let bResolved = false;
    let bError = null;
    sqlite3.exec(dbB, 'BEGIN IMMEDIATE').then(
      () => {
        bResolved = true;
      },
      (error) => {
        bError = `${error && error.code !== undefined ? error.code : 'no-code'}:${String(error && error.message ? error.message : error).slice(0, 120)}`;
      },
    );
    await new Promise((r) => setTimeout(r, 3000));
    return { bBlockedAt3s: !bResolved && bError === null, bEarlyError: bError };
  },
  async verifyClean({ name }) {
    const db = getDb(name);
    const blockRows = await selectValue(db, `SELECT COUNT(*) FROM ledger WHERE entry_id = 'block-row'`);
    const parkedRows = await selectValue(db, `SELECT COUNT(*) FROM ledger WHERE entry_id = 'parked-row'`);
    let integrity = '';
    await sqlite3.exec(db, 'PRAGMA integrity_check', (row) => {
      integrity = row[0];
    });
    return { blockRows, parkedRows, integrity };
  },
  async tSeed({ name, revision }) {
    const db = getDb(name);
    await sqlite3.exec(db, `INSERT OR REPLACE INTO guard(book_id, revision) VALUES ('twotab', ${revision});
      DELETE FROM ledger WHERE entry_id IN ('twotab-winner', 'twotab-writer-A', 'twotab-writer-B') OR entry_id LIKE 'twotab-writer-%';`);
    return { seeded: revision };
  },
  async tReadRevision({ name }) {
    const db = getDb(name);
    const revision = await selectValue(db, `SELECT revision FROM guard WHERE book_id = 'twotab'`);
    return { revision };
  },
  async tAttemptGuardedWrite({ name, fromRevision, writerId, peerId, barrier }) {
    if (writerId !== 'A' && writerId !== 'B') throw new Error(`invalid writerId ${writerId}`);
    if (barrier) {
      await waitPeerBarrier(`p04a-twotab-barrier-${name}`, writerId, peerId, 15000);
    }
    let conn = null;
    try {
      conn = await sqlite3.open_v2(`${name}.db`);
      try {
        await sqlite3.exec(conn, 'BEGIN IMMEDIATE');
      } catch (error) {
        return { committed: false, outcome: classifyWriteFailure(error), writerId, staged: false };
      }
      await sqlite3.exec(
        conn,
        `UPDATE guard SET revision = ${fromRevision + 1} WHERE book_id = 'twotab' AND revision = ${fromRevision}`,
      );
      const changed = await selectValue(conn, 'SELECT changes()');
      if (changed === 0) {
        await sqlite3.exec(conn, 'ROLLBACK');
        return { committed: false, outcome: 'stale-guard-detected-rollback', writerId, staged: true };
      }
      try {
        await sqlite3.exec(
          conn,
          `INSERT INTO ledger(entry_id, book_id, amount_minor, note) VALUES (${esc(`twotab-writer-${writerId}`)}, 'twotab', 1, ${esc(`synthetic-twotab-${writerId}`)});
           COMMIT;`,
        );
        return { committed: true, outcome: 'committed', writerId, staged: true, revision: fromRevision + 1 };
      } catch (error) {
        try {
          await sqlite3.exec(conn, 'ROLLBACK');
        } catch {
          /* already out of tx */
        }
        return { committed: false, outcome: classifyWriteFailure(error), writerId, staged: true };
      }
    } catch (error) {
      return { committed: false, outcome: classifyWriteFailure(error), writerId, staged: false };
    } finally {
      if (conn !== null) {
        try {
          await sqlite3.close(conn);
        } catch {
          /* already closed */
        }
      }
    }
  },
  async tBegin({ name }) {
    const conn = await sqlite3.open_v2(`${name}.db`);
    await sqlite3.exec(conn, 'BEGIN IMMEDIATE');
    const revision = await selectValue(conn, `SELECT revision FROM guard WHERE book_id = 'twotab'`);
    const key = `tab-${tabConns.size}`;
    tabConns.set(key, conn);
    return { key, revision };
  },
  async tCommitWinner({ key, fromRevision }) {
    const conn = tabConns.get(key);
    if (conn === undefined) throw new Error(`unknown tab connection ${key}`);
    await sqlite3.exec(conn, `UPDATE guard SET revision = ${fromRevision + 1} WHERE book_id = 'twotab' AND revision = ${fromRevision};
      INSERT INTO ledger(entry_id, book_id, amount_minor, note) VALUES ('twotab-winner', 'twotab', 1, 'synthetic-twotab-winner');
      COMMIT;`);
    await sqlite3.close(conn);
    tabConns.delete(key);
    return { committed: true, revision: fromRevision + 1 };
  },
  async tStale({ key, staleRevision }) {
    const conn = tabConns.get(key);
    if (conn === undefined) throw new Error(`unknown tab connection ${key}`);
    await sqlite3.exec(conn, `UPDATE guard SET revision = ${staleRevision + 1} WHERE book_id = 'twotab' AND revision = ${staleRevision}`);
    const changed = await selectValue(conn, 'SELECT changes()');
    let outcome;
    if (changed === 0) {
      await sqlite3.exec(conn, 'ROLLBACK');
      outcome = 'stale-guard-detected-rollback';
    } else {
      try {
        await sqlite3.exec(conn, 'COMMIT');
        outcome = 'OVERWROTE (unexpected)';
      } catch (error) {
        try {
          await sqlite3.exec(conn, 'ROLLBACK');
        } catch {
          /* already out of tx */
        }
        outcome = `commit-conflict: ${error && error.code !== undefined ? error.code : 'no-code'}`;
      }
    }
    await sqlite3.close(conn);
    tabConns.delete(key);
    return { changed, outcome };
  },
  async tVerify({ name }) {
    // Fresh-handle verification: revision, exactly-one writer row, integrity.
    const db = getDb(name);
    const revision = await selectValue(db, `SELECT revision FROM guard WHERE book_id = 'twotab'`);
    const writerARows = await selectValue(db, `SELECT COUNT(*) FROM ledger WHERE entry_id = 'twotab-writer-A'`);
    const writerBRows = await selectValue(db, `SELECT COUNT(*) FROM ledger WHERE entry_id = 'twotab-writer-B'`);
    const winnerRows = writerARows + writerBRows;
    let integrity = '';
    await sqlite3.exec(db, 'PRAGMA integrity_check', (row) => {
      integrity = row[0];
    });
    return { revision, writerARows, writerBRows, winnerRows, integrity };
  },
  async guarded({ name }) {
    // Sequential two-connection stale-guard dance (no overlapping write
    // txs, so no lock interaction): the loser must detect the conflict via
    // a 0-row guarded write, never overwrite the winner.
    const trace = {};
    const db = getDb(name);
    await sqlite3.exec(db, `INSERT OR REPLACE INTO guard(book_id, revision) VALUES ('race', 7)`);
    const dbB = await sqlite3.open_v2(`${name}.db`);
    try {
      await sqlite3.exec(db, `UPDATE guard SET revision = 8 WHERE book_id = 'race' AND revision = 7;
        INSERT INTO ledger(entry_id, book_id, amount_minor, note) VALUES ('race-winner', 'race', 1, 'synthetic-winner');`);
      trace.winnerCommitted = true;
      await sqlite3.exec(dbB, 'BEGIN IMMEDIATE');
      await sqlite3.exec(dbB, `UPDATE guard SET revision = 8 WHERE book_id = 'race' AND revision = 7`);
      const changed = await selectValue(dbB, 'SELECT changes()');
      trace.bStaleChanges = changed;
      if (changed === 0) {
        await sqlite3.exec(dbB, 'ROLLBACK');
        trace.bOutcome = 'stale-guard-detected-rollback';
      } else {
        await sqlite3.exec(dbB, 'COMMIT');
        trace.bOutcome = 'OVERWROTE (unexpected)';
      }
      trace.finalRevision = await selectValue(db, `SELECT revision FROM guard WHERE book_id = 'race'`);
      trace.winnerRows = await selectValue(db, `SELECT COUNT(*) FROM ledger WHERE entry_id = 'race-winner'`);
      return trace;
    } finally {
      try {
        await sqlite3.close(dbB);
      } catch { /* already closed on failure paths */ }
    }
  },
  async park({ name }) {
    const db = await sqlite3.open_v2(`${name}.db`);
    await sqlite3.exec(db, 'BEGIN IMMEDIATE');
    await sqlite3.exec(
      db,
      `INSERT INTO ledger(entry_id, book_id, amount_minor, note) VALUES ('parked-row', 'park', 1, 'synthetic-parked')`,
    );
    self.postMessage({ parked: true });
    await new Promise(() => {});
    return 'unreachable';
  },
  async checkParked({ name }) {
    const db = getDb(name);
    const parked = await selectValue(db, `SELECT COUNT(*) FROM ledger WHERE entry_id = 'parked-row'`);
    let integrity = '';
    await sqlite3.exec(db, 'PRAGMA integrity_check', (row) => {
      integrity = row[0];
    });
    return { parkedRows: parked, integrity };
  },
  async inject({ name }) {
    // Controlled storage-boundary fault: the next COMMIT-persistence sync
    // (jSync) returns SQLITE_IOERR_FSYNC. If the VFS still commits the
    // batch, that is a measured atomicity failure (leak), not proof of
    // when the hook ran relative to IndexedDB durability. The fault error
    // is captured here; verification runs on a fresh connection after a
    // worker restart (verifyFault), because a faulted handle is never
    // trusted again.
    const db = getDb(name);
    const before = await selectValue(db, 'SELECT COUNT(*) FROM ledger');
    const proto = Object.getPrototypeOf(vfs);
    let fired = 0;
    vfs.jSync = async function () {
      fired += 1;
      vfs.jSync = proto.jSync.bind(vfs);
      vfs.lastError = new Error('p04a-injected-ENOSPC');
      return VFS.SQLITE_IOERR_FSYNC;
    };
    let fault = null;
    try {
      const values = [];
      for (let i = 0; i < 30; i += 1) values.push(`(${esc(`fault-${i}`)},'fault',${100 + i},${esc(`synthetic-fault-${i}`)})`);
      await sqlite3.exec(db, `BEGIN IMMEDIATE; INSERT INTO ledger(entry_id, book_id, amount_minor, note) VALUES ${values.join(',')}; COMMIT;`);
    } catch (error) {
      fault = `${error && error.code !== undefined ? error.code : 'no-code'}:${String(error && error.message ? error.message : error).slice(0, 160)}`;
    }
    let rollbackOutcome = 'not-attempted';
    try {
      await sqlite3.exec(db, 'ROLLBACK');
      rollbackOutcome = 'rollback-ok';
    } catch (error) {
      rollbackOutcome = `rollback-failed: ${String(error && error.message ? error.message : error).slice(0, 120)}`;
    }
    return { kind: 'controlled-injection', method: 'jSync-IOERR_FSYNC', fired, fault, rowsBefore: before, rollbackOutcome };
  },
  async verifyFault({ name }) {
    // Fresh-connection verification after the injected fault and worker
    // restart: proves the failed commit left no partial state behind.
    const db = getDb(name);
    const after = await selectValue(db, 'SELECT COUNT(*) FROM ledger');
    const leaked = await selectValue(db, `SELECT COUNT(*) FROM ledger WHERE entry_id LIKE 'fault-%'`);
    let integrity = '';
    await sqlite3.exec(db, 'PRAGMA integrity_check', (row) => {
      integrity = row[0];
    });
    return { rowsAfter: after, leakedFaultRows: leaked, integrity };
  },
  async close({ name }) {
    await closeDb(name);
    return { closed: true };
  },
};

self.onmessage = async (event) => {
  const { id, op, params } = event.data;
  if (op === 'park') {
    // Parked transactions never resolve; ack separately from RPC.
    OPS.park(params ?? {}).catch(() => {});
    return;
  }
  try {
    const handler = OPS[op];
    if (!handler) throw new Error(`unknown op: ${op}`);
    self.postMessage({ id, ok: true, result: await handler(params ?? {}) });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error && error.stack ? error.stack : error).slice(0, 2000) });
  }
};
