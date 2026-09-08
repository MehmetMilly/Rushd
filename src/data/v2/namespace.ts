/**
 * Per-identity OPFS database namespace.
 *
 * A guest scope is derived from the P03 guest key plus device identity.
 * The handle binds that scope; the filename is a stable hash so raw IDs
 * in distinct scopes never share a database file.
 */

import type { DeviceId, RepositoryScopeId } from '../../domain/sync/scope';

const NAMESPACE_PREFIX = 'rushd-v2';

function fnv1aHex(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** OPFS VFS / database stem for one immutable scope binding. */
export function databaseNamespaceFor(scope: RepositoryScopeId, device: DeviceId, storageId?: string): string {
  const key =
    storageId === undefined ? `${scope as string}\n${device as string}` : `${scope as string}\n${device as string}\n${storageId}`;
  return `${NAMESPACE_PREFIX}-${fnv1aHex(key)}`;
}

export function writeLockNameFor(namespace: string): string {
  return `${NAMESPACE_PREFIX}-write:${namespace}`;
}

export function invalidateChannelNameFor(namespace: string): string {
  return `${NAMESPACE_PREFIX}-invalidate:${namespace}`;
}

export function isRushdV2Namespace(name: string): boolean {
  return name.startsWith(`${NAMESPACE_PREFIX}-`);
}
