// P02 declaration boundary for the mechanically moved legacy Store and DB.
// P04 owns typed persistence and any schema migration.
export interface LegacyDataRuntime {
  Core: unknown;
  Store: unknown;
  DB: unknown;
  validateBackupPayload: (payload: unknown) => unknown;
  parseMoneyInput: (value: unknown) => unknown;
  [key: string]: unknown;
}

export function createLegacyDataRuntime(options?: {
  environment?: typeof globalThis;
  Vue?: unknown;
}): LegacyDataRuntime;
