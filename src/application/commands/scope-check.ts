/**
 * Scope-binding verification shared by preview and execution.
 *
 * The repository handle is bound to exactly one local principal's
 * namespace. The caller's context origin must name that same scope and
 * device before any read, replay, or mutation; otherwise the attempt fails
 * with an explicit `scopeMismatch` failure. This is a typed rejection, not
 * an infrastructure throw, so callers can distinguish it from finance
 * failures and no mismatched attempt can touch bound state.
 */

import type { CommandFailure } from '../../domain/contracts/commands';
import type { ScopedRepository } from '../../domain/contracts/repository';
import type { CommandOrigin } from '../../domain/sync/scope';

export type ScopeBinding = { readonly ok: true } | { readonly ok: false; readonly failure: CommandFailure };

export function checkScopeBinding(repository: ScopedRepository, origin: CommandOrigin): ScopeBinding {
  if ((repository.boundScope as string) !== (origin.scopeId as string)) {
    return {
      ok: false,
      failure: {
        kind: 'scopeMismatch',
        expectedScope: repository.boundScope,
        actualScope: origin.scopeId,
        detail: 'caller origin scope does not match the bound repository scope',
      },
    };
  }
  if ((repository.boundDevice as string) !== (origin.deviceId as string)) {
    return {
      ok: false,
      failure: {
        kind: 'scopeMismatch',
        expectedScope: repository.boundScope,
        actualScope: origin.scopeId,
        detail: 'caller origin device does not match the bound repository device',
      },
    };
  }
  return { ok: true };
}
