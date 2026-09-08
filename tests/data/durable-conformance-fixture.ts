/**
 * Persistent P03 conformance fixture for the durable OPFS guest adapter.
 *
 * Each `createAdapter` opens a real browser-backed repository with a unique
 * physical storage id so tests start empty. `reopen` reuses that id and the
 * same immutable scope/device binding. The in-memory fixture is unchanged.
 */
/* eslint-env browser */

import { openDurableGuestRepository } from '../../src/data/v2/session';
import { DurableCheckpointStore } from '../../src/data/v2/checkpoint-store';
import type { DurableGuestRepository } from '../../src/data/v2/repository';
import type { DeviceId, RepositoryScopeId } from '../../src/domain/sync/scope';
import { makeAccountId, makeDeviceId, makeGuestKey, makeRepositoryScopeId, repositoryScopeIdFor } from '../../src/domain/sync/scope';
import { DEFAULT_GUEST_KEY } from '../domain/support/deterministic-context';
import type { ConformanceFixture, ConformanceScopeSpec } from '../domain/support/repository-conformance';

export interface DurableFixtureOptions {
  readonly workerUrl: string;
  readonly sqliteAssetBase: string;
}

function bindingFor(spec?: ConformanceScopeSpec): { boundScope: RepositoryScopeId; boundDevice: DeviceId } {
  const effective: ConformanceScopeSpec = spec ?? { deviceId: 'test-device-0001' };
  const device = makeDeviceId(effective.deviceId);
  if (!device.ok) throw new Error(`invalid durable fixture device id: ${effective.deviceId}`);
  if (effective.scopeId !== undefined) {
    const scope = makeRepositoryScopeId(effective.scopeId);
    if (!scope.ok) throw new Error(`invalid durable fixture scope id: ${effective.scopeId}`);
    return { boundScope: scope.value, boundDevice: device.value };
  }
  if (effective.accountId !== undefined) {
    const account = makeAccountId(effective.accountId);
    if (!account.ok) throw new Error(`invalid durable fixture account id: ${effective.accountId}`);
    return {
      boundScope: repositoryScopeIdFor({ kind: 'account', accountId: account.value, deviceId: device.value }),
      boundDevice: device.value,
    };
  }
  const guest = makeGuestKey(DEFAULT_GUEST_KEY);
  if (!guest.ok) throw new Error('invalid durable fixture guest default');
  return {
    boundScope: repositoryScopeIdFor({ kind: 'guest', guestKey: guest.value, deviceId: device.value }),
    boundDevice: device.value,
  };
}

export function createDurableConformanceFixture(options: DurableFixtureOptions): ConformanceFixture {
  return {
    name: 'durable OPFS guest adapter',
    async createAdapter(spec) {
      const binding = bindingFor(spec);
      const storageId = globalThis.crypto.randomUUID();
      return openDurableGuestRepository({
        boundScope: binding.boundScope,
        boundDevice: binding.boundDevice,
        workerUrl: options.workerUrl,
        sqliteAssetBase: options.sqliteAssetBase,
        storageId,
        reset: true,
      });
    },
    createCheckpointStore(_spec, adapter) {
      return new DurableCheckpointStore({ adapter: adapter as DurableGuestRepository });
    },
  };
}
