# Rushd / رُشد

Arabic-first personal finance assistant for tracking expenses, budgets, goals, and spending insights.

Rushd is a Vite-built web app for students and regular users who want a simple way to understand where their money goes, especially in an Arabic RTL interface with Saudi riyal amounts. It is an active prototype and should not be treated as financial advice.

## What It Does

- Tracks planned and paid expenses with categories, expected cost, actual paid amount, and essential/luxury classification.
- Shows a dashboard for the selected day, plus monthly statistics, category summaries, weekly spending, and safe-to-spend calculations.
- Supports recurring plan templates for workdays, offdays, monthly items, and flexible expenses.
- Includes savings vault goals, month-end surplus handling, and a short vault timeline.
- Stores user data in the browser using IndexedDB, with small UI preferences in localStorage.
- Supports Arabic-first RTL UI, English language mode, Gregorian/Hijri display setting, dark/light themes, motion settings, and SAR-focused formatting.
- Includes export/import backup and factory reset actions.

## Tech Stack

P02 separates the existing UI into a modular compatibility layout:

- Thin Vite `index.html` entry plus `src/main.ts`
- Raw root/component templates and moved controller in `src/app` and `src/components`
- Legacy v1 Store, IndexedDB access, normalizers, and backup validation in `src/data/legacy-v1`
- CSS with pinned Tailwind CSS 3.4.17 utilities generated at build time
- Vue 3.5.42's local full ESM compiler build, selected through the Vite alias
- Self-hosted Google Fonts CSS and WOFF2 assets for the Arabic/Latin families plus Material Symbols Rounded
- Vite build/dev/preview shell
- IndexedDB for app data
- localStorage for preferences and deferred prompts

No server, cloud database, authentication, or model integration is implemented in this version. Assistant-like guidance is rule-based UI logic.

## Screenshots

These screenshots are captured from the current local app with default local data.

![Rushd onboarding on mobile](docs/assets/screenshots/onboarding-mobile.png)

![Rushd add expense modal on mobile](docs/assets/screenshots/add-expense-mobile.png)

![Rushd dashboard in a wide browser viewport](docs/assets/screenshots/dashboard-wide.png)

![Rushd dashboard after adding a test expense](docs/assets/screenshots/dashboard-with-expense.png)

## Run Locally

Install dependencies and start the Vite development server:

```bash
npm install
npm run dev
```

Then open `http://127.0.0.1:5173`.

Useful local checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:browser
npm run test:legacy-idb
npm run parity:self-test
npm run parity:quick
npm run parity:full
```

`npm test` checks repository structure, source coverage, translation parity and
duplicate keys, P00/P01 production behavior, local font-license safety, and
finance-rule examples. `npm run test:legacy-idb` proves the built modular app
opens and renders synthetic `MicroSaveOS_DB` v1 data without a schema upgrade.

Optional browser smoke test:

```bash
npm install
npm run test:browser
```

The browser smoke test builds first, serves `dist/`, adds a fake expense, and verifies it persists after refresh. The visual parity commands compare the built output to the pinned pre-P02 commit without committing a second screenshot archive. Full command/profile details live in [`docs/implementation/P02_BUILD_FOUNDATION.md`](docs/implementation/P02_BUILD_FOUNDATION.md).

Tailwind, fonts, icons, and Vue are local runtime assets in the built app. Font provenance, source response hashes, pinned upstream versions, and license files live under [`public/fonts`](public/fonts); the smoke/browser checks reject external runtime URLs.

## Deployment

The app is prepared for static hosting of the built `dist/` directory. A deployment workflow must run `npm run build` and publish that output; serving the repository root unchanged will not load the Vite module graph. A Pages workflow can be added later by a token/user with GitHub `workflow` permission.

## Privacy Notes

Rushd stores financial entries locally in the user's browser. It does not send data to a server in the current version. Clearing browser data, switching browsers, or using a different device can remove local data unless the user exports a backup first.

Users should avoid entering sensitive real financial data unless they understand the local storage model and have reviewed the code. See `docs/privacy-notes.md`.

## Project Status

Active prototype / in development. The P02 mechanical-split candidate is ready
for independent review; its legacy database contract, runtime templates,
temporary debug/test bridge, and router/SFC deferrals remain deliberate
compatibility boundaries. This does not add a PWA, cloud sync, accounts, AI,
remote CI execution, or production security guarantees.

## Roadmap

See `docs/roadmap.md` for the maintained roadmap. Near-term priorities include better QA coverage, screenshots, accessibility review, budget calculation tests, mobile polish, and clearer backup/restore validation.

## Contributing

See `CONTRIBUTING.md`. Please do not include real financial data, private screenshots, secrets, or personal records in issues or pull requests.

## License

MIT License. See `LICENSE`.
