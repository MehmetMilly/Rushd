/**
 * Repository conformance: in-memory reference adapter.
 *
 * Runs the reusable P03 Task D conformance suite
 * (`tests/domain/support/repository-conformance.ts`) against the
 * in-memory reference adapter. P04 adopts the same runner for the
 * persistent adapter without copying these cases: it only supplies a
 * factory that binds the requested scope, persists delivery metadata,
 * and applies content-bound pulled batches with its checkpoint.
 */

import { makeAccountId, makeDeviceId, makeGuestKey, makeRepositoryScopeId, repositoryScopeIdFor } from '../../src/domain/sync/scope';
import { DEFAULT_GUEST_KEY } from './support/deterministic-context';
import { InMemoryCheckpointStore } from './support/in-memory-checkpoint-store';
import { InMemoryFinanceRepository } from './support/in-memory-repository';
import { runRepositoryConformanceSuite, type ConformanceFixture, type ConformanceScopeSpec } from './support/repository-conformance';

function boundAdapter(spec?: ConformanceScopeSpec): InMemoryFinanceRepository {
  if (spec === undefined) return new InMemoryFinanceRepository();
  const device = makeDeviceId(spec.deviceId);
  if (!device.ok) throw new Error(`invalid conformance device id: ${spec.deviceId}`);
  if (spec.scopeId !== undefined) {
    const scope = makeRepositoryScopeId(spec.scopeId);
    if (!scope.ok) throw new Error(`invalid conformance scope id: ${spec.scopeId}`);
    return new InMemoryFinanceRepository({ boundScope: scope.value, boundDevice: device.value });
  }
  // Same derivation as the deterministic context helper: account scope when
  // an account is named, otherwise the default guest scope on this device.
  if (spec.accountId !== undefined) {
    const account = makeAccountId(spec.accountId);
    if (!account.ok) throw new Error(`invalid conformance account id: ${spec.accountId}`);
    const scope = repositoryScopeIdFor({ kind: 'account', accountId: account.value, deviceId: device.value });
    return new InMemoryFinanceRepository({ boundScope: scope, boundDevice: device.value });
  }
  const guest = makeGuestKey(DEFAULT_GUEST_KEY);
  if (!guest.ok) throw new Error('invalid conformance guest default');
  const scope = repositoryScopeIdFor({ kind: 'guest', guestKey: guest.value, deviceId: device.value });
  return new InMemoryFinanceRepository({ boundScope: scope, boundDevice: device.value });
}

const fixture: ConformanceFixture = {
  name: 'in-memory reference adapter',
  createAdapter: (spec) => boundAdapter(spec),
  createCheckpointStore: (_spec, adapter) => new InMemoryCheckpointStore({ adapter: adapter as InMemoryFinanceRepository }),
};

runRepositoryConformanceSuite(fixture);
