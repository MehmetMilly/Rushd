# P02 feasibility spike — experimental evidence

**Status:** complete
**Worker:** Started by GLM 5.3 Flash; most experiments and the final report were completed by Muse Spark 1.3 after the GLM allowance expired.
**Date:** 2026-09-03
**Starting commit:** `bfa13b33b3439090492547d406a24b55ae85a98f` (branch `codex/rushd-rebuild-plan`)
**Disposable environment:** `/tmp/rushd-p02-spike`, a full clone at the starting commit. It was reused after the model handoff and removed after the evidence below was recorded.

All experiments were run inside the disposable clone only. No experimental code was copied back. This report is the single file created in the real repository.

## Environment

- macOS (Darwin 25.5.0, arm64). Node/npm versions recorded in experiment results below.
- Network access was available (CDN dependencies and npm installs reachable) — recorded where it matters.
- Playwright browsers were reused from the real repository's existing install where noted.

## Experiment index

1. Baseline — tests and browser smoke on the untouched starting commit.
2. Vite wrapper — build and serve the current single-file app with Vite.
3. Local dependencies — CDN and browser-global inventory; local replacement probes.
4. Mechanical externalization — extracting inline styles/scripts to external files.
5. Module and TypeScript boundary — small strict-TS/ESM seams.
6. Storage compatibility — legacy IndexedDB contract and modular re-open probe.
7. Test compatibility — what the existing Node/Playwright tests assume.
8. Migration sequencing — evidence-based options for Astra.

---

## 1. Baseline

Environment: Node v26.8.1, npm 11.19.0. Playwright was reused from the real repository's existing install (symlinked `node_modules` into the clone) so results reflect the same browsers/versions the project already uses; `PLAYWRIGHT_BROWSERS_PATH=0` browsers live under that `node_modules`.

Commands and results (untouched clone at `bfa13b3`):

- `npm test` — **pass**. All eight stages green: `scripts/smoke-check.mjs`, `scripts/finance-rules.test.mjs`, `scripts/p00-fixtures.test.mjs`, `scripts/p00-characterization.test.mjs`, `tests/p01-dangerous-mutations.test.mjs`, `tests/p01-stability.test.mjs`, `scripts/p00-artifact-guards.test.mjs`, `scripts/verify-p00-baseline.mjs`.
- `npm run test:browser` — **pass** (`Rushd browser smoke test passed.`).

Environmental observations (not product failures):

- `scripts/browser-smoke.cjs` serves files from `process.cwd()` over a tiny static server with correct MIME types, loads the page with `waitUntil: 'networkidle'`, and drives the real UI (skip onboarding, add an Arabic-named expense with an Arabic-numeral amount `٤٢`, reload, assert persistence). It is therefore dependent on the CDNs (Vue/Tailwind/fonts) being reachable; with CDNs blocked it would fail on `networkidle`/timeout for environmental reasons.
- The smoke test explicitly filters out console warnings containing `cdn.tailwindcss.com` (`scripts/browser-smoke.cjs:84-88`) — the Tailwind Play CDN emits a known "should not be used in production" warning. It asserts **zero** other errors/warnings/pageerrors, so any Vite-era change that introduces a single console error breaks the gate.
- The smoke test writes a screenshot to `test-results/browser-smoke/dashboard-with-expense.png` — useful as an informal characterization artifact during migration.
- `scripts/smoke-check.mjs:24-38` asserts `index.html` still contains the literal markers `Vue.createApp`, `indexedDB.open`, `exportData`, `importData`, `factoryReset`, `<html lang="ar" dir="rtl">` — a repository-level coupling to the single-file shape that must be updated deliberately in P02.

**Baseline verdict:** starting point is green on both gates; later experiments can be compared against this exact behavior.

## 2. Vite wrapper

Question: can Vite build and serve the current application with minimal mechanical changes, and does the app actually boot?

Method: in the disposable clone, on the **completely unmodified** `index.html`:

- `npx --yes vite@5.4.21 build` → succeeds: `dist/index.html 558.04 kB (gzip 94.77 kB)`, built in ~113 ms, "3 modules transformed". The build output is a single `index.html` (no separate JS/CSS chunks), because Vite only bundles `<script type="module">` and `<link rel="stylesheet">` — all 7 inline classic `<script>` blocks and both CDN scripts are passed through verbatim.
- Behavioral check of `dist/` (a copy of the browser smoke driving the real UI: skip onboarding → add expense `قهوة اختبار` with Arabic-numeral amount `٤٢` → assert visible → reload → assert persisted → assert zero unexpected console/page errors): **PASSED**.
- Dev server (`npx vite --port 4200`): app boots and the same behavioral smoke **PASSED** with zero console errors/warnings/pageerrors.

What did **not** break, because Vite leaves classic inline scripts and external URLs untouched: the `const`-chained cross-block globals, the `tailwind.config` inline assignment, the boot-theme IIFE, the Google Fonts/Material Symbols links, and the unpkg/Tailwind CDN scripts.

What this does **not** prove:

- A successful build alone is not migration progress — nothing is bundled, hashed, or modular yet. The output is still one monolithic HTML file; it merely proves Vite is a safe wrapper at step zero.
- The moment P02 externalizes scripts as `src` files or converts blocks to `type="module"`, Vite starts processing them, and different rules apply (experiments 4 and 5).
- Version note: Vite 5 was used for determinism; newer majors (6/7) were not swept. Nothing in the observed behavior is version-sensitive, but Astra may pick the current major at implementation time.

**Verdict:** Vite is a zero-friction wrapper for the current file. The safe incremental path is: wrap first (build+serve unchanged), then externalize in steps with the behavioral smoke run after every step.

## 3. CDN and browser-global inventory

Question: what does the app load from the network at runtime, what browser globals does it depend on, and what is the local-replacement path for each?

Method: `grep`/parser inventory of `index.html` in the clone at `bfa13b3`, plus `npm install --no-save vue@3.5.42` + `import('vue')` probe and `npm view` reachability checks (network was available).

### 3.1 Every external URL (exact)

| URL | Use | Fetch? |
|---|---|---|
| `https://unpkg.com/vue@3/dist/vue.global.js` | Vue 3 runtime (global build). **Unpinned: floats on major `3`.** | Yes, render-blocking classic script |
| `https://cdn.tailwindcss.com` | Tailwind Play CDN (JIT in browser). **Unpinned.** | Yes, render-blocking classic script |
| `https://fonts.googleapis.com` / `https://fonts.gstatic.com` (preconnect) + `css2?family=IBM+Plex+Sans+Arabic...&family=Noto+Kufi+Arabic...&family=Inter...&family=JetBrains+Mono...&family=Outfit...&family=Sora...` | 6 font families | Yes, stylesheet + font files |
| `https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded...` | Icon ligature font | Yes |
| `http://www.w3.org/2000/svg` | XML namespace identifier inside an inline `data:image/svg+xml` chevron | No fetch |
| `data:image/svg+xml,...` (one select-chevron) | Already inline | No fetch |

No other runtime dependencies: no router, no state library, no chart/HTTP/i18n library. `index.html` is otherwise self-contained (558,039 bytes).

### 3.2 Browser-global dependencies (exact)

- `Vue.createApp` — exactly 1 call site (component-library block). Only `Vue.*` reference in the file.
- `tailwind.config = {...}` — 1 assignment (v3-style Play config: custom `canvas/surface/brand/success/danger/warning/glass` colors mapped to CSS vars, `sans/sans-ar/display-ar/mono` font families). Only `tailwind.*` reference.
- `window` exposures used by tests/debug: `RushdCore`/`MicroSaveCore`, `MicroSaveStore`, `MicroSaveDB`, `RushdImportValidation`, `RushdMoneyInput`. `window.matchMedia` (boot theme/motion), `window.prompt` (1 site).
- `document.*` — 15 references (theme/motion boot, export-download anchor, mount target `#app`).
- `localStorage` keys: `rushd_theme`, `rushd_motion`, `rushd_lang`, `rushd_calendar`, `rushd_import_success`, `microsave_import_success` (+ month-prompt defer keys, `MONTH_START/MONTH_END_PROMPT_DEFER_KEY`).
- `indexedDB` — 1 `open()` site (see §6). `navigator.connection` (boot), `navigator.vibrate` (buttons), `Blob`/`URL.createObjectURL`/`FileReader` (export/import flow), `Intl` (currency/date formatting).

### 3.3 Local-replacement probes and classification

- **Vue → local asset first, ESM import later (proven at file level).** `npm install --no-save vue@3.5.42` + `import('vue')` → OK (`version: 3.5.42`). The npm package ships `dist/vue.global.js` — the byte-equivalent of the unpkg file — so vendoring it as a local `<script src>` is a zero-code-change step that also removes the unpinned-major risk. Full ESM (`import { createApp } from 'vue'` + Vite + `@vitejs/plugin-vue`) **requires an adapter**: the single `createApp` site plus ~10 component registrations must be rewritten; templates are currently runtime-compiled strings, so SFC conversion is redesign, not mechanical. (Vendored file was identified, not yet served in a browser — limitation.)
- **Tailwind Play CDN → requires later replacement (build-time Tailwind).** Adapter is small: the inline `tailwind.config` maps almost 1:1 to `tailwind.config.js`. Dynamic-class audit (counts from the clone): 97 `:class`/`:style` bindings, **all static string literals inside ternary/object branches** (e.g. `lang === 'ar' ? 'bg-brand text-white' : 'text-zinc-400...'`); 0 template-string constructions of utilities; the 5 `[...]:` regex hits are false positives (attribute selectors, array/object literals). Class-returning helpers (`getVarianceStripeClass`, `getVariancePillClass`, `getCategoryIcon` map) return static literals (`stripe-*`, `pill-*`, `directions_car`, …). Two dynamic constructions exist but are **custom CSS, not Tailwind**: `'cat-' + expense.category` and `` `source-${getExpenseSource(...)}` `` (values enumerable from `EXPENSE_SOURCE_VALUES`: manual/template/flexible). Consequence: build-time content scanning over all source files is safe for utilities, but P02 must add a guard that no Tailwind utility is ever constructed dynamically (or add a safelist) — the Play CDN currently masks this class of bug.
- **Google Fonts (6 families) → local assets.** Self-host woff2 + `@font-face`. Unresolved: license verification for IBM Plex Sans Arabic / Noto Kufi Arabic redistribution (AGENTS.md constraint) — question for Astra/founder.
- **Material Symbols Rounded → local asset.** `ms-icon` renders ligatures (`{{ name }}` inside `.material-symbols-rounded`); names are dynamic (`getCategoryIcon()`, `cat.icon`, static `delete/check/add`), so self-hosting the variable font covers all present and future names with no per-icon work. `cat.icon` value set not yet audited (P02 check).
- **No directly-importable runtime deps** (nothing is currently an npm ESM import). Nothing else needs replacing.

**Verdict:** 2 blocking CDN scripts (Vue, Tailwind — both unpinned), 2 font groups suitable for self-hosting, and no additional external URLs found in the current source. The dangerous Tailwind-migration risk (dynamic utilities) was checked and not found; the remaining risk is process (content globs + a dynamic-utility guard), not a known dynamic-class blocker.

## 4. Mechanical externalization

Question: can the inline `<style>`/`<script>` regions be extracted to external files without behavior change, and what breaks?

True structure (parser-verified, not regex — see hazard below): **2 `<style>` blocks** (74,121 chars in `<head>`; 46,188 chars mid-body between the component-library and main-controller scripts) and **7 inline classic scripts** (1,449 / 1,866 / 6,625 / 31,131 / 109,835 / 15,286 / 124,232 chars = tailwind-config, boot-theme IIFE, Core utils, TRANSLATIONS, DB+Store, app shell, main controller). No `document.write`; no top-level `await` (all `await`s are inside `async` methods); no `DOMContentLoaded` listener — scripts sit at end of body and `mount('#app')` runs synchronously. No `</script>` inside JS strings.

Method: `ext-extract.mjs` (parser-based splitter honoring script raw-text rules) → `ext-test/index.html` + `assets/app-0..6.js` + `assets/app-0..1.css`, referenced via plain `<script src>` / `<link rel=stylesheet>` at the exact original positions, same order, no `defer`/`async`/`type=module`. Roundtrip check (re-inline extracted files) is **byte-identical** to the original `index.html`.

Results:

- `PLAYWRIGHT_BROWSERS_PATH=<real-repo browsers> node smoke-ext.cjs` (same flow as `browser-smoke.cjs`: skip onboarding → add `قهوة اختبار` / `٤٢` → assert visible → reload → assert persisted → assert zero console errors/warnings/pageerrors + zero failed/4xx requests) — **PASSED**.
- Ordering/scope/DOM-startup: no problems as classic scripts — shared top-level `const`s (`Core`, `TRANSLATIONS`, 73 helpers/DB/Store in file 4, `MicroSaveApp`) keep working through the global lexical environment; DOM is parsed before body-end scripts run, identical to inline.
- **Regex-extraction hazard (failed sub-experiment, now a recorded constraint):** a naive `/<style>([\s\S]*?)<\/style>/` pass miscounts (reported "2 styles / 6 scripts", merging the last two scripts). Causes: (1) a JS comment in the component block contains the literal `<style>` (`/* See <style> block in Part 1 ... */`); (2) a real 46 KB `<style>` block sits mid-body. Browsers are unaffected (script raw-text ends only at `</script>`), but any P02 codemod must use an HTML parser, not regex. The roundtrip-identical result above is the proof the parser approach is sound.
- **Vite-build-of-externalized failure (failed sub-experiment, key sequencing evidence):** copying `ext-test/` to `vite-ext/` and running `npx --yes vite@5.4.21 build vite-ext` succeeds with warnings — `<script src="assets/app-N.js"> ... can't be bundled without type="module" attribute` — and emits a **broken** `dist/`: CSS is bundled+hashed (`assets/index-*.css`, 68 KB) but the seven `app-*.js` files are **not copied** to `dist`, so the built page 404s all scripts (verified in headless Chromium: 7× 404, app dead, console errors). Consequence: externalize-to-classic-`src` and `vite build` are incompatible without extra work (legacy JS under `public/`, or keep scripts inline until ESM conversion, or convert straight to modules).

**Verdict — safe vs redesign split:** mechanically safe: extracting styles (preserving document order — body CSS must come after head CSS on equal specificity) and scripts to classic external files with identical order/positions (browser-proven). Requires redesign, not extraction: converting any block to `type=module` (each module gets its own scope; the ~80 cross-block `const` references in §5 become imports), and making `vite build` consume the result (module conversion or `public/` containment).

## 5. Module and TypeScript boundary

Question: where are the safe ESM/strict-TS seams, and what concretely blocks full conversion?

Cross-block coupling map (8-space-indent top-level `const`s; inline code is body-indented, hence the indent rule):

| File | Defines (top level) | Consumed by |
|---|---|---|
| app-0.js (tailwind config) | none (`tailwind.config=` assignment) | nobody (config only) |
| app-1.js (boot IIFE) | none | nobody |
| app-2.js (Core) | `Core` (+ `window.RushdCore`/`MicroSaveCore` aliases) | app-4, app-5, app-6 |
| app-3.js (TRANSLATIONS) | `TRANSLATIONS` | app-6 |
| app-4.js (helpers+DB+Store) | 73 consts (`toFiniteNumber`, `parseMoneyInput`, date/money/validation helpers, `DB`, `Store`, …) + `window.MicroSaveStore/DB`, `RushdImportValidation`, `RushdMoneyInput` | app-5, app-6 |
| app-5.js (app shell) | `MicroSaveApp` (+ component registrations) | app-6 |
| app-6.js (main controller) | `THEME_META_COLORS`, form factories, `mountedApp` | nobody (root) |

Probes (all in the clone):

1. **Core → ESM: PASS.** `mod-probe/build-core.mjs` replaces `const Core = {` with `export const Core = {` and drops the 2 `window` lines (only browser refs in the block). `import('./mod-probe/core.mjs')` in Node 26 works with zero stubs; `Currency.format(42,'SAR')`, `Date.getTodayISO()`, `addDays('2026-01-31',1) → '2026-02-01'`, `toLocalISO('2026-01-01T21:30:00Z') → '2026-01-02'` (Riyadh boundary) all correct.
2. **Strict TS on raw Core: 20 errors, all shallow.** `npx -p typescript@5.9.2 tsc --noEmit --strict --target es2022 mod-probe/core-strict.ts` → 20× `TS7006` implicit-`any` params plus cascading `TS2339 ... on type 'never'` from untyped literals. Zero DOM/Node/syntax errors. Blocker class: missing annotations only — bounded typing work, no redesign.
3. **TRANSLATIONS seam: pure data, but drift found.** Via the real harness (`loadRushdRuntime`): `ar` 269 keys vs `en` 267; `flexibleConsumption`, `flexibleItemRequired` exist only in `ar`; exactly one within-locale duplicate — `historicalBudgetUnknownShort` in `en` (last-wins silently; matches the P01 handoff cleanup note). Extraction as `translations.ts`/`ar.json`+`en.json` is trivial; P02 needs a key-parity + no-duplicate gate or the drift will silently grow.
4. **DB/Store seam: requires an adapter (proven pattern exists).** `DB`/`Store` touch `indexedDB`, `localStorage`, `document`, `navigator`, `Vue`. The existing `tests/harness/load-rushd-runtime.mjs` already runs them in Node with in-memory IndexedDB/localStorage shims + a Vue stub — that shim set is the adapter contract P02 should formalize behind a storage interface; production code must stop touching `indexedDB`/`localStorage` directly.

**Verdict — safe boundaries vs blockers:** safe to convert first: `Core` (Currency/Date/UUID/Physics), constants (`EXPENSE_SOURCE_VALUES`, `MOTION_LEVEL_VALUES`, …), `TRANSLATIONS`, pure money/date/validation helpers in app-4. Concrete blockers for the rest: (a) ~80 cross-block `const` refs must become explicit imports; (b) `window.*` debug exposures need a decision (keep a debug bridge vs remove — tests currently consume `MicroSaveStore/DB`, `TRANSLATIONS`, `RushdMoneyInput` through them); (c) strict TS needs annotations on every helper signature (mechanical, ~20 sites in Core alone, more in app-4/6); (d) Vue component templates are runtime-compiled strings — SFC/`defineComponent` conversion is redesign.

## 6. Storage compatibility

Question: what exactly is the legacy storage contract, and can a modular app reopen existing data without renaming or recreating anything?

Exact contract (from `ext-test/assets/app-4.js`, `DB` object; confirmed live in §6 probe):

- Database name: `MicroSaveOS_DB` — inline comment states it is preserved so existing users do not lose data. Version: `1`.
- Stores: `settings` (`keyPath: 'key'`), `templates` (`keyPath: 'id'`), `expenses` (`keyPath: 'id'`, indexes `date` and `isPaid`, both non-unique). `onupgradeneeded` creates each store/index **only if absent** — additive, never destructive.
- Opening assumptions: `connect()` opens `(dbName, version)`; the transaction wrapper auto-reconnects once on `InvalidStateError` (stale/closed handle). No version-bump, delete, or rename path exists in production code; fixtures (`tests/fixtures/v1/*.json`) independently pin `indexed_db.name: MicroSaveOS_DB`, `version: 1`.
- Preferences live in `localStorage` (keys in §3.2), readable same-origin by any code.

Probe (`probe-idb.cjs`, headless Chromium, same origin `127.0.0.1:4176`): page A ran the real app and added expense `probe بقاء` with Arabic-Indic amount `٧٧` (stored as `expectedCost: 77` — normalization verified in the stored record); page B was `blank.html` (zero legacy code) doing a raw `indexedDB.open('MicroSaveOS_DB', 1)`.

Results — **PASSED**:

- App-context read: `{name: MicroSaveOS_DB, version: 1, stores: [expenses, settings, templates]}, count: 1`.
- Blank-context reopen: no `onupgradeneeded` fired (no upgrade needed), all 3 stores readable (`expenses: 1, settings: 4, templates: 0`), seeded expense found by name. No rename, no recreate, no migration code.

**Verdict:** the legacy database is a stable, additive contract. A modular app can open `MicroSaveOS_DB` v1 read/write from day one; P02 must keep name/version/stores and treat the legacy DB as immutable input (per master plan §9) until P04's verified migration exists. Only open question is the future v2 identity split (P04), which is out of P02 scope.

## 7. Test compatibility

Question: which existing tests assume the single-file shape, and what is the smallest harness change that preserves production-path coverage?

Coupling inventory (clone at `bfa13b3`):

| Test | Coupling to `index.html` shape | Smallest P02 change |
|---|---|---|
| `scripts/smoke-check.mjs` | Requires `index.html` to contain `Vue.createApp`, `indexedDB.open`, `exportData`, `importData`, `factoryReset`, `<html lang="ar" dir="rtl">` | Deliberate update: assert the same markers on the concatenated `src/` (or per owning module) instead of `index.html` |
| `tests/harness/load-rushd-runtime.mjs` | `/<script>([\s\S]*?)<\/script>/g` extraction, throws if fewer than 7 blocks, joins `blocks.slice(2)` (index coupling: 0 = tailwind config, 1 = boot IIFE) | Teach the loader to resolve `<script src>` in document order (it already concatenates in order), or load `src/` modules into the same VM context; keep the Vue/IDB/document shims unchanged |
| `scripts/p00-characterization.test.mjs` | ~20 `assert.match(source, …)` on verbatim production code + `window.RushdMoneyInput` exposure check + order-dependent `source.slice(indexOf(A), indexOf(B))` (line 88) | Build `source` by concatenating `src/` modules in canonical order — all patterns are code text, not line numbers, so they survive extraction verbatim |
| `tests/p01-stability.test.mjs` | `readFile('index.html')` for `doesNotMatch` guards (`/monthly \/ 4/`, `/GameStore/`, `SAR Saved = 10 XP`, …) + behavioral runs via harness (`TRANSLATIONS`, mixins) | Same concatenated-source helper (absence guards stay valid; guard against false-pass by asserting the concatenation covers all modules) |
| `tests/p01-dangerous-mutations.test.mjs` | Behavioral only, via harness (`DB`/`Store` production paths) | No change if the harness loads `src/` modules |
| `scripts/browser-smoke.cjs` | Serves cwd, loads `/index.html`, drives UI via Arabic strings + selectors (`.fab`, `.modal-floating-card`, `input[placeholder="تكسي، غداء..."]`) | No selector changes were needed for mechanical externalization: the `smoke-ext.cjs` variant passed. Later SFC or layout changes still require selector review, plus base-URL/file-layout awareness for Vite dev/dist. |
| `scripts/finance-rules.test.mjs` | Imports `scripts/finance-rules.mjs` (already modular) | None |
| `p00-fixtures` / artifact guards / `verify-p00-baseline` | Pin fixture schema + `MicroSaveOS_DB` v1, evidence paths | None for P02 |

**Verdict:** no test needs a new philosophy. The smallest identified adaptation is one shared helper for concatenated production source plus a script-source-aware runtime loader; this design was not implemented in the spike. `smoke-check` markers must move deliberately. Existing browser selectors survived mechanical externalization but are not proven stable across later template or layout changes.

## 8. Migration sequencing and recommendations

### Proven facts (each browser/command-verified above)

1. Baseline is green (`npm test`, `test:browser`); Vite 5 wraps the untouched file with zero changes (§1–2).
2. The app has 2 blocking runtime CDNs (both unpinned: `unpkg/vue@3`, `cdn.tailwindcss.com`), 2 self-hostable font groups, and no other network deps (§3).
3. No Tailwind utility is constructed dynamically; all dynamic classes are custom CSS with enumerable values (§3).
4. Parser-based extraction to classic external files is lossless (byte-identical roundtrip) and passes the full behavioral smoke (§4).
5. `vite build` on classic-`src` externalized output is broken (scripts 404) — externalization and bundling must be sequenced, not combined naively (§4).
6. `Core`/constants/translations/pure helpers convert to ESM trivially; strict TS on raw code yields only annotation-level errors (20 in Core) (§5).
7. Any same-origin context can reopen `MicroSaveOS_DB` v1 with no upgrade and read all stores (§6).
8. Test coupling is concentrated in the source loader and static marker checks. A concatenated-source helper plus script-source-aware loader is the smallest identified adaptation, but it remains to be implemented and verified; current browser selectors only survived the mechanical extraction tested here (§7).

### Recommendation (labeled — for Astra to accept, modify, or reject)

Wrap → vendor → extract-pure-first → adapt-state → convert-shell → replace-Tailwind → cut-over, running `npm test` + browser smoke after every step:

1. **Wrap:** commit the Vite wrapper around the untouched file (build+serve parity gate).
2. **Vendor:** self-host `vue.global.js` (and fonts when licenses clear) as local assets; pin versions; no code change.
3. **Extract pure leaves first:** `Core`, constants, `TRANSLATIONS` (+ key-parity gate), pure money/date/validation helpers → `src/` ESM+TS with unit tests; keep the classic shell importing them via temporary bridge files.
4. **Adapt state:** formalize the harness shims as a storage interface; DB/Store behind it; no direct `indexedDB`/`localStorage` in new code.
5. **Convert the shell:** app-shell + main controller to modules/Vue SFCs (redesign step — component templates, cross-block imports, `window.*` debug-bridge decision).
6. **Replace Tailwind** with a build-time setup + dynamic-utility guard once all classes live in scanned files.
7. **Cut over** entry to the bundled build only when `vite build` output passes the same browser smoke that the inline file passes today; keep `MicroSaveOS_DB` v1 open throughout.

### Tradeoffs

- Vendoring `vue.global.js` first ships an offline win in days but keeps runtime template compilation (slower, CSP-unfriendly) until step 5; going straight to SFC-ESM is cleaner but couples the riskiest rewrite with the earliest step.
- Keeping scripts inline until module conversion (§4 failure) avoids a dead `dist/` but delays file-level ownership boundaries (P02-A2/A5); using `public/` for legacy JS unblocks `dist` early at the cost of unhashed, unbundled freight.
- Concatenated-source test helpers (§7) preserve coverage cheaply but perpetuate whole-app reads; per-module imports are better long-term but require touching every characterization assertion now.

### Unresolved questions for Astra

1. Vite major at implementation time (spike used 5.4.21 for determinism; 6/7 not swept) and SFC vs `defineComponent`-with-strings for the shell.
2. Fate of the `window.*` debug bridge (`MicroSaveStore/DB`, `RushdMoneyInput`, `TRANSLATIONS` — tests consume them today).
3. Font redistribution licenses (IBM Plex Sans Arabic / Noto Kufi Arabic / Material Symbols) for self-hosting.
4. `cat.icon` value audit (Material-Symbols coverage for all category icons).
5. Whether P02 also owns the `flexibleConsumption`/`flexibleItemRequired` English gap and the duplicate-`historicalBudgetUnknownShort` cleanup, or folds them into nearby work per the handoff note.
6. v2 database/identity direction is P04 scope — P02 must only avoid precluding it (no rename, additive schema discipline).

### Limitations of this spike

- Browser runs were Chromium-only (390×844); Firefox/WebKit, viewports, and physical devices not swept.
- Vendored-Vue and build-time-Tailwind replacements were analyzed and file-probed, not served end-to-end.
- No performance measurement (bundle parse/render deltas) and no offline/service-worker probing — P04 territory.
- `npm view` reachability assumed working network; fully-offline installs not tested.

---

*Worker provenance: GLM 5.3 Flash began the task; Muse Spark 1.3 completed most experiments and the report after the GLM allowance expired. All experiments ran in `/tmp/rushd-p02-spike` at `bfa13b33b3439090492547d406a24b55ae85a98f`; the only real-repository file created is this report. No architecture decision is presented — evidence only, for Astra's review.*
