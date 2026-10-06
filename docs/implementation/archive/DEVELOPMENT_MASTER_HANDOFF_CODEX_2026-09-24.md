# Rushd Development Master handoff

## Current override — 24 September 2026

The older D3/D4/D5 narrative and `Immediate continuation` section below are
historical. Do not resume them literally. Work only in
`/Users/mehmet/Desktop/Rushd-P04D-Restart`; `/Users/mehmet/Desktop/Rushd` is
the rejected forensic checkout. Read `ACTIVE_DELIVERY_PLAN.md` for the current
status and founder decisions.

P04-D5 is open on uncommitted base `9a3267b`. The isolated stable test origin
`https://rushd-p04d5-device-gate.vercel.app/` now serves reviewed font subset
and v4 service-worker candidate, deployment
`dpl_2PKp8cCzPNN3YmK7Vizp4zgTzJzC`; its exact report is
`artifacts/agent-reports/P04-FONT-V4-ISOLATED-GATE.md`. No dogfood or
production update. The founder reports the short current-build iPhone test
passed, including icons, offline fake writes, no-export reset, and restore;
see `artifacts/agent-reports/P04-D5-IPHONE-V4-FOUNDER-REPORT.md`. The USB-connected
A55 passed v2-to-v4 update, tab-scoped offline read/write/reload, and two-tab
checks without touching its hotspot; report `artifacts/agent-reports/P04-D5-A55-V4-DEVICE-GATE.md`.
On 24 September the founder confirmed all isolated A55 data is disposable and
reported the remaining hands-on test worked perfectly. The private-use phone
checkpoint is complete by founder report, not independent step-by-step proof.
iPadOS and unsafe
storage-failure probes are explicitly deferred/NOT_TESTED. Do not claim full
P04 acceptance. The founder deferred P04-A7 URL routes/shortcuts and approved
an early visible P05/P06 slice after the phone safety checkpoint. Ask before
a consequential visual/core-interaction direction or publication. The idle
heartbeat is paused. Do not start another idle poller.

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

P04-D rollback is complete and independently verified live. The authoritative
worktree is `/Users/mehmet/Desktop/Rushd-P04D-Restart`, branch
`codex/p04d-restart`, at rollback status commit `e01e335` on accepted P04-C base
`4f48b6f`. The rejected P04-D checkout remains preserved in
`/Users/mehmet/Desktop/Rushd` for forensics only; do not merge it wholesale.

The founder authorized a compatibility-first P04-D restart on 12 September.
Read `P04_D_RESTART_ARCHITECTURE.md`, `P04_D_RESTART_PLAN.md`, and the active D2 card.
The chosen design keeps `createLegacyApplication` mounted, migrates behavior
behind feature ports, and holds production on the legacy port set until one
reviewed authority cutover. Task D1 is integrated at `f15900b`; its independent
Cursor Grok 4.6 High review returned `ready_for_integration` after reproducing
all gates. D2 is integrated at `f193fdc` after Muse implementation and a green
Cursor Grok 4.6 High review. The initial D3 review returned `needs_changes` for
unstable lost-ack retry IDs plus truthful candidate-control/classification gaps.
The same Muse session corrected all five findings and reran every gate. The
focused Grok High re-review closed findings 1–4 but found one remaining
automatic service-worker epoch hole. P05 and publication remain stopped.

D3 is integrated at `877eb27`. D4 is integrated at `82d3262` after Cursor Grok
4.6 High correction and independent Muse Spark 1.3 xHigh adjudication. The
founder inspected and accepted seven remaining strict P00 pixel deviations that
represent canonical data truth rather than UI damage; the comparator was not
weakened. All functional/data/PWA/browser gates and `parity:self-test` pass.
Read `artifacts/agent-reports/P04-D4.md` for the compact evidence. D5 physical
device persistence, install/update, offline, locking, and backup/restore is the
next step. Do not claim P04 closure, deploy, use real financial data, or start
P05 before D5 passes.

## Delivery rules

- Assign one coherent, substantial behavior slice to one product-source writer.
- Name the model, reasoning level, and short routing reason in every worker task.
- Draft every agent-facing prompt with the `writing-for-agents` method: lead with the outcome, disclose context through precise file pointers, order the work, and give each step a checkable completion criterion.
- Use the cheapest model that can perform the task reliably and preserve Codex capacity for Development Master continuity.
- Run tests that cover the accepted behavior and important failure boundary. Save broad matrices for integration and phase gates.
- Use an independent reviewer for expensive mistakes or subjective quality, not by default.
- Keep reviews read-only. The implementation worker owns corrections.
- Keep each task in one clear commit and leave unrelated changes out.
- Use external workers and reviewers when reliable and cheaper. Assign an exact report path under `/Users/mehmet/Desktop/Rushd-P04D-Restart/agent-reports/`; the founder transfers a short start instruction and later says the task finished. Read its saved report directly, following Workflow Lite. Do not assume automatic notifications or cross-app messaging. Use isolated worktrees for concurrent writers and keep one integration owner.
- For a long delegated task, offer the founder Workflow Lite's unattended-worker option before launch. After explicit approval, freeze the prompt, launch one cheap writer asynchronously (CLI/API directly or a user-authorized UI through a Luna xHigh operator), hand liveness checks and bounded same-session continuation to Luna Low/Medium, notify on completion/blocker, and end the Development Master's turn instead of polling.
- Always tell the founder their exact next action. For an unattended run, that action is normally “wait for the completion/failure notification, then return here.”
- Prefer Luna Max for clear demanding tasks, Terra up to xHigh for harder intelligence-heavy work, and Sol Medium/High only when the task is legitimately hard. Never route delegated work to Terra Max or Sol Max.
- Do not push unless the founder asks.
- Preserve the master plan's full feature scope. Speed comes from better task sizing, model routing, and parallel preparation—not from cutting approved features.

## Immediate continuation

Task D4 is the immediate continuation. Its prompt is
`docs/implementation/P04_D_TASK_D4_PROMPT.md`; expected result is
`artifacts/agent-reports/P04-D4.md`. Do not run package installs, web research,
or remote commands. On completion, use one different-family read-only review
before integration. Gemini 3.8 Flash through Anti-gravity remains available
only if its UI traffic is justified. Tell the founder before using Astra and
stay at Low or Medium. Do not start D5/P05, deploy, or push.

P03 is closed at reviewed product commit `291228c778d0714b343c396d2a37067f5361d8a1`. Tasks A through D satisfy P03-A1 through P03-A6. Task D's final independent review returned `ready_for_integration` after 9/9 adversarial probes, the Master reran every required P03 command and the full phase diff check successfully, and a Luna Max closure audit returned `ready_to_close`. The ignored reports are `artifacts/agent-reports/P03-D-GROK-REVIEW.md` and `P03-PHASE-CLOSURE-AUDIT.md`. No P04 work started during closure. Read `ACTIVE_DELIVERY_PLAN.md` before assigning any next phase work.

The founder subsequently reserved Astra for ambitious animations and selected design work too, including hands-on creation rather than consultation alone. Preserve the active plan's motion/design quality requirements; cheaper routine management is not permission to compromise the intended experience.

Founder routing update, 13 September: maximize the free Muse Spark route and
choose High, xHigh, or Max upfront from task breadth, ambiguity, and risk rather
than mechanically starting at High. Escalate the same bounded session later
only when the initial assessment proves insufficient and OpenCode exposes that
free effort. Reserve the
founder's approximately USD 16 of Fable 5.1 for consequential UI design and
motion taste rather than routine code. Use GPT Image 2.5 through ChatGPT.com
freely for UI concepts, alternate compositions, and animation keyframes so
Fable/Astra time is spent refining the strongest directions. Images remain
ideation, not implementation or quality proof. Design and animation are the
founder's highest creative priority; use Motion Lab and verify ambitious motion
in the running bilingual app with Reduced Motion, interruption, accessibility,
and performance safeguards intact.

Resume the next action recorded in `ACTIVE_DELIVERY_PLAN.md`. Before ending a substantial management turn, update current status, meaningful decisions, unresolved issues, and resource changes there. Put task-specific interfaces and acceptance mapping in the relevant execution plan.

The founder wants the full approved feature set in roughly one month, not a reduced local alpha. Preserve the distinction between implementation progress and external beta/release evidence. Be candid when actual throughput or external dependencies threaten that target.

## Evidence boundary

Treat worker summaries as leads. Confirm the commit, diff, relevant tests, and important runtime behavior before closing a high-risk task. A clean tree or a claimed test result alone is not proof.

Historical P00 authority artifacts remain audit history. They are not part of ordinary P02+ development unless the founder explicitly requests a governed run.

The old phase-orchestrator skill and phase prompts also retain obsolete process and model-routing instructions. Workflow Lite and the founder's current preferences supersede those instructions. Product invariants and phase acceptance outcomes remain binding.
