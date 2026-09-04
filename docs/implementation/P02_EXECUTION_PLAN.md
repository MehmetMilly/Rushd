# P02 execution plan

**Decision date:** 4 September 2026
**Starting commit:** `3215ca3c9380104b5bbc38b66b99e3df0ff44779`

This is the Development Master's execution decision for P02. It incorporates the GLM reconnaissance, GLM/Muse feasibility spike, and Fable 5.1 architecture review while keeping Workflow Lite's larger tasks and proportional verification.

## End state

P02 ends with a thin Vite entry, local runtime assets, strict TypeScript for new and low-coupling code, and mechanically preserved legacy behavior behind explicit ownership boundaries.

- `index.html`: meta, pre-paint preference boot, `#app`, stylesheet links, and the module entry.
- `src/app/**`: root template, composition-facing UI controller, and application i18n.
- `src/components/**`: the seven runtime-compiled legacy component templates. SFC conversion belongs to P05/P06.
- `src/application/**`: bootstrap, legacy Store compatibility, and the temporary debug/test bridge.
- `src/data/legacy-v1/**`: `MicroSaveOS_DB` version 1 access, legacy normalizers, and backup validation. P04 owns migration and retirement.
- `src/shared/**`: strict TypeScript date, money, constants, and other low-coupling helpers. P03 may evolve these.
- `src/styles/**` and `public/**`: local Tailwind output, fonts, icons, and licenses.

The runtime Vue compiler remains as a named bridge through P02 because the root and all seven registered components use runtime templates. Routing remains out of P02; P04/P05 own persistent URLs and the final shell. The database name, version, stores, and current records remain unchanged.

Strict TypeScript applies to new glue, shared helpers, i18n contracts, and legacy record contracts. Mechanically moved Store, controller, and component code may remain JavaScript under `allowJs` without pretending it has been safely redesigned. Tests must not depend on a Node-version-specific TypeScript shortcut when a project runner or build step is more portable.

## Task A — Proof and build foundation

Create the visual comparison tool before production edits, then introduce the Vite build shell, pinned local Vue, lint, typecheck, build scripts, CI configuration, and updated developer instructions.

The comparison tool supports:

- a quick representative profile for ordinary mechanical checkpoints;
- the full language, theme, viewport, and characterized-state matrix for the modular split and phase close;
- live old-root versus candidate comparison from pinned worktrees, so a second permanent screenshot archive is unnecessary;
- a deliberate-mutation self-test proving that differences are detected.

Capture or compare against the pre-P02 state at `3215ca3`. The P00 images remain historical evidence from `b56c80b`, not the zero-diff comparator after P01.

**Worker:** Muse Spark 1.3 High.

**Review:** Development Master direct.

**Gate:** repository tests, browser smoke on the built output, build/lint/typecheck, deterministic self-compare, deliberate-difference detection, and zero unexplained quick-profile drift.

## Task B — Local styling and font assets

Replace Tailwind Play CDN, Google Fonts, and Material Symbols runtime requests with pinned local build/assets while the application still has its original structural shape. Preserve stylesheet order and current rendering. Include the relevant font/icon licenses.

Use Tailwind v3-compatible configuration for the mechanical migration. A later design phase may reconsider the styling system. Check source coverage for utility classes; avoid a complex rendered-class oracle unless a real dynamic-class failure appears.

**Worker:** Muse Spark 1.3 High.

**Review:** Development Master direct when parity is clean; independent review only for accepted unexplained visual drift.

**Gate:** no external runtime requests, browser smoke, repository/build checks, and zero unexplained quick-profile drift. Run the full visual profile if font or cascade behavior remains uncertain.

## Task C — Atomic modular split

Perform the parser-based structural split as one controlled integration task:

- extract template, styles, components, controller, data compatibility, Store, i18n, and shared helpers into the ownership paths above;
- convert cross-block globals into explicit imports;
- keep runtime template compilation through the documented Vue compiler alias;
- import real production modules in the Node harness while preserving its public return shape and existing P01 assertions;
- move static source checks to the owning modules without weakening their meaning;
- add i18n key-parity and duplicate-key protection;
- fix the two known missing English keys and remove the shadowed duplicate English key as declared, explained drift;
- retain current finance, date, queue, generation-counter, UUID, serialization, and IndexedDB behavior.

Use a narrow browser-environment seam for data and testability. Do not force every UI use of `document` or `navigator` through a new abstraction during this mechanical phase. Avoid a generic `src/legacy/**` dumping ground; place compatibility code where P03–P06 can own or retire it.

**Worker:** Grok 4.6 xHigh if available; otherwise Muse Spark 1.3 xHigh.

**Review:** independent xHigh reviewer from a different model family. Prefer Muse when Grok writes, or Terra when Muse writes.

**Gate:** every P02 required command, unchanged P01 production-path assertions, local-assets proof, full pre-P02 visual comparison with only declared translation drift, legacy database reopen/read proof, module ownership review, and no unexplained runtime warnings.

## Closure

P02 closes after Task C passes independent review and the Development Master verifies every P02 acceptance outcome. Documentation and the final attribution report are part of Task C or the closure review, not a separate paperwork task.

CI configuration can be committed and tested locally without pushing. Before public or private remote execution becomes a release claim, the founder decides whether to push. Pre-P02 reference images remain reproducible from the pinned commit and need not be duplicated permanently in Git.

If Astra becomes available before Task C starts, use it for one compact challenge of this execution plan. Otherwise use Astra at the P02/P03 boundary, where its review can still change the finance-domain architecture without discarding completed mechanical work.
