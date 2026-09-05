/**
 * Command execution context.
 *
 * Clocks and ID factories are injected through the context; the domain and
 * application layers never read ambient globals such as Date.now or
 * Math.random, so runs are deterministic and testable. `calculationVersion`
 * is stamped into receipts and captured facts so later calculation changes
 * can be identified.
 *
 * Context is developer-supplied infrastructure: a malformed context throws a
 * TypeError instead of returning a command failure, because it is not user
 * input. The context carries no credentials, and nothing in it implies
 * implemented cloud authorization.
 */

export interface DomainClock {
  nowMs(): number;
}

export interface DomainIdFactory {
  newId(prefix: string): string;
}

export interface CommandContext {
  readonly clock: DomainClock;
  readonly ids: DomainIdFactory;
  readonly calculationVersion: string;
}

export function requireCommandContext(value: unknown): CommandContext {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('command context must be an object with clock, ids, and calculationVersion');
  }
  const candidate = value as Partial<CommandContext>;
  if (
    typeof candidate.clock !== 'object' ||
    candidate.clock === null ||
    typeof candidate.clock.nowMs !== 'function'
  ) {
    throw new TypeError('command context requires a clock with nowMs()');
  }
  if (typeof candidate.ids !== 'object' || candidate.ids === null || typeof candidate.ids.newId !== 'function') {
    throw new TypeError('command context requires an ids factory with newId()');
  }
  if (typeof candidate.calculationVersion !== 'string' || candidate.calculationVersion.length === 0) {
    throw new TypeError('command context requires a non-empty calculationVersion string');
  }
  return value as CommandContext;
}
