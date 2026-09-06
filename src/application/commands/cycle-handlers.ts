/**
 * Handlers for settings revisions, open-cycle rebase, close, disposition,
 * reopen, closed-cycle corrections, and propagation conflicts.
 *
 * Version rows are append-only and never mutated: rebase and reopen append a
 * new version, close appends a settlement snapshot, and the effective
 * lifecycle status derives from those records. Financial facts, observations,
 * adjustments, revisions, and settlements are append-only and never
 * rewritten. A carry source is consumed only once. Backdated corrections
 * against a closed cycle — new facts as well as linked corrections and voids
 * of closed-cycle facts — are always accepted: they propagate as exact
 * linked deltas while the downstream is untouched, and as explicit
 * unresolved conflicts otherwise, degrading completeness until an explicit
 * resolution.
 */

import { compareCivilDates, type CivilDate } from '../../domain/primitives/civil-date';
import { resolveCivilDate } from '../../domain/primitives/instant';
import { cycleStartForMonth, isDateWithinMonthlyWindow, monthlyCycleContaining } from '../../domain/primitives/monthly-cycle';
import { makeMoney, type Money } from '../../domain/primitives/money';
import {
  carryActionFor,
  countEntriesOutsideWindow,
  countFactsOutsideWindow,
  downstreamConsumedKinds,
  downstreamState,
  effectiveAnchorForDate,
  effectiveSettlementRemainder,
  effectiveTimeZoneForDate,
  fitsWithinRemainder,
  nextSettlementSeq,
  overlapsOtherCycle,
  subtractOrThrow,
  sumDispositionTotal,
} from '../../domain/cycles/derive';
import {
  effectiveFamilyRefunds,
  expenseCorrectionFamily,
  findExpenseReversalOf,
  findExpenseReturnReversalOf,
  isExpenseLive,
  returnableAmountForExpense,
} from '../../domain/activity/derive';
import {
  deriveObligationViews,
  effectiveObligationReturns,
  grossLivePaymentsFor,
} from '../../domain/obligations/derive';
import { computeAvailability, deriveActiveCycleLedger } from '../../domain/calculations/availability';
import { computeCompleteness } from '../../domain/calculations/completeness';
import {
  findEffectiveCycleVersion,
  findEffectiveSettlement,
  findEntryById,
  findOpenCycle,
  findReversalOf,
  findSettlementById,
  effectiveVersionStatus,
  type BookState,
  type CycleRecord,
  type ExpenseEntry,
  type ExpenseReturnEntry,
  type LedgerEntry,
} from '../../domain/contracts/ledger';
import type {
  CloseCycleCommand,
  DisposeCycleRemainderCommand,
  RebaseOpenCycleCommand,
  RecordClosedCycleCorrectionCommand,
  ReopenCycleCommand,
  ResolvePropagationConflictCommand,
  UpdateBookSettingsCommand,
} from '../../domain/contracts/commands';
import type { MonthlyCycleAnchor } from '../../domain/primitives/monthly-cycle';
import type { CycleId, EntryId, OperationId } from '../../domain/contracts/identity';
import type { CommandContext } from './context';
import type { ApplyResult, HandlerRefs } from './handlers';
import {
  currencyMismatchFailure,
  monthParts,
  newAllocationRecordId,
  newCycleVersionId,
  newEntryId,
  newSettlementId,
  occurredInstantOf,
  requireOpenCycle,
  resolveOccurredAt,
} from './handler-support';

function zeroOf(currency: Money['currency']): Money {
  const made = makeMoney(currency, 0);
  if (!made.ok) throw new TypeError('book currency must be supported');
  return made.value;
}

function anchorsEqual(left: MonthlyCycleAnchor, right: MonthlyCycleAnchor): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'payday' && right.kind === 'payday') return left.dayOfMonth === right.dayOfMonth;
  return true;
}

export function applyUpdateBookSettings(
  command: UpdateBookSettingsCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
): ApplyResult {
  const anchor = command.cycleAnchor ?? effectiveAnchorForDate(state, command.effectiveDate);
  const timeZone = command.timeZone ?? effectiveTimeZoneForDate(state, command.effectiveDate);

  const parts = monthParts(command.effectiveDate);
  const expectedStart = cycleStartForMonth(anchor, parts.year, parts.month);
  if (!expectedStart.ok || expectedStart.value !== command.effectiveDate) {
    return {
      ok: false,
      failure: {
        kind: 'invalidEffectiveDate',
        bookId: command.bookId,
        detail: `effective ${command.effectiveDate} is not anchor-aligned under the new settings`,
      },
    };
  }

  for (const cycle of state.cycles) {
    if (compareCivilDates(command.effectiveDate, cycle.startDate) <= 0) {
      return {
        ok: false,
        failure: {
          kind: 'invalidEffectiveDate',
          bookId: command.bookId,
          detail: `effective ${command.effectiveDate} would move the existing cycle starting ${cycle.startDate}; settings edits govern the next unopened cycle only`,
        },
      };
    }
  }
  if (state.settingsRevisions.some((revision) => revision.effectiveDate === command.effectiveDate)) {
    return {
      ok: false,
      failure: {
        kind: 'invalidEffectiveDate',
        bookId: command.bookId,
        detail: `a settings revision already takes effect at ${command.effectiveDate}`,
      },
    };
  }

  const capturedAtInstantMs = context.clock.nowMs();
  const revision = {
    settingsRevisionId: newEntryId(context, 'settings-revision'),
    bookId: command.bookId,
    effectiveDate: command.effectiveDate,
    timeZone,
    cycleAnchor: anchor,
    weekStart: command.weekStart,
    note: command.note,
    capturedAtInstantMs,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };
  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    settingsRevisions: [...state.settingsRevisions, revision],
  };
  return {
    ok: true,
    nextState,
    effects: [{ kind: 'bookSettingsUpdated', effectiveDate: command.effectiveDate }],
  };
}

export function applyRebaseOpenCycle(
  command: RebaseOpenCycleCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
): ApplyResult {
  void operationId;
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const current = openCycle.value;

  if (current.timeZone === command.timeZone && anchorsEqual(current.anchor, command.cycleAnchor)) {
    return { ok: false, failure: { kind: 'rebaseNotNeeded', bookId: command.bookId, cycleId: current.cycleId } };
  }

  const window = monthlyCycleContaining(command.cycleAnchor, current.startDate);

  // Safe rebase: every dated fact attributed to this logical cycle must lie
  // inside the candidate window, and the window must not overlap any other
  // logical cycle. A fact outside the new window (or an overlap) needs an
  // explicit accounting treatment first; the rebase writes nothing.
  const excluded = countFactsOutsideWindow(state, current.cycleId, window.startDate, window.endDateExclusive);
  if (excluded > 0) {
    return {
      ok: false,
      failure: {
        kind: 'invalidRebase',
        bookId: command.bookId,
        cycleId: current.cycleId,
        detail: `${excluded} attributed fact(s) fall outside the candidate window ${window.startDate} to ${window.endDateExclusive}; record an explicit accounting treatment before rebasing`,
      },
    };
  }
  if (overlapsOtherCycle(state, current.cycleId, window.startDate, window.endDateExclusive)) {
    return {
      ok: false,
      failure: {
        kind: 'invalidRebase',
        bookId: command.bookId,
        cycleId: current.cycleId,
        detail: `the candidate window ${window.startDate} to ${window.endDateExclusive} overlaps another cycle; rebase must not create gaps or overlaps`,
      },
    };
  }

  const versionSeq = current.versionSeq + 1;
  const openedAtInstantMs = context.clock.nowMs();
  // Append-only: the prior version row is untouched; it becomes effectively
  // superseded through this version's `supersedesVersionId` link.
  const next = {
    ...current,
    versionId: newCycleVersionId(command.bookId, current.startDate, versionSeq),
    versionSeq,
    startDate: window.startDate,
    endDateExclusive: window.endDateExclusive,
    anchor: command.cycleAnchor,
    timeZone: command.timeZone,
    openedAtInstantMs,
    supersedesVersionId: current.versionId,
  };
  const unmovedOutsideWindow = countEntriesOutsideWindow(state, current, window.startDate, window.endDateExclusive);
  const zero = zeroOf(state.book.currency);

  const nextState: BookState = { ...state, revision: state.revision + 1, cycles: [...state.cycles, next] };
  return {
    ok: true,
    nextState,
    effects: [
      {
        kind: 'openCycleRebased',
        cycleId: current.cycleId,
        oldVersionId: current.versionId,
        newVersionId: next.versionId,
        oldStartDate: current.startDate,
        newStartDate: next.startDate,
        oldEndDateExclusive: current.endDateExclusive,
        newEndDateExclusive: next.endDateExclusive,
        allocationDelta: zero,
        carryDelta: zero,
        unmovedOutsideWindow,
      },
    ],
  };
}

export function applyCloseCycle(
  command: CloseCycleCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
): ApplyResult {
  const openCycle = findOpenCycle(state);
  const targetId = command.cycleId ?? openCycle?.cycleId ?? null;
  if (targetId === null) {
    return { ok: false, failure: { kind: 'noOpenCycle', bookId: command.bookId } };
  }
  const version = findEffectiveCycleVersion(state, targetId);
  if (version === null) {
    return { ok: false, failure: { kind: 'unknownCycle', bookId: command.bookId, cycleId: targetId } };
  }
  const versionStatus = effectiveVersionStatus(state, version);
  if (versionStatus === 'closed') {
    return { ok: false, failure: { kind: 'cycleAlreadyClosed', bookId: command.bookId, cycleId: version.cycleId } };
  }
  if (versionStatus !== 'open') {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`cycle ${version.cycleId} version ${version.versionSeq} is ${versionStatus}, not open`] },
    };
  }

  const capturedAtInstantMs = context.clock.nowMs();
  const ledger = deriveActiveCycleLedger(state, version);
  const openResiduals = deriveObligationViews(state)
    .filter((view) => view.status === 'open')
    .map((view) => view.residualReservation);
  let reservedCommitments = zeroOf(state.book.currency);
  for (const residual of openResiduals) {
    reservedCommitments = addOrThrow(reservedCommitments, residual);
  }
  const availability = computeAvailability(state, { asOfInstantMs: capturedAtInstantMs, calculationVersion: context.calculationVersion });
  if (availability.status !== 'computed') {
    throw new TypeError('availability must be computed while the closed version is open');
  }
  const completeness = computeCompleteness(state, { asOfInstantMs: capturedAtInstantMs, calculationVersion: context.calculationVersion });

  // Append-only close: the version row is untouched and becomes effectively
  // closed through this settlement's `versionId` reference. The snapshot
  // carries the close time and every frozen component.
  const settlementSeq = nextSettlementSeq(state, version.cycleId);
  const settlement = {
    settlementId: newSettlementId(command.bookId, version.startDate, settlementSeq),
    bookId: command.bookId,
    cycleId: version.cycleId,
    versionId: version.versionId,
    settlementSeq,
    reversed: false,
    startingFunds: ledger.startingFunds,
    netInflows: ledger.netInflows,
    netOutflows: ledger.netActualOutflows,
    netReturns: ledger.netReturns,
    netAdjustments: ledger.netAdjustments,
    carryIn: ledger.carryIn,
    reservedCommitments,
    netAllocations: ledger.netCycleAllocations,
    buffer: state.buffer === null ? zeroOf(state.book.currency) : state.buffer.amount,
    availability: availability.available,
    poolCompleteness: completeness.pool.state,
    classificationCompleteness: completeness.classification.state,
    dataAsOfInstantMs: capturedAtInstantMs,
    calculationVersion: context.calculationVersion,
    closedAtInstantMs: capturedAtInstantMs,
    sourceOperationId: operationId,
  };

  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    settlements: [...state.settlements, settlement],
  };
  return {
    ok: true,
    nextState,
    effects: [
      {
        kind: 'cycleClosed',
        cycleId: version.cycleId,
        versionId: version.versionId,
        settlementId: settlement.settlementId,
        availability: availability.available,
      },
    ],
  };
}

function addOrThrow(left: Money, right: Money): Money {
  const sum = left.minorUnits + right.minorUnits;
  if (!Number.isSafeInteger(sum)) throw new TypeError('reservation sum is not a safe integer');
  return { currency: left.currency, minorUnits: sum };
}

export function applyDisposeCycleRemainder(
  command: DisposeCycleRemainderCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  void refs;
  const settlement = findSettlementById(state, command.settlementId);
  if (settlement === null) {
    const located = refs.locateSettlement(command.settlementId);
    if (located !== null && located.bookId !== command.bookId) {
      return {
        ok: false,
        failure: {
          kind: 'crossBookSettlement',
          bookId: command.bookId,
          settlementId: command.settlementId,
          settlementBookId: located.bookId,
        },
      };
    }
    return { ok: false, failure: { kind: 'unknownSettlement', bookId: command.bookId, settlementId: command.settlementId } };
  }

  const effective = findEffectiveSettlement(state, settlement.cycleId);
  if (effective === null || effective.settlementId !== settlement.settlementId) {
    return {
      ok: false,
      failure: {
        kind: 'invalidDisposition',
        bookId: command.bookId,
        settlementId: command.settlementId,
        detail: 'the settlement is superseded by a newer settlement and can no longer be disposed',
      },
    };
  }
  const version = findEffectiveCycleVersion(state, settlement.cycleId);
  if (version === null || effectiveVersionStatus(state, version) !== 'closed') {
    return {
      ok: false,
      failure: {
        kind: 'invalidDisposition',
        bookId: command.bookId,
        settlementId: command.settlementId,
        detail: 'the settlement cycle is not closed',
      },
    };
  }
  const existing = carryActionFor(state, settlement.settlementId);
  if (existing !== null) {
    return {
      ok: false,
      failure: {
        kind: 'carryAlreadyConsumed',
        bookId: command.bookId,
        settlementId: command.settlementId,
        existingCarryId: existing.carryId,
      },
    };
  }

  const remainder = effectiveSettlementRemainder(state, settlement);
  const disposition = command.disposition;
  // A carry destination must resolve to an existing open cycle of this
  // book: committing a remainder to a nonexistent (or closed) cycle would
  // leave it on no current or known future basis.
  const requireOpenDestination = (
    destinationCycleId: CycleId,
  ): { ok: true } | { ok: false; failure: import('../../domain/contracts/commands').CommandFailure } => {
    const destination = findEffectiveCycleVersion(state, destinationCycleId);
    if (destination === null || destination.bookId !== command.bookId) {
      return {
        ok: false,
        failure: {
          kind: 'invalidDisposition',
          bookId: command.bookId,
          settlementId: command.settlementId,
          detail: `destination ${destinationCycleId} does not resolve to a cycle of this book`,
        },
      };
    }
    if (effectiveVersionStatus(state, destination) !== 'open') {
      return {
        ok: false,
        failure: {
          kind: 'invalidDisposition',
          bookId: command.bookId,
          settlementId: command.settlementId,
          detail: `destination ${destinationCycleId} is not open; carry lands only on an existing open cycle`,
        },
      };
    }
    return { ok: true };
  };
  if (disposition.kind === 'carryIn') {
    if (disposition.amount.currency !== state.book.currency) {
      return currencyMismatchFailure(command.bookId, state.book.currency, disposition.amount.currency);
    }
    const destination = requireOpenDestination(disposition.destinationCycleId);
    if (!destination.ok) return destination;
    if (!fitsWithinRemainder(remainder, disposition.amount)) {
      return {
        ok: false,
        failure: {
          kind: 'invalidDisposition',
          bookId: command.bookId,
          settlementId: command.settlementId,
          detail: `carry ${disposition.amount.minorUnits} exceeds the free remainder ${remainder.minorUnits}`,
        },
      };
    }
  } else if (disposition.kind === 'fundTracked') {
    if (disposition.amount.currency !== state.book.currency) {
      return currencyMismatchFailure(command.bookId, state.book.currency, disposition.amount.currency);
    }
    if (!fitsWithinRemainder(remainder, disposition.amount)) {
      return {
        ok: false,
        failure: {
          kind: 'invalidDisposition',
          bookId: command.bookId,
          settlementId: command.settlementId,
          detail: `funding ${disposition.amount.minorUnits} exceeds the free remainder ${remainder.minorUnits}`,
        },
      };
    }
  } else if (disposition.kind === 'split') {
    for (const amount of [disposition.carryAmount, disposition.fundAmount]) {
      if (amount.currency !== state.book.currency) {
        return currencyMismatchFailure(command.bookId, state.book.currency, amount.currency);
      }
    }
    const destination = requireOpenDestination(disposition.destinationCycleId);
    if (!destination.ok) return destination;
    const total = sumDispositionTotal(disposition);
    if (total === null || !fitsWithinRemainder(remainder, total)) {
      return {
        ok: false,
        failure: {
          kind: 'invalidDisposition',
          bookId: command.bookId,
          settlementId: command.settlementId,
          detail: 'the split total exceeds the free remainder',
        },
      };
    }
  }

  const fundAmount = disposition.kind === 'fundTracked' ? disposition.amount : disposition.kind === 'split' ? disposition.fundAmount : null;
  const openCycle = findOpenCycle(state);
  if (fundAmount !== null && fundAmount.minorUnits > 0 && openCycle === null) {
    return {
      ok: false,
      failure: {
        kind: 'invalidDisposition',
        bookId: command.bookId,
        settlementId: command.settlementId,
        detail: 'tracked funding needs an open cycle to attribute the spending deduction',
      },
    };
  }

  const capturedAtInstantMs = context.clock.nowMs();
  const carry = {
    carryId: newEntryId(context, 'carry'),
    bookId: command.bookId,
    settlementId: command.settlementId,
    sourceCycleId: settlement.cycleId,
    disposition: toStoredDisposition(disposition),
    note: command.note,
    capturedAtInstantMs,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };

  if (fundAmount !== null && fundAmount.minorUnits > 0 && openCycle !== null) {
    const resolved = resolveCivilDate(capturedAtInstantMs, openCycle.timeZone);
    if (!resolved.ok) {
      return {
        ok: false,
        failure: { kind: 'invalidCommand', issues: [`disposition date could not be resolved (${resolved.failure.reason})`] },
      };
    }
    const funding = {
      kind: 'allocation' as const,
      recordId: newAllocationRecordId(context),
      bookId: command.bookId,
      cycleId: openCycle.cycleId,
      localDate: resolved.value,
      change: { type: 'funding' as const, amount: fundAmount },
      note: command.note,
      occurredAtInstantMs: capturedAtInstantMs,
      capturedAtInstantMs,
      capturedInTimeZone: openCycle.timeZone,
      calculationVersion: context.calculationVersion,
      sourceOperationId: operationId,
    };
    const nextState: BookState = {
      ...state,
      revision: state.revision + 1,
      carryActions: [...state.carryActions, carry],
      allocationRecords: [...state.allocationRecords, funding],
    };
    return {
      ok: true,
      nextState,
      effects: [{ kind: 'cycleRemainderDisposed', settlementId: command.settlementId, carryId: carry.carryId, dispositionKind: disposition.kind }],
    };
  }

  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    carryActions: [...state.carryActions, carry],
  };
  return {
    ok: true,
    nextState,
    effects: [{ kind: 'cycleRemainderDisposed', settlementId: command.settlementId, carryId: carry.carryId, dispositionKind: disposition.kind }],
  };
}

function toStoredDisposition(
  disposition: DisposeCycleRemainderCommand['disposition'],
): import('../../domain/contracts/ledger').RemainderDisposition {
  return disposition;
}

export function applyReopenCycle(
  command: ReopenCycleCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
): ApplyResult {
  void operationId;
  const version = findEffectiveCycleVersion(state, command.cycleId);
  if (version === null) {
    return { ok: false, failure: { kind: 'unknownCycle', bookId: command.bookId, cycleId: command.cycleId } };
  }
  if (effectiveVersionStatus(state, version) !== 'closed') {
    return { ok: false, failure: { kind: 'cycleNotClosed', bookId: command.bookId, cycleId: command.cycleId } };
  }
  const openCycle = findOpenCycle(state);
  if (openCycle !== null) {
    return { ok: false, failure: { kind: 'cycleAlreadyOpen', bookId: command.bookId, openCycleId: openCycle.cycleId } };
  }
  const settlement = findEffectiveSettlement(state, command.cycleId);
  if (settlement === null) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`closed cycle ${command.cycleId} owns no settlement`] },
    };
  }

  // The new open version is the reversal record: the closed snapshot and the
  // closed version row stay byte-for-byte, and the chain shows exactly what
  // reopened it.
  const nextVersion = {
    ...version,
    versionId: newCycleVersionId(command.bookId, version.startDate, version.versionSeq + 1),
    versionSeq: version.versionSeq + 1,
    openedAtInstantMs: context.clock.nowMs(),
    supersedesVersionId: version.versionId,
  };
  const nextState: BookState = { ...state, revision: state.revision + 1, cycles: [...state.cycles, nextVersion] };
  return {
    ok: true,
    nextState,
    effects: [
      {
        kind: 'cycleReopened',
        cycleId: command.cycleId,
        reopenedSettlementId: settlement.settlementId,
        newVersionId: nextVersion.versionId,
      },
    ],
  };
}

export function applyRecordClosedCycleCorrection(
  command: RecordClosedCycleCorrectionCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const version = findEffectiveCycleVersion(state, command.targetCycleId);
  if (version === null) {
    return { ok: false, failure: { kind: 'unknownCycle', bookId: command.bookId, cycleId: command.targetCycleId } };
  }
  if (effectiveVersionStatus(state, version) === 'open') {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`cycle ${command.targetCycleId} is open; use the ordinary activity commands`] },
    };
  }
  if (effectiveVersionStatus(state, version) !== 'closed') {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`cycle ${command.targetCycleId} version ${version.versionSeq} is not closed`] },
    };
  }

  if (command.amount.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, command.amount.currency);
  }
  const localDate = resolveOccurredAt(command.occurredAt, version.timeZone, command.bookId);
  if (!localDate.ok) return localDate;
  if (!isDateWithinMonthlyWindow(localDate.value, { startDate: version.startDate, endDateExclusive: version.endDateExclusive })) {
    return {
      ok: false,
      failure: {
        kind: 'invalidBoundary',
        bookId: command.bookId,
        detail: `the correction date ${localDate.value} lies outside the closed cycle ${command.targetCycleId}`,
      },
    };
  }

  const capturedAtInstantMs = context.clock.nowMs();
  const built =
    command.correctsEntryId !== null
      ? buildLinkedClosedCorrection(state, command, version, localDate.value, capturedAtInstantMs, context, operationId, refs)
      : buildNewClosedCorrectionFact(state, command, version, localDate.value, capturedAtInstantMs, context, operationId, refs);
  if (!built.ok) return built;

  const settlement = findEffectiveSettlement(state, command.targetCycleId);
  if (settlement === null) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`closed cycle ${command.targetCycleId} owns no settlement`] },
    };
  }
  return appendPropagatedCorrection(state, command, settlement, built.value, context, operationId, capturedAtInstantMs);
}

interface BuiltClosedCorrection {
  readonly entries: readonly LedgerEntry[];
  /** Signed effect on the settlement remainder. */
  readonly signed: Money;
  /** The reversal entry for corrections, otherwise the new fact. */
  readonly primaryEntryId: EntryId;
  readonly replacementEntryId: EntryId | null;
  readonly correctsEntryId: EntryId | null;
}

type BuiltClosedCorrectionResult =
  | { readonly ok: true; readonly value: BuiltClosedCorrection }
  | { readonly ok: false; readonly failure: import('../../domain/contracts/commands').CommandFailure };

function negateOrThrow(value: Money): Money {
  return { currency: value.currency, minorUnits: value.minorUnits === 0 ? 0 : -value.minorUnits };
}

/**
 * Builds a new backdated fact against a closed cycle. Return facts name
 * their refunded expense and respect the same returnable cap as live
 * returns; everything lands in the target cycle with its financial
 * occurrence, never in the open cycle.
 */function buildNewClosedCorrectionFact(
  state: BookState,
  command: RecordClosedCycleCorrectionCommand,
  version: CycleRecord,
  localDate: CivilDate,
  capturedAtInstantMs: number,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): BuiltClosedCorrectionResult {
  let linkedExpenseId: EntryId | null = null;
  if (command.movementKind === 'return') {
    const targetId = command.linkedExpenseEntryId;
    if (targetId === null) {
      return {
        ok: false,
        failure: { kind: 'invalidCommand', issues: ['a recovered return must name the refunded expense'] },
      };
    }
    const target = findEntryById(state, targetId);
    if (target === null) {
      const located = refs.locateEntry(targetId);
      if (located !== null && located.bookId !== command.bookId) {
        return {
          ok: false,
          failure: { kind: 'crossBookReference', bookId: command.bookId, entryId: targetId, entryBookId: located.bookId },
        };
      }
      return { ok: false, failure: { kind: 'unknownEntry', bookId: command.bookId, entryId: targetId } };
    }
    if (target.kind !== 'expense') {
      return { ok: false, failure: { kind: 'notAnExpense', bookId: command.bookId, entryId: targetId } };
    }
    if (findExpenseReversalOf(state, target.entryId) !== null) {
      const existing = findExpenseReversalOf(state, target.entryId);
      return {
        ok: false,
        failure: {
          kind: 'duplicateReversal',
          bookId: command.bookId,
          entryId: target.entryId,
          existingReversalEntryId: existing === null ? target.entryId : existing.entryId,
        },
      };
    }
    if (target.cycleId !== command.targetCycleId) {
      return {
        ok: false,
        failure: {
          kind: 'invalidBoundary',
          bookId: command.bookId,
          detail: `the refunded expense belongs to cycle ${target.cycleId}, not the correction cycle ${command.targetCycleId}`,
        },
      };
    }
    const returnable = returnableAmountForExpense(state, target);
    if (!returnable.ok) {
      return {
        ok: false,
        failure: { kind: 'invalidCommand', issues: [`returnable amount could not be derived (${returnable.failure.reason})`] },
      };
    }
    if (command.amount.minorUnits > returnable.value.minorUnits) {
      return {
        ok: false,
        failure: {
          kind: 'returnExceedsReturnable',
          bookId: command.bookId,
          targetKind: 'expense',
          targetId: target.entryId,
          requested: command.amount,
          returnable: returnable.value,
        },
      };
    }
    linkedExpenseId = target.entryId;
  }

  const entryId = newEntryId(context, 'closed-correction');
  let entry: LedgerEntry;
  if (command.movementKind === 'expense') {
    entry = {
      kind: 'expense',
      entryId,
      bookId: command.bookId,
      cycleId: command.targetCycleId,
      localDate,
      timeZone: version.timeZone,
      amount: command.amount,
      note: command.note,
      category: command.category,
      flexibleDefinitionId: null,
      linkedObligationId: null,
      replacesEntryId: null,
      occurredAtInstantMs: occurredInstantOf(command.occurredAt),
      capturedAtInstantMs,
      capturedInTimeZone: version.timeZone,
      calculationVersion: context.calculationVersion,
      sourceOperationId: operationId,
    };
  } else if (command.movementKind === 'inflow') {
    entry = {
      kind: 'inflow',
      entryId,
      bookId: command.bookId,
      cycleId: command.targetCycleId,
      localDate,
      timeZone: version.timeZone,
      amount: command.amount,
      note: command.note,
      occurredAtInstantMs: occurredInstantOf(command.occurredAt),
      capturedAtInstantMs,
      capturedInTimeZone: version.timeZone,
      calculationVersion: context.calculationVersion,
      sourceOperationId: operationId,
    };
  } else {
    entry = {
      kind: 'expenseReturn',
      entryId,
      bookId: command.bookId,
      cycleId: command.targetCycleId,
      localDate,
      timeZone: version.timeZone,
      amount: command.amount,
      linkedExpenseEntryId: linkedExpenseId,
      linkedObligationId: null,
      replacesReturnEntryId: null,
      note: command.note,
      occurredAtInstantMs: occurredInstantOf(command.occurredAt),
      capturedAtInstantMs,
      capturedInTimeZone: version.timeZone,
      calculationVersion: context.calculationVersion,
      sourceOperationId: operationId,
    };
  }

  const signed = command.movementKind === 'expense' ? negateOrThrow(command.amount) : command.amount;
  return {
    ok: true,
    value: { entries: [entry], signed, primaryEntryId: entryId, replacementEntryId: null, correctsEntryId: null },
  };
}

function moneyEqual(left: Money, right: Money): boolean {
  return left.currency === right.currency && left.minorUnits === right.minorUnits;
}

/** The live leaf of an expense correction family (the current replacement). */
function liveFamilyHead(state: BookState, expenseEntryId: EntryId): ExpenseEntry | null {
  let head: ExpenseEntry | null = null;
  for (const entry of expenseCorrectionFamily(state, expenseEntryId)) {
    if (isExpenseLive(state, entry.entryId)) head = entry;
  }
  return head;
}

/**
 * Builds a linked correction (or void) of a live closed-cycle fact: a
 * reversal plus, unless voiding, its replacement, all attributed to the
 * closed cycle with the command's financial occurrence. Correction-family
 * refund caps and obligation-net guards match the live commands, so a
 * closed-period correction can never strand refunds or drive an obligation
 * net negative. The top-level amount confirms the replacement (or the voided
 * target) so no amount is ever silently reinterpreted.
 */
function buildLinkedClosedCorrection(
  state: BookState,
  command: RecordClosedCycleCorrectionCommand,
  version: CycleRecord,
  localDate: CivilDate,
  capturedAtInstantMs: number,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): BuiltClosedCorrectionResult {
  const targetId = command.correctsEntryId;
  if (targetId === null) {
    return { ok: false, failure: { kind: 'invalidCommand', issues: ['a linked correction names no target'] } };
  }
  const target = findEntryById(state, targetId);
  if (target === null) {
    const located = refs.locateEntry(targetId);
    if (located !== null && located.bookId !== command.bookId) {
      return {
        ok: false,
        failure: { kind: 'crossBookReference', bookId: command.bookId, entryId: targetId, entryBookId: located.bookId },
      };
    }
    return { ok: false, failure: { kind: 'unknownEntry', bookId: command.bookId, entryId: targetId } };
  }
  if (target.cycleId !== command.targetCycleId) {
    return {
      ok: false,
      failure: {
        kind: 'invalidBoundary',
        bookId: command.bookId,
        detail: `the corrected fact belongs to cycle ${target.cycleId}, not the correction cycle ${command.targetCycleId}`,
      },
    };
  }

  const expectedKind = command.movementKind === 'expense' ? 'expense' : command.movementKind === 'inflow' ? 'inflow' : 'expenseReturn';
  if (target.kind !== expectedKind) {
    if (command.movementKind === 'expense') {
      return { ok: false, failure: { kind: 'notAnExpense', bookId: command.bookId, entryId: targetId } };
    }
    if (command.movementKind === 'inflow') {
      return { ok: false, failure: { kind: 'notAnInflow', bookId: command.bookId, entryId: targetId } };
    }
    return { ok: false, failure: { kind: 'notAReturn', bookId: command.bookId, entryId: targetId } };
  }

  const alreadyReversed =
    target.kind === 'expense'
      ? findExpenseReversalOf(state, target.entryId) !== null
      : target.kind === 'inflow'
        ? findReversalOf(state, target.entryId) !== null
        : findExpenseReturnReversalOf(state, target.entryId) !== null;
  if (alreadyReversed) {
    const existingId =
      target.kind === 'expense'
        ? (findExpenseReversalOf(state, target.entryId)?.entryId ?? target.entryId)
        : target.kind === 'inflow'
          ? (findReversalOf(state, target.entryId)?.entryId ?? target.entryId)
          : (findExpenseReturnReversalOf(state, target.entryId)?.entryId ?? target.entryId);
    return {
      ok: false,
      failure: { kind: 'duplicateReversal', bookId: command.bookId, entryId: target.entryId, existingReversalEntryId: existingId },
    };
  }

  const replacementAmount = command.replacement?.amount ?? null;
  if (replacementAmount !== null && replacementAmount.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, replacementAmount.currency);
  }
  const confirmed = replacementAmount ?? target.amount;
  if (!moneyEqual(command.amount, confirmed)) {
    return {
      ok: false,
      failure: {
        kind: 'invalidCommand',
        issues: ['amount must confirm the replacement amount, or the voided target amount when voiding'],
      },
    };
  }
  const replMinor = replacementAmount?.minorUnits ?? 0;

  // Correction-family and obligation-net guards, matching the live commands.
  if (target.kind === 'expense') {
    const familyRefunds = effectiveFamilyRefunds(state, target.entryId);
    if (!familyRefunds.ok) {
      return {
        ok: false,
        failure: { kind: 'invalidCommand', issues: [`family refunds could not be derived (${familyRefunds.failure.reason})`] },
      };
    }
    if (replMinor < familyRefunds.value.minorUnits) {
      return {
        ok: false,
        failure: {
          kind: 'returnExceedsReturnable',
          bookId: command.bookId,
          targetKind: 'expense',
          targetId: target.entryId,
          requested: familyRefunds.value,
          returnable: replacementAmount ?? { currency: target.amount.currency, minorUnits: 0 },
        },
      };
    }
    if (target.linkedObligationId !== null) {
      const gross = grossLivePaymentsFor(state, target.linkedObligationId);
      const refunds = effectiveObligationReturns(state, target.linkedObligationId);
      if (gross === null || refunds === null) {
        return {
          ok: false,
          failure: { kind: 'invalidCommand', issues: [`obligation ${target.linkedObligationId} payments could not be derived`] },
        };
      }
      const newGrossMinor = gross.minorUnits - target.amount.minorUnits + replMinor;
      if (newGrossMinor < refunds.minorUnits) {
        return {
          ok: false,
          failure: {
            kind: 'returnExceedsReturnable',
            bookId: command.bookId,
            targetKind: 'obligation',
            targetId: target.linkedObligationId,
            requested: refunds,
            returnable: { currency: gross.currency, minorUnits: newGrossMinor },
          },
        };
      }
    }
  } else if (target.kind === 'expenseReturn') {
    if (target.linkedExpenseEntryId !== null) {
      const familyRefunds = effectiveFamilyRefunds(state, target.linkedExpenseEntryId);
      if (!familyRefunds.ok) {
        return {
          ok: false,
          failure: { kind: 'invalidCommand', issues: [`family refunds could not be derived (${familyRefunds.failure.reason})`] },
        };
      }
      const newTotalMinor = familyRefunds.value.minorUnits - target.amount.minorUnits + replMinor;
      const head = liveFamilyHead(state, target.linkedExpenseEntryId);
      if (head === null) {
        return {
          ok: false,
          failure: { kind: 'invalidCommand', issues: [`correction family of ${target.linkedExpenseEntryId} has no live expense`] },
        };
      }
      if (newTotalMinor > head.amount.minorUnits) {
        return {
          ok: false,
          failure: {
            kind: 'returnExceedsReturnable',
            bookId: command.bookId,
            targetKind: 'expense',
            targetId: head.entryId,
            requested: { currency: familyRefunds.value.currency, minorUnits: newTotalMinor },
            returnable: head.amount,
          },
        };
      }
    } else if (target.linkedObligationId !== null) {
      const refunds = effectiveObligationReturns(state, target.linkedObligationId);
      const gross = grossLivePaymentsFor(state, target.linkedObligationId);
      if (refunds === null || gross === null) {
        return {
          ok: false,
          failure: { kind: 'invalidCommand', issues: [`obligation ${target.linkedObligationId} returns could not be derived`] },
        };
      }
      const newTotalMinor = refunds.minorUnits - target.amount.minorUnits + replMinor;
      if (newTotalMinor > gross.minorUnits) {
        return {
          ok: false,
          failure: {
            kind: 'returnExceedsReturnable',
            bookId: command.bookId,
            targetKind: 'obligation',
            targetId: target.linkedObligationId,
            requested: { currency: refunds.currency, minorUnits: newTotalMinor },
            returnable: gross,
          },
        };
      }
    } else {
      return {
        ok: false,
        failure: { kind: 'invalidCommand', issues: [`return ${target.entryId} links to neither an expense nor an obligation`] },
      };
    }
  }

  const negated = negateOrThrow(target.amount);
  const reversalId = newEntryId(context, 'closed-correction');
  const entries: LedgerEntry[] = [];
  if (target.kind === 'expense') {
    entries.push({
      kind: 'expenseReversal',
      entryId: reversalId,
      bookId: command.bookId,
      cycleId: command.targetCycleId,
      localDate,
      timeZone: version.timeZone,
      amount: negated,
      reversesEntryId: target.entryId,
      note: command.note,
      occurredAtInstantMs: occurredInstantOf(command.occurredAt),
      capturedAtInstantMs,
      capturedInTimeZone: version.timeZone,
      calculationVersion: context.calculationVersion,
      sourceOperationId: operationId,
    });
  } else if (target.kind === 'inflow') {
    entries.push({
      kind: 'inflowReversal',
      entryId: reversalId,
      bookId: command.bookId,
      cycleId: command.targetCycleId,
      localDate,
      timeZone: version.timeZone,
      amount: negated,
      reversesEntryId: target.entryId,
      note: command.note,
      occurredAtInstantMs: occurredInstantOf(command.occurredAt),
      capturedAtInstantMs,
      capturedInTimeZone: version.timeZone,
      calculationVersion: context.calculationVersion,
      sourceOperationId: operationId,
    });
  } else {
    entries.push({
      kind: 'expenseReturnReversal',
      entryId: reversalId,
      bookId: command.bookId,
      cycleId: command.targetCycleId,
      localDate,
      timeZone: version.timeZone,
      amount: negated,
      reversesEntryId: target.entryId,
      linkedExpenseEntryId: target.linkedExpenseEntryId,
      linkedObligationId: target.linkedObligationId,
      note: command.note,
      occurredAtInstantMs: occurredInstantOf(command.occurredAt),
      capturedAtInstantMs,
      capturedInTimeZone: version.timeZone,
      calculationVersion: context.calculationVersion,
      sourceOperationId: operationId,
    });
  }

  let replacementEntryId: EntryId | null = null;
  if (replacementAmount !== null) {
    replacementEntryId = newEntryId(context, 'closed-correction');
    const replacementNote = command.replacement?.note ?? target.note;
    if (target.kind === 'expense') {
      const replacement: ExpenseEntry = {
        kind: 'expense',
        entryId: replacementEntryId,
        bookId: command.bookId,
        cycleId: command.targetCycleId,
        localDate,
        timeZone: version.timeZone,
        amount: replacementAmount,
        note: replacementNote,
        category: target.category,
        flexibleDefinitionId: target.flexibleDefinitionId,
        linkedObligationId: target.linkedObligationId,
        replacesEntryId: target.entryId,
        occurredAtInstantMs: occurredInstantOf(command.occurredAt),
        capturedAtInstantMs,
        capturedInTimeZone: version.timeZone,
        calculationVersion: context.calculationVersion,
        sourceOperationId: operationId,
      };
      entries.push(replacement);
    } else if (target.kind === 'inflow') {
      entries.push({
        kind: 'inflow',
        entryId: replacementEntryId,
        bookId: command.bookId,
        cycleId: command.targetCycleId,
        localDate,
        timeZone: version.timeZone,
        amount: replacementAmount,
        note: replacementNote,
        occurredAtInstantMs: occurredInstantOf(command.occurredAt),
        capturedAtInstantMs,
        capturedInTimeZone: version.timeZone,
        calculationVersion: context.calculationVersion,
        sourceOperationId: operationId,
      });
    } else {
      const replacement: ExpenseReturnEntry = {
        kind: 'expenseReturn',
        entryId: replacementEntryId,
        bookId: command.bookId,
        cycleId: command.targetCycleId,
        localDate,
        timeZone: version.timeZone,
        amount: replacementAmount,
        linkedExpenseEntryId: (target as ExpenseReturnEntry).linkedExpenseEntryId,
        linkedObligationId: (target as ExpenseReturnEntry).linkedObligationId,
        replacesReturnEntryId: target.entryId,
        note: replacementNote,
        occurredAtInstantMs: occurredInstantOf(command.occurredAt),
        capturedAtInstantMs,
        capturedInTimeZone: version.timeZone,
        calculationVersion: context.calculationVersion,
        sourceOperationId: operationId,
      };
      entries.push(replacement);
    }
  }

  // Net signed effect on the settlement remainder: shrinking an outflow (or
  // growing an inflow/return) raises it, and vice versa.
  const targetMoney = target.amount;
  const replacementMoney = replacementAmount ?? zeroOf(targetMoney.currency);
  const signed =
    target.kind === 'expense'
      ? subtractOrThrow(targetMoney, replacementMoney, 'closed correction delta could not be derived')
      : subtractOrThrow(replacementMoney, targetMoney, 'closed correction delta could not be derived');
  return {
    ok: true,
    value: { entries, signed, primaryEntryId: reversalId, replacementEntryId, correctsEntryId: target.entryId },
  };
}

/**
 * Appends built correction facts and propagates their signed effect. The
 * mere existence of a disposition is never a conflict: an untouched
 * downstream receives the exact delta (linked to the standing action so the
 * carry basis follows it); only a subsequently changed downstream produces
 * an explicit unresolved conflict alongside the still-accepted correction.
 * A tracked funding that already stood works the same way, except the
 * completed funding movement is never rewritten — the delta joins the
 * remainder view and the pool records decide touchedness.
 */
function appendPropagatedCorrection(
  state: BookState,
  command: RecordClosedCycleCorrectionCommand,
  settlement: { readonly settlementId: import('../../domain/contracts/identity').SettlementId },
  built: BuiltClosedCorrection,
  context: CommandContext,
  operationId: OperationId,
  capturedAtInstantMs: number,
): ApplyResult {
  const downstream = downstreamState(state, settlement.settlementId);
  if (downstream !== 'changed') {
    const standing = carryActionFor(state, settlement.settlementId);
    const delta = {
      deltaId: newEntryId(context, 'propagation-delta'),
      bookId: command.bookId,
      settlementId: settlement.settlementId,
      sourceCycleId: command.targetCycleId,
      correctionEntryId: built.primaryEntryId,
      carryActionId: standing === null ? null : standing.carryId,
      deltaAmount: built.signed,
      note: command.note,
      capturedAtInstantMs,
      calculationVersion: context.calculationVersion,
      sourceOperationId: operationId,
    };
    const nextState: BookState = {
      ...state,
      revision: state.revision + 1,
      entries: [...state.entries, ...built.entries],
      propagationDeltas: [...state.propagationDeltas, delta],
    };
    return {
      ok: true,
      nextState,
      effects: [
        {
          kind: 'closedCycleCorrectionRecorded',
          entryId: built.primaryEntryId,
          targetCycleId: command.targetCycleId,
          settlementId: settlement.settlementId,
          propagation: 'applied',
          deltaAmount: built.signed,
          correctsEntryId: built.correctsEntryId,
          replacementEntryId: built.replacementEntryId,
        },
      ],
    };
  }

  const kinds = downstreamConsumedKinds(state, settlement.settlementId);
  if (kinds === null) {
    throw new TypeError('a changed downstream requires a standing disposition');
  }
  const conflict = {
    conflictId: newEntryId(context, 'propagation-conflict'),
    bookId: command.bookId,
    settlementId: settlement.settlementId,
    sourceCycleId: command.targetCycleId,
    correctionEntryId: built.primaryEntryId,
    unpropagatedAmount: built.signed,
    downstreamKind: kinds,
    note: command.note,
    capturedAtInstantMs,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };
  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    entries: [...state.entries, ...built.entries],
    propagationConflicts: [...state.propagationConflicts, conflict],
  };
  return {
    ok: true,
    nextState,
    effects: [
      {
        kind: 'closedCycleCorrectionRecorded',
        entryId: built.primaryEntryId,
        targetCycleId: command.targetCycleId,
        settlementId: settlement.settlementId,
        propagation: 'conflicted',
        deltaAmount: built.signed,
        correctsEntryId: built.correctsEntryId,
        replacementEntryId: built.replacementEntryId,
      },
    ],
  };
}

export function applyResolvePropagationConflict(
  command: ResolvePropagationConflictCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  void refs;
  const conflict = state.propagationConflicts.find((candidate) => candidate.conflictId === command.conflictId) ?? null;
  if (conflict === null) {
    return { ok: false, failure: { kind: 'unknownConflict', bookId: command.bookId, conflictId: command.conflictId } };
  }
  // Append-only resolution: the conflict row is never mutated. A second
  // resolution attempt finds the first and reports it as already resolved.
  if (state.conflictResolutions.some((resolution) => resolution.conflictId === command.conflictId)) {
    return { ok: false, failure: { kind: 'conflictAlreadyResolved', bookId: command.bookId, conflictId: command.conflictId } };
  }
  const resolution = {
    resolutionId: newEntryId(context, 'conflict-resolution'),
    bookId: command.bookId,
    conflictId: command.conflictId,
    settlementId: conflict.settlementId,
    resolution: command.resolution,
    note: command.note,
    capturedAtInstantMs: context.clock.nowMs(),
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };
  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    conflictResolutions: [...state.conflictResolutions, resolution],
  };
  return {
    ok: true,
    nextState,
    effects: [{ kind: 'propagationConflictResolved', conflictId: command.conflictId }],
  };
}
