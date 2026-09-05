/**
 * Completeness: a deterministic reducer over recorded evidence, not a
 * manually toggled badge.
 *
 * Two independent dimensions are derived:
 * - pool completeness: whether there is an honest basis for the availability
 *   amount (a full-cycle start) and no unresolved material uncertainty
 *   (disputed reservations, released disputed residuals);
 * - classification completeness: the classified share of live pool
 *   movements.
 *
 * A reason can only disappear when its underlying evidence changes: an
 * unresolved dispute is not hidden by classifying every transaction, and an
 * unclassified expense does not invalidate a known pool. Task B derives from
 * the evidence these records support; Task C extends the reducer with
 * observed boundaries, recovery, and unresolved proposals, and those future
 * transition kinds are deliberately not invented here.
 */

import type { BookState } from '../contracts/ledger';
import { deriveObligationViews } from '../obligations/derive';
import { liveExpenseEntries } from '../activity/derive';

export type CompletenessState = 'current' | 'needsAttention' | 'recordsOnly' | 'unavailable';

export type CompletenessReason =
  | { readonly type: 'noPoolBasis' }
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
  | { readonly type: 'unclassifiedExpenseMovements'; readonly count: number };

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
  const pool: CompletenessDimension =
    poolReasons.length === 0
      ? { state: 'current', reasons: [] }
      : { state: 'needsAttention', reasons: poolReasons };

  const unclassified = liveExpenseEntries(state).filter((entry) => entry.category === null);
  const classification: CompletenessDimension =
    unclassified.length === 0
      ? { state: 'current', reasons: [] }
      : {
          state: 'needsAttention',
          reasons: [{ type: 'unclassifiedExpenseMovements', count: unclassified.length }],
        };

  return { pool, classification, asOfInstantMs: params.asOfInstantMs, calculationVersion: params.calculationVersion };
}
