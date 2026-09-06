/**
 * Shared command harness for Task C suites.
 *
 * Every test exercises the production application API
 * (`previewCommand`/`executeCommand`) with hand-calculated expectations.
 * One harness owns one book and one deterministic context; operation IDs
 * are sequential per harness so retries and conflicts behave exactly as in
 * production.
 */

import { expect } from 'vitest';
import {
  computeAvailability,
  computeCompleteness,
  describeCommandFailure,
  executeCommand,
  previewCommand,
  type BookState,
  type CommandReceipt,
} from '../../../src/application/commands';
import {
  makeBookId,
  makeObligationId,
  makeOperationId,
  type BookId,
  type ObligationId,
  type OperationId,
} from '../../../src/domain/contracts/identity';
import type { CivilDate } from '../../../src/domain/primitives/civil-date';
import { createDeterministicContext } from './deterministic-context';
import { InMemoryFinanceRepository } from './in-memory-repository';

export const SAR = (minorUnits: number) => ({ currency: 'SAR' as const, minorUnits });

export function civilDate(raw: string): CivilDate {
  return raw as CivilDate;
}

export function asBookId(raw: string): BookId {
  const made = makeBookId(raw);
  if (!made.ok) throw new Error('invalid test book id');
  return made.value;
}

export function asObligationId(raw: string): ObligationId {
  const made = makeObligationId(raw);
  if (!made.ok) throw new Error('invalid test obligation id');
  return made.value;
}

function asOperationId(raw: string): OperationId {
  const made = makeOperationId(raw);
  if (!made.ok) throw new Error('invalid test operation id');
  return made.value;
}

export interface SeedBookOptions {
  readonly currency?: 'SAR' | 'USD' | 'JPY' | 'KWD';
  readonly timeZone?: string;
  readonly anchor?: { kind: 'firstOfMonth' } | { kind: 'payday'; dayOfMonth: number };
  readonly startDate?: string;
  readonly startingFundsMinor?: number;
  readonly displayName?: string;
}

export interface TaskCHarness {
  readonly repo: InMemoryFinanceRepository;
  readonly context: ReturnType<typeof createDeterministicContext>['context'];
  readonly bookId: string;
  run(rawCommand: unknown): Promise<CommandReceipt>;
  previewRaw(rawCommand: unknown): ReturnType<typeof previewCommand>;
  state(): BookState;
  availableMinor(): number;
}

export function makeTaskCHarness(bookId = 'book-task-c'): TaskCHarness {
  const repo = new InMemoryFinanceRepository();
  const { context } = createDeterministicContext({ calculationVersion: 'p03-task-c-1' });
  const theBookId = asBookId(bookId);
  let sequence = 0;

  const run = async (rawCommand: unknown): Promise<CommandReceipt> => {
    const preview = previewCommand(repo, rawCommand, context);
    expect(preview.ok, preview.ok ? undefined : describeCommandFailure(preview.failure)).toBe(true);
    if (!preview.ok) throw new Error('unreachable');
    const result = await executeCommand(
      repo,
      rawCommand,
      {
        operationId: asOperationId(`op-${String(++sequence).padStart(4, '0')}`),
        expectedRevision: preview.preview.expectedRevision,
        previewDigest: preview.preview.previewDigest,
      },
      context,
    );
    expect(result.ok, result.ok ? undefined : describeCommandFailure(result.failure)).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    return result.receipt;
  };

  const previewRaw = (rawCommand: unknown): ReturnType<typeof previewCommand> => previewCommand(repo, rawCommand, context);

  const state = (): BookState => {
    const found = repo.getBookState(theBookId);
    if (found === null) throw new Error('book missing');
    return found;
  };

  const availableMinor = (): number => {
    const availability = computeAvailability(state(), {
      asOfInstantMs: context.clock.nowMs(),
      calculationVersion: 'p03-task-c-1',
    });
    if (availability.status !== 'computed') throw new Error(`availability unavailable: ${availability.reason}`);
    return availability.available.minorUnits;
  };

  return { repo, context, bookId, run, previewRaw, state, availableMinor };
}

export async function seedStandardBook(harness: TaskCHarness, options: SeedBookOptions = {}): Promise<void> {
  const currency = options.currency ?? 'SAR';
  const funds = options.startingFundsMinor ?? 100_000;
  await harness.run({
    kind: 'createBook',
    bookId: harness.bookId,
    displayName: options.displayName ?? 'task-c',
    currency,
    timeZone: options.timeZone ?? 'Asia/Riyadh',
    cycleAnchor: options.anchor ?? { kind: 'firstOfMonth' },
  });
  await harness.run({
    kind: 'openCycle',
    bookId: harness.bookId,
    startDate: options.startDate ?? '2026-09-01',
    startingFunds: { currency, minorUnits: funds },
  });
}

/** Executes with a caller-chosen operation ID (for retry/conflict tests). */
export async function executeWithId(
  harness: TaskCHarness,
  rawCommand: unknown,
  operationId: string,
): Promise<Awaited<ReturnType<typeof executeCommand>>> {
  const preview = previewCommand(harness.repo, rawCommand, harness.context);
  expect(preview.ok, preview.ok ? undefined : describeCommandFailure(preview.failure)).toBe(true);
  if (!preview.ok) throw new Error('unreachable');
  return executeCommand(
    harness.repo,
    rawCommand,
    {
      operationId: asOperationId(operationId),
      expectedRevision: preview.preview.expectedRevision,
      previewDigest: preview.preview.previewDigest,
    },
    harness.context,
  );
}

export function completenessOf(harness: TaskCHarness): ReturnType<typeof computeCompleteness> {
  return computeCompleteness(harness.state(), {
    asOfInstantMs: harness.context.clock.nowMs(),
    calculationVersion: 'p03-task-c-1',
  });
}

export function revisionOf(harness: TaskCHarness): number {
  return harness.state().revision;
}
