/**
 * Pure derivations for settings revisions, cycle versions, settlements, and
 * propagation.
 *
 * The book's creation facts never change: the governing timezone and anchor
 * for any date come from the latest settings revision effective at or before
 * it, falling back to the creation values. Default edits govern only the
 * next unopened cycle; moving the open cycle requires an explicit rebase
 * that supersedes the prior version without re-dating captured facts.
 *
 * Settlement snapshots are immutable. The effective remainder of a
 * settlement is its snapshot availability plus exact linked propagation
 * deltas; a carry source is consumed by a single disposition, and any later
 * backdated correction that finds its downstream already consumed becomes an
 * explicit unresolved conflict instead of silently rewriting history.
 */

import { makeMoney, subtractMoney, sumMoney, type Money } from '../primitives/money';
import { compareCivilDates, type CivilDate } from '../primitives/civil-date';
import type { MonthlyCycleAnchor } from '../primitives/monthly-cycle';
import type { TimeZoneName } from '../primitives/instant';
import type { BookState, CycleRecord, CycleSettlement } from '../contracts/ledger';
import type { CycleId, SettlementId } from '../contracts/identity';

function zeroOf(currency: Money['currency']): Money {
  const made = makeMoney(currency, 0);
  if (!made.ok) throw new TypeError('book currency must be supported');
  return made.value;
}

export interface EffectiveSettings {
  readonly timeZone: TimeZoneName;
  readonly cycleAnchor: MonthlyCycleAnchor;
}

/**
 * The governing settings at a date: the latest revision effective at or
 * before it (ties resolve to the last appended), else the creation values.
 */
export function effectiveSettingsAt(state: BookState, date: CivilDate): EffectiveSettings {
  let best: EffectiveSettings | null = null;
  let bestDate: CivilDate | null = null;
  for (const revision of state.settingsRevisions) {
    if (compareCivilDates(revision.effectiveDate, date) > 0) continue;
    if (bestDate === null || compareCivilDates(bestDate, revision.effectiveDate) <= 0) {
      bestDate = revision.effectiveDate;
      best = { timeZone: revision.timeZone, cycleAnchor: revision.cycleAnchor };
    }
  }
  return best ?? { timeZone: state.book.timeZone, cycleAnchor: state.book.cycleAnchor };
}

export function effectiveAnchorForDate(state: BookState, date: CivilDate): MonthlyCycleAnchor {
  return effectiveSettingsAt(state, date).cycleAnchor;
}

export function effectiveTimeZoneForDate(state: BookState, date: CivilDate): TimeZoneName {
  return effectiveSettingsAt(state, date).timeZone;
}

/**
 * The effective remainder of a settlement: its snapshot availability plus
 * every exact linked propagation delta. Historical snapshots never change;
 * deltas are the visible forward propagation of backdated corrections.
 */
export function effectiveSettlementRemainder(state: BookState, settlement: CycleSettlement): Money {
  const parts: Money[] = [settlement.availability];
  for (const delta of state.propagationDeltas) {
    if (delta.settlementId === settlement.settlementId) parts.push(delta.deltaAmount);
  }
  const summed = sumMoney(parts as [Money, ...Money[]]);
  if (!summed.ok) throw new TypeError(`settlement remainder could not be summed exactly (${summed.failure.reason})`);
  return summed.value;
}

/** True once any disposition (carry, funding, split, or independent) exists. */
export function settlementConsumed(state: BookState, settlementId: SettlementId): boolean {
  return state.carryActions.some((action) => action.settlementId === settlementId);
}

export function carryActionFor(state: BookState, settlementId: SettlementId): BookState['carryActions'][number] | null {
  return state.carryActions.find((action) => action.settlementId === settlementId) ?? null;
}

/**
 * Which downstream kinds already consumed a settlement: `carry` for
 * carry-in/split dispositions, `trackedAllocation` for funding/split ones.
 */
export function downstreamConsumedKinds(
  state: BookState,
  settlementId: SettlementId,
): 'carry' | 'trackedAllocation' | 'both' | null {
  const action = carryActionFor(state, settlementId);
  if (action === null) return null;
  const disposition = action.disposition;
  if (disposition.kind === 'carryIn') return 'carry';
  if (disposition.kind === 'fundTracked') return 'trackedAllocation';
  if (disposition.kind === 'split') return 'both';
  return null;
}

/**
 * The effective signed carry-in attributed to one cycle: every carry-in and
 * split carry part naming it as destination. Carry is explicit and applied
 * once at disposition time; applied propagation deltas never rewrite a
 * consumed carry (they become conflicts instead).
 */
export function effectiveCarryToCycle(state: BookState, cycleId: CycleId): Money {
  const parts: Money[] = [];
  for (const action of state.carryActions) {
    const disposition = action.disposition;
    if (disposition.kind === 'carryIn' && disposition.destinationCycleId === cycleId) {
      parts.push(disposition.amount);
    } else if (disposition.kind === 'split' && disposition.destinationCycleId === cycleId) {
      parts.push(disposition.carryAmount);
    }
  }
  if (parts.length === 0) return zeroOf(state.book.currency);
  const summed = sumMoney(parts as [Money, ...Money[]]);
  if (!summed.ok) throw new TypeError(`carry-in could not be summed exactly (${summed.failure.reason})`);
  return summed.value;
}

/** Unresolved propagation conflicts in the book, in append order. */
export function unresolvedConflicts(state: BookState): readonly BookState['propagationConflicts'][number][] {
  return state.propagationConflicts.filter((conflict) => !conflict.resolved);
}

/** The next settlement sequence for a logical cycle. */
export function nextSettlementSeq(state: BookState, cycleId: CycleId): number {
  let best = 0;
  for (const settlement of state.settlements) {
    if (settlement.cycleId === cycleId && settlement.settlementSeq > best) best = settlement.settlementSeq;
  }
  return best + 1;
}

/** The next version sequence for a logical cycle. */
export function nextVersionSeq(state: BookState, cycleId: CycleId): number {
  let best = 0;
  for (const cycle of state.cycles) {
    if (cycle.cycleId === cycleId && cycle.versionSeq > best) best = cycle.versionSeq;
  }
  return best + 1;
}

/** True when a cycle window overlaps any *other* logical cycle's version. */
export function overlapsOtherCycle(
  state: BookState,
  cycleId: CycleId,
  startDate: CivilDate,
  endDateExclusive: CivilDate,
): boolean {
  for (const cycle of state.cycles) {
    if (cycle.cycleId === cycleId) continue;
    if (compareCivilDates(cycle.startDate, endDateExclusive) < 0 && compareCivilDates(startDate, cycle.endDateExclusive) < 0) {
      return true;
    }
  }
  return false;
}

/** Counts entries of a logical cycle dated outside a candidate window. */
export function countEntriesOutsideWindow(
  state: BookState,
  cycle: CycleRecord,
  startDate: CivilDate,
  endDateExclusive: CivilDate,
): number {
  let count = 0;
  for (const entry of state.entries) {
    if (entry.cycleId !== cycle.cycleId) continue;
    if (compareCivilDates(entry.localDate, startDate) < 0 || compareCivilDates(entry.localDate, endDateExclusive) >= 0) {
      count += 1;
    }
  }
  return count;
}

/**
 * Fits a signed disposition total inside a remainder: non-negative
 * remainders cap spending at the remainder; a shortfall (negative
 * availability) only records visibility unless the disposition is
 * `leaveIndependent`.
 */
export function fitsWithinRemainder(remainder: Money, total: Money): boolean {
  if (remainder.minorUnits < 0) return total.minorUnits === 0;
  return total.minorUnits <= remainder.minorUnits;
}

export function sumDispositionTotal(
  disposition:
    | { readonly kind: 'carryIn'; readonly amount: Money }
    | { readonly kind: 'fundTracked'; readonly amount: Money }
    | { readonly kind: 'split'; readonly carryAmount: Money; readonly fundAmount: Money }
    | { readonly kind: 'leaveIndependent' },
): Money | null {
  if (disposition.kind === 'carryIn') return disposition.amount;
  if (disposition.kind === 'fundTracked') return disposition.amount;
  if (disposition.kind === 'split') {
    const summed = sumMoney([disposition.carryAmount, disposition.fundAmount]);
    if (!summed.ok) throw new TypeError(`split disposition could not be summed exactly (${summed.failure.reason})`);
    return summed.value;
  }
  return null;
}

export function subtractOrThrow(minuend: Money, subtrahend: Money, detail: string): Money {
  const difference = subtractMoney(minuend, subtrahend);
  if (!difference.ok) throw new TypeError(`${detail} (${difference.failure.reason})`);
  return difference.value;
}
