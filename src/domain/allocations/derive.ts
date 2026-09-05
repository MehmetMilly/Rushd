/**
 * Pure derivations over tracked-allocation records.
 *
 * The tracked pool is funded once from spendable money; assignment divides
 * already-funded money among goals with no second availability effect;
 * unassignment returns money to tracked-unallocated; release returns money
 * to one named destination cycle. Reversals append a linked inverse record.
 *
 * Conservation invariant, derived and tested: unallocated plus the sum of
 * per-goal assigned balances always equals total funding minus total
 * releases. Goal progress is its own assigned balance, never a shared vault
 * total.
 */

import { makeMoney, subtractMoney, sumMoney, type Money } from '../primitives/money';
import type { BookState, GoalRecord } from '../contracts/ledger';
import type { GoalId } from '../contracts/identity';

export interface GoalBalance {
  readonly goal: GoalRecord;
  readonly assigned: Money;
}

export interface TrackedPoolView {
  /** Funded money not yet assigned to any goal. */
  readonly unallocated: Money;
  /** Per-goal assigned balances, in goal-record order. */
  readonly goals: readonly GoalBalance[];
  /** unallocated + sum(assigned): the whole tracked pool. */
  readonly total: Money;
}

function zeroOf(currency: Money['currency']): Money {
  const made = makeMoney(currency, 0);
  if (!made.ok) throw new TypeError('book currency must be supported');
  return made.value;
}

/**
 * Replays allocation records in append order, applying each change and each
 * reversal's exact inverse. Amounts were validated at write time, so an
 * underflow here would mean stored state violates the write-time guards.
 */
export function deriveTrackedPool(state: BookState): TrackedPoolView {
  const currency = state.book.currency;
  const assigned = new Map<string, Money>();
  let unallocated = zeroOf(currency);

  const addTo = (map: Map<string, Money>, key: string, amount: Money): void => {
    const current = map.get(key) ?? zeroOf(currency);
    const summed = sumMoney([current, amount]);
    if (!summed.ok) throw new TypeError(`tracked pool could not add allocation amounts exactly (${summed.failure.reason})`);
    map.set(key, summed.value);
  };
  const subtractFrom = (map: Map<string, Money>, key: string, amount: Money): void => {
    const current = map.get(key) ?? zeroOf(currency);
    const difference = subtractMoney(current, amount);
    if (!difference.ok) throw new TypeError(`tracked pool could not subtract allocation amounts exactly (${difference.failure.reason})`);
    map.set(key, difference.value);
  };
  const addUnallocated = (amount: Money): void => {
    const summed = sumMoney([unallocated, amount]);
    if (!summed.ok) throw new TypeError(`tracked pool could not add amounts exactly (${summed.failure.reason})`);
    unallocated = summed.value;
  };
  const subtractUnallocated = (amount: Money): void => {
    const difference = subtractMoney(unallocated, amount);
    if (!difference.ok) throw new TypeError(`tracked pool could not subtract amounts exactly (${difference.failure.reason})`);
    unallocated = difference.value;
  };

  for (const record of state.allocationRecords) {
    switch (record.change.type) {
      case 'funding':
        addUnallocated(record.change.amount);
        break;
      case 'assignment':
        addTo(assigned, record.change.goalId, record.change.amount);
        subtractUnallocated(record.change.amount);
        break;
      case 'unassignment':
        subtractFrom(assigned, record.change.goalId, record.change.amount);
        addUnallocated(record.change.amount);
        break;
      case 'release':
        if (record.change.goalId === null) subtractUnallocated(record.change.amount);
        else subtractFrom(assigned, record.change.goalId, record.change.amount);
        break;
      case 'reversal': {
        // Narrowing does not propagate into the find() closure, so capture
        // the referenced id first.
        const reversesRecordId = record.change.reversesRecordId;
        const target = state.allocationRecords.find((candidate) => candidate.recordId === reversesRecordId);
        if (target === undefined) {
          throw new TypeError(`allocation reversal ${record.recordId} references unknown record ${reversesRecordId}`);
        }
        switch (target.change.type) {
          case 'funding':
            subtractUnallocated(target.change.amount);
            break;
          case 'assignment':
            subtractFrom(assigned, target.change.goalId, target.change.amount);
            addUnallocated(target.change.amount);
            break;
          case 'unassignment':
            addUnallocated(target.change.amount);
            subtractFrom(assigned, target.change.goalId, target.change.amount);
            break;
          case 'release':
            if (target.change.goalId === null) addUnallocated(target.change.amount);
            else addTo(assigned, target.change.goalId, target.change.amount);
            break;
          case 'reversal':
            throw new TypeError(`allocation reversal ${record.recordId} references another reversal`);
        }
        break;
      }
    }
  }

  const goals: GoalBalance[] = [];
  for (const goal of state.goals) {
    goals.push({ goal, assigned: assigned.get(goal.goalId) ?? zeroOf(currency) });
  }

  const assignedList = [...assigned.values()];
  let assignedTotal: Money = zeroOf(currency);
  if (assignedList.length > 0) {
    const summed = sumMoney(assignedList as [Money, ...Money[]]);
    if (!summed.ok) throw new TypeError('tracked pool assigned balances could not be summed exactly');
    assignedTotal = summed.value;
  }
  const total = sumMoney([unallocated, assignedTotal]);
  if (!total.ok) throw new TypeError('tracked pool total could not be summed exactly');
  return { unallocated, goals, total: total.value };
}

/** The assigned balance of one goal (zero when the goal has no allocations). */
export function goalAssignedBalance(state: BookState, goalId: GoalId): Money | null {
  const pool = deriveTrackedPool(state);
  return pool.goals.find((entry) => entry.goal.goalId === goalId)?.assigned ?? null;
}
