/**
 * P04-C portable document validation (Node). Browser restore/round-trip is
 * covered by the Chromium persistence gate.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson, stableDigest } from '../../src/domain/contracts/canonical';
import { parsePortableDocument } from '../../src/data/portability/validate';
import { PORTABLE_FORMAT, PORTABLE_FORMAT_VERSION } from '../../src/data/portability/format';
import { PORTABILITY_REASON } from '../../src/data/migration/reasons';
import { createMemoryControlStore, EMPTY_POINTER, type ControlStore } from '../../src/data/migration/control-store';
import { decodeLifecycleId } from '../../src/data/migration/lifecycle-id';
import { importPortableReplacement, resetGuestScope } from '../../src/data/portability/snapshot';
import { runLegacyMigration } from '../../src/data/migration/staging';
import { MAX_REPRESENTABLE_INSTANT_MS } from '../../src/domain/primitives/instant';
import { createDeterministicContext, DEFAULT_GUEST_KEY } from '../domain/support/deterministic-context';
import { makeDeviceId, makeGuestKey, repositoryScopeIdFor } from '../../src/domain/sync/scope';

const SCOPE = 'scope:guest:9:test-guest/16:test-device-0001';
const DEVICE = 'test-device-0001';

function validBook() {
  return {
    book: {
      id: 'legacy-guest-book',
      displayName: 'Rushd guest book',
      currency: 'SAR',
      timeZone: 'Asia/Riyadh',
      cycleAnchor: { kind: 'firstOfMonth' },
      createdAtInstantMs: 1,
      createdAtLocalDate: '1970-01-01',
      createdInTimeZone: 'Asia/Riyadh',
    },
    revision: 1,
    cycles: [],
    entries: [],
    obligations: [],
    obligationEvents: [],
    goals: [],
    allocationRecords: [],
    buffer: null,
    observations: [],
    adjustments: [],
    recoveryLinks: [],
    plans: [],
    planRevisions: [],
    planOccurrences: [],
    settingsRevisions: [],
    settlements: [],
    carryActions: [],
    propagationDeltas: [],
    propagationConflicts: [],
    conflictResolutions: [],
  };
}

function validJournal(overrides?: { operationId?: string; bookId?: string; scopeId?: string; deviceId?: string; enqueueSequence?: number; outboxId?: string; extra?: Record<string, unknown> }) {
  const operationId = overrides?.operationId ?? 'op-1';
  const bookId = overrides?.bookId ?? 'legacy-guest-book';
  const scopeId = overrides?.scopeId ?? SCOPE;
  const deviceId = overrides?.deviceId ?? DEVICE;
  const enqueueSequence = overrides?.enqueueSequence ?? 1;
  const command = {
    kind: 'createBook',
    bookId,
    displayName: 'Rushd guest book',
    currency: 'SAR',
    timeZone: 'Asia/Riyadh',
    cycleAnchor: { kind: 'firstOfMonth' },
  };
  const canonicalCommand = canonicalJson(command);
  const canonicalDigest = stableDigest(canonicalCommand);
  const receipt = {
    operationId,
    commandKind: 'createBook',
    bookId,
    revisionBefore: 0,
    revisionAfter: 1,
    committedAtInstantMs: 1,
    canonicalDigest,
    calculationVersion: 'p03-test',
    effects: [{
      kind: 'bookCreated',
      bookId,
      currency: 'SAR',
      timeZone: 'Asia/Riyadh',
      cycleAnchor: { kind: 'firstOfMonth' },
    }],
    handlerClockInstants: [1],
    handlerClockVersion: 1,
    schemaVersion: 1,
    scopeId,
    sourceDeviceId: deviceId,
    enqueueSequence,
  };
  const operation = {
    operationId,
    bookId,
    canonicalCommand,
    receipt,
    committedAtInstantMs: 1,
    handlerClockInstants: [1],
    handlerClockVersion: 1,
    schemaVersion: 1,
    scopeId,
    sourceDeviceId: deviceId,
    enqueueSequence,
    ...overrides?.extra,
  };
  const outbox = {
    outboxId: overrides?.outboxId ?? `outbox:${operationId}`,
    operationId,
    bookId,
    commandKind: 'createBook',
    revisionAfter: 1,
    canonicalDigest,
    createdAtInstantMs: 1,
    status: 'pending',
    schemaVersion: 1,
    scopeId,
    sourceDeviceId: deviceId,
    enqueueSequence,
  };
  return { operation, outbox };
}

function snapshot(overrides?: Record<string, unknown>) {
  const journal = validJournal();
  return JSON.stringify({
    books: [validBook()],
    operations: [journal.operation],
    outbox: [journal.outbox],
    delivery: [],
    enqueueSequence: 1,
    ...overrides,
  });
}

function checkpoints(overrides?: Record<string, unknown>) {
  return JSON.stringify({ scopeId: SCOPE, streams: [], ...overrides });
}

function document(overrides?: Record<string, unknown>) {
  const snapshotCanonical = typeof overrides?.['snapshotCanonical'] === 'string' ? overrides['snapshotCanonical'] : snapshot();
  const checkpointCanonical = typeof overrides?.['checkpointCanonical'] === 'string' ? overrides['checkpointCanonical'] : checkpoints();
  const base = {
    format: PORTABLE_FORMAT,
    formatVersion: PORTABLE_FORMAT_VERSION,
    localSchemaVersion: 1,
    currency: 'SAR',
    exportedAtMs: 1,
    scope: { scopeId: SCOPE, deviceId: DEVICE, storageId: 'guest-active' },
    snapshotCanonical,
    checkpointCanonical,
    sourceFingerprint: null,
    migrationId: null,
    integrity: stableDigest(`${snapshotCanonical}\n${checkpointCanonical}`),
    ...overrides,
  };
  if (overrides?.['integrity'] === undefined) {
    base.integrity = stableDigest(`${base.snapshotCanonical}\n${base.checkpointCanonical}`);
  }
  return base;
}

function expectReason(parsed: ReturnType<typeof parsePortableDocument>, reason: string) {
  expect(parsed.ok).toBe(false);
  if (parsed.ok) return;
  expect(parsed.reason).toBe(reason);
}


function expectPortableOk(parsed: ReturnType<typeof parsePortableDocument>) {
  if (!parsed.ok) throw new Error(`${parsed.reason}: ${parsed.detail}`);
  expect(parsed.ok).toBe(true);
}

describe('p04c portable validation', () => {
  it('accepts a fully decoded SAR document and previews counts', () => {
    const parsed = parsePortableDocument(document());
    expectPortableOk(parsed);
    if (parsed.ok) {
      expect(parsed.preview.bookCount).toBe(1);
      expect(parsed.preview.operationCount).toBe(1);
      expect(parsed.preview.outboxCount).toBe(1);
      expect(parsed.preview.currency).toBe('SAR');
      expect(parsed.snapshot.operations[0]?.schemaVersion).toBe(1);
    }
  });

  it('rejects unknown schema, wrong currency, tamper, truncate, duplicates, and journal asymmetry', () => {
    expectReason(parsePortableDocument({ ...document(), format: 'other' }), PORTABILITY_REASON.unknownFormat);
    expectReason(parsePortableDocument({ ...document(), localSchemaVersion: 99 }), PORTABILITY_REASON.incompatibleVersion);
    expectReason(parsePortableDocument({ ...document(), currency: 'USD' }), PORTABILITY_REASON.wrongCurrency);
    expectReason(parsePortableDocument({ ...document(), integrity: 'deadbeefdeadbeef' }), PORTABILITY_REASON.tamperedPayload);
    expectReason(parsePortableDocument('{"format":"rushd.portable.v1"'), PORTABILITY_REASON.truncatedPayload);
    const duplicateOps = snapshot({
      operations: [validJournal().operation, { ...validJournal().operation }],
      outbox: [validJournal().outbox, { ...validJournal().outbox }],
    });
    expectReason(parsePortableDocument(document({ snapshotCanonical: duplicateOps })), PORTABILITY_REASON.duplicateId);
    expectReason(parsePortableDocument(document({ snapshotCanonical: snapshot({ outbox: [] }) })), PORTABILITY_REASON.journalOutboxAsymmetry);
  });

  it('rejects untyped, foreign, malformed, and orphan portable records before any write', () => {
    const incomplete = snapshot({
      operations: [{ operationId: 'op-1', enqueueSequence: 1 }],
      outbox: [{ operationId: 'op-1', enqueueSequence: 1 }],
    });
    expectReason(parsePortableDocument(document({ snapshotCanonical: incomplete })), PORTABILITY_REASON.incompatibleVersion);

    const foreign = validJournal({ scopeId: 'scope:account:other-scope/16:test-device-0001' });
    expectReason(
      parsePortableDocument(document({
        snapshotCanonical: snapshot({ operations: [foreign.operation], outbox: [foreign.outbox] }),
      })),
      PORTABILITY_REASON.foreignRecord,
    );

    const orphanDelivery = snapshot({
      delivery: [{
        schemaVersion: 1,
        outboxId: 'outbox:missing',
        operationId: 'missing-op',
        version: 1,
        attempts: 1,
        lastError: null,
        leaseHolder: null,
        leaseExpiresAtMs: null,
        acknowledged: false,
        nextRetryAtMs: null,
      }],
    });
    expectReason(parsePortableDocument(document({ snapshotCanonical: orphanDelivery })), PORTABILITY_REASON.orphanRecord);

    const journal = validJournal();
    const duplicateDelivery = snapshot({
      delivery: [
        {
          schemaVersion: 1,
          outboxId: journal.outbox.outboxId,
          operationId: journal.operation.operationId,
          version: 1,
          attempts: 1,
          lastError: null,
          leaseHolder: null,
          leaseExpiresAtMs: null,
          acknowledged: false,
          nextRetryAtMs: null,
        },
        {
          schemaVersion: 1,
          outboxId: journal.outbox.outboxId,
          operationId: journal.operation.operationId,
          version: 2,
          attempts: 2,
          lastError: null,
          leaseHolder: null,
          leaseExpiresAtMs: null,
          acknowledged: false,
          nextRetryAtMs: null,
        },
      ],
    });
    expectReason(parsePortableDocument(document({ snapshotCanonical: duplicateDelivery })), PORTABILITY_REASON.duplicateId);
  });

  it('rejects nested empty entries, empty commands, forged provenance, sequence gaps, duplicate outbox ids, and raw fingerprints', () => {
    const nestedEmpty = JSON.parse(snapshot()) as { books: Array<{ entries: unknown[] }> };
    nestedEmpty.books[0]!.entries = [{}];
    expectReason(
      parsePortableDocument(document({ snapshotCanonical: JSON.stringify(nestedEmpty) })),
      PORTABILITY_REASON.malformedRecord,
    );

    const emptyCommand = validJournal();
    const emptyCanonical = '{}';
    emptyCommand.operation.canonicalCommand = emptyCanonical;
    emptyCommand.operation.receipt = { ...emptyCommand.operation.receipt, canonicalDigest: stableDigest(emptyCanonical) };
    emptyCommand.outbox = { ...emptyCommand.outbox, canonicalDigest: stableDigest(emptyCanonical) };
    expectReason(
      parsePortableDocument(document({
        snapshotCanonical: snapshot({ operations: [emptyCommand.operation], outbox: [emptyCommand.outbox] }),
      })),
      PORTABILITY_REASON.malformedRecord,
    );

    const emptySnapshot = JSON.stringify({ books: [], operations: [], outbox: [], delivery: [], enqueueSequence: 0 });
    expectReason(
      parsePortableDocument(document({
        snapshotCanonical: emptySnapshot,
        scope: { scopeId: 'bad scope', deviceId: 'bad device', storageId: 'guest-active' },
      })),
      PORTABILITY_REASON.invalidReference,
    );
    expect(parsePortableDocument(document({ snapshotCanonical: emptySnapshot })).ok).toBe(true);

    const first = validJournal({ operationId: 'op-1', enqueueSequence: 1 });
    const third = validJournal({ operationId: 'op-3', enqueueSequence: 3, bookId: 'second-guest-book' });
    const secondBook = validBook();
    secondBook.book.id = 'second-guest-book';
    expectReason(
      parsePortableDocument(document({
        snapshotCanonical: snapshot({
          books: [validBook(), secondBook],
          operations: [first.operation, third.operation],
          outbox: [first.outbox, third.outbox],
          enqueueSequence: 3,
        }),
      })),
      PORTABILITY_REASON.journalOutboxAsymmetry,
    );

    const left = validJournal({ operationId: 'op-1', enqueueSequence: 1, outboxId: 'outbox:shared' });
    const right = validJournal({ operationId: 'op-2', enqueueSequence: 2, outboxId: 'outbox:shared' });
    expectReason(
      parsePortableDocument(document({
        snapshotCanonical: snapshot({
          operations: [left.operation, right.operation],
          outbox: [left.outbox, right.outbox],
          enqueueSequence: 2,
        }),
      })),
      PORTABILITY_REASON.duplicateId,
    );

    expectReason(
      parsePortableDocument(document({ sourceFingerprint: '{"secret":"fake-financial-source"}', migrationId: 'mig-1' })),
      PORTABILITY_REASON.malformedRecord,
    );
    expectReason(
      parsePortableDocument(document({ extra: true })),
      PORTABILITY_REASON.malformedRecord,
    );
  });
});

describe('p04c activation CAS', () => {
  it('admits one winner and an explicit conflict for concurrent pointer writes', async () => {
    const store = createMemoryControlStore();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = async (storageId: string) => {
      const pointer = await store.getPointer();
      await barrier;
      return store.compareAndSwapPointer(pointer.generation, {
        ...EMPTY_POINTER,
        activeStorageId: storageId,
        activationCommitted: true,
        committedAtMs: 1,
      });
    };
    const first = write('mig-a');
    const second = write('mig-b');
    release();
    const results = await Promise.all([first, second]);
    expect(results.filter((item) => item.ok).length).toBe(1);
    expect(results.filter((item) => !item.ok && item.reason === 'activation-conflict').length).toBe(1);
    const pointer = await store.getPointer();
    expect(pointer.generation).toBe(1);
    expect(pointer.activationCommitted).toBe(true);
  });
});

function throwingControl(): ControlStore {
  const boom = async () => {
    throw new Error('control must not be consulted');
  };
  return {
    getPointer: boom,
    putPointer: boom,
    compareAndSwapPointer: boom,
    getRun: boom,
    putRun: boom,
  };
}

function lifecycleRuntime(control: ControlStore) {
  const device = makeDeviceId(DEVICE);
  const guest = makeGuestKey(DEFAULT_GUEST_KEY);
  if (!device.ok || !guest.ok) throw new Error('invalid test origin');
  const { context } = createDeterministicContext({ deviceId: DEVICE });
  return {
    boundScope: repositoryScopeIdFor({ kind: 'guest', guestKey: guest.value, deviceId: device.value }),
    boundDevice: device.value,
    context,
    control,
  };
}

function parsedSnapshot() {
  return JSON.parse(snapshot()) as {
    books: Array<Record<string, unknown> & { entries: unknown[]; cycles: unknown[]; book: Record<string, unknown> }>;
    operations: Array<Record<string, unknown> & { receipt: Record<string, unknown> }>;
    outbox: Array<Record<string, unknown>>;
    delivery: unknown[];
    enqueueSequence: number;
  };
}

describe('p04c graph and lifecycle gates', () => {
  it('rejects legacy, missing, extra, reordered, and unrepresentable handler-clock evidence', () => {
    const legacy = parsedSnapshot();
    delete legacy.operations[0]!.handlerClockVersion;
    delete legacy.operations[0]!.receipt.handlerClockVersion;
    expectReason(
      parsePortableDocument(document({ snapshotCanonical: JSON.stringify(legacy) })),
      PORTABILITY_REASON.incompatibleVersion,
    );

    const missing = parsedSnapshot();
    delete missing.operations[0]!.handlerClockInstants;
    delete missing.operations[0]!.receipt.handlerClockInstants;
    expectReason(
      parsePortableDocument(document({ snapshotCanonical: JSON.stringify(missing) })),
      PORTABILITY_REASON.malformedRecord,
    );

    const extra = parsedSnapshot();
    extra.operations[0]!.handlerClockInstants = [1, 2];
    extra.operations[0]!.receipt.handlerClockInstants = [1, 2];
    expectReason(
      parsePortableDocument(document({ snapshotCanonical: JSON.stringify(extra) })),
      PORTABILITY_REASON.malformedRecord,
    );

    const reordered = parsedSnapshot();
    reordered.operations[0]!.handlerClockInstants = [1, 2];
    reordered.operations[0]!.receipt.handlerClockInstants = [2, 1];
    expectReason(
      parsePortableDocument(document({ snapshotCanonical: JSON.stringify(reordered) })),
      PORTABILITY_REASON.tamperedPayload,
    );

    const outOfRange = parsedSnapshot();
    outOfRange.operations[0]!.handlerClockInstants = [MAX_REPRESENTABLE_INSTANT_MS + 1];
    outOfRange.operations[0]!.receipt.handlerClockInstants = [MAX_REPRESENTABLE_INSTANT_MS + 1];
    expectReason(
      parsePortableDocument(document({ snapshotCanonical: JSON.stringify(outOfRange) })),
      PORTABILITY_REASON.malformedRecord,
    );
  });

  it('rejects the escalation probes that previously parsed as valid documents', () => {
    const negativeFunds = parsedSnapshot();
    negativeFunds.books[0]!.cycles = [{
      versionId: 'cycver:legacy-guest-book:2026-01-01:v1',
      cycleId: 'cyc:legacy-guest-book:2026-01-01',
      bookId: 'legacy-guest-book',
      versionSeq: 1,
      mode: 'fullCycle',
      startDate: '2026-01-01',
      endDateExclusive: '2026-02-01',
      anchor: { kind: 'firstOfMonth' },
      timeZone: 'Asia/Riyadh',
      startingFunds: { currency: 'SAR', minorUnits: -1 },
      openedAtInstantMs: 1,
      boundaryObservedPool: null,
      boundaryLocalDate: null,
      boundaryLocalTime: null,
      boundaryInstantMs: null,
      boundaryTimeZone: null,
      supersedesVersionId: null,
    }];
    expectReason(parsePortableDocument(document({ snapshotCanonical: JSON.stringify(negativeFunds) })), PORTABILITY_REASON.malformedRecord);

    const orphan = parsedSnapshot();
    orphan.books[0]!.entries = [{
      kind: 'inflow',
      entryId: 'inflow-1',
      bookId: 'legacy-guest-book',
      cycleId: 'missing-cycle',
      localDate: '2026-01-02',
      timeZone: 'Asia/Riyadh',
      amount: { currency: 'SAR', minorUnits: 50 },
      note: '',
      occurredAtInstantMs: 1,
      capturedAtInstantMs: 1,
      capturedInTimeZone: 'Asia/Riyadh',
      calculationVersion: 'p03-test',
      sourceOperationId: 'op-1',
    }];
    expectReason(parsePortableDocument(document({ snapshotCanonical: JSON.stringify(orphan) })), PORTABILITY_REASON.orphanRecord);

    const extraAnchor = parsedSnapshot();
    extraAnchor.books[0]!.book.cycleAnchor = { kind: 'firstOfMonth', extra: true };
    expectReason(parsePortableDocument(document({ snapshotCanonical: JSON.stringify(extraAnchor) })), PORTABILITY_REASON.malformedRecord);

    const invalidWall = parsedSnapshot();
    invalidWall.books[0]!.cycles = [{
      versionId: 'cycver:legacy-guest-book:2026-01-01:v1',
      cycleId: 'cyc:legacy-guest-book:2026-01-01',
      bookId: 'legacy-guest-book',
      versionSeq: 1,
      mode: 'remainingFromBoundary',
      startDate: '2026-01-01',
      endDateExclusive: '2026-02-01',
      anchor: { kind: 'firstOfMonth' },
      timeZone: 'Asia/Riyadh',
      startingFunds: { currency: 'SAR', minorUnits: 1000 },
      openedAtInstantMs: 1,
      boundaryObservedPool: { currency: 'SAR', minorUnits: 1000 },
      boundaryLocalDate: '2026-01-15',
      boundaryLocalTime: '99:99:99',
      boundaryInstantMs: null,
      boundaryTimeZone: 'Asia/Riyadh',
      supersedesVersionId: null,
    }];
    expectReason(parsePortableDocument(document({ snapshotCanonical: JSON.stringify(invalidWall) })), PORTABILITY_REASON.malformedRecord);

    const outOfRange = parsedSnapshot();
    outOfRange.books[0]!.book.createdAtInstantMs = MAX_REPRESENTABLE_INSTANT_MS + 1;
    expectReason(parsePortableDocument(document({ snapshotCanonical: JSON.stringify(outOfRange) })), PORTABILITY_REASON.malformedRecord);

    const malformedEffect = parsedSnapshot();
    malformedEffect.operations[0]!.receipt.effects = [{}];
    expectReason(parsePortableDocument(document({ snapshotCanonical: JSON.stringify(malformedEffect) })), PORTABILITY_REASON.malformedRecord);

    const revisionMismatch = parsedSnapshot();
    revisionMismatch.books[0]!.revision = 99;
    expectReason(parsePortableDocument(document({ snapshotCanonical: JSON.stringify(revisionMismatch) })), PORTABILITY_REASON.revisionConflict);

    expectReason(
      parsePortableDocument(document({
        checkpointCanonical: JSON.stringify({
          scopeId: SCOPE,
          streams: [{ streamId: 'stream:1', cursor: null, batchDigest: '1234567890abcdef', applied: [] }],
        }),
      })),
      PORTABILITY_REASON.malformedRecord,
    );
  });

  it('accepts remote-applied history and rejects a remote journal row missing from checkpoints', () => {
    const local = validJournal();
    const remoteCommand = {
      kind: 'openCycle',
      bookId: 'legacy-guest-book',
      startDate: '2026-01-01',
      startingFunds: { currency: 'SAR', minorUnits: 1000 },
    };
    const remoteCanonical = canonicalJson(remoteCommand);
    const remoteDigest = stableDigest(remoteCanonical);
    const remoteOp = {
      operationId: 'op-remote',
      bookId: 'legacy-guest-book',
      canonicalCommand: remoteCanonical,
      receipt: {
        operationId: 'op-remote',
        commandKind: 'openCycle',
        bookId: 'legacy-guest-book',
        revisionBefore: 1,
        revisionAfter: 2,
        committedAtInstantMs: 1,
        canonicalDigest: remoteDigest,
        calculationVersion: 'p03-test',
        effects: [{
          kind: 'cycleOpened',
          cycleId: 'cyc:legacy-guest-book:2026-01-01',
          startDate: '2026-01-01',
          endDateExclusive: '2026-02-01',
          startingFunds: { currency: 'SAR', minorUnits: 1000 },
        }],
        handlerClockInstants: [1],
        handlerClockVersion: 1,
        schemaVersion: 1,
        scopeId: SCOPE,
        sourceDeviceId: 'remote-device-01',
        enqueueSequence: 7,
      },
      committedAtInstantMs: 1,
      handlerClockInstants: [1],
      handlerClockVersion: 1,
      schemaVersion: 1,
      scopeId: SCOPE,
      sourceDeviceId: 'remote-device-01',
      enqueueSequence: 7,
    };
    const books = [{
      ...validBook(),
      revision: 2,
      cycles: [{
      versionId: 'cycver:legacy-guest-book:2026-01-01:v1',
      cycleId: 'cyc:legacy-guest-book:2026-01-01',
      bookId: 'legacy-guest-book',
      versionSeq: 1,
      mode: 'fullCycle',
      startDate: '2026-01-01',
      endDateExclusive: '2026-02-01',
      anchor: { kind: 'firstOfMonth' },
      timeZone: 'Asia/Riyadh',
      startingFunds: { currency: 'SAR', minorUnits: 1000 },
      openedAtInstantMs: 1,
      boundaryObservedPool: null,
      boundaryLocalDate: null,
      boundaryLocalTime: null,
      boundaryInstantMs: null,
      boundaryTimeZone: null,
      supersedesVersionId: null,
    }],
    }];
    const snapshotCanonical = JSON.stringify({
      books,
      operations: [local.operation, remoteOp],
      outbox: [local.outbox],
      delivery: [],
      enqueueSequence: 1,
    });
    const checkpointCanonical = JSON.stringify({
      scopeId: SCOPE,
      streams: [{
        streamId: 'stream:1',
        cursor: 'cursor-1',
        batchDigest: '1234567890abcdef',
        applied: [{
          operationId: 'op-remote',
          sequence: 1,
          scopeId: SCOPE,
          bookId: 'legacy-guest-book',
          baseRevision: 1,
          resultingRevision: 2,
          canonicalCommand: remoteCanonical,
          canonicalDigest: remoteDigest,
          sourceDeviceId: 'remote-device-01',
          sourceEnqueueSequence: 7,
          schemaVersion: 1,
        }],
      }],
    });
    const parsed = parsePortableDocument(document({ snapshotCanonical, checkpointCanonical }));
    expectPortableOk(parsed);

    const missingApplied = parsePortableDocument(document({
      snapshotCanonical,
      checkpointCanonical: checkpoints(),
    }));
    expectReason(missingApplied, PORTABILITY_REASON.journalOutboxAsymmetry);

    const mutated = JSON.parse(checkpointCanonical) as { streams: Array<{ applied: Array<Record<string, unknown>> }> };
    mutated.streams[0]!.applied[0]!.sourceDeviceId = DEVICE;
    expectReason(
      parsePortableDocument(document({ snapshotCanonical, checkpointCanonical: JSON.stringify(mutated) })),
      PORTABILITY_REASON.tamperedPayload,
    );
  });

  it('rejects invalid lifecycle IDs before any control-store method', async () => {
    const control = throwingControl();
    const runtime = lifecycleRuntime(control);
    const invalid = ['', ' ', 'a'.repeat(101), 'bad id', 'id\n', '\u0001hidden'];
    for (const value of invalid) {
      const migrated = await runLegacyMigration(value, runtime);
      expect(migrated.ok).toBe(false);
      if (!migrated.ok) {
        expect(migrated.reason).toBe('invalid-id');
        expect(migrated.activationCommitted).toBe(false);
      }
      const imported = await importPortableReplacement(value, document(), 'REPLACE-ACTIVE-DATABASE', runtime);
      expect(imported.ok).toBe(false);
      if (!imported.ok) {
        expect(imported.reason).toBe('invalid-id');
        expect(imported.activationCommitted).toBe(false);
      }
      const reset = await resetGuestScope(value, 'RESET-GUEST-SCOPE', runtime.boundScope as string, runtime);
      expect(reset.ok).toBe(false);
      if (!reset.ok) {
        expect(reset.reason).toBe('invalid-id');
        expect(reset.activationCommitted).toBe(false);
      }
    }
    const okIds = ['a', 'x'.repeat(100)];
    for (const value of okIds) {
      expect(decodeLifecycleId(value, 'migrationId').ok).toBe(true);
      expect(decodeLifecycleId(value, 'importId').ok).toBe(true);
      expect(decodeLifecycleId(value, 'resetId').ok).toBe(true);
    }
  });
});

function money(minorUnits: number) {
  return { currency: 'SAR' as const, minorUnits };
}

function richSnapshot() {
  const local = validJournal();
  const january = {
    versionId: 'cycver:legacy-guest-book:2026-01-01:v1',
    cycleId: 'cyc:legacy-guest-book:2026-01-01',
    bookId: 'legacy-guest-book',
    versionSeq: 1,
    mode: 'fullCycle',
    startDate: '2026-01-01',
    endDateExclusive: '2026-02-01',
    anchor: { kind: 'firstOfMonth' },
    timeZone: 'Asia/Riyadh',
    startingFunds: money(1000),
    openedAtInstantMs: 1,
    boundaryObservedPool: null,
    boundaryLocalDate: null,
    boundaryLocalTime: null,
    boundaryInstantMs: null,
    boundaryTimeZone: null,
    supersedesVersionId: null,
  };
  const august = {
    ...january,
    versionId: 'cycver:legacy-guest-book:2026-08-01:v1',
    cycleId: 'cyc:legacy-guest-book:2026-08-01',
    startDate: '2026-08-01',
    endDateExclusive: '2026-09-01',
  };
  const expense = {
    kind: 'expense',
    entryId: 'exp-1',
    bookId: 'legacy-guest-book',
    cycleId: january.cycleId,
    localDate: '2026-01-03',
    timeZone: 'Asia/Riyadh',
    amount: money(25),
    note: '',
    category: null,
    flexibleDefinitionId: null,
    linkedObligationId: null,
    replacesEntryId: null,
    occurredAtInstantMs: null,
    capturedAtInstantMs: 1,
    capturedInTimeZone: 'Asia/Riyadh',
    calculationVersion: 'p03-test',
    sourceOperationId: 'op-expense',
  };
  function remoteOp(params: {
    operationId: string;
    enqueueSequence: number;
    revisionBefore: number;
    command: Record<string, unknown>;
    effects: unknown[];
  }) {
    const canonicalCommand = canonicalJson(params.command);
    const canonicalDigest = stableDigest(canonicalCommand);
    return {
      operationId: params.operationId,
      bookId: 'legacy-guest-book',
      canonicalCommand,
      receipt: {
        operationId: params.operationId,
        commandKind: params.command.kind,
        bookId: 'legacy-guest-book',
        revisionBefore: params.revisionBefore,
        revisionAfter: params.revisionBefore + 1,
        committedAtInstantMs: 1,
        canonicalDigest,
        calculationVersion: 'p03-test',
        effects: params.effects,
        handlerClockInstants: [1],
        handlerClockVersion: 1,
        schemaVersion: 1,
        scopeId: SCOPE,
        sourceDeviceId: 'remote-device-01',
        enqueueSequence: params.enqueueSequence,
      },
      committedAtInstantMs: 1,
      handlerClockInstants: [1],
      handlerClockVersion: 1,
      schemaVersion: 1,
      scopeId: SCOPE,
      sourceDeviceId: 'remote-device-01',
      enqueueSequence: params.enqueueSequence,
    };
  }
  const openJanuary = remoteOp({
    operationId: 'op-january',
    enqueueSequence: 4,
    revisionBefore: 1,
    command: { kind: 'openCycle', bookId: 'legacy-guest-book', startDate: '2026-01-01', startingFunds: money(1000) },
    effects: [{
      kind: 'cycleOpened',
      cycleId: january.cycleId,
      startDate: january.startDate,
      endDateExclusive: january.endDateExclusive,
      startingFunds: january.startingFunds,
    }],
  });
  const recordExpense = remoteOp({
    operationId: 'op-expense',
    enqueueSequence: 5,
    revisionBefore: 2,
    command: {
      kind: 'recordExpense',
      bookId: 'legacy-guest-book',
      amount: money(25),
      occurredAt: { kind: 'civilDate', localDate: '2026-01-03' },
      note: '',
      category: null,
      flexibleDefinitionId: null,
    },
    effects: [{
      kind: 'expenseRecorded',
      entryId: 'exp-1',
      cycleId: january.cycleId,
      localDate: '2026-01-03',
      amount: money(25),
      linkedObligationId: null,
      replacesEntryId: null,
    }],
  });
  const createCoffee = remoteOp({
    operationId: 'op-coffee',
    enqueueSequence: 6,
    revisionBefore: 3,
    command: {
      kind: 'createRecurringPlan',
      bookId: 'legacy-guest-book',
      planId: 'plan-coffee',
      name: 'Coffee',
      amount: money(10),
      scheduleDay: 1,
      effectiveDate: '2026-01-01',
      flexibleDefinitionId: null,
    },
    effects: [{
      kind: 'recurringPlanCreated',
      planId: 'plan-coffee',
      amount: money(10),
      scheduleDay: 1,
      effectiveDate: '2026-01-01',
    }],
  });
  const createRent = remoteOp({
    operationId: 'op-rent',
    enqueueSequence: 7,
    revisionBefore: 4,
    command: {
      kind: 'createRecurringPlan',
      bookId: 'legacy-guest-book',
      planId: 'plan-rent',
      name: 'Rent',
      amount: money(10),
      scheduleDay: 1,
      effectiveDate: '2026-01-01',
      flexibleDefinitionId: null,
    },
    effects: [{
      kind: 'recurringPlanCreated',
      planId: 'plan-rent',
      amount: money(10),
      scheduleDay: 1,
      effectiveDate: '2026-01-01',
    }],
  });
  const materialize = remoteOp({
    operationId: 'op-mat-coffee',
    enqueueSequence: 8,
    revisionBefore: 5,
    command: { kind: 'materializePlanOccurrences', bookId: 'legacy-guest-book', planId: 'plan-coffee', throughDate: '2026-01-31' },
    effects: [{ kind: 'planOccurrencesMaterialized', planId: 'plan-coffee', occurrenceIds: ['occ:plan-coffee:2026-01'] }],
  });
  const openAugust = remoteOp({
    operationId: 'op-august',
    enqueueSequence: 9,
    revisionBefore: 7,
    command: { kind: 'openCycle', bookId: 'legacy-guest-book', startDate: '2026-08-01', startingFunds: money(1000) },
    effects: [{
      kind: 'cycleOpened',
      cycleId: august.cycleId,
      startDate: august.startDate,
      endDateExclusive: august.endDateExclusive,
      startingFunds: august.startingFunds,
    }],
  });
  const julySettlement = {
    settlementId: 'stl:legacy-guest-book:2026-01-01:s1',
    bookId: 'legacy-guest-book',
    cycleId: january.cycleId,
    versionId: january.versionId,
    settlementSeq: 1,
    reversed: false,
    startingFunds: money(1000),
    netInflows: money(0),
    netOutflows: money(25),
    netReturns: money(0),
    netAdjustments: money(0),
    carryIn: money(0),
    reservedCommitments: money(0),
    netAllocations: money(0),
    buffer: money(0),
    availability: money(975),
    poolCompleteness: 'current',
    classificationCompleteness: 'needsAttention',
    dataAsOfInstantMs: 1,
    calculationVersion: 'p03-test',
    closedAtInstantMs: 1,
    sourceOperationId: 'op-close-january',
  };
  const closeJanuary = remoteOp({
    operationId: 'op-close-january',
    enqueueSequence: 10,
    revisionBefore: 6,
    command: { kind: 'closeCycle', bookId: 'legacy-guest-book', cycleId: january.cycleId, note: '' },
    effects: [{
      kind: 'cycleClosed',
      cycleId: january.cycleId,
      versionId: january.versionId,
      settlementId: julySettlement.settlementId,
      availability: julySettlement.availability,
    }],
  });
  const operations = [local.operation, openJanuary, recordExpense, createCoffee, createRent, materialize, closeJanuary, openAugust];
  const snapshotCanonical = JSON.stringify({
    books: [{
      ...validBook(),
      revision: 8,
      cycles: [january, august],
      entries: [expense],
      plans: [
        { planId: 'plan-coffee', bookId: 'legacy-guest-book', name: 'Coffee', anchor: { kind: 'firstOfMonth' }, flexibleDefinitionId: null, createdAtInstantMs: 1, createdInTimeZone: 'Asia/Riyadh', calculationVersion: 'p03-test', sourceOperationId: 'op-coffee' },
        { planId: 'plan-rent', bookId: 'legacy-guest-book', name: 'Rent', anchor: { kind: 'firstOfMonth' }, flexibleDefinitionId: null, createdAtInstantMs: 1, createdInTimeZone: 'Asia/Riyadh', calculationVersion: 'p03-test', sourceOperationId: 'op-rent' },
      ],
      planRevisions: [
        { revisionId: 'rev-coffee', bookId: 'legacy-guest-book', planId: 'plan-coffee', effectiveDate: '2026-01-01', amount: money(10), scheduleDay: 1, note: '', capturedAtInstantMs: 1, calculationVersion: 'p03-test', sourceOperationId: 'op-coffee' },
        { revisionId: 'rev-rent', bookId: 'legacy-guest-book', planId: 'plan-rent', effectiveDate: '2026-01-01', amount: money(10), scheduleDay: 1, note: '', capturedAtInstantMs: 1, calculationVersion: 'p03-test', sourceOperationId: 'op-rent' },
      ],
      planOccurrences: [{
        occurrenceId: 'occ:plan-coffee:2026-01',
        bookId: 'legacy-guest-book',
        planId: 'plan-coffee',
        revisionId: 'rev-coffee',
        dueDate: '2026-01-01',
        dueCycleId: january.cycleId,
        state: 'managed',
        linkedObligationId: null,
        linkedExpenseEntryId: null,
        capturedAtInstantMs: 1,
        calculationVersion: 'p03-test',
        sourceOperationId: 'op-mat-coffee',
      }],
      settlements: [julySettlement],
    }],
    operations,
    outbox: [local.outbox],
    delivery: [],
    enqueueSequence: 1,
  });
  const checkpointCanonical = JSON.stringify({
    scopeId: SCOPE,
    streams: [{
      streamId: 'stream:1',
      cursor: 'cursor-1',
      batchDigest: '1234567890abcdef',
      applied: operations.slice(1).map((op, index) => ({
        operationId: op.operationId,
        sequence: index + 1,
        scopeId: SCOPE,
        bookId: 'legacy-guest-book',
        baseRevision: op.receipt.revisionBefore,
        resultingRevision: op.receipt.revisionAfter,
        canonicalCommand: op.canonicalCommand,
        canonicalDigest: op.receipt.canonicalDigest,
        sourceDeviceId: op.sourceDeviceId,
        sourceEnqueueSequence: op.enqueueSequence,
        schemaVersion: 1,
      })),
    }],
  });
  return { snapshotCanonical, checkpointCanonical, parsed: JSON.parse(snapshotCanonical) as ReturnType<typeof parsedSnapshot> };
}

function mutateRich(mutator: (snapshot: ReturnType<typeof parsedSnapshot>) => void) {
  const rich = richSnapshot();
  mutator(rich.parsed);
  return document({
    snapshotCanonical: JSON.stringify(rich.parsed),
    checkpointCanonical: rich.checkpointCanonical,
  });
}

describe('p04c exact effect, provenance, relationship, and money gates', () => {
  it('accepts a rich historical document and rejects the seven review mutations before staging', async () => {
    const baseline = richSnapshot();
    const parsed = parsePortableDocument(document({
      snapshotCanonical: baseline.snapshotCanonical,
      checkpointCanonical: baseline.checkpointCanonical,
    }));
    expectPortableOk(parsed);

    const mutations: Array<{ name: string; mutate: (snapshot: ReturnType<typeof parsedSnapshot>) => void }> = [
      {
        name: 'forged bookCreated timezone',
        mutate: (snapshot) => {
          const effects = snapshot.operations[0]!.receipt.effects as Array<Record<string, unknown>>;
          effects[0]!.timeZone = 'Europe/London';
        },
      },
      {
        name: 'empty createBook effects',
        mutate: (snapshot) => {
          snapshot.operations[0]!.receipt.effects = [];
        },
      },
      {
        name: 'same-book forged entry sourceOperationId',
        mutate: (snapshot) => {
          const entry = snapshot.books[0]!.entries[0] as { sourceOperationId: string };
          entry.sourceOperationId = snapshot.operations[0]!.operationId as string;
        },
      },
      {
        name: 'forged negative effect amount',
        mutate: (snapshot) => {
          const expenseOp = snapshot.operations.find((row) => row.receipt.commandKind === 'recordExpense');
          const effects = expenseOp!.receipt.effects as Array<Record<string, unknown>>;
          (effects[0]!.amount as { minorUnits: number }).minorUnits = -1;
        },
      },
      {
        name: 'occurrence referencing another plan revision',
        mutate: (snapshot) => {
          const occurrence = ((snapshot.books[0] as Record<string, unknown>).planOccurrences as Array<{ revisionId: string }>)[0]!;
          occurrence.revisionId = 'rev-rent';
        },
      },
      {
        name: 'settlement referencing another cycle version',
        mutate: (snapshot) => {
          const settlement = ((snapshot.books[0] as Record<string, unknown>).settlements as Array<{ versionId: string }>)[0]!;
          settlement.versionId = 'cycver:legacy-guest-book:2026-08-01:v1';
        },
      },
      {
        name: 'invalid settlement money relationship',
        mutate: (snapshot) => {
          const settlement = ((snapshot.books[0] as Record<string, unknown>).settlements as Array<{ netInflows: { minorUnits: number } }>)[0]!;
          settlement.netInflows.minorUnits = -1;
        },
      },
    ];

    const control = createMemoryControlStore();
    const runtime = lifecycleRuntime(control);
    const before = await control.getPointer();
    for (const row of mutations) {
      const mutated = mutateRich(row.mutate);
      const parsedMutation = parsePortableDocument(mutated);
      expect(parsedMutation.ok).toBe(false);
      const imported = await importPortableReplacement('imp-fix04', mutated, 'REPLACE-ACTIVE-DATABASE', runtime);
      expect(imported.ok).toBe(false);
      if (!imported.ok) expect(imported.activationCommitted).toBe(false);
      const after = await control.getPointer();
      expect(after).toEqual(before);
      expect(after.activationCommitted).toBe(false);
    }
  });
});
