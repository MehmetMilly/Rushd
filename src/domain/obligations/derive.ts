/**
 * Pure derivations over expected obligations.
 *
 * The obligation record itself is immutable; its status, dispute overlay, and
 * residual reservation are derived by scanning append-only events and linked
 * actual money movement. The reservation rule is the master plan's:
 * an open obligation with expected amount E and unreversed net payments P
 * reserves max(0, E - P). Posted disputed payments remain outflows; an unpaid
 * disputed residual stays reserved unless the user confirmed a previewed
 * reservation-release, which records unresolved uncertainty instead.
 */

import { makeMoney, negateMoney, subtractMoney, sumMoney, type Money } from '../primitives/money';
import type { BookState, ObligationEvent, ObligationRecord } from '../contracts/ledger';
import type { ObligationId } from '../contracts/identity';
import { isExpenseLive, isExpenseReturnLive } from '../activity/derive';

export type ObligationStatus = 'open' | 'finallySettled' | 'cancelled';

export interface ObligationView {
  readonly obligation: ObligationRecord;
  readonly status: ObligationStatus;
  /** Dispute is an independent overlay on paid/unpaid state. */
  readonly disputeOpen: boolean;
  /** True while a previewed disputed-residual release stands. */
  readonly residualReleased: boolean;
  /** Unreversed payments minus unreversed returns; never negative. */
  readonly netPayments: Money;
  /** max(0, expected - net payments) before any release suppression. */
  readonly remainingUnpaid: Money;
  /** Reserved now: remainingUnpaid, zero once closed or release-suppressed. */
  readonly residualReservation: Money;
}

function deriveStatus(events: readonly ObligationEvent[]): ObligationStatus {
  let status: ObligationStatus = 'open';
  for (const event of events) {
    if (event.change.type === 'finalSettlement') status = 'finallySettled';
    else if (event.change.type === 'cancellation') status = 'cancelled';
    else if (event.change.type === 'reopening') status = 'open';
  }
  return status;
}

function deriveDispute(events: readonly ObligationEvent[]): { disputeOpen: boolean; residualReleased: boolean } {
  let disputeOpen = false;
  let residualReleased = false;
  for (const event of events) {
    switch (event.change.type) {
      case 'disputeOpened':
        disputeOpen = true;
        break;
      case 'disputeResolved':
        disputeOpen = false;
        break;
      case 'residualReleased':
        residualReleased = true;
        break;
      case 'finalSettlement':
      case 'cancellation':
      case 'reopening':
        // Closing the obligation ends the release decision; an explicit
        // reopen recomputes the reservation fresh (and can be released
        // again through its own previewed command).
        residualReleased = false;
        break;
    }
  }
  return { disputeOpen, residualReleased };
}

function zeroOf(currency: Money['currency']): Money {
  const made = makeMoney(currency, 0);
  if (!made.ok) throw new TypeError('book currency must be supported');
  return made.value;
}

/**
 * Unreversed gross payments linked to the obligation: live (uncorrected)
 * payment expenses only. A corrected payment counts at its replacement
 * amount — the reversed original is history, not money paid.
 */
export function grossLivePaymentsFor(state: BookState, obligationId: ObligationId): Money | null {
  const obligation = state.obligations.find((candidate) => candidate.obligationId === obligationId);
  if (obligation === undefined) return null;
  const movements: Money[] = [];
  for (const entry of state.entries) {
    if (entry.kind === 'expense' && entry.linkedObligationId === obligationId && isExpenseLive(state, entry.entryId)) {
      movements.push(entry.amount);
    }
  }
  if (movements.length === 0) return zeroOf(obligation.expectedAmount.currency);
  const summed = sumMoney(movements as [Money, ...Money[]]);
  if (!summed.ok) throw new TypeError(`obligation ${obligationId} payments could not be summed exactly`);
  return summed.value;
}

/**
 * Effective (live) returns linked to the obligation: unreversed returns
 * only. A reversal marks its target dead and is never summed itself.
 * Shared by net payments, the refund cap, and return-correction guards, so
 * all three always agree.
 */
export function effectiveObligationReturns(state: BookState, obligationId: ObligationId): Money | null {
  const obligation = state.obligations.find((candidate) => candidate.obligationId === obligationId);
  if (obligation === undefined) return null;
  const parts: Money[] = [];
  for (const entry of state.entries) {
    if (entry.kind === 'expenseReturn' && entry.linkedObligationId === obligationId) {
      if (isExpenseReturnLive(state, entry.entryId)) parts.push(entry.amount);
    }
  }
  if (parts.length === 0) return zeroOf(obligation.expectedAmount.currency);
  const summed = sumMoney(parts as [Money, ...Money[]]);
  if (!summed.ok) throw new TypeError(`obligation ${obligationId} returns could not be summed exactly`);
  return summed.value;
}

/**
 * Unreversed net payments (live payments minus effective returns) linked to
 * the obligation. Write-time rules cap every return at the then-current net
 * and reject corrections that would strand standing refunds, so an honest
 * state always derives a non-negative result; a negative value here would
 * mean the stored state violates that invariant.
 */
export function netPaymentsFor(state: BookState, obligationId: ObligationId): Money | null {
  const obligation = state.obligations.find((candidate) => candidate.obligationId === obligationId);
  if (obligation === undefined) return null;
  const movements: Money[] = [];
  for (const entry of state.entries) {
    if (entry.kind === 'expense' && entry.linkedObligationId === obligationId && isExpenseLive(state, entry.entryId)) {
      movements.push(entry.amount);
    } else if (entry.kind === 'expenseReturn' && entry.linkedObligationId === obligationId) {
      if (!isExpenseReturnLive(state, entry.entryId)) continue;
      const negated = negateMoney(entry.amount);
      if (!negated.ok) throw new TypeError('return amount could not be negated exactly');
      movements.push(negated.value);
    }
    // Return reversals only mark their target dead (see above); summing one
    // alongside its excluded target would cancel the refund twice.
  }
  if (movements.length === 0) return zeroOf(obligation.expectedAmount.currency);
  const summed = sumMoney(movements as [Money, ...Money[]]);
  if (!summed.ok) throw new TypeError(`obligation ${obligationId} payments could not be summed exactly`);
  return summed.value;
}

export function deriveObligationView(state: BookState, obligationId: ObligationId): ObligationView | null {
  const obligation = state.obligations.find((candidate) => candidate.obligationId === obligationId);
  if (obligation === undefined) return null;
  const events = state.obligationEvents.filter((event) => event.obligationId === obligationId);
  const status = deriveStatus(events);
  const { disputeOpen, residualReleased } = deriveDispute(events);
  const netPayments = netPaymentsFor(state, obligationId);
  if (netPayments === null) return null;

  let remainingUnpaid = zeroOf(obligation.expectedAmount.currency);
  let residual = zeroOf(obligation.expectedAmount.currency);
  if (status === 'open') {
    const unpaid = subtractMoney(obligation.expectedAmount, netPayments);
    if (!unpaid.ok) throw new TypeError(`obligation ${obligationId} residual could not be derived exactly`);
    remainingUnpaid = unpaid.value.minorUnits > 0 ? unpaid.value : zeroOf(obligation.expectedAmount.currency);
    residual = remainingUnpaid;
    // A confirmed reservation release stands until the obligation is closed
    // or explicitly reopened: a derived dispute resolution must never
    // silently re-reserve money the user explicitly un-reserved. The
    // completeness reducer reports the recorded uncertainty instead.
    if (residualReleased) residual = zeroOf(obligation.expectedAmount.currency);
  }

  return {
    obligation,
    status,
    disputeOpen,
    residualReleased,
    netPayments,
    remainingUnpaid,
    residualReservation: residual,
  };
}

/** Views for every obligation in the book, in append order. */
export function deriveObligationViews(state: BookState): readonly ObligationView[] {
  const views: ObligationView[] = [];
  for (const obligation of state.obligations) {
    const view = deriveObligationView(state, obligation.obligationId);
    if (view !== null) views.push(view);
  }
  return views;
}
