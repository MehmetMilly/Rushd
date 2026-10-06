# Rushd P04-D3 worker card: Home, Add, and Transactions canonical ports

## Dispatch

- Repository: `/Users/mehmet/Desktop/Rushd-P04D-Restart`
- Branch: `codex/p04d-restart`
- Base product commit: `f193fdc`; preserve every existing uncommitted manager planning/workflow edit
- Model: OpenCode `opencode/muse-spark-1.3-contributor-free`, variant High
- Reason: D3 is substantial multi-file integration, but it has explicit canonical commands, a preserved UI boundary, and deterministic browser/data/parity gates, so the free Muse route gets first ownership
- Result: `/Users/mehmet/Desktop/Rushd-P04D-Restart/artifacts/agent-reports/P04-D3.md`
- Git: leave product changes uncommitted for independent review; do not stage, commit, push, deploy, publish, or start D4/P05

## Read first

1. `AGENTS.md`
2. `WORKFLOW_LITE.md`
3. `docs/implementation/P04_D_RESTART_ARCHITECTURE.md`
4. `docs/implementation/P04_D_RESTART_PLAN.md`
5. P04 in `docs/implementation/phase-plan.json`
6. `artifacts/agent-reports/P04-D2-REVIEW.md`, especially findings and D3-owned boundaries
7. `src/application/p04-d/**`, `src/application/bootstrap.*`
8. `src/app/root-controller.*` and `src/app/root-template.html`
9. `src/domain/contracts/{commands,ledger}.ts`, relevant derive helpers, and P03 command handlers
10. existing browser, legacy-IDB, parity, PWA, and data tests

The rejected checkout at `/Users/mehmet/Desktop/Rushd` is forensic evidence
only. Do not copy/cherry-pick its shell, views, navigation, placeholder screens,
composition root, or visual rewrite.

## Outcome

In explicit candidate mode only, make the established Home, Add, and
Transactions experiences read and write through canonical D2 feature ports and
the P03 command gateway. Preserve the current header, hero, day strip, cards,
FAB, modal composition, populated destinations, bilingual copy, RTL/LTR,
numeric isolation, and motion behavior. Default production remains entirely
legacy-authoritative and visually unchanged.

## Owned paths

- `src/application/p04-d/**`
- `src/application/bootstrap.js`, `src/application/bootstrap.d.ts`
- `src/app/root-controller.js`, `src/app/root-controller.d.ts`
- `src/app/root-template.html` only for the smallest candidate-port routing,
  truthful disabled state, or non-destructive correction/reversal affordance
- `src/pwa/**`
- `tests/application/**`, `tests/pwa/**`, and a focused D3 browser harness
- `scripts/production-source.mjs`, `package.json`, and lockfile only if a test
  script/dependency actually changes
- `docs/architecture.md` and directly relevant compatibility documentation

Do not edit shared styles, component hierarchy, permanent navigation, data
migration/domain semantics, sync-provider contracts, cloud/account code,
release/deployment configuration, `index.html`, or `vercel.json`. Do not start
Plan/Insights/Goals/portability cutover work from D4. If a requirement truly
needs broader scope, stop and document the exact blocker instead of expanding.

## Required work

1. Close D2 review findings that are prerequisites for UI routing:
   - make the memory-adapter import restore actual snapshot rows and assert row
     identity, not only pointer generation;
   - connect successful service-worker activation/update to a monotonic epoch
     bump so stale tabs lose write authority without caller-optional glue;
   - prevent epoch rollback within a live tab;
   - make long critical sections refresh a lease, or otherwise prove update
     activation cannot cross a live operation longer than the old TTL;
   - reject unknown/unbound injected feature-port sets even in legacy mode.
2. Add an explicit candidate-shell adapter/seam. It may be passed only through
   build/test injection and must reuse `createLegacyApplication` plus the
   established template. Ordinary `src/main.ts` must not pass candidate inputs.
3. In candidate mode, source selected date, selected-day rows, daily totals,
   safe-to-spend, and Transactions/history rows from committed canonical state.
   Do not read v1 finance state as a fallback after canonical authority is ready.
4. Do not invent missing canonical fields. Canonical actual expenses may display
   their committed amount as both the current card amount and paid amount only
   where the UI needs one legacy-shaped number; document that mapping. Do not
   fabricate exact dates for obligations that only retain a due cycle, fake
   classifications, fake plan links, or fake budget/safe-to-spend values.
5. Route manual Add through canonical capture and P03 preview/confirm/execute.
   The user-entered expense amount is an actual committed outflow in candidate
   mode; do not silently create an unpaid legacy row or celebrate underspending.
   Template and flexible-definition creation remain D4-owned and must stay
   visibly unavailable in candidate mode rather than write v1.
6. Prevent duplicate submit. Close the Add modal, show success, update totals,
   announce cross-tab invalidation, or otherwise mutate visible committed state
   only after durable command success. A validation, authority, revision,
   operation-ID, storage, or acknowledgement failure must leave the modal/data
   truthful and retryable with no duplicate record.
7. Implement history edits and deletes with append-only canonical commands:
   - edit an actual expense through `correctExpense` with a linked reversal and
     replacement;
   - delete through `correctExpense` with `replacement: null`;
   - batch delete as individually confirmed append-only reversals with explicit
     partial-failure handling; never report all-success if one fails.
   The old records must remain in canonical history/audit state even when the
   live Transactions view hides reversed entries.
8. Map payment/reopen actions only when their canonical semantics are exact.
   A paid actual may be corrected/reversed; do not mutate it in place. Do not
   invent a dated unpaid obligation from a model that does not store that date.
   Any unsupported pay/reopen/auto-fill or bulk-unpaid action must be visibly
   disabled/blocked in candidate mode and must never fall through to v1.
9. Candidate authority `preparing`/`unavailable` must keep the established shell
   mounted while blocking every Home/Add/Transactions writer. Never show success
   from the legacy controller when canonical authority is blocked.
10. Keep operation IDs reload-unique and retry-stable. A retry after a lost
    acknowledgement may reuse the same operation ID; a new intent/reload must
    not collide with persisted journal history.
11. Extend mechanical mutation ownership tests so every D3-owned controller
    action routes to exactly one port in candidate mode and cannot reach
    `Store`/`DB`. Legacy mode must preserve its current delegates.

## Acceptance

1. Default production still mounts `createLegacyApplication`, opens/writes only
   v1, registers no candidate PWA, and passes the existing browser, legacy-IDB,
   bilingual, debug, and visual-parity behavior unchanged.
2. An isolated candidate build mounts the same established shell and populates
   Home and Transactions from a synthetic migrated canonical book without
   invented fields or legacy finance fallback.
3. Selecting a day refreshes canonical Home/history rows and totals; a commit in
   another tab becomes visible without reload through coordination invalidation.
4. Manual Add commits exactly once through the P03 gateway, appears only after
   durable success, survives reload, and appears in another tab.
5. Validation, storage, authority, revision, operation-ID, and lost-
   acknowledgement cases never show false success or create duplicates.
6. Edit appends a linked correction; delete appends a reversal; live views update
   while audit history retains original facts. Batch failure is explicit and
   never reports a false all-success.
7. Unsupported template/flexible/pay/reopen/auto-fill actions are visibly blocked
   in candidate mode and cannot mutate v1 or canonical state.
8. Storage/PWA update epoch changes hard-block old tabs, remain monotonic, and
   never activate across a live long-running write/import/reset/migration.
9. Header, hero, day strip, cards, FAB, modal composition, permanent navigation,
   Arabic/English quality, direction, numeric isolation, and motion remain
   unchanged except for the minimum truthful blocked/correction behavior.
10. Changed files stay inside owned paths and `git diff --check` passes.

## Validation

Create a focused `npm run test:p04d3` gate if one does not already exist. Run
focused tests during development, then run:

```bash
npm run lint
npm run typecheck
npm test
npm run test:data
npm run test:pwa
npm run test:p04d3
npm run build
npm run test:browser
npm run test:legacy-idb
npm run parity:quick
git diff --check
```

The D3 browser gate must exercise the real established template in explicit
candidate mode, not only a synthetic API page. Use clearly fake data. Do not
weaken, delete, or bypass existing D1/D2, migration, rollback, build-contract,
browser-smoke, legacy-data, PWA, or parity assertions. If a gate is
environmentally unavailable, record the exact command/error and preserve the
candidate for review.

## Report

Write `/Users/mehmet/Desktop/Rushd-P04D-Restart/artifacts/agent-reports/P04-D3.md` with:

- complete or blocked status;
- actual model/effort and elapsed time;
- base commit and uncommitted result state;
- changed paths;
- candidate-shell adapter and mutation-routing summary;
- canonical read-model mapping, including every intentionally unavailable field
  or action;
- Add, correction, reversal, cross-tab, failure, and PWA epoch evidence;
- disposition of every D2 review finding;
- every validation command and result;
- explicit proof default production and established visuals/navigation stayed
  unchanged;
- risks, limitations, and architecture deviations.

Do not claim D4, P04-D, or P04 complete. Stop after writing the report.
