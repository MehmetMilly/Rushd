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
- P03 Task A is implemented at `557c556`, corrected at `51659e6`. Luna Max independently ran the original 50 domain tests, then 9 focused correction tests. Reversal-date binding and unrepresentable-instant rejection are fixed. A remaining BCE/year-zero-to-CE alias in `instant.ts` is a narrow prerequisite included in `P03_TASK_B_PROMPT.md`; proceed with B rather than opening another separate correction cycle. This was focused verification, not a full P03 review or phase PASS.

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
- **GLM reasoning disclosure:** the founder sees a Max option, but Task A's worker could only verify a single runtime thinking mode. Record the UI request separately from the served tier; Task A's actual tier is unverified. Do not describe it as independently verified Max execution.
- **Muse Spark 1.3:** capable near-zero-cost external worker and reviewer, not merely a lightweight fallback. The founder rates it highly, though below Grok 4.6 overall. Use High for normal multi-file work and xHigh for difficult logic, finance/data review, or broad integration; judge task fit from actual results.
- **Muse capacity:** free access is useful but limited, so do not plan unlimited work. The latest message called it "Azure Spark" through "OpenAI"; context suggests Muse/OpenCode, but that name/provider mapping remains an assumption. The founder also reports an optional contributor API tier around $0.10/M input and $0.20/M output. Pricing, eligibility, and provider are unverified; no paid API use has been requested. GLM remains first priority during its free window.

Artificial Analysis's [v4.2 announcement](https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v4-2), checked 5 September, adds realistic agentic/document tasks and increases private holdout weighting to 40%. It places Muse Spark 1.3 behind Fable 5.1, Opus 5, and Astra on AA-Briefcase. This supports assigning Muse substantial work; it does not establish Rushd coding reliability or prove performance in OpenCode's specific configuration. Compare like reasoning settings and index versions.
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
3. P03's execution plan is agreed. Task A's focused correction check is complete. Issue B to GLM with the small date-era correction included.
4. Keep the remaining foundation spine sequential: P03 finance domain, then P04 local data and PWA.
5. After P02 creates stable module boundaries, allow at most two isolated product writers. Start design foundations, provider preparation, AI schemas, eval assets, and release preparation early when they do not depend on unfinished production interfaces.
6. Integrate through the Development Master. Use short-lived branches or isolated worktrees for parallel writers and keep one integration owner.
7. Treat P01 through P11 as the full feature build. P12 is integrated hardening and release-candidate work. P13 is real-world beta and public-release validation.

## Next action and continuity

Send `P03_TASK_B_PROMPT.md` to a fresh GLM 5.3 Flash chat in the same repository. Request Max if available; report only the actual exposed thinking setting. The prompt includes one small era-validation correction followed by the full everyday-finance slice. B is ready to send, not confirmed running. Inspect its result before C; keep broad independent finance review at the A–C integration point. Deterministic cycle IDs and synchronous repository methods remain C/D design seams, not blockers by themselves. P02 research is historical context; the implemented architecture and P03 contract govern the next work.

Keep current status and resource changes in this file, and task interfaces in the phase execution plan. `DEVELOPMENT_MASTER_HANDOFF.md` explains how to resume after compaction. No additional personal AGENTS file is needed.

The one-month feature target is aggressive, not yet an evidence-based forecast. Measure throughput after P03's first integrated tasks. Arrange P04 physical-device access and P08 provider/region decisions early. Prepare AI development examples once action schemas settle, while keeping the required release holdout isolated from prompt tuning. These dependencies can block progress even when code generation is fast.

## Founder decisions that remain external

The Development Master owns technical choices unless one of these needs founder input:

- paid provider, cloud region, residency, domain, or billing choice;
- real-user beta participation and recruitment;
- legal approval or public claims;
- publication, DNS, production rollout, or pushing work to an external remote when permission is required.
