# Architecture

Rushd is currently a Vite-built legacy web app whose UI and behavior still live in
`index.html`.

## Structure

- HTML template: dashboard, statistics, vault, plans, settings, modals, navigation, and profile overlay.
- CSS: design tokens, responsive layout, RTL styling, animation profiles, app shell, cards, modals, vault, plans, and statistics styles.
- JavaScript: utility functions, translations, normalization helpers, IndexedDB wrapper, reactive store, Vue components, and view methods.

The app is built with Vite. Vue 3.5.42, Tailwind CSS 3.4.17 output, font CSS/WOFF2
files, and Material Symbols Rounded are served from the repository; no runtime CDN
is required. The legacy templates and scripts remain inline until the P02
mechanical split.

## Main Screens

- Dashboard: selected-day expense list, safe-to-spend hero, date window, payment and add-expense flows.
- Statistics: budget, paid spending, remaining safe-to-spend, category breakdown, weekly spending, and flexible expense usage.
- Vault: savings balance, savings goals, month-end surplus movement, and recent vault transactions.
- Plans: recurring template profiles for workdays, offdays, monthly expenses, and flexible expense definitions.
- Settings: language, calendar, theme, motion, base allowance, safe-to-spend mode, onboarding reset, export/import, and factory reset.

## Data Flow

User actions update the reactive Vue store. Persistent app data is written through the IndexedDB wrapper. Preferences such as theme, language, calendar type, and motion setting are also mirrored in localStorage where needed for boot-time behavior.

The app recalculates statistics from stored expenses, templates, settings, vault state, and month-end settlements.

## Storage

- IndexedDB database: `MicroSaveOS_DB` kept as a legacy database name to preserve existing local data.
- Object stores: settings, templates, expenses.
- localStorage keys: boot preferences and small deferred-prompt flags.

## Current Limitations

- The single large HTML file is still hard to test and review; P02's modular split
  will move ownership boundaries without changing the legacy data contract.
- The P02 browser smoke test rejects external runtime requests and covers a
  representative capture/reload flow. Broader language, viewport, and device
  coverage remains in the parity and later UI gates.
- No cloud sync or authentication.
- No model-backed assistant integration.

## Future Architecture Improvements

The first extracted finance-rule helpers live in `scripts/finance-rules.mjs` with tests in `scripts/finance-rules.test.mjs`. They are intentionally small and mirror current app formulas while the main app still lives in `index.html`.

The browser smoke test lives in `scripts/browser-smoke.cjs`. It starts a local static server, opens Rushd with Playwright, adds a fake expense, checks persistence after refresh, and captures a populated dashboard screenshot.

A later React/Vite or Vue/Vite migration could make sense, but only after more behavior-preserving tests and screenshots exist.
