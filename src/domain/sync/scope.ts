/**
 * Identity scope for the storage/sync contract (P03 Task D).
 *
 * The repository handed to `previewCommand`/`executeCommand` is already
 * scoped to exactly one local principal. These types name that boundary so
 * P04 local persistence and P08 account sync implement the same namespace:
 *
 * - a device-local guest identity (`GuestKey` on a `DeviceId`);
 * - an authenticated account identity (`AccountId` on a `DeviceId`);
 * - the identity-scoped local repository namespace (`RepositoryScopeId`);
 * - book and entity IDs, which live *inside* one scope and never cross it;
 * - operation/outbox IDs, used for exact retry and replication.
 *
 * Authorization rules (enforced by types, runtime guards, and the ADR):
 *
 * - `BookId` and every entity ID identify records; none grants
 *   authorization. Finance commands carry no `ownerId`/`accountId` field:
 *   strict validation rejects such fields as unknown input. The cloud
 *   adapter/server derives account ownership from the authenticated session
 *   and stamps it itself. Client-supplied ownership is data to reject, never
 *   authority to trust.
 * - The same raw `BookId` (or entity ID) may exist in isolated guest and
 *   account repositories without collision or accidental lookup: storage is
 *   namespaced by `RepositoryScopeId`, and a lookup in one scope can never
 *   observe another scope's records.
 *
 * Uniqueness rules, frozen here:
 *
 * - An operation ID is unique per identity-scoped repository (the operation
 *   journal is keyed by operation ID inside one scope). The same operation
 *   ID may exist in two scopes as two unrelated intents.
 * - Across account/device boundaries the server keys idempotency on
 *   `(accountId, operationId)` via `serverIdempotencyKeyFor`. A retry from a
 *   second device with the same operation ID and the same canonical payload
 *   replays; with different payload it is an explicit conflict.
 */

import type { OperationId } from '../contracts/identity';

declare const deviceIdBrand: unique symbol;
declare const accountIdBrand: unique symbol;
declare const guestKeyBrand: unique symbol;
declare const repositoryScopeIdBrand: unique symbol;
declare const serverIdempotencyKeyBrand: unique symbol;

export type DeviceId = string & { readonly [deviceIdBrand]: true };
export type AccountId = string & { readonly [accountIdBrand]: true };
export type GuestKey = string & { readonly [guestKeyBrand]: true };
export type RepositoryScopeId = string & { readonly [repositoryScopeIdBrand]: true };
export type ServerIdempotencyKey = string & { readonly [serverIdempotencyKeyBrand]: true };

export type ScopeIdFailure = { readonly reason: 'invalidId'; readonly provided: unknown; readonly detail: string };

export type ScopeIdResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: ScopeIdFailure };

/** Printable ASCII without whitespace. Scope IDs allow composed namespaces up to 240 characters. */
const SCOPE_ID_PATTERN = /^[\x21-\x7e]{1,100}$/;
const COMPOSED_SCOPE_ID_PATTERN = /^[\x21-\x7e]{1,240}$/;

function makeScopedId<T extends string>(value: unknown, pattern: RegExp, what: string): ScopeIdResult<T> {
  if (typeof value !== 'string') {
    return { ok: false, failure: { reason: 'invalidId', provided: value, detail: `${what} must be a string` } };
  }
  if (!pattern.test(value)) {
    return {
      ok: false,
      failure: { reason: 'invalidId', provided: value, detail: `${what} must be printable ASCII without whitespace` },
    };
  }
  return { ok: true, value: value as T };
}

export function makeDeviceId(value: unknown): ScopeIdResult<DeviceId> {
  return makeScopedId<DeviceId>(value, SCOPE_ID_PATTERN, 'device id');
}

export function makeAccountId(value: unknown): ScopeIdResult<AccountId> {
  return makeScopedId<AccountId>(value, SCOPE_ID_PATTERN, 'account id');
}

export function makeGuestKey(value: unknown): ScopeIdResult<GuestKey> {
  return makeScopedId<GuestKey>(value, SCOPE_ID_PATTERN, 'guest key');
}

export function makeRepositoryScopeId(value: unknown): ScopeIdResult<RepositoryScopeId> {
  return makeScopedId<RepositoryScopeId>(value, COMPOSED_SCOPE_ID_PATTERN, 'repository scope id');
}

export function makeServerIdempotencyKey(value: unknown): ScopeIdResult<ServerIdempotencyKey> {
  return makeScopedId<ServerIdempotencyKey>(value, COMPOSED_SCOPE_ID_PATTERN, 'server idempotency key');
}

/**
 * The local principal a repository is scoped to. A guest principal never
 * touches the cloud; an account principal names the authenticated account
 * whose session the server will independently verify.
 */
export type LocalPrincipal =
  | { readonly kind: 'guest'; readonly guestKey: GuestKey; readonly deviceId: DeviceId }
  | { readonly kind: 'account'; readonly accountId: AccountId; readonly deviceId: DeviceId };

/**
 * Injective length-prefixed encoding for composite key components.
 * Components may contain any printable non-whitespace ASCII — including
 * `:` and `/` — because each component is framed as `<length>:<bytes>` and
 * consumed by length, never by scanning for a separator. Distinct tuples
 * therefore never encode to the same key.
 *
 * Wire form: parts joined by `/`, e.g. `5:guest1/8:device-01`.
 */
export function encodeKeyComponents(parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join('/');
}

/**
 * Decodes a length-prefixed component string. Returns null when the input
 * is malformed (bad length, truncation, or trailing garbage), so a forged
 * or corrupt key is rejected rather than guessed.
 */
export function decodeKeyComponents(value: string): readonly string[] | null {
  const parts: string[] = [];
  let rest = value;
  while (rest.length > 0) {
    const colon = rest.indexOf(':');
    if (colon <= 0) return null;
    const lengthText = rest.slice(0, colon);
    if (!/^[0-9]+$/.test(lengthText)) return null;
    const length = Number.parseInt(lengthText, 10);
    if (!Number.isSafeInteger(length)) return null;
    const start = colon + 1;
    const end = start + length;
    if (end > rest.length) return null;
    parts.push(rest.slice(start, end));
    rest = rest.slice(end);
    if (rest.length > 0) {
      if (!rest.startsWith('/')) return null;
      rest = rest.slice(1);
      if (rest.length === 0) return null;
    }
  }
  return parts;
}

/**
 * Derives the storage namespace for one local principal. Guest and account
 * namespaces never overlap, and two devices never share a namespace, so the
 * same raw book/entity IDs in different scopes are unrelated records.
 *
 * The encoding is injective: `scope:guest:<len-prefixed guestKey/deviceId>`
 * can never equal the encoding of a different tuple, even when components
 * contain separator characters.
 */
export function repositoryScopeIdFor(principal: LocalPrincipal): RepositoryScopeId {
  if (principal.kind === 'guest') {
    return `scope:guest:${encodeKeyComponents([principal.guestKey as string, principal.deviceId as string])}` as RepositoryScopeId;
  }
  return `scope:account:${encodeKeyComponents([principal.accountId as string, principal.deviceId as string])}` as RepositoryScopeId;
}

export type ParsedRepositoryScope =
  | { readonly ok: true; readonly kind: 'guest'; readonly guestKey: string; readonly deviceId: string }
  | { readonly ok: true; readonly kind: 'account'; readonly accountId: string; readonly deviceId: string }
  | { readonly ok: false };

/**
 * Parses a scope ID back into its principal tuple. Adapters and the server
 * use this to route storage; finance code must not parse business meaning
 * out of it beyond routing.
 */
export function parseRepositoryScopeId(value: RepositoryScopeId): ParsedRepositoryScope {
  const text = value as string;
  const prefix = text.startsWith('scope:guest:') ? 'scope:guest:' : text.startsWith('scope:account:') ? 'scope:account:' : null;
  if (prefix === null) return { ok: false };
  const parts = decodeKeyComponents(text.slice(prefix.length));
  if (parts === null || parts.length !== 2) return { ok: false };
  if (prefix === 'scope:guest:') {
    return { ok: true, kind: 'guest', guestKey: parts[0] as string, deviceId: parts[1] as string };
  }
  return { ok: true, kind: 'account', accountId: parts[0] as string, deviceId: parts[1] as string };
}

/**
 * The server-side idempotency key across account and device boundaries. The
 * account half comes from the authenticated session, never from a client
 * payload. Length-prefixed framing keeps distinct (account, operation)
 * tuples distinct even when either half contains `:`.
 */
export function serverIdempotencyKeyFor(accountId: AccountId, operationId: OperationId): ServerIdempotencyKey {
  return `idemp:${encodeKeyComponents([accountId as string, operationId as string])}` as ServerIdempotencyKey;
}

export type ParsedServerIdempotencyKey =
  | { readonly ok: true; readonly accountId: string; readonly operationId: string }
  | { readonly ok: false };

/** Parses a server idempotency key back into its (account, operation) tuple. */
export function parseServerIdempotencyKey(value: ServerIdempotencyKey): ParsedServerIdempotencyKey {
  const text = value as string;
  if (!text.startsWith('idemp:')) return { ok: false };
  const parts = decodeKeyComponents(text.slice('idemp:'.length));
  if (parts === null || parts.length !== 2) return { ok: false };
  return { ok: true, accountId: parts[0] as string, operationId: parts[1] as string };
}

/**
 * The execution origin stamped into every operation receipt and outbox
 * intent: which device committed it, inside which scoped repository. The
 * command context carries this; the finance commands themselves carry no
 * ownership fields.
 */
export interface CommandOrigin {
  readonly deviceId: DeviceId;
  readonly scopeId: RepositoryScopeId;
}

export type PrincipalValidation = { readonly ok: true; readonly principal: LocalPrincipal } | { readonly ok: false; readonly issues: readonly string[] };

/** Runtime guard for principal descriptors received at adapter boundaries. */
export function validateLocalPrincipal(value: unknown): PrincipalValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, issues: ['principal must be an object'] };
  }
  const record = value as Record<string, unknown>;
  if (record['kind'] === 'guest') {
    const guestKey = makeGuestKey(record['guestKey']);
    const deviceId = makeDeviceId(record['deviceId']);
    const issues: string[] = [];
    if (!guestKey.ok) issues.push(`guestKey: ${guestKey.failure.detail}`);
    if (!deviceId.ok) issues.push(`deviceId: ${deviceId.failure.detail}`);
    if (issues.length > 0) return { ok: false, issues };
    if (!guestKey.ok || !deviceId.ok) return { ok: false, issues: ['unreachable'] };
    return { ok: true, principal: { kind: 'guest', guestKey: guestKey.value, deviceId: deviceId.value } };
  }
  if (record['kind'] === 'account') {
    const accountId = makeAccountId(record['accountId']);
    const deviceId = makeDeviceId(record['deviceId']);
    const issues: string[] = [];
    if (!accountId.ok) issues.push(`accountId: ${accountId.failure.detail}`);
    if (!deviceId.ok) issues.push(`deviceId: ${deviceId.failure.detail}`);
    if (issues.length > 0) return { ok: false, issues };
    if (!accountId.ok || !deviceId.ok) return { ok: false, issues: ['unreachable'] };
    return { ok: true, principal: { kind: 'account', accountId: accountId.value, deviceId: deviceId.value } };
  }
  return { ok: false, issues: ['kind must be guest or account'] };
}
