import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listProductionSourceFiles, ownedProductionFiles } from '../scripts/production-source.mjs';

const requiredOwnedFiles = [
    'src/application/bootstrap.d.ts',
    'src/application/commands/index.ts',
    'src/data/legacy-v1/contracts.ts',
    'src/domain/primitives/money.ts',
    'src/shared/contracts.ts',
    'src/types/vite-env.d.ts'
];

for (const file of requiredOwnedFiles) {
    assert.ok(ownedProductionFiles.includes(file), `${file} must remain in the canonical production manifest.`);
}
assert.deepEqual(listProductionSourceFiles(), [...ownedProductionFiles].sort(), 'Production source files must exactly match the canonical manifest.');

const tsconfig = JSON.parse(await readFile('tsconfig.json', 'utf8'));
assert.equal(tsconfig.compilerOptions.checkJs, true, 'P02 glue must remain checked as JavaScript.');
assert.ok(tsconfig.include.includes('src/application/bootstrap.js'), 'Actual bootstrap.js must stay in the typecheck graph.');
assert.ok(tsconfig.include.includes('src/application/debug-test-bridge.js'), 'Actual debug bridge must stay in the typecheck graph.');

const bootstrap = await readFile('src/application/bootstrap.js', 'utf8');
assert.match(bootstrap, /@returns \{\{ app: VueApplication, dataRuntime: LegacyDataRuntime \}\}/, 'bootstrap.js must retain its checked public return contract.');
