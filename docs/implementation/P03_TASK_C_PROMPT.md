# Rushd P03 Task C: recovery, recurring plans, and cycle lifecycle

Implement Task C in `/Users/mehmet/Desktop/Rushd` on branch `codex/rushd-rebuild-plan`, starting from `1cbcae6`. You are the only product-source writer for this task. Use Muse Spark 1.3 contributor-free with the deepest reasoning variant the host actually exposes, and report the actual setting. Sol High owns integration and will arrange an independent Terra review because recovery and cross-cycle correction errors can produce wrong money answers.

## Outcome

Deliver the remaining behavioral core that turns P03 A/B from a one-cycle engine into a cycle-aware finance system:

- full-cycle and remaining-from-boundary bases;
- Reality Check observations, signed reconciliation adjustments, recovery, and reversal;
- effective-dated recurring-plan revisions and stable managed occurrences;
- timezone/payday settings revisions and explicit open-cycle rebase;
- immutable close, explicit carry/allocation disposition, reopen, and downstream correction propagation;
- cycle-scoped availability and completeness across more than one cycle.

Every mutation continues through A's runtime validation, preview/confirmation, revision check, idempotency journal, and atomic state + receipt + outbox transaction. This task is backend-only. Do not change the legacy UI or database, start P03 D, choose a sync provider, or claim persistent-browser durability.

## Read first

Read only the sources needed for the work:

1. `AGENTS.md` and `WORKFLOW_LITE.md`.
2. `docs/implementation/P03_EXECUTION_PLAN.md`, especially Task C and the Reality Check input decision.
3. `docs/RUSHD_MASTER_PLAN_FINAL.md` section 3, section 9's application/local-data rules, and the P03 phase paragraph.
4. `docs/implementation/ACTIVE_DELIVERY_PLAN.md` for the current base and B closure.
5. The current public API, canonical contracts, derivations, command handlers/validators, deterministic context, and in-memory repository.

Treat worker/reviewer reports as historical leads, not authority. Preserve the B corrections at `f255bac` and `28d4608`: allocation reversal attribution, correction-family refund caps, effective obligation payments/returns, explicit dispute resolution, live-return validation, and return correction.

Check HEAD and status before editing. You are not alone in the workspace. Preserve every unrelated edit and never revert or stage another person's files.

## Ownership

Own the complete Task C finance slice so shared contracts have one writer:

- new `src/domain/{recovery,plans,cycles}/**` modules;
- necessary extensions under `src/domain/contracts/**`;
- necessary adaptations in `src/domain/{activity,obligations,allocations,calculations}/**`;
- Task C handler and validation modules plus the dispatch/export hubs under `src/application/commands/**`;
- corresponding `tests/domain/**`, `tests/property/**`, and test-adapter support;
- Task C updates to `docs/architecture.md` and `docs/data-model.md`;
- narrowly necessary P03 lint/typecheck/source-manifest configuration.

Keep `preview.ts` and `execute.ts` on their shared generic path unless a new repository locator genuinely requires plumbing. Keep legacy runtime/shared compatibility files, screens, IndexedDB data, and Development Master planning documents untouched.

## 1. Append-only state and identity

Extend `BookState` with separate immutable record families for the concepts below. Do not disguise observations, plan revisions, or settlements as ordinary cash transactions.

- Logical cycle identity remains deterministic. Rebase, settlement, and reopen use separate version identities so they cannot collide with `composeCycleId`.
- Preserve the original `FinanceBook` creation facts. Settings edits append versioned timezone, week-start where represented, and cycle-anchor decisions with explicit effective dates.
- Preserve original financial occurrence separately from capture time. Store enough boundary-ordering evidence to compare an instant with an observation. Never use append order or `capturedAtInstantMs` as a substitute for the financial occurrence.
- Add stable identities and cross-book checks only where caller-supplied references need them. Reuse `EntryId` where it remains semantically honest.
- Existing actuals retain their captured local date, timezone, and original cycle identity. Existing paid, detached, and closed facts are never overwritten.

Completion criterion: serialized `BookState` can represent two cycles, multiple versions of one logical cycle, two independent Reality Check boundaries, a revised recurring plan with preserved old occurrences, and a reopened settlement without changing an earlier record.

## 2. Reality Check and recovery

Implement an explicit Reality Check command and pure derivations around it.

- The input is the full amount physically left in the tracked pool. It includes money earmarked for goals and money reserved for unpaid obligations. Compare it with the ledger-derived pool at the observation boundary, never with availability.
- The observation and signed adjustment use the active book's ISO currency. An explicit different currency or ambiguous symbol returns a typed clarification and writes nothing. Version 1 performs no FX.
- Derive physical pool from the active basis and pool-changing cash facts. Goal funding/assignment/release and obligation reservations are classifications or earmarks inside that pool and do not create a physical inflow/outflow for the observation comparison.
- Each observation owns its own boundary-specific adjustment. A later observation starts from the ledger state including earlier accepted adjustments and intervening actuals. Do not use one global unexplained bucket.
- Recovering an activity that occurred at or before a named boundary atomically appends the actual fact and reduces that boundary's unexplained adjustment by the same effective net amount. Repeating the recovery changes nothing through operation idempotency. Correcting or reversing the recovered activity recomputes the linked adjustment forward so the observed-pool invariant remains true.
- If a recovered activity shares the boundary's local civil date and the command does not carry enough information to order it against the boundary, return a typed clarification/review requirement with no writes. An explicit instant before or after the boundary must resolve deterministically under the boundary timezone, including DST rules.
- Expose the unexplained remainder and its classification state. A pool may be Current while classification remains Needs Attention. Pending or ambiguous recovery proposals remain explicit reasons.

Completion criterion: two successive observations plus recovered, corrected, and reversed activity preserve both observed pool amounts exactly, consume each adjustment once, and leave unrelated boundaries unchanged.

## 3. Recurring plans and managed occurrences

Implement effective-dated recurring plan definitions, immutable revisions, and stable occurrence identity for launch's monthly rules.

- Keep planned-not-reserved occurrences distinct from reserved obligations and from actual movement.
- A plan revision affects future and unpaid managed occurrences from its explicit effective date. It never rewrites a paid occurrence, a detached occurrence, or an occurrence retaining an older historical revision.
- Materialization and retries are idempotent. Short-month schedule days clamp explicitly. The occurrence retains the plan revision, due date, due-cycle identity, and managed/detached state.
- Reserving a managed occurrence may create/link an obligation. Paying it creates actual movement in the payment's occurrence cycle while the expectation retains its original due-cycle identity.
- Support explicit detachment before manual editing. A later plan revision must not take control of that occurrence again.
- Do not turn a flexible spending limit into a reservation or subtract it from availability. Keep descriptive flexible-definition links arithmetic-neutral.

Completion criterion: revise a monthly plan across a short month and prove future/unpaid managed occurrences change while paid and detached occurrences remain byte-for-byte attributable to their original revision.

## 4. Settings revisions and open-cycle rebase

Implement versioned timezone/payday changes with explicit effective dates.

- Default edits apply to the next unopened cycle. They do not move current or closed cycles and do not re-date existing actuals.
- Changing the open cycle requires a separate previewed rebase command. It appends the prior cycle version's close/reversal state, creates a new version/boundary under the selected settings, and reports every carry or allocation delta it propagates.
- Handle forward and backward payday moves, day 29/30/31 clamping, UTC-offset crossings, and DST-capable zones. Display-timezone changes never change financial occurrence.
- A retry returns the original receipt. A stale preview or conflicting second rebase writes nothing.

Completion criterion: default settings edits leave an open cycle unchanged, while explicit rebase produces one new version with deterministic boundaries and visible deltas without altering captured facts.

## 5. Close, disposition, carry, reopen, and correction propagation

Implement immutable settlement versions and explicit post-close choices.

- Closing snapshots the named cycle's funds, cash movement, signed reconciliation adjustments, still-reserved commitments, allocations, buffer, signed availability/shortfall, completeness, calculation version, and data-as-of time.
- Close is idempotent for the same operation. Missing, duplicate, ambiguous, or already-current settlements return typed failures rather than silently re-settling.
- Open reserved obligations retain their original due-cycle identity across close. Later payments belong to the actual payment cycle while remaining linked to the expectation.
- Positive free remainder is never moved automatically. Carry-in, tracked-allocation funding, split disposition, or no transfer are explicit confirmed actions from a named settlement. A carry source can be consumed only once. A shortfall stays visible and is carried only through an explicit action.
- Reopen appends a reversal and new settlement/cycle version. It never mutates the closed snapshot. Repeating close/carry/reopen must not duplicate money or leave two effective open versions.
- Backdated recovered/corrected/reversed activity against a closed cycle appends a correction action. Recompute the affected settlement forward and create a visible propagated delta for later carry or allocation decisions. Preserve source attribution.
- If a downstream allocation/carry has already changed and its intent cannot be modified safely, still accept the valid closed-period correction and atomically append an explicit unresolved propagation conflict. Degrade completeness until an explicit resolution. Never hide or drop the correction, partially propagate it, or pretend the historical money fact did not happen.

Completion criterion: a two-cycle sequence with an outstanding obligation, explicit carry, later payment, reopen, and one backdated correction conserves money and retains every original snapshot/version. A downstream changed allocation either receives an exact linked delta or produces a typed unresolved conflict with no invented money.

## 6. Repair multi-cycle calculations

Adapt B's derived queries for more than one cycle.

- Availability uses only the effective active cycle/version basis and that cycle's cash facts, adjustments, residual reservations that still encumber it, allocation attribution, and buffer. Old-cycle actuals must not subtract again from new starting funds.
- Cross-cycle outstanding obligations encumber available funds once. The payment stays in its actual occurrence cycle.
- Completeness uses the active basis and boundary coverage. Old unclassified history outside the covered basis must not permanently contaminate a newer Current pool, while unresolved linked propagation or recovery gaps remain visible.
- Preserve negative availability, exact checked money, B's correction-family derivations, allocation conservation, and separate classification completeness.

Completion criterion: opening the second cycle cannot double-count first-cycle entries, returns, adjustments, reservations, or allocations; targeted regressions prove the corrected scope.

## 7. Command and documentation contract

For every new mutation:

- add strict runtime validation with unknown-field rejection;
- add the typed command, effect, failure, reversal/lifecycle policy, preview output, receipt, and public export;
- dispatch through the shared pure handler path used by preview and execution;
- preserve revision and confirmation binding, same-ID replay, same-ID/different-payload conflict, and injected all-or-nothing failure;
- keep failures typed and no-write. Never throw for user-controlled malformed or ambiguous input.

Update `docs/architecture.md` and `docs/data-model.md` with what Task C actually implements and what D/P04 still own. Do not claim legacy UI integration, persistent storage, sync, PWA, or browser crash safety.

## Required proof

Use production application calls and hand-calculated expectations. Add focused domain suites for recovery, plans, settings/rebase, cycle lifecycle, and cross-cycle propagation, plus bounded seeded property/state tests. At minimum prove:

1. Start with 1,000 SAR, fund and assign 200 to a goal, reserve a 100 bill, then observe 1,000. The adjustment is zero and availability is 700. Repeating the observation changes nothing. Releasing 100 keeps the observed pool at 1,000 and raises availability to 800 without an external inflow.
2. Observe a 100 shortfall, recover a 60 pre-boundary expense, then correct it to 40 and finally reverse it. The linked unexplained adjustment moves from -100 to -40 to -60 to -100 while the boundary's observed pool stays fixed. A second later boundary remains independent.
3. A same-date recovery without ordering evidence returns clarification and no write. Explicit instants on each side of the boundary behave differently and survive a Riyadh/UTC crossing plus one DST-capable timezone case.
4. A monthly plan revision updates a future unpaid managed occurrence but leaves one paid occurrence and one detached occurrence on their historical revisions. Month-end day 31 clamps in February and retries do not duplicate occurrences.
5. A payday/timezone edit defaults to the next unopened cycle. Explicit open-cycle rebase handles forward/backward anchors, short months, stale confirmation, and retry without moving existing activity.
6. Close a cycle with an unpaid obligation and explicit carry. Open the next cycle, pay the obligation there, then close/reopen/reclose without duplicating its reservation, payment, settlement, or carry.
7. Backdate a correction into the closed source cycle after its carry or tracked allocation has been consumed downstream. Apply an exact linked propagation when safe; otherwise return/store an explicit conflict and keep completeness non-Current. No historical snapshot changes.
8. Open a second ordinary cycle after first-cycle expenses, returns, adjustments, and allocations. Its availability and completeness exclude old-cycle cash effects while keeping valid outstanding cross-cycle commitments once.
9. Foreign-currency and ambiguous-symbol Reality Check inputs, cross-book references, stale previews, replayed operations, changed payload under the same operation ID, and injected failure all leave no partial writes.
10. Start a `remaining-from-boundary` cycle at a named observed amount. Pre-boundary recovered outflow/inflow/return improves history without changing that starting pool again; post-boundary movement changes it normally. Future-effective activity is excluded from an earlier observation even when inserted first.

Property/state checks must cover conservation across observation/recovery, settlement/carry/reopen, plan materialization, and retry. Keep them seeded and bounded. A test model must not copy the production reducer line for line.

Keep the test boundaries readable. Prefer focused files named `reality-check-recovery.test.ts`, `recurring-plans.test.ts`, `cycle-settings-rebase.test.ts`, `cycle-lifecycle.test.ts`, `backdated-propagation.test.ts`, and `task-c-command-safety.test.ts`, with corresponding bounded property files. Reuse or extract one command harness rather than duplicating preview/execute boilerplate through every suite.

Run targeted tests during implementation. At handoff run once:

```bash
npm run lint
npm run typecheck
npm test
npm run test:property
npm run build
git diff --check
```

No browser or visual matrix is required because Task C must not change the UI/bootstrap path. Explain any pre-existing failure; never weaken a legitimate check to obtain green output.

## Finish

Commit only Task C product, test, and implementation-document files as:

`Rushd P03: implement recovery and cycle lifecycle`

Do not amend earlier commits and do not push. Stop before Task D.

Then save a concise report to `/Users/mehmet/Desktop/Rushd/artifacts/agent-reports/P03-C.md`. The report is explicitly authorized and Git-ignored. Include task ID `P03-C`, complete/blocked status, completion time, repository path, exact base/result SHA, actual model/reasoning setting, delivered commands and public queries, changed files/diff size, command results, important semantic choices, and unresolved risks. If a credible path to silent data loss, duplication, or materially wrong money remains, stop and report it instead of broadening or hiding it.

Your final chat reply should only confirm that the report was saved and give its path.
