# Rushd P04-D2 worker card: canonical host and preserved-shell PWA lifecycle

## Dispatch

- Repository: `/Users/mehmet/Desktop/Rushd-P04D-Restart`
- Branch: `codex/p04d-restart`
- Base product commit: `f15900b`; preserve all existing uncommitted planning and workflow edits
- Model: OpenCode `opencode/muse-spark-1.3-contributor-free`, variant High
- Reason: D2 is substantial integration work, but its storage, lifecycle, concurrency, compatibility, and PWA outcomes are deterministic enough for the free Muse route
- Result: `/Users/mehmet/Desktop/Rushd-P04D-Restart/artifacts/agent-reports/P04-D2.md`
- Git: leave product changes uncommitted for independent review; do not stage, commit, push, deploy, or publish

## Read first

1. `AGENTS.md`
2. `WORKFLOW_LITE.md`
3. `docs/implementation/P04_D_RESTART_ARCHITECTURE.md`
4. `docs/implementation/P04_D_RESTART_PLAN.md`
5. P04 in `docs/implementation/phase-plan.json`
6. `artifacts/agent-reports/P04-D1-REVIEW.md`, especially residual findings
7. `src/application/p04-d/**`, `src/application/bootstrap.*`, and `src/main.ts`
8. `src/data/v2/**`, `src/data/migration/**`, and `src/data/portability/**`
9. P03 command/sync contracts under `src/application/commands/**` and `src/application/sync/**`
10. current service-worker retirement files and existing data/browser test harnesses

The rejected checkout at `/Users/mehmet/Desktop/Rushd` is forensic evidence
only. You may understand isolated accepted mechanisms from it, but do not
cherry-pick or copy its root shell, views, generic navigation, placeholder
destinations, or production composition change.

## Outcome

Assemble the canonical guest host and PWA lifecycle behind D1's explicit
candidate latch while preserving the established legacy shell and all default
production behavior. Candidate-mode tests must be able to open/migrate/write/
reload canonical v2 state offline. Ordinary production must still mount
`createLegacyApplication`, stay on legacy authority, and never open v2.

## Owned paths

- `src/application/p04-d/**`
- `src/application/bootstrap.js`, `src/application/bootstrap.d.ts`
- `src/app/root-controller.js`, `src/app/root-controller.d.ts` only for the
  smallest established-shell lifecycle or write-blocked-state seam
- `src/main.ts` only if required; it must still mount `createLegacyApplication`
  with no ordinary candidate input
- `src/pwa/**`
- `public/**` only for scoped PWA assets/service-worker lifecycle
- `vite.config.*`, `playwright.config.*`, `package.json`, and lockfile only when
  required for the PWA build/test harness
- `tests/application/**`, `tests/pwa/**`, `tests/data/**`
- focused test/build scripts required by those tests
- `scripts/production-source.mjs`, `docs/architecture.md`, and directly relevant
  PWA/data documentation

Do not edit the root template, component hierarchy, styles, permanent navigation,
domain financial semantics, sync-provider contract, cloud/account code, release
configuration, or deployment host configuration. Do not start D3 UI porting. If
a requirement truly needs a broader path, stop and explain the exact dependency
in the report rather than expanding scope.

## Required work

1. Close all D1 review residuals before routing candidate behavior:
   - expose an immutable/frozen feature-port surface and keep authority binding
     internal rather than debug-mutable;
   - gate language, calendar, deferral, and local-preference writes with the
     authority state, preserving the controller's month-deferral shape;
   - bind or reject an injected active port set so it cannot escape the latch;
   - make the TypeScript barrel resolve correctly in the repository's actual
     build/test environments;
   - keep the Home coercion difference explicitly D3-owned unless a no-behavior-
     change correction is demonstrably safe.
2. Add one candidate-only canonical guest host that composes accepted P04-B/C
   repository, migration, checkpoint, session, portability, and P03 command
   interfaces. Reuse contracts; do not duplicate finance rules.
3. Candidate startup must select one active storage authority, complete or
   recover migration/open before writes, bind canonical ports only after ready,
   and fail closed to a truthful write-blocked state on storage failure.
4. The established shell must still mount in every state. Do not introduce a
   replacement shell, blank loading takeover, generic navigation, or placeholder
   destinations. D2 may surface only the minimal existing-shell lifecycle state
   needed to prevent false success and unsafe writes.
5. Coordinate tabs for writes, import, reset, migration, and update activation.
   A service-worker update must not activate across an active critical section.
   An old binary must lose write authority after an incompatible epoch/update.
6. Add an offline-first PWA build/runtime path with zero remote runtime requests.
   Preserve the rollback retirement behavior for previously rejected
   `rushd-shell-*` caches and controller registrations. Do not claim installation
   or platform readiness beyond tested evidence.
7. Keep candidate activation build/test controlled. URL, query, hash, cookies,
   local/session storage, imported data, or mutable globals must not enable it.
   Default `npm run build` remains entirely legacy-authoritative.
8. Add `npm run test:pwa` as the focused executable gate for candidate lifecycle,
   offline reload, update coordination, old-tab blocking, and failure recovery.

## Acceptance

1. Default production still mounts `createLegacyApplication`, renders the
   established shell, writes only v1, starts no canonical host, and matches the
   accepted browser/legacy-data/visual behavior.
2. An isolated test-built candidate opens canonical v2, migrates fake v1 data,
   commits through the deterministic command gateway, reloads from v2, and works
   offline with zero external requests.
3. Storage open/migration failure still mounts the established shell and exposes
   a truthful write-blocked recovery state; no success UI can precede commit.
4. Two-tab tests prove state invalidation and that update activation cannot cross
   another tab's write/import/reset/migration critical section.
5. An incompatible old tab is hard-blocked from further writes after epoch/update
   transition.
6. Import, reset, and migration use explicit commit points and cannot create dual
   v1/v2 writers.
7. All D1 residual authority/port issues are fixed or one explicitly justified
   D3-owned display-only coercion item remains.
8. No visible design/navigation replacement, cloud/account client, deployment,
   remote dependency, or P05 work is introduced.
9. Changed files stay inside the owned paths and `git diff --check` passes.

## Validation

Run focused tests while developing, then run:

```bash
npm run lint
npm run typecheck
npm test
npm run test:data
npm run build
npm run test:pwa
npm run test:browser
npm run test:legacy-idb
npm run parity:quick
git diff --check
```

Do not weaken, delete, or bypass existing storage, migration, rollback, build-
contract, browser-smoke, legacy-data, or parity assertions. Use clearly fake test
data only. If a gate is environmentally unavailable, record the exact command
and error and preserve the candidate for review.

## Report

Write `/Users/mehmet/Desktop/Rushd-P04D-Restart/artifacts/agent-reports/P04-D2.md` with:

- complete or blocked status;
- actual model/effort and elapsed time;
- base commit and uncommitted result state;
- changed paths;
- canonical host, storage authority, migration/recovery, PWA, tab-coordination,
  and old-binary-blocking design summary;
- disposition of each D1 residual finding;
- every validation command and result;
- explicit proof that default production stayed legacy and its shell/UI remained
  unchanged;
- risks, limitations, and architecture deviations.

Do not claim P04-D or P04 complete. Stop after writing the report.
