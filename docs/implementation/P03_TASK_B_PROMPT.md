# Rushd P03 Task B: everyday financial behavior

Implement B in `/Users/mehmet/Desktop/Rushd`, branch `codex/rushd-rebuild-plan`, after Task A correction `51659e6`. You are the GLM 5.3 Flash worker; Astra owns technical integration. Select Max if the host exposes it; otherwise use the available thinking mode and report the actual setting without claiming a verified tier. Interacting payments, reservations, and allocations justify deeper reasoning.

## Outcome and context

Deliver usable domain/application behavior for expenses, returns, linked corrections, obligations, goal allocations, availability, pacing, and completeness. This is one substantial backend capability. Existing UI and legacy storage remain unchanged; C owns recovery/recurrence/cycle close and D owns final storage/sync contracts.

Read `AGENTS.md`, `WORKFLOW_LITE.md`, `P03_EXECUTION_PLAN.md` architecture/Reality Check decisions and Task B, plus final master plan section 3. Inspect the actual public API in `src/application/commands/index.ts`, contracts, and the test adapter. Use targeted existing tests for patterns rather than re-reading historical prompts/research. A's public operation shape is the starting point, not a reason to copy its large handlers into one growing file.

Check HEAD/status first and preserve all unrelated edits. The Master's routing and prompt documents are uncommitted. You are not alone in the workspace; do not revert or stage another person's files. If starting after a new foundation correction, use that descendant and report your actual base.

## Ownership

Own `src/domain/{activity,obligations,allocations,calculations}/**`, necessary extensions to `src/domain/contracts/**` and `src/application/commands/**`, corresponding `tests/domain/**` and `tests/property/**` including adapter support, and `docs/architecture.md` / `docs/data-model.md`. Necessary maintenance of existing source-manifest coverage, lint/typecheck/test configuration, and package files remains within P03's explicit tooling scope.

Keep legacy runtime/shared compatibility functions, screens, database contents, and Master planning documents untouched. The one additional primitive path authorized here is `src/domain/primitives/instant.ts` for the correction below. Keep existing A regressions and command retry semantics intact as the state model grows.

## Small prerequisite correction, included in B

The focused follow-up confirmed A's reversal-date binding and representable-instant rejection, with both focused suites passing, 9 tests total. One era edge remains: `resolveCivilDate(new Date('0000-01-01T00:00:00Z').getTime(), 'UTC')` currently succeeds as `0001-01-01`; astronomical year -1 similarly becomes CE year 2. `Intl` outputs a positive year-of-era, and the current formatter/resolver does not inspect the era.

Request and validate the Gregorian era before constructing a supported civil date, so BCE/year-zero values cannot alias to CE dates. Add focused year-zero/BCE rejection and CE year-one acceptance tests through the public primitive. Confirm the application still gives a typed no-write failure for unsupported occurrences. Include this small correction in the B commit and continue with the main task; no separate approval or correction round is needed.

## Implement

1. **Actual activity.** Introduce immutable actual expense and linked return/reversal/replacement records with explicit occurrence, book currency, cycle identity, source operation, and capture metadata. Editing a paid fact creates a linked correction, atomically with its replacement when applicable. Returns represent actual money received; an expected refund adds no money. Prevent duplicate reversal and returns exceeding the linked returnable amount; unrelated income remains an inflow. Category and optional flexible-definition links affect classification/monitoring only, never availability. Manual spending can reveal a shortfall and must not be silently clamped or hidden.

2. **Obligations.** Keep an expected item separate from actual money movement. Reservation requires explicit intent, not an inferred category. Implement open/partially settled/finally settled/cancelled state, with dispute as an independent overlay. Support multiple linked payments and returns. Residual reservation for an open obligation is `max(0, expected - unreversed net payments)`. Final settlement and confirmed cancellation release the residual; a return after final settlement does not silently reopen it. Reopening is explicit. Posted disputed payments remain outflows; unpaid disputed residual remains reserved unless the user confirms a reservation-release action, which records unresolved uncertainty. Ordinary planned-not-reserved items do not reduce availability.

3. **Goals and tracked allocations.** Record goal identity/target and separately attributed funding, assignment, unassignment, release, and linked reversal. Funding moves spendable funds into the tracked allocation pool once. Assignment divides already-funded money among goals without a second availability deduction. Unassignment returns money to tracked-unallocated, not to spending. Release names the destination cycle and returns money to spending exactly once. Preserve funding-source links and reject attempts to assign or release more tracked funds than exist. Goal progress is its assigned balance, never a shared vault total. Preserve history and use the command's explicit confirmation for changes with financial effects.

4. **Availability and pacing.** Provide a pure query returning signed available minor units, exact breakdown, currency, data-as-of, calculation version, separate completeness dimensions and reasons. Derive from starting funds/inflows minus net actual outflows, residual reservations, net cycle allocations, and explicit buffer. Add a typed buffer-setting command. Flexible limits are guidance, never another subtraction. Show negative results as shortfalls in the result contract; formatting/UI is later. Pacing uses explicit eligible remaining civil dates, avoids duplicate-day/zero-day division, and keeps integer-money arithmetic exact with a documented remainder. It never becomes a stored source of truth.

5. **Completeness.** Derive Current/Needs Attention/Records Only/Unavailable from the evidence actually supported by these records. Pool certainty and classification coverage are independent. An unresolved provisional/disputed reservation or proposal reason cannot disappear merely because all transactions have categories; an unclassified movement need not invalidate a known pool. Return reasons rather than a manually writable Current flag. Missing basis produces an unavailable decision amount or an explicitly records-only estimate, never a fabricated zero or affirmative affordability advice. C extends the reducer with observed boundaries/recovery. Keep new evidence types explicit and leave unsupported future transitions clearly unimplemented.

6. **One mutation boundary.** Every new mutation uses runtime validation, preview/confirmation, state revision checks, atomic state+receipt+outbox, and the existing idempotency policy. Confirmation must cover material amounts, targets, and financial dates. Extend immutable records and queries rather than introducing a second mutable finance store or calling legacy DB methods. Update the public API and a short usage example for C.

## Concrete checks

Use production application calls and independent hand-calculated expectations, not a duplicate implementation in tests. Cover at least:

- Start with 1,000 SAR, fund/assign 200 to a goal, reserve a 100 bill: availability is 700. The total tracked pool still includes earmarked goal funds. Assigning the funded amount does not change availability again. Releasing 100 increases availability to 800 without inventing external cash. Reality Check itself remains C's work.
- With 1,000 starting funds and an 80 obligation, availability is 920. Paying 30 leaves a 50 reservation and availability 920. A second payment of 35 still leaves availability 920 while open; explicit final settlement releases 15 and makes availability 935. A subsequent real return of 10 makes it 945 without reopening the obligation. Include overpayment, disputed residual release, and explicit reopening variants.
- A standalone expense, partial return, and linked correction preserve original facts and update the exact components. An expected refund has no effect. A category/flexible-link change leaves the amount unchanged. Overspending produces negative availability.
- Double assignment/release, repeated commands, changed payload under the same operation ID, stale confirmation, foreign-book references, and injected multi-record failure have no extra or partial effect.
- Completeness reasons change only when their underlying evidence changes; missing classification and missing pool basis produce different results. No eligible pacing days yields a typed unavailable pacing result.

Add bounded seeded state/property checks for conservation, reservation/payment replacement, allocation isolation, immutable paid facts, and retry/failure behavior. Keep tests proportional; do not manufacture hundreds of nearly identical cases or extend into release-scale mutation testing.

Run targeted tests during implementation. At handoff run lint, typecheck, `npm test`, `npm run test:property`, build, and diff check once. No browser/visual matrix is required because UI/legacy bootstrap remain unchanged. Explain any existing failure rather than weakening a check to obtain green output.

## Finish

After checks pass, commit only Task B files as `Rushd P03: implement everyday finance behavior`. Do not amend A or push. Stop before C. Return the commit/base, actual thinking setting, delivered behaviors and API entry points, commands/results, remaining limitations, and any semantic choice that materially affects C. Keep the report concise; the founder will forward it to Astra.
