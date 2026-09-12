// P04-D1 declaration boundary for the legacy port set.
// Runtime lives in `./legacy-ports.js`; deep contracts in `./contracts.js`.
import type {
  AuthorityState,
  ShellFeaturePorts,
} from './contracts.js';
import type { LegacyDataRuntime } from '../../data/legacy-v1/runtime.js';

export function createLegacyFeaturePorts(
  dataRuntime: LegacyDataRuntime,
  environment?: typeof globalThis,
  initialAuthority?: AuthorityState,
): ShellFeaturePorts;

export function bindAuthorityState(ports: ShellFeaturePorts, state: AuthorityState): void;
