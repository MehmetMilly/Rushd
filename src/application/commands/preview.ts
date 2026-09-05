/**
 * Preview: validate a raw command against the current state without writing.
 *
 * The preview reports the exact canonical payload, the book, and the revision
 * it covers. The caller confirms by echoing `previewDigest` and
 * `expectedRevision` in a `CommandConfirmation` for `executeCommand`. Effect
 * IDs and timestamps from the preview context are provisional; the receipt is
 * the authoritative record.
 */

import { canonicalJson, stableDigest } from '../../domain/contracts/canonical';
import { makeOperationId, type OperationId } from '../../domain/contracts/identity';
import type {
  CommandEffect,
  CommandPreview,
  CommandPreviewResult,
} from '../../domain/contracts/commands';
import type { FinanceReadModel } from '../../domain/contracts/repository';
import { requireCommandContext, type CommandContext } from './context';
import { dispatchApply } from './handlers';
import { validateFinanceCommand } from './validation';

const PREVIEW_OPERATION_ID: OperationId = makeOrThrow('p03-preview');

function makeOrThrow(raw: string): OperationId {
  const made = makeOperationId(raw);
  if (!made.ok) {
    throw new Error(`static preview operation id is invalid: ${made.failure.detail}`);
  }
  return made.value;
}

/**
 * Preview runs handlers with isolated provisional IDs so a preview never
 * consumes the caller's ID sequences. The caller's clock is used for
 * provisional capture timestamps and clock-derived facts (e.g., a book's
 * created date in preview effects); facts' financial dates come from the
 * command's `occurredAt`, so a preview and the execution of its confirmation
 * always agree on them. Provisional IDs and timestamps never enter returned
 * effects; the receipt is authoritative.
 */
function previewContext(context: CommandContext): CommandContext {
  let sequence = 0;
  return {
    clock: context.clock,
    ids: { newId: (prefix: string) => `preview-${prefix}-${String((sequence += 1)).padStart(3, '0')}` },
    calculationVersion: context.calculationVersion,
  };
}

export function previewCommand(
  readModel: FinanceReadModel,
  rawCommand: unknown,
  context: CommandContext,
): CommandPreviewResult {
  requireCommandContext(context);

  const validation = validateFinanceCommand(rawCommand);
  if (!validation.ok) {
    return {
      ok: false,
      failure: { kind: 'invalidCommand', issues: validation.issues.map((issue) => `${issue.path}: ${issue.problem}`) },
    };
  }
  const command = validation.command;
  const provisional = previewContext(context);

  let expectedRevision: number;
  let effects: readonly CommandEffect[];
  const refs = {
    locateEntry: (entryId: Parameters<FinanceReadModel['locateEntry']>[0]) => readModel.locateEntry(entryId),
    locateObligation: (obligationId: Parameters<FinanceReadModel['locateObligation']>[0]) => readModel.locateObligation(obligationId),
    locateGoal: (goalId: Parameters<FinanceReadModel['locateGoal']>[0]) => readModel.locateGoal(goalId),
  };
  if (command.kind === 'createBook') {
    const existing = readModel.getBookState(command.bookId);
    if (existing !== null) {
      return { ok: false, failure: { kind: 'bookAlreadyExists', bookId: command.bookId } };
    }
    expectedRevision = 0;
    const applied = dispatchApply(command, null, provisional, PREVIEW_OPERATION_ID, refs);
    if (!applied.ok) return { ok: false, failure: applied.failure };
    effects = applied.effects;
  } else {
    const state = readModel.getBookState(command.bookId);
    if (state === null) {
      return { ok: false, failure: { kind: 'unknownBook', bookId: command.bookId } };
    }
    expectedRevision = state.revision;
    const applied = dispatchApply(command, state, provisional, PREVIEW_OPERATION_ID, refs);
    if (!applied.ok) return { ok: false, failure: applied.failure };
    effects = applied.effects;
  }

  const canonicalCommand = canonicalJson(command);
  const preview: CommandPreview = {
    commandKind: command.kind,
    bookId: command.bookId,
    expectedRevision,
    canonicalCommand,
    previewDigest: stableDigest(`${canonicalCommand}\n${String(expectedRevision)}`),
    effects,
  };
  return { ok: true, preview };
}
