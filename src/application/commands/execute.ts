/**
 * Execute: atomically commit a confirmed command.
 *
 * Inside one repository transaction the executor:
 * 1. checks the operation journal for the operation ID — the same ID with the
 *    same canonical payload returns the original committed receipt with no
 *    second effect, even if the caller still holds an old revision; the same
 *    ID with different content is an explicit `operationIdConflict`;
 * 2. validates the state and the confirmation's expected revision against
 *    the committed revision — a stale preview fails with `revisionConflict`
 *    and requires a refreshed preview;
 * 3. applies the pure handler and commits state, receipt, and outbox
 *    together. Any exception between tentative writes leaves all three
 *    unchanged.
 *
 * Validation of the raw command happens before the transaction; stateful and
 * revision checks happen inside it. Infrastructure errors from the adapter
 * propagate as exceptions and roll the transaction back.
 */

import { canonicalJson, stableDigest } from '../../domain/contracts/canonical';
import type {
  CommandConfirmation,
  CommandExecutionResult,
  CommandFailure,
  CommandReceipt,
  OperationRecord,
  OutboxEnvelope,
} from '../../domain/contracts/commands';
import type { TransactionalRepository } from '../../domain/contracts/repository';
import { requireCommandContext, type CommandContext } from './context';
import { dispatchApply } from './handlers';
import { validateFinanceCommand, validateOperationId } from './validation';

const DIGEST_PATTERN = /^[0-9a-f]{16}$/;

export async function executeCommand(
  repository: TransactionalRepository,
  rawCommand: unknown,
  confirmation: unknown,
  context: CommandContext,
): Promise<CommandExecutionResult> {
  requireCommandContext(context);

  const confirmationValidation = validateConfirmation(confirmation);
  if (!confirmationValidation.ok) return { ok: false, failure: confirmationValidation.failure };
  const confirmed = confirmationValidation.value;

  const validation = validateFinanceCommand(rawCommand);
  if (!validation.ok) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: validation.issues.map((issue) => `${issue.path}: ${issue.problem}`) },
    };
  }
  const command = validation.command;
  const canonicalCommand = canonicalJson(command);

  // The confirmation must bind exactly this payload at exactly the expected
  // revision, so a confirmation cannot be reused for different content.
  const recomputedDigest = stableDigest(`${canonicalCommand}\n${String(confirmed.expectedRevision)}`);
  if (recomputedDigest !== confirmed.previewDigest) {
    return {
      ok: false,
      failure: {
        kind: 'previewMismatch',
        detail: 'confirmation.previewDigest does not bind the submitted command and expectedRevision',
      },
    };
  }

  return repository.runTransaction((transaction) => {
    const existing = transaction.getOperation(confirmed.operationId);
    if (existing !== null) {
      if (existing.canonicalCommand === canonicalCommand) {
        return { ok: true, receipt: existing.receipt, retried: true };
      }
      const failure: CommandFailure = { kind: 'operationIdConflict', operationId: confirmed.operationId };
      return { ok: false, failure };
    }

    const state = transaction.getBookState(command.bookId);
    if (command.kind === 'createBook') {
      if (state !== null) {
        return { ok: false, failure: { kind: 'bookAlreadyExists', bookId: command.bookId } as CommandFailure };
      }
      if (confirmed.expectedRevision !== 0) {
        return {
          ok: false,
          failure: {
            kind: 'revisionConflict',
            bookId: command.bookId,
            expectedRevision: confirmed.expectedRevision,
            actualRevision: 0,
          },
        };
      }
    } else {
      if (state === null) {
        return { ok: false, failure: { kind: 'unknownBook', bookId: command.bookId } as CommandFailure };
      }
      if (state.revision !== confirmed.expectedRevision) {
        return {
          ok: false,
          failure: {
            kind: 'revisionConflict',
            bookId: command.bookId,
            expectedRevision: confirmed.expectedRevision,
            actualRevision: state.revision,
          },
        };
      }
    }

    const applied = dispatchApply(command, state, context, confirmed.operationId, {
      locateEntry: (entryId) => transaction.locateEntry(entryId),
      locateObligation: (obligationId) => transaction.locateObligation(obligationId),
      locateGoal: (goalId) => transaction.locateGoal(goalId),
    });
    if (!applied.ok) {
      return { ok: false, failure: applied.failure };
    }

    const revisionBefore = state === null ? 0 : state.revision;
    const committedAtInstantMs = context.clock.nowMs();
    const canonicalDigest = stableDigest(canonicalCommand);
    const receipt: CommandReceipt = {
      operationId: confirmed.operationId,
      commandKind: command.kind,
      bookId: command.bookId,
      revisionBefore,
      revisionAfter: applied.nextState.revision,
      committedAtInstantMs,
      canonicalDigest,
      calculationVersion: context.calculationVersion,
      effects: applied.effects,
    };
    const record: OperationRecord = {
      operationId: confirmed.operationId,
      bookId: command.bookId,
      canonicalCommand,
      receipt,
      committedAtInstantMs,
    };
    const envelope: OutboxEnvelope = {
      outboxId: `outbox:${confirmed.operationId}`,
      operationId: confirmed.operationId,
      bookId: command.bookId,
      commandKind: command.kind,
      revisionAfter: receipt.revisionAfter,
      canonicalDigest,
      createdAtInstantMs: committedAtInstantMs,
      status: 'pending',
    };

    transaction.putBookState(applied.nextState);
    transaction.putOperation(record);
    transaction.putOutboxEntry(envelope);

    return { ok: true, receipt, retried: false };
  });
}

function validateConfirmation(
  value: unknown,
): { ok: true; value: CommandConfirmation } | { ok: false; failure: CommandFailure } {
  const issues: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      ok: false,
      failure: { kind: 'invalidConfirmation', issues: ['confirmation must be an object'] },
    };
  }
  const record = value as Record<string, unknown>;

  const operationId = validateOperationId(record['operationId']);
  if (operationId === null) {
    issues.push('operationId must be 1-100 printable ASCII characters without whitespace');
  }

  const rawRevision = record['expectedRevision'];
  const expectedRevision =
    typeof rawRevision === 'number' && Number.isSafeInteger(rawRevision) && rawRevision >= 0 ? rawRevision : null;
  if (expectedRevision === null) {
    issues.push('expectedRevision must be a non-negative safe integer');
  }

  const rawDigest = record['previewDigest'];
  const previewDigest = typeof rawDigest === 'string' && DIGEST_PATTERN.test(rawDigest) ? rawDigest : null;
  if (previewDigest === null) {
    issues.push('previewDigest must be the 16-hex-character preview digest');
  }

  if (operationId === null || expectedRevision === null || previewDigest === null) {
    return { ok: false, failure: { kind: 'invalidConfirmation', issues } };
  }
  return { ok: true, value: { operationId, expectedRevision, previewDigest } };
}
