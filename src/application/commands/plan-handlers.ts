/**
 * Handlers for effective-dated recurring plans and stable occurrences.
 *
 * Revisions are immutable and take effect for occurrences due on or after
 * their effective date. Only future unpaid managed occurrences follow a new
 * revision; paid and detached occurrences keep their historical revision
 * byte-for-byte. Materialization is idempotent through deterministic
 * occurrence identities, and short-month schedule days clamp explicitly.
 * Reserving a managed occurrence creates its obligation with the original
 * due-cycle identity; paying it later moves actual money in the payment's
 * occurrence cycle.
 */

import { compareCivilDates } from '../../domain/primitives/civil-date';
import { monthlyCycleContaining } from '../../domain/primitives/monthly-cycle';
import { composeCycleId } from '../../domain/contracts/identity';
import { effectiveAnchorForDate } from '../../domain/cycles/derive';
import {
  applicableRevision,
  clampedDueDate,
  isOccurrencePaid,
  latestRevision,
  occurrenceExpectedAmount,
  planMaterialization,
} from '../../domain/plans/derive';
import {
  findOccurrenceById,
  findPlanById,
  type BookState,
  type ObligationRecord,
  type PlanOccurrence,
} from '../../domain/contracts/ledger';
import type {
  CreateRecurringPlanCommand,
  DetachPlanOccurrenceCommand,
  MaterializePlanOccurrencesCommand,
  ReservePlanOccurrenceCommand,
  ReviseRecurringPlanCommand,
} from '../../domain/contracts/commands';
import type { OperationId } from '../../domain/contracts/identity';
import type { CommandContext } from './context';
import type { ApplyResult, HandlerRefs } from './handlers';
import { currencyMismatchFailure, newEntryId } from './handler-support';

export function applyCreateRecurringPlan(
  command: CreateRecurringPlanCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  if (state.plans.some((plan) => plan.planId === command.planId)) {
    return { ok: false, failure: { kind: 'planAlreadyExists', bookId: command.bookId, planId: command.planId } };
  }
  const located = refs.locatePlan(command.planId);
  if (located !== null && located.bookId !== command.bookId) {
    return {
      ok: false,
      failure: { kind: 'crossBookPlan', bookId: command.bookId, planId: command.planId, planBookId: located.bookId },
    };
  }
  if (located !== null) {
    return { ok: false, failure: { kind: 'planAlreadyExists', bookId: command.bookId, planId: command.planId } };
  }
  if (command.amount.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, command.amount.currency);
  }

  const capturedAtInstantMs = context.clock.nowMs();
  const plan = {
    planId: command.planId,
    bookId: command.bookId,
    name: command.name,
    anchor: effectiveAnchorForDate(state, command.effectiveDate),
    flexibleDefinitionId: command.flexibleDefinitionId,
    createdAtInstantMs: capturedAtInstantMs,
    createdInTimeZone: state.book.timeZone,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };
  const revision = {
    revisionId: newEntryId(context, 'plan-revision'),
    bookId: command.bookId,
    planId: command.planId,
    effectiveDate: command.effectiveDate,
    amount: command.amount,
    scheduleDay: command.scheduleDay,
    note: '',
    capturedAtInstantMs,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };
  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    plans: [...state.plans, plan],
    planRevisions: [...state.planRevisions, revision],
  };
  return {
    ok: true,
    nextState,
    effects: [
      {
        kind: 'recurringPlanCreated',
        planId: command.planId,
        amount: command.amount,
        scheduleDay: command.scheduleDay,
        effectiveDate: command.effectiveDate,
      },
    ],
  };
}

export function applyReviseRecurringPlan(
  command: ReviseRecurringPlanCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const plan = findPlanById(state, command.planId);
  if (plan === null) {
    const located = refs.locatePlan(command.planId);
    if (located !== null && located.bookId !== command.bookId) {
      return {
        ok: false,
        failure: { kind: 'crossBookPlan', bookId: command.bookId, planId: command.planId, planBookId: located.bookId },
      };
    }
    return { ok: false, failure: { kind: 'unknownPlan', bookId: command.bookId, planId: command.planId } };
  }
  if (command.amount.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, command.amount.currency);
  }

  const latest = latestRevision(state, command.planId);
  if (latest !== null && compareCivilDates(command.effectiveDate, latest.effectiveDate) <= 0) {
    return {
      ok: false,
      failure: {
        kind: 'invalidEffectiveDate',
        bookId: command.bookId,
        detail: `revision effective ${command.effectiveDate} must be after the latest revision ${latest.effectiveDate}`,
      },
    };
  }

  const capturedAtInstantMs = context.clock.nowMs();
  const revision = {
    revisionId: newEntryId(context, 'plan-revision'),
    bookId: command.bookId,
    planId: command.planId,
    effectiveDate: command.effectiveDate,
    amount: command.amount,
    scheduleDay: command.scheduleDay,
    note: command.note,
    capturedAtInstantMs,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };

  // Future unpaid managed occurrences follow the new revision from its
  // effective date. Paid and detached occurrences are never rewritten; a
  // schedule change moves the due date (clamped) while the stable identity
  // stays put.
  let updated = 0;
  const occurrences = state.planOccurrences.map((occurrence): PlanOccurrence => {
    if (occurrence.planId !== command.planId) return occurrence;
    if (occurrence.state !== 'managed') return occurrence;
    if (compareCivilDates(occurrence.dueDate, command.effectiveDate) < 0) return occurrence;
    if (isOccurrencePaid(state, occurrence)) return occurrence;
    updated += 1;
    if (command.scheduleDay === scheduleDayOf(state, occurrence)) {
      return { ...occurrence, revisionId: revision.revisionId };
    }
    const year = Number(occurrence.dueDate.slice(0, 4));
    const month = Number(occurrence.dueDate.slice(5, 7));
    const dueDate = clampedDueDate(year, month, command.scheduleDay);
    const window = monthlyCycleContaining(plan.anchor, dueDate);
    const dueCycleId = composeCycleId(command.bookId, window.startDate);
    if (!dueCycleId.ok) {
      throw new TypeError(`rescheduled due cycle could not be composed (${dueCycleId.failure.detail})`);
    }
    return { ...occurrence, revisionId: revision.revisionId, dueDate, dueCycleId: dueCycleId.value };
  });

  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    planRevisions: [...state.planRevisions, revision],
    planOccurrences: occurrences,
  };
  return {
    ok: true,
    nextState,
    effects: [
      {
        kind: 'recurringPlanRevised',
        planId: command.planId,
        revisionId: revision.revisionId,
        effectiveDate: command.effectiveDate,
        amount: command.amount,
        scheduleDay: command.scheduleDay,
        updatedOccurrences: updated,
      },
    ],
  };
}

function scheduleDayOf(state: BookState, occurrence: PlanOccurrence): number {
  const revision = state.planRevisions.find((candidate) => candidate.revisionId === occurrence.revisionId) ?? null;
  if (revision === null) throw new TypeError(`occurrence ${occurrence.occurrenceId} references an unknown revision`);
  return revision.scheduleDay;
}

export function applyMaterializePlanOccurrences(
  command: MaterializePlanOccurrencesCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const plan = findPlanById(state, command.planId);
  if (plan === null) {
    const located = refs.locatePlan(command.planId);
    if (located !== null && located.bookId !== command.bookId) {
      return {
        ok: false,
        failure: { kind: 'crossBookPlan', bookId: command.bookId, planId: command.planId, planBookId: located.bookId },
      };
    }
    return { ok: false, failure: { kind: 'unknownPlan', bookId: command.bookId, planId: command.planId } };
  }

  const planned = planMaterialization(state, plan, command.throughDate);
  if (!planned.ok) {
    return {
      ok: false,
      failure: { kind: 'invalidEffectiveDate', bookId: command.bookId, detail: planned.detail },
    };
  }

  const capturedAtInstantMs = context.clock.nowMs();
  const rows: PlanOccurrence[] = planned.value.map((row) => ({
    occurrenceId: row.occurrenceId,
    bookId: command.bookId,
    planId: command.planId,
    revisionId: row.revisionId,
    dueDate: row.dueDate,
    dueCycleId: row.dueCycleId,
    state: 'managed' as const,
    linkedObligationId: null,
    linkedExpenseEntryId: null,
    capturedAtInstantMs,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  }));
  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    planOccurrences: [...state.planOccurrences, ...rows],
  };
  return {
    ok: true,
    nextState,
    effects: [
      {
        kind: 'planOccurrencesMaterialized',
        planId: command.planId,
        occurrenceIds: rows.map((row) => row.occurrenceId),
      },
    ],
  };
}

export function applyDetachPlanOccurrence(
  command: DetachPlanOccurrenceCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const occurrence = findOccurrenceById(state, command.occurrenceId);
  if (occurrence === null) {
    const located = refs.locateOccurrence(command.occurrenceId);
    if (located !== null && located.bookId !== command.bookId) {
      return {
        ok: false,
        failure: {
          kind: 'crossBookOccurrence',
          bookId: command.bookId,
          occurrenceId: command.occurrenceId,
          occurrenceBookId: located.bookId,
        },
      };
    }
    return { ok: false, failure: { kind: 'unknownOccurrence', bookId: command.bookId, occurrenceId: command.occurrenceId } };
  }
  if (occurrence.state !== 'managed') {
    return {
      ok: false,
      failure: { kind: 'occurrenceNotManaged', bookId: command.bookId, occurrenceId: command.occurrenceId, state: occurrence.state },
    };
  }
  if (isOccurrencePaid(state, occurrence)) {
    return { ok: false, failure: { kind: 'occurrenceAlreadyPaid', bookId: command.bookId, occurrenceId: command.occurrenceId } };
  }
  void operationId;
  void context;

  const occurrences = state.planOccurrences.map((candidate) =>
    candidate.occurrenceId === occurrence.occurrenceId ? { ...candidate, state: 'detached' as const } : candidate,
  );
  const nextState: BookState = { ...state, revision: state.revision + 1, planOccurrences: occurrences };
  return {
    ok: true,
    nextState,
    effects: [{ kind: 'planOccurrenceDetached', occurrenceId: command.occurrenceId }],
  };
}

export function applyReservePlanOccurrence(
  command: ReservePlanOccurrenceCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const occurrence = findOccurrenceById(state, command.occurrenceId);
  if (occurrence === null) {
    const located = refs.locateOccurrence(command.occurrenceId);
    if (located !== null && located.bookId !== command.bookId) {
      return {
        ok: false,
        failure: {
          kind: 'crossBookOccurrence',
          bookId: command.bookId,
          occurrenceId: command.occurrenceId,
          occurrenceBookId: located.bookId,
        },
      };
    }
    return { ok: false, failure: { kind: 'unknownOccurrence', bookId: command.bookId, occurrenceId: command.occurrenceId } };
  }
  if (occurrence.state !== 'managed') {
    return {
      ok: false,
      failure: { kind: 'occurrenceNotManaged', bookId: command.bookId, occurrenceId: command.occurrenceId, state: occurrence.state },
    };
  }
  if (isOccurrencePaid(state, occurrence)) {
    return { ok: false, failure: { kind: 'occurrenceAlreadyPaid', bookId: command.bookId, occurrenceId: command.occurrenceId } };
  }
  if (occurrence.linkedObligationId !== null) {
    return {
      ok: false,
      failure: {
        kind: 'invalidCommand',
        issues: [`occurrence ${command.occurrenceId} is already reserved by ${occurrence.linkedObligationId}`],
      },
    };
  }

  const locatedObligation = refs.locateObligation(command.obligationId);
  if (locatedObligation !== null && locatedObligation.bookId !== command.bookId) {
    return {
      ok: false,
      failure: {
        kind: 'crossBookObligation',
        bookId: command.bookId,
        obligationId: command.obligationId,
        obligationBookId: locatedObligation.bookId,
      },
    };
  }
  if (state.obligations.some((candidate) => candidate.obligationId === command.obligationId)) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`obligationId ${command.obligationId} already exists in this book`] },
    };
  }

  const revision = applicableRevision(state, occurrence.planId, occurrence.dueDate);
  const expectedAmount = revision === null ? occurrenceExpectedAmount(state, occurrence) : revision.amount;
  if (expectedAmount.currency !== state.book.currency) {
    return currencyMismatchFailure(command.bookId, state.book.currency, expectedAmount.currency);
  }

  const capturedAtInstantMs = context.clock.nowMs();
  const obligation: ObligationRecord = {
    kind: 'obligation',
    obligationId: command.obligationId,
    bookId: command.bookId,
    cycleId: occurrence.dueCycleId,
    expectedAmount,
    note: command.note,
    category: null,
    createdAtInstantMs: capturedAtInstantMs,
    createdInTimeZone: state.book.timeZone,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };
  const occurrences = state.planOccurrences.map((candidate) =>
    candidate.occurrenceId === occurrence.occurrenceId
      ? { ...candidate, linkedObligationId: command.obligationId }
      : candidate,
  );
  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    obligations: [...state.obligations, obligation],
    planOccurrences: occurrences,
  };
  return {
    ok: true,
    nextState,
    effects: [
      {
        kind: 'planOccurrenceReserved',
        occurrenceId: command.occurrenceId,
        obligationId: command.obligationId,
        expectedAmount,
      },
    ],
  };
}
