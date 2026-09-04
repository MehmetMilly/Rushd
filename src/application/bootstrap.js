import { createLegacyDataRuntime } from '../data/legacy-v1/runtime.js';
import { registerLegacyComponents } from '../components/register-legacy-components.js';
import { installRootController } from '../app/root-controller.js';

/**
 * @typedef {import('vue').App} VueApplication
 * @typedef {typeof import('vue')} VueRuntime
 * @typedef {import('../data/legacy-v1/runtime.js').LegacyDataRuntime} LegacyDataRuntime
 */

/**
 * @param {{ Vue?: VueRuntime, environment?: typeof globalThis, template?: string }} [options]
 * @returns {{ app: VueApplication, dataRuntime: LegacyDataRuntime }}
 */
export function createLegacyApplication({ Vue, environment = globalThis, template } = {}) {
    if (!Vue) throw new TypeError('createLegacyApplication requires the Vue runtime.');
    /** @type {LegacyDataRuntime} */
    const dataRuntime = createLegacyDataRuntime({ environment, Vue });
    const app = Vue.createApp({
        ...(template ? { template } : {}),
        setup() {
            return { isRoot: true, store: dataRuntime.Store, core: dataRuntime.Core };
        }
    });
    registerLegacyComponents(app, environment);
    installRootController(app, dataRuntime, environment);
    return { app, dataRuntime };
}
