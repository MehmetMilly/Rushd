import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJson, executeCommand, previewCommand, stableDigest } from '../../src/application/commands';
import type { CommandConfirmation, CommandReceipt } from '../../src/domain/contracts/commands';
import { makeBookId, makeOperationId, type OperationId } from '../../src/domain/contracts/identity';
import { sumMoney, type Money } from '../../src/domain/primitives/money';
import { createDeterministicContext } from '../domain/support/deterministic-context';
import { InMemoryFinanceRepository } from '../domain/support/in-memory-repository';
import { PROPERTY_RUNS, propertySeed } from './support/seed';

const SEED = propertySeed(20260908);
const BOOK_ID = 'book-prop';

function branded<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok) throw new Error('invalid test id');
  return result.value as T;
}

const bookId = branded(makeBookId(BOOK_ID));

function opId(sequence: number): OperationId {
  return branded(makeOperationId(`op-${String(sequence).padStart(4, '0')}`));
}

type GeneratedOperation =
  | { readonly t: 'open'; readonly day: number }
  | { readonly t: 'inflow'; readonly amount: number; readonly day: number }
  | { readonly t: 'reverse'; readonly index: number }
  | { readonly t: 'retry' };

const operationArb: fc.Arbitrary<GeneratedOperation> = fc.oneof(
  fc.record({ t: fc.constant('open'), day: fc.integer({ min: 1, max: 30 }) }) as fc.Arbitrary<GeneratedOperation>,
  fc.record({ t: fc.constant('inflow'), amount: fc.integer({ min: 1, max: 90_000 }), day: fc.integer({ min: 1, max: 30 }) }) as fc.Arbitrary<GeneratedOperation>,
  fc.record({ t: fc.constant('reverse'), index: fc.integer({ min: 0, max: 5 }) }) as fc.Arbitrary<GeneratedOperation>,
  fc.record({ t: fc.constant('retry') }) as fc.Arbitrary<GeneratedOperation>,
);

interface ModelInflow {
  readonly entryId: string;
  readonly minorUnits: number;
  reversed: boolean;
}

interface Model {
  revision: number;
  opened: boolean;
  startingFunds: number;
  inflows: ModelInflow[];
  lastSuccess: { readonly rawCommand: unknown; readonly confirmation: CommandConfirmation; readonly receipt: CommandReceipt } | null;
}

describe('command sequence properties (bounded, seeded)', () => {
  it('keeps revisions, effects, and balances consistent with an independent model', async () => {
    const property = fc.asyncProperty(fc.array(operationArb, { minLength: 1, maxLength: 6 }), async (operations) => {
      const repo = new InMemoryFinanceRepository();
      const { context } = createDeterministicContext();
      let operationSequence = 0;

      const model: Model = { revision: 0, opened: false, startingFunds: 0, inflows: [], lastSuccess: null };

      const assertBalance = (): void => {
        const state = repo.getBookState(bookId);
        if (state === null) {
          expect(model.opened).toBe(false);
          return;
        }
        expect(state.revision).toBe(model.revision);
        if (!model.opened) {
          expect(state.cycles).toHaveLength(0);
          expect(state.entries).toHaveLength(0);
          return;
        }
        // BigInt oracle independent of the checked-number arithmetic.
        const oracle = model.startingFunds + model.inflows.reduce((total, inflow) => total + (inflow.reversed ? -inflow.minorUnits : inflow.minorUnits), 0);
        const amounts: [Money, ...Money[]] = [state.cycles[0].startingFunds, ...state.entries.map((entry) => entry.amount)];
        const balance = sumMoney(amounts);
        expect(balance).toEqual({ ok: true, value: { currency: 'SAR', minorUnits: oracle } });
        expect(state.entries).toHaveLength(model.inflows.length + model.inflows.filter((inflow) => inflow.reversed).length);
      };

      const expectFailure = async (rawCommand: unknown, kind: string): Promise<void> => {
        const preview = previewCommand(repo, rawCommand, context);
        expect(preview.ok, `${kind} expected, got ${preview.ok ? 'success' : preview.failure.kind}`).toBe(false);
        if (preview.ok) return;
        expect(preview.failure.kind).toBe(kind);
      };

      const previewAndExecute = async (rawCommand: unknown): Promise<CommandConfirmation> => {
        const preview = previewCommand(repo, rawCommand, context);
        expect(preview.ok).toBe(true);
        if (!preview.ok) throw new Error('unreachable');
        const confirmation: CommandConfirmation = {
          operationId: opId((operationSequence += 1)),
          expectedRevision: preview.preview.expectedRevision,
          previewDigest: preview.preview.previewDigest,
        };
        const result = await executeCommand(repo, rawCommand, confirmation, context);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        expect(result.retried).toBe(false);
        expect(result.receipt.revisionBefore).toBe(model.revision);
        model.revision += 1;
        expect(result.receipt.revisionAfter).toBe(model.revision);
        model.lastSuccess = { rawCommand, confirmation, receipt: result.receipt };
        return confirmation;
      };

      // Every run starts from the same explicit empty book.
      await previewAndExecute({
        kind: 'createBook',
        bookId: BOOK_ID,
        displayName: 'property book',
        currency: 'SAR',
        timeZone: 'Asia/Riyadh',
        cycleAnchor: { kind: 'firstOfMonth' },
      });

      for (const operation of operations) {
        switch (operation.t) {
          case 'open': {
            const rawCommand = {
              kind: 'openCycle',
              bookId: BOOK_ID,
              startDate: `2026-09-${String(operation.day).padStart(2, '0')}`,
              startingFunds: { currency: 'SAR', minorUnits: 250_000 },
            };
            if (model.opened) {
              await expectFailure(rawCommand, 'cycleAlreadyOpen');
            } else if (operation.day !== 1) {
              await expectFailure(rawCommand, 'invalidCycleStart');
            } else {
              await previewAndExecute(rawCommand);
              model.opened = true;
              model.startingFunds = 250_000;
            }
            break;
          }
          case 'inflow': {
            const rawCommand = {
              kind: 'recordInflow',
              bookId: BOOK_ID,
              amount: { currency: 'SAR', minorUnits: operation.amount },
              occurredAt: { kind: 'civilDate', localDate: `2026-09-${String(operation.day).padStart(2, '0')}` },
              note: '',
            };
            if (!model.opened) {
              await expectFailure(rawCommand, 'noOpenCycle');
            } else {
              await previewAndExecute(rawCommand);
              const receipt = model.lastSuccess?.receipt;
              const effect = receipt?.effects[0];
              expect(effect?.kind).toBe('inflowRecorded');
              model.inflows.push({ entryId: effect && 'entryId' in effect ? effect.entryId : '', minorUnits: operation.amount, reversed: false });
            }
            break;
          }
          case 'reverse': {
            const target = model.inflows[operation.index];
            const rawCommand = { kind: 'reverseInflow', bookId: BOOK_ID, inflowEntryId: target?.entryId ?? 'missing-entry', note: '' };
            if (!model.opened) {
              await expectFailure(rawCommand, 'noOpenCycle');
            } else if (target === undefined) {
              await expectFailure(rawCommand, 'unknownEntry');
            } else if (target.reversed) {
              await expectFailure(rawCommand, 'duplicateReversal');
            } else {
              await previewAndExecute(rawCommand);
              target.reversed = true;
            }
            break;
          }
          case 'retry': {
            if (model.lastSuccess !== null) {
              const retry = await executeCommand(repo, model.lastSuccess.rawCommand, model.lastSuccess.confirmation, context);
              expect(retry.ok).toBe(true);
              if (retry.ok) {
                expect(retry.retried).toBe(true);
                expect(retry.receipt).toEqual(model.lastSuccess.receipt);
              }
              expect(repo.getBookState(BOOK_ID as never)?.revision).toBe(model.revision);
            }
            break;
          }
        }
        assertBalance();
      }
    });
    await fc.assert(property, { seed: SEED, numRuns: PROPERTY_RUNS });
  });

  it('always reproduces the same canonical payload for the same command', () => {
    const property = fc.property(fc.integer({ min: 1, max: 90_000 }), fc.integer({ min: 1, max: 30 }), (amount, day) => {
      const command = {
        kind: 'recordInflow',
        bookId: BOOK_ID,
        amount: { currency: 'SAR', minorUnits: amount },
        occurredAt: { kind: 'civilDate', localDate: `2026-09-${String(day).padStart(2, '0')}` },
        note: '',
      };
      // Key order must not matter for canonical comparison.
      const reordered = {
        note: '',
        occurredAt: { localDate: `2026-09-${String(day).padStart(2, '0')}`, kind: 'civilDate' },
        amount: { minorUnits: amount, currency: 'SAR' },
        bookId: BOOK_ID,
        kind: 'recordInflow',
      };
      expect(canonicalJson(command)).toBe(canonicalJson(reordered));
      expect(stableDigest(canonicalJson(command))).toBe(stableDigest(canonicalJson(reordered)));
    });
    return fc.assert(property, { seed: SEED + 1, numRuns: PROPERTY_RUNS });
  });
});
