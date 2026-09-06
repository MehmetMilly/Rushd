/**
 * In-memory pull-checkpoint store for the P03 sync contract proofs.
 *
 * This is test-adapter-specific infrastructure (like `injectWriteFailure` on
 * the finance adapter): it proves the checkpoint contract — scope-bound
 * streams, atomic content-bound batch application of real canonical finance
 * effects together with the checkpoint, idempotent exact replay, explicit
 * base-mismatch/changed-content/cross-scope conflicts — that P04/P08
 * adapters must implement against real persistence.
 *
 * The store is bound to one identity scope for its lifetime. Every batch,
 * every pulled operation, and (for effect application) the finance adapter
 * must name that same scope; anything else is an explicit rejection that
 * advances nothing. Applying a batch executes each fresh pulled operation's
 * exact canonical command through the production `previewCommand` /
 * `executeCommand` path, so the applied finance effect is real BookState,
 * not metadata: duplicate delivery replays idempotently through the
 * operation journal, and same-ID/changed-payload surfaces as the journal's
 * `operationIdConflict`. Finance writes happen before the checkpoint
 * mutation, and any failure restores the finance snapshot, so a failed
 * apply leaves both the finance state and the checkpoint unchanged.
 *
 * It is not a sync daemon and performs no networking.
 */

import {
  describeCommandFailure,
  executeCommand,
  previewCommand,
} from '../../../src/application/commands';
import type { CommandContext } from '../../../src/application/commands/context';
import { canonicalJson } from '../../../src/domain/contracts/canonical';
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
} from '../../../src/domain/sync/cursors';
import type { RepositoryScopeId } from '../../../src/domain/sync/scope';
import { InMemoryFinanceRepository } from './in-memory-repository';

export type CheckpointApplyResult =
  | { readonly ok: true; readonly replayed: boolean }
  | { readonly ok: false; readonly reason: 'unsupportedSchema' | 'invalidBatch' | 'baseCursorMismatch' | 'injectedFailure' }
  | { readonly ok: false; readonly reason: 'contentConflict'; readonly conflict: PulledContentConflict }
  | { readonly ok: false; readonly reason: 'scopeMismatch'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'applyFailed'; readonly detail: string; readonly failures: readonly string[] };

export interface PullFinance {
  readonly adapter: InMemoryFinanceRepository;
  readonly context: CommandContext;
}

interface StreamState {
  cursor: SyncCursor | null;
  batchDigest: string | null;
  applied: Map<string, PulledOperation>;
}

export class InMemoryCheckpointStore {
  readonly boundScope: RepositoryScopeId;
  private readonly streams = new Map<string, StreamState>();
  private injectedFailures = 0;

  constructor(options: { readonly boundScope: RepositoryScopeId }) {
    this.boundScope = options.boundScope;
  }

  /** Test-adapter-specific hook: the next N batch applications fail before mutating anything. */
  injectApplyFailure(occurrences = 1): void {
    this.injectedFailures = occurrences;
  }

  cursorFor(streamId: ReplicationStreamId): SyncCursor | null {
    return this.streams.get(streamId as string)?.cursor ?? null;
  }

  batchDigestFor(streamId: ReplicationStreamId): string | null {
    return this.streams.get(streamId as string)?.batchDigest ?? null;
  }

  checkpointFor(streamId: ReplicationStreamId): CheckpointRecord {
    const state = this.streams.get(streamId as string);
    return {
      schemaVersion: 1,
      streamId,
      scopeId: this.boundScope,
      cursor: state?.cursor ?? null,
      batchDigest: state?.batchDigest ?? null,
    };
  }

  appliedOperations(streamId: ReplicationStreamId): readonly PulledOperation[] {
    const state = this.streams.get(streamId as string);
    if (state === undefined) return [];
    return [...state.applied.values()].map((operation) => JSON.parse(JSON.stringify(operation)) as PulledOperation);
  }

  appliedOperationIds(streamId: ReplicationStreamId): readonly string[] {
    return this.appliedOperations(streamId).map((operation) => operation.operationId as string);
  }

  /** Canonical snapshot for byte-identical rollback proofs. */
  snapshotBytes(): string {
    const streams = [...this.streams.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([streamId, state]) => ({
        streamId,
        cursor: state.cursor,
        batchDigest: state.batchDigest,
        applied: [...state.applied.values()],
      }));
    return canonicalJson({ scopeId: this.boundScope as string, streams });
  }

  /**
   * Applies one pulled batch atomically with real finance effects.
   *
   * Pre-checks (shape, scope binding, exact replay, base-cursor match,
   * content reconciliation against the batch and the applied set) are all
   * decided before anything mutates. Then each fresh operation's exact
   * canonical command executes through the production command path against
   * the scope-bound finance adapter; any failure restores the finance
   * snapshot and leaves the checkpoint unchanged. Only after every effect
   * commits do the applied records and the cursor advance together.
   */
  async applyBatch(batch: PulledBatch, finance: PullFinance): Promise<CheckpointApplyResult> {
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
    const state = this.streams.get(batch.streamId as string);
    for (const operation of reconciled.operations) {
      const known = state?.applied.get(operation.operationId as string);
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

    const fresh = reconciled.operations.filter(
      (operation) => state?.applied.get(operation.operationId as string) === undefined,
    );
    const financeBytes = finance.adapter.snapshotBytes();
    const failures: string[] = [];
    for (const operation of fresh) {
      const failure = await this.applyOne(operation, finance);
      if (failure !== null) {
        failures.push(failure);
        finance.adapter.restoreSnapshot(financeBytes);
        return { ok: false, reason: 'applyFailed', detail: 'pulled finance application failed; finance state and checkpoint unchanged', failures };
      }
    }

    const next: StreamState = state ?? { cursor: null, batchDigest: null, applied: new Map() };
    for (const operation of reconciled.operations) {
      if (!next.applied.has(operation.operationId as string)) {
        next.applied.set(operation.operationId as string, JSON.parse(JSON.stringify(operation)) as PulledOperation);
      }
    }
    next.cursor = batch.nextCursor;
    next.batchDigest = batch.batchDigest;
    this.streams.set(batch.streamId as string, next);
    return { ok: true, replayed: false };
  }

  /**
   * Executes one pulled operation's exact canonical command through the
   * production path. Returns null on success, or a failure description.
   * Same-ID/same-payload replays succeed idempotently through the journal;
   * same-ID/changed-payload fails closed as `operationIdConflict`; a stale
   * pulled base revision fails as `revisionConflict` instead of silently
   * reordering history.
   */
  private async applyOne(operation: PulledOperation, finance: PullFinance): Promise<string | null> {
    let command: unknown;
    try {
      command = JSON.parse(operation.canonicalCommand) as unknown;
    } catch {
      return `operation ${operation.operationId as string}: canonical payload is not JSON`;
    }
    const preview = previewCommand(finance.adapter, command, finance.context);
    if (!preview.ok) {
      return `operation ${operation.operationId as string}: preview failed with ${describeCommandFailure(preview.failure)}`;
    }
    const result = await executeCommand(
      finance.adapter,
      command,
      {
        operationId: operation.operationId,
        expectedRevision: preview.preview.expectedRevision,
        previewDigest: preview.preview.previewDigest,
      },
      finance.context,
    );
    if (!result.ok) {
      return `operation ${operation.operationId as string}: execute failed with ${describeCommandFailure(result.failure)}`;
    }
    const receipt = result.receipt;
    if (
      receipt.revisionBefore !== operation.baseRevision ||
      receipt.revisionAfter !== operation.resultingRevision ||
      receipt.canonicalDigest !== operation.canonicalDigest
    ) {
      return `operation ${operation.operationId as string}: committed receipt does not match the pulled envelope`;
    }
    return null;
  }
}
