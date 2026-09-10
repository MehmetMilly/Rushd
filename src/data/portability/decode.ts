/**
 * Fail-closed runtime decoders for portable guest snapshots.
 *
 * Integrity is only a recomputable digest; these decoders are the schema,
 * reference, provenance, and bound-identity gate before any staging write.
 */

import { canonicalJson, stableDigest } from '../../domain/contracts/canonical';
import { validateFinanceCommand } from '../../application/commands/validation';
import {
  HANDLER_CLOCK_PROVENANCE_VERSION,
  SYNC_RECORD_SCHEMA_VERSION,
  type CommandEffect,
  type CommandKind,
  type CommandReceipt,
  type FinanceCommand,
  type OperationRecord,
  type OutboxDeliveryState,
  type OutboxEnvelope,
} from '../../domain/contracts/commands';
import type { BookState } from '../../domain/contracts/ledger';
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
  type OperationId,
} from '../../domain/contracts/identity';
import { makeDeviceId, makeRepositoryScopeId } from '../../domain/sync/scope';
import {
  SYNC_CURSOR_SCHEMA_VERSION,
  makeReplicationStreamId,
  makeSyncCursor,
  type PulledOperation,
  type ReplicationStreamId,
  type SyncCursor,
} from '../../domain/sync/cursors';
import { CANONICAL_DIGEST_PATTERN } from '../../domain/contracts/repository-snapshot-validation';
import { PORTABILITY_REASON } from '../migration/reasons';
import type { PortableScope } from './format';
import {
  asRecord,
  decodeAnchor,
  decodeArray,
  decodeCivilDate,
  decodeMoney,
  decodeNullableMoney,
  decodeTimeZone,
  exactKeys,
  fail,
  isFail,
  requireNullableRepresentableInstant,
  requireRepresentableInstant,
  requireSafeInteger,
  requireString,
  type DecodeFailure,
} from './decode-helpers';
import { decodeBookState } from './decode-ledger';

export type { DecodeFailure };

const RECEIPT_KEYS = [
  'operationId',
  'commandKind',
  'bookId',
  'revisionBefore',
  'revisionAfter',
  'committedAtInstantMs',
  'canonicalDigest',
  'calculationVersion',
  'effects',
  'handlerClockInstants',
  'handlerClockVersion',
  'schemaVersion',
  'scopeId',
  'sourceDeviceId',
  'enqueueSequence',
] as const;

const OPERATION_KEYS = [
  'operationId',
  'bookId',
  'canonicalCommand',
  'receipt',
  'committedAtInstantMs',
  'handlerClockInstants',
  'handlerClockVersion',
  'schemaVersion',
  'scopeId',
  'sourceDeviceId',
  'enqueueSequence',
] as const;

const OUTBOX_KEYS = [
  'outboxId',
  'operationId',
  'bookId',
  'commandKind',
  'revisionAfter',
  'canonicalDigest',
  'createdAtInstantMs',
  'status',
  'schemaVersion',
  'scopeId',
  'sourceDeviceId',
  'enqueueSequence',
] as const;

const DELIVERY_KEYS = [
  'schemaVersion',
  'outboxId',
  'operationId',
  'version',
  'attempts',
  'lastError',
  'leaseHolder',
  'leaseExpiresAtMs',
  'acknowledged',
  'nextRetryAtMs',
] as const;

const PULLED_KEYS = [
  'operationId',
  'sequence',
  'scopeId',
  'bookId',
  'baseRevision',
  'resultingRevision',
  'canonicalCommand',
  'canonicalDigest',
  'sourceDeviceId',
  'sourceEnqueueSequence',
  'schemaVersion',
] as const;

const STREAM_KEYS = ['streamId', 'cursor', 'batchDigest', 'applied'] as const;

const COMMAND_KINDS = new Set<CommandKind>([
  'createBook',
  'openCycle',
  'recordInflow',
  'reverseInflow',
  'recordExpense',
  'correctExpense',
  'recordExpenseReturn',
  'correctExpenseReturn',
  'createObligation',
  'recordObligationPayment',
  'recordObligationReturn',
  'settleObligationFinally',
  'cancelObligation',
  'reopenObligation',
  'openObligationDispute',
  'resolveObligationDispute',
  'releaseDisputedResidual',
  'createGoal',
  'fundAllocationPool',
  'assignToGoal',
  'unassignFromGoal',
  'releaseAllocation',
  'reverseAllocationRecord',
  'setBuffer',
  'openBoundaryCycle',
  'recordRealityCheck',
  'recoverObservedActivity',
  'createRecurringPlan',
  'reviseRecurringPlan',
  'materializePlanOccurrences',
  'detachPlanOccurrence',
  'reservePlanOccurrence',
  'updateBookSettings',
  'rebaseOpenCycle',
  'closeCycle',
  'disposeCycleRemainder',
  'reopenCycle',
  'recordClosedCycleCorrection',
  'resolvePropagationConflict',
]);

function decodeEffectId<T>(raw: unknown, make: (value: unknown) => { ok: true; value: T } | { ok: false; failure: { detail: string } }, label: string): T | DecodeFailure {
  const made = make(raw);
  if (!made.ok) return fail(PORTABILITY_REASON.invalidReference, `${label}: ${made.failure.detail}`);
  return made.value;
}

function decodeCommandEffect(raw: unknown, label: string): CommandEffect | DecodeFailure {
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, `${label} is not an object`);
  const kind = record['kind'];
  if (typeof kind !== 'string') return fail(PORTABILITY_REASON.malformedRecord, `${label} is missing effect kind`);
  const money = (key: string) => decodeMoney(record[key], `${label}.${key}`);
  const date = (key: string) => decodeCivilDate(record[key], `${label}.${key}`);
  if (kind === 'bookCreated') {
    const keys = exactKeys(record, ['kind', 'bookId', 'currency', 'timeZone', 'cycleAnchor'], label);
    if (keys !== null) return keys;
    const bookId = decodeEffectId(record['bookId'], makeBookId, `${label}.bookId`);
    if (isFail(bookId)) return bookId;
    if (record['currency'] !== 'SAR') return fail(PORTABILITY_REASON.wrongCurrency, `${label}.currency is not SAR`);
    const timeZone = decodeTimeZone(record['timeZone'], `${label}.timeZone`);
    if (isFail(timeZone)) return timeZone;
    const cycleAnchor = decodeAnchor(record['cycleAnchor'], `${label}.cycleAnchor`);
    if (isFail(cycleAnchor)) return cycleAnchor;
    return { kind, bookId, currency: 'SAR', timeZone, cycleAnchor };
  }
  if (kind === 'cycleOpened') {
    const keys = exactKeys(record, ['kind', 'cycleId', 'startDate', 'endDateExclusive', 'startingFunds'], label);
    if (keys !== null) return keys;
    const cycleId = decodeEffectId(record['cycleId'], makeCycleId, `${label}.cycleId`);
    if (isFail(cycleId)) return cycleId;
    const startDate = date('startDate');
    if (isFail(startDate)) return startDate;
    const endDateExclusive = date('endDateExclusive');
    if (isFail(endDateExclusive)) return endDateExclusive;
    const startingFunds = money('startingFunds');
    if (isFail(startingFunds)) return startingFunds;
    return { kind, cycleId, startDate, endDateExclusive, startingFunds };
  }
  if (kind === 'inflowRecorded' || kind === 'expenseRecorded') {
    const extra = kind === 'expenseRecorded' ? ['linkedObligationId', 'replacesEntryId'] : [];
    const keys = exactKeys(record, ['kind', 'entryId', 'cycleId', 'localDate', 'amount', ...extra], label);
    if (keys !== null) return keys;
    const entryId = decodeEffectId(record['entryId'], makeEntryId, `${label}.entryId`);
    if (isFail(entryId)) return entryId;
    const cycleId = decodeEffectId(record['cycleId'], makeCycleId, `${label}.cycleId`);
    if (isFail(cycleId)) return cycleId;
    const localDate = date('localDate');
    if (isFail(localDate)) return localDate;
    const amount = money('amount');
    if (isFail(amount)) return amount;
    if (kind === 'inflowRecorded') return { kind, entryId, cycleId, localDate, amount };
    const linkedObligationId = record['linkedObligationId'] === null ? null : decodeEffectId(record['linkedObligationId'], makeObligationId, `${label}.linkedObligationId`);
    if (isFail(linkedObligationId)) return linkedObligationId;
    const replacesEntryId = record['replacesEntryId'] === null ? null : decodeEffectId(record['replacesEntryId'], makeEntryId, `${label}.replacesEntryId`);
    if (isFail(replacesEntryId)) return replacesEntryId;
    return { kind, entryId, cycleId, localDate, amount, linkedObligationId, replacesEntryId };
  }
  if (kind === 'inflowReversalRecorded' || kind === 'expenseReversalRecorded') {
    const keys = exactKeys(record, ['kind', 'entryId', 'reversesEntryId', 'cycleId', 'localDate', 'amount'], label);
    if (keys !== null) return keys;
    const entryId = decodeEffectId(record['entryId'], makeEntryId, `${label}.entryId`);
    if (isFail(entryId)) return entryId;
    const reversesEntryId = decodeEffectId(record['reversesEntryId'], makeEntryId, `${label}.reversesEntryId`);
    if (isFail(reversesEntryId)) return reversesEntryId;
    const cycleId = decodeEffectId(record['cycleId'], makeCycleId, `${label}.cycleId`);
    if (isFail(cycleId)) return cycleId;
    const localDate = date('localDate');
    if (isFail(localDate)) return localDate;
    const amount = money('amount');
    if (isFail(amount)) return amount;
    return { kind, entryId, reversesEntryId, cycleId, localDate, amount };
  }
  if (kind === 'expenseReturnRecorded' || kind === 'expenseReturnReversalRecorded') {
    const extra = kind === 'expenseReturnRecorded' ? ['replacesReturnEntryId'] : ['reversesEntryId'];
    const keys = exactKeys(record, ['kind', 'entryId', 'cycleId', 'localDate', 'amount', 'linkedExpenseEntryId', 'linkedObligationId', ...extra], label);
    if (keys !== null) return keys;
    const entryId = decodeEffectId(record['entryId'], makeEntryId, `${label}.entryId`);
    if (isFail(entryId)) return entryId;
    const cycleId = decodeEffectId(record['cycleId'], makeCycleId, `${label}.cycleId`);
    if (isFail(cycleId)) return cycleId;
    const localDate = date('localDate');
    if (isFail(localDate)) return localDate;
    const amount = money('amount');
    if (isFail(amount)) return amount;
    const linkedExpenseEntryId = record['linkedExpenseEntryId'] === null ? null : decodeEffectId(record['linkedExpenseEntryId'], makeEntryId, `${label}.linkedExpenseEntryId`);
    if (isFail(linkedExpenseEntryId)) return linkedExpenseEntryId;
    const linkedObligationId = record['linkedObligationId'] === null ? null : decodeEffectId(record['linkedObligationId'], makeObligationId, `${label}.linkedObligationId`);
    if (isFail(linkedObligationId)) return linkedObligationId;
    if (kind === 'expenseReturnRecorded') {
      const replacesReturnEntryId = record['replacesReturnEntryId'] === null ? null : decodeEffectId(record['replacesReturnEntryId'], makeEntryId, `${label}.replacesReturnEntryId`);
      if (isFail(replacesReturnEntryId)) return replacesReturnEntryId;
      return { kind, entryId, cycleId, localDate, amount, linkedExpenseEntryId, linkedObligationId, replacesReturnEntryId };
    }
    const reversesEntryId = decodeEffectId(record['reversesEntryId'], makeEntryId, `${label}.reversesEntryId`);
    if (isFail(reversesEntryId)) return reversesEntryId;
    return { kind, entryId, reversesEntryId, cycleId, localDate, amount, linkedExpenseEntryId, linkedObligationId };
  }
  if (kind === 'obligationCreated') {
    const keys = exactKeys(record, ['kind', 'obligationId', 'cycleId', 'expectedAmount'], label);
    if (keys !== null) return keys;
    const obligationId = decodeEffectId(record['obligationId'], makeObligationId, `${label}.obligationId`);
    if (isFail(obligationId)) return obligationId;
    const cycleId = decodeEffectId(record['cycleId'], makeCycleId, `${label}.cycleId`);
    if (isFail(cycleId)) return cycleId;
    const expectedAmount = money('expectedAmount');
    if (isFail(expectedAmount)) return expectedAmount;
    return { kind, obligationId, cycleId, expectedAmount };
  }
  if (
    kind === 'obligationFinallySettled' ||
    kind === 'obligationCancelled' ||
    kind === 'obligationReopened' ||
    kind === 'obligationResidualReleased'
  ) {
    const amountKey = kind === 'obligationReopened' ? 'reinstatedResidual' : 'releasedResidual';
    const keys = exactKeys(record, ['kind', 'obligationId', amountKey], label);
    if (keys !== null) return keys;
    const obligationId = decodeEffectId(record['obligationId'], makeObligationId, `${label}.obligationId`);
    if (isFail(obligationId)) return obligationId;
    const residual = money(amountKey);
    if (isFail(residual)) return residual;
    if (kind === 'obligationReopened') return { kind, obligationId, reinstatedResidual: residual };
    if (kind === 'obligationFinallySettled') return { kind, obligationId, releasedResidual: residual };
    if (kind === 'obligationCancelled') return { kind, obligationId, releasedResidual: residual };
    return { kind, obligationId, releasedResidual: residual };
  }
  if (kind === 'obligationDisputeOpened') {
    const keys = exactKeys(record, ['kind', 'obligationId'], label);
    if (keys !== null) return keys;
    const obligationId = decodeEffectId(record['obligationId'], makeObligationId, `${label}.obligationId`);
    if (isFail(obligationId)) return obligationId;
    return { kind, obligationId };
  }
  if (kind === 'obligationDisputeResolved') {
    const keys = exactKeys(record, ['kind', 'obligationId', 'via'], label);
    if (keys !== null) return keys;
    const obligationId = decodeEffectId(record['obligationId'], makeObligationId, `${label}.obligationId`);
    if (isFail(obligationId)) return obligationId;
    if (record['via'] !== 'finalSettlement' && record['via'] !== 'cancellation' && record['via'] !== 'explicitResolution') {
      return fail(PORTABILITY_REASON.malformedRecord, `${label}.via is unsupported`);
    }
    return { kind, obligationId, via: record['via'] };
  }
  if (kind === 'goalCreated') {
    const keys = exactKeys(record, ['kind', 'goalId', 'targetAmount'], label);
    if (keys !== null) return keys;
    const goalId = decodeEffectId(record['goalId'], makeGoalId, `${label}.goalId`);
    if (isFail(goalId)) return goalId;
    const targetAmount = money('targetAmount');
    if (isFail(targetAmount)) return targetAmount;
    return { kind, goalId, targetAmount };
  }
  if (kind === 'allocationFunded') {
    const keys = exactKeys(record, ['kind', 'recordId', 'cycleId', 'localDate', 'amount'], label);
    if (keys !== null) return keys;
    const recordId = decodeEffectId(record['recordId'], makeAllocationRecordId, `${label}.recordId`);
    if (isFail(recordId)) return recordId;
    const cycleId = decodeEffectId(record['cycleId'], makeCycleId, `${label}.cycleId`);
    if (isFail(cycleId)) return cycleId;
    const localDate = date('localDate');
    if (isFail(localDate)) return localDate;
    const amount = money('amount');
    if (isFail(amount)) return amount;
    return { kind, recordId, cycleId, localDate, amount };
  }
  if (kind === 'allocationAssigned' || kind === 'allocationUnassigned') {
    const keys = exactKeys(record, ['kind', 'recordId', 'goalId', 'amount'], label);
    if (keys !== null) return keys;
    const recordId = decodeEffectId(record['recordId'], makeAllocationRecordId, `${label}.recordId`);
    if (isFail(recordId)) return recordId;
    const goalId = decodeEffectId(record['goalId'], makeGoalId, `${label}.goalId`);
    if (isFail(goalId)) return goalId;
    const amount = money('amount');
    if (isFail(amount)) return amount;
    return { kind, recordId, goalId, amount };
  }
  if (kind === 'allocationReleased') {
    const keys = exactKeys(record, ['kind', 'recordId', 'cycleId', 'localDate', 'destinationCycleId', 'goalId', 'amount'], label);
    if (keys !== null) return keys;
    const recordId = decodeEffectId(record['recordId'], makeAllocationRecordId, `${label}.recordId`);
    if (isFail(recordId)) return recordId;
    const cycleId = decodeEffectId(record['cycleId'], makeCycleId, `${label}.cycleId`);
    if (isFail(cycleId)) return cycleId;
    const localDate = date('localDate');
    if (isFail(localDate)) return localDate;
    const destinationCycleId = decodeEffectId(record['destinationCycleId'], makeCycleId, `${label}.destinationCycleId`);
    if (isFail(destinationCycleId)) return destinationCycleId;
    const goalId = record['goalId'] === null ? null : decodeEffectId(record['goalId'], makeGoalId, `${label}.goalId`);
    if (isFail(goalId)) return goalId;
    const amount = money('amount');
    if (isFail(amount)) return amount;
    return { kind, recordId, cycleId, localDate, destinationCycleId, goalId, amount };
  }
  if (kind === 'allocationRecordReversed') {
    const keys = exactKeys(record, ['kind', 'recordId', 'reversesRecordId', 'reversedChange', 'amount'], label);
    if (keys !== null) return keys;
    const recordId = decodeEffectId(record['recordId'], makeAllocationRecordId, `${label}.recordId`);
    if (isFail(recordId)) return recordId;
    const reversesRecordId = decodeEffectId(record['reversesRecordId'], makeAllocationRecordId, `${label}.reversesRecordId`);
    if (isFail(reversesRecordId)) return reversesRecordId;
    if (
      record['reversedChange'] !== 'funding' &&
      record['reversedChange'] !== 'assignment' &&
      record['reversedChange'] !== 'unassignment' &&
      record['reversedChange'] !== 'release'
    ) {
      return fail(PORTABILITY_REASON.malformedRecord, `${label}.reversedChange is unsupported`);
    }
    const amount = money('amount');
    if (isFail(amount)) return amount;
    return { kind, recordId, reversesRecordId, reversedChange: record['reversedChange'], amount };
  }
  if (kind === 'bufferSet') {
    const keys = exactKeys(record, ['kind', 'amount', 'previousAmount'], label);
    if (keys !== null) return keys;
    const amount = money('amount');
    if (isFail(amount)) return amount;
    const previousAmount = decodeNullableMoney(record['previousAmount'], `${label}.previousAmount`);
    if (isFail(previousAmount)) return previousAmount;
    return { kind, amount, previousAmount };
  }
  if (kind === 'boundaryCycleOpened') {
    const keys = exactKeys(record, ['kind', 'cycleId', 'versionId', 'startDate', 'endDateExclusive', 'observedPool'], label);
    if (keys !== null) return keys;
    const cycleId = decodeEffectId(record['cycleId'], makeCycleId, `${label}.cycleId`);
    if (isFail(cycleId)) return cycleId;
    const versionId = decodeEffectId(record['versionId'], makeCycleVersionId, `${label}.versionId`);
    if (isFail(versionId)) return versionId;
    const startDate = date('startDate');
    if (isFail(startDate)) return startDate;
    const endDateExclusive = date('endDateExclusive');
    if (isFail(endDateExclusive)) return endDateExclusive;
    const observedPool = money('observedPool');
    if (isFail(observedPool)) return observedPool;
    return { kind, cycleId, versionId, startDate, endDateExclusive, observedPool };
  }
  if (kind === 'realityCheckRecorded') {
    const keys = exactKeys(record, ['kind', 'observationId', 'cycleId', 'observedPool', 'ledgerPool', 'adjustmentAmount'], label);
    if (keys !== null) return keys;
    const observationId = decodeEffectId(record['observationId'], makeObservationId, `${label}.observationId`);
    if (isFail(observationId)) return observationId;
    const cycleId = decodeEffectId(record['cycleId'], makeCycleId, `${label}.cycleId`);
    if (isFail(cycleId)) return cycleId;
    const observedPool = money('observedPool');
    if (isFail(observedPool)) return observedPool;
    const ledgerPool = money('ledgerPool');
    if (isFail(ledgerPool)) return ledgerPool;
    const adjustmentAmount = money('adjustmentAmount');
    if (isFail(adjustmentAmount)) return adjustmentAmount;
    return { kind, observationId, cycleId, observedPool, ledgerPool, adjustmentAmount };
  }
  if (kind === 'observedActivityRecovered') {
    const keys = exactKeys(record, ['kind', 'entryId', 'observationId', 'cycleId', 'localDate', 'amount', 'movementKind'], label);
    if (keys !== null) return keys;
    const entryId = decodeEffectId(record['entryId'], makeEntryId, `${label}.entryId`);
    if (isFail(entryId)) return entryId;
    const observationId = decodeEffectId(record['observationId'], makeObservationId, `${label}.observationId`);
    if (isFail(observationId)) return observationId;
    const cycleId = decodeEffectId(record['cycleId'], makeCycleId, `${label}.cycleId`);
    if (isFail(cycleId)) return cycleId;
    const localDate = date('localDate');
    if (isFail(localDate)) return localDate;
    const amount = money('amount');
    if (isFail(amount)) return amount;
    if (record['movementKind'] !== 'expense' && record['movementKind'] !== 'inflow' && record['movementKind'] !== 'return') {
      return fail(PORTABILITY_REASON.malformedRecord, `${label}.movementKind is unsupported`);
    }
    return { kind, entryId, observationId, cycleId, localDate, amount, movementKind: record['movementKind'] };
  }
  if (kind === 'recurringPlanCreated' || kind === 'recurringPlanRevised') {
    const extra = kind === 'recurringPlanRevised' ? ['revisionId', 'updatedOccurrences'] : [];
    const keys = exactKeys(record, ['kind', 'planId', 'amount', 'scheduleDay', 'effectiveDate', ...extra], label);
    if (keys !== null) return keys;
    const planId = decodeEffectId(record['planId'], makePlanId, `${label}.planId`);
    if (isFail(planId)) return planId;
    const amount = money('amount');
    if (isFail(amount)) return amount;
    const scheduleDay = requireSafeInteger(record['scheduleDay'], `${label}.scheduleDay`, 1);
    if (typeof scheduleDay !== 'number') return scheduleDay;
    const effectiveDate = date('effectiveDate');
    if (isFail(effectiveDate)) return effectiveDate;
    if (kind === 'recurringPlanCreated') return { kind, planId, amount, scheduleDay, effectiveDate };
    const revisionId = decodeEffectId(record['revisionId'], makeEntryId, `${label}.revisionId`);
    if (isFail(revisionId)) return revisionId;
    const updatedOccurrences = requireSafeInteger(record['updatedOccurrences'], `${label}.updatedOccurrences`, 0);
    if (typeof updatedOccurrences !== 'number') return updatedOccurrences;
    return { kind, planId, revisionId, effectiveDate, amount, scheduleDay, updatedOccurrences };
  }
  if (kind === 'planOccurrencesMaterialized') {
    const keys = exactKeys(record, ['kind', 'planId', 'occurrenceIds'], label);
    if (keys !== null) return keys;
    const planId = decodeEffectId(record['planId'], makePlanId, `${label}.planId`);
    if (isFail(planId)) return planId;
    if (!Array.isArray(record['occurrenceIds'])) return fail(PORTABILITY_REASON.malformedRecord, `${label}.occurrenceIds is not an array`);
    const occurrenceIds = [];
    for (const item of record['occurrenceIds']) {
      const id = decodeEffectId(item, makeOccurrenceId, `${label}.occurrenceIds`);
      if (isFail(id)) return id;
      occurrenceIds.push(id);
    }
    return { kind, planId, occurrenceIds };
  }
  if (kind === 'planOccurrenceDetached') {
    const keys = exactKeys(record, ['kind', 'occurrenceId'], label);
    if (keys !== null) return keys;
    const occurrenceId = decodeEffectId(record['occurrenceId'], makeOccurrenceId, `${label}.occurrenceId`);
    if (isFail(occurrenceId)) return occurrenceId;
    return { kind, occurrenceId };
  }
  if (kind === 'planOccurrenceReserved') {
    const keys = exactKeys(record, ['kind', 'occurrenceId', 'obligationId', 'expectedAmount'], label);
    if (keys !== null) return keys;
    const occurrenceId = decodeEffectId(record['occurrenceId'], makeOccurrenceId, `${label}.occurrenceId`);
    if (isFail(occurrenceId)) return occurrenceId;
    const obligationId = decodeEffectId(record['obligationId'], makeObligationId, `${label}.obligationId`);
    if (isFail(obligationId)) return obligationId;
    const expectedAmount = money('expectedAmount');
    if (isFail(expectedAmount)) return expectedAmount;
    return { kind, occurrenceId, obligationId, expectedAmount };
  }
  if (kind === 'bookSettingsUpdated') {
    const keys = exactKeys(record, ['kind', 'effectiveDate'], label);
    if (keys !== null) return keys;
    const effectiveDate = date('effectiveDate');
    if (isFail(effectiveDate)) return effectiveDate;
    return { kind, effectiveDate };
  }
  if (kind === 'openCycleRebased') {
    const keys = exactKeys(record, [
      'kind',
      'cycleId',
      'oldVersionId',
      'newVersionId',
      'oldStartDate',
      'newStartDate',
      'oldEndDateExclusive',
      'newEndDateExclusive',
      'allocationDelta',
      'carryDelta',
      'unmovedOutsideWindow',
    ], label);
    if (keys !== null) return keys;
    const cycleId = decodeEffectId(record['cycleId'], makeCycleId, `${label}.cycleId`);
    if (isFail(cycleId)) return cycleId;
    const oldVersionId = decodeEffectId(record['oldVersionId'], makeCycleVersionId, `${label}.oldVersionId`);
    if (isFail(oldVersionId)) return oldVersionId;
    const newVersionId = decodeEffectId(record['newVersionId'], makeCycleVersionId, `${label}.newVersionId`);
    if (isFail(newVersionId)) return newVersionId;
    const oldStartDate = date('oldStartDate');
    if (isFail(oldStartDate)) return oldStartDate;
    const newStartDate = date('newStartDate');
    if (isFail(newStartDate)) return newStartDate;
    const oldEndDateExclusive = date('oldEndDateExclusive');
    if (isFail(oldEndDateExclusive)) return oldEndDateExclusive;
    const newEndDateExclusive = date('newEndDateExclusive');
    if (isFail(newEndDateExclusive)) return newEndDateExclusive;
    const allocationDelta = money('allocationDelta');
    if (isFail(allocationDelta)) return allocationDelta;
    const carryDelta = money('carryDelta');
    if (isFail(carryDelta)) return carryDelta;
    const unmovedOutsideWindow = requireSafeInteger(record['unmovedOutsideWindow'], `${label}.unmovedOutsideWindow`, 0);
    if (typeof unmovedOutsideWindow !== 'number') return unmovedOutsideWindow;
    return {
      kind,
      cycleId,
      oldVersionId,
      newVersionId,
      oldStartDate,
      newStartDate,
      oldEndDateExclusive,
      newEndDateExclusive,
      allocationDelta,
      carryDelta,
      unmovedOutsideWindow,
    };
  }
  if (kind === 'cycleClosed') {
    const keys = exactKeys(record, ['kind', 'cycleId', 'versionId', 'settlementId', 'availability'], label);
    if (keys !== null) return keys;
    const cycleId = decodeEffectId(record['cycleId'], makeCycleId, `${label}.cycleId`);
    if (isFail(cycleId)) return cycleId;
    const versionId = decodeEffectId(record['versionId'], makeCycleVersionId, `${label}.versionId`);
    if (isFail(versionId)) return versionId;
    const settlementId = decodeEffectId(record['settlementId'], makeSettlementId, `${label}.settlementId`);
    if (isFail(settlementId)) return settlementId;
    const availability = money('availability');
    if (isFail(availability)) return availability;
    return { kind, cycleId, versionId, settlementId, availability };
  }
  if (kind === 'cycleRemainderDisposed') {
    const keys = exactKeys(record, ['kind', 'settlementId', 'carryId', 'dispositionKind'], label);
    if (keys !== null) return keys;
    const settlementId = decodeEffectId(record['settlementId'], makeSettlementId, `${label}.settlementId`);
    if (isFail(settlementId)) return settlementId;
    const carryId = decodeEffectId(record['carryId'], makeEntryId, `${label}.carryId`);
    if (isFail(carryId)) return carryId;
    if (
      record['dispositionKind'] !== 'carryIn' &&
      record['dispositionKind'] !== 'fundTracked' &&
      record['dispositionKind'] !== 'split' &&
      record['dispositionKind'] !== 'leaveIndependent'
    ) {
      return fail(PORTABILITY_REASON.malformedRecord, `${label}.dispositionKind is unsupported`);
    }
    return { kind, settlementId, carryId, dispositionKind: record['dispositionKind'] };
  }
  if (kind === 'cycleReopened') {
    const keys = exactKeys(record, ['kind', 'cycleId', 'reopenedSettlementId', 'newVersionId'], label);
    if (keys !== null) return keys;
    const cycleId = decodeEffectId(record['cycleId'], makeCycleId, `${label}.cycleId`);
    if (isFail(cycleId)) return cycleId;
    const reopenedSettlementId = decodeEffectId(record['reopenedSettlementId'], makeSettlementId, `${label}.reopenedSettlementId`);
    if (isFail(reopenedSettlementId)) return reopenedSettlementId;
    const newVersionId = decodeEffectId(record['newVersionId'], makeCycleVersionId, `${label}.newVersionId`);
    if (isFail(newVersionId)) return newVersionId;
    return { kind, cycleId, reopenedSettlementId, newVersionId };
  }
  if (kind === 'closedCycleCorrectionRecorded') {
    const keys = exactKeys(record, ['kind', 'entryId', 'targetCycleId', 'settlementId', 'propagation', 'deltaAmount', 'correctsEntryId', 'replacementEntryId'], label);
    if (keys !== null) return keys;
    const entryId = decodeEffectId(record['entryId'], makeEntryId, `${label}.entryId`);
    if (isFail(entryId)) return entryId;
    const targetCycleId = decodeEffectId(record['targetCycleId'], makeCycleId, `${label}.targetCycleId`);
    if (isFail(targetCycleId)) return targetCycleId;
    const settlementId = decodeEffectId(record['settlementId'], makeSettlementId, `${label}.settlementId`);
    if (isFail(settlementId)) return settlementId;
    if (record['propagation'] !== 'applied' && record['propagation'] !== 'conflicted') {
      return fail(PORTABILITY_REASON.malformedRecord, `${label}.propagation is unsupported`);
    }
    const deltaAmount = money('deltaAmount');
    if (isFail(deltaAmount)) return deltaAmount;
    const correctsEntryId = record['correctsEntryId'] === null ? null : decodeEffectId(record['correctsEntryId'], makeEntryId, `${label}.correctsEntryId`);
    if (isFail(correctsEntryId)) return correctsEntryId;
    const replacementEntryId = record['replacementEntryId'] === null ? null : decodeEffectId(record['replacementEntryId'], makeEntryId, `${label}.replacementEntryId`);
    if (isFail(replacementEntryId)) return replacementEntryId;
    return { kind, entryId, targetCycleId, settlementId, propagation: record['propagation'], deltaAmount, correctsEntryId, replacementEntryId };
  }
  if (kind === 'propagationConflictResolved') {
    const keys = exactKeys(record, ['kind', 'conflictId'], label);
    if (keys !== null) return keys;
    const conflictId = decodeEffectId(record['conflictId'], makeEntryId, `${label}.conflictId`);
    if (isFail(conflictId)) return conflictId;
    return { kind, conflictId };
  }
  return fail(PORTABILITY_REASON.malformedRecord, `${label} has unsupported effect kind`);
}

export interface DecodedPortableSnapshot {
  readonly books: readonly BookState[];
  readonly operations: readonly OperationRecord[];
  readonly outbox: readonly OutboxEnvelope[];
  readonly delivery: readonly OutboxDeliveryState[];
  readonly enqueueSequence: number;
}

export interface DecodedCheckpointStream {
  readonly streamId: ReplicationStreamId;
  readonly cursor: SyncCursor | null;
  readonly batchDigest: string | null;
  readonly applied: ReadonlyMap<string, PulledOperation>;
}

export interface DecodedCheckpoints {
  readonly scopeId: string;
  readonly streams: readonly DecodedCheckpointStream[];
}

export type SnapshotDecodeResult = { readonly ok: true; readonly snapshot: DecodedPortableSnapshot } | DecodeFailure;
export type CheckpointDecodeResult = { readonly ok: true; readonly checkpoints: DecodedCheckpoints } | DecodeFailure;

function decodeCanonicalCommand(
  text: string,
  bookId: BookId,
  expectedKind: CommandKind | null,
  label: string,
): FinanceCommand | DecodeFailure {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return fail(PORTABILITY_REASON.corruptPayload, `${label} is not JSON`);
  }
  const validated = validateFinanceCommand(parsed);
  if (!validated.ok) {
    const issue = validated.issues[0];
    return fail(
      PORTABILITY_REASON.malformedRecord,
      `${label} is not a typed P03 command${issue ? ` (${issue.path}: ${issue.problem})` : ''}`,
    );
  }
  let canonical: string;
  try {
    canonical = canonicalJson(validated.command);
  } catch {
    return fail(PORTABILITY_REASON.malformedRecord, `${label} cannot be canonicalized`);
  }
  if (canonical !== text) {
    return fail(PORTABILITY_REASON.tamperedPayload, `${label} is not in canonical form`);
  }
  if ((validated.command.bookId as string) !== (bookId as string)) {
    return fail(PORTABILITY_REASON.foreignRecord, `${label} names a foreign book`);
  }
  if (expectedKind !== null && validated.command.kind !== expectedKind) {
    return fail(PORTABILITY_REASON.journalOutboxAsymmetry, `${label} kind does not match the receipt`);
  }
  return validated.command;
}

function decodeReceipt(
  raw: unknown,
  operationId: OperationId,
  bookId: BookId,
  scopeId: string,
  deviceId: string,
  enqueueSequence: number,
): CommandReceipt | DecodeFailure {
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, 'operation receipt is not an object');
  if (record['schemaVersion'] !== SYNC_RECORD_SCHEMA_VERSION) {
    return fail(PORTABILITY_REASON.incompatibleVersion, 'receipt schema version is unsupported');
  }
  if (record['handlerClockVersion'] !== HANDLER_CLOCK_PROVENANCE_VERSION) {
    return fail(PORTABILITY_REASON.incompatibleVersion, 'legacy receipt without versioned handler-clock provenance is unsupported');
  }
  const keys = exactKeys(record, RECEIPT_KEYS, 'operation receipt');
  if (keys !== null) return keys;
  if (record['operationId'] !== (operationId as string)) {
    return fail(PORTABILITY_REASON.invalidReference, 'receipt operationId does not match the journal record');
  }
  if (record['bookId'] !== (bookId as string)) {
    return fail(PORTABILITY_REASON.invalidReference, 'receipt bookId does not match the journal record');
  }
  if (record['scopeId'] !== scopeId) return fail(PORTABILITY_REASON.foreignRecord, 'receipt scope does not match the journal record');
  if (record['sourceDeviceId'] !== deviceId) {
    return fail(PORTABILITY_REASON.foreignRecord, 'receipt device does not match the journal record');
  }
  if (record['enqueueSequence'] !== enqueueSequence) {
    return fail(PORTABILITY_REASON.journalOutboxAsymmetry, 'receipt enqueueSequence does not match the journal record');
  }
  const kindText = requireString(record['commandKind'], 'receipt.commandKind');
  if (typeof kindText !== 'string') return kindText;
  if (!COMMAND_KINDS.has(kindText as CommandKind)) {
    return fail(PORTABILITY_REASON.malformedRecord, 'receipt.commandKind is unsupported');
  }
  const revisionBefore = requireSafeInteger(record['revisionBefore'], 'receipt.revisionBefore', 0);
  if (typeof revisionBefore !== 'number') return revisionBefore;
  const revisionAfter = requireSafeInteger(record['revisionAfter'], 'receipt.revisionAfter', 1);
  if (typeof revisionAfter !== 'number') return revisionAfter;
  if (revisionAfter !== revisionBefore + 1) {
    return fail(PORTABILITY_REASON.revisionConflict, 'receipt must advance exactly one revision');
  }
  const committedAtInstantMs = requireRepresentableInstant(record['committedAtInstantMs'], 'receipt.committedAtInstantMs');
  if (typeof committedAtInstantMs !== 'number') return committedAtInstantMs;
  const canonicalDigest = requireString(record['canonicalDigest'], 'receipt.canonicalDigest');
  if (typeof canonicalDigest !== 'string') return canonicalDigest;
  if (!CANONICAL_DIGEST_PATTERN.test(canonicalDigest)) {
    return fail(PORTABILITY_REASON.malformedRecord, 'receipt.canonicalDigest is not a canonical digest');
  }
  const calculationVersion = requireString(record['calculationVersion'], 'receipt.calculationVersion');
  if (typeof calculationVersion !== 'string') return calculationVersion;
  const effects = decodeArray(record['effects'], 'receipt.effects', (item, index) => decodeCommandEffect(item, `receipt.effects[${index}]`));
  if (isFail(effects)) return effects;
  const handlerClockInstants = decodeArray(
    record['handlerClockInstants'],
    'receipt.handlerClockInstants',
    (item, index) => requireRepresentableInstant(item, `receipt.handlerClockInstants[${index}]`),
  );
  if (isFail(handlerClockInstants)) return handlerClockInstants;
  const scope = makeRepositoryScopeId(scopeId);
  const device = makeDeviceId(deviceId);
  if (!scope.ok || !device.ok) return fail(PORTABILITY_REASON.invalidReference, 'receipt provenance is invalid');
  return {
    operationId,
    commandKind: kindText as CommandKind,
    bookId,
    revisionBefore,
    revisionAfter,
    committedAtInstantMs,
    canonicalDigest,
    calculationVersion,
    effects,
    handlerClockInstants,
    handlerClockVersion: HANDLER_CLOCK_PROVENANCE_VERSION,
    schemaVersion: SYNC_RECORD_SCHEMA_VERSION,
    scopeId: scope.value,
    sourceDeviceId: device.value,
    enqueueSequence,
  };
}

function decodeOperation(raw: unknown, bound: PortableScope, bookIds: ReadonlySet<string>): OperationRecord | DecodeFailure {
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, 'operation is not an object');
  if (record['schemaVersion'] !== SYNC_RECORD_SCHEMA_VERSION) {
    return fail(PORTABILITY_REASON.incompatibleVersion, 'operation schema version is unsupported');
  }
  if (record['handlerClockVersion'] !== HANDLER_CLOCK_PROVENANCE_VERSION) {
    return fail(PORTABILITY_REASON.incompatibleVersion, 'legacy operation without versioned handler-clock provenance is unsupported');
  }
  const keys = exactKeys(record, OPERATION_KEYS, 'operation');
  if (keys !== null) return keys;
  const operationId = makeOperationId(record['operationId']);
  if (!operationId.ok) return fail(PORTABILITY_REASON.invalidReference, operationId.failure.detail);
  const bookId = makeBookId(record['bookId']);
  if (!bookId.ok) return fail(PORTABILITY_REASON.invalidReference, bookId.failure.detail);
  if (!bookIds.has(bookId.value as string)) return fail(PORTABILITY_REASON.foreignRecord, `operation ${operationId.value} names an unknown book`);
  if (record['scopeId'] !== bound.scopeId) return fail(PORTABILITY_REASON.foreignRecord, `operation ${operationId.value} is bound to a foreign scope`);
  const scope = makeRepositoryScopeId(record['scopeId']);
  const device = makeDeviceId(record['sourceDeviceId']);
  if (!scope.ok || !device.ok) return fail(PORTABILITY_REASON.invalidReference, 'operation provenance is invalid');
  const enqueueSequence = requireSafeInteger(record['enqueueSequence'], 'operation.enqueueSequence', 1);
  if (typeof enqueueSequence !== 'number') return enqueueSequence;
  const committedAtInstantMs = requireRepresentableInstant(record['committedAtInstantMs'], 'operation.committedAtInstantMs');
  if (typeof committedAtInstantMs !== 'number') return committedAtInstantMs;
  const handlerClockInstants = decodeArray(
    record['handlerClockInstants'],
    'operation.handlerClockInstants',
    (item, index) => requireRepresentableInstant(item, `operation.handlerClockInstants[${index}]`),
  );
  if (isFail(handlerClockInstants)) return handlerClockInstants;
  const canonicalCommand = requireString(record['canonicalCommand'], 'operation.canonicalCommand');
  if (typeof canonicalCommand !== 'string') return canonicalCommand;
  const receipt = decodeReceipt(record['receipt'], operationId.value, bookId.value, bound.scopeId, device.value as string, enqueueSequence);
  if (isFail(receipt)) return receipt;
  if (receipt.handlerClockVersion !== record['handlerClockVersion']) {
    return fail(PORTABILITY_REASON.tamperedPayload, `operation ${operationId.value} handler clock version does not match its receipt`);
  }
  if (
    handlerClockInstants.length !== (receipt.handlerClockInstants?.length ?? -1) ||
    handlerClockInstants.some((instantMs, index) => instantMs !== receipt.handlerClockInstants?.[index])
  ) {
    return fail(PORTABILITY_REASON.tamperedPayload, `operation ${operationId.value} handler clock trace does not match its receipt`);
  }
  const command = decodeCanonicalCommand(canonicalCommand, bookId.value, receipt.commandKind, 'operation.canonicalCommand');
  if (isFail(command)) return command;
  if (receipt.canonicalDigest !== stableDigest(canonicalCommand)) {
    return fail(PORTABILITY_REASON.tamperedPayload, `operation ${operationId.value} digest does not match canonicalCommand`);
  }
  return {
    operationId: operationId.value,
    bookId: bookId.value,
    canonicalCommand,
    receipt,
    committedAtInstantMs,
    handlerClockInstants,
    handlerClockVersion: HANDLER_CLOCK_PROVENANCE_VERSION,
    schemaVersion: SYNC_RECORD_SCHEMA_VERSION,
    scopeId: scope.value,
    sourceDeviceId: device.value,
    enqueueSequence,
  };
}

function decodeOutbox(raw: unknown, bound: PortableScope, operation: OperationRecord): OutboxEnvelope | DecodeFailure {
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, 'outbox envelope is not an object');
  const keys = exactKeys(record, OUTBOX_KEYS, 'outbox envelope');
  if (keys !== null) return keys;
  if (record['schemaVersion'] !== SYNC_RECORD_SCHEMA_VERSION) {
    return fail(PORTABILITY_REASON.incompatibleVersion, 'outbox schema version is unsupported');
  }
  if (record['status'] !== 'pending') return fail(PORTABILITY_REASON.malformedRecord, 'outbox status must be pending');
  if (record['operationId'] !== (operation.operationId as string)) {
    return fail(PORTABILITY_REASON.invalidReference, 'outbox operationId does not match the journal');
  }
  if (record['bookId'] !== (operation.bookId as string)) {
    return fail(PORTABILITY_REASON.invalidReference, 'outbox bookId does not match the journal');
  }
  if (record['enqueueSequence'] !== operation.enqueueSequence) {
    return fail(PORTABILITY_REASON.journalOutboxAsymmetry, 'outbox enqueueSequence does not match the journal');
  }
  if (record['scopeId'] !== bound.scopeId || record['sourceDeviceId'] !== bound.deviceId) {
    return fail(PORTABILITY_REASON.foreignRecord, `outbox ${operation.operationId as string} is bound to a foreign identity`);
  }
  const kind = requireString(record['commandKind'], 'outbox.commandKind');
  if (typeof kind !== 'string') return kind;
  if (kind !== operation.receipt.commandKind) {
    return fail(PORTABILITY_REASON.journalOutboxAsymmetry, 'outbox commandKind does not match the receipt');
  }
  const revisionAfter = requireSafeInteger(record['revisionAfter'], 'outbox.revisionAfter', 1);
  if (typeof revisionAfter !== 'number') return revisionAfter;
  if (revisionAfter !== operation.receipt.revisionAfter) {
    return fail(PORTABILITY_REASON.revisionConflict, 'outbox revisionAfter does not match the receipt');
  }
  const canonicalDigest = requireString(record['canonicalDigest'], 'outbox.canonicalDigest');
  if (typeof canonicalDigest !== 'string') return canonicalDigest;
  if (canonicalDigest !== operation.receipt.canonicalDigest) {
    return fail(PORTABILITY_REASON.journalOutboxAsymmetry, 'outbox digest does not match the journal');
  }
  const createdAtInstantMs = requireRepresentableInstant(record['createdAtInstantMs'], 'outbox.createdAtInstantMs');
  if (typeof createdAtInstantMs !== 'number') return createdAtInstantMs;
  const outboxId = requireString(record['outboxId'], 'outbox.outboxId');
  if (typeof outboxId !== 'string') return outboxId;
  return {
    outboxId,
    operationId: operation.operationId,
    bookId: operation.bookId,
    commandKind: kind as CommandKind,
    revisionAfter,
    canonicalDigest,
    createdAtInstantMs,
    status: 'pending',
    schemaVersion: SYNC_RECORD_SCHEMA_VERSION,
    scopeId: operation.scopeId,
    sourceDeviceId: operation.sourceDeviceId,
    enqueueSequence: operation.enqueueSequence,
  };
}

function decodeDelivery(raw: unknown, envelope: OutboxEnvelope): OutboxDeliveryState | DecodeFailure {
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, 'delivery state is not an object');
  const keys = exactKeys(record, DELIVERY_KEYS, 'delivery state');
  if (keys !== null) return keys;
  if (record['schemaVersion'] !== SYNC_RECORD_SCHEMA_VERSION) {
    return fail(PORTABILITY_REASON.incompatibleVersion, 'delivery schema version is unsupported');
  }
  if (record['operationId'] !== (envelope.operationId as string)) {
    return fail(PORTABILITY_REASON.invalidReference, 'delivery operationId does not match the outbox');
  }
  if (record['outboxId'] !== envelope.outboxId) {
    return fail(PORTABILITY_REASON.invalidReference, 'delivery outboxId does not match the outbox');
  }
  const version = requireSafeInteger(record['version'], 'delivery.version', 0);
  if (typeof version !== 'number') return version;
  const attempts = requireSafeInteger(record['attempts'], 'delivery.attempts', 0);
  if (typeof attempts !== 'number') return attempts;
  if (record['acknowledged'] !== true && record['acknowledged'] !== false) {
    return fail(PORTABILITY_REASON.malformedRecord, 'delivery.acknowledged must be boolean');
  }
  const lastError = record['lastError'];
  if (lastError !== null && typeof lastError !== 'string') {
    return fail(PORTABILITY_REASON.malformedRecord, 'delivery.lastError must be string or null');
  }
  const leaseHolder = record['leaseHolder'];
  if (leaseHolder !== null && typeof leaseHolder !== 'string') {
    return fail(PORTABILITY_REASON.malformedRecord, 'delivery.leaseHolder must be string or null');
  }
  const leaseExpiresAtMs = requireNullableRepresentableInstant(record['leaseExpiresAtMs'], 'delivery.leaseExpiresAtMs');
  if (leaseExpiresAtMs !== null && typeof leaseExpiresAtMs !== 'number') return leaseExpiresAtMs;
  const nextRetryAtMs = requireNullableRepresentableInstant(record['nextRetryAtMs'], 'delivery.nextRetryAtMs');
  if (nextRetryAtMs !== null && typeof nextRetryAtMs !== 'number') return nextRetryAtMs;
  return {
    schemaVersion: SYNC_RECORD_SCHEMA_VERSION,
    outboxId: envelope.outboxId,
    operationId: envelope.operationId,
    version,
    attempts,
    lastError: lastError as string | null,
    leaseHolder: leaseHolder as string | null,
    leaseExpiresAtMs: leaseExpiresAtMs as number | null,
    acknowledged: record['acknowledged'] as boolean,
    nextRetryAtMs: nextRetryAtMs as number | null,
  };
}

function decodePulledOperation(raw: unknown, bound: PortableScope, bookIds: ReadonlySet<string>): PulledOperation | DecodeFailure {
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.malformedRecord, 'applied checkpoint record is not an object');
  const keys = exactKeys(record, PULLED_KEYS, 'applied checkpoint record');
  if (keys !== null) return keys;
  if (record['schemaVersion'] !== SYNC_CURSOR_SCHEMA_VERSION) {
    return fail(PORTABILITY_REASON.incompatibleVersion, 'applied operation schema version is unsupported');
  }
  const operationId = makeOperationId(record['operationId']);
  if (!operationId.ok) return fail(PORTABILITY_REASON.invalidReference, operationId.failure.detail);
  const bookId = makeBookId(record['bookId']);
  if (!bookId.ok) return fail(PORTABILITY_REASON.invalidReference, bookId.failure.detail);
  if (!bookIds.has(bookId.value as string)) return fail(PORTABILITY_REASON.foreignRecord, 'applied operation names an unknown book');
  if (record['scopeId'] !== bound.scopeId) return fail(PORTABILITY_REASON.foreignRecord, 'applied operation is bound to a foreign scope');
  const scope = makeRepositoryScopeId(record['scopeId']);
  const device = makeDeviceId(record['sourceDeviceId']);
  if (!scope.ok || !device.ok) return fail(PORTABILITY_REASON.invalidReference, 'applied operation provenance is invalid');
  const sequence = requireSafeInteger(record['sequence'], 'applied.sequence', 0);
  if (typeof sequence !== 'number') return sequence;
  const baseRevision = requireSafeInteger(record['baseRevision'], 'applied.baseRevision', 0);
  if (typeof baseRevision !== 'number') return baseRevision;
  const resultingRevision = requireSafeInteger(record['resultingRevision'], 'applied.resultingRevision', 1);
  if (typeof resultingRevision !== 'number') return resultingRevision;
  if (resultingRevision !== baseRevision + 1) {
    return fail(PORTABILITY_REASON.revisionConflict, 'applied operation must advance exactly one revision');
  }
  const sourceEnqueueSequence = requireSafeInteger(record['sourceEnqueueSequence'], 'applied.sourceEnqueueSequence', 1);
  if (typeof sourceEnqueueSequence !== 'number') return sourceEnqueueSequence;
  const canonicalCommand = requireString(record['canonicalCommand'], 'applied.canonicalCommand');
  if (typeof canonicalCommand !== 'string') return canonicalCommand;
  const canonicalDigest = requireString(record['canonicalDigest'], 'applied.canonicalDigest');
  if (typeof canonicalDigest !== 'string') return canonicalDigest;
  if (canonicalDigest !== stableDigest(canonicalCommand)) {
    return fail(PORTABILITY_REASON.tamperedPayload, 'applied operation digest does not match canonicalCommand');
  }
  const command = decodeCanonicalCommand(canonicalCommand, bookId.value, null, 'applied.canonicalCommand');
  if (isFail(command)) return command;
  return {
    operationId: operationId.value,
    sequence,
    scopeId: scope.value,
    bookId: bookId.value,
    baseRevision,
    resultingRevision,
    canonicalCommand,
    canonicalDigest,
    sourceDeviceId: device.value,
    sourceEnqueueSequence,
    schemaVersion: SYNC_CURSOR_SCHEMA_VERSION,
  };
}

export function decodePortableSnapshot(raw: unknown, bound: PortableScope): SnapshotDecodeResult {
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.corruptPayload, 'snapshot is not an object');
  for (const key of Object.keys(record)) {
    if (!['books', 'operations', 'outbox', 'delivery', 'enqueueSequence'].includes(key)) {
      return fail(PORTABILITY_REASON.malformedRecord, `snapshot has unknown field ${key}`);
    }
  }
  if (!Array.isArray(record['books']) || !Array.isArray(record['operations']) || !Array.isArray(record['outbox']) || !Array.isArray(record['delivery'])) {
    return fail(PORTABILITY_REASON.corruptPayload, 'snapshot collections are missing');
  }
  const enqueueSequence = requireSafeInteger(record['enqueueSequence'], 'enqueueSequence', 0);
  if (typeof enqueueSequence !== 'number') return enqueueSequence;
  const books: BookState[] = [];
  const bookIds = new Set<string>();
  for (const item of record['books']) {
    const book = decodeBookState(item);
    if (isFail(book)) return book;
    const id = book.book.id as string;
    if (bookIds.has(id)) return fail(PORTABILITY_REASON.duplicateId, `duplicate book id ${id}`);
    bookIds.add(id);
    books.push(book);
  }
  const operations: OperationRecord[] = [];
  const operationById = new Map<string, OperationRecord>();
  for (const item of record['operations']) {
    const decoded = decodeOperation(item, bound, bookIds);
    if (isFail(decoded)) return decoded;
    const id = decoded.operationId as string;
    if (operationById.has(id)) return fail(PORTABILITY_REASON.duplicateId, `duplicate operation id ${id}`);
    operationById.set(id, decoded);
    operations.push(decoded);
  }
  const outbox: OutboxEnvelope[] = [];
  const outboxByOperationId = new Map<string, OutboxEnvelope>();
  const outboxIds = new Set<string>();
  for (const item of record['outbox']) {
    const row = asRecord(item);
    const id = typeof row?.['operationId'] === 'string' ? row['operationId'] : '';
    const operation = operationById.get(id);
    if (operation === undefined) return fail(PORTABILITY_REASON.journalOutboxAsymmetry, `outbox ${id} is missing from the journal`);
    const decoded = decodeOutbox(item, bound, operation);
    if (isFail(decoded)) return decoded;
    if (outboxByOperationId.has(id)) return fail(PORTABILITY_REASON.duplicateId, `duplicate outbox operation ${id}`);
    if (outboxIds.has(decoded.outboxId)) {
      return fail(PORTABILITY_REASON.duplicateId, `duplicate outboxId ${decoded.outboxId}`);
    }
    outboxIds.add(decoded.outboxId);
    outboxByOperationId.set(id, decoded);
    outbox.push(decoded);
  }
  const delivery: OutboxDeliveryState[] = [];
  const deliveryIds = new Set<string>();
  const deliveryOutboxIds = new Set<string>();
  for (const item of record['delivery']) {
    const row = asRecord(item);
    const id = typeof row?.['operationId'] === 'string' ? row['operationId'] : '';
    const envelope = outboxByOperationId.get(id);
    if (envelope === undefined) return fail(PORTABILITY_REASON.orphanRecord, `delivery ${id} has no outbox envelope`);
    if (deliveryIds.has(id)) return fail(PORTABILITY_REASON.duplicateId, `duplicate delivery id ${id}`);
    const decoded = decodeDelivery(item, envelope);
    if (isFail(decoded)) return decoded;
    if (deliveryOutboxIds.has(decoded.outboxId)) {
      return fail(PORTABILITY_REASON.duplicateId, `duplicate delivery outboxId ${decoded.outboxId}`);
    }
    deliveryIds.add(id);
    deliveryOutboxIds.add(decoded.outboxId);
    delivery.push(decoded);
  }
  return { ok: true, snapshot: { books, operations, outbox, delivery, enqueueSequence } };
}

export function decodePortableCheckpoints(
  raw: unknown,
  bound: PortableScope,
  bookIds: ReadonlySet<string>,
): CheckpointDecodeResult {
  const record = asRecord(raw);
  if (record === null) return fail(PORTABILITY_REASON.corruptPayload, 'checkpoint snapshot is not an object');
  for (const key of Object.keys(record)) {
    if (!['scopeId', 'streams'].includes(key)) {
      return fail(PORTABILITY_REASON.malformedRecord, `checkpoint snapshot has unknown field ${key}`);
    }
  }
  const scopeId = requireString(record['scopeId'], 'checkpoint.scopeId');
  if (typeof scopeId !== 'string') return scopeId;
  if (scopeId !== bound.scopeId) return fail(PORTABILITY_REASON.foreignRecord, 'checkpoint scope does not match the document');
  const madeScope = makeRepositoryScopeId(scopeId);
  if (!madeScope.ok) return fail(PORTABILITY_REASON.invalidReference, madeScope.failure.detail);
  if (!Array.isArray(record['streams'])) return fail(PORTABILITY_REASON.corruptPayload, 'checkpoint streams are missing');
  const streams: DecodedCheckpointStream[] = [];
  const streamIds = new Set<string>();
  for (const item of record['streams']) {
    const row = asRecord(item);
    if (row === null) return fail(PORTABILITY_REASON.malformedRecord, 'checkpoint stream is not an object');
    const streamKeys = exactKeys(row, STREAM_KEYS, 'checkpoint stream');
    if (streamKeys !== null) return streamKeys;
    const streamId = makeReplicationStreamId(row['streamId']);
    if (!streamId.ok) return fail(PORTABILITY_REASON.invalidReference, streamId.failure.detail);
    if (streamIds.has(streamId.value as string)) {
      return fail(PORTABILITY_REASON.duplicateId, `duplicate checkpoint stream ${streamId.value as string}`);
    }
    streamIds.add(streamId.value as string);
    let cursor: SyncCursor | null = null;
    if (row['cursor'] !== null) {
      const made = makeSyncCursor(row['cursor']);
      if (!made.ok) return fail(PORTABILITY_REASON.invalidReference, made.failure.detail);
      cursor = made.value;
    }
    const batchDigest = row['batchDigest'];
    if (batchDigest !== null && (typeof batchDigest !== 'string' || !CANONICAL_DIGEST_PATTERN.test(batchDigest))) {
      return fail(PORTABILITY_REASON.malformedRecord, 'checkpoint batchDigest must be a canonical digest or null');
    }
    if (!Array.isArray(row['applied'])) return fail(PORTABILITY_REASON.malformedRecord, 'checkpoint applied is not an array');
    const applied = new Map<string, PulledOperation>();
    for (const appliedRow of row['applied']) {
      const decoded = decodePulledOperation(appliedRow, bound, bookIds);
      if (isFail(decoded)) return decoded;
      const id = decoded.operationId as string;
      if (applied.has(id)) return fail(PORTABILITY_REASON.duplicateId, `duplicate applied operation ${id}`);
      applied.set(id, decoded);
    }
    streams.push({
      streamId: streamId.value,
      cursor,
      batchDigest: batchDigest as string | null,
      applied,
    });
  }
  return { ok: true, checkpoints: { scopeId, streams } };
}
