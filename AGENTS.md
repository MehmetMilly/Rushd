# AGENTS.md

## Project Overview

Rushd / رُشد is an Arabic-first personal finance assistant. The current app is a static single-file Vue 3 prototype in `index.html`, focused on expenses, plans, budgets, savings goals, and spending insights.

## Source Of Truth

The repository entry point is `index.html`.

Historical migration note for this local workspace: the latest version used to update this repository originally came from:

`C:\Users\mehme\Desktop\Rushd\Rushd 3.1.html`

Do not edit or delete that local historical file unless the user explicitly asks. Future public work should treat committed repository files as the source of truth.

## Run And Validate

Serve locally with:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

Run the lightweight repository and finance-rule checks:

```bash
npm test
```

Manual QA checklist lives in `docs/manual-qa.md`.

## Important Files

- `index.html`: the app UI, styles, Vue components, storage wrapper, and business logic.
- `README.md`: reviewer-facing project overview.
- `docs/architecture.md`: app structure and data flow.
- `docs/data-model.md`: implemented and planned entities.
- `docs/privacy-notes.md`: finance-data privacy notes.
- `scripts/smoke-check.mjs`: static repository smoke check.

## Coding Guidelines

Keep changes conservative. Preserve the current UI and behavior before restructuring. If you refactor the single HTML file, do it in small steps with browser checks after each step.

Arabic is the primary UX language. Preserve RTL layout, use `dir="ltr"` or `unicode-bidi: isolate` for numeric/currency fragments when needed, and avoid mixing English labels into Arabic views unless the app already supports that mode.

Financial calculations should be explicit and testable. Do not silently change budget, safe-to-spend, vault, or recurring-template behavior without documenting the reason and testing realistic edge cases.

## Privacy Rules

Do not commit secrets, API keys, `.env` files, real financial data, personal screenshots, or user records. Demo data must be clearly fake. Rushd currently stores app data in IndexedDB and preferences in localStorage.

## What Not To Change Casually

- Do not rename the IndexedDB database without a migration plan; the legacy name is preserved to avoid data loss.
- Do not remove export/import or reset flows without replacing them.
- Do not claim model integration, cloud sync, authentication, or production security unless implemented.
- Do not add heavy frameworks unless the user accepts a migration plan.

## Future Agent Workflow

Inspect `index.html`, run `npm test`, serve the app, perform the manual QA flow, then edit. For substantial changes, update docs and the manual QA checklist in the same branch.
