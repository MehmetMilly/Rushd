# Astra P02 review packet

Use this packet for one architecture and acceleration review before P02 implementation begins. The evidence documents are inputs, not authority; challenge their recommendations and verify any fact that materially changes the plan.

## Objective

Design the fastest credible path through P02 while preserving the full Rushd product scope and the verified P01 behavior. Improve sequencing, task boundaries, and safe overlap without recreating the retired governance ceremony.

## Read order

1. `AGENTS.md`
2. `docs/RUSHD_MASTER_PLAN_FINAL.md`
3. The P02–P04 contracts in `docs/implementation/phase-plan.json`
4. `WORKFLOW_LITE.md`
5. `docs/implementation/ACTIVE_DELIVERY_PLAN.md`
6. `docs/implementation/DEVELOPMENT_MASTER_HANDOFF.md`
7. `docs/implementation/P02_TECHNICAL_RECONNAISSANCE.md`
8. `docs/implementation/P02_FEASIBILITY_SPIKE.md`
9. Current Git log and the relevant production and test files

## Current state

- Branch: `codex/rushd-rebuild-plan`
- P01 reviewed product baseline: `075317ebebd1aa4f366a2ac6fd3f715f748d54fe`
- Development workflow documentation commit: `bfa13b33b3439090492547d406a24b55ae85a98f`
- P02 implementation has not started.
- The full approved feature set remains in scope.

## Evidence highlights to challenge

- Vite 5 can wrap and serve the unchanged prototype, but that alone provides no modularity or local assets.
- Parser-based classic-script extraction preserved behavior in Chromium, while a naive Vite build of external classic scripts produced seven missing-script responses.
- The in-DOM root template and one component string template currently depend on Vue's runtime compiler.
- The Node production harness depends on seven inline scripts in a fixed order; a script-source-aware loader or direct module imports are needed early.
- `Core`, translations, constants, and pure helpers appear to be low-coupling extraction seams.
- A same-origin blank page reopened `MicroSaveOS_DB` version 1 and read its three stores without an upgrade.
- No dynamically constructed Tailwind utility was found, making build-time scanning plausible if source globs and a guard are correct.
- Financial and data behavior has meaningful production-path coverage; most UI flows and visual parity do not.

## Decisions requested

Recommend:

1. the P02 target architecture and migration sequence;
2. a small number of substantial worker tasks with dependencies and completion gates;
3. the TypeScript rollout boundary for P02 versus later phases;
4. the temporary or permanent treatment of runtime-compiled templates;
5. when to replace Tailwind Play CDN and self-host fonts and icons;
6. whether routing belongs in P02 and, if so, its minimum behavior-preserving scope;
7. how to migrate the test harness without weakening production-path proof;
8. the smallest credible visual-parity gate for the mechanical split;
9. work that can safely begin in parallel after stable P02 boundaries exist;
10. schedule risks or assumptions that should change before implementation starts.

Resolve contradictions between the evidence documents where possible. Label remaining uncertainty and identify the cheapest experiment that would resolve it. Preserve `MicroSaveOS_DB`, Arabic/English parity, P01 financial truth, and the master plan's feature scope.

Return advice and a proposed execution shape. Do not edit code or reduce the product to an earlier alpha milestone.
