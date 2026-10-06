# Rushd P04-D4 worker card: remaining ports and atomic authority cutover

## Dispatch

- Repository: `/Users/mehmet/Desktop/Rushd-P04D-Restart`
- Branch: `codex/p04d-restart`
- Base product commit: `877eb27`; preserve every uncommitted manager planning/workflow edit
- Model: OpenCode `opencode/muse-spark-1.3-contributor-free`, variant High
- Reason: D4 is a broad but explicitly contracted integration slice; use the free Muse route first and rely on deterministic finance/data/browser gates
- Result: `/Users/mehmet/Desktop/Rushd-P04D-Restart/artifacts/agent-reports/P04-D4.md`
- Git: leave product changes uncommitted for independent review; do not stage, commit, push, deploy, publish, or start D5/P05

## Hotspot constraints

The founder is on a limited personal hotspot. Work from local repository files
only. Do not browse the web, fetch remotes, install/update packages, download
browsers/assets, call external services, launch subagents, or emit verbose logs.
Reuse installed dependencies and accepted D1–D3 evidence. Run focused tests while
developing and each broad final gate once unless a failure requires a rerun.

## Read first

1. `AGENTS.md`
2. `WORKFLOW_LITE.md`
3. `docs/implementation/P04_D_RESTART_ARCHITECTURE.md`
4. `docs/implementation/P04_D_RESTART_PLAN.md`
5. P04 in `docs/implementation/phase-plan.json`
6. `docs/implementation/P04_D_TASK_D4_PROMPT.md`
7. D3 reports: `artifacts/agent-reports/P04-D3.md`, `P04-D3-REVIEW.md`, `P04-D3-REREVIEW.md`, `P04-D3-FINAL-REREVIEW.md`
8. `src/application/p04-d/**`, `src/app/root-controller.*`, `src/app/root-template.html`, `src/main.ts`
9. canonical Plan/Goals/cycle/settings/portability commands, derives, and accepted P04-B/C persistence
10. current mutation inventory and D1–D3 browser/PWA/data gates

The rejected checkout at `/Users/mehmet/Desktop/Rushd` is forensic only. Do not
copy or cherry-pick its shell, views, generic navigation, placeholders,
composition root, or visual rewrite.

## Outcome

Move every remaining enabled overlapping read/write path—Plan, Insights, Goals,
settings/lifecycle, template materialization, portability, import, reset, and
navigation persistence—behind canonical ports in the established shell. Prove
complete mutation ownership, then make one explicit build-time production
authority cutover. After the cutover, v1 is extraction-only; no UI action may
write it. Preserve the current visual hierarchy and useful populated screens.

## Owned paths

- `src/main.ts`, `src/application/bootstrap.*`, `src/application/p04-d/**`
- `src/app/root-controller.*`, `src/app/root-template.html`
- `src/pwa/**`, `public/**`, `index.html` only for the scoped production PWA
  registration/manifest/cutover wiring
- minimal `src/data/migration/**` or `src/data/portability/**` adapter glue only
  when an accepted interface cannot be composed without it; do not change domain
  semantics or migration mappings casually
- `tests/application/**`, `tests/pwa/**`, `tests/data/**`, and focused D4 browser
  harnesses
- `scripts/production-source.mjs`, `package.json` scripts only, Vite config only
  for a compile-time authority constant if necessary
- `docs/architecture.md` and directly relevant P04 implementation docs

Do not edit shared styles, redesign components/navigation, add cloud/accounts/
AI, change finance semantics, change the IndexedDB v1 name, add dependencies,
touch deployment configuration, or start D5/P05. If a broader path is truly
required, stop and record the exact blocker.

## Required work

1. **Complete canonical port ownership.** Route all remaining candidate-mode
   controller reads/writes through Plan, Insights, Goals, portability,
   navigation, and lifecycle ports. No candidate path may reach v1 `Store`,
   `DB`, local finance objects, or legacy persistence—not even by direct method
   invocation, disabled-control bypass, error recovery, onboarding, month-end,
   or route restoration.
2. **Plan and materialization.** Use existing canonical recurring-plan commands
   and deterministic occurrence IDs. Preserve profiles/templates only where the
   canonical model has exact semantics; otherwise present a truthful disabled or
   migration-review state rather than inventing recurrence, off-day, flexible,
   or assignment facts. Auto-fill/materialization must be atomic/idempotent and
   never recreate a paid/detached occurrence.
3. **Insights.** Derive month totals, category breakdown, weekly spending,
   tracked-pool availability, commitments, and unknown/incomplete states from
   committed canonical facts and existing derive helpers. Never restate finance
   formulas or convert unknown budget/safe-to-spend into zero.
4. **Goals and month-end.** Route goal creation/deletion/funding and cycle close,
   remainder disposition, reopen/correction through the accepted append-only
   commands. Preserve audit history and truthful uncertainty. Never reward
   spending, underspending, wealth, transaction count, or app opens.
5. **Settings/lifecycle/navigation.** Route canonical book settings through
   `updateBookSettings`/cycle rules with effective-date validation. Keep purely
   local UI preferences local and authority-gated. Preserve route/date intent,
   Arabic/English direction, and the locked permanent hierarchy. Ask Rushd may
   remain a truthful later-phase destination; never replace a populated screen
   with a blank generic shell.
6. **Portability.** Wire versioned export, preview/confirm import replacement,
   reset, local-preference clearing, and recovery to P04-C commit points. Import
   and reset must not show success before durable activation, must coordinate
   across tabs/updates, and must never produce dual v1/v2 writers.
7. **Migration/startup.** On first canonical production start, extract the
   unchanged v1 snapshot read-only, migrate through the accepted staging/pointer
   protocol, and mount the established shell throughout preparation/failure.
   Reopening an existing canonical namespace must not re-migrate or overwrite it.
8. **Atomic release latch.** Introduce one build-time production authority
   choice that cannot be changed by URL, cookies, local/session storage, import,
   globals, runtime environment text, or stale cached code. Switch it to
   canonical only after mechanical mutation ownership passes. Do not leave a
   user-reachable dual-authority toggle.
9. **No v1 writes after cutover.** Mechanically scan/trace every enabled
   controller action. v1 may be opened only for immutable extraction/backup
   compatibility during migration. Old tabs/binaries must lose write authority
   via the epoch mechanism. Failure must be visibly write-blocked, never fall
   back to legacy writes.
10. **Production PWA lifecycle.** Register the reviewed local service worker only
    on the canonical production path, retain zero external runtime requests,
    preserve rejected-shell retirement, and coordinate activation with live
    write/import/reset/migration leases and one epoch bump.
11. **UI preservation.** Keep header, hero, day strip, cards, FAB, modals,
    populated Plan/Insights/Goals/Transactions views, permanent navigation,
    bilingual copy quality, RTL/LTR, numeric isolation, accessibility, and motion
    intact. Make only minimum truthful blocked/recovery/correction changes.
12. **D4 mutation proof.** Update the inventory/tests so every enabled mutation
    has exactly one canonical port owner after cutover. A missing, duplicate,
    direct v1, or unclassified writer must fail the gate.

## Acceptance

1. Production build uses the established shell with canonical authority; there
   is no runtime/user switch and no v1 UI writer.
2. Existing fake v1 data migrates once, preserves source bytes, renders useful
   Home/Transactions/Plan/Insights/Goals state without invented fields, and
   reopens the same canonical namespace offline.
3. Every enabled financial/settings/import/reset action is canonical or visibly
   disabled before invocation; direct method calls cannot bypass the port layer.
4. Plan materialization, goal/cycle operations, corrections/reversals, import,
   and reset are append-only/atomic/idempotent with explicit durable success.
5. Cross-tab commits invalidate views; active operations block update activation;
   old tabs cannot write after epoch/cutover; no dual writers exist.
6. Storage/migration/import/reset failure mounts the established shell in a
   truthful write-blocked recovery state and never falls back to v1 writes.
7. Export/import/reset preserve versioning, validation, confirmation, scope, and
   commit points; local preference clearing does not erase unrelated data.
8. Populated destinations, route/date restoration, Arabic/English direction,
   numeric isolation, accessibility, and visual parity remain intact.
9. Runtime makes zero external requests and supports reload/offline operation
   through the production PWA path.
10. Changed files stay inside owned paths and `git diff --check` passes.

## Validation

Create `npm run test:p04d4` for the integrated production-cutover gate. Run:

```bash
npm run lint
npm run typecheck
npm test
npm run test:data
npm run test:pwa
npm run test:p04d3
npm run test:p04d4
npm run build
npm run test:browser
npm run test:legacy-idb
npm run parity:quick
git diff --check
```

Run each broad command once on the final tree. The D4 browser gate must use the
real production entry and established template, exercise migrate/reload/offline/
cross-tab/import/reset/failure, and prove zero v1 writes. Use fake data only. Do
not weaken existing gates.

## Report

Write `/Users/mehmet/Desktop/Rushd-P04D-Restart/artifacts/agent-reports/P04-D4.md`
concisely with status, model/effort, elapsed time, changed paths, authority/startup
trace, complete mutation ownership map, semantic unknown/disabled decisions,
cutover/PWA/migration/portability/cross-tab evidence, exact command results, UI
preservation proof, risks, and deviations. Do not claim D5/P04 closure. Stop with
the product tree uncommitted.
