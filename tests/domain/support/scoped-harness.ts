/**
 * Scope-bound test harness.
 *
 * Builds a repository handle whose immutable scope/device binding always
 * matches the context origin, so ordinary tests exercise the bound path
 * without hand-deriving scope IDs. Mismatched-origin tests construct the
 * handle and context separately on purpose.
 */

import type { CommandContext } from '../../../src/application/commands/context';
import { createDeterministicContext, type DeterministicContextOptions } from './deterministic-context';
import { InMemoryFinanceRepository } from './in-memory-repository';

export interface ScopedHarness {
  readonly repo: InMemoryFinanceRepository;
  readonly context: CommandContext;
}

export function makeScopedHarness(options: DeterministicContextOptions = {}): ScopedHarness {
  const { context } = createDeterministicContext(options);
  const repo = new InMemoryFinanceRepository({ boundScope: context.origin.scopeId, boundDevice: context.origin.deviceId });
  return { repo, context };
}
