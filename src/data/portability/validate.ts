/**
 * Validate a versioned portable document before any active-state change.
 *
 * Integrity is recomputed only after typed record decoding succeeds. A matching
 * digest never substitutes for schema, reference, or provenance checks.
 */

import { stableDigest } from '../../domain/contracts/canonical';
import { validateRepositorySnapshotGraph } from '../../domain/contracts/repository-snapshot-validation';
import { isRepresentableInstantMs } from '../../domain/primitives/instant';
import { makeDeviceId, makeRepositoryScopeId } from '../../domain/sync/scope';
import { PORTABILITY_REASON, type PortabilityReasonCode } from '../migration/reasons';
import { isCanonicalSourceFingerprint } from '../migration/extract';
import {
  MAX_PORTABLE_BYTES,
  PORTABLE_FORMAT,
  PORTABLE_FORMAT_VERSION,
  portableByteLength,
  portableDocumentDigest,
  type PortableDocument,
  type PortableScope,
} from './format';
import {
  decodePortableCheckpoints,
  decodePortableSnapshot,
  type DecodedCheckpoints,
  type DecodedPortableSnapshot,
} from './decode';

const DOCUMENT_KEYS = [
  'format',
  'formatVersion',
  'localSchemaVersion',
  'currency',
  'exportedAtMs',
  'scope',
  'snapshotCanonical',
  'checkpointCanonical',
  'sourceFingerprint',
  'migrationId',
  'integrity',
] as const;

const SCOPE_KEYS = ['scopeId', 'deviceId', 'storageId'] as const;
const STORAGE_ID_PATTERN = /^[\x21-\x7e]{1,100}$/;
const MIGRATION_ID_PATTERN = /^[\x21-\x7e]{1,100}$/;

export interface PortablePreview {
  readonly bookCount: number;
  readonly operationCount: number;
  readonly outboxCount: number;
  readonly deliveryCount: number;
  readonly enqueueSequence: number;
  readonly currency: 'SAR';
  readonly scopeId: string;
  readonly storageId: string;
}

export type PortableValidation =
  | {
      readonly ok: true;
      readonly document: PortableDocument;
      readonly preview: PortablePreview;
      readonly snapshot: DecodedPortableSnapshot;
      readonly checkpoints: DecodedCheckpoints;
      readonly documentDigest: string;
    }
  | { readonly ok: false; readonly reason: PortabilityReasonCode; readonly detail: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function fail(reason: PortabilityReasonCode, detail: string): PortableValidation {
  return { ok: false, reason, detail };
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): PortableValidation | null {
  const expected = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) return fail(PORTABILITY_REASON.malformedRecord, `${label} has unknown field ${key}`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      return fail(PORTABILITY_REASON.malformedRecord, `${label} is missing required field ${key}`);
    }
  }
  return null;
}

function decodeBoundScope(raw: unknown): PortableScope | PortableValidation {
  const scope = asRecord(raw);
  if (scope === null) return fail(PORTABILITY_REASON.corruptPayload, 'scope identity is missing');
  const keys = exactKeys(scope, SCOPE_KEYS, 'scope');
  if (keys !== null) return keys;
  const scopeId = makeRepositoryScopeId(scope['scopeId']);
  if (!scopeId.ok) {
    return fail(PORTABILITY_REASON.invalidReference, `scope.scopeId is not a canonical repository scope: ${scopeId.failure.detail}`);
  }
  const deviceId = makeDeviceId(scope['deviceId']);
  if (!deviceId.ok) {
    return fail(PORTABILITY_REASON.invalidReference, `scope.deviceId is not a canonical device id: ${deviceId.failure.detail}`);
  }
  if (typeof scope['storageId'] !== 'string' || !STORAGE_ID_PATTERN.test(scope['storageId'])) {
    return fail(PORTABILITY_REASON.invalidReference, 'scope.storageId is not a canonical storage id');
  }
  return { scopeId: scopeId.value as string, deviceId: deviceId.value as string, storageId: scope['storageId'] };
}

function decodeProvenance(
  fingerprint: unknown,
  migrationId: unknown,
): { sourceFingerprint: string | null; migrationId: string | null } | PortableValidation {
  if (fingerprint !== null && !isCanonicalSourceFingerprint(fingerprint)) {
    return fail(PORTABILITY_REASON.malformedRecord, 'sourceFingerprint must be null or the canonical migration digest');
  }
  if (migrationId !== null && (typeof migrationId !== 'string' || !MIGRATION_ID_PATTERN.test(migrationId))) {
    return fail(PORTABILITY_REASON.malformedRecord, 'migrationId must be null or a canonical identity');
  }
  const digest = fingerprint === null ? null : fingerprint;
  const id = migrationId === null ? null : migrationId;
  if ((digest === null) !== (id === null)) {
    return fail(PORTABILITY_REASON.malformedRecord, 'sourceFingerprint and migrationId must both be present or both be null');
  }
  return { sourceFingerprint: digest, migrationId: id };
}

export function parsePortableDocument(raw: unknown): PortableValidation {
  if (typeof raw === 'string') {
    if (raw.length > MAX_PORTABLE_BYTES) return fail(PORTABILITY_REASON.oversizedPayload, 'document exceeds the portable size limit');
    if (raw.length === 0) return fail(PORTABILITY_REASON.truncatedPayload, 'document is empty');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      if (!raw.trim().endsWith('}')) return fail(PORTABILITY_REASON.truncatedPayload, 'document JSON is truncated');
      return fail(PORTABILITY_REASON.corruptPayload, 'document JSON is not parseable');
    }
    return parsePortableDocument(parsed);
  }
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.corruptPayload, 'document is not an object');
  const keys = exactKeys(record, DOCUMENT_KEYS, 'portable document');
  if (keys !== null) return keys;
  if (record['format'] !== PORTABLE_FORMAT) return fail(PORTABILITY_REASON.unknownFormat, 'format is not rushd.portable.v1');
  if (record['formatVersion'] !== PORTABLE_FORMAT_VERSION) return fail(PORTABILITY_REASON.incompatibleVersion, 'portable format version is unsupported');
  if (record['localSchemaVersion'] !== 1) return fail(PORTABILITY_REASON.incompatibleVersion, 'local schema version is unsupported');
  if (record['currency'] !== 'SAR') return fail(PORTABILITY_REASON.wrongCurrency, 'portable currency is not SAR');
  if (!isRepresentableInstantMs(record['exportedAtMs'])) {
    return fail(PORTABILITY_REASON.malformedRecord, 'exportedAtMs is outside the representable instant range');
  }
  if (typeof record['snapshotCanonical'] !== 'string' || typeof record['checkpointCanonical'] !== 'string') {
    return fail(PORTABILITY_REASON.corruptPayload, 'canonical snapshot fields are missing');
  }
  if (portableByteLength(record as unknown as PortableDocument) > MAX_PORTABLE_BYTES) {
    return fail(PORTABILITY_REASON.oversizedPayload, 'document exceeds the portable size limit');
  }
  const bound = decodeBoundScope(record['scope']);
  if ('ok' in bound && bound.ok === false) return bound;
  const scope = bound as PortableScope;
  const provenance = decodeProvenance(record['sourceFingerprint'], record['migrationId']);
  if ('ok' in provenance && provenance.ok === false) return provenance;
  const meta = provenance as { sourceFingerprint: string | null; migrationId: string | null };
  let snapshotJson: unknown;
  try {
    snapshotJson = JSON.parse(record['snapshotCanonical']);
  } catch {
    return fail(PORTABILITY_REASON.corruptPayload, 'snapshotCanonical is not JSON');
  }
  const decodedSnapshot = decodePortableSnapshot(snapshotJson, scope);
  if (!decodedSnapshot.ok) return decodedSnapshot;
  let checkpointJson: unknown;
  try {
    checkpointJson = JSON.parse(record['checkpointCanonical']);
  } catch {
    return fail(PORTABILITY_REASON.corruptPayload, 'checkpointCanonical is not JSON');
  }
  const bookIds = new Set(decodedSnapshot.snapshot.books.map((book) => book.book.id as string));
  const decodedCheckpoints = decodePortableCheckpoints(checkpointJson, scope, bookIds);
  if (!decodedCheckpoints.ok) return decodedCheckpoints;
  const graph = validateRepositorySnapshotGraph({
    books: decodedSnapshot.snapshot.books,
    operations: decodedSnapshot.snapshot.operations,
    outbox: decodedSnapshot.snapshot.outbox,
    delivery: decodedSnapshot.snapshot.delivery,
    enqueueSequence: decodedSnapshot.snapshot.enqueueSequence,
    localDeviceId: scope.deviceId,
    checkpoints: decodedCheckpoints.checkpoints,
    exportedAtMs: record['exportedAtMs'],
  });
  if (!graph.ok) return fail(graph.issue.reason, graph.issue.detail);
  const expectedIntegrity = stableDigest(`${record['snapshotCanonical']}\n${record['checkpointCanonical']}`);
  if (typeof record['integrity'] !== 'string' || record['integrity'] !== expectedIntegrity) {
    return fail(PORTABILITY_REASON.tamperedPayload, 'integrity digest does not match canonical payload');
  }
  const document: PortableDocument = {
    format: PORTABLE_FORMAT,
    formatVersion: PORTABLE_FORMAT_VERSION,
    localSchemaVersion: 1,
    currency: 'SAR',
    exportedAtMs: record['exportedAtMs'],
    scope,
    snapshotCanonical: record['snapshotCanonical'],
    checkpointCanonical: record['checkpointCanonical'],
    sourceFingerprint: meta.sourceFingerprint,
    migrationId: meta.migrationId,
    integrity: record['integrity'],
  };
  return {
    ok: true,
    document,
    snapshot: decodedSnapshot.snapshot,
    checkpoints: decodedCheckpoints.checkpoints,
    documentDigest: portableDocumentDigest(document),
    preview: {
      bookCount: decodedSnapshot.snapshot.books.length,
      operationCount: decodedSnapshot.snapshot.operations.length,
      outboxCount: decodedSnapshot.snapshot.outbox.length,
      deliveryCount: decodedSnapshot.snapshot.delivery.length,
      enqueueSequence: decodedSnapshot.snapshot.enqueueSequence,
      currency: 'SAR',
      scopeId: document.scope.scopeId,
      storageId: document.scope.storageId,
    },
  };
}
