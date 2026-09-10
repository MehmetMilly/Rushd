/**
 * Pure repository-snapshot graph validation.
 *
 * Structural unknown-to-typed decoding lives in P04 portability decoders.
 * This pass owns reference resolution, record semantics, journal/state
 * revision coherence, local-versus-remote provenance, exact receipt-effect
 * correspondence, and money-field policy. Collections are indexed once; the
 * first stable path wins.
 */

import { compareCivilDates } from '../primitives/civil-date';
import {
  isRepresentableInstantMs,
  isValidWallTime,
  resolveCivilDateTime,
  type TimeZoneName,
} from '../primitives/instant';
import { monthlyCycleContaining, type MonthlyCycleAnchor } from '../primitives/monthly-cycle';
import { addMoney, subtractMoney, type Money } from '../primitives/money';
import { canonicalJson } from './canonical';
import {
  HANDLER_CLOCK_PROVENANCE_VERSION,
  SYNC_RECORD_SCHEMA_VERSION,
  type CommandEffect,
  type CommandKind,
  type FinanceCommand,
  type OperationRecord,
  type OutboxDeliveryState,
  type OutboxEnvelope,
} from './commands';
import { composeCycleId } from './identity';
import type {
  AllocationRecord,
  BookSettingsRevision,
  BookState,
  CarryAction,
  ConflictResolution,
  CycleRecord,
  CycleSettlement,
  GoalRecord,
  LedgerEntry,
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
} from './ledger';
import type { PulledOperation } from '../sync/cursors';
import { dispatchApply, type HandlerRefs } from '../../application/commands/handlers';
import type { CommandContext } from '../../application/commands/context';
import { validateFinanceCommand } from '../../application/commands/validation';

export const CANONICAL_DIGEST_PATTERN = /^[0-9a-f]{16}$/;

/**
 * Field-by-field money sign/equality policy for stored rows and receipt
 * effects. Ordinary movements, obligation expected amounts, goal targets,
 * allocation movements, plan amounts, and carry-disposition amounts are
 * strictly positive. Pools, buffers, observed pools, settlement starting
 * funds, and reserved commitments are non-negative. Reversal amounts must
 * be the exact inverse of their target. Reconciliation, propagation,
 * rebase deltas, Reality Check adjustments, and the named settlement
 * components below remain signed. A closed settlement's `availability`
 * must equal the stored identity
 * `startingFunds + carryIn + netInflows + netReturns - netOutflows
 * - reservedCommitments - netAllocations - buffer + netAdjustments`.
 */
export const MONEY_FIELD_POLICY = Object.freeze({
  positive: Object.freeze([
    'entry.amount[inflow|expense|expenseReturn]',
    'obligation.expectedAmount',
    'goal.targetAmount',
    'allocation.change.amount[funding|assignment|unassignment|release]',
    'planRevision.amount',
    'carry.disposition.amount[carryIn|fundTracked]',
    'carry.disposition.carryAmount|fundAmount[split]',
    'effect.amount[inflowRecorded|expenseRecorded|expenseReturnRecorded|allocation*|recurringPlan*|planOccurrenceReserved]',
  ]),
  nonNegative: Object.freeze([
    'cycle.startingFunds',
    'cycle.boundaryObservedPool',
    'buffer.amount',
    'observation.observedPool',
    'settlement.startingFunds',
    'settlement.reservedCommitments',
    'settlement.buffer',
    'effect.startingFunds|observedPool|bufferSet.amount',
  ]),
  signed: Object.freeze([
    'entry.amount[inflowReversal|expenseReversal|expenseReturnReversal]',
    'adjustment.amount',
    'propagationDelta.deltaAmount',
    'propagationConflict.unpropagatedAmount',
    'settlement.netInflows',
    'settlement.netOutflows',
    'settlement.netReturns',
    'settlement.netAdjustments',
    'settlement.carryIn',
    'settlement.netAllocations',
    'settlement.availability',
    'effect.releasedResidual|reinstatedResidual|adjustmentAmount|allocationDelta|carryDelta|deltaAmount|availability',
  ]),
  settlementIdentity:
    'availability = startingFunds + carryIn + netInflows + netReturns - netOutflows - reservedCommitments - netAllocations - buffer + netAdjustments',
});

export type RepositorySnapshotGraphReason =
  | 'malformed-record'
  | 'invalid-reference'
  | 'orphan-record'
  | 'duplicate-id'
  | 'foreign-record'
  | 'revision-idempotency-conflict'
  | 'journal-outbox-asymmetry'
  | 'tampered-payload';

export interface RepositorySnapshotGraphIssue {
  readonly path: string;
  readonly reason: RepositorySnapshotGraphReason;
  readonly detail: string;
}

export interface CheckpointStreamInput {
  readonly streamId: string;
  readonly cursor: string | null;
  readonly batchDigest: string | null;
  readonly applied: ReadonlyMap<string, PulledOperation> | readonly PulledOperation[];
}

export interface RepositorySnapshotGraphInput {
  readonly books: readonly BookState[];
  readonly operations: readonly OperationRecord[];
  readonly outbox: readonly OutboxEnvelope[];
  readonly delivery: readonly OutboxDeliveryState[];
  readonly enqueueSequence: number;
  readonly localDeviceId: string;
  readonly checkpoints: {
    readonly scopeId: string;
    readonly streams: readonly CheckpointStreamInput[];
  };
  readonly exportedAtMs?: number;
}

export type RepositorySnapshotGraphResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issue: RepositorySnapshotGraphIssue };

interface ProvenanceClaim {
  readonly operationId: string;
  readonly effectKind: CommandEffect['kind'];
  readonly bookId: string;
  readonly revisionBefore: number;
  readonly revisionAfter: number;
}

interface BookIndex {
  readonly state: BookState;
  readonly cyclesById: Map<string, CycleRecord[]>;
  readonly versions: Map<string, CycleRecord>;
  readonly entries: Map<string, LedgerEntry>;
  readonly obligations: Map<string, ObligationRecord>;
  readonly events: Map<string, ObligationEvent>;
  readonly goals: Map<string, GoalRecord>;
  readonly allocations: Map<string, AllocationRecord>;
  readonly observations: Map<string, RealityCheckObservation>;
  readonly adjustments: Map<string, ReconciliationAdjustment>;
  readonly recovery: Map<string, RecoveryLink>;
  readonly plans: Map<string, RecurringPlan>;
  readonly planRevisions: Map<string, PlanRevision>;
  readonly occurrences: Map<string, PlanOccurrence>;
  readonly settings: Map<string, BookSettingsRevision>;
  readonly settlements: Map<string, CycleSettlement>;
  readonly carry: Map<string, CarryAction>;
  readonly deltas: Map<string, PropagationDelta>;
  readonly conflicts: Map<string, PropagationConflict>;
  readonly resolutions: Map<string, ConflictResolution>;
}

function fail(path: string, reason: RepositorySnapshotGraphReason, detail: string): RepositorySnapshotGraphResult {
  return { ok: false, issue: { path, reason, detail } };
}

function asAppliedList(applied: CheckpointStreamInput['applied']): PulledOperation[] {
  if (Array.isArray(applied)) return [...applied];
  return [...applied.values()];
}

function moneyEq(left: Money, right: Money): boolean {
  return left.currency === right.currency && left.minorUnits === right.minorUnits;
}

function anchorEq(left: MonthlyCycleAnchor, right: MonthlyCycleAnchor): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'firstOfMonth' && right.kind === 'firstOfMonth') return true;
  return left.kind === 'payday' && right.kind === 'payday' && left.dayOfMonth === right.dayOfMonth;
}

function asMoney(value: unknown): Money | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as { currency?: unknown; minorUnits?: unknown };
  if (record.currency !== 'SAR' && record.currency !== 'USD' && record.currency !== 'JPY' && record.currency !== 'KWD') {
    return null;
  }
  if (typeof record.minorUnits !== 'number' || !Number.isSafeInteger(record.minorUnits)) return null;
  return { currency: record.currency, minorUnits: record.minorUnits };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function positive(money: Money, path: string): RepositorySnapshotGraphResult | null {
  if (money.minorUnits <= 0) return fail(path, 'malformed-record', `${path} must be strictly positive`);
  return null;
}

function nonNegative(money: Money, path: string): RepositorySnapshotGraphResult | null {
  if (money.minorUnits < 0) return fail(path, 'malformed-record', `${path} must be non-negative`);
  return null;
}

function instant(value: number | null | undefined, path: string): RepositorySnapshotGraphResult | null {
  if (value === null || value === undefined) return null;
  if (!isRepresentableInstantMs(value)) return fail(path, 'malformed-record', `${path} is outside the representable instant range`);
  return null;
}

function inverse(reversal: Money, target: Money, path: string): RepositorySnapshotGraphResult | null {
  if (reversal.currency !== target.currency || reversal.minorUnits !== -target.minorUnits) {
    return fail(path, 'malformed-record', `${path} must be the exact inverse of its target`);
  }
  return null;
}

function moneyMismatch(path: string, label: string): RepositorySnapshotGraphResult {
  return fail(path, 'malformed-record', `${path} ${label} does not match the stored record or typed command`);
}

function allocationMovement(change: AllocationRecord['change']): Money | null {
  if (change.type === 'reversal') return null;
  return change.amount;
}

function parseCanonicalCommand(
  raw: string,
  expectedKind: CommandKind,
  path: string,
): { ok: true; value: FinanceCommand } | RepositorySnapshotGraphResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(path, 'tampered-payload', 'canonicalCommand is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail(path, 'tampered-payload', 'canonicalCommand is not an object');
  }
  const validated = validateFinanceCommand(parsed);
  if (!validated.ok) {
    return fail(path, 'tampered-payload', `canonicalCommand is not a valid finance command: ${validated.issues.map((issue) => `${issue.path} ${issue.problem}`).join('; ')}`);
  }
  const command = validated.command;
  if (command.kind !== expectedKind) {
    return fail(path, 'tampered-payload', 'canonicalCommand kind does not match the receipt');
  }
  if (canonicalJson(command) !== raw) {
    return fail(path, 'tampered-payload', 'canonicalCommand is not in canonical form');
  }
  return { ok: true, value: command };
}

function expectedEffectKinds(command: FinanceCommand): readonly (readonly CommandEffect['kind'][])[] {
  switch (command.kind) {
    case 'createBook':
      return [['bookCreated']];
    case 'openCycle':
      return [['cycleOpened']];
    case 'recordInflow':
      return [['inflowRecorded']];
    case 'reverseInflow':
      return [['inflowReversalRecorded']];
    case 'recordExpense':
    case 'recordObligationPayment':
      return [['expenseRecorded']];
    case 'correctExpense':
      return command.replacement === null ? [['expenseReversalRecorded']] : [['expenseReversalRecorded', 'expenseRecorded']];
    case 'recordExpenseReturn':
    case 'recordObligationReturn':
      return [['expenseReturnRecorded']];
    case 'correctExpenseReturn':
      return command.replacement === null
        ? [['expenseReturnReversalRecorded']]
        : [['expenseReturnReversalRecorded', 'expenseReturnRecorded']];
    case 'createObligation':
      return [['obligationCreated']];
    case 'settleObligationFinally':
      return [['obligationFinallySettled'], ['obligationFinallySettled', 'obligationDisputeResolved']];
    case 'cancelObligation':
      return [['obligationCancelled'], ['obligationCancelled', 'obligationDisputeResolved']];
    case 'reopenObligation':
      return [['obligationReopened']];
    case 'openObligationDispute':
      return [['obligationDisputeOpened']];
    case 'resolveObligationDispute':
      return [['obligationDisputeResolved']];
    case 'releaseDisputedResidual':
      return [['obligationResidualReleased']];
    case 'createGoal':
      return [['goalCreated']];
    case 'fundAllocationPool':
      return [['allocationFunded']];
    case 'assignToGoal':
      return [['allocationAssigned']];
    case 'unassignFromGoal':
      return [['allocationUnassigned']];
    case 'releaseAllocation':
      return [['allocationReleased']];
    case 'reverseAllocationRecord':
      return [['allocationRecordReversed']];
    case 'setBuffer':
      return [['bufferSet']];
    case 'openBoundaryCycle':
      return [['boundaryCycleOpened']];
    case 'recordRealityCheck':
      return [['realityCheckRecorded']];
    case 'recoverObservedActivity':
      return [['observedActivityRecovered']];
    case 'createRecurringPlan':
      return [['recurringPlanCreated']];
    case 'reviseRecurringPlan':
      return [['recurringPlanRevised']];
    case 'materializePlanOccurrences':
      return [['planOccurrencesMaterialized']];
    case 'detachPlanOccurrence':
      return [['planOccurrenceDetached']];
    case 'reservePlanOccurrence':
      return [['planOccurrenceReserved']];
    case 'updateBookSettings':
      return [['bookSettingsUpdated']];
    case 'rebaseOpenCycle':
      return [['openCycleRebased']];
    case 'closeCycle':
      return [['cycleClosed']];
    case 'disposeCycleRemainder':
      return [['cycleRemainderDisposed']];
    case 'reopenCycle':
      return [['cycleReopened']];
    case 'recordClosedCycleCorrection':
      return [['closedCycleCorrectionRecorded']];
    case 'resolvePropagationConflict':
      return [['propagationConflictResolved']];
  }
}

function kindsMatch(actual: readonly CommandEffect['kind'][], allowed: readonly (readonly CommandEffect['kind'][])[]): boolean {
  return allowed.some(
    (sequence) => sequence.length === actual.length && sequence.every((kind, index) => kind === actual[index]),
  );
}

function claimKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

function bindClaim(
  claims: Map<string, ProvenanceClaim>,
  key: string,
  claim: ProvenanceClaim,
  path: string,
): RepositorySnapshotGraphResult | null {
  const existing = claims.get(key);
  if (existing !== undefined && existing.operationId !== claim.operationId) {
    return fail(path, 'duplicate-id', `${key} is claimed by more than one operation`);
  }
  claims.set(key, claim);
  return null;
}

function indexBook(state: BookState, path: string): { ok: true; index: BookIndex } | RepositorySnapshotGraphResult {
  const entryIds = new Set<string>();
  const rememberEntry = (id: string, label: string): RepositorySnapshotGraphResult | null => {
    if (entryIds.has(id)) return fail(`${path}.${label}`, 'duplicate-id', `duplicate EntryId ${id}`);
    entryIds.add(id);
    return null;
  };
  const cyclesById = new Map<string, CycleRecord[]>();
  const versions = new Map<string, CycleRecord>();
  for (const cycle of state.cycles) {
    const versionId = cycle.versionId as string;
    if (versions.has(versionId)) return fail(`${path}.cycles`, 'duplicate-id', `duplicate cycle version ${versionId}`);
    versions.set(versionId, cycle);
    const list = cyclesById.get(cycle.cycleId as string) ?? [];
    list.push(cycle);
    cyclesById.set(cycle.cycleId as string, list);
  }
  const entries = new Map<string, LedgerEntry>();
  for (const entry of state.entries) {
    const dup = rememberEntry(entry.entryId as string, `entries.${entry.entryId as string}`);
    if (dup) return dup;
    entries.set(entry.entryId as string, entry);
  }
  const events = new Map<string, ObligationEvent>();
  for (const event of state.obligationEvents) {
    const dup = rememberEntry(event.eventId as string, `obligationEvents.${event.eventId as string}`);
    if (dup) return dup;
    events.set(event.eventId as string, event);
  }
  const adjustments = new Map<string, ReconciliationAdjustment>();
  for (const row of state.adjustments) {
    const dup = rememberEntry(row.adjustmentId as string, `adjustments.${row.adjustmentId as string}`);
    if (dup) return dup;
    adjustments.set(row.adjustmentId as string, row);
  }
  const recovery = new Map<string, RecoveryLink>();
  for (const row of state.recoveryLinks) {
    const dup = rememberEntry(row.linkId as string, `recoveryLinks.${row.linkId as string}`);
    if (dup) return dup;
    recovery.set(row.linkId as string, row);
  }
  const planRevisions = new Map<string, PlanRevision>();
  for (const row of state.planRevisions) {
    const dup = rememberEntry(row.revisionId as string, `planRevisions.${row.revisionId as string}`);
    if (dup) return dup;
    planRevisions.set(row.revisionId as string, row);
  }
  const settings = new Map<string, BookSettingsRevision>();
  for (const row of state.settingsRevisions) {
    const dup = rememberEntry(row.settingsRevisionId as string, `settingsRevisions.${row.settingsRevisionId as string}`);
    if (dup) return dup;
    settings.set(row.settingsRevisionId as string, row);
  }
  const carry = new Map<string, CarryAction>();
  for (const row of state.carryActions) {
    const dup = rememberEntry(row.carryId as string, `carryActions.${row.carryId as string}`);
    if (dup) return dup;
    carry.set(row.carryId as string, row);
  }
  const deltas = new Map<string, PropagationDelta>();
  for (const row of state.propagationDeltas) {
    const dup = rememberEntry(row.deltaId as string, `propagationDeltas.${row.deltaId as string}`);
    if (dup) return dup;
    deltas.set(row.deltaId as string, row);
  }
  const conflicts = new Map<string, PropagationConflict>();
  for (const row of state.propagationConflicts) {
    const dup = rememberEntry(row.conflictId as string, `propagationConflicts.${row.conflictId as string}`);
    if (dup) return dup;
    conflicts.set(row.conflictId as string, row);
  }
  const resolutions = new Map<string, ConflictResolution>();
  for (const row of state.conflictResolutions) {
    const dup = rememberEntry(row.resolutionId as string, `conflictResolutions.${row.resolutionId as string}`);
    if (dup) return dup;
    resolutions.set(row.resolutionId as string, row);
  }
  const obligations = new Map<string, ObligationRecord>();
  for (const row of state.obligations) {
    if (obligations.has(row.obligationId as string)) {
      return fail(`${path}.obligations`, 'duplicate-id', `duplicate obligation ${row.obligationId as string}`);
    }
    obligations.set(row.obligationId as string, row);
  }
  const goals = new Map<string, GoalRecord>();
  for (const row of state.goals) {
    if (goals.has(row.goalId as string)) return fail(`${path}.goals`, 'duplicate-id', `duplicate goal ${row.goalId as string}`);
    goals.set(row.goalId as string, row);
  }
  const observations = new Map<string, RealityCheckObservation>();
  for (const row of state.observations) {
    if (observations.has(row.observationId as string)) {
      return fail(`${path}.observations`, 'duplicate-id', `duplicate observation ${row.observationId as string}`);
    }
    observations.set(row.observationId as string, row);
  }
  const plans = new Map<string, RecurringPlan>();
  for (const row of state.plans) {
    if (plans.has(row.planId as string)) return fail(`${path}.plans`, 'duplicate-id', `duplicate plan ${row.planId as string}`);
    plans.set(row.planId as string, row);
  }
  const occurrences = new Map<string, PlanOccurrence>();
  for (const row of state.planOccurrences) {
    if (occurrences.has(row.occurrenceId as string)) {
      return fail(`${path}.planOccurrences`, 'duplicate-id', `duplicate occurrence ${row.occurrenceId as string}`);
    }
    occurrences.set(row.occurrenceId as string, row);
  }
  const settlements = new Map<string, CycleSettlement>();
  for (const row of state.settlements) {
    if (settlements.has(row.settlementId as string)) {
      return fail(`${path}.settlements`, 'duplicate-id', `duplicate settlement ${row.settlementId as string}`);
    }
    settlements.set(row.settlementId as string, row);
  }
  return {
    ok: true,
    index: {
      state,
      cyclesById,
      versions,
      entries,
      obligations,
      events,
      goals,
      allocations: new Map(state.allocationRecords.map((row) => [row.recordId as string, row])),
      observations,
      adjustments,
      recovery,
      plans,
      planRevisions,
      occurrences,
      settings,
      settlements,
      carry,
      deltas,
      conflicts,
      resolutions,
    },
  };
}

function sameBook(actual: string, expected: string, path: string): RepositorySnapshotGraphResult | null {
  if (actual !== expected) return fail(path, 'foreign-record', `${path} names a foreign book`);
  return null;
}

function requireCycle(index: BookIndex, cycleId: string, path: string): RepositorySnapshotGraphResult | null {
  if (!index.cyclesById.has(cycleId)) return fail(path, 'orphan-record', `${path} names unknown cycle ${cycleId}`);
  return null;
}

function requireProvenance(
  claims: Map<string, ProvenanceClaim>,
  ops: Map<string, OperationRecord>,
  sourceOperationId: string,
  key: string,
  bookId: string,
  path: string,
): RepositorySnapshotGraphResult | null {
  const operation = ops.get(sourceOperationId);
  if (operation === undefined) return fail(path, 'orphan-record', `${path} names unknown source operation ${sourceOperationId}`);
  if ((operation.bookId as string) !== bookId) return fail(path, 'foreign-record', `${path} source operation belongs to another book`);
  const claim = claims.get(key);
  if (claim === undefined) {
    return fail(path, 'invalid-reference', `${path} is not named by any validated receipt effect`);
  }
  if (claim.operationId !== sourceOperationId) {
    return fail(path, 'invalid-reference', `${path} is not bound to the operation whose effect created or changed it`);
  }
  if (claim.bookId !== bookId) return fail(path, 'foreign-record', `${path} provenance names a foreign book`);
  return null;
}

function commandMoney(command: Record<string, unknown>, field: string): Money | null {
  return asMoney(command[field]);
}

function commandString(command: Record<string, unknown>, field: string): string | null {
  return asString(command[field]);
}

function occurredLocalDate(command: Record<string, unknown>): string | null {
  const occurredAt = command['occurredAt'];
  if (typeof occurredAt !== 'object' || occurredAt === null) return null;
  const record = occurredAt as { kind?: unknown; localDate?: unknown };
  if (record.kind === 'civilDate' && typeof record.localDate === 'string') return record.localDate;
  return null;
}

interface ReplayMetadata {
  readonly idQueuesByOperation: Map<string, Map<string, string[]>>;
}

function buildReplayMetadata(index: BookIndex, commands: ReadonlyMap<string, FinanceCommand>): ReplayMetadata {
  const idQueuesByOperation = new Map<string, Map<string, string[]>>();
  const addId = (operationId: string, prefix: string, id: string): void => {
    let queues = idQueuesByOperation.get(operationId);
    if (queues === undefined) {
      queues = new Map<string, string[]>();
      idQueuesByOperation.set(operationId, queues);
    }
    const ids = queues.get(prefix) ?? [];
    ids.push(id);
    queues.set(prefix, ids);
  };
  for (const row of index.state.entries) {
    const operationId = row.sourceOperationId as string;
    const kind = commands.get(operationId)?.kind;
    const prefix =
      kind === 'recordInflow' ? 'inflow'
        : kind === 'reverseInflow' ? 'reversal'
          : kind === 'recordExpense' ? 'expense'
            : kind === 'correctExpense' ? row.kind === 'expenseReversal' ? 'expense-reversal' : 'expense'
              : kind === 'recordExpenseReturn' ? 'expense-return'
                : kind === 'correctExpenseReturn' ? row.kind === 'expenseReturnReversal' ? 'expense-return-reversal' : 'expense-return'
                  : kind === 'recordObligationPayment' ? 'obligation-payment'
                    : kind === 'recordObligationReturn' ? 'obligation-return'
                      : kind === 'recoverObservedActivity' ? 'recovery'
                        : kind === 'recordClosedCycleCorrection' ? 'closed-correction'
                          : null;
    if (prefix !== null) addId(operationId, prefix, row.entryId as string);
  }
  for (const row of index.state.obligationEvents) {
    addId(row.sourceOperationId as string, 'obligation-event', row.eventId as string);
  }
  for (const row of index.state.allocationRecords) {
    addId(row.sourceOperationId as string, 'allocation', row.recordId as string);
  }
  for (const row of index.state.observations) {
    addId(row.sourceOperationId as string, 'observation', row.observationId as string);
  }
  for (const row of index.state.adjustments) {
    addId(row.sourceOperationId as string, 'adjustment', row.adjustmentId as string);
  }
  for (const row of index.state.recoveryLinks) {
    addId(row.sourceOperationId as string, 'recovery-link', row.linkId as string);
  }
  for (const row of index.state.planRevisions) {
    addId(row.sourceOperationId as string, 'plan-revision', row.revisionId as string);
  }
  for (const row of index.state.settingsRevisions) {
    addId(row.sourceOperationId as string, 'settings-revision', row.settingsRevisionId as string);
  }
  for (const row of index.state.carryActions) {
    addId(row.sourceOperationId as string, 'carry', row.carryId as string);
  }
  for (const row of index.state.propagationDeltas) {
    addId(row.sourceOperationId as string, 'propagation-delta', row.deltaId as string);
  }
  for (const row of index.state.propagationConflicts) {
    addId(row.sourceOperationId as string, 'propagation-conflict', row.conflictId as string);
  }
  for (const row of index.state.conflictResolutions) {
    addId(row.sourceOperationId as string, 'conflict-resolution', row.resolutionId as string);
  }
  return { idQueuesByOperation };
}

function firstDifference(expected: unknown, actual: unknown, path: string): string | null {
  if (Object.is(expected, actual)) return null;
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return path;
    if (expected.length !== actual.length) return `${path}.length`;
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDifference(expected[index], actual[index], `${path}[${index}]`);
      if (difference !== null) return difference;
    }
    return null;
  }
  if (typeof expected === 'object' && expected !== null && typeof actual === 'object' && actual !== null) {
    const expectedRecord = expected as Record<string, unknown>;
    const actualRecord = actual as Record<string, unknown>;
    const expectedKeys = Object.keys(expectedRecord).sort();
    const actualKeys = Object.keys(actualRecord).sort();
    if (expectedKeys.length !== actualKeys.length) return `${path}.[keys]`;
    for (let index = 0; index < expectedKeys.length; index += 1) {
      if (expectedKeys[index] !== actualKeys[index]) return `${path}.[keys]`;
      const key = expectedKeys[index]!;
      const difference = firstDifference(expectedRecord[key], actualRecord[key], `${path}.${key}`);
      if (difference !== null) return difference;
    }
    return null;
  }
  return path;
}

function replayRefs(books: ReadonlyMap<string, BookIndex>, currentBookId: string): HandlerRefs {
  const locate = <T>(find: (index: BookIndex) => T | null): { bookId: BookState['book']['id']; value: T } | null => {
    for (const [bookId, index] of books) {
      if (bookId === currentBookId) continue;
      const value = find(index);
      if (value !== null) return { bookId: bookId as BookState['book']['id'], value };
    }
    return null;
  };
  return {
    locateEntry: (entryId) => {
      const found = locate((index) => index.entries.get(entryId as string) ?? null);
      return found === null ? null : { bookId: found.bookId, entryId, kind: found.value.kind };
    },
    locateObligation: (obligationId) => {
      const found = locate((index) => index.obligations.get(obligationId as string) ?? null);
      return found === null ? null : { bookId: found.bookId, obligationId };
    },
    locateGoal: (goalId) => {
      const found = locate((index) => index.goals.get(goalId as string) ?? null);
      return found === null ? null : { bookId: found.bookId, goalId };
    },
    locateObservation: (observationId) => {
      const found = locate((index) => index.observations.get(observationId as string) ?? null);
      return found === null ? null : { bookId: found.bookId, observationId };
    },
    locatePlan: (planId) => {
      const found = locate((index) => index.plans.get(planId as string) ?? null);
      return found === null ? null : { bookId: found.bookId, planId };
    },
    locateOccurrence: (occurrenceId) => {
      const found = locate((index) => index.occurrences.get(occurrenceId as string) ?? null);
      return found === null ? null : { bookId: found.bookId, occurrenceId };
    },
    locateSettlement: (settlementId) => {
      const found = locate((index) => index.settlements.get(settlementId as string) ?? null);
      return found === null ? null : { bookId: found.bookId, settlementId };
    },
  };
}

function replayJournal(
  books: ReadonlyMap<string, BookIndex>,
  operationsByBook: ReadonlyMap<string, readonly OperationRecord[]>,
  commands: ReadonlyMap<string, FinanceCommand>,
): RepositorySnapshotGraphResult | null {
  for (const [bookId, index] of books) {
    const refs = replayRefs(books, bookId);
    const replayMetadata = buildReplayMetadata(index, commands);
    const operations = [...(operationsByBook.get(bookId) ?? [])].sort(
      (left, right) => left.receipt.revisionBefore - right.receipt.revisionBefore,
    );
    let replayed: BookState | null = null;
    for (const operation of operations) {
      const operationId = operation.operationId as string;
      const command = commands.get(operationId);
      if (command === undefined) {
        return fail(`operations.${operationId}.canonicalCommand`, 'tampered-payload', 'validated command is missing from replay');
      }
      const queues = replayMetadata.idQueuesByOperation.get(operationId) ?? new Map<string, string[]>();
      const calls = new Map<string, number>();
      const handlerClockInstants = operation.handlerClockInstants;
      if (!Array.isArray(handlerClockInstants)) {
        return fail(
          `operations.${operationId}.handlerClockInstants`,
          'malformed-record',
          'schema-v2 journal replay requires a handler clock trace',
        );
      }
      let clockCall = 0;
      const context: CommandContext = {
        clock: {
          nowMs: () => {
            const instantMs = handlerClockInstants[clockCall];
            if (instantMs === undefined) throw new Error('handler clock trace exhausted');
            clockCall += 1;
            return instantMs;
          },
        },
        ids: {
          newId: (prefix) => {
            const call = calls.get(prefix) ?? 0;
            calls.set(prefix, call + 1);
            return queues.get(prefix)?.[call] ?? `replay-missing-${prefix}-${String(call + 1)}`;
          },
        },
        calculationVersion: operation.receipt.calculationVersion,
        origin: {
          deviceId: operation.sourceDeviceId,
          scopeId: operation.scopeId,
        },
      };
      let applied: ReturnType<typeof dispatchApply>;
      try {
        applied = dispatchApply(command, replayed, context, operation.operationId, refs);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return fail(`operations.${operationId}`, 'malformed-record', `journal replay threw: ${detail}`);
      }
      if (!applied.ok) {
        return fail(
          `operations.${operationId}`,
          'invalid-reference',
          `journal command cannot produce the stored revision: ${applied.failure.kind}`,
        );
      }
      if (clockCall !== handlerClockInstants.length) {
        return fail(
          `operations.${operationId}.handlerClockInstants[${String(clockCall)}]`,
          'malformed-record',
          'handler clock trace contains an unconsumed instant',
        );
      }
      const effectDifference = firstDifference(
        applied.effects,
        operation.receipt.effects,
        `operations.${operationId}.receipt.effects`,
      );
      if (effectDifference !== null) {
        return fail(effectDifference, 'malformed-record', 'receipt effects do not exactly match the P03 command result');
      }
      replayed = applied.nextState;
    }
    const stateDifference = firstDifference(replayed, index.state, `books.${bookId}`);
    if (stateDifference !== null) {
      return fail(stateDifference, 'malformed-record', `${stateDifference} does not exactly match the replayed P03 command history`);
    }
  }
  return null;
}

function validateCycle(index: BookIndex, cycle: CycleRecord, path: string): RepositorySnapshotGraphResult | null {
  const bookId = index.state.book.id as string;
  const composed = composeCycleId(index.state.book.id, cycle.startDate);
  if (!composed.ok || (composed.value as string) !== (cycle.cycleId as string)) {
    return fail(`${path}.cycleId`, 'invalid-reference', `${path}.cycleId is not the canonical window identity`);
  }
  if (compareCivilDates(cycle.startDate, cycle.endDateExclusive) >= 0) {
    return fail(`${path}.startDate`, 'malformed-record', `${path} window is not ordered start < end`);
  }
  const window = monthlyCycleContaining(cycle.anchor, cycle.startDate);
  if (window.startDate !== cycle.startDate || window.endDateExclusive !== cycle.endDateExclusive) {
    return fail(`${path}.startDate`, 'malformed-record', `${path} window does not match its monthly anchor`);
  }
  const funds = nonNegative(cycle.startingFunds, `${path}.startingFunds`);
  if (funds) return funds;
  const opened = instant(cycle.openedAtInstantMs, `${path}.openedAtInstantMs`);
  if (opened) return opened;
  if (cycle.mode === 'fullCycle') {
    if (
      cycle.boundaryObservedPool !== null ||
      cycle.boundaryLocalDate !== null ||
      cycle.boundaryLocalTime !== null ||
      cycle.boundaryInstantMs !== null ||
      cycle.boundaryTimeZone !== null
    ) {
      return fail(path, 'malformed-record', `${path} fullCycle boundary fields must be null`);
    }
  } else {
    if (cycle.boundaryObservedPool === null || cycle.boundaryLocalDate === null || cycle.boundaryTimeZone === null) {
      return fail(path, 'malformed-record', `${path} remainingFromBoundary is missing observed evidence`);
    }
    if (cycle.boundaryLocalTime === null && cycle.boundaryInstantMs === null) {
      return fail(path, 'malformed-record', `${path} remainingFromBoundary needs wall time or instant evidence`);
    }
    if (cycle.boundaryLocalTime !== null && !isValidWallTime(cycle.boundaryLocalTime)) {
      return fail(`${path}.boundaryLocalTime`, 'malformed-record', `${path}.boundaryLocalTime is not a valid wall time`);
    }
    const pool = nonNegative(cycle.boundaryObservedPool, `${path}.boundaryObservedPool`);
    if (pool) return pool;
    if (cycle.startingFunds.minorUnits !== cycle.boundaryObservedPool.minorUnits) {
      return fail(`${path}.startingFunds`, 'malformed-record', `${path} startingFunds must equal boundaryObservedPool`);
    }
    const boundInstant = instant(cycle.boundaryInstantMs, `${path}.boundaryInstantMs`);
    if (boundInstant) return boundInstant;
    if (cycle.boundaryInstantMs !== null) {
      const resolved = resolveCivilDateTime(cycle.boundaryInstantMs, cycle.boundaryTimeZone as TimeZoneName);
      if (!resolved.ok) return fail(`${path}.boundaryInstantMs`, 'malformed-record', `${path}.boundaryInstantMs cannot be resolved`);
      const hh = String(resolved.value.hour).padStart(2, '0');
      const mm = String(resolved.value.minute).padStart(2, '0');
      const ss = String(resolved.value.second).padStart(2, '0');
      if (resolved.value.localDate !== cycle.boundaryLocalDate) {
        return fail(`${path}.boundaryLocalDate`, 'malformed-record', `${path} boundary instant/date disagree`);
      }
      if (cycle.boundaryLocalTime !== null && cycle.boundaryLocalTime !== `${hh}:${mm}:${ss}`) {
        return fail(`${path}.boundaryLocalTime`, 'malformed-record', `${path} boundary instant/time disagree`);
      }
    }
  }
  if (cycle.supersedesVersionId !== null) {
    const prior = index.versions.get(cycle.supersedesVersionId as string);
    if (prior === undefined) return fail(`${path}.supersedesVersionId`, 'orphan-record', `${path} supersedes an unknown version`);
    if ((prior.bookId as string) !== bookId) return fail(`${path}.supersedesVersionId`, 'foreign-record', `${path} supersedes a foreign version`);
    if ((prior.cycleId as string) !== (cycle.cycleId as string)) {
      return fail(`${path}.supersedesVersionId`, 'invalid-reference', `${path} supersedes a different logical cycle`);
    }
  }
  return null;
}

function validateCycleFamilies(index: BookIndex, path: string): RepositorySnapshotGraphResult | null {
  for (const [cycleId, versions] of index.cyclesById) {
    const ordered = [...versions].sort((left, right) => left.versionSeq - right.versionSeq);
    const seen = new Set<number>();
    for (let i = 0; i < ordered.length; i += 1) {
      const version = ordered[i]!;
      if (seen.has(version.versionSeq)) {
        return fail(`${path}.cycles`, 'revision-idempotency-conflict', `cycle ${cycleId} has a forked versionSeq`);
      }
      seen.add(version.versionSeq);
      if (version.versionSeq !== i + 1) {
        return fail(`${path}.cycles`, 'revision-idempotency-conflict', `cycle ${cycleId} version sequence has a gap`);
      }
      if (i === 0 && version.supersedesVersionId !== null) {
        return fail(`${path}.cycles`, 'invalid-reference', `cycle ${cycleId} version 1 must not supersede`);
      }
      if (i > 0 && (version.supersedesVersionId as string) !== (ordered[i - 1]!.versionId as string)) {
        return fail(`${path}.cycles`, 'invalid-reference', `cycle ${cycleId} supersession chain is incoherent`);
      }
    }
  }
  return null;
}

function settlementIdentity(row: CycleSettlement, path: string): RepositorySnapshotGraphResult | null {
  const components = [
    row.startingFunds,
    row.netInflows,
    row.netOutflows,
    row.netReturns,
    row.netAdjustments,
    row.carryIn,
    row.reservedCommitments,
    row.netAllocations,
    row.buffer,
    row.availability,
  ];
  const currency = row.startingFunds.currency;
  for (const amount of components) {
    if (amount.currency !== currency) {
      return fail(path, 'malformed-record', `${path} settlement money fields must share one currency`);
    }
  }
  const starting = nonNegative(row.startingFunds, `${path}.startingFunds`);
  if (starting) return starting;
  const reserved = nonNegative(row.reservedCommitments, `${path}.reservedCommitments`);
  if (reserved) return reserved;
  const buffer = nonNegative(row.buffer, `${path}.buffer`);
  if (buffer) return buffer;
  let expected = row.startingFunds;
  const add = (amount: Money, label: string): RepositorySnapshotGraphResult | null => {
    const sum = addMoney(expected, amount);
    if (!sum.ok) return fail(`${path}.${label}`, 'malformed-record', `${path} ${label} cannot be summed into availability`);
    expected = sum.value;
    return null;
  };
  const sub = (amount: Money, label: string): RepositorySnapshotGraphResult | null => {
    const difference = subtractMoney(expected, amount);
    if (!difference.ok) return fail(`${path}.${label}`, 'malformed-record', `${path} ${label} cannot be subtracted from availability`);
    expected = difference.value;
    return null;
  };
  const carry = add(row.carryIn, 'carryIn');
  if (carry) return carry;
  const inflows = add(row.netInflows, 'netInflows');
  if (inflows) return inflows;
  const returns = add(row.netReturns, 'netReturns');
  if (returns) return returns;
  const outflows = sub(row.netOutflows, 'netOutflows');
  if (outflows) return outflows;
  const commitments = sub(row.reservedCommitments, 'reservedCommitments');
  if (commitments) return commitments;
  const allocations = sub(row.netAllocations, 'netAllocations');
  if (allocations) return allocations;
  const held = sub(row.buffer, 'buffer');
  if (held) return held;
  const adjustments = add(row.netAdjustments, 'netAdjustments');
  if (adjustments) return adjustments;
  if (!moneyEq(expected, row.availability)) {
    return fail(
      `${path}.availability`,
      'malformed-record',
      `${path} availability does not equal ${MONEY_FIELD_POLICY.settlementIdentity}`,
    );
  }
  return null;
}

function matchEffect(
  index: BookIndex,
  operation: OperationRecord,
  command: Record<string, unknown>,
  effect: CommandEffect,
  claims: Map<string, ProvenanceClaim>,
  path: string,
): RepositorySnapshotGraphResult | null {
  const bookId = index.state.book.id as string;
  const claim: ProvenanceClaim = {
    operationId: operation.operationId as string,
    effectKind: effect.kind,
    bookId,
    revisionBefore: operation.receipt.revisionBefore,
    revisionAfter: operation.receipt.revisionAfter,
  };
  const claimBind = (kind: string, id: string): RepositorySnapshotGraphResult | null => bindClaim(claims, claimKey(kind, id), claim, path);

  switch (effect.kind) {
    case 'bookCreated': {
      const book = index.state.book;
      if ((effect.bookId as string) !== (book.id as string)) return fail(path, 'orphan-record', `${path} bookCreated does not match the stored book`);
      if (effect.currency !== book.currency || effect.timeZone !== book.timeZone || !anchorEq(effect.cycleAnchor, book.cycleAnchor)) {
        return moneyMismatch(path, 'currency, timezone, or cycleAnchor');
      }
      if (commandString(command, 'bookId') !== (effect.bookId as string)) return moneyMismatch(path, 'bookId');
      if (commandString(command, 'currency') !== effect.currency) return moneyMismatch(path, 'currency');
      if (commandString(command, 'timeZone') !== effect.timeZone) return moneyMismatch(path, 'timeZone');
      const commandAnchor = command['cycleAnchor'] as MonthlyCycleAnchor | undefined;
      if (commandAnchor === undefined || !anchorEq(commandAnchor, effect.cycleAnchor)) return moneyMismatch(path, 'cycleAnchor');
      return claimBind('book', effect.bookId as string);
    }
    case 'cycleOpened': {
      const versions = index.cyclesById.get(effect.cycleId as string);
      if (versions === undefined) return fail(`${path}.cycleId`, 'orphan-record', `${path} names an unknown cycle`);
      const cycle = versions.find((row) => row.versionSeq === 1) ?? versions[0];
      if (cycle === undefined) return fail(`${path}.cycleId`, 'orphan-record', `${path} names an unknown cycle`);
      if (cycle.startDate !== effect.startDate || cycle.endDateExclusive !== effect.endDateExclusive || !moneyEq(cycle.startingFunds, effect.startingFunds)) {
        return moneyMismatch(path, 'cycle window or startingFunds');
      }
      const funds = nonNegative(effect.startingFunds, `${path}.startingFunds`);
      if (funds) return funds;
      if (commandString(command, 'startDate') !== effect.startDate) return moneyMismatch(path, 'startDate');
      const startingFunds = commandMoney(command, 'startingFunds');
      if (startingFunds === null || !moneyEq(startingFunds, effect.startingFunds)) return moneyMismatch(path, 'startingFunds');
      return claimBind('cycleVersion', cycle.versionId as string);
    }
    case 'inflowRecorded':
    case 'expenseRecorded':
    case 'expenseReturnRecorded': {
      const entry = index.entries.get(effect.entryId as string);
      if (entry === undefined) return fail(`${path}.entryId`, 'orphan-record', `${path} names an unknown entry`);
      const expectedKind =
        effect.kind === 'inflowRecorded' ? 'inflow' : effect.kind === 'expenseRecorded' ? 'expense' : 'expenseReturn';
      if (entry.kind !== expectedKind) return fail(`${path}.entryId`, 'invalid-reference', `${path} names the wrong entry kind`);
      if ((entry.cycleId as string) !== (effect.cycleId as string) || entry.localDate !== effect.localDate || !moneyEq(entry.amount, effect.amount)) {
        return moneyMismatch(path, 'cycle, date, or amount');
      }
      const amount = positive(effect.amount, `${path}.amount`);
      if (amount) return amount;
      const commandAmount = commandMoney(command, 'amount');
      if (commandAmount !== null && !moneyEq(commandAmount, effect.amount)) return moneyMismatch(path, 'command amount');
      const civil = occurredLocalDate(command);
      if (civil !== null && civil !== effect.localDate) return moneyMismatch(path, 'localDate');
      if (effect.kind === 'expenseRecorded') {
        if (entry.kind !== 'expense') return fail(path, 'invalid-reference', `${path} must name an expense`);
        if ((entry.linkedObligationId as string | null) !== (effect.linkedObligationId as string | null)) {
          return moneyMismatch(path, 'linkedObligationId');
        }
        if ((entry.replacesEntryId as string | null) !== (effect.replacesEntryId as string | null)) {
          return moneyMismatch(path, 'replacesEntryId');
        }
      }
      if (effect.kind === 'expenseReturnRecorded') {
        if (entry.kind !== 'expenseReturn') return fail(path, 'invalid-reference', `${path} must name a return`);
        if ((entry.linkedExpenseEntryId as string | null) !== (effect.linkedExpenseEntryId as string | null)) {
          return moneyMismatch(path, 'linkedExpenseEntryId');
        }
        if ((entry.linkedObligationId as string | null) !== (effect.linkedObligationId as string | null)) {
          return moneyMismatch(path, 'linkedObligationId');
        }
        if ((entry.replacesReturnEntryId as string | null) !== (effect.replacesReturnEntryId as string | null)) {
          return moneyMismatch(path, 'replacesReturnEntryId');
        }
      }
      return claimBind('entry', effect.entryId as string);
    }
    case 'inflowReversalRecorded':
    case 'expenseReversalRecorded':
    case 'expenseReturnReversalRecorded': {
      const entry = index.entries.get(effect.entryId as string);
      if (entry === undefined) return fail(`${path}.entryId`, 'orphan-record', `${path} names an unknown entry`);
      const expectedKind =
        effect.kind === 'inflowReversalRecorded'
          ? 'inflowReversal'
          : effect.kind === 'expenseReversalRecorded'
            ? 'expenseReversal'
            : 'expenseReturnReversal';
      if (entry.kind !== expectedKind) return fail(`${path}.entryId`, 'invalid-reference', `${path} names the wrong reversal kind`);
      if (
        (entry.cycleId as string) !== (effect.cycleId as string) ||
        entry.localDate !== effect.localDate ||
        !moneyEq(entry.amount, effect.amount) ||
        (entry.reversesEntryId as string) !== (effect.reversesEntryId as string)
      ) {
        return moneyMismatch(path, 'reversal identity, date, or amount');
      }
      const target = index.entries.get(effect.reversesEntryId as string);
      if (target === undefined) return fail(`${path}.reversesEntryId`, 'orphan-record', `${path} reverses an unknown entry`);
      const inv = inverse(effect.amount, target.amount, `${path}.amount`);
      if (inv) return inv;
      if (effect.kind === 'expenseReturnReversalRecorded' && entry.kind === 'expenseReturnReversal') {
        if ((entry.linkedExpenseEntryId as string | null) !== (effect.linkedExpenseEntryId as string | null)) {
          return moneyMismatch(path, 'linkedExpenseEntryId');
        }
        if ((entry.linkedObligationId as string | null) !== (effect.linkedObligationId as string | null)) {
          return moneyMismatch(path, 'linkedObligationId');
        }
      }
      return claimBind('entry', effect.entryId as string);
    }
    case 'obligationCreated': {
      const obligation = index.obligations.get(effect.obligationId as string);
      if (obligation === undefined) return fail(`${path}.obligationId`, 'orphan-record', `${path} names an unknown obligation`);
      if ((obligation.cycleId as string) !== (effect.cycleId as string) || !moneyEq(obligation.expectedAmount, effect.expectedAmount)) {
        return moneyMismatch(path, 'cycle or expectedAmount');
      }
      const amount = positive(effect.expectedAmount, `${path}.expectedAmount`);
      if (amount) return amount;
      const commandAmount = commandMoney(command, 'expectedAmount');
      if (commandAmount !== null && !moneyEq(commandAmount, effect.expectedAmount)) return moneyMismatch(path, 'command expectedAmount');
      if (commandString(command, 'obligationId') !== (effect.obligationId as string)) return moneyMismatch(path, 'obligationId');
      return claimBind('obligation', effect.obligationId as string);
    }
    case 'obligationFinallySettled':
    case 'obligationCancelled':
    case 'obligationReopened':
    case 'obligationDisputeOpened':
    case 'obligationDisputeResolved':
    case 'obligationResidualReleased': {
      const obligation = index.obligations.get(effect.obligationId as string);
      if (obligation === undefined) return fail(`${path}.obligationId`, 'orphan-record', `${path} names an unknown obligation`);
      if (commandString(command, 'obligationId') !== (effect.obligationId as string)) return moneyMismatch(path, 'obligationId');
      if ('releasedResidual' in effect) {
        const residual = nonNegative(effect.releasedResidual, `${path}.releasedResidual`);
        if (residual) return residual;
      }
      if ('reinstatedResidual' in effect) {
        const residual = nonNegative(effect.reinstatedResidual, `${path}.reinstatedResidual`);
        if (residual) return residual;
      }
      const changeType =
        effect.kind === 'obligationFinallySettled'
          ? 'finalSettlement'
          : effect.kind === 'obligationCancelled'
            ? 'cancellation'
            : effect.kind === 'obligationReopened'
              ? 'reopening'
              : effect.kind === 'obligationDisputeOpened'
                ? 'disputeOpened'
                : effect.kind === 'obligationDisputeResolved'
                  ? 'disputeResolved'
                  : 'residualReleased';
      const matching = [...index.events.values()].filter(
        (event) =>
          (event.sourceOperationId as string) === (operation.operationId as string) &&
          (event.obligationId as string) === (effect.obligationId as string) &&
          event.change.type === changeType,
      );
      if (matching.length !== 1) {
        return fail(path, 'invalid-reference', `${path} does not correspond to exactly one obligation event`);
      }
      if (effect.kind === 'obligationDisputeResolved' && matching[0]!.change.type === 'disputeResolved') {
        if (matching[0]!.change.via !== effect.via) return moneyMismatch(path, 'dispute resolution via');
      }
      return claimBind('obligationEvent', matching[0]!.eventId as string);
    }
    case 'goalCreated': {
      const goal = index.goals.get(effect.goalId as string);
      if (goal === undefined) return fail(`${path}.goalId`, 'orphan-record', `${path} names an unknown goal`);
      if (!moneyEq(goal.targetAmount, effect.targetAmount)) return moneyMismatch(path, 'targetAmount');
      const amount = positive(effect.targetAmount, `${path}.targetAmount`);
      if (amount) return amount;
      const commandAmount = commandMoney(command, 'targetAmount');
      if (commandAmount !== null && !moneyEq(commandAmount, effect.targetAmount)) return moneyMismatch(path, 'command targetAmount');
      if (commandString(command, 'goalId') !== (effect.goalId as string)) return moneyMismatch(path, 'goalId');
      return claimBind('goal', effect.goalId as string);
    }
    case 'allocationFunded':
    case 'allocationAssigned':
    case 'allocationUnassigned':
    case 'allocationReleased':
    case 'allocationRecordReversed': {
      const row = index.allocations.get(effect.recordId as string);
      if (row === undefined) return fail(`${path}.recordId`, 'orphan-record', `${path} names an unknown allocation record`);
      if (effect.kind === 'allocationFunded' && row.change.type === 'funding') {
        if ((row.cycleId as string) !== (effect.cycleId as string) || row.localDate !== effect.localDate || !moneyEq(row.change.amount, effect.amount)) {
          return moneyMismatch(path, 'funding fields');
        }
      } else if (effect.kind === 'allocationAssigned' && row.change.type === 'assignment') {
        if ((row.change.goalId as string) !== (effect.goalId as string) || !moneyEq(row.change.amount, effect.amount)) {
          return moneyMismatch(path, 'assignment fields');
        }
      } else if (effect.kind === 'allocationUnassigned' && row.change.type === 'unassignment') {
        if ((row.change.goalId as string) !== (effect.goalId as string) || !moneyEq(row.change.amount, effect.amount)) {
          return moneyMismatch(path, 'unassignment fields');
        }
      } else if (effect.kind === 'allocationReleased' && row.change.type === 'release') {
        if (
          (row.cycleId as string) !== (effect.cycleId as string) ||
          row.localDate !== effect.localDate ||
          (row.change.destinationCycleId as string) !== (effect.destinationCycleId as string) ||
          (row.change.goalId as string | null) !== (effect.goalId as string | null) ||
          !moneyEq(row.change.amount, effect.amount)
        ) {
          return moneyMismatch(path, 'release fields');
        }
      } else if (effect.kind === 'allocationRecordReversed' && row.change.type === 'reversal') {
        if ((row.change.reversesRecordId as string) !== (effect.reversesRecordId as string)) {
          return moneyMismatch(path, 'reversesRecordId');
        }
        const target = index.allocations.get(effect.reversesRecordId as string);
        if (target === undefined) return fail(`${path}.reversesRecordId`, 'orphan-record', `${path} reverses an unknown allocation`);
        const targetAmount = allocationMovement(target.change);
        if (targetAmount === null) return fail(`${path}.reversesRecordId`, 'invalid-reference', `${path} cannot reverse a reversal`);
        if (!moneyEq(targetAmount, effect.amount) || target.change.type !== effect.reversedChange) {
          return moneyMismatch(path, 'reversed allocation amount or change');
        }
      } else {
        return fail(path, 'invalid-reference', `${path} does not match the stored allocation change`);
      }
      if (effect.kind !== 'allocationRecordReversed') {
        const amount = positive(effect.amount, `${path}.amount`);
        if (amount) return amount;
        const commandAmount = commandMoney(command, 'amount');
        if (commandAmount !== null && !moneyEq(commandAmount, effect.amount)) return moneyMismatch(path, 'command amount');
      }
      return claimBind('allocation', effect.recordId as string);
    }
    case 'bufferSet': {
      const commandBuffer = commandMoney(command, 'buffer');
      if (commandBuffer === null || !moneyEq(commandBuffer, effect.amount)) return moneyMismatch(path, 'command buffer');
      const amount = nonNegative(effect.amount, `${path}.amount`);
      if (amount) return amount;
      if (effect.previousAmount !== null) {
        const previous = nonNegative(effect.previousAmount, `${path}.previousAmount`);
        if (previous) return previous;
      }
      if (
        index.state.buffer !== null &&
        (index.state.buffer.sourceOperationId as string) === (operation.operationId as string)
      ) {
        if (!moneyEq(index.state.buffer.amount, effect.amount)) return moneyMismatch(path, 'buffer amount');
        return claimBind('buffer', bookId);
      }
      return null;
    }
    case 'boundaryCycleOpened': {
      const cycle = index.versions.get(effect.versionId as string);
      if (cycle === undefined) return fail(`${path}.versionId`, 'orphan-record', `${path} names an unknown cycle version`);
      if ((cycle.cycleId as string) !== (effect.cycleId as string)) {
        return fail(`${path}.versionId`, 'invalid-reference', `${path} version does not belong to the named cycle`);
      }
      if (cycle.startDate !== effect.startDate || cycle.endDateExclusive !== effect.endDateExclusive || !moneyEq(cycle.startingFunds, effect.observedPool)) {
        return moneyMismatch(path, 'boundary cycle window or observed pool');
      }
      const pool = nonNegative(effect.observedPool, `${path}.observedPool`);
      if (pool) return pool;
      return claimBind('cycleVersion', effect.versionId as string);
    }
    case 'realityCheckRecorded': {
      const observation = index.observations.get(effect.observationId as string);
      if (observation === undefined) return fail(`${path}.observationId`, 'orphan-record', `${path} names an unknown observation`);
      if ((observation.cycleId as string) !== (effect.cycleId as string) || !moneyEq(observation.observedPool, effect.observedPool)) {
        return moneyMismatch(path, 'observation cycle or pool');
      }
      const pool = nonNegative(effect.observedPool, `${path}.observedPool`);
      if (pool) return pool;
      const commandPool = commandMoney(command, 'observedPool');
      if (commandPool !== null && !moneyEq(commandPool, effect.observedPool)) return moneyMismatch(path, 'command observedPool');
      const bound = claimBind('observation', effect.observationId as string);
      if (bound) return bound;
      const adjustment = [...index.adjustments.values()].find(
        (row) =>
          (row.sourceOperationId as string) === (operation.operationId as string) &&
          (row.observationId as string) === (effect.observationId as string),
      );
      if (adjustment === undefined) return fail(path, 'orphan-record', `${path} did not create a matching adjustment`);
      if (!moneyEq(adjustment.amount, effect.adjustmentAmount)) return moneyMismatch(path, 'adjustmentAmount');
      return claimBind('adjustment', adjustment.adjustmentId as string);
    }
    case 'observedActivityRecovered': {
      const entry = index.entries.get(effect.entryId as string);
      if (entry === undefined) return fail(`${path}.entryId`, 'orphan-record', `${path} names an unknown recovered entry`);
      if ((entry.cycleId as string) !== (effect.cycleId as string) || entry.localDate !== effect.localDate || !moneyEq(entry.amount, effect.amount)) {
        return moneyMismatch(path, 'recovered entry fields');
      }
      const amount = positive(effect.amount, `${path}.amount`);
      if (amount) return amount;
      if (!index.observations.has(effect.observationId as string)) {
        return fail(`${path}.observationId`, 'orphan-record', `${path} names an unknown observation`);
      }
      const commandAmount = commandMoney(command, 'amount');
      if (commandAmount !== null && !moneyEq(commandAmount, effect.amount)) return moneyMismatch(path, 'command amount');
      const bound = claimBind('entry', effect.entryId as string);
      if (bound) return bound;
      const link = [...index.recovery.values()].find(
        (row) =>
          (row.sourceOperationId as string) === (operation.operationId as string) &&
          (row.entryId as string) === (effect.entryId as string),
      );
      if (link === undefined) return fail(path, 'orphan-record', `${path} did not create a matching recovery link`);
      if ((link.observationId as string) !== (effect.observationId as string) || link.movementKind !== effect.movementKind) {
        return moneyMismatch(path, 'recovery observation or movementKind');
      }
      return claimBind('recovery', link.linkId as string);
    }
    case 'recurringPlanCreated': {
      const plan = index.plans.get(effect.planId as string);
      if (plan === undefined) return fail(`${path}.planId`, 'orphan-record', `${path} names an unknown plan`);
      if (commandString(command, 'planId') !== (effect.planId as string)) return moneyMismatch(path, 'planId');
      const amount = positive(effect.amount, `${path}.amount`);
      if (amount) return amount;
      const commandAmount = commandMoney(command, 'amount');
      if (commandAmount !== null && !moneyEq(commandAmount, effect.amount)) return moneyMismatch(path, 'command amount');
      if (commandString(command, 'effectiveDate') !== effect.effectiveDate) return moneyMismatch(path, 'effectiveDate');
      if (command['scheduleDay'] !== effect.scheduleDay) return moneyMismatch(path, 'scheduleDay');
      const bound = claimBind('plan', effect.planId as string);
      if (bound) return bound;
      const revision = [...index.planRevisions.values()].find(
        (row) =>
          (row.sourceOperationId as string) === (operation.operationId as string) &&
          (row.planId as string) === (effect.planId as string),
      );
      if (revision === undefined) return fail(path, 'orphan-record', `${path} did not create a matching plan revision`);
      if (!moneyEq(revision.amount, effect.amount) || revision.scheduleDay !== effect.scheduleDay || revision.effectiveDate !== effect.effectiveDate) {
        return moneyMismatch(path, 'plan revision fields');
      }
      return claimBind('planRevision', revision.revisionId as string);
    }
    case 'recurringPlanRevised': {
      const revision = index.planRevisions.get(effect.revisionId as string);
      if (revision === undefined) return fail(`${path}.revisionId`, 'orphan-record', `${path} names an unknown plan revision`);
      if ((revision.planId as string) !== (effect.planId as string)) {
        return fail(`${path}.revisionId`, 'invalid-reference', `${path} revision does not belong to the named plan`);
      }
      if (
        revision.effectiveDate !== effect.effectiveDate ||
        !moneyEq(revision.amount, effect.amount) ||
        revision.scheduleDay !== effect.scheduleDay
      ) {
        return moneyMismatch(path, 'revision fields');
      }
      const amount = positive(effect.amount, `${path}.amount`);
      if (amount) return amount;
      if (!index.plans.has(effect.planId as string)) return fail(`${path}.planId`, 'orphan-record', `${path} names an unknown plan`);
      return claimBind('planRevision', effect.revisionId as string);
    }
    case 'planOccurrencesMaterialized': {
      if (!index.plans.has(effect.planId as string)) return fail(`${path}.planId`, 'orphan-record', `${path} names an unknown plan`);
      if (commandString(command, 'planId') !== (effect.planId as string)) return moneyMismatch(path, 'planId');
      const seen = new Set<string>();
      for (const occurrenceId of effect.occurrenceIds) {
        const id = occurrenceId as string;
        if (seen.has(id)) return fail(`${path}.occurrenceIds`, 'duplicate-id', `${path} repeats occurrence ${id}`);
        seen.add(id);
        const occurrence = index.occurrences.get(id);
        if (occurrence === undefined) return fail(`${path}.occurrenceIds`, 'orphan-record', `${path} names an unknown occurrence`);
        if ((occurrence.planId as string) !== (effect.planId as string)) {
          return fail(`${path}.occurrenceIds`, 'invalid-reference', `${path} occurrence does not belong to the named plan`);
        }
        const bound = claimBind('occurrence', id);
        if (bound) return bound;
      }
      return null;
    }
    case 'planOccurrenceDetached': {
      const occurrence = index.occurrences.get(effect.occurrenceId as string);
      if (occurrence === undefined) return fail(`${path}.occurrenceId`, 'orphan-record', `${path} names an unknown occurrence`);
      if (occurrence.state !== 'detached') return fail(path, 'invalid-reference', `${path} occurrence is not detached`);
      if (commandString(command, 'occurrenceId') !== (effect.occurrenceId as string)) return moneyMismatch(path, 'occurrenceId');
      return null;
    }
    case 'planOccurrenceReserved': {
      const occurrence = index.occurrences.get(effect.occurrenceId as string);
      if (occurrence === undefined) return fail(`${path}.occurrenceId`, 'orphan-record', `${path} names an unknown occurrence`);
      if ((occurrence.linkedObligationId as string | null) !== (effect.obligationId as string)) {
        return moneyMismatch(path, 'reserved obligation');
      }
      const obligation = index.obligations.get(effect.obligationId as string);
      if (obligation === undefined) return fail(`${path}.obligationId`, 'orphan-record', `${path} names an unknown obligation`);
      if (!moneyEq(obligation.expectedAmount, effect.expectedAmount)) return moneyMismatch(path, 'expectedAmount');
      const amount = positive(effect.expectedAmount, `${path}.expectedAmount`);
      if (amount) return amount;
      const bound = claimBind('obligation', effect.obligationId as string);
      if (bound) return bound;
      return null;
    }
    case 'bookSettingsUpdated': {
      const revision = [...index.settings.values()].find(
        (row) =>
          (row.sourceOperationId as string) === (operation.operationId as string) &&
          row.effectiveDate === effect.effectiveDate,
      );
      if (revision === undefined) return fail(path, 'orphan-record', `${path} did not create a matching settings revision`);
      if (commandString(command, 'effectiveDate') !== effect.effectiveDate) return moneyMismatch(path, 'effectiveDate');
      return claimBind('settings', revision.settingsRevisionId as string);
    }
    case 'openCycleRebased': {
      const oldVersion = index.versions.get(effect.oldVersionId as string);
      const newVersion = index.versions.get(effect.newVersionId as string);
      if (oldVersion === undefined) return fail(`${path}.oldVersionId`, 'orphan-record', `${path} names an unknown old version`);
      if (newVersion === undefined) return fail(`${path}.newVersionId`, 'orphan-record', `${path} names an unknown new version`);
      if ((oldVersion.cycleId as string) !== (effect.cycleId as string) || (newVersion.cycleId as string) !== (effect.cycleId as string)) {
        return fail(path, 'invalid-reference', `${path} rebase versions do not belong to the named cycle`);
      }
      if (oldVersion.startDate !== effect.oldStartDate || oldVersion.endDateExclusive !== effect.oldEndDateExclusive) {
        return moneyMismatch(path, 'old window');
      }
      if (newVersion.startDate !== effect.newStartDate || newVersion.endDateExclusive !== effect.newEndDateExclusive) {
        return moneyMismatch(path, 'new window');
      }
      if ((newVersion.supersedesVersionId as string | null) !== (oldVersion.versionId as string)) {
        return fail(path, 'invalid-reference', `${path} new version does not supersede the old version`);
      }
      return claimBind('cycleVersion', effect.newVersionId as string);
    }
    case 'cycleClosed': {
      const settlement = index.settlements.get(effect.settlementId as string);
      if (settlement === undefined) return fail(`${path}.settlementId`, 'orphan-record', `${path} names an unknown settlement`);
      if ((settlement.cycleId as string) !== (effect.cycleId as string) || (settlement.versionId as string) !== (effect.versionId as string)) {
        return fail(path, 'invalid-reference', `${path} settlement does not match the named cycle version`);
      }
      if (!moneyEq(settlement.availability, effect.availability)) return moneyMismatch(path, 'availability');
      const version = index.versions.get(effect.versionId as string);
      if (version === undefined) return fail(`${path}.versionId`, 'orphan-record', `${path} names an unknown cycle version`);
      if ((version.cycleId as string) !== (effect.cycleId as string)) {
        return fail(`${path}.versionId`, 'invalid-reference', `${path} version does not belong to the named cycle`);
      }
      return claimBind('settlement', effect.settlementId as string);
    }
    case 'cycleRemainderDisposed': {
      const carry = index.carry.get(effect.carryId as string);
      if (carry === undefined) return fail(`${path}.carryId`, 'orphan-record', `${path} names an unknown carry`);
      if ((carry.settlementId as string) !== (effect.settlementId as string) || carry.disposition.kind !== effect.dispositionKind) {
        return moneyMismatch(path, 'carry settlement or disposition');
      }
      if (commandString(command, 'settlementId') !== (effect.settlementId as string)) return moneyMismatch(path, 'settlementId');
      const bound = claimBind('carry', effect.carryId as string);
      if (bound) return bound;
      // P03's remainder-disposal receipt names only the carry. fundTracked and
      // split still append one funding allocation with this operation id.
      const fundAmount =
        carry.disposition.kind === 'fundTracked'
          ? carry.disposition.amount
          : carry.disposition.kind === 'split'
            ? carry.disposition.fundAmount
            : null;
      const funding = [...index.allocations.values()].filter(
        (row) =>
          (row.sourceOperationId as string) === (operation.operationId as string) &&
          row.change.type === 'funding',
      );
      if (fundAmount !== null && fundAmount.minorUnits > 0) {
        if (funding.length !== 1) {
          return fail(path, 'invalid-reference', `${path} did not create exactly one funding allocation`);
        }
        const row = funding[0]!;
        if (row.change.type !== 'funding' || !moneyEq(row.change.amount, fundAmount)) {
          return moneyMismatch(path, 'funding allocation amount');
        }
        if (!index.cyclesById.has(row.cycleId as string)) {
          return fail(`${path}.cycleId`, 'orphan-record', `${path} funding allocation names an unknown cycle`);
        }
        return claimBind('allocation', row.recordId as string);
      }
      if (funding.length !== 0) {
        return fail(path, 'invalid-reference', `${path} created an unexpected funding allocation`);
      }
      return null;
    }
    case 'cycleReopened': {
      const settlement = index.settlements.get(effect.reopenedSettlementId as string);
      if (settlement === undefined) return fail(`${path}.reopenedSettlementId`, 'orphan-record', `${path} names an unknown settlement`);
      if ((settlement.cycleId as string) !== (effect.cycleId as string)) {
        return fail(path, 'invalid-reference', `${path} reopened settlement does not belong to the named cycle`);
      }
      const version = index.versions.get(effect.newVersionId as string);
      if (version === undefined) return fail(`${path}.newVersionId`, 'orphan-record', `${path} names an unknown new version`);
      if ((version.cycleId as string) !== (effect.cycleId as string)) {
        return fail(`${path}.newVersionId`, 'invalid-reference', `${path} new version does not belong to the named cycle`);
      }
      const bound = claimBind('cycleVersion', effect.newVersionId as string);
      if (bound) return bound;
      return claimBind('settlementReopen', effect.reopenedSettlementId as string);
    }
    case 'closedCycleCorrectionRecorded': {
      const entry = index.entries.get(effect.entryId as string);
      if (entry === undefined) return fail(`${path}.entryId`, 'orphan-record', `${path} names an unknown correction entry`);
      if (!index.cyclesById.has(effect.targetCycleId as string)) {
        return fail(`${path}.targetCycleId`, 'orphan-record', `${path} names an unknown target cycle`);
      }
      const settlement = index.settlements.get(effect.settlementId as string);
      if (settlement === undefined) return fail(`${path}.settlementId`, 'orphan-record', `${path} names an unknown settlement`);
      if ((settlement.cycleId as string) !== (effect.targetCycleId as string)) {
        return fail(path, 'invalid-reference', `${path} settlement does not belong to the target cycle`);
      }
      if (effect.correctsEntryId !== null && !index.entries.has(effect.correctsEntryId as string)) {
        return fail(`${path}.correctsEntryId`, 'orphan-record', `${path} names an unknown corrected entry`);
      }
      if (effect.replacementEntryId !== null && !index.entries.has(effect.replacementEntryId as string)) {
        return fail(`${path}.replacementEntryId`, 'orphan-record', `${path} names an unknown replacement entry`);
      }
      const bound = claimBind('entry', effect.entryId as string);
      if (bound) return bound;
      if (effect.propagation === 'applied') {
        const delta = [...index.deltas.values()].find(
          (row) =>
            (row.sourceOperationId as string) === (operation.operationId as string) &&
            (row.correctionEntryId as string) === (effect.entryId as string),
        );
        if (delta === undefined) return fail(path, 'orphan-record', `${path} did not create a matching propagation delta`);
        if (!moneyEq(delta.deltaAmount, effect.deltaAmount) || (delta.settlementId as string) !== (effect.settlementId as string)) {
          return moneyMismatch(path, 'propagation delta');
        }
        return claimBind('delta', delta.deltaId as string);
      }
      const conflict = [...index.conflicts.values()].find(
        (row) =>
          (row.sourceOperationId as string) === (operation.operationId as string) &&
          (row.correctionEntryId as string) === (effect.entryId as string),
      );
      if (conflict === undefined) return fail(path, 'orphan-record', `${path} did not create a matching propagation conflict`);
      if (!moneyEq(conflict.unpropagatedAmount, effect.deltaAmount) || (conflict.settlementId as string) !== (effect.settlementId as string)) {
        return moneyMismatch(path, 'propagation conflict');
      }
      return claimBind('conflict', conflict.conflictId as string);
    }
    case 'propagationConflictResolved': {
      const conflict = index.conflicts.get(effect.conflictId as string);
      if (conflict === undefined) return fail(`${path}.conflictId`, 'orphan-record', `${path} names an unknown conflict`);
      if (commandString(command, 'conflictId') !== (effect.conflictId as string)) return moneyMismatch(path, 'conflictId');
      const resolution = [...index.resolutions.values()].find(
        (row) =>
          (row.sourceOperationId as string) === (operation.operationId as string) &&
          (row.conflictId as string) === (effect.conflictId as string),
      );
      if (resolution === undefined) return fail(path, 'orphan-record', `${path} did not create a matching resolution`);
      if ((resolution.settlementId as string) !== (conflict.settlementId as string)) {
        return fail(path, 'invalid-reference', `${path} resolution settlement does not match the conflict`);
      }
      return claimBind('resolution', resolution.resolutionId as string);
    }
  }
}

function pulledEquals(operation: OperationRecord, pulled: PulledOperation, path: string): RepositorySnapshotGraphResult | null {
  if (
    (operation.operationId as string) !== (pulled.operationId as string) ||
    (operation.scopeId as string) !== (pulled.scopeId as string) ||
    (operation.bookId as string) !== (pulled.bookId as string) ||
    operation.receipt.revisionBefore !== pulled.baseRevision ||
    operation.receipt.revisionAfter !== pulled.resultingRevision ||
    operation.canonicalCommand !== pulled.canonicalCommand ||
    operation.receipt.canonicalDigest !== pulled.canonicalDigest ||
    (operation.sourceDeviceId as string) !== (pulled.sourceDeviceId as string) ||
    operation.enqueueSequence !== pulled.sourceEnqueueSequence
  ) {
    return fail(path, 'tampered-payload', `${path} does not immutably match the journal`);
  }
  return null;
}

function validateEntry(
  index: BookIndex,
  entry: LedgerEntry,
  ops: Map<string, OperationRecord>,
  claims: Map<string, ProvenanceClaim>,
  path: string,
): RepositorySnapshotGraphResult | null {
  const bookId = index.state.book.id as string;
  const foreign = sameBook(entry.bookId as string, bookId, `${path}.bookId`);
  if (foreign) return foreign;
  const cycle = requireCycle(index, entry.cycleId as string, `${path}.cycleId`);
  if (cycle) return cycle;
  const source = requireProvenance(claims, ops, entry.sourceOperationId as string, claimKey('entry', entry.entryId as string), bookId, `${path}.sourceOperationId`);
  if (source) return source;
  const captured = instant(entry.capturedAtInstantMs, `${path}.capturedAtInstantMs`);
  if (captured) return captured;
  const occurred = instant(entry.occurredAtInstantMs, `${path}.occurredAtInstantMs`);
  if (occurred) return occurred;
  if (entry.kind === 'inflow' || entry.kind === 'expense' || entry.kind === 'expenseReturn') {
    const amount = positive(entry.amount, `${path}.amount`);
    if (amount) return amount;
  }
  if (entry.kind === 'inflowReversal' || entry.kind === 'expenseReversal' || entry.kind === 'expenseReturnReversal') {
    const target = index.entries.get(entry.reversesEntryId as string);
    if (target === undefined) return fail(`${path}.reversesEntryId`, 'orphan-record', `${path} reverses an unknown entry`);
    if ((target.bookId as string) !== bookId) return fail(`${path}.reversesEntryId`, 'foreign-record', `${path} reverses a foreign entry`);
    if (entry.kind === 'inflowReversal' && target.kind !== 'inflow') {
      return fail(`${path}.reversesEntryId`, 'invalid-reference', `${path} does not reverse an inflow`);
    }
    if (entry.kind === 'expenseReversal' && target.kind !== 'expense') {
      return fail(`${path}.reversesEntryId`, 'invalid-reference', `${path} does not reverse an expense`);
    }
    if (entry.kind === 'expenseReturnReversal' && target.kind !== 'expenseReturn') {
      return fail(`${path}.reversesEntryId`, 'invalid-reference', `${path} does not reverse a return`);
    }
    if ((entry.reversesEntryId as string) === (entry.entryId as string)) {
      return fail(`${path}.reversesEntryId`, 'invalid-reference', `${path} cannot reverse itself`);
    }
    const inv = inverse(entry.amount, target.amount, `${path}.amount`);
    if (inv) return inv;
  }
  if (entry.kind === 'expense') {
    if (entry.linkedObligationId !== null) {
      const obligation = index.obligations.get(entry.linkedObligationId as string);
      if (obligation === undefined) return fail(`${path}.linkedObligationId`, 'orphan-record', `${path} names an unknown obligation`);
      if ((obligation.bookId as string) !== bookId) return fail(`${path}.linkedObligationId`, 'foreign-record', `${path} names a foreign obligation`);
    }
    if (entry.replacesEntryId !== null) {
      const replaced = index.entries.get(entry.replacesEntryId as string);
      if (replaced === undefined || replaced.kind !== 'expense') {
        return fail(`${path}.replacesEntryId`, 'invalid-reference', `${path} does not replace an expense`);
      }
    }
  }
  if (entry.kind === 'expenseReturn') {
    if (entry.linkedExpenseEntryId !== null) {
      const linked = index.entries.get(entry.linkedExpenseEntryId as string);
      if (linked === undefined || linked.kind !== 'expense') {
        return fail(`${path}.linkedExpenseEntryId`, 'invalid-reference', `${path} does not link an expense`);
      }
    }
    if (entry.linkedObligationId !== null && !index.obligations.has(entry.linkedObligationId as string)) {
      return fail(`${path}.linkedObligationId`, 'orphan-record', `${path} names an unknown obligation`);
    }
    if (entry.replacesReturnEntryId !== null) {
      const replaced = index.entries.get(entry.replacesReturnEntryId as string);
      if (replaced === undefined || replaced.kind !== 'expenseReturn') {
        return fail(`${path}.replacesReturnEntryId`, 'invalid-reference', `${path} does not replace a return`);
      }
    }
  }
  return null;
}

export function validateRepositorySnapshotGraph(input: RepositorySnapshotGraphInput): RepositorySnapshotGraphResult {
  if (input.exportedAtMs !== undefined) {
    const exported = instant(input.exportedAtMs, 'exportedAtMs');
    if (exported) return exported;
  }
  const books = new Map<string, BookIndex>();
  for (const book of input.books) {
    const indexed = indexBook(book, `books.${book.book.id as string}`);
    if (!('index' in indexed)) return indexed;
    books.set(book.book.id as string, indexed.index);
  }
  const operations = new Map<string, OperationRecord>();
  const opsByBook = new Map<string, OperationRecord[]>();
  for (const operation of input.operations) {
    operations.set(operation.operationId as string, operation);
    const bookOps = opsByBook.get(operation.bookId as string) ?? [];
    bookOps.push(operation);
    opsByBook.set(operation.bookId as string, bookOps);
  }
  const outboxByOp = new Map<string, OutboxEnvelope>();
  for (const envelope of input.outbox) {
    if (envelope.schemaVersion !== SYNC_RECORD_SCHEMA_VERSION) {
      return fail(
        `outbox.${envelope.outboxId}.schemaVersion`,
        'malformed-record',
        'legacy sync records without handler-clock provenance are unsupported',
      );
    }
    outboxByOp.set(envelope.operationId as string, envelope);
  }
  const appliedByOp = new Map<string, { pulled: PulledOperation; path: string }>();
  for (let streamIndex = 0; streamIndex < input.checkpoints.streams.length; streamIndex += 1) {
    const stream = input.checkpoints.streams[streamIndex]!;
    const path = `checkpoints.streams[${streamIndex}]`;
    const applied = asAppliedList(stream.applied);
    if (stream.cursor === null) {
      if (stream.batchDigest !== null) return fail(`${path}.batchDigest`, 'malformed-record', 'null cursor requires a null batch digest');
      if (applied.length > 0) return fail(`${path}.applied`, 'malformed-record', 'null cursor requires an empty applied set');
    } else {
      if (stream.batchDigest === null || !CANONICAL_DIGEST_PATTERN.test(stream.batchDigest)) {
        return fail(`${path}.batchDigest`, 'malformed-record', 'non-null cursor requires a canonical batch digest');
      }
    }
    for (const pulled of applied) {
      if ((pulled.scopeId as string) !== input.checkpoints.scopeId) {
        return fail(`${path}.applied`, 'foreign-record', 'applied operation names a foreign scope');
      }
      const id = pulled.operationId as string;
      if (appliedByOp.has(id)) return fail(`${path}.applied`, 'duplicate-id', `duplicate applied operation ${id}`);
      const journal = operations.get(id);
      if (journal === undefined) return fail(`${path}.applied.${id}`, 'orphan-record', 'applied operation is missing from the journal');
      const match = pulledEquals(journal, pulled, `${path}.applied.${id}`);
      if (match) return match;
      appliedByOp.set(id, { pulled, path: `${path}.applied.${id}` });
    }
  }

  const claims = new Map<string, ProvenanceClaim>();
  const commands = new Map<string, FinanceCommand>();
  const localEnqueue = new Set<number>();
  for (const operation of input.operations) {
    const operationId = operation.operationId as string;
    if (operation.schemaVersion !== SYNC_RECORD_SCHEMA_VERSION) {
      return fail(
        `operations.${operationId}.schemaVersion`,
        'malformed-record',
        'legacy journal records without handler-clock provenance are unsupported',
      );
    }
    if (operation.receipt.schemaVersion !== SYNC_RECORD_SCHEMA_VERSION) {
      return fail(
        `operations.${operationId}.receipt.schemaVersion`,
        'malformed-record',
        'legacy receipts without handler-clock provenance are unsupported',
      );
    }
    if (
      operation.handlerClockVersion !== HANDLER_CLOCK_PROVENANCE_VERSION ||
      operation.receipt.handlerClockVersion !== HANDLER_CLOCK_PROVENANCE_VERSION
    ) {
      return fail(
        `operations.${operationId}.handlerClockVersion`,
        'malformed-record',
        'legacy journal record without versioned handler-clock provenance is unsupported',
      );
    }
    if (!Array.isArray(operation.handlerClockInstants)) {
      return fail(
        `operations.${operationId}.handlerClockInstants`,
        'malformed-record',
        'versioned journal record requires a handler clock trace',
      );
    }
    if (!Array.isArray(operation.receipt.handlerClockInstants)) {
      return fail(
        `operations.${operationId}.receipt.handlerClockInstants`,
        'malformed-record',
        'versioned receipt requires a handler clock trace',
      );
    }
    for (let traceIndex = 0; traceIndex < operation.handlerClockInstants.length; traceIndex += 1) {
      const traced = instant(
        operation.handlerClockInstants[traceIndex],
        `operations.${operationId}.handlerClockInstants[${String(traceIndex)}]`,
      );
      if (traced) return traced;
    }
    const traceDifference = firstDifference(
      operation.handlerClockInstants,
      operation.receipt.handlerClockInstants,
      `operations.${operationId}.receipt.handlerClockInstants`,
    );
    if (traceDifference !== null) {
      return fail(
        traceDifference,
        'malformed-record',
        'operation and receipt handler clock traces must match exactly and in order',
      );
    }
    const book = books.get(operation.bookId as string);
    if (book === undefined) return fail(`operations.${operation.operationId as string}`, 'foreign-record', 'operation names an unknown book');
    if (operation.committedAtInstantMs !== operation.receipt.committedAtInstantMs) {
      return fail(`operations.${operation.operationId as string}.committedAtInstantMs`, 'malformed-record', 'operation and receipt commit instants must match');
    }
    const commit = instant(operation.committedAtInstantMs, `operations.${operation.operationId as string}.committedAtInstantMs`);
    if (commit) return commit;
    const commandPath = `operations.${operation.operationId as string}.canonicalCommand`;
    const command = parseCanonicalCommand(operation.canonicalCommand, operation.receipt.commandKind, commandPath);
    if (!('value' in command)) return command;
    const commandRecord = command.value as unknown as Record<string, unknown>;
    commands.set(operation.operationId as string, command.value);
    if (commandString(commandRecord, 'bookId') !== (operation.bookId as string)) {
      return fail(commandPath, 'foreign-record', 'canonical command bookId does not match the journal book');
    }
    const actualKinds = operation.receipt.effects.map((effect) => effect.kind);
    if (!kindsMatch(actualKinds, expectedEffectKinds(command.value))) {
      return fail(
        `operations.${operation.operationId as string}.receipt.effects`,
        'journal-outbox-asymmetry',
        'effect kind set or cardinality does not match the command handler',
      );
    }
    const seenEffectTargets = new Set<string>();
    for (let effectIndex = 0; effectIndex < operation.receipt.effects.length; effectIndex += 1) {
      const effect = operation.receipt.effects[effectIndex]!;
      const effectPath = `operations.${operation.operationId as string}.receipt.effects[${effectIndex}]`;
      const targetKey = JSON.stringify(effect);
      if (seenEffectTargets.has(targetKey)) {
        return fail(effectPath, 'duplicate-id', 'duplicate receipt effect');
      }
      seenEffectTargets.add(targetKey);
      const matched = matchEffect(book, operation, commandRecord, effect, claims, effectPath);
      if (matched) return matched;
    }
    const envelope = outboxByOp.get(operation.operationId as string);
    if (envelope !== undefined) {
      if ((operation.sourceDeviceId as string) !== input.localDeviceId) {
        return fail(`operations.${operation.operationId as string}.sourceDeviceId`, 'foreign-record', 'outbox-backed operation must bind to the document device');
      }
      if ((envelope.sourceDeviceId as string) !== input.localDeviceId) {
        return fail(`outbox.${envelope.outboxId}.sourceDeviceId`, 'foreign-record', 'outbox must bind to the document device');
      }
      if (localEnqueue.has(operation.enqueueSequence)) {
        return fail(`operations.${operation.operationId as string}.enqueueSequence`, 'duplicate-id', `duplicate local enqueueSequence ${operation.enqueueSequence}`);
      }
      if (operation.enqueueSequence < 1 || operation.enqueueSequence > input.enqueueSequence) {
        return fail(`operations.${operation.operationId as string}.enqueueSequence`, 'journal-outbox-asymmetry', 'local enqueueSequence is outside 1..enqueueSequence');
      }
      localEnqueue.add(operation.enqueueSequence);
    } else {
      const applied = appliedByOp.get(operation.operationId as string);
      if (applied === undefined) {
        return fail(`operations.${operation.operationId as string}`, 'journal-outbox-asymmetry', 'journal operation without outbox is missing from checkpoint applied history');
      }
    }
  }
  if (localEnqueue.size !== input.enqueueSequence) {
    return fail('enqueueSequence', 'journal-outbox-asymmetry', 'local outbox-backed operations do not form exact sequence 1..enqueueSequence');
  }
  for (let sequence = 1; sequence <= input.enqueueSequence; sequence += 1) {
    if (!localEnqueue.has(sequence)) {
      return fail('enqueueSequence', 'journal-outbox-asymmetry', `local journal is missing enqueueSequence ${sequence}`);
    }
  }

  for (const [bookId, index] of books) {
    const created = instant(index.state.book.createdAtInstantMs, `books.${bookId}.book.createdAtInstantMs`);
    if (created) return created;
    const family = validateCycleFamilies(index, `books.${bookId}`);
    if (family) return family;
    for (const cycle of index.state.cycles) {
      const row = validateCycle(index, cycle, `books.${bookId}.cycles.${cycle.versionId as string}`);
      if (row) return row;
      const versionClaim = claims.get(claimKey('cycleVersion', cycle.versionId as string));
      if (versionClaim === undefined) {
        return fail(`books.${bookId}.cycles.${cycle.versionId as string}`, 'orphan-record', 'cycle version is not named by a validated receipt effect');
      }
    }
    for (const entry of index.state.entries) {
      const row = validateEntry(index, entry, operations, claims, `books.${bookId}.entries.${entry.entryId as string}`);
      if (row) return row;
    }
    for (const obligation of index.state.obligations) {
      const path = `books.${bookId}.obligations.${obligation.obligationId as string}`;
      const amount = positive(obligation.expectedAmount, `${path}.expectedAmount`);
      if (amount) return amount;
      const cycle = requireCycle(index, obligation.cycleId as string, `${path}.cycleId`);
      if (cycle) return cycle;
      const source = requireProvenance(
        claims,
        operations,
        obligation.sourceOperationId as string,
        claimKey('obligation', obligation.obligationId as string),
        bookId,
        `${path}.sourceOperationId`,
      );
      if (source) return source;
      const createdAt = instant(obligation.createdAtInstantMs, `${path}.createdAtInstantMs`);
      if (createdAt) return createdAt;
    }
    for (const event of index.state.obligationEvents) {
      const path = `books.${bookId}.obligationEvents.${event.eventId as string}`;
      if (!index.obligations.has(event.obligationId as string)) return fail(`${path}.obligationId`, 'orphan-record', `${path} names an unknown obligation`);
      const source = requireProvenance(
        claims,
        operations,
        event.sourceOperationId as string,
        claimKey('obligationEvent', event.eventId as string),
        bookId,
        `${path}.sourceOperationId`,
      );
      if (source) return source;
    }
    for (const goal of index.state.goals) {
      const path = `books.${bookId}.goals.${goal.goalId as string}`;
      const amount = positive(goal.targetAmount, `${path}.targetAmount`);
      if (amount) return amount;
      const source = requireProvenance(claims, operations, goal.sourceOperationId as string, claimKey('goal', goal.goalId as string), bookId, `${path}.sourceOperationId`);
      if (source) return source;
    }
    for (const allocation of index.state.allocationRecords) {
      const path = `books.${bookId}.allocationRecords.${allocation.recordId as string}`;
      const cycle = requireCycle(index, allocation.cycleId as string, `${path}.cycleId`);
      if (cycle) return cycle;
      const source = requireProvenance(
        claims,
        operations,
        allocation.sourceOperationId as string,
        claimKey('allocation', allocation.recordId as string),
        bookId,
        `${path}.sourceOperationId`,
      );
      if (source) return source;
      const movement = allocationMovement(allocation.change);
      if (movement !== null) {
        const amount = positive(movement, `${path}.change.amount`);
        if (amount) return amount;
      }
      if (allocation.change.type === 'assignment' || allocation.change.type === 'unassignment') {
        const goal = index.goals.get(allocation.change.goalId as string);
        if (goal === undefined) return fail(`${path}.change.goalId`, 'orphan-record', `${path} names an unknown goal`);
      }
      if (allocation.change.type === 'release') {
        if (allocation.change.goalId !== null && !index.goals.has(allocation.change.goalId as string)) {
          return fail(`${path}.change.goalId`, 'orphan-record', `${path} names an unknown goal`);
        }
        const dest = requireCycle(index, allocation.change.destinationCycleId as string, `${path}.change.destinationCycleId`);
        if (dest) return dest;
      }
      if (allocation.change.type === 'reversal') {
        const target = index.allocations.get(allocation.change.reversesRecordId as string);
        if (target === undefined) return fail(`${path}.change.reversesRecordId`, 'orphan-record', `${path} reverses an unknown allocation`);
        const targetAmount = allocationMovement(target.change);
        if (targetAmount === null) return fail(`${path}.change.reversesRecordId`, 'invalid-reference', `${path} cannot reverse a reversal`);
      }
    }
    if (index.state.buffer !== null) {
      const buffer = nonNegative(index.state.buffer.amount, `books.${bookId}.buffer.amount`);
      if (buffer) return buffer;
      const source = requireProvenance(
        claims,
        operations,
        index.state.buffer.sourceOperationId as string,
        claimKey('buffer', bookId),
        bookId,
        `books.${bookId}.buffer.sourceOperationId`,
      );
      if (source) return source;
    }
    for (const observation of index.state.observations) {
      const path = `books.${bookId}.observations.${observation.observationId as string}`;
      const pool = nonNegative(observation.observedPool, `${path}.observedPool`);
      if (pool) return pool;
      const cycle = requireCycle(index, observation.cycleId as string, `${path}.cycleId`);
      if (cycle) return cycle;
      const version = index.versions.get(observation.versionId as string);
      if (version === undefined) return fail(`${path}.versionId`, 'orphan-record', `${path} names an unknown cycle version`);
      if ((version.cycleId as string) !== (observation.cycleId as string)) {
        return fail(`${path}.versionId`, 'invalid-reference', `${path} version does not belong to the observation cycle`);
      }
      const source = requireProvenance(
        claims,
        operations,
        observation.sourceOperationId as string,
        claimKey('observation', observation.observationId as string),
        bookId,
        `${path}.sourceOperationId`,
      );
      if (source) return source;
    }
    for (const adjustment of index.state.adjustments) {
      const path = `books.${bookId}.adjustments.${adjustment.adjustmentId as string}`;
      const observation = index.observations.get(adjustment.observationId as string);
      if (observation === undefined) return fail(`${path}.observationId`, 'orphan-record', `${path} names an unknown observation`);
      if ((observation.cycleId as string) !== (adjustment.cycleId as string)) {
        return fail(`${path}.cycleId`, 'invalid-reference', `${path} adjustment cycle does not match its observation`);
      }
      const cycle = requireCycle(index, adjustment.cycleId as string, `${path}.cycleId`);
      if (cycle) return cycle;
      const source = requireProvenance(
        claims,
        operations,
        adjustment.sourceOperationId as string,
        claimKey('adjustment', adjustment.adjustmentId as string),
        bookId,
        `${path}.sourceOperationId`,
      );
      if (source) return source;
    }
    for (const link of index.state.recoveryLinks) {
      const path = `books.${bookId}.recoveryLinks.${link.linkId as string}`;
      if (!index.observations.has(link.observationId as string)) return fail(`${path}.observationId`, 'orphan-record', `${path} names an unknown observation`);
      if (!index.adjustments.has(link.adjustmentId as string)) return fail(`${path}.adjustmentId`, 'orphan-record', `${path} names an unknown adjustment`);
      const entry = index.entries.get(link.entryId as string);
      if (entry === undefined) return fail(`${path}.entryId`, 'orphan-record', `${path} names an unknown entry`);
      const expectedKind = link.movementKind === 'expense' ? 'expense' : link.movementKind === 'inflow' ? 'inflow' : 'expenseReturn';
      if (entry.kind !== expectedKind) return fail(`${path}.entryId`, 'invalid-reference', `${path} recovery movement kind does not match the entry`);
      const source = requireProvenance(
        claims,
        operations,
        link.sourceOperationId as string,
        claimKey('recovery', link.linkId as string),
        bookId,
        `${path}.sourceOperationId`,
      );
      if (source) return source;
    }
    for (const plan of index.state.plans) {
      const path = `books.${bookId}.plans.${plan.planId as string}`;
      const source = requireProvenance(claims, operations, plan.sourceOperationId as string, claimKey('plan', plan.planId as string), bookId, `${path}.sourceOperationId`);
      if (source) return source;
    }
    for (const revision of index.state.planRevisions) {
      const path = `books.${bookId}.planRevisions.${revision.revisionId as string}`;
      const plan = index.plans.get(revision.planId as string);
      if (plan === undefined) return fail(`${path}.planId`, 'orphan-record', `${path} names an unknown plan`);
      const amount = positive(revision.amount, `${path}.amount`);
      if (amount) return amount;
      const source = requireProvenance(
        claims,
        operations,
        revision.sourceOperationId as string,
        claimKey('planRevision', revision.revisionId as string),
        bookId,
        `${path}.sourceOperationId`,
      );
      if (source) return source;
    }
    for (const occurrence of index.state.planOccurrences) {
      const path = `books.${bookId}.planOccurrences.${occurrence.occurrenceId as string}`;
      const plan = index.plans.get(occurrence.planId as string);
      if (plan === undefined) return fail(`${path}.planId`, 'orphan-record', `${path} names an unknown plan`);
      const revision = index.planRevisions.get(occurrence.revisionId as string);
      if (revision === undefined) return fail(`${path}.revisionId`, 'orphan-record', `${path} names an unknown plan revision`);
      if ((revision.planId as string) !== (occurrence.planId as string)) {
        return fail(`${path}.revisionId`, 'invalid-reference', `${path} revision does not belong to the occurrence plan`);
      }
      const cycle = requireCycle(index, occurrence.dueCycleId as string, `${path}.dueCycleId`);
      if (cycle) return cycle;
      if (occurrence.linkedObligationId !== null && !index.obligations.has(occurrence.linkedObligationId as string)) {
        return fail(`${path}.linkedObligationId`, 'orphan-record', `${path} names an unknown obligation`);
      }
      if (occurrence.linkedExpenseEntryId !== null) {
        const linked = index.entries.get(occurrence.linkedExpenseEntryId as string);
        if (linked === undefined || linked.kind !== 'expense') {
          return fail(`${path}.linkedExpenseEntryId`, 'invalid-reference', `${path} names an unknown expense`);
        }
      }
      const source = requireProvenance(
        claims,
        operations,
        occurrence.sourceOperationId as string,
        claimKey('occurrence', occurrence.occurrenceId as string),
        bookId,
        `${path}.sourceOperationId`,
      );
      if (source) return source;
    }
    for (const settings of index.state.settingsRevisions) {
      const path = `books.${bookId}.settingsRevisions.${settings.settingsRevisionId as string}`;
      const source = requireProvenance(
        claims,
        operations,
        settings.sourceOperationId as string,
        claimKey('settings', settings.settingsRevisionId as string),
        bookId,
        `${path}.sourceOperationId`,
      );
      if (source) return source;
    }
    for (const settlement of index.state.settlements) {
      const path = `books.${bookId}.settlements.${settlement.settlementId as string}`;
      const cycle = requireCycle(index, settlement.cycleId as string, `${path}.cycleId`);
      if (cycle) return cycle;
      const version = index.versions.get(settlement.versionId as string);
      if (version === undefined) return fail(`${path}.versionId`, 'orphan-record', `${path} names an unknown cycle version`);
      if ((version.cycleId as string) !== (settlement.cycleId as string)) {
        return fail(`${path}.versionId`, 'invalid-reference', `${path} version does not belong to the settlement cycle`);
      }
      const identity = settlementIdentity(settlement, path);
      if (identity) return identity;
      const closed = instant(settlement.closedAtInstantMs, `${path}.closedAtInstantMs`);
      if (closed) return closed;
      const asOf = instant(settlement.dataAsOfInstantMs, `${path}.dataAsOfInstantMs`);
      if (asOf) return asOf;
      const source = requireProvenance(
        claims,
        operations,
        settlement.sourceOperationId as string,
        claimKey('settlement', settlement.settlementId as string),
        bookId,
        `${path}.sourceOperationId`,
      );
      if (source) return source;
    }
    for (const carry of index.state.carryActions) {
      const path = `books.${bookId}.carryActions.${carry.carryId as string}`;
      const settlement = index.settlements.get(carry.settlementId as string);
      if (settlement === undefined) return fail(`${path}.settlementId`, 'orphan-record', `${path} names an unknown settlement`);
      if ((settlement.cycleId as string) !== (carry.sourceCycleId as string)) {
        return fail(`${path}.sourceCycleId`, 'invalid-reference', `${path} source cycle does not match the named settlement`);
      }
      const cycle = requireCycle(index, carry.sourceCycleId as string, `${path}.sourceCycleId`);
      if (cycle) return cycle;
      const disposition = carry.disposition;
      if (disposition.kind === 'carryIn' || disposition.kind === 'fundTracked') {
        const amount = positive(disposition.amount, `${path}.disposition.amount`);
        if (amount) return amount;
      }
      if (disposition.kind === 'split') {
        const carryAmount = positive(disposition.carryAmount, `${path}.disposition.carryAmount`);
        if (carryAmount) return carryAmount;
        const fundAmount = positive(disposition.fundAmount, `${path}.disposition.fundAmount`);
        if (fundAmount) return fundAmount;
      }
      if (disposition.kind === 'carryIn' || disposition.kind === 'split') {
        const dest = requireCycle(index, disposition.destinationCycleId as string, `${path}.disposition.destinationCycleId`);
        if (dest) return dest;
      }
      const source = requireProvenance(
        claims,
        operations,
        carry.sourceOperationId as string,
        claimKey('carry', carry.carryId as string),
        bookId,
        `${path}.sourceOperationId`,
      );
      if (source) return source;
    }
    for (const delta of index.state.propagationDeltas) {
      const path = `books.${bookId}.propagationDeltas.${delta.deltaId as string}`;
      const settlement = index.settlements.get(delta.settlementId as string);
      if (settlement === undefined) return fail(`${path}.settlementId`, 'orphan-record', `${path} names an unknown settlement`);
      if ((settlement.cycleId as string) !== (delta.sourceCycleId as string)) {
        return fail(`${path}.sourceCycleId`, 'invalid-reference', `${path} source cycle does not match the named settlement`);
      }
      if (!index.entries.has(delta.correctionEntryId as string)) return fail(`${path}.correctionEntryId`, 'orphan-record', `${path} names an unknown correction`);
      if (delta.carryActionId !== null && !index.carry.has(delta.carryActionId as string)) {
        return fail(`${path}.carryActionId`, 'orphan-record', `${path} names an unknown carry`);
      }
      const source = requireProvenance(
        claims,
        operations,
        delta.sourceOperationId as string,
        claimKey('delta', delta.deltaId as string),
        bookId,
        `${path}.sourceOperationId`,
      );
      if (source) return source;
    }
    for (const conflict of index.state.propagationConflicts) {
      const path = `books.${bookId}.propagationConflicts.${conflict.conflictId as string}`;
      const settlement = index.settlements.get(conflict.settlementId as string);
      if (settlement === undefined) return fail(`${path}.settlementId`, 'orphan-record', `${path} names an unknown settlement`);
      if ((settlement.cycleId as string) !== (conflict.sourceCycleId as string)) {
        return fail(`${path}.sourceCycleId`, 'invalid-reference', `${path} source cycle does not match the named settlement`);
      }
      if (!index.entries.has(conflict.correctionEntryId as string)) return fail(`${path}.correctionEntryId`, 'orphan-record', `${path} names an unknown correction`);
      const source = requireProvenance(
        claims,
        operations,
        conflict.sourceOperationId as string,
        claimKey('conflict', conflict.conflictId as string),
        bookId,
        `${path}.sourceOperationId`,
      );
      if (source) return source;
    }
    for (const resolution of index.state.conflictResolutions) {
      const path = `books.${bookId}.conflictResolutions.${resolution.resolutionId as string}`;
      const conflict = index.conflicts.get(resolution.conflictId as string);
      if (conflict === undefined) return fail(`${path}.conflictId`, 'orphan-record', `${path} names an unknown conflict`);
      if ((conflict.settlementId as string) !== (resolution.settlementId as string)) {
        return fail(`${path}.settlementId`, 'invalid-reference', `${path} resolution settlement does not belong to the named conflict`);
      }
      if (!index.settlements.has(resolution.settlementId as string)) return fail(`${path}.settlementId`, 'orphan-record', `${path} names an unknown settlement`);
      const source = requireProvenance(
        claims,
        operations,
        resolution.sourceOperationId as string,
        claimKey('resolution', resolution.resolutionId as string),
        bookId,
        `${path}.sourceOperationId`,
      );
      if (source) return source;
    }

    const bookOps = opsByBook.get(bookId) ?? [];
    if (bookOps.length !== index.state.revision) {
      return fail(`books.${bookId}.revision`, 'revision-idempotency-conflict', 'book revision does not equal the number of journal edges');
    }
    const byBefore = new Map<number, OperationRecord>();
    for (const operation of bookOps) {
      if (byBefore.has(operation.receipt.revisionBefore)) {
        return fail(`operations.${operation.operationId as string}.receipt.revisionBefore`, 'revision-idempotency-conflict', 'revision edge is forked');
      }
      byBefore.set(operation.receipt.revisionBefore, operation);
    }
    for (let revision = 0; revision < index.state.revision; revision += 1) {
      const operation = byBefore.get(revision);
      if (operation === undefined) {
        return fail(`books.${bookId}.revision`, 'revision-idempotency-conflict', `missing revision edge ${revision} -> ${revision + 1}`);
      }
      if (operation.receipt.revisionAfter !== revision + 1) {
        return fail(`operations.${operation.operationId as string}.receipt.revisionAfter`, 'revision-idempotency-conflict', 'receipt does not advance exactly one revision');
      }
      if (revision === 0 && operation.receipt.commandKind !== 'createBook') {
        return fail(`operations.${operation.operationId as string}.receipt.commandKind`, 'revision-idempotency-conflict', 'first revision edge must be createBook');
      }
    }
  }
  const replayed = replayJournal(books, opsByBook, commands);
  if (replayed) return replayed;
  for (const delivery of input.delivery) {
    if (delivery.schemaVersion !== SYNC_RECORD_SCHEMA_VERSION) {
      return fail(
        `delivery.${delivery.outboxId}.schemaVersion`,
        'malformed-record',
        'legacy sync records without handler-clock provenance are unsupported',
      );
    }
    const lease = instant(delivery.leaseExpiresAtMs, `delivery.${delivery.outboxId}.leaseExpiresAtMs`);
    if (lease) return lease;
    const retry = instant(delivery.nextRetryAtMs, `delivery.${delivery.outboxId}.nextRetryAtMs`);
    if (retry) return retry;
  }
  return { ok: true };
}
