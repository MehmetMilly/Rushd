/**
 * Availability: the primary financial amount, derived as a pure query.
 *
 *   available = cycle starting funds
 *             + signed carry-in from named settlements
 *             + net inflows
 *             + net returns (actual money received back)
 *             - net actual outflows (live expenses, including payments)
 *             - residual reservations (open obligations)
 *             - net cycle allocations (funding minus releases)
 *             - explicit buffer
 *             + signed reconciliation residuals
 *
 * Only the effective open cycle/version basis enters: old-cycle actuals,
 * returns, adjustments, reservations counted once via open obligations, and
 * allocations never subtract twice. Cross-cycle outstanding obligations
 * encumber available funds once while their payments stay in the payment
 * cycle. In a `remaining-from-boundary` cycle, pre-boundary occurrences are
 * history (excluded) and post-boundary movement changes the pool normally.
 *
 * Every component is an exact book-currency Money value; a negative result
 * stays negative (a shortfall is shown, never clamped or hidden). The result
 * carries the signed minor units, exact breakdown, currency, data-as-of
 * instant, calculation version, and the two independent completeness
 * dimensions. Flexible limits are guidance and are never subtracted here.
 */

import { negateMoney, sumMoney, type Money } from '../primitives/money';
import type { BookState, CycleRecord } from '../contracts/ledger';
import { findOpenCycle } from '../contracts/ledger';
import { expenseCorrectionFamily, liveExpenseEntries, liveExpenseReturns } from '../activity/derive';
import { cycleAllocationNet } from '../allocations/derive';
import { deriveObligationViews } from '../obligations/derive';
import { effectiveCarryToCycle } from '../cycles/derive';
import {
  adjustmentContribution,
  isOccurrenceCoveredBy,
  liveExpenseHeadAmount,
  liveInflowAmount,
  liveReturnHeadAmount,
  type ResolvedBoundary,
} from '../recovery/derive';
import { computeCompleteness, type CompletenessResult } from './completeness';

export interface AvailabilityComponents {
  /** The full-cycle starting pool, or the named observed pool at a boundary. */
  readonly startingFunds: Money;
  /** Signed carry-in explicitly disposed from named settlements. */
  readonly carryIn: Money;
  /** Recorded inflows net of their reversals, in this cycle; signed. */
  readonly netInflows: Money;
  /** Expense and obligation returns: actual money received back, this cycle. */
  readonly netReturns: Money;
  /** Live expense movement out of the pool, including obligation payments. */
  readonly netActualOutflows: Money;
  /** Sum of open obligations' residual reservations (encumbered once). */
  readonly residualReservations: Money;
  /** Funding minus releases; signed (releases cannot exceed funding). */
  readonly netCycleAllocations: Money;
  /** Signed reconciliation residuals attributed to this cycle. */
  readonly netAdjustments: Money;
  /** The explicit buffer reservation. */
  readonly buffer: Money;
}

export interface AvailabilityComputed {
  readonly status: 'computed';
  readonly bookId: string;
  readonly cycleId: string;
  readonly currency: Money['currency'];
  readonly asOfInstantMs: number;
  readonly calculationVersion: string;
  readonly available: Money;
  readonly components: AvailabilityComponents;
  readonly completeness: CompletenessResult;
}

export type AvailabilityUnavailableReason = 'noBook' | 'noOpenCycle';

export interface AvailabilityUnavailable {
  readonly status: 'unavailable';
  readonly reason: AvailabilityUnavailableReason;
  readonly asOfInstantMs: number;
  readonly calculationVersion: string;
}

export type AvailabilityResult = AvailabilityComputed | AvailabilityUnavailable;

function zero(currency: Money['currency']): Money {
  return { currency, minorUnits: 0 };
}

/**
 * The cycle-scoped ledger of the effective open version, shared by
 * `computeAvailability` and the close-cycle settlement snapshot so the two
 * can never disagree. Only facts attributed to the cycle's logical identity
 * enter; in a boundary cycle only post-boundary occurrences do.
 */
export interface ActiveCycleLedger {
  readonly startingFunds: Money;
  readonly carryIn: Money;
  readonly netInflows: Money;
  readonly netReturns: Money;
  readonly netActualOutflows: Money;
  readonly netCycleAllocations: Money;
  readonly netAdjustments: Money;
}

/** The boundary a boundary-mode version filters occurrences against. */
function cycleBoundaryOf(cycle: CycleRecord): ResolvedBoundary | null {
  if (cycle.mode !== 'remainingFromBoundary') return null;
  if (cycle.boundaryLocalDate === null || cycle.boundaryTimeZone === null) {
    throw new TypeError('a remaining-from-boundary version must carry its boundary');
  }
  if (cycle.boundaryLocalTime === null && cycle.boundaryInstantMs === null) {
    throw new TypeError('a remaining-from-boundary version must carry boundary time evidence');
  }
  return {
    localDate: cycle.boundaryLocalDate,
    localTime: cycle.boundaryLocalTime ?? '00:00:00',
    instantMs: cycle.boundaryInstantMs,
    timeZone: cycle.boundaryTimeZone,
  };
}

export function deriveActiveCycleLedger(state: BookState, cycle: CycleRecord): ActiveCycleLedger {
  const currency = state.book.currency;
  const zeroMoney = zero(currency);
  const boundary = cycleBoundaryOf(cycle);

  const inflowParts: Money[] = [];
  const outflowParts: Money[] = [];
  const returnParts: Money[] = [];

  if (boundary === null) {
    for (const entry of state.entries) {
      if (entry.cycleId !== cycle.cycleId) continue;
      if (entry.kind === 'inflow' || entry.kind === 'inflowReversal') inflowParts.push(entry.amount);
      // Expense and return reversals only mark their target dead; the live
      // scans below already exclude reversed facts.
    }
    for (const entry of liveExpenseEntries(state)) {
      if (entry.cycleId === cycle.cycleId) outflowParts.push(entry.amount);
    }
    for (const entry of liveExpenseReturns(state)) {
      if (entry.cycleId === cycle.cycleId) returnParts.push(entry.amount);
    }
  } else {
    // Boundary mode: correction families count at their live-head amount,
    // attributed to their root occurrence; only post-boundary occurrences
    // change the starting pool.
    const seenFamilies = new Set<string>();
    for (const entry of state.entries) {
      if (entry.cycleId !== cycle.cycleId) continue;
      if (entry.kind === 'expense') {
        const family = expenseCorrectionFamily(state, entry.entryId);
        const rootKey = family.length > 0 ? family[0].entryId : entry.entryId;
        if (seenFamilies.has(rootKey)) continue;
        seenFamilies.add(rootKey);
        let root = family.length > 0 ? family[0] : entry;
        while (root.replacesEntryId !== null) {
          const parent = family.find((candidate) => candidate.entryId === root.replacesEntryId);
          if (parent === undefined) break;
          root = parent;
        }
        if (isOccurrenceCoveredBy({ localDate: root.localDate, instantMs: root.occurredAtInstantMs }, boundary)) continue;
        const effective = liveExpenseHeadAmount(state, entry.entryId);
        if (effective.minorUnits !== 0) outflowParts.push(effective);
      } else if (entry.kind === 'inflow') {
        if (isOccurrenceCoveredBy({ localDate: entry.localDate, instantMs: entry.occurredAtInstantMs }, boundary)) continue;
        const effective = liveInflowAmount(state, entry.entryId);
        if (effective.minorUnits !== 0) inflowParts.push(effective);
      } else if (entry.kind === 'expenseReturn') {
        if (isOccurrenceCoveredBy({ localDate: entry.localDate, instantMs: entry.occurredAtInstantMs }, boundary)) continue;
        const effective = liveReturnHeadAmount(state, entry.entryId);
        if (effective.minorUnits !== 0) returnParts.push(effective);
      }
    }
  }

  const netInflows = inflowParts.length === 0 ? zeroMoney : sumOrThrow(inflowParts, 'inflows could not be summed exactly');
  const netReturns = returnParts.length === 0 ? zeroMoney : sumOrThrow(returnParts, 'returns could not be summed exactly');
  const netActualOutflows = outflowParts.length === 0 ? zeroMoney : sumOrThrow(outflowParts, 'outflows could not be summed exactly');

  const adjustmentParts: Money[] = [];
  for (const adjustment of state.adjustments) {
    if (adjustment.cycleId !== cycle.cycleId) continue;
    adjustmentParts.push(adjustmentContribution(state, adjustment, cycle));
  }
  const netAdjustments =
    adjustmentParts.length === 0 ? zeroMoney : sumOrThrow(adjustmentParts, 'adjustments could not be summed exactly');

  return {
    startingFunds: cycle.startingFunds,
    carryIn: effectiveCarryToCycle(state, cycle.cycleId),
    netInflows,
    netReturns,
    netActualOutflows,
    netCycleAllocations: cycleAllocationNet(state, cycle.cycleId),
    netAdjustments,
  };
}

function sumOrThrow(values: readonly Money[], detail: string): Money {
  if (values.length === 0) throw new TypeError(detail);
  const summed = sumMoney(values as [Money, ...Money[]]);
  if (!summed.ok) throw new TypeError(`${detail} (${summed.failure.reason})`);
  return summed.value;
}

function negateOrThrow(value: Money, detail: string): Money {
  const negated = negateMoney(value);
  if (!negated.ok) throw new TypeError(`${detail} (${negated.failure.reason})`);
  return negated.value;
}

/**
 * The signed availability of an open full cycle. Returns an unavailable
 * result — never a fabricated zero — when there is no book or no open cycle.
 */
export function computeAvailability(
  state: BookState | null,
  params: { readonly asOfInstantMs: number; readonly calculationVersion: string },
): AvailabilityResult {
  const openCycle: CycleRecord | null = state === null ? null : findOpenCycle(state);
  if (state === null || openCycle === null) {
    return {
      status: 'unavailable',
      reason: state === null ? 'noBook' : 'noOpenCycle',
      asOfInstantMs: params.asOfInstantMs,
      calculationVersion: params.calculationVersion,
    };
  }

  const currency = state.book.currency;
  const zeroMoney = zero(currency);

  const ledger = deriveActiveCycleLedger(state, openCycle);

  const openResiduals = deriveObligationViews(state)
    .filter((view) => view.status === 'open')
    .map((view) => view.residualReservation);
  const residualReservations =
    openResiduals.length === 0 ? zeroMoney : sumOrThrow(openResiduals, 'reservations could not be summed exactly');

  const buffer = state.buffer === null ? zeroMoney : state.buffer.amount;

  const components: AvailabilityComponents = {
    startingFunds: ledger.startingFunds,
    carryIn: ledger.carryIn,
    netInflows: ledger.netInflows,
    netReturns: ledger.netReturns,
    netActualOutflows: ledger.netActualOutflows,
    residualReservations,
    netCycleAllocations: ledger.netCycleAllocations,
    netAdjustments: ledger.netAdjustments,
    buffer,
  };

  const available = sumOrThrow(
    [
      ledger.startingFunds,
      ledger.carryIn,
      ledger.netInflows,
      ledger.netReturns,
      negateOrThrow(ledger.netActualOutflows, 'outflows could not be negated'),
      negateOrThrow(residualReservations, 'reservations could not be negated'),
      // The cycle's spending deduction shares its derivation with the tracked
      // pool: effective funding attributed to this cycle minus effective
      // releases destined to it, net of linked reversals. Assignment and
      // unassignment never appear here. This is deliberately not the whole
      // cross-cycle tracked balance.
      negateOrThrow(ledger.netCycleAllocations, 'allocations could not be negated'),
      negateOrThrow(buffer, 'buffer could not be negated'),
      ledger.netAdjustments,
    ],
    'availability could not be derived exactly',
  );

  return {
    status: 'computed',
    bookId: state.book.id,
    cycleId: openCycle.cycleId,
    currency,
    asOfInstantMs: params.asOfInstantMs,
    calculationVersion: params.calculationVersion,
    available,
    components,
    completeness: computeCompleteness(state, params),
  };
}
