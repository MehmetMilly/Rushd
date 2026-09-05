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
`obligation-handlers`, `allocation-handlers`, and matching `validation-*`
modules) behind the unchanged `previewCommand`/`executeCommand` hub, so
every new mutation keeps runtime validation, preview/confirmation, revision
checks, atomic state+receipt+outbox commits, and the idempotency policy.

Not implemented yet (later P03 tasks): Reality Check/recovery and observed
boundaries, recurring plans and occurrences, cycle close/carry/reopen,
obligation due dates, persistent storage, and sync.

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
