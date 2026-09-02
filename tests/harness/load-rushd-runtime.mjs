// Loads Rushd's real production script blocks from index.html into a Node VM
// context backed by the in-memory IndexedDB/localStorage shims. This lets the
// safety tests execute the actual storage, Store, reconciliation, settlement,
// import-validation, and reset code paths — not copies of their formulas.
//
// The Vue stub keeps component templates inert while recording mixins so tests
// can invoke real controller methods (resetApp, exportData, ...) with a
// controlled `this`.

import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createIdbShim, LocalStorageShim } from './idb-shim.mjs';

export async function loadRushdRuntime(options = {}) {
    const html = await readFile('index.html', 'utf8');
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    if (blocks.length < 7) {
        throw new Error(`Expected at least 7 inline script blocks in index.html, found ${blocks.length}`);
    }
    // Block 0 is the tailwind config, block 1 the boot-theme IIFE; both are
    // presentation-only. Blocks 2..6 are Core, i18n, helpers+DB+Store, app
    // shell, and the main controller.
    const source = blocks.slice(2).join('\n;\n');

    const shim = createIdbShim();
    const localStorageShim = new LocalStorageShim(options.localStorage || {});

    const captured = {
        mixins: [],
        components: [],
        appOptions: null,
        downloads: [],
        alerts: [],
        reloads: 0,
        lateDialogs: []
    };

    const Vue = {
        createApp(options) {
            captured.appOptions = options;
            const app = {
                component(name, definition) {
                    captured.components.push({ name, definition });
                    return app;
                },
                mixin(options) {
                    captured.mixins.push(options);
                    return app;
                },
                directive() {
                    return app;
                },
                use() {
                    return app;
                },
                mount() {
                    return {};
                }
            };
            return app;
        },
        reactive: (target) => target,
        computed: (getter) => ({ get value() { return getter(); } }),
        watchEffect: (fn) => {
            fn();
            return () => {};
        }
    };

    const anchorClicks = [];
    const documentShim = {
        createElement: (tagName) => ({
            tagName,
            href: '',
            download: '',
            click() {
                anchorClicks.push({ href: this.href, download: this.download });
                captured.downloads.push(this.download);
            },
            setAttribute() {},
            appendChild() {},
            removeChild() {},
            addEventListener() {},
            classList: { add() {}, remove() {}, toggle() {} },
            style: { setProperty() {} }
        }),
        createElementNS() {
            return this.createElement('svg');
        },
        createTextNode: () => ({ }),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        body: { appendChild() {}, removeChild() {} },
        documentElement: {
            style: { setProperty() {} },
            setAttribute() {},
            dir: 'rtl',
            lang: 'ar'
        },
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
        setTimeout,
        clearTimeout,
        setInterval: () => 0,
        clearInterval() {},
        requestAnimationFrame: (fn) => setTimeout(fn, 0),
        localStorage: localStorageShim,
        indexedDB: shim.idb,
        navigator: { userAgent: 'rushd-test-harness', language: 'ar' },
        performance: { now: () => Date.now() },
        alert: (message) => { captured.alerts.push(message); },
        location: {
            reload: () => { captured.reloads += 1; },
            href: 'http://localhost/'
        },
        document: documentShim,
        Vue,
        Blob: BlobShim,
        DOMException: class extends Error {
            constructor(message, name) {
                super(message);
                this.name = name;
            }
        },
        IDBKeyRange: {
            only: (value) => ({ type: 'only', value })
        },
        URL: {
            createObjectURL: (blob) => `blob:rushd-test-${captured.downloads.length}`,
            revokeObjectURL() {}
        },
        FileReader: class {
            readAsText() {}
        },
        Math,
        Date,
        JSON,
        Intl
    };
    context.window = context;
    context.globalThis = context;
    context.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'rushd-inline-scripts.js' });

    return {
        context,
        shim,
        localStorage: localStorageShim,
        captured,
        Store: context.MicroSaveStore,
        DB: context.MicroSaveDB,
        appOptions: captured.appOptions,
        validateBackupPayload: context.RushdImportValidation?.validateBackupPayload,
        RushdMoneyInput: context.RushdMoneyInput,
        TRANSLATIONS: context.TRANSLATIONS,
        anchorClicks
    };
}
