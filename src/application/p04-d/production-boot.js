// P04-D4: atomic production authority cutover.
//
// This module owns the single build-time production authority choice. After
// the D4 reviewed cutover, ordinary production ALWAYS boots the canonical
// finance authority behind the established legacy shell:
//
// - the authority choice below is a hardcoded build-time constant. It is not
//   read from URL, query, hash, cookies, local/session storage, imported
//   data, mutable globals, or runtime environment text, and no caller can
//   change it without editing this reviewed file. There is no
//   user-reachable dual-authority toggle anywhere in the product.
// - first boot extracts the unchanged v1 snapshot read-only
//   (`extractLegacyIndexedDb` never creates, migrates, or writes the v1
//   database: a missing source aborts the open instead of upgrading it)
//   and migrates once through the accepted staging/pointer protocol.
//   Reopening an existing canonical namespace reopens it; it never
//   re-migrates or overwrites it (the host owns that rule).
// - the SAME established composition root (`createLegacyApplication` with
//   the SAME template) stays mounted throughout preparation and failure. A
//   storage, migration, or extraction failure mounts the shell with the
//   host's write-blocked ports: every finance action visibly refuses, and
//   nothing falls back to legacy writes.
// - after the mount, every v1 finance writer on the legacy runtime is
//   replaced with an explicit extraction-only refusal. v1 stays open only
//   for immutable extraction and backup-compatibility reads during
//   migration. No UI action can write it after the cutover.
// - the reviewed local service worker registers only on this canonical
//   production path and coordinates activation with live
//   write/import/reset/migration leases plus one epoch bump (the epoch
//   hard-blocks old tabs/binaries until they reload).
//
// Device identity: the canonical namespace is guest-scoped per device. The
// persisted device id is storage namespacing only; it never selects the
// finance authority.

import { createLegacyApplication } from '../bootstrap.js';
import { prepareCanonicalCandidateHost } from './canonical-host.js';
import { createCandidateIdFactory } from './candidate-shell.js';
import { Core } from '../../shared/core.js';
import { createTabCoordinator } from './tab-coordination.js';
import { registerCandidatePwa } from '../../pwa/registration.js';
import { extractLegacyIndexedDb, snapshotFromStores } from '../../data/migration/extract.ts';
import { decodeLifecycleId } from '../../data/migration/lifecycle-id.ts';
import {
  makeDeviceId,
  makeGuestKey,
  repositoryScopeIdFor,
} from '../../domain/sync/scope.ts';

/**
 * @typedef {import('./contracts.ts').AuthorityState} AuthorityState
 * @typedef {import('./contracts.ts').ShellFeaturePorts} ShellFeaturePorts
 * @typedef {import('../commands/index.ts').CommandContext} CommandContext
 * @typedef {import('./tab-coordination.ts').TabCoordinator} TabCoordinator
 */

/** Build-time production finance authority. D4 cutover: canonical only. */
export const P04D_PRODUCTION_AUTHORITY = 'canonical';
export const P04D_PRODUCTION_MIGRATION_ID = 'mg:production-v1';
export const P04D_PRODUCTION_CALCULATION_VERSION = 'rushd-p04d-1';
export const P04D_PRODUCTION_GUEST_KEY = 'rushd-guest';
export const P04D_PRODUCTION_DEVICE_KEY = 'rushd_device_id';
export const P04D_V1_EXTRACTION_ONLY_REASON =
  'P04-D4: MicroSaveOS_DB v1 is extraction-only after the canonical cutover; all finance writes flow through canonical ports.';

/**
 * Canonical storage endpoints for ordinary production. The Vite build
 * emits `dist/sqlite-worker.js` next to `index.html` and the wa-sqlite
 * engine closure under `dist/pkg`; both resolve here at runtime from the
 * page base so no build-time `import.meta` worker URL is needed. Callers
 * that need another endpoint (test harnesses) pass `workerUrl` /
 * `sqliteAssetBase` explicitly into `prepareCanonicalCandidateHost`.
 * @param {typeof globalThis} [environment]
 * @returns {{ workerUrl: string, sqliteAssetBase: string }}
 */
export function resolveProductionStorageEndpoints(environment = globalThis) {
  let workerUrl = '/sqlite-worker.js';
  try {
    const doc = environment?.document;
    if (doc && typeof doc.baseURI === 'string' && doc.baseURI.length > 0) {
      workerUrl = new URL('sqlite-worker.js', doc.baseURI).href;
    }
  } catch {
    /* keep the root-relative default */
  }
  return { workerUrl, sqliteAssetBase: '/pkg' };
}

/**
 * True only for the canonical production authority. The value is a
 * build-time constant: no runtime input can change it.
 * @returns {boolean}
 */
export function isProductionCanonical() {
  return P04D_PRODUCTION_AUTHORITY === 'canonical';
}

/**
 * Stable per-device guest identity for canonical namespace scoping.
 * The id persists in local storage so reloads reopen the SAME namespace;
 * a missing id is generated once from per-device entropy.
 * @param {{ localStorage?: Storage | undefined, crypto?: Crypto | undefined }} environment
 * @returns {{ deviceId: string, scopeId: string }}
 */
export function resolveProductionIdentity(environment) {
  const store = environment?.localStorage;
  let deviceId = null;
  try {
    deviceId = typeof store?.getItem === 'function' ? store.getItem.call(store, P04D_PRODUCTION_DEVICE_KEY) : null;
  } catch {
    deviceId = null;
  }
  const deviceMade = makeDeviceId(deviceId);
  if (deviceMade.ok) {
    const scopeId = repositoryScopeIdFor({
      kind: 'guest',
      guestKey: makeGuestKey(P04D_PRODUCTION_GUEST_KEY).value,
      deviceId: deviceMade.value,
    });
    return { deviceId: deviceMade.value, scopeId };
  }
  let fresh = null;
  try {
    const cryptoRef = environment?.crypto;
    if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
      fresh = `dev-${cryptoRef.randomUUID()}`;
    }
  } catch {
    fresh = null;
  }
  if (!fresh) {
    fresh = `dev-nr-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
  }
  const made = makeDeviceId(fresh);
  if (!made.ok) throw new Error('production device identity could not be established');
  try {
    if (typeof store?.setItem === 'function') store.setItem.call(store, P04D_PRODUCTION_DEVICE_KEY, made.value);
  } catch {
    /* namespacing without persistence still boots; reloads re-migrate into a fresh namespace only when no pointer exists */
  }
  const scopeId = repositoryScopeIdFor({
    kind: 'guest',
    guestKey: makeGuestKey(P04D_PRODUCTION_GUEST_KEY).value,
    deviceId: made.value,
  });
  return { deviceId: made.value, scopeId };
}

/**
 * Device-local civil today (`YYYY-MM-DD`) for the initially selected day.
 * This mirrors the legacy shell's `getTodayISO`: the visible "today"
 * (date strip, humanized labels) is device-local, while instants stay
 * UTC. It selects only the display date, never the finance authority.
 * @returns {string} Empty when the device date is unreadable (the host
 * falls back to its clock-derived default).
 */
export function resolveProductionSelectedDate() {
  try {
    const today = Core?.Date?.getTodayISO?.();
    return typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : '';
  } catch {
    return '';
  }
}

/**
 * Build the production command context: real clock, reload-unique ids,
 * product calculation version, and the stable guest origin.
 * @param {{ deviceId: string, scopeId: string }} identity
 * @returns {CommandContext}
 */
export function createProductionContext(identity) {
  const ids = createCandidateIdFactory();
  const deviceMade = makeDeviceId(identity.deviceId);
  if (!deviceMade.ok) throw new Error('production device identity is invalid');
  return {
    clock: { nowMs: () => Date.now() },
    ids,
    calculationVersion: P04D_PRODUCTION_CALCULATION_VERSION,
    origin: { deviceId: deviceMade.value, scopeId: identity.scopeId },
  };
}

/**
 * v1 finance writers that become extraction-only refusals after the
 * canonical cutover. Reads stay intact for migration input and backup
 * compatibility. Method names mirror the D1 mutation inventory's v1
 * primitives — plus `connect`, so nothing can open the v1 database
 * outside the explicit read-only extraction in this module (which uses
 * its own IndexedDB handle, never the runtime `DB` object).
 */
export const P04D_V1_FROZEN_DB_WRITERS = Object.freeze([
  'connect',
  'setSetting',
  'saveTemplate',
  'deleteTemplate',
  'saveExpense',
  'deleteExpense',
  'setSettingsEntries',
  'applyExpenseWritePlan',
  'restoreBackupRecords',
  'resolveMonthEndSettlement',
  'factoryReset',
]);

export const P04D_V1_FROZEN_STORE_WRITERS = Object.freeze([
  'init',
  'ensureTemplateProfilesState',
  'upsertMonthlyTemplateAssignment',
  'recordCurrentMonthBaseAllowance',
  'persistVaultState',
  'addVaultGoal',
  'deleteVaultGoal',
  'persistMonthEndSettlements',
  'addVaultTransaction',
  'settleMonthEnd',
  'settleMonthEndToVault',
  'settleMonthEndToBudget',
  'settleMonthEndNoSurplus',
  'loadDay',
  'refreshFlexibleStats',
  'refreshStatistics',
  'recalcGlobalStats',
  'addExpense',
  'updateExpense',
  'deleteExpense',
  'seedTemplates',
  'autoFillDay',
  'applyTemplatesFrom',
]);

/**
 * Replace every v1 finance writer on the mounted legacy runtime with an
 * explicit extraction-only refusal. Reads keep working; any UI or test
 * path that still reaches a v1 writer fails loudly instead of forking a
 * second writer.
 * @param {{ DB?: Record<string, unknown>, Store?: Record<string, unknown> }} dataRuntime
 * @returns {{ db: number, store: number }} Count of frozen writers per surface.
 */
export function freezeV1Writers(dataRuntime) {
  const refuse = (surface, method) => {
    throw new Error(`${P04D_V1_EXTRACTION_ONLY_REASON} (blocked ${surface}.${method})`);
  };
  let db = 0;
  const dbSurface = dataRuntime?.DB;
  if (dbSurface && typeof dbSurface === 'object') {
    for (const method of P04D_V1_FROZEN_DB_WRITERS) {
      if (typeof dbSurface[method] === 'function') {
        const name = method;
        dbSurface[name] = () => refuse('DB', name);
        db += 1;
      }
    }
  }
  let store = 0;
  const storeSurface = dataRuntime?.Store;
  if (storeSurface && typeof storeSurface === 'object') {
    for (const method of P04D_V1_FROZEN_STORE_WRITERS) {
      if (typeof storeSurface[method] === 'function') {
        const name = method;
        storeSurface[name] = () => refuse('Store', name);
        store += 1;
      }
    }
  }
  return { db, store };
}

/**
 * Boot ordinary production: read-only v1 extraction, one canonical
 * migration/open, the established shell on canonical ports, PWA
 * registration on the canonical path, and the v1 extraction-only freeze.
 * Every input except the explicit composition arguments is derived inside;
 * nothing selects the finance authority at runtime.
 * @param {{ Vue: unknown, environment?: typeof globalThis, template?: string, workerUrl?: string, sqliteAssetBase?: string }} options
 * @returns {Promise<{ ok: boolean, authority: AuthorityState, featurePorts: ShellFeaturePorts, app: unknown, dataRuntime: unknown, host: unknown, coordination: TabCoordinator, pwa: { ok: boolean, reason: string } | null, frozen: { db: number, store: number }, reason: string }>}
 */
export async function bootProductionApplication(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('bootProductionApplication requires an explicit options object.');
  }
  if (!isProductionCanonical()) {
    throw new Error('P04-D4: production authority is not canonical; refusing to boot a dual-authority product.');
  }
  const { Vue, environment = globalThis, template } = options;
  if (!Vue) throw new TypeError('bootProductionApplication requires the Vue runtime.');
  const coordination = createTabCoordinator({ environment });
  const identity = resolveProductionIdentity(environment);
  const context = createProductionContext({ deviceId: identity.deviceId, scopeId: identity.scopeId });
  // Explicit endpoint overrides are test-harness-only (their bundles live
  // under /harness/ with their own worker copy). Ordinary production
  // always resolves the emitted dist endpoints below.
  const resolved = resolveProductionStorageEndpoints(environment);
  const endpoints = {
    workerUrl: typeof options.workerUrl === 'string' && options.workerUrl ? options.workerUrl : resolved.workerUrl,
    sqliteAssetBase: typeof options.sqliteAssetBase === 'string' && options.sqliteAssetBase ? options.sqliteAssetBase : resolved.sqliteAssetBase,
  };
  const selectedDate = resolveProductionSelectedDate() || undefined;

  // Read-only v1 extraction. A missing source yields an empty snapshot
  // (fresh install); any other extraction failure mounts the shell
  // write-blocked below instead of falling back to legacy writes.
  let snapshot = null;
  let extractionReason = '';
  try {
    const factory = environment?.indexedDB;
    if (!factory) {
      snapshot = snapshotFromStores({ settings: [], templates: [], expenses: [], sourcePresent: false });
    } else {
      const extracted = await extractLegacyIndexedDb(factory);
      if (extracted.ok) {
        snapshot = extracted.snapshot;
      } else {
        extractionReason = extracted.detail ?? extracted.reason;
      }
    }
  } catch (error) {
    extractionReason = error instanceof Error ? error.message : String(error);
  }

  const migrationId = decodeLifecycleId(P04D_PRODUCTION_MIGRATION_ID, 'migrationId');
  if (!migrationId.ok) {
    throw new Error(`production migration id is invalid: ${migrationId.detail}`);
  }

  let host = null;
  if (snapshot) {
    host = await prepareCanonicalCandidateHost({
      environment,
      context,
      snapshot,
      migrationId: migrationId.value,
      workerUrl: endpoints.workerUrl,
      sqliteAssetBase: endpoints.sqliteAssetBase,
      selectedDate,
      coordination,
    });
  } else {
    // Extraction failed: retry the host on a memory control store so the
    // established shell still mounts with write-blocked canonical ports
    // instead of falling back to legacy writes. The durable namespace is
    // scope-bound, so this rejoins the same namespace when storage works.
    const { createMemoryControlStore } = await import('../../data/migration/control-store.ts');
    host = await prepareCanonicalCandidateHost({
      environment,
      context,
      control: createMemoryControlStore(),
      workerUrl: endpoints.workerUrl,
      sqliteAssetBase: endpoints.sqliteAssetBase,
      coordination,
    });
    if (!host || !host.featurePorts) {
      throw new Error(
        `P04-D4: production cannot mount without canonical ports (extraction: ${extractionReason}); refusing a legacy fallback.`,
      );
    }
  }
  if (!host || !host.featurePorts) {
    throw new Error('P04-D4: production cannot mount without canonical ports; refusing a legacy fallback.');
  }

  // The established shell mounts on canonical ports in every outcome. When
  // the host failed, its ports are the write-blocked recovery set, so no
  // finance action can reach v1.
  const { app, dataRuntime, featurePorts, authority } = createLegacyApplication({
    Vue,
    environment,
    template,
    authorityMode: 'canonicalCandidate',
    candidatePorts: host.featurePorts,
  });
  const frozen = freezeV1Writers(dataRuntime);

  let pwa = null;
  try {
    const registered = await registerCandidatePwa({ environment, coordination });
    pwa = { ok: registered.ok, reason: registered.reason };
  } catch (error) {
    pwa = { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }

  return {
    ok: host.ok,
    authority,
    featurePorts,
    app,
    dataRuntime,
    host,
    coordination,
    pwa,
    frozen,
    reason: host.ok ? '' : (host.reason || extractionReason),
  };
}
