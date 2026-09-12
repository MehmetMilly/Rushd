// P04-D3 declaration boundary for the explicit candidate-shell adapter.
// Runtime lives in `./candidate-shell.js`.
import type { AuthorityState, ShellFeaturePorts } from './contracts.ts';
import type { CommandContext, DomainIdFactory } from '../commands/index.ts';
import type { ControlStore } from '../../data/migration/control-store.ts';
import type { ExtractedLegacySnapshot } from '../../data/migration/extract.ts';
import type { CanonicalHost, CanonicalStorageAdapter } from './canonical-host.ts';
import type { TabCoordinator } from './tab-coordination.ts';
import type { LegacyApplicationOptions } from '../bootstrap.js';

export function createCandidateIdFactory(): DomainIdFactory;

export interface CandidateShellOptions {
  readonly Vue: LegacyApplicationOptions['Vue'];
  readonly environment?: typeof globalThis;
  readonly template?: string;
  readonly context: CommandContext;
  readonly snapshot?: ExtractedLegacySnapshot;
  readonly migrationId?: string;
  readonly control?: ControlStore;
  readonly workerUrl?: string;
  readonly sqliteAssetBase?: string;
  readonly selectedDate?: string;
  readonly coordination?: TabCoordinator;
  readonly storage?: CanonicalStorageAdapter;
  readonly registerPwa?: boolean;
}

export interface CandidateShell {
  readonly app: unknown;
  readonly dataRuntime: unknown;
  readonly featurePorts: ShellFeaturePorts;
  readonly authority: AuthorityState;
  readonly host: CanonicalHost;
  readonly coordination: TabCoordinator;
  readonly pwa: { readonly ok: boolean; readonly reason: string } | null;
}

export function prepareCandidateShell(options: CandidateShellOptions): Promise<CandidateShell>;
