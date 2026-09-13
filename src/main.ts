import * as Vue from 'vue';
import rootTemplate from './app/root-template.html?raw';
import { TRANSLATIONS } from './app/i18n/translations.js';
import { assertTranslationCatalog } from './app/i18n/contracts';
import { bootProductionApplication } from './application/p04-d/production-boot.js';
import { installLegacyDebugBridge } from './application/debug-test-bridge.js';
import './styles/legacy-foundation.css';
import './styles/tailwind.css';
import './styles/legacy-components.css';

assertTranslationCatalog(TRANSLATIONS);

// P04-D4 production cutover: ordinary production always boots the canonical
// finance authority behind the established shell. The authority choice is a
// single build-time constant inside production-boot.js — no URL, storage,
// or runtime toggle can change it. The shell stays mounted through
// preparation and failure; v1 is extraction-only after the mount.
void (async () => {
    const { app, dataRuntime, host } = await bootProductionApplication({
        Vue,
        environment: globalThis,
        template: rootTemplate
    });

    const mountedProxy = app.mount('#app');

    // This is a deliberately narrow P02 compatibility/debug seam. It lets the
    // existing test harness exercise the same DB, Store, and mounted proxy as the
    // legacy build without depending on Vue's private production internals.
    installLegacyDebugBridge(globalThis, dataRuntime, mountedProxy);

    // D5 round-3: live same-namespace commit → read-only Home re-mirror, so
    // every same-origin tab's cards track the canonical count without a
    // reload (the A55 A9 divergence). The host notifies only for the
    // namespace it holds — foreign flips already retired this tab and never
    // notify, so no orphaned fork can reach the UI. The resync assigns
    // in-memory view rows from the refreshed read model; it performs no
    // finance write and changes no authority. Best-effort: reload still
    // converges through the boot mirror when this subscription is absent.
    try {
        const proxyRecord = mountedProxy as unknown as Record<string, unknown>;
        const hostRecord = host as unknown as Record<string, unknown> | null | undefined;
        const subscribe = hostRecord?.onCommitted;
        const resync = proxyRecord?.resyncP04DCandidateHome;
        if (typeof subscribe === 'function' && typeof resync === 'function') {
            (subscribe as (handler: () => void) => unknown).call(hostRecord, () => {
                void Promise.resolve()
                    .then(() => (resync as () => Promise<void>).call(proxyRecord))
                    .catch(() => undefined);
            });
        }
    } catch {
        /* live re-mirror is best-effort chrome; the boot mirror still converges on reload */
    }

    console.log('Rushd fully loaded.');
})().catch((error) => {
    console.error('Rushd production boot failed:', error);
});
