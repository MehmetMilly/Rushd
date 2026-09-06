# P03 execution proposal

**Date:** 5 September 2026
**Assessment base:** `f80cfc9`
**Status:** Execution active. Tasks A through C are implemented; C closed at `a047a60` after independent finance review and two correction rounds. Task D is next. Current routing and continuity live in `ACTIVE_DELIVERY_PLAN.md`.

## Outcome

P03 delivers Rushd's canonical finance engine and the application command API that P04 storage, P06/P07 screens, sync, and AI will share. It implements every P03 acceptance outcome without changing the existing UI or migrating real data.

Read the P03/P04 contracts in `phase-plan.json` and final master plan sections 3 and 9 before implementation. Other master-plan sections are consulted only when their behavior enters the assigned task. Workflow Lite governs delivery.

## Assessment

P02 is a useful mechanical foundation, not the finished financial architecture. Its local build, production-path regressions, preserved database, and module ownership are worth retaining. The current Store is still coupled to Vue and IndexedDB; its money helpers still use floating-point major units. Adding types around those formulas would preserve the wrong model.

The Luna Max read-only assessment found these concrete boundaries:

- `src/data/legacy-v1/runtime.js:25` rounds legacy money; `src/shared/contracts.ts:1` uses unchecked numbers. Canonical money needs a separate API.
- `src/shared/core.js:46` permits JavaScript to normalize impossible civil dates. New date validation must reject them.
- `src/data/legacy-v1/runtime.js:893` has useful atomic-write behavior and `:976` has settlement retry handling, but no general command/receipt boundary exists.
- `src/app/root-controller.js:688` and other controller paths write legacy data directly. Rewiring these now would duplicate P04/P06 integration work.
- `scripts/production-source.mjs` rejects source files not in its explicit list. The lint command also lists individual files. Task A must extend both checks to cover new production code without weakening existing coverage.

This is targeted source assessment plus the inherited P02 review, not a fresh exhaustive audit. No tests were rerun during this assessment. Existing P01 tests exercise real legacy runtime code; keep them. Standalone `scripts/finance-rules.mjs` examples are not proof of the new engine's correctness.

## Architecture decisions

### One canonical engine, explicit integration boundary

Use strict TypeScript under `src/domain/**`, with no Vue, browser globals, database SDK, network, or ambient clock. `src/application/**` validates commands at runtime, handles preview/execution, and owns the transaction port.

The legacy UI continues through its existing runtime until the new storage and screens are integrated in P04/P06/P07. P03 tests import the real canonical engine through the application API. This is an executable subsystem, not copied test formulas; it is not yet the finance engine visible in the old UI. Do not claim that P03 changed all legacy writes.

### Records and immutable corrections

Use ordinary typed records, immutable financial movements/corrections, and derived queries. Keep a durable action journal for identity, audit, and retry. Avoid a generic event-sourcing framework or a database rebuilt from an unlimited event log on every read.

Separate expected obligations, actual movements, boundary observations, reconciliation adjustments, plan revisions/occurrences, settlement versions, and tracked-allocation funding/assignment/release. Category and flexible-preset links remain descriptive. Occurrences retain identity across retries, while paid/detached facts retain their historical revision.

### Money and time

- Checked integer minor units with explicit supported ISO currency metadata. Test zero-, two-, and three-decimal currencies. Validate all arithmetic results and intermediates; no silent rounding, overflow, cross-currency arithmetic, or locale-driven relabeling. Use exact intermediates where necessary, with serializable checked values at the API boundary.
- Strict civil dates, explicit profile timezone, captured timestamps and cycle identity, and an injected clock/ID source. Never rely on the host timezone or parse a civil date as an implicit UTC instant.
- Gregorian monthly/payday cycles clamp their anchor to the month's last valid day. Settings edits default to the next unopened cycle. Rebase is a separate previewed command; closed versions remain immutable.
- If a backdated event lacks enough timing information to place it relative to a same-day observed boundary, return a clarification/review requirement. Do not guess from its insertion time.

### Command and persistence contract

The caller previews a typed command against a specific revision, confirms its effects, then executes it. Execution rechecks revision and invariants inside one repository transaction. A stale preview requires a new preview.

The initial API sketch is `previewCommand(snapshot, command, context)` and `executeCommand(repository, command, confirmation)`. Context supplies clock/IDs, book identity, and calculation version. Execution returns either a typed failure/clarification with no writes or a receipt and resulting revision.

Within the transaction, check the operation ID before treating a retry as a stale command. The same ID and same payload return the original result; the same ID with different content is an explicit conflict. Canonical changes, receipt, and outbox entry commit together. An exception leaves none of them committed.

P03 proves the protocol with a transactional in-memory adapter and failure injection. P04 must prove the actual persistent adapter under crash/reload, two tabs, and quota failures; an in-memory test is not evidence of durable browser atomicity. Confirmation is an application policy, not a cloud authorization credential. P08 must independently enforce ownership on the server.

### Financial behavior to keep explicit

Availability returns its signed amount, currency, exact components, data-as-of time, calculation version, and separate pool/classification completeness. A negative result remains negative. Pacing is a query with explicit eligible days and an unavailable result when its basis is unsupported.

Recovery processes observation boundaries in effective order with explicit links to covered actuals and residual adjustments. Recovering a forgotten item consumes the appropriate unexplained difference exactly once. Test multiple observations, backdated corrections and reversal, rather than using one global adjustment that changes the wrong period.

A partially paid obligation reserves only its unpaid residual; final settlement releases the remainder. A dispute does not erase paid outflows, and an expected refund adds nothing. Pausing a disputed reservation requires its own visible command and degrades completeness.

Cross-cycle outstanding obligations retain original due-cycle identity and encumber available funds once. Actual payments belong to the occurrence cycle. Close/carry/reopen uses immutable settlement versions and linked propagation deltas. A correction to an older cycle cannot silently overwrite a later settlement or allocation.

Funding tracked allocations affects availability once; assigning funded money to a goal does not affect it again. Release names its destination cycle, preserves source attribution, and cannot release or assign the same funds twice.

Completeness is derived from recorded evidence and unresolved conditions. Return explicit reasons. Do not invent a blanket freshness timeout or let a UI flag mark uncertain data Current. Freeze the concrete transition examples in Task B.

## Reality Check input decision

The founder delegated this UX choice after confirming that 1,000 SAR total, 200 allocated to a goal, and 100 reserved for an unpaid bill should yield 700 available.

Decision: the user enters the full current amount in the pool being tracked, including money earmarked within that pool for goals and unpaid bills. Rushd applies the deductions and shows their breakdown. The user enters 1,000, not 800 or 700. This avoids requiring manual subtraction before an observation. It is a UX judgment, not a claim established by user research.

Compare the observation with the ledger-derived total on the same pool basis, never directly with availability. Derive availability after accounting for reservations and allocations exactly once. A goal assignment or release within the tracked pool changes earmarking, not the observed total; genuine money entering or leaving that pool is separate. Keep tracked-pool scope explicit so an unrelated account balance is not treated as this pool's observation. Rushd records intentions and does not move bank money.

Required examples: an unchanged 1,000 observation with a 200 goal allocation and 100 unpaid reservation produces no reconciliation adjustment and 700 available. Repeating it changes nothing. Releasing 100 of that allocation leaves the observed total at 1,000 and raises availability to 800, without inventing an external inflow. Preserve the master plan's named-cycle release accounting and source attribution while translating it correctly to this observation basis. This supersedes the earlier proposal to ask users to subtract goal funds themselves.

## Four substantial tasks

### A. Checked primitives and executable command foundation

**Worker:** GLM 5.3 Flash, Max, confirmed available by the founder. The interactions between exact arithmetic, revisions, and retry behavior justify deeper reasoning within the expiring pool.

Build checked money/currency/date/cycle primitives; book and identity types; runtime-validated command envelopes; transaction port; preview/revision/idempotency/receipt behavior; and a minimal real start-book/start-cycle/inflow path. Add the domain/property runner and lint/source coverage in this same task.

Own `src/domain/primitives/**`, `src/domain/contracts/**`, `src/application/commands/**`, corresponding `tests/domain/**` and `tests/property/**`, package files, and the narrowly named tooling below. Finish with working application-level examples, invalid currency/date/amount rejection, duplicate-command protection, stale-preview rejection, and injected all-or-nothing failure. No empty interfaces presented as completed finance behavior.

### B. Everyday financial behavior

**Worker:** GLM 5.3 Flash, request Max if exposed; record the actual available thinking mode. Task A's useful implementation and targeted fixes justify continuing within the free window, and B's interacting financial states warrant deeper reasoning. Grok High is the fallback when the GLM window ends.

Build actual expenses/returns/corrections; obligations with partial/final settlement, dispute and reservation release; allocations; availability breakdown; pacing; and completeness. Exercise these through A's command API. Include deterministic examples where an 80 commitment paid by 30 still consumes 80 until final settlement, and where assigning funded money to a goal has no second cost.

Own `src/domain/activity/**`, `src/domain/obligations/**`, `src/domain/allocations/**`, `src/domain/calculations/**`, relevant command handlers, and their tests. Completion includes mixed-operation sequences, unavailable inputs, negative availability, overpayment, returns, and no double allocation. A must be integrated first.

### C. Recovery, recurring plans, and cycle lifecycle

**Worker:** Grok 4.6 at the highest suitable exposed reasoning setting. Backdating and linked correction chains are P03's hardest interactions; use stronger reasoning here.

Build full-cycle/mid-cycle boundaries, Reality Check and recovery, effective-dated plan revisions/occurrences, paid-fact protection, timezone/payday rebase, close/carry/reopen, and propagated correction effects. Use the agreed observation basis and B's calculations; every mutation uses A's command API.

Own the corresponding domain modules, command handlers, and tests. Completion proves two successive observations plus recovered/reversed activity, same-day timing uncertainty, short-month/DST boundaries, cross-cycle unpaid commitments, repeat close/carry/reopen, and a backdated correction whose downstream allocation has already changed. Preserve immutable history or return an explicit unresolved conflict; never hide a lost correction.

**Review point:** a fresh Grok review if GLM wrote most of the core; use Muse xHigh or Terra High/xHigh for the difficult Grok-written recovery code when available. Review A through C as one integrated engine, concentrating on arithmetic and state transitions. Different-family review is preferred, not an excuse to wait or order duplicate full audits.

### D. Storage/sync contract and P03 integration

**Worker:** Grok High for contract decisions and integration. GLM may implement disjoint conformance tests against the settled API while its window lasts.

Complete the provider-neutral ADR in `docs/architecture.md` and corresponding public types. Define guest/account/book/device/operation identity separation, server ownership, operation ordering/cursors, revision conflicts, tombstones, guest merge, sign-out/cache behavior, schema versioning, and provider substitution. A cursor is a replication position, not a financial timestamp; ownership supplied by a client is not trusted server ownership.

Prove command/receipt/outbox atomicity and replay through the same repository conformance suite P04 will reuse. Include same-ID/different-payload conflicts, uncertain commit followed by retry, stale revisions, delete-versus-edit, and a cross-book rejection. Update the data model and map every P03 acceptance criterion to an implemented test or the ADR. Partial property tests from prior tasks accumulate here; no release-scale mutation campaign in P03.

**Review point:** a focused independent check of D's contract and changes since the prior review, followed by the Master checking integration evidence. The required P03 commands must pass once on the integrated result. Persistent sync, VFS selection, legacy migration, AI gateway, and UI wiring remain later-phase work.

## Verification and task boundaries

Use Vitest and property/state tests as the master plan specifies, importing production domain/application modules. Use seeded runs with reproducible failures. Assert conservation, exact-once effects, immutable paid/closed facts, no-write failures, and the observation invariant against independent hand-calculated examples. A test that repeats the implementation is not an independent oracle.

Run targeted tests while changing code. At P03 closure run lint, typecheck, `npm test`, `npm run test:property`, and build. Run browser smoke only if bootstrap/shared legacy behavior is affected; full visual parity is unnecessary for a domain-only addition.

P03's path list now includes the narrow tooling additions `scripts/production-source.mjs`, `tests/p02-build-contract.test.mjs`, `eslint.config.cjs`, `tsconfig.json`, and optional `vitest.config.ts`. Keep discovery/coverage checks meaningful as modules are added, and ensure lint/typecheck cover all new domain/application/test files. No product acceptance is weakened by this tooling repair.

Use at most two isolated writers. The second gets disjoint work after interfaces are settled, such as synthetic scenario fixtures or repository conformance tests. Do not run multiple finance writers against changing shared contracts. Package and integration changes have one owner.

Each handoff reports commit/diff, behavior delivered, commands actually run, unresolved findings, and follow-ups. Worker-owned corrections are scoped to reproducible findings; repeat only affected checks plus the final integrated gate. P03 application action receipts are product functionality, not the retired development-process receipts.

## Calendar and resource use

Use the GLM window for A and, if quality and time permit, B. A second GLM session can prepare concrete synthetic command scenarios after A's interfaces settle. Grok is the main fallback and review route. Free tokens expiring do not justify unfinished speculative code or an oversized task.

The master plan has a strong product definition, but "decision-complete" overstates some semantics and external dependencies. Keep its feature vision; resolve ambiguities with examples when they first matter. Separate implementation prerequisites from phase closure order so later design, provider preparation, and AI development examples can overlap safely.

Treat one month as a planning target until actual throughput supports it. After the first integrated P03 tasks, forecast remaining work from correction rate and wall-clock progress. Physical-device testing, account/region decisions, AI eval preparation, and the mandatory P13 beta cannot be accelerated by generating more code. Raise a threatened milestone early, with a concrete cause and adjustment, while preserving the agreed feature set.
