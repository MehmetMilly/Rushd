/**
 * Completeness: a deterministic reducer over recorded evidence, not a
 * manually toggled badge.
 *
 * Two independent dimensions are derived:
 * - pool completeness: whether there is an honest basis for the availability
 *   amount (a full-cycle start or an observed boundary) and no unresolved
 *   material uncertainty (disputed reservations, released disputed
 *   residuals, unresolved propagation conflicts). An accepted Reality Check
 *   adjustment IS pool reconciliation: the observed pool is the recorded
 *   truth, so its residual never keeps the pool stale — only genuinely
 *   unresolved recovery/proposal/conflict gaps do;
 * - classification completeness: the classified share of the covered pool
 *   movements, including classified reconciliation adjustments. An
 *   unclassified adjustment keeps this dimension Needs Attention even when
 *   the pool is Current.
 *
 * A reason can only disappear when its underlying evidence changes: an
 * unresolved dispute is not hidden by classifying every transaction, and an
 * unclassified expense does not invalidate a known pool. Coverage is the
 * active cycle/version basis: old unclassified history outside it never
 * contaminates a newer Current pool, while unresolved linked propagation or
 * recovery gaps stay visible. A pool may be Current while classification
 * remains Needs Attention.
 */

import type { BookState } from '../contracts/ledger';
import { findOpenCycle } from '../contracts/ledger';
import { deriveObligationViews } from '../obligations/derive';
import { liveExpenseEntries } from '../activity/derive';
import { unresolvedConflicts } from '../cycles/derive';

export type CompletenessState = 'current' | 'needsAttention' | 'recordsOnly' | 'unavailable';

export type CompletenessReason =
  | { readonly type: 'noPoolBasis' }
  | { readonly type: 'noActiveBasis' }
  | {
      readonly type: 'openDisputedObligation';
      readonly obligationId: string;
      readonly residualReleased: boolean;
    }
  | {
      readonly type: 'releasedResidualUncertainty';
      readonly obligationId: string;
      readonly releasedUnpaid: { readonly currency: string; readonly minorUnits: number };
    }
  | { readonly type: 'unresolvedPropagationConflict'; readonly conflictId: string }
  | { readonly type: 'unclassifiedExpenseMovements'; readonly count: number }
  | { readonly type: 'unclassifiedAdjustment'; readonly observationId: string };

export interface CompletenessDimension {
  readonly state: CompletenessState;
  readonly reasons: readonly CompletenessReason[];
}

export interface CompletenessResult {
  readonly pool: CompletenessDimension;
  readonly classification: CompletenessDimension;
  readonly asOfInstantMs: number;
  readonly calculationVersion: string;
}

export function computeCompleteness(
  state: BookState | null,
  params: { readonly asOfInstantMs: number; readonly calculationVersion: string },
): CompletenessResult {
  if (state === null || state.cycles.length === 0) {
    const pool: CompletenessDimension = { state: 'unavailable', reasons: [{ type: 'noPoolBasis' }] };
    // With no pool basis there are also no covered movements to classify.
    const classification: CompletenessDimension = { state: 'unavailable', reasons: [{ type: 'noPoolBasis' }] };
    return { pool, classification, asOfInstantMs: params.asOfInstantMs, calculationVersion: params.calculationVersion };
  }

  const poolReasons: CompletenessReason[] = [];
  for (const view of deriveObligationViews(state)) {
    if (view.status !== 'open') continue;
    if (view.disputeOpen) {
      poolReasons.push({
        type: 'openDisputedObligation',
        obligationId: view.obligation.obligationId,
        residualReleased: view.residualReleased,
      });
    } else if (view.residualReleased && view.remainingUnpaid.minorUnits > 0) {
      // A confirmed reservation release whose unpaid amount still stands is
      // recorded uncertainty: it cannot silently become certainty just
      // because the dispute overlay itself was resolved.
      poolReasons.push({
        type: 'releasedResidualUncertainty',
        obligationId: view.obligation.obligationId,
        releasedUnpaid: {
          currency: view.remainingUnpaid.currency,
          minorUnits: view.remainingUnpaid.minorUnits,
        },
      });
    }
  }

  const activeCycle = findOpenCycle(state);
  if (activeCycle === null) {
    // Cycles exist but none is open (between close and open): the last basis
    // is history, not a decision basis. Unresolved propagation conflicts
    // stay visible even here; the correction itself is never hidden.
    const historyReasons: CompletenessReason[] = [...poolReasons];
    for (const conflict of unresolvedConflicts(state)) {
      historyReasons.push({ type: 'unresolvedPropagationConflict', conflictId: conflict.conflictId });
    }
    historyReasons.push({ type: 'noActiveBasis' });
    const pool: CompletenessDimension = { state: 'recordsOnly', reasons: historyReasons };
    const classification: CompletenessDimension = { state: 'recordsOnly', reasons: [{ type: 'noActiveBasis' }] };
    return { pool, classification, asOfInstantMs: params.asOfInstantMs, calculationVersion: params.calculationVersion };
  }

  // Unresolved propagation conflicts degrade the pool until explicitly
  // resolved; the valid correction itself is never hidden. Accepted
  // reconciliation residuals never appear here: the observed pool is the
  // recorded truth, so an accepted adjustment reconciles the pool by
  // definition (its classification state lives in the other dimension).
  for (const conflict of unresolvedConflicts(state)) {
    poolReasons.push({ type: 'unresolvedPropagationConflict', conflictId: conflict.conflictId });
  }

  const pool: CompletenessDimension =
    poolReasons.length === 0
      ? { state: 'current', reasons: [] }
      : { state: 'needsAttention', reasons: poolReasons };

  // Classification covers the active basis only: old-cycle history outside
  // it never contaminates a newer pool, while unclassified adjustments keep
  // merchant/category analysis Needs Attention.
  const classificationReasons: CompletenessReason[] = [];
  const unclassified = liveExpenseEntries(state).filter(
    (entry) => entry.cycleId === activeCycle.cycleId && entry.category === null,
  );
  if (unclassified.length > 0) {
    classificationReasons.push({ type: 'unclassifiedExpenseMovements', count: unclassified.length });
  }
  for (const adjustment of state.adjustments) {
    if (adjustment.cycleId !== activeCycle.cycleId) continue;
    if (adjustment.classificationNote !== null) continue;
    // An unclassified adjustment keeps classification Needs Attention even
    // when its remainder is fully explained: the pool can be Current while
    // merchant/category analysis is not.
    classificationReasons.push({ type: 'unclassifiedAdjustment', observationId: adjustment.observationId });
  }
  const classification: CompletenessDimension =
    classificationReasons.length === 0
      ? { state: 'current', reasons: [] }
      : { state: 'needsAttention', reasons: classificationReasons };

  return { pool, classification, asOfInstantMs: params.asOfInstantMs, calculationVersion: params.calculationVersion };
}
