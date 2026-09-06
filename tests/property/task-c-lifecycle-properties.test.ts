/**
 * Settlement, carry, reopen, and plan-materialization properties (bounded,
 * seeded).
 *
 * Over random close/dispose/reopen/correct/resolve/materialize/retry
 * sequences the suite asserts the conservation laws against an independent
 * plain-number model: settlement snapshots never change, the effective
 * remainder always equals snapshot plus tracked deltas, availability always
 * equals modeled funds plus carry-in minus modeled outflows, carry sources
 * are consumed at most once, occurrence sets are stable, and retries never
 * change state. The model never reimplements a production derivation.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeAvailability,
  effectiveSettlementRemainder,
  executeCommand,
  previewCommand,
  unresolvedConflicts,
  type CommandConfirmation,
  type CommandReceipt,
} from '../../src/application/commands';
import { makeBookId, makeOperationId, type BookId, type OperationId } from '../../src/domain/contracts/identity';
import { createDeterministicContext } from '../domain/support/deterministic-context';
import { InMemoryFinanceRepository } from '../domain/support/in-memory-repository';
import { PROPERTY_RUNS, propertySeed } from './support/seed';

const SEED = propertySeed(20260922);
const BOOK_ID = 'book-prop-life';
const SEPT_ID = `cyc:${BOOK_ID}:2026-09-01`;
const OCT_ID = `cyc:${BOOK_ID}:2026-10-01`;
const SEPT_FUNDS = 100_000;
const OCT_FUNDS = 50_000;

function operationIdOf(raw: string): OperationId {
  const made = makeOperationId(raw);
  if (!made.ok) throw new Error('invalid test operation id');
  return made.value;
}

function bookIdOf(raw: string): BookId {
  const made = makeBookId(raw);
  if (!made.ok) throw new Error('invalid test book id');
  return made.value;
}

const THE_BOOK_ID = bookIdOf(BOOK_ID);

type LifeOp =
  | { readonly t: 'expense'; readonly amount: number }
  | { readonly t: 'close' }
  | { readonly t: 'carry'; readonly amount: number }
  | { readonly t: 'leave' }
  | { readonly t: 'reopen'; readonly cycle: 'sept' | 'oct' }
  | { readonly t: 'openNext' }
  | { readonly t: 'correct'; readonly amount: number }
  | { readonly t: 'resolve' }
  | { readonly t: 'materialize' }
  | { readonly t: 'retry' };

const smallArb = fc.integer({ min: 100, max: 20_000 });
const largeArb = fc.integer({ min: 60_000, max: 150_000 });
const moneyArb = fc.oneof(
  { arbitrary: smallArb, weight: 3 },
  { arbitrary: largeArb, weight: 1 },
);
const opArb: fc.Arbitrary<LifeOp> = fc.oneof(
  { arbitrary: fc.record({ t: fc.constant('expense' as const), amount: smallArb }), weight: 3 },
  { arbitrary: fc.constant({ t: 'close' as const }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('carry' as const), amount: moneyArb }), weight: 2 },
  { arbitrary: fc.constant({ t: 'leave' as const }), weight: 1 },
  {
    arbitrary: fc.record({ t: fc.constant('reopen' as const), cycle: fc.constantFrom('sept' as const, 'oct' as const) }),
    weight: 1,
  },
  { arbitrary: fc.constant({ t: 'openNext' as const }), weight: 1 },
  { arbitrary: fc.record({ t: fc.constant('correct' as const), amount: moneyArb }), weight: 2 },
  { arbitrary: fc.constant({ t: 'resolve' as const }), weight: 1 },
  { arbitrary: fc.constant({ t: 'materialize' as const }), weight: 1 },
  { arbitrary: fc.constant({ t: 'retry' as const }), weight: 1 },
);

interface ModelSettlement {
  id: string;
  cycle: string;
  snapshot: number;
  deltas: number[];
  consumed: boolean;
  /** Carry destination, if the disposition moved money downstream. */
  dest: string | null;
  /** Destination intent changed after the disposition landed. */
  touched: boolean;
}

interface ModelConflict {
  amount: number;
  resolved: boolean;
}

describe('settlement and carry properties (bounded, seeded)', () => {
  it('conserves money across close, carry, reopen, correction, and retry', async () => {
    const executeScenario = async (operations: LifeOp[]): Promise<void> => {
      const repo = new InMemoryFinanceRepository();
      const { context } = createDeterministicContext({ calculationVersion: 'p03-task-c-1' });
      let operationSequence = 0;
      let revision = 0;
      let entryCount = 0;
      let openCycle: 'sept' | 'oct' | null = null;
      const closedNow = new Set<string>();
      const closeOrder: string[] = [];
      let octOpened = false;
      const funds: Record<string, number> = { [SEPT_ID]: SEPT_FUNDS, [OCT_ID]: OCT_FUNDS };
      const carryReceived: Record<string, number> = { [SEPT_ID]: 0, [OCT_ID]: 0 };
      const spent: Record<string, number> = { [SEPT_ID]: 0, [OCT_ID]: 0 };
      const settlements: ModelSettlement[] = [];
      const conflicts: ModelConflict[] = [];
      const occurrences = new Set<string>();
      const successes: Array<{ rawCommand: unknown; confirmation: CommandConfirmation }> = [];

      const previewExecute = async (rawCommand: unknown): Promise<{ ok: true; receipt: CommandReceipt } | { ok: false; kind: string }> => {
        const preview = previewCommand(repo, rawCommand, context);
        if (!preview.ok) return { ok: false, kind: preview.failure.kind };
        const confirmation: CommandConfirmation = {
          operationId: operationIdOf(`op-${String(++operationSequence).padStart(4, '0')}`),
          expectedRevision: preview.preview.expectedRevision,
          previewDigest: preview.preview.previewDigest,
        };
        const result = await executeCommand(repo, rawCommand, confirmation, context);
        if (!result.ok) return { ok: false, kind: result.failure.kind };
        expect(result.retried).toBe(false);
        revision += 1;
        successes.push({ rawCommand, confirmation });
        return { ok: true, receipt: result.receipt };
      };

      const modelAvailability = (cycle: string): number =>
        (funds[cycle] ?? 0) + (carryReceived[cycle] ?? 0) - (spent[cycle] ?? 0);

      const latestSettlement = (): ModelSettlement | null =>
        settlements.length === 0 ? null : settlements[settlements.length - 1] as ModelSettlement;

      const assertLaws = (): void => {
        const state = repo.getBookState(THE_BOOK_ID);
        if (state === null) throw new Error('book missing');
        expect(state.revision).toBe(revision);
        expect(state.entries.length).toBe(entryCount);
        // Law 1: every settlement snapshot is immutable.
        for (const model of settlements) {
          const stored = state.settlements.find((candidate) => candidate.settlementId === model.id);
          expect(stored, `settlement ${model.id} missing`).toBeDefined();
          expect(stored?.availability.minorUnits).toBe(model.snapshot);
        }
        // Law 2: the effective remainder is always snapshot plus tracked deltas.
        for (const model of settlements) {
          const stored = state.settlements.find((candidate) => candidate.settlementId === model.id);
          if (stored === undefined) throw new Error('unreachable');
          const expected = model.snapshot + model.deltas.reduce((total, delta) => total + delta, 0);
          expect(effectiveSettlementRemainder(state, stored).minorUnits).toBe(expected);
        }
        // Law 3: open-cycle availability matches the independent model.
        // Closed-cycle corrections join the open basis when their cycle
        // reopens; while closed they move nothing.
        if (openCycle !== null) {
          const id = openCycle === 'sept' ? SEPT_ID : OCT_ID;
          const availability = computeAvailability(state, { asOfInstantMs: 0, calculationVersion: 'p03-task-c-1' });
          if (availability.status !== 'computed') throw new Error('availability should be computed');
          expect(availability.available.minorUnits).toBe(modelAvailability(id));
        }
        // Law 4: unresolved conflicts match in count and signed amounts.
        const live = unresolvedConflicts(state);
        const expectedLive = conflicts.filter((conflict) => !conflict.resolved);
        expect(live.length).toBe(expectedLive.length);
        const liveAmounts = live.map((conflict) => conflict.unpropagatedAmount.minorUnits).sort((a, b) => a - b);
        const expectedAmounts = expectedLive.map((conflict) => conflict.amount).sort((a, b) => a - b);
        expect(liveAmounts).toEqual(expectedAmounts);
        // Law 5: occurrence sets are stable and exact.
        const produced = state.planOccurrences.map((occurrence) => occurrence.occurrenceId).sort();
        expect(produced).toEqual([...occurrences].sort());
        // Law 6: carry consumption is at most once per settlement.
        expect(state.carryActions.length).toBe(settlements.filter((model) => model.consumed).length);
      };

      const setupBook = await previewExecute({
        kind: 'createBook', bookId: BOOK_ID, displayName: '', currency: 'SAR',
        timeZone: 'Asia/Riyadh', cycleAnchor: { kind: 'firstOfMonth' },
      });
      expect(setupBook.ok).toBe(true);
      const setupCycle = await previewExecute({
        kind: 'openCycle', bookId: BOOK_ID, startDate: '2026-09-01',
        startingFunds: { currency: 'SAR', minorUnits: SEPT_FUNDS },
      });
      expect(setupCycle.ok).toBe(true);
      openCycle = 'sept';
      const setupPlan = await previewExecute({
        kind: 'createRecurringPlan', bookId: BOOK_ID, planId: 'plan-prop', name: 'Prop',
        amount: { currency: 'SAR', minorUnits: 5_000 }, scheduleDay: 5,
        effectiveDate: '2026-09-01', flexibleDefinitionId: null,
      });
      expect(setupPlan.ok).toBe(true);
      assertLaws();

      for (const operation of operations) {
        switch (operation.t) {
          case 'expense': {
            if (openCycle === null) break;
            const id = openCycle === 'sept' ? SEPT_ID : OCT_ID;
            const day = openCycle === 'sept' ? '2026-09-06' : '2026-10-06';
            const result = await previewExecute({
              kind: 'recordExpense', bookId: BOOK_ID, amount: { currency: 'SAR', minorUnits: operation.amount },
              occurredAt: { kind: 'civilDate', localDate: day }, note: '', category: 'food', flexibleDefinitionId: null,
            });
            expect(result.ok).toBe(true);
            if (result.ok) {
              spent[id] = (spent[id] ?? 0) + operation.amount;
              entryCount += 1;
              // Spending in a carry destination after the carry landed
              // changes downstream intent for settlements carried there.
              for (const model of settlements) {
                if (model.consumed && model.dest === id) model.touched = true;
              }
            }
            break;
          }
          case 'close': {
            if (openCycle === null) break;
            const id = openCycle === 'sept' ? SEPT_ID : OCT_ID;
            const result = await previewExecute({ kind: 'closeCycle', bookId: BOOK_ID, cycleId: null, note: '' });
            expect(result.ok).toBe(true);
            if (result.ok) {
              const effect = result.receipt.effects.find((candidate) => candidate.kind === 'cycleClosed');
              if (effect?.kind !== 'cycleClosed') throw new Error('missing effect');
              settlements.push({ id: effect.settlementId, cycle: id, snapshot: modelAvailability(id), deltas: [], consumed: false, dest: null, touched: false });
              closedNow.add(id);
              closeOrder.push(id);
              openCycle = null;
              // Closing a carry destination after the carry landed changes
              // downstream intent for settlements carried there.
              for (const model of settlements) {
                if (model.consumed && model.dest === id) model.touched = true;
              }
            }
            break;
          }
          case 'carry':
          case 'leave': {
            const target = latestSettlement();
            if (target === null) break;
            const rawCommand = operation.t === 'carry'
              ? {
                  kind: 'disposeCycleRemainder', bookId: BOOK_ID, settlementId: target.id,
                  disposition: { kind: 'carryIn', amount: { currency: 'SAR', minorUnits: operation.amount }, destinationCycleId: OCT_ID },
                  note: '',
                }
              : {
                  kind: 'disposeCycleRemainder', bookId: BOOK_ID, settlementId: target.id,
                  disposition: { kind: 'leaveIndependent' }, note: '',
                };
            // The latest settlement may be superseded (after a reclose),
            // already consumed, attached to a reopened cycle, or aimed at a
            // non-open October; the model mirrors the handler guards.
            const effective = settlements.filter((model) => model.cycle === target.cycle);
            const isEffective = effective.length > 0 && effective[effective.length - 1]?.id === target.id;
            const versionClosed = closedNow.has(target.cycle);
            // Only carry dispositions name a destination, which must be an
            // open cycle; leave decisions need none.
            const destinationOpen = operation.t === 'leave' || openCycle === 'oct';
            if (target.consumed) {
              const result = await previewExecute(rawCommand);
              expect(result.ok).toBe(false);
              if (!result.ok) expect(result.kind).toBe('carryAlreadyConsumed');
            } else if (!isEffective || !versionClosed || !destinationOpen) {
              const result = await previewExecute(rawCommand);
              expect(result.ok).toBe(false);
              if (!result.ok) expect(result.kind).toBe('invalidDisposition');
            } else if (operation.t === 'carry') {
              const remainder = target.snapshot + target.deltas.reduce((total, delta) => total + delta, 0);
              if (operation.amount > remainder) {
                const result = await previewExecute(rawCommand);
                expect(result.ok).toBe(false);
                if (!result.ok) expect(result.kind).toBe('invalidDisposition');
              } else {
                const result = await previewExecute(rawCommand);
                expect(result.ok).toBe(true);
                if (result.ok) {
                  target.consumed = true;
                  target.dest = OCT_ID;
                  carryReceived[OCT_ID] = (carryReceived[OCT_ID] ?? 0) + operation.amount;
                }
              }
            } else {
              const result = await previewExecute(rawCommand);
              expect(result.ok).toBe(true);
              if (result.ok) target.consumed = true;
            }
            break;
          }
          case 'reopen': {
            const id = operation.cycle === 'sept' ? SEPT_ID : OCT_ID;
            const isOct = operation.cycle === 'oct';
            // Mirrors the handler guards: unknown versions, non-closed
            // versions, and reopening while another cycle is open all fail
            // with distinct typed failures.
            if (isOct && !octOpened) {
              const result = await previewExecute({ kind: 'reopenCycle', bookId: BOOK_ID, cycleId: id, note: '' });
              expect(result.ok).toBe(false);
              if (!result.ok) expect(result.kind).toBe('unknownCycle');
            } else if (!closedNow.has(id)) {
              const result = await previewExecute({ kind: 'reopenCycle', bookId: BOOK_ID, cycleId: id, note: '' });
              expect(result.ok).toBe(false);
              if (!result.ok) expect(result.kind).toBe('cycleNotClosed');
            } else if (openCycle !== null) {
              const result = await previewExecute({ kind: 'reopenCycle', bookId: BOOK_ID, cycleId: id, note: '' });
              expect(result.ok).toBe(false);
              if (!result.ok) expect(result.kind).toBe('cycleAlreadyOpen');
            } else {
              const result = await previewExecute({ kind: 'reopenCycle', bookId: BOOK_ID, cycleId: id, note: '' });
              expect(result.ok).toBe(true);
              if (result.ok) {
                closedNow.delete(id);
                openCycle = operation.cycle;
              }
            }
            break;
          }
          case 'openNext': {
            if (openCycle !== null || octOpened) {
              const rawCommand = {
                kind: 'openCycle', bookId: BOOK_ID, startDate: '2026-10-01',
                startingFunds: { currency: 'SAR', minorUnits: OCT_FUNDS },
              };
              const result = await previewExecute(rawCommand);
              expect(result.ok).toBe(false);
              if (!result.ok) {
                if (openCycle !== null) expect(result.kind).toBe('cycleAlreadyOpen');
                else expect(result.kind).toBe('cycleAlreadyClosed');
              }
            } else {
              const result = await previewExecute({
                kind: 'openCycle', bookId: BOOK_ID, startDate: '2026-10-01',
                startingFunds: { currency: 'SAR', minorUnits: OCT_FUNDS },
              });
              expect(result.ok).toBe(true);
              if (result.ok) {
                octOpened = true;
                openCycle = 'oct';
              }
            }
            break;
          }
          case 'correct': {
            const target = [...closeOrder].reverse().find((id) => closedNow.has(id)) ?? null;
            if (target === null) break;
            const day = target === SEPT_ID ? '2026-09-10' : '2026-10-10';
            const result = await previewExecute({
              kind: 'recordClosedCycleCorrection', bookId: BOOK_ID, targetCycleId: target,
              movementKind: 'expense', amount: { currency: 'SAR', minorUnits: operation.amount },
              occurredAt: { kind: 'civilDate', localDate: day },
              note: '', category: null, linkedExpenseEntryId: null, correctsEntryId: null, replacement: null,
            });
            expect(result.ok).toBe(true);
            if (result.ok) {
              const effect = result.receipt.effects.find((candidate) => candidate.kind === 'closedCycleCorrectionRecorded');
              if (effect?.kind !== 'closedCycleCorrectionRecorded') throw new Error('missing effect');
              entryCount += 1;
              // The corrected outflow belongs to the target cycle: invisible
              // to availability while closed, counted once it reopens.
              spent[target] = (spent[target] ?? 0) + operation.amount;
              const settlement = settlements.find((model) => model.id === effect.settlementId);
              if (settlement === undefined) throw new Error('settlement missing from model');
              // Mirrors the downstream rule: no disposition (or an
              // independent one) applies the delta; a consumed-but-untouched
              // carry adjusts its destination basis; a touched downstream
              // conflicts instead.
              if (!settlement.consumed || settlement.dest === null) {
                expect(effect.propagation).toBe('applied');
                settlement.deltas.push(effect.deltaAmount.minorUnits);
              } else if (settlement.touched) {
                expect(effect.propagation).toBe('conflicted');
                conflicts.push({ amount: effect.deltaAmount.minorUnits, resolved: false });
              } else {
                expect(effect.propagation).toBe('applied');
                settlement.deltas.push(effect.deltaAmount.minorUnits);
                carryReceived[settlement.dest] = (carryReceived[settlement.dest] ?? 0) + effect.deltaAmount.minorUnits;
              }
            }
            break;
          }
          case 'resolve': {
            const state = repo.getBookState(THE_BOOK_ID);
            if (state === null) throw new Error('book missing');
            const live = unresolvedConflicts(state);
            if (live.length === 0) {
              const result = await previewExecute({
                kind: 'resolvePropagationConflict', bookId: BOOK_ID, conflictId: 'conflict-missing',
                resolution: 'acknowledgedDownstreamStands', note: '',
              });
              expect(result.ok).toBe(false);
              if (!result.ok) expect(result.kind).toBe('unknownConflict');
            } else {
              const first = live[0];
              if (first === undefined) throw new Error('unreachable');
              const result = await previewExecute({
                kind: 'resolvePropagationConflict', bookId: BOOK_ID, conflictId: first.conflictId,
                resolution: 'acknowledgedDownstreamStands', note: '',
              });
              expect(result.ok).toBe(true);
              if (result.ok) {
                const model = conflicts.find((candidate) => !candidate.resolved);
                if (model === undefined) throw new Error('model conflict missing');
                model.resolved = true;
              }
            }
            break;
          }
          case 'materialize': {
            const result = await previewExecute({
              kind: 'materializePlanOccurrences', bookId: BOOK_ID, planId: 'plan-prop', throughDate: '2026-10-31',
            });
            expect(result.ok).toBe(true);
            if (result.ok) {
              const effect = result.receipt.effects.find((candidate) => candidate.kind === 'planOccurrencesMaterialized');
              if (effect?.kind !== 'planOccurrencesMaterialized') throw new Error('missing effect');
              for (const id of effect.occurrenceIds) occurrences.add(id);
              expect([...occurrences].sort()).toEqual(['occ:plan-prop:2026-09', 'occ:plan-prop:2026-10']);
            }
            break;
          }
          case 'retry': {
            if (successes.length > 0) {
              const last = successes[successes.length - 1] as { rawCommand: unknown; confirmation: CommandConfirmation };
              const before = revision;
              const retry = await executeCommand(repo, last.rawCommand, last.confirmation, context);
              expect(retry.ok).toBe(true);
              if (retry.ok) expect(retry.retried).toBe(true);
              expect(revision).toBe(before);
            }
            break;
          }
        }
        assertLaws();
      }
    };
    await fc.assert(fc.asyncProperty(fc.array(opArb, { minLength: 3, maxLength: 10 }), executeScenario), {
      seed: SEED,
      numRuns: PROPERTY_RUNS,
    });
  });
});
