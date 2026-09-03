# P02 Technical Reconnaissance

**Prepared for:** GPT 6 Astra, ahead of P02 ("Production foundation and mechanical split") architecture and sequencing decisions.
**Prepared by:** GLM 5.3 Flash.
**Scope:** Factual map of the current implementation as of commit `bfa13b33b3439090492547d406a24b55ae85a98f` on branch `codex/rushd-rebuild-plan`. This is analysis only; no code was modified and no P02 work has started.
**Method:** Repository reading plus read-only command inspection. `npm test` was executed and passes fully at HEAD. Line references are exact at the recon commit but will drift once P02 edits `index.html`.

Legend: **[F]** = confirmed fact (verified by reading code or running commands). **[I]** = interpretation/judgment.

---

## 1. P02 contract summary (what Astra must satisfy)

From `docs/implementation/phase-plan.json:102-118`:

- **Objective:** replace the single-file delivery mechanism with a buildable modular Vue/Vite/TypeScript foundation while preserving behavior and legacy data access.
- **Allowed paths:** `index.html`, `src/**`, `public/**`, `tests/**`, `scripts/**`, `.github/workflows/**`, `package.json`, `package-lock.json`, `vite.config.*`, `tsconfig*.json`, `eslint.config.*`, `playwright.config.*`, `docs/**`, `.gitignore`.
- **Acceptance:** A1 local Vue/assets, lockfile, lint, typecheck, tests, CI, no runtime CDNs; A2 template/styles/storage/business logic no longer one 10k-line file; A3 current legitimate data opens unchanged and `MicroSaveOS_DB` naming preserved; A4 characterization screenshots/flows show no unexplained behavioral or visual drift; A5 explicit module ownership, no replacement global finance blob.
- **Required commands:** `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:browser` — none of `lint`, `typecheck`, `build` exist in `package.json:6-14` yet **[F]**; all five must exist by phase close.
- **Manual QA:** P02-M1 compare the modular build to Phase 0 baselines at the locked viewport/language/theme matrix (`docs/baseline/current/` holds `ar`/`en` light/dark PNG baselines at 390x844, 1024x1366, 1440x900 — 260 media artifacts verified by `scripts/verify-p00-baseline.mjs` **[F]**).

Relevant master-plan constraints (`docs/RUSHD_MASTER_PLAN_FINAL.md`): Vue 3 + Vite + strict TypeScript modular monolith, router with locked hierarchy (§9 Application, lines 710-723); preserve `MicroSaveOS_DB` as immutable migration input (§9 Local data, line 727); money moves to integer halalas in **P03**, not P02 (§3 Canonical amounts; `WORKFLOW_LITE.md:118` "canonical money will move toward integer halalas during domain extraction"). P02 is explicitly a **mechanical split**, not a domain rewrite — P03 owns the finance domain (`phase-plan.json:124-135`).

---

## 2. Current delivery mechanism: index.html anatomy

`index.html` is 10,915 lines / ~563 KB **[F]**. It is the only production source file. No `vite.config.*`, `tsconfig*`, or eslint config exists anywhere in the repo **[F]**. The file is composed of seven inline `<script>` blocks (no `src` attributes), two `<style>` blocks, one in-DOM Vue template, and a `<head>` with CDN links **[F]**:

| Lines | Content |
|---|---|
| 1–24 | Head, meta, Google Fonts preconnect + stylesheet (IBM Plex Sans Arabic, Noto Kufi Arabic, Inter, JetBrains Mono, Outfit, Sora), **Vue 3 from `https://unpkg.com/vue@3/dist/vue.global.js`** (line 21), **Tailwind from `https://cdn.tailwindcss.com`** (line 24) |
| 25–54 | Inline Tailwind config: custom color tokens wired to CSS variables (`--twc-*`), font families (line 26) |
| 55–78 | Boot IIFE: reads `localStorage['rushd_theme']`, `['rushd_motion']`, matchMedia, navigator.connection/deviceMemory/hardwareConcurrency; sets `documentElement.dataset.theme/motion/motionSetting`, colorScheme, meta theme-color **before first paint** |
| 83–2429 | Main `<style>` block (~2,350 lines): design tokens (Section 1, line 85), global reset (Section 2, line 269), component styles & animations (Section 3, line 315) |
| 2431–2573 | **Block 2 — `Core`**: `Core.Currency.format` (Intl `en-SA`, max 1 fraction digit, line 2441), `Core.Date` (local-civil-day ISO helpers: `toLocalISO`, `parseLocalDate`, `getTodayISO`, `addDays`, `generateWindow`, `humanize`, lines 2468-2541), `Core.UUID()` (Math.random-based v4, line 2546), `Core.Physics` (lerp/spring, line 2555). Exposed as `window.RushdCore` and legacy alias `window.MicroSaveCore` (2571-2572) |
| 2575–3146 | **Block 3 — i18n**: single `const TRANSLATIONS = { ar: {...2584}, en: {...2865} }` (~560 lines). `_locale` (`ar-SA`/`en-US`) and `_dir` (`rtl`/`ltr`) keys ride inside the dictionaries (2586-2587). Arabic is default |
| 3150–5003 | **In-DOM Vue template** inside `<div id="app" v-cloak>` (line 3153): dashboard (3157), statistics (3537), plans (3789), vault (4080), settings sections (3418/3457/3522/4205/4219), bottom nav (4251-4267), modals incl. custom confirm dialog (4963-4980) |
| 5004–7059 | **Block 4 — helpers + DB + Store**: record normalizers, money/date/profile/vault/settlement helpers, backup validator, `DB` IndexedDB wrapper (5765), reactive `Store` (6093) |
| 7060–7410 | **Block 5 — component library + app shell**: `MicroSaveApp = Vue.createApp({ setup })` created here (7071) with **no `template` option**; components `ms-icon`, `ms-btn`, `ms-swipe-item`, `ms-numpad`, `ms-stat-ring`, `ms-modal` (7083-7409) |
| 7412–8680 | Second `<style>` block (~1,270 lines): app-shell, modal, plans/vault/settings-specific styles |
| 8682–10911 | **Block 6 — root controller**: root component `data/computed/watch/methods/mounted` (8740-10824), global `showProfile` mixin (10838), `ms-profile-overlay` component with a **JS template string** (10852-10905), `MicroSaveApp.mount('#app')` (10909) |

**Critical fact — in-DOM template compilation:** the root app (7071-7080, 10820-10824) has no `template` option; Vue compiles the ~1,850-line HTML inside `#app` at runtime. The unpkg `vue.global.js` is the full build including the runtime compiler. A standard Vite + Vue SFC setup normally uses precompiled templates, although Vite can be configured to keep the compiler. P02 must choose deliberately between temporary compiler support and converting the markup to SFC `<template>` blocks. This is the largest mechanical difference between the current runtime and a conventional Vite build **[F/I]**.

**Secondary template fact:** `ms-profile-overlay` uses a JS string template (10876+), which also needs the compiler, and one unused `styles` string option exists on `ms-btn` (7130-7133) that Vue ignores **[F]**.

---

## 3. Major responsibilities currently in index.html

**[F]** (all inside the blocks mapped above):

1. **Design tokens & theming** — CSS custom properties for dark ("Nebula Dark") and light palettes, glassmorphism system, typography, spacing, z-index layers; `[data-theme]`/`[data-motion]` attribute selectors; boot-time theme/motion resolution in head IIFE (55-78) plus runtime `applyTheme`/`applyMotionProfile` in the controller (~10500-10540 writing `rushd_theme`/`rushd_motion`).
2. **i18n** — the full AR/EN dictionary; `t` computed from `this.lang` (8815); `applyLangDirection` (10760+); RTL is default document direction (`<html lang="ar" dir="rtl">`, line 2); numeric fragments wrapped in `dir="ltr"` + `unicode-bidi: isolate` in templates (e.g. 10884, 10892).
3. **Date/currency formatting** — `Core.Date` local civil-day helpers and `Core.Currency`; hijri support via `Intl` `calendar: 'islamic'` in `generateWindow` (2506) and `formatMonthKeyLabel` (9626-9640).
4. **Money parsing/normalization** — `parseMoneyInput` (5026-5055) accepts Arabic-Indic and Eastern Arabic-Thai digits, Arabic decimal/thousands separators, strict 2-decimal cap, `MAX_MONEY_INPUT = 999999999.99`; `roundMoney`/`normalizePersistedMoney` (5057-5064) as the explicitly-labeled **P01 containment** for float residue until P03 halalas.
5. **Record normalizers** — expense (5555-5570), template/flexible definition (5497-5521), profiles (5284-5320), monthly assignments (5324-5355), monthly base allowances (5359-5368), onboarding state (5370-5379), vault goals/transactions/state (5381-5452), month-end settlements (5454-5484). These silently repair malformed legacy rows on read.
6. **Backup import validation** — `validateBackupPayload` (5603-5763), strict whole-payload structural gate run before any store is touched (P1-10).
7. **IndexedDB wrapper `DB`** — see §5.
8. **Reactive `Store`** — settings state, day loading with generation counters, statistics/flexible-stats/global-stats recalculation, expense mutations, template auto-fill and plan build/apply, budget history, vault and settlement operations. See §6.
9. **Six UI components** (`ms-*`, 7083-7409) including the touch-physics `ms-swipe-item` (raw `touchstart/touchmove/touchend`, rubber-banding, long-press, `navigator.vibrate` haptics) and `ms-modal` used by every dialog.
10. **Root controller** (~2,240 lines): view switching (`currentView`: dashboard/statistics/vault/plans/settings — note vault is a current tab although AGENTS.md's locked hierarchy names Home/Plan/Ask Rushd/Insights/Goals as the *future* locked set), date scroller with retry loop (`centerDateScroller`, 9490-9509), onboarding modal flow, month-start/month-end prompt deferrals, pay/add/edit modals, plan apply preview/confirm, vault goal form, selection mode (bulk delete/mark-unpaid), custom confirm dialog (`showConfirmDialog`, 9909), toast, theme/motion/language/calendar settings, export/import/reset.
11. **Export/import/reset** — `buildBackupSnapshot` (10576: version `'3.1'`), `downloadBackupFile` via Blob + object URL anchor click (10585-10594), `importData` with FileReader → `validateBackupPayload` → confirm → atomic `DB.restoreBackupRecords` → success flag → `store.init()` (10610-10696), `resetApp` with export-first guard then `DB.factoryReset(onBlocked)` then localStorage wipe then `location.reload()` (10699-10749).

**[I]** There is no routing, service worker, manifest, PWA, auth, sync, or AI code anywhere; `Ask Rushd`, `Insights`, `Momentum`, and notifications exist only as translation strings/placeholders.

---

## 4. External runtime dependencies P02 must replace locally

**[F]** Runtime CDN/network dependencies (P02-A1 requires zero runtime CDNs):

1. `https://unpkg.com/vue@3/dist/vue.global.js` (line 21) — the entire framework.
2. `https://cdn.tailwindcss.com` (line 24) — the Tailwind **Play CDN** (a JIT-in-browser compiler, not a static stylesheet). Classes are used pervasively in the template and second style block; the inline config at 26-54 maps Tailwind color names onto the CSS-variable token system. The CDN emits a console warning that `scripts/browser-smoke.cjs:84-86` explicitly filters out — a static Tailwind build or CSS extraction will change that warning behavior (harmless, but the filter is code that will need updating).
3. Google Fonts stylesheet (lines 17-19): IBM Plex Sans Arabic (300-700), Noto Kufi Arabic (400-900), Inter, JetBrains Mono, Outfit, Sora — plus `fonts.gstatic.com` preconnect.
4. Material Symbols Rounded variable font (line 80-81) — `<ms-icon>` renders icon **ligature text** (e.g. `savings`, `check_circle`) styled by `fontVariationSettings`; without the font the raw icon words would be visible. Any local replacement must preserve ligature names or re-map all `<ms-icon name="...">` call sites.

**[I]** Font licensing must be verified before self-hosting per the master plan §8 (P05 owns final typography, but P02 must bundle *something* to satisfy "no runtime CDNs" while keeping the P02-M1 visual matrix passing — bundling the same Google Fonts families locally is the smallest visual-drift path).

---

## 5. Storage: IndexedDB and browser state

### IndexedDB **[F]**

- Database **`MicroSaveOS_DB`**, **version 1**, opened in `DB.connect` (5765-5808). The name is deliberately legacy ("Legacy database name preserved so existing local users do not lose data", 5766) and the master plan (§9, line 727) forbids renaming until verified migration. P02-A3 requires it unchanged.
- Object stores: `settings` (keyPath `key`), `templates` (keyPath `id`), `expenses` (keyPath `id`, indexes `date` and `isPaid`, 5779-5794). There is no schema evolution history; `onupgradeneeded` only creates missing stores, so the same open path serves both brand-new and years-old databases.
- All values are written through `toSerializableValue` (JSON round-trip, 5523) and through the normalizers — reads and writes normalize (e.g. `DB.saveExpense` normalizes, 5883).
- **Atomic multi-store writes** (P01/P00 outcomes that P02 must preserve behaviorally):
  - `DB.multiStoreTransaction` (5895-5916): N stores in one tx, `onabort` rejects, stale-connection `InvalidStateError` retry-once.
  - `DB.applyExpenseWritePlan` (5932-5951): plan apply commits expense deletes/puts + settings entries atomically.
  - `DB.restoreBackupRecords` (5955-5972): import commits settings+templates+expenses atomically.
  - `DB.resolveMonthEndSettlement` (5979-6062): read-modify-write of `vault` + `monthEndSettlements` inside a single readwrite tx, serialized in-process by `_settlementWriteQueue` (5769, 6060) — this is the idempotent settlement path (`alreadySettled` short-circuit at 6005; deterministic transaction id `vault-settlement-<monthKey>` at 6014).
  - `DB.factoryReset(onBlocked)` (6068-6081): `deleteDatabase` with a pending/blocked contract so a blocked reset cannot report "unchanged" and later delete.
- Single generic `DB.transaction` wrapper (5812-5838) with the same stale-retry.

### localStorage keys **[F]**

| Key | Purpose | Read | Write |
|---|---|---|---|
| `rushd_theme` | boot theme before IndexedDB loads | head IIFE 57, Store 6107, 6175 | `setTheme` ~10509 |
| `rushd_motion` | boot motion before IndexedDB loads | head IIFE 59, Store 6106/6174 | ~10538 |
| `rushd_lang` | language | 8742 | `setLang` 10753 |
| `rushd_calendar` | gregorian/hijri | 8743 | 10758 |
| `rushd_import_success` (+ legacy `microsave_import_success`) | post-import toast flag surviving `store.init()` reload semantics | 9483 | 10678, removed 9484-9485, 10686 |
| `rushd_month_start_prompt_deferred` | month-start plan prompt deferral JSON `{monthKey, dateStr}` | 9567 | 9583 |
| `rushd_month_end_prompt_deferred` | month-end settlement prompt deferral JSON | 9609 | 9624 |
| `onboardingState` | listed in the reset wipe key filter (10743) but actual onboarding state lives in IndexedDB settings (`ONBOARDING_STATE_KEY`, 5280, written at 9174) — the localStorage key is defensive only | — | — |

`resetApp` wipes every `rushd_*` / `microsave_*` key plus `onboardingState` (10739-10748). The head IIFE and Store also read `navigator.connection`, `navigator.deviceMemory`, `navigator.hardwareConcurrency`, `matchMedia`, `'ontouchstart' in window` for auto motion tiering (61-70, 10521-10528).

**[I]** The boot IIFE (55-78) and the duplicated auto-motion logic (~10515-10540) are presentation-only but must keep executing before first paint in the new shell or the P02-M1 visual matrix will show a theme flash.

---

## 6. Financial logic that must remain behaviorally stable through P02

P02 is mechanical, so these P01-corrected behaviors are the regression surface. All **[F]** with locations:

1. **Safe-to-spend:** `budget − paidSpent − unpaidEssential`, luxury unpaid items excluded from commitments (`refreshStatistics`, 6550-6681; `recalcGlobalStats` monthlyExpected same rule, 6702-6713; `Store.safeToSpend` getter returns `null` when `budgetKnown === false`, 7039-7044).
2. **Historical budget truth:** past months use the allowance snapshot recorded while the month was live (`monthlyBaseAllowances`, `getBudgetForMonth` 6318-6335); an unsnapshotted historical month yields `budgetKnown: false` / `null` values — never today's allowance (P1-03).
3. **Paid facts are immutable to planning:** plan reconciliation only mutates template-sourced, `templateProtected === false`, **unpaid** expenses (`mutableExpenseIds`, 6932-6934); everything else is a blocking match (P0-01).
4. **Atomicity/idempotency:** plan apply, import, settlement commits described in §5; settlement retry is idempotent; blocked plans (`blockedReason: 'monthlyDayMissing'`, 6898-6921) write nothing.
5. **Monthly-day validity:** monthly templates require explicit valid days 1-31. Production validation uses strict `getValidTemplateDays` (5155-5162), and generation blocks visibly until invalid legacy records are repaired (P1-06). The older fallback-capable `normalizeTemplateDays` currently has no call sites. The display-only `monthlyTemplateScheduleValid` is slightly stricter than the production helper for string values; current save/import paths prevent a reachable divergence, but P02 should align the checks rather than preserve the duplication.
6. **Historical generation blocked:** `autoFillDay` refuses dates before today (6803); plan apply range starts at `max(effectiveDate, monthStart)` (6885) — historical months are not regenerated (P1-07).
7. **Race safety:** `_loadGen` guards the whole loadDay→flexibleStats→statistics pipeline (6464-6483); `_flexibleStatsGen`/`_statisticsGen` guard independent refreshes; `_autoFillLock` prevents double auto-fill (6097-6099). These generations are load-bearing under rapid navigation.
8. **Money input:** `parseMoneyInput` Arabic-digit/separator handling (5026-5055) and the strict backup money validator `isValidBackupMoneyValue` (5577-5581); `roundMoney` is the documented P01 containment (5057-5060) that P03 will replace — do not "fix" it during P02.
9. **Local civil dates:** all user-facing dates are local civil days (`parseLocalDate`/`parseLocalCalendarDate`, 2477-2483, 5079-5084); UTC remains only for timestamps (`createdAt`, `exportedAt`); P1-01 regressions pin Riyadh-boundary behavior (`tests/p01-stability.test.mjs:28-100`).
10. **Legacy vault opening balance:** `normalizeVaultStateRecord` reconstructs `openingBalance` from `balance` minus transaction sum with an explicit legacy-source selection rule (5433-5452) — a delicate legacy-compat formula, tested via the `legacy-vault` fixture.
11. **Weekly mode removed:** any stored/imported `safeToSpendMode` normalizes to `'monthly'` (6170-6173, import at 10643-10645) (P1-05).
12. **Export schema version `'3.1'`** (`buildBackupSnapshot`, 10580) and the `validateBackupPayload` structural contract — both are fixtures-pinned (`tests/fixtures/v1/*.backup.json`, fixture test asserts `backup.version === '3.1'`, `scripts/p00-fixtures.test.mjs:25`).

---

## 7. Bilingual / RTL / styling notes P02 must not break **[F]** unless noted

- Document is RTL-first (`<html lang="ar" dir="rtl">`); language switch updates direction via `applyLangDirection` (10760+). Font switching between Latin and Arabic families is handled by Tailwind font-family config (45-50) and explicit `font-family` rules (e.g. 578).
- Numbers/currency are isolated with `dir="ltr"` + `unicode-bidi: isolate` at many template sites; `Core.Currency.format` uses locale `en-SA` deliberately.
- Hijri calendar affects the date window (`generateWindow` calendar option, 2506), month labels (9626-9640), and nothing else; date storage stays Gregorian ISO.
- `v-cloak` (3153) hides the app until Vue mounts — a Vite build changes mount timing; a FOUC here is a visible regression class.
- Two separate `<style>` blocks share the same token namespace and both are load-bearing (the second block styles the app shell and modals introduced later in development).
- Translations are one flat object with mixed English-in-Arabic entries noted by P01 review (duplicate `historicalBudgetUnknownShort` key cleanup pending per `DEVELOPMENT_MASTER_HANDOFF.md:28`); the `t` computed falls back to Arabic (8815-8817).

**[I]** The visual baseline comparison (P02-M1) makes pure refactors of CSS risky to verify manually; the cheapest safe path keeps CSS byte-identical (or trivially split) during the JS split, deferring token/typography redesign to P05.

---

## 8. Test harnesses: what exists, what it exercises, what it does not protect

### Node suite (`npm test`, all pass at HEAD **[F]**) — `package.json:7`

1. `scripts/smoke-check.mjs` — repo hygiene: required files, `index.html` string markers (`Vue.createApp`, `indexedDB.open`, `exportData`, `importData`, `factoryReset`, `<html lang="ar" dir="rtl">`), no overclaiming README language. **P02 will break this check** if those markers move out of `index.html`; the script must be updated in the same slice.
2. `scripts/finance-rules.test.mjs` + `scripts/finance-rules.mjs` — **not imported by production**; mirrors of safe-to-spend, flexible usage, vault balance. Deliberately labeled as mirrors (`docs/architecture.md:43`); per `WORKFLOW_LITE.md:44` a mirrored formula is not production proof. It protects nothing during the split; it is a smoke net only.
3. `scripts/p00-fixtures.test.mjs` — pins the sanitized v1 fixture set (`tests/fixtures/v1/{empty,populated,paid-generated,plan-edit,legacy-vault,malformed,boundary,large-history}.json` + backups), DB name/version, synthetic markers, no local paths.
4. `scripts/p00-characterization.test.mjs` — validates the P0/P1 reproduction catalog (`tests/characterization/p0-p1-cases.json`, 20 cases) and evidence files; asserts source markers for executable reproductions.
5. `tests/p01-dangerous-mutations.test.mjs` (572 lines) — **executes real production code** through the VM harness: plan apply protecting paid activity, atomic multi-store writes with injected transaction failure, malformed import rejection, settlement idempotency, etc.
6. `tests/p01-stability.test.mjs` (635 lines) — Riyadh date boundaries (spawns child processes with `TZ`), monthly allowance snapshots, budgetKnown semantics, export filename, reset flow via captured controller methods.
7. `scripts/p00-artifact-guards.test.mjs` — proves baseline normalizer refuses to overwrite P00 evidence without an env flag (writes only to a tmpdir sandbox).
8. `scripts/verify-p00-baseline.mjs` — verifies P00 commit ancestry, authority hashes, 17 fixtures, 20 reproductions, 260 media artifacts, 228 axe records.

### The VM runtime harness — `tests/harness/load-rushd-runtime.mjs` **[F]**

This is the piece P02 is most likely to break, and the piece that makes the split verifiable:

- It reads `index.html` and extracts inline scripts with the regex `/<script>([\s\S]*?)<\/script>/g` (line 16) — it requires **at least 7 inline `<script>` blocks** (line 17-19, plain `<script>` tags with no attributes) and assumes block order: 0=tailwind config, 1=boot theme, 2=Core, 3=i18n, 4=helpers+DB+Store, 5=app shell/components, 6=root controller (comment at lines 20-23; blocks 2..6 are concatenated and run in a `vm` context).
- It stubs `Vue` (createApp captured, `reactive` = identity, `computed`/`watchEffect` minimal) so the real Store is a plain reactive-looking object and the controller's `createApp` options/mixins/components are captured, not mounted (38-68).
- It provides an in-memory IndexedDB shim (`tests/harness/idb-shim.mjs`, 326 lines) with date-index getAll, blockable `deleteDatabase` with a simulated second tab, and injected write-failure control (`shim.state.failNextWriteTransaction`); a `LocalStorageShim`; document/Blob/URL/FileReader/alert/location shims capturing downloads, alerts, and reloads.
- Tests reach production code through the **window debug globals**: `window.MicroSaveStore`, `window.MicroSaveDB`, `window.RushdImportValidation`, `window.RushdMoneyInput` (index.html 7053-7057), plus the top-level `const TRANSLATIONS` read via in-context eval (load-rushd-runtime.mjs:172), and captured `appOptions.methods` for controller methods like `resetApp`/`exportData`.

### Browser smoke — `scripts/browser-smoke.cjs` **[F]**

Static server + Playwright Chromium at 390x844: asserts title `رُشد | Rushd`, skips onboarding by exact text `تخطي الآن`, clicks `.fab:visible` (exactly one), waits for `.modal-floating-card:visible`, fills `input[placeholder="تكسي، غداء..."]` and the first `input[inputmode="decimal"]` with `٤٢` (Arabic-Indic digits), clicks text `إضافة إلى اليوم`, asserts the expense text persists across reload, asserts **zero console errors/warnings/pageerrors** (after filtering the Tailwind CDN warning, 84-88), and screenshots to `test-results/browser-smoke/`.

### What is NOT protected **[F/I]**

- **No test touches the real DOM templates.** The entire 1,850-line in-DOM markup, all `v-if`/`v-model`/event wiring, the `ms-*` component templates, and the swipe/numpad physics have zero automated coverage beyond the single smoke path (add-expense happy path in Arabic only). **[F]** for coverage facts; **[I]** that this is the biggest regression risk of the split.
- No English-mode browser test; no light-theme test; no vault/plans/settings-view browser flow; no screenshot diffing (P02-A4 says "characterization screenshots" — the P00 baselines exist but nothing currently diffs against them automatically; `capture-p00-baseline.cjs` regenerates, `verify-p00-baseline.mjs` verifies hashes/attestation, not current-UI parity).
- `finance-rules.mjs` mirrors are not production imports.
- The harness's regex/block-order contract means *any* reordering, attribute addition (`<script type="module">` would also change the regex match), or consolidation of script blocks breaks it. **[I]** P02 should either migrate the harness to import real modules early in the split (preferred — it converts the harness from a delivery-mechanism dependency into a true behavior net) or keep block order stable until each block's tests are re-pointed.
- The browser smoke depends on exact Arabic placeholder strings and DOM classes (`.fab`, `.modal-floating-card`) — template extraction must preserve these or the selectors must be updated in the same commit.

---

## 9. Coupling map: natural seams vs dangerous tangles

### Natural extraction seams **[F]** for boundaries, **[I]** for seam assessment

| Candidate module | Current location | Coupling notes |
|---|---|---|
| Money/date primitives | Block 2 `Core` (2431-2573) + block-4 helpers (5012-5260) | Nearly pure; depends only on `Intl`/`Date`. Two date implementations exist (`Core.Date.parseLocalDate` and `parseLocalCalendarDate` are duplicates) — consolidation is safe but changes no behavior. |
| Normalizers + backup validator | Block 4 (5276-5763) | Pure functions; reference each other and `LEGACY_TEMPLATE_PROFILE`; no DOM/DB/Vue deps. |
| `DB` wrapper | 5765-6082 | Depends only on normalizers + `indexedDB` + `localStorage` (motion/theme fallbacks at 6106-6107 are in Store, not DB). Already exposes window globals consumed by tests. |
| i18n dictionary | 2575-3146 | Pure data. Size ~560 lines. |
| `Store` | 6093-7050 | Depends on `DB`, helpers, `Core`; `Vue.reactive/computed/watchEffect` destructured at 6091. Getter-style `safeToSpend` is consumed by the template. Race counters are internal. |
| `ms-*` components | 7060-7409 | Depend on Vue global, `ms-icon` nesting, CSS classes in both style blocks, `navigator.vibrate`. |
| View controllers / modals | Root block 8682-10911 | The tangle (below). |
| Styles | 83-2429, 7412-8680 | Two blocks, one token namespace; no build-time processing today. |

### Dangerous tangles **[F]** for facts, **[I]** for risk wording

1. **Root controller ↔ template ↔ Store.** The template binds directly to `store.*` state (e.g. `store.currentViewExpenses`, `store.flexibleStats.totalUsedBudget` inside `ms-profile-overlay`, 10881+) and to ~100 controller methods; the controller mutates `store.settings` objects directly (e.g. vault goal flow) and calls `store.recalcGlobalStats/refresh*` after its own mutations (e.g. bulk mark-unpaid, 9899-9906). There is no command boundary — extracting views without first stabilizing the Store's public surface will churn.
2. **Store double-writes after controller mutations.** Several controller paths mutate then manually refresh statistics; if module extraction changes call order, stale-statistics bugs reappear. The generation counters (§6.7) must move with the code that sets `currentViewExpenses`.
3. **The harness regex contract** (§8) couples tests to the physical block layout.
4. **Boot-time vs runtime preference resolution** is duplicated in three places (head IIFE 55-78, Store defaults 6106-6107 + 6174-6175, controller `applyTheme/applyMotionProfile` ~10500-10540) with subtly different fallback logic (e.g. head IIFE's `autoMotion` tiering vs `normalizeMotionLevel`).
5. **Duplicated date and monthly-day checks** (§6.5) — extraction should preserve current behavior first, then remove the unused fallback helper and route display validation through the production helper.
6. **CSS/Tailwind interleaving.** Layout relies on both Tailwind utility classes and hand-written CSS in two blocks, including arbitrary-value classes (`px-4 pb-[8px]`, 3161). Moving to static Tailwind requires scanning the in-DOM template plus JS string templates plus dynamic class bindings (`getVarianceStripeClass` etc., 10033-10050).
7. **`window.*` debug globals are a test API**, not just debug leftovers (7053-7057).

---

## 10. Likely regression classes during the split (factual risk inventory) **[I]**, grounded in **[F]**

- **Visual drift at mount:** compiler/runtime differences, `v-cloak` FOUC, async font loading differences, Tailwind Play CDN → static build (Class detection differences, preflight differences), mount ordering. Verified against the P00 visual matrix.
- **Behavior drift in untested flows:** everything in §8 "not protected" — edit modal, plans preview/apply UI, vault transfers UI, month-end prompts, onboarding variants, settings, selection mode, swipe gestures, hijri mode, English mode.
- **Storage regression:** any change to normalizer order, `toSerializableValue` JSON round-tripping (it strips `undefined`), or index usage (`getExpensesByDate` uses the `date` index with `IDBKeyRange.only`, 5870-5876) can silently alter what legacy users see. The VM tests cover much of this but only through the shim.
- **Test-infrastructure breakage:** harness regex/block count/order; `smoke-check.mjs` string markers; browser-smoke selectors/strings; fixture-pinned export version.
- **Race-condition resurrection:** generation counters and the settlement queue are easy to accidentally bypass when splitting async pipelines (e.g. a view that calls `refreshStatistics` without the pipeline gen).
- **i18n/RTL regressions:** translation keys live in code; splitting without keeping key parity (including the two `t` computed implementations — root at 8815 and `ms-profile-overlay` at 10873) risks missing-key fallbacks that render raw keys or Arabic defaults in English mode.

---

## 11. Factual sequencing options for Astra (with tradeoffs; no architecture selected)

These are implementation-order observations from the dependency facts above; the final architecture (SFC vs template-compiler, router timing, state layer, TS strictness rollout) is Astra's decision.

**Option A — Strangler by block, harness-first.** Sequence: (1) add Vite/TS/lint scaffolding and CI while `index.html` still works as-is (it is valid HTML a Vite app can serve); (2) migrate `load-rushd-runtime.mjs` to import extracted ES modules as they appear, keeping VM-shim semantics; (3) extract in dependency order: primitives → normalizers/validator → DB → i18n → Store → components → view controllers; (4) split templates/CSS last. *Tradeoff:* slowest first visible change, but every extraction step is verifiable by the existing 20-case regression suite plus browser smoke; the harness conversion cost is paid once, up front, and then protects every subsequent step. **[I]**

**Option B — Build-shell first (Vite + single entry importing current code verbatim).** Copy the script blocks into `src/` almost verbatim (concatenated into one entry or few files), get `npm run build`/lint/typecheck green with the in-DOM template preserved (runtime compiler or HTML transform), then modularize inside `src/`. *Tradeoff:* reaches P02-A1 (build/CDN/lockfile) quickly and de-risks the toolchain early; but P02-A2 ("no longer one 10k-line source file") and A5 are only satisfied by the follow-on work, and a verbatim copy doubles the window where fixes must land twice. **[I]**

**Option C — Domain-seam-first.** Extract the finance-adjacent pure layer (money parse, normalizers, DB, plan/settlement logic) into `src/` modules consumed by `index.html` via `<script type="module">` before introducing Vite, leaving UI in place. *Tradeoff:* highest-value tests (`tests/p01-*.test.mjs`) switch to importing real modules immediately; but module scripts change the harness's regex extraction anyway, and the UI/controller tangle — the largest actual risk — remains untouched. **[I]**

Cross-cutting facts relevant to any option **[F]**: the node harness requires `window.MicroSaveStore`/`MicroSaveDB`/`RushdImportValidation`/`RushdMoneyInput` (or a harness update); `smoke-check.mjs` requires its markers or an update; the browser smoke requires the Arabic selectors or an update; `index.html` has **no** ES-module usage today (everything is globals/top-level consts), so introducing modules changes scope semantics (top-level `const` in blocks currently share one global lexical scope — e.g. block 6 uses `TRANSLATIONS`, `DB`, `parseMoneyInput`, `normalize*` declared in earlier blocks; extraction must make these explicit imports or parameters).

**[F]** A practical fact in favor of early harness conversion: `load-rushd-runtime.mjs` already treats production code as the API under test (it never duplicates formulas), so pointing it at real modules is a mechanical change to the loader, not to the ~1,200 lines of tests.

---

## 12. Open questions / uncertainties not resolvable from the repository

1. **TypeScript strictness rollout:** the master plan requires "strict TypeScript for new code" (P02, master plan line 890) but says nothing about converting the split JS. Whether P02 should typecheck only new glue (with the extracted JS as loose `.js` or `allowJs`) or fully type the extracted code is a scope decision with large effort implications. **[I]**
2. **Router in P02 or P05?** P02 says "router shell" in the master plan (line 891), but the phase-plan P02 acceptance criteria never mention routes; P04-A7 owns URL persistence and P05 owns the locked shell. Whether Astra adds vue-router in P02 is ambiguous between the two documents.
3. **Vault as a nav tab:** the current app has five tabs (dashboard/statistics/vault/plans/settings) while the locked future hierarchy is Home/Plan/Ask Rushd/Insights/Goals. P02 must obviously preserve current behavior (P02-M1), so no action — noted only because the two navigations differ and later phases will reconcile them.
4. **CI reality:** no `.github/workflows/**` exists in the repo **[F]**; P02-A1 requires CI. Whether the founder's GitHub remote/push policy (nothing has been pushed, `DEVELOPMENT_MASTER_HANDOFF.md:29`) allows enabling CI before any push is a founder-process question, not a code question.
5. **Tailwind disposition:** keep utility classes with a static build, or migrate to the design-token CSS only. The current markup's dependence on arbitrary-value utilities makes full de-Tailwind-ing a large visual-risk surface; no test protects it. This is a real architecture fork for P05 as well.
6. **Fixture `large-history` performance envelope:** `refreshStatistics`/`recalcGlobalStats`/`buildTemplateApplyPlan` all call `DB.getAllExpenses()` and scan everything (6571, 6685, 6923). The P00 performance baseline exists (`docs/baseline/current/playwright-performance.json`), but the repository gives no explicit budget for P02 to preserve beyond "no unexplained drift".
7. **The `styles:` string on `ms-btn` (7130) and other dead code:** presumed inert, but a full dead-code inventory was not performed; extraction may surface more (e.g. `seedTemplates` at 6765 is unreachable from the current UI — seed cleanup happens on load instead, 6190-6198). **[I]** on intent.
8. **`Core.UUID()` uses `Math.random`, not `crypto.randomUUID`** (2546-2551). Master plan requires "stable UUIDs" eventually (line 754). Replacing the generator in P02 would change ID bytes for new records — behavior-preserving question for Astra (P03 will need this anyway).

---

## 13. Verification footprint left by this recon

- `npm test` executed at HEAD: all eight suites pass (output: smoke, finance rules, P00 fixtures, P00 characterization, P01 dangerous-mutations, P01 stability, artifact guards, baseline verification).
- Browser smoke was **not** run during recon (requires Playwright browser launch and writes `test-results/` artifacts); its selectors and behavior were established by reading `scripts/browser-smoke.cjs`.
- No production or configuration file was modified; nothing was staged, committed, or pushed. At task completion this document was the worker's only change; a separate feasibility-spike report was created afterward by another task.
