// P04-D2 PWA static gate. Run: node tests/pwa/static-checks.mjs
/* global console:readonly */
//
// Plain-Node checks that need no browser: the candidate service worker is
// offline-scoped with zero remote requests and preserves the rollback
// retirement; default production references no candidate worker or mode;
// the latch still performs no environment access; and every new D2 source
// file is owned by the production-source manifest.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { ownedProductionFiles } from '../../scripts/production-source.mjs';

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

// 1. Candidate service worker: offline-first, same-origin only, no finance
// storage access, retires rejected shell caches, gates skipWaiting.
{
  assert.ok(existsSync('public/rushd-pwa-sw.js'), 'candidate service worker must exist');
  const raw = await readFile('public/rushd-pwa-sw.js', 'utf8');
  const source = stripComments(raw);
  assert.match(source, /rushd-shell-/, 'candidate SW must preserve rushd-shell-* retirement');
  assert.match(source, /rushd-pwa-skip-waiting/, 'candidate SW must gate skipWaiting on an explicit message');
  assert.doesNotMatch(source, /skipWaiting\(\)\s*\)?\s*;?\s*\n?\s*\}\)\(\);/, 'candidate SW must not force-activate');
  assert.ok(!source.includes('skipWaiting()') || source.includes('rushd-pwa-skip-waiting'), 'skipWaiting only via the gated message');
  for (const forbidden of ['indexedDB', 'openDatabase', 'localStorage', 'sessionStorage', 'WebSocket', 'importScripts']) {
    assert.ok(!source.includes(forbidden), `candidate SW must not reference ${forbidden}`);
  }
  // No remote fetching: every fetch path is origin-gated to self.
  assert.match(source, /url\.origin !== self\.location\.origin/, 'candidate SW must refuse cross-origin caching');
  assert.ok(!source.includes('https://') && !source.includes('http://'), 'candidate SW must hardcode no remote URLs');
}

// 2. Rollback retirement worker is unchanged and still self-unregisters.
{
  const raw = await readFile('public/sw.js', 'utf8');
  assert.match(raw, /rushd-shell-/, 'retirement worker must still target rushd-shell-* caches');
  assert.match(raw, /unregister/, 'retirement worker must still self-unregister');
  assert.doesNotMatch(stripComments(raw), /fetch/, 'retirement worker must have no fetch handler');
}

// 3. Production boots canonical only through the build-time production
// boot: index.html keeps the rollback retirement trigger plus the local
// manifest link, main.ts boots via bootProductionApplication with no
// runtime authority inputs, and the legacy boot path still registers no
// workers and opens no v2 storage itself.
{
  const html = await readFile('index.html', 'utf8');
  assert.ok(!html.includes('rushd-pwa-sw'), 'index.html must not hardcode the worker URL (registration owns it)');
  assert.match(html, /retire-rejected-shell\.js/, 'index.html must keep the rollback retirement trigger');
  assert.match(html, /manifest\.webmanifest/, 'production index.html must link the local manifest');
  const main = await readFile('src/main.ts', 'utf8');
  assert.match(main, /bootProductionApplication/, 'production main.ts must boot through the reviewed cutover');
  assert.ok(!main.includes('canonicalCandidate'), 'production main.ts must not name candidate modes');
  assert.ok(!main.includes('candidatePorts'), 'production main.ts must not pass raw candidate ports');
  assert.ok(!main.includes('serviceWorker'), 'production main.ts must not touch service workers directly');
  const bootstrap = await readFile('src/application/bootstrap.js', 'utf8');
  assert.ok(!bootstrap.includes('serviceWorker'), 'bootstrap must not register service workers');
  assert.ok(!bootstrap.includes('v2/session'), 'bootstrap must not open v2 storage');
}

// 4. The latch still performs no environment access (D1 isolation intact).
{
  const raw = await readFile('src/application/p04-d/authority-latch.js', 'utf8');
  const source = stripComments(raw);
  for (const forbidden of ['localStorage', 'sessionStorage', 'location', 'document', 'cookie', 'URLSearchParams', 'imported']) {
    assert.ok(!source.includes(forbidden), `authority-latch must not reference ${forbidden}`);
  }
}

// 5. The candidate token module is dependency-free (no storage/worker refs
// can leak into the production bundle through the latch).
{
  const raw = await readFile('src/application/p04-d/candidate-token.js', 'utf8');
  const source = stripComments(raw);
  assert.doesNotMatch(source, /^import\s/m, 'candidate-token must have no imports');
  for (const forbidden of ['indexedDB', 'serviceWorker', 'fetch(', 'localStorage']) {
    assert.ok(!source.includes(forbidden), `candidate-token must not reference ${forbidden}`);
  }
}

// 6. Tab coordination is dependency-free too (plain-Node testable).
{
  const raw = await readFile('src/application/p04-d/tab-coordination.js', 'utf8');
  assert.doesNotMatch(stripComments(raw), /^import\s/m, 'tab-coordination must have no imports');
}

// 7. Every new D2 source file is owned by the production-source manifest.
{
  const required = [
    'src/application/p04-d/candidate-token.js',
    'src/application/p04-d/candidate-token.d.ts',
    'src/application/p04-d/canonical-host.js',
    'src/application/p04-d/canonical-host.d.ts',
    'src/application/p04-d/command-gateway.js',
    'src/application/p04-d/command-gateway.d.ts',
    'src/application/p04-d/read-models.js',
    'src/application/p04-d/read-models.d.ts',
    'src/application/p04-d/tab-coordination.js',
    'src/application/p04-d/tab-coordination.d.ts',
    'src/application/p04-d/mutation-coverage.js',
    'src/application/p04-d/mutation-coverage.d.ts',
    'src/pwa/registration.js',
    'src/pwa/registration.d.ts',
  ];
  for (const file of required) {
    assert.ok(ownedProductionFiles.includes(file), `${file} must be in the production manifest`);
    assert.ok(existsSync(file), `${file} must exist`);
  }
  assert.ok(!ownedProductionFiles.includes('src/application/p04-d/mutation-coverage.ts'), 'stale .ts inventory must leave the manifest');
}

// 8. The PWA manifest claims no installation readiness beyond evidence.
{
  assert.ok(existsSync('public/manifest.webmanifest'), 'candidate manifest must exist');
  const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.scope, '/');
  assert.ok(!('icons' in manifest) || (Array.isArray(manifest.icons) && manifest.icons.length > 0), 'manifest must not half-claim icons');
}

// 9. D3 candidate shell: owned by the manifest, dependency-light, and the
// application boundary rejects unknown injected port sets. Production no
// longer passes candidate inputs itself; the production boot module owns
// the single injection.
{
  for (const file of ['src/application/p04-d/candidate-shell.js', 'src/application/p04-d/candidate-shell.d.ts']) {
    assert.ok(ownedProductionFiles.includes(file), `${file} must be in the production manifest`);
    assert.ok(existsSync(file), `${file} must exist`);
  }
  const shell = stripComments(await readFile('src/application/p04-d/candidate-shell.js', 'utf8'));
  assert.match(shell, /createLegacyApplication/, 'candidate shell must reuse the established composition root');
  assert.ok(!shell.includes('createGuestApplication'), 'candidate shell must not mount an alternate root');
  for (const forbidden of ['localStorage', 'sessionStorage', 'location', 'document', 'cookie', 'URLSearchParams']) {
    assert.ok(!shell.includes(forbidden), `candidate-shell must not read ${forbidden} (injection only)`);
  }
  const registration = stripComments(await readFile('src/pwa/registration.js', 'utf8'));
  assert.doesNotMatch(registration, /^import\s/m, 'pwa registration must stay import-free');
  const bootstrap = await readFile('src/application/bootstrap.js', 'utf8');
  assert.match(bootstrap, /refusing unknown featurePorts/, 'bootstrap must reject unknown injected port sets');
  const main = await readFile('src/main.ts', 'utf8');
  assert.ok(!main.includes('candidatePorts'), 'production main.ts must not pass candidate ports itself');
  assert.ok(!main.includes('authorityMode'), 'production main.ts must not pass an authority request itself');
}

// 10. D4 atomic cutover: one build-time production authority choice, v1
// extraction-only freeze, and no user-reachable dual-authority toggle.
{
  for (const file of ['src/application/p04-d/production-boot.js', 'src/application/p04-d/production-boot.d.ts']) {
    assert.ok(ownedProductionFiles.includes(file), `${file} must be in the production manifest`);
    assert.ok(existsSync(file), `${file} must exist`);
  }
  const boot = stripComments(await readFile('src/application/p04-d/production-boot.js', 'utf8'));
  assert.match(boot, /P04D_PRODUCTION_AUTHORITY = 'canonical'/, 'production authority must be a hardcoded canonical constant');
  assert.match(boot, /createLegacyApplication/, 'production boot must reuse the established composition root');
  assert.ok(!boot.includes('createGuestApplication'), 'production boot must not mount an alternate root');
  // The authority choice cannot be steered at runtime: no location, URL
  // parsing, cookies, or environment-text reads anywhere in the module.
  // (localStorage holds only device namespacing and UI chrome, which never
  // select the finance authority.)
  for (const forbidden of ['location', 'URLSearchParams', 'cookie', 'matchMedia', 'imported']) {
    assert.ok(!boot.includes(forbidden), `production-boot must not reference ${forbidden}`);
  }
  assert.match(boot, /freezeV1Writers/, 'production boot must freeze v1 writers after the mount');
  assert.match(boot, /registerCandidatePwa/, 'production boot must register the reviewed worker on the canonical path');
  assert.match(boot, /refusing a legacy fallback/, 'production boot must refuse a legacy fallback instead of mounting one');
  const bootMain = await readFile('src/main.ts', 'utf8');
  assert.match(bootMain, /await bootProductionApplication/, 'production must await the canonical boot before mounting');
  // No dual-authority toggle: no build-mode flag, and the production
  // bundle exposes no runtime switch. (The single reviewed injection into
  // the established composition root lives in production-boot only.)
  for (const file of ['src/main.ts', 'index.html']) {
    const source = stripComments(await readFile(file, 'utf8'));
    assert.ok(!/authorityMode|P04D_BUILD_MODE|useLegacy|useCanonical/i.test(source), `${file} must expose no runtime authority switch`);
  }
  assert.ok(!/P04D_BUILD_MODE|useLegacy|useCanonical/i.test(boot), 'production-boot must expose no runtime authority switch');
}

// 11. D5 A55 correction: offline closure precache + navigation fallback,
// page-side warming, usable-book recovery, and pointer-flip epoch safety.
{
  const raw = await readFile('public/rushd-pwa-sw.js', 'utf8');
  const source = stripComments(raw);
  assert.match(source, /rushd-pwa-v4/, 'candidate SW must carry the font-update cache version');
  assert.match(source, /REQUIRED_URLS/, 'candidate SW must precache required offline assets at install');
  assert.match(source, /BEST_EFFORT_URLS/, 'candidate SW must keep optional assets best-effort');
  assert.match(source, /cache\.addAll\(REQUIRED_URLS\)/, 'candidate SW must fail installation without the required closure');
  for (const asset of [
    '/sqlite-worker.js',
    '/pkg/dist/wa-sqlite.mjs',
    '/pkg/dist/wa-sqlite.wasm',
    '/pkg/src/sqlite-api.js',
    '/pkg/src/examples/OPFSCoopSyncVFS.js',
    '/index.html',
  ]) {
    assert.ok(source.includes(asset), `candidate SW precache must cover ${asset}`);
  }
  assert.match(source, /satisfyRangeFromCache/, 'candidate SW must serve valid Range requests from the cached full body');
  assert.match(source, /206/, 'candidate SW must answer satisfiable ranges with 206');
  assert.match(source, /mode === 'navigate'|isNavigationRequest/, 'candidate SW must detect navigations for the offline fallback');
  assert.match(source, /503/, 'candidate SW must answer offline subresource misses without rejecting');
  assert.ok(source.includes("'range'") || source.includes('"range"'), 'candidate SW must not poison the cache with range responses');
  for (const forbidden of ['indexedDB', 'openDatabase', 'localStorage', 'sessionStorage', 'WebSocket', 'importScripts']) {
    assert.ok(!source.includes(forbidden), `candidate SW must not reference ${forbidden}`);
  }
  assert.ok(!source.includes('https://') && !source.includes('http://'), 'candidate SW must hardcode no remote URLs');

  const registration = await readFile('src/pwa/registration.js', 'utf8');
  const registrationSource = stripComments(registration);
  assert.doesNotMatch(registrationSource, /^import\s/m, 'pwa registration must stay import-free');
  assert.match(registrationSource, /CANDIDATE_PWA_CACHE = 'rushd-pwa-v4'/, 'page cache name must mirror the worker version');
  assert.match(registrationSource, /selectWarmUrls/, 'pwa registration must select same-origin warm URLs');
  assert.match(registrationSource, /warmPwaCache/, 'pwa registration must warm hashed bundles after boot');
  const versionLine = source.match(/PWA_CACHE_VERSION = '([^']+)'/);
  assert.ok(versionLine && versionLine[1] === 'rushd-pwa-v4', 'worker cache version and page cache name must agree');

  // D5 update correction: navigations are network-first (an online client
  // can never stay pinned to an obsolete cached shell), the offline shell
  // fallback is retained, and registration recovers a worker that reached
  // `waiting` before the page's listeners attached, through the same gated
  // activation path (one activation request per worker).
  const navBranch = source.indexOf('if (navigation)');
  assert.ok(navBranch > 0, 'candidate SW must special-case navigations');
  const navFetch = source.indexOf('await fetch(request)', navBranch);
  const navMatch = source.indexOf('cache.match(request', navBranch);
  assert.ok(navFetch > navBranch && navFetch < navMatch, 'candidate SW must fetch navigations before consulting the cache (network-first shell)');
  assert.match(source.slice(navBranch, navBranch + 2000), /cache\.put\('\/index\.html'/, 'candidate SW must refresh the offline shell alias on a fresh navigation');
  assert.match(registrationSource, /registration\.waiting\) requestActivation/, 'pwa registration must recover an already-waiting worker at registration time');
  assert.match(registrationSource, /activationWorker === worker/, 'pwa registration must guard one activation request per worker');
  assert.match(registrationSource, /registration\.update\(\)/, 'pwa registration must explicitly check for updates once per boot');

  const host = stripComments(await readFile('src/application/p04-d/canonical-host.js', 'utf8'));
  assert.match(host, /provisionFreshBookIfMissing/, 'canonical host must provision a usable book when storage holds none');
  assert.match(host, /adoptActivationFlip/, 'canonical host must adopt import/reset flips through one guarded path');
  assert.match(host, /bumpEpoch\(`p04-d:/, 'import/reset adoption must retire other tabs with an epoch bump');
  assert.match(host, /P04D_D5_STORAGE_MOVED_REASON/, 'canonical host must block writes that miss the flip broadcast');
  assert.match(host, /hasUsableBook/, 'canonical host must expose book existence for setup claims');

  const legacyPorts = stripComments(await readFile('src/application/p04-d/legacy-ports.js', 'utf8'));
  assert.match(legacyPorts, /hasUsableBook/, 'legacy ports must carry the book-existence read for contract parity');

  const controller = await readFile('src/app/root-controller.js', 'utf8');
  assert.match(controller, /hasUsableBook/, 'onboarding status must not claim completion without a usable book');
}

console.log('p04-d2 static checks passed');
