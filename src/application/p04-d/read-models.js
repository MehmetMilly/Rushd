// P04-D2: canonical read-model projections for the candidate host.
//
// These functions derive legacy-shaped view rows from committed canonical
// `BookState` only. They reuse the domain derive helpers
// (`liveExpenseEntries`, `isExpenseLive`) and never restate finance rules:
// amounts come from committed entry money, liveness from reversal linkage,
// dates from committed civil dates. No v1 object is read here and no field
// is invented beyond an explicit, documented display default.
//
// Display-mapping notes (D3-owned refinements):
// - Canonical expenses are actuals; `expectedCost` mirrors the committed
//   actual until D3 projects obligations/plans as expected amounts.
// - `classification` has no canonical counterpart yet and defaults to
//   `essential`; D3 replaces it with the real derivation.
// - `name` mirrors the committed expense note; D3 owns bilingual display
//   shaping. Amounts stay exact (minor units / 100 for SAR majors).

import {
  isExpenseLive,
  liveExpenseEntries,
} from '../../domain/activity/derive.ts';

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
    category: entry.category || 'other',
    classification: 'essential',
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
    category: entry.category || 'other',
    classification: 'essential',
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
