# P02 build and parity foundation

Task A wraps the unchanged legacy DOM/script application in Vite and vendors the
runtime Vue compiler without starting the P02 module split. `npm run build` writes
the production site to `dist/`; browser smoke explicitly serves that directory.

## Commands

```bash
npm run dev             # Vite development server at http://127.0.0.1:5173
npm run build           # deterministic production output in dist/
npm run preview         # preview dist/ at http://127.0.0.1:4173
npm run lint            # ESLint for the new foundation/comparator glue
npm run typecheck       # strict TypeScript check for new TS boundaries
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

The vendored global/compiler build is Vue `3.5.42` from the pinned npm package.
Its SHA-256 is recorded in `public/vendor/vue.global.js.sha256` and is checked
with `shasum -a 256 public/vendor/vue.global.js`. The legacy app continues to
use runtime-compiled templates and the original seven classic inline script
blocks in their original order.

The generated Tailwind sheet is linked after the first legacy `<style>` block
(where the Play CDN injected its sheet) and before the second body style block,
so preflight and utility cascade order stay characterized.

Task B replaces the remaining styling/runtime requests with a pinned Tailwind
CSS `3.4.17` build and local Google Fonts/Material Symbols Rounded assets. The
font CSS response and every downloaded WOFF2 file are hashed in
`public/fonts/PROVENANCE.json`; applicable OFL and Apache 2.0 texts are included
under `public/fonts/licenses/`. The browser smoke test blocks and reports every
request outside its local test origin.
