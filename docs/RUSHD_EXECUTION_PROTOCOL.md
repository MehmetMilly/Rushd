# Rushd Autonomous Implementation Protocol

**Purpose:** Let one long-lived manager run the complete Rushd plan while every phase starts
with clean context, receives independent review, and leaves durable evidence.

**Canonical phase plan:** [`implementation/phase-plan.json`](./implementation/phase-plan.json)

## 1. Roles

### Manager task — Sol high

The manager owns the outcome, sequencing, state machine, review loop, and escalation. It
does not implement product code. The user has explicitly authorized it to create a new
top-level Codex task for each phase in the saved Rushd project, using the local project
checkout, sequentially.

The manager may:

- Read the final plan, phase record, run state, checkpoint/review JSON, targeted diffs,
  and necessary evidence.
- Create and monitor phase implementation tasks.
- Start fresh isolated reviewer tasks and supporting subagents.
- Send exact correction or commit instructions to a phase task.
- Update `.codex/runs/<run-id>/` state/evidence files.
- Run read-only verification and inspect the working tree.

The manager's only writes are ignored run-control/evidence artifacts under that run
directory. It may not stage them or edit product/planning source. The manager may not:

- Implement or edit product source itself.
- Run two product-source write-capable agents at once. Isolated reviewers may write only
  disposable build/test evidence in their own worktrees.
- Read every worker action/log by default.
- Expand scope, revise the product contract, stage unrelated files, publish, deploy,
  expose secrets, or make a legally significant provider decision.

### Phase implementer — Sol high

Each phase begins in a new top-level task with a fresh context and a `/goal` matching that
phase's objective and stopping condition. It owns only the phase's allowed paths. It may
use supporting subagents but remains responsible for integration and evidence.

### Reviewers

- Sol medium: medium-risk UI/foundation review.
- Sol high: financial, storage, migration, sync, auth, AI, security, and release review.
- Sol xhigh: only after two failed correction cycles, conflicting reviewer evidence, or an
  exceptionally hard unresolved defect.
- Terra high: browser execution, reproduction, performance trace, accessibility, and QA
  support.
- Luna medium: inventory, log/evidence packaging, hashes, and schema validation.

Every reviewer is fresh for every attempt and runs in a disposable Codex worktree created
from the implementation checkout's current working-tree snapshot. It may write build/test
artifacts inside that disposable worktree so browser/performance gates can run, but it must
not edit product source; the manager verifies the reviewer worktree has no unexplained
source diff. Durable logs cited by review JSON are written only to the manager-declared
absolute ignored review-evidence directory in the implementation checkout; no other shared
path is writable. This isolation—not a TOML sandbox claim—prevents review activity from
changing product source while preserving evidence after the worktree is archived. The
reviewer returns complete review JSON; the manager validates and persists that exact JSON
under `.codex/runs/` without changing it.

## 2. Durable run layout

Runtime files are local evidence and ignored by Git:

```text
.codex/runs/<run-id>/
  state.json
  state.journal.jsonl
  phases/P00/checkpoint-attempt-01.json
  phases/P00/patch-attempt-01.json
  phases/P00/review-attempt-01.json
  phases/P00/commit-attempt-01.json
  phases/P00/adjudication-attempt-03.json
  tasks/<thread-id>-created-receipt.json
  tasks/<thread-id>-completed-receipt.json
  tasks/<thread-id>-thread-request.json
  tasks/<thread-id>-thread-response.json
  tasks/<thread-id>-turn-request.json
  tasks/<thread-id>-turn-response.json
  tasks/<thread-id>-turn-completed.json
  remediation/P03/regression-P04.json
  final-audits/<audit-id>.json
  logs/P00/*.log
  evidence/P00/*
```

Committed workflow authority lives in:

```text
docs/RUSHD_MASTER_PLAN_FINAL.md
docs/RUSHD_EXECUTION_PROTOCOL.md
docs/RUSHD_PHASE_PROMPTS.md
docs/implementation/phase-plan.json
.agents/skills/rushd-phase-orchestrator/
.codex/agents/*.toml
```

Before a run exists, the complete workflow-authority set above must be present in one
founder-authorized authority-only Git commit. A dirty bootstrap checkout or an authority
path absent from that commit blocks `not_started -> worker_running`; P00 must not absorb the
workflow bootstrap into its product patch.

The manager chooses a unique run ID matching `rushd-YYYYMMDD-slug`, copies
`docs/implementation/state-template.json` to the new run directory,
records the original source baseline and separate committed authority SHA, and uses
`transition-state.mjs` for every transition. Every request declares a canonical
`transition_kind`, exact edge-owned changes, non-empty evidence paths, and SHA-256 hashes.
The script rejects unknown changes and validates all linked artifacts before advancing.
It writes and fsyncs `<state>.pending`, appends and fsyncs the journal event, then atomically
renames state. On restart it may finish only that exact journal-ahead pending rename; any
other state/journal gap, duplicate event ID, or broken hash chain stops the run.
Validation walks every event from `genesis_state_sha256` through the current revision:
revisions are contiguous, `from`/`to` statuses and previous/next hashes join, evidence
still matches its hash, and the tail matches `state.json`.

```bash
node .agents/skills/rushd-phase-orchestrator/scripts/transition-state.mjs \
  <state.json> <transition-request.json>
```

Path policy is deny-first: `protected_paths` always overrides every `allowed_paths` glob.
A broad allowance such as `docs/**` permits unprotected documentation only. Modifying a
protected authority file requires a separate explicit founder-authorized plan revision;
no implementation phase may infer permission from a broader glob. The manager records that
authority with `docs/implementation/plan-amendment-template.json`, validates it, and makes
the amendment in a separate plan-only commit before any affected implementation resumes.
Later workflow-only authority commits are valid only when they are single-parented,
authority-only, carry exactly one approved `PLAN_AMENDMENT_*.json` record, and leave the
phase acceptance/product contract unchanged. Before commit, a fresh isolated reviewer must
return an unqualified `rushd.authority-amendment-review.v1` PASS for a unique immutable
candidate manifest. The manager seals that review, its completed receipt, and the candidate
manifest in `.codex/runs/<run-id>/controller/authority-amendment-approval.json`. Run-state
validation recomputes the committed parent-to-child manifest and requires byte-exact equality
with that reviewed manifest; matching path names without matching file hashes is insufficient.
The validator rejects every other authority change after bootstrap.

## 3. Phase state machine

```text
not_started
  -> worker_running
  -> worker_running (same-task usage-limit turn recovery only)
  -> ready_for_review
  -> reviewer_running
  -> needs_changes -> worker_running
  -> escalated -> worker_running | reviewer_running | human_required
  -> passed_pending_commit
  -> passed_pending_commit -> worker_running (pre-commit reconciliation only)
  -> committed -> worker_running | regression_review | final_audit
  -> regression_review -> regression_review | worker_running | final_audit
  -> final_audit -> final_audit | worker_running | human_required | complete
```

`human_required` is a resumable pause, not a terminal failure. It stores a canonical gate
kind/ID, exact request, at least two safe options, evidence needed, request hash,
`resume_state`, paused task identities, and time. Resume must target exactly that state and
provide a matching hashed `rushd.human-attestation.v1`; arbitrary acknowledgements or a
different phase/gate do not resume work.

Only these terminal run states are valid:

- `complete`: P13 and the final full-repository review passed.
- `failed`: reserved for an unrecoverable technical state with preserved evidence; it is
  not used merely because a test or attempt failed.

## 4. Starting a phase

### Codex task adapter

The portable adapter is an external Codex App Server controller. It performs the documented
JSON-RPC `initialize`/`initialized` handshake, creates tasks with `thread/start` using the
exact `cwd`, model, effort, and sandbox, starts prompts with `turn/start`, consumes streamed
events through `turn/completed`, and uses `thread/read`, `thread/resume`, and
`thread/archive` as needed. The request, response, and completion messages are persisted
unchanged and hashed. The current workflow does not admit an undocumented native Desktop
method. If the App Server controller is not callable and end-to-end tested, record the
structured external gate `ORCHESTRATOR-ADAPTER` and stop—never substitute a same-context or
subagent implementation.

The two App Server sandbox spellings are intentionally different and must match the live
protocol: `thread/start` uses `sandbox: "workspace-write"`, while `turn/start` uses
`sandboxPolicy: {"type":"workspaceWrite", ...}`. Both use `approvalPolicy: "never"`;
the turn sets the exact model, reasoning effort, cwd, and writable root recorded by the
task receipt.

App Server does not create a local-changes worktree. Before a reviewer, adjudicator,
regression reviewer, final auditor, or remediation worker is launched, the manager creates
the exact disposable snapshot with:

```bash
node .agents/skills/rushd-phase-orchestrator/scripts/create-worktree-snapshot.mjs \
  <base-sha> <patch-manifest.json> <new-worktree-path>
```

The task receipt records adapter/method, thread/session/turn IDs, prompt hash, model/effort,
source SHA, worktree path, snapshot-manifest path/hash, and hashes of the exact App Server
thread/turn request/response messages. Receipts are immutable: a completed receipt is a new
artifact which hashes and extends the preserved created receipt and the exact
`turn/completed` event. A review artifact is accepted only when that completed receipt is
fresh, role-correct, targets the checkpoint patch, and reports a clean source diff.

The manager must:

1. Verify every dependency phase is committed.
2. Verify the working tree has no unexplained changes. Preserve pre-existing/user changes;
   never sweep them into the phase.
3. Record the base SHA and allowed/protected paths.
4. Create a new top-level task in the saved Rushd project, local checkout, model
   `gpt-5.6-sol`, reasoning `high`, titled `Rushd Pxx — <short phase title>`.
5. Give it the exact worker prompt plus phase JSON, attempt number, base SHA, allowed paths,
   and checkpoint destination.
6. Wait using compact task snapshots. Do not repeatedly read the full task transcript.

The phase task must call `/goal`/create a Goal itself. The goal is phase-sized: one
objective, explicit acceptance criteria, and a verifiable stop. It is not “finish Rushd.”

### Same-task usage-limit recovery

A preserved external/account `usageLimitExceeded` failure does not consume a phase
attempt and does not authorize a second writer. The manager resumes the same App Server
thread and starts one follow-up turn with the same phase, attempt, base, model, sandbox,
and role. Every original failure event and both receipt lifecycles remain immutable.

Before accepting the follow-up checkpoint, the manager persists and validates a
`rushd.worker-turn-recovery.v1` record. The only allowed self-transition is
`worker_running -> worker_running` with `transition_kind: recover_worker_turn`; it rotates
only `active_worker_receipt_path` from the original failed turn's created receipt to the
successful follow-up turn's created receipt. The record must prove:

- the original `turn/completed` status is `failed` with
  `codexErrorInfo: usageLimitExceeded`;
- original and follow-up receipts have identical run, role, phase, attempt, thread,
  session, source/base, model, effort, and environment identity;
- the follow-up completed receipt extends its own created receipt and reports the source
  diff as explained;
- the canonical patch manifest retains the exact base and patch hash;
- the canonical amendment approval and exact direct-child authority commit are pinned;
- the live checkout from the preserved base is exactly the disjoint union of that sealed
  authority manifest and the unchanged phase patch manifest, with no overlap or extra byte;
  and
- all original/follow-up protocol messages, receipts, completion events, manifest, and
  hashes are transition evidence.

Cross-thread, cross-attempt, unclassified failure, receipt substitution, hash mismatch,
base/patch drift, or any additional state change is rejected. The ordinary
`checkpoint_ready` transition then consumes the successful completed receipt exactly as
before. Checkpoint validation applies the same sealed-authority overlay separation before
comparing the unchanged phase manifest; review, acceptance, correction, and commit gates
are unchanged.

### Founder-attested external-runtime continuation

The one gate `EXTERNAL-P00-PINNED-CHROMIUM` may use `transition_kind:
resume_external_worker` only after the founder selects the recorded safe option and a
separate authority-only amendment is independently reviewed, sealed, and committed. This
does not generalize external execution. It permits the manager to expose the exact
lockfile-pinned Playwright Chromium 151.0.7922.34 outside the worker sandbox at a
localhost-only CDP endpoint using synthetic P00 data, then start one new turn in the same
P00 task, phase, attempt, base, model, effort, sandbox identity, and role.

The manager preserves the prior created/completed receipt and its successful
`turn/completed` final message proving that no checkpoint was produced solely because the
pinned browser was killed in the sandbox. After the follow-up completes, the manager seals
the exact founder attestation, both worker lifecycles, pinned browser/version and endpoint
proof, unchanged-base phase manifest, prior authority approval/commit, new authority
approval/commit, and every protocol artifact in a validated
`rushd.external-worker-continuation.v1` record. The journal transition may rotate only the
paused worker receipt to that follow-up created receipt. Cross-thread, cross-attempt,
unattested or mismatched gates, non-canonical runtime, receipt substitution, hash or patch
drift, authority-chain substitution, or any other state/gate weakening is rejected. The
ordinary full P00 gate, checkpoint, fresh independent review, and commit rules remain
unchanged.

### Same-task commit-sandbox continuation

`workspaceWrite` remains mandatory for every ordinary task turn. A narrowly scoped
exception exists only after a phase is already `passed_pending_commit` and the same phase
task returns a completed, validated receipt whose structured final report proves `.git`
was read-only before staging, no commit was created, the index remained clean, and the
reviewed patch had no unexplained change. The manager must preserve that failed commit
turn and seal `rushd.phase-commit-sandbox-authorization.v1` before dispatching another
turn.

The authorization binds the same run, role, phase, attempt, thread, session, reviewed
base, model, effort, worker receipt, failed commit receipt, exact PASS checkpoint and
review, patch manifest/hash, current sealed authority parent, exact commit subject, exact
changed paths, and the SHA-256 of the bounded continuation prompt. Its only allowed
actions, in order, are:

1. `recompute_reviewed_patch`;
2. `stage_exact_reviewed_paths`;
3. `create_single_parent_phase_commit`; and
4. `report_commit_status`.

Only that authorized follow-up `turn/start` may use
`sandboxPolicy: {"type":"dangerFullAccess"}`. The original `thread/start` identity and
all prior receipts remain immutable. Editing product or authority files, staging an
unreviewed path, amending or rewriting history, pushing, publishing, or deploying are
forbidden. The manager still may not stage or commit the product patch. After completion,
the ordinary `rushd.phase-commit.v1` validator independently proves the single-parent
commit, byte-exact reviewed product manifest after subtracting the sealed authority chain,
subject, checkpoint/review/worker hashes, and absence of unexplained changes. A mismatch
in task, attempt, prompt, capability artifact/hash, failure classification, manifest,
authority parent, or any acceptance gate invalidates the continuation without consuming a
new phase attempt.

The prompt is not free-form: the validator derives one canonical prompt byte-for-byte from
the authorization fields, ordered actions, exact changed paths, and prohibitions, and the
turn input must equal it. Both the checkpoint worker receipt and failed commit receipt must
be canonical files inside the run task directory; the former must equal the checkpoint's
exact worker receipt, and the latter's structured no-commit report must match every
authorization identity field. The authorization must be issued strictly after both the
blocker and PASS-review lifecycles complete, and the elevated turn must start strictly after
authorization.
The sealed parent chain must contain this exact independently approved enabling amendment.
If a separately reviewed correction revision sits above that enabling commit, the preserved
workspaceWrite blocker remains bound to the enabling commit's single parent: the authority
tip that actually existed when the blocker completed. The live authorization parent remains
the latest sealed correction tip. Conflating those two parents invalidates recovery.
Before the phase commit it must equal live HEAD; afterward it must be the actual parent of
the exact authorized subject/product commit. `rushd.phase-commit.v1` cross-links the
authorization path/hash, parent, subject, patch, and changed files. It also requires the
canonical completed receipt for that elevated turn and an exact structured commit report
matching the actual commit SHA, parent, subject, reviewed manifest, clean index and working
tree, changed files, and commit time. The strict order is authorization issuance, elevated
turn creation, actual Git committer time, then elevated turn completion; equality fails at
every boundary, and the declared/report time must denote the same instant as Git metadata.
Removing, substituting, starting early, or mismatching that elevated lifecycle invalidates
the phase commit.

### Pre-commit reconciliation

A phase already at `passed_pending_commit` may reopen as a new attempt only when later sealed
authority-only commits invalidate a phase assumption and the preserved full-gate log proves
that exact compatibility failure. The manager must preserve the prior PASS checkpoint/review
hashes, failing command log, affected phase-owned paths, current authority head, and founder-
approved amendment in `rushd.precommit-reconciliation.v1`. The same phase worker then receives
a new attempt receipt, updates only those named paths, reruns the complete required gate, and
creates a normal new checkpoint. A fresh isolated reviewer reviews that attempt. This path can
never broaden product scope, substitute the worker, weaken acceptance criteria, rewrite the old
PASS artifacts, or reopen committed work.

### Runtime-neutral lifecycle adapter

The controller may use Codex App Server or an equivalent local coding runtime such as
ZCode/GLM. Every task receipt must still record the adapter, immutable session/thread and turn
identities, exact model/effort, source SHA, environment/worktree snapshot, prompt and response
artifact hashes, sandbox-equivalent policy, created/completed timestamps, and clean reviewer
proof. A runtime is valid only when its receipts validate through the same schemas, commands
run in the declared directory, and reviewers cannot edit product source. Adapter identity may
change model routing but never lowers review independence or evidence requirements.

## 5. Checkpoint contract

Before requesting review, the implementer writes a checkpoint matching
`rushd.phase-checkpoint.v1` and returns only its checkpoint locator. The checkpoint includes:

- Run/phase/attempt/status.
- Base SHA, canonical patch-manifest path, and hash of the exact uncommitted patch.
- Every changed path and purpose.
- Every acceptance criterion with pass/fail and evidence.
- Commands, exit codes, summaries, and log paths.
- Manual QA and artifact paths.
- Every structured `mandatory_human_gates` entry from the phase plan, with its matching
  validated attestation. P13 cannot checkpoint without founder-attested `P13-BETA`
  evidence covering at least 28 complete days.
- Risks, deviations, unresolved questions, and unrelated changes observed.

Every command record also contains start/finish UTC timestamps, absolute cwd, runner task
ID, and log SHA-256. Every non-command evidence file is non-symlink, lives under the exact
durable evidence root, and is named in `evidence_hashes`. Self-reported success never passes
a phase without the manager-issued task receipt and later independent review receipt.

The implementer generates the manifest with:

```bash
node .agents/skills/rushd-phase-orchestrator/scripts/compute-patch-hash.mjs \
  <base-sha> <patch-manifest-path>
```

The hash is SHA-256 of canonical JSON containing the base commit and every tracked change,
untracked non-ignored file, deletion, symlink target, executable bit, byte length, and file
content hash, sorted by bytewise path. This is the only valid patch-hash algorithm.

P12-A5's reviewer clause is deliberately recorded as `pending_independent_review` in the
worker checkpoint; the reproducibility/no-open-risk evidence is still required there. Only
the subsequent independent reviewer may turn P12-A5 into a PASS check. This removes the
otherwise circular requirement that a worker checkpoint already contain its later review.

## 6. Independent review

The manager starts a fresh disposable-worktree reviewer task at the tier in the phase
plan. The reviewer receives
only:

- Canonical plan and exact phase record.
- Base SHA, checkpoint path, and exact checkpoint JSON embedded in the prompt (the ignored
  run directory is not assumed to exist in the disposable review worktree).
- One absolute ignored durable review-evidence root in the implementation checkout.
- The working diff and relevant fixtures/evidence.
- Repository instructions.

It does not receive the worker's reasoning transcript or the manager's desired verdict.
It independently validates:

1. Checkpoint schema and patch hash.
2. Changed paths against allowed/protected paths.
3. Every acceptance criterion.
4. Required commands and independent targeted tests.
5. Financial, migration, sync, AI, privacy, RTL/LTR, accessibility, motion, and performance
   constraints applicable to the phase.
6. Unexplained drift and user-change preservation.

The reviewer returns only complete `rushd.phase-review.v1` JSON in its final response,
including its independently run commands and log paths under that durable root. The
manager writes it to the declared review path, verifies the review worktree has no source
edits, and validates review and checkpoint together:

```bash
node .agents/skills/rushd-phase-orchestrator/scripts/validate-artifact.mjs \
  <review.json> <checkpoint.json>
```

Allowed verdicts:

- `pass`
- `needs_changes`
- `blocked`
- `escalate`

“Pass with a known mistake” is invalid. Any reproducible defect, unmet acceptance item,
missing required evidence, unexplained change, regression, or undocumented deviation is
`needs_changes`. Purely optional ideas that are outside the phase contract are labeled
non-blocking and do not cause an infinite perfection loop.

Verdict routing:

- `needs_changes` -> correction loop.
- `blocked` -> classify it. Missing evidence becomes `needs_changes`; a listed external
  prerequisite becomes `human_required`; an inconsistent block goes to adjudication.
- `escalate` -> Sol-xhigh adjudication immediately.
- Adjudication `implementation_violation` -> correction loop.
- Adjudication `finding_invalid` -> a fresh reviewer of the unchanged attempt; an
  adjudicator never directly passes a phase.
- Adjudication `human_required` -> structured human gate.

## 7. Correction loop

For `needs_changes`:

1. Manager sends only numbered findings and the allowed correction scope to the same phase
   task.
2. Worker creates attempt N+1 and reruns the affected checks plus the full phase gate.
3. Manager starts a new reviewer; it never reuses the prior reviewer context.

After two failed correction cycles, start one Sol-xhigh adjudicator. It determines whether
the contract is achievable, the defect diagnosis is wrong, or a genuinely new decision is
required. The manager does not lower acceptance criteria to escape a hard problem.

The adjudicator returns only `rushd.phase-adjudication.v1` JSON matching the committed
template. The manager persists and validates it. A committed phase reopened by a later
finding receives an additive remediation commit owned by that phase; history is never
rewritten. Rerun the owning phase's full gate, every downstream gate affected by the diff,
and all five final audits.

### Reopening committed work

The run state represents a later-phase or final-audit blocker owned by a committed phase
with a non-null `remediation` object. It records the owner phase, trigger artifact/finding
IDs, interrupted return phase/status/task/attempt, and **every later already-committed
phase** as an ordered required-regression list. It also seals the interrupted patch
manifest/hash, pre-remediation HEAD, owner commit count, and original release candidate.
The manager pauses the interrupted worker and starts a fresh Sol-high `remediation_worker`
in a clean disposable worktree at current HEAD. The remediation receives the normal
checkpoint/fresh-review/commit loop. Its single-parent additive commit is fast-forwarded
into the implementation checkout only if the sealed interrupted file manifest remains
byte-for-byte unchanged; overlapping changes require correction or a human gate, not a
silent stash/reset. The phase-commit artifact must prove the Git parent, committed manifest,
review hash, worker receipt, and exact commit subject. The owner history must grow by one.

After the remediation commit, state enters `regression_review`. Fresh isolated reviewers
rerun the complete gate of **every** required downstream committed phase in order, without
source changes. Every pass has a hashed `rushd.regression-review.v1` artifact and a fresh
completed reviewer receipt targeting the remediation commit. State may become
`ready_to_resume` only when the passed list and result list exactly equal the required list.
`transition-state.mjs` refuses to clear remediation earlier. The manager then resumes the
recorded phase worker at the new base with its sealed patch intact, or requires a different
clean HEAD release candidate, clears all old final/full/publication/postdeploy results, and
restarts all five final audits. This deliberately
reruns more than a targeted impact guess so a later fix cannot silently invalidate an
earlier promise.

If a downstream regression returns `needs_changes`, its artifact is appended to
`failed_regression_results`; it is never discarded or relabeled. A fresh isolated
remediation worker starts at the latest remediation commit, the round increments, and the
normal checkpoint/review loop produces one additional single-parent additive owner-phase
commit. Passed/result prefixes reset, and the complete ordered downstream list reruns from
the beginning against that new commit. Each extra round therefore retains one failed
regression artifact and adds one owner-phase commit.

## 8. Passing and committing

A phase may become `passed_pending_commit` only when:

- Checkpoint and review schemas validate.
- Patch hashes match.
- All changed paths are allowed and protected paths are untouched unless explicitly in
  the phase.
- All acceptance and required tests pass.
- Manual QA evidence exists when required.
- No blocker, deviation, or unexplained drift remains.

The manager then sends the phase task a commit instruction. The phase task must:

1. Recompute and verify the patch hash.
2. Stage exact reviewed paths; never use `git add -A`.
3. Commit with `Rushd Pxx: <phase outcome>`.
4. Return the commit SHA and a clean/unexplained-change report.

The manager persists and validates `rushd.phase-commit.v1`. Validation requires a real
single-parent Git commit whose parent is either the reviewed base or the exact tip of a
sealed, authority-only, independently approved amendment chain descended from that base.
When that chain exists, validation subtracts its disjoint authority manifest and requires
the parent-to-phase-commit product manifest to equal the checkpoint patch hash/files
byte-for-byte; any non-authority overlay, unsealed amendment, overlap, or extra product byte
is rejected. The subject is `Rushd Pxx: ...`, checkpoint/review/worker-receipt hashes match,
and no unexplained tree change remains. State records the
artifact path/hash with `commit_sha`, `patch_sha256`, `attempt`, `committed_at`, and
`purpose`; the transition can append exactly one current-phase entry. It archives the
phase task and immediately starts the next phase. After P13 and after any audit remediation,
it records the current clean HEAD as `release_candidate_sha`; all final audits and
post-deployment verification must name that exact SHA.

No push, pull request, deployment, DNS change, or public release occurs unless separately
authorized by the founder or by the explicit P13 human gate.

## 9. Manager context discipline

By default the manager reads only:

- `state.json`
- The next phase record
- Checkpoint JSON
- Review JSON
- `git diff --stat` / `git show --stat`
- Targeted diff hunks cited by the reviewer

It opens raw logs, broad diffs, screenshots, or a task transcript only when:

- A command failed.
- Evidence conflicts.
- Reviewer confidence is not high.
- A finding cites a particular artifact.
- The next phase depends on a detailed contract decision.

This is the key to keeping the long-lived manager useful across days of work.

## 10. External/human gates

The manager proceeds autonomously through all local, reversible implementation work. It
sets `human_required` and asks the founder only when necessary for:

- Production provider region/residency/legal choice.
- Founder-owned Supabase, PowerSync, OpenAI, hosting, analytics, or error-monitoring account
  creation, billing, or credentials.
- Real domain/DNS changes or public deployment.
- Sending real personal finance/audio data to external services.
- Destructive migration/reset of non-synthetic data.
- Legal/privacy/terms approval or beta participant coordination.
- A genuine product decision not answered by the final master plan.
- A physical-device/manual gate the manager cannot perform through an available connected
  device. The request uses `rushd.human-attestation.v1`, not a casual yes/no.

The request must state the exact action, why it is required now, at least two safe options,
required evidence, canonical gate kind/ID, requesting task, UTC time, and canonical request
hash. “I need clarification” is not sufficient. Manual gates must match the exact
phase-plan requirement. External gates are limited to `ORCHESTRATOR-ADAPTER`, `P13-BETA`,
`PUBLICATION`, or an explicit `EXTERNAL-*` authority record.

The four-week P13 beta is the mandatory structured phase gate `P13-BETA` and a durable
`human_required`/monitoring pause, not an active worker task. Resume requires the exact
phase-plan request and a founder attestation whose frozen evidence spans at least 28
complete days. The P13 checkpoint requires that artifact, so review, commit, final state,
and completion revalidate it. After P13 is
committed, run the five final audits and full gate, then ask the founder for the single
publication/DNS authorization. A final launch task performs deployment and post-deployment
smoke/rollback verification before `complete`. Persist and validate the exact
`full-gate-template.json`, `publication-authority-template.json`, and
`post-deployment-template.json` artifacts; state stores their paths and release SHA.

## 11. Final audit

After P13 implementation work, create fresh independent audits for:

1. Finance and migration correctness.
2. Auth/sync/security/privacy.
3. AI actions and eval integrity.
4. Bilingual UX/accessibility and visual/motion quality.
5. Performance/PWA/release operations.

Run final auditors sequentially in the exact canonical order; each
`final_audit -> final_audit` appends exactly one validated result, closes its completed
auditor receipt, and starts at most one fresh next auditor without changing the release
SHA. Every audit runs the exact commands in `workflow-lib.mjs` and exact check IDs in the
phase plan, with distinct hashed logs/evidence. Any single blocker
returns the run to the owning phase through the structured additive-remediation path above.
The goal completes only when all five `rushd.final-audit.v1` artifacts pass against the same
release SHA, a separately persisted full-gate artifact passes on that SHA, founder
publication authority is recorded, post-deployment verification passes, and repository
state is explained. The full gate, publication authority, and postdeployment summaries must
each point to their exact schema and matching artifact hash; publication requires the
hashed founder `PUBLICATION` attestation, and postdeployment requires an HTTP(S) URL,
launch-worker receipt, exact smoke/update/rollback checks, and UTC time. A completion
transition has no mutable payload and merely proves the already-recorded gates. Exact
templates live in `docs/implementation/`.

Any edit to the orchestration scripts, schemas, templates, or this protocol must pass both
named workflow self-checks before the authority commit or a real run:

```bash
node .agents/skills/rushd-phase-orchestrator/scripts/self-test.mjs
node .agents/skills/rushd-phase-orchestrator/scripts/transition-self-test.mjs
```

`self-test.mjs` covers artifact/path/gate/regression-correction rules and invokes
`transition-self-test.mjs`; the latter remains independently runnable to prove the full
human pause/resume and contiguous journal-chain behavior.
