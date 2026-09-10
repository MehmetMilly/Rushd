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

import { describe, expect, it } from 'vitest';
import { applyRemoteOperation } from '../../src/application/sync/apply-remote';
import { canonicalJson, stableDigest } from '../../src/domain/contracts/canonical';
import { makeBookId, makeOperationId } from '../../src/domain/contracts/identity';
import type { PulledOperation } from '../../src/domain/sync/cursors';
import { makeAccountId, makeDeviceId, makeGuestKey, makeRepositoryScopeId, repositoryScopeIdFor } from '../../src/domain/sync/scope';
import { createDeterministicContext } from './support/deterministic-context';
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

describe('handler-clock provenance through remote apply', () => {
  it('stores the receiver handler trace in both journal and receipt', async () => {
    const repository = boundAdapter();
    const { context } = createDeterministicContext({ baseInstantMs: 500, stepMs: -100 });
    const command = {
      kind: 'createBook',
      bookId: 'book-remote-trace',
      displayName: 'remote trace',
      currency: 'SAR',
      timeZone: 'Asia/Riyadh',
      cycleAnchor: { kind: 'firstOfMonth' },
    };
    const canonicalCommand = canonicalJson(command);
    const operationId = makeOperationId('op-remote-trace');
    const bookId = makeBookId('book-remote-trace');
    const sourceDeviceId = makeDeviceId('remote-trace-device');
    if (!operationId.ok || !bookId.ok || !sourceDeviceId.ok) throw new Error('invalid test identity');
    const pulled: PulledOperation = {
      operationId: operationId.value,
      sequence: 1,
      scopeId: repository.boundScope,
      bookId: bookId.value,
      baseRevision: 0,
      resultingRevision: 1,
      canonicalCommand,
      canonicalDigest: stableDigest(canonicalCommand),
      sourceDeviceId: sourceDeviceId.value,
      sourceEnqueueSequence: 9,
      schemaVersion: 1,
    };
    const result = await repository.runTransaction((transaction) =>
      applyRemoteOperation(repository, transaction, pulled, context),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.receipt.handlerClockInstants).toEqual([500]);
    expect(result.receipt.committedAtInstantMs).toBe(400);
    const stored = repository.getOperation(operationId.value);
    expect(stored?.handlerClockVersion).toBe(1);
    expect(stored?.handlerClockInstants).toEqual([500]);
    expect(stored?.receipt.handlerClockInstants).toEqual([500]);
  });
});
