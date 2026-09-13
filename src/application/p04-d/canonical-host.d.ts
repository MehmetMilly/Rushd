// P04-D2 declaration boundary for the candidate-only canonical guest host.
// Runtime lives in `./canonical-host.js`.
import type { AuthorityState, ShellFeaturePorts } from './contracts.ts';
import type { CommandContext } from '../commands/index.ts';
import type { ControlStore } from '../../data/migration/control-store.ts';
import type { ExtractedLegacySnapshot } from '../../data/migration/extract.ts';
import type { MigrationResult } from '../../data/migration/staging.ts';
import type { TabCoordinator } from './tab-coordination.ts';

export const P04D_D2_PREPARING_REASON: string;
export const P04D_D2_NO_BOOK_REASON: string;
export const P04D_D2_D3_OWNED_REASON: string;
export const P04D_D2_D4_OWNED_REASON: string;
export const P04D_D3_PAY_BLOCKED_REASON: string;
export const P04D_D3_BULK_UNPAID_BLOCKED_REASON: string;
export const P04D_D4_PROFILE_BLOCKED_REASON: string;
export const P04D_D4_TEMPLATE_DELETE_BLOCKED_REASON: string;
export const P04D_D4_GOAL_DELETE_BLOCKED_REASON: string;
export const P04D_D4_ALLOWANCE_BLOCKED_REASON: string;
export const P04D_ONBOARDING_STATE_KEY: string;
export const P04D_NAV_INTENT_KEY: string;

export interface CanonicalStorageAdapter {
  readonly control?: ControlStore;
  openActive(storageId: string, options?: { readonly reset?: boolean }): Promise<unknown>;
  migrate(migrationId: string, snapshot: ExtractedLegacySnapshot): Promise<MigrationResult>;
  exportSnapshot(repository: unknown): Promise<unknown>;
  previewImport?(raw: unknown): Promise<{ readonly ok: boolean; readonly reason?: string }>;
  importReplacement(
    importId: string,
    raw: unknown,
    confirmation: string,
  ): Promise<{ readonly ok: boolean; readonly activeStorageId: string; readonly reason?: string; readonly detail?: string }>;
  resetScope(
    resetId: string,
    confirmation: string,
    scopeId: string,
  ): Promise<{ readonly ok: boolean; readonly activeStorageId: string; readonly reason?: string; readonly detail?: string }>;
}

export interface CanonicalHostOptions {
  readonly environment?: typeof globalThis;
  readonly context: CommandContext;
  readonly snapshot?: ExtractedLegacySnapshot;
  readonly migrationId?: string;
  readonly control?: ControlStore;
  readonly workerUrl?: string;
  readonly sqliteAssetBase?: string;
  readonly selectedDate?: string;
  readonly coordination?: TabCoordinator;
  readonly storage?: CanonicalStorageAdapter;
}

export interface CanonicalHost {
  readonly ok: boolean;
  readonly authority: AuthorityState;
  readonly featurePorts: ShellFeaturePorts;
  readonly storageId: string;
  readonly migration: MigrationResult | null;
  readonly coordination: TabCoordinator;
  readonly openedEpoch: number;
  readonly reason: string;
  refresh(): Promise<void>;
  close(): Promise<void>;
}

export function prepareCanonicalCandidateHost(options?: CanonicalHostOptions): Promise<CanonicalHost>;
