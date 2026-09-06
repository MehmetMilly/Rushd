/**
 * Handlers for boundary cycles, Reality Check observations, and recovery.
 *
 * The observation names the full physically-left pool (goal-earmarked and
 * obligation-reserved money included) and derives a boundary-specific signed
 * adjustment against the ledger-derived pool — never against availability.
 * Recovering pre-boundary activity appends the actual fact and links it to
 * the boundary, consuming the unexplained difference exactly once; later
 * corrections and reversals recompute the residual forward through the
 * derivation, not through stored mutation. Ambiguous same-date recoveries
 * clarify instead of guessing.
 */

import { subtractMoney } from '../../domain/primitives/money';
import { isDateWithinMonthlyWindow, monthlyCycleContaining } from '../../domain/primitives/monthly-cycle';
import { resolveCivilDateTime } from '../../domain/primitives/instant';
import { effectiveAnchorForDate, effectiveTimeZoneForDate, overlapsOtherCycle } from '../../domain/cycles/derive';
import {
  boundaryFromObservation,
  classifyCurrencyLabel,
  compareOccurrenceToBoundary,
  compareResolvedBoundaries,
  deriveLedgerPoolAt,
  earliestCoveringObservation,
  type ResolvedBoundary,
} from '../../domain/recovery/derive';
import { findExpenseReversalOf, returnableAmountForExpense } from '../../domain/activity/derive';
import { composeCycleId, type EntryId, type OperationId } from '../../domain/contracts/identity';
import {
  findAdjustmentByObservation,
  findEffectiveCycleVersion,
  findEntryById,
  findObservationById,
  findOpenCycle,
  effectiveVersionStatus,
  type BookState,
  type CycleRecord,
  type LedgerEntry,
  type RealityCheckObservation,
} from '../../domain/contracts/ledger';
import type {
  CommandFailure,
  ObservationBoundary,
  OpenBoundaryCycleCommand,
  RecoverObservedActivityCommand,
  RecordRealityCheckCommand,
} from '../../domain/contracts/commands';
import type { BookId } from '../../domain/contracts/identity';
import type { TimeZoneName } from '../../domain/primitives/instant';
import type { CivilDate } from '../../domain/primitives/civil-date';
import type { CommandContext } from './context';
import type { ApplyResult, HandlerRefs } from './handlers';
import {
  currencyMismatchFailure,
  newCycleVersionId,
  newEntryId,
  newObservationId,
  occurredInstantOf,
  requireOpenCycle,
  resolveOccurredAt,
} from './handler-support';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Resolves a command boundary in the governing timezone: instants resolve
 * through the creation timezone first, then re-resolve once under the
 * effective timezone at that date (deterministic across DST rules);
 * civil boundaries use the effective timezone at their date directly.
 */
function resolveBoundaryInput(
  boundary: ObservationBoundary,
  state: BookState,
  bookId: BookId,
): { ok: true; value: ResolvedBoundary } | { ok: false; failure: CommandFailure } {
  if (boundary.kind === 'instant') {
    const first = resolveCivilDateTime(boundary.instantMs, state.book.timeZone);
    if (!first.ok) {
      return {
        ok: false,
        failure: { kind: 'invalidBoundary', bookId, detail: `instant ${boundary.instantMs} could not be resolved (${first.failure.reason})` },
      };
    }
    const timeZone = effectiveTimeZoneForDate(state, first.value.localDate);
    const resolved = resolveCivilDateTime(boundary.instantMs, timeZone);
    if (!resolved.ok) {
      return {
        ok: false,
        failure: { kind: 'invalidBoundary', bookId, detail: `instant ${boundary.instantMs} could not be resolved in ${timeZone} (${resolved.failure.reason})` },
      };
    }
    return {
      ok: true,
      value: {
        localDate: resolved.value.localDate,
        localTime: `${pad2(resolved.value.hour)}:${pad2(resolved.value.minute)}:${pad2(resolved.value.second)}`,
        instantMs: boundary.instantMs,
        timeZone,
      },
    };
  }
  const timeZone = effectiveTimeZoneForDate(state, boundary.localDate);
  return {
    ok: true,
    value: { localDate: boundary.localDate, localTime: boundary.localTime, instantMs: null, timeZone },
  };
}

function boundaryKeyOf(boundary: ResolvedBoundary): string {
  return boundary.instantMs !== null ? `i:${boundary.instantMs}` : `c:${boundary.localDate}T${boundary.localTime}`;
}

function storedBoundaryKey(observation: RealityCheckObservation): string {
  return observation.boundaryInstantMs !== null
    ? `i:${observation.boundaryInstantMs}`
    : `c:${observation.boundaryLocalDate}T${observation.boundaryLocalTime ?? '00:00:00'}`;
}

function boundaryTimeZoneOf(state: BookState, date: CivilDate): TimeZoneName {
  return effectiveTimeZoneForDate(state, date);
}

export function applyOpenBoundaryCycle(command: OpenBoundaryCycleCommand, state: BookState, context: CommandContext): ApplyResult {
  const openCycle = findOpenCycle(state);
  if (openCycle !== null) {
    return { ok: false, failure: { kind: 'cycleAlreadyOpen', bookId: command.bookId, openCycleId: openCycle.cycleId } };
  }
  if (command.observedPool.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, command.observedPool.currency);
  }

  const boundary = resolveBoundaryInput(command.boundary, state, command.bookId);
  if (!boundary.ok) return boundary;

  const anchor = effectiveAnchorForDate(state, boundary.value.localDate);
  const window = monthlyCycleContaining(anchor, boundary.value.localDate);
  const cycleIdResult = composeCycleId(command.bookId, window.startDate);
  if (!cycleIdResult.ok) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`cycle id could not be composed (${cycleIdResult.failure.detail})`] },
    };
  }
  const existing = findEffectiveCycleVersion(state, cycleIdResult.value);
  if (existing !== null) {
    if (effectiveVersionStatus(state, existing) === 'closed') {
      return { ok: false, failure: { kind: 'cycleAlreadyClosed', bookId: command.bookId, cycleId: existing.cycleId } };
    }
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`cycle ${existing.cycleId} already has version ${existing.versionSeq}`] },
    };
  }
  if (overlapsOtherCycle(state, cycleIdResult.value, window.startDate, window.endDateExclusive)) {
    return {
      ok: false,
      failure: {
        kind: 'invalidCycleStart',
        bookId: command.bookId,
        requestedStartDate: window.startDate,
        expectedStartDate: window.startDate,
      },
    };
  }

  const timeZone = boundaryTimeZoneOf(state, boundary.value.localDate);
  const cycle: CycleRecord = {
    versionId: newCycleVersionId(command.bookId, window.startDate, 1),
    cycleId: cycleIdResult.value,
    bookId: command.bookId,
    versionSeq: 1,
    mode: 'remainingFromBoundary',
    startDate: window.startDate,
    endDateExclusive: window.endDateExclusive,
    anchor,
    startingFunds: command.observedPool,
    openedAtInstantMs: context.clock.nowMs(),
    boundaryObservedPool: command.observedPool,
    boundaryLocalDate: boundary.value.localDate,
    boundaryLocalTime: boundary.value.localTime,
    boundaryInstantMs: boundary.value.instantMs,
    boundaryTimeZone: boundary.value.timeZone,
    timeZone,
    supersedesVersionId: null,
  };
  const nextState: BookState = { ...state, revision: state.revision + 1, cycles: [...state.cycles, cycle] };
  return {
    ok: true,
    nextState,
    effects: [
      {
        kind: 'boundaryCycleOpened',
        cycleId: cycle.cycleId,
        versionId: cycle.versionId,
        startDate: cycle.startDate,
        endDateExclusive: cycle.endDateExclusive,
        observedPool: command.observedPool,
      },
    ],
  };
}

export function applyRecordRealityCheck(
  command: RecordRealityCheckCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  void refs;
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const cycle = openCycle.value;

  if (command.observedPool.currency !== state.book.currency) {
    return {
      ok: false,
      failure: {
        kind: 'clarificationNeeded',
        bookId: command.bookId,
        reason: 'foreignCurrency',
        detail: `the observation names ${command.observedPool.currency} but the book uses ${state.book.currency}; version 1 performs no conversion`,
      },
    };
  }
  const label = classifyCurrencyLabel(command.currencyLabel, state.book.currency);
  if (label === 'foreign') {
    return {
      ok: false,
      failure: {
        kind: 'clarificationNeeded',
        bookId: command.bookId,
        reason: 'foreignCurrency',
        detail: `the named currency '${command.currencyLabel}' is not the book currency ${state.book.currency}; version 1 performs no conversion`,
      },
    };
  }
  if (label === 'ambiguous') {
    return {
      ok: false,
      failure: {
        kind: 'clarificationNeeded',
        bookId: command.bookId,
        reason: 'ambiguousCurrency',
        detail: `the named currency '${command.currencyLabel}' cannot be resolved unambiguously to ${state.book.currency}`,
      },
    };
  }

  const boundary = resolveBoundaryInput(command.boundary, state, command.bookId);
  if (!boundary.ok) return boundary;
  if (!isDateWithinMonthlyWindow(boundary.value.localDate, { startDate: cycle.startDate, endDateExclusive: cycle.endDateExclusive })) {
    return {
      ok: false,
      failure: {
        kind: 'invalidBoundary',
        bookId: command.bookId,
        detail: `boundary ${boundary.value.localDate} lies outside the open cycle ${cycle.cycleId}`,
      },
    };
  }

  const key = boundaryKeyOf(boundary.value);
  const duplicate = state.observations.find(
    (observation) => observation.cycleId === cycle.cycleId && storedBoundaryKey(observation) === key,
  );
  if (duplicate !== undefined) {
    return {
      ok: false,
      failure: { kind: 'duplicateObservation', bookId: command.bookId, cycleId: cycle.cycleId, observationId: duplicate.observationId },
    };
  }

  // Observations chain forward in boundary order. Inserting a boundary
  // before an accepted later boundary would stack the same observed gap
  // twice: the later adjustment's ledger would newly include this one while
  // keeping its recorded amount. Reject with no write instead of accepting
  // a materially wrong money answer.
  for (const existing of state.observations) {
    if (existing.cycleId !== cycle.cycleId) continue;
    if (compareResolvedBoundaries(boundaryFromObservation(existing), boundary.value) > 0) {
      return {
        ok: false,
        failure: {
          kind: 'invalidBoundary',
          bookId: command.bookId,
          detail: `boundary ${boundary.value.localDate} precedes the accepted boundary ${existing.boundaryLocalDate} in this cycle; observations chain forward and a backdated boundary needs an explicit observation correction`,
        },
      };
    }
  }

  const ledgerPool = deriveLedgerPoolAt(state, cycle, boundary.value);
  const reconciled = subtractMoney(command.observedPool, ledgerPool);
  if (!reconciled.ok) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`reconciliation could not be derived (${reconciled.failure.reason})`] },
    };
  }

  const capturedAtInstantMs = context.clock.nowMs();
  const observationId = newObservationId(context);
  const observation: RealityCheckObservation = {
    observationId,
    bookId: command.bookId,
    cycleId: cycle.cycleId,
    versionId: cycle.versionId,
    observedPool: command.observedPool,
    boundaryLocalDate: boundary.value.localDate,
    boundaryLocalTime: boundary.value.localTime,
    boundaryInstantMs: boundary.value.instantMs,
    boundaryTimeZone: boundary.value.timeZone,
    currencyLabel: command.currencyLabel,
    note: command.note,
    capturedAtInstantMs,
    capturedInTimeZone: cycle.timeZone,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };
  const adjustment = {
    kind: 'adjustment' as const,
    adjustmentId: newEntryId(context, 'adjustment'),
    bookId: command.bookId,
    cycleId: cycle.cycleId,
    observationId,
    amount: reconciled.value,
    classificationNote: command.classificationNote,
    capturedAtInstantMs,
    capturedInTimeZone: cycle.timeZone,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };
  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    observations: [...state.observations, observation],
    adjustments: [...state.adjustments, adjustment],
  };
  return {
    ok: true,
    nextState,
    effects: [
      {
        kind: 'realityCheckRecorded',
        observationId,
        cycleId: cycle.cycleId,
        observedPool: command.observedPool,
        ledgerPool,
        adjustmentAmount: reconciled.value,
      },
    ],
  };
}

export function applyRecoverObservedActivity(
  command: RecoverObservedActivityCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const observation = findObservationById(state, command.observationId);
  if (observation === null) {
    const located = refs.locateObservation(command.observationId);
    if (located !== null && located.bookId !== command.bookId) {
      return {
        ok: false,
        failure: {
          kind: 'crossBookObservation',
          bookId: command.bookId,
          observationId: command.observationId,
          observationBookId: located.bookId,
        },
      };
    }
    return { ok: false, failure: { kind: 'unknownObservation', bookId: command.bookId, observationId: command.observationId } };
  }

  const version = findEffectiveCycleVersion(state, observation.cycleId);
  if (version === null) {
    return { ok: false, failure: { kind: 'unknownCycle', bookId: command.bookId, cycleId: observation.cycleId } };
  }
  const versionStatus = effectiveVersionStatus(state, version);
  if (versionStatus !== 'open') {
    return {
      ok: false,
      failure: {
        kind: 'invalidRecoveryBoundary',
        bookId: command.bookId,
        observationId: command.observationId,
        detail: `cycle ${observation.cycleId} is ${versionStatus}; backdated activity against a closed cycle uses recordClosedCycleCorrection`,
      },
    };
  }

  if (command.amount.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, command.amount.currency);
  }

  const localDate = resolveOccurredAt(command.occurredAt, observation.boundaryTimeZone, command.bookId);
  if (!localDate.ok) return localDate;
  const boundary = boundaryFromObservation(observation);
  const order = compareOccurrenceToBoundary(
    { localDate: localDate.value, instantMs: occurredInstantOf(command.occurredAt) },
    boundary,
  );
  if (order === 'after') {
    return {
      ok: false,
      failure: {
        kind: 'invalidRecoveryBoundary',
        bookId: command.bookId,
        observationId: command.observationId,
        detail: `the activity occurred after the observation boundary ${observation.boundaryLocalDate}`,
      },
    };
  }
  if (order === 'ambiguous') {
    return {
      ok: false,
      failure: {
        kind: 'clarificationNeeded',
        bookId: command.bookId,
        reason: 'ambiguousBoundaryOrder',
        detail: `the activity shares the boundary's local date ${observation.boundaryLocalDate} without instant evidence to order it; name an explicit instant before or after the boundary`,
      },
    };
  }
  // The recovery must attach to the earliest covering boundary: linking it
  // to a later one would change earlier ledgers without consuming their
  // adjustments and break those observed-pool invariants.
  const earliest = earliestCoveringObservation(
    state,
    observation.cycleId,
    { localDate: localDate.value, instantMs: occurredInstantOf(command.occurredAt) },
  );
  if (earliest !== null && earliest.observationId !== observation.observationId) {
    return {
      ok: false,
      failure: {
        kind: 'invalidRecoveryBoundary',
        bookId: command.bookId,
        observationId: command.observationId,
        detail: `the activity is also covered by the earlier boundary ${earliest.boundaryLocalDate}; link the recovery to observation ${earliest.observationId}`,
      },
    };
  }
  if (!isDateWithinMonthlyWindow(localDate.value, { startDate: version.startDate, endDateExclusive: version.endDateExclusive })) {
    return {
      ok: false,
      failure: {
        kind: 'invalidRecoveryBoundary',
        bookId: command.bookId,
        observationId: command.observationId,
        detail: `the activity date ${localDate.value} lies outside the observation cycle ${observation.cycleId}`,
      },
    };
  }

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
    if (target.cycleId !== observation.cycleId) {
      return {
        ok: false,
        failure: {
          kind: 'invalidRecoveryBoundary',
          bookId: command.bookId,
          observationId: command.observationId,
          detail: `the refunded expense belongs to cycle ${target.cycleId}, not the observation cycle ${observation.cycleId}`,
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

  const adjustment = findAdjustmentByObservation(state, observation.observationId);
  if (adjustment === null) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`observation ${observation.observationId} owns no adjustment`] },
    };
  }

  const capturedAtInstantMs = context.clock.nowMs();
  const entryId = newEntryId(context, 'recovery');
  let entry: LedgerEntry;
  if (command.movementKind === 'expense') {
    entry = {
      kind: 'expense',
      entryId,
      bookId: command.bookId,
      cycleId: observation.cycleId,
      localDate: localDate.value,
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
      cycleId: observation.cycleId,
      localDate: localDate.value,
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
      cycleId: observation.cycleId,
      localDate: localDate.value,
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

  const link = {
    linkId: newEntryId(context, 'recovery-link'),
    bookId: command.bookId,
    observationId: observation.observationId,
    adjustmentId: adjustment.adjustmentId,
    entryId,
    movementKind: command.movementKind,
    capturedAtInstantMs,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };
  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    entries: [...state.entries, entry],
    recoveryLinks: [...state.recoveryLinks, link],
  };
  return {
    ok: true,
    nextState,
    effects: [
      {
        kind: 'observedActivityRecovered',
        entryId,
        observationId: observation.observationId,
        cycleId: observation.cycleId,
        localDate: localDate.value,
        amount: command.amount,
        movementKind: command.movementKind,
      },
    ],
  };
}
