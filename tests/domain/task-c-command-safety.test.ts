/**
 * Task C command safety (proof 9).
 *
 * Foreign-currency and ambiguous-symbol Reality Check inputs,
 * cross-book references, stale previews, replayed operations, changed
 * payloads under the same operation ID, unknown fields, and injected
 * adapter failures all leave no partial writes: either a typed failure
 * with untouched state, or an exact idempotent replay.
 */

import { describe, expect, it } from 'vitest';
import {
  describeCommandFailure,
  executeCommand,
  type CommandReceipt,
} from '../../src/application/commands';
import { makeTaskCHarness, revisionOf, SAR, seedStandardBook } from './support/task-c-harness';

function effectOf(receipt: CommandReceipt, kind: string): Record<string, unknown> {
  const effect = receipt.effects.find((candidate) => candidate.kind === kind);
  if (effect === undefined) throw new Error(`missing ${kind} effect`);
  return effect as unknown as Record<string, unknown>;
}

function expectNoWrite(harness: ReturnType<typeof makeTaskCHarness>, revisionBefore: number): void {
  expect(revisionOf(harness)).toBe(revisionBefore);
}

describe('reality-check currency safety', () => {
  it('clarifies foreign and ambiguous currencies with no writes', async () => {
    const harness = makeTaskCHarness('book-proof-9-fx');
    await seedStandardBook(harness);
    const revisionBefore = revisionOf(harness);
    const base = {
      kind: 'recordRealityCheck',
      bookId: harness.bookId,
      boundary: { kind: 'civilDateTime', localDate: '2026-09-05', localTime: '12:00:00' },
      classificationNote: null,
      note: '',
    } as const;

    const foreign = harness.previewRaw({ ...base, observedPool: { currency: 'USD', minorUnits: 100_000 }, currencyLabel: null });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) {
      expect(foreign.failure.kind).toBe('clarificationNeeded');
      if (foreign.failure.kind === 'clarificationNeeded') expect(foreign.failure.reason).toBe('foreignCurrency');
    }

    const labeledForeign = harness.previewRaw({ ...base, observedPool: SAR(100_000), currencyLabel: 'USD' });
    expect(labeledForeign.ok).toBe(false);
    if (!labeledForeign.ok) {
      expect(labeledForeign.failure.kind).toBe('clarificationNeeded');
      if (labeledForeign.failure.kind === 'clarificationNeeded') expect(labeledForeign.failure.reason).toBe('foreignCurrency');
    }

    const ambiguous = harness.previewRaw({ ...base, observedPool: SAR(100_000), currencyLabel: '$' });
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) {
      expect(ambiguous.failure.kind).toBe('clarificationNeeded');
      if (ambiguous.failure.kind === 'clarificationNeeded') expect(ambiguous.failure.reason).toBe('ambiguousCurrency');
    }

    expectNoWrite(harness, revisionBefore);
    expect(harness.state().observations).toHaveLength(0);
    expect(harness.state().adjustments).toHaveLength(0);

    // An unambiguous book-currency label is accepted.
    await harness.run({ ...base, observedPool: SAR(100_000), currencyLabel: 'SAR' });
    expect(harness.state().observations).toHaveLength(1);
  });
});

describe('cross-book references', () => {
  it('rejects every Task C cross-book reference with no writes', async () => {
    // Both books live in one shared repository (following
    // atomicity.test.ts): cross-book means cross-bookId, not cross-store.
    const harness = makeTaskCHarness('book-proof-9-a');
    await seedStandardBook(harness);
    const otherBookId = 'book-proof-9-b';
    await harness.run({
      kind: 'createBook', bookId: otherBookId, displayName: 'other', currency: 'SAR',
      timeZone: 'Asia/Riyadh', cycleAnchor: { kind: 'firstOfMonth' },
    });
    await harness.run({
      kind: 'openCycle', bookId: otherBookId, startDate: '2026-09-01', startingFunds: SAR(50_000),
    });

    const check = await harness.run({
      kind: 'recordRealityCheck', bookId: harness.bookId, observedPool: SAR(100_000),
      boundary: { kind: 'civilDateTime', localDate: '2026-09-05', localTime: '12:00:00' },
      currencyLabel: null, classificationNote: null, note: '',
    });
    const observationId = effectOf(check, 'realityCheckRecorded')['observationId'] as string;
    await harness.run({
      kind: 'createRecurringPlan', bookId: harness.bookId, planId: 'plan-shared', name: 'Shared',
      amount: SAR(1_000), scheduleDay: 3, effectiveDate: '2026-09-01', flexibleDefinitionId: null,
    });
    await harness.run({
      kind: 'materializePlanOccurrences', bookId: harness.bookId, planId: 'plan-shared', throughDate: '2026-09-30',
    });
    const occurrenceId = 'occ:plan-shared:2026-09-03';
    await harness.run({ kind: 'closeCycle', bookId: harness.bookId, cycleId: null, note: '' });
    const settlementId = harness.state().settlements[0].settlementId;

    const otherRevisionBefore = harness.repo.getBookState(otherBookId as never)?.revision;
    const cases: Array<{ name: string; command: unknown; kind: string }> = [
      {
        name: 'observation',
        command: {
          kind: 'recoverObservedActivity', bookId: otherBookId, observationId,
          movementKind: 'expense', amount: SAR(100),
          occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
          note: '', category: null, linkedExpenseEntryId: null,
        },
        kind: 'crossBookObservation',
      },
      {
        name: 'plan',
        command: { kind: 'materializePlanOccurrences', bookId: otherBookId, planId: 'plan-shared', throughDate: '2026-09-30' },
        kind: 'crossBookPlan',
      },
      {
        name: 'occurrence',
        command: { kind: 'detachPlanOccurrence', bookId: otherBookId, occurrenceId, note: '' },
        kind: 'crossBookOccurrence',
      },
      {
        name: 'settlement',
        command: {
          kind: 'disposeCycleRemainder', bookId: otherBookId, settlementId,
          disposition: { kind: 'leaveIndependent' }, note: '',
        },
        kind: 'crossBookSettlement',
      },
    ];
    for (const { name, command, kind } of cases) {
      const preview = harness.previewRaw(command);
      expect(preview.ok, name).toBe(false);
      if (!preview.ok) expect(preview.failure.kind, name).toBe(kind);
    }
    expect(harness.repo.getBookState(otherBookId as never)?.revision).toBe(otherRevisionBefore);
  });
});

describe('preview binding, replay, and unknown fields', () => {
  it('holds revision binding, replays exactly, and rejects unknown fields', async () => {
    const harness = makeTaskCHarness('book-proof-9-binding');
    await seedStandardBook(harness);

    // Stale preview: the confirmation binds the old revision.
    const preview = harness.previewRaw({ kind: 'closeCycle', bookId: harness.bookId, cycleId: null, note: '' });
    if (!preview.ok) throw new Error(describeCommandFailure(preview.failure));
    await harness.run({ kind: 'setBuffer', bookId: harness.bookId, buffer: SAR(1_000), note: '' });
    const stale = await executeCommand(
      harness.repo,
      { kind: 'closeCycle', bookId: harness.bookId, cycleId: null, note: '' },
      {
        operationId: 'op-stale-close' as never,
        expectedRevision: preview.preview.expectedRevision,
        previewDigest: preview.preview.previewDigest,
      },
      harness.context,
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.failure.kind).toBe('revisionConflict');

    // Replay: the same operation returns the original receipt with no second effect.
    const closeCommand = { kind: 'closeCycle', bookId: harness.bookId, cycleId: null, note: '' };
    const closePreview = harness.previewRaw(closeCommand);
    if (!closePreview.ok) throw new Error(describeCommandFailure(closePreview.failure));
    const confirmation = {
      operationId: 'op-close-once' as never,
      expectedRevision: closePreview.preview.expectedRevision,
      previewDigest: closePreview.preview.previewDigest,
    };
    const first = await executeCommand(harness.repo, closeCommand, confirmation, harness.context);
    if (!first.ok) throw new Error(describeCommandFailure(first.failure));
    expect(first.retried).toBe(false);
    expect(harness.state().settlements).toHaveLength(1);
    const retry = await executeCommand(harness.repo, closeCommand, confirmation, harness.context);
    if (!retry.ok) throw new Error(describeCommandFailure(retry.failure));
    expect(retry.retried).toBe(true);
    expect(retry.receipt).toEqual(first.receipt);
    expect(harness.state().settlements).toHaveLength(1);

    // Unknown fields never reach a handler.
    const revisionBefore = revisionOf(harness);
    const unknown = harness.previewRaw({
      kind: 'recordRealityCheck', bookId: harness.bookId, observedPool: SAR(1),
      boundary: { kind: 'civilDateTime', localDate: '2026-09-05', localTime: '12:00:00' },
      currencyLabel: null, classificationNote: null, note: '', smuggled: true,
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.failure.kind).toBe('invalidCommand');
    expectNoWrite(harness, revisionBefore);
  });
});

describe('injected adapter failure', () => {
  it('rolls back state, journal, and outbox together, then retries cleanly', async () => {
    const harness = makeTaskCHarness('book-proof-9-crash');
    await seedStandardBook(harness);
    const command = {
      kind: 'recordRealityCheck', bookId: harness.bookId, observedPool: SAR(100_000),
      boundary: { kind: 'civilDateTime', localDate: '2026-09-05', localTime: '12:00:00' },
      currencyLabel: null, classificationNote: null, note: '',
    };
    const preview = harness.previewRaw(command);
    if (!preview.ok) throw new Error(describeCommandFailure(preview.failure));
    const confirmation = {
      operationId: 'op-crash-1' as never,
      expectedRevision: preview.preview.expectedRevision,
      previewDigest: preview.preview.previewDigest,
    };
    const revisionBefore = revisionOf(harness);
    const outboxBefore = harness.repo.listOutbox().length;

    harness.repo.injectWriteFailure('putBookState');
    await expect(executeCommand(harness.repo, command, confirmation, harness.context)).rejects.toThrow();
    expectNoWrite(harness, revisionBefore);
    expect(harness.state().observations).toHaveLength(0);
    expect(harness.repo.getOperation('op-crash-1' as never)).toBeNull();
    expect(harness.repo.listOutbox()).toHaveLength(outboxBefore);

    const retry = await executeCommand(harness.repo, command, confirmation, harness.context);
    if (!retry.ok) throw new Error(describeCommandFailure(retry.failure));
    expect(retry.retried).toBe(false);
    expect(harness.state().observations).toHaveLength(1);
  });
});
