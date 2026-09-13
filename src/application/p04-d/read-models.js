// P04-D2: canonical read-model projections for the candidate host.
//
// These functions derive legacy-shaped view rows from committed canonical
// `BookState` only. They reuse the domain derive helpers
// (`liveExpenseEntries`, `isExpenseLive`) and never restate finance rules:
// amounts come from committed entry money, liveness from reversal linkage,
// dates from committed civil dates. No v1 object is read here and no field
// is invented beyond an explicit, documented display default.
//
// Display-mapping notes (D3 canonical contract, corrected):
// - Canonical expenses are actuals. The established cards need one
//   legacy-shaped number, so the committed actual amount is displayed as
//   BOTH `expectedCost` and `actualPaid`, with `isPaid` true for every
//   live entry. There is no unpaid canonical expense: legacy unpaid rows
//   do not migrate as spendable facts, and no expected/obligation amount
//   is projected here (obligations and plans stay D4-owned).
// - `classification` has no canonical counterpart, so the field is EMPTY,
//   never `essential`: no false tag renders (the cards' luxury tag and
//   luxury styling only trigger on an explicit `luxury` value). A
//   luxury-labeled legacy row keeps its committed amount and note, but the
//   canonical view does not claim a classification it cannot derive.
// - `category` is preserved only when canonical state actually contains
//   it; an empty canonical category stays empty instead of substituting a
//   made-up `other` or `food`. Category pickers remain user-chosen input,
//   never inferred facts.
// - `name` mirrors the committed expense note verbatim; no bilingual
//   reshaping happens here. Amounts stay exact (minor units / 100 SAR).
// - Intentionally unavailable (never fabricated): exact dates for
//   obligations that retain only a due cycle, plan links, a monthly
//   budget figure, and any non-committed field. Home safe-to-spend is
//   D4-owned canonical availability (`computeAvailability`); it stays
//   `null` when no book/open cycle exists. Starting funds are not a
//   budget, so Insights `budgetKnown` stays false.

import {
  isExpenseLive,
  liveExpenseEntries,
} from '../../domain/activity/derive.ts';
import { deriveTrackedPool } from '../../domain/allocations/derive.ts';
import { deriveObligationViews } from '../../domain/obligations/derive.ts';
import { effectiveSettingsAt } from '../../domain/cycles/derive.ts';
import { findOpenCycle } from '../../domain/contracts/ledger.ts';
import { latestRevision } from '../../domain/plans/derive.ts';
import { computeAvailability } from '../../domain/calculations/availability.ts';

/**
 * @typedef {import('../../domain/contracts/ledger.ts').BookState} BookState
 * @typedef {import('../../domain/contracts/ledger.ts').ExpenseEntry} ExpenseEntry
 * @typedef {import('./contracts.ts').HomeDayExpense} HomeDayExpense
 * @typedef {import('./contracts.ts').HistoryExpenseRecord} HistoryExpenseRecord
 */

const SAR_MINOR_PER_MAJOR = 100;

/**
 * @param {number} minorUnits
 * @returns {number}
 */
export function minorUnitsToSarMajor(minorUnits) {
  return minorUnits / SAR_MINOR_PER_MAJOR;
}

/**
 * @param {BookState | null | undefined} state
 * @param {ExpenseEntry} entry
 * @returns {boolean}
 */
function liveIn(state, entry) {
  if (!state) return true;
  try {
    return isExpenseLive(state, entry.entryId);
  } catch {
    return true;
  }
}

/**
 * Project one canonical expense entry to the legacy-shaped day row.
 * Classification is empty when canonical state has none (never guessed);
 * category is preserved verbatim (never substituted).
 * @param {ExpenseEntry} entry
 * @param {boolean} paid
 * @returns {HomeDayExpense}
 */
export function projectHomeDayExpense(entry, paid) {
  const amount = minorUnitsToSarMajor(entry.amount.minorUnits);
  return {
    id: String(entry.entryId),
    name: entry.note || '',
    expectedCost: amount,
    actualPaid: amount,
    isPaid: paid,
    category: entry.category || '',
    classification: '',
    date: String(entry.localDate),
  };
}

/**
 * List the live canonical expenses attributed to one civil date.
 * @param {BookState | null | undefined} state
 * @param {string} isoDate Strict `YYYY-MM-DD`.
 * @returns {HomeDayExpense[]}
 */
export function projectSelectedDayExpenses(state, isoDate) {
  if (!state || typeof isoDate !== 'string' || !isoDate) return [];
  return liveExpenseEntries(state)
    .filter((entry) => String(entry.localDate) === isoDate)
    .map((entry) => projectHomeDayExpense(entry, liveIn(state, entry)));
}

/**
 * Sum of committed actuals for one day (paid/live entries only).
 * @param {BookState | null | undefined} state
 * @param {string} isoDate
 * @returns {number}
 */
export function projectDailyPaidTotal(state, isoDate) {
  return projectSelectedDayExpenses(state, isoDate)
    .filter((expense) => expense.isPaid)
    .reduce((sum, expense) => sum + expense.actualPaid, 0);
}

/**
 * Sum of committed amounts for one day. Canonical expenses are actuals, so
 * this mirrors the paid total until D3 projects expected amounts from
 * obligations and plans.
 * @param {BookState | null | undefined} state
 * @param {string} isoDate
 * @returns {number}
 */
export function projectDailyExpectedTotal(state, isoDate) {
  return projectSelectedDayExpenses(state, isoDate)
    .reduce((sum, expense) => sum + expense.expectedCost, 0);
}

/**
 * History-shaped record for one canonical expense entry.
 * @param {ExpenseEntry} entry
 * @param {boolean} paid
 * @returns {HistoryExpenseRecord}
 */
export function projectHistoryRecord(entry, paid) {
  const amount = minorUnitsToSarMajor(entry.amount.minorUnits);
  return {
    id: String(entry.entryId),
    date: String(entry.localDate),
    name: entry.note || '',
    expectedCost: amount,
    actualPaid: amount,
    isPaid: paid,
    category: entry.category || '',
    classification: '',
    cycleId: String(entry.cycleId),
    entryId: String(entry.entryId),
    sourceOperationId: String(entry.sourceOperationId),
  };
}

/**
 * List live canonical expenses for one civil date as history records.
 * @param {BookState | null | undefined} state
 * @param {string} isoDate
 * @returns {HistoryExpenseRecord[]}
 */
export function projectDayHistory(state, isoDate) {
  if (!state || typeof isoDate !== 'string' || !isoDate) return [];
  return liveExpenseEntries(state)
    .filter((entry) => String(entry.localDate) === isoDate)
    .map((entry) => projectHistoryRecord(entry, liveIn(state, entry)));
}

// --- P04-D4 month/plan/goal/settings projections. ---------------------------
// Every projection below derives from committed canonical `BookState` only,
// reusing the domain derive helpers. Monthly budget has no canonical fact
// (the legacy allowance became opening-cycle starting funds, the buffer is
// an explicit reserve), so Insights `budgetKnown` stays false and budget
// stays `null` — never converted to zero. Home/open-cycle safe-to-spend is
// canonical availability. Commitments are open-obligation residual
// reservations; the tracked pool comes from the allocation derive.

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * @param {unknown} monthKey
 * @returns {boolean}
 */
export function isMonthKeyText(monthKey) {
  return typeof monthKey === 'string' && MONTH_KEY_PATTERN.test(monthKey);
}

/**
 * Signed open-cycle availability in SAR major units, or `null` when the
 * book has no honest pool (no book, no open cycle, or unavailable
 * completeness). A computed zero is a real shortfall/exhaustion, not
 * unknown, and is never substituted for a missing cycle.
 * @param {BookState | null | undefined} state
 * @param {{ asOfInstantMs: number, calculationVersion: string }} params
 * @returns {number | null}
 */
export function projectAvailabilityAmount(state, params) {
  if (!state || !params || typeof params.asOfInstantMs !== 'number' || !params.calculationVersion) {
    return null;
  }
  try {
    const result = computeAvailability(state, params);
    if (result.status !== 'computed') return null;
    if (result.completeness?.pool?.state === 'unavailable') return null;
    return minorUnitsToSarMajor(result.available.minorUnits);
  } catch {
    return null;
  }
}

/**
 * Calendar month of the effective open cycle (`YYYY-MM`), or null.
 * @param {BookState | null | undefined} state
 * @returns {string | null}
 */
export function projectOpenCycleMonthKey(state) {
  if (!state) return null;
  try {
    const start = findOpenCycle(state)?.startDate;
    return typeof start === 'string' && isMonthKeyText(start.slice(0, 7)) ? start.slice(0, 7) : null;
  } catch {
    return null;
  }
}

/**
 * Live canonical expenses attributed to one calendar month.
 * @param {BookState | null | undefined} state
 * @param {string} monthKey Strict `YYYY-MM`.
 * @returns {import('../../domain/contracts/ledger.ts').ExpenseEntry[]}
 */
export function projectMonthEntries(state, monthKey) {
  if (!state || !isMonthKeyText(monthKey)) return [];
  return liveExpenseEntries(state).filter((entry) => String(entry.localDate).slice(0, 7) === monthKey);
}

/**
 * Sum of committed actuals for one calendar month.
 * @param {BookState | null | undefined} state
 * @param {string} monthKey
 * @returns {number}
 */
export function projectMonthPaidTotal(state, monthKey) {
  return projectMonthEntries(state, monthKey)
    .reduce((sum, entry) => sum + minorUnitsToSarMajor(entry.amount.minorUnits), 0);
}

/**
 * Month-level category breakdown from committed actuals. Categories render
 * verbatim; an empty canonical category stays empty, never a guessed
 * default.
 * @param {BookState | null | undefined} state
 * @param {string} monthKey
 * @returns {Array<{ category: string, amount: number, count: number }>}
 */
export function projectMonthCategoryBreakdown(state, monthKey) {
  const rows = projectMonthEntries(state, monthKey);
  const totals = new Map();
  for (const entry of rows) {
    const category = entry.category || '';
    totals.set(category, (totals.get(category) ?? 0) + minorUnitsToSarMajor(entry.amount.minorUnits));
  }
  return [...totals.entries()].map(([category, amount]) => ({
    category,
    amount,
    count: rows.filter((entry) => (entry.category || '') === category).length,
  }));
}

/**
 * Weekly spending buckets for one calendar month (week 1 = days 1-7).
 * @param {BookState | null | undefined} state
 * @param {string} monthKey
 * @returns {Array<{ week: number, amount: number }>}
 */
export function projectMonthWeeklySpending(state, monthKey) {
  const rows = projectMonthEntries(state, monthKey);
  const totals = new Map();
  for (const entry of rows) {
    const day = Number(String(entry.localDate).slice(8, 10));
    const week = Number.isFinite(day) && day > 0 ? Math.ceil(day / 7) : 0;
    totals.set(week, (totals.get(week) ?? 0) + minorUnitsToSarMajor(entry.amount.minorUnits));
  }
  return [...totals.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([week, amount]) => ({ week, amount }));
}

/**
 * Open-obligation residual reservations: money encumbered but not yet paid.
 * @param {BookState | null | undefined} state
 * @returns {number}
 */
export function projectCommitmentsTotal(state) {
  if (!state) return 0;
  try {
    return deriveObligationViews(state)
      .filter((view) => view.status === 'open')
      .reduce((sum, view) => sum + minorUnitsToSarMajor(view.residualReservation.minorUnits), 0);
  } catch {
    return 0;
  }
}

/**
 * Tracked-pool (vault) total from the allocation derive.
 * @param {BookState | null | undefined} state
 * @returns {number}
 */
export function projectTrackedPoolTotal(state) {
  if (!state) return 0;
  try {
    return minorUnitsToSarMajor(deriveTrackedPool(state).total.minorUnits);
  } catch {
    return 0;
  }
}

/**
 * Canonical recurring-plan summaries with the latest effective revision and
 * managed-occurrence counts. Profiles/offdays have no canonical counterpart
 * and are never synthesized here.
 * @param {BookState | null | undefined} state
 * @returns {Array<{ planId: string, name: string, amount: number | null, scheduleDay: number | null, effectiveDate: string, flexibleDefinitionId: string | null, occurrenceCount: number }>}
 */
export function projectPlanSummaries(state) {
  if (!state || !Array.isArray(state.plans)) return [];
  return state.plans.map((plan) => {
    let revision = null;
    try {
      revision = latestRevision(state, plan.planId);
    } catch {
      revision = null;
    }
    const occurrenceCount = Array.isArray(state.planOccurrences)
      ? state.planOccurrences.filter((occurrence) => String(occurrence.planId) === String(plan.planId)).length
      : 0;
    return {
      planId: String(plan.planId),
      name: String(plan.name ?? plan.planId),
      // D4 correction: project only committed fields. A missing revision
      // amount or schedule day stays null (unknown) — defaulting to 0 or
      // day 1 would invent plan facts the book never committed.
      amount: revision?.amount != null ? minorUnitsToSarMajor(revision.amount.minorUnits) : null,
      scheduleDay: revision?.scheduleDay ?? null,
      effectiveDate: String(revision?.effectiveDate ?? ''),
      flexibleDefinitionId: plan.flexibleDefinitionId ?? null,
      occurrenceCount,
    };
  });
}

/**
 * Effective book settings (timezone/anchor) at one civil date, plus the
 * explicit buffer reserve. The buffer is a reserve, never a budget.
 * @param {BookState | null | undefined} state
 * @param {string} isoDate
 * @returns {{ timeZone: string, cycleAnchorKind: string, bufferAmount: number | null, currency: string } | null}
 */
export function projectBookSettings(state, isoDate) {
  if (!state || !state.book) return null;
  try {
    const effective = effectiveSettingsAt(state, isoDate);
    return {
      timeZone: String(effective.timeZone),
      cycleAnchorKind: String(effective.cycleAnchor?.kind ?? 'firstOfMonth'),
      bufferAmount: state.buffer ? minorUnitsToSarMajor(state.buffer.amount.minorUnits) : null,
      currency: String(state.book.currency),
    };
  } catch {
    return null;
  }
}

/**
 * Logical id of the effective open cycle, or null when no cycle is open.
 * @param {BookState | null | undefined} state
 * @returns {string | null}
 */
export function projectOpenCycleId(state) {
  if (!state) return null;
  try {
    return findOpenCycle(state)?.cycleId ? String(findOpenCycle(state).cycleId) : null;
  } catch {
    return null;
  }
}

/**
 * Latest unreversed settlement snapshot, or null when no cycle has closed.
 * @param {BookState | null | undefined} state
 * @returns {import('../../domain/contracts/ledger.ts').CycleSettlement | null}
 */
export function projectLatestSettlement(state) {
  if (!state || !Array.isArray(state.settlements) || state.settlements.length === 0) return null;
  const live = state.settlements.filter((settlement) => settlement.reversed !== true);
  if (live.length === 0) return null;
  return live[live.length - 1];
}
