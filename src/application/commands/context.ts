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

import { isRepresentableInstantMs } from '../../domain/primitives/instant';
import { makeDeviceId, makeRepositoryScopeId, type CommandOrigin } from '../../domain/sync/scope';

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
  /**
   * Execution origin stamped into every receipt, operation journal entry,
   * and outbox intent: which device committed, inside which identity-scoped
   * repository. Required so sync-facing records always bind scope, device,
   * and durable order; the finance commands themselves carry no ownership
   * fields, and this origin is a local record-stamping claim, never cloud
   * authorization (P08 derives ownership from the session server-side).
   */
  readonly origin: CommandOrigin;
}

export interface HandlerClockTrace {
  readonly context: CommandContext;
  readonly instants: readonly number[];
}

/** Records only handler clock reads while delegating IDs and provenance unchanged. */
export function traceHandlerClock(context: CommandContext): HandlerClockTrace {
  const instants: number[] = [];
  return {
    context: {
      ...context,
      clock: {
        nowMs: () => {
          const instantMs = context.clock.nowMs();
          if (!isRepresentableInstantMs(instantMs)) {
            throw new TypeError('handler clock returned an instant outside the representable range');
          }
          instants.push(instantMs);
          return instantMs;
        },
      },
    },
    instants,
  };
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
  const origin = (candidate as { origin?: unknown }).origin;
  if (typeof origin !== 'object' || origin === null || Array.isArray(origin)) {
    throw new TypeError('command context requires an origin with deviceId and scopeId');
  }
  const originRecord = origin as Record<string, unknown>;
  const deviceId = makeDeviceId(originRecord['deviceId']);
  if (!deviceId.ok) {
    throw new TypeError(`command context origin deviceId is invalid: ${deviceId.failure.detail}`);
  }
  const scopeId = makeRepositoryScopeId(originRecord['scopeId']);
  if (!scopeId.ok) {
    throw new TypeError(`command context origin scopeId is invalid: ${scopeId.failure.detail}`);
  }
  return value as CommandContext;
}
