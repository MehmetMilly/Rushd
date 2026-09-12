// P04-D1 declaration boundary for the authority latch.
// Runtime lives in `./authority-latch.js`; deep contracts in `./contracts.js`.
import type {
  AuthorityState,
  P04DAuthorityRequest,
  P04DAuthorityResolution,
  P04DBuildMode,
  ShellFeaturePorts,
} from './contracts.js';

export const P04D_LEGACY_MODE: P04DBuildMode;
export const P04D_CANDIDATE_MODE: P04DBuildMode;
export const P04D_D1_CANDIDATE_BLOCKED_REASON: string;

export function normalizeP04DBuildMode(explicitMode: unknown): P04DBuildMode;

export function resolveP04DAuthority(
  request: P04DAuthorityRequest | null | undefined,
  legacyPorts: ShellFeaturePorts,
): P04DAuthorityResolution;

export function isAuthorityWritable(authority: AuthorityState): boolean;

export function describeAuthority(authority: AuthorityState): string;
