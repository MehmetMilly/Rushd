/**
 * Parser-backed one-time P02 extractor.
 *
 * It reads the pre-split P02 source, uses parse5 source locations to find raw
 * HTML nodes, then writes mechanically moved modules. It deliberately does
 * not use regex to find HTML tags: script comments and template strings in
 * Rushd contain tag-looking text.
 *
 * This stays in the repository as the repeatable extraction record. Run it
 * only against the pinned pre-split file, not the thin final entry.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse } from 'parse5';

const [input] = process.argv.slice(2);
if (!input) {
    throw new Error('Usage: node scripts/extract-p02-legacy.mjs <pre-split-index.html>');
}

const source = await readFile(input, 'utf8');
const document = parse(source, { sourceCodeLocationInfo: true });

/** @type {Array<any>} */
const scripts = [];
/** @type {Array<any>} */
const styles = [];
let appNode = null;

function walk(node) {
    if (node.tagName === 'script' && !node.attrs?.some((attr) => attr.name === 'src')) scripts.push(node);
    if (node.tagName === 'style') styles.push(node);
    if (node.tagName === 'div' && node.attrs?.some((attr) => attr.name === 'id' && attr.value === 'app')) appNode = node;
    for (const child of node.childNodes || []) walk(child);
}
walk(document);

if (scripts.length !== 6 || styles.length !== 2 || !appNode) {
    throw new Error(`Expected 6 inline scripts, 2 styles, and #app; found ${scripts.length}, ${styles.length}, ${Boolean(appNode)}.`);
}

function rawText(node) {
    const location = node.sourceCodeLocation;
    return source.slice(location.startTag.endOffset, location.endTag.startOffset);
}

function statementRange(script, name) {
    const start = script.indexOf(`MicroSaveApp.component('${name}',`);
    if (start < 0) throw new Error(`Cannot find component ${name}.`);
    const open = script.indexOf('{', start);
    let depth = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let index = open; index < script.length; index += 1) {
        const char = script[index];
        const next = script[index + 1];
        if (lineComment) {
            if (char === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (char === '*' && next === '/') {
                blockComment = false;
                index += 1;
            }
            continue;
        }
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }
        if (char === '/' && next === '/') {
            lineComment = true;
            index += 1;
            continue;
        }
        if (char === '/' && next === '*') {
            blockComment = true;
            index += 1;
            continue;
        }
        if (char === '\'' || char === '"' || char === '`') {
            quote = char;
            continue;
        }
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                const end = script.indexOf(';', index);
                if (end < 0) throw new Error(`Cannot terminate component ${name}.`);
                return { start, end: end + 1, object: script.slice(open, index + 1) };
            }
        }
    }
    throw new Error(`Cannot balance component ${name}.`);
}

function topLevelConstNames(script) {
    return [...script.matchAll(/^ {8}const ([A-Za-z_$][\w$]*)\s*=/gm)].map((match) => match[1]);
}

async function write(path, contents) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, 'utf8');
}

const boot = rawText(scripts[0]);
const core = rawText(scripts[1]);
const translations = rawText(scripts[2]);
const data = rawText(scripts[3]);
const componentScript = rawText(scripts[4]);
const controller = rawText(scripts[5]);
const rootTemplate = rawText(appNode);

const componentSpecs = [
    ['ms-icon', 'MsIcon', 'ms-icon.js'],
    ['ms-btn', 'MsButton', 'ms-button.js'],
    ['ms-swipe-item', 'MsSwipeItem', 'ms-swipe-item.js'],
    ['ms-numpad', 'MsNumpad', 'ms-numpad.js'],
    ['ms-stat-ring', 'MsStatRing', 'ms-stat-ring.js'],
    ['ms-modal', 'MsModal', 'ms-modal.js']
];

for (const [name, exportName, file] of componentSpecs) {
    const { object } = statementRange(componentScript, name);
    await write(resolve('src/components', file), `// Mechanically extracted P02 runtime template. SFC conversion is deferred to P05/P06.\nexport function create${exportName}(environment = globalThis) {\n    const { navigator, performance, setTimeout, clearTimeout } = environment;\n    return ${object};\n}\n`);
}

const profileRange = statementRange(controller, 'ms-profile-overlay');
const profileObject = profileRange.object.replace(/MicroSaveStore/g, 'Store');
await write(resolve('src/components/ms-profile-overlay.js'), `// Mechanically extracted P02 runtime template. SFC conversion is deferred to P05/P06.\nimport { TRANSLATIONS } from '../app/i18n/translations.js';\n\nexport function createMsProfileOverlay(dataRuntime) {\n    const { Store, toFiniteNumber } = dataRuntime;\n    return ${profileObject};\n}\n`);

const names = topLevelConstNames(data);
const dataWithoutBridge = data.replace(/\n\s*\/\/ Expose Store for debugging[\s\S]*?window\.RushdMoneyInput = \{ parseMoneyInput \};\n/, '\n');
await write(resolve('src/data/legacy-v1/runtime.js'), `// P02 compatibility boundary. P04 owns migration from MicroSaveOS_DB v1.\nimport { Core } from '../../shared/core.js';\n\nexport function createLegacyDataRuntime({ environment = globalThis, Vue = environment.Vue } = {}) {\n    const { localStorage, indexedDB, DOMException, IDBKeyRange } = environment;\n${dataWithoutBridge}\n    return { Core, ${names.join(', ')} };\n}\n`);

const modularCore = core
    .replace('const Core =', 'export const Core =')
    .replace(/\n\s*\/\/ EXPOSE CORE TO WINDOW FOR DEBUGGING[\s\S]*?window\.MicroSaveCore = Core;[^\n]*/, '');
await write(resolve('src/shared/core.js'), `${modularCore.trim()}\n`);

let correctedTranslations = translations
    .replace('const TRANSLATIONS =', 'export const TRANSLATIONS =')
    .replace("                historicalBudgetUnknownShort: 'Not recorded',\n                historicalBudgetUnknownHint: 'Tap to see why',\n                historicalBudgetUnknownShort: 'Not recorded',", "                historicalBudgetUnknownShort: 'Not recorded',\n                historicalBudgetUnknownHint: 'Tap to see why',")
    .replace("                flexibleItemRequired: 'اختر عنصراً مرناً أولاً.',", "                flexibleItemRequired: 'اختر عنصراً مرناً أولاً.',")
    .replace("                exportFailed: 'Export failed. Check console for details.',", "                flexibleConsumption: 'Flexible spending',\n                flexibleItemRequired: 'Choose a flexible item first.',\n                exportFailed: 'Export failed. Check console for details.',");
if ((correctedTranslations.match(/historicalBudgetUnknownShort/g) || []).length !== 2) throw new Error('English duplicate correction did not leave one key per locale.');
if (!correctedTranslations.includes("flexibleConsumption: 'Flexible spending'")) throw new Error('Missing English flexibleConsumption correction.');
await write(resolve('src/app/i18n/translations.js'), `${correctedTranslations.trim()}\n`);

await write(resolve('src/app/root-template.html'), rootTemplate);
await write(resolve('src/styles/legacy-foundation.css'), rawText(styles[0]));
await write(resolve('src/styles/legacy-components.css'), rawText(styles[1]));

let rootController = controller.slice();
rootController = `${rootController.slice(0, profileRange.start)}\n        registerProfileOverlay(app, dataRuntime);\n${rootController.slice(profileRange.end)}`;
rootController = rootController
    .replace(/MicroSaveApp/g, 'app')
    .replace(/MicroSaveStore/g, 'Store')
    .replace(/MicroSaveCore/g, 'Core')
    .replace(/const mountedApp = app\.mount\('#app'\);[\s\S]*?console\.log\("Rushd fully loaded\."\);/, '');
await write(resolve('src/app/root-controller.js'), `// P02 compatibility controller. P05/P06 own component and route redesign.\nimport { Core } from '../shared/core.js';\nimport { TRANSLATIONS } from './i18n/translations.js';\nimport { registerProfileOverlay } from '../components/register-profile-overlay.js';\n\nexport function installRootController(app, dataRuntime, environment = globalThis) {\n    const { ${names.join(', ')} } = dataRuntime;\n    const { localStorage, document, navigator, alert, location, Blob, URL, FileReader, setTimeout, clearTimeout, window } = environment;\n${rootController}\n}\n`);

await write(resolve('src/components/register-profile-overlay.js'), `import { createMsProfileOverlay } from './ms-profile-overlay.js';\n\nexport function registerProfileOverlay(app, dataRuntime) {\n    app.component('ms-profile-overlay', createMsProfileOverlay(dataRuntime));\n}\n`);

await write(resolve('src/components/register-legacy-components.js'), `${componentSpecs.map(([, exportName, file]) => `import { create${exportName} } from './${file}';`).join('\n')}\n\nexport function registerLegacyComponents(app, environment = globalThis) {\n${componentSpecs.map(([name, exportName]) => `    app.component('${name}', create${exportName}(environment));`).join('\n')}\n}\n`);

await write(resolve('src/application/bootstrap.js'), `import { createLegacyDataRuntime } from '../data/legacy-v1/runtime.js';\nimport { registerLegacyComponents } from '../components/register-legacy-components.js';\nimport { installRootController } from '../app/root-controller.js';\n\nexport function createLegacyApplication({ Vue, environment = globalThis, template } = {}) {\n    const dataRuntime = createLegacyDataRuntime({ environment, Vue });\n    const app = Vue.createApp({\n        ...(template ? { template } : {}),\n        setup() {\n            return { isRoot: true, store: dataRuntime.Store, core: dataRuntime.Core };\n        }\n    });\n    registerLegacyComponents(app, environment);\n    installRootController(app, dataRuntime, environment);\n    return { app, dataRuntime };\n}\n`);

await write(resolve('src/application/debug-test-bridge.js'), `// Temporary P02 bridge for existing debug tools and production-path tests.\n// P04 owns retirement or replacement of the legacy data globals and this\n// mounted-proxy accessor.\nexport function installLegacyDebugBridge(environment, dataRuntime, mountedProxy) {\n    const RushdDebug = Object.freeze({\n        // Read-only access for existing characterization controls. It does not\n        // add any finance commands beyond the proxy the legacy build exposed.\n        getAppProxy: () => mountedProxy\n    });\n    const bridge = {\n        RushdCore: dataRuntime.Core,\n        MicroSaveCore: dataRuntime.Core,\n        MicroSaveStore: dataRuntime.Store,\n        MicroSaveDB: dataRuntime.DB,\n        RushdDebug,\n        RushdImportValidation: { validateBackupPayload: dataRuntime.validateBackupPayload },\n        RushdMoneyInput: { parseMoneyInput: dataRuntime.parseMoneyInput }\n    };\n    Object.assign(environment, bridge);\n    return bridge;\n}\n`);

const thinIndex = `<!DOCTYPE html>\n<html lang="ar" dir="rtl">\n\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport"\n        content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">\n    <meta name="theme-color" content="#09090b">\n    <meta name="apple-mobile-web-app-capable" content="yes">\n    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n    <meta name="mobile-web-app-capable" content="yes">\n    <meta name="description" content="رُشد — الحكمة المالية | Rushd — Financial Wisdom Tracker">\n    <title>رُشد | Rushd</title>\n\n    <link rel="stylesheet" href="/fonts/google-fonts.css">\n\n    <script>${boot}</script>\n\n    <link rel="stylesheet" href="/fonts/material-symbols-rounded.css">\n</head>\n\n<body>\n    <div class="cinema-wrapper">\n        <div class="cinema-backdrop"></div>\n        <div id="app" v-cloak></div>\n    </div>\n    <script type="module" src="/src/main.ts"></script>\n</body>\n\n</html>\n`;
await write(resolve('index.html'), thinIndex);

const map = {
    source_sha256: createHash('sha256').update(source).digest('hex'),
    html_parser: 'parse5@7.3.0',
    original_execution_order: [
        'index.html pre-paint boot',
        'src/shared/core.js',
        'src/app/i18n/translations.js',
        'src/data/legacy-v1/runtime.js',
        'src/components/*.js',
        'src/app/root-controller.js',
        'src/main.ts mount'
    ],
    style_cascade_order: [
        'src/styles/legacy-foundation.css',
        'src/styles/tailwind.css',
        'src/styles/legacy-components.css'
    ],
    explicit_import_edges: [
        'main -> root template, CSS, bootstrap, debug bridge, i18n contract',
        'bootstrap -> legacy-v1 runtime, component registry, root controller',
        'legacy-v1 runtime -> shared Core',
        'root controller -> shared Core, translations, profile registration',
        'profile overlay -> translations and legacy data runtime'
    ],
    original_regions: [
        { owner: 'pre-paint boot retained in index.html', start_line: scripts[0].sourceCodeLocation.startLine, end_line: scripts[0].sourceCodeLocation.endLine },
        { owner: 'src/styles/legacy-foundation.css', start_line: styles[0].sourceCodeLocation.startLine, end_line: styles[0].sourceCodeLocation.endLine },
        { owner: 'src/shared/core.js', start_line: scripts[1].sourceCodeLocation.startLine, end_line: scripts[1].sourceCodeLocation.endLine },
        { owner: 'src/app/i18n/translations.js', start_line: scripts[2].sourceCodeLocation.startLine, end_line: scripts[2].sourceCodeLocation.endLine },
        { owner: 'src/app/root-template.html', start_line: appNode.sourceCodeLocation.startLine, end_line: appNode.sourceCodeLocation.endLine },
        { owner: 'src/data/legacy-v1/runtime.js', start_line: scripts[3].sourceCodeLocation.startLine, end_line: scripts[3].sourceCodeLocation.endLine },
        { owner: 'src/components/*.js', start_line: scripts[4].sourceCodeLocation.startLine, end_line: scripts[4].sourceCodeLocation.endLine },
        { owner: 'src/styles/legacy-components.css', start_line: styles[1].sourceCodeLocation.startLine, end_line: styles[1].sourceCodeLocation.endLine },
        { owner: 'src/app/root-controller.js and ms-profile-overlay.js', start_line: scripts[5].sourceCodeLocation.startLine, end_line: scripts[5].sourceCodeLocation.endLine }
    ]
};
await write(resolve('docs/implementation/P02_EXTRACTION_MAP.json'), `${JSON.stringify(map, null, 2)}\n`);

console.log(`Extracted ${map.original_regions.length} source regions from ${input}.`);
