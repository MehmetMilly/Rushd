// P04-D4 declaration boundary for the production authority cutover.
// Runtime lives in `./production-boot.js`.
import type { AuthorityState, ShellFeaturePorts } from './contracts.ts';
import type { CommandContext } from '../commands/index.ts';
import type { TabCoordinator } from './tab-coordination.ts';
import type { LegacyDataRuntime } from '../../data/legacy-v1/runtime.js';

interface MountableApp {
  mount(selector: string): unknown;
}

export const P04D_PRODUCTION_AUTHORITY: string;
export const P04D_PRODUCTION_MIGRATION_ID: string;
export const P04D_PRODUCTION_CALCULATION_VERSION: string;
export const P04D_PRODUCTION_GUEST_KEY: string;
export const P04D_PRODUCTION_DEVICE_KEY: string;
export const P04D_V1_EXTRACTION_ONLY_REASON: string;

export function isProductionCanonical(): boolean;
export function resolveProductionSelectedDate(): string;
export function resolveProductionStorageEndpoints(environment?: typeof globalThis): {
  workerUrl: string;
  sqliteAssetBase: string;
};
export function resolveProductionIdentity(environment: {
  localStorage?: Storage | undefined;
  crypto?: Crypto | undefined;
}): { deviceId: string; scopeId: string };
export function createProductionContext(identity: { deviceId: string; scopeId: string }): CommandContext;

export const P04D_V1_FROZEN_DB_WRITERS: readonly string[];
export const P04D_V1_FROZEN_STORE_WRITERS: readonly string[];
export function freezeV1Writers(dataRuntime: {
  DB?: Record<string, unknown>;
  Store?: Record<string, unknown>;
}): { db: number; store: number };

export function bootProductionApplication(options: {
  Vue: unknown;
  environment?: typeof globalThis;
  template?: string;
  workerUrl?: string;
  sqliteAssetBase?: string;
}): Promise<{
  ok: boolean;
  authority: AuthorityState;
  featurePorts: ShellFeaturePorts;
  app: MountableApp;
  dataRuntime: LegacyDataRuntime;
  host: unknown;
  coordination: TabCoordinator;
  pwa: { ok: boolean; reason: string } | null;
  frozen: { db: number; store: number };
  reason: string;
}>;
