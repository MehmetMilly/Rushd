---
name: rushd-phase-orchestrator
description: Run and verify Rushd's autonomous phased implementation workflow. Use when managing a Rushd implementation phase, launching a fresh phase task, producing or reviewing a phase checkpoint, correcting a failed phase, committing a reviewed phase, advancing the implementation run, or performing the final multi-audit release gate.
---

# Rushd Phase Orchestrator

Use the repository's committed phase contract and keep the long-lived manager's context
small. Never replace independent verification with a worker's summary.

## Load authority

Read these files before taking a workflow action:

1. `AGENTS.md`
2. `docs/RUSHD_MASTER_PLAN_FINAL.md`
3. `docs/RUSHD_EXECUTION_PROTOCOL.md`
4. `docs/implementation/phase-plan.json`

Read `docs/RUSHD_PHASE_PROMPTS.md` only when constructing a manager, worker, reviewer,
correction, commit, escalation, or final-audit prompt.

## Select the operation

- **Bootstrap authority:** refuse to start until every workflow-authority file is in one
  founder-authorized authority-only commit and the non-run working tree is clean.
- **Start a run:** choose a run ID matching `rushd-YYYYMMDD-slug`, copy
  `docs/implementation/state-template.json` to `.codex/runs/<run-id>/state.json`, fill
  the baseline, and record `not_started`.
- **Start a phase:** verify dependencies and repository state, then use the documented App
  Server `thread/start` + `turn/start` controller to create one fresh Sol-high top-level
  local-project implementation task. Persist and hash the exact thread/turn
  requests/responses and an immutable created receipt.
- **Review an attempt:** validate its checkpoint, then create a fresh reviewer task in a
  disposable worktree from the exact manifest using `create-worktree-snapshot.mjs` at the
  declared tier. Write a separate completed receipt extending the preserved created receipt
  and hashed `turn/completed` event before accepting review.
- **Correct an attempt:** send only numbered blocking findings to the same phase task and
  require a new checkpoint attempt.
- **Recover an interrupted worker turn:** only for a preserved App Server
  `usageLimitExceeded` event, resume the same thread/phase/attempt, validate a
  `rushd.worker-turn-recovery.v1` record, and use the journaled `recover_worker_turn`
  self-transition to rotate only the active created receipt before checkpoint acceptance.
  Pin the reviewed recovery-amendment commit and prove the live checkout is exactly its
  disjoint authority delta plus the worker's unchanged preserved patch. Validate the
  checkpoint through the same overlay separation before review.
- **Resume an authorized external-runtime gate:** only for
  `EXTERNAL-P00-PINNED-CHROMIUM`, require the exact founder attestation, preserve the
  completed no-checkpoint sandbox blocker, and resume the same P00 thread/attempt after the
  manager exposes Playwright Chromium 151.0.7922.34 at a localhost-only CDP endpoint with
  synthetic data. Seal the follow-up created/completed lifecycle, pinned-runtime proof,
  unchanged base, phase manifest, and both independently approved authority commits in a
  `rushd.external-worker-continuation.v1` record, then use only the journaled
  `resume_external_worker` transition. It may rotate the paused worker receipt but may not
  change the thread, phase, attempt, routing, acceptance criteria, or any other gate.
- **Commit a workflow amendment:** require a fresh isolated unqualified review PASS, seal
  its unique candidate manifest and completed reviewer receipt in the canonical
  `rushd.authority-amendment-approval.v1` record, and prove the committed manifest is
  byte-exactly the approved manifest. Path-set equality alone is never approval.
- **Commit a phase:** only after PASS; persist `rushd.phase-commit.v1`. Its single parent is
  the reviewed base or the exact tip of a sealed authority-only amendment chain descended
  from that base. In the latter case subtract that disjoint authority overlay and require
  the parent-to-commit product manifest to match the reviewed checkpoint byte-for-byte.
  Verify exact checkpoint/review/receipt hashes, then append exactly one state record. If
  and only if the same phase task first returns a preserved completed receipt proving that
  `workspaceWrite` made `.git` read-only before staging, seal a
  `rushd.phase-commit-sandbox-authorization.v1` and resume that same task with
  `dangerFullAccess` for the four enumerated commit-only actions. Bind the authorization to
  the exact prompt, PASS checkpoint/review, manifest, authority parent, failed receipt,
  worker identity, and commit subject; reject every source edit, extra staged path, history
  rewrite, task/attempt substitution, or publication action. Derive the prompt canonically,
  require canonical task-root receipts and post-prerequisite timestamps, require the exact
    enabling authority commit/approval, and cross-link the authorization plus its canonical
    completed elevated-turn receipt and exact clean commit report to the actual phase commit
    parent, subject, manifest, changed files, and actual Git committer time, strictly between
    the elevated turn's creation and completion.
- **Advance:** record the commit and immediately start the next fresh phase task.
- **Escalate:** after two failed correction cycles, use one Sol-xhigh adjudicator.
- **Remediate committed work:** seal the interrupted patch, use a clean remediation
  worktree, make one additive reviewed commit, preserve the interrupted files while
  fast-forwarding it, then attach a fresh regression-review artifact for every later
  committed phase in order before resuming. Final-audit remediation must use a new release
  candidate and discard all stale release results. A failed downstream regression is
  retained and starts a fresh remediation round with another additive commit; reset and
  rerun the complete ordered downstream list.
- **Finish:** append the five final audits one at a time in canonical order, then record the
  full gate, exact founder publication attestation, and postdeployment proof before the
  payload-free `complete` transition.

## Preserve context and ownership

- Run one product-source write-capable task at a time. The manager writes only ignored run
  control; reviewers write only disposable worktree evidence.
- Use fresh top-level context for each new phase; reuse a phase task only for corrections
  and its reviewed commit.
- Use fresh isolated reviewer context/worktree for every attempt and verify it makes no
  product-source edits.
- Read `state.json`, checkpoint/review JSON, diff stats, and targeted cited evidence by
  default. Open raw logs or broad transcripts only when evidence conflicts or fails.
- Preserve all user/pre-existing changes. Never stage with `git add -A`.
- Apply path rules deny-first: every protected path overrides every allowed-path glob.
- Never push, deploy, provision paid services, expose secrets, or use real finance/audio
  data without the explicit human gate.

## Model routing

- Manager and implementer: `gpt-5.6-sol`, high.
- Medium-risk reviewer: `gpt-5.6-sol`, medium.
- Hard reviewer: `gpt-5.6-sol`, high.
- Escalation only: `gpt-5.6-sol`, xhigh.
- Browser/test/trace support: `gpt-5.6-terra`, high.
- Mechanical evidence: `gpt-5.6-luna`, medium.

## Validate artifacts

Run:

```bash
node .agents/skills/rushd-phase-orchestrator/scripts/validate-artifact.mjs <path>
```

Generate phase hashes only with `compute-patch-hash.mjs <base-sha> <manifest-path>`. Move
run state only with `transition-state.mjs <state.json> <transition-request.json>`. Validate
the plan before starting the run, then every state/checkpoint artifact. Validate a review
with both paths: `validate-artifact.mjs <review.json> <checkpoint.json>`. A hash mismatch,
unknown criterion, invalid status, unallowed path, missing evidence, or unexplained drift
blocks advancement.

After changing this skill, its scripts, templates, or state protocol, run both workflow
self-checks before any authority commit or real run:

```bash
node .agents/skills/rushd-phase-orchestrator/scripts/self-test.mjs
node .agents/skills/rushd-phase-orchestrator/scripts/transition-self-test.mjs
```

The first covers artifact/path/gate/correction policies and invokes the second; the second
is also runnable directly for the complete human pause/resume, authorized external-runtime
continuation, adversarial rejection, and journal-chain cases.

Every transition request uses a canonical `transition_kind`, a strict edge-specific change
set, non-empty evidence, and evidence hashes. Do not hand-edit state or journal. The
transition script uses a fsynced pending-state + journal-first protocol and only repairs the
one provable journal-ahead pending rename. Validation walks the full contiguous
revision/status/previous-next hash chain from `genesis_state_sha256`, including evidence
hashes; a valid tail cannot hide a broken middle event.

Command receipts require exact canonical commands, independent runner task ID, absolute
cwd, UTC start/finish, unique non-symlink log, and SHA-256. Other evidence must stay inside
the role's durable root with a matching `evidence_hashes` entry. P12-A5 remains
`pending_independent_review` at checkpoint and becomes PASS only in the fresh review.
Every phase-plan `mandatory_human_gates` entry is also checkpoint-blocking. In particular,
P13 requires the exact founder-attested `P13-BETA` period of at least 28 days.

## Pass rule

PASS requires every acceptance item, required command, manual gate, path constraint,
artifact schema, and applicable product invariant to pass. Any reproducible defect or
missing required evidence is `needs_changes`. Optional out-of-scope suggestions do not
block and must not create an infinite polish loop.
