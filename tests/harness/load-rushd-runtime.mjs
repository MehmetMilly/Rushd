// Loads the real P02 production modules with an in-memory browser environment.
// The public return shape remains stable so P01 assertions still exercise the
// actual Store, IndexedDB wrapper, import gate, and controller methods.

import { createLegacyApplication } from '../../src/application/bootstrap.js';
import { installLegacyDebugBridge } from '../../src/application/debug-test-bridge.js';
import { TRANSLATIONS } from '../../src/app/i18n/translations.js';
import { createIdbShim, LocalStorageShim } from './idb-shim.mjs';

export async function loadRushdRuntime(options = {}) {
    const shim = createIdbShim();
    const localStorageShim = new LocalStorageShim(options.localStorage || {});
    const captured = {
        mixins: [], components: [], appOptions: null, downloads: [],
        alerts: [], reloads: 0, lateDialogs: []
    };

    const Vue = {
        createApp(options) {
            captured.appOptions = options;
            const app = {
                component(name, definition) {
                    captured.components.push({ name, definition });
                    return app;
                },
                mixin(mixin) {
                    captured.mixins.push(mixin);
                    return app;
                },
                directive() { return app; },
                use() { return app; },
                mount() { return {}; }
            };
            return app;
        },
        reactive: (target) => target,
        computed: (getter) => ({ get value() { return getter(); } }),
        watchEffect: (effect) => {
            effect();
            return () => {};
        }
    };

    const anchorClicks = [];
    const documentShim = {
        createElement: (tagName) => ({
            tagName, href: '', download: '',
            click() {
                anchorClicks.push({ href: this.href, download: this.download });
                captured.downloads.push(this.download);
            },
            setAttribute() {}, appendChild() {}, removeChild() {}, addEventListener() {},
            classList: { add() {}, remove() {}, toggle() {} }, style: { setProperty() {} }
        }),
        createElementNS() { return this.createElement('svg'); },
        createTextNode: () => ({}), getElementById: () => null, querySelector: () => null,
        querySelectorAll: () => [], addEventListener() {}, body: { appendChild() {}, removeChild() {} },
        documentElement: { style: { setProperty() {} }, setAttribute() {}, dataset: {}, dir: 'rtl', lang: 'ar' },
        head: { appendChild() {} }
    };

    class BlobShim {
        constructor(parts, blobOptions = {}) {
            this.parts = parts;
            this.type = blobOptions.type || '';
            this.text = async () => parts.join('');
        }
    }

    const context = {
        console: options.console ?? { log() {}, warn() {}, error() {}, info() {} },
        setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
        requestAnimationFrame: (fn) => setTimeout(fn, 0), localStorage: localStorageShim,
        indexedDB: shim.idb, navigator: { userAgent: 'rushd-test-harness', language: 'ar' },
        performance: { now: () => Date.now() }, alert: (message) => { captured.alerts.push(message); },
        prompt: () => '', location: { reload: () => { captured.reloads += 1; }, href: 'http://localhost/' },
        document: documentShim, Vue, Blob: BlobShim,
        DOMException: class extends Error { constructor(message, name) { super(message); this.name = name; } },
        IDBKeyRange: { only: (value) => ({ type: 'only', value }) },
        URL: { createObjectURL: () => `blob:rushd-test-${captured.downloads.length}`, revokeObjectURL() {} },
        FileReader: class { readAsText() {} }, Math, Date, JSON, Intl,
        matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} })
    };
    context.window = context;
    context.globalThis = context;

    const { app, dataRuntime } = createLegacyApplication({ Vue, environment: context });
    const bridge = installLegacyDebugBridge(context, dataRuntime);

    return {
        context, shim, localStorage: localStorageShim, captured,
        Store: bridge.MicroSaveStore, DB: bridge.MicroSaveDB, appOptions: captured.appOptions,
        validateBackupPayload: bridge.RushdImportValidation.validateBackupPayload,
        RushdMoneyInput: bridge.RushdMoneyInput, TRANSLATIONS, anchorClicks, app
    };
}
