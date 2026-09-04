import type { App, computed, createApp, reactive, watchEffect } from 'vue';

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

export function createLegacyApplication(options: {
  Vue: LegacyVueRuntime;
  environment?: typeof globalThis;
  template?: string;
}): { app: LegacyVueApplication; dataRuntime: LegacyDataRuntime };
