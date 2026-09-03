# Rushd Development Master handoff

Use this file when a new Development Master task needs the current execution context. Load the source documents it points to instead of relying on copied prompts or old chat transcripts.

## Role

The Development Master owns technical direction, task boundaries, model routing, integration, and risk-based verification. The founder owns product intent and the external decisions listed in `ACTIVE_DELIVERY_PLAN.md`.

Keep explanations to the founder simple and focused. Make routine technical decisions without asking for approval. Ask only when a real product, provider, legal, publication, or paid-service decision requires the founder.

## Read order

1. `AGENTS.md`
2. `docs/RUSHD_MASTER_PLAN_FINAL.md`
3. `docs/implementation/phase-plan.json`
4. `WORKFLOW_LITE.md`
5. `docs/implementation/ACTIVE_DELIVERY_PLAN.md`
6. The relevant implementation and tests for the current task

The final master plan defines product scope. The phase plan defines acceptance outcomes. Workflow Lite defines how work is delivered. The active delivery plan records the current phase and model strategy.

## Current position

- Branch: `codex/rushd-rebuild-plan`
- P00 is closed; keep its useful fixtures, baselines, and regressions.
- P01 is closed at reviewed product commit `075317ebebd1aa4f366a2ac6fd3f715f748d54fe`.
- P01's final independent Muse Spark 1.3 xHigh review found no blocking issue. Repository, P01, browser-smoke, and focused production-path checks passed.
- Two harmless cleanup notes may be folded into nearby work: remove the duplicate English `historicalBudgetUnknownShort` translation key and align the display-only monthly-day validity check with the production helper.
- Nothing has been pushed.
- The next product phase is P02.

## Delivery rules

- Assign one coherent, substantial behavior slice to one product-source writer.
- Name the model, reasoning level, and short routing reason in every worker task.
- Use the cheapest model that can perform the task reliably and preserve Codex capacity for Development Master continuity.
- Run tests that cover the accepted behavior and important failure boundary. Save broad matrices for integration and phase gates.
- Use an independent reviewer for expensive mistakes or subjective quality, not by default.
- Keep reviews read-only. The implementation worker owns corrections.
- Keep each task in one clear commit and leave unrelated changes out.
- Do not push unless the founder asks.
- Preserve the master plan's full feature scope. Speed comes from better task sizing, model routing, and parallel preparation—not from cutting approved features.

## Immediate continuation

If GPT 6 Astra is available, begin with `ASTRA_P02_REVIEW_PACKET.md` and use it once for the bounded acceleration and dependency review described in `ACTIVE_DELIVERY_PLAN.md`. Ask it to improve sequencing, task boundaries, safe overlap, and schedule risk without reducing scope or recreating governance ceremony.

Then define P02 as a small number of substantial implementation tasks. Keep P02's module boundaries stable enough for P03 finance-domain work and later parallel preparation. Give each worker only the files and acceptance criteria needed for its task.

If Astra is unavailable, the Development Master should inspect the P02 contract, current architecture, and test seams, then prepare the first P02 task directly. Do not pause delivery for a future model release.

## Evidence boundary

Treat worker summaries as leads. Confirm the commit, diff, relevant tests, and important runtime behavior before closing a high-risk task. A clean tree or a claimed test result alone is not proof.

Historical P00 authority artifacts remain audit history. They are not part of ordinary P02+ development unless the founder explicitly requests a governed run.
