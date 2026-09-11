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

const main = await readFile('src/main.ts', 'utf8');
assert.match(main, /createLegacyApplication/, 'P04-C composition root must keep createLegacyApplication.');
assert.doesNotMatch(main, /createGuestApplication/, 'Rollback release must not mount createGuestApplication.');

const vercel = JSON.parse(await readFile('vercel.json', 'utf8'));
assert.deepEqual(Object.keys(vercel), ['headers'], 'Rollback host config must be headers-only.');
assert.ok(!('rewrites' in vercel) && !('redirects' in vercel) && !('routes' in vercel), 'Rollback host config must not rewrite, redirect, or SPA-fallback.');

function vercelHeaders(source) {
    const rule = vercel.headers.find((entry) => entry.source === source);
    assert.ok(rule, `missing Vercel header rule for ${source}`);
    return Object.fromEntries(rule.headers.map((header) => [header.key, header.value]));
}

assert.deepEqual(vercelHeaders('/sw.js'), {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': 'no-store',
    'Service-Worker-Allowed': '/',
});
assert.equal(vercelHeaders('/retire-rejected-shell.js')['Cache-Control'], 'no-store');
assert.equal(vercelHeaders('/')['Cache-Control'], 'no-store');
assert.equal(vercelHeaders('/index.html')['Cache-Control'], 'no-store');
