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

Use `ACTIVE_DELIVERY_PLAN.md` for the current commit, phase, available models, expiry times, and next action. It is the single status record. Verify Git status before work; preserve existing changes. Proposals awaiting discussion are not implementation dispatches.

## Delivery rules

- Assign one coherent, substantial behavior slice to one product-source writer.
- Name the model, reasoning level, and short routing reason in every worker task.
- Draft every agent-facing prompt with the `writing-for-agents` method: lead with the outcome, disclose context through precise file pointers, order the work, and give each step a checkable completion criterion.
- Use the cheapest model that can perform the task reliably and preserve Codex capacity for Development Master continuity.
- Run tests that cover the accepted behavior and important failure boundary. Save broad matrices for integration and phase gates.
- Use an independent reviewer for expensive mistakes or subjective quality, not by default.
- Keep reviews read-only. The implementation worker owns corrections.
- Keep each task in one clear commit and leave unrelated changes out.
- Use external workers and reviewers when reliable and cheaper. Assign an exact report path under `/Users/mehmet/Desktop/Rushd/artifacts/agent-reports/`; the founder transfers a short start instruction and later says the task finished. Read its saved report directly, following Workflow Lite. Do not assume automatic notifications or cross-app messaging. Use isolated worktrees for concurrent writers and keep one integration owner.
- For a long delegated task, offer the founder Workflow Lite's unattended-worker option before launch. After explicit approval, freeze the prompt, launch one cheap writer asynchronously (CLI/API directly or a user-authorized UI through a Luna xHigh operator), hand liveness checks and bounded same-session continuation to Luna Low/Medium, notify on completion/blocker, and end the Development Master's turn instead of polling.
- Always tell the founder their exact next action. For an unattended run, that action is normally “wait for the completion/failure notification, then return here.”
- Prefer Luna Max for clear demanding tasks, Terra up to xHigh for harder intelligence-heavy work, and Sol Medium/High only when the task is legitimately hard. Never route delegated work to Terra Max or Sol Max.
- Do not push unless the founder asks.
- Preserve the master plan's full feature scope. Speed comes from better task sizing, model routing, and parallel preparation—not from cutting approved features.

## Immediate continuation

P03 is closed at reviewed product commit `291228c778d0714b343c396d2a37067f5361d8a1`. Tasks A through D satisfy P03-A1 through P03-A6. Task D's final independent review returned `ready_for_integration` after 9/9 adversarial probes, the Master reran every required P03 command and the full phase diff check successfully, and a Luna Max closure audit returned `ready_to_close`. The ignored reports are `artifacts/agent-reports/P03-D-GROK-REVIEW.md` and `P03-PHASE-CLOSURE-AUDIT.md`. No P04 work started during closure. Read `ACTIVE_DELIVERY_PLAN.md` before assigning any next phase work.

The founder subsequently reserved Astra for ambitious animations and selected design work too, including hands-on creation rather than consultation alone. Preserve the active plan's motion/design quality requirements; cheaper routine management is not permission to compromise the intended experience.

Resume the next action recorded in `ACTIVE_DELIVERY_PLAN.md`. Before ending a substantial management turn, update current status, meaningful decisions, unresolved issues, and resource changes there. Put task-specific interfaces and acceptance mapping in the relevant execution plan.

The founder wants the full approved feature set in roughly one month, not a reduced local alpha. Preserve the distinction between implementation progress and external beta/release evidence. Be candid when actual throughput or external dependencies threaten that target.

## Evidence boundary

Treat worker summaries as leads. Confirm the commit, diff, relevant tests, and important runtime behavior before closing a high-risk task. A clean tree or a claimed test result alone is not proof.

Historical P00 authority artifacts remain audit history. They are not part of ordinary P02+ development unless the founder explicitly requests a governed run.

The old phase-orchestrator skill and phase prompts also retain obsolete process and model-routing instructions. Workflow Lite and the founder's current preferences supersede those instructions. Product invariants and phase acceptance outcomes remain binding.
