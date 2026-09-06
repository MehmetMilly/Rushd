/**
 * Deterministic command context for tests.
 *
 * The clock returns a fixed base instant and advances by a fixed step on each
 * call, and IDs are sequential per prefix, so every run is reproducible and
 * no ambient global is read.
 *
 * Every context carries an explicit commit origin (device + identity-scoped
 * repository) stamped into receipts, the operation journal, and outbox
 * intents. The default origin is a fixed guest scope on a fixed test
 * device; harnesses that need isolation pass a different `deviceId`,
 * `scopeId`, or `accountId`.
 */

import type { CommandContext, DomainClock, DomainIdFactory } from '../../../src/application/commands/context';
import {
  makeAccountId,
  makeDeviceId,
  makeGuestKey,
  makeRepositoryScopeId,
  repositoryScopeIdFor,
  type DeviceId,
  type RepositoryScopeId,
} from '../../../src/domain/sync/scope';

export const DEFAULT_BASE_INSTANT_MS = Date.UTC(2026, 8, 5, 12, 0, 0); // 2026-09-05T12:00:00Z
export const DEFAULT_STEP_MS = 1_000;
export const DEFAULT_CALCULATION_VERSION = 'p03-task-a-1';
export const DEFAULT_DEVICE_ID = 'test-device-0001';
export const DEFAULT_GUEST_KEY = 'test-guest';

export interface DeterministicContextOptions {
  readonly baseInstantMs?: number;
  readonly stepMs?: number;
  readonly calculationVersion?: string;
  /** Device stamped as the commit origin; defaults to a fixed test device. */
  readonly deviceId?: string;
  /**
   * Scope stamped as the commit origin. When omitted, the scope is derived
   * from the effective device id: the account scope when `accountId` is set,
   * otherwise the default guest scope.
   */
  readonly scopeId?: string;
  /** Account id for account-scoped harnesses. */
  readonly accountId?: string;
}

export interface DeterministicContext {
  readonly context: CommandContext;
  /** The instant the next clock call will return. */
  nextInstantMs(): number;
}

export function createDeterministicContext(options: DeterministicContextOptions = {}): DeterministicContext {
  const base = options.baseInstantMs ?? DEFAULT_BASE_INSTANT_MS;
  const step = options.stepMs ?? DEFAULT_STEP_MS;
  const calculationVersion = options.calculationVersion ?? DEFAULT_CALCULATION_VERSION;

  let current = base;
  const clock: DomainClock = {
    nowMs: () => {
      const value = current;
      current += step;
      return value;
    },
  };
  const counters = new Map<string, number>();
  const ids: DomainIdFactory = {
    newId: (prefix: string) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}-${String(next).padStart(4, '0')}`;
    },
  };

  const deviceMade = makeDeviceId(options.deviceId ?? DEFAULT_DEVICE_ID);
  if (!deviceMade.ok) throw new Error(`invalid deterministic test device id: ${deviceMade.failure.detail}`);
  const deviceId: DeviceId = deviceMade.value;
  let scopeId: RepositoryScopeId;
  if (options.scopeId !== undefined) {
    const scopeMade = makeRepositoryScopeId(options.scopeId);
    if (!scopeMade.ok) throw new Error(`invalid deterministic test scope id: ${scopeMade.failure.detail}`);
    scopeId = scopeMade.value;
  } else if (options.accountId !== undefined) {
    const accountMade = makeAccountId(options.accountId);
    if (!accountMade.ok) throw new Error(`invalid deterministic test account id: ${accountMade.failure.detail}`);
    scopeId = repositoryScopeIdFor({ kind: 'account', accountId: accountMade.value, deviceId });
  } else {
    const guestMade = makeGuestKey(DEFAULT_GUEST_KEY);
    if (!guestMade.ok) throw new Error(`invalid deterministic test guest key: ${guestMade.failure.detail}`);
    scopeId = repositoryScopeIdFor({ kind: 'guest', guestKey: guestMade.value, deviceId });
  }

  return {
    context: { clock, ids, calculationVersion, origin: { deviceId, scopeId } },
    nextInstantMs: () => current,
  };
}
