# Rushd active delivery plan

**Updated:** 6 October 2026

This file records the current delivery position and resource strategy. It does not replace the product contract in `docs/RUSHD_MASTER_PLAN_FINAL.md`, the phase outcomes in `docs/implementation/phase-plan.json`, or the working method in `WORKFLOW_LITE.md`.

## Goal

Build the full Rushd feature set described by the final master plan. The founder does not want a reduced local-alpha scope.

The working target is a feature-complete build ready for private founder use within one month. Public-release validation is a later finish line because P13 requires at least four weeks of real beta evidence plus external legal and operational work. This separates calendar validation from implementation without removing product features.

## Current position — 6 October 2026

**P04 is open; its private-use phone checkpoint has passed; visible P05/P06 work is authorized but not started.** Development Master moved from Codex to Claude Code (Opus 5.5) on 6 October. The full verified state, risks and reasoning are in `DEVELOPMENT_MASTER_HANDOFF.md`; this section is the short status.

- Branch `codex/p04d-restart`. Checkpoint commit `6268eb3` holds the phone-tested build (bytes match the device-gate deployment `dpl_2PKp8cCzPNN3YmK7Vizp4zgTzJzC`). Lint, typecheck, `npm test`, `test:data` and `test:pwa` pass on it. 71 commits ahead of `origin/main`, none pushed.
- Private-use checkpoint: iPhone script (founder report) and Galaxy A55 v2→v4/offline/two-tab (agent-observed) passed; A55 remainder by founder report. iPadOS, Mac Safari and unsafe storage-failure probes are **NOT_TESTED**; P04-A6 (VFS ADR) and P04-A7 (URL routes, deferred) stay open. Do not claim P04 closure.
- P05 `early_start_exception` (23 Sep) authorizes visible P05/P06 design and core-product work. Not publication.
- The founder confirmed on 6 October that no deployment holds real financial data.
- Motion experiments run between 24 September and 2 October in disposable copies are documented in `MOTION_EXPERIMENTS.md`; none is merged.

## Next action

1. Agree with the founder: the Claude Code delegation model; whether to push the local commits; the first P05/P06 slice.
2. Show the founder a visible proposal for the locked navigation (Home, Plan, Ask Rushd, Insights, Goals, Settings in the header) and the first slice. The handoff recommends capture → commit → ledger/availability plus new-user funding/onboarding.
3. Then freeze the Motion Lab rubric and motion-token source and start P05/P06 on the canonical runtime.

## Founder decisions that remain external

The Development Master owns technical choices unless one of these needs founder input:

- paid provider, cloud region, residency, domain, or billing choice;
- real-user beta participation and recruitment;
- legal approval or public claims;
- publication, DNS, production rollout, or pushing work to an external remote when permission is required.

## History (Codex era)

Everything below records the delivery position, method and routing up to 24 September 2026. It is kept for the reasons behind decisions. Where it conflicts with the sections above or with `DEVELOPMENT_MASTER_HANDOFF.md`, those win; in particular the model routing, the Sol/Astra Master arrangement, unattended monitoring and the "D4 worker is next" action are superseded.

### Position on 24 September

**P04-D5 remains open.** Base `9a3267b` has uncommitted candidate work. The
first subset deployment reused v3 worker bytes, leaving old icon CSS cached
on installed clients. A bounded v4 cache-generation correction passed focused
font/boot and real old-client upgrade checks, then Arabic and English booted
on isolated preview. The exact preview was promoted to isolated stable
deployment `dpl_2PKp8cCzPNN3YmK7Vizp4zgTzJzC`; stable HTML/JS/CSS/worker/font
bytes match local `dist`. See `artifacts/agent-reports/P04-FONT-V4-ISOLATED-GATE.md`.
The earlier live English timeout on v3 remains **INCONCLUSIVE**, not a pass;
no physical v3-to-v4 upgrade has been claimed.
Older isolated browser gates passed fake-data backup/reset/import/cancel and
offline read/write/reopen; they are not physical proof of this new candidate.

The founder approved a faster **private-use safety checkpoint**, not a claim
that the original full P04 contract passed. Next: one batched fake-data test
on the current iPhone and Android, covering installed launch/update, offline
read/write/reopen, persistence, manual export, no-export Factory Reset, import
cancel/reject/restore, and safe two-tab behavior. Never touch real data.
Physical iPadOS and unsafe quota/private-mode/kill-write probes are deferred
and remain **NOT_TESTED**. Mac Safari remains **NOT_TESTED**. P04-A6's strict
physical VFS ADR and failure matrix are still open; do not claim full P04
closure or release-quality support.

The founder also deferred URL-addressable destination routes and Add/Ask
shortcuts: current persisted view intent suffices for now. P04-A7 is **not
passed**; its route work moves to the navigation/core-product phase, and Ask
and authentication-interruption work stays with their later owner phases.
The founder reported the short current-build iPhone script passed, including
normal icons, offline fake-data writes/reopen, no-export reset, and restore.
That report does not cover iPhone two-tab, invalid import, device/OS attestation,
or Android. The A55 then connected over USB and passed the current-build v2-to-v4
update, target-scoped offline read/write/reload, and two-tab fake-data checks
without changing the phone's network or hotspot. Android installed cold launch,
backup/reset/import, old-tab rejection, and physical radio-offline are still
**NOT_TESTED** by an agent. On 24 September the founder confirmed all isolated
A55 data is disposable and reported the remaining hands-on test worked perfectly.
That completes the private-use phone safety checkpoint by founder report, without
turning unobserved steps into agent-attested evidence. See `artifacts/agent-reports/P04-D5-IPHONE-V4-FOUNDER-REPORT.md`
and `artifacts/agent-reports/P04-D5-A55-V4-DEVICE-GATE.md`.
Start a substantial visible P05/P06 slice
under the founder's explicit sequencing exception while keeping deferred P04
risks visible. Consult the founder before a consequential visual/core
interaction direction or publication. The idle continuity automation is
paused; dogfood and production remain untouched.

### Restart history

**P04-D compatibility-first restart previously active at Task D4.** The founder
rejected the replacement shell after real production use, completed the safe
rollback, and on 12 September explicitly authorized a redesigned P04-D start.
The active branch is `codex/p04d-restart`, based on accepted P04-C commit
`4f48b6f`. Commit `6799dbf` restores the established legacy composition root,
`545ce0b` pins retirement headers, and `e01e335` records rollback status. The
rejected P04-D checkout remains preserved in `/Users/mehmet/Desktop/Rushd` as
forensic evidence and must not be merged back wholesale.

The rollback is live at `https://rushd-dogfood.vercel.app/` and independently
verified. The production report is
`agent-reports/P04D-ROLLBACK-PRODUCTION-VERIFY.md`. A fresh isolated browser
showed the legacy app, no P04-D shell/controller/registration/cache, no remote
requests, all established destinations, and a synthetic expense that persisted
after reload. The separately reviewed same-origin transition harness proved the
rejected controller and `rushd-shell-*` caches retire while v1 IndexedDB, v2
storage/OPFS, localStorage, cookies, and unrelated caches remain intact. No real
user profile or device storage was cleared.

The chosen restart architecture is
`docs/implementation/P04_D_RESTART_ARCHITECTURE.md`; the sequence is
`docs/implementation/P04_D_RESTART_PLAN.md`. It keeps
`createLegacyApplication` mounted, migrates behavior behind typed feature ports,
and uses a hard build-time release latch so incremental implementation never
ships dual v1/v2 finance writers. Expense add/reload, populated established
destinations, visual parity, import/export, existing-data preservation, and a
mechanical mutation-ownership proof block the final authority cutover. P05 and
publication remain outside the authorization.

Task D1 is integrated at `f15900b` after free Muse Spark 1.3 High implementation
and a read-only Cursor Grok 4.6 High review returned
`ready_for_integration`. The reports are `artifacts/agent-reports/P04-D1.md`
and `artifacts/agent-reports/P04-D1-REVIEW.md`. D1 adds the compatibility
authority seam, typed feature-port contracts, legacy delegates, and a mechanical
48-action mutation inventory while the production root remains fully legacy.
The reviewer independently reproduced every required gate. Its five non-blocking
port-hygiene findings are assigned to D2 before candidate routing begins.

Task D2 is integrated at `f193fdc` after free Muse Spark 1.3 High
implementation and a read-only Cursor Grok 4.6 High review returned
`ready_for_integration`. The reports are `artifacts/agent-reports/P04-D2.md`
and `artifacts/agent-reports/P04-D2-REVIEW.md`; the reviewer independently
reproduced every required gate. D2 provides the candidate-only canonical guest
host, PWA lifecycle, tab coordination, old-binary block, and explicit storage
authority while default production remains entirely legacy.

Task D3 is integrated at `877eb27` after Muse implementation, corrections, and
a focused Cursor Grok 4.6 High review. It routes Home, Add, and Transactions
through canonical ports while preserving the established shell.

Task D4 is integrated at `82d3262`. It routes the remaining Plan, Insights,
Goals, lifecycle/navigation, portability, import/reset, and PWA paths through
canonical authority and performs the single production cutover. Cursor Grok
4.6 High corrected the initial review findings and the production parity
harness; independent Muse Spark 1.3 xHigh confirmed that the seven remaining
strict P00 pixel differences reflect canonical truth conflicts rather than UI
damage. The founder inspected the production preview and accepted those seven
documented deviations on 13 September. Every functional/data/PWA/browser gate
and the parity comparator self-test passed; `parity:quick` remains intentionally
red only for the accepted populated/edit/profile/apply-plan states. Report:
`artifacts/agent-reports/P04-D4.md`.

Task D5 is next. It must verify the exact integrated commit on physical Android,
iPadOS/iOS Safari, and desktop, including install/update, offline write/reload,
two-tab locking, persistence, migration, reset, and backup/restore. D4 does not
authorize personal financial data, deployment, publication, or P05.

- Branch: `codex/p04d-restart`
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
- P03 Task D is closed at `291228c`, following implementation `7d4f3b5`, corrections `289ff96` and `a129082`, and the final Grok correction `291228c`. The final independent review returned `ready_for_integration` after 9/9 adversarial transaction, rollback, provenance, replay, and conflict probes. Persistent storage, networking, and UI integration were not added.
- P03 is closed at reviewed product commit `291228c`. The Master reran lint, typecheck, `npm test` (25 domain files / 186 tests plus repository and legacy checks), `npm run test:property` (7 files / 23 tests), build, and the full `f80cfc9..291228c` diff check successfully on 7 September. A separate Luna Max acceptance audit mapped P03-A1 through P03-A6 to production paths and current executable evidence and returned `ready_to_close`.

### Working method

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
- Assign external workers/reviewers a fixed report path under `/Users/mehmet/Desktop/Rushd/artifacts/agent-reports/` (note, 6 Oct: that is where P00–P03 and pre-restart P04 reports live; restart-era reports from 12 September on are in `/Users/mehmet/Desktop/Rushd-P04D-Restart/artifacts/agent-reports/`). They save results there; the founder only says which task finished. The Master reads the report directly. Do not assume automatic notifications. Use isolated worktrees for concurrent writers, return corrections to the original worker, and integrate dependencies before starting dependent work.
- For long delegated work, offer the founder the unattended-worker option before launch. With explicit approval, run the named cheap worker asynchronously, delegate long-interval liveness checks and bounded same-session continuation to Luna Low/Medium (using a separate Luna xHigh UI operator when the worker is only reachable through computer control), notify on completion/blocker, and end the Development Master's turn. Do not keep Sol/Astra alive to poll partial output.
- Every founder-facing handoff ends with an explicit instruction for what the founder should do next.
- Tests cover production behavior and the important failure boundary. Full matrices run at integration or phase gates rather than after every small edit.
- No receipt ceremony, patch manifest, lifecycle transcript, or manual state transition is part of normal development.

### Model routing

Routing changes when pricing, resets, free windows, or model availability changes. The founder will report those changes and the Development Master will adjust upcoming work.

Current founder-reported window: **300M GLM 5.3 Flash literal tokens until 6 September 2026 at 18:00 Asia/Riyadh**, interpreting "tomorrow" from the 5 September message. Cached input counts. Recheck availability on resumption; expiry is not extended by this document. Grok 4.6's Cursor Pro capacity is substantially better than previously assumed, so use it for more substantial implementation and review. These are resource reports, not independently verified provider claims.

- **GPT 6 Astra:** ambitious signature animations and selected visual-design work, including hands-on exploration, prototyping, implementation, and refinement. Also bounded consultation for difficult financial semantics, migration/sync architecture, AI permissions, and unresolved technical disputes. Not the routine manager or reviewer.
- **GPT 5.6 Sol:** High for the regular Development Master. Own task design, technical direction, integration, and risk-based verification; delegate cheaper bounded work. Medium remains available for substantial bounded support. Do not use Max.
- **GPT 5.6 Terra:** harder implementation and review that needs a higher tier of intelligence. Choose Medium, High, or xHigh from task risk; do not use Max.
- **GPT 5.6 Luna:** default Codex worker for clear, well-defined implementation, testing, fixtures, mechanical migration, and focused review. Prefer Max when task breadth or integration risk benefits from deeper checking; use xHigh when Max is unnecessary.
- **GLM 5.3 Flash:** large bounded implementation or test work during temporary free-token windows. Its free pool is a literal token allowance including cached input and may expire within 10 to 12 hours, so use one compact task context and avoid repeated large-history loading. Prioritize it while a short free window is active.
- **GLM reasoning disclosure:** the founder sees a Max option, but Task A's worker could only verify a single runtime thinking mode. Record the UI request separately from the served tier; Task A's actual tier is unverified. Do not describe it as independently verified Max execution.
- **Muse Spark 1.3:** capable free external worker and reviewer, not merely a lightweight fallback. Use it as much as task fit allows. Select High, xHigh, or Max from the beginning based on task breadth, ambiguity, integration risk, and review difficulty; do not default every task to High. If the initial assessment was too low, continue the same bounded session at a higher exposed free effort. Judge it by correction rate and gate results rather than assuming the free model is weak.
- **Muse capacity:** free access is useful but limited, so do not plan unlimited work. The latest message called it "Azure Spark" through "OpenAI"; context suggests Muse/OpenCode, but that name/provider mapping remains an assumption. The founder also reports an optional contributor API tier around $0.10/M input and $0.20/M output. Pricing, eligibility, and provider are unverified; no paid API use has been requested. GLM remains first priority during its free window.

Artificial Analysis's [v4.2 announcement](https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v4-2), checked 5 September, adds realistic agentic/document tasks and increases private holdout weighting to 40%. It places Muse Spark 1.3 behind Fable 5.1, Opus 5, and Astra on AA-Briefcase. This supports assigning Muse substantial work; it does not establish Rushd coding reliability or prove performance in OpenCode's specific configuration. Compare like reasoning settings and index versions.
- **Gemini 3.8 Flash:** fallback for straightforward, tightly specified work that needs many tokens and has deterministic validation. Do not use it for ambiguous implementation, architecture, finance decisions, or final review. Its benchmark strength does not outweigh weak results on real Rushd tasks.
- **Claude Opus 4.6:** product writing, bilingual copy critique, founder-facing explanations, and qualitative review.
- **Grok 4.6 through Cursor:** preferred external route for harder implementation and independent finance review. Use High for clear multi-file work and the highest exposed setting for difficult reconciliation/concurrency review. Do not assume Cursor exposes xHigh; report the actual selected setting. Do not pause current work for a future release.
- **Fable 5.1:** reserve for high-leverage UI design and motion taste, where the founder considers it unusually strong. Founder-reported remaining budget is approximately USD 16 total. Use compact, evidence-rich briefs for consequential visual direction, hierarchy, composition, and motion critique; do not spend it on routine implementation, mechanical tests, or broad context loading. Record known spend and remaining budget after each use.
- **GPT Image 2.5 through ChatGPT.com:** use generously for inexpensive UI concept frames, alternative compositions, visual motifs, and animation keyframes/storyboards. It can reduce expensive taste-model iteration, but generated images are exploration artifacts—not approved product screens, implementation specifications by themselves, or proof of responsive/bilingual/accessibility quality.

**Design/motion priority, 13 September:** design and animation are the founder's highest creative-quality priority. When P05/P11 or another consequential experience slice begins, deliberately combine GPT Image exploration, selective Fable taste input, and Astra's approved design/motion role. Pursue an ambitious signature experience rather than a generic finance shell, while keeping Reduced Motion, interruption behavior, performance, accessibility, and equal Arabic/English quality non-negotiable. Use the Rushd Motion Lab skill and validate animations in the running app.

### Reasoning levels

Choose reasoning from task shape rather than model prestige:

- **Low:** exact mechanical edits with a deterministic formatter, compiler, schema, or snapshot check.
- **Medium:** narrow implementation or test work with one clear code path and limited edge cases.
- **High:** normal multi-file product work, debugging, migrations, financial behavior, or tasks with several interacting requirements.
- **xHigh:** architecture, unclear root causes, concurrency, sync conflicts, difficult integration, or reviews where missing one interaction would be costly.
- **Maximum tiers:** Luna Max is allowed for demanding, clearly bounded work. Terra Max and Sol Max are excluded; High or xHigh is their normal ceiling.

Weak or unfamiliar models may need a higher reasoning level for the same task. A higher tier is useful only when it improves decisions; it should not compensate for an unsuitable model or an unclear prompt.

If an external app does not expose the suggested setting, use its highest suitable available setting and report it. Each prompt still states the desired reasoning depth and why.

### Acceleration plan

1. P01 is closed at reviewed commit `075317e`.
2. P02 is closed at `f80cfc9`.
3. P03 is closed at reviewed product commit `291228c`; all six acceptance outcomes and the integrated phase gate pass.
4. Keep the remaining foundation spine sequential. No P04 work has started as part of P03 closure.
5. After P02 creates stable module boundaries, allow at most two isolated product writers. Start design foundations, provider preparation, AI schemas, eval assets, and release preparation early when they do not depend on unfinished production interfaces.
6. Integrate through the Development Master. Use short-lived branches or isolated worktrees for parallel writers and keep one integration owner.
7. Treat P01 through P11 as the full feature build. P12 is integrated hardening and release-candidate work. P13 is real-world beta and public-release validation.

### Next action and continuity as of D4 (stale)

The D4 worker and its later independent review are the active critical path.
Keep monitoring local and minimal. The
20-minute fallback must take the next authorized action and repoint itself before
notifying; it must not stop at a completion message. Gemini 3.8 Flash through
Anti-gravity remains approved for narrow deterministic support. Tell the founder
before any Astra consultation and use Low or Medium only. Do not deploy an
intermediate candidate or start P05.

P03 closed on 7 September at reviewed product commit `291228c778d0714b343c396d2a37067f5361d8a1`. Task D's final worker report is `artifacts/agent-reports/P03-D-GROK-CORRECTION.md`; its independent review is `P03-D-GROK-REVIEW.md` and returns `ready_for_integration`. The phase closure audit is `P03-PHASE-CLOSURE-AUDIT.md` and returns `ready_to_close`. The Master's final gate logs are under `artifacts/agent-reports/P03-PHASE-CLOSURE-evidence/`.

The generated-child-ID convergence case remains documented for later sync command-schema work. It is not a P03 blocker under the frozen contract. Do not reopen P03 without a new reproducible defect or an explicit contract change. No P04 implementation or preparation started during this closure.

Keep current status and resource changes in this file, and task interfaces in the phase execution plan. `DEVELOPMENT_MASTER_HANDOFF.md` explains how to resume after compaction. No additional personal AGENTS file is needed.

The one-month feature target is aggressive, not yet an evidence-based forecast. Measure throughput after P03's first integrated tasks. Arrange P04 physical-device access and P08 provider/region decisions early. Prepare AI development examples once action schemas settle, while keeping the required release holdout isolated from prompt tuning. These dependencies can block progress even when code generation is fast.
