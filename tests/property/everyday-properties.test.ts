import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeAvailability,
  describeCommandFailure,
  executeCommand,
  previewCommand,
  type BookState,
  type CommandConfirmation,
  type CommandReceipt,
} from '../../src/application/commands';
import { deriveTrackedPool } from '../../src/domain/allocations/derive';
import { makeBookId, makeGoalId, makeObligationId, makeOperationId, type GoalId, type ObligationId } from '../../src/domain/contracts/identity';
import { createDeterministicContext } from '../domain/support/deterministic-context';
import { InMemoryFinanceRepository } from '../domain/support/in-memory-repository';
import { PROPERTY_RUNS, propertySeed } from './support/seed';

const SEED = propertySeed(20260912);
const BOOK_ID = 'book-prop-b';

function branded<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok) throw new Error('invalid test id');
  return result.value as T;
}

const theBookId = branded(makeBookId(BOOK_ID));
const SAR = (minorUnits: number) => ({ currency: 'SAR' as const, minorUnits });

type GeneratedOperation =
  | { readonly t: 'expense'; readonly amount: number }
  | { readonly t: 'expenseReturn'; readonly index: number; readonly amount: number }
  | { readonly t: 'correctExpense'; readonly index: number; readonly newAmount: number }
  | { readonly t: 'correctReturn'; readonly scope: 'expense' | 'obligation'; readonly index: number; readonly newAmount: number }
  | { readonly t: 'createObligation'; readonly expected: number }
  | { readonly t: 'payment'; readonly index: number; readonly amount: number }
  | { readonly t: 'obligationReturn'; readonly index: number; readonly amount: number }
  | { readonly t: 'settle'; readonly index: number }
  | { readonly t: 'cancel'; readonly index: number }
  | { readonly t: 'reopen'; readonly index: number }
  | { readonly t: 'dispute'; readonly index: number }
  | { readonly t: 'resolveDispute'; readonly index: number }
  | { readonly t: 'releaseResidual'; readonly index: number }
  | { readonly t: 'createGoal'; readonly target: number }
  | { readonly t: 'fund'; readonly amount: number }
  | { readonly t: 'assign'; readonly amount: number }
  | { readonly t: 'unassign'; readonly amount: number }
  | { readonly t: 'releaseAlloc'; readonly amount: number }
  | { readonly t: 'reverseAlloc'; readonly index: number }
  | { readonly t: 'setBuffer'; readonly amount: number }
  | { readonly t: 'retry' };

const amountArb = fc.integer({ min: 100, max: 30_000 });
const indexArb = fc.integer({ min: 0, max: 3 });
/** Narrower index for ops that need a pre-existing entity, so success paths fire. */
const nearIndexArb = fc.integer({ min: 0, max: 1 });
const operationArb: fc.Arbitrary<GeneratedOperation> = fc.oneof(
  { arbitrary: fc.record({ t: fc.constant('expense' as const), amount: amountArb }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('expenseReturn' as const), index: indexArb, amount: amountArb }), weight: 1 },
  { arbitrary: fc.record({ t: fc.constant('correctExpense' as const), index: indexArb, newAmount: amountArb }), weight: 1 },
  {
    arbitrary: fc.record({
      t: fc.constant('correctReturn' as const),
      scope: fc.constantFrom('expense' as const, 'obligation' as const),
      index: nearIndexArb,
      newAmount: amountArb,
    }),
    weight: 2,
  },
  { arbitrary: fc.record({ t: fc.constant('createObligation' as const), expected: amountArb }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('payment' as const), index: indexArb, amount: amountArb }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('obligationReturn' as const), index: indexArb, amount: amountArb }), weight: 1 },
  { arbitrary: fc.record({ t: fc.constant('settle' as const), index: nearIndexArb }), weight: 1 },
  { arbitrary: fc.record({ t: fc.constant('cancel' as const), index: nearIndexArb }), weight: 1 },
  { arbitrary: fc.record({ t: fc.constant('reopen' as const), index: nearIndexArb }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('dispute' as const), index: nearIndexArb }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('resolveDispute' as const), index: nearIndexArb }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('releaseResidual' as const), index: nearIndexArb }), weight: 1 },
  { arbitrary: fc.record({ t: fc.constant('createGoal' as const), target: amountArb }), weight: 1 },
  { arbitrary: fc.record({ t: fc.constant('fund' as const), amount: amountArb }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('assign' as const), amount: amountArb }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('unassign' as const), amount: amountArb }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('releaseAlloc' as const), amount: amountArb }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('reverseAlloc' as const), index: nearIndexArb }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('setBuffer' as const), amount: amountArb }), weight: 1 },
  { arbitrary: fc.constant({ t: 'retry' as const }), weight: 1 },
);
/**
 * Correction-heavy generator for the second scenario: chain indices are
 * pinned to entity zero so setup and follow-up align (expense 0 gets the
 * return that gets corrected; obligation 0 gets the dispute that gets
 * resolved; the first allocation record gets reversed), while amounts stay
 * random so both success and typed-rejection branches fire. Same operation
 * shapes, same model, same oracle as the general scenario.
 */
const zeroIndexArb = fc.constant(0);
const correctionHeavyArb: fc.Arbitrary<GeneratedOperation> = fc.oneof(
  { arbitrary: fc.record({ t: fc.constant('expense' as const), amount: amountArb }), weight: 3 },
  { arbitrary: fc.record({ t: fc.constant('expenseReturn' as const), index: zeroIndexArb, amount: amountArb }), weight: 3 },
  { arbitrary: fc.record({ t: fc.constant('correctExpense' as const), index: zeroIndexArb, newAmount: amountArb }), weight: 2 },
  {
    arbitrary: fc.record({
      t: fc.constant('correctReturn' as const),
      scope: fc.constantFrom('expense' as const, 'obligation' as const),
      index: zeroIndexArb,
      newAmount: amountArb,
    }),
    weight: 3,
  },
  { arbitrary: fc.record({ t: fc.constant('createObligation' as const), expected: amountArb }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('payment' as const), index: zeroIndexArb, amount: amountArb }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('obligationReturn' as const), index: zeroIndexArb, amount: amountArb }), weight: 3 },
  { arbitrary: fc.record({ t: fc.constant('dispute' as const), index: zeroIndexArb }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('resolveDispute' as const), index: zeroIndexArb }), weight: 3 },
  { arbitrary: fc.record({ t: fc.constant('createGoal' as const), target: amountArb }), weight: 1 },
  { arbitrary: fc.record({ t: fc.constant('fund' as const), amount: amountArb }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('assign' as const), amount: amountArb }), weight: 1 },
  { arbitrary: fc.record({ t: fc.constant('releaseAlloc' as const), amount: amountArb }), weight: 1 },
  { arbitrary: fc.record({ t: fc.constant('reverseAlloc' as const), index: zeroIndexArb }), weight: 3 },
  { arbitrary: fc.record({ t: fc.constant('settle' as const), index: zeroIndexArb }), weight: 1 },
  { arbitrary: fc.constant({ t: 'retry' as const }), weight: 1 },
);

interface ModelExpense {
  readonly entryId: string;
  readonly amount: number;
  live: boolean;
  /** The corrected entry this replaces, if any: the correction lineage. */
  readonly parent: string | null;
}

interface ModelReturn {
  readonly returnId: string;
  readonly expenseEntryId: string | null;
  readonly obligationId: ObligationId | null;
  readonly amount: number;
  live: boolean;
}

interface ModelObligation {
  readonly obligationId: ObligationId;
  readonly expected: number;
  /** Sum of payments actually posted. */
  paidOut: number;
  status: 'open' | 'finallySettled' | 'cancelled';
  disputeOpen: boolean;
  released: boolean;
}

interface ModelGoal {
  readonly goalId: GoalId;
  assigned: number;
}

interface ModelAllocRecord {
  readonly recordId: string;
  readonly type: 'funding' | 'assignment' | 'unassignment' | 'release';
  readonly amount: number;
  readonly goalId: GoalId | null;
}

interface Model {
  revision: number;
  expenses: ModelExpense[];
  returns: ModelReturn[];
  obligations: ModelObligation[];
  goals: ModelGoal[];
  allocRecords: ModelAllocRecord[];
  fundingEff: number;
  releasedEff: number;
  unallocated: number;
  buffer: number;
  /** Ledger entries appended, across every fact kind. */
  entryCount: number;
  /** Expense/return entries appended for obligation payments and returns. */
  obligationMovements: number;
  lastSuccess: { readonly rawCommand: unknown; readonly confirmation: CommandConfirmation; readonly receipt: CommandReceipt } | null;
}

const STARTING = 100_000;

describe('everyday finance properties (bounded, seeded)', () => {
  it('keeps availability, conservation, reservations, and immutability consistent with an independent model', async () => {
    const executeScenario = async (operations: GeneratedOperation[]): Promise<void> => {
      const repo = new InMemoryFinanceRepository();
      const { context } = createDeterministicContext();
      let operationSequence = 0;
      let goalSequence = 0;
      let obligationSequence = 0;

      const model: Model = {
        revision: 0,
        expenses: [],
        returns: [],
        obligations: [],
        goals: [],
        allocRecords: [],
        fundingEff: 0,
        releasedEff: 0,
        unallocated: 0,
        buffer: 0,
        entryCount: 0,
        obligationMovements: 0,
        lastSuccess: null,
      };

      const expectFailure = async (rawCommand: unknown, kind: string): Promise<void> => {
        const preview = previewCommand(repo, rawCommand, context);
        expect(preview.ok, `${kind} expected, got ${preview.ok ? 'success' : describeCommandFailure(preview.failure)}`).toBe(false);
        if (preview.ok) return;
        expect(preview.failure.kind).toBe(kind);
        expect(repo.getBookState(theBookId)?.revision).toBe(model.revision);
      };

      const previewAndExecute = async (rawCommand: unknown): Promise<CommandReceipt> => {
        const preview = previewCommand(repo, rawCommand, context);
        expect(preview.ok, preview.ok ? undefined : describeCommandFailure(preview.failure)).toBe(true);
        if (!preview.ok) throw new Error('unreachable');
        const confirmation: CommandConfirmation = {
          operationId: branded(makeOperationId(`op-${String(++operationSequence).padStart(4, '0')}`)),
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
        return result.receipt;
      };

      /** Correction lineage root of an expense entry. */
      const familyRootOf = (entryId: string): string => {
        let current = entryId;
        for (;;) {
          const found = model.expenses.find((expense) => expense.entryId === current);
          if (found === undefined || found.parent === null) return current;
          current = found.parent;
        }
      };

      /** Live (unreversed) refunds across an expense's correction family. */
      const familyLiveRefunds = (entryId: string): number => {
        const root = familyRootOf(entryId);
        return model.returns
          .filter((item) => item.live && item.expenseEntryId !== null && familyRootOf(item.expenseEntryId) === root)
          .reduce((total, item) => total + item.amount, 0);
      };

      /** The live head expense of a family (the current replacement). */
      const familyHeadAmount = (entryId: string): number | null => {
        const root = familyRootOf(entryId);
        const live = model.expenses.filter((expense) => expense.live && familyRootOf(expense.entryId) === root);
        if (live.length !== 1) return null;
        return live[0].amount;
      };

      /** Live refunds linked to an obligation. */
      const obligationLiveReturns = (obligationId: ObligationId): number =>
        model.returns
          .filter((item) => item.live && item.obligationId === obligationId)
          .reduce((total, item) => total + item.amount, 0);

      const residualOf = (obligation: ModelObligation): number => {
        if (obligation.status !== 'open') return 0;
        if (obligation.released) return 0;
        return Math.max(0, obligation.expected - (obligation.paidOut - obligationLiveReturns(obligation.obligationId)));
      };

      const assertInvariants = (): void => {
        const state: BookState | null = repo.getBookState(theBookId);
        expect(state?.revision).toBe(model.revision);
        if (state === null) throw new Error('unreachable');

        // Availability oracle: starting - live standalone outflows + live
        // expense returns - obligation net payments - residuals - effective
        // net allocations - buffer, all plain hand arithmetic. Obligation
        // payments are actual outflows and obligation returns are actual
        // inflows; reversals only ever mark their target dead.
        const liveOutflows = model.expenses.filter((expense) => expense.live).reduce((total, expense) => total + expense.amount, 0);
        const expenseReturns = model.returns
          .filter((item) => item.live && item.expenseEntryId !== null)
          .reduce((total, item) => total + item.amount, 0);
        const obligationNetPaid = model.obligations.reduce(
          (total, obligation) => total + (obligation.paidOut - obligationLiveReturns(obligation.obligationId)),
          0,
        );
        const residuals = model.obligations.reduce((total, obligation) => total + residualOf(obligation), 0);
        const oracle = STARTING - liveOutflows + expenseReturns - obligationNetPaid - residuals - (model.fundingEff - model.releasedEff) - model.buffer;

        const availability = computeAvailability(state, { asOfInstantMs: 0, calculationVersion: 'p03-task-b-1' });
        if (availability.status !== 'computed') throw new Error('availability should be computed');
        expect(availability.available).toEqual(SAR(oracle));

        // Conservation: unallocated + assigned == effective funding - releases.
        const pool = deriveTrackedPool(state);
        const assigned = model.goals.reduce((total, goal) => total + goal.assigned, 0);
        expect(pool.unallocated).toEqual(SAR(model.unallocated));
        expect(pool.total).toEqual(SAR(model.fundingEff - model.releasedEff));
        expect(model.unallocated + assigned).toBe(model.fundingEff - model.releasedEff);
        for (const goal of model.goals) {
          const derived = pool.goals.find((entry) => entry.goal.goalId === goal.goalId);
          expect(derived?.assigned).toEqual(SAR(goal.assigned));
        }

        // Immutable paid facts: every appended entry is still present and
        // the original amounts never changed.
        expect(state.entries.length).toBe(model.entryCount);
        for (const expense of model.expenses) {
          const original = state.entries.find((entry) => entry.entryId === expense.entryId);
          expect(original).toMatchObject({ kind: 'expense', amount: SAR(expense.amount) });
        }
        for (const item of model.returns) {
          const original = state.entries.find((entry) => entry.entryId === item.returnId);
          expect(original).toMatchObject({ kind: 'expenseReturn', amount: SAR(item.amount) });
        }
      };

      const effectEntryId = (receipt: CommandReceipt, kind: string): string => {
        const effect = receipt.effects.find((candidate) => candidate.kind === kind);
        if (effect === undefined) throw new Error(`missing ${kind} effect`);
        const record = effect as unknown as Record<string, unknown>;
        const value = record['entryId'] ?? record['recordId'];
        if (typeof value !== 'string') throw new Error(`effect ${kind} carries no id`);
        return value;
      };

      await previewAndExecute({
        kind: 'createBook',
        bookId: BOOK_ID,
        displayName: '',
        currency: 'SAR',
        timeZone: 'Asia/Riyadh',
        cycleAnchor: { kind: 'firstOfMonth' },
      });
      await previewAndExecute({
        kind: 'openCycle',
        bookId: BOOK_ID,
        startDate: '2026-09-01',
        startingFunds: SAR(STARTING),
      });

      for (const operation of operations) {
        switch (operation.t) {
          case 'expense': {
            const receipt = await previewAndExecute({
              kind: 'recordExpense',
              bookId: BOOK_ID,
              amount: SAR(operation.amount),
              occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
              note: '',
              category: null,
              flexibleDefinitionId: null,
            });
            const effect = receipt.effects[0];
            if (effect?.kind !== 'expenseRecorded') throw new Error('unreachable');
            model.expenses.push({ entryId: effect.entryId, amount: operation.amount, live: true, parent: null });
            model.entryCount += 1;
            break;
          }
          case 'expenseReturn': {
            const target = model.expenses[operation.index];
            const rawCommand = {
              kind: 'recordExpenseReturn',
              bookId: BOOK_ID,
              expenseEntryId: target?.entryId ?? 'missing-entry',
              amount: SAR(operation.amount),
              occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
              note: '',
            };
            if (target === undefined) {
              await expectFailure(rawCommand, 'unknownEntry');
            } else if (!target.live) {
              await expectFailure(rawCommand, 'duplicateReversal');
            } else {
              const headAmount = familyHeadAmount(target.entryId);
              const allowance = (headAmount ?? target.amount) - familyLiveRefunds(target.entryId);
              if (allowance < operation.amount) {
                await expectFailure(rawCommand, 'returnExceedsReturnable');
              } else {
                const receipt = await previewAndExecute(rawCommand);
                model.returns.push({ returnId: effectEntryId(receipt, 'expenseReturnRecorded'), expenseEntryId: target.entryId, obligationId: null, amount: operation.amount, live: true });
                model.entryCount += 1;
              }
            }
            break;
          }
          case 'correctExpense': {
            const target = model.expenses[operation.index];
            const rawCommand = {
              kind: 'correctExpense',
              bookId: BOOK_ID,
              expenseEntryId: target?.entryId ?? 'missing-entry',
              occurredAt: { kind: 'civilDate', localDate: '2026-09-07' },
              note: '',
              replacement: { amount: SAR(operation.newAmount) },
            };
            if (target === undefined) {
              await expectFailure(rawCommand, 'unknownEntry');
            } else if (!target.live) {
              await expectFailure(rawCommand, 'duplicateReversal');
            } else if (familyLiveRefunds(target.entryId) > operation.newAmount) {
              await expectFailure(rawCommand, 'returnExceedsReturnable');
            } else {
              const receipt = await previewAndExecute(rawCommand);
              target.live = false;
              const replacementEffect = receipt.effects.find((effect) => effect.kind === 'expenseRecorded');
              if (replacementEffect?.kind !== 'expenseRecorded') throw new Error('unreachable');
              model.expenses.push({ entryId: replacementEffect.entryId, amount: operation.newAmount, live: true, parent: target.entryId });
              model.entryCount += 2;
            }
            break;
          }
          case 'correctReturn': {
            const pool = operation.scope === 'expense'
              ? model.returns.filter((item) => item.expenseEntryId !== null)
              : model.returns.filter((item) => item.obligationId !== null);
            const target = pool[operation.index];
            const rawCommand = {
              kind: 'correctExpenseReturn',
              bookId: BOOK_ID,
              returnEntryId: target?.returnId ?? 'missing-entry',
              occurredAt: { kind: 'civilDate', localDate: '2026-09-07' },
              note: '',
              replacement: { amount: SAR(operation.newAmount) },
            };
            if (target === undefined) {
              await expectFailure(rawCommand, 'unknownEntry');
            } else if (!target.live) {
              await expectFailure(rawCommand, 'duplicateReversal');
            } else if (target.expenseEntryId !== null) {
              const headAmount = familyHeadAmount(target.expenseEntryId);
              if (headAmount === null) throw new Error('family without a live head');
              const newTotal = familyLiveRefunds(target.expenseEntryId) - target.amount + operation.newAmount;
              if (newTotal > headAmount) {
                await expectFailure(rawCommand, 'returnExceedsReturnable');
              } else {
                const receipt = await previewAndExecute(rawCommand);
                target.live = false;
                model.returns.push({ returnId: effectEntryId(receipt, 'expenseReturnRecorded'), expenseEntryId: target.expenseEntryId, obligationId: null, amount: operation.newAmount, live: true });
                model.entryCount += 2;
              }
            } else if (target.obligationId !== null) {
              const obligation = model.obligations.find((candidate) => candidate.obligationId === target.obligationId);
              if (obligation === undefined) throw new Error('return without an obligation');
              const newTotal = obligationLiveReturns(obligation.obligationId) - target.amount + operation.newAmount;
              if (newTotal > obligation.paidOut) {
                await expectFailure(rawCommand, 'returnExceedsReturnable');
              } else {
                const receipt = await previewAndExecute(rawCommand);
                target.live = false;
                model.returns.push({ returnId: effectEntryId(receipt, 'expenseReturnRecorded'), expenseEntryId: null, obligationId: target.obligationId, amount: operation.newAmount, live: true });
                model.entryCount += 2;
                model.obligationMovements += 2;
              }
            }
            break;
          }
          case 'createObligation': {
            const obligationId: ObligationId = branded(makeObligationId(`obl-${++obligationSequence}`));
            await previewAndExecute({
              kind: 'createObligation',
              bookId: BOOK_ID,
              obligationId,
              expectedAmount: SAR(operation.expected),
              note: '',
              category: null,
            });
            model.obligations.push({ obligationId, expected: operation.expected, paidOut: 0, status: 'open', disputeOpen: false, released: false });
            break;
          }
          case 'payment': {
            const target = model.obligations[operation.index];
            const rawCommand = {
              kind: 'recordObligationPayment',
              bookId: BOOK_ID,
              obligationId: target?.obligationId ?? 'obl-missing',
              amount: SAR(operation.amount),
              occurredAt: { kind: 'civilDate', localDate: '2026-09-08' },
              note: '',
              category: null,
            };
            if (target === undefined) {
              await expectFailure(rawCommand, 'unknownObligation');
            } else if (target.status !== 'open') {
              await expectFailure(rawCommand, 'obligationNotOpen');
            } else {
              // Overpayment is allowed; the residual floors at zero.
              await previewAndExecute(rawCommand);
              target.paidOut += operation.amount;
              model.entryCount += 1;
              model.obligationMovements += 1;
            }
            break;
          }
          case 'obligationReturn': {
            const target = model.obligations[operation.index];
            const rawCommand = {
              kind: 'recordObligationReturn',
              bookId: BOOK_ID,
              obligationId: target?.obligationId ?? 'obl-missing',
              amount: SAR(operation.amount),
              occurredAt: { kind: 'civilDate', localDate: '2026-09-08' },
              note: '',
            };
            if (target === undefined) {
              await expectFailure(rawCommand, 'unknownObligation');
            } else if (target.paidOut - obligationLiveReturns(target.obligationId) < operation.amount) {
              await expectFailure(rawCommand, 'returnExceedsReturnable');
            } else {
              const receipt = await previewAndExecute(rawCommand);
              model.returns.push({ returnId: effectEntryId(receipt, 'expenseReturnRecorded'), expenseEntryId: null, obligationId: target.obligationId, amount: operation.amount, live: true });
              model.entryCount += 1;
              model.obligationMovements += 1;
              // A return never resolves the dispute overlay on its own.
            }
            break;
          }
          case 'settle':
          case 'cancel': {
            const target = model.obligations[operation.index];
            const rawCommand = { kind: operation.t === 'settle' ? 'settleObligationFinally' : 'cancelObligation', bookId: BOOK_ID, obligationId: target?.obligationId ?? 'obl-missing', note: '' };
            if (target === undefined) {
              await expectFailure(rawCommand, 'unknownObligation');
            } else if (target.status !== 'open') {
              await expectFailure(rawCommand, 'obligationNotOpen');
            } else {
              await previewAndExecute(rawCommand);
              target.status = operation.t === 'settle' ? 'finallySettled' : 'cancelled';
              target.disputeOpen = false;
              target.released = false;
            }
            break;
          }
          case 'reopen': {
            const target = model.obligations[operation.index];
            const rawCommand = { kind: 'reopenObligation', bookId: BOOK_ID, obligationId: target?.obligationId ?? 'obl-missing', note: '' };
            if (target === undefined) {
              await expectFailure(rawCommand, 'unknownObligation');
            } else if (target.status === 'open') {
              await expectFailure(rawCommand, 'obligationNotClosed');
            } else {
              await previewAndExecute(rawCommand);
              target.status = 'open';
              // Reopening alone never resolves the dispute overlay.
              target.released = false;
            }
            break;
          }
          case 'dispute': {
            const target = model.obligations[operation.index];
            const rawCommand = { kind: 'openObligationDispute', bookId: BOOK_ID, obligationId: target?.obligationId ?? 'obl-missing', note: '' };
            if (target === undefined) {
              await expectFailure(rawCommand, 'unknownObligation');
            } else if (target.status !== 'open') {
              await expectFailure(rawCommand, 'obligationNotOpen');
            } else if (target.disputeOpen) {
              await expectFailure(rawCommand, 'disputeAlreadyOpen');
            } else {
              await previewAndExecute(rawCommand);
              target.disputeOpen = true;
            }
            break;
          }
          case 'resolveDispute': {
            const target = model.obligations[operation.index];
            const rawCommand = {
              kind: 'resolveObligationDispute',
              bookId: BOOK_ID,
              obligationId: target?.obligationId ?? 'obl-missing',
              resolution: 'other',
              linkedReturnEntryId: null,
              note: '',
            };
            if (target === undefined) {
              await expectFailure(rawCommand, 'unknownObligation');
            } else if (target.status !== 'open') {
              await expectFailure(rawCommand, 'obligationNotOpen');
            } else if (!target.disputeOpen) {
              await expectFailure(rawCommand, 'disputeNotOpen');
            } else {
              await previewAndExecute(rawCommand);
              target.disputeOpen = false;
            }
            break;
          }
          case 'releaseResidual': {
            const target = model.obligations[operation.index];
            const rawCommand = { kind: 'releaseDisputedResidual', bookId: BOOK_ID, obligationId: target?.obligationId ?? 'obl-missing', note: '' };
            if (target === undefined) {
              await expectFailure(rawCommand, 'unknownObligation');
            } else if (target.status !== 'open') {
              await expectFailure(rawCommand, 'obligationNotOpen');
            } else if (!target.disputeOpen) {
              await expectFailure(rawCommand, 'disputeNotOpen');
            } else if (target.released || Math.max(0, target.expected - (target.paidOut - obligationLiveReturns(target.obligationId))) === 0) {
              await expectFailure(rawCommand, 'residualNotReleasable');
            } else {
              await previewAndExecute(rawCommand);
              target.released = true;
            }
            break;
          }
          case 'createGoal': {
            const goalId: GoalId = branded(makeGoalId(`goal-${++goalSequence}`));
            await previewAndExecute({ kind: 'createGoal', bookId: BOOK_ID, goalId, name: '', targetAmount: SAR(operation.target) });
            model.goals.push({ goalId, assigned: 0 });
            break;
          }
          case 'fund': {
            const receipt = await previewAndExecute({
              kind: 'fundAllocationPool',
              bookId: BOOK_ID,
              amount: SAR(operation.amount),
              occurredAt: { kind: 'civilDate', localDate: '2026-09-09' },
              note: '',
            });
            model.fundingEff += operation.amount;
            model.unallocated += operation.amount;
            model.allocRecords.push({ recordId: effectEntryId(receipt, 'allocationFunded'), type: 'funding', amount: operation.amount, goalId: null });
            break;
          }
          case 'assign': {
            const target = model.goals[0];
            const rawCommand = { kind: 'assignToGoal', bookId: BOOK_ID, goalId: target?.goalId ?? 'goal-missing', amount: SAR(operation.amount), note: '' };
            if (target === undefined) {
              await expectFailure(rawCommand, 'unknownGoal');
            } else if (model.unallocated < operation.amount) {
              await expectFailure(rawCommand, 'insufficientTrackedFunds');
            } else {
              const receipt = await previewAndExecute(rawCommand);
              model.unallocated -= operation.amount;
              target.assigned += operation.amount;
              model.allocRecords.push({ recordId: effectEntryId(receipt, 'allocationAssigned'), type: 'assignment', amount: operation.amount, goalId: target.goalId });
            }
            break;
          }
          case 'unassign': {
            const target = model.goals[0];
            const rawCommand = { kind: 'unassignFromGoal', bookId: BOOK_ID, goalId: target?.goalId ?? 'goal-missing', amount: SAR(operation.amount), note: '' };
            if (target === undefined) {
              await expectFailure(rawCommand, 'unknownGoal');
            } else if (target.assigned < operation.amount) {
              await expectFailure(rawCommand, 'insufficientTrackedFunds');
            } else {
              const receipt = await previewAndExecute(rawCommand);
              target.assigned -= operation.amount;
              model.unallocated += operation.amount;
              model.allocRecords.push({ recordId: effectEntryId(receipt, 'allocationUnassigned'), type: 'unassignment', amount: operation.amount, goalId: target.goalId });
            }
            break;
          }
          case 'releaseAlloc': {
            const target = model.goals[0];
            // With no goal in the model the generated command releases from
            // tracked-unallocated (goalId null), not from a named goal.
            const goalIdForCommand = target?.goalId ?? null;
            const rawCommand = {
              kind: 'releaseAllocation',
              bookId: BOOK_ID,
              goalId: goalIdForCommand,
              amount: SAR(operation.amount),
              destinationCycleId: `cyc:${BOOK_ID}:2026-09-01`,
              occurredAt: { kind: 'civilDate', localDate: '2026-09-09' },
              note: '',
            };
            const sourceAvailable = target === null || target === undefined ? model.unallocated : target.assigned;
            if (sourceAvailable < operation.amount) {
              await expectFailure(rawCommand, 'insufficientTrackedFunds');
            } else {
              const receipt = await previewAndExecute(rawCommand);
              if (target !== null && target !== undefined) {
                target.assigned -= operation.amount;
              } else {
                model.unallocated -= operation.amount;
              }
              model.releasedEff += operation.amount;
              model.allocRecords.push({ recordId: effectEntryId(receipt, 'allocationReleased'), type: 'release', amount: operation.amount, goalId: target?.goalId ?? null });
            }
            break;
          }
          case 'reverseAlloc': {
            const target = model.allocRecords[operation.index];
            const rawCommand = {
              kind: 'reverseAllocationRecord',
              bookId: BOOK_ID,
              allocationRecordId: target?.recordId ?? 'alloc-missing',
              note: '',
            };
            if (target === undefined) {
              await expectFailure(rawCommand, 'unknownAllocationRecord');
              break;
            }
            // The reversal guard mirrors the implementation: the inverse must
            // find its money where the original record left it.
            const guardOk =
              target.type === 'release' ||
              (target.type === 'funding' && model.unallocated >= target.amount) ||
              (target.type === 'assignment' && (model.goals.find((goal) => goal.goalId === target.goalId)?.assigned ?? 0) >= target.amount) ||
              (target.type === 'unassignment' && model.unallocated >= target.amount);
            if (!guardOk) {
              await expectFailure(rawCommand, 'insufficientTrackedFunds');
              break;
            }
            await previewAndExecute(rawCommand);
            switch (target.type) {
              case 'funding':
                model.unallocated -= target.amount;
                model.fundingEff -= target.amount;
                break;
              case 'assignment': {
                const goal = model.goals.find((candidate) => candidate.goalId === target.goalId);
                if (goal === undefined) throw new Error('assignment without a goal');
                goal.assigned -= target.amount;
                model.unallocated += target.amount;
                break;
              }
              case 'unassignment': {
                const goal = model.goals.find((candidate) => candidate.goalId === target.goalId);
                if (goal === undefined) throw new Error('unassignment without a goal');
                goal.assigned += target.amount;
                model.unallocated -= target.amount;
                break;
              }
              case 'release': {
                if (target.goalId !== null) {
                  const goal = model.goals.find((candidate) => candidate.goalId === target.goalId);
                  if (goal === undefined) throw new Error('release without a goal');
                  goal.assigned += target.amount;
                } else {
                  model.unallocated += target.amount;
                }
                model.releasedEff -= target.amount;
                break;
              }
            }
            break;
          }
          case 'setBuffer': {
            await previewAndExecute({ kind: 'setBuffer', bookId: BOOK_ID, buffer: SAR(operation.amount), note: '' });
            model.buffer = operation.amount;
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
              expect(repo.getBookState(theBookId)?.revision).toBe(model.revision);
            }
            break;
          }
        }
        assertInvariants();
      }
    };
    await fc.assert(fc.asyncProperty(fc.array(operationArb, { minLength: 1, maxLength: 14 }), executeScenario), { seed: SEED, numRuns: PROPERTY_RUNS });
    await fc.assert(fc.asyncProperty(fc.array(correctionHeavyArb, { minLength: 4, maxLength: 10 }), executeScenario), { seed: propertySeed(20260913), numRuns: PROPERTY_RUNS });
  });
});
