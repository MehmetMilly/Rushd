# Rushd P03 Task D: storage/sync contract and repository conformance

Implement Task D in `/Users/mehmet/Desktop/Rushd` on branch
`codex/rushd-rebuild-plan`. The reviewed product baseline is `ca140bb`; begin
from the clean current HEAD containing this prompt/status handoff above that
baseline, and record that exact starting SHA as `TASK_BASE` before editing.
You are the only product-source writer for this task. Use Muse Spark 1.3 contributor-free in
OpenCode with `--variant high`; this is the preferred cheap route for a large,
bounded contract task. Do not silently switch to a paid model or endpoint. If
that route is unavailable, stop and report the availability blocker. Record the
actual model, provider route, and reasoning variant in the final report. Sol
High owns integration and will arrange an independent data/sync review because
an ambiguous ownership, ordering, or retry contract can cause silent loss or
duplication later.

## Outcome

Finish P03 by freezing the provider-neutral contract that P04 local persistence
and P08 account sync must implement:

- identity and repository-scope separation for guest, account, book, device,
  operation, and entity IDs;
- server-owned authorization boundaries that cannot be forged through command
  payloads or client-supplied ownership fields;
- versioned operation, receipt, outbox, delivery, cursor/checkpoint, tombstone,
  and conflict records;
- deterministic ordering, idempotency, retry, and uncertain-commit semantics;
- explicit guest merge and sign-out/cache-erasure safety decisions;
- a reusable repository conformance suite exercised by the existing in-memory
  adapter;
- an evidence map from every P03 acceptance item to production tests or the
  approved ADR section that owns it.

This task defines and proves contracts. It does not add IndexedDB, a service
worker, authentication, cloud networking, RLS, Supabase, PowerSync, migrations,
or a sync daemon. Those implementations remain P04/P08 scope.

## Read first

Read only the sources needed for this task:

1. `AGENTS.md` and `WORKFLOW_LITE.md`.
2. `docs/implementation/P03_EXECUTION_PLAN.md`, especially Task D and the
   command/persistence architecture decisions.
3. `docs/RUSHD_MASTER_PLAN_FINAL.md` section 9's application/local-data and
   cloud/sync rules, section 10's data/sync resilience gates, and the P03/P04/P08
   phase paragraphs.
4. `docs/implementation/phase-plan.json` for P03-A4, P03-A5, P03-A6, allowed
   paths, and required commands.
5. `docs/implementation/ACTIVE_DELIVERY_PLAN.md` for current routing and the
   reviewed Task C result.
6. `src/domain/contracts/{identity,commands,repository,canonical,index}.ts`,
   `src/application/commands/{preview,execute,index}.ts`,
   `tests/domain/support/in-memory-repository.ts`, and the existing atomicity,
   idempotency, command-safety, and property suites.
7. The current P03 sections of `docs/architecture.md` and `docs/data-model.md`.

Treat existing tests and worker reports as leads, not authority. Preserve all
reviewed A–C finance semantics at `a047a60`, especially revision-confirmed
commands, immutable correction families, exact retries, fixed-clock append
ordering, and typed no-write failures.

Check `HEAD` and `git status` before editing. You are not alone in the
workspace. Preserve every unrelated edit and stage only files you own.

## Ownership

Own the complete Task D contract and proof slice:

- necessary extensions in `src/domain/contracts/{identity,commands,repository,index}.ts`;
- focused new provider-neutral modules under `src/domain/sync/**` or
  `src/application/sync/**` when separating policy from storage ports improves
  the public contract;
- narrowly necessary adaptations to `src/application/commands/{execute,index}.ts`;
- the reusable conformance harness and in-memory reference adapter under
  `tests/domain/support/**`;
- focused `tests/domain/**` and bounded `tests/property/**` coverage;
- Task D updates to `docs/architecture.md` and `docs/data-model.md`;
- narrowly necessary lint, typecheck, production-source, or Vitest discovery
  configuration already allowed by the P03 phase contract.

Keep the command handlers and A–C finance derivations unchanged unless a
contract adaptation is strictly necessary and behavior-preserving. Keep
`src/data/legacy-v1/**`, the Vue/UI path, IndexedDB, import/export, service
worker, manifests, auth clients, provider SDKs, environment files, and network
code untouched.

## 1. Identity and repository scope

Define public, serializable types that keep these concepts separate:

- a device-local guest identity;
- an authenticated account identity;
- a device/install identity;
- the identity-scoped local repository/database namespace;
- book and entity IDs inside that scope;
- operation/outbox IDs used for exact retry and replication.

The repository passed to `previewCommand`/`executeCommand` is already scoped to
one local principal. Preserve that useful boundary rather than adding a
caller-controlled `ownerId` to every finance command. `BookId` and every entity
ID identify records; none grants authorization. The cloud adapter/server must
derive account ownership from the authenticated session and stamp it itself.
Client-supplied ownership is data to reject, never authority to trust.

Freeze the uniqueness rules in types and the ADR. At minimum, state whether an
operation ID is unique per identity-scoped repository and how the server keys
idempotency across account and device boundaries. Permit the same raw `BookId`
in isolated guest/account repositories without collision or accidental lookup.

Completion criterion: production-facing types and tests can represent two
isolated identity scopes with the same book/entity IDs, while cross-scope and
cross-book references remain explicit failures and no command field can grant
ownership.

## 2. Operation, receipt, and outbox schema

Version the canonical sync-facing records. Preserve the existing invariant that
one accepted command atomically produces one next `BookState`, one immutable
`OperationRecord`/receipt, and one immutable outbox intent.

Choose one normalized source of truth for the canonical command payload. If an
outbox item references the operation journal instead of duplicating the
payload, make that dependency explicit and require both records to exist in the
same transaction. Separate immutable operation intent from mutable delivery
metadata such as attempts, last error, lease, acknowledgement, or retry time so
transport state cannot rewrite financial history.

The schema must carry enough provider-neutral data for P04/P08 to:

- retry after restart without generating another canonical effect;
- detect same operation ID with different canonical content;
- bind an operation to its identity scope, book, base revision, resulting local
  revision, source device, and durable local enqueue order;
- acknowledge exactly the intended outbox operation;
- evolve the wire/local schema without guessing a record version.

Keep the current preview digest an application confirmation mechanism. Do not
misrepresent its short stable digest as authentication, authorization, or a
cryptographic integrity proof.

Completion criterion: every sync-facing record has an explicit schema version,
immutable intent fields, and a single documented owner; delivery changes cannot
change the canonical command, receipt, book revision, or effect.

## 3. Ordering, cursors, and checkpoints

Define durable ordering without clocks. `createdAtInstantMs`, financial
occurrence time, local date, string ID order, and provider timestamps are not
replication sequence numbers.

- Assign a monotonic local enqueue sequence inside the identity-scoped
  repository transaction. Two operations committed under a fixed clock still
  have a strict durable order.
- Keep per-book optimistic revisions for finance-command conflicts. A later
  server acceptance never makes a stale base revision silently valid.
- Treat a pull cursor/checkpoint as an opaque replication position scoped to
  the owning identity/provider stream. Code outside the adapter must not parse
  time or business meaning from it.
- Applying a pulled batch and advancing its checkpoint is atomic. A failed
  apply leaves both unchanged; replaying the batch is idempotent.
- Reordered, duplicated, or delayed delivery yields one canonical effect or an
  explicit conflict. It never drops an operation or stalls it invisibly.

Completion criterion: fixed-clock and reordered-delivery tests prove ordering
comes only from durable sequence/revision/cursor data, with one visible effect
per accepted operation.

## 4. Tombstones and recoverable conflicts

Define provider-neutral tombstone and conflict records plus pure policy helpers
where useful. Do not add a destructive finance command merely to create a test.

- A tombstone names identity scope, entity kind/ID, book, source operation,
  base/canonical revision or sequence, and schema version. It remains available
  until acknowledgement/retention policy makes compaction safe.
- Delete-versus-edit, stale revision, ownership mismatch, duplicate ID with
  changed payload, and incompatible schema are explicit conflict kinds. Never
  use last-write-wins for canonical money or erase either side's intent.
- Conflict history is immutable. Resolution is a separate appended decision
  that preserves the local operation, remote/current state reference, and
  chosen policy result.
- An unresolved conflict stays discoverable and blocks any action whose safety
  depends on successful synchronization or deletion.

Completion criterion: deterministic tests cover edit-before-delete,
delete-before-edit, duplicate/reordered delivery, and resolution append history
without mutating the original tombstone or conflict.

## 5. Guest merge and sign-out/cache safety

Model decisions, not UI or network calls.

Guest data never contacts the cloud automatically. After sign-in, merge starts
only from an explicit `mergeThisDeviceData` choice; `keepLocal` leaves the guest
repository isolated. A merge plan is resumable and idempotent, preserves stable
IDs, and records collisions as recoverable conflicts instead of replacing
remote data. Keep the source guest repository intact until the merge is fully
acknowledged and safe cleanup is separately confirmed.

Sign-out distinguishes session termination from local account-cache deletion.
The safe default under offline, failed, or unknown sync state is retain-and-
retry. Cache erasure is blocked while unacknowledged outbox items or unresolved
conflicts exist. The only destructive override requires both a verified export
reference and explicit confirmation; encode that requirement so an adapter or
UI cannot bypass it with a boolean named `force`.

Completion criterion: pure tests prove explicit merge versus keep-local,
resume after a partial/duplicate merge attempt, ID-collision conflict, safe
sign-out retention, blocked unsafe erasure, and the exact verified-export
override requirements.

## 6. Provider substitution boundary

Record the binding ADR in `docs/architecture.md` and mirror the implemented
record model in `docs/data-model.md`.

The current preferred candidate remains Supabase Auth/Postgres plus PowerSync,
subject to the founder's residency, provider, billing, and region gates. No
provider is approved by this task. Keep provider-specific table names, tokens,
SDK types, retry codes, and cursors behind future adapters. Define the minimal
capabilities any substitute must prove: authenticated server-stamped ownership,
transactional validated writes, idempotency, ordered replication checkpoints,
recoverable conflicts, export/deletion, backup/restore support, and the required
residency evidence.

Include an authorized amendment path: a future provider may replace the
candidate only after the same contract/conformance evidence and founder gates;
the finance domain and command schema must not require a provider-specific
rewrite.

Completion criterion: the ADR answers identity ownership, local scope,
operation/outbox schema, ordering, cursor/checkpoint, tombstone/conflict, guest
merge, sign-out/cache, schema evolution, provider substitution, and phase
ownership without claiming that cloud or persistent storage exists.

## 7. Reusable repository conformance suite

Extract a factory-driven conformance suite from the existing in-memory tests so
P04 can run the same behavioral contract against a persistent adapter. Keep the
test oracle independent of the adapter implementation; do not copy its reducer
or transaction internals into expected results.

The suite must be reusable without importing the concrete
`InMemoryFinanceRepository` and must verify at least:

1. defensive, non-aliasing reads;
2. transaction isolation and read-your-own-write behavior;
3. exactly-one revision advancement and first-committer-wins;
4. atomic state + operation + outbox intent + durable enqueue sequence;
5. rollback when each tentative write/checkpoint step fails;
6. same-ID/same-payload receipt replay and same-ID/different-payload conflict;
7. stale preview rejection and a refreshed retry;
8. a simulated commit that succeeds but whose acknowledgement is lost, followed
   by exact idempotent retry after reopening/reacquiring the adapter;
9. duplicate and reordered outbox/pull application;
10. cross-book and cross-identity lookup rejection;
11. atomic pulled-batch application with checkpoint advancement;
12. fixed-clock ordering that still follows durable sequence.

Add only the test hooks required to prove failure boundaries. Keep them clearly
test-adapter-specific. P03 still proves an in-process reference adapter, not
browser crash durability; P04 must rerun the suite after real persistence,
reload, multi-tab, quota, and physical-device scenarios exist.

Completion criterion: one exported conformance runner executes against the
in-memory factory, and a future P04 adapter can adopt it without copying the
test cases.

## 8. P03 acceptance evidence

Add one concise evidence table to `docs/architecture.md` mapping P03-A1 through
P03-A6 to exact production test files/test names and, for P03-A5's design
decisions, exact ADR headings. Do not call a worker report or standalone copied
formula acceptance evidence.

Run the integrated A–D command/property gate once. If D changes a shared public
type, update every affected test and export deliberately; do not weaken type or
source-discovery coverage to obtain green output.

Completion criterion: every P03 acceptance item has a concrete current evidence
pointer, no item is marked complete by prose alone when executable proof is
required, and P04/P08 ownership is explicit.

## Required proof scenarios

Use public production contracts and the reusable repository interface wherever
possible. Add hand-checked examples for these boundaries:

1. Two repository scopes use the same raw book and entity IDs without collision;
   a cross-scope reference cannot read or mutate the other scope.
2. Three commands committed with one fixed timestamp receive strict local
   sequence order; replay and reordering still yield one effect each.
3. A command commits, the caller receives a simulated transport/ack failure,
   and retry after adapter reacquisition returns the original receipt without a
   second state change or outbox intent.
4. Failure at state, operation, outbox, delivery, and checkpoint boundaries
   leaves the whole attempted transaction byte-identical; retry succeeds once.
5. Edit-versus-delete in both delivery orders preserves the tombstone and edit
   intent in an explicit unresolved conflict; resolution appends separately.
6. Guest merge retries a partially acknowledged batch without replacing remote
   data; an ID collision becomes a conflict, while `keepLocal` emits no cloud
   intent.
7. Sign-out with pending outbox or unresolved conflict retains cache by default
   and rejects erasure; a verified export plus explicit destructive confirmation
   is the only override path.
8. A provider cursor is stored and compared only as an opaque value; tests fail
   if timestamp or lexical ordering is substituted for local sequence/revision.

Bounded property/state checks must cover duplicate/reordered delivery,
same-operation retries, uncertain acknowledgement, stale base revisions, and
delete-versus-edit decisions. Preserve exact seeds and shrinking output.

## Out of scope

- No persistent IndexedDB/OPFS/SQLite adapter or browser VFS choice.
- No migration from `MicroSaveOS_DB` v1 and no import/export implementation.
- No service worker, installability, manifest, offline UI, or update flow.
- No authentication screen, session manager, provider SDK, RLS policy, RPC,
  Edge Function, PowerSync rules, cloud schema, or network request.
- No real provider/region/residency decision, account creation, billing, secret,
  deployment, DNS, or remote publication.
- No legacy UI wiring and no P04/P08 feature implementation disguised as a
  contract test.
- No re-audit or refactor of reviewed A–C finance behavior unless a reproducible
  D-induced regression requires a minimal compatibility fix.

## Validation

Run focused conformance, sync-policy, and property tests during implementation.
At handoff run once:

```bash
npm run lint
npm run typecheck
npm test
npm run test:property
npm run build
git diff --check <TASK_BASE>..HEAD
```

No browser or visual matrix is required because Task D must not change the UI,
legacy runtime, or persistent browser adapter. Explain any pre-existing failure;
never weaken a legitimate gate.

## Finish

Commit only Task D product, test, and implementation-document files as:

`Rushd P03: freeze storage and sync contract`

Do not amend earlier commits and do not push. Stop before P04.

Then save a concise report to
`/Users/mehmet/Desktop/Rushd/artifacts/agent-reports/P03-D.md`. The report is
explicitly authorized and Git-ignored. Include task ID `P03-D`, complete or
blocked status, completion time, repository path, exact base/result SHA, actual
model/provider/reasoning variant, changed files/diff size, public contracts and
policy decisions, conformance runner API, exact commands/results, important
limitations, and unresolved risks. If a credible path remains for silent data
loss, duplication, cross-identity access, unsafe cache erasure, or materially
wrong replay, stop and report it rather than documenting it as a harmless
boundary.

Your final chat reply should only confirm that the report was saved and give
its absolute path.
