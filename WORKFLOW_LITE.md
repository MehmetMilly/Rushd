# Rushd Workflow Lite

This is the active delivery workflow. It optimizes for useful product progress while preserving the quality invariants that matter for a personal finance app.

## Roles

- **Founder:** owns product intent, manual experience feedback, account/provider decisions, publication, and explicit acceptance of major product tradeoffs.
- **Development Master:** owns planning, task sizing, technical decisions, risk classification, verification, integration, and concise task cards for Workers.
- **Worker:** implements an assigned slice in a dedicated chat, runs logical tests, and reports honestly.
- **Reviewer:** a separate agent used only when a change needs independent adversarial verification. It reviews behavior, diffs, tests, screenshots/video where relevant, and risks—not process paperwork.

The Development Master may directly verify low-risk changes. Independent Reviewer is reserved for high-consequence work.

## Task sizing

A normal task is a coherent, respectable slice—not a one-line chore and not an entire phase compressed into one prompt. A task should usually produce one of:

- a complete user-visible flow;
- a complete financial-safety fix plus regression coverage;
- a bounded refactor with behavior preservation;
- a complete infrastructure capability;
- a documented containment for a defect whose final solution belongs later.

Batch related edits into the same task. Split only when risk, uncertainty, review size, or a hard dependency makes splitting genuinely useful.

## Test scope

Tests verify meaningful behavior; they are not ceremonial coverage theater.

For most product changes:

- test the main accepted behavior;
- test the important failure or boundary;
- update affected regressions;
- run targeted tests during development;
- run the relevant full gate before handoff.

Add deeper property, migration, accessibility, performance, security, or visual checks only when the change touches those risks or the phase contract demands them.

Additional rules:

- If a Worker finds a credible new path to silent data loss, duplication, or materially wrong money answers, stop that slice and report it before broadening scope.
- A dangerous prototype action may be visibly blocked until its permanent fix; the UI must say the action is temporarily unavailable rather than failing silently.
- Tests must exercise production logic. A copy of the formula in a test helper is not proof.
- Claims about atomic writes or retry safety need an injected failure followed by reload/retry verification.
- At handoff, report the commit, tests, manual checks, remaining visible containments, and any unexplained changes. No additional process artifacts are required.

## Verification tiers

### Tier 0 — Master direct

Use for docs, comments, configuration, formatting, small developer tooling, and obvious cleanup. The Development Master inspects the result directly.

### Tier 1 — Master technical verification

Use for normal features, refactors, bug fixes, and UI changes. The Worker reports implementation and tests; the Development Master reviews diff, behavior, scope, and tests.

### Tier 2 — Independent Reviewer

Use when mistakes are expensive or subjective quality matters:

- finance calculations and reconciliation;
- data mutation, import/export, reset, migration;
- sync/auth/security/privacy;
- AI output handling or proposals;
- release/beta readiness;
- major architecture choices;
- significant visual, motion, or bilingual UX work.

For important UI or animation work, the Reviewer may record and inspect live video rather than relying only on static screenshots.

## Task card

Every Worker assignment includes:

1. outcome;
2. repository context/files;
3. allowed paths;
4. acceptance criteria;
5. tests to run;
6. out-of-scope items;
7. expected concise report and its exact absolute output path.

Workers read only what they need. They do not reread the whole governance corpus for every slice.

## Worker report

The Worker saves its final report at the exact path in the task prompt, normally `/Users/mehmet/Desktop/Rushd/artifacts/agent-reports/<task-id>.md`. This local directory is already Git-ignored. Write the report after the implementation commit so it can name the actual commit; do not commit the report. Use a separate named report for each correction/review assignment. A blocked task writes its current result at its assigned path too.

Include task ID, complete/blocked status, completion time, actual repository/worktree path, base and result commit when present, actual model/reasoning setting, and the implementation/test/limitation details below. Markdown is fine; a prescribed JSON ceremony is unnecessary. Keep secrets and real user data out of reports.

The Worker's chat reply need only say the report is saved and identify its path. The founder then tells the Development Master that the task finished; the Master reads the assigned report and checks the relevant code/evidence. This shared-file handoff requires access to the same filesystem. If unavailable, report that limitation in chat rather than claiming the file was saved.

Report content includes:

```json
{
  "status": "complete | blocked",
  "changed_files": [],
  "implementation_summary": "",
  "tests_run": [],
  "test_results": {},
  "manual_or_visual_checks": [],
  "risks": [],
  "follow_ups": [],
  "questions": []
}
```

No receipts, manifests, lifecycle transcripts, or state transitions are required unless explicitly requested.

## Unattended worker execution

Use unattended execution whenever a long task can run safely in a cheaper worker while the
Development Master is idle. This is a cost-control pattern, not blanket authorization.
Before every new unattended run, ask the founder one clear question:

> Would you like me to run this task unattended, have a cheaper subagent monitor and resume it when safe, and report back when it finishes?

Proceed only after explicit approval for that task. The approval covers launching the named
worker and monitor under the stated free/paid route; it does not authorize a paid fallback,
provider change, login, purchase, secret entry, destructive action, publication, or a second
product writer.

### Launch path

1. Freeze a worker-ready task card with outcome, product base, owned paths, acceptance,
   validation, commit/report requirements, model, reasoning setting, and routing reason.
2. Tell the founder exactly what will run, what will monitor it, and that their next action is
   to wait for completion or failure notification.
3. Record durable local run metadata under `artifacts/agent-reports/`: task ID, prompt path,
   product base, worker model/setting, process/session/tab identity, log path, report path, and
   monitor identity. Keep secrets out.
4. Start one product-source writer asynchronously. Prefer a detached CLI/API session when the
   route supports it. Verify the process/session accepted the prompt once, then stop reading
   partial output.
5. When the model is available only through a user-authorized UI, assign a capable low-cost
   operator such as Luna xHigh to use computer control to open the exact app/tab, select the
   approved model/setting, submit the frozen prompt, and capture the resulting session identity.
   The operator may use already-authorized accounts; it may not solve a CAPTCHA, change billing,
   accept new terms, expose secrets, or choose a paid route without a separate founder decision.

The launch operator does not become a second implementation worker. After it verifies a live
run, it hands monitoring to the cheapest model that can reliably read status and resume the
same session—normally Luna Low for CLI/process checks or Luna Medium for UI state.

### Monitor path

The monitor is a liveness coordinator, not a reviewer or developer.

- Wait with long adaptive intervals, normally 3–10 minutes based on expected task duration.
  Prefer one sleeping process/tool call over repeated model turns.
- Check only liveness, terminal/app status, final report presence, and the minimal log tail needed
  to classify a stop. Do not stream partial reasoning, inspect evolving diffs, run tests, or make
  product decisions while the worker is active.
- Preserve one-writer ownership. Resume the same worker session; never start a replacement writer
  against its partial tree without Development Master and founder approval.
- Automatically resume the same session after a clearly transient stop such as a connection drop,
  rate limit, terminal detachment, or incomplete stop with no final report. Re-send a short
  continuation that preserves the frozen task, working tree, model, and report requirement.
- Limit automatic continuation to two consecutive transient resumes. A third stop, an unavailable
  session, contradictory state, merge conflict, approval request, login/CAPTCHA, paid fallback,
  destructive action, or ambiguous product question is a blocker to report—not permission to
  improvise.
- On completion or blocker, save a concise monitor summary, notify the Development Master, and use
  an available user notification channel (Codex task notification or local OS notification) so
  the founder knows to return.

### Development Master sleep rule

After launch verification and monitor assignment, the Development Master ends its turn. It does
not hold an expensive foreground process, call `wait` repeatedly, poll the log, or remain active
to narrate progress. The manager resumes only when the monitor reports completion/blocker or the
founder sends new input.

When the manager resumes, it reads the final worker report and commit, performs the risk-tiered
verification/review loop, updates status, and again tells the founder the exact next action.
Detached workers and monitors still consume their own provider/model allowances; this pattern
prevents unnecessary Development Master usage but does not make delegated work free.

## Git discipline

- Keep each coherent task in one commit.
- Keep unrelated cleanup out of the commit.
- Commit only after required verification.
- Do not push unless the founder asks.
- Use clear subjects such as `Rushd P01: protect paid activity from reconciliation`.

## Non-negotiable product invariants

- Arabic and English receive equal design quality.
- Financial calculations remain explicit, testable, and honest about available money.
- Canonical money will move toward integer halalas during domain extraction.
- Destructive operations require confirmation and safe containment.
- Existing user data is never silently lost.
- AI never writes canonical finance data directly; it proposes typed actions.
- Do not claim sync, security, production readiness, residency, PWA support, or release readiness before implemented and verified.
- Do not reward spending, underspending, wealth, transaction count, or app opens in Momentum.

## Current phase plan

P00 through P03 are closed. P01's reviewed product baseline is commit `075317ebebd1aa4f366a2ac6fd3f715f748d54fe`; P02 closes at `f80cfc9`, and P03 closes at reviewed product commit `291228c778d0714b343c396d2a37067f5361d8a1`. P01's risk dispositions remain in `docs/baseline/P01-risk-matrix.json`.

Read the current execution position from `docs/implementation/ACTIVE_DELIVERY_PLAN.md` and the relevant contract from `docs/implementation/phase-plan.json`. Ordinary development follows this workflow and does not use the retired P00 state machine.
