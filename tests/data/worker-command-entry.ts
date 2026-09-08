/**
 * P04-A-FIX-01 worker command entry (bundled with esbuild for Workers).
 *
 * Runs REAL P03 commands (`previewCommand`/`executeCommand`) against the
 * SQLite-candidate repository inside a browser Worker, over an injected
 * sqlite3 handle the worker owns. The bundle contains only Rushd production
 * code (commands, deterministic context, repository); the SQLite engine and
 * VFS stay external and are imported by the worker from the served package.
 */
import { executeCommand, previewCommand } from '../../src/application/commands';
import { makeBookId, makeOperationId } from '../../src/domain/contracts/identity';
import {
  SqliteCandidateRepository,
  type CandidateSqlite,
} from '../../src/data/experiments/sqlite-candidate-repository';
import { createDeterministicContext } from '../domain/support/deterministic-context';

const BOOK_ID = 'book-p04a-sqlite-proof';

function brandedBookId(raw: string): import('../../src/domain/contracts/identity').BookId {
  const made = makeBookId(raw);
  if (!made.ok) throw new Error(`invalid book id: ${raw}`);
  return made.value;
}

function brandedOperationId(raw: string): import('../../src/domain/contracts/identity').OperationId {
  const made = makeOperationId(raw);
  if (!made.ok) throw new Error(`invalid operation id: ${raw}`);
  return made.value;
}

export interface NarrowProofResult {
  readonly receipts: ReadonlyArray<{ operationId: string; revisionBefore: number; revisionAfter: number; enqueueSequence: number }>;
  readonly digest: string;
  readonly entryCount: number;
  readonly outboxLength: number;
  /** Field-by-field outbox/journal/receipt comparison for one operation. */
  readonly envelopeCheck: ReadonlyArray<{ field: string; expected: string; actual: string }>;
  /** Delivery proof: initialOutboxDelivery received the complete envelope. */
  readonly deliveryCheck: { operationId: string; outboxId: string; version: number; attempts: number };
}

async function previewAndExecute(
  repo: SqliteCandidateRepository,
  context: ReturnType<typeof createDeterministicContext>['context'],
  operationId: string,
  rawCommand: unknown,
): Promise<import('../../src/domain/contracts/commands').CommandReceipt> {
  const preview = previewCommand(repo, rawCommand, context);
  if (!preview.ok) throw new Error(`preview failed: ${JSON.stringify(preview)}`);
  const result = await executeCommand(
    repo,
    rawCommand,
    {
      operationId: brandedOperationId(operationId),
      expectedRevision: preview.preview.expectedRevision,
      previewDigest: preview.preview.previewDigest,
    },
    context,
  );
  if (!result.ok) throw new Error(`execute failed: ${JSON.stringify(result)}`);
  return result.receipt;
}

/**
 * Narrow real-command proof: createBook + openCycle + three recordInflows,
 * all through the deterministic command API onto the candidate SQLite
 * database. Returns the digest the worker re-verifies after reopen.
 */
export async function runNarrowProof(
  sqlite3: CandidateSqlite,
  db: number,
  deviceId: string,
): Promise<NarrowProofResult> {
  const { context } = createDeterministicContext({ deviceId });
  const repo = new SqliteCandidateRepository({
    sqlite3,
    db,
    boundScope: context.origin.scopeId,
    boundDevice: context.origin.deviceId,
  });
  await repo.open();
  const receipts = [];
  receipts.push(
    await previewAndExecute(repo, context, 'sqlite-proof-create', {
      kind: 'createBook',
      bookId: BOOK_ID,
      displayName: 'p04a sqlite proof',
      currency: 'SAR',
      timeZone: 'Asia/Riyadh',
      cycleAnchor: { kind: 'firstOfMonth' },
    }),
  );
  // The sync preview cache is refreshed after every durable commit: this is
  // the documented Task B browser contract (hydrate → preview → execute →
  // commit-time recheck), exercised here for real.
  await repo.refresh();
  receipts.push(
    await previewAndExecute(repo, context, 'sqlite-proof-cycle', {
      kind: 'openCycle',
      bookId: BOOK_ID,
      startDate: '2026-09-01',
      startingFunds: { currency: 'SAR', minorUnits: 100_000 },
    }),
  );
  const inflows = [
    { amount: 5000, date: '2026-09-12', note: 'synthetic-sqlite-0' },
    { amount: 2500, date: '2026-09-13', note: 'synthetic-sqlite-1' },
    { amount: 7500, date: '2026-09-14', note: 'synthetic-sqlite-2' },
  ];
  for (let index = 0; index < inflows.length; index += 1) {
    const inflow = inflows[index];
    if (inflow === undefined) throw new Error('unreachable');
    await repo.refresh();
    receipts.push(
      await previewAndExecute(repo, context, `sqlite-proof-inflow-${index}`, {
        kind: 'recordInflow',
        bookId: BOOK_ID,
        amount: { currency: 'SAR', minorUnits: inflow.amount },
        occurredAt: { kind: 'civilDate', localDate: inflow.date },
        note: inflow.note,
      }),
    );
  }
  await repo.refresh();
  const state = repo.getBookState(brandedBookId(BOOK_ID));
  const outbox = await repo.listOutboxEntries();

  // Full-envelope proof for one operation: every OutboxEnvelope field is
  // compared against the matching journal record, receipt, and context.
  const targetOp = brandedOperationId('sqlite-proof-inflow-0');
  const journal = await repo.readOperation(targetOp);
  if (journal === null) throw new Error('proof journal record missing');
  const envelope = outbox.find((candidate) => (candidate.operationId as string) === 'sqlite-proof-inflow-0');
  if (envelope === undefined) throw new Error('proof outbox envelope missing');
  const inflowReceipt = receipts.find((receipt) => (receipt.operationId as string) === 'sqlite-proof-inflow-0');
  if (inflowReceipt === undefined) throw new Error('proof receipt missing');
  const check = (field: string, expected: unknown, actual: unknown): { field: string; expected: string; actual: string } => {
    const pair = { field, expected: String(expected), actual: String(actual) };
    if (pair.expected !== pair.actual) throw new Error(`envelope mismatch at ${field}: expected ${pair.expected}, got ${pair.actual}`);
    return pair;
  };
  const envelopeCheck = [
    check('outboxId', `outbox:${targetOp as string}`, envelope.outboxId),
    check('operationId', journal.operationId, envelope.operationId),
    check('bookId', journal.bookId, envelope.bookId),
    check('commandKind', 'recordInflow', envelope.commandKind),
    check('revisionAfter', inflowReceipt.revisionAfter, envelope.revisionAfter),
    check('canonicalDigest', inflowReceipt.canonicalDigest, envelope.canonicalDigest),
    check('canonicalDigest/journal', journal.receipt.canonicalDigest, envelope.canonicalDigest),
    check('createdAtInstantMs', inflowReceipt.committedAtInstantMs, envelope.createdAtInstantMs),
    check('status', 'pending', envelope.status),
    check('schemaVersion', journal.schemaVersion, envelope.schemaVersion),
    check('scopeId', context.origin.scopeId, envelope.scopeId),
    check('sourceDeviceId', context.origin.deviceId, envelope.sourceDeviceId),
    check('enqueueSequence', inflowReceipt.enqueueSequence, envelope.enqueueSequence),
    check('enqueueSequence/journal', journal.enqueueSequence, envelope.enqueueSequence),
  ];

  // Delivery proof: initialOutboxDelivery must receive the complete
  // envelope (outboxId linkage), then one failed attempt persists.
  await repo.updateDeliveryState(targetOp, { ok: false, error: 'p04a-delivery-probe', nextRetryAtMs: 1000 });
  const delivery = await repo.readDeliveryState(targetOp);
  if (delivery === null) throw new Error('proof delivery state missing');
  if (delivery.outboxId !== envelope.outboxId) {
    throw new Error(`delivery outbox linkage broken: ${String(delivery.outboxId)} vs ${String(envelope.outboxId)}`);
  }
  if (delivery.version !== 1 || delivery.attempts !== 1) {
    throw new Error(`delivery version/attempts wrong: version ${delivery.version}, attempts ${delivery.attempts}`);
  }
  const deliveryCheck = {
    operationId: delivery.operationId as string,
    outboxId: delivery.outboxId as string,
    version: delivery.version,
    attempts: delivery.attempts,
  };

  // Digest covers the complete committed state (books, journal, outbox,
  // delivery, sequence) so close/reopen verification is exact.
  await repo.refresh();
  const digest = await repo.snapshotDigest();
  return {
    receipts: receipts.map((receipt) => ({
      operationId: receipt.operationId as string,
      revisionBefore: receipt.revisionBefore,
      revisionAfter: receipt.revisionAfter,
      enqueueSequence: receipt.enqueueSequence,
    })),
    digest,
    entryCount: state?.entries.length ?? -1,
    outboxLength: outbox.length,
    envelopeCheck,
    deliveryCheck,
  };
}

/** Digest of the committed proof rows, for post-reopen comparison. */
export async function readProofDigest(sqlite3: CandidateSqlite, db: number, deviceId: string): Promise<string> {
  const { context } = createDeterministicContext({ deviceId });
  const repo = new SqliteCandidateRepository({
    sqlite3,
    db,
    boundScope: context.origin.scopeId,
    boundDevice: context.origin.deviceId,
  });
  await repo.refresh();
  return repo.snapshotDigest();
}
