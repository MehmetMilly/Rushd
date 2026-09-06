/**
 * Pure derivations for effective-dated recurring plans and stable
 * occurrences.
 *
 * The plan holds identity and the anchor snapshot; the money and schedule
 * live in immutable revisions. A revision governs occurrences due on or
 * after its effective date. Paid and detached occurrences keep their
 * historical revision byte-for-byte; only future unpaid managed occurrences
 * follow a new revision.
 *
 * Occurrence identity is deterministic (`occ:<planId>:<dueDate>` at
 * materialization) so materialization and retries never duplicate. Short
 * months clamp the schedule day explicitly. Reserving a managed occurrence
 * creates its obligation; paying it moves actual money in the payment's
 * occurrence cycle while the expectation retains its due-cycle identity.
 * Flexible-definition links stay descriptive and arithmetic-neutral.
 */

import { makeMoney, type Money } from '../primitives/money';
import { compareCivilDates, daysInGregorianMonth, makeCivilDate, type CivilDate } from '../primitives/civil-date';
import { monthlyCycleContaining } from '../primitives/monthly-cycle';
import {
  composeCycleId,
  makeOccurrenceId,
  type CycleId,
  type OccurrenceId,
} from '../contracts/identity';
import type { BookState, PlanOccurrence, PlanRevision, RecurringPlan } from '../contracts/ledger';
import { grossLivePaymentsFor } from '../obligations/derive';
import { findExpenseEntry, isExpenseLive } from '../activity/derive';

function zeroOf(currency: Money['currency']): Money {
  const made = makeMoney(currency, 0);
  if (!made.ok) throw new TypeError('book currency must be supported');
  return made.value;
}

/** Revisions of one plan in append order. */
export function revisionsOf(state: BookState, planId: RecurringPlan['planId']): readonly PlanRevision[] {
  return state.planRevisions.filter((revision) => revision.planId === planId);
}

/**
 * The revision governing occurrences due on `date`: the latest effective
 * revision at or before it (ties resolve to the last appended). Null when no
 * revision covers the date yet.
 */
export function applicableRevision(
  state: BookState,
  planId: RecurringPlan['planId'],
  date: CivilDate,
): PlanRevision | null {
  let best: PlanRevision | null = null;
  for (const revision of revisionsOf(state, planId)) {
    if (compareCivilDates(revision.effectiveDate, date) <= 0) best = revision;
  }
  return best;
}

/** The latest revision of a plan regardless of date, if any. */
export function latestRevision(state: BookState, planId: RecurringPlan['planId']): PlanRevision | null {
  const revisions = revisionsOf(state, planId);
  return revisions.length === 0 ? null : revisions[revisions.length - 1];
}

/**
 * The deterministic occurrence identity for a plan and due date: plan plus
 * monthly period key. One monthly slot remains one occurrence across
 * schedule-day revisions, so rematerialization can never create a duplicate
 * payable occurrence; the mutable due date lives on the row, not in the
 * identity.
 */
export function occurrenceIdFor(
  planId: RecurringPlan['planId'],
  dueDate: CivilDate,
): { ok: true; value: OccurrenceId } | { ok: false; detail: string } {
  const made = makeOccurrenceId(`occ:${planId}:${dueDate.slice(0, 7)}`);
  if (!made.ok) return { ok: false, detail: made.failure.detail };
  return { ok: true, value: made.value };
}

/** Clamps a schedule day to the month's last valid day. */
export function clampedDueDate(year: number, month: number, scheduleDay: number): CivilDate {
  const monthLength = daysInGregorianMonth(year, month);
  if (monthLength === null) throw new TypeError(`cannot clamp schedule day for invalid month ${year}-${month}`);
  const day = Math.min(scheduleDay, monthLength);
  const made = makeCivilDate(year, month, day);
  if (!made.ok) throw new TypeError(`clamped schedule day is invalid (${made.failure.reason})`);
  return made.value;
}

export interface MaterializedOccurrence {
  readonly occurrenceId: OccurrenceId;
  readonly dueDate: CivilDate;
  readonly dueCycleId: CycleId;
  readonly revisionId: PlanRevision['revisionId'];
}

/**
 * Plans the occurrences due from the earliest revision through
 * `throughDate`, skipping already-materialized identities. Pure: callers
 * append the returned rows. Short-month schedule days clamp; each
 * occurrence keeps its governing revision, due date, due-cycle identity,
 * and managed state.
 */
export function planMaterialization(
  state: BookState,
  plan: RecurringPlan,
  throughDate: CivilDate,
): { ok: true; value: readonly MaterializedOccurrence[] } | { ok: false; detail: string } {
  const revisions = revisionsOf(state, plan.planId);
  if (revisions.length === 0) return { ok: false, detail: `plan ${plan.planId} has no revisions` };
  const earliest = revisions[0].effectiveDate;
  if (compareCivilDates(throughDate, earliest) < 0) {
    return { ok: false, detail: `throughDate ${throughDate} precedes the first revision ${earliest}` };
  }

  const existing = new Set<string>(state.planOccurrences.map((occurrence) => occurrence.occurrenceId));
  const rows: MaterializedOccurrence[] = [];
  let year = Number(earliest.slice(0, 4));
  let month = Number(earliest.slice(5, 7));
  const endYear = Number(throughDate.slice(0, 4));
  const endMonth = Number(throughDate.slice(5, 7));

  for (;;) {
    // A revision governs a month when its effective date is at or before the
    // due date it would produce; later revisions overwrite earlier ones. This
    // stays exact when a mid-month revision also changes the schedule day.
    let chosen: PlanRevision | null = null;
    for (const revision of revisions) {
      const candidateDue = clampedDueDate(year, month, revision.scheduleDay);
      if (compareCivilDates(revision.effectiveDate, candidateDue) <= 0) chosen = revision;
    }
    if (chosen !== null) {
      const dueDate = clampedDueDate(year, month, chosen.scheduleDay);
      if (compareCivilDates(dueDate, throughDate) <= 0) {
        const id = occurrenceIdFor(plan.planId, dueDate);
        if (!id.ok) return { ok: false, detail: id.detail };
        if (!existing.has(id.value)) {
          const window = monthlyCycleContaining(plan.anchor, dueDate);
          const cycleId = composeCycleId(plan.bookId, window.startDate);
          if (!cycleId.ok) return { ok: false, detail: `due cycle could not be composed (${cycleId.failure.detail})` };
          existing.add(id.value);
          rows.push({ occurrenceId: id.value, dueDate, dueCycleId: cycleId.value, revisionId: chosen.revisionId });
        }
      }
    }
    if (year === endYear && month === endMonth) break;
    if (month === 12) {
      year += 1;
      month = 1;
    } else {
      month += 1;
    }
    if (year > endYear + 1) break;
  }
  return { ok: true, value: rows };
}

/**
 * True when an occurrence is paid: a live linked expense exists, or its
 * linked obligation has live (unreversed) payments. Paid occurrences keep
 * their historical revision forever.
 */
export function isOccurrencePaid(state: BookState, occurrence: PlanOccurrence): boolean {
  if (occurrence.linkedExpenseEntryId !== null) {
    const expense = findExpenseEntry(state, occurrence.linkedExpenseEntryId);
    if (expense !== null && isExpenseLive(state, expense.entryId)) return true;
  }
  if (occurrence.linkedObligationId !== null) {
    const gross = grossLivePaymentsFor(state, occurrence.linkedObligationId);
    if (gross !== null && gross.minorUnits > 0) return true;
  }
  return false;
}

/**
 * The expected amount currently governing an occurrence: its attributed
 * revision's amount (zero when the revision vanished, which cannot happen in
 * an honest state).
 */
export function occurrenceExpectedAmount(state: BookState, occurrence: PlanOccurrence): Money {
  const revision = state.planRevisions.find((candidate) => candidate.revisionId === occurrence.revisionId) ?? null;
  if (revision === null) return zeroOf(state.book.currency);
  return revision.amount;
}
