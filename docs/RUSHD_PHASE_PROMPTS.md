# Rushd Manager and Phase Prompts

These prompts are execution artifacts. The created manager task should use the manager
prompt; it fills the placeholders for every later task from `phase-plan.json`.

## 1. Manager goal prompt

```text
Create a Goal and act as the long-lived implementation manager for Rushd.

Objective:
Complete every phase in docs/implementation/phase-plan.json in dependency order, with a
fresh top-level Sol-high implementation task for every phase, independent review of every
attempt, exact evidence, and all final release gates passing.

First read, in order:
1. AGENTS.md
2. docs/RUSHD_MASTER_PLAN_FINAL.md
3. docs/RUSHD_EXECUTION_PROTOCOL.md
4. docs/implementation/phase-plan.json
5. .agents/skills/rushd-phase-orchestrator/SKILL.md

The founder has explicitly authorized you to create a separate top-level Codex task for
each implementation phase in the saved Rushd project, using the local project checkout,
model gpt-5.6-sol, reasoning high. Do not ask the founder to start phases manually.

You are the manager, not the product implementer. Never edit product/planning source; your
only writes are ignored run-control/evidence files under the current run directory. Run
only one product-source write-capable task at a time. Every new phase starts in a fresh
top-level task; corrections within the same phase return to that phase task. The phase task
must create its own Goal.

Use compact task waits/snapshots. Read state, checkpoint/review JSON, diff stats, and only
targeted evidence by default. Do not mirror the worker transcript into your context.

After every checkpoint, create the disposable worktree with
create-worktree-snapshot.mjs from the exact checkpoint manifest, then start a fresh reviewer
task there. Use Sol medium for medium-risk review
and Sol high for hard review. Verify the review worktree has no product-source edits. Use
Terra high for test/browser/trace/accessibility support; Luna medium for mechanical
evidence; Sol xhigh only after two failed correction cycles or conflicting hard evidence.

Never advance on self-reported success. Any reproducible defect, unmet acceptance item,
missing required evidence, unexplained change, regression, or undocumented deviation is a
FAIL/needs_changes. Send numbered findings to the same phase worker, then use a fresh
reviewer for the next attempt. Do not weaken a gate to escape a difficult problem.

On PASS, have the phase worker stage only the exact reviewed paths and make one local phase
commit. Require a validated phase-commit artifact proving its parent, manifest,
checkpoint/review/receipt hashes, and exact subject before updating state and starting the
next fresh phase task.

Preserve all pre-existing user work and protected files. Do not push, publish, deploy,
change DNS, create paid accounts, expose secrets, or use real finance/audio data without
the explicit human gate. When a genuine external gate is reached, record human_required
and ask one exact actionable question; otherwise continue autonomously.

Use documented App Server thread/start and turn/start. Persist the exact hashed
thread/turn requests and responses, then preserve the created receipt and write a separate
completed receipt bound to the hashed turn/completed event. Create
.codex/runs/<RUN_ID>/state.json from the template and persist every transition through
transition-state.mjs and its append-only journal.
Mark the Goal complete only after P13, all five final independent audits, and the full
repository gate pass; the founder's exact publication authorization and the matching
post-deployment smoke/update/rollback proof are recorded; and there are no unexplained
changes or open P0/P1 risks.
```

## 2. New phase implementation task

```text
Create a Goal for Rushd phase <PHASE_ID>: <PHASE_TITLE>.

Goal objective:
<OBJECTIVE>

Stopping condition:
Every acceptance criterion below passes, every required command and manual gate has valid
evidence, a complete rushd.phase-checkpoint.v1 artifact is written, and no unrelated or
protected path is changed. Do not call the phase passed; only an independent reviewer can.

Read:
- AGENTS.md
- docs/RUSHD_MASTER_PLAN_FINAL.md
- docs/RUSHD_EXECUTION_PROTOCOL.md
- the <PHASE_ID> record in docs/implementation/phase-plan.json
- .agents/skills/rushd-phase-orchestrator/SKILL.md

Run context:
- Run ID: <RUN_ID>
- Attempt: <ATTEMPT>
- Base SHA: <BASE_SHA>
- Allowed paths: <ALLOWED_PATHS>
- Protected paths: use the global protected_paths list in phase-plan.json
- Checkpoint path: <CHECKPOINT_PATH>
- Patch manifest path: <PATCH_MANIFEST_PATH>
- Worker task receipt path: <WORKER_RECEIPT_PATH>
- Log/evidence root: <PHASE_EVIDENCE_ROOT>
- Required skills: <REQUIRED_SKILLS>

You own this phase. You are not alone in the repository: preserve user changes and do not
revert, stage, or rewrite work outside your ownership. Use apply_patch for source edits.
Read and use every required skill before phase actions. Use supporting subagents according
to the project routing, but integrate and verify all work yourself. Only one product-source
writer may edit the shared implementation checkout at a time.

Acceptance criteria:
<ACCEPTANCE_JSON>

Required commands:
<COMMANDS>

Required manual QA:
<MANUAL_QA>

Implement the smallest complete solution that satisfies the phase contract. Every command
record must include exact runner ID, absolute cwd, UTC start/finish, unique log path and log
SHA-256; hash every other cited evidence file in evidence_hashes. Save raw logs and
artifacts under the run directory. Generate the canonical patch manifest with the
repository skill script, store its path/hash in checkpoint JSON matching the template, and
validate the checkpoint. Do not
commit, push, publish, or deploy.

Your final response must be exactly:
PHASE_CHECKPOINT <PHASE_ID> <ATTEMPT> ready_for_review <CHECKPOINT_PATH>
```

## 3. Independent reviewer

```text
Review Rushd phase <PHASE_ID>, attempt <ATTEMPT>, inside the disposable review worktree.
Do not edit product source and do not assume the implementer's conclusion is correct.

Read:
- AGENTS.md
- docs/RUSHD_MASTER_PLAN_FINAL.md
- docs/RUSHD_EXECUTION_PROTOCOL.md
- the exact phase record in docs/implementation/phase-plan.json
- checkpoint locator: <CHECKPOINT_PATH>
- checkpoint JSON embedded by the manager: <CHECKPOINT_JSON>

Starting point: <BASE_SHA>
Review output: <REVIEW_PATH>
Durable review evidence root (the only writable shared-checkout path): <REVIEW_EVIDENCE_ROOT>
Completed reviewer receipt path: <REVIEWER_RECEIPT_PATH>

Validate the checkpoint schema and exact patch hash. Inspect the diff from the base SHA,
verify every changed path is allowed, and confirm protected/user changes are untouched.
Independently run the required checks and targeted adversarial checks. Compare every
acceptance criterion with actual behavior and evidence, including applicable finance,
migration, sync, AI, privacy, bilingual RTL/LTR, accessibility, motion, and performance
contracts.

Run tests/builds in the disposable worktree. Write only command logs and evidence cited by
your JSON to <REVIEW_EVIDENCE_ROOT>; do not write any other path in the shared implementation
checkout.

Use pass only when evidence is sufficient and no reproducible mistake or missing required
evidence exists. Every blocking finding must include a stable ID, severity, owning phase,
exact location, hashed evidence, and one actionable required change. Put genuinely optional out-of-scope ideas in
non_blocking_suggestions so they cannot create an infinite perfection loop.

Return only the complete rushd.phase-review.v1 JSON object in your final response. The
manager knows <REVIEW_PATH>, will persist it unchanged, verify your worktree has no source
diff, and validate it together with the checkpoint.
```

## 4. Correction request

```text
Correct Rushd phase <PHASE_ID> using only blocking findings <FINDING_IDS> from
<REVIEW_PATH>.

Do not broaden scope, weaken acceptance criteria, or revert unrelated work. Preserve the
same phase ownership. Produce attempt <NEXT_ATTEMPT>, rerun every affected check plus the
complete required phase gate, recompute the patch hash from the original phase base SHA,
and write <NEXT_CHECKPOINT_PATH>.

Your final response must be exactly:
PHASE_CHECKPOINT <PHASE_ID> <NEXT_ATTEMPT> ready_for_review <NEXT_CHECKPOINT_PATH>
```

## 5. Commit request after PASS

```text
Phase <PHASE_ID> attempt <ATTEMPT> passed independent review at <REVIEW_PATH>.

Before committing, verify the current patch SHA-256 still equals the reviewed checkpoint
hash and that no unexplained path changed after review. Stage only the exact reviewed paths;
never use git add -A. Commit with:

Rushd <PHASE_ID>: <PHASE_OUTCOME>

Write and validate <PHASE_COMMIT_ARTIFACT> from phase-commit-template.json. Do not push or
publish. Return exactly:
PHASE_COMMIT <PHASE_ID> <COMMIT_SHA> <PHASE_COMMIT_ARTIFACT>
```

## 6. Sol-xhigh escalation reviewer

```text
Adjudicate the unresolved Rushd phase <PHASE_ID> after two correction cycles inside a
disposable review worktree. Do not edit product source.

Use only the canonical plan, phase contract, current diff, checkpoints, reviews, and raw
evidence necessary to resolve the disputed findings. Determine one of:

1. The implementation still violates the contract: give the minimal exact correction.
2. The review finding is invalid: prove why with reproducible evidence.
3. The contract is internally inconsistent or requires new authority: state the single
   exact founder decision and what safe work can continue.

Do not relax a valid finance, data-loss, sync, auth, AI, accessibility, or security gate.
Return only a complete rushd.phase-adjudication.v1 JSON object matching
docs/implementation/adjudication-template.json. The manager will persist it at
<ADJUDICATION_PATH> and validate it.
```

## 7. Committed-phase remediation

Before final audits, committed-phase remediation uses this additional prompt:

```text
Remediate committed Rushd phase <OWNER_PHASE> for blocker(s) <FINDING_IDS> from
<TRIGGER_ARTIFACT> in the isolated clean worktree at <PRE_REMEDIATION_HEAD>.

The interrupted <RETURN_PHASE> patch is sealed at <RETURN_SNAPSHOT_MANIFEST>; do not read,
edit, discard, or incorporate it. Own only <OWNER_PHASE> allowed paths. Produce a normal
checkpoint and fresh independent review, then one single-parent additive commit with kind
remediation and subject `Rushd <OWNER_PHASE>: <OUTCOME>`. The manager will fast-forward it
only if the interrupted file manifest is unchanged. Do not rewrite history or lower gates.
```

Each downstream regression reviewer receives the remediation commit and exactly one target
phase. It reruns that target's complete required command/acceptance gate without source
changes and returns `rushd.regression-review.v1` with a completed clean reviewer receipt.
Every later committed phase is reviewed in dependency order; no impact-based omission is
allowed.

If a downstream reviewer returns `needs_changes`, persist that failed artifact and start a
fresh isolated remediation-worker round at the latest additive commit. Produce another
reviewed additive owner-phase commit, reset all downstream pass/result prefixes, and rerun
every required downstream phase in order from the beginning; never skip directly to the
failed target.

P13-BETA is not prose-only. Before the P13 checkpoint can be ready, run the exact
structured phase-plan human gate and attach the founder attestation proving at least 28
complete days of frozen controlled-beta evidence, including any required reduced-scope
rerun.

## 8. Final five-audit prompts

Each final auditor runs in a fresh disposable worktree and receives the run ID, audit ID,
release candidate SHA, final plan, phase commits, relevant evidence, and its absolute
durable `.codex/runs/<RUN_ID>/evidence/final-audits/<AUDIT_ID>` root—not prior auditors'
conclusions. It returns only a complete `rushd.final-audit.v1` JSON object matching
`docs/implementation/final-audit-template.json`; the manager persists it at
`.codex/runs/<RUN_ID>/final-audits/<AUDIT_ID>.json` and validates it. Use the exact audit
command set from workflow-lib.mjs, the exact check IDs from phase-plan.json, distinct hashed
logs/evidence, and the completed clean auditor receipt. Do not read prior audit verdicts.

### Finance and migration

```text
Audit deterministic financial formulas, cycles/dates/currency, plans versus actuals,
reconciliation, returns/corrections, allocations, legacy migration, import/export,
settlement, idempotency, and rollback. Treat any misstatement or data-loss possibility as
blocking. Use audit_id `finance_migration` and identify the owning phase for every blocker.
```

### Auth, sync, security, and privacy

```text
Audit ownership/RLS, local identity separation, guest merge, conflict recovery,
idempotency, offline convergence, sessions/deletion/export, secrets, logging/telemetry,
backup/PITR, incident/rollback, and privacy claims. Treat silent loss, cross-account access,
or raw finance leakage as blocking. Use audit_id `auth_sync_security_privacy`.
```

### AI

```text
Audit proposal authority, schemas, deterministic validation, stale-read protection,
confirmation/undo, Arabic/English/mixed eval coverage, ambiguity, prompt injection,
gateway retention/redaction/rate limits, offline behavior, and kill switch. Treat any
unconfirmed canonical write or invented financial result as blocking. Use audit_id `ai`.
```

### Bilingual UX, accessibility, and motion

```text
Audit every locked destination and core journey in Arabic RTL and English LTR across
phone/tablet/laptop, keyboard/touch/screen reader, zoom, Full/Balanced/Reduced motion, and
visual hierarchy. Treat inaccessible controls, changed mental model, lost input, or
motion-dependent meaning as blocking. Use audit_id `bilingual_ux_accessibility_motion`.
```

### PWA, performance, and release operations

```text
Audit install/update/offline lifecycle on physical targets, realistic-ledger performance,
interaction/motion traces, memory/leaks, reproducible build, CI, monitoring, backup/restore,
staged rollout, rollback, support diagnostics, and truthful release claims. Treat failed
offline recovery, stale mixed-version app state, or missing operational recovery as
blocking. Use audit_id `pwa_performance_operations`.
```
