/**
 * Durable activation/control plane for staged migration and portability.
 *
 * Lives in `Rushd_P04C_Control`, never in `MicroSaveOS_DB`. The activation
 * pointer write is the commit point after which cancellation cannot undo.
 * Pointer commits use compare-and-swap on `generation` so two concurrent
 * writers cannot both report success.
 */

import type { MigrationReasonCode } from './reasons';

export const CONTROL_DATABASE = 'Rushd_P04C_Control';
export const CONTROL_DATABASE_VERSION = 1;
export const DEFAULT_ACTIVE_STORAGE_ID = 'guest-active';

export type LifecyclePhase =
  | 'idle'
  | 'extracting'
  | 'converting'
  | 'staging'
  | 'validating'
  | 'activating'
  | 'activated'
  | 'failed'
  | 'cancelled';

export interface ActivationPointer {
  readonly activeStorageId: string;
  readonly schemaVersion: 1;
  readonly generation: number;
  readonly migrationId: string | null;
  readonly importId: string | null;
  readonly sourceFingerprint: string | null;
  readonly importDocumentDigest: string | null;
  readonly committedAtMs: number | null;
  readonly activationCommitted: boolean;
}

export interface LifecycleRun {
  readonly id: string;
  readonly kind: 'migration' | 'import' | 'reset';
  readonly phase: LifecyclePhase;
  readonly stagingStorageId: string;
  readonly priorActiveStorageId: string;
  readonly sourceFingerprint: string | null;
  readonly importDocumentDigest: string | null;
  readonly activationCommitted: boolean;
  readonly cancelRequested: boolean;
  readonly lastReason: MigrationReasonCode | null;
  readonly lastDetail: string | null;
  readonly reviewCount: number;
}

export type ActivationCasResult =
  | { readonly ok: true; readonly pointer: ActivationPointer }
  | { readonly ok: false; readonly reason: 'activation-conflict'; readonly current: ActivationPointer };

export interface ControlStore {
  getPointer(): Promise<ActivationPointer>;
  putPointer(pointer: ActivationPointer): Promise<void>;
  compareAndSwapPointer(expectedGeneration: number, pointer: Omit<ActivationPointer, 'generation'>): Promise<ActivationCasResult>;
  getRun(id: string): Promise<LifecycleRun | null>;
  putRun(run: LifecycleRun): Promise<void>;
}

export const EMPTY_POINTER: ActivationPointer = Object.freeze({
  activeStorageId: DEFAULT_ACTIVE_STORAGE_ID,
  schemaVersion: 1,
  generation: 0,
  migrationId: null,
  importId: null,
  sourceFingerprint: null,
  importDocumentDigest: null,
  committedAtMs: null,
  activationCommitted: false,
});

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('control store request failed'));
  });
}

function completeTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('control transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('control transaction aborted'));
  });
}

function normalizePointer(value: ActivationPointer | undefined): ActivationPointer {
  if (value === undefined) return EMPTY_POINTER;
  return {
    activeStorageId: value.activeStorageId,
    schemaVersion: 1,
    generation: typeof value.generation === 'number' && Number.isSafeInteger(value.generation) ? value.generation : 0,
    migrationId: value.migrationId ?? null,
    importId: value.importId ?? null,
    sourceFingerprint: value.sourceFingerprint ?? null,
    importDocumentDigest: value.importDocumentDigest ?? null,
    committedAtMs: value.committedAtMs ?? null,
    activationCommitted: value.activationCommitted === true,
  };
}

export class InjectedControlFailure extends Error {
  readonly code = 'injectedControlFailure' as const;
  constructor(readonly at: 'pointer' | 'run') {
    super(`injected control-store failure at ${at}`);
    this.name = 'InjectedControlFailure';
  }
}

export function createMemoryControlStore(seed?: ActivationPointer): ControlStore {
  let pointer: ActivationPointer = seed ?? EMPTY_POINTER;
  const runs = new Map<string, LifecycleRun>();
  return {
    async getPointer() {
      return pointer;
    },
    async putPointer(next) {
      pointer = normalizePointer({ ...next, generation: next.generation });
    },
    async compareAndSwapPointer(expectedGeneration, next) {
      const currentGen = pointer.generation;
      if (currentGen !== expectedGeneration) {
        return { ok: false, reason: 'activation-conflict', current: pointer };
      }
      pointer = normalizePointer({ ...next, generation: expectedGeneration + 1 });
      return { ok: true, pointer };
    },
    async getRun(id) {
      return runs.get(id) ?? null;
    },
    async putRun(run) {
      runs.set(run.id, run);
    },
  };
}

export function createIndexedDbControlStore(
  factory: IDBFactory = indexedDB,
  options: { readonly failOn?: 'pointer' | 'run' | null } = {},
): ControlStore {
  let failOn = options.failOn ?? null;
  const openDb = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(CONTROL_DATABASE, CONTROL_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('failed to open control database'));
    });

  return {
    async getPointer() {
      const db = await openDb();
      try {
        const tx = db.transaction(['meta'], 'readonly');
        const row = await requestToPromise(tx.objectStore('meta').get('pointer')) as { key: string; value: ActivationPointer } | undefined;
        return normalizePointer(row?.value);
      } finally {
        db.close();
      }
    },
    async putPointer(pointer) {
      if (failOn === 'pointer') {
        failOn = null;
        throw new InjectedControlFailure('pointer');
      }
      const db = await openDb();
      try {
        const tx = db.transaction(['meta'], 'readwrite');
        tx.objectStore('meta').put({ key: 'pointer', value: normalizePointer(pointer) });
        await completeTransaction(tx);
      } finally {
        db.close();
      }
    },
    async compareAndSwapPointer(expectedGeneration, next) {
      if (failOn === 'pointer') {
        failOn = null;
        throw new InjectedControlFailure('pointer');
      }
      const db = await openDb();
      try {
        const tx = db.transaction(['meta'], 'readwrite');
        const store = tx.objectStore('meta');
        const row = await requestToPromise(store.get('pointer')) as { key: string; value: ActivationPointer } | undefined;
        const current = normalizePointer(row?.value);
        if (current.generation !== expectedGeneration) {
          return { ok: false, reason: 'activation-conflict', current };
        }
        const written = normalizePointer({ ...next, generation: expectedGeneration + 1 });
        store.put({ key: 'pointer', value: written });
        await completeTransaction(tx);
        return { ok: true, pointer: written };
      } finally {
        db.close();
      }
    },
    async getRun(id) {
      const db = await openDb();
      try {
        const tx = db.transaction(['meta'], 'readonly');
        const row = await requestToPromise(tx.objectStore('meta').get(`run:${id}`)) as { key: string; value: LifecycleRun } | undefined;
        return row?.value ?? null;
      } finally {
        db.close();
      }
    },
    async putRun(run) {
      if (failOn === 'run') {
        failOn = null;
        throw new InjectedControlFailure('run');
      }
      const db = await openDb();
      try {
        const tx = db.transaction(['meta'], 'readwrite');
        tx.objectStore('meta').put({ key: `run:${run.id}`, value: run });
        await completeTransaction(tx);
      } finally {
        db.close();
      }
    },
  };
}

export const ACTIVATION_COMMIT_POINT =
  'Activation is committed when the control-store activation pointer is durably written with activationCommitted=true. Cancellation after that write cannot undo it.';
