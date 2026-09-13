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
    const { app, dataRuntime } = await bootProductionApplication({
        Vue,
        environment: globalThis,
        template: rootTemplate
    });

    const mountedProxy = app.mount('#app');

    // This is a deliberately narrow P02 compatibility/debug seam. It lets the
    // existing test harness exercise the same DB, Store, and mounted proxy as the
    // legacy build without depending on Vue's private production internals.
    installLegacyDebugBridge(globalThis, dataRuntime, mountedProxy);

    console.log('Rushd fully loaded.');
})().catch((error) => {
    console.error('Rushd production boot failed:', error);
});
