/**
 * Pure derivations for Reality Check observations, reconciliation
 * adjustments, and recovery.
 *
 * The input is always the full amount physically left in the tracked pool,
 * including money earmarked for goals and reserved for unpaid obligations.
 * Goal funding/assignment/release and obligation reservations are
 * classifications inside that pool: they never create a physical
 * inflow/outflow for the observation comparison, so the ledger-derived pool
 * sums only starting funds, effective carry-in, pool-changing cash facts,
 * and earlier boundary residuals.
 *
 * Ordering against a boundary uses the financial occurrence — an explicit
 * instant resolved under the boundary timezone, or the local civil date —
 * never append order or `capturedAtInstantMs`. A civil-date-only fact on the
 * boundary's own local date carries no ordering evidence and is ambiguous.
 *
 * Correction families are attributed to their root occurrence: a corrected
 * pre-boundary expense still explains its boundary at its live replacement
 * amount, and a voided recovery explains nothing. This keeps every observed
 * pool invariant while later corrections recompute residuals forward.
 */

import { makeMoney, subtractMoney, sumMoney, type Money } from '../primitives/money';
import { compareCivilDates, type CivilDate } from '../primitives/civil-date';
import { resolveCivilDateTime, type TimeZoneName } from '../primitives/instant';
import type {
  BookState,
  CycleRecord,
  ExpenseEntry,
  RealityCheckObservation,
  ReconciliationAdjustment,
} from '../contracts/ledger';
import type { EntryId } from '../contracts/identity';
import {
  expenseCorrectionFamily,
  findExpenseReturnReversalOf,
  isExpenseLive,
} from '../activity/derive';

export interface ResolvedBoundary {
  readonly localDate: CivilDate;
  /** Wall time `HH:MM:SS` in `timeZone` (from the instant or the input). */
  readonly localTime: string;
  readonly instantMs: number | null;
  readonly timeZone: TimeZoneName;
}

export type BoundaryOrder = 'before' | 'after' | 'ambiguous';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function boundaryFromObservation(observation: RealityCheckObservation): ResolvedBoundary {
  if (observation.boundaryInstantMs !== null) {
    const resolved = resolveCivilDateTime(observation.boundaryInstantMs, observation.boundaryTimeZone);
    if (!resolved.ok) {
      throw new TypeError(`stored observation boundary could not be resolved (${resolved.failure.reason})`);
    }
    return {
      localDate: resolved.value.localDate,
      localTime: `${pad2(resolved.value.hour)}:${pad2(resolved.value.minute)}:${pad2(resolved.value.second)}`,
      instantMs: observation.boundaryInstantMs,
      timeZone: observation.boundaryTimeZone,
    };
  }
  if (observation.boundaryLocalTime === null) {
    throw new TypeError('stored civil observation boundary carries no wall time');
  }
  return {
    localDate: observation.boundaryLocalDate,
    localTime: observation.boundaryLocalTime,
    instantMs: null,
    timeZone: observation.boundaryTimeZone,
  };
}

/**
 * Orders one financial occurrence against a boundary. An explicit instant on
 * either side of the boundary resolves deterministically under the boundary
 * timezone (including DST rules via the platform database); an occurrence at
 * exactly the boundary instant counts as at-or-before. A civil-date-only
 * occurrence on the boundary's own date is ambiguous.
 */
export function compareOccurrenceToBoundary(
  occurrence: { readonly localDate: CivilDate; readonly instantMs: number | null },
  boundary: ResolvedBoundary,
): BoundaryOrder {
  if (occurrence.instantMs !== null) {
    const resolved = resolveCivilDateTime(occurrence.instantMs, boundary.timeZone);
    if (!resolved.ok) {
      throw new TypeError(`stored occurrence instant could not be resolved (${resolved.failure.reason})`);
    }
    const occurrenceKey = `${resolved.value.localDate}T${pad2(resolved.value.hour)}:${pad2(resolved.value.minute)}:${pad2(resolved.value.second)}`;
    const boundaryKey = `${boundary.localDate}T${boundary.localTime}`;
    if (occurrenceKey <= boundaryKey) return 'before';
    return 'after';
  }
  const order = compareCivilDates(occurrence.localDate, boundary.localDate);
  if (order < 0) return 'before';
  if (order > 0) return 'after';
  return 'ambiguous';
}

/** True when the occurrence belongs at or before the boundary. */
export function isOccurrenceCoveredBy(
  occurrence: { readonly localDate: CivilDate; readonly instantMs: number | null },
  boundary: ResolvedBoundary,
): boolean {
  return compareOccurrenceToBoundary(occurrence, boundary) === 'before';
}

function zeroOf(currency: Money['currency']): Money {
  const made = makeMoney(currency, 0);
  if (!made.ok) throw new TypeError('book currency must be supported');
  return made.value;
}

/** The live head amount of an expense correction family (0 when voided). */
export function liveExpenseHeadAmount(state: BookState, expenseEntryId: EntryId): Money {
  const family = expenseCorrectionFamily(state, expenseEntryId);
  const currency = family.length > 0 ? family[0].amount.currency : state.book.currency;
  let head: ExpenseEntry | null = null;
  for (const entry of family) {
    if (isExpenseLive(state, entry.entryId)) head = entry;
  }
  return head === null ? zeroOf(currency) : head.amount;
}

/** The live head amount of a return correction chain (0 when voided). */
export function liveReturnHeadAmount(state: BookState, returnEntryId: EntryId): Money {
  interface ReturnNode {
    readonly amount: Money;
    readonly replaces: EntryId | null;
    readonly live: boolean;
  }
  const byId = new Map<EntryId, ReturnNode>();
  for (const entry of state.entries) {
    if (entry.kind === 'expenseReturn') {
      byId.set(entry.entryId, {
        amount: entry.amount,
        replaces: entry.replacesReturnEntryId,
        live: findExpenseReturnReversalOf(state, entry.entryId) === null,
      });
    }
  }
  const start = byId.get(returnEntryId);
  if (start === undefined) return zeroOf(state.book.currency);
  const childOf = new Map<EntryId, ReturnNode>();
  for (const node of byId.values()) {
    if (node.replaces !== null && !childOf.has(node.replaces)) childOf.set(node.replaces, node);
  }
  let head = start;
  let next = childOf.get(returnEntryId);
  while (next !== undefined) {
    head = next;
    const headId = [...byId.entries()].find(([, node]) => node === head)?.[0];
    next = headId === undefined ? undefined : childOf.get(headId);
  }
  return head.live ? head.amount : zeroOf(head.amount.currency);
}

/** An inflow counts at its amount while unreversed, otherwise zero. */
export function liveInflowAmount(state: BookState, inflowEntryId: EntryId): Money {
  const entry = state.entries.find((candidate) => candidate.entryId === inflowEntryId) ?? null;
  if (entry === null || entry.kind !== 'inflow') return zeroOf(state.book.currency);
  const reversed = state.entries.some(
    (candidate) => candidate.kind === 'inflowReversal' && candidate.reversesEntryId === inflowEntryId,
  );
  return reversed ? zeroOf(entry.amount.currency) : entry.amount;
}

/**
 * The signed consumable remainder of one adjustment: its recorded amount
 * plus every linked recovery at its current effective value (expenses add,
 * inflows and returns subtract). Derived, never stored, so correcting or
 * reversing a recovered activity recomputes the boundary forward.
 */
export function adjustmentResidual(state: BookState, adjustment: ReconciliationAdjustment): Money {
  const parts: Money[] = [adjustment.amount];
  for (const link of state.recoveryLinks) {
    if (link.adjustmentId !== adjustment.adjustmentId) continue;
    if (link.movementKind === 'expense') {
      parts.push(liveExpenseHeadAmount(state, link.entryId));
    } else if (link.movementKind === 'inflow') {
      parts.push(negate(liveInflowAmount(state, link.entryId)));
    } else {
      parts.push(negate(liveReturnHeadAmount(state, link.entryId)));
    }
  }
  const summed = sumMoney(parts as [Money, ...Money[]]);
  if (!summed.ok) throw new TypeError(`adjustment residual could not be summed exactly (${summed.failure.reason})`);
  return summed.value;
}

function negate(value: Money): Money {
  return { currency: value.currency, minorUnits: value.minorUnits === 0 ? 0 : -value.minorUnits };
}

export interface FamilyOccurrence {
  readonly localDate: CivilDate;
  readonly instantMs: number | null;
}

/** The root occurrence of a return correction chain. */
function returnChainRoot(state: BookState, returnEntryId: EntryId): FamilyOccurrence | null {
  let current = state.entries.find((entry) => entry.entryId === returnEntryId) ?? null;
  if (current === null || current.kind !== 'expenseReturn') return null;
  const seen = new Set<string>();
  while (current.replacesReturnEntryId !== null && !seen.has(current.entryId)) {
    seen.add(current.entryId);
    const parent = state.entries.find((entry) => entry.entryId === (current as { replacesReturnEntryId: EntryId | null }).replacesReturnEntryId) ?? null;
    if (parent === null || parent.kind !== 'expenseReturn') break;
    current = parent;
  }
  return { localDate: current.localDate, instantMs: current.occurredAtInstantMs };
}

/** The root occurrence of a recovery-linked entry (correction-aware). */
export function linkedRootOccurrence(
  state: BookState,
  link: { readonly entryId: EntryId; readonly movementKind: 'expense' | 'inflow' | 'return' },
): FamilyOccurrence | null {
  if (link.movementKind === 'expense') return expenseFamilyRoot(state, link.entryId);
  if (link.movementKind === 'return') return returnChainRoot(state, link.entryId);
  const entry = state.entries.find((candidate) => candidate.entryId === link.entryId) ?? null;
  if (entry === null) return null;
  return { localDate: entry.localDate, instantMs: entry.occurredAtInstantMs };
}

/** The signed current effect of one recovery link (as in the residual). */
export function linkedEffectAmount(
  state: BookState,
  link: { readonly entryId: EntryId; readonly movementKind: 'expense' | 'inflow' | 'return' },
): Money {
  if (link.movementKind === 'expense') return liveExpenseHeadAmount(state, link.entryId);
  if (link.movementKind === 'inflow') return negate(liveInflowAmount(state, link.entryId));
  return negate(liveReturnHeadAmount(state, link.entryId));
}

/**
 * An adjustment's contribution to current availability. In a full cycle this
 * is the residual: linked recoveries cancel against their own outflows in
 * the ledger. In a `remainingFromBoundary` cycle, recoveries rooted at or
 * before the opening boundary are pure history (their entries are excluded
 * from the starting pool), so their linked effects are stripped here and the
 * starting pool stays fixed.
 */
export function adjustmentContribution(state: BookState, adjustment: ReconciliationAdjustment, cycle: CycleRecord): Money {
  const residual = adjustmentResidual(state, adjustment);
  if (cycle.mode !== 'remainingFromBoundary') return residual;
  if (cycle.boundaryLocalDate === null || cycle.boundaryTimeZone === null) return residual;
  if (cycle.boundaryLocalTime === null && cycle.boundaryInstantMs === null) return residual;
  const boundary: ResolvedBoundary = {
    localDate: cycle.boundaryLocalDate,
    localTime: cycle.boundaryLocalTime ?? '00:00:00',
    instantMs: cycle.boundaryInstantMs,
    timeZone: cycle.boundaryTimeZone,
  };
  const strip: Money[] = [];
  for (const link of state.recoveryLinks) {
    if (link.adjustmentId !== adjustment.adjustmentId) continue;
    const root = linkedRootOccurrence(state, link);
    if (root === null || !isOccurrenceCoveredBy(root, boundary)) continue;
    strip.push(linkedEffectAmount(state, link));
  }
  if (strip.length === 0) return residual;
  strip.push(negate(residual));
  const negatedStrip = sumMoney(strip as [Money, ...Money[]]);
  if (!negatedStrip.ok) throw new TypeError(`adjustment contribution could not be summed exactly (${negatedStrip.failure.reason})`);
  return negate(negatedStrip.value);
}
/** The root occurrence of an expense correction family. */
function expenseFamilyRoot(state: BookState, expenseEntryId: EntryId): FamilyOccurrence | null {
  const family = expenseCorrectionFamily(state, expenseEntryId);
  if (family.length === 0) return null;
  let root = family[0];
  while (root.replacesEntryId !== null) {
    const parent = family.find((entry) => entry.entryId === root.replacesEntryId);
    if (parent === undefined) break;
    root = parent;
  }
  return { localDate: root.localDate, instantMs: root.occurredAtInstantMs };
}

/**
 * The ledger-derived pool of one cycle version at a boundary: starting
 * funds, effective carry-in, cash facts whose financial occurrence is
 * covered by the boundary (correction families at their live-head amount,
 * attributed to their root occurrence), and earlier boundary residuals.
 * Allocation funding/assignment/release and obligation reservations are
 * earmarks inside the pool and never enter this comparison. Future-effective
 * activity is excluded even when it was appended first.
 */
export function deriveLedgerPoolAt(
  state: BookState,
  cycle: CycleRecord,
  boundary: ResolvedBoundary,
  excludeObservationId: { readonly observationId: string } | null = null,
): Money {
  const parts: Money[] = [cycle.startingFunds];

  for (const action of state.carryActions) {
    const disposition = action.disposition;
    if (disposition.kind === 'carryIn' && disposition.destinationCycleId === cycle.cycleId) {
      parts.push(disposition.amount);
    } else if (disposition.kind === 'split' && disposition.destinationCycleId === cycle.cycleId) {
      parts.push(disposition.carryAmount);
    }
  }

  const seenFamilies = new Set<string>();
  for (const entry of state.entries) {
    if (entry.cycleId !== cycle.cycleId) continue;
    if (entry.kind === 'expense') {
      const family = expenseCorrectionFamily(state, entry.entryId);
      const rootId = family.length > 0 ? family[0].entryId : entry.entryId;
      if (seenFamilies.has(rootId)) continue;
      seenFamilies.add(rootId);
      const root = expenseFamilyRoot(state, entry.entryId);
      if (root === null || !isOccurrenceCoveredBy({ localDate: root.localDate, instantMs: root.instantMs }, boundary)) {
        continue;
      }
      const effective = liveExpenseHeadAmount(state, entry.entryId);
      if (effective.minorUnits !== 0) parts.push(negate(effective));
    } else if (entry.kind === 'inflow') {
      if (!isOccurrenceCoveredBy({ localDate: entry.localDate, instantMs: entry.occurredAtInstantMs }, boundary)) continue;
      const effective = liveInflowAmount(state, entry.entryId);
      if (effective.minorUnits !== 0) parts.push(effective);
    } else if (entry.kind === 'expenseReturn') {
      if (!isOccurrenceCoveredBy({ localDate: entry.localDate, instantMs: entry.occurredAtInstantMs }, boundary)) continue;
      const effective = liveReturnHeadAmount(state, entry.entryId);
      if (effective.minorUnits !== 0) parts.push(effective);
    }
    // Reversal facts only mark their target dead; the family/head derivations
    // above already exclude reversed facts, so summing one would double-count.
  }

  for (const adjustment of state.adjustments) {
    if (adjustment.cycleId !== cycle.cycleId) continue;
    if (excludeObservationId !== null && adjustment.observationId === excludeObservationId.observationId) continue;
    const observation = state.observations.find((candidate) => candidate.observationId === adjustment.observationId) ?? null;
    if (observation === null) continue;
    const earlier = boundaryFromObservation(observation);
    if (!isBoundaryCoveredBy(earlier, boundary)) continue;
    parts.push(adjustmentResidual(state, adjustment));
  }

  const summed = sumMoney(parts as [Money, ...Money[]]);
  if (!summed.ok) throw new TypeError(`ledger pool could not be derived exactly (${summed.failure.reason})`);
  return summed.value;
}

/** True when `earlier` is at or before `later` (instant-aware, DST-safe). */
function isBoundaryCoveredBy(earlier: ResolvedBoundary, later: ResolvedBoundary): boolean {  if (earlier.instantMs !== null && later.instantMs !== null) return earlier.instantMs <= later.instantMs;
  const dateOrder = compareCivilDates(earlier.localDate, later.localDate);
  if (dateOrder !== 0) return dateOrder < 0;
  if (earlier.instantMs !== null || later.instantMs !== null) {
    return `${earlier.localDate}T${earlier.localTime}` <= `${later.localDate}T${later.localTime}`;
  }
  return true;
}

/** Deterministic total order over resolved boundaries (wall time, then instant). */
export function compareResolvedBoundaries(left: ResolvedBoundary, right: ResolvedBoundary): -1 | 0 | 1 {
  const leftKey = `${left.localDate}T${left.localTime}`;
  const rightKey = `${right.localDate}T${right.localTime}`;
  if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
  const leftInstant = left.instantMs ?? Number.MIN_SAFE_INTEGER;
  const rightInstant = right.instantMs ?? Number.MIN_SAFE_INTEGER;
  if (leftInstant !== rightInstant) return leftInstant < rightInstant ? -1 : 1;
  return 0;
}

/**
 * The earliest observation in a cycle whose boundary covers an occurrence.
 * A recovery must attach there: linking it to a later boundary would leave
 * the earlier boundary's ledger changed without consuming its adjustment,
 * breaking that boundary's observed-pool invariant. Returns null when no
 * observation in the cycle covers the occurrence.
 */
export function earliestCoveringObservation(
  state: BookState,
  cycleId: CycleRecord['cycleId'],
  occurrence: { readonly localDate: CivilDate; readonly instantMs: number | null },
): RealityCheckObservation | null {
  let best: RealityCheckObservation | null = null;
  let bestBoundary: ResolvedBoundary | null = null;
  for (const observation of state.observations) {
    if (observation.cycleId !== cycleId) continue;
    const boundary = boundaryFromObservation(observation);
    if (!isOccurrenceCoveredBy(occurrence, boundary)) continue;
    if (best === null || bestBoundary === null || compareResolvedBoundaries(boundary, bestBoundary) < 0) {
      best = observation;
      bestBoundary = boundary;
    }
  }
  return best;
}

/**
 * The signed reconciliation for an observation: observed pool minus the
 * ledger-derived pool at its boundary, in the book currency.
 */
export function deriveReconciliationAmount(
  state: BookState,
  cycle: CycleRecord,
  boundary: ResolvedBoundary,
  observedPool: Money,
): Money {
  const ledger = deriveLedgerPoolAt(state, cycle, boundary);
  const difference = subtractMoney(observedPool, ledger);
  if (!difference.ok) throw new TypeError(`reconciliation could not be derived exactly (${difference.failure.reason})`);
  return difference.value;
}

/**
 * Classifies a caller-named currency label against the book currency:
 * `ok` when it names the book currency unambiguously (or is absent),
 * `foreign` when it explicitly names another supported currency, and
 * `ambiguous` when it cannot be resolved (e.g. `$`, unknown text).
 */
export function classifyCurrencyLabel(
  label: string | null,
  bookCurrency: string,
): 'ok' | 'foreign' | 'ambiguous' {
  if (label === null) return 'ok';
  const normalized = label.trim().toLowerCase();
  if (normalized === '') return 'ok';
  const names: Record<string, readonly string[]> = {
    SAR: ['sar', 'saudi riyal', 'riyal', 'ر.س', 'ر س', 'sr'],
    USD: ['usd', 'us dollar', 'us dollars', 'dollar'],
    JPY: ['jpy', 'japanese yen', 'yen'],
    KWD: ['kwd', 'kuwaiti dinar', 'dinar'],
  };
  const bookNames = names[bookCurrency] ?? [];
  if (bookNames.includes(normalized) || normalized === bookCurrency.toLowerCase()) return 'ok';
  for (const [code, aliases] of Object.entries(names)) {
    if (code === bookCurrency) continue;
    if (aliases.includes(normalized) || normalized === code.toLowerCase()) return 'foreign';
  }
  if (normalized === '$') return 'ambiguous';
  return 'ambiguous';
}
