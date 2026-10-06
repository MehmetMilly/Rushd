# Rushd Workflow Lite

> **Status, 6 October 2026:** written for the Codex-era Development Master. For the Claude Code Development Master, the *Model routing*, *Astra consultation*, *Approved unattended execution* and file-handoff mechanics below are historical: the delegation model is being agreed with the founder. The durable principles still apply: founder consultation, the evidence boundary, risk-proportional independent verification, one writer per checkout, explicit Git staging, no push or publication without permission, and the product boundaries. The current state is in `docs/implementation/DEVELOPMENT_MASTER_HANDOFF.md`.

This is the active delivery workflow. Preserve the master plan's product quality and phase acceptance outcomes while minimizing total cost, including Master time, worker corrections, repeated reviews, and founder effort.

## Authority and roles

The founder owns product intent, experience feedback, external account/provider decisions, publication, and major product tradeoffs. The Development Master owns technical direction, task design, routing, verification, and integration. Workers implement; independent reviewers verify expensive failure boundaries.

Founder clarification, 11 September: consult the founder before implementing major changes to visual direction, core interactions, navigation, or feature scope. Show the concrete proposal and explain the tradeoff. Routine technical choices remain autonomous. The founder has authorized a compatibility-first P04-D restart that preserves the mounted legacy application and evolves the established visual identity on the new data layer. This is not authorization for another replacement shell, empty permanent destinations, P05, or publication. Favor Muse/OpenCode and Grok/Cursor, minimize Codex work and repeated gates.

Use `AGENTS.md` for project invariants, `docs/implementation/ACTIVE_DELIVERY_PLAN.md` for current status, and the relevant phase entry in `phase-plan.json` for acceptance. Read only the master-plan sections needed for the decision. Historical protocols, task prompts, and model assignments do not override this workflow or current founder instructions.

## Master operating loop

1. Recover current status once. Inspect the assigned report, Git state, and the relevant evidence. Do not reread the whole project or transcript on each turn.
2. Identify the next concrete outcome and choose its owner. Do short decisions, targeted evidence checks, and small coherent edits directly when delegation would cost more. Delegate bounded exploration, implementation, test execution, and evidence packaging to cheaper capable workers.
3. Complete authorized work through its next useful handoff. A result notification means read the result and act: accept and integrate, save a correction prompt, or identify a specific decision needed. Do not merely acknowledge completion or ask whether to read the report.
4. If useful independent Master work remains, do it. When only delegated work remains, end the turn with the actual next action and return mechanism. This applies to subagents, reviewers, new tasks, external workers, and audits equally. Do not park the Master in wait loops, poll progress, inspect partial diffs, or redo delegated work.
5. Resume when a completion/blocker event or the founder arrives. A single compact status check on an explicit status request or recovery event is appropriate. Report observed state precisely: a PID or screen proves presence, not progress. Do not claim progress, a sleeping monitor, or automatic wakeup without evidence that the mechanism is working.
6. Update the active status once at a meaningful handoff or closure. Suggest or execute the next authorized step. An explicit phase stop overrides general momentum; do not start the next phase.

The Master is accountable for outcomes, not required to personally execute every test. Sending a task to a cheaper model and then following every step defeats delegation. A blocked tool wait is not itself proof of token consumption; the avoidable overhead is repeated inference, large contexts, and duplicated work. Do not invent cost savings or measured usage.

## Model routing

These are founder preferences, not published pricing or benchmark claims. Use the available model/effort actually exposed by the tool. Never silently substitute a model or claim a UI setting was selected.

| Route | Assignment and effort |
| --- | --- |
| Luna | Codex is primarily a monitoring and return-path tool. Use Luna Low/Medium for monitoring and simple bounded tasks. Prefer a capable founder-named free external agent for substantial code work; when those routes are unavailable or unsuitable, GPT-6 Luna xHigh or Max can own code-related review and agentic work. Choose xHigh or Max upfront from task difficulty and risk; Max is viable for harder tasks, not a last-resort exception. For Codex subagents, request the exact `gpt-6-luna` model and effort; never infer the model from a preset role name. Do not interrupt an already-running adequate review merely to raise effort. |
| Muse Spark 1.3 through OpenCode | First choice for substantial well-defined implementation, tests, and suitable independent review while its contributor route is free and not rate-limited. Choose High, xHigh, or Max upfront from task breadth, ambiguity, and risk; do not mechanically start at High. Escalate the same session later only when the initial assessment proves insufficient and the free route exposes the higher effort. |
| Kimi K3, DeepSeek V4.1 Flash, and GLM 5.3 Flash through Cline | Founder-reported free ClinePass capacity. Kimi suits harder bounded code and diagnosis; DeepSeek and GLM suit clear implementation and test tasks. Verify the exact model and free allowance in the app before launch, and never let a fallback silently spend credits. |
| DeepSeek V4.1 Flash and GLM 5.3 Flash through Verdent | Founder-reported free capacity for bounded coding tasks. Prefer explicit ownership, small contexts, and checkable tests. App access is known; do not assume a CLI is installed or that its allowance remains free. |
| Grok 4.6 or 4.7 through Cursor | Use for hard implementation, finance/concurrency reasoning, or difficult independent review when a free route is inadequate. The founder wants 4.7 used where its quality merits it, but suspects materially higher token use than 4.6; record observed task-level tokens/cost when available instead of assuming the benchmark ratio. Confirm the selected Cursor model and billing route before launch; past Cursor usage unexpectedly spent paid credits. Medium/High normally; xHigh only for exceptional work. |
| Gemini 3.8 Flash through Anti-gravity | Fast, cheap owner for explicit low-risk implementation, fixtures, mechanical tests, and bounded evidence tasks. Give it narrow files and deterministic checks. Do not assign architecture, ambiguous finance behavior, concurrency, migration safety, or final high-risk review. |
| Fable 5.1 | Premium taste specialist for high-leverage UI direction, visual hierarchy, component composition, and motion critique/exploration. The founder reports a total remaining budget of about USD 16; reserve it for consequential design decisions, use compact briefs, avoid routine coding/review, and record spend when known. |
| GPT Image 2.5 through ChatGPT.com | Low-cost visual ideation for UI frames, alternate art directions, animation keyframes, and composition experiments. Use images to widen and communicate design options, never as implementation proof or a substitute for bilingual, accessible, responsive validation in the running app. |
| Terra | Do not use for ordinary Rushd implementation or review. Reserve only for an explicitly justified internal exception when external Muse/Grok cannot perform a tiny bounded task. |
| Sol | Do not delegate ordinary Rushd implementation or review to Codex Sol. Use Medium/High only for an explicitly justified bounded exception. |
| Astra | The founder may select Astra as Master. Also preserve its approved role in ambitious motion and selected design work. For consultation from another Master, tell the founder first and use Low or Medium only. |

The founder has not settled Astra Light versus Sol High as Master. Keep the selected Master; do not switch it or impose Sol as the default. “Light” is the founder's UI terminology; map it to an actual supported effort only when known. A chosen Sol Master does not authorize additional Sol reviewers.

The founder reports GPT-6 Sol and Luna as roughly 50% cheaper than their GPT-5.6 predecessors in current usage. Treat that as a routing preference, not verified billing; preserve Master continuity and use free competent workers first. Free windows and model availability can change. Check the actual app/provider route before each external launch; a rate limit or exhausted allowance is not permission to switch to paid credits.

Use only the founder-named external model routes above unless the founder approves another model. A model being free is not sufficient reason to substitute it. In particular, do not route Rushd work to Nemotron; the founder rejected that choice. If a named app is inaccessible and Muse is rate-limited, use a bounded Luna review/task or ask for a manual app handoff rather than silently choosing an unapproved free model.

For substantial implementation, correction, independent review, and gate ownership, prefer a capable free route through OpenCode, Cline, Verdent, or Anti-gravity before paid Cursor or Codex. A separate Codex task may monitor an external run and message the Development Master, but it must not silently replace that external route with Codex implementation/review. Do not keep the Development Master active while another route works.

Give each dispatch a one-sentence reason connecting model and effort to task difficulty. Prefer a fresh compact worker context with files, base, scope, and output path over a full-history fork. Use subagents for supporting work; create a sidebar task only when the founder explicitly asks.

### Astra consultation

Taste is also a reason to involve Astra: visual hierarchy, typography, bilingual composition, interaction feel, animation choreography, and design critique. Consult it before consequential taste choices are locked in, even when implementation is technically straightforward. Use Light for one focused critique and Medium only when several design/motion decisions interact. Astra may own exploration, prototypes, and implementation when approved; it is not restricted to reviewing someone else's design. Preserve the existing motion-quality commitment.

Design and animation are the founder's highest creative-quality priority. For P05/P11 and other consequential experience work, combine cheap image-based exploration, selective Fable 5.1 taste input, and Astra's approved motion/design role before implementation is locked. Push the experience ambitiously while retaining Reduced Motion, interruption safety, performance, accessibility, and equal Arabic/English composition. Use the Rushd Motion Lab workflow and judge motion in the running app; static images are concept evidence only.

Recommend Astra Light for a bounded second opinion and Medium for interacting architecture, financial semantics, design, or animation decisions when the current Master cannot resolve a consequential ambiguity, reviewers disagree on a contract, or repeated corrections reveal an unsettled design. Prepare one compact file with the exact question, evidence, options, and the Master's recommendation. Tell the founder why the consultation is worth its cost and request approval before launching it or asking for a model switch. Do not quietly call Astra. Already-approved consultation needs no second approval. The founder has pre-approved one conservative Light-or-Medium consultation for P04-D/P05 design and animation planning or critique when it materially improves quality; use the smallest adequate effort and do not multiply consultations.

Two unsuccessful correction rounds are a signal to reassess root cause and task fit, not a trigger for a prescribed expensive model. Prefer Grok for technical correction; propose Astra when the unresolved issue is a consequential decision. Keep the final quality gate intact.

## Task ownership and file handoffs

A task delivers one coherent behavior, safety fix, infrastructure capability, or documented containment. Split when dependencies or review risk justify it; avoid tiny dispatches and manager handholding. One product writer owns a checkout at a time. Parallel work requires independent scopes and, where necessary, isolated worktrees.

Save every manual worker/reviewer/consultation prompt as a file, normally under `/Users/mehmet/Desktop/Rushd-P04D-Restart/artifacts/agent-reports/` (gitignored, local only). Use committed phase task cards under `docs/implementation/` when they are durable interfaces. Results always have a separate exact output path under the same ignored report directory.

A prompt includes outcome, repository and base, ownership/allowed paths, relevant context pointers, acceptance, scoped validation, exclusions, chosen model/effort and reason, Git permissions, and the exact result path. Review prompts pin the candidate and require independent behavior checks without product edits. Resume the original worker for corrections when available.

For a manual handoff, provide the app, model, effort, routing reason, saved prompt, short paste instruction, and the founder's next action. Do not paste the whole file into chat unless requested. A bare “prompt created” is incomplete.

Reports include status, actual model/effort, base/result SHA or uncommitted state, changed scope, behavior, commands/results, evidence paths, blockers, and remaining limitations. Record elapsed time and retries if available; do not poll account usage or invent dollar costs. Reports live in the ignored directory. Commit only when authorized, and report after the commit when one was requested.

## Verification without duplication

- Low-risk docs, tooling, and obvious changes: direct focused inspection.
- Ordinary implementation: scoped tests and relevant diff/evidence review by an assigned cheaper capable reviewer. The Master reads the packaged evidence and adjudicates it.
- Finance, mutation/migration, sync/auth/security, AI writes, release, significant visual/motion/bilingual work: independent risk-focused review. Prefer an external reviewer when capable. Different families are useful, not a reason to order another full audit after an adequate independent review.
- Worker tests do not replace independent review. Reviewers exercise real production paths and adversarial cases, not copied formulas.
- Reuse passing command evidence from an independent reviewer at the exact integrated product SHA when commands, results, and environment are verifiable. Run missing gates or rerun after relevant changes, environment differences, weak evidence, or an explicit phase requirement. Do not automatically run the same full gate as worker, reviewer, Master, and closure auditor.
- Assign one owner to the integrated gate. The Master checks its evidence and acceptance coverage. A docs-only status commit does not invalidate product tests.
- Direct product-diff inspection or test execution by the Master is an exception. Use it only for a small manager check or when no cheaper capable route exists, and tell the founder before spending that effort.
- Atomicity/retry claims need injected failure plus reopening/retry at the implemented boundary. In-memory proof is not durable browser proof.
- After correction, review the affected failure paths and relevant regressions. Broaden only when the change or new evidence justifies it.
- A real silent-loss, duplicate-effect, wrong-money, or identity defect blocks acceptance. Record exact reproduction and return it to the responsible worker. Do not reclassify a defect as later work simply to close a phase.
- Record genuine later-phase gaps with the reason for deferral, owner phase, and required future proof. Preserve closure unless new evidence warrants reopening it.

## Approved unattended execution

Prepare the task file before seeking launch approval. Explain the worker/model, scope, monitor, expected report, allowance used, and resume limit. Obtain the founder's approval before starting an external unattended run. This workflow setup alone is not launch approval. Preserve approval already given for the same run; do not ask again for authorized monitoring or bounded continuation.

1. Verify CLI/tool capabilities and exact model availability with a cheap read-only check. Do not assume Cursor's UI models, subscription, and CLI models are interchangeable.
2. Prefer a detached resumable CLI session. Use a Luna xHigh UI operator only when needed and authorized. Record the task/base, model, session, result path, and approval scope in one ignored run file.
3. Verify launch once. Assign exactly one cheap Luna Low/Medium monitor for that worker. The monitor owns continuity, not just status. It checks liveness, observable progress, the exit marker, and the expected report at a sensible interval. If an approved session stops mechanically before producing a valid report, the monitor verifies that the original writer is gone and resumes the same session within the two-resume limit. It alerts the Master instead when recovery is ambiguous, the limit is exhausted, or the task needs a founder decision. The monitor does not inspect partial diffs, run product tests, change scope, switch models, or start the next task. It stays active until a valid report, terminal blocker, or Master handoff exists.
4. Add one short current-thread fallback heartbeat every 15 minutes when unattended continuation matters. It recovers control if the worker or monitor fails to return it. Verify that the saved automation is active and targets the current Development Master task before ending the turn. The fallback stays quiet on non-terminal checks. On a successful terminal result, it takes the next already-authorized action, such as dispatching the frozen independent review, and repoints itself to that stage before notifying. It pauses only when the next action needs a founder decision or the result is blocked. When the founder explicitly requires uninterrupted continuation, keep one bounded direct wait open as the primary return path and retain the heartbeat only as fallback.
5. On completion, the Master reads the packaged result and immediately routes the next review, correction, or task. Do not create speculative parallel handoffs, multiple monitors, or repeated status turns while one worker/reviewer owns the critical path.
6. Treat a living PID or screen as presence, not progress. Suspect a stall only after no report/log/CPU change across three checks spanning at least 20 minutes and no known long-running child. A long-lived preview/dev server does not count as productive work after the report and required evidence are complete; stop only that owned server so the worker can return. Then inspect the minimal log/process state once and either resume the same authorized session or report a blocker. Limit same-session resumes to two.
7. A rate-limit response with a reset time should wait until eligible; exhausted free capacity is not permission to switch to paid. Before any stopped-session resume, verify the original writer is gone. The founder has pre-authorized same-session resumes once a task, provider, model, checkout, and scope are already approved. Do not ask again solely to resume that session. New billing, login/CAPTCHA, destructive recovery, changed provider or model family, expanded task scope, or a second writer still requires the applicable decision.
8. Completion requires a matching report and coherent repository state, not merely an idle UI or living PID.
9. Once the worker, one monitor, and optional 20-minute fallback are verified, the Master normally ends its turn. If the founder explicitly requires uninterrupted continuation, keep the bounded direct wait active instead. Delete or repurpose stale task-specific fallbacks after the terminal event; leave unrelated user automations alone.

New billing, login/CAPTCHA, destructive recovery, publication, changed provider, or a second writer requires the applicable founder decision. Prepare any safe remaining work before asking. Transparency should not become repeated permission requests.

## Communication and continuity

Use plain, tasteful language. Lead with the result or decision. Give useful progress updates during active work; do not manufacture status turns while idle. Share material concerns and worthwhile ideas with a short reason, distinguish opinion from evidence, and make a recommendation.

Every handoff names exactly what the founder must do, or says that nothing is needed and identifies who acts next. “Nothing required” is valid at a completed scope or a verified unattended handoff, not a substitute for preparing the next authorized step.

Keep one current status record in `ACTIVE_DELIVERY_PLAN.md`: phase/base, assignment owner, prompt/result, relevant session and approval, next action, blockers, and unresolved decisions as applicable. Link long run details rather than duplicating them. Update at handoffs, decisions, and closure; do not maintain a parallel ceremony.

## Git and product boundaries

Preserve existing edits. Stage explicit files and commit only within authorization after relevant verification. Never push or publish without permission. No receipts, manifests, or historical state-machine transitions are required for ordinary work.

Arabic and English remain equal-quality languages. Preserve financial safety, data, destructive-action confirmation, typed AI proposals, honest readiness claims, and the locked navigation/Momentum rules in `AGENTS.md` and the master plan. Saving usage is not permission to lower acceptance or motion/design ambition.
