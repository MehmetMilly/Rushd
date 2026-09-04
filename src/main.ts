import * as Vue from 'vue';
import rootTemplate from './app/root-template.html?raw';
import { TRANSLATIONS } from './app/i18n/translations.js';
import { assertTranslationCatalog } from './app/i18n/contracts';
import { createLegacyApplication } from './application/bootstrap.js';
import { installLegacyDebugBridge } from './application/debug-test-bridge.js';
import './styles/legacy-foundation.css';
import './styles/tailwind.css';
import './styles/legacy-components.css';

assertTranslationCatalog(TRANSLATIONS);

const { app, dataRuntime } = createLegacyApplication({
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
