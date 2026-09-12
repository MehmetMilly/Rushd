// P04-D2 declaration boundary for canonical read-model projections.
// Runtime lives in `./read-models.js`.
import type { BookState, ExpenseEntry } from '../../domain/contracts/ledger.ts';
import type { HistoryExpenseRecord, HomeDayExpense } from './contracts.ts';

export function minorUnitsToSarMajor(minorUnits: number): number;
export function projectHomeDayExpense(entry: ExpenseEntry, paid: boolean): HomeDayExpense;
export function projectSelectedDayExpenses(
  state: BookState | null | undefined,
  isoDate: string,
): HomeDayExpense[];
export function projectDailyPaidTotal(state: BookState | null | undefined, isoDate: string): number;
export function projectDailyExpectedTotal(
  state: BookState | null | undefined,
  isoDate: string,
): number;
export function projectHistoryRecord(entry: ExpenseEntry, paid: boolean): HistoryExpenseRecord;
export function projectDayHistory(
  state: BookState | null | undefined,
  isoDate: string,
): HistoryExpenseRecord[];
