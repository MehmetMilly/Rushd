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
//   obligations that retain only a due cycle, plan links, monthly
//   budget/safe-to-spend values, and any non-committed field. Home
//   safe-to-spend reads `null` (unknown) until D4 owns availability.

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
