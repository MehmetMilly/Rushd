/**
 * P04-B schema and namespace unit checks (Node). Durable OPFS behavior is
 * exercised by `tests/data/p04b-persistence.mjs` in Chromium.
 */
import { describe, expect, it } from 'vitest';
import { databaseNamespaceFor, isRushdV2Namespace } from '../../src/data/v2/namespace';
import { LOCAL_SCHEMA_SQL, LOCAL_SCHEMA_VERSION, sqlText } from '../../src/data/v2/schema';
import { SQLITE_ENGINE_VERSION } from '../../src/data/v2/protocol';
import { makeAccountId, makeDeviceId, makeGuestKey, repositoryScopeIdFor } from '../../src/domain/sync/scope';
import { DEFAULT_GUEST_KEY } from '../domain/support/deterministic-context';

describe('p04b schema and namespace', () => {
  it('pins schema 1 and the accepted sqlite engine identity', () => {
    expect(LOCAL_SCHEMA_VERSION).toBe(1);
    expect(SQLITE_ENGINE_VERSION).toBe('3.53.0');
    expect(LOCAL_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS books');
    expect(LOCAL_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS journal');
    expect(LOCAL_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS outbox');
    expect(LOCAL_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS delivery');
    expect(LOCAL_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS checkpoints');
    expect(LOCAL_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS meta');
  });

  it('isolates guest and account scopes and distinct devices', () => {
    const deviceA = makeDeviceId('test-device-0001');
    const deviceB = makeDeviceId('test-device-0002');
    const guest = makeGuestKey(DEFAULT_GUEST_KEY);
    const account = makeAccountId('acct-p04b');
    if (!deviceA.ok || !deviceB.ok || !guest.ok || !account.ok) throw new Error('invalid test ids');
    const guestA = repositoryScopeIdFor({ kind: 'guest', guestKey: guest.value, deviceId: deviceA.value });
    const guestB = repositoryScopeIdFor({ kind: 'guest', guestKey: guest.value, deviceId: deviceB.value });
    const accountA = repositoryScopeIdFor({ kind: 'account', accountId: account.value, deviceId: deviceA.value });
    const nsGuestA = databaseNamespaceFor(guestA, deviceA.value);
    const nsGuestB = databaseNamespaceFor(guestB, deviceB.value);
    const nsGuestA2 = databaseNamespaceFor(guestA, deviceA.value, 'instance-2');
    expect(isRushdV2Namespace(nsGuestA)).toBe(true);
    expect(nsGuestA).not.toBe(nsGuestB);
    expect(nsGuestA).not.toBe(nsGuestA2);
    expect(nsGuestA).not.toBe(databaseNamespaceFor(accountA, deviceA.value));
    expect(sqlText("o'clock")).toBe("'o''clock'");
  });
});
