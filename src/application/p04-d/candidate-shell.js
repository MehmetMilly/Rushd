// P04-D3: explicit candidate-shell adapter.
//
// The established Home, Add, and Transactions experiences run through
// canonical D2 feature ports while the preserved shell stays mounted.
// This module is the ONLY candidate composition path besides direct host
// calls in tests: it prepares the canonical candidate host, then mounts
// the same `createLegacyApplication` with the same established template,
// passing the host-bound port set through the explicit build/test
// injection (`authorityMode: 'canonicalCandidate'` plus `candidatePorts`).
// Ordinary `src/main.ts` boots through `production-boot.js` instead, which
// always mounts the established shell on host-bound canonical ports
// (the D4 cutover); this adapter remains the harness composition path.
//
// Write rules in candidate mode:
// - candidate preparation blocks every financial action until active
//   storage opens or migration activates (host `canonicalPreparing`);
// - a storage/migration/update failure keeps the shell mounted with a
//   truthful write-blocked (`unavailable`) recovery state;
// - operation identities are reload-unique per intent and retry-stable
//   (see `createCandidateIdFactory`); a retry after a lost acknowledgement
//   reuses the same operation ID and replays idempotently, while a new
//   intent or reload must never collide with persisted journal history.

import { createLegacyApplication } from '../bootstrap.js';
import { prepareCanonicalCandidateHost } from './canonical-host.js';
import { createTabCoordinator } from './tab-coordination.js';
import { registerCandidatePwa } from '../../pwa/registration.js';

/**
 * @typedef {import('./contracts.ts').ShellFeaturePorts} ShellFeaturePorts
 * @typedef {import('./contracts.ts').AuthorityState} AuthorityState
 * @typedef {import('../commands/index.ts').CommandContext} CommandContext
 * @typedef {import('../commands/index.ts').DomainIdFactory} DomainIdFactory
 * @typedef {import('../../data/migration/extract.ts').ExtractedLegacySnapshot} ExtractedLegacySnapshot
 * @typedef {import('./canonical-host.ts').CanonicalHost} CanonicalHost
 * @typedef {import('./tab-coordination.ts').TabCoordinator} TabCoordinator
 * @typedef {import('../bootstrap.js').LegacyVueRuntime} LegacyVueRuntime
 */

/**
 * Create a reload-unique, retry-stable ID factory for candidate contexts.
 * Every minted ID carries per-process entropy, so IDs never repeat across
 * reloads (which would turn the first post-reload write into an
 * `operationIdConflict`), while a caller-kept ID stays stable for retries
 * of the same intent. Test harnesses needing determinism inject their own
 * factory instead.
 * @returns {DomainIdFactory}
 */
export function createCandidateIdFactory() {
  let counter = 0;
  return {
    newId(prefix) {
      const cryptoRef = globalThis?.crypto;
      if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
        try {
          return `${prefix}-${cryptoRef.randomUUID()}`;
        } catch {
          /* fall through to the entropy fallback */
        }
      }
      counter += 1;
      const random = Math.floor(Math.random() * 0xffffff).toString(36);
      return `${prefix}-nr-${Date.now().toString(36)}-${counter.toString(36)}-${random}`;
    },
  };
}

/**
 * Prepare the candidate shell: canonical host plus the mounted
 * established application reading and writing through its ports.
 * Every input is explicit build/test injection; nothing is read from
 * URL, query, hash, cookies, local/session storage, imported data, or
 * mutable globals to decide the mode.
 * @param {{
 *   Vue: LegacyVueRuntime,
 *   environment?: typeof globalThis,
 *   template?: string,
 *   context: CommandContext,
 *   snapshot?: ExtractedLegacySnapshot,
 *   migrationId?: string,
 *   control?: import('../../data/migration/control-store.ts').ControlStore,
 *   workerUrl?: string,
 *   sqliteAssetBase?: string,
 *   selectedDate?: string,
 *   coordination?: TabCoordinator,
 *   storage?: import('./canonical-host.ts').CanonicalStorageAdapter,
 *   registerPwa?: boolean,
 * }} options
 * @returns {Promise<{ app: unknown, dataRuntime: unknown, featurePorts: ShellFeaturePorts, authority: AuthorityState, host: CanonicalHost, coordination: TabCoordinator, pwa: { ok: boolean, reason: string } | null }>}
 */
export async function prepareCandidateShell(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('prepareCandidateShell requires an explicit options object.');
  }
  const { Vue, environment = globalThis, template, registerPwa = false } = options;
  if (!Vue) throw new TypeError('prepareCandidateShell requires the Vue runtime.');
  const coordination = options.coordination ?? createTabCoordinator({ environment });
  const host = await prepareCanonicalCandidateHost({
    environment,
    context: options.context,
    snapshot: options.snapshot,
    migrationId: options.migrationId,
    control: options.control,
    workerUrl: options.workerUrl,
    sqliteAssetBase: options.sqliteAssetBase,
    selectedDate: options.selectedDate,
    coordination,
    storage: options.storage,
  });
  const { app, dataRuntime, featurePorts, authority } = createLegacyApplication({
    Vue,
    environment,
    template,
    authorityMode: 'canonicalCandidate',
    candidatePorts: host.featurePorts,
  });
  let pwa = null;
  if (registerPwa) {
    const registered = await registerCandidatePwa({ environment, coordination });
    pwa = { ok: registered.ok, reason: registered.reason };
  }
  return { app, dataRuntime, featurePorts, authority, host, coordination, pwa };
}
