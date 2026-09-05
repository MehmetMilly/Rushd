/**
 * Deterministic command context for tests.
 *
 * The clock returns a fixed base instant and advances by a fixed step on each
 * call, and IDs are sequential per prefix, so every run is reproducible and
 * no ambient global is read.
 */

import type { CommandContext, DomainClock, DomainIdFactory } from '../../../src/application/commands/context';

export const DEFAULT_BASE_INSTANT_MS = Date.UTC(2026, 8, 5, 12, 0, 0); // 2026-09-05T12:00:00Z
export const DEFAULT_STEP_MS = 1_000;
export const DEFAULT_CALCULATION_VERSION = 'p03-task-a-1';

export interface DeterministicContextOptions {
  readonly baseInstantMs?: number;
  readonly stepMs?: number;
  readonly calculationVersion?: string;
}

export interface DeterministicContext {
  readonly context: CommandContext;
  /** The instant the next clock call will return. */
  nextInstantMs(): number;
}

export function createDeterministicContext(options: DeterministicContextOptions = {}): DeterministicContext {
  const base = options.baseInstantMs ?? DEFAULT_BASE_INSTANT_MS;
  const step = options.stepMs ?? DEFAULT_STEP_MS;
  const calculationVersion = options.calculationVersion ?? DEFAULT_CALCULATION_VERSION;

  let current = base;
  const clock: DomainClock = {
    nowMs: () => {
      const value = current;
      current += step;
      return value;
    },
  };
  const counters = new Map<string, number>();
  const ids: DomainIdFactory = {
    newId: (prefix: string) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}-${String(next).padStart(4, '0')}`;
    },
  };
  return {
    context: { clock, ids, calculationVersion },
    nextInstantMs: () => current,
  };
}
