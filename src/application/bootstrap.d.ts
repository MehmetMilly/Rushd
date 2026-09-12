import type { App, computed, createApp, reactive, watchEffect } from 'vue';
import type {
  AuthorityState,
  P04DBuildMode,
  ShellFeaturePorts,
} from './p04-d/contracts.js';

export type LegacyVueApplication = App;

export interface LegacyVueRuntime {
  createApp: typeof createApp;
  reactive: typeof reactive;
  computed: typeof computed;
  watchEffect: typeof watchEffect;
}

export interface LegacyDataRuntime {
  Core: unknown;
  Store: unknown;
  DB: unknown;
  validateBackupPayload: (payload: unknown) => unknown;
  parseMoneyInput: (value: unknown) => unknown;
  [key: string]: unknown;
}

export interface LegacyApplicationOptions {
  Vue: LegacyVueRuntime;
  environment?: typeof globalThis;
  template?: string;
  /**
   * P04-D1 compatibility seam. An explicit test/build port set overrides the
   * default legacy delegates. Ordinary production callers omit it.
   */
  featurePorts?: ShellFeaturePorts;
  /** Build/test authority request. Ordinary production omits it (`legacy`). */
  authorityMode?: P04DBuildMode;
  /** Candidate ports for D2-D4 harnesses. Never populated from runtime inputs. */
  candidatePorts?: ShellFeaturePorts | null;
}

export interface LegacyApplication {
  app: LegacyVueApplication;
  dataRuntime: LegacyDataRuntime;
  featurePorts: ShellFeaturePorts;
  authority: AuthorityState;
}

export function createLegacyApplication(options: {
  Vue: LegacyVueRuntime;
  environment?: typeof globalThis;
  template?: string;
  featurePorts?: ShellFeaturePorts;
  authorityMode?: P04DBuildMode;
  candidatePorts?: ShellFeaturePorts | null;
}): { app: LegacyVueApplication; dataRuntime: LegacyDataRuntime; featurePorts: ShellFeaturePorts; authority: AuthorityState };
