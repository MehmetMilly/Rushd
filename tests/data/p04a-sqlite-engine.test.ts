/**
 * P04 Task A pinned-engine proof.
 *
 * Records the exact pinned SQLite engine (package, version, SQLite lib
 * version, source ID) and proves, against that engine, the SQL-level commit
 * shape Task B will use: BEGIN IMMEDIATE, a multi-table delta (book row +
 * operation row + outbox row sharing one durable sequence), COMMIT, and a
 * mid-transaction failure that rolls everything back with the prior rows
 * intact.
 *
 * Node runs this engine in-memory only (documented upstream scope); OPFS is
 * absent here by design and is covered by the Chromium experiment plus the
 * provisional per-platform matrix, not by this file.
 */
import { describe, expect, it } from 'vitest';
import sqlite3Init from '@sqlite.org/sqlite-wasm';
import { PINNED_ENGINE } from '../../src/data/experiments/candidates';

describe('p04a pinned sqlite engine', () => {
  it('loads the pinned engine build', async () => {
    const sqlite3 = await sqlite3Init();
    expect(sqlite3.version.libVersion).toBe(PINNED_ENGINE.sqliteVersion);
    expect(sqlite3.version.sourceId).toBe(PINNED_ENGINE.sqliteSourceId);
    expect(sqlite3.capi.sqlite3_vfs_find('opfs')).toBe(0);
  });

  it('commits a book+operation+outbox delta atomically and rolls back a mid-transaction failure', async () => {
    const sqlite3 = await sqlite3Init();
    const db = new sqlite3.oo1.DB(':memory:');
    try {
      db.exec('CREATE TABLE book(book_id TEXT PRIMARY KEY, revision INTEGER NOT NULL)');
      db.exec('CREATE TABLE operations(operation_id TEXT PRIMARY KEY, enqueue_sequence INTEGER NOT NULL)');
      db.exec('CREATE TABLE outbox(operation_id TEXT PRIMARY KEY, enqueue_sequence INTEGER NOT NULL)');

      db.exec("BEGIN IMMEDIATE; INSERT INTO book VALUES ('b1', 2); INSERT INTO operations VALUES ('op-1', 1); INSERT INTO outbox VALUES ('op-1', 1); COMMIT;");
      expect(db.selectValue('SELECT revision FROM book WHERE book_id = ?', ['b1'])).toBe(2);
      expect(db.selectValue('SELECT COUNT(*) FROM outbox')).toBe(1);

      const before = {
        revision: db.selectValue('SELECT revision FROM book WHERE book_id = ?', ['b1']),
        operations: db.selectValue('SELECT COUNT(*) FROM operations'),
        outbox: db.selectValue('SELECT COUNT(*) FROM outbox'),
      };
      expect(() =>
        db.exec(
          "BEGIN IMMEDIATE; UPDATE book SET revision = 3 WHERE book_id = 'b1'; INSERT INTO operations VALUES ('op-2', 2); INSERT INTO outbox VALUES ('op-1', 2); COMMIT;",
        ),
      ).toThrow();
      db.exec('ROLLBACK;');
      // The failed delta left every table exactly as before: no partial
      // book bump, no orphaned operation row.
      expect(db.selectValue('SELECT revision FROM book WHERE book_id = ?', ['b1'])).toBe(before.revision);
      expect(db.selectValue('SELECT COUNT(*) FROM operations')).toBe(before.operations);
      expect(db.selectValue('SELECT COUNT(*) FROM outbox')).toBe(before.outbox);
    } finally {
      db.close();
    }
  });
});
