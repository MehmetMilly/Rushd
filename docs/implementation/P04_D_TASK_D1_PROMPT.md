# Rushd P04-D1 worker card: compatibility seam and regression lock

## Dispatch

- Repository: `/Users/mehmet/Desktop/Rushd-P04D-Restart`
- Branch: `codex/p04d-restart`
- Base: current HEAD `e01e335`; preserve all existing uncommitted planning and workflow edits
- Model: OpenCode `opencode/muse-spark-1.3-contributor-free`, variant High
- Reason: D1 is a substantial but tightly specified behavior-preserving seam with deterministic browser, data, and parity gates, so the free Muse route gets first ownership
- Result: `/Users/mehmet/Desktop/Rushd-P04D-Restart/artifacts/agent-reports/P04-D1.md`
- Git: leave product changes uncommitted for independent review; do not stage, commit, push, deploy, or publish

## Read first

1. `AGENTS.md`
2. `WORKFLOW_LITE.md`
3. `docs/implementation/P04_D_RESTART_ARCHITECTURE.md`
4. `docs/implementation/P04_D_RESTART_PLAN.md`
5. P04 in `docs/implementation/phase-plan.json`
6. `src/main.ts`, `src/application/bootstrap.js`, `src/application/bootstrap.d.ts`
7. `src/app/root-controller.js`, `src/app/root-template.html`
8. `src/data/legacy-v1/runtime.js` public `DB`/`Store` boundary
9. `tests/p02-build-contract.test.mjs`, `scripts/browser-smoke.cjs`, and visual-parity harness

Use the rejected checkout only as forensic evidence if needed. Do not copy its
`createGuestApplication`, root shell, views, generic navigation, placeholder
destinations, or production composition change.

## Outcome

Introduce the feature-port and authority-latch seam described in the chosen
architecture while preserving the visible/runtime behavior of the current
legacy application exactly. This task prepares controlled migration; it does
not open v2 storage in the ordinary production path.

## Owned paths

- `src/application/bootstrap.js`
- `src/application/bootstrap.d.ts`
- `src/application/p04-d/**`
- `src/app/root-controller.js` only for the smallest dependency-injection seam
- `src/main.ts` only if required to pass an explicit default legacy port set;
  it must still call and mount `createLegacyApplication`
- `tests/application/**`
- `tests/p02-build-contract.test.mjs`
- `scripts/production-source.mjs`
- `docs/architecture.md`

Do not edit the root template, components, styles, data/domain/PWA modules,
package files, Vite config, service workers, rollback files, or host config in
D1. If the design truly requires one of those paths, stop and explain why in
the report instead of broadening scope.

## Required design

- Define deep TypeScript contracts for authority state and feature ports. The
  contracts must cover Home, capture/Add, history, Plan, Insights, Goals,
  portability, navigation intent, and update lifecycle even if D1 implements
  only legacy delegates.
- Provide a legacy port set that delegates existing behavior rather than
  reimplementing finance calculations.
- Let `createLegacyApplication` receive an optional explicit port set. Its
  default remains the current legacy behavior for existing callers/tests.
- Add a build/test-controlled authority latch with `legacy` and
  `canonicalCandidate` concepts. In D1, ordinary production always resolves to
  `legacy`.
- Candidate injection must not be reachable through URL parameters,
  localStorage, cookies, imported user data, or mutable global flags.
- Add a mechanical mutation-coverage inventory that names every currently
  enabled controller action capable of changing finance/settings/import/reset
  state and its owning port. A missing or duplicate owner must fail a test.
- Do not translate canonical state, open P04-B/C storage, create a service
  worker, or alter navigation/visual output yet.
- Keep the debug bridge and existing characterization behavior intact.

## Acceptance

1. `src/main.ts` still mounts `createLegacyApplication`; no alternate root app
   or shell exists.
2. Default application behavior and rendered markup remain unchanged.
3. The explicit port contracts and mutation coverage are typechecked and tested.
4. Production runtime inputs cannot enable candidate mode.
5. Legacy port delegation does not copy finance formulas or create new writes.
6. No v2 database, migration, account/cloud client, fetch guard, or service
   worker is started by D1.
7. Existing expense add/reload, populated destination, import/export access,
   RTL/LTR, debug bridge, and visual parity gates pass.
8. The changed-file set stays inside the owned paths and `git diff --check`
   passes.

## Validation

Run focused tests during implementation, then run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:browser
npm run test:legacy-idb
npm run parity:quick
git diff --check
```

Do not weaken, delete, or bypass the rollback, build-contract, browser-smoke,
legacy-data, or parity assertions. If a gate is unavailable for an environmental
reason, record the exact command/error and preserve the candidate for review.

## Report

Write `/Users/mehmet/Desktop/Rushd-P04D-Restart/artifacts/agent-reports/P04-D1.md` with:

- complete or blocked status;
- actual model/effort and elapsed time;
- base and uncommitted result state;
- changed paths;
- contract/module summary and mutation-coverage inventory location;
- every command and result;
- explicit confirmation that default production behavior stayed legacy and no
  v2/PWA path opened;
- risks, limitations, and any architecture deviation.

Do not claim P04-D or P04 complete. Stop after the report.
