/**
 * Recovery conservation properties (bounded, seeded).
 *
 * Over random observe/recover/correct/retry sequences the suite asserts the
 * laws, not the implementation: every observation's ledger-plus-residual
 * always restores its observed pool exactly, availability always equals the
 * independently modeled starting-funds-minus-live-movement-plus-residuals,
 * retries never change state, and revisions advance exactly once per
 * committed command. The model tracks plain amounts and liveness flags; it
 * never reimplements the residual or ledger derivations.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  adjustmentResidual,
  boundaryFromObservation,
  computeAvailability,
  deriveLedgerPoolAt,
  executeCommand,
  findAdjustmentByObservation,
  findObservationById,
  findOpenCycle,
  previewCommand,
  type CommandConfirmation,
  type CommandReceipt,
} from '../../src/application/commands';
import { makeBookId, makeOperationId, type BookId, type OperationId } from '../../src/domain/contracts/identity';
import { createDeterministicContext } from '../domain/support/deterministic-context';
import { InMemoryFinanceRepository } from '../domain/support/in-memory-repository';
import { PROPERTY_RUNS, propertySeed } from './support/seed';

const SEED = propertySeed(20260921);
const BOOK_ID = 'book-prop-recovery';
const STARTING = 100_000;

type RecOp =
  | { readonly t: 'observe'; readonly day: number; readonly amount: number }
  | { readonly t: 'recoverExpense'; readonly day: number; readonly amount: number }
  | { readonly t: 'recoverInflow'; readonly day: number; readonly amount: number }
  | { readonly t: 'correct'; readonly index: number; readonly newAmount: number | null }
  | { readonly t: 'retry' };

const dayArb = fc.integer({ min: 1, max: 28 });
const amountArb = fc.integer({ min: 100, max: 40_000 });
const opArb: fc.Arbitrary<RecOp> = fc.oneof(
  { arbitrary: fc.record({ t: fc.constant('observe' as const), day: dayArb, amount: amountArb }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('recoverExpense' as const), day: dayArb, amount: amountArb }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('recoverInflow' as const), day: dayArb, amount: amountArb }), weight: 1 },
  {
    arbitrary: fc.record({ t: fc.constant('correct' as const), index: fc.integer({ min: 0, max: 3 }), newAmount: fc.oneof(fc.constant(null), amountArb) }),
    weight: 2,
  },
  { arbitrary: fc.constant({ t: 'retry' as const }), weight: 1 },
);

interface ModelExpense {
  entryId: string;
  amount: number;
  live: boolean;
}

interface ModelObservation {
  observationId: string;
  day: number;
  observed: number;
}

function pad(day: number): string {
  return `2026-09-${String(day).padStart(2, '0')}`;
}

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

describe('recovery conservation properties (bounded, seeded)', () => {
  it('restores every observed pool and models availability independently', async () => {
    const executeScenario = async (operations: RecOp[]): Promise<void> => {
      const repo = new InMemoryFinanceRepository();
      const { context } = createDeterministicContext({ calculationVersion: 'p03-task-c-1' });
      let operationSequence = 0;
      let revision = 0;
      const expenses: ModelExpense[] = [];
      const observations: ModelObservation[] = [];
      let liveOutflows = 0;
      let liveInflows = 0;
      let entryCount = 0;
      const successes: Array<{ rawCommand: unknown; confirmation: CommandConfirmation }> = [];
      const lastSuccessOf = (): { rawCommand: unknown; confirmation: CommandConfirmation } | null =>
        successes.length === 0 ? null : successes[successes.length - 1] as { rawCommand: unknown; confirmation: CommandConfirmation };

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

      const assertLaws = (): void => {
        const state = repo.getBookState(THE_BOOK_ID);
        if (state === null) throw new Error('book missing');
        expect(state.revision).toBe(revision);
        expect(state.entries.length).toBe(entryCount);
        // Law 1: every observation's ledger (excluding its own adjustment)
        // plus its derived residual restores the observed pool exactly.
        const cycle = findOpenCycle(state);
        if (cycle === null) throw new Error('no open cycle');
        for (const obs of observations) {
          const observation = findObservationById(state, obs.observationId as never);
          const adjustment = findAdjustmentByObservation(state, obs.observationId as never);
          if (observation === null || adjustment === null) throw new Error('observation records missing');
          const ledger = deriveLedgerPoolAt(state, cycle, boundaryFromObservation(observation), {
            observationId: obs.observationId,
          });
          const residual = adjustmentResidual(state, adjustment);
          expect(ledger.minorUnits + residual.minorUnits).toBe(obs.observed);
        }
        // Law 2: independent availability oracle from plain model sums.
        let residualSum = 0;
        for (const obs of observations) {
          const adjustment = findAdjustmentByObservation(state, obs.observationId as never);
          if (adjustment === null) throw new Error('unreachable');
          residualSum += adjustmentResidual(state, adjustment).minorUnits;
        }
        const availability = computeAvailability(state, { asOfInstantMs: 0, calculationVersion: 'p03-task-c-1' });
        if (availability.status !== 'computed') throw new Error('availability should be computed');
        expect(availability.available.minorUnits).toBe(STARTING - liveOutflows + liveInflows + residualSum);
      };

      const setup = await previewExecute({
        kind: 'createBook', bookId: BOOK_ID, displayName: '', currency: 'SAR',
        timeZone: 'Asia/Riyadh', cycleAnchor: { kind: 'firstOfMonth' },
      });
      expect(setup.ok).toBe(true);
      const opened = await previewExecute({
        kind: 'openCycle', bookId: BOOK_ID, startDate: '2026-09-01', startingFunds: { currency: 'SAR', minorUnits: STARTING },
      });
      expect(opened.ok).toBe(true);
      assertLaws();

      for (const operation of operations) {
        switch (operation.t) {
          case 'observe': {
            // Successive observations advance forward in boundary order (the
            // specified succession shape): one boundary owns one observation,
            // and a later observation absorbs earlier residuals into its
            // ledger basis. A backdated boundary would stack an independent
            // adjustment instead of rewriting later ones, so the generator
            // holds monotonicity and the duplicate rule keys on the boundary.
            const lastDay = observations.length === 0 ? 1 : observations[observations.length - 1]!.day;
            const day = Math.max(operation.day, lastDay);
            const duplicate = observations.some((obs) => obs.day === day);
            const rawCommand = {
              kind: 'recordRealityCheck', bookId: BOOK_ID, observedPool: { currency: 'SAR', minorUnits: operation.amount },
              boundary: { kind: 'civilDateTime', localDate: pad(day), localTime: '12:00:00' },
              currencyLabel: null, classificationNote: 'counted', note: '',
            };
            if (duplicate) {
              const result = await previewExecute(rawCommand);
              expect(result.ok).toBe(false);
              if (!result.ok) expect(result.kind).toBe('duplicateObservation');
            } else {
              const result = await previewExecute(rawCommand);
              expect(result.ok).toBe(true);
              if (result.ok) {
                const effect = result.receipt.effects.find((candidate) => candidate.kind === 'realityCheckRecorded');
                if (effect?.kind !== 'realityCheckRecorded') throw new Error('missing effect');
                observations.push({ observationId: effect.observationId, day, observed: operation.amount });
              }
            }
            break;
          }
          case 'recoverExpense':
          case 'recoverInflow': {
            const last = observations[observations.length - 1];
            const rawCommand = {
              kind: 'recoverObservedActivity', bookId: BOOK_ID,
              observationId: last?.observationId ?? 'obs-missing',
              movementKind: operation.t === 'recoverExpense' ? 'expense' : 'inflow',
              amount: { currency: 'SAR', minorUnits: operation.amount },
              occurredAt: { kind: 'civilDate', localDate: pad(operation.day) },
              note: '', category: null, linkedExpenseEntryId: null,
            };
            if (last === undefined) {
              const result = await previewExecute(rawCommand);
              expect(result.ok).toBe(false);
              if (!result.ok) expect(result.kind).toBe('unknownObservation');
            } else if (operation.day === last.day) {
              const result = await previewExecute(rawCommand);
              expect(result.ok).toBe(false);
              if (!result.ok) expect(result.kind).toBe('clarificationNeeded');
            } else if (operation.day > last.day) {
              const result = await previewExecute(rawCommand);
              expect(result.ok).toBe(false);
              if (!result.ok) expect(result.kind).toBe('invalidRecoveryBoundary');
            } else {
              // The recovery must attach to the earliest covering boundary:
              // an earlier observation on or after the occurrence date owns
              // the gap, and naming a later one is a typed rejection.
              const earliest = observations.find((obs) => obs.day > operation.day) ?? null;
              if (earliest !== null && earliest.observationId !== last.observationId) {
                const result = await previewExecute(rawCommand);
                expect(result.ok).toBe(false);
                if (!result.ok) expect(result.kind).toBe('invalidRecoveryBoundary');
              } else {
                const result = await previewExecute(rawCommand);
                expect(result.ok).toBe(true);
                if (result.ok) {
                  const effect = result.receipt.effects.find((candidate) => candidate.kind === 'observedActivityRecovered');
                  if (effect?.kind !== 'observedActivityRecovered') throw new Error('missing effect');
                  if (operation.t === 'recoverExpense') {
                    expenses.push({ entryId: effect.entryId, amount: operation.amount, live: true });
                    liveOutflows += operation.amount;
                  } else {
                    liveInflows += operation.amount;
                  }
                  entryCount += 1;
                }
              }
            }
            break;
          }
          case 'correct': {
            const target = expenses.length === 0 ? undefined : expenses[operation.index % expenses.length];
            const rawCommand = {
              kind: 'correctExpense', bookId: BOOK_ID,
              expenseEntryId: target?.entryId ?? 'entry-missing',
              occurredAt: { kind: 'civilDate', localDate: '2026-09-20' },
              note: '', replacement: operation.newAmount === null ? null : { amount: { currency: 'SAR', minorUnits: operation.newAmount } },
            };
            if (target === undefined) {
              const result = await previewExecute(rawCommand);
              expect(result.ok).toBe(false);
              if (!result.ok) expect(result.kind).toBe('unknownEntry');
            } else if (!target.live) {
              const result = await previewExecute(rawCommand);
              expect(result.ok).toBe(false);
              if (!result.ok) expect(result.kind).toBe('duplicateReversal');
            } else {
              const result = await previewExecute(rawCommand);
              expect(result.ok).toBe(true);
              if (result.ok) {
                target.live = false;
                liveOutflows -= target.amount;
                if (operation.newAmount !== null) {
                  const replacement = result.receipt.effects.find((candidate) => candidate.kind === 'expenseRecorded');
                  if (replacement?.kind !== 'expenseRecorded') throw new Error('missing replacement');
                  expenses.push({ entryId: replacement.entryId, amount: operation.newAmount, live: true });
                  liveOutflows += operation.newAmount;
                  entryCount += 2;
                } else {
                  entryCount += 1;
                }
              }
            }
            break;
          }
          case 'retry': {
            const last = lastSuccessOf();
            if (last !== null) {
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
    await fc.assert(fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 12 }), executeScenario), {
      seed: SEED,
      numRuns: PROPERTY_RUNS,
    });
  });
});
