/**
 * P04-D2 command-gateway gate (Node, deterministic).
 *
 * Proves the gateway binds preview/confirm/execute over the P03 protocol:
 * success resolves only after the durable commit, validation failures never
 * look like success, identical operation ids replay idempotently, and
 * adapter crashes surface as explicit gateway failures.
 */
import { describe, expect, it } from 'vitest';
import { createCommandGateway, mintOperationId } from '../../src/application/p04-d/command-gateway.js';
import { createDeterministicContext } from '../domain/support/deterministic-context';
import { InMemoryFinanceRepository } from '../domain/support/in-memory-repository';
import { makeBookId } from '../../src/domain/contracts/identity';
import { previewCommand, executeCommand } from '../../src/application/commands';

function bookOf(raw: string) {
  const made = makeBookId(raw);
  if (!made.ok) throw new Error(made.failure.detail);
  return made.value;
}

function openBookFixture() {
  const { context } = createDeterministicContext();
  const repository = new InMemoryFinanceRepository({
    boundScope: context.origin.scopeId,
    boundDevice: context.origin.deviceId,
  });
  return { context, repository };
}

async function createOpenBook(context: ReturnType<typeof createDeterministicContext>['context'], repository: InMemoryFinanceRepository, bookId: string) {
  const gateway = createCommandGateway({ repository, context });
  const book = await gateway.execute({
    kind: 'createBook',
    bookId: bookOf(bookId),
    displayName: 'guest',
    currency: 'SAR',
    timeZone: 'Asia/Riyadh',
    cycleAnchor: { kind: 'firstOfMonth' },
  } as never);
  if (!book.ok) throw new Error(`fixture book failed: ${book.detail}`);
  const cycle = await gateway.execute({
    kind: 'openCycle',
    bookId: bookOf(bookId),
    startDate: '2026-09-01',
    startingFunds: { currency: 'SAR', minorUnits: 100_000 },
  } as never);
  return { gateway, cycle };
}

describe('command gateway', () => {
  it('mints validated operation identities from the context factory', () => {
    const { context } = createDeterministicContext();
    const first = mintOperationId(context);
    const second = mintOperationId(context);
    expect(String(first)).not.toBe(String(second));
  });

  it('commits recordExpense and resolves only after the durable commit', async () => {
    const { context, repository } = openBookFixture();
    const { gateway } = await createOpenBook(context, repository, 'book-gateway-1');
    const before = repository.snapshotBytes();
    const result = await gateway.execute({
      kind: 'recordExpense',
      bookId: bookOf('book-gateway-1'),
      amount: { currency: 'SAR', minorUnits: 1250 },
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: 'bread',
      category: 'food',
      flexibleDefinitionId: null,
    } as never);
    expect(result.ok).toBe(true);
    expect(result.receipt).toBeDefined();
    expect(repository.snapshotBytes()).not.toBe(before);
    const recorded = result.receipt!.effects.find((effect) => effect.kind === 'expenseRecorded');
    expect(recorded).toBeDefined();
  });

  it('returns validation failures without touching committed state', async () => {
    const { context, repository } = openBookFixture();
    const { gateway } = await createOpenBook(context, repository, 'book-gateway-2');
    const before = repository.snapshotBytes();
    const result = await gateway.execute({
      kind: 'recordExpense',
      bookId: bookOf('book-gateway-2'),
      amount: { currency: 'SAR', minorUnits: -50 },
      occurredAt: { kind: 'civilDate', localDate: '2026-09-05' },
      note: 'negative',
      category: 'food',
      flexibleDefinitionId: null,
    } as never);
    expect(result.ok).toBe(false);
    expect(result.detail).toBeTruthy();
    expect(repository.snapshotBytes()).toBe(before);
  });

  it('replays an identical operation id without a second effect', async () => {
    const { context, repository } = openBookFixture();
    const { gateway } = await createOpenBook(context, repository, 'book-gateway-3');
    const operationId = mintOperationId(context);
    const command = {
      kind: 'recordExpense',
      bookId: bookOf('book-gateway-3'),
      amount: { currency: 'SAR', minorUnits: 900 },
      occurredAt: { kind: 'civilDate', localDate: '2026-09-06' },
      note: 'milk',
      category: 'food',
      flexibleDefinitionId: null,
    } as never;
    const first = await gateway.execute(command, { operationId });
    expect(first.ok).toBe(true);
    const mid = repository.snapshotBytes();
    const second = await gateway.execute(command, { operationId });
    expect(second.ok).toBe(true);
    expect(repository.snapshotBytes()).toBe(mid);
  });

  it('reports adapter crashes as gateway failures, never success', async () => {
    const { context, repository } = openBookFixture();
    const { gateway } = await createOpenBook(context, repository, 'book-gateway-4');
    repository.injectWriteFailure('putBookState', 50);
    const result = await gateway.execute({
      kind: 'recordExpense',
      bookId: bookOf('book-gateway-4'),
      amount: { currency: 'SAR', minorUnits: 300 },
      occurredAt: { kind: 'civilDate', localDate: '2026-09-07' },
      note: 'crash-probe',
      category: 'food',
      flexibleDefinitionId: null,
    } as never);
    expect(result.ok).toBe(false);
    expect(result.failure?.kind).toBe('gatewayInfrastructure');
  });

  it('rejects a malformed context instead of executing', () => {
    const { repository } = openBookFixture();
    expect(() => createCommandGateway({ repository, context: {} as never })).toThrow(TypeError);
  });

  it('exposes preview without committing', async () => {
    const { context, repository } = openBookFixture();
    const { gateway } = await createOpenBook(context, repository, 'book-gateway-5');
    const before = repository.snapshotBytes();
    const previewed = gateway.preview({
      kind: 'recordExpense',
      bookId: bookOf('book-gateway-5'),
      amount: { currency: 'SAR', minorUnits: 100 },
      occurredAt: { kind: 'civilDate', localDate: '2026-09-08' },
      note: 'preview-only',
      category: 'food',
      flexibleDefinitionId: null,
    } as never);
    expect(previewed.ok).toBe(true);
    expect(repository.snapshotBytes()).toBe(before);
    void previewCommand;
    void executeCommand;
  });
});
