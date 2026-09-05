# Rushd P03 Task A: exact primitives and executable command foundation

Implement Task A in `/Users/mehmet/Desktop/Rushd` on `codex/rushd-rebuild-plan`. You are the implementation worker; Astra is the Development Master. Use GLM 5.3 Flash with Max reasoning, confirmed available by the founder, and report the actual selected mode. Exact arithmetic, revisions, and retry interactions justify this setting. This task has explicit behavior and objective checks; resolve ordinary implementation choices yourself.

## Outcome and context

Deliver a working, strict-TypeScript foundation for exact money, profile-timezone dates/monthly cycles, and atomic, revision-checked, retry-safe commands. Prove it through a real create-book → open-cycle → record-inflow → reverse-inflow flow. This is Task A, not all of P03.

Read `AGENTS.md`, `WORKFLOW_LITE.md`, and `docs/implementation/P03_EXECUTION_PLAN.md` through Task A. Consult final master plan sections 3 and 9 for financial/time/identity rules, and the P03 acceptance in `phase-plan.json`. Inspect package/TS/lint configuration and `scripts/production-source.mjs` before adding files. Existing runtime code is legacy compatibility, not the canonical arithmetic to copy. Skip old receipts, phase-state machinery, research packets, and chat history.

Check HEAD/status first. The base includes `f80cfc9` plus the Development Master's P03 planning commit. Preserve unrelated edits. You are not alone in this workspace: keep ownership narrow and do not revert another agent's work.

## Ownership

Create modules under `src/domain/primitives/**`, `src/domain/contracts/**`, and `src/application/commands/**`; create corresponding `tests/domain/**` and `tests/property/**`. You also own necessary edits to `package.json`, `package-lock.json`, `scripts/production-source.mjs`, `tests/p02-build-contract.test.mjs`, `eslint.config.cjs`, `tsconfig.json`, optional `vitest.config.ts`, and the implemented-API sections of `docs/architecture.md` / `docs/data-model.md`.

Keep the existing UI, legacy runtime, database, and bootstrap unchanged. New functionality is called through its application API in tests; no browser wiring, migration, cloud service, or real data is part of this task. Do not modify the master plan, phase plan, or Development Master documents.

## Build and demonstrate

1. **Exact values.** Define checked minor-unit money and currency metadata, distinct civil-date/cycle/identity types, and runtime validators. Support at least SAR/USD, JPY, and KWD with correct ISO exponents. Parse Arabic/Western numerals exactly from supported decimal input; reject malformed input, unsupported currency, excess precision, overflow, and invalid command-specific signs. A money type can represent signed values; an ordinary inflow amount must be positive. Arithmetic rejects currency mismatch and unsafe intermediate/results. No silent rounding or FX. Keep serialized money in checked integer units.

2. **Dates and cycles.** Validate actual Gregorian dates, including leap years. Compute first-of-month and chosen-payday cycles using explicit inclusive-start/exclusive-end boundaries, clamping the anchor in short months. Resolve an instant to the profile's civil date through an explicit IANA timezone. Supply clocks and IDs through context rather than reading ambient globals inside the domain. Preserve captured date/timezone/cycle identity. Test Riyadh midnight and a DST timezone; do not implement your own timezone database. Effective-date rebase and historical recovery belong to C, but these primitives must support them.

3. **Executable commands.** Implement runtime-validated discriminated commands and typed failures, receipts, revisions, and outbox envelopes. Provide one documented preview/execute API and concrete handlers for book creation, opening a full cycle, inflow, and linked inflow reversal. An empty book has explicit initialization semantics. Currency is bound to the book. The preview identifies the payload, book, and revisions it covers; execution revalidates them. Unknown fields/invalid data must not slip through a TypeScript cast. Each command declares its reversal policy; reversals append linked facts rather than deleting original history. Reject duplicate reversal and unsafe operations explicitly.

4. **Atomic retry behavior.** Define a narrow repository transaction port. Within one transaction check the operation identity, validate state/revisions, and commit state changes plus receipt and outbox. Same operation ID and same command content returns the original committed receipt without a second effect, even if the caller still holds the old revision. Same ID with changed content fails. A new operation with stale revision fails and requires a refreshed preview. Keep idempotency scope and canonical payload comparison explicit. IDs, book ownership, and actor metadata must not imply implemented cloud authorization.

5. **A functioning adapter for tests.** Implement a transactional in-memory adapter under the test directories. It must isolate uncommitted mutations, enforce revision checks under two concurrent commands, and roll back on injected failure. Exercise the production application functions through it, not copied formulas or mocked success results. Expose a reusable contract for P04's persistent adapter. Do not claim crash-safe browser durability from this proof.

6. **Tooling and handoff.** Add compatible Vitest/property-test tooling with a lockfile. `npm test` retains all current regressions and runs new domain examples. `npm run test:property` runs bounded seeded properties. Ensure lint/typecheck actually include new source and tests, while preserving the named P02 compatibility exceptions. Extend the exact production-source coverage mechanism without replacing it with a check that silently accepts every new file. Document the public API with one short usage example and distinguish implemented behavior from future P03 tasks.

## Required proof

Use a compact set of meaningful examples/properties:

- Exact 0/2/3-decimal handling, bilingual digits, arithmetic overflow and cross-currency rejection; impossible dates and short-month/payday membership.
- Real command sequence with expected minor-unit balances, one linked reversal, and immutable original facts.
- Exact retry after successful commit; retry after simulated lost acknowledgement returns the same result; altered-payload ID reuse and stale previews produce no writes.
- Failure between tentative state/receipt/outbox operations leaves all unchanged. Competing commands against one base revision cannot both commit conflicting results.
- Invalid runtime input and cross-book references cannot mutate state. New typed objects must not leak writable references to repository internals.

Run targeted tests while building. Before handoff run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:property`, `npm run build`, and `git diff --check`. Fix failures introduced by this task; report unrelated pre-existing failures honestly. No full visual matrix or browser run is required because the UI/legacy bootstrap stays unchanged. Avoid exhaustive random campaigns; deterministic reproductions and bounded properties are enough here.

Availability, obligations, goal accounting, Reality Check, recurring-plan changes, cycle close/reopen, persistent storage, and production sync are later tasks. Do not implement speculative handlers for them now. Preserve the agreed distinction between a full tracked-pool observation and available money for future integration.

## Finish

After the required checks pass, commit only your task files as `Rushd P03: add exact primitives and command foundation`. Do not amend earlier commits or push. Stop after A.

Return the commit SHA, selected reasoning setting, concise implementation summary, API entry points for B, exact commands/results, and unresolved issues. Call out any assumptions or deviation that affects later tasks. The founder will forward your response to Astra; you do not need to contact another coding app or create process receipts.
