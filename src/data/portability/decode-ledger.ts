/**
 * Strict runtime decoders for every nested BookState collection and row.
 *
 * A top-level key check plus a generic walk is not validation. Each record
 * is decoded against the supported P03 schema with exact keys, typed money,
 * canonical IDs, and book binding before any staging write.
 */

import type {
  AllocationChange,
  AllocationRecord,
  BookSettingsRevision,
  BookState,
  BufferSetting,
  CarryAction,
  ConflictResolution,
  CycleRecord,
  CycleSettlement,
  ExpenseEntry,
  ExpenseReturnEntry,
  ExpenseReturnReversalEntry,
  ExpenseReversalEntry,
  FinanceBook,
  GoalRecord,
  InflowEntry,
  InflowReversalEntry,
  LedgerEntry,
  ObligationChange,
  ObligationEvent,
  ObligationRecord,
  PlanOccurrence,
  PlanRevision,
  PropagationConflict,
  PropagationDelta,
  RealityCheckObservation,
  ReconciliationAdjustment,
  RecoveryLink,
  RecurringPlan,
  RemainderDisposition,
} from '../../domain/contracts/ledger';
import {
  makeAllocationRecordId,
  makeBookId,
  makeCycleId,
  makeCycleVersionId,
  makeEntryId,
  makeGoalId,
  makeObligationId,
  makeObservationId,
  makeOccurrenceId,
  makeOperationId,
  makePlanId,
  makeSettlementId,
  type BookId,
} from '../../domain/contracts/identity';
import { PORTABILITY_REASON } from '../migration/reasons';
import {
  IdentitySet,
  asRecord,
  decodeAnchor,
  decodeArray,
  decodeCivilDate,
  decodeMoney,
  decodeNullableCivilDate,
  decodeNullableMoney,
  decodeNullableTimeZone,
  decodeTimeZone,
  decodeWallTime,
  exactKeys,
  fail,
  isFail,
  requireNullableString,
  requireNullableRepresentableInstant,
  requireRepresentableInstant,
  requireSafeInteger,
  requireString,
  requireText,
  type DecodeFailure,
} from './decode-helpers';

const FINANCE_BOOK_KEYS = [
  'id',
  'displayName',
  'currency',
  'timeZone',
  'cycleAnchor',
  'createdAtInstantMs',
  'createdAtLocalDate',
  'createdInTimeZone',
] as const;

const BOOK_STATE_KEYS = [
  'book',
  'revision',
  'cycles',
  'entries',
  'obligations',
  'obligationEvents',
  'goals',
  'allocationRecords',
  'buffer',
  'observations',
  'adjustments',
  'recoveryLinks',
  'plans',
  'planRevisions',
  'planOccurrences',
  'settingsRevisions',
  'settlements',
  'carryActions',
  'propagationDeltas',
  'propagationConflicts',
  'conflictResolutions',
] as const;

const CYCLE_KEYS = [
  'versionId',
  'cycleId',
  'bookId',
  'versionSeq',
  'mode',
  'startDate',
  'endDateExclusive',
  'anchor',
  'timeZone',
  'startingFunds',
  'openedAtInstantMs',
  'boundaryObservedPool',
  'boundaryLocalDate',
  'boundaryLocalTime',
  'boundaryInstantMs',
  'boundaryTimeZone',
  'supersedesVersionId',
] as const;

const INFLOW_KEYS = [
  'kind', 'entryId', 'bookId', 'cycleId', 'localDate', 'timeZone', 'amount', 'note',
  'occurredAtInstantMs', 'capturedAtInstantMs', 'capturedInTimeZone', 'calculationVersion', 'sourceOperationId',
] as const;

const INFLOW_REVERSAL_KEYS = [...INFLOW_KEYS, 'reversesEntryId'] as const;

const EXPENSE_KEYS = [
  'kind', 'entryId', 'bookId', 'cycleId', 'localDate', 'timeZone', 'amount', 'note',
  'category', 'flexibleDefinitionId', 'linkedObligationId', 'replacesEntryId',
  'occurredAtInstantMs', 'capturedAtInstantMs', 'capturedInTimeZone', 'calculationVersion', 'sourceOperationId',
] as const;

const EXPENSE_REVERSAL_KEYS = [
  'kind', 'entryId', 'bookId', 'cycleId', 'localDate', 'timeZone', 'amount', 'reversesEntryId', 'note',
  'occurredAtInstantMs', 'capturedAtInstantMs', 'capturedInTimeZone', 'calculationVersion', 'sourceOperationId',
] as const;

const EXPENSE_RETURN_KEYS = [
  'kind', 'entryId', 'bookId', 'cycleId', 'localDate', 'timeZone', 'amount',
  'linkedExpenseEntryId', 'linkedObligationId', 'replacesReturnEntryId', 'note',
  'occurredAtInstantMs', 'capturedAtInstantMs', 'capturedInTimeZone', 'calculationVersion', 'sourceOperationId',
] as const;

const EXPENSE_RETURN_REVERSAL_KEYS = [
  'kind', 'entryId', 'bookId', 'cycleId', 'localDate', 'timeZone', 'amount', 'reversesEntryId',
  'linkedExpenseEntryId', 'linkedObligationId', 'note',
  'occurredAtInstantMs', 'capturedAtInstantMs', 'capturedInTimeZone', 'calculationVersion', 'sourceOperationId',
] as const;

type BrandMake<T> = (value: unknown) => { ok: true; value: T } | { ok: false; failure: { detail: string } };

function decodeId<T extends string>(value: unknown, label: string, make: BrandMake<T>): T | DecodeFailure {
  const made = make(value);
  if (!made.ok) return fail(PORTABILITY_REASON.invalidReference, `${label} is invalid: ${made.failure.detail}`);
  return made.value;
}

function decodeNullableId<T extends string>(
  value: unknown,
  label: string,
  make: BrandMake<T>,
): T | null | DecodeFailure {
  if (value === null) return null;
  return decodeId(value, label, make);
}

function requireBook(record: Record<string, unknown>, bookId: BookId, label: string): DecodeFailure | null {
  if (record['bookId'] !== (bookId as string)) {
    return fail(PORTABILITY_REASON.foreignRecord, `${label} names a foreign book`);
  }
  return null;
}

function decodeFinanceBook(raw: unknown): FinanceBook | DecodeFailure {
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, 'book is not an object');
  const keys = exactKeys(record, FINANCE_BOOK_KEYS, 'book');
  if (keys !== null) return keys;
  const id = decodeId(record['id'], 'book.id', makeBookId);
  if (isFail(id)) return id;
  const displayName = requireString(record['displayName'], 'book.displayName');
  if (typeof displayName !== 'string') return displayName;
  if (record['currency'] !== 'SAR') return fail(PORTABILITY_REASON.wrongCurrency, `book ${id} is not SAR`);
  const timeZone = decodeTimeZone(record['timeZone'], 'book.timeZone');
  if (isFail(timeZone)) return timeZone;
  const createdInTimeZone = decodeTimeZone(record['createdInTimeZone'], 'book.createdInTimeZone');
  if (isFail(createdInTimeZone)) return createdInTimeZone;
  const createdAtInstantMs = requireRepresentableInstant(record['createdAtInstantMs'], 'book.createdAtInstantMs');
  if (typeof createdAtInstantMs !== 'number') return createdAtInstantMs;
  const createdAtLocalDate = decodeCivilDate(record['createdAtLocalDate'], 'book.createdAtLocalDate');
  if (isFail(createdAtLocalDate)) return createdAtLocalDate;
  const cycleAnchor = decodeAnchor(record['cycleAnchor'], 'book.cycleAnchor');
  if (isFail(cycleAnchor)) return cycleAnchor;
  return {
    id,
    displayName,
    currency: 'SAR',
    timeZone,
    cycleAnchor,
    createdAtInstantMs,
    createdAtLocalDate,
    createdInTimeZone,
  };
}

function decodeCycle(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): CycleRecord | DecodeFailure {
  const label = `cycles[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const keys = exactKeys(record, CYCLE_KEYS, label);
  if (keys !== null) return keys;
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const versionId = decodeId(record['versionId'], `${label}.versionId`, makeCycleVersionId);
  if (isFail(versionId)) return versionId;
  const cycleId = decodeId(record['cycleId'], `${label}.cycleId`, makeCycleId);
  if (isFail(cycleId)) return cycleId;
  const dup = ids.remember('versionId', versionId as string, 'cycle versionId');
  if (dup !== null) return dup;
  const versionSeq = requireSafeInteger(record['versionSeq'], `${label}.versionSeq`, 1);
  if (typeof versionSeq !== 'number') return versionSeq;
  if (record['mode'] !== 'fullCycle' && record['mode'] !== 'remainingFromBoundary') {
    return fail(PORTABILITY_REASON.malformedRecord, `${label}.mode is unsupported`);
  }
  const startDate = decodeCivilDate(record['startDate'], `${label}.startDate`);
  if (isFail(startDate)) return startDate;
  const endDateExclusive = decodeCivilDate(record['endDateExclusive'], `${label}.endDateExclusive`);
  if (isFail(endDateExclusive)) return endDateExclusive;
  const anchor = decodeAnchor(record['anchor'], `${label}.anchor`);
  if (isFail(anchor)) return anchor;
  const timeZone = decodeTimeZone(record['timeZone'], `${label}.timeZone`);
  if (isFail(timeZone)) return timeZone;
  const startingFunds = decodeMoney(record['startingFunds'], `${label}.startingFunds`);
  if (isFail(startingFunds)) return startingFunds;
  const openedAtInstantMs = requireRepresentableInstant(record['openedAtInstantMs'], `${label}.openedAtInstantMs`);
  if (typeof openedAtInstantMs !== 'number') return openedAtInstantMs;
  const boundaryObservedPool = decodeNullableMoney(record['boundaryObservedPool'], `${label}.boundaryObservedPool`);
  if (isFail(boundaryObservedPool)) return boundaryObservedPool;
  const boundaryLocalDate = decodeNullableCivilDate(record['boundaryLocalDate'], `${label}.boundaryLocalDate`);
  if (isFail(boundaryLocalDate)) return boundaryLocalDate;
  const boundaryLocalTime = decodeWallTime(record['boundaryLocalTime'], `${label}.boundaryLocalTime`);
  if (isFail(boundaryLocalTime)) return boundaryLocalTime;
  const boundaryInstantMs = requireNullableRepresentableInstant(record['boundaryInstantMs'], `${label}.boundaryInstantMs`);
  if (boundaryInstantMs !== null && typeof boundaryInstantMs !== 'number') return boundaryInstantMs;
  const boundaryTimeZone = decodeNullableTimeZone(record['boundaryTimeZone'], `${label}.boundaryTimeZone`);
  if (isFail(boundaryTimeZone)) return boundaryTimeZone;
  const supersedesVersionId = decodeNullableId(record['supersedesVersionId'], `${label}.supersedesVersionId`, makeCycleVersionId);
  if (isFail(supersedesVersionId)) return supersedesVersionId;
  return {
    versionId,
    cycleId,
    bookId,
    versionSeq,
    mode: record['mode'],
    startDate,
    endDateExclusive,
    anchor,
    timeZone,
    startingFunds,
    openedAtInstantMs,
    boundaryObservedPool,
    boundaryLocalDate,
    boundaryLocalTime,
    boundaryInstantMs,
    boundaryTimeZone,
    supersedesVersionId,
  };
}

function decodeEntryCore(record: Record<string, unknown>, bookId: BookId, label: string, ids: IdentitySet) {
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const entryId = decodeId(record['entryId'], `${label}.entryId`, makeEntryId);
  if (isFail(entryId)) return entryId;
  const dup = ids.remember('entryId', entryId as string, 'entryId');
  if (dup !== null) return dup;
  const cycleId = decodeId(record['cycleId'], `${label}.cycleId`, makeCycleId);
  if (isFail(cycleId)) return cycleId;
  const localDate = decodeCivilDate(record['localDate'], `${label}.localDate`);
  if (isFail(localDate)) return localDate;
  const timeZone = decodeTimeZone(record['timeZone'], `${label}.timeZone`);
  if (isFail(timeZone)) return timeZone;
  const amount = decodeMoney(record['amount'], `${label}.amount`);
  if (isFail(amount)) return amount;
  const note = requireText(record['note'], `${label}.note`);
  if (typeof note !== 'string') return note;
  const occurredAtInstantMs = requireNullableRepresentableInstant(record['occurredAtInstantMs'], `${label}.occurredAtInstantMs`);
  if (occurredAtInstantMs !== null && typeof occurredAtInstantMs !== 'number') return occurredAtInstantMs;
  const capturedAtInstantMs = requireRepresentableInstant(record['capturedAtInstantMs'], `${label}.capturedAtInstantMs`);
  if (typeof capturedAtInstantMs !== 'number') return capturedAtInstantMs;
  const capturedInTimeZone = decodeTimeZone(record['capturedInTimeZone'], `${label}.capturedInTimeZone`);
  if (isFail(capturedInTimeZone)) return capturedInTimeZone;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  return {
    entryId,
    cycleId,
    localDate,
    timeZone,
    amount,
    note,
    occurredAtInstantMs,
    capturedAtInstantMs,
    capturedInTimeZone,
    calculationVersion,
    sourceOperationId,
  };
}

function decodeEntry(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): LedgerEntry | DecodeFailure {
  const label = `entries[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const kind = record['kind'];
  if (kind === 'inflow' || kind === 'inflowReversal') {
    const keys = exactKeys(record, kind === 'inflow' ? INFLOW_KEYS : INFLOW_REVERSAL_KEYS, label);
    if (keys !== null) return keys;
    const core = decodeEntryCore(record, bookId, label, ids);
    if (isFail(core)) return core;
    if (kind === 'inflow') {
      return { kind: 'inflow', bookId, ...core } satisfies InflowEntry;
    }
    const reversesEntryId = decodeId(record['reversesEntryId'], `${label}.reversesEntryId`, makeEntryId);
    if (isFail(reversesEntryId)) return reversesEntryId;
    return { kind: 'inflowReversal', bookId, ...core, reversesEntryId } satisfies InflowReversalEntry;
  }
  if (kind === 'expense') {
    const keys = exactKeys(record, EXPENSE_KEYS, label);
    if (keys !== null) return keys;
    const core = decodeEntryCore(record, bookId, label, ids);
    if (isFail(core)) return core;
    const category = requireNullableString(record['category'], `${label}.category`);
    if (isFail(category)) return category;
    const flexibleDefinitionId = requireNullableString(record['flexibleDefinitionId'], `${label}.flexibleDefinitionId`);
    if (isFail(flexibleDefinitionId)) return flexibleDefinitionId;
    const linkedObligationId = decodeNullableId(record['linkedObligationId'], `${label}.linkedObligationId`, makeObligationId);
    if (isFail(linkedObligationId)) return linkedObligationId;
    const replacesEntryId = decodeNullableId(record['replacesEntryId'], `${label}.replacesEntryId`, makeEntryId);
    if (isFail(replacesEntryId)) return replacesEntryId;
    return {
      kind: 'expense',
      bookId,
      ...core,
      category,
      flexibleDefinitionId,
      linkedObligationId,
      replacesEntryId,
    } satisfies ExpenseEntry;
  }
  if (kind === 'expenseReversal') {
    const keys = exactKeys(record, EXPENSE_REVERSAL_KEYS, label);
    if (keys !== null) return keys;
    const core = decodeEntryCore(record, bookId, label, ids);
    if (isFail(core)) return core;
    const reversesEntryId = decodeId(record['reversesEntryId'], `${label}.reversesEntryId`, makeEntryId);
    if (isFail(reversesEntryId)) return reversesEntryId;
    return { kind: 'expenseReversal', bookId, ...core, reversesEntryId } satisfies ExpenseReversalEntry;
  }
  if (kind === 'expenseReturn') {
    const keys = exactKeys(record, EXPENSE_RETURN_KEYS, label);
    if (keys !== null) return keys;
    const core = decodeEntryCore(record, bookId, label, ids);
    if (isFail(core)) return core;
    const linkedExpenseEntryId = decodeNullableId(record['linkedExpenseEntryId'], `${label}.linkedExpenseEntryId`, makeEntryId);
    if (isFail(linkedExpenseEntryId)) return linkedExpenseEntryId;
    const linkedObligationId = decodeNullableId(record['linkedObligationId'], `${label}.linkedObligationId`, makeObligationId);
    if (isFail(linkedObligationId)) return linkedObligationId;
    const replacesReturnEntryId = decodeNullableId(record['replacesReturnEntryId'], `${label}.replacesReturnEntryId`, makeEntryId);
    if (isFail(replacesReturnEntryId)) return replacesReturnEntryId;
    return {
      kind: 'expenseReturn',
      bookId,
      ...core,
      linkedExpenseEntryId,
      linkedObligationId,
      replacesReturnEntryId,
    } satisfies ExpenseReturnEntry;
  }
  if (kind === 'expenseReturnReversal') {
    const keys = exactKeys(record, EXPENSE_RETURN_REVERSAL_KEYS, label);
    if (keys !== null) return keys;
    const core = decodeEntryCore(record, bookId, label, ids);
    if (isFail(core)) return core;
    const reversesEntryId = decodeId(record['reversesEntryId'], `${label}.reversesEntryId`, makeEntryId);
    if (isFail(reversesEntryId)) return reversesEntryId;
    const linkedExpenseEntryId = decodeNullableId(record['linkedExpenseEntryId'], `${label}.linkedExpenseEntryId`, makeEntryId);
    if (isFail(linkedExpenseEntryId)) return linkedExpenseEntryId;
    const linkedObligationId = decodeNullableId(record['linkedObligationId'], `${label}.linkedObligationId`, makeObligationId);
    if (isFail(linkedObligationId)) return linkedObligationId;
    return {
      kind: 'expenseReturnReversal',
      bookId,
      ...core,
      reversesEntryId,
      linkedExpenseEntryId,
      linkedObligationId,
    } satisfies ExpenseReturnReversalEntry;
  }
  return fail(PORTABILITY_REASON.malformedRecord, `${label} has unsupported entry kind`);
}

function decodeObligation(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): ObligationRecord | DecodeFailure {
  const label = `obligations[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const keys = exactKeys(record, [
    'kind', 'obligationId', 'bookId', 'cycleId', 'expectedAmount', 'note', 'category',
    'createdAtInstantMs', 'createdInTimeZone', 'calculationVersion', 'sourceOperationId',
  ], label);
  if (keys !== null) return keys;
  if (record['kind'] !== 'obligation') return fail(PORTABILITY_REASON.malformedRecord, `${label}.kind must be obligation`);
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const obligationId = decodeId(record['obligationId'], `${label}.obligationId`, makeObligationId);
  if (isFail(obligationId)) return obligationId;
  const dup = ids.remember('obligationId', obligationId as string, 'obligationId');
  if (dup !== null) return dup;
  const cycleId = decodeId(record['cycleId'], `${label}.cycleId`, makeCycleId);
  if (isFail(cycleId)) return cycleId;
  const expectedAmount = decodeMoney(record['expectedAmount'], `${label}.expectedAmount`);
  if (isFail(expectedAmount)) return expectedAmount;
  const note = requireText(record['note'], `${label}.note`);
  if (typeof note !== 'string') return note;
  const category = requireNullableString(record['category'], `${label}.category`);
  if (isFail(category)) return category;
  const createdAtInstantMs = requireRepresentableInstant(record['createdAtInstantMs'], `${label}.createdAtInstantMs`);
  if (typeof createdAtInstantMs !== 'number') return createdAtInstantMs;
  const createdInTimeZone = decodeTimeZone(record['createdInTimeZone'], `${label}.createdInTimeZone`);
  if (isFail(createdInTimeZone)) return createdInTimeZone;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  return {
    kind: 'obligation',
    obligationId,
    bookId,
    cycleId,
    expectedAmount,
    note,
    category,
    createdAtInstantMs,
    createdInTimeZone,
    calculationVersion,
    sourceOperationId,
  };
}

function decodeObligationChange(raw: unknown, label: string): ObligationChange | DecodeFailure {
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const type = record['type'];
  if (type === 'finalSettlement' || type === 'cancellation' || type === 'reopening' || type === 'disputeOpened' || type === 'residualReleased') {
    const keys = exactKeys(record, ['type'], label);
    if (keys !== null) return keys;
    return { type };
  }
  if (type === 'disputeResolved') {
    const keys = exactKeys(record, ['type', 'via'], label);
    if (keys !== null) return keys;
    if (record['via'] !== 'finalSettlement' && record['via'] !== 'cancellation' && record['via'] !== 'explicitResolution') {
      return fail(PORTABILITY_REASON.malformedRecord, `${label}.via is unsupported`);
    }
    return { type: 'disputeResolved', via: record['via'] };
  }
  return fail(PORTABILITY_REASON.malformedRecord, `${label}.type is unsupported`);
}

function decodeObligationEvent(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): ObligationEvent | DecodeFailure {
  const label = `obligationEvents[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const keys = exactKeys(record, [
    'kind', 'eventId', 'bookId', 'obligationId', 'change', 'note',
    'capturedAtInstantMs', 'capturedInTimeZone', 'calculationVersion', 'sourceOperationId',
  ], label);
  if (keys !== null) return keys;
  if (record['kind'] !== 'obligationEvent') return fail(PORTABILITY_REASON.malformedRecord, `${label}.kind must be obligationEvent`);
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const eventId = decodeId(record['eventId'], `${label}.eventId`, makeEntryId);
  if (isFail(eventId)) return eventId;
  const dup = ids.remember('eventId', eventId as string, 'obligation eventId');
  if (dup !== null) return dup;
  const obligationId = decodeId(record['obligationId'], `${label}.obligationId`, makeObligationId);
  if (isFail(obligationId)) return obligationId;
  const change = decodeObligationChange(record['change'], `${label}.change`);
  if (isFail(change)) return change;
  const note = requireText(record['note'], `${label}.note`);
  if (typeof note !== 'string') return note;
  const capturedAtInstantMs = requireRepresentableInstant(record['capturedAtInstantMs'], `${label}.capturedAtInstantMs`);
  if (typeof capturedAtInstantMs !== 'number') return capturedAtInstantMs;
  const capturedInTimeZone = decodeTimeZone(record['capturedInTimeZone'], `${label}.capturedInTimeZone`);
  if (isFail(capturedInTimeZone)) return capturedInTimeZone;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  return {
    kind: 'obligationEvent',
    eventId,
    bookId,
    obligationId,
    change,
    note,
    capturedAtInstantMs,
    capturedInTimeZone,
    calculationVersion,
    sourceOperationId,
  };
}

function decodeGoal(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): GoalRecord | DecodeFailure {
  const label = `goals[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const keys = exactKeys(record, [
    'kind', 'goalId', 'bookId', 'name', 'targetAmount',
    'createdAtInstantMs', 'createdInTimeZone', 'calculationVersion', 'sourceOperationId',
  ], label);
  if (keys !== null) return keys;
  if (record['kind'] !== 'goal') return fail(PORTABILITY_REASON.malformedRecord, `${label}.kind must be goal`);
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const goalId = decodeId(record['goalId'], `${label}.goalId`, makeGoalId);
  if (isFail(goalId)) return goalId;
  const dup = ids.remember('goalId', goalId as string, 'goalId');
  if (dup !== null) return dup;
  const name = requireString(record['name'], `${label}.name`);
  if (typeof name !== 'string') return name;
  const targetAmount = decodeMoney(record['targetAmount'], `${label}.targetAmount`);
  if (isFail(targetAmount)) return targetAmount;
  const createdAtInstantMs = requireRepresentableInstant(record['createdAtInstantMs'], `${label}.createdAtInstantMs`);
  if (typeof createdAtInstantMs !== 'number') return createdAtInstantMs;
  const createdInTimeZone = decodeTimeZone(record['createdInTimeZone'], `${label}.createdInTimeZone`);
  if (isFail(createdInTimeZone)) return createdInTimeZone;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  return {
    kind: 'goal',
    goalId,
    bookId,
    name,
    targetAmount,
    createdAtInstantMs,
    createdInTimeZone,
    calculationVersion,
    sourceOperationId,
  };
}

function decodeAllocationChange(raw: unknown, label: string): AllocationChange | DecodeFailure {
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const type = record['type'];
  if (type === 'funding') {
    const keys = exactKeys(record, ['type', 'amount'], label);
    if (keys !== null) return keys;
    const amount = decodeMoney(record['amount'], `${label}.amount`);
    if (isFail(amount)) return amount;
    return { type: 'funding', amount };
  }
  if (type === 'assignment' || type === 'unassignment') {
    const keys = exactKeys(record, ['type', 'goalId', 'amount'], label);
    if (keys !== null) return keys;
    const goalId = decodeId(record['goalId'], `${label}.goalId`, makeGoalId);
    if (isFail(goalId)) return goalId;
    const amount = decodeMoney(record['amount'], `${label}.amount`);
    if (isFail(amount)) return amount;
    return { type, goalId, amount };
  }
  if (type === 'release') {
    const keys = exactKeys(record, ['type', 'goalId', 'amount', 'destinationCycleId'], label);
    if (keys !== null) return keys;
    const goalId = decodeNullableId(record['goalId'], `${label}.goalId`, makeGoalId);
    if (isFail(goalId)) return goalId;
    const amount = decodeMoney(record['amount'], `${label}.amount`);
    if (isFail(amount)) return amount;
    const destinationCycleId = decodeId(record['destinationCycleId'], `${label}.destinationCycleId`, makeCycleId);
    if (isFail(destinationCycleId)) return destinationCycleId;
    return { type: 'release', goalId, amount, destinationCycleId };
  }
  if (type === 'reversal') {
    const keys = exactKeys(record, ['type', 'reversesRecordId'], label);
    if (keys !== null) return keys;
    const reversesRecordId = decodeId(record['reversesRecordId'], `${label}.reversesRecordId`, makeAllocationRecordId);
    if (isFail(reversesRecordId)) return reversesRecordId;
    return { type: 'reversal', reversesRecordId };
  }
  return fail(PORTABILITY_REASON.malformedRecord, `${label}.type is unsupported`);
}

function decodeAllocation(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): AllocationRecord | DecodeFailure {
  const label = `allocationRecords[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const keys = exactKeys(record, [
    'kind', 'recordId', 'bookId', 'cycleId', 'localDate', 'change', 'note',
    'occurredAtInstantMs', 'capturedAtInstantMs', 'capturedInTimeZone', 'calculationVersion', 'sourceOperationId',
  ], label);
  if (keys !== null) return keys;
  if (record['kind'] !== 'allocation') return fail(PORTABILITY_REASON.malformedRecord, `${label}.kind must be allocation`);
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const recordId = decodeId(record['recordId'], `${label}.recordId`, makeAllocationRecordId);
  if (isFail(recordId)) return recordId;
  const dup = ids.remember('allocationRecordId', recordId as string, 'allocation recordId');
  if (dup !== null) return dup;
  const cycleId = decodeId(record['cycleId'], `${label}.cycleId`, makeCycleId);
  if (isFail(cycleId)) return cycleId;
  const localDate = decodeNullableCivilDate(record['localDate'], `${label}.localDate`);
  if (isFail(localDate)) return localDate;
  const change = decodeAllocationChange(record['change'], `${label}.change`);
  if (isFail(change)) return change;
  const note = requireText(record['note'], `${label}.note`);
  if (typeof note !== 'string') return note;
  const occurredAtInstantMs = requireNullableRepresentableInstant(record['occurredAtInstantMs'], `${label}.occurredAtInstantMs`);
  if (occurredAtInstantMs !== null && typeof occurredAtInstantMs !== 'number') return occurredAtInstantMs;
  const capturedAtInstantMs = requireRepresentableInstant(record['capturedAtInstantMs'], `${label}.capturedAtInstantMs`);
  if (typeof capturedAtInstantMs !== 'number') return capturedAtInstantMs;
  const capturedInTimeZone = decodeTimeZone(record['capturedInTimeZone'], `${label}.capturedInTimeZone`);
  if (isFail(capturedInTimeZone)) return capturedInTimeZone;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  return {
    kind: 'allocation',
    recordId,
    bookId,
    cycleId,
    localDate,
    change,
    note,
    occurredAtInstantMs,
    capturedAtInstantMs,
    capturedInTimeZone,
    calculationVersion,
    sourceOperationId,
  };
}

function decodeBuffer(raw: unknown, label: string): BufferSetting | null | DecodeFailure {
  if (raw === null) return null;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object or null`);
  const keys = exactKeys(record, ['amount', 'sourceOperationId', 'updatedAtInstantMs', 'calculationVersion'], label);
  if (keys !== null) return keys;
  const amount = decodeMoney(record['amount'], `${label}.amount`);
  if (isFail(amount)) return amount;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  const updatedAtInstantMs = requireRepresentableInstant(record['updatedAtInstantMs'], `${label}.updatedAtInstantMs`);
  if (typeof updatedAtInstantMs !== 'number') return updatedAtInstantMs;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  return { amount, sourceOperationId, updatedAtInstantMs, calculationVersion };
}

function decodeObservation(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): RealityCheckObservation | DecodeFailure {
  const label = `observations[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const keys = exactKeys(record, [
    'observationId', 'bookId', 'cycleId', 'versionId', 'observedPool', 'boundaryLocalDate',
    'boundaryLocalTime', 'boundaryInstantMs', 'boundaryTimeZone', 'currencyLabel', 'note',
    'capturedAtInstantMs', 'capturedInTimeZone', 'calculationVersion', 'sourceOperationId',
  ], label);
  if (keys !== null) return keys;
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const observationId = decodeId(record['observationId'], `${label}.observationId`, makeObservationId);
  if (isFail(observationId)) return observationId;
  const dup = ids.remember('observationId', observationId as string, 'observationId');
  if (dup !== null) return dup;
  const cycleId = decodeId(record['cycleId'], `${label}.cycleId`, makeCycleId);
  if (isFail(cycleId)) return cycleId;
  const versionId = decodeId(record['versionId'], `${label}.versionId`, makeCycleVersionId);
  if (isFail(versionId)) return versionId;
  const observedPool = decodeMoney(record['observedPool'], `${label}.observedPool`);
  if (isFail(observedPool)) return observedPool;
  const boundaryLocalDate = decodeCivilDate(record['boundaryLocalDate'], `${label}.boundaryLocalDate`);
  if (isFail(boundaryLocalDate)) return boundaryLocalDate;
  const boundaryLocalTime = decodeWallTime(record['boundaryLocalTime'], `${label}.boundaryLocalTime`);
  if (isFail(boundaryLocalTime)) return boundaryLocalTime;
  const boundaryInstantMs = requireNullableRepresentableInstant(record['boundaryInstantMs'], `${label}.boundaryInstantMs`);
  if (boundaryInstantMs !== null && typeof boundaryInstantMs !== 'number') return boundaryInstantMs;
  const boundaryTimeZone = decodeTimeZone(record['boundaryTimeZone'], `${label}.boundaryTimeZone`);
  if (isFail(boundaryTimeZone)) return boundaryTimeZone;
  const currencyLabel = requireNullableString(record['currencyLabel'], `${label}.currencyLabel`);
  if (isFail(currencyLabel)) return currencyLabel;
  const note = requireText(record['note'], `${label}.note`);
  if (typeof note !== 'string') return note;
  const capturedAtInstantMs = requireRepresentableInstant(record['capturedAtInstantMs'], `${label}.capturedAtInstantMs`);
  if (typeof capturedAtInstantMs !== 'number') return capturedAtInstantMs;
  const capturedInTimeZone = decodeTimeZone(record['capturedInTimeZone'], `${label}.capturedInTimeZone`);
  if (isFail(capturedInTimeZone)) return capturedInTimeZone;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  return {
    observationId,
    bookId,
    cycleId,
    versionId,
    observedPool,
    boundaryLocalDate,
    boundaryLocalTime,
    boundaryInstantMs,
    boundaryTimeZone,
    currencyLabel,
    note,
    capturedAtInstantMs,
    capturedInTimeZone,
    calculationVersion,
    sourceOperationId,
  };
}

function decodeAdjustment(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): ReconciliationAdjustment | DecodeFailure {
  const label = `adjustments[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const keys = exactKeys(record, [
    'adjustmentId', 'bookId', 'cycleId', 'observationId', 'amount', 'classificationNote',
    'capturedAtInstantMs', 'capturedInTimeZone', 'calculationVersion', 'sourceOperationId',
  ], label);
  if (keys !== null) return keys;
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const adjustmentId = decodeId(record['adjustmentId'], `${label}.adjustmentId`, makeEntryId);
  if (isFail(adjustmentId)) return adjustmentId;
  const dup = ids.remember('adjustmentId', adjustmentId as string, 'adjustmentId');
  if (dup !== null) return dup;
  const cycleId = decodeId(record['cycleId'], `${label}.cycleId`, makeCycleId);
  if (isFail(cycleId)) return cycleId;
  const observationId = decodeId(record['observationId'], `${label}.observationId`, makeObservationId);
  if (isFail(observationId)) return observationId;
  const amount = decodeMoney(record['amount'], `${label}.amount`);
  if (isFail(amount)) return amount;
  const classificationNote = requireNullableString(record['classificationNote'], `${label}.classificationNote`);
  if (isFail(classificationNote)) return classificationNote;
  const capturedAtInstantMs = requireRepresentableInstant(record['capturedAtInstantMs'], `${label}.capturedAtInstantMs`);
  if (typeof capturedAtInstantMs !== 'number') return capturedAtInstantMs;
  const capturedInTimeZone = decodeTimeZone(record['capturedInTimeZone'], `${label}.capturedInTimeZone`);
  if (isFail(capturedInTimeZone)) return capturedInTimeZone;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  return {
    adjustmentId,
    bookId,
    cycleId,
    observationId,
    amount,
    classificationNote,
    capturedAtInstantMs,
    capturedInTimeZone,
    calculationVersion,
    sourceOperationId,
  };
}

function decodeRecoveryLink(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): RecoveryLink | DecodeFailure {
  const label = `recoveryLinks[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const keys = exactKeys(record, [
    'linkId', 'bookId', 'observationId', 'adjustmentId', 'entryId', 'movementKind',
    'capturedAtInstantMs', 'calculationVersion', 'sourceOperationId',
  ], label);
  if (keys !== null) return keys;
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const linkId = decodeId(record['linkId'], `${label}.linkId`, makeEntryId);
  if (isFail(linkId)) return linkId;
  const dup = ids.remember('linkId', linkId as string, 'recovery linkId');
  if (dup !== null) return dup;
  const observationId = decodeId(record['observationId'], `${label}.observationId`, makeObservationId);
  if (isFail(observationId)) return observationId;
  const adjustmentId = decodeId(record['adjustmentId'], `${label}.adjustmentId`, makeEntryId);
  if (isFail(adjustmentId)) return adjustmentId;
  const entryId = decodeId(record['entryId'], `${label}.entryId`, makeEntryId);
  if (isFail(entryId)) return entryId;
  if (record['movementKind'] !== 'expense' && record['movementKind'] !== 'inflow' && record['movementKind'] !== 'return') {
    return fail(PORTABILITY_REASON.malformedRecord, `${label}.movementKind is unsupported`);
  }
  const capturedAtInstantMs = requireRepresentableInstant(record['capturedAtInstantMs'], `${label}.capturedAtInstantMs`);
  if (typeof capturedAtInstantMs !== 'number') return capturedAtInstantMs;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  return {
    linkId,
    bookId,
    observationId,
    adjustmentId,
    entryId,
    movementKind: record['movementKind'],
    capturedAtInstantMs,
    calculationVersion,
    sourceOperationId,
  };
}

function decodePlan(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): RecurringPlan | DecodeFailure {
  const label = `plans[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const keys = exactKeys(record, [
    'planId', 'bookId', 'name', 'anchor', 'flexibleDefinitionId',
    'createdAtInstantMs', 'createdInTimeZone', 'calculationVersion', 'sourceOperationId',
  ], label);
  if (keys !== null) return keys;
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const planId = decodeId(record['planId'], `${label}.planId`, makePlanId);
  if (isFail(planId)) return planId;
  const dup = ids.remember('planId', planId as string, 'planId');
  if (dup !== null) return dup;
  const name = requireString(record['name'], `${label}.name`);
  if (typeof name !== 'string') return name;
  const anchor = decodeAnchor(record['anchor'], `${label}.anchor`);
  if (isFail(anchor)) return anchor;
  const flexibleDefinitionId = requireNullableString(record['flexibleDefinitionId'], `${label}.flexibleDefinitionId`);
  if (isFail(flexibleDefinitionId)) return flexibleDefinitionId;
  const createdAtInstantMs = requireRepresentableInstant(record['createdAtInstantMs'], `${label}.createdAtInstantMs`);
  if (typeof createdAtInstantMs !== 'number') return createdAtInstantMs;
  const createdInTimeZone = decodeTimeZone(record['createdInTimeZone'], `${label}.createdInTimeZone`);
  if (isFail(createdInTimeZone)) return createdInTimeZone;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  return {
    planId,
    bookId,
    name,
    anchor,
    flexibleDefinitionId,
    createdAtInstantMs,
    createdInTimeZone,
    calculationVersion,
    sourceOperationId,
  };
}

function decodePlanRevision(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): PlanRevision | DecodeFailure {
  const label = `planRevisions[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const keys = exactKeys(record, [
    'revisionId', 'bookId', 'planId', 'effectiveDate', 'amount', 'scheduleDay', 'note',
    'capturedAtInstantMs', 'calculationVersion', 'sourceOperationId',
  ], label);
  if (keys !== null) return keys;
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const revisionId = decodeId(record['revisionId'], `${label}.revisionId`, makeEntryId);
  if (isFail(revisionId)) return revisionId;
  const dup = ids.remember('planRevisionId', revisionId as string, 'plan revisionId');
  if (dup !== null) return dup;
  const planId = decodeId(record['planId'], `${label}.planId`, makePlanId);
  if (isFail(planId)) return planId;
  const effectiveDate = decodeCivilDate(record['effectiveDate'], `${label}.effectiveDate`);
  if (isFail(effectiveDate)) return effectiveDate;
  const amount = decodeMoney(record['amount'], `${label}.amount`);
  if (isFail(amount)) return amount;
  const scheduleDay = requireSafeInteger(record['scheduleDay'], `${label}.scheduleDay`, 1);
  if (typeof scheduleDay !== 'number') return scheduleDay;
  if (scheduleDay > 31) return fail(PORTABILITY_REASON.malformedRecord, `${label}.scheduleDay is out of range`);
  const note = requireText(record['note'], `${label}.note`);
  if (typeof note !== 'string') return note;
  const capturedAtInstantMs = requireRepresentableInstant(record['capturedAtInstantMs'], `${label}.capturedAtInstantMs`);
  if (typeof capturedAtInstantMs !== 'number') return capturedAtInstantMs;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  return {
    revisionId,
    bookId,
    planId,
    effectiveDate,
    amount,
    scheduleDay,
    note,
    capturedAtInstantMs,
    calculationVersion,
    sourceOperationId,
  };
}

function decodePlanOccurrence(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): PlanOccurrence | DecodeFailure {
  const label = `planOccurrences[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const keys = exactKeys(record, [
    'occurrenceId', 'bookId', 'planId', 'revisionId', 'dueDate', 'dueCycleId', 'state',
    'linkedObligationId', 'linkedExpenseEntryId', 'capturedAtInstantMs', 'calculationVersion', 'sourceOperationId',
  ], label);
  if (keys !== null) return keys;
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const occurrenceId = decodeId(record['occurrenceId'], `${label}.occurrenceId`, makeOccurrenceId);
  if (isFail(occurrenceId)) return occurrenceId;
  const dup = ids.remember('occurrenceId', occurrenceId as string, 'occurrenceId');
  if (dup !== null) return dup;
  const planId = decodeId(record['planId'], `${label}.planId`, makePlanId);
  if (isFail(planId)) return planId;
  const revisionId = decodeId(record['revisionId'], `${label}.revisionId`, makeEntryId);
  if (isFail(revisionId)) return revisionId;
  const dueDate = decodeCivilDate(record['dueDate'], `${label}.dueDate`);
  if (isFail(dueDate)) return dueDate;
  const dueCycleId = decodeId(record['dueCycleId'], `${label}.dueCycleId`, makeCycleId);
  if (isFail(dueCycleId)) return dueCycleId;
  if (record['state'] !== 'managed' && record['state'] !== 'detached') {
    return fail(PORTABILITY_REASON.malformedRecord, `${label}.state is unsupported`);
  }
  const linkedObligationId = decodeNullableId(record['linkedObligationId'], `${label}.linkedObligationId`, makeObligationId);
  if (isFail(linkedObligationId)) return linkedObligationId;
  const linkedExpenseEntryId = decodeNullableId(record['linkedExpenseEntryId'], `${label}.linkedExpenseEntryId`, makeEntryId);
  if (isFail(linkedExpenseEntryId)) return linkedExpenseEntryId;
  const capturedAtInstantMs = requireRepresentableInstant(record['capturedAtInstantMs'], `${label}.capturedAtInstantMs`);
  if (typeof capturedAtInstantMs !== 'number') return capturedAtInstantMs;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  return {
    occurrenceId,
    bookId,
    planId,
    revisionId,
    dueDate,
    dueCycleId,
    state: record['state'],
    linkedObligationId,
    linkedExpenseEntryId,
    capturedAtInstantMs,
    calculationVersion,
    sourceOperationId,
  };
}

function decodeSettingsRevision(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): BookSettingsRevision | DecodeFailure {
  const label = `settingsRevisions[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const keys = exactKeys(record, [
    'settingsRevisionId', 'bookId', 'effectiveDate', 'timeZone', 'cycleAnchor', 'weekStart', 'note',
    'capturedAtInstantMs', 'calculationVersion', 'sourceOperationId',
  ], label);
  if (keys !== null) return keys;
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const settingsRevisionId = decodeId(record['settingsRevisionId'], `${label}.settingsRevisionId`, makeEntryId);
  if (isFail(settingsRevisionId)) return settingsRevisionId;
  const dup = ids.remember('settingsRevisionId', settingsRevisionId as string, 'settingsRevisionId');
  if (dup !== null) return dup;
  const effectiveDate = decodeCivilDate(record['effectiveDate'], `${label}.effectiveDate`);
  if (isFail(effectiveDate)) return effectiveDate;
  const timeZone = decodeTimeZone(record['timeZone'], `${label}.timeZone`);
  if (isFail(timeZone)) return timeZone;
  const cycleAnchor = decodeAnchor(record['cycleAnchor'], `${label}.cycleAnchor`);
  if (isFail(cycleAnchor)) return cycleAnchor;
  const weekStart = record['weekStart'] === null ? null : requireSafeInteger(record['weekStart'], `${label}.weekStart`, 0);
  if (weekStart !== null && typeof weekStart !== 'number') return weekStart;
  if (weekStart !== null && weekStart > 6) return fail(PORTABILITY_REASON.malformedRecord, `${label}.weekStart is out of range`);
  const note = requireText(record['note'], `${label}.note`);
  if (typeof note !== 'string') return note;
  const capturedAtInstantMs = requireRepresentableInstant(record['capturedAtInstantMs'], `${label}.capturedAtInstantMs`);
  if (typeof capturedAtInstantMs !== 'number') return capturedAtInstantMs;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  return {
    settingsRevisionId,
    bookId,
    effectiveDate,
    timeZone,
    cycleAnchor,
    weekStart,
    note,
    capturedAtInstantMs,
    calculationVersion,
    sourceOperationId,
  };
}

function decodeSettlement(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): CycleSettlement | DecodeFailure {
  const label = `settlements[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const keys = exactKeys(record, [
    'settlementId', 'bookId', 'cycleId', 'versionId', 'settlementSeq', 'reversed',
    'startingFunds', 'netInflows', 'netOutflows', 'netReturns', 'netAdjustments', 'carryIn',
    'reservedCommitments', 'netAllocations', 'buffer', 'availability',
    'poolCompleteness', 'classificationCompleteness', 'dataAsOfInstantMs',
    'calculationVersion', 'closedAtInstantMs', 'sourceOperationId',
  ], label);
  if (keys !== null) return keys;
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const settlementId = decodeId(record['settlementId'], `${label}.settlementId`, makeSettlementId);
  if (isFail(settlementId)) return settlementId;
  const dup = ids.remember('settlementId', settlementId as string, 'settlementId');
  if (dup !== null) return dup;
  const cycleId = decodeId(record['cycleId'], `${label}.cycleId`, makeCycleId);
  if (isFail(cycleId)) return cycleId;
  const versionId = decodeId(record['versionId'], `${label}.versionId`, makeCycleVersionId);
  if (isFail(versionId)) return versionId;
  const settlementSeq = requireSafeInteger(record['settlementSeq'], `${label}.settlementSeq`, 1);
  if (typeof settlementSeq !== 'number') return settlementSeq;
  if (record['reversed'] !== true && record['reversed'] !== false) {
    return fail(PORTABILITY_REASON.malformedRecord, `${label}.reversed must be boolean`);
  }
  const moneyFields = [
    'startingFunds', 'netInflows', 'netOutflows', 'netReturns', 'netAdjustments', 'carryIn',
    'reservedCommitments', 'netAllocations', 'buffer', 'availability',
  ] as const;
  const money: Record<string, ReturnType<typeof decodeMoney>> = {};
  for (const field of moneyFields) {
    const decoded = decodeMoney(record[field], `${label}.${field}`);
    if (isFail(decoded)) return decoded;
    money[field] = decoded;
  }
  const poolCompleteness = requireString(record['poolCompleteness'], `${label}.poolCompleteness`);
  if (typeof poolCompleteness !== 'string') return poolCompleteness;
  const classificationCompleteness = requireString(record['classificationCompleteness'], `${label}.classificationCompleteness`);
  if (typeof classificationCompleteness !== 'string') return classificationCompleteness;
  const dataAsOfInstantMs = requireRepresentableInstant(record['dataAsOfInstantMs'], `${label}.dataAsOfInstantMs`);
  if (typeof dataAsOfInstantMs !== 'number') return dataAsOfInstantMs;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const closedAtInstantMs = requireRepresentableInstant(record['closedAtInstantMs'], `${label}.closedAtInstantMs`);
  if (typeof closedAtInstantMs !== 'number') return closedAtInstantMs;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  return {
    settlementId,
    bookId,
    cycleId,
    versionId,
    settlementSeq,
    reversed: record['reversed'],
    startingFunds: money['startingFunds'] as CycleSettlement['startingFunds'],
    netInflows: money['netInflows'] as CycleSettlement['netInflows'],
    netOutflows: money['netOutflows'] as CycleSettlement['netOutflows'],
    netReturns: money['netReturns'] as CycleSettlement['netReturns'],
    netAdjustments: money['netAdjustments'] as CycleSettlement['netAdjustments'],
    carryIn: money['carryIn'] as CycleSettlement['carryIn'],
    reservedCommitments: money['reservedCommitments'] as CycleSettlement['reservedCommitments'],
    netAllocations: money['netAllocations'] as CycleSettlement['netAllocations'],
    buffer: money['buffer'] as CycleSettlement['buffer'],
    availability: money['availability'] as CycleSettlement['availability'],
    poolCompleteness,
    classificationCompleteness,
    dataAsOfInstantMs,
    calculationVersion,
    closedAtInstantMs,
    sourceOperationId,
  };
}

function decodeDisposition(raw: unknown, label: string): RemainderDisposition | DecodeFailure {
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const kind = record['kind'];
  if (kind === 'carryIn') {
    const keys = exactKeys(record, ['kind', 'amount', 'destinationCycleId'], label);
    if (keys !== null) return keys;
    const amount = decodeMoney(record['amount'], `${label}.amount`);
    if (isFail(amount)) return amount;
    const destinationCycleId = decodeId(record['destinationCycleId'], `${label}.destinationCycleId`, makeCycleId);
    if (isFail(destinationCycleId)) return destinationCycleId;
    return { kind: 'carryIn', amount, destinationCycleId };
  }
  if (kind === 'fundTracked') {
    const keys = exactKeys(record, ['kind', 'amount'], label);
    if (keys !== null) return keys;
    const amount = decodeMoney(record['amount'], `${label}.amount`);
    if (isFail(amount)) return amount;
    return { kind: 'fundTracked', amount };
  }
  if (kind === 'split') {
    const keys = exactKeys(record, ['kind', 'carryAmount', 'fundAmount', 'destinationCycleId'], label);
    if (keys !== null) return keys;
    const carryAmount = decodeMoney(record['carryAmount'], `${label}.carryAmount`);
    if (isFail(carryAmount)) return carryAmount;
    const fundAmount = decodeMoney(record['fundAmount'], `${label}.fundAmount`);
    if (isFail(fundAmount)) return fundAmount;
    const destinationCycleId = decodeId(record['destinationCycleId'], `${label}.destinationCycleId`, makeCycleId);
    if (isFail(destinationCycleId)) return destinationCycleId;
    return { kind: 'split', carryAmount, fundAmount, destinationCycleId };
  }
  if (kind === 'leaveIndependent') {
    const keys = exactKeys(record, ['kind'], label);
    if (keys !== null) return keys;
    return { kind: 'leaveIndependent' };
  }
  return fail(PORTABILITY_REASON.malformedRecord, `${label}.kind is unsupported`);
}

function decodeCarryAction(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): CarryAction | DecodeFailure {
  const label = `carryActions[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const keys = exactKeys(record, [
    'carryId', 'bookId', 'settlementId', 'sourceCycleId', 'disposition', 'downstreamCursors',
    'note', 'capturedAtInstantMs', 'calculationVersion', 'sourceOperationId',
  ], label);
  if (keys !== null) return keys;
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const carryId = decodeId(record['carryId'], `${label}.carryId`, makeEntryId);
  if (isFail(carryId)) return carryId;
  const dup = ids.remember('carryId', carryId as string, 'carryId');
  if (dup !== null) return dup;
  const settlementId = decodeId(record['settlementId'], `${label}.settlementId`, makeSettlementId);
  if (isFail(settlementId)) return settlementId;
  const sourceCycleId = decodeId(record['sourceCycleId'], `${label}.sourceCycleId`, makeCycleId);
  if (isFail(sourceCycleId)) return sourceCycleId;
  const disposition = decodeDisposition(record['disposition'], `${label}.disposition`);
  if (isFail(disposition)) return disposition;
  const cursors = asRecord(record['downstreamCursors']);
  if (cursors === null) return fail(PORTABILITY_REASON.malformedRecord, `${label}.downstreamCursors is not an object`);
  const cursorKeys = exactKeys(cursors, ['entryCount', 'allocationCount', 'obligationCount', 'settlementCount'], `${label}.downstreamCursors`);
  if (cursorKeys !== null) return cursorKeys;
  const entryCount = requireSafeInteger(cursors['entryCount'], `${label}.downstreamCursors.entryCount`, 0);
  if (typeof entryCount !== 'number') return entryCount;
  const allocationCount = requireSafeInteger(cursors['allocationCount'], `${label}.downstreamCursors.allocationCount`, 0);
  if (typeof allocationCount !== 'number') return allocationCount;
  const obligationCount = requireSafeInteger(cursors['obligationCount'], `${label}.downstreamCursors.obligationCount`, 0);
  if (typeof obligationCount !== 'number') return obligationCount;
  const settlementCount = requireSafeInteger(cursors['settlementCount'], `${label}.downstreamCursors.settlementCount`, 0);
  if (typeof settlementCount !== 'number') return settlementCount;
  const note = requireText(record['note'], `${label}.note`);
  if (typeof note !== 'string') return note;
  const capturedAtInstantMs = requireRepresentableInstant(record['capturedAtInstantMs'], `${label}.capturedAtInstantMs`);
  if (typeof capturedAtInstantMs !== 'number') return capturedAtInstantMs;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  return {
    carryId,
    bookId,
    settlementId,
    sourceCycleId,
    disposition,
    downstreamCursors: { entryCount, allocationCount, obligationCount, settlementCount },
    note,
    capturedAtInstantMs,
    calculationVersion,
    sourceOperationId,
  };
}

function decodeDelta(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): PropagationDelta | DecodeFailure {
  const label = `propagationDeltas[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const keys = exactKeys(record, [
    'deltaId', 'bookId', 'settlementId', 'sourceCycleId', 'correctionEntryId', 'carryActionId',
    'deltaAmount', 'note', 'capturedAtInstantMs', 'calculationVersion', 'sourceOperationId',
  ], label);
  if (keys !== null) return keys;
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const deltaId = decodeId(record['deltaId'], `${label}.deltaId`, makeEntryId);
  if (isFail(deltaId)) return deltaId;
  const dup = ids.remember('deltaId', deltaId as string, 'deltaId');
  if (dup !== null) return dup;
  const settlementId = decodeId(record['settlementId'], `${label}.settlementId`, makeSettlementId);
  if (isFail(settlementId)) return settlementId;
  const sourceCycleId = decodeId(record['sourceCycleId'], `${label}.sourceCycleId`, makeCycleId);
  if (isFail(sourceCycleId)) return sourceCycleId;
  const correctionEntryId = decodeId(record['correctionEntryId'], `${label}.correctionEntryId`, makeEntryId);
  if (isFail(correctionEntryId)) return correctionEntryId;
  const carryActionId = decodeNullableId(record['carryActionId'], `${label}.carryActionId`, makeEntryId);
  if (isFail(carryActionId)) return carryActionId;
  const deltaAmount = decodeMoney(record['deltaAmount'], `${label}.deltaAmount`);
  if (isFail(deltaAmount)) return deltaAmount;
  const note = requireText(record['note'], `${label}.note`);
  if (typeof note !== 'string') return note;
  const capturedAtInstantMs = requireRepresentableInstant(record['capturedAtInstantMs'], `${label}.capturedAtInstantMs`);
  if (typeof capturedAtInstantMs !== 'number') return capturedAtInstantMs;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  return {
    deltaId,
    bookId,
    settlementId,
    sourceCycleId,
    correctionEntryId,
    carryActionId,
    deltaAmount,
    note,
    capturedAtInstantMs,
    calculationVersion,
    sourceOperationId,
  };
}

function decodeConflict(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): PropagationConflict | DecodeFailure {
  const label = `propagationConflicts[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const keys = exactKeys(record, [
    'conflictId', 'bookId', 'settlementId', 'sourceCycleId', 'correctionEntryId',
    'unpropagatedAmount', 'downstreamKind', 'note', 'capturedAtInstantMs', 'calculationVersion', 'sourceOperationId',
  ], label);
  if (keys !== null) return keys;
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const conflictId = decodeId(record['conflictId'], `${label}.conflictId`, makeEntryId);
  if (isFail(conflictId)) return conflictId;
  const dup = ids.remember('conflictId', conflictId as string, 'conflictId');
  if (dup !== null) return dup;
  const settlementId = decodeId(record['settlementId'], `${label}.settlementId`, makeSettlementId);
  if (isFail(settlementId)) return settlementId;
  const sourceCycleId = decodeId(record['sourceCycleId'], `${label}.sourceCycleId`, makeCycleId);
  if (isFail(sourceCycleId)) return sourceCycleId;
  const correctionEntryId = decodeId(record['correctionEntryId'], `${label}.correctionEntryId`, makeEntryId);
  if (isFail(correctionEntryId)) return correctionEntryId;
  const unpropagatedAmount = decodeMoney(record['unpropagatedAmount'], `${label}.unpropagatedAmount`);
  if (isFail(unpropagatedAmount)) return unpropagatedAmount;
  if (record['downstreamKind'] !== 'carry' && record['downstreamKind'] !== 'trackedAllocation' && record['downstreamKind'] !== 'both') {
    return fail(PORTABILITY_REASON.malformedRecord, `${label}.downstreamKind is unsupported`);
  }
  const note = requireText(record['note'], `${label}.note`);
  if (typeof note !== 'string') return note;
  const capturedAtInstantMs = requireRepresentableInstant(record['capturedAtInstantMs'], `${label}.capturedAtInstantMs`);
  if (typeof capturedAtInstantMs !== 'number') return capturedAtInstantMs;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  return {
    conflictId,
    bookId,
    settlementId,
    sourceCycleId,
    correctionEntryId,
    unpropagatedAmount,
    downstreamKind: record['downstreamKind'],
    note,
    capturedAtInstantMs,
    calculationVersion,
    sourceOperationId,
  };
}

function decodeResolution(raw: unknown, bookId: BookId, ids: IdentitySet, index: number): ConflictResolution | DecodeFailure {
  const label = `conflictResolutions[${index}]`;
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const keys = exactKeys(record, [
    'resolutionId', 'bookId', 'conflictId', 'settlementId', 'resolution', 'note',
    'capturedAtInstantMs', 'calculationVersion', 'sourceOperationId',
  ], label);
  if (keys !== null) return keys;
  const foreign = requireBook(record, bookId, label);
  if (foreign !== null) return foreign;
  const resolutionId = decodeId(record['resolutionId'], `${label}.resolutionId`, makeEntryId);
  if (isFail(resolutionId)) return resolutionId;
  const dup = ids.remember('resolutionId', resolutionId as string, 'resolutionId');
  if (dup !== null) return dup;
  const conflictId = decodeId(record['conflictId'], `${label}.conflictId`, makeEntryId);
  if (isFail(conflictId)) return conflictId;
  const settlementId = decodeId(record['settlementId'], `${label}.settlementId`, makeSettlementId);
  if (isFail(settlementId)) return settlementId;
  if (record['resolution'] !== 'acknowledgedDownstreamStands') {
    return fail(PORTABILITY_REASON.malformedRecord, `${label}.resolution is unsupported`);
  }
  const note = requireText(record['note'], `${label}.note`);
  if (typeof note !== 'string') return note;
  const capturedAtInstantMs = requireRepresentableInstant(record['capturedAtInstantMs'], `${label}.capturedAtInstantMs`);
  if (typeof capturedAtInstantMs !== 'number') return capturedAtInstantMs;
  const calculationVersion = requireString(record['calculationVersion'], `${label}.calculationVersion`);
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const sourceOperationId = decodeId(record['sourceOperationId'], `${label}.sourceOperationId`, makeOperationId);
  if (isFail(sourceOperationId)) return sourceOperationId;
  return {
    resolutionId,
    bookId,
    conflictId,
    settlementId,
    resolution: 'acknowledgedDownstreamStands',
    note,
    capturedAtInstantMs,
    calculationVersion,
    sourceOperationId,
  };
}

export function decodeBookState(raw: unknown): BookState | DecodeFailure {
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, 'book state is not an object');
  const keys = exactKeys(record, BOOK_STATE_KEYS, 'book state');
  if (keys !== null) return keys;
  const book = decodeFinanceBook(record['book']);
  if (isFail(book)) return book;
  const revision = requireSafeInteger(record['revision'], `book ${book.id as string} revision`, 1);
  if (typeof revision !== 'number') return revision;
  const ids = new IdentitySet();
  const cycles = decodeArray(record['cycles'], 'cycles', (item, index) => decodeCycle(item, book.id, ids, index));
  if (isFail(cycles)) return cycles;
  const entries = decodeArray(record['entries'], 'entries', (item, index) => decodeEntry(item, book.id, ids, index));
  if (isFail(entries)) return entries;
  const obligations = decodeArray(record['obligations'], 'obligations', (item, index) => decodeObligation(item, book.id, ids, index));
  if (isFail(obligations)) return obligations;
  const obligationEvents = decodeArray(record['obligationEvents'], 'obligationEvents', (item, index) => decodeObligationEvent(item, book.id, ids, index));
  if (isFail(obligationEvents)) return obligationEvents;
  const goals = decodeArray(record['goals'], 'goals', (item, index) => decodeGoal(item, book.id, ids, index));
  if (isFail(goals)) return goals;
  const allocationRecords = decodeArray(record['allocationRecords'], 'allocationRecords', (item, index) => decodeAllocation(item, book.id, ids, index));
  if (isFail(allocationRecords)) return allocationRecords;
  const buffer = decodeBuffer(record['buffer'], `book ${book.id as string} buffer`);
  if (isFail(buffer)) return buffer;
  const observations = decodeArray(record['observations'], 'observations', (item, index) => decodeObservation(item, book.id, ids, index));
  if (isFail(observations)) return observations;
  const adjustments = decodeArray(record['adjustments'], 'adjustments', (item, index) => decodeAdjustment(item, book.id, ids, index));
  if (isFail(adjustments)) return adjustments;
  const recoveryLinks = decodeArray(record['recoveryLinks'], 'recoveryLinks', (item, index) => decodeRecoveryLink(item, book.id, ids, index));
  if (isFail(recoveryLinks)) return recoveryLinks;
  const plans = decodeArray(record['plans'], 'plans', (item, index) => decodePlan(item, book.id, ids, index));
  if (isFail(plans)) return plans;
  const planRevisions = decodeArray(record['planRevisions'], 'planRevisions', (item, index) => decodePlanRevision(item, book.id, ids, index));
  if (isFail(planRevisions)) return planRevisions;
  const planOccurrences = decodeArray(record['planOccurrences'], 'planOccurrences', (item, index) => decodePlanOccurrence(item, book.id, ids, index));
  if (isFail(planOccurrences)) return planOccurrences;
  const settingsRevisions = decodeArray(record['settingsRevisions'], 'settingsRevisions', (item, index) => decodeSettingsRevision(item, book.id, ids, index));
  if (isFail(settingsRevisions)) return settingsRevisions;
  const settlements = decodeArray(record['settlements'], 'settlements', (item, index) => decodeSettlement(item, book.id, ids, index));
  if (isFail(settlements)) return settlements;
  const carryActions = decodeArray(record['carryActions'], 'carryActions', (item, index) => decodeCarryAction(item, book.id, ids, index));
  if (isFail(carryActions)) return carryActions;
  const propagationDeltas = decodeArray(record['propagationDeltas'], 'propagationDeltas', (item, index) => decodeDelta(item, book.id, ids, index));
  if (isFail(propagationDeltas)) return propagationDeltas;
  const propagationConflicts = decodeArray(record['propagationConflicts'], 'propagationConflicts', (item, index) => decodeConflict(item, book.id, ids, index));
  if (isFail(propagationConflicts)) return propagationConflicts;
  const conflictResolutions = decodeArray(record['conflictResolutions'], 'conflictResolutions', (item, index) => decodeResolution(item, book.id, ids, index));
  if (isFail(conflictResolutions)) return conflictResolutions;
  return {
    book,
    revision,
    cycles,
    entries,
    obligations,
    obligationEvents,
    goals,
    allocationRecords,
    buffer,
    observations,
    adjustments,
    recoveryLinks,
    plans,
    planRevisions,
    planOccurrences,
    settingsRevisions,
    settlements,
    carryActions,
    propagationDeltas,
    propagationConflicts,
    conflictResolutions,
  };
}
