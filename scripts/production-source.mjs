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
    'src/application/commands/validation-helpers.ts',
    'src/application/commands/validation-activity.ts',
    'src/application/commands/validation-obligations.ts',
    'src/application/commands/validation-allocations.ts',
    'src/application/commands/validation-task-c.ts',
    'src/application/commands/handler-support.ts',
    'src/application/commands/handlers.ts',
    'src/application/commands/activity-handlers.ts',
    'src/application/commands/obligation-handlers.ts',
    'src/application/commands/obligation-movement.ts',
    'src/application/commands/allocation-handlers.ts',
    'src/application/commands/recovery-handlers.ts',
    'src/application/commands/plan-handlers.ts',
    'src/application/commands/cycle-handlers.ts',
    'src/application/commands/preview.ts',
    'src/application/commands/execute.ts',
    'src/application/commands/scope-check.ts',
    'src/application/commands/index.ts',
    'src/application/sync/apply-remote.ts',
    'src/application/sync/index.ts',
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
    'src/domain/contracts/repository-snapshot-validation.ts',
    'src/domain/contracts/index.ts',
    'src/domain/sync/scope.ts',
    'src/domain/sync/cursors.ts',
    'src/domain/sync/tombstones.ts',
    'src/domain/sync/conflicts.ts',
    'src/domain/sync/merge.ts',
    'src/domain/sync/signout.ts',
    'src/domain/sync/provider.ts',
    'src/domain/sync/index.ts',
    'src/domain/activity/derive.ts',
    'src/domain/obligations/derive.ts',
    'src/domain/allocations/derive.ts',
    'src/domain/recovery/derive.ts',
    'src/domain/plans/derive.ts',
    'src/domain/cycles/derive.ts',
    'src/domain/calculations/completeness.ts',
    'src/domain/calculations/availability.ts',
    'src/domain/calculations/pacing.ts',
    'src/data/legacy-v1/contracts.ts',
    'src/data/legacy-v1/runtime.d.ts',
    'src/data/legacy-v1/runtime.js',
    'src/data/experiments/candidates.ts',
    'src/data/experiments/durable-overlay.ts',
    'src/data/experiments/sqlite-candidate-repository.ts',
    'src/data/v2/errors.ts',
    'src/data/v2/json-copy.ts',
    'src/data/v2/schema.ts',
    'src/data/v2/namespace.ts',
    'src/data/v2/protocol.ts',
    'src/data/v2/overlay.ts',
    'src/data/v2/sqlite-worker.ts',
    'src/data/v2/worker-client.ts',
    'src/data/v2/repository.ts',
    'src/data/v2/checkpoint-store.ts',
    'src/data/v2/session.ts',
    'src/data/v2/index.ts',
    'src/data/migration/reasons.ts',
    'src/data/migration/money-conversion.ts',
    'src/data/migration/extract.ts',
    'src/data/migration/mapping.ts',
    'src/data/migration/lifecycle-id.ts',
    'src/data/migration/control-store.ts',
    'src/data/migration/staging.ts',
    'src/data/migration/index.ts',
    'src/data/portability/format.ts',
    'src/data/portability/decode-helpers.ts',
    'src/data/portability/decode-ledger.ts',
    'src/data/portability/decode.ts',
    'src/data/portability/validate.ts',
    'src/data/portability/snapshot.ts',
    'src/data/portability/index.ts',
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
