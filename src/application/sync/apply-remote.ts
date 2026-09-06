/**
 * Remote-apply boundary for pulled operations (P03 Task D).
 *
 * A provider-accepted operation is not a newly authored local command.
 * This path applies the deterministic finance effect inside an already
 * open repository transaction, stamps the immutable source device and
 * source enqueue identity from the pulled envelope, and never creates a
 * pending outbox intent. Exact replay is idempotent through the journal;
 * changed payload or provenance is an explicit `operationIdConflict`
 * without writes.
 */

import { canonicalJson, stableDigest } from '../../domain/contracts/canonical';
import {
  SYNC_RECORD_SCHEMA_VERSION,
  type CommandExecutionResult,
  type CommandFailure,
  type CommandReceipt,
  type OperationRecord,
} from '../../domain/contracts/commands';
import type { ScopedRepository, RepositoryTransaction } from '../../domain/contracts/repository';
import type { PulledOperation } from '../../domain/sync/cursors';
import { checkScopeBinding } from '../commands/scope-check';
import { requireCommandContext, type CommandContext } from '../commands/context';
import { dispatchApply } from '../commands/handlers';
import { validateFinanceCommand } from '../commands/validation';

function remoteMatchesJournal(record: OperationRecord, pulled: PulledOperation): boolean {
  return (
    record.canonicalCommand === pulled.canonicalCommand &&
    record.receipt.canonicalDigest === pulled.canonicalDigest &&
    (record.scopeId as string) === (pulled.scopeId as string) &&
    (record.bookId as string) === (pulled.bookId as string) &&
    record.receipt.revisionBefore === pulled.baseRevision &&
    record.receipt.revisionAfter === pulled.resultingRevision &&
    (record.sourceDeviceId as string) === (pulled.sourceDeviceId as string) &&
    record.enqueueSequence === pulled.sourceEnqueueSequence
  );
}

/**
 * Applies one pulled operation inside the caller's transaction.
 *
 * The command context supplies clock, IDs, and calculation version for the
 * deterministic handler. Record provenance comes only from the envelope:
 * the receiver device is never written onto a remote operation, the source
 * enqueue identity is preserved, and no pending upload is created.
 */
export function applyRemoteOperation(
  repository: ScopedRepository,
  transaction: RepositoryTransaction,
  pulled: PulledOperation,
  context: CommandContext,
): CommandExecutionResult {
  requireCommandContext(context);

  const binding = checkScopeBinding(repository, context.origin);
  if (!binding.ok) return { ok: false, failure: binding.failure };

  if ((pulled.scopeId as string) !== (repository.boundScope as string)) {
    return {
      ok: false,
      failure: {
        kind: 'scopeMismatch',
        expectedScope: repository.boundScope,
        actualScope: pulled.scopeId,
        detail: 'pulled operation names another scope than the bound repository',
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(pulled.canonicalCommand) as unknown;
  } catch {
    return { ok: false, failure: { kind: 'invalidCommand', issues: ['pulled canonical payload is not JSON'] } };
  }

  const validation = validateFinanceCommand(parsed);
  if (!validation.ok) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: validation.issues.map((issue) => `${issue.path}: ${issue.problem}`) },
    };
  }
  const command = validation.command;
  const canonicalCommand = canonicalJson(command);
  if (canonicalCommand !== pulled.canonicalCommand || stableDigest(canonicalCommand) !== pulled.canonicalDigest) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: ['pulled canonical payload does not match its digest after validation'] },
    };
  }

  const existing = transaction.getOperation(pulled.operationId);
  if (existing !== null) {
    if (remoteMatchesJournal(existing, pulled)) {
      return { ok: true, receipt: existing.receipt, retried: true };
    }
    const failure: CommandFailure = { kind: 'operationIdConflict', operationId: pulled.operationId };
    return { ok: false, failure };
  }

  const state = transaction.getBookState(command.bookId);
  if (command.kind === 'createBook') {
    if (state !== null) {
      return { ok: false, failure: { kind: 'bookAlreadyExists', bookId: command.bookId } };
    }
    if (pulled.baseRevision !== 0) {
      return {
        ok: false,
        failure: {
          kind: 'revisionConflict',
          bookId: command.bookId,
          expectedRevision: pulled.baseRevision,
          actualRevision: 0,
        },
      };
    }
  } else {
    if (state === null) {
      return { ok: false, failure: { kind: 'unknownBook', bookId: command.bookId } };
    }
    if (state.revision !== pulled.baseRevision) {
      return {
        ok: false,
        failure: {
          kind: 'revisionConflict',
          bookId: command.bookId,
          expectedRevision: pulled.baseRevision,
          actualRevision: state.revision,
        },
      };
    }
  }

  const applied = dispatchApply(command, state, context, pulled.operationId, {
    locateEntry: (entryId) => transaction.locateEntry(entryId),
    locateObligation: (obligationId) => transaction.locateObligation(obligationId),
    locateGoal: (goalId) => transaction.locateGoal(goalId),
    locateObservation: (observationId) => transaction.locateObservation(observationId),
    locatePlan: (planId) => transaction.locatePlan(planId),
    locateOccurrence: (occurrenceId) => transaction.locateOccurrence(occurrenceId),
    locateSettlement: (settlementId) => transaction.locateSettlement(settlementId),
  });
  if (!applied.ok) return { ok: false, failure: applied.failure };

  if (applied.nextState.revision !== pulled.resultingRevision) {
    return {
      ok: false,
      failure: {
        kind: 'revisionConflict',
        bookId: command.bookId,
        expectedRevision: pulled.resultingRevision,
        actualRevision: applied.nextState.revision,
      },
    };
  }

  const revisionBefore = state === null ? 0 : state.revision;
  const committedAtInstantMs = context.clock.nowMs();
  const receipt: CommandReceipt = {
    operationId: pulled.operationId,
    commandKind: command.kind,
    bookId: command.bookId,
    revisionBefore,
    revisionAfter: applied.nextState.revision,
    committedAtInstantMs,
    canonicalDigest: pulled.canonicalDigest,
    calculationVersion: context.calculationVersion,
    effects: applied.effects,
    schemaVersion: SYNC_RECORD_SCHEMA_VERSION,
    scopeId: pulled.scopeId,
    sourceDeviceId: pulled.sourceDeviceId,
    enqueueSequence: pulled.sourceEnqueueSequence,
  };
  const record: OperationRecord = {
    operationId: pulled.operationId,
    bookId: command.bookId,
    canonicalCommand,
    receipt,
    committedAtInstantMs,
    schemaVersion: SYNC_RECORD_SCHEMA_VERSION,
    scopeId: pulled.scopeId,
    sourceDeviceId: pulled.sourceDeviceId,
    enqueueSequence: pulled.sourceEnqueueSequence,
  };

  transaction.putBookState(applied.nextState);
  transaction.putOperation(record);
  return { ok: true, receipt, retried: false };
}
