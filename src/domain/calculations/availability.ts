/**
 * Availability: the primary financial amount, derived as a pure query.
 *
 *   available = cycle starting funds
 *             + net inflows
 *             + net returns (actual money received back)
 *             - net actual outflows (live expenses, including payments)
 *             - residual reservations (open obligations)
 *             - net cycle allocations (funding minus releases)
 *             - explicit buffer
 *
 * Every component is an exact book-currency Money value; a negative result
 * stays negative (a shortfall is shown, never clamped or hidden). The result
 * carries the signed minor units, exact breakdown, currency, data-as-of
 * instant, calculation version, and the two independent completeness
 * dimensions. Flexible limits are guidance and are never subtracted here.
 * Reality Check observations and reconciliation adjustments arrive with
 * Task C and extend the formula at that boundary.
 */

import { negateMoney, sumMoney, type Money } from '../primitives/money';
import type { BookState, OpenCycleRecord } from '../contracts/ledger';
import { findOpenCycle } from '../contracts/ledger';
import { effectiveReturnAmounts, liveExpenseEntries } from '../activity/derive';
import { cycleAllocationNet } from '../allocations/derive';
import { deriveObligationViews } from '../obligations/derive';
import { computeCompleteness, type CompletenessResult } from './completeness';

export interface AvailabilityComponents {
  /** The full-cycle starting pool. */
  readonly startingFunds: Money;
  /** Recorded inflows net of their reversals; signed. */
  readonly netInflows: Money;
  /** Expense and obligation returns: actual money received back. */
  readonly netReturns: Money;
  /** Live expense movement out of the pool, including obligation payments. */
  readonly netActualOutflows: Money;
  /** Sum of open obligations' residual reservations. */
  readonly residualReservations: Money;
  /** Funding minus releases; signed (releases cannot exceed funding). */
  readonly netCycleAllocations: Money;
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
  const openCycle: OpenCycleRecord | null = state === null ? null : findOpenCycle(state);
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

  const inflowParts: Money[] = [];
  for (const entry of state.entries) {
    if (entry.kind === 'inflow') inflowParts.push(entry.amount);
    else if (entry.kind === 'inflowReversal') inflowParts.push(entry.amount);
    // Returns and their reversals share one effective derivation with the
    // refund caps and obligation net payments (see below); expenseReversal
    // facts only cancel their linked expense, and the live-expense scan
    // below already excludes reversed expenses.
  }
  const liveOutflows = liveExpenseEntries(state).map((entry) => entry.amount);
  const returnParts = effectiveReturnAmounts(state);

  const netInflows = inflowParts.length === 0 ? zeroMoney : sumOrThrow(inflowParts, 'inflows could not be summed exactly');
  const netReturns = returnParts.length === 0 ? zeroMoney : sumOrThrow(returnParts, 'returns could not be summed exactly');
  const netActualOutflows = liveOutflows.length === 0 ? zeroMoney : sumOrThrow(liveOutflows, 'outflows could not be summed exactly');

  const openResiduals = deriveObligationViews(state)
    .filter((view) => view.status === 'open')
    .map((view) => view.residualReservation);
  const residualReservations =
    openResiduals.length === 0 ? zeroMoney : sumOrThrow(openResiduals, 'reservations could not be summed exactly');

  // The cycle's spending deduction shares its derivation with the tracked
  // pool: effective funding attributed to this cycle minus effective
  // releases destined to it, net of linked reversals. Assignment and
  // unassignment never appear here. This is deliberately not the whole
  // cross-cycle tracked balance.
  const netCycleAllocations = cycleAllocationNet(state, openCycle.cycleId);

  const buffer = state.buffer === null ? zeroMoney : state.buffer.amount;

  const components: AvailabilityComponents = {
    startingFunds: openCycle.startingFunds,
    netInflows,
    netReturns,
    netActualOutflows,
    residualReservations,
    netCycleAllocations,
    buffer,
  };

  const available = sumOrThrow(
    [
      openCycle.startingFunds,
      netInflows,
      netReturns,
      negateOrThrow(netActualOutflows, 'outflows could not be negated'),
      negateOrThrow(residualReservations, 'reservations could not be negated'),
      negateOrThrow(netCycleAllocations, 'allocations could not be negated'),
      negateOrThrow(buffer, 'buffer could not be negated'),
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
