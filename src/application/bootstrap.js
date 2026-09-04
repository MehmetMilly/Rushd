import { createLegacyDataRuntime } from '../data/legacy-v1/runtime.js';
import { registerLegacyComponents } from '../components/register-legacy-components.js';
import { installRootController } from '../app/root-controller.js';

export function createLegacyApplication({ Vue, environment = globalThis, template } = {}) {
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
