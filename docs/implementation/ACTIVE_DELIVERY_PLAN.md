# Rushd active delivery plan

**Updated:** 6 September 2026

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
- P03 Task A is implemented at `557c556`, corrected at `51659e6`. Luna Max independently ran the original 50 domain tests, then 9 focused correction tests. Reversal-date binding and unrepresentable-instant rejection are fixed. B subsequently addressed the BCE/year-zero-to-CE alias in `instant.ts`; the integrated instant-resolution suite passes. This was focused verification, not a full P03 review or phase PASS.
- P03 Task B is closed at `28d4608`, following initial implementation `e68926f` and corrections `f255bac`. Muse independently reviewed B; Terra High verified the corrections and found a final live-return validation gap, now fixed and independently reproduced as passing. The Master reran lint, typecheck, `npm test` (99 domain tests plus repository/legacy checks), 16 property tests, and build successfully on 6 September. This closes B's domain/application scope, not P03 or legacy UI integration. The founder reports over 100 minutes for the initial implementation; include correction work when evaluating throughput.
- P03 Task C is closed at `a047a60`, following implementation `e33ca18` and corrections `e71601b` and `a047a60`. Muse Spark 1.3 contributor-free was the only product writer, invoked through OpenCode with `--variant high`. Terra High independently reproduced nine initial finance/data blockers, verified their corrections, then found one fixed-clock ordering defect; the second correction replaced wall-clock comparison with immutable append cursors. Terra's final review returned `ready_for_integration`. The Master reran lint, typecheck, `npm test` (138 domain tests plus repository/legacy checks), 18 property tests, build, and range diff-check successfully on 6 September. C remains backend-only and does not claim persistent storage or legacy UI integration.

## Working method

**Founder-approved handoff, 6 September:** Sol High becomes the regular Development Master after the founder compacts and switches the selected model. Astra handles ambitious signature animation work and selected design work, as well as bounded architecture/escalation decisions. This records the approved routing, not a claim that the UI switch has already happened. Recent manager work does not establish enough incremental benefit from Astra on every turn; retain independent financial verification and judge routing by completion, correction rate, and actual allowance consumption. Reduce repeated manager reads/status edits regardless of model.

The founder explicitly treats ambitious animation and visual-design quality as non-negotiable. Bring Astra into motion exploration, prototyping, implementation, and refinement, and selected visual-design work; its role is not limited to consultation. Sol coordinates delivery. Cost optimization must not silently downgrade the intended experience. Preserve motion accessibility, interruption behavior, performance, and equal Arabic/English quality while pursuing that ambition. Use the Rushd Motion Lab skill for the relevant motion work and validate the result in the running app rather than accepting a description or static screenshot as proof of animation quality.

- The Development Master owns task design, technical direction, integration, and risk-based verification. Sol High is the approved default. Delegate code exploration, implementation, testing, and review when cheaper agents can deliver reliably.
- Each implementation task has one product-source writer and one coherent commit.
- Tasks should be large enough to deliver a real behavior or capability, but small enough to review as one idea.
- Workers receive compact repository pointers and acceptance criteria, not this chat history or the retired governance corpus.
- The cheapest model that can perform a task reliably should get the task.
- Every task card names the model, reasoning level, and a short reason for that choice. The founder may override the choice when limits or availability change.
- Preserve Codex capacity for Development Master continuity. External models should handle most implementation, testing, and routine independent review when they can do so reliably.
- High-consequence finance, migration, sync, security, AI-write, release, and major visual work receives independent review. Ordinary low-risk changes receive direct Master review. Sol High is not the automatic reviewer for every high-risk task.
- When practical, worker and reviewer come from different model families.
- Assign external workers/reviewers a fixed report path under `/Users/mehmet/Desktop/Rushd/artifacts/agent-reports/`. They save results there; the founder only says which task finished. The Master reads the report directly. Do not assume automatic notifications. Use isolated worktrees for concurrent writers, return corrections to the original worker, and integrate dependencies before starting dependent work.
- For long delegated work, offer the founder the unattended-worker option before launch. With explicit approval, run the named cheap worker asynchronously, delegate long-interval liveness checks and bounded same-session continuation to Luna Low/Medium (using a separate Luna xHigh UI operator when the worker is only reachable through computer control), notify on completion/blocker, and end the Development Master's turn. Do not keep Sol/Astra alive to poll partial output.
- Every founder-facing handoff ends with an explicit instruction for what the founder should do next.
- Tests cover production behavior and the important failure boundary. Full matrices run at integration or phase gates rather than after every small edit.
- No receipt ceremony, patch manifest, lifecycle transcript, or manual state transition is part of normal development.

## Model routing

Routing changes when pricing, resets, free windows, or model availability changes. The founder will report those changes and the Development Master will adjust upcoming work.

Current founder-reported window: **300M GLM 5.3 Flash literal tokens until 6 September 2026 at 18:00 Asia/Riyadh**, interpreting "tomorrow" from the 5 September message. Cached input counts. Recheck availability on resumption; expiry is not extended by this document. Grok 4.6's Cursor Pro capacity is substantially better than previously assumed, so use it for more substantial implementation and review. These are resource reports, not independently verified provider claims.

- **GPT 6 Astra:** ambitious signature animations and selected visual-design work, including hands-on exploration, prototyping, implementation, and refinement. Also bounded consultation for difficult financial semantics, migration/sync architecture, AI permissions, and unresolved technical disputes. Not the routine manager or reviewer.
- **GPT 5.6 Sol:** High for the regular Development Master. Own task design, technical direction, integration, and risk-based verification; delegate cheaper bounded work. Medium remains available for substantial bounded support. Do not use Max.
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
3. P03 Tasks A through C are implemented and C's high-risk finance review is closed. Prepare Task D's storage/sync contract and repository-conformance integration next; do not repeat C's full audit unless D changes its financial semantics.
4. Keep the remaining foundation spine sequential: P03 finance domain, then P04 local data and PWA.
5. After P02 creates stable module boundaries, allow at most two isolated product writers. Start design foundations, provider preparation, AI schemas, eval assets, and release preparation early when they do not depend on unfinished production interfaces.
6. Integrate through the Development Master. Use short-lived branches or isolated worktrees for parallel writers and keep one integration owner.
7. Treat P01 through P11 as the full feature build. P12 is integrated hardening and release-candidate work. P13 is real-world beta and public-release validation.

## Next action and continuity

B review is complete: actual reviewer Muse Spark 1.3 contributor-free, default reasoning, not requested Grok. `artifacts/agent-reports/P03-B-REVIEW.md` reports independently passing existing gates and five material findings: allocation reversals omitted from availability, corrected payments double-counted by obligations, refunds exceeding corrected expenses, automatic dispute resolution on refunds, and missing return corrections. Astra corroborated the key source paths and accepts the findings. Complete cross-generation refund caps now and require explicit dispute resolution even after a full refund; the review's narrower recommendations are not sufficient.

The B corrections are committed at `f255bac`, parent `e68926f`, by Muse Spark 1.3 contributor-free, not GLM. Report: `artifacts/agent-reports/P03-B-FIX-01.md`. Terra High's scoped review found one remaining interaction: a voided return can still validate `returnReceived` dispute resolution. The correction suite and property suite passed, but its independent production-API probe reproduced the defect. Review: `artifacts/agent-reports/P03-B-FIX-01-REVIEW.md`.

The Master resumed the original Muse OpenCode session for this narrow correction, limited to the obligation handler and correction-chain tests. Commit `28d4608` rejects dead originals and accepts live replacement returns. Report: `artifacts/agent-reports/P03-B-FIX-02.md`. Terra reran its independent probe successfully and confirmed permanent no-write regressions; its existing review contains the closure addendum. Master integration gates all passed. B is closed.

C closed on 6 September at `a047a60`. The worker report is `artifacts/agent-reports/P03-C.md`; the three independent review reports are `P03-C-REVIEW.md`, `P03-C-REVIEW-2.md`, and `P03-C-REVIEW-3.md` in the same ignored directory. The final review independently passed fixed-clock carry, split, tracked-funding, obligation, Reality Check, buffer, rebase, and no-transfer probes and returned `ready_for_integration`. The next product task is P03 D. Its copy-paste worker card is ready at `docs/implementation/P03_TASK_D_PROMPT.md`, based on `ca140bb`, and routes the preferred cheap implementation path to Muse Spark 1.3 contributor-free with `--variant high`. It freezes the provider-neutral storage/sync contract and reusable repository-conformance suite while keeping persistent implementation in P04. The earlier GLM window expired at 18:00 and must not be assumed active. Do not reopen C unless D changes its finance semantics or a new reproducible defect appears.

The founder requested a Luna monitoring task. Created `01a072db-a6c3-7da0-b0fc-b731a666e37b` with Luna Low, solely to confirm completion and notify this Master (`01a02647-0425-7833-aee2-8e4c7bdeff29`). Pinned OpenCode session `ses_f8d78c148ffeZEzGcLLGjzl1XV` was already finished: final assistant message `msg_072d8d93f001gqCejivHxlgySp`, finish `stop`, completion `1788633214165`, names the correction report. No recurring polling/automation is needed after that completion. Monitor does not review or edit code.

Keep current status and resource changes in this file, and task interfaces in the phase execution plan. `DEVELOPMENT_MASTER_HANDOFF.md` explains how to resume after compaction. No additional personal AGENTS file is needed.

The one-month feature target is aggressive, not yet an evidence-based forecast. Measure throughput after P03's first integrated tasks. Arrange P04 physical-device access and P08 provider/region decisions early. Prepare AI development examples once action schemas settle, while keeping the required release holdout isolated from prompt tuning. These dependencies can block progress even when code generation is fast.

## Founder decisions that remain external

The Development Master owns technical choices unless one of these needs founder input:

- paid provider, cloud region, residency, domain, or billing choice;
- real-user beta participation and recruitment;
- legal approval or public claims;
- publication, DNS, production rollout, or pushing work to an external remote when permission is required.
