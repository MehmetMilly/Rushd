/**
 * Deterministic mapping from extracted v1 records to typed P03 commands
 * plus review/quarantine evidence. Canonical writes happen later through
 * executeCommand; this module only plans them.
 */

import type { FinanceCommand } from '../../domain/contracts/commands';
import { parseCivilDate, type CivilDate } from '../../domain/primitives/civil-date';
import { isValidTimeZoneName } from '../../domain/primitives/instant';
import { addMoney, makeMoney, subtractMoney } from '../../domain/primitives/money';
import { canonicalJson, stableDigest } from '../../domain/contracts/canonical';
import { composeCycleId, makeBookId, makeGoalId, makeObligationId, makeOperationId, makePlanId, makeSettlementId } from '../../domain/contracts/identity';
import { LEGACY_MIGRATION_CURRENCY, convertUntaggedSarMajor, requireNonNegative, requireStrictlyPositive, type SourceRef } from './money-conversion';
import { settingValue, type ExtractedLegacySnapshot, type ExtractedRecord } from './extract';
import { MIGRATION_REASON, type MigrationReasonCode } from './reasons';

export const LEGACY_GUEST_BOOK_ID = 'legacy-guest-book';
export const DEFAULT_TIME_ZONE = 'Asia/Riyadh';
export const DEFAULT_CYCLE_START = '2026-08-01';

export interface ReviewItem {
  readonly reason: MigrationReasonCode;
  readonly source: SourceRef | null;
  readonly originalValue: unknown;
  readonly detail: string;
  readonly needsAttention: true;
}

export interface PlannedCommand {
  readonly operationId: string;
  readonly command: FinanceCommand;
  readonly sourceIds: readonly string[];
}

export interface MigrationPlan {
  readonly bookId: string;
  readonly currency: typeof LEGACY_MIGRATION_CURRENCY;
  readonly commands: readonly PlannedCommand[];
  readonly review: readonly ReviewItem[];
  readonly preservedSourceIds: readonly string[];
  readonly openingVaultMinorUnits: number;
  readonly budgetCarryInIds: readonly string[];
  readonly vaultFundingIds: readonly string[];
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const ENTITY_ID = /^[\x21-\x7e]{1,100}$/;
const SETTLEMENT_DECISIONS = new Set(['vault', 'budget', 'no_surplus']);

function source(store: SourceRef['store'], recordKey: string, field: string): SourceRef {
  return { database: 'MicroSaveOS_DB', databaseVersion: 1, store, recordKey, field };
}

function review(reason: MigrationReasonCode, originalValue: unknown, detail: string, src: SourceRef | null = null): ReviewItem {
  return { reason, source: src, originalValue, detail, needsAttention: true };
}

function clipNote(text: string): string {
  return text.length <= 280 ? text : text.slice(0, 280);
}

function monthStart(monthKey: string): string {
  return `${monthKey}-01`;
}

function monthKeyFromDate(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return date.slice(0, 7);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stableOp(kind: string, sourceId: string, generated: Set<string>, reviewItems: ReviewItem[], original: unknown, src: SourceRef | null): string | null {
  const raw = `mg:${kind}:${sourceId}`;
  const candidate = raw.length <= 100 ? raw : `mg:${kind}:${stableDigest(canonicalJson({ kind, sourceId }))}`;
  if (candidate.length > 100) {
    reviewItems.push(review(MIGRATION_REASON.operationIdCollision, original, 'generated operation id exceeds the identity bound', src));
    return null;
  }
  if (generated.has(candidate)) {
    reviewItems.push(review(MIGRATION_REASON.operationIdCollision, original, `generated operation id collides for distinct source ${sourceId}`, src));
    return null;
  }
  generated.add(candidate);
  return candidate;
}

function addSar(left: number, right: number): { ok: true; minorUnits: number } | { ok: false } {
  const a = makeMoney(LEGACY_MIGRATION_CURRENCY, left);
  const b = makeMoney(LEGACY_MIGRATION_CURRENCY, right);
  if (!a.ok || !b.ok) return { ok: false };
  const sum = addMoney(a.value, b.value);
  if (!sum.ok) return { ok: false };
  return { ok: true, minorUnits: sum.value.minorUnits };
}

function subtractSar(left: number, right: number): { ok: true; minorUnits: number } | { ok: false } {
  const a = makeMoney(LEGACY_MIGRATION_CURRENCY, left);
  const b = makeMoney(LEGACY_MIGRATION_CURRENCY, right);
  if (!a.ok || !b.ok) return { ok: false };
  const difference = subtractMoney(a.value, b.value);
  if (!difference.ok) return { ok: false };
  return { ok: true, minorUnits: difference.value.minorUnits };
}

function validEntityId(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !ENTITY_ID.test(value)) return null;
  return value;
}

interface SettlementView {
  readonly previousMonthKey: string;
  readonly decision: 'vault' | 'budget' | 'no_surplus';
  readonly targetMonthKey: string;
  readonly targetMonthKeyValid: boolean;
  readonly surplus: unknown;
  readonly vaultTransactionId: string;
  readonly fundingEligible: boolean;
  readonly raw: unknown;
}

interface VaultTxView {
  readonly id: string;
  readonly amount: unknown;
  readonly date: string;
  readonly sourceMonthKey: string;
  readonly raw: unknown;
}

export function planLegacyMigration(snapshot: ExtractedLegacySnapshot): MigrationPlan {
  const reviewItems: ReviewItem[] = [];
  const commands: PlannedCommand[] = [];
  const preservedSourceIds: string[] = [];
  const seenIds = new Map<string, string>();
  const generatedOperationIds = new Set<string>();
  const budgetCarryInIds: string[] = [];
  const vaultFundingIds: string[] = [];

  const timeZone = DEFAULT_TIME_ZONE;
  if (!isValidTimeZoneName(timeZone)) throw new Error('Asia/Riyadh must remain a valid timezone');
  const pendingSettlement = makeSettlementId('pending-close');
  if (!pendingSettlement.ok) throw new Error('pending settlement placeholder is invalid');
  const bookMade = makeBookId(LEGACY_GUEST_BOOK_ID);
  if (!bookMade.ok) throw new Error('legacy guest book id is invalid');
  const bookId = bookMade.value;

  const rememberId = (id: string, kind: string, original: unknown, src: SourceRef): boolean => {
    const existing = seenIds.get(id);
    if (existing !== undefined) {
      reviewItems.push(review(MIGRATION_REASON.duplicateId, original, `${kind} id ${id} duplicates ${existing}`, src));
      return false;
    }
    seenIds.set(id, kind);
    preservedSourceIds.push(id);
    return true;
  };

  const moneyOf = (value: unknown, src: SourceRef, mode: 'any' | 'nonNegative' | 'positive') => {
    const converted = convertUntaggedSarMajor(value, src);
    if (mode === 'nonNegative') return requireNonNegative(converted);
    if (mode === 'positive') return requireStrictlyPositive(converted);
    return converted;
  };

  const planOp = (kind: string, sourceId: string, original: unknown = sourceId, src: SourceRef | null = null): string | null =>
    stableOp(kind, sourceId, generatedOperationIds, reviewItems, original, src);

  const pushCommand = (operationId: string | null, command: FinanceCommand, sourceIds: readonly string[]) => {
    if (operationId === null) return;
    const made = makeOperationId(operationId);
    if (!made.ok) {
      reviewItems.push(review(MIGRATION_REASON.invalidId, operationId, made.failure.detail, null));
      return;
    }
    commands.push({ operationId, command, sourceIds });
  };

  pushCommand(planOp('book', LEGACY_GUEST_BOOK_ID), {
    kind: 'createBook',
    bookId,
    displayName: 'Rushd guest book',
    currency: LEGACY_MIGRATION_CURRENCY,
    timeZone,
    cycleAnchor: { kind: 'firstOfMonth' },
  }, []);

  const allowanceRaw = settingValue(snapshot, 'baseAllowance');
  const allowance = moneyOf(allowanceRaw, source('settings', 'baseAllowance', 'value'), 'nonNegative');
  if (!allowance.ok) reviewItems.push(review(allowance.reason, allowance.originalValue, allowance.detail, allowance.source));
  const monthlyAllowances = asRecord(settingValue(snapshot, 'monthlyBaseAllowances')) ?? {};

  const vaultRaw = asRecord(settingValue(snapshot, 'vault')) ?? { balance: 0, transactions: [], goals: [] };
  const vaultTxRaw = Array.isArray(vaultRaw['transactions']) ? vaultRaw['transactions'] : [];
  if (vaultRaw['transactions'] !== undefined && !Array.isArray(vaultRaw['transactions'])) {
    reviewItems.push(review(MIGRATION_REASON.malformedRecord, vaultRaw['transactions'], 'vault.transactions is not an array', source('settings', 'vault', 'transactions')));
  }
  const vaultTx: VaultTxView[] = [];
  const vaultTxIds = new Set<string>();
  for (const row of vaultTxRaw) {
    const record = asRecord(row);
    if (record === null) {
      reviewItems.push(review(MIGRATION_REASON.malformedRecord, row, 'vault transaction is not an object', source('settings', 'vault', 'transactions')));
      continue;
    }
    const id = validEntityId(typeof record['id'] === 'string' ? record['id'] : null);
    if (id === null) {
      reviewItems.push(review(MIGRATION_REASON.invalidId, record['id'], 'vault transaction id is missing or invalid', source('settings', 'vault', 'id')));
      continue;
    }
    if (vaultTxIds.has(id)) {
      reviewItems.push(review(MIGRATION_REASON.duplicateId, record, `vault transaction ${id} is duplicated`, source('settings', 'vault', 'id')));
      continue;
    }
    vaultTxIds.add(id);
    const date = typeof record['date'] === 'string' ? record['date'] : '';
    const parsedDate = date.length > 0 ? parseCivilDate(date) : null;
    if (date.length > 0 && (parsedDate === null || !parsedDate.ok)) {
      reviewItems.push(review(MIGRATION_REASON.malformedDate, date, `vault transfer ${id} date is not a civil date`, source('settings', 'vault', `transactions.${id}.date`)));
    }
    const sourceMonthKey = typeof record['sourceMonthKey'] === 'string' && MONTH_KEY.test(record['sourceMonthKey'])
      ? record['sourceMonthKey']
      : monthKeyFromDate(date) ?? '';
    const dateMonth = parsedDate !== null && parsedDate.ok ? monthKeyFromDate(parsedDate.value) : monthKeyFromDate(date);
    if (MONTH_KEY.test(sourceMonthKey) && dateMonth !== null && sourceMonthKey !== dateMonth) {
      reviewItems.push(review(
        MIGRATION_REASON.contradictorySettlement,
        record,
        `vault transfer ${id} sourceMonthKey ${sourceMonthKey} contradicts date month ${dateMonth}`,
        source('settings', 'vault', `transactions.${id}`),
      ));
    }
    vaultTx.push({ id, amount: record['amount'], date, sourceMonthKey, raw: record });
  }

  let txSumResult = 0;
  let txSumFailed = false;
  for (const tx of vaultTx) {
    const converted = moneyOf(tx.amount, source('settings', 'vault', `transactions.${tx.id}.amount`), 'positive');
    if (!converted.ok) {
      reviewItems.push(review(converted.reason, converted.originalValue, converted.detail, converted.source));
      continue;
    }
    const added = addSar(txSumResult, converted.money.minorUnits);
    if (!added.ok) {
      reviewItems.push(review(MIGRATION_REASON.unsafeAmount, converted.money.minorUnits, `vault transfer ${tx.id} cannot be accumulated as a safe integer`, source('settings', 'vault', `transactions.${tx.id}.amount`)));
      txSumFailed = true;
      continue;
    }
    txSumResult = added.minorUnits;
  }

  const storedOpening = vaultRaw['openingBalance'];
  const storedBalance = vaultRaw['balance'];
  let openingMinor = 0;
  if (storedOpening !== undefined) {
    const converted = moneyOf(storedOpening, source('settings', 'vault', 'openingBalance'), 'nonNegative');
    if (!converted.ok) reviewItems.push(review(converted.reason, converted.originalValue, converted.detail, converted.source));
    else openingMinor = converted.money.minorUnits;
  } else if (vaultTx.length > 0) {
    const converted = moneyOf(storedBalance ?? 0, source('settings', 'vault', 'balance'), 'nonNegative');
    if (!converted.ok) reviewItems.push(review(converted.reason, converted.originalValue, converted.detail, converted.source));
    else if (txSumFailed) {
      reviewItems.push(review(MIGRATION_REASON.unsafeAmount, storedBalance, 'vault opening cannot be derived because transfer totals are unsafe', source('settings', 'vault', 'balance')));
      openingMinor = 0;
    } else {
      const derived = subtractSar(converted.money.minorUnits, txSumResult);
      if (!derived.ok || derived.minorUnits < 0) {
        reviewItems.push(review(MIGRATION_REASON.overlappingOpeningSettlement, storedBalance, 'vault balance is smaller than the sum of surplus transfers', source('settings', 'vault', 'balance')));
        openingMinor = 0;
      } else openingMinor = derived.minorUnits;
    }
  } else {
    const converted = moneyOf(storedBalance ?? 0, source('settings', 'vault', 'balance'), 'nonNegative');
    if (!converted.ok) reviewItems.push(review(converted.reason, converted.originalValue, converted.detail, converted.source));
    else openingMinor = converted.money.minorUnits;
  }

  if (storedOpening !== undefined && vaultTx.length > 0 && storedBalance !== undefined) {
    const balanceConv = moneyOf(storedBalance, source('settings', 'vault', 'balance'), 'nonNegative');
    const composed = addSar(openingMinor, txSumResult);
    if (balanceConv.ok && (!composed.ok || balanceConv.money.minorUnits !== composed.minorUnits)) {
      reviewItems.push(review(
        MIGRATION_REASON.overlappingOpeningSettlement,
        storedBalance,
        'vault opening plus surplus transfers does not equal stored balance',
        source('settings', 'vault', 'balance'),
      ));
    }
  }

  const settlementRaw = settingValue(snapshot, 'monthEndSettlements');
  const settlementRows = Array.isArray(settlementRaw) ? settlementRaw : [];
  if (settlementRaw !== undefined && !Array.isArray(settlementRaw)) {
    reviewItems.push(review(MIGRATION_REASON.malformedRecord, settlementRaw, 'monthEndSettlements is not an array', source('settings', 'monthEndSettlements', 'value')));
  }
  const draftSettlements: Omit<SettlementView, 'fundingEligible'>[] = [];
  const seenMonths = new Set<string>();
  for (const row of settlementRows) {
    const record = asRecord(row);
    if (record === null) {
      reviewItems.push(review(MIGRATION_REASON.malformedRecord, row, 'settlement is not an object', source('settings', 'monthEndSettlements', 'item')));
      continue;
    }
    const previousMonthKey = typeof record['previousMonthKey'] === 'string' ? record['previousMonthKey'] : '';
    const decision = typeof record['decision'] === 'string' ? record['decision'] : '';
    if (!MONTH_KEY.test(previousMonthKey) || !SETTLEMENT_DECISIONS.has(decision)) {
      reviewItems.push(review(MIGRATION_REASON.malformedRecord, record, 'settlement month or decision is invalid', source('settings', 'monthEndSettlements', previousMonthKey || 'item')));
      continue;
    }
    if (seenMonths.has(previousMonthKey)) {
      reviewItems.push(review(MIGRATION_REASON.duplicateSettlement, record, `settlement for ${previousMonthKey} is duplicated`, source('settings', 'monthEndSettlements', previousMonthKey)));
      continue;
    }
    seenMonths.add(previousMonthKey);
    const targetMonthKey = typeof record['targetMonthKey'] === 'string' ? record['targetMonthKey'] : '';
    draftSettlements.push({
      previousMonthKey,
      decision: decision as SettlementView['decision'],
      targetMonthKey,
      targetMonthKeyValid: MONTH_KEY.test(targetMonthKey),
      surplus: record['surplus'],
      vaultTransactionId: typeof record['vaultTransactionId'] === 'string' ? record['vaultTransactionId'] : '',
      raw: record,
    });
  }

  const vaultLinkCount = new Map<string, number>();
  for (const settlement of draftSettlements) {
    if (settlement.decision !== 'vault') continue;
    if (settlement.vaultTransactionId.length === 0) {
      reviewItems.push(review(MIGRATION_REASON.missingSettlement, settlement.raw, `vault settlement ${settlement.previousMonthKey} has no vault transaction link`, source('settings', 'monthEndSettlements', settlement.previousMonthKey)));
      continue;
    }
    vaultLinkCount.set(settlement.vaultTransactionId, (vaultLinkCount.get(settlement.vaultTransactionId) ?? 0) + 1);
  }
  const reusedVaultLinks = new Set([...vaultLinkCount.entries()].filter(([, count]) => count > 1).map(([id]) => id));
  for (const id of reusedVaultLinks) {
    reviewItems.push(review(MIGRATION_REASON.duplicateSettlement, id, `vault transaction ${id} is linked from more than one settlement`, source('settings', 'vault', `transactions.${id}`)));
  }

  const settlementsByMonth = new Map<string, SettlementView>();
  const linkedVaultTxIds = new Set<string>();
  const reusedPreservationIds = new Set<string>();
  for (const settlement of draftSettlements) {
    let fundingEligible = false;
    if (settlement.decision === 'vault') {
      const link = settlement.vaultTransactionId;
      if (link.length === 0) {
        fundingEligible = false;
      } else if (reusedVaultLinks.has(link)) {
        fundingEligible = false;
        reusedPreservationIds.add(link);
      } else if (!vaultTxIds.has(link)) {
        reviewItems.push(review(MIGRATION_REASON.missingSettlement, settlement.raw, `vault settlement ${settlement.previousMonthKey} is missing transfer ${link}`, source('settings', 'monthEndSettlements', settlement.previousMonthKey)));
        fundingEligible = false;
      } else {
        fundingEligible = true;
        linkedVaultTxIds.add(link);
      }
    }
    if (settlement.decision === 'budget' && !settlement.targetMonthKeyValid) {
      reviewItems.push(review(MIGRATION_REASON.malformedDate, settlement.raw, `budget settlement ${settlement.previousMonthKey} targetMonthKey is invalid`, source('settings', 'monthEndSettlements', settlement.previousMonthKey)));
    }
    settlementsByMonth.set(settlement.previousMonthKey, { ...settlement, fundingEligible });
  }

  for (const tx of vaultTx) {
    if (linkedVaultTxIds.has(tx.id) || reusedVaultLinks.has(tx.id)) continue;
    reviewItems.push(review(MIGRATION_REASON.missingSettlement, tx.raw, `vault transfer ${tx.id} has no matching month-end settlement`, source('settings', 'vault', `transactions.${tx.id}`)));
  }

  const expenseRecords = snapshot.expenses;
  const datedMonths = new Set<string>();
  for (const assignment of Array.isArray(settingValue(snapshot, 'monthlyTemplateAssignments')) ? (settingValue(snapshot, 'monthlyTemplateAssignments') as unknown[]) : []) {
    const record = asRecord(assignment);
    const monthKey = typeof record?.['monthKey'] === 'string' ? record['monthKey'] : '';
    if (MONTH_KEY.test(monthKey)) datedMonths.add(monthKey);
  }
  for (const settlement of settlementsByMonth.values()) {
    datedMonths.add(settlement.previousMonthKey);
    if (MONTH_KEY.test(settlement.targetMonthKey)) datedMonths.add(settlement.targetMonthKey);
  }
  for (const tx of vaultTx) {
    const month = monthKeyFromDate(tx.date);
    if (month) datedMonths.add(month);
    if (MONTH_KEY.test(tx.sourceMonthKey)) datedMonths.add(tx.sourceMonthKey);
  }

  const parsedExpenses: {
    record: ExtractedRecord;
    date: CivilDate | null;
    monthKey: string | null;
  }[] = [];
  for (const expense of expenseRecords) {
    const id = expense.id;
    const src = source('expenses', id ?? 'missing', 'id');
    if (id === null) {
      reviewItems.push(review(MIGRATION_REASON.missingId, expense.raw, 'expense id is missing', src));
      parsedExpenses.push({ record: expense, date: null, monthKey: null });
      continue;
    }
    if (validEntityId(id) === null) {
      reviewItems.push(review(MIGRATION_REASON.invalidId, id, 'expense id is not a stable printable identity', src));
      parsedExpenses.push({ record: expense, date: null, monthKey: null });
      continue;
    }
    if (!rememberId(id, 'expense', expense.raw, src)) {
      parsedExpenses.push({ record: expense, date: null, monthKey: null });
      continue;
    }
    const dateText = expense.raw['date'];
    const parsedDate = typeof dateText === 'string' ? parseCivilDate(dateText) : null;
    if (parsedDate === null || !parsedDate.ok) {
      reviewItems.push(review(MIGRATION_REASON.malformedDate, dateText, 'expense date is not a civil date', source('expenses', id, 'date')));
      parsedExpenses.push({ record: expense, date: null, monthKey: null });
      continue;
    }
    const monthKey = monthKeyFromDate(parsedDate.value);
    if (monthKey) datedMonths.add(monthKey);
    parsedExpenses.push({ record: expense, date: parsedDate.value, monthKey });
  }

  if (datedMonths.size === 0) datedMonths.add(DEFAULT_CYCLE_START.slice(0, 7));
  const months = [...datedMonths].sort();

  const allowanceFor = (monthKey: string) => {
    if (Object.prototype.hasOwnProperty.call(monthlyAllowances, monthKey)) {
      const converted = moneyOf(monthlyAllowances[monthKey], source('settings', 'monthlyBaseAllowances', monthKey), 'nonNegative');
      if (!converted.ok) {
        reviewItems.push(review(converted.reason, converted.originalValue, converted.detail, converted.source));
        return 0;
      }
      return converted.money.minorUnits;
    }
    return allowance.ok ? allowance.money.minorUnits : 0;
  };

  const firstMonth = months[0];
  const firstStart = monthStart(firstMonth);
  const firstAllowance = allowanceFor(firstMonth);
  const starting = addSar(firstAllowance, openingMinor);
  if (!starting.ok) {
    reviewItems.push(review(MIGRATION_REASON.unsafeAmount, openingMinor, 'cycle opening plus vault opening is not a safe integer', source('settings', 'vault', 'openingBalance')));
  }
  const firstStarting = starting.ok ? starting.minorUnits : firstAllowance;
  const includeOpening = starting.ok && openingMinor > 0;
  pushCommand(planOp('cycle', firstStart), {
    kind: 'openCycle',
    bookId,
    startDate: firstStart as CivilDate,
    startingFunds: { currency: LEGACY_MIGRATION_CURRENCY, minorUnits: firstStarting },
  }, []);

  if (includeOpening) {
    pushCommand(planOp('vault-open', 'unallocated'), {
      kind: 'fundAllocationPool',
      bookId,
      amount: { currency: LEGACY_MIGRATION_CURRENCY, minorUnits: openingMinor },
      occurredAt: { kind: 'civilDate', localDate: firstStart as CivilDate },
      note: 'legacy-vault-opening-unallocated',
    }, ['vault.openingBalance']);
  }

  const goalsRaw = Array.isArray(vaultRaw['goals']) ? vaultRaw['goals'] : [];
  if (vaultRaw['goals'] !== undefined && vaultRaw['goals'] !== null && !Array.isArray(vaultRaw['goals'])) {
    reviewItems.push(review(MIGRATION_REASON.malformedRecord, vaultRaw['goals'], 'vault.goals is not an array', source('settings', 'vault', 'goals')));
  }
  for (const row of goalsRaw) {
    const record = asRecord(row);
    if (record === null) {
      reviewItems.push(review(MIGRATION_REASON.malformedRecord, row, 'vault goal is not an object', source('settings', 'vault', 'goals')));
      continue;
    }
    const id = validEntityId(typeof record['id'] === 'string' ? record['id'] : null);
    const name = typeof record['name'] === 'string' ? clipNote(record['name']) : '';
    if (id === null || name.length === 0) {
      reviewItems.push(review(MIGRATION_REASON.malformedRecord, record, 'vault goal is missing a stable id or name', source('settings', 'vault', 'goals')));
      continue;
    }
    if (!rememberId(id, 'goal', record, source('settings', 'vault', `goals.${id}`))) continue;
    const target = moneyOf(record['targetAmount'] ?? record['target'], source('settings', 'vault', `goals.${id}.targetAmount`), 'positive');
    if (!target.ok) {
      reviewItems.push(review(target.reason, target.originalValue, target.detail, target.source));
      continue;
    }
    const goalId = makeGoalId(id);
    if (!goalId.ok) {
      reviewItems.push(review(MIGRATION_REASON.invalidId, id, goalId.failure.detail, source('settings', 'vault', `goals.${id}`)));
      continue;
    }
    pushCommand(planOp('goal', id, record, source('settings', 'vault', `goals.${id}`)), {
      kind: 'createGoal',
      bookId,
      goalId: goalId.value,
      name,
      targetAmount: target.money,
    }, [id]);
    if (record['allocatedAmount'] !== undefined || record['allocation'] !== undefined) {
      reviewItems.push(review(
        MIGRATION_REASON.goalAllocationNotInferred,
        record['allocatedAmount'] ?? record['allocation'],
        'legacy goal allocated amounts are not migrated as custody',
        source('settings', 'vault', `goals.${id}.allocatedAmount`),
      ));
    }
  }

  const plannedTemplateIds = new Set<string>();
  for (const template of snapshot.templates) {
    const id = template.id;
    if (id === null || validEntityId(id) === null) {
      reviewItems.push(review(MIGRATION_REASON.invalidId, template.raw, 'template id is missing or invalid', source('templates', id ?? 'missing', 'id')));
      continue;
    }
    if (!rememberId(id, 'template', template.raw, source('templates', id, 'id'))) continue;
    const amount = moneyOf(template.raw['expectedCost'] ?? template.raw['defaultAmount'], source('templates', id, 'expectedCost'), 'positive');
    if (!amount.ok) {
      reviewItems.push(review(amount.reason, amount.originalValue, amount.detail, amount.source));
      continue;
    }
    const planId = makePlanId(id);
    if (!planId.ok) continue;
    const name = typeof template.raw['name'] === 'string' && template.raw['name'].length > 0 ? clipNote(String(template.raw['name'])) : id;
    const days = Array.isArray(template.raw['days']) ? template.raw['days'] : [];
    const scheduleDay = typeof days[0] === 'number' && Number.isInteger(days[0]) && days[0] >= 1 && days[0] <= 31 ? days[0] : 1;
    const flexible = template.raw['source'] === 'flexible' ? id : null;
    pushCommand(planOp('plan', id, template.raw, source('templates', id, 'id')), {
      kind: 'createRecurringPlan',
      bookId,
      planId: planId.value,
      name,
      amount: amount.money,
      scheduleDay,
      effectiveDate: firstStart as CivilDate,
      flexibleDefinitionId: flexible,
    }, [id]);
    plannedTemplateIds.add(id);
  }

  const lastMonth = months[months.length - 1];
  const lastThrough = monthStart(lastMonth).slice(0, 8) + '28';
  const lastThroughParsed = parseCivilDate(lastThrough);
  if (lastThroughParsed.ok) {
    for (const id of plannedTemplateIds) {
      const planId = makePlanId(id);
      if (!planId.ok) continue;
      pushCommand(planOp('materialize', id), {
        kind: 'materializePlanOccurrences',
        bookId,
        planId: planId.value,
        throughDate: lastThroughParsed.value,
      }, [id]);
    }
  }

  const emitUnverifiedVaultTransfers = (monthKey: string) => {
    for (const tx of vaultTx) {
      if (linkedVaultTxIds.has(tx.id)) continue;
      const preserveReused = reusedPreservationIds.has(tx.id);
      const txMonth = monthKeyFromDate(tx.date) ?? (MONTH_KEY.test(tx.sourceMonthKey) ? tx.sourceMonthKey : null);
      if (txMonth !== monthKey) continue;
      const amount = moneyOf(tx.amount, source('settings', 'vault', `transactions.${tx.id}.amount`), 'positive');
      if (!amount.ok) continue;
      const dateText = /^\d{4}-\d{2}-\d{2}$/.test(tx.date) ? tx.date : monthStart(monthKey);
      const parsedDate = parseCivilDate(dateText);
      if (!parsedDate.ok) continue;
      pushCommand(planOp('vault-tx', tx.id, tx.raw, source('settings', 'vault', `transactions.${tx.id}`)), {
        kind: 'fundAllocationPool',
        bookId,
        amount: amount.money,
        occurredAt: { kind: 'civilDate', localDate: parsedDate.value },
        note: preserveReused ? `legacy-reused-vault-link-${tx.id}` : `legacy-unverified-vault-transfer-${tx.id}`,
      }, [tx.id]);
      vaultFundingIds.push(tx.id);
    }
  };

  const emitExpenseMonth = (monthKey: string) => {
    for (const item of parsedExpenses) {
      if (item.monthKey !== monthKey || item.date === null || item.record.id === null) continue;
      const raw = item.record.raw;
      const id = item.record.id;
      const paid = raw['isPaid'] === true;
      const classification = raw['classification'];
      const reservedFlag = raw['reserved'] === true || raw['isReserved'] === true;
      if (paid) {
        const amount = moneyOf(raw['actualPaid'] ?? raw['expectedCost'], source('expenses', id, 'actualPaid'), 'positive');
        if (!amount.ok) {
          reviewItems.push(review(amount.reason, amount.originalValue, amount.detail, amount.source));
          continue;
        }
        const category = typeof raw['category'] === 'string' ? clipNote(raw['category']) : null;
        const flexible = typeof raw['flexibleDefinitionId'] === 'string' ? raw['flexibleDefinitionId'] : null;
        pushCommand(planOp('exp', id, raw, source('expenses', id, 'id')), {
          kind: 'recordExpense',
          bookId,
          amount: amount.money,
          occurredAt: { kind: 'civilDate', localDate: item.date },
          note: typeof raw['name'] === 'string' ? clipNote(raw['name']) : id,
          category,
          flexibleDefinitionId: flexible !== null && ENTITY_ID.test(flexible) ? flexible : null,
        }, [id]);
        continue;
      }
      const expected = moneyOf(raw['expectedCost'], source('expenses', id, 'expectedCost'), 'positive');
      if (!expected.ok) {
        reviewItems.push(review(expected.reason, expected.originalValue, expected.detail, expected.source));
        continue;
      }
      const isEssential = classification === 'essential';
      if (isEssential || reservedFlag) {
        const obligationId = makeObligationId(id);
        if (!obligationId.ok) {
          reviewItems.push(review(MIGRATION_REASON.invalidId, id, obligationId.failure.detail, source('expenses', id, 'id')));
          continue;
        }
        pushCommand(planOp('ob', id, raw, source('expenses', id, 'id')), {
          kind: 'createObligation',
          bookId,
          obligationId: obligationId.value,
          expectedAmount: expected.money,
          note: typeof raw['name'] === 'string' ? clipNote(raw['name']) : id,
          category: typeof raw['category'] === 'string' ? clipNote(raw['category']) : null,
        }, [id]);
        reviewItems.push(review(
          MIGRATION_REASON.provisionalEssentialReservation,
          raw,
          'unpaid essential migrated as a provisional reserved commitment',
          source('expenses', id, 'classification'),
        ));
        continue;
      }
      if (typeof raw['templateOriginId'] === 'string' && plannedTemplateIds.has(raw['templateOriginId'])) {
        reviewItems.push(review(
          MIGRATION_REASON.plannedNotReserved,
          raw,
          'unpaid non-essential item stays planned-not-reserved via its template plan',
          source('expenses', id, 'classification'),
        ));
        continue;
      }
      const planId = makePlanId(`u-${id}`);
      if (!planId.ok) continue;
      const day = Number(item.date.slice(8, 10));
      pushCommand(planOp('uplan', id, raw, source('expenses', id, 'id')), {
        kind: 'createRecurringPlan',
        bookId,
        planId: planId.value,
        name: typeof raw['name'] === 'string' ? clipNote(raw['name']) : id,
        amount: expected.money,
        scheduleDay: Number.isInteger(day) && day >= 1 && day <= 31 ? day : 1,
        effectiveDate: item.date,
        flexibleDefinitionId: null,
      }, [id]);
      pushCommand(planOp('umat', id, raw, source('expenses', id, 'id')), {
        kind: 'materializePlanOccurrences',
        bookId,
        planId: planId.value,
        throughDate: item.date,
      }, [id]);
      reviewItems.push(review(
        MIGRATION_REASON.plannedNotReserved,
        raw,
        'unpaid non-essential item migrated as planned-not-reserved',
        source('expenses', id, 'classification'),
      ));
    }
  };

  for (let index = 0; index < months.length; index += 1) {
    const monthKey = months[index];
    const isLast = index === months.length - 1;
    emitUnverifiedVaultTransfers(monthKey);
    emitExpenseMonth(monthKey);
    if (isLast) continue;
    const nextMonthKey = months[index + 1];
    const nextStart = monthStart(nextMonthKey);
    const nextCycle = composeCycleId(bookId, nextStart);
    pushCommand(planOp('close', monthKey), {
      kind: 'closeCycle',
      bookId,
      cycleId: null,
      note: `legacy-close-${monthKey}`,
    }, []);
    pushCommand(planOp('cycle', nextStart), {
      kind: 'openCycle',
      bookId,
      startDate: nextStart as CivilDate,
      startingFunds: { currency: LEGACY_MIGRATION_CURRENCY, minorUnits: allowanceFor(nextMonthKey) },
    }, []);
    const settlement = settlementsByMonth.get(monthKey);
    if (settlement === undefined) {
      pushCommand(planOp('disp-independent', monthKey), {
        kind: 'disposeCycleRemainder',
        bookId,
        settlementId: pendingSettlement.value,
        disposition: { kind: 'leaveIndependent' },
        note: `legacy-missing-settlement-${monthKey}`,
      }, []);
      reviewItems.push(review(MIGRATION_REASON.missingSettlement, null, `no verified settlement for ${monthKey}`, source('settings', 'monthEndSettlements', monthKey)));
      continue;
    }
    const surplus = moneyOf(settlement.surplus, source('settings', 'monthEndSettlements', `${monthKey}.surplus`), 'nonNegative');
    if (!surplus.ok) {
      reviewItems.push(review(surplus.reason, surplus.originalValue, surplus.detail, surplus.source));
      pushCommand(planOp('disp-independent', monthKey), {
        kind: 'disposeCycleRemainder',
        bookId,
        settlementId: pendingSettlement.value,
        disposition: { kind: 'leaveIndependent' },
        note: `legacy-invalid-surplus-${monthKey}`,
      }, []);
      continue;
    }
    if (settlement.decision === 'budget') {
      if (!nextCycle.ok) continue;
      if (surplus.money.minorUnits === 0) {
        pushCommand(planOp('disp-independent', monthKey), {
          kind: 'disposeCycleRemainder',
          bookId,
          settlementId: pendingSettlement.value,
          disposition: { kind: 'leaveIndependent' },
          note: `legacy-budget-zero-${monthKey}`,
        }, [monthKey]);
      } else if (!settlement.targetMonthKeyValid) {
        pushCommand(planOp('disp-independent', monthKey), {
          kind: 'disposeCycleRemainder',
          bookId,
          settlementId: pendingSettlement.value,
          disposition: { kind: 'leaveIndependent' },
          note: `legacy-budget-invalid-target-${monthKey}`,
        }, [monthKey]);
      } else if (settlement.targetMonthKey !== nextMonthKey) {
        reviewItems.push(review(
          MIGRATION_REASON.contradictorySettlement,
          settlement.raw,
          `budget settlement ${monthKey} targets ${settlement.targetMonthKey} instead of the next open cycle ${nextMonthKey}`,
          source('settings', 'monthEndSettlements', monthKey),
        ));
        pushCommand(planOp('disp-independent', monthKey), {
          kind: 'disposeCycleRemainder',
          bookId,
          settlementId: pendingSettlement.value,
          disposition: { kind: 'leaveIndependent' },
          note: `legacy-budget-contradictory-target-${monthKey}`,
        }, [monthKey]);
      } else {
        const destination = composeCycleId(bookId, monthStart(settlement.targetMonthKey));
        if (!destination.ok) continue;
        pushCommand(planOp('disp-budget', monthKey), {
          kind: 'disposeCycleRemainder',
          bookId,
          settlementId: pendingSettlement.value,
          disposition: { kind: 'carryIn', amount: surplus.money, destinationCycleId: destination.value },
          note: `legacy-budget-carry-in-${monthKey}`,
        }, [monthKey]);
        budgetCarryInIds.push(monthKey);
      }
    } else if (settlement.decision === 'vault') {
      if (surplus.money.minorUnits === 0 || !settlement.fundingEligible) {
        if (surplus.money.minorUnits > 0 && !settlement.fundingEligible) {
          reviewItems.push(review(
            MIGRATION_REASON.unverifiedSettlement,
            settlement.raw,
            `vault settlement ${monthKey} is not funded without a unique verified transaction link`,
            source('settings', 'monthEndSettlements', monthKey),
          ));
        }
        pushCommand(planOp('disp-independent', monthKey), {
          kind: 'disposeCycleRemainder',
          bookId,
          settlementId: pendingSettlement.value,
          disposition: { kind: 'leaveIndependent' },
          note: `legacy-vault-unverified-${monthKey}`,
        }, [monthKey]);
      } else {
        pushCommand(planOp('disp-vault', monthKey), {
          kind: 'disposeCycleRemainder',
          bookId,
          settlementId: pendingSettlement.value,
          disposition: { kind: 'fundTracked', amount: surplus.money },
          note: `legacy-vault-funding-${monthKey}`,
        }, [settlement.vaultTransactionId]);
        vaultFundingIds.push(settlement.vaultTransactionId);
      }
    } else {
      pushCommand(planOp('disp-independent', monthKey), {
        kind: 'disposeCycleRemainder',
        bookId,
        settlementId: pendingSettlement.value,
        disposition: { kind: 'leaveIndependent' },
        note: `legacy-no-surplus-${monthKey}`,
      }, [monthKey]);
    }
  }

  return {
    bookId: LEGACY_GUEST_BOOK_ID,
    currency: LEGACY_MIGRATION_CURRENCY,
    commands,
    review: reviewItems,
    preservedSourceIds,
    openingVaultMinorUnits: openingMinor,
    budgetCarryInIds,
    vaultFundingIds,
  };
}
