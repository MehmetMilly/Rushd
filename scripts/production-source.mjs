import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Static guards read the exact production entry and every source module in a
// deterministic order. Keeping this list explicit makes an omitted ownership
// file a test failure instead of an accidental false pass after P02.
export const ownedProductionFiles = Object.freeze([
    'index.html',
    'src/main.ts',
    'src/app/root-template.html',
    'src/app/root-controller.d.ts',
    'src/app/root-controller.js',
    'src/app/i18n/contracts.ts',
    'src/app/i18n/translations.js',
    'src/application/bootstrap.d.ts',
    'src/application/bootstrap.js',
    'src/application/debug-test-bridge.js',
    'src/application/commands/context.ts',
    'src/application/commands/validation.ts',
    'src/application/commands/handlers.ts',
    'src/application/commands/preview.ts',
    'src/application/commands/execute.ts',
    'src/application/commands/index.ts',
    'src/domain/primitives/currency.ts',
    'src/domain/primitives/money.ts',
    'src/domain/primitives/civil-date.ts',
    'src/domain/primitives/monthly-cycle.ts',
    'src/domain/primitives/instant.ts',
    'src/domain/primitives/index.ts',
    'src/domain/contracts/identity.ts',
    'src/domain/contracts/canonical.ts',
    'src/domain/contracts/ledger.ts',
    'src/domain/contracts/commands.ts',
    'src/domain/contracts/repository.ts',
    'src/domain/contracts/index.ts',
    'src/data/legacy-v1/contracts.ts',
    'src/data/legacy-v1/runtime.d.ts',
    'src/data/legacy-v1/runtime.js',
    'src/shared/contracts.ts',
    'src/shared/core.d.ts',
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
    'src/components/register-legacy-components.d.ts',
    'src/components/register-legacy-components.js',
    'src/components/register-profile-overlay.js',
    'src/types/vite-env.d.ts'
]);

function collect(directory, files) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) collect(path, files);
        else if (/\.(?:html|js|mjs|ts|css)$/.test(entry.name)) files.push(path);
    }
}

export function listProductionSourceFiles() {
    const missing = ownedProductionFiles.filter((file) => !existsSync(file));
    if (missing.length) throw new Error(`P02 production source coverage is incomplete: ${missing.join(', ')}`);
    const discovered = ['index.html'];
    collect('src', discovered);
    const unexpected = discovered.filter((file) => !ownedProductionFiles.includes(file));
    if (unexpected.length) throw new Error(`P02 production source manifest has unowned files: ${unexpected.sort().join(', ')}`);
    return [...ownedProductionFiles].sort();
}

export function readProductionSource() {
    return listProductionSourceFiles()
        .map((file) => `\n/* ${file} */\n${readFileSync(file, 'utf8')}`)
        .join('\n');
}
