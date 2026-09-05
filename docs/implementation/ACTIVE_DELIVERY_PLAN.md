# Rushd active delivery plan

**Updated:** 5 September 2026

This file records the current delivery position and resource strategy. It does not replace the product contract in `docs/RUSHD_MASTER_PLAN_FINAL.md`, the phase outcomes in `docs/implementation/phase-plan.json`, or the working method in `WORKFLOW_LITE.md`.

## Goal

Build the full Rushd feature set described by the final master plan. The founder does not want a reduced local-alpha scope.

The working target is a feature-complete build ready for private founder use within one month. Public-release validation is a later finish line because P13 requires at least four weeks of real beta evidence plus external legal and operational work. This separates calendar validation from implementation without removing product features.

## Current position

- Branch: `codex/rushd-rebuild-plan`
- P02 closure commit: `f80cfc9`, following reviewed product work through `4c88443` and documentation correction `5680c3f`. Working tree was clean at the start of Astra's assessment.
- P00 is closed. Its fixtures, visual baseline, and characterization tests remain useful; its old receipt and authority process is retired for ordinary work.
- P01 Task 1 stopped dangerous financial mutations.
- P01 Task 2 restored truthful available-money behavior.
- A follow-up correction closed independently reproduced import, settlement, reset, decimal, and IndexedDB test-harness defects. A fresh Sol review returned PASS.
- P01 Task 3 and its corrections close the remaining local-date, historical-budget, weekly-pace, scheduling, assignment, stale-state, mock-analytics, and harmful-gamification problems. The final commit `075317e` passed an independent Muse Spark 1.3 xHigh production-path review with no blocking findings.
- P01 is closed. The duplicate English translation key was addressed in P02. The display-only monthly-day check remains a nearby cleanup candidate when that UI is changed.
- P02 is closed. The app now has a Vite build, local runtime assets, owned modules, strict checks for new glue, preserved `MicroSaveOS_DB` v1 data, and verified visual parity apart from six documented English translation corrections.
- P03 implementation has not started. The founder agreed to `P03_EXECUTION_PLAN.md`; Task A's ready-to-send prompt is `P03_TASK_A_PROMPT.md`. Its Reality Check decision uses the full tracked-pool amount, with Rushd deducting reservations and goal allocations.

## Working method

- GPT-6 Astra is now the Development Master. It owns task design, technical direction, integration, and risk-based verification. Delegate code exploration, implementation, testing, and review when cheaper agents can deliver reliably.
- Each implementation task has one product-source writer and one coherent commit.
- Tasks should be large enough to deliver a real behavior or capability, but small enough to review as one idea.
- Workers receive compact repository pointers and acceptance criteria, not this chat history or the retired governance corpus.
- The cheapest model that can perform a task reliably should get the task.
- Every task card names the model, reasoning level, and a short reason for that choice. The founder may override the choice when limits or availability change.
- Preserve Codex capacity for Development Master continuity. External models should handle most implementation, testing, and routine independent review when they can do so reliably.
- High-consequence finance, migration, sync, security, AI-write, release, and major visual work receives independent review. Ordinary low-risk changes receive direct Master review. Sol High is not the automatic reviewer for every high-risk task.
- When practical, worker and reviewer come from different model families.
- External workers usually report through the founder. Do not assume cross-app messaging. Use isolated worktrees for concurrent writers, return corrections to the original worker, and integrate dependencies before starting dependent work.
- Tests cover production behavior and the important failure boundary. Full matrices run at integration or phase gates rather than after every small edit.
- No receipt ceremony, patch manifest, lifecycle transcript, or manual state transition is part of normal development.

## Model routing

Routing changes when pricing, resets, free windows, or model availability changes. The founder will report those changes and the Development Master will adjust upcoming work.

Current founder-reported window: **300M GLM 5.3 Flash literal tokens until 6 September 2026 at 18:00 Asia/Riyadh**, interpreting "tomorrow" from the 5 September message. Cached input counts. Recheck availability on resumption; expiry is not extended by this document. Grok 4.6's Cursor Pro capacity is substantially better than previously assumed, so use it for more substantial implementation and review. These are resource reports, not independently verified provider claims.

- **GPT 6 Astra:** Development Master, architecture, task design, and difficult integration decisions. Preserve its capacity by delegating routine implementation and checking.
- **GPT 5.6 Sol:** difficult diagnosis, unresolved technical disputes, and integration support. Medium for bounded substantial review; High for architecture-critical disputes or severe recovery. Do not use Max.
- **GPT 5.6 Terra:** harder implementation and review that needs a higher tier of intelligence. Choose Medium, High, or xHigh from task risk; do not use Max.
- **GPT 5.6 Luna:** default Codex worker for clear, well-defined implementation, testing, fixtures, mechanical migration, and focused review. Prefer Max when task breadth or integration risk benefits from deeper checking; use xHigh when Max is unnecessary.
- **GLM 5.3 Flash:** large bounded implementation or test work during temporary free-token windows. Its free pool is a literal token allowance including cached input and may expire within 10 to 12 hours, so use one compact task context and avoid repeated large-history loading. Prioritize it while a short free window is active.
- **Muse Spark 1.3:** near-zero-cost external worker and reviewer for well-defined implementation and testing. Start with bounded tasks, then expand its role if repository results and independent reviews remain strong. Use High for normal multi-file work and xHigh for difficult logic, finance/data review, or broad integration.
- **Gemini 3.8 Flash:** fallback for straightforward, tightly specified work that needs many tokens and has deterministic validation. Do not use it for ambiguous implementation, architecture, finance decisions, or final review. Its benchmark strength does not outweigh weak results on real Rushd tasks.
- **Claude Opus 4.6:** product writing, bilingual copy critique, founder-facing explanations, and qualitative review.
- **Grok 4.6 through Cursor:** preferred external route for harder implementation and independent finance review. Use High for clear multi-file work and the highest exposed setting for difficult reconciliation/concurrency review. Do not assume Cursor exposes xHigh; report the actual selected setting. Do not pause current work for a future release.

## Reasoning levels

Choose reasoning from task shape rather than model prestige:

- **Low:** exact mechanical edits with a deterministic formatter, compiler, schema, or snapshot check.
- **Medium:** narrow implementation or test work with one clear code path and limited edge cases.
- **High:** normal multi-file product work, debugging, migrations, financial behavior, or tasks with several interacting requirements.
- **xHigh:** architecture, unclear root causes, concurrency, sync conflicts, difficult integration, or reviews where missing one interaction would be costly.
- **Maximum tiers:** Luna Max is allowed for demanding, clearly bounded work. Terra Max and Sol Max are excluded; High or xHigh is their normal ceiling.

Weak or unfamiliar models may need a higher reasoning level for the same task. A higher tier is useful only when it improves decisions; it should not compensate for an unsuitable model or an unclear prompt.

If an external app does not expose the suggested setting, use its highest suitable available setting and report it. Each prompt still states the desired reasoning depth and why.

## Acceleration plan

1. P01 is closed at reviewed commit `075317e`.
2. P02 is closed at `f80cfc9`.
3. P03's execution plan is agreed. Deliver `P03_TASK_A_PROMPT.md` to GLM, then inspect its result before assigning dependent work.
4. Keep the remaining foundation spine sequential: P03 finance domain, then P04 local data and PWA.
5. After P02 creates stable module boundaries, allow at most two isolated product writers. Start design foundations, provider preparation, AI schemas, eval assets, and release preparation early when they do not depend on unfinished production interfaces.
6. Integrate through the Development Master. Use short-lived branches or isolated worktrees for parallel writers and keep one integration owner.
7. Treat P01 through P11 as the full feature build. P12 is integrated hardening and release-candidate work. P13 is real-world beta and public-release validation.

## Next action and continuity

The founder should open `/Users/mehmet/Desktop/Rushd` in the external coding app and give a fresh GLM 5.3 Flash chat `P03_TASK_A_PROMPT.md`, using High if available. Task A is prepared, not confirmed running. On receiving its report, inspect the actual diff and command API before dispatching B. Keep broad independent finance review at the A–C integration point; bring forward a focused check only for an unresolved foundational concern. P02 research is historical context; the implemented architecture and P03 contract govern the next work.

Keep current status and resource changes in this file, and task interfaces in the phase execution plan. `DEVELOPMENT_MASTER_HANDOFF.md` explains how to resume after compaction. No additional personal AGENTS file is needed.

The one-month feature target is aggressive, not yet an evidence-based forecast. Measure throughput after P03's first integrated tasks. Arrange P04 physical-device access and P08 provider/region decisions early. Prepare AI development examples once action schemas settle, while keeping the required release holdout isolated from prompt tuning. These dependencies can block progress even when code generation is fast.

## Founder decisions that remain external

The Development Master owns technical choices unless one of these needs founder input:

- paid provider, cloud region, residency, domain, or billing choice;
- real-user beta participation and recruitment;
- legal approval or public claims;
- publication, DNS, production rollout, or pushing work to an external remote when permission is required.
