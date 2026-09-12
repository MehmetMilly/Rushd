// P04-D2: deterministic P03 command gateway for the canonical candidate host.
//
// Every canonical finance write flows through preview/confirm/execute here.
// The gateway never invents finance semantics: it validates the caller
// context once, mints operation identities from the injected id factory,
// binds each confirmation to its preview (expected revision + digest), and
// resolves success only after the repository durably commits book,
// operation, receipt/outbox, and checkpoint effects together. A failure
// never surfaces as success: validation/revision conflicts return
// `{ ok: false }`, and infrastructure exceptions are reported as explicit
// gateway failures instead of thrown into UI state.
//
// Nothing here opens storage, starts workers, or contacts the network. The
// repository and context are injected by the canonical host (browser OPFS
// adapter in the real candidate, an equivalent TransactionalRepository in
// tests).

import {
  describeCommandFailure,
  executeCommand,
  makeOperationId,
  previewCommand,
  requireCommandContext,
} from '../commands/index.ts';

/**
 * @typedef {import('../commands/index.ts').CommandContext} CommandContext
 * @typedef {import('../commands/index.ts').FinanceCommand} FinanceCommand
 * @typedef {import('../commands/index.ts').CommandPreviewResult} CommandPreviewResult
 * @typedef {import('../commands/index.ts').CommandExecutionResult} CommandExecutionResult
 * @typedef {import('../commands/index.ts').CommandFailure} CommandFailure
 * @typedef {import('../commands/index.ts').CommandReceipt} CommandReceipt
 * @typedef {import('../commands/index.ts').OperationId} OperationId
 * @typedef {import('../../domain/contracts/repository.ts').TransactionalRepository} TransactionalRepository
 * @typedef {import('../../domain/contracts/repository.ts').FinanceReadModel} FinanceReadModel
 */

/**
 * @typedef {object} CommandGatewayResult
 * @property {boolean} ok
 * @property {CommandReceipt} [receipt] Present only after a durable commit.
 * @property {CommandFailure | { kind: 'gatewayInfrastructure', detail: string }} [failure]
 * @property {string} [detail] Human-readable failure text for blocked-action UI.
 * @property {boolean} [retried] True when execution retried after a lost acknowledgement.
 */

/**
 * Mint a validated operation identity from the context id factory.
 * @param {CommandContext} context
 * @returns {OperationId}
 */
export function mintOperationId(context) {
  const raw = context.ids.newId('op');
  const made = makeOperationId(raw);
  if (!made.ok) {
    throw new Error(`command gateway minted an invalid operation id: ${made.failure.detail}`);
  }
  return made.value;
}

/**
 * @param {unknown} failure
 * @returns {string}
 */
function failureDetail(failure) {
  try {
    return describeCommandFailure(failure);
  } catch {
    return failure instanceof Error ? failure.message : String(failure);
  }
}

/**
 * Create a gateway bound to one repository and one command context.
 * The repository must satisfy the P03 transactional port
 * (`previewCommand` reads it, `executeCommand` commits through it).
 * @param {{ repository: TransactionalRepository & FinanceReadModel, context: CommandContext }} options
 * @returns {{ preview(command: FinanceCommand): CommandPreviewResult, execute(command: FinanceCommand, confirmation?: { operationId?: OperationId }): Promise<CommandGatewayResult>, describeFailure(failure: unknown): string }}
 */
export function createCommandGateway({ repository, context }) {
  requireCommandContext(context);
  if (!repository || typeof repository !== 'object') {
    throw new TypeError('command gateway requires a repository implementing the P03 transactional port.');
  }

  return {
    preview(command) {
      return previewCommand(repository, command, context);
    },
    describeFailure(failure) {
      return failureDetail(failure);
    },
    async execute(command, confirmation = {}) {
      let previewed;
      try {
        previewed = previewCommand(repository, command, context);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, failure: { kind: 'gatewayInfrastructure', detail }, detail };
      }
      if (!previewed.ok) {
        return { ok: false, failure: previewed.failure, detail: failureDetail(previewed.failure) };
      }
      const operationId = confirmation.operationId ?? mintOperationId(context);
      try {
        const result = await executeCommand(
          repository,
          command,
          {
            operationId,
            expectedRevision: previewed.preview.expectedRevision,
            previewDigest: previewed.preview.previewDigest,
          },
          context,
        );
        if (!result.ok) {
          return { ok: false, failure: result.failure, detail: failureDetail(result.failure) };
        }
        // Success resolves only here: executeCommand commits book,
        // operation, receipt/outbox, and checkpoint effects atomically
        // before returning the receipt.
        return { ok: true, receipt: result.receipt, ...(result.retried === true ? { retried: true } : {}) };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, failure: { kind: 'gatewayInfrastructure', detail }, detail };
      }
    },
  };
}
