# AGENTS.md

## Project Overview

Rushd / رُشد is a bilingual personal-finance assistant for younger people managing one dominant spending pool. The current app is a static single-file Vue 3 prototype in `index.html`. The approved destination is an offline-capable, account-synced PWA with deterministic financial logic, deeply integrated AI, and a premium Arabic/English experience.

## Source Of Truth

The repository entry point is `index.html`.

Product and implementation authority, in order:

1. `docs/RUSHD_MASTER_PLAN_FINAL.md`
2. `docs/implementation/phase-plan.json`
3. `docs/RUSHD_EXECUTION_PROTOCOL.md`
4. This file

The July `docs/RUSHD_MASTER_PLAN.md` and August founder discussion/feedback files are preserved decision history. They are superseded wherever the final master plan differs.

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

Run the optional browser smoke test after installing dependencies:

```bash
npm install
npm run test:browser
```

Manual QA checklist lives in `docs/manual-qa.md`.

## Important Files

- `index.html`: the app UI, styles, Vue components, storage wrapper, and business logic.
- `README.md`: reviewer-facing project overview.
- `docs/architecture.md`: app structure and data flow.
- `docs/data-model.md`: implemented and planned entities.
- `docs/privacy-notes.md`: finance-data privacy notes.
- `scripts/smoke-check.mjs`: static repository smoke check.
- `scripts/finance-rules.mjs`: first extracted finance-rule helpers.
- `scripts/browser-smoke.cjs`: optional Playwright browser smoke test.
- `docs/RUSHD_FINAL_FOUNDER_BRIEF.md`: concise approved product description.
- `docs/RUSHD_MASTER_PLAN_FINAL.md`: canonical product and technical contract.
- `docs/implementation/phase-plan.json`: machine-readable phases and acceptance gates.
- `docs/RUSHD_EXECUTION_PROTOCOL.md`: manager/worker/reviewer state machine.
- `.agents/skills/rushd-phase-orchestrator/SKILL.md`: reusable phase orchestration workflow.
- `.agents/skills/rushd-motion-lab/SKILL.md`: Rushd-specific signature-motion prototype and verification loop.

## Coding Guidelines

Keep migration changes conservative and phase-bounded. Protect the current data and characterized behavior before restructuring; do not preserve a known bug as the final product. Refactor the single HTML file only through the approved phase gates and browser/data checks.

Arabic and English are equal-quality launch languages. Preserve the current Arabic fonts subject to license verification. Preserve RTL layout, use `dir="ltr"`, `bdi`, or `unicode-bidi: isolate` for numeric/currency fragments when needed, and design English/LTR intentionally rather than as an afterthought.

Financial calculations should be explicit and testable. Do not silently change budget, safe-to-spend, vault, or recurring-template behavior without documenting the reason and testing realistic edge cases.

## Privacy Rules

Do not commit secrets, API keys, `.env` files, real financial data, personal screenshots, or user records. Demo data must be clearly fake. Rushd currently stores app data in IndexedDB and preferences in localStorage.

## What Not To Change Casually

- Do not rename the IndexedDB database without a migration plan; the legacy name is preserved to avoid data loss.
- Do not remove export/import or reset flows without replacing them.
- Do not claim model integration, cloud sync, authentication, or production security unless implemented.
- Do not add heavy frameworks unless the user accepts a migration plan.
- Do not change the locked permanent hierarchy: Home, Plan, Ask Rushd, Insights, Goals. Transactions remains a secondary full-history screen from Home.
- Do not reward spending amount, underspending, wealth, transaction count, or app opens in Momentum.
- Do not let AI write canonical finance data directly; it must use typed proposals and the deterministic command/action layer.
- Do not claim PWA, sync, account, AI, security, backup, residency, or release readiness until its phase gate has passed.

## Future Agent Workflow

Read the final plan and exact phase record, inspect the relevant code, run the current baseline, then edit only phase-owned paths. Use the `rushd-phase-orchestrator` skill for implementation phases. Every phase requires a structured checkpoint and fresh independent review; only one write-capable agent works at a time. For substantial changes, update docs and the manual QA checklist in the same phase commit.
