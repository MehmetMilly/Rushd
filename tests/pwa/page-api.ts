/**
 * Same-origin page API for P04-D2 browser lifecycle tests.
 *
 * Drives the real candidate stack in Chromium: the canonical host over the
 * OPFS-backed durable v2 repository, P04-C staged migration, the P03
 * command gateway, and cross-tab coordination. All data is synthetic; no
 * account or cloud client is constructed.
 */
/* eslint-env browser */

import { prepareCanonicalCandidateHost } from '../../src/application/p04-d/canonical-host.js';
import { createTabCoordinator } from '../../src/application/p04-d/tab-coordination.js';
import { snapshotFromStores } from '../../src/data/migration/extract';
import { createDeterministicContext } from '../domain/support/deterministic-context';

const WORKER_URL = '/harness/v2-worker.js';
const SQLITE_BASE = '/pkg';

interface CandidateHandle {
  host: Awaited<ReturnType<typeof prepareCanonicalCandidateHost>>;
  coordination: ReturnType<typeof createTabCoordinator>;
  context: ReturnType<typeof createDeterministicContext>['context'];
  deviceId: string;
  inputFingerprint: string | null;
  heldToken: { kind: string; tabId: string } | null;
}

let handle: CandidateHandle | null = null;

function fakeV1Snapshot() {
  return snapshotFromStores({
    settings: [
      { key: 'baseAllowance', value: 1500 },
      { key: 'theme', value: 'dark' },
    ],
    templates: [],
    expenses: [
      {
        id: 'v1-bread',
        name: 'bread',
        expectedCost: 12,
        actualPaid: 12,
        isPaid: true,
        date: '2026-09-05',
        category: 'food',
        classification: 'essential',
      },
      {
        id: 'v1-bus',
        name: 'bus',
        expectedCost: 7,
        actualPaid: 0,
        isPaid: false,
        date: '2026-09-06',
        category: 'transport',
        classification: 'essential',
      },
    ],
    sourcePresent: true,
  });
}

async function openCandidate(options: {
  deviceId: string;
  migrationId?: string;
  withSnapshot?: boolean;
  workerUrl?: string;
  tabId?: string;
}) {
  const { context: deterministic } = createDeterministicContext({ deviceId: options.deviceId });
  // Reload-resilient identities: the deterministic counter restarts on
  // every page load while the operation journal persists, so reusing it
  // would turn the first post-reload write into an operationIdConflict.
  // Clock, calculation version, and origin stay deterministic; only the id
  // factory draws per-load entropy (UUIDs satisfy the printable-ASCII
  // identity bound). This mirrors the production requirement that id
  // factories never repeat across reloads.
  const context = {
    ...deterministic,
    ids: {
      newId: (prefix: string) => `${prefix}-${crypto.randomUUID()}`,
    },
  };
  const coordination = createTabCoordinator({
    tabId: options.tabId ?? `browser-tab-${options.deviceId}`,
  });
  const snapshot = options.withSnapshot === false ? undefined : fakeV1Snapshot();
  const host = await prepareCanonicalCandidateHost({
    context,
    snapshot,
    migrationId: options.migrationId ?? `mg-${options.deviceId}-0001`,
    coordination,
    workerUrl: options.workerUrl ?? WORKER_URL,
    sqliteAssetBase: SQLITE_BASE,
    selectedDate: '2026-09-05',
  });
  handle = {
    host,
    coordination,
    context,
    deviceId: options.deviceId,
    inputFingerprint: snapshot ? JSON.stringify(snapshot) : null,
    heldToken: null,
  };
  return summarize();
}

function requireHandle(): CandidateHandle {
  if (handle === null) throw new Error('candidate is not open');
  return handle;
}

function summarize() {
  const current = requireHandle();
  return {
    ok: current.host.ok,
    reason: current.host.reason,
    // Live port state, not the prepare-time snapshot: epoch breaches and
    // failure transitions happen after open.
    authority: current.host.featurePorts.authority.getState(),
    storageId: current.host.storageId,
    selectedDate: current.host.featurePorts.home.getSelectedDate(),
    dayCount: current.host.featurePorts.home.listSelectedDayExpenses().length,
    inputFingerprint: current.inputFingerprint,
    inputIntact: current.inputFingerprint === null
      ? null
      : current.inputFingerprint === JSON.stringify(fakeV1Snapshot()),
  };
}

export const __p04d2 = {
  openCandidate,
  async reopen() {
    const current = requireHandle();
    const deviceId = current.deviceId;
    await current.host.close();
    return openCandidate({ deviceId, withSnapshot: false, tabId: current.coordination.tabId });
  },
  async submitExpense(input: { name: string; cost: number; category: string; date?: string }) {
    return requireHandle().host.featurePorts.capture.submitExpense(input);
  },
  captureStatus() {
    return requireHandle().host.featurePorts.capture.getStatus();
  },
  async listDay(date: string) {
    return requireHandle().host.featurePorts.history.listDayExpenses(date);
  },
  async refresh() {
    await requireHandle().host.refresh();
    return summarize();
  },
  async close() {
    const current = requireHandle();
    await current.host.close();
    handle = null;
    return { closed: true };
  },
  beginCritical(kind: 'write' | 'import' | 'reset' | 'migration') {
    const current = requireHandle();
    current.heldToken = current.coordination.beginCritical(kind) as { kind: string; tabId: string };
    return { held: kind, canActivateUpdate: current.coordination.canActivateUpdate() };
  },
  endCritical() {
    const current = requireHandle();
    current.coordination.endCritical(current.heldToken);
    current.heldToken = null;
    return { canActivateUpdate: current.coordination.canActivateUpdate() };
  },
  canActivateUpdate() {
    return { canActivateUpdate: requireHandle().coordination.canActivateUpdate() };
  },
  bumpEpoch(reason: string) {
    return { epoch: requireHandle().coordination.bumpEpoch(reason) };
  },
  epoch() {
    return { epoch: requireHandle().coordination.getEpoch() };
  },
  waitForInvalidate(timeoutMs = 10_000) {
    const current = requireHandle();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve({ received: false });
      }, timeoutMs);
      const unsubscribe = current.coordination.onInvalidate((message) => {
        clearTimeout(timer);
        unsubscribe();
        resolve({ received: true, storageId: message.storageId });
      });
    });
  },
  summary() {
    return summarize();
  },
};

(globalThis as Record<string, unknown>).__p04d2 = __p04d2;
