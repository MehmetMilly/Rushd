/**
 * Shared repository-graph validator coverage for P04-C correction 04.
 * Structural decoding is covered by the portability suite; this file owns
 * exact receipt effects, provenance, relationship identity, money policy,
 * revision, checkpoint, and linear-time cases.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson, stableDigest } from '../../src/domain/contracts/canonical';
import {
  MONEY_FIELD_POLICY,
  validateRepositorySnapshotGraph,
} from '../../src/domain/contracts/repository-snapshot-validation';
import type { BookState, CycleRecord, CycleSettlement, LedgerEntry, PlanOccurrence, PlanRevision } from '../../src/domain/contracts/ledger';
import type { CommandReceipt, OperationRecord, OutboxEnvelope } from '../../src/domain/contracts/commands';
import type { PulledOperation } from '../../src/domain/sync/cursors';
import { MAX_REPRESENTABLE_INSTANT_MS, MIN_REPRESENTABLE_INSTANT_MS } from '../../src/domain/primitives/instant';

const SCOPE = 'scope:guest:9:test-guest/16:test-device-0001';
const DEVICE = 'test-device-0001';
const REMOTE = 'remote-device-01';
const BOOK = 'legacy-guest-book';
const CYCLE = 'cyc:legacy-guest-book:2026-01-01';
const AUGUST = 'cyc:legacy-guest-book:2026-08-01';

const sar = (minorUnits: number) => ({ currency: 'SAR' as const, minorUnits });

function emptyBook(revision = 1, bookId = BOOK): BookState {
  return {
    book: {
      id: bookId,
      displayName: 'Rushd guest book',
      currency: 'SAR',
      timeZone: 'Asia/Riyadh',
      cycleAnchor: { kind: 'firstOfMonth' },
      createdAtInstantMs: 1,
      createdAtLocalDate: '1970-01-01',
      createdInTimeZone: 'Asia/Riyadh',
    },
    revision,
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
  } as unknown as BookState;
}

function januaryCycle(overrides: Record<string, unknown> = {}): CycleRecord {
  return {
    versionId: 'cycver:legacy-guest-book:2026-01-01:v1',
    cycleId: CYCLE,
    bookId: BOOK,
    versionSeq: 1,
    mode: 'fullCycle',
    startDate: '2026-01-01',
    endDateExclusive: '2026-02-01',
    anchor: { kind: 'firstOfMonth' },
    timeZone: 'Asia/Riyadh',
    startingFunds: sar(1000),
    openedAtInstantMs: 1,
    boundaryObservedPool: null,
    boundaryLocalDate: null,
    boundaryLocalTime: null,
    boundaryInstantMs: null,
    boundaryTimeZone: null,
    supersedesVersionId: null,
    ...overrides,
  } as unknown as CycleRecord;
}

function augustCycle(): CycleRecord {
  return {
    ...januaryCycle({
      versionId: 'cycver:legacy-guest-book:2026-08-01:v1',
      cycleId: AUGUST,
      startDate: '2026-08-01',
      endDateExclusive: '2026-09-01',
    }),
  } as CycleRecord;
}

function bookCreatedEffect(bookId = BOOK) {
  return {
    kind: 'bookCreated' as const,
    bookId,
    currency: 'SAR' as const,
    timeZone: 'Asia/Riyadh',
    cycleAnchor: { kind: 'firstOfMonth' as const },
  };
}

function cycleOpenedEffect(cycle: CycleRecord) {
  return {
    kind: 'cycleOpened' as const,
    cycleId: cycle.cycleId,
    startDate: cycle.startDate,
    endDateExclusive: cycle.endDateExclusive,
    startingFunds: cycle.startingFunds,
  };
}

function operation(params: {
  operationId: string;
  enqueueSequence: number;
  revisionBefore: number;
  commandKind: string;
  deviceId?: string;
  bookId?: string;
  committedAtInstantMs?: number;
  receiptCommittedAtInstantMs?: number;
  effects?: unknown[];
  command?: Record<string, unknown>;
  handlerClockInstants?: number[];
}): OperationRecord {
  const bookId = params.bookId ?? BOOK;
  const command =
    params.command ??
    (params.commandKind === 'createBook'
      ? {
          kind: 'createBook',
          bookId,
          displayName: 'Rushd guest book',
          currency: 'SAR',
          timeZone: 'Asia/Riyadh',
          cycleAnchor: { kind: 'firstOfMonth' },
        }
      : params.commandKind === 'openCycle'
        ? {
            kind: 'openCycle',
            bookId,
            startDate: '2026-01-01',
            startingFunds: sar(1000),
          }
        : params.commandKind === 'recordInflow'
          ? {
              kind: 'recordInflow',
              bookId,
              amount: sar(50),
              occurredAt: { kind: 'civilDate', localDate: '2026-01-02' },
              note: '',
            }
          : params.commandKind === 'recordExpense'
            ? {
                kind: 'recordExpense',
                bookId,
                amount: sar(25),
                occurredAt: { kind: 'civilDate', localDate: '2026-01-03' },
                note: '',
                category: null,
                flexibleDefinitionId: null,
              }
            : {
                kind: 'closeCycle',
                bookId,
                cycleId: CYCLE,
                note: '',
              });
  const canonicalCommand = canonicalJson(command);
  const deviceId = params.deviceId ?? DEVICE;
  const handlerClockInstants = params.handlerClockInstants ?? [1];
  const defaultEffects =
    params.commandKind === 'createBook'
      ? [bookCreatedEffect(bookId)]
      : params.commandKind === 'openCycle'
        ? [cycleOpenedEffect(januaryCycle())]
        : [];
  const receipt = {
    operationId: params.operationId,
    commandKind: params.commandKind,
    bookId,
    revisionBefore: params.revisionBefore,
    revisionAfter: params.revisionBefore + 1,
    committedAtInstantMs: params.receiptCommittedAtInstantMs ?? params.committedAtInstantMs ?? 1,
    canonicalDigest: stableDigest(canonicalCommand),
    calculationVersion: 'p03-test',
    effects: params.effects ?? defaultEffects,
    handlerClockInstants: [...handlerClockInstants],
    handlerClockVersion: 1,
    schemaVersion: 1,
    scopeId: SCOPE,
    sourceDeviceId: deviceId,
    enqueueSequence: params.enqueueSequence,
  } as unknown as CommandReceipt;
  return {
    operationId: params.operationId,
    bookId,
    canonicalCommand,
    receipt,
    committedAtInstantMs: params.committedAtInstantMs ?? 1,
    handlerClockInstants: [...handlerClockInstants],
    handlerClockVersion: 1,
    schemaVersion: 1,
    scopeId: SCOPE,
    sourceDeviceId: deviceId,
    enqueueSequence: params.enqueueSequence,
  } as unknown as OperationRecord;
}

function outboxFor(op: OperationRecord): OutboxEnvelope {
  return {
    outboxId: `outbox:${op.operationId as string}`,
    operationId: op.operationId,
    bookId: op.bookId,
    commandKind: op.receipt.commandKind,
    revisionAfter: op.receipt.revisionAfter,
    canonicalDigest: op.receipt.canonicalDigest,
    createdAtInstantMs: 1,
    status: 'pending',
    schemaVersion: 1,
    scopeId: op.scopeId,
    sourceDeviceId: op.sourceDeviceId,
    enqueueSequence: op.enqueueSequence,
  } as unknown as OutboxEnvelope;
}

function pulledFrom(op: OperationRecord, sequence = 1): PulledOperation {
  return {
    operationId: op.operationId,
    sequence,
    scopeId: op.scopeId,
    bookId: op.bookId,
    baseRevision: op.receipt.revisionBefore,
    resultingRevision: op.receipt.revisionAfter,
    canonicalCommand: op.canonicalCommand,
    canonicalDigest: op.receipt.canonicalDigest,
    sourceDeviceId: op.sourceDeviceId,
    sourceEnqueueSequence: op.enqueueSequence,
    schemaVersion: 1,
  } as unknown as PulledOperation;
}

function graph(overrides: Record<string, unknown> = {}) {
  const local = operation({ operationId: 'op-local', enqueueSequence: 1, revisionBefore: 0, commandKind: 'createBook' });
  return validateRepositorySnapshotGraph({
    books: [emptyBook(1)],
    operations: [local],
    outbox: [outboxFor(local)],
    delivery: [],
    enqueueSequence: 1,
    localDeviceId: DEVICE,
    checkpoints: { scopeId: SCOPE, streams: [] },
    ...overrides,
  });
}

function expectFail(result: ReturnType<typeof validateRepositorySnapshotGraph>, reason: string) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issue.reason).toBe(reason);
}

function expectOk(result: ReturnType<typeof validateRepositorySnapshotGraph>) {
  if (!result.ok) throw new Error(JSON.stringify(result.issue));
  expect(result.ok).toBe(true);
}

function inflowTemplate(): LedgerEntry {
  return {
    kind: 'inflow',
    entryId: 'inflow-1',
    bookId: BOOK,
    cycleId: CYCLE,
    localDate: '2026-01-02',
    timeZone: 'Asia/Riyadh',
    amount: sar(50),
    note: '',
    occurredAtInstantMs: null,
    capturedAtInstantMs: 1,
    capturedInTimeZone: 'Asia/Riyadh',
    calculationVersion: 'p03-test',
    sourceOperationId: 'op-inflow',
  } as unknown as LedgerEntry;
}

function withEffects(op: OperationRecord, effects: unknown[]): OperationRecord {
  return { ...op, receipt: { ...op.receipt, effects } } as unknown as OperationRecord;
}

function inflowOp() {
  return operation({
    operationId: 'op-inflow',
    enqueueSequence: 9,
    revisionBefore: 2,
    commandKind: 'recordInflow',
    deviceId: REMOTE,
    effects: [{
      kind: 'inflowRecorded',
      entryId: 'inflow-1',
      cycleId: CYCLE,
      localDate: '2026-01-02',
      amount: sar(50),
    }],
  });
}

function openCycleOp(overrides: { operationId?: string; enqueueSequence?: number; revisionBefore?: number; cycle?: CycleRecord } = {}) {
  const cycle = overrides.cycle ?? januaryCycle();
  return operation({
    operationId: overrides.operationId ?? 'op-remote',
    enqueueSequence: overrides.enqueueSequence ?? 4,
    revisionBefore: overrides.revisionBefore ?? 1,
    commandKind: 'openCycle',
    deviceId: REMOTE,
    command: {
      kind: 'openCycle',
      bookId: BOOK,
      startDate: cycle.startDate,
      startingFunds: cycle.startingFunds,
    },
    effects: [cycleOpenedEffect(cycle)],
  });
}

function remoteHistory(book: BookState, extraOps: OperationRecord[] = []) {
  const local = operation({ operationId: 'op-local', enqueueSequence: 1, revisionBefore: 0, commandKind: 'createBook' });
  const remote = openCycleOp();
  const operations = [local, remote, ...extraOps];
  return {
    books: [book],
    operations,
    outbox: [outboxFor(local)],
    delivery: [] as const,
    enqueueSequence: 1,
    localDeviceId: DEVICE,
    checkpoints: {
      scopeId: SCOPE,
      streams: [{
        streamId: 'stream:1',
        cursor: 'cursor-1',
        batchDigest: '1234567890abcdef',
        applied: operations.slice(1).map((op, index) => pulledFrom(op, index + 1)),
      }],
    },
  };
}

function expenseEntry(): LedgerEntry {
  return {
    kind: 'expense',
    entryId: 'exp-1',
    bookId: BOOK,
    cycleId: CYCLE,
    localDate: '2026-01-03',
    timeZone: 'Asia/Riyadh',
    amount: sar(25),
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
  } as unknown as LedgerEntry;
}

function expenseOp() {
  return operation({
    operationId: 'op-expense',
    enqueueSequence: 8,
    revisionBefore: 2,
    commandKind: 'recordExpense',
    deviceId: REMOTE,
    effects: [{
      kind: 'expenseRecorded',
      entryId: 'exp-1',
      cycleId: CYCLE,
      localDate: '2026-01-03',
      amount: sar(25),
      linkedObligationId: null,
      replacesEntryId: null,
    }],
  });
}

function settlementFor(cycle: CycleRecord, overrides: Record<string, unknown> = {}): CycleSettlement {
  return {
    settlementId: `stl:${BOOK}:${cycle.startDate}:s1`,
    bookId: BOOK,
    cycleId: cycle.cycleId,
    versionId: cycle.versionId,
    settlementSeq: 1,
    reversed: false,
    startingFunds: cycle.startingFunds,
    netInflows: sar(0),
    netOutflows: sar(0),
    netReturns: sar(0),
    netAdjustments: sar(0),
    carryIn: sar(0),
    reservedCommitments: sar(0),
    netAllocations: sar(0),
    buffer: sar(0),
    availability: cycle.startingFunds,
    poolCompleteness: 'current',
    classificationCompleteness: 'current',
    dataAsOfInstantMs: 1,
    calculationVersion: 'p03-test',
    closedAtInstantMs: 1,
    sourceOperationId: `op-close-${cycle.versionId as string}`,
    ...overrides,
  } as unknown as CycleSettlement;
}

function closeOp(cycle: CycleRecord, settlement: CycleSettlement): OperationRecord {
  return operation({
    operationId: settlement.sourceOperationId as string,
    enqueueSequence: 20,
    revisionBefore: 2,
    commandKind: 'closeCycle',
    deviceId: REMOTE,
    command: { kind: 'closeCycle', bookId: BOOK, cycleId: cycle.cycleId, note: '' },
    effects: [{
      kind: 'cycleClosed',
      cycleId: cycle.cycleId,
      versionId: cycle.versionId,
      settlementId: settlement.settlementId,
      availability: settlement.availability,
    }],
  });
}

function planRevision(planId: string, revisionId: string): PlanRevision {
  return {
    revisionId,
    bookId: BOOK,
    planId,
    effectiveDate: '2026-01-01',
    amount: sar(10),
    scheduleDay: 1,
    note: '',
    capturedAtInstantMs: 1,
    calculationVersion: 'p03-test',
    sourceOperationId: `op-plan-${planId}`,
  } as unknown as PlanRevision;
}

function occurrence(planId: string, revisionId: string, occurrenceId: string): PlanOccurrence {
  return {
    occurrenceId,
    bookId: BOOK,
    planId,
    revisionId,
    dueDate: '2026-01-01',
    dueCycleId: CYCLE,
    state: 'managed',
    linkedObligationId: null,
    linkedExpenseEntryId: null,
    capturedAtInstantMs: 1,
    calculationVersion: 'p03-test',
    sourceOperationId: `op-mat-${planId}`,
  } as unknown as PlanOccurrence;
}

describe('validateRepositorySnapshotGraph', () => {
  it('accepts a local createBook journal with outbox and empty checkpoints', () => {
    expect(graph().ok).toBe(true);
  });

  it('uses only the ordered handler trace and rejects legacy, missing, extra, reordered, or out-of-range evidence', () => {
    const local = operation({ operationId: 'op-local', enqueueSequence: 1, revisionBefore: 0, commandKind: 'createBook' });
    const base = {
      books: [emptyBook(1)],
      operations: [local],
      outbox: [outboxFor(local)],
      delivery: [],
      enqueueSequence: 1,
      localDeviceId: DEVICE,
      checkpoints: { scopeId: SCOPE, streams: [] },
    };

    const legacy = {
      ...local,
      handlerClockInstants: undefined,
      handlerClockVersion: undefined,
      receipt: { ...local.receipt, handlerClockInstants: undefined, handlerClockVersion: undefined },
    } as unknown as OperationRecord;
    expectFail(validateRepositorySnapshotGraph({ ...base, operations: [legacy] }), 'malformed-record');

    const missing = {
      ...local,
      handlerClockInstants: undefined,
      receipt: { ...local.receipt, handlerClockInstants: undefined },
    } as unknown as OperationRecord;
    expectFail(validateRepositorySnapshotGraph({ ...base, operations: [missing] }), 'malformed-record');

    const missingSample = {
      ...local,
      handlerClockInstants: [],
      receipt: { ...local.receipt, handlerClockInstants: [] },
    } as OperationRecord;
    expectFail(validateRepositorySnapshotGraph({ ...base, operations: [missingSample] }), 'malformed-record');

    const extra = {
      ...local,
      handlerClockInstants: [1, 2],
      receipt: { ...local.receipt, handlerClockInstants: [1, 2] },
    } as OperationRecord;
    expectFail(validateRepositorySnapshotGraph({ ...base, operations: [extra] }), 'malformed-record');

    const reordered = {
      ...local,
      handlerClockInstants: [1, 2],
      receipt: { ...local.receipt, handlerClockInstants: [2, 1] },
    } as OperationRecord;
    expectFail(validateRepositorySnapshotGraph({ ...base, operations: [reordered] }), 'malformed-record');

    const outOfRange = {
      ...local,
      handlerClockInstants: [MAX_REPRESENTABLE_INSTANT_MS + 1],
      receipt: { ...local.receipt, handlerClockInstants: [MAX_REPRESENTABLE_INSTANT_MS + 1] },
    } as OperationRecord;
    expectFail(validateRepositorySnapshotGraph({ ...base, operations: [outOfRange] }), 'malformed-record');

    const forgedState = { ...emptyBook(1), book: { ...emptyBook(1).book, createdAtInstantMs: 999 } } as BookState;
    expectFail(validateRepositorySnapshotGraph({ ...base, books: [forgedState] }), 'malformed-record');
  });

  it('accepts a handler clock that moves backwards relative to commit time', () => {
    const local = operation({
      operationId: 'op-local',
      enqueueSequence: 1,
      revisionBefore: 0,
      commandKind: 'createBook',
      committedAtInstantMs: 90,
      receiptCommittedAtInstantMs: 90,
      handlerClockInstants: [100],
    });
    expectOk(validateRepositorySnapshotGraph({
      books: [{ ...emptyBook(1), book: { ...emptyBook(1).book, createdAtInstantMs: 100 } } as BookState],
      operations: [local],
      outbox: [outboxFor(local)],
      delivery: [],
      enqueueSequence: 1,
      localDeviceId: DEVICE,
      checkpoints: { scopeId: SCOPE, streams: [] },
    }));
  });

  it('resolves nested references against kind, book, and historical targets', () => {
    const inflow = inflowTemplate();
    const validBook = { ...emptyBook(3), cycles: [januaryCycle()], entries: [inflow] };
    const valid = validateRepositorySnapshotGraph(remoteHistory(validBook, [inflowOp()]));
    expectOk(valid);

    const cases: Array<{ name: string; book: BookState; extraOps?: OperationRecord[]; reason: string }> = [
      {
        name: 'absent cycle',
        extraOps: [withEffects(inflowOp(), [{ kind: 'inflowRecorded', entryId: 'inflow-1', cycleId: 'missing-cycle', localDate: '2026-01-02', amount: sar(50) }])],
        book: { ...emptyBook(3), cycles: [januaryCycle()], entries: [{ ...inflowTemplate(), cycleId: 'missing-cycle' as never }] },
        reason: 'orphan-record',
      },
      {
        name: 'self-reversal',
        book: {
          ...emptyBook(3),
          cycles: [januaryCycle()],
          entries: [{
            ...inflowTemplate(),
            kind: 'inflowReversal',
            entryId: 'inflow-1',
            reversesEntryId: 'inflow-1',
            amount: sar(-50),
          } as unknown as LedgerEntry],
        },
        extraOps: [inflowOp()],
        reason: 'invalid-reference',
      },
      {
        name: 'wrong reversal kind',
        extraOps: [inflowOp()],
        book: {
          ...emptyBook(3),
          cycles: [januaryCycle()],
          entries: [
            inflowTemplate(),
            {
              ...inflowTemplate(),
              kind: 'expenseReversal',
              entryId: 'rev-1',
              reversesEntryId: 'inflow-1',
              amount: sar(-50),
              sourceOperationId: 'op-inflow',
            } as unknown as LedgerEntry,
          ],
        },
        reason: 'invalid-reference',
      },
      {
        name: 'unknown obligation',
        extraOps: [withEffects(expenseOp(), [{
          kind: 'expenseRecorded',
          entryId: 'exp-1',
          cycleId: CYCLE,
          localDate: '2026-01-03',
          amount: sar(25),
          linkedObligationId: 'missing-ob',
          replacesEntryId: null,
        }])],
        book: {
          ...emptyBook(3),
          cycles: [januaryCycle()],
          entries: [{ ...expenseEntry(), linkedObligationId: 'missing-ob' } as unknown as LedgerEntry],
        },
        reason: 'orphan-record',
      },
      {
        name: 'unknown source operation',
        extraOps: [inflowOp()],
        book: { ...emptyBook(3), cycles: [januaryCycle()], entries: [{ ...inflowTemplate(), sourceOperationId: 'missing-op' as never }] },
        reason: 'orphan-record',
      },
    ];
    for (const row of cases) {
      expectFail(validateRepositorySnapshotGraph(remoteHistory(row.book, row.extraOps)), row.reason);
    }
  });

  it('rejects a shared EntryId reused across collections', () => {
    const local = operation({ operationId: 'op-local', enqueueSequence: 1, revisionBefore: 0, commandKind: 'createBook' });
    const book = {
      ...emptyBook(1),
      entries: [{
        kind: 'inflow',
        entryId: 'shared-id',
        bookId: BOOK,
        cycleId: CYCLE,
        localDate: '2026-01-02',
        timeZone: 'Asia/Riyadh',
        amount: sar(50),
        note: '',
        occurredAtInstantMs: 1,
        capturedAtInstantMs: 1,
        capturedInTimeZone: 'Asia/Riyadh',
        calculationVersion: 'p03-test',
        sourceOperationId: 'op-local',
      } as unknown as LedgerEntry],
      cycles: [januaryCycle()],
      adjustments: [{
        adjustmentId: 'shared-id',
        observationId: 'obs-1',
        cycleId: CYCLE,
        sourceOperationId: 'op-local',
        capturedAtInstantMs: 1,
      }],
    } as unknown as BookState;
    expectFail(
      validateRepositorySnapshotGraph({
        books: [book],
        operations: [local],
        outbox: [outboxFor(local)],
        delivery: [],
        enqueueSequence: 1,
        localDeviceId: DEVICE,
        checkpoints: { scopeId: SCOPE, streams: [] },
      }),
      'duplicate-id',
    );
  });

  it('rejects incompatible, missing, extra, and record-mismatched effects', () => {
    const local = operation({
      operationId: 'op-local',
      enqueueSequence: 1,
      revisionBefore: 0,
      commandKind: 'createBook',
      effects: [{ kind: 'inflowRecorded', entryId: 'e1', cycleId: CYCLE, localDate: '2026-01-01', amount: sar(1) }],
    });
    expectFail(graph({ operations: [local], outbox: [outboxFor(local)] }), 'journal-outbox-asymmetry');

    const emptyEffects = operation({
      operationId: 'op-local',
      enqueueSequence: 1,
      revisionBefore: 0,
      commandKind: 'createBook',
      effects: [],
    });
    expectFail(graph({ operations: [emptyEffects], outbox: [outboxFor(emptyEffects)] }), 'journal-outbox-asymmetry');

    const extra = operation({
      operationId: 'op-local',
      enqueueSequence: 1,
      revisionBefore: 0,
      commandKind: 'createBook',
      effects: [bookCreatedEffect(), bookCreatedEffect()],
    });
    expectFail(graph({ operations: [extra], outbox: [outboxFor(extra)] }), 'journal-outbox-asymmetry');

    const missingCreated = operation({
      operationId: 'op-local',
      enqueueSequence: 1,
      revisionBefore: 0,
      commandKind: 'createBook',
      effects: [{ kind: 'bookCreated', bookId: 'other-book', currency: 'SAR', timeZone: 'Asia/Riyadh', cycleAnchor: { kind: 'firstOfMonth' } }],
    });
    expectFail(graph({ operations: [missingCreated], outbox: [outboxFor(missingCreated)] }), 'orphan-record');

    const forgedZone = operation({
      operationId: 'op-local',
      enqueueSequence: 1,
      revisionBefore: 0,
      commandKind: 'createBook',
      effects: [{ ...bookCreatedEffect(), timeZone: 'Europe/London' }],
    });
    expectFail(graph({ operations: [forgedZone], outbox: [outboxFor(forgedZone)] }), 'malformed-record');
  });

  it('rejects revision forks, gaps, wrong first command, and commit-time mismatch', () => {
    const create = operation({ operationId: 'op-local', enqueueSequence: 1, revisionBefore: 0, commandKind: 'createBook' });
    expectFail(graph({ books: [emptyBook(99)], operations: [create], outbox: [outboxFor(create)] }), 'revision-idempotency-conflict');

    const forkA = operation({ operationId: 'op-a', enqueueSequence: 1, revisionBefore: 0, commandKind: 'createBook' });
    const forkB = operation({ operationId: 'op-b', enqueueSequence: 2, revisionBefore: 0, commandKind: 'openCycle' });
    expectFail(
      graph({
        books: [{ ...emptyBook(2), cycles: [januaryCycle()] }],
        operations: [forkA, forkB],
        outbox: [outboxFor(forkA), outboxFor(forkB)],
        enqueueSequence: 2,
      }),
      'revision-idempotency-conflict',
    );

    const wrongFirst = operation({ operationId: 'op-local', enqueueSequence: 1, revisionBefore: 0, commandKind: 'openCycle' });
    expectFail(
      graph({
        books: [{ ...emptyBook(1), cycles: [januaryCycle()] }],
        operations: [wrongFirst],
        outbox: [outboxFor(wrongFirst)],
      }),
      'revision-idempotency-conflict',
    );

    const mismatch = operation({
      operationId: 'op-local',
      enqueueSequence: 1,
      revisionBefore: 0,
      commandKind: 'createBook',
      committedAtInstantMs: 1,
      receiptCommittedAtInstantMs: 2,
    });
    expectFail(graph({ operations: [mismatch], outbox: [outboxFor(mismatch)] }), 'malformed-record');
  });

  it('round-trips remote-applied history and rejects immutable-field mutations', () => {
    const local = operation({ operationId: 'op-local', enqueueSequence: 1, revisionBefore: 0, commandKind: 'createBook' });
    const remote = openCycleOp({ enqueueSequence: 9 });
    const book = { ...emptyBook(2), cycles: [januaryCycle()] };
    const base = {
      books: [book],
      operations: [local, remote],
      outbox: [outboxFor(local)],
      delivery: [],
      enqueueSequence: 1,
      localDeviceId: DEVICE,
      checkpoints: {
        scopeId: SCOPE,
        streams: [{ streamId: 'stream:1', cursor: 'cursor-1', batchDigest: '1234567890abcdef', applied: [pulledFrom(remote)] }],
      },
    };
    expectOk(validateRepositorySnapshotGraph(base));

    expectFail(validateRepositorySnapshotGraph({ ...base, outbox: [] }), 'journal-outbox-asymmetry');
    expectFail(
      validateRepositorySnapshotGraph({
        ...base,
        checkpoints: { scopeId: SCOPE, streams: [] },
      }),
      'journal-outbox-asymmetry',
    );

    const mutatedDevice = {
      ...pulledFrom(remote),
      sourceDeviceId: DEVICE,
    } as PulledOperation;
    expectFail(
      validateRepositorySnapshotGraph({
        ...base,
        checkpoints: {
          scopeId: SCOPE,
          streams: [{ streamId: 'stream:1', cursor: 'cursor-1', batchDigest: '1234567890abcdef', applied: [mutatedDevice] }],
        },
      }),
      'tampered-payload',
    );

    const localOnRemoteDevice = operation({
      operationId: 'op-local',
      enqueueSequence: 1,
      revisionBefore: 0,
      commandKind: 'createBook',
      deviceId: REMOTE,
    });
    expectFail(
      validateRepositorySnapshotGraph({
        ...base,
        operations: [localOnRemoteDevice, remote],
        outbox: [outboxFor(localOnRemoteDevice)],
      }),
      'foreign-record',
    );
  });

  it('enforces record-specific money signs, instants, anchors, and cycle windows', () => {
    const local = operation({ operationId: 'op-local', enqueueSequence: 1, revisionBefore: 0, commandKind: 'createBook' });
    const withCycle = (cycle: CycleRecord, commandCycle = cycle) => {
      const remote = openCycleOp({ cycle: commandCycle });
      return validateRepositorySnapshotGraph({
        books: [{ ...emptyBook(2), cycles: [cycle] }],
        operations: [local, remote],
        outbox: [outboxFor(local)],
        delivery: [],
        enqueueSequence: 1,
        localDeviceId: DEVICE,
        checkpoints: {
          scopeId: SCOPE,
          streams: [{ streamId: 's', cursor: 'c', batchDigest: '1234567890abcdef', applied: [pulledFrom(remote)] }],
        },
      });
    };
    expectFail(withCycle(januaryCycle({ startingFunds: sar(-1) }), januaryCycle()), 'malformed-record');
    expectFail(withCycle(januaryCycle({ startDate: '2026-01-01', endDateExclusive: '2026-01-01' })), 'malformed-record');
    expectFail(withCycle(januaryCycle({
      startDate: '2026-01-15',
      endDateExclusive: '2026-02-15',
      cycleId: 'cyc:legacy-guest-book:2026-01-15',
    })), 'malformed-record');
    expectFail(withCycle(januaryCycle({ cycleId: 'cyc:legacy-guest-book:2025-01-01' })), 'invalid-reference');
    expectFail(
      withCycle(januaryCycle({
        mode: 'fullCycle',
        boundaryObservedPool: sar(1),
      })),
      'malformed-record',
    );
    expectFail(
      withCycle(januaryCycle({
        mode: 'remainingFromBoundary',
        boundaryObservedPool: sar(1000),
        boundaryLocalDate: '2026-01-15',
        boundaryLocalTime: '99:99:99',
        boundaryTimeZone: 'Asia/Riyadh',
        boundaryInstantMs: null,
      })),
      'malformed-record',
    );
    expect(withCycle(januaryCycle()).ok).toBe(true);
    expectFail(
      graph({
        books: [{
          ...emptyBook(1),
          book: { ...emptyBook(1).book, createdAtInstantMs: MAX_REPRESENTABLE_INSTANT_MS + 1 },
        } as BookState],
      }),
      'malformed-record',
    );
    expect(MIN_REPRESENTABLE_INSTANT_MS).toBeLessThan(0);
  });

  it('enforces checkpoint cursor/digest/applied pairing', () => {
    const local = operation({ operationId: 'op-local', enqueueSequence: 1, revisionBefore: 0, commandKind: 'createBook' });
    const remote = openCycleOp({ enqueueSequence: 2 });
    const input = {
      books: [{ ...emptyBook(2), cycles: [januaryCycle()] }],
      operations: [local, remote],
      outbox: [outboxFor(local)],
      delivery: [],
      enqueueSequence: 1,
      localDeviceId: DEVICE,
    };
    expect(
      graph({
        checkpoints: { scopeId: SCOPE, streams: [{ streamId: 's', cursor: null, batchDigest: null, applied: [] }] },
      }).ok,
    ).toBe(true);
    expectFail(
      validateRepositorySnapshotGraph({
        ...input,
        checkpoints: { scopeId: SCOPE, streams: [{ streamId: 's', cursor: null, batchDigest: '1234567890abcdef', applied: [] }] },
      }),
      'malformed-record',
    );
    expectFail(
      validateRepositorySnapshotGraph({
        ...input,
        checkpoints: { scopeId: SCOPE, streams: [{ streamId: 's', cursor: 'c', batchDigest: null, applied: [] }] },
      }),
      'malformed-record',
    );
    expectFail(
      validateRepositorySnapshotGraph({
        ...input,
        checkpoints: { scopeId: SCOPE, streams: [{ streamId: 's', cursor: null, batchDigest: null, applied: [pulledFrom(remote)] }] },
      }),
      'malformed-record',
    );
  });

  it('binds sourceOperationId to the claiming effect and rejects same-book forgeries', () => {
    const forged = {
      ...emptyBook(3),
      cycles: [januaryCycle()],
      entries: [{ ...inflowTemplate(), sourceOperationId: 'op-local' as never }],
    };
    expectFail(validateRepositorySnapshotGraph(remoteHistory(forged, [inflowOp()])), 'invalid-reference');
  });

  it('binds fundTracked remainder allocations to the disposal effect, not a same-book sibling', () => {
    const january = januaryCycle();
    const august = augustCycle();
    const julySettlement = settlementFor(january, { netOutflows: sar(0), availability: sar(1000) });
    const closeJanuary = closeOp(january, julySettlement);
    const openAugust = openCycleOp({
      operationId: 'op-august',
      enqueueSequence: 11,
      revisionBefore: 3,
      cycle: august,
    });
    const dispose = operation({
      operationId: 'op-disp-vault',
      enqueueSequence: 14,
      revisionBefore: 4,
      commandKind: 'disposeCycleRemainder',
      deviceId: REMOTE,
      command: {
        kind: 'disposeCycleRemainder',
        bookId: BOOK,
        settlementId: julySettlement.settlementId,
        note: 'vault',
        disposition: { kind: 'fundTracked', amount: sar(45) },
      },
      effects: [{
        kind: 'cycleRemainderDisposed',
        settlementId: julySettlement.settlementId,
        carryId: 'carry-1',
        dispositionKind: 'fundTracked',
      }],
    });
    const carry = {
      carryId: 'carry-1',
      bookId: BOOK,
      settlementId: julySettlement.settlementId,
      sourceCycleId: january.cycleId,
      disposition: { kind: 'fundTracked', amount: sar(45) },
      downstreamCursors: { allocationCount: 0, entryCount: 0, obligationCount: 0, settlementCount: 1 },
      note: 'vault',
      capturedAtInstantMs: 1,
      calculationVersion: 'p03-test',
      sourceOperationId: 'op-disp-vault',
    };
    const allocation = {
      kind: 'allocation',
      recordId: 'allocation-1',
      bookId: BOOK,
      cycleId: august.cycleId,
      localDate: '1970-01-01',
      change: { type: 'funding', amount: sar(45) },
      note: 'vault',
      occurredAtInstantMs: 1,
      capturedAtInstantMs: 1,
      capturedInTimeZone: 'Asia/Riyadh',
      calculationVersion: 'p03-test',
      sourceOperationId: 'op-disp-vault',
    };
    const validBook = {
      ...emptyBook(5),
      cycles: [january, august],
      settlements: [julySettlement],
      carryActions: [carry],
      allocationRecords: [allocation],
    } as unknown as BookState;
    expectOk(validateRepositorySnapshotGraph(remoteHistory(validBook, [closeJanuary, openAugust, dispose])));

    const forged = {
      ...validBook,
      allocationRecords: [{ ...allocation, sourceOperationId: 'op-local' }],
    } as unknown as BookState;
    expectFail(
      validateRepositorySnapshotGraph(remoteHistory(forged, [closeJanuary, openAugust, dispose])),
      'invalid-reference',
    );
  });

  it('enforces plan-revision and settlement-version relationship identity', () => {
    const coffeeRevision = planRevision('plan-coffee', 'rev-coffee');
    const rentRevision = planRevision('plan-rent', 'rev-rent');
    const planOps = [
      operation({
        operationId: 'op-plan-plan-coffee',
        enqueueSequence: 5,
        revisionBefore: 2,
        commandKind: 'createRecurringPlan',
        deviceId: REMOTE,
        command: {
          kind: 'createRecurringPlan',
          bookId: BOOK,
          planId: 'plan-coffee',
          name: 'Coffee',
          amount: sar(10),
          scheduleDay: 1,
          effectiveDate: '2026-01-01',
          flexibleDefinitionId: null,
        },
        effects: [{
          kind: 'recurringPlanCreated',
          planId: 'plan-coffee',
          amount: sar(10),
          scheduleDay: 1,
          effectiveDate: '2026-01-01',
        }],
      }),
      operation({
        operationId: 'op-plan-plan-rent',
        enqueueSequence: 6,
        revisionBefore: 3,
        commandKind: 'createRecurringPlan',
        deviceId: REMOTE,
        command: {
          kind: 'createRecurringPlan',
          bookId: BOOK,
          planId: 'plan-rent',
          name: 'Rent',
          amount: sar(10),
          scheduleDay: 1,
          effectiveDate: '2026-01-01',
          flexibleDefinitionId: null,
        },
        effects: [{
          kind: 'recurringPlanCreated',
          planId: 'plan-rent',
          amount: sar(10),
          scheduleDay: 1,
          effectiveDate: '2026-01-01',
        }],
      }),
      operation({
        operationId: 'op-mat-plan-coffee',
        enqueueSequence: 7,
        revisionBefore: 4,
        commandKind: 'materializePlanOccurrences',
        deviceId: REMOTE,
        command: { kind: 'materializePlanOccurrences', bookId: BOOK, planId: 'plan-coffee', throughDate: '2026-01-31' },
        effects: [{ kind: 'planOccurrencesMaterialized', planId: 'plan-coffee', occurrenceIds: ['occ-coffee'] }],
      }),
    ];
    const plans = [
      { planId: 'plan-coffee', bookId: BOOK, name: 'Coffee', anchor: { kind: 'firstOfMonth' }, flexibleDefinitionId: null, createdAtInstantMs: 1, createdInTimeZone: 'Asia/Riyadh', calculationVersion: 'p03-test', sourceOperationId: 'op-plan-plan-coffee' },
      { planId: 'plan-rent', bookId: BOOK, name: 'Rent', anchor: { kind: 'firstOfMonth' }, flexibleDefinitionId: null, createdAtInstantMs: 1, createdInTimeZone: 'Asia/Riyadh', calculationVersion: 'p03-test', sourceOperationId: 'op-plan-plan-rent' },
    ];
    const mismatched = {
      ...emptyBook(5),
      cycles: [januaryCycle()],
      plans,
      planRevisions: [coffeeRevision, rentRevision],
      planOccurrences: [occurrence('plan-coffee', 'rev-rent', 'occ-coffee')],
    } as unknown as BookState;
    expectFail(validateRepositorySnapshotGraph(remoteHistory(mismatched, planOps)), 'invalid-reference');

    const january = januaryCycle();
    const august = augustCycle();
    const julySettlement = settlementFor(january);
    const closeJanuary = closeOp(january, julySettlement);
    const openAugust = openCycleOp({
      operationId: 'op-august',
      enqueueSequence: 11,
      revisionBefore: 3,
      cycle: august,
    });
    const wrongVersion = {
      ...emptyBook(4),
      cycles: [january, august],
      settlements: [{ ...julySettlement, versionId: august.versionId }],
    } as unknown as BookState;
    expectFail(
      validateRepositorySnapshotGraph(remoteHistory(wrongVersion, [closeJanuary, openAugust])),
      'invalid-reference',
    );
  });

  it('enforces the documented money-field policy including signed settlement identity', () => {
    expect(MONEY_FIELD_POLICY.settlementIdentity).toContain('availability = startingFunds');
    const january = januaryCycle();
    const settlement = settlementFor(january, { netInflows: sar(-1) });
    const close = closeOp(january, settlement);
    const book = {
      ...emptyBook(3),
      cycles: [january],
      settlements: [settlement],
    } as unknown as BookState;
    expectFail(validateRepositorySnapshotGraph(remoteHistory(book, [close])), 'malformed-record');

    const reality = operation({
      operationId: 'op-reality',
      enqueueSequence: 12,
      revisionBefore: 2,
      commandKind: 'recordRealityCheck',
      deviceId: REMOTE,
      command: {
        kind: 'recordRealityCheck',
        bookId: BOOK,
        observedPool: sar(900),
        boundary: { kind: 'civilDateTime', localDate: '2026-01-15', localTime: '12:00:00' },
        currencyLabel: null,
        classificationNote: 'cash check',
        note: '',
      },
      effects: [{
        kind: 'realityCheckRecorded',
        observationId: 'obs-1',
        cycleId: CYCLE,
        observedPool: sar(900),
        ledgerPool: sar(1000),
        adjustmentAmount: sar(-100),
      }],
    });
    const observation = {
      observationId: 'obs-1',
      bookId: BOOK,
      cycleId: CYCLE,
      versionId: january.versionId,
      observedPool: sar(900),
      boundaryLocalDate: '2026-01-15',
      boundaryLocalTime: '12:00:00',
      boundaryInstantMs: null,
      boundaryTimeZone: 'Asia/Riyadh',
      currencyLabel: null,
      note: '',
      capturedAtInstantMs: 1,
      capturedInTimeZone: 'Asia/Riyadh',
      calculationVersion: 'p03-test',
      sourceOperationId: 'op-reality',
    };
    const adjustment = {
      kind: 'adjustment',
      adjustmentId: 'adj-1',
      bookId: BOOK,
      cycleId: CYCLE,
      observationId: 'obs-1',
      amount: sar(-100),
      classificationNote: 'cash check',
      capturedAtInstantMs: 1,
      capturedInTimeZone: 'Asia/Riyadh',
      calculationVersion: 'p03-test',
      sourceOperationId: 'op-reality',
    };
    const validSigned = settlementFor(january, { netAdjustments: sar(-100), availability: sar(900) });
    const validClose = closeOp(january, validSigned);
    const closeAfterReality = {
      ...validClose,
      receipt: {
        ...validClose.receipt,
        revisionBefore: 3,
        revisionAfter: 4,
      },
    } as OperationRecord;
    const validBook = {
      ...emptyBook(4),
      cycles: [january],
      observations: [observation],
      adjustments: [adjustment],
      settlements: [validSigned],
    } as unknown as BookState;
    expectOk(validateRepositorySnapshotGraph(remoteHistory(validBook, [reality, closeAfterReality])));

    const inflow = inflowTemplate();
    const negativeEffect = withEffects(inflowOp(), [{
      kind: 'inflowRecorded',
      entryId: 'inflow-1',
      cycleId: CYCLE,
      localDate: '2026-01-02',
      amount: sar(-1),
    }]);
    expectFail(
      validateRepositorySnapshotGraph(remoteHistory({ ...emptyBook(3), cycles: [january], entries: [inflow] }, [negativeEffect])),
      'malformed-record',
    );
  });

  it('validates large histories in linear time', () => {
    const count = 2500;
    const local = operation({ operationId: 'op-0', enqueueSequence: 1, revisionBefore: 0, commandKind: 'createBook' });
    const operations: OperationRecord[] = [local];
    const entries: LedgerEntry[] = [];
    for (let index = 1; index < count; index += 1) {
      const entryId = `inflow-${index}`;
      entries.push({
        ...inflowTemplate(),
        entryId,
        sourceOperationId: `op-${index}`,
        localDate: '2026-01-02',
      } as LedgerEntry);
      operations.push(operation({
        operationId: `op-${index}`,
        enqueueSequence: index + 10,
        revisionBefore: index,
        commandKind: 'recordInflow',
        deviceId: REMOTE,
        command: {
          kind: 'recordInflow',
          bookId: BOOK,
          amount: sar(50),
          occurredAt: { kind: 'civilDate', localDate: '2026-01-02' },
          note: '',
        },
        effects: [{
          kind: 'inflowRecorded',
          entryId,
          cycleId: CYCLE,
          localDate: '2026-01-02',
          amount: sar(50),
        }],
      }));
    }
    const remoteOpen = openCycleOp({ operationId: 'op-open', enqueueSequence: 2, revisionBefore: 1 });
    operations.splice(1, 0, remoteOpen);
    for (let index = 2; index < operations.length; index += 1) {
      operations[index] = {
        ...operations[index]!,
        receipt: { ...operations[index]!.receipt, revisionBefore: index, revisionAfter: index + 1 },
      } as OperationRecord;
    }
    const applied = operations.slice(1).map((op, index) => pulledFrom(op, index + 1));
    const started = Date.now();
    const result = validateRepositorySnapshotGraph({
      books: [{ ...emptyBook(operations.length), cycles: [januaryCycle()], entries }],
      operations,
      outbox: [outboxFor(operations[0]!)],
      delivery: [],
      enqueueSequence: 1,
      localDeviceId: DEVICE,
      checkpoints: {
        scopeId: SCOPE,
        streams: [{ streamId: 'stream:large', cursor: 'cursor-large', batchDigest: '1234567890abcdef', applied }],
      },
    });
    const elapsed = Date.now() - started;
    expectOk(result);
    expect(elapsed).toBeLessThan(5000);
    expect(operations.length).toBe(count + 1);
  });
});
