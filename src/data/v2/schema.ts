/**
 * Versioned local schema for the durable v2 guest repository.
 *
 * Schema 1 persists canonical book state, the operation journal, complete
 * immutable outbox envelopes, delivery metadata, the enqueue counter, and
 * content-bound replication checkpoints with applied pulled operations.
 * Unknown versions fail visibly; this module never migrates them.
 */

export const LOCAL_SCHEMA_VERSION = 1;

export const LOCAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS books (
  book_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS journal (
  operation_id TEXT PRIMARY KEY,
  enqueue_sequence INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  operation_id TEXT PRIMARY KEY,
  enqueue_sequence INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS delivery (
  operation_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checkpoints (
  stream_id TEXT PRIMARY KEY,
  cursor TEXT,
  batch_digest TEXT,
  applied_json TEXT NOT NULL
);
`.trim();

export const META_SCHEMA_VERSION = 'schema_version';
export const META_ENQUEUE_SEQUENCE = 'enqueue_sequence';
export const META_BOUND_SCOPE = 'bound_scope';
export const META_BOUND_DEVICE = 'bound_device';

/** SQLite string literal escaping (single quotes doubled). */
export function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function sqlNullableText(value: string | null): string {
  return value === null ? 'NULL' : sqlText(value);
}
