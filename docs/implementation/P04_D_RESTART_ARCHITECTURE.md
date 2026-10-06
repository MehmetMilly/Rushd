# P04-D restart architecture

**Date:** 12 September 2026  
**Status:** chosen design; implementation not started  
**Base:** `codex/p04d-restart` at `e01e335`, with accepted P04-C product base `4f48b6f`

## Caller usage first

The visible application continues to be created and mounted through
`createLegacyApplication`. P04-D adds explicit feature ports and an authority
latch; it does not introduce a second root shell.

```ts
const host = await prepareP04DHost({
  mode: P04D_BUILD_MODE,
  environment: globalThis,
});

const { app, dataRuntime } = createLegacyApplication({
  Vue,
  environment: globalThis,
  template: rootTemplate,
  featurePorts: host.featurePorts,
});

host.bindMountedApplication(app.mount('#app'));
```

During implementation, the production build mode remains `legacy` and the
existing app behaves exactly as it does today. Canonical candidate mode is
reachable only through an explicit test/build injection, never a user-visible
localStorage flag. Production switches once, after every enabled financial
mutation has a canonical owner and the blocking compatibility gate passes.

## Grounded runtime

The current path is:

1. `src/main.ts` calls `createLegacyApplication`.
2. `src/application/bootstrap.js` creates `createLegacyDataRuntime`.
3. The root template, registered components, and `installRootController` mount
   the established UI.
4. The root controller reads and mutates the reactive legacy `Store` and calls
   the v1 `DB` wrapper directly.
5. `MicroSaveOS_DB` v1 therefore remains the visible app's authority today.

P04-B and P04-C already provide the durable v2 repository, migration, and
portability APIs. They are not wired into the visible runtime. The rejected
P04-D replaced the composition root with a separate generic guest shell. Its
storage/lifecycle work proved useful, but production use showed that replacing
the working interface and populating permanent destinations with thin later-
phase states was the wrong integration boundary.

## Constraints

- Keep `createLegacyApplication` as the mounted composition path.
- Preserve the established template, visual hierarchy, populated views, RTL/LTR
  behavior, export/import access, and characterized expense add/reload flow.
- Never ship v1 and v2 as simultaneous writers for the same finance scope.
- `MicroSaveOS_DB` is immutable migration input after canonical activation.
- All canonical writes use P03 preview/confirm/execute and resolve only after
  durable book, operation, receipt/outbox, and checkpoint effects commit.
- A storage, migration, update, or compatibility failure blocks writes visibly;
  it never falls back to a false-success in-memory or v1 write.
- Intermediate migration commits are development candidates only. No dogfood
  deployment occurs before the release latch opens.
- P04-D does not redesign the app, implement AI, claim accounts/sync, start P05,
  or publish without founder authorization.

## Candidate A: full compatibility runtime swap

Replace `createLegacyDataRuntime` with one adapter that imitates the complete
legacy `DB` and `Store` API while translating every operation to canonical
state and commands. The existing template/controller would remain almost
unchanged and production could cut over once.

### Strengths

- Smallest visible-app diff.
- One obvious authority switch.
- Strong preservation of existing component and template behavior.

### Rejection reasons

- The legacy API is broad and mutable: expense edits/deletes, templates,
  vault, settings, settlement, statistics, import/reset, and controller-local
  mutations do not map one-to-one to the append-only canonical model.
- Imitating the old object model would hide semantic translation in a shallow,
  high-risk adapter and encourage unsafe casts or fabricated fields.
- A failure would be difficult to attribute because view projection, command
  translation, persistence, and legacy compatibility would collapse into one
  module.

## Candidate B: feature ports with an atomic release latch

Keep the legacy shell and controller, but introduce explicit application ports
for each visible responsibility. Migrate one port at a time in candidate mode.
Production stays on the unchanged legacy port set until the canonical port set
covers every enabled overlapping mutation; then one build-time latch switches
the whole finance authority.

```ts
type AuthorityState =
  | { kind: 'legacy'; writable: true }
  | { kind: 'canonicalPreparing'; writable: false; reason: string }
  | { kind: 'canonicalReady'; writable: true; storageId: string }
  | { kind: 'unavailable'; writable: false; reason: string };

interface ShellFeaturePorts {
  readonly authority: AuthorityPort;
  readonly home: HomePort;
  readonly capture: CapturePort;
  readonly history: HistoryPort;
  readonly plan: PlanPort;
  readonly insights: InsightsPort;
  readonly goals: GoalsPort;
  readonly portability: PortabilityPort;
  readonly navigation: NavigationIntentPort;
  readonly lifecycle: UpdateLifecyclePort;
}
```

Each port owns a deep interface: a typed view model, its allowed actions, and
truthful busy/error/recovery state. The controller stops reaching through the
port to storage details. Canonical ports derive from `BookState` and execute
typed commands; legacy ports delegate current behavior for the production-
preservation period.

### Strengths

- Matches the founder's instruction to migrate one visible feature at a time.
- Keeps changes reviewable and lets each semantic translation receive focused
  characterization and adversarial tests.
- Prevents a compatibility facade from pretending obsolete mutable fields are
  canonical facts.
- Preserves the full established UI throughout development.

### Main risk and control

Incremental code can accidentally become incremental production authority. The
release latch prevents that: candidate mode may exercise mixed adapters only on
synthetic isolated storage, while production stays entirely legacy until all
overlapping write ports are canonical. The final switch makes v1 read-only in
one reviewed change. No intermediate candidate is published.

## Synthesis decision

Choose Candidate B. Candidate A hides too much semantic mismatch behind one
legacy-shaped adapter. Candidate B has a larger explicit module map but a
smaller public interface per feature and keeps the authority problem visible.

The design combines Candidate B's feature ports with Candidate A's single
production cutover. This yields incremental implementation without shipping a
dual-authority product.

## Module map

| Path | Responsibility |
| --- | --- |
| `src/application/p04-d/contracts.ts` | Authority state and deep feature-port contracts |
| `src/application/p04-d/legacy-ports.ts` | Current v1 behavior behind ports; temporary and characterization-backed |
| `src/application/p04-d/canonical-host.ts` | Guest identity, active-storage selection, migration/open, canonical port assembly |
| `src/application/p04-d/command-gateway.ts` | Preview/confirmation/execution, operation identity, durable success boundary |
| `src/application/p04-d/read-models/**` | Canonical Home/history/plan/insights/goals projections |
| `src/application/p04-d/authority-latch.ts` | Build-time mode, capability coverage, global write gate, no user toggle |
| `src/application/p04-d/navigation.ts` | URL intent mapping while the established shell remains mounted |
| `src/pwa/**` | Cache, registration, update coordination, offline lifecycle |
| `src/app/p04-d/**` | Thin UI adapters only where the existing controller/template needs a scoped seam |

`src/app/root-template.html`, `src/app/root-controller.js`, and
`src/application/bootstrap.js` remain the host. Changes to them must be small,
feature-bounded, and protected by the legacy browser/parity gate.

## Runtime rules

1. Legacy mode is the default until the final authority task.
2. Candidate mode uses synthetic or explicitly isolated storage only.
3. Canonical preparation blocks every candidate financial action until active
   storage is opened or migration activates successfully.
4. Once canonical mode is the production default, v1 is extraction-only. Any
   legacy write attempt is a test failure and a visible blocked action.
5. Feature ports refresh from the committed canonical repository and invalidate
   across tabs; UI-local optimistic objects never become finance truth.
6. Service-worker activation participates in the same cross-tab activity
   protocol as writes, migration, import, and reset. Controller replacement is a
   hard old-tab write boundary until compatible reopen/reload.
7. New URL intents coexist with the populated legacy shell. A later-phase
   destination must not replace a working populated screen with a blank shell.
   P04-A7 proves intent persistence and safe return; it does not claim AI or
   later-phase feature completion.

## Blocking release latch

The production mode cannot change from `legacy` to `canonical` until one
independent reviewer verifies all of the following at the same candidate SHA:

- every enabled v1 financial mutation is routed through a canonical port or is
  visibly unavailable with no local state mutation;
- expense add and reload, populated established destinations, import/export,
  reset containment, and existing-data migration all pass;
- Arabic/English, light/dark, mobile/wide parity stays within the approved
  visual direction;
- route refresh/back/forward and installed offline destination recovery pass;
- two-tab write/update/import/reset coordination and old-tab blocking pass;
- no account/cloud request and no finance data in the asset cache;
- v1 remains byte-for-byte unchanged after canonical activation;
- required P04 commands and physical P04-M1/A6 evidence pass.

## Scrap signals

Re-ground and redesign instead of patching around the plan if two or more
features require the same escape hatch, raw v1 objects leak into canonical
ports, canonical view models invent unavailable legacy fields, controller code
must understand repository/lifecycle internals, or the release latch cannot
prove complete mutation ownership mechanically.
