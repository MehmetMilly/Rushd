import { describe, expect, it } from 'vitest';
import { canonicalJson, executeCommand, MAX_REPRESENTABLE_INSTANT_MS, previewCommand, stableDigest } from '../../src/application/commands';
import { requireCommandContext, type CommandContext } from '../../src/application/commands/context';
import { makeBookId, makeOperationId, type OperationId } from '../../src/domain/contracts/identity';
import type { RepositoryTransaction } from '../../src/domain/contracts/repository';
import { createDeterministicContext } from './support/deterministic-context';
import { ConcurrencyConflictError, InMemoryFinanceRepository } from './support/in-memory-repository';

const BOOK_ID = 'book-atomic';
const BOOK_ID_2 = 'book-other';

function branded<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok) throw new Error('invalid test id');
  return result.value as T;
}

const bookId = branded(makeBookId(BOOK_ID));
const bookId2 = branded(makeBookId(BOOK_ID_2));

function op(raw: string): OperationId {
  return branded(makeOperationId(raw));
}

const createBook = {
  kind: 'createBook',
  bookId: BOOK_ID,
  displayName: 'atomic book',
  currency: 'SAR',
  timeZone: 'Asia/Riyadh',
  cycleAnchor: { kind: 'firstOfMonth' },
};

const createBook2 = {
  kind: 'createBook',
  bookId: BOOK_ID_2,
  displayName: 'other book',
  currency: 'KWD',
  timeZone: 'Asia/Riyadh',
  cycleAnchor: { kind: 'firstOfMonth' },
};

const openCycle = {
  kind: 'openCycle',
  bookId: BOOK_ID,
  startDate: '2026-09-01',
  startingFunds: { currency: 'SAR', minorUnits: 80_000 },
};

interface Harness {
  repo: InMemoryFinanceRepository;
  context: CommandContext;
}

function makeHarness(): Harness {
  const repo = new InMemoryFinanceRepository();
  const { context } = createDeterministicContext();
  return { repo, context: requireCommandContext(context) };
}

async function previewAndExecute(harness: Harness, operationId: string, rawCommand: unknown) {
  const preview = previewCommand(harness.repo, rawCommand, harness.context);
  expect(preview.ok).toBe(true);
  if (!preview.ok) throw new Error('unreachable');
  return executeCommand(
    harness.repo,
    rawCommand,
    { operationId: op(operationId), expectedRevision: preview.preview.expectedRevision, previewDigest: preview.preview.previewDigest },
    harness.context,
  );
}

async function seededHarness(): Promise<Harness> {
  const harness = makeHarness();
  await previewAndExecute(harness, 'op-create', createBook);
  await previewAndExecute(harness, 'op-cycle', openCycle);
  await previewAndExecute(harness, 'op-inflow-1', {
    kind: 'recordInflow',
    bookId: BOOK_ID,
    amount: { currency: 'SAR', minorUnits: 10_000 },
    occurredAt: { kind: 'civilDate', localDate: '2026-09-03' },
    note: '',
  });
  return harness;
}

describe('atomic all-or-nothing behavior', () => {
  it('leaves state, journal, and outbox unchanged when any tentative write fails', async () => {
    const inflow = {
      kind: 'recordInflow',
      bookId: BOOK_ID,
      amount: { currency: 'SAR', minorUnits: 25_000 },
      occurredAt: { kind: 'civilDate', localDate: '2026-09-20' },
      note: '',
    };

    for (const method of ['putBookState', 'putOperation', 'putOutboxEntry'] as const) {
      const harness = await seededHarness();
      const before = harness.repo.getBookState(bookId);
      const revisionBefore = before?.revision;
      const entriesBefore = JSON.stringify(before?.entries);
      const outboxBefore = harness.repo.listOutbox().length;
      const failedOperationId = op(`op-fail-${method}`);

      harness.repo.injectWriteFailure(method);
      const preview = previewCommand(harness.repo, inflow, harness.context);
      expect(preview.ok).toBe(true);
      if (!preview.ok) throw new Error('unreachable');
      await expect(
        executeCommand(
          harness.repo,
          inflow,
          { operationId: failedOperationId, expectedRevision: preview.preview.expectedRevision, previewDigest: preview.preview.previewDigest },
          harness.context,
        ),
      ).rejects.toThrow(new RegExp(`injected adapter failure at ${method}`));

      const after = harness.repo.getBookState(bookId);
      expect(after?.revision).toBe(revisionBefore);
      expect(JSON.stringify(after?.entries)).toBe(entriesBefore);
      expect(harness.repo.listOutbox()).toHaveLength(outboxBefore);
      expect(harness.repo.getOperation(failedOperationId)).toBeNull();

      // The same operation succeeds once the adapter stops failing; the
      // failed attempt left no journal entry behind.
      const recovered = await previewAndExecute(harness, `op-fail-${method}`, inflow);
      expect(recovered.ok).toBe(true);
      expect(harness.repo.getOperation(failedOperationId)).not.toBeNull();
      expect(harness.repo.getBookState(bookId)?.entries).toHaveLength((before?.entries.length ?? 0) + 1);
    }
  });

  it('rejects a write whose committed state changed during the transaction', async () => {
    const harness = await seededHarness();
    const revisionBefore = harness.repo.getBookState(bookId)?.revision;

    let releaseSlowTransaction!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseSlowTransaction = resolve;
    });
    let conflict: unknown = null;

    const slow = harness.repo.runTransaction(async (transaction: RepositoryTransaction) => {
      const state = transaction.getBookState(bookId);
      if (state === null) throw new Error('book disappeared during test');
      await gate;
      try {
        transaction.putBookState({
          ...state,
          revision: state.revision + 1,
          entries: [...state.entries],
        });
      } catch (error) {
        conflict = error;
        throw error;
      }
    });

    // While the first transaction is parked, a competing command commits.
    const competing = await previewAndExecute(harness, 'op-competing', {
      kind: 'recordInflow',
      bookId: BOOK_ID,
      amount: { currency: 'SAR', minorUnits: 5_000 },
      occurredAt: { kind: 'civilDate', localDate: '2026-09-21' },
      note: '',
    });
    expect(competing.ok).toBe(true);

    releaseSlowTransaction();
    await expect(slow).rejects.toBeInstanceOf(ConcurrencyConflictError);
    expect(conflict).toBeInstanceOf(ConcurrencyConflictError);

    expect(harness.repo.getBookState(bookId)?.revision).toBe((revisionBefore ?? 0) + 1);
    expect(harness.repo.getBookState(bookId)?.entries).toHaveLength(2);
  });
});

describe('competing commands against one base revision', () => {
  it('lets exactly one of two previews commit; the other fails stale', async () => {
    const harness = await seededHarness();

    const commandA = {
      kind: 'recordInflow',
      bookId: BOOK_ID,
      amount: { currency: 'SAR', minorUnits: 1_000 },
      occurredAt: { kind: 'civilDate', localDate: '2026-09-10' },
      note: 'A',
    };
    const commandB = {
      kind: 'recordInflow',
      bookId: BOOK_ID,
      amount: { currency: 'SAR', minorUnits: 2_000 },
      occurredAt: { kind: 'civilDate', localDate: '2026-09-11' },
      note: 'B',
    };

    const previewA = previewCommand(harness.repo, commandA, harness.context);
    const previewB = previewCommand(harness.repo, commandB, harness.context);
    expect(previewA.ok && previewB.ok).toBe(true);
    if (!previewA.ok || !previewB.ok) throw new Error('unreachable');
    expect(previewA.preview.expectedRevision).toBe(previewB.preview.expectedRevision);

    const executedA = await executeCommand(
      harness.repo,
      commandA,
      { operationId: op('op-A'), expectedRevision: previewA.preview.expectedRevision, previewDigest: previewA.preview.previewDigest },
      harness.context,
    );
    expect(executedA.ok).toBe(true);

    const executedB = await executeCommand(
      harness.repo,
      commandB,
      { operationId: op('op-B'), expectedRevision: previewB.preview.expectedRevision, previewDigest: previewB.preview.previewDigest },
      harness.context,
    );
    expect(executedB.ok).toBe(false);
    if (!executedB.ok) expect(executedB.failure.kind).toBe('revisionConflict');

    const state = harness.repo.getBookState(bookId);
    expect(state?.entries).toHaveLength(2);
    expect(state?.entries.some((entry) => entry.note === 'A')).toBe(true);
    expect(state?.entries.some((entry) => entry.note === 'B')).toBe(false);
    expect(executedA.ok ? executedA.receipt.revisionAfter : 0).toBe(state?.revision);
  });
});

describe('invalid runtime input and cross-book references', () => {
  it('never mutates state for malformed commands', async () => {
    const harness = await seededHarness();
    const revisionBefore = harness.repo.getBookState(bookId)?.revision;

    const malformedPayloads = [
      null,
      42,
      'recordInflow',
      [],
      { kind: 'recordInflow' },
      { kind: 'recordInflow', bookId: BOOK_ID, amount: { currency: 'SAR', minorUnits: 5, text: '5' }, occurredAt: { kind: 'civilDate', localDate: '2026-09-10' }, note: '' },
      { kind: 'recordInflow', bookId: BOOK_ID, amount: { currency: 'EUR', minorUnits: 5 }, occurredAt: { kind: 'civilDate', localDate: '2026-09-10' }, note: '' },
      { kind: 'recordInflow', bookId: BOOK_ID, amount: { currency: 'SAR', text: '5.005' }, occurredAt: { kind: 'civilDate', localDate: '2026-09-10' }, note: '' },
      { kind: 'recordInflow', bookId: BOOK_ID, amount: { currency: 'SAR', minorUnits: 5 }, occurredAt: { kind: 'civilDate', localDate: '2026-02-30' }, note: '' },
      { kind: 'recordInflow', bookId: BOOK_ID, amount: { currency: 'SAR', minorUnits: 5 }, occurredAt: { kind: 'instant', instantMs: 1.5 }, note: '' },
    ];

    for (const [index, payload] of malformedPayloads.entries()) {
      const result = await executeCommand(
        harness.repo,
        payload,
        // Digests cannot be known for invalid commands; validation fails first.
        { operationId: op(`op-bad-${index}`), expectedRevision: 0, previewDigest: '0000000000000000' },
        harness.context,
      );
      expect(result.ok, `payload ${index}`).toBe(false);
      if (!result.ok) {
        expect(['invalidCommand', 'invalidConfirmation', 'previewMismatch']).toContain(result.failure.kind);
      }
    }

    expect(harness.repo.getBookState(bookId)?.revision).toBe(revisionBefore);
    expect(harness.repo.listOutbox().some((envelope) => envelope.operationId.startsWith('op-bad-'))).toBe(false);
  });

  it('rejects instants the platform cannot represent without mutating anything', async () => {
    const harness = await seededHarness();
    const revisionBefore = harness.repo.getBookState(bookId)?.revision;
    const entriesBefore = JSON.stringify(harness.repo.getBookState(bookId)?.entries);
    const outboxBefore = harness.repo.listOutbox().length;

    // Safe integers beyond the Date range fail validation before any state is
    // touched, at preview and at execution.
    for (const instantMs of [Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
      const rawCommand = {
        kind: 'recordInflow',
        bookId: BOOK_ID,
        amount: { currency: 'SAR', minorUnits: 500 },
        occurredAt: { kind: 'instant', instantMs },
        note: '',
      };
      const preview = previewCommand(harness.repo, rawCommand, harness.context);
      expect(preview.ok, String(instantMs)).toBe(false);
      if (!preview.ok) {
        expect(preview.failure.kind).toBe('invalidCommand');
        if (preview.failure.kind === 'invalidCommand') {
          expect(preview.failure.issues.some((issue) => issue.startsWith('occurredAt.instantMs:'))).toBe(true);
        }
      }
      const result = await executeCommand(
        harness.repo,
        rawCommand,
        { operationId: op(`op-range-${instantMs < 0 ? 'neg' : 'pos'}`), expectedRevision: 0, previewDigest: '0000000000000000' },
        harness.context,
      );
      expect(result.ok, String(instantMs)).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe('invalidCommand');
      expect(harness.repo.getOperation(op(`op-range-${instantMs < 0 ? 'neg' : 'pos'}`))).toBeNull();
    }

    // A representable instant whose civil resolution falls outside the
    // supported Gregorian range passes validation and fails in the handler
    // with a typed failure — never a thrown RangeError.
    const beyondCivilRange = {
      kind: 'recordInflow',
      bookId: BOOK_ID,
      amount: { currency: 'SAR', minorUnits: 500 },
      occurredAt: { kind: 'instant', instantMs: MAX_REPRESENTABLE_INSTANT_MS },
      note: '',
    };
    const beyondPreview = previewCommand(harness.repo, beyondCivilRange, harness.context);
    expect(beyondPreview.ok).toBe(false);
    if (!beyondPreview.ok) expect(beyondPreview.failure.kind).toBe('invalidOccurredAt');

    const revisionNow = harness.repo.getBookState(bookId)?.revision ?? 0;
    const beyondExecute = await executeCommand(
      harness.repo,
      beyondCivilRange,
      { operationId: op('op-range-civil'), expectedRevision: revisionNow, previewDigest: stableDigest(`${canonicalJson(beyondCivilRange)}\n${String(revisionNow)}`) },
      harness.context,
    );
    expect(beyondExecute.ok).toBe(false);
    if (!beyondExecute.ok) expect(beyondExecute.failure.kind).toBe('invalidOccurredAt');
    expect(harness.repo.getOperation(op('op-range-civil'))).toBeNull();

    // Every rejected attempt left state, journal, and outbox untouched.
    expect(harness.repo.getBookState(bookId)?.revision).toBe(revisionBefore);
    expect(JSON.stringify(harness.repo.getBookState(bookId)?.entries)).toBe(entriesBefore);
    expect(harness.repo.listOutbox()).toHaveLength(outboxBefore);

    // An ordinary valid timestamp still records normally after the rejections.
    const validInstant = await previewAndExecute(harness, 'op-instant-valid', {
      kind: 'recordInflow',
      bookId: BOOK_ID,
      amount: { currency: 'SAR', minorUnits: 700 },
      occurredAt: { kind: 'instant', instantMs: Date.UTC(2026, 8, 10, 9, 0, 0) },
      note: '',
    });
    expect(validInstant.ok).toBe(true);
    expect(harness.repo.getBookState(bookId)?.entries).toHaveLength(2);
    expect(harness.repo.listOutbox()).toHaveLength(outboxBefore + 1);
  });

  it('rejects cross-book reversal references without mutating either book', async () => {
    const harness = await seededHarness();
    await previewAndExecute(harness, 'op-create-2', createBook2);

    // Book 2 has no open cycle yet, so its own inflow fails without writing.
    const prematurePreview = previewCommand(harness.repo, {
      kind: 'recordInflow',
      bookId: BOOK_ID_2,
      amount: { currency: 'KWD', minorUnits: 500 },
      occurredAt: { kind: 'civilDate', localDate: '2026-09-10' },
      note: '',
    }, harness.context);
    expect(prematurePreview.ok).toBe(false);
    if (!prematurePreview.ok) expect(prematurePreview.failure.kind).toBe('noOpenCycle');

    await previewAndExecute(harness, 'op-cycle-2', {
      kind: 'openCycle',
      bookId: BOOK_ID_2,
      startDate: '2026-09-01',
      startingFunds: { currency: 'KWD', minorUnits: 0 },
    });
    // The same operation ID succeeds once the state allows it: a failed
    // operation never consumes its identity.
    const recordedOther = await previewAndExecute(harness, 'op-inflow-other', {
      kind: 'recordInflow',
      bookId: BOOK_ID_2,
      amount: { currency: 'KWD', minorUnits: 500 },
      occurredAt: { kind: 'civilDate', localDate: '2026-09-10' },
      note: '',
    });
    expect(recordedOther.ok).toBe(true);

    const otherEntryId = harness.repo.getBookState(bookId2)?.entries[0]?.entryId;
    expect(otherEntryId).toBeTruthy();

    const revisionBefore = harness.repo.getBookState(bookId)?.revision;
    const revision2Before = harness.repo.getBookState(bookId2)?.revision;

    const crossBookCommand = {
      kind: 'reverseInflow',
      bookId: BOOK_ID,
      inflowEntryId: otherEntryId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-10' },
      note: '',
    };

    // The preview itself rejects: the entry belongs to book 2, an explicit
    // cross-book rejection rather than a silent unknown-entry rewrite.
    const crossBookPreview = previewCommand(harness.repo, crossBookCommand, harness.context);
    expect(crossBookPreview.ok).toBe(false);
    if (!crossBookPreview.ok) {
      expect(crossBookPreview.failure.kind).toBe('crossBookReference');
      if (crossBookPreview.failure.kind === 'crossBookReference') {
        expect(crossBookPreview.failure.entryBookId).toBe(BOOK_ID_2);
      }
    }

    // Execution-level with a correctly bound confirmation: same rejection.
    const revision1 = harness.repo.getBookState(bookId)?.revision ?? 0;
    const crossBookExecute = await executeCommand(
      harness.repo,
      crossBookCommand,
      { operationId: op('op-cross'), expectedRevision: revision1, previewDigest: stableDigest(`${canonicalJson(crossBookCommand)}\n${String(revision1)}`) },
      harness.context,
    );
    expect(crossBookExecute.ok).toBe(false);
    if (!crossBookExecute.ok) {
      expect(crossBookExecute.failure.kind).toBe('crossBookReference');
    }

    expect(harness.repo.getBookState(bookId)?.revision).toBe(revisionBefore);
    expect(harness.repo.getBookState(bookId2)?.revision).toBe(revision2Before);
  });
});

describe('repository internals do not leak', () => {
  it('returns frozen snapshots that cannot corrupt committed state', async () => {
    const harness = await seededHarness();
    const snapshot = harness.repo.getBookState(bookId);
    expect(snapshot).not.toBeNull();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.book)).toBe(true);
    expect(Object.isFrozen(snapshot?.entries)).toBe(true);
    expect(Object.isFrozen(snapshot?.entries[0])).toBe(true);

    expect(() => {
      (snapshot as { revision: number }).revision = 999;
    }).toThrow(TypeError);
    expect(() => {
      (snapshot?.entries as unknown as unknown[]).push({ kind: 'inflow' });
    }).toThrow(TypeError);

    const reread = harness.repo.getBookState(bookId);
    expect(JSON.stringify(reread)).toBe(JSON.stringify(snapshot));
    expect(reread?.revision).not.toBe(999);
  });
});
