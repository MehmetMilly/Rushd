/**
 * Read-only extraction of immutable `MicroSaveOS_DB` v1 input.
 *
 * Extraction never mutates, deletes, renames, or replaces the source. Each
 * captured record keeps database/object/record identity and the original
 * raw value for conversion evidence.
 */

import { canonicalJson, stableDigest } from '../../domain/contracts/canonical';
import { LEGACY_V1_DATABASE } from '../legacy-v1/contracts';
import { MIGRATION_REASON, type MigrationReasonCode } from './reasons';

export const LEGACY_SOURCE_DATABASE = LEGACY_V1_DATABASE.name;
export const LEGACY_SOURCE_VERSION = LEGACY_V1_DATABASE.version;

export interface ExtractedSetting {
  readonly key: string;
  readonly value: unknown;
}

export interface ExtractedRecord {
  readonly store: 'templates' | 'expenses';
  readonly id: string | null;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface ExtractedLegacySnapshot {
  readonly database: typeof LEGACY_SOURCE_DATABASE;
  readonly databaseVersion: typeof LEGACY_SOURCE_VERSION;
  readonly settings: readonly ExtractedSetting[];
  readonly templates: readonly ExtractedRecord[];
  readonly expenses: readonly ExtractedRecord[];
  readonly sourcePresent: boolean;
}

export interface ExtractionFailure {
  readonly ok: false;
  readonly reason: MigrationReasonCode;
  readonly detail: string;
}

export type ExtractionResult =
  | { readonly ok: true; readonly snapshot: ExtractedLegacySnapshot }
  | ExtractionFailure;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cloneRaw(value: unknown): unknown {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fall through to a special-preserving JSON-safe clone */
    }
  }
  return jsonSafeSource(value);
}

/**
 * Canonical JSON-safe form that preserves special numeric values so
 * quarantine decisions stay deterministic. This encoding is digest input
 * only; it is never stored or exported as lifecycle metadata.
 */
export function jsonSafeSource(value: unknown): unknown {
  if (value === undefined) return { $u: true };
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { $n: 'NaN' };
    if (value === Infinity) return { $n: 'Infinity' };
    if (value === -Infinity) return { $n: '-Infinity' };
    if (Object.is(value, -0)) return { $n: '-0' };
    if (!Number.isSafeInteger(value)) return { $n: String(value) };
    return value;
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return { $t: typeof value, $v: String(value) };
  }
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((entry) => jsonSafeSource(entry));
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      output[key] = jsonSafeSource((value as Record<string, unknown>)[key]);
    }
    return output;
  }
  return value;
}

export function settingValue(snapshot: ExtractedLegacySnapshot, key: string): unknown {
  const found = snapshot.settings.find((entry) => entry.key === key);
  return found === undefined ? undefined : found.value;
}

export function snapshotFromStores(input: {
  readonly settings?: readonly unknown[];
  readonly templates?: readonly unknown[];
  readonly expenses?: readonly unknown[];
  readonly sourcePresent?: boolean;
}): ExtractedLegacySnapshot {
  const settings: ExtractedSetting[] = [];
  for (const entry of input.settings ?? []) {
    const record = asRecord(entry);
    if (record === null) continue;
    const key = typeof record['key'] === 'string' ? record['key'] : '';
    settings.push({ key, value: cloneRaw(record['value']) });
  }
  const templates = cloneStoreRecords('templates', input.templates ?? []);
  const expenses = cloneStoreRecords('expenses', input.expenses ?? []);
  return {
    database: LEGACY_SOURCE_DATABASE,
    databaseVersion: LEGACY_SOURCE_VERSION,
    settings,
    templates,
    expenses,
    sourcePresent: input.sourcePresent !== false,
  };
}

function cloneStoreRecords(store: 'templates' | 'expenses', rows: readonly unknown[]): ExtractedRecord[] {
  return rows.map((row) => {
    const record = asRecord(row);
    if (record === null) {
      return { store, id: null, raw: Object.freeze({ malformed: cloneRaw(row) }) };
    }
    const id = typeof record['id'] === 'string' && record['id'].length > 0 ? record['id'] : null;
    return { store, id, raw: Object.freeze(cloneRaw(record) as Record<string, unknown>) };
  });
}

export function snapshotFromP00Fixture(fixture: unknown): ExtractionResult {
  const root = asRecord(fixture);
  if (root === null) {
    return { ok: false, reason: MIGRATION_REASON.malformedRecord, detail: 'fixture is not an object' };
  }
  const indexed = asRecord(root['indexed_db']);
  if (indexed === null) {
    return { ok: false, reason: MIGRATION_REASON.malformedRecord, detail: 'fixture indexed_db is missing' };
  }
  const name = indexed['name'];
  if (name !== LEGACY_SOURCE_DATABASE) {
    return { ok: false, reason: MIGRATION_REASON.conflictingSource, detail: 'fixture database name is not MicroSaveOS_DB' };
  }
  const stores = asRecord(indexed['stores']);
  if (stores === null) {
    return { ok: false, reason: MIGRATION_REASON.malformedRecord, detail: 'fixture stores are missing' };
  }
  return {
    ok: true,
    snapshot: snapshotFromStores({
      settings: Array.isArray(stores['settings']) ? stores['settings'] : [],
      templates: Array.isArray(stores['templates']) ? stores['templates'] : [],
      expenses: Array.isArray(stores['expenses']) ? stores['expenses'] : [],
      sourcePresent: true,
    }),
  };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'));
  });
}

/**
 * Open `MicroSaveOS_DB` read-only and copy every store. The source version
 * is not upgraded. Missing source is an empty-but-present-false snapshot.
 */
function classifyOpenOrDiscoveryError(error: unknown, fallback: string): ExtractionFailure {
  const marked = error as { name?: string };
  const message = error instanceof Error ? error.message : fallback;
  const quota =
    marked?.name === 'QuotaExceededError' ||
    marked?.name === 'SecurityError' ||
    /quota|permission|private/i.test(String(message));
  return {
    ok: false,
    reason: quota ? MIGRATION_REASON.quotaOrPrivate : MIGRATION_REASON.extractionFailure,
    detail: message,
  };
}

export async function extractLegacyIndexedDb(factory: IDBFactory = indexedDB): Promise<ExtractionResult> {
  let databases: IDBDatabaseInfo[] = [];
  try {
    if (factory.databases !== undefined) {
      databases = await factory.databases();
    }
  } catch (error) {
    return classifyOpenOrDiscoveryError(error, 'failed to discover IndexedDB databases');
  }
  const listed = databases.find((entry) => entry.name === LEGACY_SOURCE_DATABASE);
  if (listed === undefined && databases.length > 0) {
    return {
      ok: true,
      snapshot: snapshotFromStores({ settings: [], templates: [], expenses: [], sourcePresent: false }),
    };
  }

  let db: IDBDatabase;
  try {
    db = await new Promise((resolve, reject) => {
      const request = factory.open(LEGACY_SOURCE_DATABASE);
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(Object.assign(new Error('legacy source is absent'), { absent: true as const }));
      };
      request.onblocked = () => reject(Object.assign(new Error('legacy source is blocked'), { blocked: true as const }));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('failed to open MicroSaveOS_DB'));
    });
  } catch (error) {
    const marked = error as { absent?: boolean; blocked?: boolean; name?: string };
    if (marked?.absent === true) {
      return {
        ok: true,
        snapshot: snapshotFromStores({ settings: [], templates: [], expenses: [], sourcePresent: false }),
      };
    }
    return classifyOpenOrDiscoveryError(error, 'failed to open MicroSaveOS_DB');
  }

  try {
    if (db.version !== LEGACY_SOURCE_VERSION) {
      return {
        ok: false,
        reason: MIGRATION_REASON.extractionFailure,
        detail: `legacy database version ${db.version} is not ${LEGACY_SOURCE_VERSION}`,
      };
    }
    const storeNames = ['settings', 'templates', 'expenses'] as const;
    const present = storeNames.filter((name) => db.objectStoreNames.contains(name));
    if (present.length === 0) {
      return {
        ok: true,
        snapshot: snapshotFromStores({ settings: [], templates: [], expenses: [], sourcePresent: true }),
      };
    }
    const tx = db.transaction([...present], 'readonly');
    const settings = present.includes('settings') ? await requestToPromise(tx.objectStore('settings').getAll()) : [];
    const templates = present.includes('templates') ? await requestToPromise(tx.objectStore('templates').getAll()) : [];
    const expenses = present.includes('expenses') ? await requestToPromise(tx.objectStore('expenses').getAll()) : [];
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('readonly extraction transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('readonly extraction transaction aborted'));
    });
    return {
      ok: true,
      snapshot: snapshotFromStores({ settings, templates, expenses, sourcePresent: true }),
    };
  } catch (error) {
    return {
      ok: false,
      reason: MIGRATION_REASON.extractionFailure,
      detail: error instanceof Error ? error.message : 'extraction failed',
    };
  } finally {
    db.close();
  }
}

export const SOURCE_FINGERPRINT_PATTERN = /^[0-9a-f]{16}$/;

export function isCanonicalSourceFingerprint(value: unknown): value is string {
  return typeof value === 'string' && SOURCE_FINGERPRINT_PATTERN.test(value);
}

export function sourceFingerprintOf(snapshot: ExtractedLegacySnapshot): string {
  return stableDigest(
    canonicalJson({
      database: snapshot.database,
      databaseVersion: snapshot.databaseVersion,
      expenses: jsonSafeSource(snapshot.expenses.map((row) => row.raw)),
      settings: jsonSafeSource(snapshot.settings),
      sourcePresent: snapshot.sourcePresent,
      templates: jsonSafeSource(snapshot.templates.map((row) => row.raw)),
    }),
  );
}
