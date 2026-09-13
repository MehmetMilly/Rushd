// P04-D2 declaration boundary for canonical read-model projections.
// Runtime lives in `./read-models.js`.
import type { BookState, CycleSettlement, ExpenseEntry } from '../../domain/contracts/ledger.ts';
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
export function isMonthKeyText(monthKey: unknown): boolean;
export function projectAvailabilityAmount(
  state: BookState | null | undefined,
  params: { readonly asOfInstantMs: number; readonly calculationVersion: string },
): number | null;
export function projectOpenCycleMonthKey(state: BookState | null | undefined): string | null;
export function projectMonthEntries(
  state: BookState | null | undefined,
  monthKey: string,
): ExpenseEntry[];
export function projectMonthPaidTotal(state: BookState | null | undefined, monthKey: string): number;
export function projectMonthCategoryBreakdown(
  state: BookState | null | undefined,
  monthKey: string,
): Array<{ category: string; amount: number; count: number }>;
export function projectMonthWeeklySpending(
  state: BookState | null | undefined,
  monthKey: string,
): Array<{ week: number; amount: number }>;
export function projectCommitmentsTotal(state: BookState | null | undefined): number;
export function projectTrackedPoolTotal(state: BookState | null | undefined): number;
export function projectPlanSummaries(state: BookState | null | undefined): Array<{
  planId: string;
  name: string;
  amount: number | null;
  scheduleDay: number | null;
  effectiveDate: string;
  flexibleDefinitionId: string | null;
  occurrenceCount: number;
}>;
export function projectBookSettings(
  state: BookState | null | undefined,
  isoDate: string,
): { timeZone: string; cycleAnchorKind: string; bufferAmount: number | null; currency: string } | null;
export function projectOpenCycleId(state: BookState | null | undefined): string | null;
export function projectLatestSettlement(
  state: BookState | null | undefined,
): CycleSettlement | null;
