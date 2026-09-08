/**
 * Main-thread RPC client for the dedicated OPFS/SQLite worker.
 *
 * Commits take a finite exclusive Web Lock plus an in-process queue so
 * writers serialize without an infinite block. I/O, VFS, and worker
 * failures never fall back to memory.
 */
/* eslint-env browser */

import {
  GuardConflictError,
  SchemaRejectedError,
  StorageFailureError,
  StorageUnsupportedError,
} from './errors';
import { writeLockNameFor } from './namespace';
import {
  WRITE_LOCK_TIMEOUT_MS,
  WORKER_RPC_TIMEOUT_MS,
  type CommitDeltaPayload,
  type HydratedPayload,
  type OpenParams,
  type OpenResult,
  type WorkerOp,
  type WorkerResponse,
} from './protocol';

export interface SqliteWorkerClientOptions {
  readonly workerUrl: string;
  readonly namespace: string;
}

export class SqliteWorkerClient {
  readonly namespace: string;
  private readonly workerUrl: string;
  private worker: Worker | null = null;
  private seq = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private commitChain: Promise<unknown> = Promise.resolve();
  private parkWaiter: ((value: true) => void) | null = null;
  private parkedAck = false;

  constructor(options: SqliteWorkerClientOptions) {
    this.workerUrl = options.workerUrl;
    this.namespace = options.namespace;
  }

  spawn(): void {
    if (this.worker !== null) return;
    if (typeof Worker === 'undefined') {
      throw new StorageUnsupportedError({
        reason: 'worker-unavailable',
        message: 'dedicated Worker is required for the synchronous OPFS SQLite VFS',
      });
    }
    const worker = new Worker(this.workerUrl, { type: 'module', name: this.namespace });
    worker.onmessage = (event: MessageEvent<WorkerResponse | { parked: true }>) => {
      const data = event.data;
      if (data && 'parked' in data && data.parked === true) {
        this.parkedAck = true;
        this.parkWaiter?.(true);
        this.parkWaiter = null;
        return;
      }
      const response = data as WorkerResponse;
      const waiter = this.pending.get(response.id);
      if (waiter === undefined) return;
      this.pending.delete(response.id);
      clearTimeout(waiter.timer);
      if (response.ok) waiter.resolve(response.result);
      else waiter.reject(decodeWorkerError(response));
    };
    worker.onerror = (event) => {
      const error = new StorageFailureError({
        reason: 'worker',
        message: `sqlite worker error: ${event.message}`,
      });
      for (const [id, waiter] of this.pending) {
        this.pending.delete(id);
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    };
    this.worker = worker;
  }

  async open(params: OpenParams): Promise<OpenResult> {
    this.spawn();
    return (await this.call('open', params, WORKER_RPC_TIMEOUT_MS)) as OpenResult;
  }

  async hydrate(): Promise<HydratedPayload> {
    return withLock(this.namespace, 'shared', async () => {
      return (await this.call('hydrate', undefined, WORKER_RPC_TIMEOUT_MS)) as HydratedPayload;
    });
  }

  async commit(delta: CommitDeltaPayload): Promise<void> {
    const run = async (): Promise<void> => {
      await withLock(this.namespace, 'exclusive', async () => {
        await this.call('commit', delta, WORKER_RPC_TIMEOUT_MS);
      });
    };
    const next = this.commitChain.then(run, run);
    this.commitChain = next.then(
      () => undefined,
      () => undefined,
    );
    await next;
  }

  async close(): Promise<void> {
    if (this.worker === null) return;
    try {
      await this.call('close', undefined, 5_000);
    } catch {
      /* terminate regardless */
    }
    this.terminate();
  }

  async integrity(): Promise<string> {
    const result = (await this.call('integrity', undefined, WORKER_RPC_TIMEOUT_MS)) as { integrity: string };
    return result.integrity;
  }

  async armParkAfterBegin(): Promise<void> {
    this.parkedAck = false;
    await this.call('armParkAfterBegin', undefined, 5_000);
  }

  async armParkDuringHydrate(): Promise<void> {
    this.parkedAck = false;
    await this.call('armParkDuringHydrate', undefined, 5_000);
  }

  async resumeParked(): Promise<void> {
    await this.call('resumeParked', undefined, 5_000);
  }

  async armHangAfterCommit(): Promise<void> {
    await this.call('armHangAfterCommit', undefined, 5_000);
  }

  async armInjectedCommitFailure(): Promise<void> {
    await this.call('armInjectedCommitFailure', undefined, 5_000);
  }

  async simulateUnsupported(): Promise<void> {
    await this.call('simulateUnsupported', undefined, 5_000);
  }

  async forceSchemaVersion(version: string): Promise<void> {
    await this.call('forceSchemaVersion', { version }, 5_000);
  }

  waitPark(timeoutMs = WORKER_RPC_TIMEOUT_MS): Promise<true> {
    if (this.parkedAck) {
      this.parkedAck = false;
      return Promise.resolve(true);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.parkWaiter = null;
        reject(new StorageFailureError({ reason: 'worker', message: `park ack timeout after ${timeoutMs}ms` }));
      }, timeoutMs);
      this.parkWaiter = () => {
        this.parkedAck = false;
        clearTimeout(timer);
        resolve(true);
      };
      if (this.parkedAck) {
        this.parkWaiter(true);
        this.parkWaiter = null;
      }
    });
  }

  terminate(): void {
    if (this.worker !== null) {
      this.worker.terminate();
      this.worker = null;
    }
    const error = new StorageFailureError({ reason: 'worker', message: 'sqlite worker terminated' });
    for (const [id, waiter] of this.pending) {
      this.pending.delete(id);
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  private call(op: WorkerOp, params: unknown, timeoutMs: number): Promise<unknown> {
    const worker = this.worker;
    if (worker === null) {
      return Promise.reject(new StorageFailureError({ reason: 'closed', message: 'sqlite worker is not running' }));
    }
    return new Promise((resolve, reject) => {
      const id = this.seq;
      this.seq += 1;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new StorageFailureError({ reason: 'worker', message: `op timeout: ${op} after ${timeoutMs}ms` }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, op, params });
    });
  }
}

function decodeWorkerError(response: Extract<WorkerResponse, { ok: false }>): Error {
  if (response.reason === 'guard') return new GuardConflictError({ message: response.error });
  if (response.reason === 'busy') {
    return new StorageFailureError({ reason: 'busy', message: response.error });
  }
  if (response.reason === 'schema') {
    return new SchemaRejectedError({ foundVersion: response.foundVersion ?? 'unknown', message: response.error });
  }
  if (response.reason === 'unsupported') {
    return new StorageUnsupportedError({ reason: 'opfs-unavailable', message: response.error });
  }
  if (response.reason === 'scopeMismatch') {
    return new StorageFailureError({ reason: 'scopeMismatch', message: response.error });
  }
  if (response.reason === 'injected') {
    return new Error(response.error);
  }
  return new StorageFailureError({ reason: 'io', message: response.error });
}

async function withLock<T>(namespace: string, mode: 'shared' | 'exclusive', work: () => Promise<T>): Promise<T> {
  const locks = navigator.locks;
  if (locks === undefined || typeof locks.request !== 'function') {
    return work();
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WRITE_LOCK_TIMEOUT_MS);
  try {
    return await locks.request(writeLockNameFor(namespace), { mode, signal: controller.signal }, async () => work());
  } catch (error) {
    if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw new StorageFailureError({ reason: 'busy', message: `write lock busy after ${WRITE_LOCK_TIMEOUT_MS}ms` });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
