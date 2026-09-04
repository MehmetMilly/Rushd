import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Static guards read the exact production entry and every source module in a
// deterministic order. Keeping this list explicit makes an omitted ownership
// file a test failure instead of an accidental false pass after P02.
const requiredProductionFiles = [
    'index.html',
    'src/main.ts',
    'src/app/root-template.html',
    'src/app/root-controller.js',
    'src/app/i18n/translations.js',
    'src/application/bootstrap.js',
    'src/application/debug-test-bridge.js',
    'src/data/legacy-v1/runtime.js',
    'src/shared/core.js',
    'src/styles/legacy-foundation.css',
    'src/styles/tailwind.css',
    'src/styles/legacy-components.css',
    'src/components/ms-icon.js',
    'src/components/ms-button.js',
    'src/components/ms-swipe-item.js',
    'src/components/ms-numpad.js',
    'src/components/ms-stat-ring.js',
    'src/components/ms-modal.js',
    'src/components/ms-profile-overlay.js',
    'src/components/register-legacy-components.js',
    'src/components/register-profile-overlay.js'
];

function collect(directory, files) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) collect(path, files);
        else if (/\.(?:html|js|mjs|ts|css)$/.test(entry.name)) files.push(path);
    }
}

export function listProductionSourceFiles() {
    const missing = requiredProductionFiles.filter((file) => !existsSync(file));
    if (missing.length) throw new Error(`P02 production source coverage is incomplete: ${missing.join(', ')}`);
    const files = ['index.html'];
    collect('src', files);
    return [...new Set(files)].sort();
}

export function readProductionSource() {
    return listProductionSourceFiles()
        .map((file) => `\n/* ${file} */\n${readFileSync(file, 'utf8')}`)
        .join('\n');
}
