/**
 * Shared pure helpers for concrete command handlers.
 *
 * Extracted from the Task A handlers so per-domain handler modules reuse the
 * exact same open-cycle, occurrence, currency, and ID plumbing instead of
 * growing one file. Handlers stay pure: context supplies clock and IDs, and
 * failures are typed values, never thrown errors.
 */

import type { CivilDate } from '../../domain/primitives/civil-date';
import { resolveCivilDate, type TimeZoneName } from '../../domain/primitives/instant';
import { isDateWithinMonthlyWindow } from '../../domain/primitives/monthly-cycle';
import { type CurrencyCode } from '../../domain/primitives/currency';
import { makeAllocationRecordId, makeEntryId, type AllocationRecordId, type BookId, type EntryId } from '../../domain/contracts/identity';
import type { CommandFailure, OccurredAt } from '../../domain/contracts/commands';
import { findOpenCycle, type OpenCycleRecord } from '../../domain/contracts/ledger';
import type { BookState } from '../../domain/contracts/ledger';
import type { CommandContext } from './context';

export function requireOpenCycle(state: BookState): { ok: true; value: OpenCycleRecord } | { ok: false; failure: CommandFailure } {
  const openCycle = findOpenCycle(state);
  if (openCycle === null) {
    return { ok: false, failure: { kind: 'noOpenCycle', bookId: state.book.id } };
  }
  return { ok: true, value: openCycle };
}

export function resolveOccurredAt(
  occurredAt: OccurredAt,
  timeZone: TimeZoneName,
  bookId: BookId,
): { ok: true; value: CivilDate } | { ok: false; failure: CommandFailure } {
  if (occurredAt.kind === 'civilDate') {
    return { ok: true, value: occurredAt.localDate };
  }
  const resolved = resolveCivilDate(occurredAt.instantMs, timeZone);
  if (!resolved.ok) {
    return {
      ok: false,
      failure: {
        kind: 'invalidOccurredAt',
        bookId,
        detail: `instant ${occurredAt.instantMs} could not be resolved in ${timeZone} (${resolved.failure.reason})`,
      },
    };
  }
  return { ok: true, value: resolved.value };
}

export function requireDateInOpenCycle(
  localDate: CivilDate,
  cycle: OpenCycleRecord,
  bookId: BookId,
): { ok: true } | { ok: false; failure: CommandFailure } {
  if (!isDateWithinMonthlyWindow(localDate, { startDate: cycle.startDate, endDateExclusive: cycle.endDateExclusive })) {
    return {
      ok: false,
      failure: { kind: 'dateOutsideOpenCycle', bookId, localDate, openCycleId: cycle.cycleId },
    };
  }
  return { ok: true };
}

export function currencyMismatchFailure(bookId: BookId, bookCurrency: CurrencyCode, providedCurrency: CurrencyCode): { ok: false; failure: CommandFailure } {
  return {
    ok: false,
    failure: { kind: 'currencyMismatch', bookId, bookCurrency, providedCurrency },
  };
}

export function newEntryId(context: CommandContext, prefix: string): EntryId {
  const made = makeEntryId(context.ids.newId(prefix));
  if (!made.ok) {
    throw new TypeError(`id factory produced an invalid entry id: ${made.failure.detail}`);
  }
  return made.value;
}

export function newObligationEventId(context: CommandContext): EntryId {
  return newEntryId(context, 'obligation-event');
}

export function newAllocationRecordId(context: CommandContext): AllocationRecordId {
  const made = makeAllocationRecordId(context.ids.newId('allocation'));
  if (!made.ok) {
    throw new TypeError(`id factory produced an invalid allocation record id: ${made.failure.detail}`);
  }
  return made.value;
}

export function monthParts(date: CivilDate): { year: number; month: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}
