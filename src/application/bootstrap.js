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
 * Required surface of an explicitly injected port set. D3 rejects unknown
 * or unbound sets even in legacy mode: an override must implement every
 * port with its contract methods instead of arriving as a partial or
 * forged object that could silently drop a finance write.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const KNOWN_PORT_SURFACE = Object.freeze({
    authority: Object.freeze(['getState', 'assertWritable', 'describe', 'getStatus']),
    home: Object.freeze(['getSelectedDate', 'getSafeToSpend', 'getDailyPaidTotal', 'getDailyExpectedTotal', 'listSelectedDayExpenses', 'selectDate', 'refresh', 'getStatus']),
    capture: Object.freeze(['submitExpense', 'payExpense', 'markUnpaid', 'autoFillDay', 'getStatus']),
    history: Object.freeze(['listDayExpenses', 'updateExpense', 'deleteExpense', 'deleteSelected', 'markSelectedUnpaid', 'getStatus']),
    plan: Object.freeze(['listProfiles', 'getActiveProfileId', 'setActiveProfile', 'createProfile', 'previewApply', 'confirmApply', 'getStatus']),
    insights: Object.freeze(['getMonthStatistics', 'getCategoryBreakdown', 'getWeeklySpending', 'refresh', 'getStatus']),
    goals: Object.freeze(['getVaultBalance', 'listGoals', 'addGoal', 'deleteGoal', 'getStatus']),
    portability: Object.freeze(['buildSnapshot', 'restoreSnapshot', 'factoryReset', 'clearLocalPreferences', 'getStatus']),
    navigation: Object.freeze(['resolveIntent', 'listDestinations', 'getStatus']),
    lifecycle: Object.freeze(['initialize', 'getSettings', 'getStatus']),
});

/**
 * Throw unless `ports` implements the complete shell port surface. The
 * internally assembled legacy set and host-bound candidate sets satisfy
 * this; arbitrary injected objects do not and are rejected instead of
 * being served as the finance authority.
 * @param {unknown} ports
 * @returns {asserts ports is ShellFeaturePorts}
 */
function assertKnownPortSet(ports) {
    const missing = [];
    if (!ports || typeof ports !== 'object') {
        throw new TypeError('createLegacyApplication: featurePorts must be a complete shell port set, got a non-object.');
    }
    const bag = /** @type {Record<string, unknown>} */ (ports);
    for (const [name, methods] of Object.entries(KNOWN_PORT_SURFACE)) {
        const candidate = bag[name];
        if (!candidate || typeof candidate !== 'object') {
            missing.push(`${name} (missing port)`);
            continue;
        }
        const port = /** @type {Record<string, unknown>} */ (candidate);
        if (port['name'] !== name) {
            missing.push(`${name} (misnamed port '${String(port['name'])}')`);
        }
        for (const method of methods) {
            if (typeof port[method] !== 'function') {
                missing.push(`${name}.${method}`);
            }
        }
    }
    if (missing.length > 0) {
        throw new TypeError(`createLegacyApplication: refusing unknown featurePorts set; missing or invalid: ${missing.join(', ')}.`);
    }
}

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
    if (featurePorts !== undefined && featurePorts !== null) {
        // D3 residual fix: even in legacy mode, an explicitly injected set
        // must implement the complete port surface. Unknown, partial, or
        // forged objects are rejected instead of served as the authority.
        assertKnownPortSet(featurePorts);
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
