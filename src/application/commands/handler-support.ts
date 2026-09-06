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
import { makeAllocationRecordId, makeCycleVersionId, makeEntryId, makeObservationId, makeOccurrenceId, makeSettlementId, type AllocationRecordId, type BookId, type CycleVersionId, type EntryId, type ObservationId, type SettlementId } from '../../domain/contracts/identity';
import type { CommandFailure, OccurredAt } from '../../domain/contracts/commands';
import { findOpenCycle, type CycleRecord } from '../../domain/contracts/ledger';
import type { BookState } from '../../domain/contracts/ledger';
import type { CommandContext } from './context';

export function requireOpenCycle(state: BookState): { ok: true; value: CycleRecord } | { ok: false; failure: CommandFailure } {
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
  cycle: CycleRecord,
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

/** The financial occurrence instant of a command, if it named one. */
export function occurredInstantOf(occurredAt: OccurredAt): number | null {
  return occurredAt.kind === 'instant' ? occurredAt.instantMs : null;
}

/**
 * A version identity in its own namespace: `cycver:<book>:<start>:v<seq>`.
 * It can never collide with `composeCycleId`'s `cyc:` identities.
 */
export function newCycleVersionId(bookId: BookId, startDate: CivilDate, versionSeq: number): CycleVersionId {
  const made = makeCycleVersionId(`cycver:${bookId}:${startDate}:v${String(versionSeq)}`);
  if (!made.ok) {
    throw new TypeError(`cycle version id could not be composed (${made.failure.detail})`);
  }
  return made.value;
}

/** A settlement identity: `stl:<book>:<start>:s<seq>`, stable per version. */
export function newSettlementId(bookId: BookId, startDate: CivilDate, settlementSeq: number): SettlementId {
  const made = makeSettlementId(`stl:${bookId}:${startDate}:s${String(settlementSeq)}`);
  if (!made.ok) {
    throw new TypeError(`settlement id could not be composed (${made.failure.detail})`);
  }
  return made.value;
}

/** A generated observation identity from the caller's ID sequence. */
export function newObservationId(context: CommandContext): ObservationId {
  const made = makeObservationId(context.ids.newId('observation'));
  if (!made.ok) {
    throw new TypeError(`id factory produced an invalid observation id: ${made.failure.detail}`);
  }
  return made.value;
}

/** A deterministic occurrence identity helper for plan materialization. */
export function newOccurrenceIdFor(planId: string, dueDate: CivilDate): ReturnType<typeof makeOccurrenceId> {
  return makeOccurrenceId(`occ:${planId}:${dueDate}`);
}
