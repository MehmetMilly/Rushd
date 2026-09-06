/**
 * Identity and repository-scope separation (P03 Task D, proof scenario 1).
 *
 * Two identity scopes use the same raw book and entity IDs without
 * collision; a cross-scope reference cannot read or mutate the other scope;
 * and no command field can grant ownership (client-supplied ownership is
 * rejected as unknown input, never trusted).
 */

import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  executeCommand,
  previewCommand,
  stableDigest,
  validateFinanceCommand,
  type CommandReceipt,
} from '../../src/application/commands';
import type { CommandContext } from '../../src/application/commands/context';
import {
  makeBookId,
  makeOperationId,
  type BookId,
  type OperationId,
} from '../../src/domain/contracts/identity';
import {
  makeAccountId,
  makeDeviceId,
  makeGuestKey,
  parseRepositoryScopeId,
  parseServerIdempotencyKey,
  repositoryScopeIdFor,
  serverIdempotencyKeyFor,
  validateLocalPrincipal,
} from '../../src/domain/sync/scope';
import { InMemoryFinanceRepository } from './support/in-memory-repository';
import { makeScopedHarness } from './support/scoped-harness';

function branded<T>(result: { ok: true; value: T } | { ok: false; failure: { detail: string } }): T {
  if (!result.ok) throw new Error(`invalid test id: ${result.failure.detail}`);
  return result.value;
}

const RAW_BOOK_ID = 'book-shared';
const bookId: BookId = branded(makeBookId(RAW_BOOK_ID));

function op(raw: string): OperationId {
  return branded(makeOperationId(raw));
}

interface ScopeHarness {
  readonly repo: InMemoryFinanceRepository;
  readonly context: CommandContext;
}

function guestHarness(deviceId: string): ScopeHarness {
  return makeScopedHarness({ deviceId });
}

function accountHarness(deviceId: string, accountId: string): ScopeHarness {
  return makeScopedHarness({ deviceId, accountId });
}

const createBook = {
  kind: 'createBook',
  bookId: RAW_BOOK_ID,
  displayName: 'shared book',
  currency: 'SAR',
  timeZone: 'Asia/Riyadh',
  cycleAnchor: { kind: 'firstOfMonth' },
};

const openCycle = {
  kind: 'openCycle',
  bookId: RAW_BOOK_ID,
  startDate: '2026-09-01',
  startingFunds: { currency: 'SAR', minorUnits: 100_000 },
};

function inflow(amount: number, day: string): Record<string, unknown> {
  return {
    kind: 'recordInflow',
    bookId: RAW_BOOK_ID,
    amount: { currency: 'SAR', minorUnits: amount },
    occurredAt: { kind: 'civilDate', localDate: day },
    note: '',
  };
}

async function run(harness: ScopeHarness, operationId: string, rawCommand: unknown): Promise<CommandReceipt> {
  const preview = previewCommand(harness.repo, rawCommand, harness.context);
  expect(preview.ok).toBe(true);
  if (!preview.ok) throw new Error('unreachable');
  const result = await executeCommand(
    harness.repo,
    rawCommand,
    { operationId: op(operationId), expectedRevision: preview.preview.expectedRevision, previewDigest: preview.preview.previewDigest },
    harness.context,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.receipt;
}

describe('identity scope separation', () => {
  it('derives disjoint namespaces for guest, account, and device identities', () => {
    const deviceA = branded(makeDeviceId('device-a'));
    const deviceB = branded(makeDeviceId('device-b'));
    const guestKey = branded(makeGuestKey('guest-1'));
    const accountId = branded(makeAccountId('account-1'));

    const guestA = repositoryScopeIdFor({ kind: 'guest', guestKey, deviceId: deviceA });
    const guestB = repositoryScopeIdFor({ kind: 'guest', guestKey, deviceId: deviceB });
    const accountA = repositoryScopeIdFor({ kind: 'account', accountId, deviceId: deviceA });

    expect(guestA).not.toBe(guestB);
    expect(guestA).not.toBe(accountA);
    expect(guestB).not.toBe(accountA);

    // Server idempotency keys bind the session account, never a client payload.
    const key = serverIdempotencyKeyFor(accountId, op('op-1'));
    const parsedKey = parseServerIdempotencyKey(key);
    expect(parsedKey).toEqual({ ok: true, accountId: accountId as string, operationId: 'op-1' });
  });

  it('rejects malformed principals at adapter boundaries', () => {
    expect(validateLocalPrincipal(null).ok).toBe(false);
    expect(validateLocalPrincipal({ kind: 'guest' }).ok).toBe(false);
    expect(validateLocalPrincipal({ kind: 'account', accountId: 'a', deviceId: 'd with space' }).ok).toBe(false);
    const guest = validateLocalPrincipal({ kind: 'guest', guestKey: 'g', deviceId: 'd' });
    expect(guest.ok).toBe(true);
    const account = validateLocalPrincipal({ kind: 'account', accountId: 'a', deviceId: 'd' });
    expect(account.ok).toBe(true);
  });

  it('never collides across separator-containing tuples (adversarial)', () => {
    const device = (raw: string) => branded(makeDeviceId(raw));
    const guest = (raw: string) => branded(makeGuestKey(raw));
    const account = (raw: string) => branded(makeAccountId(raw));

    // The classic collision: ('a:b', 'c') vs ('a', 'b:c') must differ.
    const left = repositoryScopeIdFor({ kind: 'account', accountId: account('a:b'), deviceId: device('c') });
    const right = repositoryScopeIdFor({ kind: 'account', accountId: account('a'), deviceId: device('b:c') });
    expect(left as string).not.toBe(right as string);
    expect(parseRepositoryScopeId(left)).toEqual({ ok: true, kind: 'account', accountId: 'a:b', deviceId: 'c' });
    expect(parseRepositoryScopeId(right)).toEqual({ ok: true, kind: 'account', accountId: 'a', deviceId: 'b:c' });

    // Guest tuples with separators and slashes round-trip exactly.
    const guestScope = repositoryScopeIdFor({ kind: 'guest', guestKey: guest('g/x:y'), deviceId: device('d:1/2') });
    expect(parseRepositoryScopeId(guestScope)).toEqual({ ok: true, kind: 'guest', guestKey: 'g/x:y', deviceId: 'd:1/2' });

    // Guest and account namespaces can never overlap, even adversarially.
    const guestAsAccount = repositoryScopeIdFor({ kind: 'guest', guestKey: guest('account'), deviceId: device('x') });
    const realAccount = repositoryScopeIdFor({ kind: 'account', accountId: account('x'), deviceId: device('y') });
    expect(guestAsAccount as string).not.toBe(realAccount as string);

    // Server idempotency keys: ('a:b', 'c') vs ('a', 'b:c') must differ.
    const keyLeft = serverIdempotencyKeyFor(account('a:b'), op('c'));
    const keyRight = serverIdempotencyKeyFor(account('a'), op('b:c'));
    expect(keyLeft as string).not.toBe(keyRight as string);
    expect(parseServerIdempotencyKey(keyLeft)).toEqual({ ok: true, accountId: 'a:b', operationId: 'c' });
    expect(parseServerIdempotencyKey(keyRight)).toEqual({ ok: true, accountId: 'a', operationId: 'b:c' });

    // Malformed encodings are rejected, never guessed.
    expect(parseRepositoryScopeId('scope:account:bogus' as never)).toEqual({ ok: false });
    expect(parseRepositoryScopeId('scope:account:3:ab' as never)).toEqual({ ok: false });
    expect(parseServerIdempotencyKey('idemp:2:a:extra' as never)).toEqual({ ok: false });
    expect(parseServerIdempotencyKey('other:1:a/1:b' as never)).toEqual({ ok: false });
  });

  it('keeps the same raw book and entity IDs isolated across scopes', async () => {
    const guest = guestHarness('device-guest');
    const account = accountHarness('device-acct', 'account-1');

    await run(guest, 'op-create', createBook);
    await run(account, 'op-create', createBook);
    await run(guest, 'op-cycle', openCycle);
    await run(account, 'op-cycle', openCycle);
    await run(guest, 'op-inflow-g', inflow(10_000, '2026-09-03'));
    await run(account, 'op-inflow-a', inflow(50_000, '2026-09-04'));

    // Same raw IDs, unrelated records: neither scope observes the other.
    const guestState = guest.repo.getBookState(bookId);
    const accountState = account.repo.getBookState(bookId);
    expect(guestState?.entries).toHaveLength(1);
    expect(accountState?.entries).toHaveLength(1);
    expect(guestState?.entries[0]?.amount.minorUnits).toBe(10_000);
    expect(accountState?.entries[0]?.amount.minorUnits).toBe(50_000);

    // Operation IDs are unique per scope: the same raw ID commits independently in each.
    await run(guest, 'op-shared', inflow(1, '2026-09-05'));
    await run(account, 'op-shared', inflow(2, '2026-09-06'));
    expect(guest.repo.getOperation(op('op-shared'))?.receipt.enqueueSequence).toBeGreaterThan(0);
    expect(account.repo.getOperation(op('op-shared'))?.receipt.enqueueSequence).toBeGreaterThan(0);

    // Stamps name the committing scope: receipts never leak across it.
    expect(guest.repo.getOperation(op('op-shared'))?.scopeId).not.toBe(account.repo.getOperation(op('op-shared'))?.scopeId);
  });

  it('fails cross-scope references explicitly without reading or mutating the other scope', async () => {
    const guest = guestHarness('device-guest');
    const account = accountHarness('device-acct', 'account-1');
    await run(guest, 'op-create', createBook);
    await run(guest, 'op-cycle', openCycle);
    await run(guest, 'op-inflow-g', inflow(10_000, '2026-09-03'));

    const guestEntryId = guest.repo.getBookState(bookId)?.entries[0]?.entryId;
    expect(guestEntryId).toBeTruthy();

    // The account scope never saw this book: its commands fail unknownBook,
    // and the guest scope is untouched.
    const guestBytesBefore = guest.repo.snapshotBytes();
    const foreign = previewCommand(account.repo, inflow(5, '2026-09-10'), account.context);
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.failure.kind).toBe('unknownBook');

    // A guest entry ID presented to the account scope resolves to nothing:
    // unknownEntry, never a cross-scope read.
    await run(account, 'op-create', createBook);
    await run(account, 'op-cycle', openCycle);
    const crossScope = {
      kind: 'reverseInflow',
      bookId: RAW_BOOK_ID,
      inflowEntryId: guestEntryId,
      occurredAt: { kind: 'civilDate', localDate: '2026-09-10' },
      note: '',
    };
    const preview = previewCommand(account.repo, crossScope, account.context);
    expect(preview.ok).toBe(false);
    if (!preview.ok) expect(preview.failure.kind).toBe('unknownEntry');
    expect(guest.repo.snapshotBytes()).toBe(guestBytesBefore);
  });

  it('rejects client-supplied ownership fields instead of trusting them', () => {
    for (const forged of [
      { ...inflow(100, '2026-09-10'), ownerId: 'account-1' },
      { ...inflow(100, '2026-09-10'), accountId: 'account-1' },
      { ...createBook, ownerId: 'account-1' },
      { ...createBook, scopeId: 'scope:account:account-1:device-x' },
    ]) {
      const validated = validateFinanceCommand(forged);
      expect(validated.ok, JSON.stringify(forged)).toBe(false);
    }
    // The digest binds the exact canonical payload, so ownership cannot be
    // smuggled through the confirmation either: a forged payload never
    // matches a clean preview's digest.
    const clean = canonicalJson(inflow(100, '2026-09-10'));
    const forgedPayload = { ...inflow(100, '2026-09-10'), ownerId: 'account-1' };
    expect(stableDigest(`${canonicalJson(forgedPayload)}\n0`)).not.toBe(stableDigest(`${clean}\n0`));
  });
});

describe('scope binding enforcement', () => {
  it('rejects a mismatched origin before any read, replay, or mutation', async () => {
    const owner = accountHarness('device-owner', 'account-owner');
    const intruder = accountHarness('device-intruder', 'account-intruder');

    const receipt = await run(owner, 'op-create', createBook);
    expect(receipt.scopeId).toBe(owner.repo.boundScope);

    const ownerBytes = owner.repo.snapshotBytes();

    // Preview with the intruder origin against the bound book: scopeMismatch,
    // proved before any bound state is observed.
    const intruderPreview = previewCommand(owner.repo, inflow(5, '2026-09-10'), intruder.context);
    expect(intruderPreview.ok).toBe(false);
    if (!intruderPreview.ok) {
      expect(intruderPreview.failure.kind).toBe('scopeMismatch');
      if (intruderPreview.failure.kind === 'scopeMismatch') {
        expect(intruderPreview.failure.expectedScope).toBe(owner.repo.boundScope);
        expect(intruderPreview.failure.actualScope).toBe(intruder.repo.boundScope);
      }
    }

    // Execution with the intruder origin: no mutation and no replay.
    const intruderCommand = inflow(5, '2026-09-10');
    const intruderExecute = await executeCommand(
      owner.repo,
      intruderCommand,
      { operationId: op('op-intruder'), expectedRevision: 1, previewDigest: stableDigest(`${canonicalJson(intruderCommand)}\n1`) },
      intruder.context,
    );
    expect(intruderExecute.ok).toBe(false);
    if (!intruderExecute.ok) expect(intruderExecute.failure.kind).toBe('scopeMismatch');

    // Replaying the owner's committed receipt through the intruder origin
    // does not return the owner's receipt.
    const replay = await executeCommand(
      owner.repo,
      createBook,
      { operationId: op('op-create'), expectedRevision: 0, previewDigest: stableDigest(`${canonicalJson(createBook)}\n0`) },
      intruder.context,
    );
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.failure.kind).toBe('scopeMismatch');

    expect(owner.repo.snapshotBytes()).toBe(ownerBytes);
    expect(owner.repo.getBookState(bookId)?.revision).toBe(1);
  });

  it('keeps reopened handles bound to their original scope', async () => {
    const owner = accountHarness('device-owner', 'account-owner');
    const intruder = accountHarness('device-intruder', 'account-intruder');
    await run(owner, 'op-create', createBook);

    const reopened = owner.repo.reopen();
    expect(reopened.boundScope).toBe(owner.repo.boundScope);
    expect(reopened.boundDevice).toBe(owner.repo.boundDevice);

    const intruderAttempt = previewCommand(reopened, inflow(5, '2026-09-10'), intruder.context);
    expect(intruderAttempt.ok).toBe(false);
    if (!intruderAttempt.ok) expect(intruderAttempt.failure.kind).toBe('scopeMismatch');
  });
});
