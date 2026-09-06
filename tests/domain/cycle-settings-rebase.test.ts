/**
 * Settings revisions and open-cycle rebase (proof 5).
 *
 * Default timezone/payday edits govern the next unopened cycle only: the
 * open cycle, its window, and every captured fact stay put. Moving the open
 * cycle requires a separate previewed rebase that supersedes the prior
 * version, reports its deltas, and never re-dates activity. Retries replay,
 * stale confirmations conflict, and a repeated rebase writes nothing.
 */

import { describe, expect, it } from 'vitest';
import { describeCommandFailure, effectiveVersionStatus, executeCommand, findOpenCycle, previewCommand, type CommandReceipt } from '../../src/application/commands';
import { makeTaskCHarness, revisionOf, SAR, seedStandardBook } from './support/task-c-harness';

function effectOf(receipt: CommandReceipt, kind: string): Record<string, unknown> {
  const effect = receipt.effects.find((candidate) => candidate.kind === kind);
  if (effect === undefined) throw new Error(`missing ${kind} effect`);
  return effect as unknown as Record<string, unknown>;
}

describe('settings revisions default to the next unopened cycle', () => {
  it('leaves the open cycle, its window, and captured facts untouched', async () => {
    const harness = makeTaskCHarness('book-proof-5');
    await seedStandardBook(harness);
    await harness.run({
      kind: 'recordExpense', bookId: harness.bookId, amount: SAR(5_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: '', category: 'food', flexibleDefinitionId: null,
    });
    const availabilityBefore = harness.availableMinor();

    await harness.run({
      kind: 'updateBookSettings',
      bookId: harness.bookId,
      timeZone: null,
      cycleAnchor: { kind: 'payday', dayOfMonth: 15 },
      weekStart: 6,
      effectiveDate: '2026-10-15',
      note: 'payday moves',
    });

    const state = harness.state();
    const open = findOpenCycle(state);
    expect(open?.startDate).toBe('2026-09-01');
    expect(open?.endDateExclusive).toBe('2026-10-01');
    expect(open?.anchor).toEqual({ kind: 'firstOfMonth' });
    expect(open?.versionSeq).toBe(1);
    expect(state.entries[0]).toMatchObject({ localDate: '2026-09-04', cycleId: `cyc:${harness.bookId}:2026-09-01` });
    expect(harness.availableMinor()).toBe(availabilityBefore);

    // The next cycle opens under the new payday anchor.
    await harness.run({ kind: 'closeCycle', bookId: harness.bookId, cycleId: null, note: 'close sept' });
    const october = await harness.run({
      kind: 'openCycle', bookId: harness.bookId, startDate: '2026-10-15', startingFunds: SAR(50_000),
    });
    expect(effectOf(october, 'cycleOpened')['startDate']).toBe('2026-10-15');
    expect(effectOf(october, 'cycleOpened')['endDateExclusive']).toBe('2026-11-15');
  });

  it('rejects effective dates that would move current or closed cycles', async () => {
    const harness = makeTaskCHarness('book-proof-5-guard');
    await seedStandardBook(harness);
    const revisionBefore = revisionOf(harness);
    const current = harness.previewRaw({
      kind: 'updateBookSettings', bookId: harness.bookId, timeZone: null,
      cycleAnchor: { kind: 'payday', dayOfMonth: 20 }, weekStart: null, effectiveDate: '2026-09-01', note: '',
    });
    expect(current.ok).toBe(false);
    if (!current.ok) expect(current.failure.kind).toBe('invalidEffectiveDate');
    const misaligned = harness.previewRaw({
      kind: 'updateBookSettings', bookId: harness.bookId, timeZone: null,
      cycleAnchor: { kind: 'payday', dayOfMonth: 20 }, weekStart: null, effectiveDate: '2026-10-03', note: '',
    });
    expect(misaligned.ok).toBe(false);
    if (!misaligned.ok) expect(misaligned.failure.kind).toBe('invalidEffectiveDate');
    expect(revisionOf(harness)).toBe(revisionBefore);
  });

  it('versions week-start as display policy without touching money', async () => {
    const harness = makeTaskCHarness('book-proof-5-week');
    await seedStandardBook(harness);
    const availabilityBefore = harness.availableMinor();
    await harness.run({
      kind: 'updateBookSettings', bookId: harness.bookId, timeZone: null, cycleAnchor: null,
      weekStart: 1, effectiveDate: '2026-10-01', note: 'weeks start Monday',
    });
    expect(harness.state().settingsRevisions).toHaveLength(1);
    expect(harness.state().settingsRevisions[0]).toMatchObject({ effectiveDate: '2026-10-01', weekStart: 1 });
    expect(harness.availableMinor()).toBe(availabilityBefore);
    const revisionBefore = revisionOf(harness);
    const invalid = harness.previewRaw({
      kind: 'updateBookSettings', bookId: harness.bookId, timeZone: null, cycleAnchor: null,
      weekStart: 7, effectiveDate: '2026-11-01', note: '',
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.failure.kind).toBe('invalidCommand');
    expect(revisionOf(harness)).toBe(revisionBefore);
  });
});

describe('explicit open-cycle rebase', () => {
  it('produces one new version with deterministic boundaries and visible deltas', async () => {
    const harness = makeTaskCHarness('book-proof-5-rebase');
    await seedStandardBook(harness);
    await harness.run({
      kind: 'recordExpense', bookId: harness.bookId, amount: SAR(7_000),
      occurredAt: { kind: 'civilDate', localDate: '2026-09-04' },
      note: '', category: null, flexibleDefinitionId: null,
    });
    const availabilityBefore = harness.availableMinor();

    const rebased = await harness.run({
      kind: 'rebaseOpenCycle', bookId: harness.bookId,
      timeZone: 'Asia/Riyadh', cycleAnchor: { kind: 'payday', dayOfMonth: 15 }, note: 'align to payday',
    });
    const effect = effectOf(rebased, 'openCycleRebased');
    // The payday-15 window containing Sept 1 runs Aug 15 to Sept 15.
    expect(effect['oldStartDate']).toBe('2026-09-01');
    expect(effect['newStartDate']).toBe('2026-08-15');
    expect(effect['newEndDateExclusive']).toBe('2026-09-15');
    expect(effect['allocationDelta']).toEqual(SAR(0));
    expect(effect['carryDelta']).toEqual(SAR(0));

    const state = harness.state();
    const versions = state.cycles.filter((cycle) => cycle.cycleId === `cyc:${harness.bookId}:2026-09-01`);
    expect(versions).toHaveLength(2);
    // Append-only: both version rows are preserved byte-for-byte; the prior
    // row is effectively superseded through the new row's link.
    expect(versions.map((version) => effectiveVersionStatus(state, version)).sort()).toEqual(['open', 'superseded']);
    const open = versions.find((version) => effectiveVersionStatus(state, version) === 'open')!;
    expect(open.versionSeq).toBe(2);
    expect(open.supersedesVersionId).toBe(versions.find((version) => effectiveVersionStatus(state, version) === 'superseded')!.versionId);
    // Captured facts are never re-dated or moved.
    expect(state.entries[0]).toMatchObject({
      localDate: '2026-09-04',
      cycleId: `cyc:${harness.bookId}:2026-09-01`,
      timeZone: 'Asia/Riyadh',
    });
    expect(harness.availableMinor()).toBe(availabilityBefore);
  });

  it('handles forward and backward payday moves plus short-month clamping', async () => {
    const harness = makeTaskCHarness('book-proof-5-moves');
    await seedStandardBook(harness, { startDate: '2026-01-01' });

    const forward = await harness.run({
      kind: 'rebaseOpenCycle', bookId: harness.bookId,
      timeZone: 'Asia/Riyadh', cycleAnchor: { kind: 'payday', dayOfMonth: 28 }, note: 'forward',
    });
    // Payday 28 containing Jan 1: Dec 28 to Jan 28.
    expect(effectOf(forward, 'openCycleRebased')['newStartDate']).toBe('2025-12-28');
    expect(effectOf(forward, 'openCycleRebased')['newEndDateExclusive']).toBe('2026-01-28');

    const backward = await harness.run({
      kind: 'rebaseOpenCycle', bookId: harness.bookId,
      timeZone: 'Asia/Riyadh', cycleAnchor: { kind: 'payday', dayOfMonth: 5 }, note: 'backward',
    });
    // Payday 5 containing Jan 1: Dec 5 to Jan 5.
    expect(effectOf(backward, 'openCycleRebased')['newStartDate']).toBe('2025-12-05');

    const clamp = await harness.run({
      kind: 'rebaseOpenCycle', bookId: harness.bookId,
      timeZone: 'Asia/Riyadh', cycleAnchor: { kind: 'payday', dayOfMonth: 31 }, note: 'month end',
    });
    // The anchor point is now the current version start (Dec 5), so payday
    // 31 containing it runs Nov 30 (clamped: November has 30 days) to Dec 31.
    expect(effectOf(clamp, 'openCycleRebased')['newStartDate']).toBe('2025-11-30');
    expect(effectOf(clamp, 'openCycleRebased')['newEndDateExclusive']).toBe('2025-12-31');
  });

  it('replays retries, rejects stale confirmations, and ignores repeated rebases', async () => {
    const harness = makeTaskCHarness('book-proof-5-retry');
    await seedStandardBook(harness);
    const command = {
      kind: 'rebaseOpenCycle', bookId: harness.bookId,
      timeZone: 'Asia/Riyadh', cycleAnchor: { kind: 'payday', dayOfMonth: 15 }, note: '',
    };
    const preview = previewCommand(harness.repo, command, harness.context);
    if (!preview.ok) throw new Error(describeCommandFailure(preview.failure));
    const confirmation = {
      operationId: 'op-rebase-1' as never,
      expectedRevision: preview.preview.expectedRevision,
      previewDigest: preview.preview.previewDigest,
    };
    const first = await executeCommand(harness.repo, command, confirmation, harness.context);
    if (!first.ok) throw new Error(describeCommandFailure(first.failure));
    expect(first.retried).toBe(false);

    // A stale preview taken before an intervening write conflicts: the same
    // confirmation under a fresh operation ID fails the revision check.
    await harness.run({ kind: 'setBuffer', bookId: harness.bookId, buffer: SAR(1_000), note: '' });
    const stale = await executeCommand(
      harness.repo,
      command,
      { operationId: 'op-rebase-stale' as never, expectedRevision: confirmation.expectedRevision, previewDigest: confirmation.previewDigest },
      harness.context,
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.failure.kind).toBe('revisionConflict');

    // The same operation replays the original receipt without a new preview.
    const replay = await executeCommand(harness.repo, command, confirmation, harness.context);
    if (!replay.ok) throw new Error(describeCommandFailure(replay.failure));
    expect(replay.retried).toBe(true);

    // A conflicting second rebase at the same settings writes nothing.
    const versionsBefore = harness.state().cycles.length;
    const repeated = harness.previewRaw({
      kind: 'rebaseOpenCycle', bookId: harness.bookId,
      timeZone: 'Asia/Riyadh', cycleAnchor: { kind: 'payday', dayOfMonth: 15 }, note: 'again',
    });
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.failure.kind).toBe('rebaseNotNeeded');
    expect(harness.state().cycles.length).toBe(versionsBefore);
  });
});
