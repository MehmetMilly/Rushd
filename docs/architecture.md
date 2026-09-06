# Architecture

Rushd is a Vite-built modular Vue 3 legacy application. P02 preserves the
runtime-template UI and IndexedDB v1 behavior while making ownership explicit.

## Structure

- `index.html`: metadata, local font links, the pre-paint preference boot, the
  static cinema wrapper/backdrop plus empty `#app` host, and the module entry
  only.
- `src/main.ts`: composition root. It imports ordered CSS and the raw root
  template, creates the app, installs the temporary bridge, and mounts it.
- `src/app/`: root template/controller plus bilingual translations/contracts.
- `src/components/`: one runtime-template file for every legacy component.
- `src/application/`: bootstrap and the narrow debug/test bridge.
- `src/data/legacy-v1/`: record contracts, normalizers, IndexedDB wrapper,
  backup validation, and the reactive Store compatibility code.
- `src/shared/`: Core utilities and strict TypeScript shared contracts.
- `src/styles/`: the two original CSS regions in cascade order, with Tailwind
  between them.

The app is built with Vite. `vite.config.mjs` aliases `vue` to the full
`vue.esm-bundler.js` build because the moved root and component strings still
compile at runtime. Vue 3.5.42, Tailwind CSS 3.4.17 output, fonts, and Material
Symbols Rounded are local. There is no runtime CDN.

## Canonical domain and command foundation (P03 Task A)

P03 adds a strict-TypeScript finance engine beside the legacy runtime. The
legacy UI does not use it yet; P04/P06/P07 will integrate it. It is an
executable subsystem proven by tests, not a wired product surface.

- `src/domain/primitives/`: checked integer minor-unit money with explicit
  ISO currency metadata (SAR/USD two decimals, JPY zero, KWD three), an exact
  bilingual amount parser (Western, Arabic-Indic, and Extended Arabic-Indic
  digits), strict Gregorian civil dates, first-of-month and payday-anchored
  monthly cycles with short-month clamping, and instant-to-civil-date
  resolution through an explicit IANA timezone via the platform `Intl`
  database. Instants outside the platform-representable `Date` range, or
  resolving outside the supported Gregorian year range, are typed rejections
  rather than thrown errors. No ambient clock, `Math.random`, or own timezone
  logic.
- `src/domain/contracts/`: branded identities (book/cycle/entry/operation),
  canonical JSON plus a non-cryptographic stable digest, immutable book,
  cycle, and ledger records (inflows and linked reversal facts only),
  runtime-validated command/receipt/failure/outbox types with a declared
  per-command reversal policy, and the narrow transactional repository port.
- `src/application/commands/`: the public API. `previewCommand` validates a
  raw `unknown` command and reports the canonical payload, book, revision it
  covers, and provisional effects without writing. `executeCommand` rechecks
  the operation identity, revision, and state inside one repository
  transaction, then commits state, receipt, and outbox together. Concrete
  handlers exist for `createBook`, `openCycle`, `recordInflow`, and
  `reverseInflow` (append-only, linked reversals; duplicate or cross-book
  reversals are typed rejections). Inflows and reversals carry an explicit
  `occurredAt` (civil date or instant) in the canonical payload: the
  confirmed financial date cannot drift with the clock between preview and
  execution, while capture timestamps still reflect execution time.

Command protocol: a caller previews against the current revision, confirms
with `{ operationId, expectedRevision, previewDigest }`, and executes. The
same operation ID with the same canonical payload replays the original
receipt with no second effect, even with a stale held revision; the same ID
with different content is an `operationIdConflict`; a stale preview is a
`revisionConflict` that requires a refreshed preview. Clocks and ID
factories are injected through the context; nothing implies cloud
authorization, and the confirmation is an application policy, not a
credential.

`tests/domain/support/in-memory-repository.ts` is the transactional
in-memory reference adapter (overlay isolation, first-committer-wins write
conflicts, rollback on injected failure) used to prove the protocol and to
give P04's persistent adapter a conformance target. This proves one-process
protocol behavior; it is not evidence of crash-safe browser durability.

## Everyday financial behavior (P03 Task B)

Task B extends the same command protocol with the engine's working money
semantics. It is still backend-only: the legacy UI does not call it.

- `src/domain/activity/`: derivations over actual movement. Expenses, linked
  expense reversals, expense returns, and linked return reversals are
  immutable ledger facts. Editing a paid fact (`correctExpense`) atomically
  appends a reversal plus its optional replacement; originals are preserved
  verbatim. Correcting a return (`correctExpenseReturn`) works the same way
  for standalone and obligation returns. Returns are actual money received
  and can never exceed the linked returnable amount; the allowance is
  computed across the whole correction family, so a new replacement ID never
  resets it, and shrinking below standing refunds (or voiding while any
  remain) is rejected. Category and flexible-definition links describe only.
- `src/domain/obligations/`: expected items kept strictly separate from money
  movement. The residual reservation of an open obligation is
  `max(0, expected - unreversed net payments)`; payments are expenses linked
  to the obligation (overpayment allowed, residual floors at zero), counted
  at their live replacement amount after corrections. Final settlement and
  confirmed cancellation release the residual; a return after settlement
  never silently reopens; reopening is explicit. Dispute is an independent
  overlay that closes only through an explicit confirmed
  `resolveObligationDispute` (optionally linked to its return) or a final
  settlement/cancellation whose preview describes that effect: refunds and
  reopenings never resolve it. Posted disputed payments stay outflows, and a
  previewed `releaseDisputedResidual` records unresolved uncertainty that
  persists (and degrades completeness) until its own conditions resolve it.
  Lifecycle history is append-only events, never mutations.
- `src/domain/allocations/`: tracked-pool derivations. Funding moves
  spendable money into the pool exactly once; assignment divides
  already-funded money among goals with no second availability effect;
  unassignment returns to tracked-unallocated; release names its destination
  cycle and returns money to spending exactly once. Linked
  `reverseAllocationRecord` restores the prior state only when conservation
  allows. One shared replay produces both the pool balances and each cycle's
  spending deduction with source/destination attribution, so reversing a
  release re-earmarks money and reversing funding restores it in
  availability as well as in the pool. Conservation holds: unallocated +
  assigned == funding - releases. Goal progress is its own assigned balance.
- `src/domain/calculations/`: pure queries. `computeAvailability` returns
  the signed amount, exact component breakdown, currency, data-as-of
  instant, calculation version, and both completeness dimensions; a negative
  result stays negative. `computePacing` divides availability over explicit
  caller-supplied eligible dates with exact integer arithmetic and a
  reported remainder (duplicate/empty/out-of-cycle days are typed
  unavailable results, never skewed divisions). `computeCompleteness`
  derives pool and classification dimensions independently from recorded
  evidence with typed reasons; a disputed or released-residual reason does
  not disappear because transactions got categories, and vice versa.

Handler and validator code is split per domain (`activity-handlers`,
`obligation-handlers`, `allocation-handlers`, plus Task C's
`recovery-handlers`, `plan-handlers`, `cycle-handlers`, and matching
`validation-*` modules) behind the unchanged `previewCommand`/
`executeCommand` hub, so every new mutation keeps runtime validation,
preview/confirmation, revision checks, atomic state+receipt+outbox commits,
and the idempotency policy.

## Recovery, recurring plans, and cycle lifecycle (P03 Task C)

Task C turns the one-cycle engine into a cycle-aware finance system. It is
still backend-only: the legacy UI does not call it.

- `src/domain/recovery/`: Reality Check derivations. The observation names
  the full physically-left pool (goal-earmarked and obligation-reserved
  money included); the signed adjustment is observed minus the
  ledger-derived pool at the boundary, never availability. Allocation moves
  and reservations are earmarks and never enter the comparison. Residuals
  derive from linked recoveries at live correction-family values, so
  correcting or voiding recovered activity recomputes the boundary forward.
  Ordering uses the financial occurrence (explicit instants resolved under
  the boundary timezone with DST rules, else the civil date); a civil-date
  fact on the boundary's own date is ambiguous and clarifies with no write.
  Recoveries attach to the earliest covering boundary, which keeps every
  observed pool exact. Successive observations chain forward; a backdated
  boundary stacks an independent adjustment without rewriting later ones.
- `src/domain/plans/`: effective-dated revisions with stable
  period-slot occurrence identities (`occ:<plan>:<YYYY-MM>`), short-month
  clamping, and idempotent materialization. Revisions move future unpaid
  managed occurrences only; paid, detached, and reserved occurrences keep
  their historical revision, so a revision can never desynchronize an
  occurrence from its linked obligation. One monthly slot stays one
  occurrence across schedule-day revisions: the due date lives on the row,
  rematerialization never duplicates a payable, and paying moves actual
  money in the payment's cycle. Detach is the explicit pre-editing escape
  and later revisions never retake a detached occurrence. Flexible links
  stay descriptive and arithmetic-neutral.
- `src/domain/cycles/`: effective settings (timezone/payday/week-start) per
  date, settlement remainder derivation (snapshot plus linked deltas),
  carry attribution, and overlap accounting. Week-start is display policy
  and never changes financial occurrence.
- Cycle versions are append-only rows with derived effective status: a
  version referenced by a settlement is closed, versions named by another
  version's `supersedesVersionId` are superseded, otherwise the latest is
  open. Rebase and close never mutate a row; reopen appends a new version
  that acts as the reversal record while the closed snapshot and version
  stay byte-for-byte. A rebase is rejected with no write when any dated
  fact attributed to the cycle would fall outside the candidate window, or
  when the window would overlap another cycle. Managed unpaid occurrences
  advance by replacement (except reserved ones, which are pinned to their
  obligation); conflict resolutions append a separate record while the
  conflict row stays byte-identical. Paid, detached, closed, and settled
  facts are never overwritten, and every transition is journaled through
  the operation record.
- Reality Check, recovery, plans, settings/rebase, close, explicit
  remainder disposition (carry-in, tracked funding, split, independent),
  reopen, closed-cycle corrections (new facts plus linked corrections and
  voids with live-command refund/net guards), and conflict resolution all
  run through the shared command protocol. Foreign-currency and ambiguous
  inputs clarify with no writes. Observations chain forward in boundary
  order; a backdated boundary is rejected with no write rather than
  stacking the same gap twice. Carry destinations must resolve to an
  existing open cycle. Backdated corrections are always accepted: an
  untouched downstream receives the exact linked delta (the carry basis
  follows it by derivation; completed tracked funding stands while the
  remainder view records the delta), while a subsequently changed
  downstream produces an explicit unresolved conflict that degrades
  completeness until an appended acknowledgement resolves it. Downstream
  ordering is durable append order (per-family cursors frozen on the carry
  action), never wall-clock comparison, so fixed or repeated capture
  milliseconds cannot reorder intent. The
  acknowledgement carries no monetary action.
- Availability is cycle-scoped (starting funds plus signed carry-in, this
  cycle's cash facts, signed reconciliation residuals, once-counted open
  reservations, per-cycle allocation attribution, buffer) with extra
  components `carryIn` and `netAdjustments`. Completeness covers the active
  basis: old unclassified history never contaminates a newer pool, while
  unclassified adjustments and unresolved
  propagation conflicts stay visible. A pool may be Current while
  classification remains Needs Attention: an accepted adjustment reconciles
  the pool by definition, so only disputes, released residuals, and
  unresolved conflicts keep the pool stale.
- New facts resolve and stamp in the active version timezone through one
  centralized helper; correction records retain their original fact's
  timezone by design, so history is never re-dated by later settings.
  Detach is the occurrence cancellation path; there is no separate
  plan-cancellation command.

Not implemented yet (later phases): persistent storage, obligation due
dates beyond plan occurrences, and sync.

## Storage/sync contract ADR (P03 Task D, binding)

This ADR freezes the provider-neutral contract P04 local persistence and
P08 account sync must implement. It defines and proves contracts only: no
IndexedDB, service worker, authentication, cloud networking, RLS, Supabase,
PowerSync, migration, or sync daemon is added by this task, and nothing here
claims that cloud or persistent storage exists. P04 owns the persistent
adapter (proved by rerunning the conformance suite after reload, multi-tab,
quota, and physical-device scenarios); P08 owns the server, authenticated
ownership, and replication.

### 1. Identity ownership

- The repository passed to `previewCommand`/`executeCommand` is scoped to
  exactly one local principal (`src/domain/sync/scope.ts`): a device-local
  guest (`GuestKey` on a `DeviceId`), an authenticated account (`AccountId`
  on a `DeviceId`), or one device/install identity. The scope namespace
  (`RepositoryScopeId`, `scope:guest:<key>:<device>` or
  `scope:account:<account>:<device>`) is derived, never caller-chosen per
  command.
- `BookId` and every entity ID identify records; none grants authorization.
  Finance commands carry no `ownerId`/`accountId` field, and strict
  validation rejects such fields as unknown input. The cloud adapter/server
  derives account ownership from the authenticated session and stamps it
  itself; client-supplied ownership is data to reject, never authority to
  trust.
- Uniqueness: an operation ID is unique per identity-scoped repository (the
  journal is keyed by operation ID inside one scope). Across account/device
  boundaries the server keys idempotency on `(accountId, operationId)`
  (`serverIdempotencyKeyFor`). The same raw `BookId` may exist in isolated
  guest/account repositories without collision or accidental lookup.
- Composite keys are injective: scope IDs (`scope:guest:` /
  `scope:account:` plus length-prefixed components) and server idempotency
  keys (`idemp:` plus length-prefixed components) frame each component as
  `<length>:<bytes>`, so tuples like (`a:b`, `c`) and (`a`, `b:c`) never
  encode to the same key even though components may contain separators.
  `parseRepositoryScopeId` / `parseServerIdempotencyKey` recover the exact
  tuple; malformed encodings are rejected, never guessed.

### 2. Local scope

One local principal owns one repository namespace; books live inside it.
Every repository handle carries an immutable scope/device binding
(`ScopedRepository.boundScope` / `boundDevice`, preserved across
reopen). `previewCommand`/`executeCommand` verify the caller origin
against that binding before any read, replay, or mutation: a mismatched
origin fails with an explicit `scopeMismatch` failure, can neither mutate
the bound scope's books nor replay another scope's receipts, and leaves
bound state byte-identical. Adapters that accept a mismatched
caller-controlled scope do not satisfy the port.
Cross-scope references fail explicitly (`unknownBook`/`unknownEntry` — a
lookup in one scope can never observe another scope's records), and
cross-book references fail as typed `crossBook*` failures without mutation.
Two scopes may reuse the same raw book/entity IDs as unrelated records, and
the same raw operation ID commits independently in each scope.

### 3. Operation/outbox schema

- Every sync-facing record carries `schemaVersion: 1`
  (`SYNC_RECORD_SCHEMA_VERSION`). Unknown versions must be rejected
  explicitly; no reader guesses a version.
- One accepted command still atomically produces one next `BookState`,
  one immutable `OperationRecord`/receipt, and one immutable outbox intent —
  now additionally bound to `scopeId`, `sourceDeviceId`, and one shared
  durable `enqueueSequence` assigned inside the committing transaction.
- The operation journal is the single normalized source of truth for the
  canonical command payload. The outbox intent references it by
  `operationId` (same sequence, same digest, same scope/device) and never
  duplicates the payload; both records are written in the same transaction
  and one must never exist without the other.
- Immutable intent is separated from mutable delivery metadata
  (`OutboxDeliveryState`: version, attempts, last error, lease,
  acknowledgement, retry time, owned by the adapter/transport) and
  persisted transactionally per operation with first-committer-wins
  version guards: every mutation advances exactly one version, so
  concurrent delivery workers serialize or fail explicitly and no
  successful update is silently lost. Delivery activity cannot
  change the canonical command, receipt, book revision, or effect, and
  acknowledgement names exactly the intended operation (mismatch and
  duplicate acks are explicit rejections).
- The preview digest stays an application confirmation mechanism: a short
  stable (non-cryptographic) digest binding a confirmation to its preview.
  It is not authentication, authorization, or a cryptographic integrity
  proof.

### 4. Ordering

Durable order comes from the local enqueue sequence plus per-book
optimistic revisions, never from clocks: `createdAtInstantMs`, financial
occurrence time, local date, string ID order, and provider timestamps are
not replication sequence numbers. Allocation is tentative until commit, so
an aborted transaction leaves the whole attempt byte-identical; the commit
finalizes atomically and fails when another transaction moved the counter
(first-committer-wins extends to the sequence counter). A later server
acceptance never makes a stale base revision silently valid
(`revisionConflict` still requires a refreshed preview).

### 5. Cursor/checkpoint

A pull cursor is an opaque replication position scoped to one
identity/provider stream (`src/domain/sync/cursors.ts`). Only
construction, validation, and equality comparison are legal; there is
deliberately no ordering comparison, so no code can substitute timestamp
or lexical order for durable sequence/revision. Every checkpoint,
batch, and cursor stream is bound to one immutable `RepositoryScopeId`:
a batch naming another scope is rejected without mutation, and an
operation naming another scope than its batch is malformed. Pulled
operations travel as full content envelopes (operation ID, provider
sequence, scope, book, base and resulting revision with exactly-one
advancement, the exact canonical command payload, its digest re-verified
by the receiver, schema version), and each batch carries an identity
plus a content digest the receiver recomputes. Duplicate equality covers
every immutable envelope field — the provider sequence is transport
positioning, not identity — so the same operation ID with any changed
scope, book, revision, payload, digest, or schema field is an explicit
`contentConflict` naming the differing fields, never keep-first.
Applying a pulled batch executes each fresh operation's exact canonical
command through the production preview/execute path against the
scope-bound adapter, so the applied effect is real `BookState`:
duplicate delivery replays idempotently through the operation journal,
same-ID/changed-payload fails closed as `operationIdConflict`, and a
stale pulled base fails as `revisionConflict` instead of silently
reordering history. Finance effects commit before the applied records
and cursor advance together; any failure restores the finance snapshot,
so a failed apply leaves finance, cursor, and applied set unchanged. An
exact replay (same next cursor and same content digest) is a no-op
success; a stale base is an explicit `baseCursorMismatch`. Reordered,
duplicated, or delayed delivery therefore yields one canonical applied
record and effect, or an explicit conflict — never a drop, a duplicate,
an invisible stall, or a cursor advance past unverified content.

### 6. Tombstone/conflict

Tombstones (`src/domain/sync/tombstones.ts`) name scope, entity
kind/ID, book, source operation, base revision, durable sequence, and
schema version, and remain until acknowledgement plus the retention window
makes compaction safe. Delete-versus-edit, stale revision, ownership
mismatch, duplicate ID with changed payload, and incompatible schema are
explicit conflict kinds (`src/domain/sync/conflicts.ts`); canonical money
never uses last-write-wins and neither side's intent is erased. Conflict
history is immutable; resolution appends a separate decision preserving the
local operation, the remote reference, and the chosen policy. An
unresolved conflict stays discoverable and blocks sync-sensitive actions
via `assertSyncSafeForSensitiveAction`.

### 7. Guest merge

Decisions only, no UI or network (`src/domain/sync/merge.ts`). Guest data
never contacts the cloud automatically: merge starts only from an explicit
`mergeThisDeviceData` choice, while `keepLocal` leaves the guest
repository isolated with zero cloud intent. A merge plan is resumable and
idempotent, preserves stable IDs, and records ID collisions as
recoverable `duplicateIdChangedPayload` conflicts instead of replacing
remote data. The source guest repository stays intact until the merge is
fully acknowledged; safe cleanup is separately confirmed under the
sign-out/cache policy, never by the merge plan.

### 8. Sign-out/cache

Decisions only (`src/domain/sync/signout.ts`). Sign-out distinguishes
session termination (always allowed, never deletes) from local
account-cache deletion (gated). The safe default under offline, failed, or
unknown sync state is retain-and-retry. Erasure is blocked while
unacknowledged outbox items or unresolved conflicts exist — unless the
caller presents the destructive override: both a verified export reference
and an explicit destructive confirmation carrying the literal phrase
`ERASE-LOCAL-ACCOUNT-CACHE`, validated from unknown input at runtime
(master plan 778-784, P08-A2). The override covers enumerated pending
outbox/conflict intent; missing/invalid proof, unknown counts, and unknown
(offline/failed) sync states stay blocked. A boolean named `force` is a
type error and a runtime rejection, never a bypass.

### 9. Schema evolution

Record versions are explicit on every sync-facing envelope (records,
cursors/checkpoints, tombstones, conflicts, merge plans). Version 1 is
frozen here; future versions extend the records with new versioned
envelopes and explicit migration/rejection rules. Incompatible schemas
surface as explicit conflicts or rejections, never as guessed parses.

### 10. Provider substitution

The preferred candidate remains Supabase Auth/Postgres plus PowerSync,
subject to the founder's residency, provider, billing, and region gates.
No provider is approved by this task: table names, tokens, SDK types,
retry codes, and cursors stay behind future adapters. Any substitute must
prove every capability in `SyncProviderCapabilities`
(`src/domain/sync/provider.ts`): server-stamped ownership,
transactional validated writes, idempotency, ordered replication
checkpoints, recoverable conflicts, export/deletion, backup/restore, and
residency evidence. A future provider may replace the candidate only after
the same contract/conformance evidence passes against its adapter plus the
founder gates; the finance domain and command schema must not require a
provider-specific rewrite.

### 11. Phase ownership

P03 freezes this contract and proves it against the in-memory reference
adapter plus the reusable conformance runner
(`tests/domain/support/repository-conformance.ts`, 12 checks) that P04
adopts unchanged for the persistent adapter. P04 owns durable local
persistence, reload/multi-tab/quota/device proof, legacy migration,
import/export, and the PWA. P08 owns authentication, server-stamped
ownership, replication, guest merge execution, conflict recovery UX, and
backup lifecycle. Neither phase may weaken the contract; amendments go
through the same evidence plus founder gates.

### P03 acceptance evidence (A1-A6)

Every item points to executable proof (test file and test name) or, for
A5 design decisions, to the ADR heading above. Worker reports and copied
formulas are not evidence.

| ID | Outcome | Evidence |
|----|---------|----------|
| P03-A1 | Checked integer ISO minor-unit money; explicit civil dates and payday/calendar cycles | `tests/domain/money.test.ts` (full file), `tests/domain/civil-date.test.ts`, `tests/domain/monthly-cycle.test.ts`, `tests/domain/instant-resolution.test.ts`, `tests/property/money-properties.test.ts` |
| P03-A2 | Availability, mid-cycle boundary, completeness, shortfall, pacing, partial/residual obligations, multiple payments, returns, signed adjustments, allocations | `tests/domain/everyday-flow.test.ts`, `tests/domain/completeness-pacing.test.ts`, `tests/domain/reality-check-recovery.test.ts`, `tests/property/everyday-properties.test.ts` |
| P03-A3 | Plans cannot rewrite paid facts; close/carry/reopen, backdated propagation, allocation funding/assignment/release are explicit, atomic, idempotent | `tests/domain/cycle-lifecycle.test.ts`, `tests/domain/backdated-propagation.test.ts`, `tests/domain/cycle-settings-rebase.test.ts`, `tests/domain/recurring-plans.test.ts`, `tests/domain/correction-chains.test.ts`, `tests/property/task-c-lifecycle-properties.test.ts`, `tests/property/task-c-recovery-properties.test.ts` |
| P03-A4 | Typed commands, invariant validation, receipts, revision/idempotency identity, undo/reversal policy | `tests/domain/command-flow.test.ts`, `tests/domain/idempotency.test.ts` ("replays the original receipt", "lost acknowledgement", "same operation ID with changed content", "stale previews"), `tests/domain/atomicity.test.ts` ("all-or-nothing", "first-committer-wins"), `tests/domain/everyday-command-safety.test.ts`, `tests/domain/task-c-command-safety.test.ts`, `tests/domain/reversal-binding.test.ts`, `tests/property/command-sequence-properties.test.ts`; conformance runner `tests/domain/repository-conformance.test.ts` (17 checks: replay, conflict, stale preview, uncertain commit, delivery persistence and race, scope binding and mismatched-context rejection, real-effect pull application with rollback/replay) |
| P03-A5 | Provider-neutral pre-P04 ADR (identity, ownership, operation/outbox, cursors, tombstones, conflicts, guest merge, sign-out/cache, amendment path) plus boundary/property/regression tests over production code | ADR headings 1-11 above; `tests/domain/sync-scope.test.ts` ("isolated across scopes", "adversarial separator tuples", "scope binding enforcement"), `tests/domain/sync-records.test.ts`, `tests/domain/sync-uncertain-commit.test.ts` ("lost acknowledgement and reacquisition", "delivery boundary retry"), `tests/domain/sync-tombstone-conflict.test.ts`, `tests/domain/guest-merge-signout.test.ts` ("verified-export override", "unknown states stay blocked"), `tests/domain/sync-provider.test.ts`, `tests/property/sync-delivery-properties.test.ts` ("changed-envelope conflicts", "exact-replay classification") |
| P03-A6 | Completeness reducer, recovered classified activity, disputed reservations, refunds, effective dates, rebase, closed-cycle immutability, UTC/DST/short-month boundaries, retry/reopen, Reality Check currency invariants (no FX, clarification-only non-writes) | `tests/domain/reality-check-recovery.test.ts`, `tests/domain/cycle-lifecycle.test.ts`, `tests/domain/cycle-settings-rebase.test.ts`, `tests/domain/recurring-plans.test.ts`, `tests/property/cycle-properties.test.ts` |

P04/P08 ownership is explicit in ADR heading 11: the contract is frozen
here; persistence, reload/multi-tab/quota/device proof, auth, server
ownership, replication, and backup lifecycle belong to their phases and
must satisfy this contract rather than renegotiate it.

## Main Screens

- Dashboard: selected-day expense list, safe-to-spend hero, date window, payment and add-expense flows.
- Statistics: budget, paid spending, remaining safe-to-spend, category breakdown, weekly spending, and flexible expense usage.
- Vault: savings balance, savings goals, month-end surplus movement, and recent vault transactions.
- Plans: recurring template profiles for workdays, offdays, monthly expenses, and flexible expense definitions.
- Settings: language, calendar, theme, motion, base allowance, safe-to-spend mode, onboarding reset, export/import, and factory reset.

## Data Flow

`main.ts` creates the legacy data runtime with browser dependencies, registers
components and controller mixins, and mounts the raw template. User actions
update its reactive Store. Persistent writes use the IndexedDB wrapper.
Preferences such as theme, language, calendar type, and motion setting remain
mirrored in localStorage where boot behavior needs them.

The app recalculates statistics from stored expenses, templates, settings, vault state, and month-end settlements.

## Storage

- IndexedDB database: `MicroSaveOS_DB`, version `1`, unchanged as the legacy
  database name and schema input.
- Object stores: `settings` (`key`), `templates` (`id`), and `expenses` (`id`,
  with `date` and `isPaid` indexes).
- localStorage keys: boot preferences and small deferred-prompt flags.

## Current Limitations

- The temporary `window.MicroSave*`/`window.Rushd*` debug/test bridge remains
  for local tools and P01 production-path tests. Its sole mounted-app accessor
  is `window.RushdDebug.getAppProxy()`; P04 owns retiring it.
- Runtime string templates and the full Vue compiler remain until P05/P06.
  vue-router is deferred with persistent URL work to P04/P05.
- The P02 browser smoke test rejects external runtime requests and covers a
  representative capture/reload flow. Broader language, viewport, and device
  coverage remains in the parity and later UI gates.
- No cloud sync or authentication.
- No model-backed assistant integration.

## Future Architecture Improvements

The first extracted finance-rule helpers live in `scripts/finance-rules.mjs` with tests in `scripts/finance-rules.test.mjs`. They intentionally mirror the legacy formulas; the canonical engine under `src/domain/` and `src/application/commands/` is the P03 replacement and is not yet wired into the UI.

`scripts/production-source.mjs` lists every owned production file, including the new domain and command modules; `npm run lint` covers the same set plus the domain tests, and `tsc --noEmit` typechecks them. Vitest runs the domain suites (`npm test`) and the bounded seeded property suites (`npm run test:property`).

The browser smoke test lives in `scripts/browser-smoke.cjs`. It starts a local static server, opens Rushd with Playwright, adds a fake expense, checks persistence after refresh, and captures a populated dashboard screenshot.

`npm run test:legacy-idb` seeds synthetic v1 data before the built app loads. It
proves the production module path reopens it at version 1 without an upgrade and
renders the seeded expense. P02 does not add a PWA, cloud sync, authentication,
model integration, or production-security claim.
