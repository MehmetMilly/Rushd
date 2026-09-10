/**
 * Versioned offline portable document for the accepted v2 guest repository.
 *
 * Format `rushd.portable.v1` carries schema/version, scope identity,
 * canonical snapshot bytes, checkpoints, and migration evidence. It never
 * includes secrets or cloud/account claims. `sourceFingerprint` is a digest,
 * never raw financial records.
 */

import { canonicalJson, stableDigest } from '../../domain/contracts/canonical';

export const PORTABLE_FORMAT = 'rushd.portable.v1';
export const PORTABLE_FORMAT_VERSION = 1;
export const MAX_PORTABLE_BYTES = 8_000_000;
export const REPLACE_ACTIVE_CONFIRMATION = 'REPLACE-ACTIVE-DATABASE';
export const RESET_SCOPE_CONFIRMATION = 'RESET-GUEST-SCOPE';

export interface PortableScope {
  readonly scopeId: string;
  readonly deviceId: string;
  readonly storageId: string;
}

export interface PortableDocument {
  readonly format: typeof PORTABLE_FORMAT;
  readonly formatVersion: typeof PORTABLE_FORMAT_VERSION;
  readonly localSchemaVersion: 1;
  readonly currency: 'SAR';
  readonly exportedAtMs: number;
  readonly scope: PortableScope;
  readonly snapshotCanonical: string;
  readonly checkpointCanonical: string;
  readonly sourceFingerprint: string | null;
  readonly migrationId: string | null;
  readonly integrity: string;
}

export function portableByteLength(document: PortableDocument | string): number {
  return (typeof document === 'string' ? document : JSON.stringify(document)).length;
}

export function portableDocumentDigest(document: Pick<
  PortableDocument,
  'format' | 'formatVersion' | 'localSchemaVersion' | 'currency' | 'scope' | 'snapshotCanonical' | 'checkpointCanonical' | 'sourceFingerprint' | 'migrationId'
>): string {
  return stableDigest(
    canonicalJson({
      checkpointCanonical: document.checkpointCanonical,
      currency: document.currency,
      format: document.format,
      formatVersion: document.formatVersion,
      localSchemaVersion: document.localSchemaVersion,
      migrationId: document.migrationId,
      scope: document.scope,
      snapshotCanonical: document.snapshotCanonical,
      sourceFingerprint: document.sourceFingerprint,
    }),
  );
}
