import { createLegacyDataRuntime } from '../data/legacy-v1/runtime.js';
import { registerLegacyComponents } from '../components/register-legacy-components.js';
import { installRootController } from '../app/root-controller.js';
import { createLegacyFeaturePorts, bindAuthorityState } from './p04-d/legacy-ports.js';
import { normalizeP04DBuildMode, resolveP04DAuthority } from './p04-d/authority-latch.js';

/**
 * @typedef {import('vue').App} VueApplication
 * @typedef {typeof import('vue')} VueRuntime
 * @typedef {import('../data/legacy-v1/runtime.js').LegacyDataRuntime} LegacyDataRuntime
 * @typedef {import('./p04-d/contracts.js').ShellFeaturePorts} ShellFeaturePorts
 * @typedef {import('./p04-d/contracts.js').AuthorityState} AuthorityState
 * @typedef {import('./p04-d/contracts.js').P04DBuildMode} P04DBuildMode
 */

/**
 * P04-D1 compatibility seam: the application may receive an explicit port
 * set (test/build injection). The default remains the current legacy
 * behavior for all existing callers and tests.
 * @param {{ Vue?: VueRuntime, environment?: typeof globalThis, template?: string, featurePorts?: ShellFeaturePorts, authorityMode?: P04DBuildMode, candidatePorts?: ShellFeaturePorts | null }} [options]
 * @returns {{ app: VueApplication, dataRuntime: LegacyDataRuntime, featurePorts: ShellFeaturePorts, authority: AuthorityState }}
 */
export function createLegacyApplication({ Vue, environment = globalThis, template, featurePorts = undefined, authorityMode = undefined, candidatePorts = undefined } = {}) {
    if (!Vue) throw new TypeError('createLegacyApplication requires the Vue runtime.');
    /** @type {LegacyDataRuntime} */
    const dataRuntime = createLegacyDataRuntime({ environment, Vue });
    /** @type {ShellFeaturePorts} */
    const legacyPorts = createLegacyFeaturePorts(dataRuntime, environment);
    const resolution = resolveP04DAuthority({ mode: authorityMode, candidatePorts }, legacyPorts);
    bindAuthorityState(legacyPorts, resolution.authority);
    /** @type {ShellFeaturePorts} */
    const activePorts = featurePorts ?? resolution.featurePorts;
    if (featurePorts !== undefined && featurePorts !== null && activePorts !== legacyPorts) {
        // D2 residual fix: an explicitly injected port set cannot escape the
        // latch. Candidate-mode callers must pass canonical ports through
        // `candidatePorts` (D2 host); combining `featurePorts` with a
        // candidate request is rejected instead of silently serving an
        // unbound writable set.
        if (normalizeP04DBuildMode(authorityMode) !== 'legacy') {
            throw new TypeError('createLegacyApplication: featurePorts cannot be combined with a candidate authority request; pass candidate ports via candidatePorts.');
        }
        bindAuthorityState(activePorts, resolution.authority);
    }
    const app = Vue.createApp({
        ...(template ? { template } : {}),
        setup() {
            return { isRoot: true, store: dataRuntime.Store, core: dataRuntime.Core };
        }
    });
    registerLegacyComponents(app, environment);
    installRootController(app, dataRuntime, environment, { featurePorts: activePorts });
    return { app, dataRuntime, featurePorts: activePorts, authority: resolution.authority };
}
