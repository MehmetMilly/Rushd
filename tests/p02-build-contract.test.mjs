import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listProductionSourceFiles, ownedProductionFiles } from '../scripts/production-source.mjs';

const requiredOwnedFiles = [
    'src/application/bootstrap.d.ts',
    'src/application/commands/index.ts',
    'src/application/p04-d/contracts.ts',
    'src/application/p04-d/legacy-ports.js',
    'src/application/p04-d/legacy-ports.d.ts',
    'src/application/p04-d/authority-latch.js',
    'src/application/p04-d/authority-latch.d.ts',
    'src/application/p04-d/mutation-coverage.js',
    'src/application/p04-d/mutation-coverage.d.ts',
    'src/application/p04-d/index.ts',
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
assert.match(bootstrap, /@returns \{\{ app: VueApplication, dataRuntime: LegacyDataRuntime, featurePorts: ShellFeaturePorts, authority: AuthorityState \}\}/, 'bootstrap.js must retain its checked public return contract with the P04-D seam.');
assert.match(bootstrap, /createLegacyDataRuntime/, 'P04-D must keep the legacy data runtime as the default authority.');
assert.match(bootstrap, /resolveP04DAuthority/, 'P04-D must resolve production authority through the latch.');
assert.doesNotMatch(bootstrap, /createGuestApplication/, 'P04-D must not mount an alternate root application.');
assert.match(bootstrap, /installRootController\(app, dataRuntime, environment, \{ featurePorts: activePorts \}\)/, 'P04-D must pass the resolved port set through the controller seam.');

const latch = await readFile('src/application/p04-d/authority-latch.js', 'utf8');
assert.match(latch, /canonicalPreparing/, 'P04-D latch must name the blocked candidate state.');
assert.doesNotMatch(latch, /openDatabase|indexedDB\.open|navigator\.storage|serviceWorker/, 'P04-D1 latch must not open storage or workers.');

const rootController = await readFile('src/app/root-controller.js', 'utf8');
assert.match(rootController, /\$p04dPorts/, 'P04-D controller seam must expose the injected port set.');
assert.doesNotMatch(rootController, /canonicalReady|canonicalCandidate/, 'P04-D1 controller must not resolve candidate authority.');

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
