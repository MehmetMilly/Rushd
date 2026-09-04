# Architecture

Rushd is a Vite-built modular Vue 3 legacy application. P02 preserves the
runtime-template UI and IndexedDB v1 behavior while making ownership explicit.

## Structure

- `index.html`: metadata, local font links, the pre-paint preference boot, the
  static cinema wrapper/backdrop plus empty `#app` host, and the module entry
  only.
- `src/main.ts`: composition root. It imports ordered CSS and the raw root
  template, creates the app, installs the temporary bridge, and mounts it.
- `src/app/`: root template/controller plus bilingual translations/contracts.
- `src/components/`: one runtime-template file for every legacy component.
- `src/application/`: bootstrap and the narrow debug/test bridge.
- `src/data/legacy-v1/`: record contracts, normalizers, IndexedDB wrapper,
  backup validation, and the reactive Store compatibility code.
- `src/shared/`: Core utilities and strict TypeScript shared contracts.
- `src/styles/`: the two original CSS regions in cascade order, with Tailwind
  between them.

The app is built with Vite. `vite.config.mjs` aliases `vue` to the full
`vue.esm-bundler.js` build because the moved root and component strings still
compile at runtime. Vue 3.5.42, Tailwind CSS 3.4.17 output, fonts, and Material
Symbols Rounded are local. There is no runtime CDN.

## Main Screens

- Dashboard: selected-day expense list, safe-to-spend hero, date window, payment and add-expense flows.
- Statistics: budget, paid spending, remaining safe-to-spend, category breakdown, weekly spending, and flexible expense usage.
- Vault: savings balance, savings goals, month-end surplus movement, and recent vault transactions.
- Plans: recurring template profiles for workdays, offdays, monthly expenses, and flexible expense definitions.
- Settings: language, calendar, theme, motion, base allowance, safe-to-spend mode, onboarding reset, export/import, and factory reset.

## Data Flow

`main.ts` creates the legacy data runtime with browser dependencies, registers
components and controller mixins, and mounts the raw template. User actions
update its reactive Store. Persistent writes use the IndexedDB wrapper.
Preferences such as theme, language, calendar type, and motion setting remain
mirrored in localStorage where boot behavior needs them.

The app recalculates statistics from stored expenses, templates, settings, vault state, and month-end settlements.

## Storage

- IndexedDB database: `MicroSaveOS_DB`, version `1`, unchanged as the legacy
  database name and schema input.
- Object stores: `settings` (`key`), `templates` (`id`), and `expenses` (`id`,
  with `date` and `isPaid` indexes).
- localStorage keys: boot preferences and small deferred-prompt flags.

## Current Limitations

- The temporary `window.MicroSave*`/`window.Rushd*` debug/test bridge remains
  for local tools and P01 production-path tests. Its sole mounted-app accessor
  is `window.RushdDebug.getAppProxy()`; P04 owns retiring it.
- Runtime string templates and the full Vue compiler remain until P05/P06.
  vue-router is deferred with persistent URL work to P04/P05.
- The P02 browser smoke test rejects external runtime requests and covers a
  representative capture/reload flow. Broader language, viewport, and device
  coverage remains in the parity and later UI gates.
- No cloud sync or authentication.
- No model-backed assistant integration.

## Future Architecture Improvements

The first extracted finance-rule helpers live in `scripts/finance-rules.mjs` with tests in `scripts/finance-rules.test.mjs`. They intentionally mirror the legacy formulas while P03 owns the finance domain.

The browser smoke test lives in `scripts/browser-smoke.cjs`. It starts a local static server, opens Rushd with Playwright, adds a fake expense, checks persistence after refresh, and captures a populated dashboard screenshot.

`npm run test:legacy-idb` seeds synthetic v1 data before the built app loads. It
proves the production module path reopens it at version 1 without an upgrade and
renders the seeded expense. P02 does not add a PWA, cloud sync, authentication,
model integration, or production-security claim.
