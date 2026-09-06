/**
 * Handlers for expected obligations.
 *
 * An obligation is an expected item, strictly separate from actual money
 * movement: creating it reserves intent (never an inferred category), while
 * payments and returns append actual expense/return facts linked to it. The
 * residual reservation of an open obligation is max(0, expected - unreversed
 * net payments). Final settlement and confirmed cancellation release the
 * residual; a return after final settlement does not silently reopen it
 * (reopening is explicit). Dispute is an independent overlay: posted
 * disputed payments remain outflows, and releasing an unpaid disputed
 * residual is a separate previewed action that records unresolved
 * uncertainty. Only an explicit confirmed resolution — or a final
 * settlement/cancellation whose preview describes that effect — closes the
 * overlay; refunds and reopenings never do.
 */

import type { OperationId } from '../../domain/contracts/identity';
import type { BookState, ObligationEvent, ObligationRecord } from '../../domain/contracts/ledger';
import { findEntryById } from '../../domain/contracts/ledger';
import { isExpenseReturnLive } from '../../domain/activity/derive';
import type {
  CancelObligationCommand,
  CommandEffect,
  CommandFailure,
  CreateObligationCommand,
  OpenObligationDisputeCommand,
  RecordObligationPaymentCommand,
  RecordObligationReturnCommand,
  ReleaseDisputedResidualCommand,
  ReopenObligationCommand,
  ResolveObligationDisputeCommand,
  SettleObligationFinallyCommand,
} from '../../domain/contracts/commands';
import type { CommandContext } from './context';
import type { ApplyResult, HandlerRefs } from './handlers';
import { newObligationEventId, requireOpenCycle } from './handler-support';
import { deriveObligationView } from '../../domain/obligations/derive';
import { appendExpenseEntry, appendObligationReturnEntry } from './obligation-movement';

function obligationEvent(
  change: ObligationEvent['change'],
  obligationId: ObligationEvent['obligationId'],
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  note: string,
): ObligationEvent {
  return {
    kind: 'obligationEvent',
    eventId: newObligationEventId(context),
    bookId: state.book.id,
    obligationId,
    change,
    note,
    capturedAtInstantMs: context.clock.nowMs(),
    capturedInTimeZone: state.book.timeZone,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };
}

function commitWithEvents(
  state: BookState,
  events: readonly ObligationEvent[],
  effects: readonly CommandEffect[],
): ApplyResult {
  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    obligationEvents: [...state.obligationEvents, ...events],
  };
  return { ok: true, nextState, effects };
}

export function applyCreateObligation(
  command: CreateObligationCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;

  const located = refs.locateObligation(command.obligationId);
  if (located !== null && located.bookId !== command.bookId) {
    return {
      ok: false,
      failure: {
        kind: 'crossBookObligation',
        bookId: command.bookId,
        obligationId: command.obligationId,
        obligationBookId: located.bookId,
      },
    };
  }
  if (state.obligations.some((candidate) => candidate.obligationId === command.obligationId)) {
    // Retrying the same committed operation is handled by the operation
    // journal before this point; reaching here means a genuinely duplicate ID.
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: [`obligationId ${command.obligationId} already exists in this book`] },
    };
  }

  const record: ObligationRecord = {
    kind: 'obligation',
    obligationId: command.obligationId,
    bookId: command.bookId,
    cycleId: openCycle.value.cycleId,
    expectedAmount: command.expectedAmount,
    note: command.note,
    category: command.category,
    createdAtInstantMs: context.clock.nowMs(),
    createdInTimeZone: state.book.timeZone,
    calculationVersion: context.calculationVersion,
    sourceOperationId: operationId,
  };
  const nextState: BookState = {
    ...state,
    revision: state.revision + 1,
    obligations: [...state.obligations, record],
  };
  return {
    ok: true,
    nextState,
    effects: [
      {
        kind: 'obligationCreated',
        obligationId: record.obligationId,
        cycleId: record.cycleId,
        expectedAmount: record.expectedAmount,
      },
    ],
  };
}

export function applyRecordObligationPayment(
  command: RecordObligationPaymentCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;

  const view = requireObligationView(state, command, refs);
  if (!view.ok) return view;
  if (view.value.status !== 'open') {
    return {
      ok: false,
      failure: {
        kind: 'obligationNotOpen',
        bookId: command.bookId,
        obligationId: command.obligationId,
        status: view.value.status,
      },
    };
  }

  // Overpayment is allowed: real money movement is a fact, and the residual
  // floors at zero. The outflow is never silently clamped or hidden.
  return appendExpenseEntry(command.bookId, command.occurredAt, command.amount, command.note, command.category, command.obligationId, state, context, operationId);
}

export function applyRecordObligationReturn(
  command: RecordObligationReturnCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;

  const view = requireObligationView(state, command, refs);
  if (!view.ok) return view;
  if (view.value.netPayments.minorUnits < command.amount.minorUnits) {
    return {
      ok: false,
      failure: {
        kind: 'returnExceedsReturnable',
        bookId: command.bookId,
        targetKind: 'obligation',
        targetId: command.obligationId,
        requested: command.amount,
        returnable: view.value.netPayments,
      },
    };
  }

  // Allowed while open or after final settlement/cancellation: a real return
  // is actual money received and never silently reopens the obligation. A
  // return never resolves the dispute overlay on its own: even a full refund
  // does not prove the disagreement is over. Resolution is explicit
  // (resolveObligationDispute) or via a confirmed final
  // settlement/cancellation whose preview describes that effect.
  return appendObligationReturnEntry(command.bookId, command.occurredAt, command.amount, command.note, command.obligationId, state, context, operationId);
}

export function applySettleObligationFinally(
  command: SettleObligationFinallyCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const view = deriveObligationView(state, command.obligationId);
  if (view === null) return unknownObligationFailure(state.book.id, command.obligationId);
  if (view.status !== 'open') {
    return { ok: false, failure: { kind: 'obligationNotOpen', bookId: command.bookId, obligationId: command.obligationId, status: view.status } };
  }

  const events: ObligationEvent[] = [obligationEvent({ type: 'finalSettlement' }, command.obligationId, state, context, operationId, command.note)];
  const effects: CommandEffect[] = [
    { kind: 'obligationFinallySettled', obligationId: command.obligationId, releasedResidual: view.residualReservation },
  ];
  // Resolving a dispute through settlement links the resolution without
  // overwriting the dispute history.
  if (view.disputeOpen) {
    events.push(obligationEvent({ type: 'disputeResolved', via: 'finalSettlement' }, command.obligationId, state, context, operationId, ''));
    effects.push({ kind: 'obligationDisputeResolved', obligationId: command.obligationId, via: 'finalSettlement' });
  }
  return commitWithEvents(state, events, effects);
}

export function applyCancelObligation(
  command: CancelObligationCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const view = deriveObligationView(state, command.obligationId);
  if (view === null) return unknownObligationFailure(state.book.id, command.obligationId);
  if (view.status !== 'open') {
    return { ok: false, failure: { kind: 'obligationNotOpen', bookId: command.bookId, obligationId: command.obligationId, status: view.status } };
  }

  const events: ObligationEvent[] = [obligationEvent({ type: 'cancellation' }, command.obligationId, state, context, operationId, command.note)];
  const effects: CommandEffect[] = [
    { kind: 'obligationCancelled', obligationId: command.obligationId, releasedResidual: view.residualReservation },
  ];
  if (view.disputeOpen) {
    events.push(obligationEvent({ type: 'disputeResolved', via: 'cancellation' }, command.obligationId, state, context, operationId, ''));
    effects.push({ kind: 'obligationDisputeResolved', obligationId: command.obligationId, via: 'cancellation' });
  }
  return commitWithEvents(state, events, effects);
}

export function applyReopenObligation(
  command: ReopenObligationCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const view = deriveObligationView(state, command.obligationId);
  if (view === null) return unknownObligationFailure(state.book.id, command.obligationId);
  if (view.status === 'open') {
    return { ok: false, failure: { kind: 'obligationNotClosed', bookId: command.bookId, obligationId: command.obligationId, status: 'open' } };
  }

  // Reopening is explicit: the unpaid residual is reinstated from the same
  // expected amount minus unreversed net payments (the view's reservation is
  // zero while closed, so the unsuppressed remaining unpaid amount is used).
  // Reopening alone never resolves the dispute overlay.
  const events: ObligationEvent[] = [obligationEvent({ type: 'reopening' }, command.obligationId, state, context, operationId, command.note)];
  const effects: CommandEffect[] = [
    { kind: 'obligationReopened', obligationId: command.obligationId, reinstatedResidual: view.remainingUnpaid },
  ];
  return commitWithEvents(state, events, effects);
}

export function applyOpenObligationDispute(
  command: OpenObligationDisputeCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const view = deriveObligationView(state, command.obligationId);
  if (view === null) return unknownObligationFailure(state.book.id, command.obligationId);
  if (view.status !== 'open') {
    return { ok: false, failure: { kind: 'obligationNotOpen', bookId: command.bookId, obligationId: command.obligationId, status: view.status } };
  }
  if (view.disputeOpen) {
    return { ok: false, failure: { kind: 'disputeAlreadyOpen', bookId: command.bookId, obligationId: command.obligationId } };
  }
  return commitWithEvents(
    state,
    [obligationEvent({ type: 'disputeOpened' }, command.obligationId, state, context, operationId, command.note)],
    [{ kind: 'obligationDisputeOpened', obligationId: command.obligationId }],
  );
}

export function applyResolveObligationDispute(
  command: ResolveObligationDisputeCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
  refs: HandlerRefs,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const view = deriveObligationView(state, command.obligationId);
  if (view === null) {
    const located = refs.locateObligation(command.obligationId);
    if (located !== null && located.bookId !== command.bookId) {
      return {
        ok: false,
        failure: {
          kind: 'crossBookObligation',
          bookId: command.bookId,
          obligationId: command.obligationId,
          obligationBookId: located.bookId,
        },
      };
    }
    return unknownObligationFailure(state.book.id, command.obligationId);
  }
  if (view.status !== 'open') {
    return { ok: false, failure: { kind: 'obligationNotOpen', bookId: command.bookId, obligationId: command.obligationId, status: view.status } };
  }
  if (!view.disputeOpen) {
    return { ok: false, failure: { kind: 'disputeNotOpen', bookId: command.bookId, obligationId: command.obligationId } };
  }

  // The reason and the link are validated as a pair: a returnReceived reason
  // must name a real return belonging to this obligation, and any other
  // reason must not claim one.
  if (command.resolution === 'returnReceived') {
    if (command.linkedReturnEntryId === null) {
      return {
        ok: false,
        failure: { kind: 'invalidCommand', issues: ['linkedReturnEntryId: required when resolution is returnReceived'] },
      };
    }
    const linked = findEntryById(state, command.linkedReturnEntryId);
    if (linked === null || linked.kind !== 'expenseReturn' || linked.linkedObligationId !== command.obligationId) {
      return {
        ok: false,
        failure: {
          kind: 'invalidCommand',
          issues: [`linkedReturnEntryId: ${command.linkedReturnEntryId} is not a return of obligation ${command.obligationId}`],
        },
      };
    }
    if (!isExpenseReturnLive(state, linked.entryId)) {
      return {
        ok: false,
        failure: {
          kind: 'invalidCommand',
          issues: [`linkedReturnEntryId: ${command.linkedReturnEntryId} was corrected and no longer evidences a received return`],
        },
      };
    }
  } else if (command.linkedReturnEntryId !== null) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: ['linkedReturnEntryId: must be null unless resolution is returnReceived'] },
    };
  }

  // Explicit resolution removes only the dispute reason: a standing
  // residual-release decision and its completeness uncertainty persist until
  // their own conditions (real movement, settlement, cancellation, or an
  // explicit reopen) resolve them.
  return commitWithEvents(
    state,
    [obligationEvent({ type: 'disputeResolved', via: 'explicitResolution' }, command.obligationId, state, context, operationId, command.note)],
    [{ kind: 'obligationDisputeResolved', obligationId: command.obligationId, via: 'explicitResolution' }],
  );
}

export function applyReleaseDisputedResidual(
  command: ReleaseDisputedResidualCommand,
  state: BookState,
  context: CommandContext,
  operationId: OperationId,
): ApplyResult {
  const openCycle = requireOpenCycle(state);
  if (!openCycle.ok) return openCycle;
  const view = deriveObligationView(state, command.obligationId);
  if (view === null) return unknownObligationFailure(state.book.id, command.obligationId);
  if (view.status !== 'open') {
    return { ok: false, failure: { kind: 'obligationNotOpen', bookId: command.bookId, obligationId: command.obligationId, status: view.status } };
  }
  if (!view.disputeOpen) {
    return { ok: false, failure: { kind: 'disputeNotOpen', bookId: command.bookId, obligationId: command.obligationId } };
  }
  if (view.residualReleased) {
    return {
      ok: false,
      failure: { kind: 'residualNotReleasable', bookId: command.bookId, obligationId: command.obligationId, detail: 'residual was already released' },
    };
  }
  if (view.residualReservation.minorUnits === 0) {
    return {
      ok: false,
      failure: { kind: 'residualNotReleasable', bookId: command.bookId, obligationId: command.obligationId, detail: 'there is no unpaid residual to release' },
    };
  }

  // The money never came back: availability improves, but the unresolved
  // uncertainty is recorded and degrades completeness until real movement
  // or settlement resolves it.
  return commitWithEvents(
    state,
    [obligationEvent({ type: 'residualReleased' }, command.obligationId, state, context, operationId, command.note)],
    [{ kind: 'obligationResidualReleased', obligationId: command.obligationId, releasedResidual: view.residualReservation }],
  );
}

function requireObligationView(
  state: BookState,
  command: { readonly bookId: BookState['book']['id']; readonly obligationId: ObligationRecord['obligationId'] },
  refs: HandlerRefs,
): { ok: true; value: NonNullable<ReturnType<typeof deriveObligationView>> } | { ok: false; failure: CommandFailure } {
  const view = deriveObligationView(state, command.obligationId);
  if (view !== null) return { ok: true, value: view };
  const located = refs.locateObligation(command.obligationId);
  if (located !== null && located.bookId !== command.bookId) {
    return {
      ok: false,
      failure: {
        kind: 'crossBookObligation',
        bookId: command.bookId,
        obligationId: command.obligationId,
        obligationBookId: located.bookId,
      },
    };
  }
  return { ok: false, failure: { kind: 'unknownObligation', bookId: command.bookId, obligationId: command.obligationId } };
}

function unknownObligationFailure(bookId: BookState['book']['id'], obligationId: ObligationRecord['obligationId']) {
  return { ok: false as const, failure: { kind: 'unknownObligation' as const, bookId, obligationId } };
}
