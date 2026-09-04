# P02 build and parity foundation

Task A initially wrapped the legacy DOM/script application in Vite and vendored
the runtime Vue compiler. Task C completed the module split. `npm run build`
writes the production site to `dist/`; browser smoke explicitly serves that directory.

## Commands

```bash
npm run dev             # Vite development server at http://127.0.0.1:5173
npm run build           # deterministic production output in dist/
npm run preview         # preview dist/ at http://127.0.0.1:4173
npm run lint            # ESLint for P02 glue, contracts, and test tooling
npm run typecheck       # strict TS plus checked bootstrap/debug JavaScript
npm test                # repository, finance, fixture, P00, and P01 checks
npm run test:browser    # build, then smoke-test dist/ with pinned Chromium
npm run parity:self-test # same-root zero-diff + deliberate mutation proof
npm run parity:quick    # 15-state representative comparison to pre-P02
npm run parity:full     # 228-state characterized matrix comparison
npm run ci              # all above gates plus parity self-test and quick comparison
```

The comparator defaults to the pre-P02 reference commit
`3215ca3c9380104b5bbc38b66b99e3df0ff44779` and uses the synthetic fixtures from
`tests/fixtures/v1/`. Captures use `2026-08-10T09:00:00.000Z`, `Asia/Riyadh`,
device scale 1, loaded fonts, and disabled motion. Quick covers Arabic/English,
dark/light, phone/tablet/laptop widths, and representative onboarding, capture,
edit, plan, profile, reset, and error states. Full covers every Arabic/English ×
dark/light × 390×844/1024×1366/1440×900 combination and all 19 characterized
states (228 screenshots). Screenshots stay in memory; only a machine-readable
result and any non-empty disposable diff PNGs are written under `test-results/`.

Vue `3.5.42` comes from the pinned npm package. Vite aliases it to the local
full ESM compiler build because P02 keeps runtime-compiled templates. The
historical pre-split source had seven classic inline script blocks; Task C maps
their former order but the current production entry has one pre-paint IIFE and
the `src/main.ts` module entry.

The generated Tailwind sheet is linked after the first legacy `<style>` block
(where the Play CDN injected its sheet) and before the second body style block,
so preflight and utility cascade order stay characterized.

Task B replaces the remaining styling/runtime requests with a pinned Tailwind
CSS `3.4.17` build and local Google Fonts/Material Symbols Rounded assets. The
font CSS response and every downloaded WOFF2 file are hashed in
`public/fonts/PROVENANCE.json`; applicable OFL and Apache 2.0 texts are included
under `public/fonts/licenses/`. The browser smoke test blocks and reports every
request outside its local test origin.

## Task C modular split

Task C reduces `index.html` from 560,927 bytes to a 2,854-byte Vite entry. Its
pre-paint preference IIFE and the static cinema wrapper/backdrop remain in
place. The exact root inner HTML, both style regions, six executable blocks,
and their order were mapped with
`parse5@7.3.0` before edits. The parser-backed map is
[`P02_EXTRACTION_MAP.json`](P02_EXTRACTION_MAP.json); the extraction script is
[`scripts/extract-p02-legacy.mjs`](../../scripts/extract-p02-legacy.mjs). Run it
against the pinned pre-split source, never the thin final entry.

`src/main.ts` imports the raw root template and CSS in former cascade order,
then creates the app through Vite's full-compiler Vue alias. The controller,
v1 Store and DB, components, i18n, shared Core, and styles now have explicit
owners. The Node harness imports real production modules through the bootstrap
factory while keeping its P01 return API and assertions.

`tsconfig.json` keeps strict checking on new TypeScript and checks the actual
`bootstrap.js` and debug bridge JavaScript. Paired declarations isolate the
mechanically moved controller, v1 Store, Core, and runtime-template components;
P03/P04/P05/P06 own replacing those compatibility boundaries with typed code.
The canonical manifest in `scripts/production-source.mjs` names every owned
production source file and rejects both missing and unlisted files.

The only declared content changes are English `flexibleConsumption` =
`Flexible spending` and `flexibleItemRequired` = `Choose a flexible item first.`
The duplicate English `historicalBudgetUnknownShort` was removed while keeping
its prior winning value, `Not recorded`. `tests/i18n-parity.test.mjs` gates
locale parity and source duplicate keys.

`npm run test:legacy-idb` runs both synthetic v1 reopen/render and blank-profile
fresh-install legs against the built app. It asserts the exact name, version,
stores, key paths, indexes, index uniqueness, no reopen upgrade, and seeded
record rendering. `src/application/debug-test-bridge.js` documents the temporary bridge:
its read-only `RushdDebug.getAppProxy()` accessor preserves existing
characterization controls without depending on Vue private fields. P04 owns its
replacement. Vue router and SFC conversion are deferred to P04/P05 because this
phase is a mechanical split, not navigation or visual redesign.

The final full visual report has 228 states. 222 are pixel-identical to pinned
`3215ca3c9380104b5bbc38b66b99e3df0ff44779`; the only six deltas are English
`profile-modal` at dark/light × 390×844, 1024×1366, and 1440×900. They total
670,075 differing pixels and are the direct reflow of the two declared English
flexible-spending labels above. The comparator intentionally reports those as a
non-passing strict result rather than masking or tolerating them. The quick
matrix remains exact: 15/15 states and zero differing pixels.
