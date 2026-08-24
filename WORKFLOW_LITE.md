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
7. expected concise report.

Workers read only what they need. They do not reread the whole governance corpus for every slice.

## Worker report

The Worker returns:

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

P00 is closed. Remaining work follows the phase order in `docs/implementation/phase-plan.json`, but ordinary development no longer uses the P00 state machine. The live P01 risk map is `docs/baseline/P01-risk-matrix.json`; update it as each item changes state.

## P01 — Immediate corruption containment

P01 is split around consequence: stop dangerous mutation first, restore money truth second, then remove remaining misleading behavior.

### Task 1 — Stop dangerous mutation

Outcome:

- prevent paid generated activity from being mutated by plan reconciliation;
- make plan application atomic or visibly blocked;
- validate imports strictly and make them atomic or visibly blocked;
- make settlement atomic and retry-safe;
- make reset export-first, complete, and visibly handle blocked deletion;
- add focused regression coverage.

Fault-injection checks cover partial plan apply, import, and settlement where those operations are enabled.

### Task 2 — Restore money truth

Outcome:

- unpaid reserved commitments affect availability and settlement;
- each goal uses only its own allocation rather than double-counting the vault;
- the legacy vault opening value remains visible once history exists;
- unsafe numeric input is rejected consistently while supporting Arabic and Western numerals;
- Home's displayed period matches its calculation period.

Do not build the complete currency-aware domain here; that belongs to P03.

### Task 3 — Stability and proof

Outcome:

- local-date semantics are corrected or contained;
- historical budget rewriting is prevented;
- weekly pace no longer gives a false answer;
- monthly scheduling cannot silently drop its selected day;
- assignment effective dates and profile revisions are respected or contained;
- stale derived state is guarded;
- mock analytics and harmful gamification incentives are disabled, labeled, or corrected;
- ordinary capture/export/reload works;
- Arabic/English manual QA is recorded;
- every row in `docs/baseline/P01-risk-matrix.json` is fixed, visibly contained, or explicitly made non-authoritative with its final owning phase.
