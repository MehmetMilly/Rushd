/**
 * Durable pull-checkpoint store bound to one guest repository handle.
 *
 * Applies content-bound pulled batches inside the same SQLite transaction
 * as finance effects. Exact replay is a no-op; changed content is an
 * explicit conflict. Guest mode constructs no account or cloud client.
 */

import { describeCommandFailure } from '../../application/commands';
import { applyRemoteOperation } from '../../application/sync/apply-remote';
import type { CommandContext } from '../../application/commands/context';
import {
  differingPulledFields,
  isBatchAlreadyApplied,
  isNextBatchFor,
  pulledOperationsEqual,
  reconcilePulledOperations,
  validatePulledBatchShape,
  type CheckpointRecord,
  type PulledBatch,
  type PulledContentConflict,
  type PulledOperation,
  type ReplicationStreamId,
  type SyncCursor,
} from '../../domain/sync/cursors';
import type { RepositoryScopeId } from '../../domain/sync/scope';
import { GuardConflictError } from './errors';
import { asDurableTransaction, DurableGuestRepository } from './repository';

export type DurableApplyResult =
  | { readonly ok: true; readonly replayed: boolean }
  | { readonly ok: false; readonly reason: 'unsupportedSchema' | 'invalidBatch' | 'baseCursorMismatch' | 'injectedFailure' }
  | { readonly ok: false; readonly reason: 'contentConflict'; readonly conflict: PulledContentConflict }
  | { readonly ok: false; readonly reason: 'scopeMismatch'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'applyFailed'; readonly detail: string; readonly failures: readonly string[] };

export interface DurablePullFinance {
  readonly adapter: DurableGuestRepository;
  readonly context: CommandContext;
}

class PullApplyAborted extends Error {
  constructor(readonly result: DurableApplyResult) {
    super('pulled-batch apply aborted');
    this.name = 'PullApplyAborted';
  }
}

export class DurableCheckpointStore {
  readonly boundScope: RepositoryScopeId;
  private readonly adapter: DurableGuestRepository;
  private injectedFailures = 0;
  private applyGate: Promise<void> | null = null;
  private notifyParked: (() => void) | null = null;

  constructor(options: { readonly adapter: DurableGuestRepository }) {
    this.adapter = options.adapter;
    this.boundScope = options.adapter.boundScope;
  }

  injectApplyFailure(occurrences = 1): void {
    this.injectedFailures = occurrences;
  }

  armApplyBarrier(gate: Promise<void>): Promise<void> {
    this.applyGate = gate;
    return new Promise<void>((resolve) => {
      this.notifyParked = resolve;
    });
  }

  cursorFor(streamId: ReplicationStreamId): SyncCursor | null {
    return this.adapter.committedCheckpoint(streamId)?.cursor ?? null;
  }

  batchDigestFor(streamId: ReplicationStreamId): string | null {
    return this.adapter.committedCheckpoint(streamId)?.batchDigest ?? null;
  }

  checkpointFor(streamId: ReplicationStreamId): CheckpointRecord {
    const state = this.adapter.committedCheckpoint(streamId);
    return {
      schemaVersion: 1,
      streamId,
      scopeId: this.boundScope,
      cursor: state?.cursor ?? null,
      batchDigest: state?.batchDigest ?? null,
    };
  }

  appliedOperations(streamId: ReplicationStreamId): readonly PulledOperation[] {
    const state = this.adapter.committedCheckpoint(streamId);
    if (state === null) return [];
    return [...state.applied.values()].map((operation) => JSON.parse(JSON.stringify(operation)) as PulledOperation);
  }

  appliedOperationIds(streamId: ReplicationStreamId): readonly string[] {
    return this.appliedOperations(streamId).map((operation) => operation.operationId as string);
  }

  snapshotBytes(): string {
    return this.adapter.checkpointSnapshotBytes();
  }

  async applyBatch(batch: PulledBatch, finance: DurablePullFinance): Promise<DurableApplyResult> {
    const shape = validatePulledBatchShape(batch);
    if (!shape.ok) {
      return { ok: false, reason: shape.failure.kind === 'unsupportedSchema' ? 'unsupportedSchema' : 'invalidBatch' };
    }
    if ((batch.scopeId as string) !== (this.boundScope as string)) {
      return { ok: false, reason: 'scopeMismatch', detail: 'pulled batch names another scope than this checkpoint stream' };
    }
    const stored = this.checkpointFor(batch.streamId);
    if (isBatchAlreadyApplied(stored, batch)) {
      return { ok: true, replayed: true };
    }
    if (!isNextBatchFor(stored, batch)) {
      return { ok: false, reason: 'baseCursorMismatch' };
    }
    const reconciled = reconcilePulledOperations(batch.operations);
    if (!reconciled.ok) {
      return { ok: false, reason: 'contentConflict', conflict: reconciled.conflict };
    }
    const knownApplied = this.adapter.committedCheckpoint(batch.streamId)?.applied;
    for (const operation of reconciled.operations) {
      const known = knownApplied?.get(operation.operationId as string);
      if (known !== undefined && !pulledOperationsEqual(known, operation)) {
        return {
          ok: false,
          reason: 'contentConflict',
          conflict: {
            operationId: operation.operationId as string,
            digests: [known.canonicalDigest, operation.canonicalDigest],
            differingFields: differingPulledFields(known, operation),
          },
        };
      }
    }
    if (this.injectedFailures > 0) {
      this.injectedFailures -= 1;
      return { ok: false, reason: 'injectedFailure' };
    }
    if ((finance.adapter.boundScope as string) !== (this.boundScope as string)) {
      return { ok: false, reason: 'scopeMismatch', detail: 'finance adapter is bound to another scope than this checkpoint stream' };
    }
    if (finance.adapter !== this.adapter) {
      return { ok: false, reason: 'scopeMismatch', detail: 'checkpoint store is bound to a different finance adapter instance' };
    }

    const fresh = reconciled.operations.filter((operation) => knownApplied?.get(operation.operationId as string) === undefined);

    let outcome: DurableApplyResult = { ok: true, replayed: false };
    try {
      await finance.adapter.runTransaction(async (transaction) => {
        const tx = asDurableTransaction(transaction);
        const current = tx.getStreamCheckpoint(batch.streamId);
        const currentRecord: CheckpointRecord = {
          schemaVersion: 1,
          streamId: batch.streamId,
          scopeId: this.boundScope,
          cursor: current.cursor,
          batchDigest: current.batchDigest,
        };
        if (isBatchAlreadyApplied(currentRecord, batch)) {
          outcome = { ok: true, replayed: true };
          return;
        }
        if (!isNextBatchFor(currentRecord, batch)) {
          throw new PullApplyAborted({ ok: false, reason: 'baseCursorMismatch' });
        }
        for (const operation of reconciled.operations) {
          const known = current.applied.get(operation.operationId as string);
          if (known !== undefined && !pulledOperationsEqual(known, operation)) {
            throw new PullApplyAborted({
              ok: false,
              reason: 'contentConflict',
              conflict: {
                operationId: operation.operationId as string,
                digests: [known.canonicalDigest, operation.canonicalDigest],
                differingFields: differingPulledFields(known, operation),
              },
            });
          }
        }

        for (let index = 0; index < fresh.length; index += 1) {
          if (index === 1) await this.takeApplyBarrier();
          const operation = fresh[index];
          if (operation === undefined) throw new Error('unreachable');
          const result = applyRemoteOperation(finance.adapter, tx, operation, finance.context);
          if (!result.ok) {
            throw new PullApplyAborted({
              ok: false,
              reason: 'applyFailed',
              detail: 'pulled finance application failed; finance state and checkpoint unchanged',
              failures: [`operation ${operation.operationId as string}: execute failed with ${describeCommandFailure(result.failure)}`],
            });
          }
        }
        if (fresh.length <= 1) await this.takeApplyBarrier();

        const nextApplied = new Map(current.applied);
        for (const operation of reconciled.operations) {
          if (!nextApplied.has(operation.operationId as string)) {
            nextApplied.set(operation.operationId as string, JSON.parse(JSON.stringify(operation)) as PulledOperation);
          }
        }
        tx.putStreamCheckpoint(batch.streamId, {
          cursor: batch.nextCursor,
          batchDigest: batch.batchDigest,
          applied: nextApplied,
        });
      });
    } catch (error) {
      if (error instanceof PullApplyAborted) return error.result;
      if (error instanceof GuardConflictError) {
        return {
          ok: false,
          reason: 'applyFailed',
          detail: 'pulled finance application failed; finance state and checkpoint unchanged',
          failures: [error.message],
        };
      }
      throw error;
    }
    return outcome;
  }

  private async takeApplyBarrier(): Promise<void> {
    if (this.applyGate === null) return;
    const gate = this.applyGate;
    this.applyGate = null;
    const notify = this.notifyParked;
    this.notifyParked = null;
    notify?.();
    await gate;
  }
}
