// P04-D2 declaration boundary for cross-tab coordination.
// Runtime lives in `./tab-coordination.js` and has no imports.

export type CriticalSectionKind = 'write' | 'import' | 'reset' | 'migration';

export const CRITICAL_SECTIONS: readonly CriticalSectionKind[];
export const COORDINATION_CHANNEL: string;
export const COORDINATION_EPOCH_KEY: string;
export const COORDINATION_LOCKS_KEY: string;
export const COORDINATION_LOCK_TTL_MS: number;
export const COORDINATION_HEARTBEAT_MS: number;

export interface CriticalSectionToken {
  readonly kind: CriticalSectionKind;
  readonly tabId: string;
  readonly atMs: number;
}

export interface CommitAnnouncement {
  readonly tabId: string;
  readonly storageId: string | null;
  readonly operationId: string | null;
  readonly atMs: number;
}

export interface EpochAnnouncement {
  readonly epoch: number;
  readonly reason: string;
  readonly tabId: string;
}

export interface CoordinationStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CoordinationBus {
  postMessage(message: unknown): void;
  onmessage: ((message: unknown) => void) | null;
  close?: () => void;
}

export interface TabCoordinator {
  readonly tabId: string;
  getEpoch(): number;
  bumpEpoch(reason?: string): number;
  assertEpoch(openedEpoch: number): void;
  beginCritical(kind: CriticalSectionKind): CriticalSectionToken;
  endCritical(token: Pick<CriticalSectionToken, 'kind' | 'tabId'> | null | undefined): void;
  refreshCritical(token: Pick<CriticalSectionToken, 'kind' | 'tabId'> | null | undefined): CriticalSectionToken;
  activeCriticalSections(): CriticalSectionToken[];
  canActivateUpdate(): boolean;
  announceCommit(info?: { readonly storageId?: string; readonly operationId?: string }): void;
  onInvalidate(handler: (message: CommitAnnouncement) => void): () => void;
  onEpoch(handler: (message: EpochAnnouncement) => void): () => void;
  close(): void;
}

export function createTabCoordinator(options?: {
  readonly tabId?: string;
  readonly environment?: typeof globalThis;
  readonly store?: CoordinationStore | null;
  readonly bus?: CoordinationBus | null;
  readonly now?: () => number;
}): TabCoordinator;
