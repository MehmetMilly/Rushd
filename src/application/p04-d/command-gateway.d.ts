// P04-D2 declaration boundary for the deterministic P03 command gateway.
// Runtime lives in `./command-gateway.js`.
import type {
  CommandContext,
  CommandExecutionResult,
  CommandFailure,
  CommandPreviewResult,
  CommandReceipt,
  FinanceCommand,
  OperationId,
} from '../commands/index.ts';
import type {
  FinanceReadModel,
  TransactionalRepository,
} from '../../domain/contracts/repository.ts';

export type GatewayInfrastructureFailure = {
  readonly kind: 'gatewayInfrastructure';
  readonly detail: string;
};

export interface CommandGatewayResult {
  readonly ok: boolean;
  readonly receipt?: CommandReceipt;
  readonly failure?: CommandFailure | GatewayInfrastructureFailure;
  readonly detail?: string;
  readonly retried?: boolean;
}

export interface CommandGateway {
  preview(command: FinanceCommand): CommandPreviewResult;
  execute(
    command: FinanceCommand,
    confirmation?: { readonly operationId?: OperationId },
  ): Promise<CommandGatewayResult>;
  describeFailure(failure: unknown): string;
}

export function mintOperationId(context: CommandContext): OperationId;

export function createCommandGateway(options: {
  readonly repository: TransactionalRepository & FinanceReadModel;
  readonly context: CommandContext;
}): CommandGateway;

export type { CommandExecutionResult };
